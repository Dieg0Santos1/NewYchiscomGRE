import { loadEnv } from '../../src/config/env.js';
import { createBizlinksPool, createGreFcPool, sql } from '../../src/integrations/bizlinksSql.js';

const serieNumeroGuia = process.argv[2]?.trim().toUpperCase() ?? 'T003-00005566';

async function main() {
  const config = loadEnv();
  const bizlinksPool = createBizlinksPool(config);
  const greFcPool = createGreFcPool(config);

  await bizlinksPool.connect();
  await greFcPool.connect();

  try {
    const errorLogColumns = await new sql.Request(bizlinksPool).query(`
      SELECT COLUMN_NAME, DATA_TYPE
      FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = 'dbo'
        AND TABLE_NAME = 'SPE_ERROR_LOG'
      ORDER BY ORDINAL_POSITION
    `);

    console.log('\nSPE_ERROR_LOG columns');
    console.table(errorLogColumns.recordset);

    const headerRequest = new sql.Request(bizlinksPool);
    headerRequest.input('serieNumeroGuia', sql.VarChar(20), serieNumeroGuia);
    const header = await headerRequest.query(`
      SELECT TOP (5)
        d.serieNumeroGuia,
        d.tipoDocumentoGuia,
        d.fechaEmisionGuia,
        d.horaEmisionGuia,
        d.fechaInicioTraslado,
        d.fechaEntregaBienes,
        d.bl_estadoRegistro,
        d.numeroDocumentoDestinatario,
        d.razonSocialDestinatario,
        d.ubigeoPtoLlegada,
        d.direccionPtoLlegada
      FROM dbo.SPE_DESPATCH d
      WHERE d.serieNumeroGuia = @serieNumeroGuia
      ORDER BY d.fechaEmisionGuia DESC
    `);

    console.log('\nSPE_DESPATCH');
    console.table(header.recordset);

    const responseRequest = new sql.Request(bizlinksPool);
    responseRequest.input('serieNumeroGuia', sql.VarChar(20), serieNumeroGuia);
    const response = await responseRequest.query(`
      SELECT TOP (10)
        r.serieNumeroGuia,
        r.tipoDocumentoGuia,
        r.bl_estadoRegistro,
        r.bl_estadoProceso,
        r.process_state,
        r.bl_mensaje,
        r.bl_mensajeSunat,
        r.bl_url_pdf
      FROM dbo.SPE_DESPATCH_RESPONSE r
      WHERE r.serieNumeroGuia = @serieNumeroGuia
      ORDER BY r.serieNumeroGuia DESC
    `);

    console.log('\nSPE_DESPATCH_RESPONSE');
    console.table(response.recordset);

    const itemColumns = await new sql.Request(bizlinksPool).query(`
      SELECT COLUMN_NAME, DATA_TYPE
      FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = 'dbo'
        AND TABLE_NAME = 'SPE_DESPATCH_ITEM'
      ORDER BY ORDINAL_POSITION
    `);

    console.log('\nSPE_DESPATCH_ITEM columns');
    console.table(itemColumns.recordset);

    const itemRequest = new sql.Request(bizlinksPool);
    itemRequest.input('serieNumeroGuia', sql.VarChar(20), serieNumeroGuia);
    const items = await itemRequest.query(`
      SELECT
        *
      FROM dbo.SPE_DESPATCH_ITEM
      WHERE serieNumeroGuia = @serieNumeroGuia
      ORDER BY numeroOrdenItem
    `);

    console.log('\nSPE_DESPATCH_ITEM');
    console.table(items.recordset.map((row: Record<string, unknown>) => ({
      numeroOrdenItem: row.numeroOrdenItem,
      codigoProductoItem: row.codigoProductoItem,
      descripcionItem: row.descripcionItem,
      descripcionProductoItem: row.descripcionProductoItem,
      codigoUnidadMedida: row.codigoUnidadMedida,
      unidadMedida: row.unidadMedida,
      cantidad: row.cantidad,
      cantidadItem: row.cantidadItem,
      codigoProductoSunat: row.codigoProductoSunat
    })));

    const empaqueRequest = new sql.Request(bizlinksPool);
    empaqueRequest.input('serieNumeroGuia', sql.VarChar(20), serieNumeroGuia);
    const empaques = await empaqueRequest.query(`
      SELECT
        CODIGOEMPAQUE,
        CODIGOPRODUCTO,
        DESCRIPCION,
        cantidad,
        UNIDADMEDIDA,
        SERIENUMEROGUIAREMISION,
        ORDENGUIA,
        SERIENUMEROGUIAFACTURA,
        ORDENFACTURA
      FROM dbo.EMPAQUE_DETALLE
      WHERE SERIENUMEROGUIAREMISION = @serieNumeroGuia
      ORDER BY CODIGOEMPAQUE, CODIGOPRODUCTO
    `);

    console.log('\nEMPAQUE_DETALLE link');
    console.table(empaques.recordset);

    const errorLogRequest = new sql.Request(bizlinksPool);
    errorLogRequest.input('serieNumeroGuia', sql.VarChar(20), serieNumeroGuia);
    const errorLog = await errorLogRequest.query(`
      SELECT TOP (20)
        *
      FROM dbo.SPE_ERROR_LOG
      WHERE SERIENUMERO = @serieNumeroGuia
         OR DESCRIPCIONERROR LIKE '%' + @serieNumeroGuia + '%'
      ORDER BY FECHAREGISTRO DESC
    `);

    console.log('\nSPE_ERROR_LOG');
    console.table(errorLog.recordset);

    const traceColumns = await new sql.Request(greFcPool).query(`
      SELECT COLUMN_NAME, DATA_TYPE
      FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = 'dbo'
        AND TABLE_NAME = 'FLEXO_GRE_OPERACION'
      ORDER BY ORDINAL_POSITION
    `);

    console.log('\nFLEXO_GRE_OPERACION columns');
    console.table(traceColumns.recordset);

    const traceRequest = new sql.Request(greFcPool);
    traceRequest.input('serieNumeroGuia', sql.VarChar(20), serieNumeroGuia);
    const trace = await traceRequest.query(`
      SELECT TOP (5)
        *
      FROM dbo.FLEXO_GRE_OPERACION
      WHERE serieNumeroGuia = @serieNumeroGuia
      ORDER BY creadoEn DESC
    `);

    console.log('\nFLEXO_GRE_OPERACION');
    console.table(trace.recordset.map((row: Record<string, unknown>) => ({
      id: row.id,
      idOperacion: row.idOperacion,
      serieNumeroGuia: row.serieNumeroGuia,
      estado: row.estado,
      fechaEmision: row.fechaEmision,
      fechaInicioTraslado: row.fechaInicioTraslado,
      creadoEn: row.creadoEn,
      actualizadoEn: row.actualizadoEn
    })));

    const eventColumns = await new sql.Request(greFcPool).query(`
      SELECT COLUMN_NAME, DATA_TYPE
      FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = 'dbo'
        AND TABLE_NAME = 'FLEXO_GRE_EVENTO'
      ORDER BY ORDINAL_POSITION
    `);

    console.log('\nFLEXO_GRE_EVENTO columns');
    console.table(eventColumns.recordset);

    const eventRequest = new sql.Request(greFcPool);
    eventRequest.input('serieNumeroGuia', sql.VarChar(20), serieNumeroGuia);
    const events = await eventRequest.query(`
      SELECT TOP (20)
        e.*
      FROM dbo.FLEXO_GRE_EVENTO e
      INNER JOIN dbo.FLEXO_GRE_OPERACION o
        ON o.id = e.operacionId
      WHERE o.serieNumeroGuia = @serieNumeroGuia
      ORDER BY e.creadoEn DESC
    `);

    console.log('\nFLEXO_GRE_EVENTO');
    console.table(events.recordset);
  } finally {
    await greFcPool.close();
    await bizlinksPool.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
