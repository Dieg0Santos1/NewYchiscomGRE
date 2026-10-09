import { loadEnv } from '../../src/config/env.js';
import { createYchiPool, sql } from '../../src/integrations/bizlinksSql.js';

async function main() {
  const pool = createYchiPool(loadEnv());
  await pool.connect();

  try {
    const request = new sql.Request(pool);
    request.input('fecha', sql.DateTime, new Date('2026-09-16T00:00:00-05:00'));
    const result = await request.query(`
      SET TRANSACTION ISOLATION LEVEL READ UNCOMMITTED;
      SELECT CONVERT(decimal(10, 4), venta) AS tipoCambio, fecha
      FROM dbo.TBTICA
      WHERE IDMONEDA = 'D'
        AND CONVERT(date, fecha) = CONVERT(date, @fecha);
    `);

    console.log(JSON.stringify({ safety: 'READ_ONLY', result: result.recordset }, null, 2));
  } finally {
    await pool.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
