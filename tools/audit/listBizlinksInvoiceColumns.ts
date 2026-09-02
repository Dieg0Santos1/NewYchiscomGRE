import { loadEnv } from '../../src/config/env.js';
import { createBizlinksPool, sql } from '../../src/integrations/bizlinksSql.js';

const interesting = /guia|detrac|operacion|adquir|correo|orden|pago|venta|igv|moneda|estado|unidad|descrip|precio|importe|aux/i;

async function main() {
  const config = loadEnv();
  const pool = createBizlinksPool(config);
  await pool.connect();

  try {
    for (const tableName of ['SPE_EINVOICEHEADER', 'SPE_EINVOICEDETAIL']) {
      const request = new sql.Request(pool);
      request.input('tableName', sql.VarChar(128), tableName);
      const result = await request.query<{ COLUMN_NAME: string }>(`
        SELECT COLUMN_NAME
        FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_SCHEMA = 'dbo'
          AND TABLE_NAME = @tableName
        ORDER BY ORDINAL_POSITION;
      `);

      console.log(`--- ${tableName}`);
      console.log(result.recordset.map((row) => row.COLUMN_NAME).filter((name) => interesting.test(name)).join('\n'));
    }
  } finally {
    await pool.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
