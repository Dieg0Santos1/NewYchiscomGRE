import { loadEnv } from '../../src/config/env.js';
import { createBizlinksPool, sql } from '../../src/integrations/bizlinksSql.js';

async function main() {
  const pool = createBizlinksPool(loadEnv());
  await pool.connect();
  try {
    const result = await new sql.Request(pool).query(`
      SET TRANSACTION ISOLATION LEVEL READ UNCOMMITTED;
      SELECT TOP (200)
        o.name, o.type_desc,
        LEFT(REPLACE(REPLACE(m.definition, CHAR(13), ' '), CHAR(10), ' '), 1200) AS snippet
      FROM sys.objects o
      INNER JOIN sys.sql_modules m ON m.object_id = o.object_id
      WHERE m.definition LIKE '%formaPago%'
         OR m.definition LIKE '%CONDIC%'
         OR m.definition LIKE '%textoLeyenda_1%'
         OR m.definition LIKE '%VW_FACTURA_HEADER%'
      ORDER BY o.name;

      SELECT serieNumero, clave, valor
      FROM dbo.SPE_EINVOICEHEADER_ADD
      WHERE serieNumero IN ('FF01-00017179', 'FF01-00017187')
        AND tipoDocumento = '01'
      ORDER BY serieNumero, clave;
    `);
    console.log(JSON.stringify({ modules: result.recordsets[0], add: result.recordsets[1] }, null, 2));
  } finally {
    await pool.close();
  }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
