import { Router } from 'express';
import type { AppConfig } from '../config/env.js';
import { getGreDefaults } from '../config/greDefaults.js';
import { GRE_TRASLADO_SERIE_FORMAT_MESSAGE, GRE_TRASLADO_SERIE_PATTERN } from '../config/greTrasladoSeries.js';
import { mapGreInputToPayload } from '../mappers/grePayloadMapper.js';
import { toSpeDespatchProcedurePlan } from '../mappers/speDespatchProcedureMapper.js';
import { greTrasladoInputSchema, type GreTrasladoInputDto } from '../schemas/greTrasladoInputSchema.js';
import {
  DirectDbGreTrasladoManualSunatService,
  type GreTrasladoManualSunatService
} from '../services/greTrasladoManualSunatService.js';
import { DirectDbGreTrasladoService, type GreTrasladoService } from '../services/greTrasladoService.js';
import { sanitizeValue, validationIssues } from '../utils/sanitize.js';

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function greTrasladoRoutes(
  config: AppConfig,
  service: GreTrasladoService = new DirectDbGreTrasladoService(config),
  manualSunatService: GreTrasladoManualSunatService = new DirectDbGreTrasladoManualSunatService(config)
) {
  const router = Router();

  router.get('/api/gre-traslados/next-serie', async (_req, res, next) => {
    try {
      res.status(200).json({
        ok: true,
        ...await service.getNextSerie()
      });
    } catch (error) {
      next(error);
    }
  });

  router.get('/api/gre-traslados', async (_req, res, next) => {
    try {
      res.status(200).json({
        ok: true,
        traslados: await service.listTraslados()
      });
    } catch (error) {
      next(error);
    }
  });

  router.get('/api/gre-traslados/:serieNumeroGuia/pdf', async (req, res, next) => {
    try {
      const serieNumeroGuia = String(req.params.serieNumeroGuia ?? '').trim();

      if (!GRE_TRASLADO_SERIE_PATTERN.test(serieNumeroGuia)) {
        res.status(400).json({
          error: 'SERIE_NOT_ALLOWED',
          message: GRE_TRASLADO_SERIE_FORMAT_MESSAGE
        });
        return;
      }

      const pdfUrl = await service.getTrasladoPdfUrl(serieNumeroGuia);

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

  router.post('/api/gre-traslados/:serieNumeroGuia/manual-sunat-accepted', async (req, res, next) => {
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

      if (!GRE_TRASLADO_SERIE_PATTERN.test(serieNumeroGuia)) {
        res.status(400).json({
          error: 'SERIE_NOT_ALLOWED',
          message: GRE_TRASLADO_SERIE_FORMAT_MESSAGE
        });
        return;
      }

      req.log.info(
        sanitizeValue(
          {
            event: 'gre-traslados.manual-sunat-accepted.request',
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

  router.post('/api/gre-traslados/preview', async (req, res) => {
    const parsed = greTrasladoInputSchema.safeParse(req.body);

    if (!parsed.success) {
      res.status(400).json({
        error: 'VALIDATION_ERROR',
        issues: validationIssues(parsed.error)
      });
      return;
    }

    const businessIssues = trasladoBusinessValidationIssues(parsed.data, config);
    if (businessIssues.length > 0) {
      res.status(400).json({
        error: 'VALIDATION_ERROR',
        issues: businessIssues
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

  router.post('/api/gre-traslados/declarar', async (req, res, next) => {
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
          message: 'La escritura directa de traslado requiere GRE_DIRECT_DB_INSERT_ENABLED=true'
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

      const parsed = greTrasladoInputSchema.safeParse(req.body);

      if (!parsed.success) {
        res.status(400).json({
          error: 'VALIDATION_ERROR',
          issues: validationIssues(parsed.error)
        });
        return;
      }

      const businessIssues = trasladoBusinessValidationIssues(parsed.data, config);
      if (businessIssues.length > 0) {
        res.status(400).json({
          error: 'VALIDATION_ERROR',
          issues: businessIssues
        });
        return;
      }

      req.log.info(
        sanitizeValue(
          {
            event: 'gre-traslados.declarar.request',
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

function trasladoBusinessValidationIssues(input: GreTrasladoInputDto, config: AppConfig) {
  const issues: Array<{ path: string; message: string }> = [];

  if (input.traslado.motivoTraslado === '02') {
    const destinatarioDocumento = input.destinatario.numeroDocumentoDestinatario.trim();
    const destinatarioTipo = input.destinatario.tipoDocumentoDestinatario.trim();
    const remitenteDocumento = config.remitente.numeroDocumento.trim();
    const remitenteTipo = config.remitente.tipoDocumento.trim();

    if (destinatarioDocumento !== remitenteDocumento || destinatarioTipo !== remitenteTipo) {
      issues.push({
        path: 'destinatario.numeroDocumentoDestinatario',
        message: `Para motivo 02 - COMPRA, SUNAT exige que el destinatario sea igual al remitente (${remitenteTipo}-${remitenteDocumento} ${config.remitente.razonSocial}).`
      });
    }
  }

  return issues;
}
