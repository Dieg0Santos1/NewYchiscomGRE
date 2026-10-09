import { describe, expect, it } from 'vitest';
import { invoiceAmountInWords, toFcFacturaProcedurePlan } from '../mappers/fcFacturaProcedureMapper.js';
import type { FcFacturaPreviewInput } from '../schemas/fcFacturaSchema.js';
import { testConfig } from './fixtures.js';

describe('fc factura procedure mapper', () => {
  it('genera leyenda SUNAT en letras para soles y dolares', () => {
    expect(invoiceAmountInWords(3681.01, 'PEN')).toBe('TRES MIL SEISCIENTOS OCHENTA Y UNO CON 01/100 SOLES');
    expect(invoiceAmountInWords(936.92, 'USD')).toBe('NOVECIENTOS TREINTA Y SEIS CON 92/100 DOLARES AMERICANOS');
  });

  it('mapea factura FF01 con guia T001 referenciada', () => {
    const input: FcFacturaPreviewInput = {
      serie: 'FF01',
      numero: '00000001',
      fechaEmision: '2026-08-14',
      moneda: 'PEN',
      tipoCambio: 1,
      formaPago: 'Factura 10 dias',
      diasPago: 10,
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
        razonSocial: 'ALICORP S.A.A.',
        direccionFiscal: {
          direccion: 'AV. ARGENTINA 4793',
          ubigeo: '070101',
          distrito: 'CALLAO',
          provincia: 'CALLAO',
          departamento: 'CALLAO',
          pais: 'PE',
          fuente: 'AAA_ADQUIRIENTE'
        }
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
    expect(header.get('ORDENCOMPRA')).toBe('OC-123');
    expect(header.get('TIPODOCUMENTO')).toBe('01');
    expect(header.get('codigoAuxiliar40_1')).toBe('9218');
    expect(header.get('textoAuxiliar40_1')).toBe('JUNIOR BUSTAMANTE');
    expect(header.get('ubigeoEmisor')).toBe('150115');
    expect(header.get('DEPARTAMENTOEMISOR')).toBe('LIMA');
    expect(header.get('PROVINCIAEMISOR')).toBe('LIMA');
    expect(header.get('DISTRITOEMISOR')).toBe('LA VICTORIA');
    expect(header.get('direccionAdquiriente')).toBe('AV. ARGENTINA 4793');
    expect(header.get('ubigeoAdquiriente')).toBe('070101');
    expect(header.get('distritoAdquiriente')).toBe('CALLAO');
    expect(header.get('BL_REINTENTO')).toBe('0');
    expect(header.get('BL_HASFILERESPONSE')).toBe('0');
    expect(header.get('GUIAREMISION')).toBe('0T001-00000019');
    expect(header.get('TIPOGUIAREMISION')).toBe('09');
    expect(header.get('totalVenta')).toBe('4720.00');
    expect(header.get('textoLeyenda_1')).toBe('CUATRO MIL SETECIENTOS VEINTE CON 00/100 SOLES');
    expect(header.get('CODIGODETRACCION')).toBe('037');
    expect(header.get('PORCENTAJEDETRACCION')).toBe('12.00');
    expect(header.get('TOTALDETRACCION')).toBe('566.40');
    expect(header.get('BANCONACION')).toBe('00-099022671');
    expect(header.get('montoNetoPendiente')).toBe('0.00');
    expect(header.get('montoPagoCuota1')).toBe('4153.60');
    expect(header.get('fechaPagoCuota1')).toBe('2026-08-24');
    expect(detail.get('SERIENUMERO')).toBe('FF01-00000001');
    expect(detail.get('ImporteIGV')).toBe('720.00');
    expect(detail.get('UNIDADMEDIDA')).toBe('NIU');
    expect(detail.get('codigoProductoSUNAT')).toBeNull();
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
      tipoCambio: 1,
      formaPago: 'Contado C/E',
      diasPago: 0,
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

  it('mapea venta normal sin detraccion para importes chicos', () => {
    const input: FcFacturaPreviewInput = {
      serie: 'FF01',
      numero: '00000005',
      fechaEmision: '2026-08-14',
      moneda: 'PEN',
      tipoCambio: 1,
      formaPago: 'Contado C/E',
      diasPago: 0,
      cuenta: '7022111',
      tipoDetraccion: '000',
      tipoExclusionProducto: 'GRAVADA',
      vendedor: {
        idEmpleado: 217,
        nombre: 'OFICINA OFICINAFLEXO'
      },
      ordenCompra: '',
      observaciones: '',
      cliente: {
        tipoDocumento: '6',
        numeroDocumento: '10406265574',
        razonSocial: 'ORLANDO BORITZ LLERENA DELGADO'
      },
      guias: [{ serieNumeroGuia: 'T001-00000093' }],
      items: [
        {
          id: '1',
          serieNumeroGuia: 'T001-00000093',
          codigoProducto: '881708',
          descripcion: 'BOLETA DE VENTA',
          unidadMedida: 'MLL',
          cantidad: 5,
          precioUnitario: 0.1,
          afectoIgv: true
        }
      ]
    };

    const plan = toFcFacturaProcedurePlan(input, {
      remitente: testConfig.remitente,
      puntoPartida: testConfig.puntoPartida
    }, {
      gravada: 0.5,
      igv: 0.09,
      total: 0.59
    });
    const header = new Map(plan.USP_CabeceraFE.map((param) => [param.name, param.value]));

    expect(header.get('tipoOperacion')).toBe('0101');
    expect(header.get('CODIGODETRACCION')).toBeNull();
    expect(header.get('PORCENTAJEDETRACCION')).toBeNull();
    expect(header.get('TOTALDETRACCION')).toBeNull();
  });

  it('normaliza MLL como MIL para Bizlinks FE', () => {
    const input: FcFacturaPreviewInput = {
      serie: 'FF01',
      numero: '00000003',
      fechaEmision: '2026-08-14',
      moneda: 'PEN',
      tipoCambio: 1,
      formaPago: 'Contado C/E',
      diasPago: 0,
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
    const header = new Map(plan.USP_CabeceraFE.map((param) => [param.name, param.value]));
    const detail = new Map(plan.USP_DetalleFE[0]!.map((param) => [param.name, param.value]));

    expect(header.get('ORDENCOMPRA')).toBe('-');
    expect(detail.get('UNIDADMEDIDA')).toBe('MIL');
  });

  it('acepta guia T999 como referencia de factura FC', () => {
    const input: FcFacturaPreviewInput = {
      serie: 'FF01',
      numero: '00000004',
      fechaEmision: '2026-08-14',
      moneda: 'PEN',
      tipoCambio: 1,
      formaPago: 'Contado C/E',
      diasPago: 0,
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

  it('mapea varias GRE usando la primera en cabecera y cada guia en su detalle', () => {
    const input = invoiceInput({
      guias: [
        { serieNumeroGuia: 'T001-00000019' },
        { serieNumeroGuia: 'T001-00000020' }
      ],
      items: [
        {
          id: '1',
          serieNumeroGuia: 'T001-00000019',
          codigoProducto: '880485',
          descripcion: 'PRODUCTO FC 1',
          unidadMedida: 'MIL',
          cantidad: 1,
          precioUnitario: 100,
          afectoIgv: true
        },
        {
          id: '2',
          serieNumeroGuia: 'T001-00000020',
          codigoProducto: '880486',
          descripcion: 'PRODUCTO FC 2',
          unidadMedida: 'MIL',
          cantidad: 2,
          precioUnitario: 50,
          afectoIgv: true
        }
      ]
    });
    const plan = toFcFacturaProcedurePlan(input, {
      remitente: testConfig.remitente,
      puntoPartida: testConfig.puntoPartida
    }, {
      gravada: 200,
      igv: 36,
      total: 236
    });
    const header = new Map(plan.USP_CabeceraFE.map((param) => [param.name, param.value]));
    const firstDetail = new Map(plan.USP_DetalleFE[0]!.map((param) => [param.name, param.value]));
    const secondDetail = new Map(plan.USP_DetalleFE[1]!.map((param) => [param.name, param.value]));

    expect(header.get('GUIAREMISION')).toBe('0T001-00000019');
    expect(header.get('TIPOGUIAREMISION')).toBe('09');
    expect(firstDetail.get('textoAuxiliar250_1')).toBe('T001-00000019');
    expect(secondDetail.get('textoAuxiliar250_1')).toBe('T001-00000020');
    expect(plan.USP_DetalleFE).toHaveLength(2);
  });

  it('aplica NR a cada item y respeta fecha de vencimiento manual', () => {
    const input = invoiceInput({
      formaPago: 'Factura 60 dias',
      diasPago: 60,
      fechaVencimiento: '2026-11-30',
      numeroRegistro: '5002700171',
      guias: [
        { serieNumeroGuia: 'T001-00000019' },
        { serieNumeroGuia: 'T001-00000020' }
      ],
      items: [
        {
          id: '1',
          serieNumeroGuia: 'T001-00000019',
          codigoProducto: '880485',
          descripcion: 'FORMATO GUIA DE SALIDA',
          unidadMedida: 'MIL',
          cantidad: 1,
          precioUnitario: 100,
          afectoIgv: true
        },
        {
          id: '2',
          serieNumeroGuia: 'T001-00000020',
          codigoProducto: '880486',
          descripcion: 'FORMATO GUIA DE INGRESO',
          unidadMedida: 'MIL',
          cantidad: 2,
          precioUnitario: 50,
          afectoIgv: true
        }
      ]
    });
    const plan = toFcFacturaProcedurePlan(input, {
      remitente: testConfig.remitente,
      puntoPartida: testConfig.puntoPartida
    }, {
      gravada: 200,
      igv: 36,
      total: 236
    });
    const header = new Map(plan.USP_CabeceraFE.map((param) => [param.name, param.value]));
    const firstDetail = new Map(plan.USP_DetalleFE[0]!.map((param) => [param.name, param.value]));
    const secondDetail = new Map(plan.USP_DetalleFE[1]!.map((param) => [param.name, param.value]));

    expect(header.get('fechaVencimiento')).toBe('2026-11-30');
    expect(header.get('fechaPagoCuota1')).toBe('2026-11-30');
    expect(firstDetail.get('DESCRIPCION')).toBe('FORMATO GUIA DE SALIDA  NR 5002700171');
    expect(secondDetail.get('DESCRIPCION')).toBe('FORMATO GUIA DE INGRESO  NR 5002700171');
  });

  it('mapea multiples cuotas de credito en los campos Bizlinks oficiales', () => {
    const input = invoiceInput({
      formaPago: 'Factura 60 dias',
      diasPago: 60,
      fechaVencimiento: '2026-10-13',
      cuotas: [
        { fecha: '2026-09-13', monto: 100 },
        { fecha: '2026-10-13', monto: 136 }
      ]
    });
    const plan = toFcFacturaProcedurePlan(input, {
      remitente: testConfig.remitente,
      puntoPartida: testConfig.puntoPartida
    }, {
      gravada: 200,
      igv: 36,
      total: 236
    });
    const header = new Map(plan.USP_CabeceraFE.map((param) => [param.name, param.value]));

    expect(header.get('formapago')).toBe('999');
    expect(header.get('facturaPagoNegociable')).toBe('1');
    expect(header.get('fechaVencimiento')).toBe('2026-10-13');
    expect(header.get('montoPagoCuota1')).toBe('100.00');
    expect(header.get('fechaPagoCuota1')).toBe('2026-09-13');
    expect(header.get('montoPagoCuota2')).toBe('136.00');
    expect(header.get('fechaPagoCuota2')).toBe('2026-10-13');
    expect(header.get('montoPagoCuota3')).toBeNull();
  });

  it('mapea operaciones exoneradas e inafectas como onerosas sin IGV', () => {
    for (const [tipoExclusionProducto, reasonCode] of [
      ['EXONERADA', '20'],
      ['INAFECTA', '30']
    ] as const) {
      const input = invoiceInput({ tipoExclusionProducto });
      const plan = toFcFacturaProcedurePlan(input, {
        remitente: testConfig.remitente,
        puntoPartida: testConfig.puntoPartida
      }, {
        gravada: 0,
        exonerada: tipoExclusionProducto === 'EXONERADA' ? 3000 : 0,
        inafecta: tipoExclusionProducto === 'INAFECTA' ? 3000 : 0,
        gratuita: 0,
        igv: 0,
        total: 3000
      });
      const header = new Map(plan.USP_CabeceraFE.map((param) => [param.name, param.value]));
      const detail = new Map(plan.USP_DetalleFE[0]!.map((param) => [param.name, param.value]));

      expect(header.get('totalValorVentaNetoOpGravadas')).toBe('0.00');
      expect(header.get('totalIGV')).toBe('0.00');
      expect(header.get('totalImpuestos')).toBe('0.00');
      expect(header.get('totalVenta')).toBe('3000.00');
      expect(detail.get('CODIGORAZONEXONERACION')).toBe(reasonCode);
      expect(detail.get('codigoImporteUnitarioConImpuesto')).toBe('01');
      expect(detail.get('ImporteIGV')).toBe('0.00');
      expect(detail.get('tasaIGV')).toBe('0.00');
    }
  });

  it('mapea USD con detraccion en soles como una FF01 aceptada', () => {
    const input = invoiceInput({
      moneda: 'USD',
      tipoCambio: 3.379,
      formaPago: 'Factura 30 dias',
      diasPago: 30,
      tipoDetraccion: '037'
    });
    const plan = toFcFacturaProcedurePlan(input, {
      remitente: testConfig.remitente,
      puntoPartida: testConfig.puntoPartida
    }, {
      gravada: 3000,
      igv: 540,
      total: 3540
    });
    const header = new Map(plan.USP_CabeceraFE.map((param) => [param.name, param.value]));

    expect(header.get('tipoMoneda')).toBe('USD');
    expect(header.get('tipocambio')).toBeNull();
    expect(header.get('TOTALDETRACCION')).toBe('1435.82');
    expect(header.get('BANCONACION')).toBe('00-099022671');
    expect(header.get('montoNetoPendiente')).toBe('0.00');
    expect(header.get('montoPagoCuota1')).toBe('3115.20');
    expect(header.get('fechaPagoCuota1')).toBe('2026-09-13');
    expect(header.get('formapago')).toBe('999');
  });
});

function invoiceInput(overrides: Partial<FcFacturaPreviewInput> = {}): FcFacturaPreviewInput {
  return {
    serie: 'FF01',
    numero: '00017172',
    fechaEmision: '2026-08-14',
    moneda: 'PEN',
    tipoCambio: 1,
    formaPago: 'Contado C/E',
    diasPago: 0,
    cuenta: '7022111',
    tipoDetraccion: '000',
    tipoExclusionProducto: 'GRAVADA',
    vendedor: { idEmpleado: 91, nombre: 'JUNIOR BUSTAMANTE' },
    ordenCompra: '',
    observaciones: '',
    cliente: {
      tipoDocumento: '6',
      numeroDocumento: '20100055237',
      razonSocial: 'ALICORP S.A.A.'
    },
    guias: [{ serieNumeroGuia: 'T001-00000019' }],
    items: [{
      id: '1',
      serieNumeroGuia: 'T001-00000019',
      codigoProducto: '880485',
      descripcion: 'PRODUCTO FC',
      unidadMedida: 'MIL',
      cantidad: 1,
      precioUnitario: 3000,
      afectoIgv: true
    }],
    ...overrides
  };
}
