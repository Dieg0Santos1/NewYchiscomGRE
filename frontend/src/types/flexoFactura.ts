export type FlexoFacturaCliente = {
  id: string;
  tipoDocumento: string;
  numeroDocumento: string;
  razonSocial: string;
  fuente: 'BIZLINKS_FLEXO';
};

export type FlexoFacturaCuenta = {
  id: string;
  cuenta: string;
  denominacion: string;
  label: string;
  fuente: 'VIEW_CUENTAS_FACTURA' | 'FLEXO_DEFAULT';
};

export type FlexoFacturaFormaPago = {
  id: string;
  nombre: string;
  valor: string;
  dias: number;
};

export type FlexoFacturaItem = {
  id: string;
  serieNumeroGuia: string;
  codigoProducto: string;
  descripcion: string;
  cantidad: number;
  unidadMedida: string;
  precioUnitario: number;
  afectoIgv: boolean;
};

export type FlexoFacturaGuiaPendiente = {
  operationId: string;
  serieNumeroGuia: string;
  fecha: string | null;
  cliente: {
    tipoDocumento: string;
    numeroDocumento: string;
    razonSocial: string;
  };
  estadoSunat: 'ACEPTADA';
  items: FlexoFacturaItem[];
};

export type FlexoFacturaDetraccion = '000' | '037' | '025' | '027';
export type FlexoFacturaTipoExclusion = 'GRAVADA' | 'GRATUITA' | 'EXONERADA' | 'INAFECTA';

export type FlexoFacturaPreviewInput = {
  serie: 'FF03';
  numero: string;
  fechaEmision: string;
  moneda: 'PEN';
  formaPago: string;
  cuenta: string;
  detraccion: FlexoFacturaDetraccion;
  tipoExclusionProducto: FlexoFacturaTipoExclusion;
  ordenCompra: string;
  observaciones: string;
  cliente: {
    tipoDocumento: string;
    numeroDocumento: string;
    razonSocial: string;
  };
  guias: Array<{ serieNumeroGuia: string }>;
  items: FlexoFacturaItem[];
};

export type FlexoFacturaPreviewResponse = {
  ok: boolean;
  writesDatabase: false;
  productionEnabled: false;
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

export type FlexoFacturaNextSerie = {
  ok: boolean;
  serie: 'FF03';
  numero: string;
  serieNumeroFactura: string;
  reserved: false;
  source: 'BIZLINKS_SPE_EINVOICEHEADER';
};
