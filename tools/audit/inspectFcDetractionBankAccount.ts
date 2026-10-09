import { loadEnv } from '../../src/config/env.js';
import { createBizlinksPool, sql } from '../../src/integrations/bizlinksSql.js';

async function main() {
  const pool = createBizlinksPool(loadEnv());
  await pool.connect();
  try {
    const result = await new sql.Request(pool).query(`
      SET TRANSACTION ISOLATION LEVEL READ UNCOMMITTED;
      SELECT SERIENUMERO, tipoMoneda, tipoOperacion, codigoDetraccion, porcentajeDetraccion, totalDetraccion,
        numeroCtaBancoNacion, totalVenta, BL_ESTADOREGISTRO
      FROM dbo.SPE_EINVOICEHEADER
      WHERE SERIENUMERO IN ('FF01-00017172', 'FF01-00017184', 'FF01-00017187')
        AND TIPODOCUMENTO = '01'
      ORDER BY SERIENUMERO;

      SELECT SERIENUMERO, clave, valor
      FROM dbo.SPE_EINVOICEHEADER_ADD
      WHERE SERIENUMERO IN ('FF01-00017172', 'FF01-00017184', 'FF01-00017187')
        AND TIPODOCUMENTO = '01'
        AND (
          clave LIKE '%Banco%'
          OR clave IN ('formaPago', 'formapago', 'fechaVencimiento', 'montoNetoPendiente', 'montoPagoCuota1', 'fechaPagoCuota1')
        )
      ORDER BY SERIENUMERO, clave;
    `);
    console.log(JSON.stringify({ headers: result.recordsets[0], add: result.recordsets[1] }, null, 2));
  } finally {
    await pool.close();
  }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
