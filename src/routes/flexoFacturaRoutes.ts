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

  router.post('/api/flexo-facturas/declarar', async (req, res, next) => {
    try {
      const confirmed = String(req.header('x-confirm-flexo-factura') ?? '').trim().toUpperCase();
      const operationId = String(req.header('x-operation-id') ?? '').trim();
      const user = String(req.header('x-user') ?? '').trim() || undefined;

      if (confirmed !== 'YES') {
        res.status(403).json({
          error: 'FLEXO_FACTURA_CONFIRMATION_REQUIRED',
          message: 'La declaracion de facturas Flexo requiere cabecera X-Confirm-Flexo-Factura: YES'
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

      const parsed = flexoFacturaPreviewSchema.safeParse(req.body);

      if (!parsed.success) {
        res.status(400).json({
          error: 'VALIDATION_ERROR',
          issues: validationIssues(parsed.error)
        });
        return;
      }

      let result: Awaited<ReturnType<FlexoFacturaService['declarar']>>;
      try {
        result = await service.declarar(parsed.data, { operationId, user });
      } catch (error) {
        const friendly = toFlexoFacturaErrorResponse(error);
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

  router.post('/api/flexo-facturas/declarar-test', (_req, res) => {
    res.status(403).json({
      error: 'FLEXO_FACTURA_DECLARACION_BLOCKED',
      message: 'La declaracion de facturas Flexo esta bloqueada hasta completar auditoria del contrato Bizlinks.'
    });
  });

  return router;
}

function toFlexoFacturaErrorResponse(error: unknown) {
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
        message: 'Bizlinks rechazo la factura porque algun dato excede el tamano permitido. Revise descripcion, codigo, unidad de medida, forma de pago, OC u observaciones.',
        detail: safeDetail(message)
      }
    };
  }

  if (number === 2627 || number === 2601 || /duplicate key|unique|ya existe|ya esta facturada/i.test(message)) {
    return {
      status: 409,
      body: {
        ok: false,
        error: 'FLEXO_FACTURA_DUPLICADA',
        message: 'La factura o alguna GRE seleccionada ya tiene trazabilidad de facturacion. Actualice la pantalla y revise Reportes antes de volver a declarar.',
        detail: safeDetail(message)
      }
    };
  }

  if (number === 229 || /permission was denied|SELECT permission|INSERT permission|UPDATE permission|EXECUTE permission/i.test(message)) {
    return {
      status: 403,
      body: {
        ok: false,
        error: 'FLEXO_FACTURA_PERMISO_BD',
        message: 'El usuario de base de datos no tiene permisos suficientes para completar la declaracion FF03.',
        detail: safeDetail(message)
      }
    };
  }

  if (/No se pudo obtener bloqueo SQL/i.test(message)) {
    return {
      status: 409,
      body: {
        ok: false,
        error: 'FLEXO_FACTURA_BLOQUEO_SQL',
        message: 'Otro proceso esta usando el correlativo o una GRE seleccionada. Espere unos segundos, actualice la pantalla y vuelva a intentar.',
        detail: safeDetail(message)
      }
    };
  }

  return {
    status: 500,
    body: {
      ok: false,
      error: 'FLEXO_FACTURA_DECLARACION_ERROR',
      message: 'No se pudo declarar la factura Flexo. Revise Reportes antes de reintentar.',
      detail: safeDetail(message)
    }
  };
}

function safeDetail(value: string) {
  return value.replace(/at\s+[\w.<>]+\(.*?\)/g, '').slice(0, 600);
}
