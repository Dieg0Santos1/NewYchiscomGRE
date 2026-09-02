import type { WorkOrderSearchResult } from '../types/gre';
import { apiGet } from './ApiClient';

export interface WorkOrderService {
  searchByOt(ot: string, type?: string): Promise<WorkOrderSearchResult>;
}

type WorkOrderResponse = {
  ok: boolean;
} & WorkOrderSearchResult;

export const workOrderService: WorkOrderService = {
  async searchByOt(ot, type = 'ot') {
    const normalized = ot.trim();
    if (!normalized) {
      return {
        status: 'OT_NO_ENCONTRADA',
        documents: [],
        message: type === 'guia' ? 'Ingrese número de Guía Física' : 'Ingrese número de OT'
      };
    }

    const response = await apiGet<WorkOrderResponse>(
      `/api/gre-formularios/work-orders?ot=${encodeURIComponent(normalized)}&type=${encodeURIComponent(type)}`
    );
    return {
      status: response.status,
      documents: response.documents,
      message: response.message,
      warnings: response.warnings
    };
  }
};
