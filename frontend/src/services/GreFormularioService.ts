import type { GreInputDto, GuideStatusResult, RecipientAddress } from '../types/gre';
import type { GreSerie } from '../data/series';
import { apiGet, apiPost } from './ApiClient';

export type PreviewResponse = {
  ok: boolean;
  writesDatabase: false;
  payload: unknown;
  procedurePlan: unknown;
};

export type DeclareResponse = {
  ok: boolean;
  productionEnabled: false;
  operationId: string;
  reused: boolean;
  generatedSerieNumeroGuia: string;
  insertedHeader: boolean;
  insertedItems: number;
  activated: boolean;
  status: unknown;
};

type StatusResponse = {
  ok: boolean;
  status: GuideStatusResult;
};

type GuideListResponse = {
  ok: boolean;
  guides: GuideStatusResult[];
};

type DestinosResponse = {
  ok: boolean;
  destinos: RecipientAddress[];
};

type NextSerieResponse = {
  ok: boolean;
  serie: GreSerie;
  numero: string;
  serieNumeroGuia: string;
  reserved: false;
};

type ManualSunatAcceptedResponse = {
  ok: boolean;
  operationId: string;
  serieNumeroGuia: string;
  reused: boolean;
  updated: boolean;
  message: string;
};

type ReleaseWorkOrdersResponse = {
  ok: boolean;
  operationId: string;
  serieNumeroGuia: string;
  reused: boolean;
  updated: boolean;
  affectedRows: number;
  idsOT: number[];
};

export const greFormularioService = {
  async getNextSerie(serie?: GreSerie) {
    const query = serie ? `?serie=${encodeURIComponent(serie)}` : '';

    return apiGet<NextSerieResponse>(`/api/gre-formularios/next-serie${query}`);
  },

  preview(payload: GreInputDto) {
    return apiPost<PreviewResponse>('/api/gre-formularios/preview', payload);
  },

  declare(payload: GreInputDto, operationId: string) {
    return apiPost<DeclareResponse>('/api/gre-formularios/declarar-test', payload, {
      'X-Confirm-Send': 'YES',
      'X-Operation-Id': operationId,
      'X-User': 'frontend-gre-fc'
    });
  },

  async getStatus(operationId: string) {
    const response = await apiGet<StatusResponse>(`/api/gre-formularios/status/${operationId}`);
    return response.status;
  },

  async listGuides() {
    const response = await apiGet<GuideListResponse>('/api/gre-formularios/guides');
    return response.guides;
  },

  async getDestinos(numeroDocumento: string) {
    const response = await apiGet<DestinosResponse>(`/api/catalogos/destinos/${encodeURIComponent(numeroDocumento)}`);
    return response.destinos;
  },

  setManualSunatAcceptedMessage(serieNumeroGuia: string) {
    return apiPost<ManualSunatAcceptedResponse>(
      `/api/gre-formularios/guides/${encodeURIComponent(serieNumeroGuia)}/manual-sunat-accepted`,
      {},
      {
        'X-Confirm-Manual-Sunat': 'YES',
        'X-User': 'frontend-gre-fc'
      }
    );
  },

  releaseWorkOrders(serieNumeroGuia: string) {
    return apiPost<ReleaseWorkOrdersResponse>(
      `/api/gre-formularios/guides/${encodeURIComponent(serieNumeroGuia)}/release-ots`,
      {},
      {
        'X-Confirm-Release-OT': 'YES',
        'X-User': 'frontend-gre-fc'
      }
    );
  },

  pdfUrl(serieNumeroGuia: string) {
    return `/api/gre-formularios/guides/${encodeURIComponent(serieNumeroGuia)}/pdf`;
  }
};
