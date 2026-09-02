import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEnv } from '../config/env.js';
import { createGreFcPool, sql } from '../integrations/bizlinksSql.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..', '..');
const migrationsDir = path.join(projectRoot, 'migrations', 'GRE_FORMULARIOS_TEST');
const bootstrapMigration = '000_create_database';

type MigrationFile = {
  version: string;
  fileName: string;
  fullPath: string;
};

type AppliedMigration = {
  version: string;
  descripcion: string;
  aplicadoEn: Date;
};

export async function printMigrationStatus() {
  const config = loadEnv();
  const pool = createGreFcPool(config);

  await pool.connect();

  try {
    const files = await getMigrationFiles();
    const applied = await getAppliedMigrations(pool);
    const appliedVersions = new Set(applied.map((migration) => migration.version));
    const pending = files.filter((migration) => !appliedVersions.has(migration.version));

    printHeader(config.greFcDb.database);
    printBootstrapNote();
    printApplied(applied);
    printPending(pending);
  } finally {
    await pool.close();
  }
}

export async function runPendingMigrations() {
  const config = loadEnv();
  const pool = createGreFcPool(config);

  await pool.connect();

  try {
    const files = await getMigrationFiles();
    const transaction = new sql.Transaction(pool);

    await transaction.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);

    try {
      await ensureMigrationTable(transaction);

      const applied = await getAppliedMigrations(transaction);
      const appliedVersions = new Set(applied.map((migration) => migration.version));
      const pending = files.filter((migration) => !appliedVersions.has(migration.version));

      printHeader(config.greFcDb.database);
      printBootstrapNote();

      if (pending.length === 0) {
        console.log('Migraciones pendientes: 0');
        await transaction.commit();
        return;
      }

      for (const migration of pending) {
        console.log(`Aplicando ${migration.fileName}...`);
        const sqlText = await fs.readFile(migration.fullPath, 'utf8');
        await executeSqlBatches(transaction, sqlText);
        await registerMigration(transaction, migration);
      }

      await transaction.commit();
      console.log(`Migraciones aplicadas: ${pending.length}`);
    } catch (error) {
      await rollbackQuietly(transaction);
      throw error;
    }
  } finally {
    await pool.close();
  }
}

async function getMigrationFiles(): Promise<MigrationFile[]> {
  const entries = await fs.readdir(migrationsDir, { withFileTypes: true });

  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith('.sql'))
    .map((entry) => ({
      version: entry.name.replace(/\.sql$/i, ''),
      fileName: entry.name,
      fullPath: path.join(migrationsDir, entry.name)
    }))
    .filter((migration) => migration.version !== bootstrapMigration)
    .sort((left, right) => left.version.localeCompare(right.version));
}

async function getAppliedMigrations(poolOrTransaction: sql.ConnectionPool | sql.Transaction): Promise<AppliedMigration[]> {
  const tableExistsRequest = createRequest(poolOrTransaction);
  const tableExistsResult = await tableExistsRequest.query<{ total: number }>(`
    SELECT COUNT(1) AS total
    FROM sys.objects
    WHERE object_id = OBJECT_ID(N'dbo.GRE_FC_SCHEMA_MIGRATION')
      AND type = 'U'
  `);

  if ((tableExistsResult.recordset[0]?.total ?? 0) === 0) {
    return [];
  }

  const request = createRequest(poolOrTransaction);
  const result = await request.query<AppliedMigration>(`
    SELECT version, descripcion, aplicadoEn
    FROM dbo.GRE_FC_SCHEMA_MIGRATION
    ORDER BY version
  `);

  return result.recordset;
}

async function ensureMigrationTable(transaction: sql.Transaction) {
  await new sql.Request(transaction).query(`
    IF OBJECT_ID(N'dbo.GRE_FC_SCHEMA_MIGRATION', N'U') IS NULL
    BEGIN
      CREATE TABLE dbo.GRE_FC_SCHEMA_MIGRATION
      (
        id int IDENTITY(1,1) NOT NULL CONSTRAINT PK_GRE_FC_SCHEMA_MIGRATION PRIMARY KEY,
        version varchar(50) NOT NULL CONSTRAINT UQ_GRE_FC_SCHEMA_MIGRATION_version UNIQUE,
        descripcion nvarchar(250) NOT NULL,
        aplicadoEn datetime2(3) NOT NULL CONSTRAINT DF_GRE_FC_SCHEMA_MIGRATION_aplicadoEn DEFAULT SYSUTCDATETIME()
      );
    END;
  `);
}

async function executeSqlBatches(transaction: sql.Transaction, sqlText: string) {
  const batches = splitSqlBatches(sqlText);

  for (const batch of batches) {
    await new sql.Request(transaction).batch(batch);
  }
}

function splitSqlBatches(sqlText: string) {
  return sqlText
    .split(/^\s*GO\s*;?\s*$/gim)
    .map((batch) => batch.trim())
    .filter(Boolean);
}

async function registerMigration(transaction: sql.Transaction, migration: MigrationFile) {
  const request = new sql.Request(transaction);
  request.input('version', sql.VarChar(50), migration.version);
  request.input('descripcion', sql.NVarChar(250), `Aplicada desde ${migration.fileName}`);

  await request.query(`
    IF NOT EXISTS (SELECT 1 FROM dbo.GRE_FC_SCHEMA_MIGRATION WHERE version = @version)
    BEGIN
      INSERT INTO dbo.GRE_FC_SCHEMA_MIGRATION (version, descripcion)
      VALUES (@version, @descripcion);
    END;
  `);
}

function createRequest(poolOrTransaction: sql.ConnectionPool | sql.Transaction) {
  return poolOrTransaction instanceof sql.Transaction
    ? new sql.Request(poolOrTransaction)
    : new sql.Request(poolOrTransaction);
}

function printHeader(database: string) {
  console.log(`Base objetivo: ${database}`);
  console.log('Conexion: GRE_FC_SQL_*');
}

function printBootstrapNote() {
  console.log('Bootstrap manual: 000_create_database.sql');
}

function printApplied(applied: AppliedMigration[]) {
  console.log(`Migraciones aplicadas: ${applied.length}`);

  for (const migration of applied) {
    console.log(`  - ${migration.version} (${migration.aplicadoEn.toISOString()})`);
  }
}

function printPending(pending: MigrationFile[]) {
  console.log(`Migraciones pendientes: ${pending.length}`);

  for (const migration of pending) {
    console.log(`  - ${migration.version}`);
  }
}

async function rollbackQuietly(transaction: sql.Transaction) {
  try {
    await transaction.rollback();
  } catch {
    // rollback best effort
  }
}
