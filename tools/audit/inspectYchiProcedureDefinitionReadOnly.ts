import { loadEnv } from '../../src/config/env.js';
import { createYchiPool, sql } from '../../src/integrations/bizlinksSql.js';

const procedureName = process.argv[2]?.trim();

if (!procedureName) {
  console.error('Uso: npx tsx tools/audit/inspectYchiProcedureDefinitionReadOnly.ts <procedureName>');
  process.exit(1);
}

async function main() {
  const config = loadEnv();
  const pool = createYchiPool(config);
  await pool.connect();

  try {
    const result = await new sql.Request(pool)
      .input('name', sql.VarChar(128), procedureName)
      .query(`
        SET TRANSACTION ISOLATION LEVEL READ UNCOMMITTED;

        SELECT
          p.parameter_id,
          p.name AS parameterName,
          TYPE_NAME(p.user_type_id) AS typeName,
          p.max_length,
          p.precision,
          p.scale,
          p.is_output
        FROM sys.objects o
        LEFT JOIN sys.parameters p ON p.object_id = o.object_id
        WHERE o.name = @name
        ORDER BY p.parameter_id;

        SELECT
          o.name,
          LEN(m.definition) AS definitionLength,
          m.definition
        FROM sys.objects o
        INNER JOIN sys.sql_modules m ON m.object_id = o.object_id
        WHERE o.name = @name;
      `);

    console.log(JSON.stringify({
      safety: 'READ_ONLY',
      procedureName,
      parameters: result.recordsets[0],
      definition: result.recordsets[1]?.[0] ?? null
    }, null, 2));
  } finally {
    await pool.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
