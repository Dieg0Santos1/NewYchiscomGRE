export type FcLegacyCapabilities = {
  writeEnabled: boolean;
  confirmationRequired: boolean;
};

export type FcLegacyNextInternalGuide = {
  serie: '001' | '003';
  numero: string;
  serieNumero: string;
};

export type FcLegacyFormaPago = {
  id: string;
  nombre: string;
  valor: string;
  dias: number;
};

export type FcLegacyVendedor = {
  idEmpleado: number;
  nombre: string;
};

export type FcLegacyMotivo = {
  idMotivoTraslado: number;
  nombre: string;
};

export type FcLegacyCatalogs = {
  formasPago: FcLegacyFormaPago[];
  vendedores: FcLegacyVendedor[];
  motivos: FcLegacyMotivo[];
  warnings: string[];
};

export type FcLegacyClient = {
  idClieProv: number;
  cliente: string;
  ruc: string;
  direccion: string;
  idDistrito: number;
  distritoNombre: string;
  otsPendientes: number;
  cantidadPendiente: number;
};

export type FcLegacyWorkOrder = {
  idOrdenTrabajo: number;
  numeroOt: string;
  idOrdenVenta: number;
  numeroOv: string;
  cliente: string;
  idClieProv: number;
  cantidadOt: number;
  cantidadAceptada: number;
  cantidadPendiente: number;
  recepciones: number;
  serie: string;
  numeroDel: string;
  numeroAl: string;
  estadoGuiaOt: string;
  estadoPlanta: string;
};

export type FcLegacyReception = {
  idRecepcionOT: number;
  idOrdenTrabajo: number;
  numeroOt: string;
  idOrdenVenta: number;
  numeroOv: string;
  numeroOvLegacy: string;
  idClieProv: number;
  cliente: string;
  cantidad: number;
  unidad: string;
  del: string;
  al: string;
  fechaRegistro: string;
  estadoOt: string;
  estadoGuia: string;
  estadoFactura: string;
  serieProducto: string;
  formato: string;
  medida: string;
  numCopias: number;
  descripcion: string;
  direccion: string;
  idDistrito: number;
  distritoNombre: string;
  idEmpleado: number | null;
  vendedorNombre: string;
};

export type FcLegacyGuideItem = {
  idRecepcionOT: number;
  descripcion: string;
  cantidad: number;
  unidad: string;
};
