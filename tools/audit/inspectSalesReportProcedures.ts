import { loadEnv } from '../../src/config/env.js';
import { createBizlinksPool, createYchiPool, sql } from '../../src/integrations/bizlinksSql.js';

const targets = {
  BIZLINKS_PROD21: ['SPB_REGISTRO_VTAS_FF03_2023', 'SPB_BUSCAR_FACTURA_ELECTRONICA_FF03'],
  YCHIDB3: [
    'SPB_REGISTRO_DEVENTAS_2_Y_003',
    'SPB_REGISTRO_DEVENTAS_3',
    'SPB_REGISTRO_DEVENTAS_4',
    'SPB_REGISTRO_DEVENTAS'
  ]
};

async function inspect(label: string, pool: sql.ConnectionPool, names: string[]) {
  await pool.connect();
  try {
    for (const name of names) {
      const request = new sql.Request(pool);
      request.input('name', sql.NVarChar(128), name);

      const params = await request.query(`
        SELECT
          SCHEMA_NAME(o.schema_id) AS schemaName,
          o.name,
          o.type_desc,
          p.name AS paramName,
          TYPE_NAME(p.user_type_id) AS typeName,
          p.max_length,
          p.parameter_id
        FROM sys.objects o
        LEFT JOIN sys.parameters p
          ON p.object_id = o.object_id
        WHERE o.name = @name
        ORDER BY p.parameter_id;
      `);

      const definition = await request.query<{ definition: string | null }>(`
        SELECT OBJECT_DEFINITION(o.object_id) AS definition
        FROM sys.objects o
        WHERE o.name = @name;
      `);

      console.log(JSON.stringify({
        database: label,
        name,
        params: params.recordset,
        definition: (definition.recordset[0]?.definition ?? '').slice(0, 16000)
      }, null, 2));
    }
  } finally {
    await pool.close();
  }
}

async function main() {
  const config = loadEnv();

  await inspect('BIZLINKS_PROD21', createBizlinksPool(config), targets.BIZLINKS_PROD21);
  await inspect('YCHIDB3', createYchiPool(config), targets.YCHIDB3);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
