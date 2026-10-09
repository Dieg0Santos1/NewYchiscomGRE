import { describe, expect, it } from 'vitest';
import type { FcFacturaPreviewInput } from '../schemas/fcFacturaSchema.js';
import { DirectDbFcFacturaService } from '../services/fcFacturaService.js';
import { testConfig } from './fixtures.js';

describe('validacion de factura FC sin detraccion', () => {
  it('permite 000 sin detraccion para una operacion mayor a S/ 700', async () => {
    const preview = await new DirectDbFcFacturaService(testConfig).preview(invoiceInput());
    const validation = preview.validations.find((item) => item.code === 'REGLA_MONTO_DETRACCION');

    expect(validation?.severity).toBe('warning');
    expect(validation?.message).toContain('emitida sin detraccion por seleccion del usuario');
  });

  it('envia 0101 sin campos de detraccion al seleccionar 000', async () => {
    const preview = await new DirectDbFcFacturaService(testConfig).preview(invoiceInput());
    const header = new Map(preview.procedurePlan.USP_CabeceraFE.map((param) => [param.name, param.value]));

    expect(header.get('tipoOperacion')).toBe('0101');
    expect(header.get('CODIGODETRACCION')).toBeNull();
    expect(header.get('PORCENTAJEDETRACCION')).toBeNull();
    expect(header.get('TOTALDETRACCION')).toBeNull();
    expect(header.get('BANCONACION')).toBeNull();
  });

  it('permite exonerada e inafecta y mantiene gratuita bloqueada', async () => {
    const service = new DirectDbFcFacturaService(testConfig);

    for (const tipoExclusionProducto of ['EXONERADA', 'INAFECTA'] as const) {
      const preview = await service.preview(invoiceInput({ tipoExclusionProducto }));
      const validation = preview.validations.find((item) => item.code === 'TIPO_EXCLUSION_PRODUCTO');

      expect(validation?.severity).toBe('ok');
    }

    const gratuita = await service.preview(invoiceInput({ tipoExclusionProducto: 'GRATUITA' }));
    const gratuitaValidation = gratuita.validations.find((item) => item.code === 'TIPO_EXCLUSION_PRODUCTO');

    expect(gratuitaValidation?.severity).toBe('error');
  });
});

function invoiceInput(overrides: Partial<FcFacturaPreviewInput> = {}): FcFacturaPreviewInput {
  return {
    serie: 'FF01',
    numero: '00017175',
    fechaEmision: '2026-09-17',
    moneda: 'PEN',
    tipoCambio: 1,
    formaPago: 'Contado C/E',
    diasPago: 0,
    cuenta: '7022111',
    tipoDetraccion: '000',
    tipoExclusionProducto: 'GRAVADA',
    vendedor: { idEmpleado: 1, nombre: 'CECILIA LAZO' },
    ordenCompra: '',
    observaciones: '',
    cliente: {
      tipoDocumento: '6',
      numeroDocumento: '20481252475',
      razonSocial: 'ASOCIACION FONDO CONTRA ACCIDENTES DE TRANSITO DE LA PROVINCIA DE TRUJILLO'
    },
    guias: [{ serieNumeroGuia: 'T001-00000102' }],
    items: [{
      id: 'T001-00000102-1',
      serieNumeroGuia: 'T001-00000102',
      codigoProducto: '881896',
      descripcion: 'AFOCAT 2026 TRUJILLO REGION LA LIBERTAD',
      unidadMedida: 'MIL',
      cantidad: 3,
      precioUnitario: 694.92,
      afectoIgv: true
    }],
    ...overrides
  };
}
