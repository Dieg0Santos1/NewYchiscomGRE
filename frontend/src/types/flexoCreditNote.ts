export type FlexoCreditNoteMotivo = 'anulacion' | 'ruc' | 'total' | 'item';

export type FlexoCreditNoteInvoice = {
  serieNumeroFactura: string;
  fechaEmision: string | null;
  cliente: {
    tipoDocumento: string;
    numeroDocumento: string;
    razonSocial: string;
  };
  moneda: string;
  total: number;
  guias: string[];
  notacres: string[];
};

export type FlexoCreditNotePreviewInput = {
  facturaAfectada: string;
  motivo: FlexoCreditNoteMotivo;
  cuentaNc: string;
  observaciones: string;
};

export type FlexoCreditNotePreviewResponse = {
  ok: boolean;
  writesDatabase: boolean;
  productionEnabled: boolean;
  serieNumeroNotaCredito: string;
  facturaAfectada: string;
  motivo: {
    codigo: string;
    descripcion: string;
    fullDocument: boolean;
  };
  cliente: string;
  moneda: string;
  totals: {
    gravada: number;
    igv: number;
    total: number;
  };
  guias: Array<{
    NRO_GUIA: string | null;
    NRO_FACTURA: string | null;
    NOTACRE: string | null;
  }>;
  items: number;
  validations: Array<{
    code: string;
    severity: 'ok' | 'warning' | 'error';
    message: string;
  }>;
};

export type FlexoCreditNoteDeclareResponse = {
  ok: boolean;
  operationId: string;
  serieNumeroNotaCredito: string;
  facturaAfectada: string;
  insertedHeader: boolean;
  insertedItems: number;
  activated: boolean;
  status: unknown;
  legacyMirror: unknown;
};

export type FlexoCreditNoteNextSerie = {
  ok: boolean;
  serie: 'FC03';
  numero: string;
  serieNumeroNotaCredito: string;
  reserved: false;
  source: 'AAA_TIPODOCUMENTO';
};
