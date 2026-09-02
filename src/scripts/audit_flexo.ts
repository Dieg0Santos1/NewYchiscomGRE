import sql from 'mssql';
import { config as loadDotenv } from 'dotenv';

loadDotenv();

const dbConfig = {
  server: process.env.YCHI_SQL_SERVER || process.env.YCHIDB3_SQL_SERVER || '',
  port: Number(process.env.YCHI_SQL_PORT || process.env.YCHIDB3_SQL_PORT || 1433),
  database: process.env.YCHI_SQL_DATABASE || process.env.YCHIDB3_SQL_DATABASE || 'YCHIDB3',
  user: process.env.YCHI_SQL_USER || process.env.YCHIDB3_SQL_USER || '',
  password: process.env.YCHI_SQL_PASSWORD || process.env.YCHIDB3_SQL_PASSWORD || '',
  options: {
    encrypt: (process.env.YCHI_SQL_ENCRYPT || process.env.YCHIDB3_SQL_ENCRYPT) === 'true',
    trustServerCertificate: (process.env.YCHI_SQL_TRUST_SERVER_CERTIFICATE || process.env.YCHIDB3_SQL_TRUST_SERVER_CERTIFICATE || 'true') === 'true'
  }
};

async function runAudit() {
  if (!dbConfig.server || !dbConfig.user || !dbConfig.password) {
    throw new Error('Configure YCHI_SQL_SERVER, YCHI_SQL_USER y YCHI_SQL_PASSWORD en .env antes de auditar.');
  }

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
