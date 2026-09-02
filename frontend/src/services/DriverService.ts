import type { DriverCatalogItem } from '../types/gre';
import { apiGet } from './ApiClient';

export interface DriverService {
  listPrivateDrivers(): Promise<DriverCatalogItem[]>;
}

type DriverResponse = {
  ok: boolean;
  choferes: DriverCatalogItem[];
};

export const driverService: DriverService = {
  async listPrivateDrivers() {
    const response = await apiGet<DriverResponse>('/api/catalogos/choferes');
    return response.choferes;
  }
};
