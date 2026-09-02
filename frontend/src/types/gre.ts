export type GuideStatus = 'Pendiente' | 'Generado' | 'Enviado' | 'En proceso' | 'Aceptado' | 'Rechazado' | 'Error';
export type BackendGuideStatus = 'GENERADO' | 'ENVIADO' | 'EN_PROCESO' | 'ACEPTADA' | 'RECHAZADA' | 'ERROR';

export type ProductItem = {
  codigoProducto: string;
  descripcion: string;
  cantidad: number;
  cantidadOriginal: number;
  cantidadPendiente: number;
  incluido: boolean;
  unidadMedida: string;
  id: string;
};

export type WorkOrderDocument = {
  idDocumentos: string;
  numeroOt: string;
  cliente: string;
  fecha: string;
  referencia: string;
  ordenCompra: string;
  destinatario: WorkOrderRecipient | null;
  destinos: RecipientAddress[];
  productos: ProductItem[];
};

export type WorkOrderSearchStatus =
  | 'OT_DISPONIBLE'
  | 'OT_SIN_DETALLES'
  | 'OT_NO_ENCONTRADA'
  | 'CLIENTE_SIN_DESTINOS'
  | 'DESTINOS_ERROR';

export type WorkOrderSearchResult = {
  status: WorkOrderSearchStatus;
  documents: WorkOrderDocument[];
  message: string;
  warnings?: string[];
};

export type RecipientAddress = {
  id: string;
  codigoDestino?: string;
  ubigeo?: string;
  direccion: string;
  textoOriginal?: string;
};

export type WorkOrderRecipient = {
  tipoDocumentoDestinatario: string;
  numeroDocumentoDestinatario: string;
  razonSocialDestinatario: string;
  fuente?: string;
};

export type DriverCatalogItem = {
  id: string;
  tipoDocumento: string;
  numeroDocumento: string;
  nombres: string;
  apellidos: string;
  licencia: string;
  placa: string;
};

export type Recipient = {
  id: string;
  tipoDocumentoDestinatario: string;
  numeroDocumentoDestinatario: string;
  razonSocialDestinatario: string;
  direcciones: RecipientAddress[];
};

export type GreFormState = {
  searchText: string;
  searchType: 'idDocumentos' | 'OT' | 'Orden';
  selectedIdDocumentos: string;
  ordenCompra: string;
  empresa: string;
  fechaEmisionGuia: string;
  horaEmisionGuia: string;
  fechaInicioTraslado: string;
  fechaEntregaBienes: string;
  serie: 'T001' | 'T999';
  numero: string;
  tipoDocumentoDestinatario: string;
  numeroDocumentoDestinatario: string;
  razonSocialDestinatario: string;
  correoDestinatario: string;
  ubigeoPtoLlegada: string;
  direccionPtoLlegada: string;
  codigoPtoLlegada: string;
  origen: string;
  modalidadTraslado: string;
  motivoTraslado: string;
  descripcionMotivoTraslado: string;
  pesoBrutoTotalBienes: number;
  unidadMedidaPesoBruto: string;
  numeroBultos: number;
  observaciones: string;
  tipoDocumentoConductor: string;
  numeroDocumentoConductor: string;
  nombreConductor: string;
  apellidoConductor: string;
  numeroLicencia: string;
  numeroPlacaVehiculoPrin: string;
  selectedPrivateDriverId: string;
  items: ProductItem[];
};

export type GreInputDto = {
  serieNumeroGuia: string;
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
    motivoTraslado: string;
    descripcionMotivoTraslado: string;
    pesoBrutoTotalBienes: number;
    unidadMedidaPesoBruto: string;
    modalidadTraslado: string;
    numeroBultos: number;
    ubigeoPtoLlegada: string;
    direccionPtoLlegada: string;
    codigoPtoLlegada: string;
  };
  conductor: {
    tipoDocumentoConductor: string;
    numeroDocumentoConductor: string;
    nombreConductor: string;
    apellidoConductor: string;
    numeroLicencia: string;
  };
  vehiculo: {
    numeroPlacaVehiculoPrin: string;
  };
  items: Array<ProductItem & { codigoEmpaque: 0 }>;
};

export type GuideStatusResult = {
  operationId: string;
  serieNumeroGuia: string | null;
  estado: BackendGuideStatus;
  estadoOperacion: string | null;
  estadoEnvio: string | null;
  estadoBizlinks: string | null;
  estadoProceso: string | null;
  mensaje: string | null;
  respuestaSunat: string | null;
  pdfDisponible: boolean;
  manualSunatMessageAllowed: boolean;
  releaseOtAllowed: boolean;
  workOrdersReleased: boolean;
  items: number;
  creadoEn: string | null;
  actualizadoEn: string | null;
};
