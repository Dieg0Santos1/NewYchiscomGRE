import { loadEnv } from '../../src/config/env.js';
import { createGreFcPool, sql } from '../../src/integrations/bizlinksSql.js';

const guide = process.argv[2]?.trim() || 'T001-00000067';

async function main() {
  const config = loadEnv();
  const pool = createGreFcPool(config);
  await pool.connect();

  try {
    const request = new sql.Request(pool);
    request.input('guide', sql.VarChar(20), guide);
    const result = await request.query(`
      SELECT
        g.serieNumeroGuia,
        o.serieNumeroFactura,
        o.estado,
        h.bl_estadoRegistro
      FROM dbo.FC_FACT_GUIA g
      INNER JOIN dbo.FC_FACT_OPERACION o
        ON o.id = g.operacionId
      LEFT JOIN [${config.bizlinksDb.database.replace(/]/g, ']]')}].dbo.SPE_EINVOICEHEADER h
        ON h.SERIENUMERO COLLATE DATABASE_DEFAULT = o.serieNumeroFactura
       AND h.TIPODOCUMENTO = '01'
      WHERE g.serieNumeroGuia = @guide
        AND o.estado IN ('PREPARANDO', 'INSERTADO_BIZLINKS', 'ACTIVADO', 'ACEPTADA')
        AND ISNULL(h.bl_estadoRegistro, '') <> 'E';
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
