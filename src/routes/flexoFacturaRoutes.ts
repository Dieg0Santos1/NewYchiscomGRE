import { Router } from 'express';
import type { AppConfig } from '../config/env.js';
import { flexoFacturaPreviewSchema } from '../schemas/flexoFacturaSchema.js';
import { DirectDbFlexoFacturaService, type FlexoFacturaService } from '../services/flexoFacturaService.js';
import { sanitizeValue, validationIssues } from '../utils/sanitize.js';

export function flexoFacturaRoutes(
  config: AppConfig,
  service: FlexoFacturaService = new DirectDbFlexoFacturaService(config)
) {
  const router = Router();

  router.get('/api/flexo-facturas/clientes/search', async (req, res, next) => {
    try {
      const query = String(req.query.q ?? '').trim();
      res.status(200).json({
        ok: true,
        clientes: await service.searchClientes(query)
      });
    } catch (error) {
      next(error);
    }
  });

  router.get('/api/flexo-facturas/next-serie', async (_req, res, next) => {
    try {
      res.status(200).json({
        ok: true,
        ...await service.getNextSerie()
      });
    } catch (error) {
      next(error);
    }
  });

  router.get('/api/flexo-facturas/catalogos/cuentas', async (_req, res, next) => {
    try {
      res.status(200).json({
        ok: true,
        ...await service.listCuentas()
      });
    } catch (error) {
      next(error);
    }
  });

  router.get('/api/flexo-facturas/catalogos/formas-pago', async (_req, res, next) => {
    try {
      res.status(200).json({
        ok: true,
        formasPago: await service.listFormasPago()
      });
    } catch (error) {
      next(error);
    }
  });

  router.get('/api/flexo-facturas/guias-pendientes', async (req, res, next) => {
    try {
      const numeroDocumento = String(req.query.numeroDocumento ?? '').trim();

      if (!numeroDocumento) {
        res.status(400).json({
          error: 'NUMERO_DOCUMENTO_REQUIRED',
          message: 'numeroDocumento es requerido'
        });
        return;
      }

      res.status(200).json({
        ok: true,
        ...await service.listGuiasPendientes(numeroDocumento)
      });
    } catch (error) {
      next(error);
    }
  });

  router.post('/api/flexo-facturas/preview', async (req, res, next) => {
    try {
      const parsed = flexoFacturaPreviewSchema.safeParse(req.body);

      if (!parsed.success) {
        res.status(400).json({
          error: 'VALIDATION_ERROR',
          issues: validationIssues(parsed.error)
        });
        return;
      }

      res.status(200).json({
        ok: true,
        ...sanitizeValue(await service.preview(parsed.data), [
          config.existingGreApiToken,
          config.greFcDb.password,
          config.ychiDb.password,
          config.bizlinksDb.password
        ]) as Record<string, unknown>
      });
    } catch (error) {
      next(error);
    }
  });

  router.post('/api/flexo-facturas/declarar-test', (_req, res) => {
    res.status(403).json({
      error: 'FLEXO_FACTURA_DECLARACION_BLOCKED',
      message: 'La declaracion de facturas Flexo esta bloqueada hasta completar auditoria del contrato Bizlinks.'
    });
  });

  return router;
}
