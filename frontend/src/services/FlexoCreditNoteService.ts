import { apiGet, apiPost } from './ApiClient';
import type {
  FlexoCreditNoteDeclareResponse,
  FlexoCreditNoteInvoice,
  FlexoCreditNoteNextSerie,
  FlexoCreditNotePreviewInput,
  FlexoCreditNotePreviewResponse
} from '../types/flexoCreditNote';

type FacturasSearchResponse = {
  ok: boolean;
  facturas: FlexoCreditNoteInvoice[];
};

export const flexoCreditNoteService = {
  async searchFacturas(query: string) {
    const response = await apiGet<FacturasSearchResponse>(`/api/flexo-notas-credito/facturas/search?q=${encodeURIComponent(query)}`);
    return response.facturas;
  },

  getNextSerie() {
    return apiGet<FlexoCreditNoteNextSerie>('/api/flexo-notas-credito/next-serie');
  },

  preview(payload: FlexoCreditNotePreviewInput) {
    return apiPost<FlexoCreditNotePreviewResponse>('/api/flexo-notas-credito/preview', payload);
  },

  declare(payload: FlexoCreditNotePreviewInput, operationId: string) {
    return apiPost<FlexoCreditNoteDeclareResponse>('/api/flexo-notas-credito/declarar', payload, {
      'X-Confirm-Flexo-Nce': 'YES',
      'X-Operation-Id': operationId
    });
  }
};
