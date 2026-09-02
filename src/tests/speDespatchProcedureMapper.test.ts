import { describe, expect, it } from 'vitest';
import { getGreDefaults } from '../config/greDefaults.js';
import { mapGreInputToPayload } from '../mappers/grePayloadMapper.js';
import { toSpeDespatchProcedurePlan } from '../mappers/speDespatchProcedureMapper.js';
import { testConfig, validGreInput } from './fixtures.js';

describe('SPE_DESPATCH official procedure mapper', () => {
  it('prepara parametros de cabecera compatibles con USP_CabeceraGuia', () => {
    const payload = mapGreInputToPayload(validGreInput, getGreDefaults(testConfig));
    const plan = toSpeDespatchProcedurePlan(payload);
    const params = new Map(plan.USP_CabeceraGuia.map((param) => [param.name, param.value]));

    expect(params.get('tipoDocumentoRemitente')).toBe(payload.tipoDocumentoRemitente);
    expect(params.get('numeroDocumentoRemitente')).toBe(payload.numeroDocumentoRemitente);
    expect(params.get('serieNumeroGuia')).toBe(payload.serieNumeroGuia);
    expect(params.get('tipoDocumentoGuia')).toBe(payload.tipoDocumentoGuia);
    expect(params.get('correoEmisor')).toBe('-');
    expect(params.get('correoAdquiriente')).toBe('-');
    expect(params.get('fechaEntregaBienes')).toBeNull();
    expect(params.get('numeroBultos')).toBe('10');
    expect(params.get('codigopuerto')).toBeNull();
    expect(params.get('descripcionpuerto')).toBeNull();
    expect(params.get('codigoPtollegada')).toBeNull();
    expect(params.get('numeroDocumentoPtoPartida')).toBeNull();
    expect(params.get('numeroDocumentoPtoLlegada')).toBeNull();
  });

  it('prepara detalle por item sin depender de codigoEmpaque', () => {
    const payload = mapGreInputToPayload(validGreInput, getGreDefaults(testConfig));
    const plan = toSpeDespatchProcedurePlan(payload);
    const firstItem = plan.USP_DetalleGuia[0];

    expect(plan.USP_DetalleGuia).toHaveLength(payload.spE_DESPATCH_ITEM.length);
    expect(firstItem?.map((param) => param.name)).toEqual([
      'tipoDocumentoRemitente',
      'numeroDocumentoRemitente',
      'serieNumeroGuia',
      'tipoDocumentoGuia',
      'numeroOrdenItem',
      'cantidad',
      'unidadMedida',
      'descripcion',
      'codigo'
    ]);
    expect(firstItem?.some((param) => param.name.toLowerCase().includes('empaque'))).toBe(false);
    expect(JSON.stringify(plan).toLowerCase()).not.toContain('codigoempaque');
  });

  it('prepara USP_EnvioGuia con exactamente sus cuatro llaves', () => {
    const payload = mapGreInputToPayload(validGreInput, getGreDefaults(testConfig));
    const plan = toSpeDespatchProcedurePlan(payload);

    expect(plan.USP_EnvioGuia).toEqual([
      { name: 'tipoDocumentoRemitente', value: payload.tipoDocumentoRemitente },
      { name: 'numeroDocumentoRemitente', value: payload.numeroDocumentoRemitente },
      { name: 'serieNumeroGuia', value: payload.serieNumeroGuia },
      { name: 'tipoDocumentoGuia', value: payload.tipoDocumentoGuia }
    ]);
    expect(plan.USP_DocRef).toEqual([]);
  });
});
