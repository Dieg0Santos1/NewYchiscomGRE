export type FlexoCliente = {
  id: string;
  tipoDocumento: string;
  numeroDocumento: string;
  razonSocial: string;
  ultimoEmpaque: string | null;
};

export type FlexoDestino = {
  id: string;
  ubigeo: string;
  direccion: string;
};

export type FlexoEmpaqueItem = {
  id: string;
  codigoEmpaque: number;
  codigoProducto: string;
  descripcion: string;
  cantidad: number;
  unidadMedida: string;
};

export type FlexoEmpaque = {
  id: string;
  codigoEmpaque: number;
  ticket: string;
  ordenCompra: string;
  fechaCreacion: string | null;
  destino: FlexoDestino;
  items: FlexoEmpaqueItem[];
};

export type FlexoGuideSerie = 'T003' | 'T999';

export type FlexoNextSerie = {
  ok: boolean;
  serie: FlexoGuideSerie;
  numero: string;
  serieNumeroGuia: string;
  reserved: false;
  source: 'AAA_TIPODOCUMENTO' | 'BIZLINKS_SPE_DESPATCH';
};

export type FlexoValidation = {
  code: string;
  severity: 'ok' | 'warning' | 'error';
  message: string;
};

export type FlexoEmpaqueAdjustment = {
  id: string;
  codigoEmpaque: number;
  codigoProducto: string;
  descripcion: string;
  cantidad: number;
  unidadMedida: string;
  moneda: string;
  ordenGuia: string;
  ordenFactura: string;
  ticket: string;
  ordenCompra: string;
  clienteNumeroDocumento: string;
  clienteRazonSocial: string;
  guiaRemision: string | null;
  guiaFactura: string | null;
};

export type FlexoUpdateUnidadResponse = {
  ok: boolean;
  codigoEmpaque: number;
  codigoProducto: string;
  unidadAnterior: string;
  unidadNueva: string;
  updated: true;
};

export type FlexoCatalogWarning = {
  source: string;
  message: string;
};

export type FlexoCatalogsResponse = {
  ok: boolean;
  warnings: FlexoCatalogWarning[];
  choferes: Array<{
    id: string;
    tipoDocumento: string;
    numeroDocumento: string;
    nombres: string;
    apellidos: string;
    licencia: string;
    placa: string;
  }>;
  motivos: Array<{
    id: string;
    codigo: string;
    descripcion: string;
  }>;
  origenes: Array<{
    id: string;
    numeroDocumentoEmisor: string;
    ubigeo: string;
    direccion: string;
    codigoLocalAnexo: string;
  }>;
  transportistas: Array<{
    id: string;
    tipoDocumento: string;
    numeroDocumento: string;
    razonSocial: string;
  }>;
  detracciones: Array<{
    id: string;
    codigo: string;
    descripcion: string;
    porcentaje: number;
  }>;
  empresas: Array<{
    id: string;
    numeroDocumentoEmisor: string;
    tipoDocumentoEmisor: string;
    razonSocial: string;
    ubigeo: string;
    direccion: string;
  }>;
  tiposDocumento: Array<{
    id: string;
    tipoDocumento: string;
    descripcion: string;
    serie: string;
    correlativo: number;
  }>;
};

export type FlexoReportStatus = 'PENDIENTE' | 'EN_PROCESO' | 'ACEPTADA' | 'RECHAZADA' | 'ERROR' | 'ANULADA';

export type FlexoReportGuide = {
  tipo: 'GRE';
  serieNumero: string;
  fecha: string | null;
  clienteDocumento: string;
  clienteNombre: string;
  estado: FlexoReportStatus;
  estadoBizlinks: string;
  estadoProceso: string;
  mensaje: string;
  pdfDisponible: boolean;
  empaques: number;
  items: number;
  itemsFacturados: number;
  trazabilidadPortal: boolean;
  manualSunatMessageAllowed: boolean;
};

export type FlexoReportInvoice = {
  tipo: 'FE';
  serieNumero: string;
  fecha: string | null;
  clienteDocumento: string;
  clienteNombre: string;
  estado: FlexoReportStatus;
  estadoBizlinks: string;
  estadoProceso: string;
  mensaje: string;
  pdfDisponible: boolean;
  guias: number;
  items: number;
  total: number;
  trazabilidadPortal: boolean;
};

export type FlexoReportCancellation = {
  id: number;
  tipoDocumentoOrigen: string;
  serieNumeroDocumento: string;
  tipoBaja: string;
  estado: string;
  motivo: string;
  confirmadoExternamente: boolean;
  solicitadoEn: string;
  confirmadoEn: string | null;
};

export type FlexoReportsResponse = {
  ok: boolean;
  generatedAt: string;
  guias: FlexoReportGuide[];
  facturas: FlexoReportInvoice[];
  bajas: FlexoReportCancellation[];
  warnings: string[];
};

export type FlexoGuidePreviewInput = {
  serieNumeroGuia: string;
  fechaEmision: string;
  fechaTraslado: string;
  cliente: {
    tipoDocumento: string;
    numeroDocumento: string;
    razonSocial: string;
  };
  destino: FlexoDestino;
  modalidadTraslado: string;
  motivoTraslado: string;
  descripcionMotivoTraslado: string;
  pesoBruto: number;
  unidadPeso: string;
  numeroBultos: number;
  ordenCompra: string;
  observaciones: string;
  conductor: {
    tipoDocumento: string;
    numeroDocumento: string;
    nombres: string;
    apellidos: string;
    licencia: string;
    placa: string;
  };
  empaques: FlexoEmpaque[];
};

export type FlexoGuidePreviewResponse = {
  ok: boolean;
  writesDatabase: false;
  productionEnabled: false;
  serieNumeroGuia: string;
  validations: FlexoValidation[];
  payload: FlexoGuidePreviewInput;
};

export type FlexoGuidePrepareResponse = {
  ok: boolean;
  operationId: string;
  operacionDbId: number;
  serieNumeroGuia: string;
  estado: 'BORRADOR' | 'INSERTADO_BIZLINKS' | 'ENVIADO' | 'ACEPTADA' | 'RECHAZADA' | 'ERROR';
  reused: boolean;
  insertedItems: number;
  writesBizlinks: false;
  writesEmpaqueDetalle: false;
  message: string;
};

export type FlexoGuideDeclareResponse = {
  ok: boolean;
  operationId: string;
  operacionDbId: number;
  serieNumeroGuia: string;
  estado: 'ENVIADO';
  reused: boolean;
  insertedItems: number;
  linkedItems: number;
  correlativo: number;
  status: unknown;
  message: string;
};
