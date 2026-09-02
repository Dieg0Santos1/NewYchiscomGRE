import type { ErrorRequestHandler } from 'express';
import { ZodError } from 'zod';
import { ExistingGreClientError } from '../integrations/existingGreClient.js';
import { sanitizeValue, validationIssues } from '../utils/sanitize.js';

export const errorHandler: ErrorRequestHandler = (error, req, res, _next) => {
  const secrets = [
    req.app.locals.config?.existingGreApiToken,
    req.app.locals.config?.greFcDb?.password,
    req.app.locals.config?.ychiDb?.password,
    req.app.locals.config?.bizlinksDb?.password
  ].filter(Boolean);

  if (error instanceof ZodError) {
    res.status(400).json({
      error: 'VALIDATION_ERROR',
      issues: validationIssues(error)
    });
    return;
  }

  if (error instanceof ExistingGreClientError) {
    res.status(error.statusCode ?? 502).json({
      error: 'EXISTING_GRE_API_ERROR',
      message: sanitizeValue(error.message, secrets),
      response: sanitizeValue(error.responseBody, secrets)
    });
    return;
  }

  res.status(500).json({
    error: 'INTERNAL_ERROR',
    message: 'Error interno'
  });
};
