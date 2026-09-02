import { Router } from 'express';
import { z } from 'zod';
import type { AppConfig } from '../config/env.js';
import {
  DirectDbReportesEspecialesService,
  type ReportesEspecialesService,
  monthRange
} from '../services/reportesEspecialesService.js';
import { sanitizeValue } from '../utils/sanitize.js';

const querySchema = z.object({
  year: z.coerce.number().int().min(2000).max(2100),
  month: z.coerce.number().int().min(1).max(12)
});

export function reportesEspecialesRoutes(
  config: AppConfig,
  service: ReportesEspecialesService = new DirectDbReportesEspecialesService(config)
) {
  const router = Router();

  router.get('/api/reportes-especiales/facturacion-mensual/export', async (req, res) => {
    try {
      const parsed = querySchema.parse(req.query);
      const result = await service.exportFacturacionMensualExcel(parsed);

      res.status(200);
      res.setHeader('Content-Type', result.contentType);
      res.setHeader('Content-Disposition', `attachment; filename="${result.filename}"`);
      res.setHeader('Cache-Control', 'no-store');
      res.send(result.body);
    } catch (error) {
      const secrets = [
        config.existingGreApiToken,
        config.greFcDb?.password,
        config.ychiDb?.password,
        config.bizlinksDb?.password
      ].filter(Boolean);

      res.status(500).json({
        error: 'REPORT_EXPORT_ERROR',
        message: sanitizeValue(error instanceof Error ? error.message : 'No se pudo generar el reporte.', secrets)
      });
    }
  });

  router.get('/api/reportes-especiales/facturacion-mensual/range', (req, res, next) => {
    try {
      const parsed = querySchema.parse(req.query);

      res.status(200).json({
        ok: true,
        ...monthRange(parsed)
      });
    } catch (error) {
      next(error);
    }
  });

  return router;
}
