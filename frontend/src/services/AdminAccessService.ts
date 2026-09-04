import { apiGet, apiPost } from './ApiClient';
import type { AuthAccess, CreateAuthAccess } from '../types/auth';

type AccessListResponse = {
  ok: boolean;
  accesses: AuthAccess[];
};

type AccessCreatedResponse = {
  ok: boolean;
  access: AuthAccess;
};

export const adminAccessService = {
  async list() {
    const response = await apiGet<AccessListResponse>('/api/admin/accesses');
    return response.accesses;
  },

  async create(input: CreateAuthAccess) {
    const response = await apiPost<AccessCreatedResponse>('/api/admin/accesses', input);
    return response.access;
  }
};
