export type TrasladoItem = {
  id: string;
  codigoProducto: string;
  descripcion: string;
  cantidad: number;
  unidadMedida: string;
};

export type TrasladoMotivoCode = '01' | '14' | '04' | '17' | '18' | '08' | '09' | '13' | '03' | '19';
export type TrasladoModalidadCode = '01' | '02';

export type TrasladoFormState = {
  serieNumeroGuia: string;
  referenciaInterna: string;
  fechaEmisionGuia: string;
  horaEmisionGuia: string;
  fechaInicioTraslado: string;
  fechaEntregaBienes: string;
  observaciones: string;
  correoDestinatario: string;
  tipoDocumentoDestinatario: string;
  numeroDocumentoDestinatario: string;
  razonSocialDestinatario: string;
  ubigeoPtoLlegada: string;
  direccionPtoLlegada: string;
  codigoPtoLlegada: string;
  motivoTraslado: TrasladoMotivoCode;
  descripcionMotivoTraslado: string;
  modalidadTraslado: TrasladoModalidadCode;
  pesoBrutoTotalBienes: number;
  numeroBultos: number;
  selectedDriverId: string;
  tipoDocumentoConductor: string;
  numeroDocumentoConductor: string;
  nombreConductor: string;
  apellidoConductor: string;
  numeroLicencia: string;
  numeroPlacaVehiculoPrin: string;
  tipoDocumentoTransportista: string;
  numeroRucTransportista: string;
  razonSocialTransportista: string;
  items: TrasladoItem[];
};

export type GreTrasladoInputDto = {
  serieNumeroGuia: string;
  referenciaInterna: string;
  fechaEmisionGuia: string;
  horaEmisionGuia: string;
  fechaInicioTraslado: string;
  fechaEntregaBienes: string;
  observaciones: string;
  correoDestinatario: string;
  destinatario: {
    tipoDocumentoDestinatario: string;
    numeroDocumentoDestinatario: string;
    razonSocialDestinatario: string;
  };
  traslado: {
    motivoTraslado: TrasladoMotivoCode;
    descripcionMotivoTraslado: string;
    pesoBrutoTotalBienes: number;
    unidadMedidaPesoBruto: 'KGM';
    modalidadTraslado: TrasladoModalidadCode;
    numeroBultos: number;
    ubigeoPtoLlegada: string;
    direccionPtoLlegada: string;
    codigoPtoLlegada: string;
  };
  conductor?: {
    tipoDocumentoConductor: string;
    numeroDocumentoConductor: string;
    nombreConductor: string;
    apellidoConductor: string;
    numeroLicencia: string;
  };
  vehiculo?: {
    numeroPlacaVehiculoPrin: string;
  };
  transportista?: {
    tipoDocumentoTransportista: string;
    numeroRucTransportista: string;
    razonSocialTransportista: string;
  };
  items: Array<TrasladoItem & {
    codigoEmpaque: 0;
    cantidadOriginal: number;
    cantidadPendiente: number;
    moneda: '-100';
    importeUnitarioSinImpuesto: 1;
  }>;
};

export type TrasladoNextSerieResponse = {
  ok: boolean;
  serie: 'T002';
  numero: string;
  serieNumeroGuia: string;
  reserved: false;
};

export type TrasladoPreviewResponse = {
  ok: boolean;
  writesDatabase: false;
  payload: unknown;
  procedurePlan: unknown;
};

export type TrasladoDeclareResponse = {
  ok: boolean;
  productionEnabled: false;
  operationId: string;
  reused: boolean;
  generatedSerieNumeroGuia: string;
  insertedHeader: boolean;
  insertedItems: number;
  activated: boolean;
  status: unknown;
};

export type TrasladoStatusResult = {
  operationId: string;
  serieNumeroGuia: string | null;
  creadoEn: string | null;
  cliente: string;
  numeroDocumentoCliente: string;
  motivoTraslado: string;
  modalidadTraslado: string;
  estadoOperacion: string;
  estadoEnvio: string | null;
  estadoBizlinks: string | null;
  estadoProceso: string | null;
  mensaje: string | null;
  pdfDisponible: boolean;
  manualSunatMessageAllowed: boolean;
  items: number;
};
