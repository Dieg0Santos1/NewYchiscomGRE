import { apiGet, apiPost } from './ApiClient';
import type {
  FcFacturaCliente,
  FcFacturaCuenta,
  FcFacturaFormaPago,
  FcFacturaGuiaPendiente,
  FcFacturaNextSerie,
  FcFacturaDeclareResponse,
  FcFacturaPreviewInput,
  FcFacturaPreviewResponse,
  FcFacturaStatusResult,
  FcFacturaVendedor
} from '../types/factura';

type ClienteSearchResponse = {
  ok: boolean;
  clientes: FcFacturaCliente[];
};

type GuiasPendientesResponse = {
  ok: boolean;
  guias: FcFacturaGuiaPendiente[];
  vendedor: FcFacturaVendedor | null;
  warnings: string[];
};

type CuentasResponse = {
  ok: boolean;
  cuentas: FcFacturaCuenta[];
  warnings: string[];
};

type FormasPagoResponse = {
  ok: boolean;
  formasPago: FcFacturaFormaPago[];
};

type FacturasResponse = {
  ok: boolean;
  facturas: FcFacturaStatusResult[];
};

export const facturaFcService = {
  async searchClientes(query: string) {
    const response = await apiGet<ClienteSearchResponse>(`/api/fc-facturas/clientes/search?q=${encodeURIComponent(query)}`);
    return response.clientes;
  },

  async searchDestinatarios(query: string) {
    const response = await apiGet<ClienteSearchResponse>(
      `/api/fc-facturas/clientes/search?scope=destinatarios&q=${encodeURIComponent(query)}`
    );
    return response.clientes;
  },

  getNextSerie() {
    return apiGet<FcFacturaNextSerie>('/api/fc-facturas/next-serie');
  },

  async listGuiasPendientes(numeroDocumento: string) {
    const response = await apiGet<GuiasPendientesResponse>(`/api/fc-facturas/guias-pendientes?numeroDocumento=${encodeURIComponent(numeroDocumento)}`);
    return response;
  },

  async listCuentas() {
    return apiGet<CuentasResponse>('/api/fc-facturas/catalogos/cuentas');
  },

  async listFormasPago() {
    const response = await apiGet<FormasPagoResponse>('/api/fc-facturas/catalogos/formas-pago');
    return response.formasPago;
  },

  preview(payload: FcFacturaPreviewInput) {
    return apiPost<FcFacturaPreviewResponse>('/api/fc-facturas/preview', payload);
  },

  declare(payload: FcFacturaPreviewInput, operationId: string) {
    return apiPost<FcFacturaDeclareResponse>('/api/fc-facturas/declarar', payload, {
      'X-Confirm-Fc-Factura': 'YES',
      'X-Operation-Id': operationId
    });
  },

  async listFacturas() {
    const response = await apiGet<FacturasResponse>('/api/fc-facturas');
    return response.facturas;
  },

  pdfUrl(serieNumeroFactura: string) {
    return `/api/fc-facturas/${encodeURIComponent(serieNumeroFactura)}/pdf`;
  }
};
