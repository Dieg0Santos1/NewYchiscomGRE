import { loadEnv } from '../../src/config/env.js';
import { createBizlinksPool, createYchiPool, sql } from '../../src/integrations/bizlinksSql.js';

const values = process.argv.slice(2).map((value) => value.trim()).filter(Boolean);

if (values.length === 0) {
  console.error('Uso: npx tsx tools/audit/findValueInSqlTextColumns.ts FF03-00010950 00010950');
  process.exit(1);
}

type TextColumn = {
  TABLE_SCHEMA: string;
  TABLE_NAME: string;
  COLUMN_NAME: string;
};

function quoteName(value: string) {
  return `[${value.replace(/]/g, ']]')}]`;
}

async function findInPool(label: string, pool: sql.ConnectionPool) {
  const columns = await new sql.Request(pool).query<TextColumn>(`
    SELECT TABLE_SCHEMA, TABLE_NAME, COLUMN_NAME
    FROM INFORMATION_SCHEMA.COLUMNS
    WHERE DATA_TYPE IN ('char', 'varchar', 'nchar', 'nvarchar', 'text', 'ntext')
      AND TABLE_SCHEMA = 'dbo'
    ORDER BY TABLE_NAME, ORDINAL_POSITION
  `);

  const matches: Array<Record<string, unknown>> = [];

  for (const column of columns.recordset) {
    const tableName = `${quoteName(column.TABLE_SCHEMA)}.${quoteName(column.TABLE_NAME)}`;
    const columnName = quoteName(column.COLUMN_NAME);

    for (const [index, value] of values.entries()) {
      const request = new sql.Request(pool);
      request.input('needle', sql.NVarChar(4000), `%${value}%`);

      try {
        const result = await request.query<{ sampleValue: string | null; total: number }>(`
          SELECT TOP (3)
            CONVERT(nvarchar(4000), ${columnName}) AS sampleValue,
            COUNT(1) OVER () AS total
          FROM ${tableName}
          WHERE CONVERT(nvarchar(4000), ${columnName}) LIKE @needle
        `);

        for (const row of result.recordset) {
          matches.push({
            database: label,
            table: `${column.TABLE_SCHEMA}.${column.TABLE_NAME}`,
            column: column.COLUMN_NAME,
            searched: value,
            sampleValue: row.sampleValue,
            totalInColumn: row.total
          });
        }
      } catch (error) {
        if (index === 0 && /permission|denied/i.test(error instanceof Error ? error.message : String(error))) {
          matches.push({
            database: label,
            table: `${column.TABLE_SCHEMA}.${column.TABLE_NAME}`,
            column: column.COLUMN_NAME,
            error: error instanceof Error ? error.message : String(error)
          });
        }
      }
    }
  }

  return matches;
}

async function main() {
  const config = loadEnv();
  const bizlinksPool = createBizlinksPool(config);
  const ychiPool = createYchiPool(config);

  await bizlinksPool.connect();
  await ychiPool.connect();

  try {
    const [bizlinks, ychiscom] = await Promise.all([
      findInPool('BIZLINKS_PROD21', bizlinksPool),
      findInPool('YCHIDB3', ychiPool)
    ]);

    console.log(JSON.stringify({
      searchedValues: values,
      matches: [...bizlinks, ...ychiscom]
    }, null, 2));
  } finally {
    await ychiPool.close();
    await bizlinksPool.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
