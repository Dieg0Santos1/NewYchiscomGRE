import dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config();

const booleanFromEnv = z
  .string()
  .optional()
  .transform((value) => value?.toLowerCase() === 'false' ? false : true);
const disabledBooleanFromEnv = z
  .string()
  .optional()
  .default('false')
  .transform((value) => value.toLowerCase() === 'true');

const envSchema = z.object({
  PORT: z.coerce.number().int().positive().default(3001),
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  DRY_RUN: booleanFromEnv.default(true),
  EXISTING_GRE_API_URL: z.string().url().default('http://192.168.1.140:92'),
  EXISTING_GRE_API_TOKEN: z.string().optional().default(''),
  GRE_REQUEST_TIMEOUT_MS: z.coerce.number().int().positive().default(30000),
  GRE_REMITENTE_TIPO_DOCUMENTO: z.string().min(1).default('6'),
  GRE_REMITENTE_NUMERO_DOCUMENTO: z.string().min(1).default('20259402965'),
  GRE_REMITENTE_RAZON_SOCIAL: z.string().min(1).default('YCHIFORMAS S.A.'),
  GRE_REMITENTE_CORREO: z.string().min(1).default('-'),
  GRE_PARTIDA_UBIGEO: z.string().min(6).default('140109'),
  GRE_PARTIDA_DIRECCION: z.string().min(1).default('AV. LUNA PIZARRO 1328-1340, LA VICTORIA'),
  GRE_DIRECT_DB_INSERT_ENABLED: booleanFromEnv.default(false),
  GRE_FC_SQL_SERVER: z.string().optional().default(''),
  GRE_FC_SQL_PORT: z.coerce.number().int().positive().default(1433),
  GRE_FC_SQL_DATABASE: z.string().optional().default('GRE_FORMULARIOS_TEST'),
  GRE_FC_SQL_USER: z.string().optional().default(''),
  GRE_FC_SQL_PASSWORD: z.string().optional().default(''),
  GRE_FC_SQL_ENCRYPT: booleanFromEnv.default(false),
  GRE_FC_SQL_TRUST_SERVER_CERTIFICATE: booleanFromEnv.default(true),
  YCHI_SQL_SERVER: z.string().optional().default(''),
  YCHI_SQL_PORT: z.coerce.number().int().positive().default(1433),
  YCHI_SQL_DATABASE: z.string().optional().default('YCHIDB3'),
  YCHI_SQL_USER: z.string().optional().default(''),
  YCHI_SQL_PASSWORD: z.string().optional().default(''),
  YCHI_SQL_ENCRYPT: booleanFromEnv.default(false),
  YCHI_SQL_TRUST_SERVER_CERTIFICATE: booleanFromEnv.default(true),
  YCHIDB3_SQL_SERVER: z.string().optional().default(''),
  YCHIDB3_SQL_PORT: z.coerce.number().int().positive().default(1433),
  YCHIDB3_SQL_DATABASE: z.string().optional().default(''),
  YCHIDB3_SQL_USER: z.string().optional().default(''),
  YCHIDB3_SQL_PASSWORD: z.string().optional().default(''),
  YCHIDB3_SQL_ENCRYPT: booleanFromEnv.default(false),
  YCHIDB3_SQL_TRUST_SERVER_CERTIFICATE: booleanFromEnv.default(true),
  BIZLINKS_SQL_SERVER: z.string().optional().default(''),
  BIZLINKS_SQL_PORT: z.coerce.number().int().positive().default(1433),
  BIZLINKS_SQL_DATABASE: z.string().optional().default('BIZLINKS_PROD21'),
  BIZLINKS_SQL_USER: z.string().optional().default(''),
  BIZLINKS_SQL_PASSWORD: z.string().optional().default(''),
  BIZLINKS_SQL_ENCRYPT: booleanFromEnv.default(false),
  BIZLINKS_SQL_TRUST_SERVER_CERTIFICATE: booleanFromEnv.default(true),
  SERVE_FRONTEND: disabledBooleanFromEnv,
  FRONTEND_DIST_PATH: z.string().optional().default('frontend/dist')
});

export type SqlDbConfig = {
  server: string;
  port: number;
  database: string;
  user: string;
  password: string;
  encrypt: boolean;
  trustServerCertificate: boolean;
};

export type AppConfig = {
  port: number;
  nodeEnv: string;
  dryRun: boolean;
  existingGreApiUrl: string;
  existingGreApiToken: string;
  requestTimeoutMs: number;
  directDbInsertEnabled: boolean;
  remitente: {
    tipoDocumento: string;
    numeroDocumento: string;
    razonSocial: string;
    correo: string;
  };
  puntoPartida: {
    ubigeo: string;
    direccion: string;
  };
  serveFrontend: boolean;
  frontendDistPath: string;
  greFcDb: SqlDbConfig;
  ychiDb: SqlDbConfig;
  bizlinksDb: SqlDbConfig;
};

export function loadEnv(source: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = envSchema.parse(source);

  return {
    port: parsed.PORT,
    nodeEnv: parsed.NODE_ENV,
    dryRun: parsed.DRY_RUN,
    existingGreApiUrl: parsed.EXISTING_GRE_API_URL.replace(/\/$/, ''),
    existingGreApiToken: parsed.EXISTING_GRE_API_TOKEN,
    requestTimeoutMs: parsed.GRE_REQUEST_TIMEOUT_MS,
    directDbInsertEnabled: parsed.GRE_DIRECT_DB_INSERT_ENABLED,
    remitente: {
      tipoDocumento: parsed.GRE_REMITENTE_TIPO_DOCUMENTO,
      numeroDocumento: parsed.GRE_REMITENTE_NUMERO_DOCUMENTO,
      razonSocial: parsed.GRE_REMITENTE_RAZON_SOCIAL,
      correo: parsed.GRE_REMITENTE_CORREO
    },
    puntoPartida: {
      ubigeo: parsed.GRE_PARTIDA_UBIGEO,
      direccion: parsed.GRE_PARTIDA_DIRECCION
    },
    serveFrontend: parsed.SERVE_FRONTEND,
    frontendDistPath: parsed.FRONTEND_DIST_PATH,
    greFcDb: {
      server: parsed.GRE_FC_SQL_SERVER,
      port: parsed.GRE_FC_SQL_PORT,
      database: parsed.GRE_FC_SQL_DATABASE,
      user: parsed.GRE_FC_SQL_USER,
      password: parsed.GRE_FC_SQL_PASSWORD,
      encrypt: parsed.GRE_FC_SQL_ENCRYPT,
      trustServerCertificate: parsed.GRE_FC_SQL_TRUST_SERVER_CERTIFICATE
    },
    ychiDb: {
      server: parsed.YCHI_SQL_SERVER || parsed.YCHIDB3_SQL_SERVER,
      port: parsed.YCHI_SQL_SERVER ? parsed.YCHI_SQL_PORT : parsed.YCHIDB3_SQL_PORT,
      database: parsed.YCHI_SQL_DATABASE || parsed.YCHIDB3_SQL_DATABASE || 'YCHIDB3',
      user: parsed.YCHI_SQL_USER || parsed.YCHIDB3_SQL_USER,
      password: parsed.YCHI_SQL_PASSWORD || parsed.YCHIDB3_SQL_PASSWORD,
      encrypt: parsed.YCHI_SQL_SERVER ? parsed.YCHI_SQL_ENCRYPT : parsed.YCHIDB3_SQL_ENCRYPT,
      trustServerCertificate: parsed.YCHI_SQL_SERVER
        ? parsed.YCHI_SQL_TRUST_SERVER_CERTIFICATE
        : parsed.YCHIDB3_SQL_TRUST_SERVER_CERTIFICATE
    },
    bizlinksDb: {
      server: parsed.BIZLINKS_SQL_SERVER,
      port: parsed.BIZLINKS_SQL_PORT,
      database: parsed.BIZLINKS_SQL_DATABASE,
      user: parsed.BIZLINKS_SQL_USER,
      password: parsed.BIZLINKS_SQL_PASSWORD,
      encrypt: parsed.BIZLINKS_SQL_ENCRYPT,
      trustServerCertificate: parsed.BIZLINKS_SQL_TRUST_SERVER_CERTIFICATE
    }
  };
}
