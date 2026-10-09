import { loadEnv } from '../../src/config/env.js';
import { createYchiPool, sql } from '../../src/integrations/bizlinksSql.js';

const documents = process.argv.slice(2).filter((item) => /^\d{8,11}$/.test(item));
if (documents.length === 0) documents.push('20307214386', '20481252475');

async function main() {
  const pool = createYchiPool(loadEnv());
  await pool.connect();

  try {
    const request = new sql.Request(pool);
    const params = documents.map((document, index) => {
      const name = `document${index}`;
      request.input(name, sql.VarChar(20), document);
      return `@${name}`;
    });

    const columns = await pool.request().query(`
      SELECT COLUMN_NAME, DATA_TYPE
      FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = 'dbo'
        AND TABLE_NAME = 'tbClieProv'
      ORDER BY ORDINAL_POSITION;
    `);
    const geoColumns = await pool.request().query(`
      SELECT TABLE_NAME, COLUMN_NAME, DATA_TYPE
      FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = 'dbo'
        AND TABLE_NAME IN ('tbDepartamento', 'tbProvincia', 'tbDistrito')
      ORDER BY TABLE_NAME, ORDINAL_POSITION;
    `);
    const available = new Set(columns.recordset.map((row) => String(row.COLUMN_NAME).toLowerCase()));
    const wanted = [
      'idClieProv', 'RUC', 'Nombre', 'Direccion', 'Distrito', 'Provincia',
      'Departamento', 'Ubigeo', 'idDepartamento', 'IdProvincia', 'IdDistrito',
      'Estado', 'tipoClieProv'
    ].filter((column) => available.has(column.toLowerCase()));

    const customers = await request.query(`
      SELECT ${wanted.map((column) => `c.[${column}]`).join(', ')},
        dpto.nombre AS departamentoCatalogo,
        prov.nombre AS provinciaCatalogo,
        dist.nombre AS distritoCatalogo
      FROM dbo.tbClieProv c
      LEFT JOIN dbo.tbDepartamento dpto ON dpto.idDepartamento = c.idDepartamento
      LEFT JOIN dbo.tbProvincia prov ON prov.idProvincia = c.IdProvincia
      LEFT JOIN dbo.tbDistrito dist ON dist.idDistrito = c.IdDistrito
      WHERE REPLACE(REPLACE(LTRIM(RTRIM(ISNULL(c.RUC, ''))), '-', ''), ' ', '')
        IN (${params.join(', ')});
    `);

    console.log(JSON.stringify({
      safety: 'READ_ONLY',
      relevantColumns: columns.recordset.filter((row) =>
        /dire|distr|provin|depart|ubig|ruc|nombre/i.test(String(row.COLUMN_NAME))
      ),
      geographyColumns: geoColumns.recordset,
      customers: customers.recordset
    }, null, 2));
  } finally {
    await pool.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
