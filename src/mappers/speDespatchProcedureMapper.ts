import type { GrePayload } from './grePayloadMapper.js';

export type StoredProcedureParam = {
  name: string;
  value: string | number | null;
};

export type SpeDespatchProcedurePlan = {
  USP_CabeceraGuia: StoredProcedureParam[];
  USP_DetalleGuia: StoredProcedureParam[][];
  USP_DocRef: StoredProcedureParam[][];
  USP_EnvioGuia: StoredProcedureParam[];
};

type SpeDocRelacionadoPayload = {
  tipoDocumentoDocRel: string;
  codigoDocumentoDocRel: string;
  numeroDocumentoDocRel: string;
  numeroDocumentoEmisorDocRel: string;
  tipoDocumentoEmisorDocRel: string;
};

export function toSpeDespatchProcedurePlan(payload: GrePayload): SpeDespatchProcedurePlan {
  return {
    USP_CabeceraGuia: toUspCabeceraGuiaParams(payload),
    USP_DetalleGuia: payload.spE_DESPATCH_ITEM.map((item, index) => toUspDetalleGuiaParams(payload, item, index)),
    USP_DocRef: (payload.SPE_DESPATCH_DOCRELACIONADO as SpeDocRelacionadoPayload[]).map((doc, index) =>
      toUspDocRefParams(payload, doc, index)
    ),
    USP_EnvioGuia: toUspEnvioGuiaParams(payload)
  };
}

export function toUspCabeceraGuiaParams(payload: GrePayload): StoredProcedureParam[] {
  return [
    { name: 'tipoDocumentoRemitente', value: payload.tipoDocumentoRemitente },
    { name: 'numeroDocumentoRemitente', value: payload.numeroDocumentoRemitente },
    { name: 'serieNumeroGuia', value: payload.serieNumeroGuia },
    { name: 'tipoDocumentoGuia', value: payload.tipoDocumentoGuia },
    { name: 'fechaEmisionGuia', value: payload.fechaEmisionGuia },
    { name: 'Observaciones', value: emptyToNull(payload.observaciones) },
    { name: 'razonSocialRemitente', value: payload.razonSocialRemitente },
    { name: 'correoEmisor', value: '-' },
    { name: 'correoAdquiriente', value: '-' },
    { name: 'serieGuiaBaja', value: emptyToNull(payload.serieGuiaBaja) },
    { name: 'codigoGuiaBaja', value: emptyToNull(payload.codigoGuiaBaja) },
    { name: 'numeroDocumentoDestinatario', value: payload.numeroDocumentoDestinatario },
    { name: 'tipoDocumentoDestinatario', value: payload.tipoDocumentoDestinatario },
    { name: 'razonSocialDestinatario', value: payload.razonSocialDestinatario },
    { name: 'motivoTraslado', value: payload.motivoTraslado },
    { name: 'descripcionMotivoTraslado', value: payload.descripcionMotivoTraslado },
    { name: 'indTransbordoProgramado', value: emptyToNull(payload.indTransbordoProgramado) },
    { name: 'pesoBrutoTotalBienes', value: payload.pesoBrutoTotalBienes },
    { name: 'unidadMedidaPesoBruto', value: payload.unidadMedidaPesoBruto },
    { name: 'modalidadTraslado', value: payload.modalidadTraslado },
    { name: 'fechaInicioTraslado', value: payload.fechaInicioTraslado },
    { name: 'fechaEntregaBienes', value: valueUnusedByPrivateTransport(payload.modalidadTraslado, payload.fechaEntregaBienes) },
    { name: 'ubigeoPtoPartida', value: payload.ubigeoPtoPartida },
    { name: 'direccionPtoPartida', value: payload.direccionPtoPartida },
    { name: 'ubigeoPtoLLegada', value: payload.ubigeoPtoLLegada },
    { name: 'direccionPtoLlegada', value: payload.direccionPtoLLegada },
    { name: 'numeroRucTransportista', value: emptyToNull(payload.numeroRucTransportista) },
    { name: 'tipoDocumentoTransportista', value: emptyToNull(payload.tipoDocumentoTransportista) },
    { name: 'razonsocialTransportista', value: emptyToNull(payload.razonSocialTransportista) },
    { name: 'numeroDocumentoConductor', value: emptyToNull(payload.numeroDocumentoConductor) },
    { name: 'tipoDocumentoConductor', value: emptyToNull(payload.tipoDocumentoConductor) },
    { name: 'nombreConductor', value: emptyToNull(payload.nombreConductor) },
    { name: 'apellidoConductor', value: emptyToNull(payload.apellidoConductor) },
    { name: 'numeroLicenciaConductor', value: emptyToNull(payload.numeroLicencia) },
    { name: 'numeroPlacaVehiculo', value: emptyToNull(payload.numeroPlacaVehiculoPrin) },
    { name: 'horaemision', value: payload.horaEmisionGuia },
    { name: 'numeroBultos', value: emptyToNull(payload.numeroBultos) },
    { name: 'codigopuerto', value: null },
    { name: 'descripcionpuerto', value: null },
    { name: 'codigoPtoPartida', value: emptyToNull(payload.codigoPtoPartida) },
    { name: 'codigoPtollegada', value: valueUnusedByPrivateTransport(payload.modalidadTraslado, payload.codigoPtollegada) },
    { name: 'numeroDocumentoPtoPartida', value: null },
    { name: 'numeroDocumentoPtoLlegada', value: null }
  ];
}

export function toUspDetalleGuiaParams(
  payload: GrePayload,
  item: GrePayload['spE_DESPATCH_ITEM'][number],
  index: number
): StoredProcedureParam[] {
  return [
    { name: 'tipoDocumentoRemitente', value: payload.tipoDocumentoRemitente },
    { name: 'numeroDocumentoRemitente', value: payload.numeroDocumentoRemitente },
    { name: 'serieNumeroGuia', value: payload.serieNumeroGuia },
    { name: 'tipoDocumentoGuia', value: payload.tipoDocumentoGuia },
    { name: 'numeroOrdenItem', value: String(index + 1) },
    { name: 'cantidad', value: item.cantidad },
    { name: 'unidadMedida', value: item.unidadMedida },
    { name: 'descripcion', value: item.descripcion },
    { name: 'codigo', value: item.codigo }
  ];
}

export function toUspDocRefParams(
  payload: GrePayload,
  doc: SpeDocRelacionadoPayload,
  index: number
): StoredProcedureParam[] {
  return [
    { name: 'numeroDocumentoRemitente', value: payload.numeroDocumentoRemitente },
    { name: 'tipoDocumentoGuia', value: payload.tipoDocumentoGuia },
    { name: 'tipoDocumentoRemitente', value: payload.tipoDocumentoRemitente },
    { name: 'serieNumeroGuia', value: payload.serieNumeroGuia },
    { name: 'correlativo', value: String(index + 1) },
    { name: 'tipoDocumentoDocRel', value: doc.tipoDocumentoDocRel },
    { name: 'codigoDocumentoDocRel', value: doc.codigoDocumentoDocRel },
    { name: 'numeroDocumentoDocRel', value: doc.numeroDocumentoDocRel },
    { name: 'numeroDocumentoEmisorDocRel', value: doc.numeroDocumentoEmisorDocRel },
    { name: 'tipoDocumentoEmisorDocRel', value: doc.tipoDocumentoEmisorDocRel }
  ];
}

export function toUspEnvioGuiaParams(payload: Pick<GrePayload, 'tipoDocumentoRemitente' | 'numeroDocumentoRemitente' | 'serieNumeroGuia' | 'tipoDocumentoGuia'>): StoredProcedureParam[] {
  return [
    { name: 'tipoDocumentoRemitente', value: payload.tipoDocumentoRemitente },
    { name: 'numeroDocumentoRemitente', value: payload.numeroDocumentoRemitente },
    { name: 'serieNumeroGuia', value: payload.serieNumeroGuia },
    { name: 'tipoDocumentoGuia', value: payload.tipoDocumentoGuia }
  ];
}

function emptyToNull(value: string | null | undefined) {
  return value ? value : null;
}

function valueUnusedByPrivateTransport(modalidadTraslado: string, value: string | null | undefined) {
  return modalidadTraslado === '02' ? null : emptyToNull(value);
}
