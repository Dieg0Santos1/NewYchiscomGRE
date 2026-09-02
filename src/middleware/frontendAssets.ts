import express from 'express';
import path from 'node:path';
import type { AppConfig } from '../config/env.js';

export function frontendAssets(config: AppConfig) {
  const router = express.Router();
  const distPath = path.resolve(process.cwd(), config.frontendDistPath);

  router.use(express.static(distPath, {
    index: false,
    maxAge: config.nodeEnv === 'production' ? '1h' : 0
  }));

  router.get(/.*/, (req, res, next) => {
    if (req.path.startsWith('/api/') || req.path === '/health') {
      next();
      return;
    }

    res.sendFile(path.join(distPath, 'index.html'), (error) => {
      if (error) next(error);
    });
  });

  return router;
}
