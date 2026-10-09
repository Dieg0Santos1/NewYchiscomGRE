import { loadEnv } from '../../src/config/env.js';
import { createYchiPool, sql } from '../../src/integrations/bizlinksSql.js';

async function main() {
  const config = loadEnv();
  const ychi = createYchiPool(config);
  await ychi.connect();

  try {
    const columns = await new sql.Request(ychi).query(`
      SELECT TABLE_NAME, COLUMN_NAME, DATA_TYPE, CHARACTER_MAXIMUM_LENGTH,
        IS_NULLABLE, COLUMN_DEFAULT
      FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_NAME IN ('tbDocumentos', 'tbDetFact')
      ORDER BY TABLE_NAME, ORDINAL_POSITION;
    `);

    const docs = await new sql.Request(ychi).query(`
      SET TRANSACTION ISOLATION LEVEL READ UNCOMMITTED;
      SELECT *
      FROM dbo.tbDocumentos
      WHERE idTipoDocu = 1 AND SeriDocu = 'F01'
        AND NumeDocu BETWEEN '0017173' AND '0017180'
      ORDER BY NumeDocu;
    `);

    console.log(JSON.stringify({
      safety: 'READ_ONLY',
      columns: columns.recordset,
      documents: docs.recordset
    }, null, 2));
  } finally {
    await ychi.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
