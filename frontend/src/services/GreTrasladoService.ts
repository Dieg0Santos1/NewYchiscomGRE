import { apiGet, apiPost } from './ApiClient';
import type {
  GreTrasladoInputDto,
  TrasladoDeclareResponse,
  TrasladoNextSerieResponse,
  TrasladoPreviewResponse,
  TrasladoStatusResult
} from '../types/traslado';

type TrasladosResponse = {
  ok: boolean;
  traslados: TrasladoStatusResult[];
};

type ManualSunatAcceptedResponse = {
  ok: boolean;
  operationId: string;
  serieNumeroGuia: string;
  reused: boolean;
  updated: boolean;
  message: string;
};

export const greTrasladoService = {
  getNextSerie() {
    return apiGet<TrasladoNextSerieResponse>('/api/gre-traslados/next-serie');
  },

  preview(payload: GreTrasladoInputDto) {
    return apiPost<TrasladoPreviewResponse>('/api/gre-traslados/preview', payload);
  },

  declare(payload: GreTrasladoInputDto, operationId: string) {
    return apiPost<TrasladoDeclareResponse>('/api/gre-traslados/declarar', payload, {
      'X-Confirm-Send': 'YES',
      'X-Operation-Id': operationId,
      'X-User': 'frontend-gre-traslado'
    });
  },

  async listTraslados() {
    const response = await apiGet<TrasladosResponse>('/api/gre-traslados');
    return response.traslados;
  },

  setManualSunatAcceptedMessage(serieNumeroGuia: string) {
    return apiPost<ManualSunatAcceptedResponse>(
      `/api/gre-traslados/${encodeURIComponent(serieNumeroGuia)}/manual-sunat-accepted`,
      {},
      {
        'X-Confirm-Manual-Sunat': 'YES',
        'X-User': 'frontend-gre-traslado'
      }
    );
  },

  pdfUrl(serieNumeroGuia: string) {
    return `/api/gre-traslados/${encodeURIComponent(serieNumeroGuia)}/pdf`;
  }
};
