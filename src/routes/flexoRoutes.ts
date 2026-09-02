import { Router } from 'express';
import type { AppConfig } from '../config/env.js';
import { DirectDbFlexoService, type FlexoService } from '../services/flexoService.js';
import { sanitizeValue } from '../utils/sanitize.js';

export function flexoRoutes(config: AppConfig, service: FlexoService = new DirectDbFlexoService(config)) {
  const router = Router();

  router.get('/api/flexo/clientes/search', async (req, res, next) => {
    try {
      const q = String(req.query.q ?? '');
      res.status(200).json({
        ok: true,
        clientes: await service.searchClientes(q)
      });
    } catch (error) {
      next(error);
    }
  });

  router.get('/api/flexo/clientes/:numeroDocumento/destinos', async (req, res, next) => {
    try {
      const numeroDocumento = String(req.params.numeroDocumento ?? '');
      res.status(200).json({
        ok: true,
        destinos: await service.listDestinos(numeroDocumento)
      });
    } catch (error) {
      next(error);
    }
  });

  router.get('/api/flexo/empaques', async (req, res, next) => {
    try {
      const numeroDocumento = String(req.query.numeroDocumento ?? '');
      const today = new Date().toISOString().slice(0, 10);

      res.status(200).json({
        ok: true,
        empaques: await service.listEmpaques({
          numeroDocumento,
          desde: String(req.query.desde ?? today),
          hasta: String(req.query.hasta ?? today),
          filtro: String(req.query.filtro ?? '')
        })
      });
    } catch (error) {
      next(error);
    }
  });

  router.get('/api/flexo/guias/next-serie', async (req, res, next) => {
    try {
      const serie = String(req.query.serie ?? 'T003').trim().toUpperCase();
      if (serie !== 'T003' && serie !== 'T999') {
        res.status(400).json({
          ok: false,
          message: 'Serie Flexo no permitida. Use T003 o T999.'
        });
        return;
      }

      res.status(200).json({
        ok: true,
        ...await service.getNextSerie(serie)
      });
    } catch (error) {
      next(error);
    }
  });

  router.post('/api/flexo/guias/preview', async (req, res, next) => {
    try {
      res.status(200).json({
        ok: true,
        ...sanitizeValue(await service.previewGuia(req.body), [
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

  return router;
}
