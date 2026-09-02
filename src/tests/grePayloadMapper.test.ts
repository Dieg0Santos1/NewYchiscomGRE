import { describe, expect, it } from 'vitest';
import { getGreDefaults } from '../config/greDefaults.js';
import { mapGreInputToPayload } from '../mappers/grePayloadMapper.js';
import { testConfig, validGreInput } from './fixtures.js';

const expectedPayloadKeys = [
  'tipoDocumentoRemitente',
  'numeroDocumentoRemitente',
  'serieNumeroGuia',
  'tipoDocumentoGuia',
  'bl_estadoRegistro',
  'bl_reintento',
  'bl_origen',
  'bl_hasFileResponse',
  'fechaEmisionGuia',
  'horaEmisionGuia',
  'fechaInicioTraslado',
  'fechaEntregaBienes',
  'observaciones',
  'razonSocialRemitente',
  'correoRemitente',
  'correoDestinatario',
  'numeroDocumentoDestinatario',
  'tipoDocumentoDestinatario',
  'razonSocialDestinatario',
  'motivoTraslado',
  'descripcionMotivoTraslado',
  'pesoBrutoTotalBienes',
  'unidadMedidaPesoBruto',
  'modalidadTraslado',
  'numeroBultos',
  'codigoPuerto',
  'idEntrega',
  'ubigeoPtoPartida',
  'direccionPtoPartida',
  'ubigeoPtoLLegada',
  'direccionPtoLLegada',
  'codigoPtollegada',
  'tipoDocumentoConductor',
  'numeroDocumentoConductor',
  'nombreConductor',
  'apellidoConductor',
  'numeroLicencia',
  'numeroPlacaVehiculoPrin',
  'numeroPlacaVehiculoSec1',
  'numeroAutorizacionRem',
  'codigoAutorizadoRem',
  'tipoDocumentoComprador',
  'numeroDocumentoComprador',
  'razonSocialComprador',
  'tipoEvento',
  'numeroAutorizacionTrans',
  'codigoAutorizadoTrans',
  'tarjetaUnicaCirculacionPrin',
  'numeroAutorizacionVehPrin',
  'codigoAutorizadoVehPrin',
  'numeroPlacaVehiculoSec2',
  'tarjetaUnicaCirculacionSec1',
  'tarjetaUnicaCirculacionSec2',
  'numeroAutorizacionVehSec1',
  'numeroAutorizacionVehSec2',
  'codigoAutorizadoVehSec1',
  'codigoAutorizadoVehSec2',
  'numeroDocumentoConductorSec1',
  'tipoDocumentoConductorSec1',
  'nombreConductorSec1',
  'apellidoConductorSec1',
  'numeroLicenciaSec1',
  'numeroDocumentoConductorSec2',
  'tipoDocumentoConductorSec2',
  'nombreConductorSec2',
  'apellidoConductorSec2',
  'numeroLicenciaSec2',
  'numeroDocumentoPtoLlegada',
  'ptoLlegadaLongitud',
  'ptoLlegadaLatitud',
  'numeroDocumentoPtoPartida',
  'codigoPtoPartida',
  'ptoPartidaLongitud',
  'ptoPartidaLatitud',
  'tipoLocacion',
  'codigoAeropuerto',
  'nombrePuertoAeropuerto',
  'serieGuiaBaja',
  'codigoGuiaBaja',
  'tipoGuiaBaja',
  'numeroDocumentoRelacionado',
  'codigoDocumentoRelacionado',
  'numeroDocumentoEstablecimiento',
  'tipoDocumentoEstablecimiento',
  'razonSocialEstablecimiento',
  'numeroRucTransportista',
  'tipoDocumentoTransportista',
  'razonSocialTransportista',
  'numeroRegistroMTC',
  'indTransbordoProgramado',
  'indRetornoVehiculoEnvaseVacio',
  'indRetornoVehiculoVacio',
  'indTrasVehiculoCatM1L',
  'indRegVehiculoyCond',
  'indTrasladoTotalDAMoDS',
  'numeroContenedor1',
  'numeroContenedor2',
  'numeroPrecinto1',
  'numeroPrecinto2',
  'pesoBrutoTotalItem',
  'unidadMedidaPesoBrutoItem',
  'sustentoPesoBrutoTotal',
  'bL_SOURCEFILE',
  'bl_createdAt',
  'spE_DESPATCH_ITEM',
  'SPE_DESPATCH_DOCRELACIONADO'
].sort();

const expectedItemKeys = [
  'codigoEmpaque',
  'codigoProducto',
  'descripcion',
  'cantidad',
  'unidadMedida',
  'moneda',
  'tipoCambio',
  'importeUnitarioSinImpuesto',
  'serieNumeroGuiaRemision',
  'serieNumeroGuiaFactura',
  'ordenguia',
  'ordenfactura',
  'id',
  'unidadmedida',
  'codigo',
  'cliente'
].sort();

describe('mapGreInputToPayload', () => {
  it('centraliza remitente y punto de partida desde configuracion', () => {
    const payload = mapGreInputToPayload(validGreInput, getGreDefaults(testConfig));

    expect(payload.numeroDocumentoRemitente).toBe(testConfig.remitente.numeroDocumento);
    expect(payload.razonSocialRemitente).toBe(testConfig.remitente.razonSocial);
    expect(payload.ubigeoPtoPartida).toBe(testConfig.puntoPartida.ubigeo);
    expect(payload.direccionPtoPartida).toBe(testConfig.puntoPartida.direccion);
  });

  it('construye campos obligatorios y defaults para la API existente', () => {
    const payload = mapGreInputToPayload(validGreInput, getGreDefaults(testConfig));

    expect(payload.tipoDocumentoGuia).toBe('09');
    expect(payload.bl_estadoRegistro).toBe('N');
    expect(payload.bl_origen).toBe('W');
    expect(payload.bl_reintento).toBe(0);
    expect(payload.bl_hasFileResponse).toBe(0);
    expect(payload.SPE_DESPATCH_DOCRELACIONADO).toEqual([]);
    expect(payload.spE_DESPATCH_ITEM[0]).toMatchObject({
      codigoEmpaque: 0,
      codigoProducto: 'PROD001',
      cantidad: '1',
      cliente: validGreInput.destinatario.numeroDocumentoDestinatario
    });
  });

  it('contiene exactamente todas las propiedades conocidas del request original', () => {
    const payload = mapGreInputToPayload(validGreInput, getGreDefaults(testConfig));

    expect(Object.keys(payload).sort()).toEqual(expectedPayloadKeys);
    expect(Object.keys(payload.spE_DESPATCH_ITEM[0] ?? {}).sort()).toEqual(expectedItemKeys);

    for (const key of expectedPayloadKeys) {
      if (
        key === 'bl_createdAt' ||
        key === 'spE_DESPATCH_ITEM' ||
        key === 'SPE_DESPATCH_DOCRELACIONADO'
      ) {
        continue;
      }

      expect(payload).toHaveProperty(key);
    }
  });
});
