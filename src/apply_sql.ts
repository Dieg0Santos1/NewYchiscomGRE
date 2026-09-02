import sql from 'mssql';
import * as fs from 'fs';
import * as path from 'path';
import { config as loadDotenv } from 'dotenv';

loadDotenv();

async function main() {
  const mode = process.argv[2];
  if (mode !== 'upgrade' && mode !== 'rollback') {
    console.error("Uso: npx tsx src/apply_sql.ts [upgrade|rollback]");
    process.exit(1);
  }

  const fileName = mode === 'upgrade' ? 'upgrade_procedures.sql' : 'rollback_procedures.sql';
  const filePath = path.join(process.cwd(), 'src', fileName);
  
  if (!fs.existsSync(filePath)) {
    console.error(`No se encontro el archivo SQL: ${filePath}`);
    process.exit(1);
  }

  const saConfig = {
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

  if (!saConfig.server || !saConfig.user || !saConfig.password) {
    console.error('Configure YCHI_SQL_SERVER, YCHI_SQL_USER y YCHI_SQL_PASSWORD en .env antes de aplicar SQL.');
    process.exit(1);
  }

  const pool = new sql.ConnectionPool(saConfig);
  await pool.connect();

  try {
    console.log(`Conectado como sa. Leyendo y aplicando: ${fileName}...`);
    const sqlContent = fs.readFileSync(filePath, 'utf-8');
    
    // Split commands by GO (case-insensitive)
    const commands = sqlContent.split(/\bGO\b/i);

    for (const cmd of commands) {
      const trimmed = cmd.trim();
      if (trimmed) {
        console.log("Ejecutando comando SQL...");
        await pool.request().query(trimmed);
      }
    }
    console.log(`¡Exito! Se ha aplicado el script de ${mode} en la base de datos.`);

  } catch (error: any) {
    console.error("Error ejecutando SQL:", error.message);
  } finally {
    await pool.close();
  }
}

main();
