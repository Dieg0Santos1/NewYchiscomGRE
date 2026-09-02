import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { createApp } from '../app.js';
import { testConfig } from './fixtures.js';

function createService(writeEnabled = false) {
  return {
    capabilities: vi.fn(() => ({ writeEnabled })),
    searchClients: vi.fn().mockResolvedValue([]),
    searchWorkOrders: vi.fn().mockResolvedValue([]),
    searchReceptions: vi.fn().mockResolvedValue([]),
    createPreGuide: vi.fn().mockResolvedValue({ idRecepcionOT: 10 }),
    acceptPreGuide: vi.fn().mockResolvedValue({ idRecepcionOT: 10 }),
    createInternalGuide: vi.fn().mockResolvedValue({ serieNumero: '001-0000001' })
  };
}

describe('fcLegacyWorkflowRoutes', () => {
  it('expone el modo de solo lectura', async () => {
    const service = createService(false);
    const app = createApp({ config: testConfig, fcLegacyWorkflowService: service });

    const response = await request(app).get('/api/fc-legacy/capabilities');

    expect(response.status).toBe(200);
    expect(response.body.writeEnabled).toBe(false);
  });

  it('busca clientes disponibles para pre-guia', async () => {
    const service = createService(false);
    const app = createApp({ config: testConfig, fcLegacyWorkflowService: service });

    const response = await request(app).get('/api/fc-legacy/clients?q=ALICORP');

    expect(response.status).toBe(200);
    expect(service.searchClients).toHaveBeenCalledWith('ALICORP');
  });

  it('filtra OT y recepciones por cliente seleccionado', async () => {
    const service = createService(false);
    const app = createApp({ config: testConfig, fcLegacyWorkflowService: service });

    await request(app).get('/api/fc-legacy/work-orders?q=OT&idClieProv=25');
    await request(app).get('/api/fc-legacy/receptions?q=OT&state=ready&idClieProv=25');

    expect(service.searchWorkOrders).toHaveBeenCalledWith('OT', 25);
    expect(service.searchReceptions).toHaveBeenCalledWith('OT', 'ready', 25);
  });

  it('rechaza una escritura sin confirmacion explicita', async () => {
    const service = createService(true);
    const app = createApp({ config: testConfig, fcLegacyWorkflowService: service });

    const response = await request(app).post('/api/fc-legacy/pre-guides').send({
      numeroOt: 'OT02600674', cantidad: 1, del: '1', al: '1'
    });

    expect(response.status).toBe(403);
    expect(service.createPreGuide).not.toHaveBeenCalled();
  });

  it('envia al wrapper solo un payload validado y confirmado', async () => {
    const service = createService(true);
    const app = createApp({ config: testConfig, fcLegacyWorkflowService: service });
    const payload = { numeroOt: 'OT02600674', cantidad: 1, del: '1', al: '1' };

    const response = await request(app)
      .post('/api/fc-legacy/pre-guides')
      .set('X-Confirm-Legacy-Write', 'YES')
      .send(payload);

    expect(response.status).toBe(200);
    expect(service.createPreGuide).toHaveBeenCalledWith(payload);
  });
});
