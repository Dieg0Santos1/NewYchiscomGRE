import express from 'express';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';
import { afterEach, describe, expect, it } from 'vitest';
import { authenticateRequests } from '../middleware/auth.js';
import { adminAccessRoutes } from '../routes/adminAccessRoutes.js';
import { authRoutes } from '../routes/authRoutes.js';
import { FileAuthenticationService, hashPassword } from '../services/authService.js';
import { testConfig } from './fixtures.js';

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe('administracion de accesos', () => {
  it('solo permite listar accesos al administrador y nunca expone hashes', async () => {
    const { app } = createAdminApp();
    const adminCookie = await login(app, 'superadmin', 'Admin-Test$2026');
    const userCookie = await login(app, 'mary', 'ClaveMary$');

    await request(app)
      .get('/api/admin/accesses')
      .set('Cookie', userCookie)
      .expect(403)
      .expect((response) => expect(response.body.error).toBe('ADMIN_FORBIDDEN'));

    await request(app)
      .get('/api/admin/accesses')
      .set('Cookie', adminCookie)
      .expect(200)
      .expect((response) => {
        expect(response.body.accesses).toHaveLength(2);
        expect(JSON.stringify(response.body)).not.toContain('passwordHash');
      });
  });

  it('crea una credencial permanente, trazable y utilizable inmediatamente', async () => {
    const { app, usersFile, service } = createAdminApp();
    const adminCookie = await login(app, 'superadmin', 'Admin-Test$2026');

    await request(app)
      .post('/api/admin/accesses')
      .set('Cookie', adminCookie)
      .send({
        displayName: 'Usuario Contabilidad',
        username: 'contabilidad',
        password: 'ClaveContable$2026',
        modules: ['fc', 'traslado']
      })
      .expect(201)
      .expect((response) => {
        expect(response.body.access).toMatchObject({
          username: 'contabilidad',
          modules: ['fc', 'traslado'],
          administrator: false,
          createdBy: 'superadmin'
        });
        expect(response.body.access).not.toHaveProperty('passwordHash');
      });

    expect(service.authenticate('contabilidad', 'ClaveContable$2026')).not.toBeNull();
    const stored = JSON.parse(readFileSync(usersFile, 'utf8')) as { users: Array<Record<string, unknown>> };
    expect(stored.users.find((user) => user.username === 'contabilidad')).toMatchObject({
      active: true,
      administrator: false,
      createdBy: 'superadmin'
    });
    expect(JSON.stringify(stored)).not.toContain('ClaveContable$2026');
  });

  it('rechaza usuarios duplicados', async () => {
    const { app } = createAdminApp();
    const adminCookie = await login(app, 'superadmin', 'Admin-Test$2026');

    await request(app)
      .post('/api/admin/accesses')
      .set('Cookie', adminCookie)
      .send({ displayName: 'Mary duplicada', username: 'MARY', password: 'OtraClave$2026', modules: ['traslado'] })
      .expect(409)
      .expect((response) => expect(response.body.error).toBe('ACCESS_ALREADY_EXISTS'));
  });
});

function createAdminApp() {
  const directory = mkdtempSync(join(tmpdir(), 'gre-admin-test-'));
  temporaryDirectories.push(directory);
  const usersFile = join(directory, 'users.json');
  writeFileSync(usersFile, JSON.stringify({
    users: [
      {
        username: 'superadmin',
        displayName: 'SuperAdmin',
        passwordHash: hashPassword('Admin-Test$2026'),
        modules: ['fc', 'flexo', 'traslado'],
        active: true,
        administrator: true
      },
      {
        username: 'mary',
        displayName: 'Mary',
        passwordHash: hashPassword('ClaveMary$'),
        modules: ['traslado'],
        active: true,
        administrator: false
      }
    ]
  }));

  const config = {
    ...testConfig,
    auth: {
      enabled: true,
      sessionSecret: 'test-session-secret-with-at-least-32-characters',
      usersFile,
      sessionHours: 12,
      cookieSecure: false
    }
  };
  const service = new FileAuthenticationService(config);
  const app = express();
  app.use(express.json());
  app.use(authRoutes(config, service));
  app.use(authenticateRequests(service));
  app.use(adminAccessRoutes(service));

  return { app, usersFile, service };
}

async function login(app: express.Express, username: string, password: string) {
  const response = await request(app).post('/api/auth/login').send({ username, password }).expect(200);
  return String(response.headers['set-cookie']?.[0] ?? '');
}
