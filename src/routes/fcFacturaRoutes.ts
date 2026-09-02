import { Router } from 'express';
import type { AppConfig } from '../config/env.js';
import { DirectDbFcFacturaService, type FcFacturaService } from '../services/fcFacturaService.js';
import { FC_FACTURA_SERIE_PATTERN, fcFacturaPreviewSchema } from '../schemas/fcFacturaSchema.js';
import { sanitizeValue, validationIssues } from '../utils/sanitize.js';

export function fcFacturaRoutes(
  config: AppConfig,
  service: FcFacturaService = new DirectDbFcFacturaService(config)
) {
  const router = Router();

  router.get('/api/fc-facturas/clientes/search', async (req, res, next) => {
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

  router.get('/api/fc-facturas/next-serie', async (_req, res, next) => {
    try {
      res.status(200).json({
        ok: true,
        ...await service.getNextSerie()
      });
    } catch (error) {
      next(error);
    }
  });

  router.get('/api/fc-facturas/catalogos/cuentas', async (_req, res, next) => {
    try {
      res.status(200).json({
        ok: true,
        ...await service.listCuentas()
      });
    } catch (error) {
      next(error);
    }
  });

  router.get('/api/fc-facturas/catalogos/formas-pago', async (_req, res, next) => {
    try {
      res.status(200).json({
        ok: true,
        formasPago: await service.listFormasPago()
      });
    } catch (error) {
      next(error);
    }
  });

  router.get('/api/fc-facturas/guias-pendientes', async (req, res, next) => {
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

  router.get('/api/fc-facturas', async (_req, res, next) => {
    try {
      res.status(200).json({
        ok: true,
        facturas: await service.listFacturas()
      });
    } catch (error) {
      next(error);
    }
  });

  router.get('/api/fc-facturas/:serieNumeroFactura/pdf', async (req, res, next) => {
    try {
      const serieNumeroFactura = String(req.params.serieNumeroFactura ?? '').trim();

      if (!FC_FACTURA_SERIE_PATTERN.test(serieNumeroFactura)) {
        res.status(400).json({
          error: 'SERIE_NOT_ALLOWED',
          message: 'Solo se permite imprimir facturas FF01 de formularios continuos'
        });
        return;
      }

      const pdfUrl = await service.getFacturaPdfUrl(serieNumeroFactura);

      if (!pdfUrl) {
        res.status(404).json({
          error: 'PDF_NOT_AVAILABLE',
          message: 'El PDF aun no esta disponible para esta factura'
        });
        return;
      }

      res.redirect(302, pdfUrl);
    } catch (error) {
      next(error);
    }
  });

  router.post('/api/fc-facturas/preview', async (req, res, next) => {
    try {
      const parsed = fcFacturaPreviewSchema.safeParse(req.body);

      if (!parsed.success) {
        res.status(400).json({
          error: 'VALIDATION_ERROR',
          issues: validationIssues(parsed.error)
        });
        return;
      }

      const preview = await service.preview(parsed.data);

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

  router.post('/api/fc-facturas/declarar', async (req, res, next) => {
    try {
      const confirmed = String(req.header('x-confirm-fc-factura') ?? '').trim().toUpperCase();
      const operationId = String(req.header('x-operation-id') ?? '').trim();
      const user = String(req.header('x-user') ?? '').trim() || undefined;

      if (confirmed !== 'YES') {
        res.status(403).json({
          error: 'FC_FACTURA_CONFIRMATION_REQUIRED',
          message: 'La declaracion de facturas FC requiere cabecera X-Confirm-Fc-Factura: YES'
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

      const parsed = fcFacturaPreviewSchema.safeParse(req.body);

      if (!parsed.success) {
        res.status(400).json({
          error: 'VALIDATION_ERROR',
          issues: validationIssues(parsed.error)
        });
        return;
      }

      let result: Awaited<ReturnType<FcFacturaService['declarar']>>;
      try {
        result = await service.declarar(parsed.data, { operationId, user });
      } catch (error) {
        const friendly = toFcFacturaErrorResponse(error);
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

  router.post('/api/fc-facturas/declarar-test', (_req, res) => {
    res.status(403).json({
      error: 'FC_FACTURA_DECLARACION_BLOCKED',
      message: 'La declaracion de facturas FC esta bloqueada hasta completar auditoria, permisos y contrato Bizlinks.'
    });
  });

  return router;
}

function toFcFacturaErrorResponse(error: unknown) {
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
        message: 'Bizlinks rechazo la factura porque algun dato excede el tamano permitido. Revise descripcion, codigo, unidad de medida, forma de pago, OC u observaciones. La factura no fue declarada; corrija el dato y vuelva a generar vista previa.',
        detail: 'Error SQL 8152: dato demasiado largo para una columna de Bizlinks.'
      }
    };
  }

  if (number === 2627 || number === 2601 || /duplicate key|unique/i.test(message)) {
    return {
      status: 409,
      body: {
        ok: false,
        error: 'FC_FACTURA_DUPLICADA',
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
        error: 'FC_FACTURA_PERMISO_BD',
        message: 'El usuario de base de datos no tiene permisos suficientes para completar la declaracion. La factura no fue declarada; revise permisos sobre las tablas/procedimientos indicados.',
        detail: safeDetail(message)
      }
    };
  }

  if (/No se pudo obtener bloqueo SQL/i.test(message)) {
    return {
      status: 409,
      body: {
        ok: false,
        error: 'FC_FACTURA_BLOQUEO_SQL',
        message: 'Otro proceso esta usando el correlativo o una de las GRE seleccionadas. Espere unos segundos, actualice la pantalla y vuelva a intentar.',
        detail: safeDetail(message)
      }
    };
  }

  if (/005_allow_t999_fc_facturacion_guides/i.test(message)) {
    return {
      status: 422,
      body: {
        ok: false,
        error: 'FC_FACTURA_T999_SCHEMA_PENDING',
        message,
        detail: 'La factura no fue enviada a Bizlinks.'
      }
    };
  }

  return {
    status: 500,
    body: {
      ok: false,
      error: 'FC_FACTURA_DECLARACION_ERROR',
      message: 'No se pudo declarar la factura. No vuelva a intentarlo a ciegas: revise Reportes para confirmar si se llego a insertar en Bizlinks y comparta este detalle con soporte.',
      detail: safeDetail(message)
    }
  };
}

function safeDetail(value: string) {
  return value.replace(/at\s+[\w.<>]+\(.*?\)/g, '').slice(0, 600);
}
