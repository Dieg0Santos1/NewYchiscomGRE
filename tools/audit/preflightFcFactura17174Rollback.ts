import { loadEnv } from '../../src/config/env.js';
import { createBizlinksPool, createGreFcPool, sql } from '../../src/integrations/bizlinksSql.js';
import type { StoredProcedureParam } from '../../src/mappers/speDespatchProcedureMapper.js';
import type { FcFacturaPreviewInput } from '../../src/schemas/fcFacturaSchema.js';
import { assertGuidesNotAlreadyTraced, DirectDbFcFacturaService } from '../../src/services/fcFacturaService.js';

const TARGET = 'FF01-00017174';
const GUIDE = 'T001-00000102';
const CLIENT_RUC = '20481252475';
const UNIT_PRICE = 694.92;
const EXPECTED_TOTAL = 2460.02;

async function main() {
  const config = loadEnv();
  const service = new DirectDbFcFacturaService(config);
  const next = await service.getNextSerie();
  if (next.serieNumeroFactura !== TARGET) {
    throw new Error(`Correlativo inesperado: ${next.serieNumeroFactura}; se esperaba ${TARGET}.`);
  }

  const pending = await service.listGuiasPendientes(CLIENT_RUC);
  const customer = (await service.searchClientes(CLIENT_RUC))
    .find((item) => item.numeroDocumento === CLIENT_RUC);
  if (!customer?.direccionFiscal) throw new Error(`El cliente ${CLIENT_RUC} no tiene direccion fiscal verificable.`);
  const guide = pending.guias.find((item) => item.serieNumeroGuia === GUIDE);
  if (!guide) throw new Error(`La guia ${GUIDE} no esta pendiente para facturar.`);
  if (guide.estadoSunat !== 'ACEPTADA') throw new Error(`Estado SUNAT inesperado para ${GUIDE}.`);
  if (guide.items.length !== 1) throw new Error(`Se esperaba un item en ${GUIDE}.`);

  const input: FcFacturaPreviewInput = {
    serie: 'FF01',
    numero: TARGET.slice(-8),
    fechaEmision: '2026-09-17',
    moneda: 'PEN',
    tipoCambio: null,
    formaPago: 'Contado C/E',
    diasPago: 0,
    cuenta: '7022111',
    tipoDetraccion: '000',
    tipoExclusionProducto: 'GRAVADA',
    vendedor: pending.vendedor,
    ordenCompra: '',
    observaciones: '',
    cliente: {
      ...guide.cliente,
      direccionFiscal: customer.direccionFiscal
    },
    guias: [{ serieNumeroGuia: GUIDE }],
    items: guide.items.map((item) => ({ ...item, precioUnitario: UNIT_PRICE }))
  };

  const preview = await service.preview(input);
  const blocking = preview.validations.filter((validation) => validation.severity === 'error');
  if (blocking.length > 0) throw new Error(blocking.map((item) => item.message).join(' '));
  if (Math.abs(preview.totals.total - EXPECTED_TOTAL) > 0.001) {
    throw new Error(`Total inesperado: ${preview.totals.total}.`);
  }

  const headerPlan = new Map(preview.procedurePlan.USP_CabeceraFE.map((param) => [param.name, param.value]));
  if (headerPlan.get('tipoOperacion') !== '0101') throw new Error('La operacion no usa 0101.');
  if (
    headerPlan.get('CODIGODETRACCION') != null
    || headerPlan.get('PORCENTAJEDETRACCION') != null
    || headerPlan.get('TOTALDETRACCION') != null
  ) {
    throw new Error('El plan contiene datos de detraccion pese a la confirmacion de no sujecion.');
  }

  const gre = createGreFcPool(config);
  const biz = createBizlinksPool(config);
  await gre.connect();
  await biz.connect();
  const greTransaction = new sql.Transaction(gre);
  const bizTransaction = new sql.Transaction(biz);
  let greStarted = false;
  let bizStarted = false;

  try {
    await greTransaction.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);
    greStarted = true;
    await assertGuidesNotAlreadyTraced(greTransaction, input, config.bizlinksDb.database);

    await bizTransaction.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);
    bizStarted = true;
    const before = await new sql.Request(bizTransaction)
      .input('target', sql.VarChar(13), TARGET)
      .input('guide', sql.VarChar(20), GUIDE)
      .query<{ targetRows: number; guideLinks: number }>(`
        SELECT
          (SELECT COUNT(1) FROM dbo.SPE_EINVOICEHEADER WITH (UPDLOCK, HOLDLOCK)
            WHERE SERIENUMERO = @target AND TIPODOCUMENTO = '01') AS targetRows,
          (SELECT COUNT(1) FROM dbo.AAA_GUIAFACTURADA WITH (UPDLOCK, HOLDLOCK)
            WHERE NRO_GUIA = @guide) AS guideLinks;
      `);
    if (Number(before.recordset[0]?.targetRows) !== 0) throw new Error(`${TARGET} ya no esta libre.`);
    if (Number(before.recordset[0]?.guideLinks) !== 0) throw new Error(`${GUIDE} ya esta ligada a una factura.`);

    await executeProcedure(bizTransaction, 'dbo.USP_CabeceraFE', preview.procedurePlan.USP_CabeceraFE);
    for (const detail of preview.procedurePlan.USP_DetalleFE) {
      await executeProcedure(bizTransaction, 'dbo.USP_DetalleFE', detail);
    }

    await new sql.Request(bizTransaction)
      .input('ruc', sql.VarChar(20), config.remitente.numeroDocumento)
      .input('guide', sql.VarChar(20), GUIDE)
      .input('target', sql.VarChar(13), TARGET)
      .input('date', sql.Date, input.fechaEmision)
      .query(`
        INSERT INTO dbo.AAA_GUIAFACTURADA
          (RUC_EMISOR, NRO_GUIA, NRO_FACTURA, FECHA_EMISION, USUARIO, ESTADO)
        VALUES (@ruc, @guide, @target, @date, 0, 'FACTURADO');
      `);

    await executeProcedure(bizTransaction, 'dbo.USP_EnviaDocumentoFE', preview.procedurePlan.USP_EnviaDocumentoFE);

    const persisted = await new sql.Request(bizTransaction)
      .input('target', sql.VarChar(13), TARGET)
      .input('guide', sql.VarChar(20), GUIDE)
      .query<{
        estado: string;
        ruc: string;
        moneda: string;
        total: number | string;
        tipoOperacion: string;
        detraccion: string | null;
        referencia: string | null;
        tipoReferencia: string | null;
        items: number;
        cuotas: number;
        montoPendiente: number;
        links: number;
      }>(`
        SELECT h.BL_ESTADOREGISTRO AS estado,
          h.NUMERODOCUMENTOADQUIRIENTE AS ruc,
          h.tipoMoneda AS moneda,
          h.totalVenta AS total,
          h.tipoOperacion,
          h.codigoDetraccion AS detraccion,
          h.numeroDocumentoReferencia_1 AS referencia,
          h.tipoReferencia_1 AS tipoReferencia,
          (SELECT COUNT(1) FROM dbo.SPE_EINVOICEDETAIL d
            WHERE d.SERIENUMERO = h.SERIENUMERO AND d.TIPODOCUMENTO = '01') AS items,
          (SELECT COUNT(1) FROM dbo.SPE_EINVOICEHEADER_ADD a
            WHERE a.SERIENUMERO = h.SERIENUMERO AND a.TIPODOCUMENTO = '01'
              AND a.clave LIKE 'montoPagoCuota%') AS cuotas,
          (SELECT COUNT(1) FROM dbo.SPE_EINVOICEHEADER_ADD a
            WHERE a.SERIENUMERO = h.SERIENUMERO AND a.TIPODOCUMENTO = '01'
              AND a.clave = 'montoNetoPendiente') AS montoPendiente,
          (SELECT COUNT(1) FROM dbo.AAA_GUIAFACTURADA g
            WHERE g.NRO_FACTURA = h.SERIENUMERO AND g.NRO_GUIA = @guide) AS links
        FROM dbo.SPE_EINVOICEHEADER h
        WHERE h.SERIENUMERO = @target AND h.TIPODOCUMENTO = '01';
      `);

    const row = persisted.recordset[0];
    if (!row) throw new Error('USP_CabeceraFE no creo la cabecera.');
    if (row.estado !== 'A') throw new Error(`Estado previo inesperado: ${row.estado}.`);
    if (row.ruc !== CLIENT_RUC || row.moneda !== 'PEN') throw new Error('Cliente o moneda incorrectos.');
    if (Math.abs(Number(row.total) - EXPECTED_TOTAL) > 0.001) throw new Error(`Total persistido incorrecto: ${row.total}.`);
    if (row.tipoOperacion !== '0101' || row.detraccion != null) throw new Error('Operacion o detraccion incorrecta.');
    if (row.referencia !== GUIDE || row.tipoReferencia !== '09') throw new Error('Referencia GRE incorrecta.');
    if (
      Number(row.items) !== 1
      || Number(row.cuotas) !== 0
      || Number(row.montoPendiente) !== 0
      || Number(row.links) !== 1
    ) {
      throw new Error(`Detalle o pago al contado incorrecto: ${JSON.stringify(row)}.`);
    }

    console.log(JSON.stringify({
      result: 'PREFLIGHT_COMPLETO_OK',
      factura: TARGET,
      guia: GUIDE,
      cliente: guide.cliente,
      vendedor: pending.vendedor,
      totals: preview.totals,
      financial: preview.financial,
      persisted
    }, null, 2));
  } finally {
    if (bizStarted) await bizTransaction.rollback().catch(() => undefined);
    if (greStarted) await greTransaction.rollback().catch(() => undefined);
    await biz.close();
    await gre.close();
  }

  console.log('ROLLBACK completado. No se envio ni se reservo el correlativo.');
}

async function executeProcedure(
  transaction: sql.Transaction,
  procedureName: string,
  params: StoredProcedureParam[]
) {
  const request = new sql.Request(transaction);
  for (const param of params) request.input(param.name, sql.NVarChar, param.value);
  await request.execute(procedureName);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
