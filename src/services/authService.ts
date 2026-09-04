import { createHash, createHmac, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { z } from 'zod';
import type { AppConfig } from '../config/env.js';

export const authModules = ['fc', 'flexo', 'traslado'] as const;
export type AuthModule = typeof authModules[number];

const userRecordSchema = z.object({
  username: z.string().trim().min(1).max(80),
  displayName: z.string().trim().min(1).max(120),
  passwordHash: z.string().regex(/^scrypt\$[A-Za-z0-9_-]+\$[A-Za-z0-9_-]+$/),
  modules: z.array(z.enum(authModules)).min(1),
  active: z.boolean().default(true),
  administrator: z.boolean().default(false),
  createdAt: z.string().datetime().optional(),
  createdBy: z.string().trim().min(1).max(80).optional()
});

const usersFileSchema = z.object({
  users: z.array(userRecordSchema)
});

const sessionSchema = z.object({
  username: z.string().min(1),
  displayName: z.string().min(1),
  modules: z.array(z.enum(authModules)).min(1),
  administrator: z.boolean().default(false),
  credentialId: z.string().min(1),
  issuedAt: z.number().int(),
  expiresAt: z.number().int()
});

export type AuthUserRecord = z.infer<typeof userRecordSchema>;
export type AuthSession = z.infer<typeof sessionSchema>;
export type AuthAccessRecord = Omit<AuthUserRecord, 'passwordHash'>;
export type CreateAuthAccessInput = {
  username: string;
  displayName: string;
  password: string;
  modules: AuthModule[];
  administrator?: boolean;
};
export type UpdateAuthAccessInput = {
  displayName: string;
  password?: string;
  active: boolean;
  administrator: boolean;
};
export type AuthAttemptContext = { ip?: string; userAgent?: string };
type MaybePromise<T> = T | Promise<T>;

export class AuthUserAlreadyExistsError extends Error {}
export class AuthUserNotFoundError extends Error {}
export class AuthLastAdministratorError extends Error {}

export interface AuthenticationService {
  readonly enabled: boolean;
  authenticate(username: string, password: string, context?: AuthAttemptContext): MaybePromise<AuthUserRecord | null>;
  createSession(user: AuthUserRecord): { token: string; session: AuthSession };
  verifySession(token: string): MaybePromise<AuthSession | null>;
  listAccesses(): MaybePromise<AuthAccessRecord[]>;
  createAccess(input: CreateAuthAccessInput, actor: string): MaybePromise<AuthAccessRecord>;
  updateAccess(username: string, input: UpdateAuthAccessInput, actor: string): MaybePromise<AuthAccessRecord>;
}

export class FileAuthenticationService implements AuthenticationService {
  readonly enabled: boolean;
  private readonly users: Map<string, AuthUserRecord>;
  private readonly usersFile: string;

  constructor(private readonly config: AppConfig) {
    this.enabled = config.auth.enabled;
    this.usersFile = resolve(config.auth.usersFile);
    this.users = this.enabled ? loadUsers(this.usersFile) : new Map();
  }

  authenticate(username: string, password: string) {
    const normalized = normalizeUsername(username);
    const user = this.users.get(normalized);

    if (!user || !user.active || !verifyPassword(password, user.passwordHash)) {
      return null;
    }

    return user;
  }

  createSession(user: AuthUserRecord) {
    return createSignedSession(this.config, user);
  }

  verifySession(token: string) {
    const parsed = verifySignedSession(this.config, token);
    if (!parsed) return null;
    const user = this.users.get(normalizeUsername(parsed.username));
    if (!user || !user.active || parsed.credentialId !== passwordFingerprint(user.passwordHash)) return null;

    return {
      ...parsed,
      username: user.username,
      displayName: user.displayName,
      modules: user.modules,
      administrator: user.administrator
    };
  }

  listAccesses() {
    return [...this.users.values()]
      .map(toAccessRecord)
      .sort((left, right) => left.displayName.localeCompare(right.displayName, 'es'));
  }

  createAccess(input: CreateAuthAccessInput, actor: string) {
    const username = normalizeUsername(input.username);
    if (!/^[a-z0-9._-]{3,80}$/.test(username)) {
      throw new Error('El usuario debe tener entre 3 y 80 caracteres y usar letras, numeros, punto, guion o guion bajo.');
    }
    if (this.users.has(username)) throw new AuthUserAlreadyExistsError(`El usuario ${username} ya existe.`);

    const displayName = input.displayName.trim();
    if (!displayName || displayName.length > 120) throw new Error('Ingrese un nombre de hasta 120 caracteres.');
    const modules = [...new Set(input.modules)].filter((module): module is AuthModule => authModules.includes(module));
    if (modules.length === 0) throw new Error('Seleccione al menos un modulo.');

    const user = userRecordSchema.parse({
      username,
      displayName,
      passwordHash: hashPassword(input.password),
      modules,
      active: true,
      administrator: input.administrator ?? false,
      createdAt: new Date().toISOString(),
      createdBy: normalizeUsername(actor)
    });
    const nextUsers = new Map(this.users);
    nextUsers.set(username, user);
    persistUsers(this.usersFile, [...nextUsers.values()]);
    this.users.set(username, user);

    return toAccessRecord(user);
  }

  updateAccess(username: string, input: UpdateAuthAccessInput, actor: string) {
    const normalized = normalizeUsername(username);
    const existing = this.users.get(normalized);
    if (!existing) throw new AuthUserNotFoundError(`El usuario ${normalized} no existe.`);

    const displayName = input.displayName.trim();
    if (!displayName || displayName.length > 120) throw new Error('Ingrese un nombre de hasta 120 caracteres.');
    if (input.password && (input.password.length < 8 || input.password.length > 128)) {
      throw new Error('La contrasena debe tener entre 8 y 128 caracteres');
    }
    if ((existing.active && existing.administrator) && (!input.active || !input.administrator)) {
      const otherAdminExists = [...this.users.values()].some((user) =>
        normalizeUsername(user.username) !== normalized && user.active && user.administrator
      );
      if (!otherAdminExists) {
        throw new AuthLastAdministratorError('Debe quedar al menos un SuperAdmin activo.');
      }
    }

    const updated = userRecordSchema.parse({
      ...existing,
      displayName,
      passwordHash: input.password ? hashPassword(input.password) : existing.passwordHash,
      active: input.active,
      administrator: input.administrator,
      createdAt: existing.createdAt,
      createdBy: existing.createdBy
    });
    this.users.set(normalized, updated);
    persistUsers(this.usersFile, [...this.users.values()]);

    return toAccessRecord(updated);
  }
}

export function hashPassword(password: string) {
  if (password.length < 8 || password.length > 128) {
    throw new Error('La contrasena debe tener entre 8 y 128 caracteres');
  }

  const salt = randomBytes(16);
  const derivedKey = scryptSync(password, salt, 64);
  return `scrypt$${salt.toString('base64url')}$${derivedKey.toString('base64url')}`;
}

export function createSignedSession(config: AppConfig, user: AuthUserRecord) {
  const issuedAt = Math.floor(Date.now() / 1000);
  const session: AuthSession = {
    username: user.username,
    displayName: user.displayName,
    modules: [...new Set(user.modules)],
    administrator: user.administrator,
    credentialId: passwordFingerprint(user.passwordHash),
    issuedAt,
    expiresAt: issuedAt + config.auth.sessionHours * 60 * 60
  };
  const payload = Buffer.from(JSON.stringify(session)).toString('base64url');
  const signature = sign(payload, config.auth.sessionSecret);

  return { token: `${payload}.${signature}`, session };
}

export function verifySignedSession(config: AppConfig, token: string) {
  const [payload, signature, extra] = token.split('.');
  if (!payload || !signature || extra) return null;

  const expected = sign(payload, config.auth.sessionSecret);
  const receivedBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);
  if (receivedBuffer.length !== expectedBuffer.length || !timingSafeEqual(receivedBuffer, expectedBuffer)) return null;

  try {
    const parsed = sessionSchema.parse(JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')));
    return parsed.expiresAt > Math.floor(Date.now() / 1000) ? parsed : null;
  } catch {
    return null;
  }
}

export function verifyPassword(password: string, storedHash: string) {
  const [algorithm, saltValue, hashValue, extra] = storedHash.split('$');
  if (algorithm !== 'scrypt' || !saltValue || !hashValue || extra) return false;

  try {
    const expected = Buffer.from(hashValue, 'base64url');
    const actual = scryptSync(password, Buffer.from(saltValue, 'base64url'), expected.length);
    return actual.length === expected.length && timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

function loadUsers(usersFile: string) {
  const absolutePath = resolve(usersFile);
  let contents: string;

  try {
    contents = readFileSync(absolutePath, 'utf8');
  } catch {
    throw new Error(`AUTH_ENABLED=true pero no se pudo leer el archivo de usuarios: ${absolutePath}`);
  }

  const parsed = usersFileSchema.parse(JSON.parse(contents));
  const users = new Map<string, AuthUserRecord>();

  for (const user of parsed.users) {
    const key = normalizeUsername(user.username);
    if (users.has(key)) {
      throw new Error(`Usuario de acceso duplicado: ${user.username}`);
    }
    users.set(key, { ...user, username: key });
  }

  if (users.size === 0) {
    throw new Error('AUTH_ENABLED=true pero no hay usuarios configurados');
  }
  if (![...users.values()].some((user) => user.active)) {
    throw new Error('AUTH_ENABLED=true pero no hay usuarios activos configurados');
  }

  return users;
}

function persistUsers(usersFile: string, users: AuthUserRecord[]) {
  mkdirSync(dirname(usersFile), { recursive: true });
  const temporaryFile = `${usersFile}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(temporaryFile, `${JSON.stringify({ users }, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  renameSync(temporaryFile, usersFile);
}

function toAccessRecord(user: AuthUserRecord): AuthAccessRecord {
  const { passwordHash: _passwordHash, ...access } = user;
  return { ...access, modules: [...access.modules] };
}

function normalizeUsername(value: string) {
  return value.trim().toLowerCase();
}

function sign(payload: string, secret: string) {
  return createHmac('sha256', secret).update(payload).digest('base64url');
}

export function passwordFingerprint(passwordHash: string) {
  return createHash('sha256').update(passwordHash).digest('base64url').slice(0, 22);
}
