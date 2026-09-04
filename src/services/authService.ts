import { createHash, createHmac, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { z } from 'zod';
import type { AppConfig } from '../config/env.js';

export const authModules = ['fc', 'flexo', 'traslado'] as const;
export type AuthModule = typeof authModules[number];

const userRecordSchema = z.object({
  username: z.string().trim().min(1).max(80),
  displayName: z.string().trim().min(1).max(120),
  passwordHash: z.string().regex(/^scrypt\$[A-Za-z0-9_-]+\$[A-Za-z0-9_-]+$/),
  modules: z.array(z.enum(authModules)).min(1),
  active: z.boolean().default(true)
});

const usersFileSchema = z.object({
  users: z.array(userRecordSchema)
});

const sessionSchema = z.object({
  username: z.string().min(1),
  displayName: z.string().min(1),
  modules: z.array(z.enum(authModules)).min(1),
  credentialId: z.string().min(1),
  issuedAt: z.number().int(),
  expiresAt: z.number().int()
});

export type AuthUserRecord = z.infer<typeof userRecordSchema>;
export type AuthSession = z.infer<typeof sessionSchema>;

export interface AuthenticationService {
  readonly enabled: boolean;
  authenticate(username: string, password: string): AuthUserRecord | null;
  createSession(user: AuthUserRecord): { token: string; session: AuthSession };
  verifySession(token: string): AuthSession | null;
}

export class FileAuthenticationService implements AuthenticationService {
  readonly enabled: boolean;
  private readonly users: Map<string, AuthUserRecord>;

  constructor(private readonly config: AppConfig) {
    this.enabled = config.auth.enabled;
    this.users = this.enabled ? loadUsers(config.auth.usersFile) : new Map();
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
    const issuedAt = Math.floor(Date.now() / 1000);
    const session: AuthSession = {
      username: user.username,
      displayName: user.displayName,
      modules: [...new Set(user.modules)],
      credentialId: passwordFingerprint(user.passwordHash),
      issuedAt,
      expiresAt: issuedAt + this.config.auth.sessionHours * 60 * 60
    };
    const payload = Buffer.from(JSON.stringify(session)).toString('base64url');
    const signature = sign(payload, this.config.auth.sessionSecret);

    return { token: `${payload}.${signature}`, session };
  }

  verifySession(token: string) {
    const [payload, signature, extra] = token.split('.');
    if (!payload || !signature || extra) return null;

    const expected = sign(payload, this.config.auth.sessionSecret);
    const receivedBuffer = Buffer.from(signature);
    const expectedBuffer = Buffer.from(expected);
    if (receivedBuffer.length !== expectedBuffer.length || !timingSafeEqual(receivedBuffer, expectedBuffer)) {
      return null;
    }

    try {
      const parsed = sessionSchema.parse(JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')));
      const user = this.users.get(normalizeUsername(parsed.username));
      if (
        !user
        || !user.active
        || parsed.credentialId !== passwordFingerprint(user.passwordHash)
        || parsed.expiresAt <= Math.floor(Date.now() / 1000)
      ) return null;

      return {
        ...parsed,
        username: user.username,
        displayName: user.displayName,
        modules: user.modules
      };
    } catch {
      return null;
    }
  }
}

export function hashPassword(password: string) {
  if (password.length < 12) {
    throw new Error('La contrasena debe tener al menos 12 caracteres');
  }

  const salt = randomBytes(16);
  const derivedKey = scryptSync(password, salt, 64);
  return `scrypt$${salt.toString('base64url')}$${derivedKey.toString('base64url')}`;
}

function verifyPassword(password: string, storedHash: string) {
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

function normalizeUsername(value: string) {
  return value.trim().toLowerCase();
}

function sign(payload: string, secret: string) {
  return createHmac('sha256', secret).update(payload).digest('base64url');
}

function passwordFingerprint(passwordHash: string) {
  return createHash('sha256').update(passwordHash).digest('base64url').slice(0, 22);
}
