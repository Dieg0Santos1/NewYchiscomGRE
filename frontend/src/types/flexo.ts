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
  source: 'BIZLINKS_SPE_DESPATCH';
};

export type FlexoValidation = {
  code: string;
  severity: 'ok' | 'warning' | 'error';
  message: string;
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
