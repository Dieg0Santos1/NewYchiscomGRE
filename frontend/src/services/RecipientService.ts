import type { Recipient } from '../types/gre';
import { apiGet } from './ApiClient';

export type RecipientSearchParams = {
  query: string;
};

export interface RecipientService {
  search(params: RecipientSearchParams): Promise<Recipient[]>;
}

type RecipientResponse = {
  ok: boolean;
  recipients: Recipient[];
};

export const recipientService: RecipientService = {
  async search({ query }) {
    const response = await apiGet<RecipientResponse>(`/api/gre-formularios/recipients?q=${encodeURIComponent(query.trim())}`);
    return response.recipients;
  }
};
