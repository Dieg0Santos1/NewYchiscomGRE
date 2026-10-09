import { loadEnv } from '../../src/config/env.js';
import { getGreDefaults } from '../../src/config/greDefaults.js';
import { createBizlinksPool, createGreFcPool, sql } from '../../src/integrations/bizlinksSql.js';
import { toFcFacturaProcedurePlan } from '../../src/mappers/fcFacturaProcedureMapper.js';
import { fcFacturaPreviewSchema } from '../../src/schemas/fcFacturaSchema.js';
import { assertGuidesNotAlreadyTraced } from '../../src/services/fcFacturaService.js';

// Uses only an ERROR attempt, inserts as N, never activates, always rolls back.
async function main() {
  const serie = process.argv[2];
  if (!/^FF01-\d{8}$/.test(serie ?? '')) throw new Error('Indique una factura FF01 fallida.');
  const config = loadEnv();
  const gre = createGreFcPool(config);
  const biz = createBizlinksPool(config);
  await gre.connect();
  await biz.connect();
  const gt = new sql.Transaction(gre);
  const bt = new sql.Transaction(biz);
  let greStarted = false;
  let bizStarted = false;
  try {
    const attempt = await gre.request().input('serie', sql.VarChar(13), serie).query(`
      SELECT TOP (1) datosJson, gravada, igv, total
      FROM dbo.FC_FACT_OPERACION
      WHERE serieNumeroFactura = @serie AND estado = 'ERROR'
      ORDER BY id DESC;
    `);
    const row = attempt.recordset[0];
    if (!row) throw new Error('No hay un intento ERROR para esta factura.');
    const input = fcFacturaPreviewSchema.parse(JSON.parse(row.datosJson));
    input.numero = serie!.split('-')[1]!;
    const plan = toFcFacturaProcedurePlan(input, getGreDefaults(config), {
      gravada: Number(row.gravada), igv: Number(row.igv), total: Number(row.total)
    });
    await gt.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);
    greStarted = true;
    await assertGuidesNotAlreadyTraced(gt, input, config.bizlinksDb.database);
    await bt.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);
    bizStarted = true;
    // Protect against the legacy SP's DELETE-before-INSERT behavior.
    const existing = await new sql.Request(bt).input('serie', sql.NVarChar(13), serie).query(`
      SET LOCK_TIMEOUT 5000;
      SELECT SERIENUMERO FROM dbo.SPE_EINVOICEHEADER WITH (UPDLOCK, HOLDLOCK)
      WHERE SERIENUMERO = @serie AND TIPODOCUMENTO = '01';
    `);
    if (existing.recordset.length) throw new Error('La factura ya existe: no se ejecutara ningun SP.');
    for (const [name, params] of [
      ['dbo.USP_CabeceraFE', plan.USP_CabeceraFE],
      ...plan.USP_DetalleFE.map(params => ['dbo.USP_DetalleFE', params] as const)
    ] as const) {
      const request = new sql.Request(bt);
      for (const param of params) request.input(param.name, sql.NVarChar, param.value);
      const start = Date.now();
      await request.execute(name);
      console.log(`${name}: OK (${Date.now() - start} ms)`);
    }
    const result = await new sql.Request(bt).input('serie', sql.NVarChar(13), serie).query(`
      SELECT SERIENUMERO, bl_estadoRegistro, tipoOperacion, totalVenta,
        codigoDetraccion, ubigeoEmisor, codigoAuxiliar40_1, textoAuxiliar40_1
      FROM dbo.SPE_EINVOICEHEADER
      WHERE SERIENUMERO = @serie AND TIPODOCUMENTO = '01';
      SELECT COUNT(*) AS items FROM dbo.SPE_EINVOICEDETAIL
      WHERE SERIENUMERO = @serie AND TIPODOCUMENTO = '01';
    `);
    console.log(JSON.stringify(result.recordsets, null, 2));
    if (result.recordsets[0]?.[0]?.bl_estadoRegistro !== 'N') throw new Error('Estado inesperado.');
    if (!result.recordsets[0]?.[0]?.textoAuxiliar40_1) throw new Error('Falta texto del vendedor (7122).');
    if (Number(result.recordsets[1]?.[0]?.items) !== input.items.length) throw new Error('Faltan detalles.');
  } finally {
    if (bizStarted) await bt.rollback();
    if (greStarted) await gt.rollback();
    await biz.close();
    await gre.close();
  }
  console.log('ROLLBACK completado. No se activo ni se envio la factura.');
}

main().catch(error => { console.error(error); process.exitCode = 1; });
