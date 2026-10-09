import { loadEnv } from '../../src/config/env.js';
import { createBizlinksPool, sql } from '../../src/integrations/bizlinksSql.js';

async function main() {
  const pool = createBizlinksPool(loadEnv());
  await pool.connect();

  try {
    const result = await new sql.Request(pool).query(`
      SELECT TOP (120)
        o.name,
        o.type_desc,
        CASE WHEN m.definition LIKE '%EMPAQUE_DETALLE%' THEN 1 ELSE 0 END AS usesEmpaqueDetalle,
        CASE WHEN m.definition LIKE '%AAA_GUIAFACTURADA%' THEN 1 ELSE 0 END AS usesGuiaFacturada,
        CASE WHEN m.definition LIKE '%AAA_REGISTRO_CONTABLE%' THEN 1 ELSE 0 END AS usesRegistroContable,
        CASE WHEN m.definition LIKE '%SPE_DESPATCH%' THEN 1 ELSE 0 END AS usesDespatch,
        CASE WHEN m.definition LIKE '%SPE_EINVOICE%' THEN 1 ELSE 0 END AS usesEinvoice
      FROM sys.objects o
      JOIN sys.sql_modules m
        ON m.object_id = o.object_id
      WHERE o.type IN ('P', 'FN', 'IF', 'TF', 'V')
        AND (
          o.name LIKE '%FF03%'
          OR o.name LIKE '%T003%'
          OR o.name LIKE '%GUIA%'
          OR o.name LIKE '%FACTURA%'
          OR o.name LIKE '%DESPATCH%'
          OR m.definition LIKE '%EMPAQUE_DETALLE%'
          OR m.definition LIKE '%AAA_GUIAFACTURADA%'
        )
      ORDER BY
        usesEmpaqueDetalle DESC,
        usesGuiaFacturada DESC,
        usesRegistroContable DESC,
        usesDespatch DESC,
        usesEinvoice DESC,
        o.name;
    `);

    console.log(JSON.stringify(result.recordset, null, 2));
  } finally {
    await pool.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
