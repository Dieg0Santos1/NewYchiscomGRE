import { loadEnv } from '../../src/config/env.js';
import { createBizlinksPool, sql } from '../../src/integrations/bizlinksSql.js';

const names = [
  'SPB_BUSCAR_FACTURA_ELECTRONICA_FF01',
  'VW_FACTURA_HEADER',
  'VW_FACTURA_DETAIL',
  'VW_direccionAdquiriente',
  'VW_ubigeoAdquiriente'
];

async function main() {
  const pool = createBizlinksPool(loadEnv());
  await pool.connect();

  try {
    const request = new sql.Request(pool);
    const params = names.map((name, index) => {
      const param = `name${index}`;
      request.input(param, sql.NVarChar(128), name);
      return `@${param}`;
    });

    const result = await request.query<{
      name: string;
      type_desc: string;
      definition: string | null;
    }>(`
      SELECT o.name, o.type_desc, OBJECT_DEFINITION(o.object_id) AS definition
      FROM sys.objects o
      WHERE o.name IN (${params.join(', ')})
      ORDER BY o.name;
    `);

    console.log(JSON.stringify(result.recordset.map((row) => ({
      ...row,
      definition: (row.definition ?? '').slice(0, 16000)
    })), null, 2));
  } finally {
    await pool.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
