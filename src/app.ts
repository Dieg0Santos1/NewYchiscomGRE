import express from 'express';
import pino from 'pino';
import { pinoHttp } from 'pino-http';
import type { AppConfig } from './config/env.js';
import { loadEnv } from './config/env.js';
import { createExistingGreClient, type ExistingGreClient } from './integrations/existingGreClient.js';
import { errorHandler } from './middleware/errorHandler.js';
import { frontendAssets } from './middleware/frontendAssets.js';
import { fcFacturaRoutes } from './routes/fcFacturaRoutes.js';
import { flexoFacturaRoutes } from './routes/flexoFacturaRoutes.js';
import { flexoRoutes } from './routes/flexoRoutes.js';
import { greFormularioRoutes } from './routes/greFormularioRoutes.js';
import { greRoutes } from './routes/greRoutes.js';
import { greTrasladoRoutes } from './routes/greTrasladoRoutes.js';
import { healthRoutes } from './routes/healthRoutes.js';
import { reportesEspecialesRoutes } from './routes/reportesEspecialesRoutes.js';
import { sanitizeValue } from './utils/sanitize.js';
import type { FcFacturaService } from './services/fcFacturaService.js';
import type { FlexoFacturaService } from './services/flexoFacturaService.js';
import type { GreFormularioDeclararTestService } from './services/greFormularioDeclararTestService.js';
import type { GreFormularioManualSunatService } from './services/greFormularioManualSunatService.js';
import type { GreFormularioReleaseOtService } from './services/greFormularioReleaseOtService.js';
import type { GreTrasladoManualSunatService } from './services/greTrasladoManualSunatService.js';
import type { GreTrasladoService } from './services/greTrasladoService.js';
import type { ReportesEspecialesService } from './services/reportesEspecialesService.js';

export function createApp(options?: {
  config?: AppConfig;
  existingGreClient?: ExistingGreClient;
  fcFacturaService?: FcFacturaService;
  flexoFacturaService?: FlexoFacturaService;
  greFormularioDeclararTestService?: GreFormularioDeclararTestService;
  greFormularioManualSunatService?: GreFormularioManualSunatService;
  greFormularioReleaseOtService?: GreFormularioReleaseOtService;
  greTrasladoManualSunatService?: GreTrasladoManualSunatService;
  greTrasladoService?: GreTrasladoService;
  reportesEspecialesService?: ReportesEspecialesService;
}) {
  const config = options?.config ?? loadEnv();
  const logger = pino({
    level: config.nodeEnv === 'test' ? 'silent' : 'info',
    redact: ['req.headers.token', 'req.headers.authorization']
  });
  const app = express();
  const existingGreClient = options?.existingGreClient ?? createExistingGreClient(config);

  app.disable('x-powered-by');
  app.locals.config = config;
  app.use(express.json({ limit: '1mb' }));
  app.use(
    pinoHttp({
      logger,
      serializers: {
        err: (error: unknown) => sanitizeValue(error, [config.existingGreApiToken])
      }
    })
  );
  app.use(healthRoutes());
  app.use(greRoutes(config, existingGreClient));
  app.use(flexoRoutes(config));
  app.use(greFormularioRoutes(
    config,
    options?.greFormularioDeclararTestService,
    existingGreClient,
    options?.greFormularioManualSunatService,
    options?.greFormularioReleaseOtService
  ));
  app.use(greTrasladoRoutes(config, options?.greTrasladoService, options?.greTrasladoManualSunatService));
  app.use(fcFacturaRoutes(config, options?.fcFacturaService));
  app.use(flexoFacturaRoutes(config, options?.flexoFacturaService));
  app.use(reportesEspecialesRoutes(config, options?.reportesEspecialesService));
  if (config.serveFrontend) {
    app.use(frontendAssets(config));
  }
  app.use(errorHandler);

  return app;
}
