import { apiGet, apiPatch, apiPost } from './ApiClient';
import type { AuthAccess, CreateAuthAccess, UpdateAuthAccess } from '../types/auth';

type AccessListResponse = {
  ok: boolean;
  accesses: AuthAccess[];
};

type AccessCreatedResponse = {
  ok: boolean;
  access: AuthAccess;
};

type AccessUpdatedResponse = {
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
  },

  async update(username: string, input: UpdateAuthAccess) {
    const response = await apiPatch<AccessUpdatedResponse>(`/api/admin/accesses/${encodeURIComponent(username)}`, input);
    return response.access;
  }
};
