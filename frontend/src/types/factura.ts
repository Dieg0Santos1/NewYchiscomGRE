export type FcFacturaCliente = {
  id: string;
  tipoDocumento: string;
  numeroDocumento: string;
  razonSocial: string;
  fuente: 'GRE_FC' | 'BIZLINKS';
};

export type FcFacturaVendedor = {
  idEmpleado: number | null;
  nombre: string;
};

export type FcFacturaItem = {
  id: string;
  serieNumeroGuia: string;
  codigoProducto: string;
  descripcion: string;
  cantidad: number;
  unidadMedida: string;
  precioUnitario: number;
  afectoIgv: boolean;
};

export type FcFacturaGuiaPendiente = {
  operationId: string;
  serieNumeroGuia: string;
  fecha: string | null;
  cliente: {
    tipoDocumento: string;
    numeroDocumento: string;
    razonSocial: string;
  };
  estadoSunat: 'ACEPTADA';
  items: FcFacturaItem[];
};

export type FcFacturaPreviewInput = {
  serie: 'FF01';
  numero: string;
  fechaEmision: string;
  moneda: 'PEN';
  formaPago: string;
  cuenta: string;
  tipoDetraccion: '037' | '025';
  tipoExclusionProducto: 'GRAVADA' | 'GRATUITA' | 'EXONERADA' | 'INAFECTA';
  vendedor: FcFacturaVendedor;
  ordenCompra: string;
  observaciones: string;
  cliente: {
    tipoDocumento: string;
    numeroDocumento: string;
    razonSocial: string;
  };
  guias: Array<{ serieNumeroGuia: string }>;
  items: FcFacturaItem[];
};

export type FcFacturaPreviewResponse = {
  ok: boolean;
  writesDatabase: false;
  productionEnabled: true;
  serieNumeroFactura: string;
  totals: {
    gravada: number;
    igv: number;
    total: number;
  };
  validations: Array<{
    code: string;
    severity: 'ok' | 'warning' | 'error';
    message: string;
  }>;
  payload: unknown;
  procedurePlan: unknown;
};

export type FcFacturaDeclareResponse = {
  ok: boolean;
  operationId: string;
  reused: boolean;
  serieNumeroFactura: string;
  insertedHeader: boolean;
  insertedItems: number;
  activated: boolean;
  status: unknown;
};

export type FcFacturaStatusResult = {
  operationId: string;
  serieNumeroFactura: string;
  creadoEn: string | null;
  cliente: string;
  numeroDocumentoCliente: string;
  estadoOperacion: string;
  estadoEnvio: string | null;
  estadoBizlinks: string | null;
  estadoProceso: string | null;
  mensaje: string | null;
  total: number;
  items: number;
  pdfDisponible: boolean;
};

export type FcFacturaNextSerie = {
  ok: boolean;
  serie: 'FF01';
  numero: string;
  serieNumeroFactura: string;
  reserved: false;
  source: 'BIZLINKS_SPE_EINVOICEHEADER';
};

export type FcFacturaCuenta = {
  id: string;
  cuenta: string;
  denominacion: string;
  label: string;
  fuente: 'VIEW_CUENTAS_FACTURA' | 'FC_OFFSET_DEFAULT';
};

export type FcFacturaFormaPago = {
  id: string;
  nombre: string;
  valor: string;
  dias: number;
};
