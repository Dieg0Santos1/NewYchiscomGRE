import { apiGet, apiPatch, apiPost } from './ApiClient';
import type {
  FlexoCliente,
  FlexoDestino,
  FlexoEmpaque,
  FlexoEmpaqueAdjustment,
  FlexoGuidePreviewInput,
  FlexoGuidePreviewResponse,
  FlexoGuideSerie,
  FlexoNextSerie,
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

export const flexoService = {
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
