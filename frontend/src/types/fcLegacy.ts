export type FcLegacyCapabilities = {
  writeEnabled: boolean;
};

export type FcLegacyClient = {
  idClieProv: number;
  cliente: string;
  ruc: string;
  direccion: string;
  idDistrito: number;
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
  direccion: string;
  idDistrito: number;
};
