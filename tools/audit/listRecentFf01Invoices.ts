import { loadEnv } from '../../src/config/env.js';
import { createBizlinksPool, sql } from '../../src/integrations/bizlinksSql.js';

async function main() {
  const pool = createBizlinksPool(loadEnv());
  await pool.connect();

  try {
    const result = await new sql.Request(pool).query(`
      SELECT TOP (10)
        h.SERIENUMERO,
        h.FECHAEMISION,
        h.bl_estadoRegistro,
        h.numeroDocumentoAdquiriente,
        h.razonSocialAdquiriente,
        h.tipoOperacion,
        h.codigoDetraccion,
        h.porcentajeDetraccion,
        h.totalDetraccion,
        h.totalVenta
      FROM dbo.SPE_EINVOICEHEADER h
      WHERE h.SERIENUMERO LIKE 'FF01-%'
        AND h.TIPODOCUMENTO = '01'
      ORDER BY h.SERIENUMERO DESC;
    `);

    console.dir(result.recordset, { depth: null, colors: false });
  } finally {
    await pool.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
