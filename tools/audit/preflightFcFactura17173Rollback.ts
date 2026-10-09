import { loadEnv } from '../../src/config/env.js';
import { createBizlinksPool, createGreFcPool, sql } from '../../src/integrations/bizlinksSql.js';
import type { StoredProcedureParam } from '../../src/mappers/speDespatchProcedureMapper.js';
import { fcFacturaPreviewSchema } from '../../src/schemas/fcFacturaSchema.js';
import { assertGuidesNotAlreadyTraced, DirectDbFcFacturaService } from '../../src/services/fcFacturaService.js';

const SOURCE = 'FF01-00017173';
const TARGET = 'FF01-00017174';
const GUIDE = 'T001-00000101';

async function executeProcedure(
  transaction: sql.Transaction,
  name: string,
  params: StoredProcedureParam[]
) {
  const request = new sql.Request(transaction);
  for (const param of params) request.input(param.name, sql.NVarChar, param.value);
  await request.execute(name);
}

async function main() {
  const config = loadEnv();
  const service = new DirectDbFcFacturaService(config);
  const next = await service.getNextSerie();
  if (next.serieNumeroFactura !== TARGET) {
    throw new Error(`Correlativo inesperado: ${next.serieNumeroFactura}; se esperaba ${TARGET}.`);
  }

  const pending = await service.listGuiasPendientes('20307214386');
  if (!pending.guias.some((guide) => guide.serieNumeroGuia === GUIDE)) {
    throw new Error(`La guia ${GUIDE} no esta disponible para facturar.`);
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
    const source = await gre.request()
      .input('serie', sql.VarChar(13), SOURCE)
      .query<{ datosJson: string }>(`
        SELECT TOP (1) datosJson
        FROM dbo.FC_FACT_OPERACION
        WHERE serieNumeroFactura = @serie
        ORDER BY id DESC;
      `);
    if (!source.recordset[0]) throw new Error(`No existe la fuente local ${SOURCE}.`);

    const parsed = fcFacturaPreviewSchema.parse(JSON.parse(source.recordset[0].datosJson));
    const customer = (await service.searchClientes(parsed.cliente.numeroDocumento))
      .find((item) => item.numeroDocumento === parsed.cliente.numeroDocumento);
    if (!customer?.direccionFiscal) {
      throw new Error(`El cliente ${parsed.cliente.numeroDocumento} no tiene direccion fiscal verificable.`);
    }
    const input = fcFacturaPreviewSchema.parse({
      ...parsed,
      numero: TARGET.slice(-8),
      cliente: {
        ...parsed.cliente,
        direccionFiscal: customer.direccionFiscal
      }
    });
    const preview = await service.preview(input);
    const blocking = preview.validations.filter((validation) => validation.severity === 'error');
    if (blocking.length > 0) {
      throw new Error(blocking.map((validation) => validation.message).join(' '));
    }
    if (preview.totals.total !== 171.1 || preview.financial.netoPendiente !== 171.1) {
      throw new Error(`Totales inesperados: ${JSON.stringify({ totals: preview.totals, financial: preview.financial })}`);
    }

    await greTransaction.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);
    greStarted = true;
    await assertGuidesNotAlreadyTraced(greTransaction, input, config.bizlinksDb.database);

    await bizTransaction.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);
    bizStarted = true;
    const existing = await new sql.Request(bizTransaction)
      .input('serie', sql.VarChar(13), TARGET)
      .query<{ total: number }>(`
        SELECT
          (SELECT COUNT(1) FROM dbo.SPE_EINVOICEHEADER WHERE SERIENUMERO = @serie AND TIPODOCUMENTO = '01')
          + (SELECT COUNT(1) FROM dbo.SPE_EINVOICEDETAIL WHERE SERIENUMERO = @serie AND TIPODOCUMENTO = '01')
          + (SELECT COUNT(1) FROM dbo.SPE_EINVOICE_RESPONSE WHERE SERIENUMERO = @serie AND TIPODOCUMENTO = '01') AS total;
      `);
    if (Number(existing.recordset[0]?.total ?? 0) !== 0) throw new Error(`${TARGET} ya no esta libre.`);

    await executeProcedure(bizTransaction, 'dbo.USP_CabeceraFE', preview.procedurePlan.USP_CabeceraFE);
    for (const params of preview.procedurePlan.USP_DetalleFE) {
      await executeProcedure(bizTransaction, 'dbo.USP_DetalleFE', params);
    }

    const persisted = await new sql.Request(bizTransaction)
      .input('serie', sql.VarChar(13), TARGET)
      .query<{
        estado: string;
        totalVenta: number | string;
        montoNetoPendiente: number | string | null;
        totalCuotas: number | string | null;
        items: number;
      }>(`
        SELECT h.BL_ESTADOREGISTRO AS estado, h.totalVenta,
          MAX(CASE WHEN a.clave = 'montoNetoPendiente' THEN CONVERT(decimal(18, 2), a.valor) END) AS montoNetoPendiente,
          SUM(CASE WHEN a.clave LIKE 'montoPagoCuota%' THEN CONVERT(decimal(18, 2), a.valor) ELSE 0 END) AS totalCuotas,
          (SELECT COUNT(1) FROM dbo.SPE_EINVOICEDETAIL d WHERE d.SERIENUMERO = h.SERIENUMERO AND d.TIPODOCUMENTO = '01') AS items
        FROM dbo.SPE_EINVOICEHEADER h
        LEFT JOIN dbo.SPE_EINVOICEHEADER_ADD a
          ON a.SERIENUMERO = h.SERIENUMERO
         AND a.TIPODOCUMENTO = h.TIPODOCUMENTO
         AND a.NUMERODOCUMENTOEMISOR = h.NUMERODOCUMENTOEMISOR
        WHERE h.SERIENUMERO = @serie AND h.TIPODOCUMENTO = '01'
        GROUP BY h.SERIENUMERO, h.BL_ESTADOREGISTRO, h.totalVenta;
      `);
    const row = persisted.recordset[0];
    if (
      !row
      || row.estado !== 'N'
      || Number(row.totalVenta) !== 171.1
      || Number(row.montoNetoPendiente) !== 171.1
      || Number(row.totalCuotas) !== 171.1
      || Number(row.items) !== input.items.length
    ) {
      throw new Error(`Persistencia previa incompatible: ${JSON.stringify(row)}`);
    }

    console.log(JSON.stringify({
      result: 'PREFLIGHT_OK_ROLLBACK_REQUIRED',
      target: TARGET,
      guide: GUIDE,
      nextSerie: next,
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

  console.log('ROLLBACK completado. No se ejecuto USP_EnviaDocumentoFE ni se envio a Bizlinks.');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
