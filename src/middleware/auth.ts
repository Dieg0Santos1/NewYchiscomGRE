import type { NextFunction, Request, Response } from 'express';
import type { AppConfig } from '../config/env.js';
import type { AuthModule, AuthenticationService, AuthSession } from '../services/authService.js';

export const AUTH_COOKIE_NAME = 'gre_session';

export function authenticateRequests(service: AuthenticationService) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!service.enabled || !req.path.startsWith('/api/')) {
      next();
      return;
    }

    const token = readCookie(req, AUTH_COOKIE_NAME);
    const session = token ? service.verifySession(token) : null;
    if (!session) {
      res.status(401).json({
        error: 'AUTH_REQUIRED',
        message: 'La sesion no existe o ha vencido. Ingrese nuevamente.'
      });
      return;
    }

    res.locals.authUser = session;
    req.headers['x-user'] = session.username;
    next();
  };
}

export function authorizeApiModules(config: AppConfig) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!config.auth.enabled || !req.path.startsWith('/api/')) {
      next();
      return;
    }

    const session = res.locals.authUser as AuthSession | undefined;
    const allowedModules = modulesForRequest(req);
    if (!session || !allowedModules.some((module) => session.modules.includes(module))) {
      res.status(403).json({
        error: 'MODULE_FORBIDDEN',
        message: 'Su cuenta no tiene acceso a este modulo.'
      });
      return;
    }

    next();
  };
}

function modulesForRequest(req: Request): AuthModule[] {
  const path = req.path;

  if (path.startsWith('/api/gre-traslados')) return ['traslado'];
  if (path.startsWith('/api/flexo-facturas') || path.startsWith('/api/flexo/')) return ['flexo'];
  if (req.method === 'GET' && path === '/api/fc-facturas/clientes/search') return ['fc', 'traslado'];
  if (path.startsWith('/api/catalogos/')) return ['fc', 'traslado'];
  if (
    path.startsWith('/api/fc-facturas')
    || path.startsWith('/api/fc-legacy')
    || path.startsWith('/api/gre-formularios')
    || path.startsWith('/api/gre/')
    || path.startsWith('/api/reportes-especiales')
  ) {
    return ['fc'];
  }

  return [];
}

function readCookie(req: Request, name: string) {
  const cookieHeader = req.headers.cookie;
  if (!cookieHeader) return null;

  for (const part of cookieHeader.split(';')) {
    const separator = part.indexOf('=');
    if (separator < 0) continue;
    const key = part.slice(0, separator).trim();
    if (key !== name) continue;

    try {
      return decodeURIComponent(part.slice(separator + 1).trim());
    } catch {
      return null;
    }
  }

  return null;
}
