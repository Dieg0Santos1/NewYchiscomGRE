import { apiGet, apiPatch, apiPost } from './ApiClient';
import type {
  FlexoCliente,
  FlexoCatalogsResponse,
  FlexoDestino,
  FlexoEmpaque,
  FlexoEmpaqueAdjustment,
  FlexoGuideDeclareResponse,
  FlexoGuidePrepareResponse,
  FlexoGuidePreviewInput,
  FlexoGuidePreviewResponse,
  FlexoGuideSerie,
  FlexoNextSerie,
  FlexoReportsResponse,
  FlexoUpdateUnidadResponse
} from '../types/flexo';

type ClientesResponse = {
  ok: boolean;
  clientes: FlexoCliente[];
};

type DestinosResponse = {
  ok: boolean;
  destinos: FlexoDestino[];
};

type EmpaquesResponse = {
  ok: boolean;
  empaques: FlexoEmpaque[];
};

type EmpaqueAdjustmentsResponse = {
  ok: boolean;
  empaques: FlexoEmpaqueAdjustment[];
};

type ManualSunatAcceptedResponse = {
  ok: boolean;
  operationId: string;
  serieNumeroGuia: string;
  reused: boolean;
  updated: boolean;
  message: string;
};

export const flexoService = {
  listCatalogs() {
    return apiGet<FlexoCatalogsResponse>('/api/flexo/catalogos');
  },

  listReports() {
    return apiGet<FlexoReportsResponse>('/api/flexo/reportes');
  },

  async searchClientes(query: string) {
    const response = await apiGet<ClientesResponse>(`/api/flexo/clientes/search?q=${encodeURIComponent(query)}`);
    return response.clientes;
  },

  async listDestinos(numeroDocumento: string) {
    const response = await apiGet<DestinosResponse>(`/api/flexo/clientes/${encodeURIComponent(numeroDocumento)}/destinos`);
    return response.destinos;
  },

  async listEmpaques(params: { numeroDocumento: string; desde: string; hasta: string; filtro: string }) {
    const search = new URLSearchParams({
      numeroDocumento: params.numeroDocumento,
      desde: params.desde,
      hasta: params.hasta,
      filtro: params.filtro
    });
    const response = await apiGet<EmpaquesResponse>(`/api/flexo/empaques?${search.toString()}`);
    return response.empaques;
  },

  getNextSerie(serie: FlexoGuideSerie = 'T003') {
    return apiGet<FlexoNextSerie>(`/api/flexo/guias/next-serie?serie=${encodeURIComponent(serie)}`);
  },

  previewGuia(payload: FlexoGuidePreviewInput) {
    return apiPost<FlexoGuidePreviewResponse>('/api/flexo/guias/preview', payload);
  },

  prepareGuia(payload: FlexoGuidePreviewInput) {
    return apiPost<FlexoGuidePrepareResponse>('/api/flexo/guias/preparar', payload);
  },

  declareGuia(payload: FlexoGuidePreviewInput) {
    return apiPost<FlexoGuideDeclareResponse>('/api/flexo/guias/declarar', payload);
  },

  guidePdfUrl(serieNumeroGuia: string) {
    return `/api/flexo/guias/${encodeURIComponent(serieNumeroGuia)}/pdf`;
  },

  setManualSunatAcceptedMessage(serieNumeroGuia: string) {
    return apiPost<ManualSunatAcceptedResponse>(
      `/api/flexo/guias/${encodeURIComponent(serieNumeroGuia)}/manual-sunat-accepted`,
      {},
      {
        'X-Confirm-Manual-Sunat': 'YES',
        'X-User': 'frontend-flexo'
      }
    );
  },

  invoicePdfUrl(serieNumeroFactura: string) {
    return `/api/flexo/facturas/${encodeURIComponent(serieNumeroFactura)}/pdf`;
  },

  async searchEmpaqueAdjustments(query: string) {
    const response = await apiGet<EmpaqueAdjustmentsResponse>(`/api/flexo/ajustes/empaques?q=${encodeURIComponent(query)}`);
    return response.empaques;
  },

  updateEmpaqueUnidad(params: { codigoEmpaque: number; codigoProducto: string; unidadMedida: string }) {
    return apiPatch<FlexoUpdateUnidadResponse>(
      `/api/flexo/ajustes/empaques/${encodeURIComponent(String(params.codigoEmpaque))}/${encodeURIComponent(params.codigoProducto)}/unidad-medida`,
      { unidadMedida: params.unidadMedida }
    );
  }
};
