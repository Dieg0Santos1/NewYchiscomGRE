import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { createApp } from '../app.js';
import { testConfig } from './fixtures.js';
import type { FlexoService } from '../services/flexoService.js';

function createFlexoServiceMock(overrides: Partial<FlexoService> = {}): FlexoService {
  return {
    listCatalogs: vi.fn().mockResolvedValue({
      warnings: [],
      choferes: [],
      motivos: [],
      origenes: [],
      transportistas: [],
      detracciones: [],
      empresas: [],
      tiposDocumento: []
    }),
    listReports: vi.fn().mockResolvedValue({
      generatedAt: new Date(0).toISOString(),
      guias: [],
      facturas: [],
      bajas: [],
      warnings: []
    }),
    getGuidePdfUrl: vi.fn(),
    setManualSunatAcceptedMessage: vi.fn(),
    getInvoicePdfUrl: vi.fn(),
    searchClientes: vi.fn(),
    listDestinos: vi.fn(),
    listEmpaques: vi.fn(),
    getNextSerie: vi.fn(),
    previewGuia: vi.fn(),
    prepareGuia: vi.fn(),
    declareGuia: vi.fn(),
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
  it('expone reportes Flexo read-only', async () => {
    const service = createFlexoServiceMock({
      listReports: vi.fn().mockResolvedValue({
        generatedAt: new Date(0).toISOString(),
        guias: [
          {
            tipo: 'GRE',
            serieNumero: 'T003-00005443',
            fecha: '2026-09-16',
            clienteDocumento: '20600876491',
            clienteNombre: 'WESTFALIA',
            estado: 'ACEPTADA',
            estadoBizlinks: 'L',
            estadoProceso: 'SIGNED/AC_03',
            mensaje: '',
            pdfDisponible: true,
            empaques: 1,
            items: 1,
            itemsFacturados: 1,
            trazabilidadPortal: false,
            manualSunatMessageAllowed: false
          }
        ],
        facturas: [],
        bajas: [],
        warnings: []
      })
    });

    const app = createApp({
      config: { ...testConfig, auth: { ...testConfig.auth, enabled: false } },
      flexoService: service
    });

    await request(app)
      .get('/api/flexo/reportes')
      .expect(200)
      .expect((response) => {
        expect(response.body.guias[0].serieNumero).toBe('T003-00005443');
        expect(response.body.facturas).toHaveLength(0);
      });

    expect(service.listReports).toHaveBeenCalledOnce();
  });

  it('expone catalogos Flexo read-only con warnings por fuente', async () => {
    const service = createFlexoServiceMock({
      listCatalogs: vi.fn().mockResolvedValue({
        warnings: [
          {
            source: 'MOTIVOS',
            message: 'The SELECT permission was denied.'
          }
        ],
        choferes: [
          {
            id: '09520763',
            tipoDocumento: '1',
            numeroDocumento: '09520763',
            nombres: 'JUAN',
            apellidos: 'PEREZ',
            licencia: 'Q12345678',
            placa: 'ABC123'
          }
        ],
        motivos: [],
        origenes: [],
        transportistas: [],
        detracciones: [],
        empresas: [],
        tiposDocumento: []
      })
    });

    const app = createApp({
      config: { ...testConfig, auth: { ...testConfig.auth, enabled: false } },
      flexoService: service
    });

    await request(app)
      .get('/api/flexo/catalogos')
      .expect(200)
      .expect((response) => {
        expect(response.body.choferes).toHaveLength(1);
        expect(response.body.warnings[0].source).toBe('MOTIVOS');
      });

    expect(service.listCatalogs).toHaveBeenCalledOnce();
  });

  it('guarda preparacion de GRE Flexo sin declarar en Bizlinks', async () => {
    const payload = {
      serieNumeroGuia: 'T003-00005444',
      fechaEmision: '2026-09-16T10:00',
      fechaTraslado: '2026-09-16',
      cliente: {
        tipoDocumento: '6',
        numeroDocumento: '20600876491',
        razonSocial: 'CLIENTE FLEXO'
      },
      destino: {
        id: '150101-1',
        ubigeo: '150101',
        direccion: 'AV. DESTINO'
      },
      modalidadTraslado: '02',
      motivoTraslado: '01',
      descripcionMotivoTraslado: 'VENTA',
      pesoBruto: 12,
      unidadPeso: 'KGM',
      numeroBultos: 1,
      ordenCompra: 'OC-1',
      observaciones: '',
      conductor: {
        tipoDocumento: '1',
        numeroDocumento: '09520763',
        nombres: 'JUAN',
        apellidos: 'PEREZ',
        licencia: 'Q12345678',
        placa: 'ABC123'
      },
      empaques: []
    };
    const service = createFlexoServiceMock({
      prepareGuia: vi.fn().mockResolvedValue({
        operationId: '11111111-1111-1111-1111-111111111111',
        operacionDbId: 10,
        serieNumeroGuia: 'T003-00005444',
        estado: 'BORRADOR',
        reused: false,
        insertedItems: 1,
        writesBizlinks: false,
        writesEmpaqueDetalle: false,
        message: 'Preparacion guardada. No se escribio en Bizlinks ni EMPAQUE_DETALLE.'
      })
    });
    const app = createApp({
      config: { ...testConfig, auth: { ...testConfig.auth, enabled: false } },
      flexoService: service
    });

    await request(app)
      .post('/api/flexo/guias/preparar')
      .send(payload)
      .expect(200)
      .expect((response) => {
        expect(response.body.estado).toBe('BORRADOR');
        expect(response.body.writesBizlinks).toBe(false);
        expect(response.body.writesEmpaqueDetalle).toBe(false);
      });

    expect(service.prepareGuia).toHaveBeenCalledWith(payload);
  });

  it('declara GRE Flexo con SP oficiales', async () => {
    const payload = {
      serieNumeroGuia: 'T003-00005564',
      fechaEmision: '2026-09-30T12:05',
      fechaTraslado: '2026-09-30',
      cliente: {
        tipoDocumento: '6',
        numeroDocumento: '10406265574',
        razonSocial: 'ORLANDO BORITZ LLERENA DELGADO'
      },
      destino: {
        id: '150101-1',
        ubigeo: '150101',
        direccion: 'AV. TOMAS VALLE'
      },
      modalidadTraslado: '02',
      motivoTraslado: '01',
      descripcionMotivoTraslado: 'VENTA',
      pesoBruto: 1,
      unidadPeso: 'KGM',
      numeroBultos: 1,
      ordenCompra: '',
      observaciones: 'PRUEBA',
      conductor: {
        tipoDocumento: '1',
        numeroDocumento: '09517108',
        nombres: 'JUAN JOSE',
        apellidos: 'APARICIO HERRERA',
        licencia: 'Q09517108',
        placa: 'A45895'
      },
      empaques: []
    };
    const service = createFlexoServiceMock({
      declareGuia: vi.fn().mockResolvedValue({
        operationId: '584d263b-71de-4c43-be7d-b345439eebeb',
        operacionDbId: 1,
        serieNumeroGuia: 'T003-00005564',
        estado: 'ENVIADO',
        reused: false,
        insertedItems: 1,
        linkedItems: 1,
        correlativo: 5564,
        status: { itemCount: 1 },
        message: 'GRE T003-00005564 declarada y enviada a Bizlinks.'
      })
    });
    const app = createApp({
      config: { ...testConfig, auth: { ...testConfig.auth, enabled: false } },
      flexoService: service
    });

    await request(app)
      .post('/api/flexo/guias/declarar')
      .send(payload)
      .expect(200)
      .expect((response) => {
        expect(response.body.estado).toBe('ENVIADO');
        expect(response.body.linkedItems).toBe(1);
        expect(response.body.correlativo).toBe(5564);
      });

    expect(service.declareGuia).toHaveBeenCalledWith(payload);
  });

  it('redirige al PDF de una GRE Flexo aceptada', async () => {
    const getGuidePdfUrl = vi.fn().mockResolvedValue('https://sfeintegrador.bizlinks.com.pe/pdf/T003-00005563.pdf');
    const service = createFlexoServiceMock({ getGuidePdfUrl });
    const app = createApp({
      config: { ...testConfig, auth: { ...testConfig.auth, enabled: false } },
      flexoService: service
    });

    await request(app)
      .get('/api/flexo/guias/T003-00005563/pdf')
      .expect(302)
      .expect('Location', 'https://sfeintegrador.bizlinks.com.pe/pdf/T003-00005563.pdf');

    expect(getGuidePdfUrl).toHaveBeenCalledWith('T003-00005563');
  });

  it('bloquea aceptacion manual SUNAT Flexo sin confirmacion explicita', async () => {
    const setManualSunatAcceptedMessage = vi.fn();
    const service = createFlexoServiceMock({ setManualSunatAcceptedMessage });
    const app = createApp({
      config: {
        ...testConfig,
        auth: { ...testConfig.auth, enabled: false },
        dryRun: false,
        directDbInsertEnabled: true
      },
      flexoService: service
    });

    await request(app)
      .post('/api/flexo/guias/T003-00005611/manual-sunat-accepted')
      .send({})
      .expect(403)
      .expect((response) => {
        expect(response.body.error).toBe('MANUAL_SUNAT_CONFIRMATION_REQUIRED');
      });

    expect(setManualSunatAcceptedMessage).not.toHaveBeenCalled();
  });

  it('registra aceptacion manual SUNAT Flexo con confirmacion', async () => {
    const setManualSunatAcceptedMessage = vi.fn().mockResolvedValue({
      operationId: 'operation-id',
      serieNumeroGuia: 'T003-00005611',
      reused: false,
      updated: true,
      message: '{"codigo":"0","mensaje":"El Comprobante numero T003-00005611, ha sido aceptado"}'
    });
    const service = createFlexoServiceMock({ setManualSunatAcceptedMessage });
    const app = createApp({
      config: {
        ...testConfig,
        auth: { ...testConfig.auth, enabled: false },
        dryRun: false,
        directDbInsertEnabled: true
      },
      flexoService: service
    });

    await request(app)
      .post('/api/flexo/guias/T003-00005611/manual-sunat-accepted')
      .set('X-Confirm-Manual-Sunat', 'YES')
      .set('X-User', 'test-user')
      .send({})
      .expect(200)
      .expect((response) => {
        expect(response.body.updated).toBe(true);
        expect(response.body.serieNumeroGuia).toBe('T003-00005611');
      });

    expect(setManualSunatAcceptedMessage).toHaveBeenCalledWith('T003-00005611', {
      user: 'test-user'
    });
  });

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
