import { Router } from 'express';
import type { AppConfig } from '../config/env.js';
import { AUTH_COOKIE_NAME } from '../middleware/auth.js';
import type { AuthenticationService } from '../services/authService.js';

const loginAttempts = new Map<string, { count: number; resetAt: number }>();
const maxAttempts = 6;
const attemptWindowMs = 15 * 60 * 1000;

export function authRoutes(config: AppConfig, service: AuthenticationService) {
  const router = Router();

  router.get('/api/auth/me', async (req, res) => {
    if (!service.enabled) {
      res.status(200).json({
        ok: true,
        authEnabled: false,
        user: {
          username: 'desarrollo',
          displayName: 'Desarrollo local',
          modules: ['fc', 'flexo', 'traslado'],
          administrator: false
        }
      });
      return;
    }

    const token = readSessionCookie(req.headers.cookie);
    const session = token ? await service.verifySession(token) : null;
    if (!session) {
      res.status(401).json({ error: 'AUTH_REQUIRED', message: 'Ingrese al sistema.' });
      return;
    }

    res.status(200).json({ ok: true, authEnabled: true, user: publicUser(session) });
  });

  router.post('/api/auth/login', async (req, res) => {
    if (!service.enabled) {
      res.status(400).json({ error: 'AUTH_DISABLED', message: 'El acceso no esta habilitado.' });
      return;
    }

    const clientKey = req.ip || req.socket.remoteAddress || 'unknown';
    const attempt = currentAttempt(clientKey);
    if (attempt.count >= maxAttempts) {
      res.status(429).json({
        error: 'LOGIN_RATE_LIMITED',
        message: 'Demasiados intentos. Espere 15 minutos antes de volver a intentar.'
      });
      return;
    }

    const username = typeof req.body?.username === 'string' ? req.body.username : '';
    const password = typeof req.body?.password === 'string' ? req.body.password : '';
    const user = await service.authenticate(username, password, {
      ip: req.ip || req.socket.remoteAddress,
      userAgent: req.get('user-agent')
    });

    if (!user) {
      loginAttempts.set(clientKey, { count: attempt.count + 1, resetAt: attempt.resetAt });
      res.status(401).json({ error: 'INVALID_CREDENTIALS', message: 'Usuario o contrasena incorrectos.' });
      return;
    }

    loginAttempts.delete(clientKey);
    const { token, session } = service.createSession(user);
    res.cookie(AUTH_COOKIE_NAME, token, cookieOptions(config));
    res.status(200).json({ ok: true, authEnabled: true, user: publicUser(session) });
  });

  router.post('/api/auth/logout', (_req, res) => {
    res.clearCookie(AUTH_COOKIE_NAME, cookieOptions(config));
    res.status(200).json({ ok: true });
  });

  return router;
}

function currentAttempt(key: string) {
  const now = Date.now();
  const existing = loginAttempts.get(key);
  if (!existing || existing.resetAt <= now) {
    return { count: 0, resetAt: now + attemptWindowMs };
  }
  return existing;
}

function cookieOptions(config: AppConfig) {
  return {
    httpOnly: true,
    sameSite: 'strict' as const,
    secure: config.auth.cookieSecure,
    path: '/',
    maxAge: config.auth.sessionHours * 60 * 60 * 1000
  };
}

function publicUser(session: { username: string; displayName: string; modules: string[]; administrator: boolean }) {
  return {
    username: session.username,
    displayName: session.displayName,
    modules: session.modules,
    administrator: session.administrator
  };
}

function readSessionCookie(cookieHeader: string | undefined) {
  if (!cookieHeader) return null;
  const prefix = `${AUTH_COOKIE_NAME}=`;
  const part = cookieHeader.split(';').map((item) => item.trim()).find((item) => item.startsWith(prefix));
  if (!part) return null;

  try {
    return decodeURIComponent(part.slice(prefix.length));
  } catch {
    return null;
  }
}
