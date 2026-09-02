import sql from 'mssql';
import * as fs from 'fs';
import * as path from 'path';

async function main() {
  const mode = process.argv[2];
  if (mode !== 'upgrade' && mode !== 'rollback') {
    console.error("Uso: npx tsx src/apply_sql.ts [upgrade|rollback]");
    process.exit(1);
  }

  const fileName = mode === 'upgrade' ? 'upgrade_procedures.sql' : 'rollback_procedures.sql';
  const filePath = path.join('D:/CODE/NewSystemGRE/src', fileName);
  
  if (!fs.existsSync(filePath)) {
    console.error(`No se encontro el archivo SQL: ${filePath}`);
    process.exit(1);
  }

  const saConfig = {
    server: '192.168.1.140',
    port: 1433,
    database: 'YCHIDB3',
    user: 'sa',
    password: 'G8dag6tg4dt',
    options: {
      encrypt: false,
      trustServerCertificate: true
    }
  };

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
