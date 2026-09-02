import { Router } from 'express';
import type { AppConfig } from '../config/env.js';
import { getGreDefaults } from '../config/greDefaults.js';
import { GRE_FC_ALLOWED_SERIES, GRE_FC_SERIE_FORMAT_MESSAGE, GRE_FC_SERIE_PATTERN, isGreFcAllowedSerie } from '../config/greSeries.js';
import type { ExistingGreClient } from '../integrations/existingGreClient.js';
import { mapGreInputToPayload } from '../mappers/grePayloadMapper.js';
import { toSpeDespatchProcedurePlan } from '../mappers/speDespatchProcedureMapper.js';
import {
  DirectDbGreFormularioDeclararTestService,
  type GreFormularioDeclararTestService
} from '../services/greFormularioDeclararTestService.js';
import {
  DirectDbGreFormularioManualSunatService,
  type GreFormularioManualSunatService
} from '../services/greFormularioManualSunatService.js';
import {
  DirectDbGreFormularioReleaseOtService,
  type GreFormularioReleaseOtService
} from '../services/greFormularioReleaseOtService.js';
import { GreFormularioQueryService } from '../services/greFormularioQueryService.js';
import { greInputSchema } from '../schemas/greInputSchema.js';
import { sanitizeValue, validationIssues } from '../utils/sanitize.js';

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function greFormularioRoutes(
  config: AppConfig,
  service: GreFormularioDeclararTestService = new DirectDbGreFormularioDeclararTestService(config),
  existingGreClient?: ExistingGreClient,
  manualSunatService: GreFormularioManualSunatService = new DirectDbGreFormularioManualSunatService(config),
  releaseOtService: GreFormularioReleaseOtService = new DirectDbGreFormularioReleaseOtService(config)
) {
  const router = Router();
  const queryService = new GreFormularioQueryService(config, existingGreClient);

  router.get('/api/gre-formularios/work-orders', async (req, res, next) => {
    try {
      const ot = String(req.query.ot ?? '').trim();
      const type = String(req.query.type ?? 'ot').trim().toLowerCase();

      if (!ot) {
        res.status(400).json({
          error: 'QUERY_REQUIRED',
          message: type === 'guia' ? 'Ingrese número de Guía Física' : 'Ingrese número de OT'
        });
        return;
      }

      const result = type === 'guia'
        ? await queryService.searchByPhysicalGuide(ot)
        : await queryService.searchByOt(ot);

      res.status(200).json({
        ok: true,
        ...result
      });
    } catch (error) {
      next(error);
    }
  });

  router.get('/api/catalogos/destinos/:numeroDocumento', async (req, res, next) => {
    try {
      const numeroDocumento = String(req.params.numeroDocumento ?? '').trim();

      if (!numeroDocumento) {
        res.status(400).json({
          error: 'NUMERO_DOCUMENTO_REQUIRED',
          message: 'numeroDocumento es requerido'
        });
        return;
      }

      res.status(200).json({
        ok: true,
        ...await queryService.getDestinos(numeroDocumento)
      });
    } catch (error) {
      next(error);
    }
  });

  router.get('/api/catalogos/choferes', async (_req, res, next) => {
    try {
      res.status(200).json({
        ok: true,
        choferes: await queryService.searchDrivers()
      });
    } catch (error) {
      next(error);
    }
  });

  router.get('/api/gre-formularios/next-serie', async (_req, res, next) => {
    try {
      const requestedSerie = String(_req.query.serie ?? '').trim().toUpperCase();

      if (requestedSerie && !isGreFcAllowedSerie(requestedSerie)) {
        res.status(400).json({
          error: 'SERIE_NOT_ALLOWED',
          message: GRE_FC_SERIE_FORMAT_MESSAGE,
          allowedSeries: GRE_FC_ALLOWED_SERIES
        });
        return;
      }
      const serie = requestedSerie && isGreFcAllowedSerie(requestedSerie) ? requestedSerie : undefined;

      res.status(200).json({
        ok: true,
        ...await queryService.getNextSerie(serie)
      });
    } catch (error) {
      next(error);
    }
  });

  router.get('/api/gre-formularios/recipients', async (req, res, next) => {
    try {
      res.status(200).json({
        ok: true,
        recipients: await queryService.searchRecipients(String(req.query.q ?? ''))
      });
    } catch (error) {
      next(error);
    }
  });

  router.get('/api/gre-formularios/guides', async (_req, res, next) => {
    try {
      res.status(200).json({
        ok: true,
        guides: await queryService.listGuides()
      });
    } catch (error) {
      next(error);
    }
  });

  router.get('/api/gre-formularios/guides/:serieNumeroGuia/pdf', async (req, res, next) => {
    try {
      const serieNumeroGuia = String(req.params.serieNumeroGuia ?? '').trim();

      if (!GRE_FC_SERIE_PATTERN.test(serieNumeroGuia)) {
        res.status(400).json({
          error: 'SERIE_NOT_ALLOWED',
          message: `Solo se permite imprimir guias ${GRE_FC_ALLOWED_SERIES.join(' o ')} de formularios continuos`
        });
        return;
      }

      const pdfUrl = await queryService.getGuidePdfUrl(serieNumeroGuia);

      if (!pdfUrl) {
        res.status(404).json({
          error: 'PDF_NOT_AVAILABLE',
          message: 'El PDF aun no esta disponible para esta guia'
        });
        return;
      }

      res.redirect(302, pdfUrl);
    } catch (error) {
      next(error);
    }
  });

  router.post('/api/gre-formularios/guides/:serieNumeroGuia/manual-sunat-accepted', async (req, res, next) => {
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

      const serieNumeroGuia = String(req.params.serieNumeroGuia ?? '').trim();

      if (!GRE_FC_SERIE_PATTERN.test(serieNumeroGuia)) {
        res.status(400).json({
          error: 'SERIE_NOT_ALLOWED',
          message: `Solo se permite actualizar guias ${GRE_FC_ALLOWED_SERIES.join(' o ')} de formularios continuos`
        });
        return;
      }

      req.log.info(
        sanitizeValue(
          {
            event: 'gre-formularios.manual-sunat-accepted.request',
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

      const result = await manualSunatService.setAcceptedMessage(serieNumeroGuia, {
        user: req.get('X-User') ?? req.ip
      });

      res.status(200).json({
        ok: true,
        ...sanitizeValue(result, [
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

  router.post('/api/gre-formularios/guides/:serieNumeroGuia/release-ots', async (req, res, next) => {
    try {
      if (config.dryRun) {
        res.status(403).json({
          error: 'RELEASE_OT_DISABLED_DRY_RUN',
          message: 'La liberacion de OT esta bloqueada porque DRY_RUN=true'
        });
        return;
      }

      if (!config.directDbInsertEnabled) {
        res.status(403).json({
          error: 'RELEASE_OT_DIRECT_DB_DISABLED',
          message: 'La liberacion de OT requiere GRE_DIRECT_DB_INSERT_ENABLED=true'
        });
        return;
      }

      if (req.get('X-Confirm-Release-OT') !== 'YES') {
        res.status(403).json({
          error: 'RELEASE_OT_CONFIRMATION_REQUIRED',
          message: 'Para liberar las OT se requiere X-Confirm-Release-OT: YES'
        });
        return;
      }

      const serieNumeroGuia = String(req.params.serieNumeroGuia ?? '').trim();

      if (!GRE_FC_SERIE_PATTERN.test(serieNumeroGuia)) {
        res.status(400).json({
          error: 'SERIE_NOT_ALLOWED',
          message: `Solo se permite liberar OT de guias ${GRE_FC_ALLOWED_SERIES.join(' o ')} de formularios continuos`
        });
        return;
      }

      req.log.info(
        sanitizeValue(
          {
            event: 'gre-formularios.release-ots.request',
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

      const result = await releaseOtService.releaseWorkOrders(serieNumeroGuia, {
        user: req.get('X-User') ?? req.ip
      });

      res.status(200).json({
        ok: true,
        ...sanitizeValue(result, [
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

  router.get('/api/gre-formularios/status/:operationId', async (req, res, next) => {
    try {
      const { operationId } = req.params;

      if (!operationId || !uuidPattern.test(operationId)) {
        res.status(400).json({
          error: 'OPERATION_ID_REQUIRED',
          message: 'operationId debe ser un UUID valido'
        });
        return;
      }

      const status = await queryService.getStatus(operationId);

      if (!status) {
        res.status(404).json({
          error: 'OPERATION_NOT_FOUND',
          message: 'No existe una operacion con el operationId indicado'
        });
        return;
      }

      res.status(200).json({
        ok: true,
        status
      });
    } catch (error) {
      next(error);
    }
  });

  router.post('/api/gre-formularios/preview', async (req, res) => {
    const parsed = greInputSchema.safeParse(req.body);

    if (!parsed.success) {
      res.status(400).json({
        error: 'VALIDATION_ERROR',
        issues: validationIssues(parsed.error)
      });
      return;
    }

    const payload = mapGreInputToPayload(parsed.data, getGreDefaults(config));

    res.status(200).json({
      ok: true,
      writesDatabase: false,
      payload: sanitizeValue(payload, [
        config.existingGreApiToken,
        config.greFcDb.password,
        config.ychiDb.password,
        config.bizlinksDb.password
      ]),
      procedurePlan: sanitizeValue(toSpeDespatchProcedurePlan(payload), [
        config.existingGreApiToken,
        config.greFcDb.password,
        config.ychiDb.password,
        config.bizlinksDb.password
      ])
    });
  });

  router.post('/api/gre-formularios/declarar-test', async (req, res, next) => {
    try {
      if (config.dryRun) {
        res.status(403).json({
          error: 'SEND_DISABLED_DRY_RUN',
          message: 'La escritura directa esta bloqueada porque DRY_RUN=true'
        });
        return;
      }

      if (!config.directDbInsertEnabled) {
        res.status(403).json({
          error: 'DIRECT_DB_INSERT_DISABLED',
          message: 'La escritura directa experimental requiere GRE_DIRECT_DB_INSERT_ENABLED=true'
        });
        return;
      }

      if (req.get('X-Confirm-Send') !== 'YES') {
        res.status(403).json({
          error: 'SEND_CONFIRMATION_REQUIRED',
          message: 'Para insertar se requiere X-Confirm-Send: YES'
        });
        return;
      }

      const operationId = req.get('X-Operation-Id');

      if (!operationId || !uuidPattern.test(operationId)) {
        res.status(400).json({
          error: 'OPERATION_ID_REQUIRED',
          message: 'Para insertar se requiere X-Operation-Id con UUID valido'
        });
        return;
      }

      const parsed = greInputSchema.safeParse(req.body);

      if (!parsed.success) {
        res.status(400).json({
          error: 'VALIDATION_ERROR',
          issues: validationIssues(parsed.error)
        });
        return;
      }

      req.log.info(
        sanitizeValue(
          {
            event: 'gre-formularios.declarar-test.request',
            operationId,
            serieSolicitada: parsed.data.serieNumeroGuia,
            items: parsed.data.items.length,
            destinatario: parsed.data.destinatario.numeroDocumentoDestinatario
          },
          [
            config.existingGreApiToken,
            config.greFcDb.password,
            config.ychiDb.password,
            config.bizlinksDb.password
          ]
        )
      );

      const result = await service.declarar(parsed.data, {
        operationId,
        user: req.get('X-User') ?? req.ip
      });

      req.log.info(
        sanitizeValue(
          {
            event: 'gre-formularios.declarar-test.result',
            result
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
        productionEnabled: false,
        ...(sanitizeValue(result, [
          config.existingGreApiToken,
          config.greFcDb.password,
          config.ychiDb.password,
          config.bizlinksDb.password
        ]) as Record<string, unknown>)
      });
    } catch (error) {
      next(error);
    }
  });

  return router;
}
