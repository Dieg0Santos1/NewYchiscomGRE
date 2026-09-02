import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { createApp } from '../app.js';
import { ExistingGreClientError } from '../integrations/existingGreClient.js';
import { testConfig, validGreInput } from './fixtures.js';

describe('send-test guards', () => {
  it('bloquea send-test cuando DRY_RUN=true', async () => {
    const declareGre = vi.fn();
    const app = createApp({
      config: { ...testConfig, dryRun: true },
      existingGreClient: { declareGre, getDestinos: vi.fn() }
    });

    await request(app)
      .post('/api/gre/send-test')
      .set('X-Confirm-Send', 'YES')
      .send(validGreInput)
      .expect(403)
      .expect((response) => {
        expect(response.body.error).toBe('SEND_DISABLED_DRY_RUN');
      });

    expect(declareGre).not.toHaveBeenCalled();
  });

  it('bloquea send-test sin X-Confirm-Send YES cuando DRY_RUN=false', async () => {
    const declareGre = vi.fn();
    const app = createApp({
      config: { ...testConfig, dryRun: false },
      existingGreClient: { declareGre, getDestinos: vi.fn() }
    });

    await request(app)
      .post('/api/gre/send-test')
      .send(validGreInput)
      .expect(403)
      .expect((response) => {
        expect(response.body.error).toBe('SEND_CONFIRMATION_REQUIRED');
      });

    expect(declareGre).not.toHaveBeenCalled();
  });

  it('con DRY_RUN=false y confirmacion, usa solamente el cliente inyectado en pruebas', async () => {
    const declareGre = vi.fn().mockResolvedValue({ ok: true });
    const app = createApp({
      config: { ...testConfig, dryRun: false },
      existingGreClient: { declareGre, getDestinos: vi.fn() }
    });

    await request(app)
      .post('/api/gre/send-test')
      .set('X-Confirm-Send', 'YES')
      .send(validGreInput)
      .expect(200)
      .expect((response) => {
        expect(response.body.sent).toBe(true);
        expect(response.body.response).toEqual({ ok: true });
      });

    expect(declareGre).toHaveBeenCalledTimes(1);
  });

  it('rechaza serie no T001 aun con DRY_RUN=false y confirmacion', async () => {
    const declareGre = vi.fn();
    const app = createApp({
      config: { ...testConfig, dryRun: false },
      existingGreClient: { declareGre, getDestinos: vi.fn() }
    });

    await request(app)
      .post('/api/gre/send-test')
      .set('X-Confirm-Send', 'YES')
      .send({ ...validGreInput, serieNumeroGuia: 'T003-00000093' })
      .expect(400)
      .expect((response) => {
        expect(response.body.error).toBe('VALIDATION_ERROR');
      });

    expect(declareGre).not.toHaveBeenCalled();
  });

  it('sanitiza errores devueltos por el cliente de la API existente', async () => {
    const secret = 'SECRET_TOKEN_FOR_TEST';
    const declareGre = vi.fn().mockRejectedValue(
      new ExistingGreClientError('Fallo remoto con SECRET_TOKEN_FOR_TEST', 502, {
        token: secret,
        detail: `respuesta con ${secret}`
      })
    );
    const app = createApp({
      config: { ...testConfig, dryRun: false, existingGreApiToken: secret },
      existingGreClient: { declareGre, getDestinos: vi.fn() }
    });

    await request(app)
      .post('/api/gre/send-test')
      .set('X-Confirm-Send', 'YES')
      .send(validGreInput)
      .expect(502)
      .expect((response) => {
        const serialized = JSON.stringify(response.body);

        expect(response.body.error).toBe('EXISTING_GRE_API_ERROR');
        expect(serialized).not.toContain(secret);
        expect(serialized).toContain('[REDACTED]');
      });
  });
});
