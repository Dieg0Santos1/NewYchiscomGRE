import { apiGet, apiPost } from './ApiClient';
import type {
  FlexoFacturaCliente,
  FlexoFacturaCuenta,
  FlexoFacturaFormaPago,
  FlexoFacturaGuiaPendiente,
  FlexoFacturaNextSerie,
  FlexoFacturaPreviewInput,
  FlexoFacturaPreviewResponse
} from '../types/flexoFactura';

type ClienteSearchResponse = {
  ok: boolean;
  clientes: FlexoFacturaCliente[];
};

type GuiasPendientesResponse = {
  ok: boolean;
  guias: FlexoFacturaGuiaPendiente[];
  warnings: string[];
};

type CuentasResponse = {
  ok: boolean;
  cuentas: FlexoFacturaCuenta[];
  warnings: string[];
};

type FormasPagoResponse = {
  ok: boolean;
  formasPago: FlexoFacturaFormaPago[];
};

export const flexoFacturaService = {
  async searchClientes(query: string) {
    const response = await apiGet<ClienteSearchResponse>(`/api/flexo-facturas/clientes/search?q=${encodeURIComponent(query)}`);
    return response.clientes;
  },

  getNextSerie() {
    return apiGet<FlexoFacturaNextSerie>('/api/flexo-facturas/next-serie');
  },

  async listGuiasPendientes(numeroDocumento: string) {
    const response = await apiGet<GuiasPendientesResponse>(`/api/flexo-facturas/guias-pendientes?numeroDocumento=${encodeURIComponent(numeroDocumento)}`);
    return response;
  },

  async listCuentas() {
    return apiGet<CuentasResponse>('/api/flexo-facturas/catalogos/cuentas');
  },

  async listFormasPago() {
    const response = await apiGet<FormasPagoResponse>('/api/flexo-facturas/catalogos/formas-pago');
    return response.formasPago;
  },

  preview(payload: FlexoFacturaPreviewInput) {
    return apiPost<FlexoFacturaPreviewResponse>('/api/flexo-facturas/preview', payload);
  }
};
