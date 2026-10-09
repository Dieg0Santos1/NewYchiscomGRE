import { loadEnv } from '../../src/config/env.js';
import { createYchiPool, sql } from '../../src/integrations/bizlinksSql.js';

async function main() {
  const pool = createYchiPool(loadEnv());
  await pool.connect();
  try {
    const result = await new sql.Request(pool).query(`
      SET TRANSACTION ISOLATION LEVEL READ UNCOMMITTED;
      SELECT TABLE_NAME, COLUMN_NAME, DATA_TYPE
      FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_NAME IN ('tbPropiedades', 'tbDocumentos')
        AND (TABLE_NAME = 'tbPropiedades' OR COLUMN_NAME IN ('idDocumento','idTipoDocu','SeriDocu','NumeDocu','DescClieProv','formaPago','Moneda','Tica','Neto','Igv','Total','Observaciones','FechaEmision','FechaVencimiento','Estado','idEmpleado','nguia','cuenta','idDocumentoAnterior'))
      ORDER BY TABLE_NAME, ORDINAL_POSITION;
    `);
    console.log(JSON.stringify(result.recordset, null, 2));
  } finally {
    await pool.close();
  }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
