import sql from 'mssql';
import type { AppConfig, SqlDbConfig } from '../config/env.js';

function createSqlPool(dbConfig: SqlDbConfig, requestTimeoutMs: number, label: string) {
  if (!dbConfig.server || !dbConfig.user || !dbConfig.password) {
    throw new Error(`Configuracion ${label} SQL incompleta`);
  }

  if (dbConfig.user.trim().toLowerCase() === 'sa') {
    throw new Error(`${label}_SQL_USER no puede ser sa`);
  }

  return new sql.ConnectionPool({
    server: dbConfig.server,
    port: dbConfig.port,
    database: dbConfig.database,
    user: dbConfig.user,
    password: dbConfig.password,
    options: {
      encrypt: dbConfig.encrypt,
      trustServerCertificate: dbConfig.trustServerCertificate
    },
    pool: {
      max: 5,
      min: 0,
      idleTimeoutMillis: 30000
    },
    requestTimeout: requestTimeoutMs,
    connectionTimeout: requestTimeoutMs
  });
}

export function createBizlinksPool(config: AppConfig) {
  return createSqlPool(config.bizlinksDb, config.requestTimeoutMs, 'BIZLINKS');
}

export function createGreFcPool(config: AppConfig) {
  return createSqlPool(config.greFcDb, config.requestTimeoutMs, 'GRE_FC');
}

export function createYchiPool(config: AppConfig) {
  return createSqlPool(config.ychiDb, config.requestTimeoutMs, 'YCHI');
}

export { sql };
