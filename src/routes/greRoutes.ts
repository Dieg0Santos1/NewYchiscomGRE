import { Router } from 'express';
import type { AppConfig } from '../config/env.js';
import { getGreDefaults } from '../config/greDefaults.js';
import type { ExistingGreClient } from '../integrations/existingGreClient.js';
import { mapGreInputToPayload } from '../mappers/grePayloadMapper.js';
import { greInputSchema } from '../schemas/greInputSchema.js';
import { validationIssues } from '../utils/sanitize.js';

export function greRoutes(config: AppConfig, existingGreClient: ExistingGreClient) {
  const router = Router();

  router.post('/api/gre/dry-run', (req, res) => {
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
      dryRun: true,
      wouldSend: false,
      payload
    });
  });

  router.post('/api/gre/send-test', async (req, res, next) => {
    try {
      if (config.dryRun) {
        res.status(403).json({
          error: 'SEND_DISABLED_DRY_RUN',
          message: 'El envio real esta bloqueado porque DRY_RUN=true'
        });
        return;
      }

      if (req.get('X-Confirm-Send') !== 'YES') {
        res.status(403).json({
          error: 'SEND_CONFIRMATION_REQUIRED',
          message: 'Para enviar se requiere X-Confirm-Send: YES'
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

      const payload = mapGreInputToPayload(parsed.data, getGreDefaults(config));
      const response = await existingGreClient.declareGre(payload);

      res.status(200).json({
        sent: true,
        dryRun: false,
        response
      });
    } catch (error) {
      next(error);
    }
  });

  return router;
}
