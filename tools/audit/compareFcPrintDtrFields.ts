import { loadEnv } from '../../src/config/env.js';
import { createBizlinksPool, sql } from '../../src/integrations/bizlinksSql.js';

async function main() {
  const pool = createBizlinksPool(loadEnv());
  await pool.connect();
  try {
    const result = await new sql.Request(pool).query(`
      SET TRANSACTION ISOLATION LEVEL READ UNCOMMITTED;
      SELECT SERIENUMERO, textoLeyenda_1, textoAuxiliar100_1, textoAuxiliar40_2, textoAuxiliar40_3,
        codigoAuxiliar100_1, codigoAuxiliar40_2, codigoAuxiliar40_3,
        tipoMoneda, totalVenta, tipoOperacion, codigoDetraccion, totalDetraccion
      FROM dbo.SPE_EINVOICEHEADER
      WHERE SERIENUMERO IN ('FF01-00017172', 'FF01-00017184', 'FF01-00017187')
        AND TIPODOCUMENTO = '01'
      ORDER BY SERIENUMERO;
    `);
    console.log(JSON.stringify(result.recordset, null, 2));
  } finally {
    await pool.close();
  }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
