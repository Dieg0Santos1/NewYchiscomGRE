import sql from 'mssql';

const dbConfig = {
  server: '192.168.1.140',
  port: 1433,
  database: 'YCHIDB3',
  user: 'gre_app_test',
  password: '72032575Dasa*',
  options: {
    encrypt: false,
    trustServerCertificate: true
  }
};

async function runAudit() {
  const pool = new sql.ConnectionPool(dbConfig);
  await pool.connect();
  console.log("Connected to YCHIDB3!");
  try {
    const cols = await pool.request().query(`
      SELECT COLUMN_NAME, DATA_TYPE FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'tbDetGuias'
    `);
    console.log("tbDetGuias Columns:", cols.recordset.map(c => c.COLUMN_NAME));
  } catch (e) {
    console.error(e);
  } finally {
    await pool.close();
  }
}

runAudit();
