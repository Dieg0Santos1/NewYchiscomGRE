import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { createApp } from '../app.js';
import { testConfig } from './fixtures.js';
import type { FlexoService } from '../services/flexoService.js';

function createFlexoServiceMock(overrides: Partial<FlexoService> = {}): FlexoService {
  return {
    searchClientes: vi.fn(),
    listDestinos: vi.fn(),
    listEmpaques: vi.fn(),
    getNextSerie: vi.fn(),
    previewGuia: vi.fn(),
    searchEmpaqueAdjustments: vi.fn().mockResolvedValue([]),
    updateEmpaqueUnidad: vi.fn().mockResolvedValue({
      codigoEmpaque: 7449,
      codigoProducto: '0092-0007',
      unidadAnterior: 'Rolls',
      unidadNueva: 'NIU',
      updated: true
    }),
    ...overrides
  };
}

describe('Flexo adjustment routes', () => {
  it('busca empaques para ajuste de unidad', async () => {
    const service = createFlexoServiceMock({
      searchEmpaqueAdjustments: vi.fn().mockResolvedValue([
        {
          id: '7449-0092-0007',
          codigoEmpaque: 7449,
          codigoProducto: '0092-0007',
          descripcion: 'ETIQUETA',
          cantidad: 100,
          unidadMedida: 'Rolls',
          moneda: '1',
          ordenGuia: '',
          ordenFactura: '',
          ticket: '',
          ordenCompra: '',
          clienteNumeroDocumento: '20111111111',
          clienteRazonSocial: 'CLIENTE FLEXO',
          guiaRemision: null,
          guiaFactura: null
        }
      ])
    });

    const app = createApp({
      config: { ...testConfig, auth: { ...testConfig.auth, enabled: false } },
      flexoService: service
    });

    await request(app)
      .get('/api/flexo/ajustes/empaques?q=7449')
      .expect(200)
      .expect((response) => {
        expect(response.body.empaques).toHaveLength(1);
        expect(response.body.empaques[0].unidadMedida).toBe('Rolls');
      });

    expect(service.searchEmpaqueAdjustments).toHaveBeenCalledWith('7449');
  });

  it('actualiza la unidad de medida de un empaque', async () => {
    const service = createFlexoServiceMock();
    const app = createApp({
      config: { ...testConfig, auth: { ...testConfig.auth, enabled: false } },
      flexoService: service
    });

    await request(app)
      .patch('/api/flexo/ajustes/empaques/7449/0092-0007/unidad-medida')
      .send({ unidadMedida: 'NIU' })
      .expect(200)
      .expect((response) => {
        expect(response.body.updated).toBe(true);
        expect(response.body.unidadNueva).toBe('NIU');
      });

    expect(service.updateEmpaqueUnidad).toHaveBeenCalledWith({
      codigoEmpaque: 7449,
      codigoProducto: '0092-0007',
      unidadMedida: 'NIU'
    });
  });
});
