import express from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { authenticateRequests, authorizeApiModules } from '../middleware/auth.js';
import { authRoutes } from '../routes/authRoutes.js';
import type { AuthenticationService, AuthSession, AuthUserRecord } from '../services/authService.js';
import { testConfig } from './fixtures.js';

const mary: AuthUserRecord = {
  username: 'mary',
  displayName: 'Mary',
  passwordHash: 'hash-no-usado-en-mock',
  modules: ['traslado'],
  active: true,
  administrator: false
};

const session: AuthSession = {
  username: mary.username,
  displayName: mary.displayName,
  modules: mary.modules,
  administrator: false,
  credentialId: 'credencial-prueba',
  issuedAt: 1,
  expiresAt: 4_000_000_000
};

function createProtectedApp() {
  const config = {
    ...testConfig,
    auth: {
      ...testConfig.auth,
      enabled: true,
      sessionSecret: 'test-session-secret-with-at-least-32-characters'
    }
  };
  const service: AuthenticationService = {
    enabled: true,
    authenticate: vi.fn((username, password) => username === 'mary' && password === 'correcta' ? mary : null),
    createSession: vi.fn(() => ({ token: 'token-valido', session })),
    verifySession: vi.fn((token) => token === 'token-valido' ? session : null),
    listAccesses: vi.fn(() => []),
    createAccess: vi.fn()
  };
  const app = express();
  app.use(express.json());
  app.use(authRoutes(config, service));
  app.use(authenticateRequests(service));
  app.use(authorizeApiModules(config));
  app.get('/api/gre-traslados/test', (req, res) => res.json({ ok: true, user: req.get('X-User') }));
  app.get('/api/gre-formularios/guides', (_req, res) => res.json({ ok: true }));

  return app;
}

describe('autenticacion y permisos por modulo', () => {
  it('requiere sesion para las API protegidas', async () => {
    await request(createProtectedApp())
      .get('/api/gre-traslados/test')
      .expect(401)
      .expect((response) => expect(response.body.error).toBe('AUTH_REQUIRED'));
  });

  it('inicia sesion con cookie HttpOnly y SameSite Strict', async () => {
    await request(createProtectedApp())
      .post('/api/auth/login')
      .send({ username: 'mary', password: 'correcta' })
      .expect(200)
      .expect((response) => {
        const cookie = String(response.headers['set-cookie']?.[0] ?? '');
        expect(cookie).toContain('gre_session=token-valido');
        expect(cookie).toContain('HttpOnly');
        expect(cookie).toContain('SameSite=Strict');
        expect(response.body.user.modules).toEqual(['traslado']);
      });
  });

  it('permite Guia 2, bloquea FC y fija la identidad trazable', async () => {
    const app = createProtectedApp();

    await request(app)
      .get('/api/gre-traslados/test')
      .set('Cookie', 'gre_session=token-valido')
      .set('X-User', 'usuario-falsificado')
      .expect(200)
      .expect((response) => expect(response.body.user).toBe('mary'));

    await request(app)
      .get('/api/gre-formularios/guides')
      .set('Cookie', 'gre_session=token-valido')
      .expect(403)
      .expect((response) => expect(response.body.error).toBe('MODULE_FORBIDDEN'));
  });
});
