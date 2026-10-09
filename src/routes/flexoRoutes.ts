import { Router } from 'express';
import type { AppConfig } from '../config/env.js';
import { DirectDbFlexoService, type FlexoService } from '../services/flexoService.js';
import { sanitizeValue } from '../utils/sanitize.js';

export function flexoRoutes(config: AppConfig, service: FlexoService = new DirectDbFlexoService(config)) {
  const router = Router();

  router.get('/api/flexo/catalogos', async (_req, res, next) => {
    try {
      res.status(200).json({
        ok: true,
        ...await service.listCatalogs()
      });
    } catch (error) {
      next(error);
    }
  });

  router.get('/api/flexo/reportes', async (_req, res, next) => {
    try {
      res.status(200).json({
        ok: true,
        ...await service.listReports()
      });
    } catch (error) {
      next(error);
    }
  });

  router.get('/api/flexo/guias/:serieNumeroGuia/pdf', async (req, res, next) => {
    try {
      const serieNumeroGuia = String(req.params.serieNumeroGuia ?? '').trim().toUpperCase();

      if (!/^T(?:003|999)-\d{8}$/.test(serieNumeroGuia)) {
        res.status(400).json({
          error: 'SERIE_NOT_ALLOWED',
          message: 'Serie GRE Flexo no permitida. Use T003-00000000 o T999-00000000.'
        });
        return;
      }

      const pdfUrl = await service.getGuidePdfUrl(serieNumeroGuia);

      if (!pdfUrl) {
        res.status(404).json({
          error: 'PDF_NOT_AVAILABLE',
          message: 'El PDF aun no esta disponible para esta GRE.'
        });
        return;
      }

      res.redirect(302, pdfUrl);
    } catch (error) {
      next(error);
    }
  });

  router.post('/api/flexo/guias/:serieNumeroGuia/manual-sunat-accepted', async (req, res, next) => {
    try {
      if (config.dryRun) {
        res.status(403).json({
          error: 'MANUAL_SUNAT_DISABLED_DRY_RUN',
          message: 'La actualizacion manual SUNAT esta bloqueada porque DRY_RUN=true'
        });
        return;
      }

      if (!config.directDbInsertEnabled) {
        res.status(403).json({
          error: 'MANUAL_SUNAT_DIRECT_DB_DISABLED',
          message: 'La actualizacion manual SUNAT requiere GRE_DIRECT_DB_INSERT_ENABLED=true'
        });
        return;
      }

      if (req.get('X-Confirm-Manual-Sunat') !== 'YES') {
        res.status(403).json({
          error: 'MANUAL_SUNAT_CONFIRMATION_REQUIRED',
          message: 'Para actualizar el mensaje SUNAT se requiere X-Confirm-Manual-Sunat: YES'
        });
        return;
      }

      const serieNumeroGuia = String(req.params.serieNumeroGuia ?? '').trim().toUpperCase();

      if (!/^T(?:003|999)-\d{8}$/.test(serieNumeroGuia)) {
        res.status(400).json({
          error: 'SERIE_NOT_ALLOWED',
          message: 'Serie GRE Flexo no permitida. Use T003-00000000 o T999-00000000.'
        });
        return;
      }

      req.log.info(
        sanitizeValue(
          {
            event: 'flexo.manual-sunat-accepted.request',
            serieNumeroGuia,
            user: req.get('X-User') ?? req.ip
          },
          [
            config.existingGreApiToken,
            config.greFcDb.password,
            config.ychiDb.password,
            config.bizlinksDb.password
          ]
        )
      );

      res.status(200).json({
        ok: true,
        ...sanitizeValue(await service.setManualSunatAcceptedMessage(serieNumeroGuia, {
          user: req.get('X-User') ?? req.ip
        }), [
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

  router.get('/api/flexo/facturas/:serieNumeroFactura/pdf', async (req, res, next) => {
    try {
      const serieNumeroFactura = String(req.params.serieNumeroFactura ?? '').trim().toUpperCase();

      if (!/^FF03-\d{8}$/.test(serieNumeroFactura)) {
        res.status(400).json({
          error: 'SERIE_NOT_ALLOWED',
          message: 'Serie FE Flexo no permitida. Use FF03-00000000.'
        });
        return;
      }

      const pdfUrl = await service.getInvoicePdfUrl(serieNumeroFactura);

      if (!pdfUrl) {
        res.status(404).json({
          error: 'PDF_NOT_AVAILABLE',
          message: 'El PDF aun no esta disponible para esta factura.'
        });
        return;
      }

      res.redirect(302, pdfUrl);
    } catch (error) {
      next(error);
    }
  });

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

  router.get('/api/flexo/ajustes/empaques', async (req, res, next) => {
    try {
      const q = String(req.query.q ?? '');

      res.status(200).json({
        ok: true,
        empaques: await service.searchEmpaqueAdjustments(q)
      });
    } catch (error) {
      next(error);
    }
  });

  router.patch('/api/flexo/ajustes/empaques/:codigoEmpaque/:codigoProducto/unidad-medida', async (req, res, next) => {
    try {
      const codigoEmpaque = Number(req.params.codigoEmpaque);
      const codigoProducto = String(req.params.codigoProducto ?? '');
      const unidadMedida = String(req.body?.unidadMedida ?? '');

      res.status(200).json({
        ok: true,
        ...await service.updateEmpaqueUnidad({
          codigoEmpaque,
          codigoProducto,
          unidadMedida
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

  router.post('/api/flexo/guias/preparar', async (req, res, next) => {
    try {
      res.status(200).json({
        ok: true,
        ...sanitizeValue(await service.prepareGuia(req.body), [
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

  router.post('/api/flexo/guias/declarar', async (req, res, next) => {
    try {
      res.status(200).json({
        ok: true,
        ...sanitizeValue(await service.declareGuia(req.body), [
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
