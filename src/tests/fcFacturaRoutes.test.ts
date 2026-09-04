import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { createApp } from '../app.js';
import { testConfig } from './fixtures.js';
import type { FcFacturaService } from '../services/fcFacturaService.js';

const fcFacturaService: FcFacturaService = {
  searchClientes: vi.fn().mockResolvedValue([
    {
      id: '6-20111111111',
      tipoDocumento: '6',
      numeroDocumento: '20111111111',
      razonSocial: 'CLIENTE FACTURA S.A.C.',
      fuente: 'GRE_FC'
    }
  ]),
  getNextSerie: vi.fn().mockResolvedValue({
    serie: 'FF01',
    numero: '00000001',
    serieNumeroFactura: 'FF01-00000001',
    reserved: false,
    source: 'BIZLINKS_SPE_EINVOICEHEADER'
  }),
  listCuentas: vi.fn().mockResolvedValue({
    warnings: [],
    cuentas: [
      {
        id: '7022111',
        cuenta: '7022111',
        denominacion: 'PRODUCTOS TERMINADOS - OFFSET',
        label: 'PRODUCTOS TERMINADOS - OFFSET-7022111',
        fuente: 'VIEW_CUENTAS_FACTURA'
      }
    ]
  }),
  listFormasPago: vi.fn().mockResolvedValue([
    {
      id: '5',
      nombre: 'Contado C/E',
      valor: 'Contado C/E',
      dias: 0
    }
  ]),
  listGuiasPendientes: vi.fn().mockResolvedValue({
    warnings: ['Validacion de no duplicidad aplicada contra fuentes disponibles.'],
    vendedor: {
      idEmpleado: 91,
      nombre: 'JUNIOR BUSTAMANTE'
    },
    guias: [
      {
        operationId: '11111111-1111-4111-8111-111111111111',
        serieNumeroGuia: 'T001-00000023',
        fecha: '2026-08-12T12:00:00.000Z',
        cliente: {
          tipoDocumento: '6',
          numeroDocumento: '20111111111',
          razonSocial: 'CLIENTE FACTURA S.A.C.'
        },
        estadoSunat: 'ACEPTADA',
        items: [
          {
            id: 'T001-00000023-1',
            serieNumeroGuia: 'T001-00000023',
            codigoProducto: 'PROD001',
            descripcion: 'PRODUCTO FC',
            cantidad: 2,
            unidadMedida: 'UND',
            precioUnitario: 0,
            afectoIgv: true
          }
        ]
      }
    ]
  }),
  preview: vi.fn().mockResolvedValue({
    writesDatabase: false,
    productionEnabled: true,
    serieNumeroFactura: 'FF01-00000000',
    totals: {
      gravada: 20,
      igv: 3.6,
      total: 23.6
    },
    validations: [
      {
        code: 'PREVIEW_SIN_ESCRITURA',
        severity: 'ok',
        message: 'La vista previa no escribe en base de datos.'
      }
    ],
    payload: {},
    procedurePlan: {
      USP_CabeceraFE: [],
      USP_DetalleFE: [],
      USP_EnviaDocumentoFE: []
    }
  }),
  declarar: vi.fn().mockResolvedValue({
    operationId: '11111111-1111-4111-8111-111111111111',
    reused: false,
    serieNumeroFactura: 'FF01-00000001',
    insertedHeader: true,
    insertedItems: 1,
    activated: true,
    status: {
      header: {},
      response: null,
      headerCount: 1,
      itemCount: 1,
      responseCount: 0
    }
  }),
  listFacturas: vi.fn().mockResolvedValue([
    {
      operationId: '11111111-1111-4111-8111-111111111111',
      serieNumeroFactura: 'FF01-00000001',
      creadoEn: '2026-08-12T12:00:00.000Z',
      cliente: 'CLIENTE FACTURA S.A.C.',
      numeroDocumentoCliente: '20111111111',
      estadoOperacion: 'ACTIVADO',
      estadoEnvio: 'ACTIVADO',
      estadoBizlinks: 'A',
      estadoProceso: null,
      mensaje: null,
      total: 23.6,
      items: 1,
      pdfDisponible: true
    }
  ]),
  getFacturaPdf: vi.fn().mockResolvedValue({
    kind: 'url',
    url: 'https://sfeintegrador.bizlinks.com.pe/pdf/FF01-00000001.pdf'
  })
};

describe('fc-facturas routes', () => {
  it('busca clientes con servicio inyectado', async () => {
    const app = createApp({ config: testConfig, fcFacturaService });

    await request(app)
      .get('/api/fc-facturas/clientes/search?q=CLIENTE')
      .expect(200)
      .expect((response) => {
        expect(response.body.ok).toBe(true);
        expect(response.body.clientes[0].numeroDocumento).toBe('20111111111');
      });
  });

  it('lista GRE pendientes aceptadas', async () => {
    const app = createApp({ config: testConfig, fcFacturaService });

    await request(app)
      .get('/api/fc-facturas/guias-pendientes?numeroDocumento=20111111111')
      .expect(200)
      .expect((response) => {
        expect(response.body.ok).toBe(true);
        expect(response.body.guias[0].serieNumeroGuia).toBe('T001-00000023');
      });
  });

  it('muestra siguiente correlativo FF01 sin reservarlo', async () => {
    const app = createApp({ config: testConfig, fcFacturaService });

    await request(app)
      .get('/api/fc-facturas/next-serie')
      .expect(200)
      .expect((response) => {
        expect(response.body.ok).toBe(true);
        expect(response.body.serieNumeroFactura).toBe('FF01-00000001');
        expect(response.body.reserved).toBe(false);
      });
  });

  it('lista catalogos de cuenta y forma de pago', async () => {
    const app = createApp({ config: testConfig, fcFacturaService });

    await request(app)
      .get('/api/fc-facturas/catalogos/cuentas')
      .expect(200)
      .expect((response) => {
        expect(response.body.ok).toBe(true);
        expect(response.body.cuentas[0].cuenta).toBe('7022111');
      });

    await request(app)
      .get('/api/fc-facturas/catalogos/formas-pago')
      .expect(200)
      .expect((response) => {
        expect(response.body.ok).toBe(true);
        expect(response.body.formasPago[0].valor).toBe('Contado C/E');
      });
  });

  it('genera preview para serie FF01 sin escritura', async () => {
    const app = createApp({ config: testConfig, fcFacturaService });

    await request(app)
      .post('/api/fc-facturas/preview')
      .send({
        serie: 'FF01',
        numero: '00000000',
        fechaEmision: '2026-08-12',
        moneda: 'PEN',
        formaPago: 'CONTADO',
        cuenta: '701',
        tipoDetraccion: '037',
        tipoExclusionProducto: 'GRAVADA',
        vendedor: {
          idEmpleado: 91,
          nombre: 'JUNIOR BUSTAMANTE'
        },
        cliente: {
          tipoDocumento: '6',
          numeroDocumento: '20111111111',
          razonSocial: 'CLIENTE FACTURA S.A.C.'
        },
        guias: [{ serieNumeroGuia: 'T001-00000023' }],
        items: [
          {
            id: 'T001-00000023-1',
            serieNumeroGuia: 'T001-00000023',
            codigoProducto: 'PROD001',
            descripcion: 'PRODUCTO FC',
            unidadMedida: 'UND',
            cantidad: 2,
            precioUnitario: 10,
            afectoIgv: true
          }
        ]
      })
      .expect(200)
      .expect((response) => {
        expect(response.body.ok).toBe(true);
        expect(response.body.writesDatabase).toBe(false);
        expect(response.body.serieNumeroFactura).toBe('FF01-00000000');
      });
  });

  it('bloquea declarar-test de facturas FC', async () => {
    const app = createApp({ config: testConfig, fcFacturaService });

    await request(app)
      .post('/api/fc-facturas/declarar-test')
      .send({})
      .expect(403)
      .expect((response) => {
        expect(response.body.error).toBe('FC_FACTURA_DECLARACION_BLOCKED');
      });
  });

  it('lista facturas declaradas FC', async () => {
    const app = createApp({ config: testConfig, fcFacturaService });

    await request(app)
      .get('/api/fc-facturas')
      .expect(200)
      .expect((response) => {
        expect(response.body.ok).toBe(true);
        expect(response.body.facturas[0].serieNumeroFactura).toBe('FF01-00000001');
      });
  });

  it('redirige al PDF de factura FC cuando esta disponible', async () => {
    const app = createApp({ config: testConfig, fcFacturaService });

    await request(app)
      .get('/api/fc-facturas/FF01-00000001/pdf')
      .expect(302)
      .expect('Location', 'https://sfeintegrador.bizlinks.com.pe/pdf/FF01-00000001.pdf');
  });

  it('solicita clientes y proveedores para el selector de destinatarios', async () => {
    const app = createApp({ config: testConfig, fcFacturaService });

    await request(app)
      .get('/api/fc-facturas/clientes/search?scope=destinatarios&q=COLTECMEC')
      .expect(200);

    expect(fcFacturaService.searchClientes).toHaveBeenLastCalledWith('COLTECMEC', true);
  });

  it('entrega directamente el PDF binario descargado por Bizlinks', async () => {
    const pdf = Buffer.from('%PDF-1.4\nPDF DE PRUEBA');
    const service: FcFacturaService = {
      ...fcFacturaService,
      getFacturaPdf: vi.fn().mockResolvedValue({ kind: 'buffer', data: pdf })
    };
    const app = createApp({ config: testConfig, fcFacturaService: service });

    await request(app)
      .get('/api/fc-facturas/FF01-00000001/pdf')
      .expect(200)
      .expect('Content-Type', /application\/pdf/)
      .expect('Content-Disposition', 'inline; filename="FF01-00000001.pdf"')
      .expect((response) => {
        expect(response.body).toEqual(pdf);
      });
  });

  it('requiere confirmacion explicita para declarar factura FC', async () => {
    const app = createApp({ config: testConfig, fcFacturaService });

    await request(app)
      .post('/api/fc-facturas/declarar')
      .send({})
      .expect(403)
      .expect((response) => {
        expect(response.body.error).toBe('FC_FACTURA_CONFIRMATION_REQUIRED');
      });
  });

  it('declara factura FC con UUID idempotente y confirmacion', async () => {
    const app = createApp({ config: testConfig, fcFacturaService });

    await request(app)
      .post('/api/fc-facturas/declarar')
      .set('X-Confirm-Fc-Factura', 'YES')
      .set('X-Operation-Id', '11111111-1111-4111-8111-111111111111')
      .send({
        serie: 'FF01',
        numero: '00000001',
        fechaEmision: '2026-08-12',
        moneda: 'PEN',
        formaPago: 'CONTADO',
        cuenta: '701',
        tipoDetraccion: '037',
        tipoExclusionProducto: 'GRAVADA',
        vendedor: {
          idEmpleado: 91,
          nombre: 'JUNIOR BUSTAMANTE'
        },
        cliente: {
          tipoDocumento: '6',
          numeroDocumento: '20111111111',
          razonSocial: 'CLIENTE FACTURA S.A.C.'
        },
        guias: [{ serieNumeroGuia: 'T001-00000023' }],
        items: [
          {
            id: 'T001-00000023-1',
            serieNumeroGuia: 'T001-00000023',
            codigoProducto: 'PROD001',
            descripcion: 'PRODUCTO FC',
            unidadMedida: 'UND',
            cantidad: 2,
            precioUnitario: 10,
            afectoIgv: true
          }
        ]
      })
      .expect(200)
      .expect((response) => {
        expect(response.body.ok).toBe(true);
        expect(response.body.serieNumeroFactura).toBe('FF01-00000001');
      });
  });
});
