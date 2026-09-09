import { apiGet, apiPost } from './ApiClient';
import type { FcLegacyCapabilities, FcLegacyCatalogs, FcLegacyClient, FcLegacyGuideItem, FcLegacyReception, FcLegacyWorkOrder } from '../types/fcLegacy';

type WorkOrdersResponse = { ok: boolean; workOrders: FcLegacyWorkOrder[] };
type ReceptionsResponse = { ok: boolean; receptions: FcLegacyReception[] };
type ClientsResponse = { ok: boolean; clients: FcLegacyClient[] };

const legacyWriteHeaders = { 'X-Confirm-Legacy-Write': 'YES' };

export const fcLegacyWorkflowService = {
  async capabilities() {
    const result = await apiGet<{ ok: boolean } & FcLegacyCapabilities>('/api/fc-legacy/capabilities');
    return { writeEnabled: result.writeEnabled, confirmationRequired: result.confirmationRequired };
  },

  async catalogs() {
    const result = await apiGet<{ ok: boolean } & FcLegacyCatalogs>('/api/fc-legacy/catalogs');
    return {
      formasPago: result.formasPago,
      vendedores: result.vendedores,
      motivos: result.motivos,
      warnings: result.warnings
    };
  },

  async searchClients(query: string) {
    const result = await apiGet<ClientsResponse>(`/api/fc-legacy/clients?q=${encodeURIComponent(query)}`);
    return result.clients;
  },

  async searchWorkOrders(query: string, idClieProv?: number) {
    const params = new URLSearchParams({ q: query });
    if (idClieProv) params.set('idClieProv', String(idClieProv));
    const result = await apiGet<WorkOrdersResponse>(`/api/fc-legacy/work-orders?${params.toString()}`);
    return result.workOrders;
  },

  async searchReceptions(query: string, state: 'ready' | 'pending' | 'all' = 'ready', idClieProv?: number) {
    const params = new URLSearchParams({ q: query, state });
    if (idClieProv) params.set('idClieProv', String(idClieProv));
    const result = await apiGet<ReceptionsResponse>(`/api/fc-legacy/receptions?${params.toString()}`);
    return result.receptions;
  },

  createPreGuide(payload: { numeroOt: string; cantidad: number; del: string; al: string }) {
    return apiPost<{ ok: boolean; preGuide: unknown }>('/api/fc-legacy/pre-guides', payload, legacyWriteHeaders);
  },

  acceptPreGuide(idRecepcionOT: number) {
    return apiPost<{ ok: boolean; preGuide: unknown }>(
      `/api/fc-legacy/pre-guides/${idRecepcionOT}/accept`,
      {},
      legacyWriteHeaders
    );
  },

  createInternalGuide(payload: {
    serie: '001' | '003';
    idRecepciones: number[];
    direccion: string;
    idDistrito: number;
    ordenCompra: string;
    observaciones: string;
    formaPago?: string;
    idEmpleado?: number | null;
    idMotivoTraslado?: number | null;
    detalles?: FcLegacyGuideItem[];
  }) {
    return apiPost<{ ok: boolean; internalGuide: { serieNumero?: string } }>(
      '/api/fc-legacy/internal-guides',
      payload,
      legacyWriteHeaders
    );
  }
};
