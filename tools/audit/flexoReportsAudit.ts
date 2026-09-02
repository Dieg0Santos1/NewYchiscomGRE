import { loadEnv } from '../../src/config/env.js';
import { createBizlinksPool, createGreFcPool, createYchiPool, sql } from '../../src/integrations/bizlinksSql.js';

const config = loadEnv();

async function query<T>(pool: sql.ConnectionPool, text: string): Promise<T[]> {
  const result = await new sql.Request(pool).query<T>(text);
  return result.recordset;
}

async function main() {
  const bizlinksPool = createBizlinksPool(config);
  const ychiPool = createYchiPool(config);
  const greFcPool = createGreFcPool(config);

  await bizlinksPool.connect();
  await ychiPool.connect();
  await greFcPool.connect();

  try {
    const [
      flexoGuideStatus,
      recentFlexoGuides,
      responseStateSamples,
      empaqueLinks,
      empaqueColumns,
      guideTraceTables,
      flexoInvoices,
      invoiceColumns,
      ychiReceptionColumns
    ] = await Promise.all([
      query(bizlinksPool, `
        SELECT
          LEFT(d.serieNumeroGuia, 4) AS serie,
          COUNT(DISTINCT d.serieNumeroGuia) AS guias,
          SUM(CASE WHEN r.bl_url_pdf IS NOT NULL AND LTRIM(RTRIM(r.bl_url_pdf)) <> '' THEN 1 ELSE 0 END) AS conPdf,
          SUM(CASE WHEN r.bl_estadoProceso LIKE '%AC_03%' OR r.bl_mensajeSunat LIKE '%aceptad%' OR r.bl_mensaje LIKE '%aceptad%' THEN 1 ELSE 0 END) AS aceptadas
        FROM dbo.SPE_DESPATCH d
        LEFT JOIN dbo.SPE_DESPATCH_RESPONSE r
          ON r.tipoDocumentoRemitente = d.tipoDocumentoRemitente
         AND r.numeroDocumentoRemitente = d.numeroDocumentoRemitente
         AND r.serieNumeroGuia = d.serieNumeroGuia
         AND r.tipoDocumentoGuia = d.tipoDocumentoGuia
        WHERE d.serieNumeroGuia LIKE 'T003-%'
           OR d.serieNumeroGuia LIKE 'T999-%'
        GROUP BY LEFT(d.serieNumeroGuia, 4)
        ORDER BY serie;
      `),
      query(bizlinksPool, `
        SELECT TOP (15)
          d.serieNumeroGuia,
          d.fechaEmisionGuia,
          d.numeroDocumentoDestinatario,
          d.razonSocialDestinatario,
          d.bl_estadoRegistro AS guiaEstadoRegistro,
          r.bl_estadoRegistro AS responseEstadoRegistro,
          r.bl_estadoProceso,
          r.process_state,
          CASE WHEN r.bl_url_pdf IS NULL OR LTRIM(RTRIM(r.bl_url_pdf)) = '' THEN 0 ELSE 1 END AS pdfDisponible,
          LEFT(COALESCE(r.bl_mensajeSunat, r.bl_mensaje, ''), 180) AS mensaje
        FROM dbo.SPE_DESPATCH d
        LEFT JOIN dbo.SPE_DESPATCH_RESPONSE r
          ON r.tipoDocumentoRemitente = d.tipoDocumentoRemitente
         AND r.numeroDocumentoRemitente = d.numeroDocumentoRemitente
         AND r.serieNumeroGuia = d.serieNumeroGuia
         AND r.tipoDocumentoGuia = d.tipoDocumentoGuia
        WHERE d.serieNumeroGuia LIKE 'T003-%'
           OR d.serieNumeroGuia LIKE 'T999-%'
        ORDER BY d.fechaEmisionGuia DESC, d.serieNumeroGuia DESC;
      `),
      query(bizlinksPool, `
        SELECT TOP (20)
          r.bl_estadoRegistro,
          r.bl_estadoProceso,
          r.process_state,
          COUNT(1) AS total,
          SUM(CASE WHEN r.bl_mensajeSunat IS NULL OR LTRIM(RTRIM(r.bl_mensajeSunat)) = '' THEN 0 ELSE 1 END) AS conMensajeSunat,
          SUM(CASE WHEN r.bl_url_pdf IS NULL OR LTRIM(RTRIM(r.bl_url_pdf)) = '' THEN 0 ELSE 1 END) AS conPdf
        FROM dbo.SPE_DESPATCH_RESPONSE r
        WHERE r.serieNumeroGuia LIKE 'T003-%'
           OR r.serieNumeroGuia LIKE 'T999-%'
        GROUP BY r.bl_estadoRegistro, r.bl_estadoProceso, r.process_state
        ORDER BY total DESC;
      `),
      query(bizlinksPool, `
        SELECT TOP (20)
          d.SERIENUMEROGUIAREMISION,
          COUNT(DISTINCT d.CODIGOEMPAQUE) AS empaques,
          COUNT(1) AS items,
          SUM(CASE WHEN d.SERIENUMEROGUIAFACTURA IS NULL THEN 0 ELSE 1 END) AS itemsConFactura,
          MIN(e.NUMERODOCUMENTOADQUIRIENTE) AS ruc,
          MIN(e.RAZONSOCIALADQUIRIENTE) AS cliente,
          MIN(e.ORDENCOMPRA) AS ordenCompra
        FROM dbo.EMPAQUE_DETALLE d
        INNER JOIN dbo.EMPAQUE e
          ON e.CODIGOEMPAQUE = d.CODIGOEMPAQUE
        WHERE d.SERIENUMEROGUIAREMISION LIKE 'T003-%'
           OR d.SERIENUMEROGUIAREMISION LIKE 'T999-%'
        GROUP BY d.SERIENUMEROGUIAREMISION
        ORDER BY MAX(e.FECHACREACION) DESC;
      `),
      query(bizlinksPool, `
        SELECT
          TABLE_NAME,
          COLUMN_NAME,
          DATA_TYPE,
          CHARACTER_MAXIMUM_LENGTH
        FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_SCHEMA = 'dbo'
          AND TABLE_NAME IN ('EMPAQUE', 'EMPAQUE_DETALLE', 'AAA_GUIAFACTURADA')
        ORDER BY TABLE_NAME, ORDINAL_POSITION;
      `),
      query(greFcPool, `
        SELECT
          TABLE_NAME,
          COLUMN_NAME,
          DATA_TYPE,
          CHARACTER_MAXIMUM_LENGTH
        FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_SCHEMA = 'dbo'
          AND TABLE_NAME LIKE 'GRE_FC_%'
        ORDER BY TABLE_NAME, ORDINAL_POSITION;
      `),
      query(bizlinksPool, `
        SELECT TOP (20)
          h.serieNumero,
          h.fechaEmision,
          h.numeroDocumentoAdquiriente,
          h.razonSocialAdquiriente,
          h.bl_estadoRegistro,
          r.bl_estadoProceso,
          r.process_state,
          CASE WHEN r.bl_url_pdf IS NULL OR LTRIM(RTRIM(r.bl_url_pdf)) = '' THEN 0 ELSE 1 END AS pdfDisponible,
          LEFT(COALESCE(r.bl_mensajeSunat, r.bl_mensaje, ''), 180) AS mensaje
        FROM dbo.SPE_EINVOICEHEADER h
        LEFT JOIN dbo.SPE_EINVOICE_RESPONSE r
          ON r.tipoDocumentoEmisor = h.tipoDocumentoEmisor
         AND r.numeroDocumentoEmisor = h.numeroDocumentoEmisor
         AND r.serieNumero = h.serieNumero
         AND r.tipoDocumento = h.tipoDocumento
        WHERE h.serieNumero LIKE 'FF03-%'
          AND h.tipoDocumento = '01'
        ORDER BY h.fechaEmision DESC, h.serieNumero DESC;
      `).catch((error) => [{ error: error instanceof Error ? error.message : String(error) }]),
      query(bizlinksPool, `
        SELECT
          TABLE_NAME,
          COLUMN_NAME,
          DATA_TYPE,
          CHARACTER_MAXIMUM_LENGTH
        FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_SCHEMA = 'dbo'
          AND TABLE_NAME LIKE 'SPE_EINVOICE%'
        ORDER BY TABLE_NAME, ORDINAL_POSITION;
      `),
      query(ychiPool, `
        SELECT
          TABLE_NAME,
          COLUMN_NAME,
          DATA_TYPE,
          CHARACTER_MAXIMUM_LENGTH
        FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_SCHEMA = 'dbo'
          AND TABLE_NAME IN ('tbRecepcionOT', 'VW_BUSCAS_DOCUMENTOS', 'VW_DETGUIA_REMISION', 'tbDocumentos')
        ORDER BY TABLE_NAME, ORDINAL_POSITION;
      `)
    ]);

    console.log(JSON.stringify({
      flexoGuideStatus,
      recentFlexoGuides,
      responseStateSamples,
      empaqueLinks,
      empaqueColumnsCount: empaqueColumns.length,
      empaqueKeyColumns: empaqueColumns.filter((row: any) => /SERIENUMEROGUIA|CODIGOEMPAQUE|TICKET|ORDEN|ESTADO|UNIDAD|CANTIDAD/i.test(row.COLUMN_NAME)),
      guideTraceTablesCount: guideTraceTables.length,
      flexoOwnTraceTables: guideTraceTables.filter((row: any) => /^FLEXO_|^GRE_FLEXO_/i.test(row.TABLE_NAME)),
      flexoInvoices,
      invoiceColumnsCount: invoiceColumns.length,
      invoiceResponseTables: [...new Set(invoiceColumns.map((row: any) => row.TABLE_NAME).filter((name: string) => /RESPONSE/i.test(name)))],
      ychiReceptionKeyColumns: ychiReceptionColumns.filter((row: any) => /IDOT|EstadoGuia|idOrdenVenta|idDetGuia|idDocumentos|nguia|serie/i.test(row.COLUMN_NAME))
    }, null, 2));
  } finally {
    await greFcPool.close();
    await ychiPool.close();
    await bizlinksPool.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
