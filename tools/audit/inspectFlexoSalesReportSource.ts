import { loadEnv } from '../../src/config/env.js';
import { createBizlinksPool, createYchiPool, sql } from '../../src/integrations/bizlinksSql.js';

const factura = process.argv[2]?.trim() || 'FF03-00010950';

async function query<T>(pool: sql.ConnectionPool, text: string, inputs: Record<string, string> = {}) {
  const request = new sql.Request(pool);
  for (const [name, value] of Object.entries(inputs)) {
    request.input(name, sql.VarChar(50), value);
  }
  return (await request.query<T>(text)).recordset;
}

async function main() {
  const config = loadEnv();
  const bizlinksPool = createBizlinksPool(config);
  const ychiPool = createYchiPool(config);

  await bizlinksPool.connect();
  await ychiPool.connect();

  try {
    const currentBizlinks = await query(bizlinksPool, `
      SELECT 'SPE_EINVOICEHEADER' AS tabla,
        SERIENUMERO,
        TIPODOCUMENTO,
        FECHAEMISION,
        NUMERODOCUMENTOADQUIRIENTE,
        RAZONSOCIALADQUIRIENTE,
        BL_ESTADOREGISTRO
      FROM dbo.SPE_EINVOICEHEADER
      WHERE SERIENUMERO = @factura

      UNION ALL

      SELECT 'SPE_EINVOICE_RESPONSE' AS tabla,
        SERIENUMERO,
        TIPODOCUMENTO,
        CAST(NULL AS date) AS FECHAEMISION,
        NUMERODOCUMENTOEMISOR AS NUMERODOCUMENTOADQUIRIENTE,
        CAST(NULL AS varchar(250)) AS RAZONSOCIALADQUIRIENTE,
        bl_estadoRegistro AS BL_ESTADOREGISTRO
      FROM dbo.SPE_EINVOICE_RESPONSE
      WHERE SERIENUMERO = @factura;
    `, { factura });

    const currentAdd = await query(bizlinksPool, `
      SELECT TOP (50)
        SERIENUMERO,
        TIPODOCUMENTO,
        CLAVE,
        VALOR
      FROM dbo.SPE_EINVOICEHEADER_ADD
      WHERE SERIENUMERO = @factura
      ORDER BY CLAVE;
    `, { factura }).catch((error: unknown) => [{ error: error instanceof Error ? error.message : String(error) }]);

    const currentDetails = await query(bizlinksPool, `
      SELECT
        COUNT(1) AS detalleRows,
        SUM(CASE WHEN SERIENUMERO = @factura THEN 1 ELSE 0 END) AS rowsFactura
      FROM dbo.SPE_EINVOICEDETAIL
      WHERE SERIENUMERO = @factura;
    `, { factura }).catch((error: unknown) => [{ error: error instanceof Error ? error.message : String(error) }]);

    const currentEmpaqueDetalle = await query(bizlinksPool, `
      SELECT
        SERIENUMEROGUIAREMISION,
        SERIENUMEROGUIAFACTURA,
        COUNT(1) AS filas
      FROM dbo.EMPAQUE_DETALLE
      WHERE SERIENUMEROGUIAFACTURA = @factura
         OR SERIENUMEROGUIAREMISION IN (
           SELECT NRO_GUIA
           FROM dbo.AAA_GUIAFACTURADA
           WHERE NRO_FACTURA = @factura
         )
      GROUP BY SERIENUMEROGUIAREMISION, SERIENUMEROGUIAFACTURA;
    `, { factura });

    const currentAaa = await query(bizlinksPool, `
      SELECT ID, RUC_EMISOR, NRO_GUIA, NRO_FACTURA, FECHA_EMISION, USUARIO, ESTADO, NOTACRE
      FROM dbo.AAA_GUIAFACTURADA
      WHERE NRO_FACTURA = @factura;
    `, { factura });

    const ychiDocs = await query(ychiPool, `
      SELECT TOP (50)
        idDocumento,
        idTipoDocu,
        SeriDocu,
        NumeDocu,
        FechaEmision,
        FechaCreacion,
        Estado,
        DescClieProv,
        Total,
        nguia
      FROM dbo.tbDocumentos
      WHERE CONCAT(SeriDocu, '-', NumeDocu) = @factura
         OR (SeriDocu = LEFT(@factura, CHARINDEX('-', @factura + '-') - 1)
             AND NumeDocu = RIGHT(@factura, 8))
         OR nguia LIKE '%' + @factura + '%'
      ORDER BY FechaCreacion DESC;
    `, { factura }).catch((error: unknown) => [{ error: error instanceof Error ? error.message : String(error) }]);

    const ychiModules = await query(ychiPool, `
      SELECT TOP (80)
        SCHEMA_NAME(o.schema_id) AS schemaName,
        o.name AS objectName,
        o.type_desc AS objectType
      FROM sys.objects o
      INNER JOIN sys.sql_modules m
        ON m.object_id = o.object_id
      WHERE m.definition LIKE '%SPE_EINVOICEHEADER%'
         OR m.definition LIKE '%AAA_GUIAFACTURADA%'
         OR m.definition LIKE '%SPE_EINVOICE%'
         OR m.definition LIKE '%Registro%Venta%'
         OR m.definition LIKE '%FF03%'
         OR o.name LIKE '%FactElectronica%'
         OR o.name LIKE '%Venta%'
      ORDER BY o.type_desc, o.name;
    `).catch((error: unknown) => [{ error: error instanceof Error ? error.message : String(error) }]);

    const bizlinksModules = await query(bizlinksPool, `
      SELECT TOP (80)
        SCHEMA_NAME(o.schema_id) AS schemaName,
        o.name AS objectName,
        o.type_desc AS objectType
      FROM sys.objects o
      INNER JOIN sys.sql_modules m
        ON m.object_id = o.object_id
      WHERE m.definition LIKE '%SPE_EINVOICEHEADER%'
         OR m.definition LIKE '%AAA_GUIAFACTURADA%'
         OR m.definition LIKE '%SPE_EINVOICE%'
         OR m.definition LIKE '%Registro%Venta%'
         OR m.definition LIKE '%FF03%'
         OR o.name LIKE '%FactElectronica%'
         OR o.name LIKE '%Venta%'
      ORDER BY o.type_desc, o.name;
    `).catch((error: unknown) => [{ error: error instanceof Error ? error.message : String(error) }]);

    console.log(JSON.stringify({
      factura,
      currentBizlinks,
      currentAdd,
      currentDetails,
      currentEmpaqueDetalle,
      currentAaa,
      ychiDocs,
      ychiModules,
      bizlinksModules
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
