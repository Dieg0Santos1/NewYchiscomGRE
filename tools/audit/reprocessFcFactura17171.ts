import { loadEnv } from '../../src/config/env.js';
import { getGreDefaults } from '../../src/config/greDefaults.js';
import { createBizlinksPool, createGreFcPool, sql } from '../../src/integrations/bizlinksSql.js';
import { toFcFacturaProcedurePlan } from '../../src/mappers/fcFacturaProcedureMapper.js';
import { fcFacturaPreviewSchema } from '../../src/schemas/fcFacturaSchema.js';
import type { StoredProcedureParam } from '../../src/mappers/speDespatchProcedureMapper.js';

const FACTURA = 'FF01-00017171';
const GUIA = 'T001-00000093';
const RUC_CLIENTE = '10406265574';
const TOTAL = 0.59;
const apply = process.argv.includes('--apply');

async function main() {
  const config = loadEnv();
  const gre = createGreFcPool(config);
  const biz = createBizlinksPool(config);
  await gre.connect();
  await biz.connect();

  try {
    const operation = await new sql.Request(gre)
      .input('factura', sql.VarChar(13), FACTURA)
      .query<{
        id: number;
        datosJson: string;
        gravada: number | string;
        igv: number | string;
        total: number | string;
      }>(`
        SELECT TOP (1) id, datosJson, gravada, igv, total
        FROM dbo.FC_FACT_OPERACION
        WHERE serieNumeroFactura = @factura
        ORDER BY id DESC;
      `);
    const row = operation.recordset[0];
    if (!row) throw new Error(`No existe trazabilidad interna para ${FACTURA}.`);

    const input = fcFacturaPreviewSchema.parse({
      ...JSON.parse(row.datosJson),
      numero: FACTURA.split('-')[1],
      tipoDetraccion: '000'
    });
    const totals = {
      gravada: Number(row.gravada),
      igv: Number(row.igv),
      total: Number(row.total)
    };
    assertInput(input.cliente.numeroDocumento, totals.total, input.guias.map((item) => item.serieNumeroGuia));

    const plan = toFcFacturaProcedurePlan(input, getGreDefaults(config), totals);
    assertCorrectedPlan(plan.USP_CabeceraFE);

    const transaction = new sql.Transaction(biz);
    await transaction.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);
    try {
      const snapshot = await readLockedSnapshot(transaction, config.remitente.numeroDocumento);
      assertSafeToReprocess(snapshot);

      await executeStoredProcedure(transaction, 'dbo.USP_CabeceraFE', plan.USP_CabeceraFE);
      for (const params of plan.USP_DetalleFE) {
        await executeStoredProcedure(transaction, 'dbo.USP_DetalleFE', params);
      }
      await executeStoredProcedure(transaction, 'dbo.USP_EnviaDocumentoFE', plan.USP_EnviaDocumentoFE);

      const corrected = await readCorrectedState(transaction);
      assertCorrectedState(corrected, input.items.length);

      console.log(JSON.stringify({
        mode: apply ? 'APPLY' : 'ROLLBACK',
        factura: FACTURA,
        before: snapshot.header,
        after: corrected.header,
        itemCount: corrected.itemCount,
        preservedErrorRows: snapshot.errorCount
      }, null, 2));

      if (apply) {
        await transaction.commit();
        console.log('COMMIT completado: Bizlinks puede procesar la factura.');
      } else {
        await transaction.rollback();
        console.log('ROLLBACK completado: no se envio ni modifico la factura.');
      }
    } catch (error) {
      await rollbackQuietly(transaction);
      throw error;
    }

    if (apply) await pollResponse(biz);
  } finally {
    await biz.close();
    await gre.close();
  }
}

async function readLockedSnapshot(transaction: sql.Transaction, emitterRuc: string) {
  const result = await new sql.Request(transaction)
    .input('factura', sql.VarChar(13), FACTURA)
    .input('guia', sql.VarChar(13), GUIA)
    .input('emitterRuc', sql.VarChar(20), emitterRuc)
    .query(`
      SET LOCK_TIMEOUT 10000;

      SELECT SERIENUMERO, NUMERODOCUMENTOADQUIRIENTE, RAZONSOCIALADQUIRIENTE,
        totalVenta, tipoOperacion, codigoDetraccion, porcentajeDetraccion,
        totalDetraccion, codigoAuxiliar40_1, textoAuxiliar40_1, BL_SOURCEFILE,
        BL_ESTADOREGISTRO
      FROM dbo.SPE_EINVOICEHEADER WITH (UPDLOCK, HOLDLOCK)
      WHERE SERIENUMERO = @factura AND TIPODOCUMENTO = '01';

      SELECT COUNT(*) AS itemCount
      FROM dbo.SPE_EINVOICEDETAIL WITH (UPDLOCK, HOLDLOCK)
      WHERE SERIENUMERO = @factura AND TIPODOCUMENTO = '01';

      SELECT COUNT(*) AS responseCount
      FROM dbo.SPE_EINVOICE_RESPONSE WITH (UPDLOCK, HOLDLOCK)
      WHERE SERIENUMERO = @factura AND TIPODOCUMENTO = '01';

      SELECT COUNT(*) AS downloadCount
      FROM dbo.SPE_JOB_DOWNLOAD WITH (UPDLOCK, HOLDLOCK)
      WHERE numeroDocumentoEmisor = @emitterRuc
        AND tipoDocumento = '01' AND serieNumero = @factura;

      SELECT COUNT(*) AS linkCount
      FROM dbo.AAA_GUIAFACTURADA WITH (UPDLOCK, HOLDLOCK)
      WHERE NRO_FACTURA = @factura AND NRO_GUIA = @guia;

      SELECT COUNT(*) AS errorCount
      FROM dbo.SPE_ERROR_LOG
      WHERE SERIENUMERO = @factura AND TIPODOCUMENTO = '01';
    `);

  return {
    header: result.recordsets[0]?.[0] as Record<string, unknown> | undefined,
    itemCount: Number(result.recordsets[1]?.[0]?.itemCount ?? 0),
    responseCount: Number(result.recordsets[2]?.[0]?.responseCount ?? 0),
    downloadCount: Number(result.recordsets[3]?.[0]?.downloadCount ?? 0),
    linkCount: Number(result.recordsets[4]?.[0]?.linkCount ?? 0),
    errorCount: Number(result.recordsets[5]?.[0]?.errorCount ?? 0)
  };
}

function assertSafeToReprocess(snapshot: Awaited<ReturnType<typeof readLockedSnapshot>>) {
  if (!snapshot.header) throw new Error('La cabecera rechazada ya no existe.');
  if (snapshot.responseCount !== 0) throw new Error('Bizlinks ya genero una respuesta; reproceso cancelado.');
  if (snapshot.downloadCount !== 0) throw new Error('Ya existe una descarga PDF/XML; reproceso cancelado.');
  if (snapshot.header.BL_SOURCEFILE != null) throw new Error('Bizlinks ya genero un archivo fuente; reproceso cancelado.');
  if (String(snapshot.header.NUMERODOCUMENTOADQUIRIENTE) !== RUC_CLIENTE) throw new Error('El RUC no coincide.');
  if (Math.abs(Number(snapshot.header.totalVenta) - TOTAL) > 0.001) throw new Error('El total no coincide.');
  if (snapshot.itemCount !== 1) throw new Error(`Se esperaban 1 item y existen ${snapshot.itemCount}.`);
  if (snapshot.linkCount !== 1) throw new Error('La relacion guia-factura no coincide exactamente.');
  if (snapshot.errorCount < 1) throw new Error('No se encontro el error historico que sustenta el reproceso.');
}

async function readCorrectedState(transaction: sql.Transaction) {
  const result = await new sql.Request(transaction)
    .input('factura', sql.VarChar(13), FACTURA)
    .query(`
      SELECT SERIENUMERO, BL_ESTADOREGISTRO, NUMERODOCUMENTOADQUIRIENTE,
        totalVenta, tipoOperacion, codigoDetraccion, porcentajeDetraccion,
        totalDetraccion, ubigeoEmisor, departamentoEmisor, provinciaEmisor,
        distritoEmisor, urbanizacion, codigoAuxiliar40_1, textoAuxiliar40_1
      FROM dbo.SPE_EINVOICEHEADER
      WHERE SERIENUMERO = @factura AND TIPODOCUMENTO = '01';

      SELECT COUNT(*) AS itemCount
      FROM dbo.SPE_EINVOICEDETAIL
      WHERE SERIENUMERO = @factura AND TIPODOCUMENTO = '01';

      SELECT COUNT(*) AS invalidSunatProductCodes
      FROM dbo.SPE_EINVOICEDETAIL
      WHERE SERIENUMERO = @factura AND TIPODOCUMENTO = '01'
        AND codigoProductoSunat IS NOT NULL;
    `);
  return {
    header: result.recordsets[0]?.[0] as Record<string, unknown> | undefined,
    itemCount: Number(result.recordsets[1]?.[0]?.itemCount ?? 0),
    invalidSunatProductCodes: Number(result.recordsets[2]?.[0]?.invalidSunatProductCodes ?? 0)
  };
}

function assertCorrectedState(state: Awaited<ReturnType<typeof readCorrectedState>>, expectedItems: number) {
  const header = state.header;
  if (!header) throw new Error('El SP no recreo la cabecera.');
  if (state.itemCount !== expectedItems) throw new Error('El SP no recreo todos los detalles.');
  if (state.invalidSunatProductCodes !== 0) throw new Error('El codigo de producto SUNAT opcional no quedo vacio.');
  if (header.tipoOperacion !== '0101') throw new Error('La operacion no quedo como venta interna normal 0101.');
  if (header.codigoDetraccion != null || header.totalDetraccion != null) throw new Error('La detraccion no quedo vacia.');
  if (header.ubigeoEmisor !== '150115') throw new Error('El ubigeo fiscal del emisor no coincide.');
  if (!String(header.textoAuxiliar40_1 ?? '').trim()) throw new Error('Falta el texto auxiliar del vendedor.');
  if (header.BL_ESTADOREGISTRO !== 'A') throw new Error(`Estado posterior inesperado: ${header.BL_ESTADOREGISTRO}.`);
}

function assertInput(ruc: string, total: number, guides: string[]) {
  if (ruc !== RUC_CLIENTE) throw new Error(`RUC interno inesperado: ${ruc}.`);
  if (Math.abs(total - TOTAL) > 0.001) throw new Error(`Total interno inesperado: ${total}.`);
  if (guides.length !== 1 || guides[0] !== GUIA) throw new Error(`Guia interna inesperada: ${guides.join(', ')}.`);
}

function assertCorrectedPlan(params: StoredProcedureParam[]) {
  const values = new Map(params.map((param) => [param.name, param.value]));
  if (values.get('tipoOperacion') !== '0101') throw new Error('El plan no usa operacion 0101.');
  if (values.get('CODIGODETRACCION') != null) throw new Error('El plan aun contiene detraccion.');
  if (values.get('codigoAuxiliar40_1') !== '9218') throw new Error('Falta el codigo auxiliar 9218.');
  if (!String(values.get('textoAuxiliar40_1') ?? '').trim()) throw new Error('Falta el vendedor auxiliar.');
}

async function executeStoredProcedure(
  transaction: sql.Transaction,
  procedureName: string,
  params: StoredProcedureParam[]
) {
  const request = new sql.Request(transaction);
  for (const param of params) request.input(param.name, sql.NVarChar, param.value);
  await request.execute(procedureName);
}

async function pollResponse(pool: sql.ConnectionPool) {
  for (let attempt = 1; attempt <= 24; attempt += 1) {
    const result = await pool.request()
      .input('factura', sql.VarChar(13), FACTURA)
      .query(`
        SELECT TOP (1) bl_estadoRegistro, bl_estadoProceso, process_state,
          bl_mensaje, bl_mensajeSunat, bl_url_pdf
        FROM dbo.SPE_EINVOICE_RESPONSE
        WHERE SERIENUMERO = @factura AND TIPODOCUMENTO = '01';
      `);
    if (result.recordset[0]) {
      console.log(JSON.stringify({ response: result.recordset[0] }, null, 2));
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 5000));
  }
  console.log('Sin respuesta Bizlinks despues de 120 segundos; el documento queda en seguimiento.');
}

async function rollbackQuietly(transaction: sql.Transaction) {
  try {
    await transaction.rollback();
  } catch {
    // The transaction may already be closed by SQL Server.
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
