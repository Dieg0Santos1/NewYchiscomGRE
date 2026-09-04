import type { AppConfig } from '../config/env.js';
import { createGreFcPool, sql } from '../integrations/bizlinksSql.js';
import {
  AuthUserAlreadyExistsError,
  authModules,
  createSignedSession,
  hashPassword,
  verifyPassword,
  verifySignedSession,
  type AuthAccessRecord,
  type AuthenticationService,
  type AuthAttemptContext,
  type AuthModule,
  type AuthUserRecord,
  type CreateAuthAccessInput
} from './authService.js';

type UserRow = {
  idUsuario: number;
  username: string;
  displayName: string;
  passwordHash: string;
  administrator: boolean;
  active: boolean;
  createdAt: Date | null;
  createdBy: string | null;
  module: string | null;
};

export class SqlAuthenticationService implements AuthenticationService {
  readonly enabled: boolean;

  constructor(private readonly config: AppConfig) {
    this.enabled = config.auth.enabled;
  }

  async authenticate(username: string, password: string, context?: AuthAttemptContext) {
    const normalized = normalizeUsername(username);
    const pool = createGreFcPool(this.config);
    await pool.connect();

    try {
      const request = new sql.Request(pool);
      request.input('username', sql.VarChar(80), normalized);
      const result = await request.query<UserRow>(`
        SELECT
          u.idUsuario,
          u.usuario AS username,
          u.nombre AS displayName,
          u.passwordHash,
          u.esAdministrador AS administrator,
          u.activo AS active,
          u.creadoEn AS createdAt,
          u.creadoPor AS createdBy,
          m.modulo
        FROM dbo.GRE_PORTAL_USUARIO u
        LEFT JOIN dbo.GRE_PORTAL_USUARIO_MODULO m ON m.idUsuario = u.idUsuario
        WHERE u.usuario = @username
        ORDER BY m.modulo;
      `);
      const user = rowsToUsers(result.recordset)[0] ?? null;
      const authenticated = Boolean(user?.active && verifyPassword(password, user.passwordHash));

      await insertAudit(pool, {
        eventType: authenticated ? 'LOGIN_OK' : 'LOGIN_FALLIDO',
        actor: authenticated ? user!.username : null,
        target: normalized || '(vacio)',
        success: authenticated,
        ip: context?.ip,
        userAgent: context?.userAgent,
        detail: authenticated ? 'Inicio de sesion correcto.' : 'Usuario o contrasena incorrectos.'
      });

      return authenticated ? user : null;
    } finally {
      await pool.close();
    }
  }

  createSession(user: AuthUserRecord) {
    return createSignedSession(this.config, user);
  }

  verifySession(token: string) {
    return verifySignedSession(this.config, token);
  }

  async listAccesses() {
    const pool = createGreFcPool(this.config);
    await pool.connect();

    try {
      const result = await new sql.Request(pool).query<UserRow>(`
        SELECT
          u.idUsuario,
          u.usuario AS username,
          u.nombre AS displayName,
          u.passwordHash,
          u.esAdministrador AS administrator,
          u.activo AS active,
          u.creadoEn AS createdAt,
          u.creadoPor AS createdBy,
          m.modulo
        FROM dbo.GRE_PORTAL_USUARIO u
        LEFT JOIN dbo.GRE_PORTAL_USUARIO_MODULO m ON m.idUsuario = u.idUsuario
        ORDER BY u.nombre, u.usuario, m.modulo;
      `);

      return rowsToUsers(result.recordset).map(toAccessRecord);
    } finally {
      await pool.close();
    }
  }

  async createAccess(input: CreateAuthAccessInput, actor: string) {
    const username = normalizeUsername(input.username);
    const displayName = input.displayName.trim();
    const modules = [...new Set(input.modules)].filter((module): module is AuthModule => authModules.includes(module));
    if (!/^[a-z0-9._-]{3,80}$/.test(username)) throw new Error('Nombre de usuario invalido.');
    if (!displayName || displayName.length > 120) throw new Error('Nombre visible invalido.');
    if (modules.length === 0) throw new Error('Seleccione al menos un modulo.');

    const passwordHash = hashPassword(input.password);
    const normalizedActor = normalizeUsername(actor);
    const pool = createGreFcPool(this.config);
    await pool.connect();
    const transaction = new sql.Transaction(pool);
    await transaction.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);

    try {
      const duplicateRequest = new sql.Request(transaction);
      duplicateRequest.input('username', sql.VarChar(80), username);
      const duplicate = await duplicateRequest.query<{ total: number }>(`
        SELECT COUNT(1) AS total
        FROM dbo.GRE_PORTAL_USUARIO WITH (UPDLOCK, HOLDLOCK)
        WHERE usuario = @username;
      `);
      if ((duplicate.recordset[0]?.total ?? 0) > 0) {
        throw new AuthUserAlreadyExistsError(`El usuario ${username} ya existe.`);
      }

      const userRequest = new sql.Request(transaction);
      userRequest.input('username', sql.VarChar(80), username);
      userRequest.input('displayName', sql.NVarChar(120), displayName);
      userRequest.input('passwordHash', sql.VarChar(300), passwordHash);
      userRequest.input('administrator', sql.Bit, input.administrator ?? false);
      userRequest.input('actor', sql.VarChar(80), normalizedActor);
      const inserted = await userRequest.query<{ idUsuario: number; createdAt: Date }>(`
        INSERT INTO dbo.GRE_PORTAL_USUARIO
          (usuario, nombre, passwordHash, esAdministrador, activo, creadoPor)
        OUTPUT INSERTED.idUsuario, INSERTED.creadoEn AS createdAt
        VALUES
          (@username, @displayName, @passwordHash, @administrator, 1, @actor);
      `);
      const idUsuario = inserted.recordset[0]!.idUsuario;
      const createdAt = inserted.recordset[0]!.createdAt;

      for (const module of modules) {
        const moduleRequest = new sql.Request(transaction);
        moduleRequest.input('idUsuario', sql.Int, idUsuario);
        moduleRequest.input('module', sql.VarChar(20), module);
        moduleRequest.input('actor', sql.VarChar(80), normalizedActor);
        await moduleRequest.query(`
          INSERT INTO dbo.GRE_PORTAL_USUARIO_MODULO (idUsuario, modulo, asignadoPor)
          VALUES (@idUsuario, @module, @actor);
        `);
      }

      await insertAudit(transaction, {
        eventType: 'USUARIO_CREADO',
        actor: normalizedActor,
        target: username,
        success: true,
        detail: `Modulos: ${modules.join(',')}; administrador: ${input.administrator ? 'si' : 'no'}.`
      });
      await transaction.commit();

      return {
        username,
        displayName,
        modules,
        active: true,
        administrator: input.administrator ?? false,
        createdAt: createdAt.toISOString(),
        createdBy: normalizedActor
      };
    } catch (error) {
      await transaction.rollback().catch(() => undefined);
      throw error;
    } finally {
      await pool.close();
    }
  }
}

function rowsToUsers(rows: UserRow[]) {
  const users = new Map<number, AuthUserRecord>();

  for (const row of rows) {
    const existing = users.get(row.idUsuario);
    const module = authModules.find((item) => item === row.module);
    if (existing) {
      if (module && !existing.modules.includes(module)) existing.modules.push(module);
      continue;
    }

    users.set(row.idUsuario, {
      username: row.username,
      displayName: row.displayName,
      passwordHash: row.passwordHash,
      modules: module ? [module] : [],
      active: Boolean(row.active),
      administrator: Boolean(row.administrator),
      createdAt: row.createdAt?.toISOString(),
      createdBy: row.createdBy ?? undefined
    });
  }

  return [...users.values()].filter((user) => user.modules.length > 0);
}

function toAccessRecord(user: AuthUserRecord): AuthAccessRecord {
  const { passwordHash: _passwordHash, ...access } = user;
  return access;
}

async function insertAudit(pool: sql.ConnectionPool | sql.Transaction, event: {
  eventType: string;
  actor: string | null;
  target: string;
  success: boolean;
  ip?: string;
  userAgent?: string;
  detail: string;
}) {
  const request = pool instanceof sql.Transaction ? new sql.Request(pool) : new sql.Request(pool);
  request.input('eventType', sql.VarChar(40), event.eventType);
  request.input('actor', sql.VarChar(80), event.actor);
  request.input('target', sql.VarChar(80), event.target);
  request.input('success', sql.Bit, event.success);
  request.input('ip', sql.VarChar(64), event.ip?.slice(0, 64) || null);
  request.input('userAgent', sql.NVarChar(400), event.userAgent?.slice(0, 400) || null);
  request.input('detail', sql.NVarChar(500), event.detail);
  await request.query(`
    INSERT INTO dbo.GRE_PORTAL_ACCESO_EVENTO
      (tipoEvento, actorUsuario, usuarioObjetivo, exitoso, ip, userAgent, detalle)
    VALUES
      (@eventType, @actor, @target, @success, @ip, @userAgent, @detail);
  `);
}

function normalizeUsername(value: string) {
  return value.trim().toLowerCase();
}
