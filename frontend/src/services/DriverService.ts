import type { DriverCatalogItem } from '../types/gre';
import { apiGet, apiPost } from './ApiClient';

export interface DriverService {
  listPrivateDrivers(): Promise<DriverCatalogItem[]>;
  createPrivateDriver(input: DriverCreateInput): Promise<DriverCatalogItem>;
}

export type DriverCreateInput = {
  tipoDocumento: '1';
  numeroDocumento: string;
  nombres: string;
  apellidos: string;
  licencia: string;
  placa: string;
};

type DriverResponse = {
  ok: boolean;
  choferes: DriverCatalogItem[];
};

type DriverCreateResponse = {
  ok: boolean;
  chofer: DriverCatalogItem;
};

export const driverService: DriverService = {
  async listPrivateDrivers() {
    const response = await apiGet<DriverResponse>('/api/catalogos/choferes');
    return response.choferes;
  },

  async createPrivateDriver(input) {
    const response = await apiPost<DriverCreateResponse>('/api/catalogos/choferes', input);
    return response.chofer;
  }
};
