import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { createApp } from '../app.js';
import { testConfig, validGreInput } from './fixtures.js';

describe('GRE routes', () => {
  it('GET /health responde ok', async () => {
    const app = createApp({ config: testConfig });

    await request(app)
      .get('/health')
      .expect(200)
      .expect((response) => {
        expect(response.body).toEqual({ status: 'ok' });
        expect(response.headers['x-powered-by']).toBeUndefined();
      });
  });

  it('POST /api/gre/dry-run valida y devuelve payload sin enviar', async () => {
    const declareGre = vi.fn();
    const app = createApp({
      config: testConfig,
      existingGreClient: { declareGre, getDestinos: vi.fn() }
    });

    await request(app)
      .post('/api/gre/dry-run')
      .send(validGreInput)
      .expect(200)
      .expect((response) => {
        expect(response.body.dryRun).toBe(true);
        expect(response.body.wouldSend).toBe(false);
        expect(response.body.payload.serieNumeroGuia).toBe(validGreInput.serieNumeroGuia);
      });

    expect(declareGre).not.toHaveBeenCalled();
  });

  it('POST /api/gre/dry-run reporta errores de validacion', async () => {
    const app = createApp({ config: testConfig });

    await request(app)
      .post('/api/gre/dry-run')
      .send({ ...validGreInput, items: [] })
      .expect(400)
      .expect((response) => {
        expect(response.body.error).toBe('VALIDATION_ERROR');
      });
  });
});
