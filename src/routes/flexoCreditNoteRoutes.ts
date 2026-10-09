import { Router } from 'express';
import type { AppConfig } from '../config/env.js';
import { flexoCreditNotePreviewSchema } from '../schemas/flexoCreditNoteSchema.js';
import { DirectDbFlexoCreditNoteService, type FlexoCreditNoteService } from '../services/flexoCreditNoteService.js';
import { sanitizeValue, validationIssues } from '../utils/sanitize.js';

export function flexoCreditNoteRoutes(
  config: AppConfig,
  service: FlexoCreditNoteService = new DirectDbFlexoCreditNoteService(config)
) {
  const router = Router();

  router.get('/api/flexo-notas-credito/facturas/search', async (req, res, next) => {
    try {
      const query = String(req.query.q ?? '').trim();
      res.status(200).json({
        ok: true,
        ...await service.searchFacturas(query)
      });
    } catch (error) {
      next(error);
    }
  });

  router.get('/api/flexo-notas-credito/next-serie', async (_req, res, next) => {
    try {
      res.status(200).json({
        ok: true,
        ...await service.getNextSerie()
      });
    } catch (error) {
      next(error);
    }
  });

  router.post('/api/flexo-notas-credito/preview', async (req, res, next) => {
    try {
      const parsed = flexoCreditNotePreviewSchema.safeParse(req.body);

      if (!parsed.success) {
        res.status(400).json({
          error: 'VALIDATION_ERROR',
          issues: validationIssues(parsed.error)
        });
        return;
      }

      let preview: Awaited<ReturnType<FlexoCreditNoteService['preview']>>;
      try {
        preview = await service.preview(parsed.data);
      } catch (error) {
        const friendly = toFlexoCreditNoteErrorResponse(error);
        res.status(friendly.status).json(friendly.body);
        return;
      }

      res.status(200).json({
        ok: true,
        ...sanitizeValue(preview, [
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

  router.post('/api/flexo-notas-credito/declarar', async (req, res, next) => {
    try {
      const confirmed = String(req.header('x-confirm-flexo-nce') ?? '').trim().toUpperCase();
      const operationId = String(req.header('x-operation-id') ?? '').trim();
      const user = String(req.header('x-user') ?? '').trim() || undefined;

      if (confirmed !== 'YES') {
        res.status(403).json({
          error: 'FLEXO_NCE_CONFIRMATION_REQUIRED',
          message: 'La declaracion de notas de credito Flexo requiere cabecera X-Confirm-Flexo-Nce: YES'
        });
        return;
      }

      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(operationId)) {
        res.status(400).json({
          error: 'OPERATION_ID_REQUIRED',
          message: 'La declaracion requiere cabecera X-Operation-Id con UUID valido'
        });
        return;
      }

      const parsed = flexoCreditNotePreviewSchema.safeParse(req.body);

      if (!parsed.success) {
        res.status(400).json({
          error: 'VALIDATION_ERROR',
          issues: validationIssues(parsed.error)
        });
        return;
      }

      let result: Awaited<ReturnType<FlexoCreditNoteService['declarar']>>;
      try {
        result = await service.declarar(parsed.data, { operationId, user });
      } catch (error) {
        const friendly = toFlexoCreditNoteErrorResponse(error);
        res.status(friendly.status).json(friendly.body);
        return;
      }

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

  return router;
}

function toFlexoCreditNoteErrorResponse(error: unknown) {
  const rawMessage = error instanceof Error ? error.message : String(error);
  const record = error && typeof error === 'object' ? error as Record<string, unknown> : {};
  const number = Number(record.number ?? record.code ?? 0);
  const message = rawMessage.replace(/\s+/g, ' ').trim();

  if (number === 8152 || /String or binary data would be truncated/i.test(message)) {
    return {
      status: 422,
      body: {
        ok: false,
        error: 'BIZLINKS_DATA_TOO_LONG',
        message: 'Bizlinks rechazo la nota de credito porque algun dato excede el tamano permitido.',
        detail: safeDetail(message)
      }
    };
  }

  if (number === 2627 || number === 2601 || /duplicate key|unique|ya existe|NOTACRE|nota de credito/i.test(message)) {
    return {
      status: 409,
      body: {
        ok: false,
        error: 'FLEXO_NCE_DUPLICADA_O_YA_ASOCIADA',
        message: 'La factura ya tiene nota de credito o el correlativo FC03 ya fue usado. Actualice y revise Reportes antes de reintentar.',
        detail: safeDetail(message)
      }
    };
  }

  if (number === 229 || /permission was denied|SELECT permission|INSERT permission|UPDATE permission|EXECUTE permission/i.test(message)) {
    return {
      status: 403,
      body: {
        ok: false,
        error: 'FLEXO_NCE_PERMISO_BD',
        message: 'El usuario de base de datos no tiene permisos suficientes para completar la nota de credito Flexo.',
        detail: safeDetail(message)
      }
    };
  }

  if (/No existe factura legacy|No existe cliente legacy|legacy/i.test(message)) {
    return {
      status: 422,
      body: {
        ok: false,
        error: 'FLEXO_NCE_LEGACY_INCOMPLETO',
        message: 'No se puede declarar la nota de credito porque falta la factura o cliente en tablas legacy YCHIDB3.',
        detail: safeDetail(message)
      }
    };
  }

  return {
    status: 500,
    body: {
      ok: false,
      error: 'FLEXO_NCE_DECLARACION_ERROR',
      message: 'No se pudo declarar la nota de credito Flexo. Revise Reportes antes de reintentar.',
      detail: safeDetail(message)
    }
  };
}

function safeDetail(value: string) {
  return value.replace(/at\s+[\w.<>]+\(.*?\)/g, '').slice(0, 600);
}
