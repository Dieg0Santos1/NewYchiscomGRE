import { loadEnv } from '../../src/config/env.js';
import { createGreFcPool, sql } from '../../src/integrations/bizlinksSql.js';

async function main() {
  const pool = createGreFcPool(loadEnv());
  await pool.connect();

  try {
    const result = await new sql.Request(pool).query(`
      SELECT DB_NAME() AS dbName;

      SELECT
        TABLE_SCHEMA,
        TABLE_NAME
      FROM INFORMATION_SCHEMA.TABLES
      WHERE TABLE_NAME LIKE 'FC_FACT%'
      ORDER BY TABLE_SCHEMA, TABLE_NAME;

      SELECT
        c.name,
        OBJECT_SCHEMA_NAME(c.parent_object_id) AS schemaName,
        OBJECT_NAME(c.parent_object_id) AS tableName,
        c.definition
      FROM sys.check_constraints c
      WHERE c.name LIKE '%FC_FACT_GUIA%'
         OR c.name LIKE '%GUIA_serie%';

      SELECT
        version,
        aplicadoEn
      FROM dbo.GRE_FC_SCHEMA_MIGRATION
      WHERE version LIKE '004%'
         OR version LIKE '005%'
      ORDER BY version;
    `);

    console.dir(result.recordsets, { depth: null, colors: false });
  } finally {
    await pool.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
