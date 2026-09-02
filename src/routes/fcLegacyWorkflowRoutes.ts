import { Router } from 'express';
import { z } from 'zod';
import type { AppConfig } from '../config/env.js';
import { FcLegacyWorkflowService } from '../services/fcLegacyWorkflowService.js';
import { validationIssues } from '../utils/sanitize.js';

const preGuideSchema = z.object({
  numeroOt: z.string().trim().min(1).max(11),
  cantidad: z.number().positive(),
  del: z.string().trim().max(12),
  al: z.string().trim().max(12)
});
const internalGuideSchema = z.object({
  serie: z.enum(['001', '003']),
  idRecepciones: z.array(z.number().int().positive()).min(1).max(100),
  direccion: z.string().trim().min(1).max(150),
  idDistrito: z.number().int().positive(),
  ordenCompra: z.string().trim().max(50),
  observaciones: z.string().trim().max(50)
});

export type FcLegacyWorkflowRouteService = Pick<
  FcLegacyWorkflowService,
  'capabilities' | 'searchClients' | 'searchWorkOrders' | 'searchReceptions' | 'createPreGuide' | 'acceptPreGuide' | 'createInternalGuide'
>;

export function fcLegacyWorkflowRoutes(
  config: AppConfig,
  service: FcLegacyWorkflowRouteService = new FcLegacyWorkflowService(config)
) {
  const router = Router();

  router.get('/api/fc-legacy/capabilities', (_req, res) => res.json({ ok: true, ...service.capabilities() }));
  router.get('/api/fc-legacy/clients', async (req, res, next) => {
    try { res.json({ ok: true, clients: await service.searchClients(String(req.query.q ?? '')) }); }
    catch (error) { next(error); }
  });
  router.get('/api/fc-legacy/work-orders', async (req, res, next) => {
    try {
      const idClieProv = optionalPositiveInt(req.query.idClieProv);
      res.json({ ok: true, workOrders: await service.searchWorkOrders(String(req.query.q ?? ''), idClieProv) });
    }
    catch (error) { next(error); }
  });
  router.get('/api/fc-legacy/receptions', async (req, res, next) => {
    try {
      const state = z.enum(['ready', 'pending', 'all']).catch('ready').parse(req.query.state);
      const idClieProv = optionalPositiveInt(req.query.idClieProv);
      res.json({ ok: true, receptions: await service.searchReceptions(String(req.query.q ?? ''), state, idClieProv) });
    }
    catch (error) { next(error); }
  });
  router.post('/api/fc-legacy/pre-guides', async (req, res, next) => {
    try {
      if (req.get('X-Confirm-Legacy-Write') !== 'YES') return void res.status(403).json({ message: 'Falta confirmacion de escritura legacy.' });
      const parsed = preGuideSchema.safeParse(req.body);
      if (!parsed.success) return void res.status(400).json({ error: 'VALIDATION_ERROR', issues: validationIssues(parsed.error) });
      res.json({ ok: true, preGuide: await service.createPreGuide(parsed.data) });
    } catch (error) { next(error); }
  });
  router.post('/api/fc-legacy/pre-guides/:id/accept', async (req, res, next) => {
    try {
      if (req.get('X-Confirm-Legacy-Write') !== 'YES') return void res.status(403).json({ message: 'Falta confirmacion de escritura legacy.' });
      const idRecepcionOT = Number(req.params.id);
      if (!Number.isInteger(idRecepcionOT) || idRecepcionOT <= 0) return void res.status(400).json({ message: 'idRecepcionOT invalido.' });
      res.json({ ok: true, preGuide: await service.acceptPreGuide({ idRecepcionOT }) });
    } catch (error) { next(error); }
  });
  router.post('/api/fc-legacy/internal-guides', async (req, res, next) => {
    try {
      if (req.get('X-Confirm-Legacy-Write') !== 'YES') return void res.status(403).json({ message: 'Falta confirmacion de escritura legacy.' });
      const parsed = internalGuideSchema.safeParse(req.body);
      if (!parsed.success) return void res.status(400).json({ error: 'VALIDATION_ERROR', issues: validationIssues(parsed.error) });
      res.json({ ok: true, internalGuide: await service.createInternalGuide(parsed.data) });
    } catch (error) { next(error); }
  });
  return router;
}

function optionalPositiveInt(value: unknown) {
  if (value === undefined || value === null || value === '') return undefined;
  const numeric = Number(value);
  if (!Number.isInteger(numeric) || numeric <= 0) return undefined;
  return numeric;
}
