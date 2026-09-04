import { Router } from 'express';
import { z } from 'zod';
import {
  AuthUserAlreadyExistsError,
  authModules,
  type AuthenticationService,
  type AuthSession
} from '../services/authService.js';

const createAccessSchema = z.object({
  displayName: z.string().trim().min(1).max(120),
  username: z.string().trim().toLowerCase().regex(/^[a-z0-9._-]{3,80}$/),
  password: z.string().min(8).max(128),
  modules: z.array(z.enum(authModules)).min(1)
});

export function adminAccessRoutes(service: AuthenticationService) {
  const router = Router();

  router.use('/api/admin', (_req, res, next) => {
    const session = res.locals.authUser as AuthSession | undefined;
    if (!session?.administrator) {
      res.status(403).json({
        error: 'ADMIN_FORBIDDEN',
        message: 'Solo el administrador puede gestionar accesos.'
      });
      return;
    }

    next();
  });

  router.get('/api/admin/accesses', async (_req, res) => {
    res.status(200).json({ ok: true, accesses: await service.listAccesses() });
  });

  router.post('/api/admin/accesses', async (req, res, next) => {
    const parsed = createAccessSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        error: 'VALIDATION_ERROR',
        message: 'Revise el nombre, usuario, contrasena y modulos seleccionados.',
        issues: parsed.error.issues
      });
      return;
    }

    const session = res.locals.authUser as AuthSession;

    try {
      const access = await service.createAccess(parsed.data, session.username);
      req.log?.info({
        auditEvent: 'access_created',
        actor: session.username,
        targetUsername: access.username,
        modules: access.modules
      }, 'administrative access created');
      res.status(201).json({ ok: true, access });
    } catch (error) {
      if (error instanceof AuthUserAlreadyExistsError) {
        res.status(409).json({ error: 'ACCESS_ALREADY_EXISTS', message: error.message });
        return;
      }
      next(error);
    }
  });

  return router;
}
