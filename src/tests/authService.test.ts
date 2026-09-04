import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { FileAuthenticationService, hashPassword } from '../services/authService.js';
import { testConfig } from './fixtures.js';

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe('servicio de autenticacion', () => {
  it('valida hash, firma la sesion y rechaza tokens alterados', () => {
    const password = 'ClaveTemporal-Segura-2026';
    const service = createService(hashPassword(password));
    const user = service.authenticate('MARY', password);

    expect(user?.modules).toEqual(['traslado']);
    expect(service.authenticate('mary', 'incorrecta')).toBeNull();

    const token = service.createSession(user!).token;
    expect(service.verifySession(token)?.username).toBe('mary');
    expect(service.verifySession(`${token}alterado`)).toBeNull();
  });

  it('invalida una sesion cuando se renueva la clave', () => {
    const oldService = createService(hashPassword('Clave-Original-2026'));
    const user = oldService.authenticate('mary', 'Clave-Original-2026');
    const token = oldService.createSession(user!).token;
    const renewedService = createService(hashPassword('Clave-Renovada-2026'));

    expect(renewedService.verifySession(token)).toBeNull();
  });
});

function createService(passwordHash: string) {
  const directory = mkdtempSync(join(tmpdir(), 'gre-auth-test-'));
  temporaryDirectories.push(directory);
  const usersFile = join(directory, 'users.json');
  writeFileSync(usersFile, JSON.stringify({
    users: [{
      username: 'mary',
      displayName: 'Mary',
      passwordHash,
      modules: ['traslado'],
      active: true
    }]
  }));

  return new FileAuthenticationService({
    ...testConfig,
    auth: {
      enabled: true,
      sessionSecret: 'test-session-secret-with-at-least-32-characters',
      usersFile,
      sessionHours: 12,
      cookieSecure: false
    }
  });
}
