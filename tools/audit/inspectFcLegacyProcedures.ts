import { loadEnv } from '../../src/config/env.js';
import { createYchiPool, sql } from '../../src/integrations/bizlinksSql.js';

const procedureNames = [
  'SPI_RECEPCIONOTGUI',
  'SPU_RECEPCION_OT_ESTADO',
  'SPU_CERRAR_OTGUI',
  'SPI_GUIA_REMISION44_YP',
  'SPI_DETGUIA_REMISION',
  'SPI_GUIA_REMISION_Y_003',
  'SPI_DETGUIA_REMISION_Y_003',
  'GRE_WEB_CREAR_PREGUIA_FC',
  'GRE_WEB_ACEPTAR_PREGUIA_FC',
  'GRE_WEB_CREAR_GUIA_INTERNA_FC'
];

const config = loadEnv();
const pool = createYchiPool(config);
await pool.connect();

try {
  const request = new sql.Request(pool);
  const parameters = procedureNames.map((name, index) => {
    request.input(`name${index}`, sql.NVarChar(128), name);
    return `@name${index}`;
  });
  const result = await request.query(`
    SET TRANSACTION ISOLATION LEVEL READ UNCOMMITTED;
    SELECT
      SCHEMA_NAME(o.schema_id) AS schemaName,
      o.name,
      OBJECT_DEFINITION(o.object_id) AS definition
    FROM sys.objects o
    WHERE o.type IN ('P', 'PC')
      AND o.name IN (${parameters.join(', ')})
    ORDER BY o.name;
  `);

  for (const row of result.recordset) {
    console.log(`\n===== ${row.schemaName}.${row.name} =====\n`);
    console.log(row.definition ?? '[definition unavailable]');
  }
} finally {
  await pool.close();
}
