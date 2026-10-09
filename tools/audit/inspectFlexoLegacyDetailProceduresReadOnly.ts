import { loadEnv } from '../../src/config/env.js';
import { createYchiPool, sql } from '../../src/integrations/bizlinksSql.js';

async function main() {
  const config = loadEnv();
  const pool = createYchiPool(config);
  await pool.connect();

  try {
    const result = await new sql.Request(pool).query(`
      SET TRANSACTION ISOLATION LEVEL READ UNCOMMITTED;

      SELECT TOP (120)
        SCHEMA_NAME(o.schema_id) AS schemaName,
        o.name AS objectName,
        o.type_desc AS objectType,
        CASE
          WHEN m.definition LIKE '%INSERT%tbDetFact%' THEN 'INSERT tbDetFact'
          WHEN m.definition LIKE '%INSERT%TBDETFACT%' THEN 'INSERT TBDETFACT'
          WHEN m.definition LIKE '%idDetFact%' THEN 'idDetFact'
          WHEN m.definition LIKE '%idDocumento%' AND m.definition LIKE '%idProducto%' AND m.definition LIKE '%Precio%' THEN 'detail-shape'
          ELSE 'match'
        END AS matchedBy,
        LEFT(m.definition, 2500) AS definitionStart
      FROM sys.objects o
      INNER JOIN sys.sql_modules m ON m.object_id = o.object_id
      WHERE (
          m.definition LIKE '%tbDetFact%'
          OR m.definition LIKE '%TBDETFACT%'
          OR m.definition LIKE '%idDetFact%'
        )
        AND (
          o.name LIKE '%FACT%'
          OR o.name LIKE '%DET%'
          OR o.name LIKE '%VENTA%'
          OR m.definition LIKE '%idTipoDocu = 38%'
          OR m.definition LIKE '%idTipoDocu=38%'
          OR m.definition LIKE '%F03%'
        )
        AND o.name NOT LIKE 'dt_%'
      ORDER BY
        CASE
          WHEN m.definition LIKE '%INSERT%tbDetFact%' OR m.definition LIKE '%INSERT%TBDETFACT%' THEN 0
          ELSE 1
        END,
        o.type_desc,
        o.name;

      SELECT
        HAS_PERMS_BY_NAME(N'dbo.SPI_FACTURA_ELECTRONICA_FF03', N'OBJECT', N'EXECUTE') AS puedeEjecutarSpiFacturaElectronicaFf03,
        HAS_PERMS_BY_NAME(N'dbo.tbDocumentos', N'OBJECT', N'SELECT') AS puedeLeerTbDocumentos,
        HAS_PERMS_BY_NAME(N'dbo.tbDetFact', N'OBJECT', N'SELECT') AS puedeLeerTbDetFact,
        HAS_PERMS_BY_NAME(N'dbo.tbTipoDocu', N'OBJECT', N'SELECT') AS puedeLeerTbTipoDocu;
    `);

    console.log(JSON.stringify({
      safety: 'READ_ONLY',
      detailProcedureCandidates: result.recordsets[0],
      permissions: result.recordsets[1]
    }, null, 2));
  } finally {
    await pool.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
