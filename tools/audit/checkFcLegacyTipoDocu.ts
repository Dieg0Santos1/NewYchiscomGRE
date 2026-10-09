import { loadEnv } from '../../src/config/env.js';
import { createYchiPool, sql } from '../../src/integrations/bizlinksSql.js';

async function main() {
  const pool = createYchiPool(loadEnv());
  await pool.connect();

  try {
    const result = await new sql.Request(pool).query(`
      SET TRANSACTION ISOLATION LEVEL READ UNCOMMITTED;
      SELECT *
      FROM dbo.tbTipoDocu
      WHERE idTipoDocu = 1
         OR serie IN ('F01', 'FF01')
      ORDER BY idTipoDocu, serie;
    `);

    const functions = await new sql.Request(pool).query(`
      SELECT o.name, OBJECT_DEFINITION(o.object_id) AS definition
      FROM sys.objects o
      WHERE o.name IN ('F_NumFactElectronica', 'F_NumFactElectronica_FC01')
      ORDER BY o.name;
    `);

    console.log(JSON.stringify({
      safety: 'READ_ONLY',
      tbTipoDocu: result.recordset,
      functions: functions.recordset.map((row) => ({
        name: row.name,
        definition: String(row.definition ?? '').slice(0, 6000)
      }))
    }, null, 2));
  } finally {
    await pool.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
