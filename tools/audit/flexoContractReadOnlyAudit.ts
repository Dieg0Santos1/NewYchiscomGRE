import { loadEnv } from '../../src/config/env.js';
import { createBizlinksPool, createYchiPool, sql } from '../../src/integrations/bizlinksSql.js';

const config = loadEnv();

async function query<T>(
  pool: sql.ConnectionPool,
  text: string,
  inputs: Record<string, string> = {}
): Promise<T[]> {
  const request = new sql.Request(pool);
  for (const [name, value] of Object.entries(inputs)) {
    request.input(name, sql.VarChar(50), value);
  }
  const result = await request.query<T>(text);
  return result.recordset;
}

async function safe<T>(fn: () => Promise<T[]>): Promise<T[] | Array<{ error: string }>> {
  try {
    return await fn();
  } catch (error) {
    return [{ error: error instanceof Error ? error.message : String(error) }];
  }
}

async function main() {
  const bizlinksPool = createBizlinksPool(config);
  const ychiPool = createYchiPool(config);

  await bizlinksPool.connect();
  await ychiPool.connect();

  try {
    const tables = [
      'AAA_ADQUIRIENTE',
      'AAA_CHOFER',
      'AAA_CONTABLE',
      'AAA_DESTINO',
      'AAA_DETRACCION',
      'AAA_EMPRESA',
      'AAA_GUIAFACTURADA',
      'AAA_ORIGEN',
      'AAA_REGISTRO_CONTABLE',
      'AAA_TIPODOCUMENTO',
      'AAA_TRANSPORTISTA',
      'MOTIVOS',
      'EMPAQUE',
      'EMPAQUE_DETALLE',
      'SPE_DESPATCH',
      'SPE_DESPATCH_ITEM',
      'SPE_DESPATCH_RESPONSE',
      'SPE_EINVOICEHEADER',
      'SPE_EINVOICEDETAIL',
      'SPE_EINVOICE_RESPONSE',
      'SPE_EINVOICEHEADER_ADD'
    ];

    const tableList = tables.map((tableName) => `SELECT '${tableName}' AS tableName`).join(' UNION ALL ');
    const quotedTables = tables.map((tableName) => `'${tableName}'`).join(',');

    const objectAudit = await query(bizlinksPool, `
      WITH wanted AS (${tableList})
      SELECT
        w.tableName,
        o.object_id,
        o.type_desc,
        HAS_PERMS_BY_NAME('dbo.' + w.tableName, 'OBJECT', 'SELECT') AS canSelect,
        HAS_PERMS_BY_NAME('dbo.' + w.tableName, 'OBJECT', 'INSERT') AS canInsert,
        HAS_PERMS_BY_NAME('dbo.' + w.tableName, 'OBJECT', 'UPDATE') AS canUpdate
      FROM wanted w
      LEFT JOIN sys.objects o
        ON o.schema_id = SCHEMA_ID('dbo')
       AND o.name = w.tableName
      ORDER BY w.tableName;
    `);

    const columnsSample = await query(bizlinksPool, `
      SELECT
        TABLE_NAME,
        COLUMN_NAME,
        DATA_TYPE,
        CHARACTER_MAXIMUM_LENGTH,
        NUMERIC_PRECISION,
        NUMERIC_SCALE
      FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = 'dbo'
        AND TABLE_NAME IN (${quotedTables})
        AND (
          TABLE_NAME LIKE 'AAA_%'
          OR TABLE_NAME = 'MOTIVOS'
          OR COLUMN_NAME LIKE '%SERIE%'
          OR COLUMN_NAME LIKE '%NUMERO%'
          OR COLUMN_NAME LIKE '%GUIA%'
          OR COLUMN_NAME LIKE '%FACT%'
          OR COLUMN_NAME LIKE '%ORDEN%'
          OR COLUMN_NAME LIKE '%CODIGO%'
          OR COLUMN_NAME LIKE '%CANTIDAD%'
          OR COLUMN_NAME LIKE '%UNIDAD%'
          OR COLUMN_NAME LIKE '%MOTIVO%'
          OR COLUMN_NAME LIKE '%DIRECCION%'
          OR COLUMN_NAME LIKE '%UBIGEO%'
          OR COLUMN_NAME LIKE '%DOCUMENTO%'
          OR COLUMN_NAME LIKE '%RAZON%'
          OR COLUMN_NAME LIKE '%ESTADO%'
          OR COLUMN_NAME LIKE '%BL_%'
        )
      ORDER BY TABLE_NAME, ORDINAL_POSITION;
    `);

    const counts = await safe(() => query(bizlinksPool, `
      SELECT 'AAA_ADQUIRIENTE' tabla, COUNT_BIG(1) total FROM dbo.AAA_ADQUIRIENTE
      UNION ALL SELECT 'AAA_CHOFER', COUNT_BIG(1) FROM dbo.AAA_CHOFER
      UNION ALL SELECT 'AAA_CONTABLE', COUNT_BIG(1) FROM dbo.AAA_CONTABLE
      UNION ALL SELECT 'AAA_DESTINO', COUNT_BIG(1) FROM dbo.AAA_DESTINO
      UNION ALL SELECT 'AAA_DETRACCION', COUNT_BIG(1) FROM dbo.AAA_DETRACCION
      UNION ALL SELECT 'AAA_EMPRESA', COUNT_BIG(1) FROM dbo.AAA_EMPRESA
      UNION ALL SELECT 'AAA_GUIAFACTURADA', COUNT_BIG(1) FROM dbo.AAA_GUIAFACTURADA
      UNION ALL SELECT 'AAA_ORIGEN', COUNT_BIG(1) FROM dbo.AAA_ORIGEN
      UNION ALL SELECT 'AAA_REGISTRO_CONTABLE', COUNT_BIG(1) FROM dbo.AAA_REGISTRO_CONTABLE
      UNION ALL SELECT 'AAA_TIPODOCUMENTO', COUNT_BIG(1) FROM dbo.AAA_TIPODOCUMENTO
      UNION ALL SELECT 'AAA_TRANSPORTISTA', COUNT_BIG(1) FROM dbo.AAA_TRANSPORTISTA
      UNION ALL SELECT 'MOTIVOS', COUNT_BIG(1) FROM dbo.MOTIVOS;
    `));

    const refByLinks = await query<{
      factura: string;
      guia: string;
      items: number;
      empaques: number;
      ruc: string;
      cliente: string;
    }>(bizlinksPool, `
      SELECT TOP (20)
        d.SERIENUMEROGUIAFACTURA factura,
        d.SERIENUMEROGUIAREMISION guia,
        COUNT(*) items,
        COUNT(DISTINCT d.CODIGOEMPAQUE) empaques,
        MIN(e.NUMERODOCUMENTOADQUIRIENTE) ruc,
        MIN(e.RAZONSOCIALADQUIRIENTE) cliente
      FROM dbo.EMPAQUE_DETALLE d
      JOIN dbo.EMPAQUE e
        ON e.CODIGOEMPAQUE = d.CODIGOEMPAQUE
      JOIN dbo.SPE_EINVOICE_RESPONSE r
        ON r.SERIENUMERO = d.SERIENUMEROGUIAFACTURA
       AND r.TIPODOCUMENTO = '01'
      WHERE d.SERIENUMEROGUIAFACTURA LIKE 'FF03-%'
        AND d.SERIENUMEROGUIAREMISION LIKE 'T003-%'
        AND (
          r.bl_estadoProceso LIKE '%AC_03%'
          OR r.bl_mensajeSunat LIKE '%aceptad%'
          OR r.bl_mensaje LIKE '%aceptad%'
        )
      GROUP BY d.SERIENUMEROGUIAFACTURA, d.SERIENUMEROGUIAREMISION
      ORDER BY MAX(d.SERIENUMEROGUIAFACTURA) DESC;
    `);

    const refGuia = refByLinks[0]?.guia ?? 'T003-00005442';
    const refFactura = refByLinks[0]?.factura ?? 'FF03-00011117';

    const [
      guideHeader,
      guideItems,
      guideResponse,
      empaqueLink,
      invoiceHeader,
      invoiceDetails,
      invoiceAdd,
      invoiceResponse,
      aaaGuiaFacturada,
      registroContable,
      ychiscomDocs,
      procedureCandidates
    ] = await Promise.all([
      query(bizlinksPool, `
        SELECT TOP 1 *
        FROM dbo.SPE_DESPATCH
        WHERE serieNumeroGuia = @guia
          AND tipoDocumentoGuia = '09';
      `, { guia: refGuia }),
      query(bizlinksPool, `
        SELECT *
        FROM dbo.SPE_DESPATCH_ITEM
        WHERE serieNumeroGuia = @guia
          AND tipoDocumentoGuia = '09'
        ORDER BY CASE WHEN ISNUMERIC(numeroOrdenItem) = 1 THEN CONVERT(int, numeroOrdenItem) ELSE 9999 END, numeroOrdenItem;
      `, { guia: refGuia }),
      query(bizlinksPool, `
        SELECT TOP 5
          serieNumeroGuia,
          tipoDocumentoGuia,
          bl_estadoRegistro,
          bl_estadoProceso,
          process_state,
          LEFT(COALESCE(bl_mensajeSunat, bl_mensaje, ''), 300) mensaje,
          bl_url_pdf
        FROM dbo.SPE_DESPATCH_RESPONSE
        WHERE serieNumeroGuia = @guia
          AND tipoDocumentoGuia = '09'
        ORDER BY serieNumeroGuia DESC;
      `, { guia: refGuia }),
      query(bizlinksPool, `
        SELECT
          e.CODIGOEMPAQUE,
          e.TICKETNUM,
          e.ORDENCOMPRA,
          e.FECHACREACION,
          e.NUMERODOCUMENTOADQUIRIENTE,
          e.RAZONSOCIALADQUIRIENTE,
          e.UBIGEOPTOLLEGADA,
          e.DIRECCIONPTOLLEGADA,
          d.CODIGOPRODUCTO,
          d.DESCRIPCION,
          d.CANTIDAD,
          d.UNIDADMEDIDA,
          d.MONEDA,
          d.SERIENUMEROGUIAREMISION,
          d.ORDENGUIA,
          d.SERIENUMEROGUIAFACTURA,
          d.ORDENFACTURA
        FROM dbo.EMPAQUE_DETALLE d
        JOIN dbo.EMPAQUE e
          ON e.CODIGOEMPAQUE = d.CODIGOEMPAQUE
        WHERE d.SERIENUMEROGUIAREMISION = @guia
           OR d.SERIENUMEROGUIAFACTURA = @factura
        ORDER BY d.SERIENUMEROGUIAREMISION, e.CODIGOEMPAQUE, CASE WHEN ISNUMERIC(d.ORDENGUIA) = 1 THEN CONVERT(int, d.ORDENGUIA) ELSE 9999 END, d.CODIGOPRODUCTO;
      `, { guia: refGuia, factura: refFactura }),
      query(bizlinksPool, `
        SELECT TOP 1 *
        FROM dbo.SPE_EINVOICEHEADER
        WHERE SERIENUMERO = @factura
          AND TIPODOCUMENTO = '01';
      `, { factura: refFactura }),
      query(bizlinksPool, `
        SELECT *
        FROM dbo.SPE_EINVOICEDETAIL
        WHERE SERIENUMERO = @factura
          AND TIPODOCUMENTO = '01'
        ORDER BY CASE WHEN ISNUMERIC(NUMEROORDENITEM) = 1 THEN CONVERT(int, NUMEROORDENITEM) ELSE 9999 END, NUMEROORDENITEM;
      `, { factura: refFactura }),
      safe(() => query(bizlinksPool, `
        SELECT *
        FROM dbo.SPE_EINVOICEHEADER_ADD
        WHERE SERIENUMERO = @factura
          AND TIPODOCUMENTO = '01';
      `, { factura: refFactura })),
      query(bizlinksPool, `
        SELECT TOP 5
          SERIENUMERO,
          TIPODOCUMENTO,
          bl_estadoRegistro,
          bl_estadoProceso,
          process_state,
          LEFT(COALESCE(bl_mensajeSunat, bl_mensaje, ''), 300) mensaje,
          bl_url_pdf
        FROM dbo.SPE_EINVOICE_RESPONSE
        WHERE SERIENUMERO = @factura
          AND TIPODOCUMENTO = '01'
        ORDER BY SERIENUMERO DESC;
      `, { factura: refFactura }),
      safe(() => query(bizlinksPool, `
        SELECT *
        FROM dbo.AAA_GUIAFACTURADA
        WHERE NRO_FACTURA = @factura
           OR NRO_GUIA = @guia
        ORDER BY NRO_FACTURA, NRO_GUIA;
      `, { factura: refFactura, guia: refGuia })),
      safe(() => query(bizlinksPool, `
        SELECT TOP 20 *
        FROM dbo.AAA_REGISTRO_CONTABLE;
      `)),
      safe(() => query(ychiPool, `
        SELECT TOP 20
          idDocumento,
          idTipoDocu,
          SeriDocu,
          NumeDocu,
          DescClieProv,
          Neto,
          Igv,
          Total,
          FechaEmision,
          FechaCreacion,
          Estado,
          cuenta,
          nguia
        FROM dbo.tbDocumentos
        WHERE nguia LIKE '%' + @guia + '%'
           OR nguia LIKE '%' + @factura + '%'
           OR (SeriDocu = 'FF03' AND NumeDocu LIKE '%' + RIGHT(@factura, 6))
        ORDER BY FechaCreacion DESC;
      `, { guia: refGuia, factura: refFactura })),
      query(bizlinksPool, `
        SELECT TOP (80)
          o.name,
          o.type_desc,
          CASE WHEN m.definition LIKE '%EMPAQUE_DETALLE%' THEN 1 ELSE 0 END usesEmpaqueDetalle,
          CASE WHEN m.definition LIKE '%SPE_DESPATCH%' THEN 1 ELSE 0 END usesDespatch,
          CASE WHEN m.definition LIKE '%SPE_EINVOICE%' THEN 1 ELSE 0 END usesEinvoice,
          CASE WHEN m.definition LIKE '%AAA_GUIAFACTURADA%' THEN 1 ELSE 0 END usesGuiaFacturada,
          LEFT(REPLACE(REPLACE(m.definition, CHAR(13), ' '), CHAR(10), ' '), 500) snippet
        FROM sys.objects o
        JOIN sys.sql_modules m
          ON m.object_id = o.object_id
        WHERE o.type IN ('P', 'FN', 'IF', 'TF', 'V')
          AND (
            m.definition LIKE '%T003%'
            OR m.definition LIKE '%FF03%'
            OR m.definition LIKE '%EMPAQUE%'
            OR m.definition LIKE '%SPE_DESPATCH%'
            OR m.definition LIKE '%SPE_EINVOICE%'
            OR m.definition LIKE '%AAA_GUIAFACTURADA%'
          )
        ORDER BY usesEmpaqueDetalle DESC, usesDespatch DESC, usesEinvoice DESC, o.name;
      `)
    ]);

    console.log(JSON.stringify({
      objectAudit,
      counts,
      columnsSample,
      refByLinks,
      selectedReference: { refGuia, refFactura },
      guideHeader,
      guideItems,
      guideResponse,
      empaqueLink,
      invoiceHeader,
      invoiceDetails,
      invoiceAdd,
      invoiceResponse,
      aaaGuiaFacturada,
      registroContable,
      ychiscomDocs,
      procedureCandidates
    }, null, 2));
  } finally {
    await ychiPool.close();
    await bizlinksPool.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
