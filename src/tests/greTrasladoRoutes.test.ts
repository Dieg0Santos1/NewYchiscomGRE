import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { createApp } from '../app.js';
import { testConfig } from './fixtures.js';
import type { GreTrasladoInputDto } from '../schemas/greTrasladoInputSchema.js';

const operationId = '22222222-2222-4222-8222-222222222222';

const validTrasladoInput: GreTrasladoInputDto = {
  serieNumeroGuia: 'T002-00000001',
  referenciaInterna: 'ACTIVOS',
  fechaEmisionGuia: '2026-09-01',
  horaEmisionGuia: '10:00:00',
  fechaInicioTraslado: '2026-09-01',
  fechaEntregaBienes: '2026-09-01',
  observaciones: 'TRASLADO DE BIENES NO REGISTRADOS',
  correoDestinatario: '-',
  destinatario: {
    tipoDocumentoDestinatario: '6',
    numeroDocumentoDestinatario: '20111111111',
    razonSocialDestinatario: 'CLIENTE TRASLADO S.A.C.'
  },
  traslado: {
    motivoTraslado: '03',
    descripcionMotivoTraslado: 'OTROS',
    pesoBrutoTotalBienes: 8,
    unidadMedidaPesoBruto: 'KGM',
    modalidadTraslado: '02',
    numeroBultos: 1,
    ubigeoPtoLlegada: '150101',
    direccionPtoLlegada: 'DIRECCION DE LLEGADA',
    codigoPtoLlegada: '1'
  },
  conductor: {
    tipoDocumentoConductor: '1',
    numeroDocumentoConductor: '12345678',
    nombreConductor: 'NOMBRES',
    apellidoConductor: 'APELLIDOS',
    numeroLicencia: 'Q12345678'
  },
  vehiculo: {
    numeroPlacaVehiculoPrin: 'ABC123'
  },
  items: [
    {
      codigoEmpaque: 0,
      codigoProducto: 'TRAS-001',
      descripcion: 'LAPTOP LENOVO COLOR NEGRO',
      cantidad: 1,
      cantidadOriginal: 1,
      cantidadPendiente: 0,
      unidadMedida: 'NIU',
      moneda: '-100',
      importeUnitarioSinImpuesto: 1,
      id: 'TRAS-001'
    }
  ]
};

describe('GRE Traslado routes', () => {
  it('genera preview T002 con motivo 03 sin llamar declaracion', async () => {
    const declarar = vi.fn();
    const app = createApp({
      config: { ...testConfig, dryRun: true, directDbInsertEnabled: false },
      greTrasladoService: {
        getNextSerie: vi.fn(),
        listTraslados: vi.fn(),
        getTrasladoPdfUrl: vi.fn(),
        declarar
      }
    });

    await request(app)
      .post('/api/gre-traslados/preview')
      .send(validTrasladoInput)
      .expect(200)
      .expect((response) => {
        expect(response.body.ok).toBe(true);
        expect(response.body.writesDatabase).toBe(false);
        expect(response.body.payload.serieNumeroGuia).toBe('T002-00000001');
        expect(response.body.payload.motivoTraslado).toBe('03');
        expect(response.body.payload.spE_DESPATCH_ITEM[0]).toMatchObject({
          codigoProducto: 'TRAS-001',
          unidadMedida: 'NIU',
          descripcion: 'LAPTOP LENOVO COLOR NEGRO'
        });
      });

    expect(declarar).not.toHaveBeenCalled();
  });

  it('rechaza series que no sean T002', async () => {
    const app = createApp({
      config: { ...testConfig, dryRun: true, directDbInsertEnabled: false },
      greTrasladoService: {
        getNextSerie: vi.fn(),
        listTraslados: vi.fn(),
        getTrasladoPdfUrl: vi.fn(),
        declarar: vi.fn()
      }
    });

    await request(app)
      .post('/api/gre-traslados/preview')
      .send({ ...validTrasladoInput, serieNumeroGuia: 'T001-00000001' })
      .expect(400)
      .expect((response) => {
        expect(response.body.error).toBe('VALIDATION_ERROR');
      });
  });

  it('genera preview T002 con transporte publico y datos de transportista', async () => {
    const declarar = vi.fn();
    const publicoInput: GreTrasladoInputDto = {
      ...validTrasladoInput,
      traslado: {
        ...validTrasladoInput.traslado,
        modalidadTraslado: '01',
        motivoTraslado: '03',
        descripcionMotivoTraslado: 'OTROS'
      },
      conductor: undefined,
      vehiculo: undefined,
      transportista: {
        tipoDocumentoTransportista: '6',
        numeroRucTransportista: '20555555555',
        razonSocialTransportista: 'TRANSPORTES PRUEBA S.A.C.'
      }
    };
    const app = createApp({
      config: { ...testConfig, dryRun: true, directDbInsertEnabled: false },
      greTrasladoService: {
        getNextSerie: vi.fn(),
        listTraslados: vi.fn(),
        getTrasladoPdfUrl: vi.fn(),
        declarar
      }
    });

    await request(app)
      .post('/api/gre-traslados/preview')
      .send(publicoInput)
      .expect(200)
      .expect((response) => {
        expect(response.body.payload.modalidadTraslado).toBe('01');
        expect(response.body.payload.motivoTraslado).toBe('03');
        expect(response.body.payload.numeroRucTransportista).toBe('20555555555');
        expect(response.body.payload.razonSocialTransportista).toBe('TRANSPORTES PRUEBA S.A.C.');
        expect(response.body.payload.numeroDocumentoConductor).toBe('');
        expect(response.body.payload.numeroPlacaVehiculoPrin).toBe('');
      });

    expect(declarar).not.toHaveBeenCalled();
  });

  it('rechaza motivos de traslado no habilitados para T002', async () => {
    const app = createApp({
      config: { ...testConfig, dryRun: true, directDbInsertEnabled: false },
      greTrasladoService: {
        getNextSerie: vi.fn(),
        listTraslados: vi.fn(),
        getTrasladoPdfUrl: vi.fn(),
        declarar: vi.fn()
      }
    });

    await request(app)
      .post('/api/gre-traslados/preview')
      .send({
        ...validTrasladoInput,
        traslado: {
          ...validTrasladoInput.traslado,
          motivoTraslado: '04',
          descripcionMotivoTraslado: 'TRASLADO ENTRE ESTABLECIMIENTOS DE LA MISMA EMPRESA'
        }
      })
      .expect(400)
      .expect((response) => {
        expect(response.body.error).toBe('VALIDATION_ERROR');
      });
  });

  it('rechaza motivo 02 compra cuando destinatario no es el remitente', async () => {
    const app = createApp({
      config: { ...testConfig, dryRun: true, directDbInsertEnabled: false },
      greTrasladoService: {
        getNextSerie: vi.fn(),
        listTraslados: vi.fn(),
        getTrasladoPdfUrl: vi.fn(),
        declarar: vi.fn()
      }
    });

    await request(app)
      .post('/api/gre-traslados/preview')
      .send({
        ...validTrasladoInput,
        traslado: {
          ...validTrasladoInput.traslado,
          motivoTraslado: '02',
          descripcionMotivoTraslado: 'COMPRA'
        },
        destinatario: {
          tipoDocumentoDestinatario: '1',
          numeroDocumentoDestinatario: '10406265574',
          razonSocialDestinatario: 'DESTINATARIO INCORRECTO'
        }
      })
      .expect(400)
      .expect((response) => {
        expect(response.body.error).toBe('VALIDATION_ERROR');
        expect(response.body.issues[0].message).toContain('02 - COMPRA');
      });
  });

  it('permite motivo 02 compra cuando destinatario es el remitente', async () => {
    const app = createApp({
      config: { ...testConfig, dryRun: true, directDbInsertEnabled: false },
      greTrasladoService: {
        getNextSerie: vi.fn(),
        listTraslados: vi.fn(),
        getTrasladoPdfUrl: vi.fn(),
        declarar: vi.fn()
      }
    });

    await request(app)
      .post('/api/gre-traslados/preview')
      .send({
        ...validTrasladoInput,
        traslado: {
          ...validTrasladoInput.traslado,
          motivoTraslado: '02',
          descripcionMotivoTraslado: 'COMPRA'
        },
        destinatario: {
          tipoDocumentoDestinatario: testConfig.remitente.tipoDocumento,
          numeroDocumentoDestinatario: testConfig.remitente.numeroDocumento,
          razonSocialDestinatario: testConfig.remitente.razonSocial
        }
      })
      .expect(200)
      .expect((response) => {
        expect(response.body.payload.motivoTraslado).toBe('02');
        expect(response.body.payload.numeroDocumentoDestinatario).toBe(testConfig.remitente.numeroDocumento);
      });
  });

  it('rechaza transporte publico sin transportista', async () => {
    const app = createApp({
      config: { ...testConfig, dryRun: true, directDbInsertEnabled: false },
      greTrasladoService: {
        getNextSerie: vi.fn(),
        listTraslados: vi.fn(),
        getTrasladoPdfUrl: vi.fn(),
        declarar: vi.fn()
      }
    });

    await request(app)
      .post('/api/gre-traslados/preview')
      .send({
        ...validTrasladoInput,
        traslado: {
          ...validTrasladoInput.traslado,
          modalidadTraslado: '01'
        },
        conductor: undefined,
        vehiculo: undefined
      })
      .expect(400)
      .expect((response) => {
        expect(response.body.error).toBe('VALIDATION_ERROR');
        expect(JSON.stringify(response.body.issues)).toContain('transportista');
      });
  });

  it('bloquea declaracion cuando DRY_RUN=true', async () => {
    const declarar = vi.fn();
    const app = createApp({
      config: { ...testConfig, dryRun: true, directDbInsertEnabled: true },
      greTrasladoService: {
        getNextSerie: vi.fn(),
        listTraslados: vi.fn(),
        getTrasladoPdfUrl: vi.fn(),
        declarar
      }
    });

    await request(app)
      .post('/api/gre-traslados/declarar')
      .set('X-Confirm-Send', 'YES')
      .set('X-Operation-Id', operationId)
      .send(validTrasladoInput)
      .expect(403)
      .expect((response) => {
        expect(response.body.error).toBe('SEND_DISABLED_DRY_RUN');
      });

    expect(declarar).not.toHaveBeenCalled();
  });

  it('requiere X-Operation-Id UUID para declaracion', async () => {
    const declarar = vi.fn();
    const app = createApp({
      config: { ...testConfig, dryRun: false, directDbInsertEnabled: true },
      greTrasladoService: {
        getNextSerie: vi.fn(),
        listTraslados: vi.fn(),
        getTrasladoPdfUrl: vi.fn(),
        declarar
      }
    });

    await request(app)
      .post('/api/gre-traslados/declarar')
      .set('X-Confirm-Send', 'YES')
      .send(validTrasladoInput)
      .expect(400)
      .expect((response) => {
        expect(response.body.error).toBe('OPERATION_ID_REQUIRED');
      });

    expect(declarar).not.toHaveBeenCalled();
  });

  it('con candados abiertos delega al servicio T002', async () => {
    const declarar = vi.fn().mockResolvedValue({
      operationId,
      reused: false,
      generatedSerieNumeroGuia: 'T002-00000001',
      insertedHeader: true,
      insertedItems: 1,
      activated: true,
      status: {
        serieNumeroGuia: 'T002-00000001',
        bl_estadoRegistro: 'A'
      }
    });
    const app = createApp({
      config: { ...testConfig, dryRun: false, directDbInsertEnabled: true },
      greTrasladoService: {
        getNextSerie: vi.fn(),
        listTraslados: vi.fn(),
        getTrasladoPdfUrl: vi.fn(),
        declarar
      }
    });

    await request(app)
      .post('/api/gre-traslados/declarar')
      .set('X-Confirm-Send', 'YES')
      .set('X-Operation-Id', operationId)
      .set('X-User', 'qa-traslado')
      .send(validTrasladoInput)
      .expect(200)
      .expect((response) => {
        expect(response.body.ok).toBe(true);
        expect(response.body.generatedSerieNumeroGuia).toBe('T002-00000001');
        expect(response.body.activated).toBe(true);
      });

    expect(declarar).toHaveBeenCalledWith(validTrasladoInput, {
      operationId,
      user: 'qa-traslado'
    });
  });

  it('redirige al PDF de Bizlinks para guias T002 trazadas', async () => {
    const getTrasladoPdfUrl = vi.fn().mockResolvedValue('https://sfeintegrador.bizlinks.com.pe/pdf/T002-00000001.pdf');
    const app = createApp({
      config: testConfig,
      greTrasladoService: {
        getNextSerie: vi.fn(),
        listTraslados: vi.fn(),
        getTrasladoPdfUrl,
        declarar: vi.fn()
      }
    });

    await request(app)
      .get('/api/gre-traslados/T002-00000001/pdf')
      .expect(302)
      .expect('Location', 'https://sfeintegrador.bizlinks.com.pe/pdf/T002-00000001.pdf');

    expect(getTrasladoPdfUrl).toHaveBeenCalledWith('T002-00000001');
  });

  it('bloquea aceptacion manual T002 sin cabeceras de confirmacion', async () => {
    const setAcceptedMessage = vi.fn();
    const app = createApp({
      config: { ...testConfig, dryRun: false, directDbInsertEnabled: true },
      greTrasladoService: {
        getNextSerie: vi.fn(),
        listTraslados: vi.fn(),
        getTrasladoPdfUrl: vi.fn(),
        declarar: vi.fn()
      },
      greTrasladoManualSunatService: {
        setAcceptedMessage
      }
    });

    await request(app)
      .post('/api/gre-traslados/T002-00000001/manual-sunat-accepted')
      .send({})
      .expect(403)
      .expect((response) => {
        expect(response.body.error).toBe('MANUAL_SUNAT_CONFIRMATION_REQUIRED');
      });

    expect(setAcceptedMessage).not.toHaveBeenCalled();
  });

  it('con confirmacion delega aceptacion manual T002 al servicio', async () => {
    const setAcceptedMessage = vi.fn().mockResolvedValue({
      operationId,
      serieNumeroGuia: 'T002-00000001',
      reused: false,
      updated: true,
      message: '{"codigo":"0","mensaje":"El Comprobante numero T002-00000001, ha sido aceptado"}',
      before: {},
      after: {}
    });
    const app = createApp({
      config: { ...testConfig, dryRun: false, directDbInsertEnabled: true },
      greTrasladoService: {
        getNextSerie: vi.fn(),
        listTraslados: vi.fn(),
        getTrasladoPdfUrl: vi.fn(),
        declarar: vi.fn()
      },
      greTrasladoManualSunatService: {
        setAcceptedMessage
      }
    });

    await request(app)
      .post('/api/gre-traslados/T002-00000001/manual-sunat-accepted')
      .set('X-Confirm-Manual-Sunat', 'YES')
      .set('X-User', 'qa-traslado')
      .send({})
      .expect(200)
      .expect((response) => {
        expect(response.body.ok).toBe(true);
        expect(response.body.updated).toBe(true);
        expect(response.body.serieNumeroGuia).toBe('T002-00000001');
      });

    expect(setAcceptedMessage).toHaveBeenCalledWith('T002-00000001', {
      user: 'qa-traslado'
    });
  });
});
