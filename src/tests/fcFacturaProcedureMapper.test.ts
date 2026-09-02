import { describe, expect, it } from 'vitest';
import { toFcFacturaProcedurePlan } from '../mappers/fcFacturaProcedureMapper.js';
import type { FcFacturaPreviewInput } from '../schemas/fcFacturaSchema.js';
import { testConfig } from './fixtures.js';

describe('fc factura procedure mapper', () => {
  it('mapea factura FF01 con guia T001 referenciada', () => {
    const input: FcFacturaPreviewInput = {
      serie: 'FF01',
      numero: '00000001',
      fechaEmision: '2026-08-14',
      moneda: 'PEN',
      formaPago: 'Factura 10 dias',
      cuenta: '7022111',
      tipoDetraccion: '037',
      tipoExclusionProducto: 'GRAVADA',
      vendedor: {
        idEmpleado: 91,
        nombre: 'JUNIOR BUSTAMANTE'
      },
      ordenCompra: 'OC-123',
      observaciones: '',
      cliente: {
        tipoDocumento: '6',
        numeroDocumento: '20100055237',
        razonSocial: 'ALICORP S.A.A.'
      },
      guias: [{ serieNumeroGuia: 'T001-00000019' }],
      items: [
        {
          id: '1',
          serieNumeroGuia: 'T001-00000019',
          codigoProducto: '880485',
          descripcion: 'PRODUCTO FC',
          unidadMedida: 'UND',
          cantidad: 20,
          precioUnitario: 200,
          afectoIgv: true
        }
      ]
    };

    const plan = toFcFacturaProcedurePlan(input, {
      remitente: testConfig.remitente,
      puntoPartida: testConfig.puntoPartida
    }, {
      gravada: 4000,
      igv: 720,
      total: 4720
    });
    const header = new Map(plan.USP_CabeceraFE.map((param) => [param.name, param.value]));
    const detail = new Map(plan.USP_DetalleFE[0]!.map((param) => [param.name, param.value]));

    expect(header.get('SERIENUMERO')).toBe('FF01-00000001');
    expect(header.get('TIPODOCUMENTO')).toBe('01');
    expect(header.get('BL_REINTENTO')).toBe('0');
    expect(header.get('BL_HASFILERESPONSE')).toBe('0');
    expect(header.get('GUIAREMISION')).toBe('0T001-00000019');
    expect(header.get('TIPOGUIAREMISION')).toBe('09');
    expect(header.get('totalVenta')).toBe('4720.00');
    expect(header.get('CODIGODETRACCION')).toBe('037');
    expect(header.get('PORCENTAJEDETRACCION')).toBe('12.00');
    expect(header.get('TOTALDETRACCION')).toBe('566.40');
    expect(header.get('fechaPagoCuota1')).toBe('2026-08-24');
    expect(detail.get('SERIENUMERO')).toBe('FF01-00000001');
    expect(detail.get('ImporteIGV')).toBe('720.00');
    expect(detail.get('UNIDADMEDIDA')).toBe('NIU');
    expect(plan.USP_EnviaDocumentoFE).toEqual([
      { name: 'NUMERODOCUMENTOEMISOR', value: testConfig.remitente.numeroDocumento },
      { name: 'SERIENUMERO', value: 'FF01-00000001' },
      { name: 'TIPODOCUMENTO', value: '01' }
    ]);
  });

  it('mantiene MIL como unidad Bizlinks FE de tres caracteres', () => {
    const input: FcFacturaPreviewInput = {
      serie: 'FF01',
      numero: '00000002',
      fechaEmision: '2026-08-14',
      moneda: 'PEN',
      formaPago: 'Contado C/E',
      cuenta: '7022111',
      tipoDetraccion: '037',
      tipoExclusionProducto: 'GRAVADA',
      vendedor: {
        idEmpleado: 91,
        nombre: 'JUNIOR BUSTAMANTE'
      },
      ordenCompra: '',
      observaciones: '',
      cliente: {
        tipoDocumento: '6',
        numeroDocumento: '20100055237',
        razonSocial: 'ALICORP S.A.A.'
      },
      guias: [{ serieNumeroGuia: 'T001-00000020' }],
      items: [
        {
          id: '1',
          serieNumeroGuia: 'T001-00000020',
          codigoProducto: '880485',
          descripcion: 'PRODUCTO FC',
          unidadMedida: 'MIL',
          cantidad: 1,
          precioUnitario: 100,
          afectoIgv: true
        }
      ]
    };

    const plan = toFcFacturaProcedurePlan(input, {
      remitente: testConfig.remitente,
      puntoPartida: testConfig.puntoPartida
    }, {
      gravada: 100,
      igv: 18,
      total: 118
    });
    const detail = new Map(plan.USP_DetalleFE[0]!.map((param) => [param.name, param.value]));

    expect(detail.get('UNIDADMEDIDA')).toBe('MIL');
  });

  it('normaliza MLL como MIL para Bizlinks FE', () => {
    const input: FcFacturaPreviewInput = {
      serie: 'FF01',
      numero: '00000003',
      fechaEmision: '2026-08-14',
      moneda: 'PEN',
      formaPago: 'Contado C/E',
      cuenta: '7022111',
      tipoDetraccion: '037',
      tipoExclusionProducto: 'GRAVADA',
      vendedor: {
        idEmpleado: 91,
        nombre: 'JUNIOR BUSTAMANTE'
      },
      ordenCompra: '',
      observaciones: '',
      cliente: {
        tipoDocumento: '6',
        numeroDocumento: '20100055237',
        razonSocial: 'ALICORP S.A.A.'
      },
      guias: [{ serieNumeroGuia: 'T001-00000021' }],
      items: [
        {
          id: '1',
          serieNumeroGuia: 'T001-00000021',
          codigoProducto: '880485',
          descripcion: 'PRODUCTO FC',
          unidadMedida: 'MLL',
          cantidad: 1,
          precioUnitario: 100,
          afectoIgv: true
        }
      ]
    };

    const plan = toFcFacturaProcedurePlan(input, {
      remitente: testConfig.remitente,
      puntoPartida: testConfig.puntoPartida
    }, {
      gravada: 100,
      igv: 18,
      total: 118
    });
    const detail = new Map(plan.USP_DetalleFE[0]!.map((param) => [param.name, param.value]));

    expect(detail.get('UNIDADMEDIDA')).toBe('MIL');
  });

  it('acepta guia T999 como referencia de factura FC', () => {
    const input: FcFacturaPreviewInput = {
      serie: 'FF01',
      numero: '00000004',
      fechaEmision: '2026-08-14',
      moneda: 'PEN',
      formaPago: 'Contado C/E',
      cuenta: '7022111',
      tipoDetraccion: '037',
      tipoExclusionProducto: 'GRAVADA',
      vendedor: {
        idEmpleado: 91,
        nombre: 'JUNIOR BUSTAMANTE'
      },
      ordenCompra: '',
      observaciones: '',
      cliente: {
        tipoDocumento: '6',
        numeroDocumento: '20100055237',
        razonSocial: 'ALICORP S.A.A.'
      },
      guias: [{ serieNumeroGuia: 'T999-00000021' }],
      items: [
        {
          id: '1',
          serieNumeroGuia: 'T999-00000021',
          codigoProducto: '880485',
          descripcion: 'PRODUCTO FC',
          unidadMedida: 'MIL',
          cantidad: 1,
          precioUnitario: 100,
          afectoIgv: true
        }
      ]
    };

    const plan = toFcFacturaProcedurePlan(input, {
      remitente: testConfig.remitente,
      puntoPartida: testConfig.puntoPartida
    }, {
      gravada: 100,
      igv: 18,
      total: 118
    });
    const header = new Map(plan.USP_CabeceraFE.map((param) => [param.name, param.value]));
    const detail = new Map(plan.USP_DetalleFE[0]!.map((param) => [param.name, param.value]));

    expect(header.get('GUIAREMISION')).toBe('0T999-00000021');
    expect(detail.get('textoAuxiliar250_1')).toBe('T999-00000021');
  });
});
