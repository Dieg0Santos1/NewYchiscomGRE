import { loadEnv } from '../../src/config/env.js';
import { createYchiPool, sql } from '../../src/integrations/bizlinksSql.js';

const procedureNames = [
  'SPI_FACTURA_ELECTRONICA_FF03',
  'SPI_FACTURA_VENTA_YP_GREMISION_003',
  'SPB_REGISTRO_VENTAS_COMISIONES_FF03'
];

async function main() {
  const config = loadEnv();
  const pool = createYchiPool(config);
  await pool.connect();

  try {
    const request = new sql.Request(pool);
    const params = procedureNames.map((name, index) => {
      const param = `name${index}`;
      request.input(param, sql.VarChar(128), name);
      return `@${param}`;
    });

    const result = await request.query(`
      SET TRANSACTION ISOLATION LEVEL READ UNCOMMITTED;

      SELECT
        o.name,
        p.parameter_id,
        p.name AS parameterName,
        TYPE_NAME(p.user_type_id) AS typeName,
        p.max_length,
        p.precision,
        p.scale,
        p.is_output
      FROM sys.objects o
      LEFT JOIN sys.parameters p ON p.object_id = o.object_id
      WHERE o.name IN (${params.join(', ')})
      ORDER BY o.name, p.parameter_id;

      SELECT
        o.name,
        LEFT(m.definition, 4000) AS definitionStart
      FROM sys.objects o
      INNER JOIN sys.sql_modules m ON m.object_id = o.object_id
      WHERE o.name IN (${params.join(', ')})
      ORDER BY o.name;
    `);

    console.log(JSON.stringify({
      safety: 'READ_ONLY',
      procedureNames,
      parameters: result.recordsets[0],
      definitionStarts: result.recordsets[1]
    }, null, 2));
  } finally {
    await pool.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
