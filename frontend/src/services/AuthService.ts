import type { AuthSessionResponse } from '../types/auth';

export const authService = {
  async getSession() {
    const response = await fetch('/api/auth/me', {
      headers: { Accept: 'application/json' },
      credentials: 'same-origin'
    });
    if (response.status === 401) return null;
    return parseResponse(response);
  },

  async login(username: string, password: string) {
    const response = await fetch('/api/auth/login', {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json'
      },
      credentials: 'same-origin',
      body: JSON.stringify({ username, password })
    });
    return parseResponse(response);
  },

  async logout() {
    await fetch('/api/auth/logout', {
      method: 'POST',
      headers: { Accept: 'application/json' },
      credentials: 'same-origin'
    });
  }
};

async function parseResponse(response: Response): Promise<AuthSessionResponse> {
  const body = await response.json().catch(() => null) as { message?: string } | null;
  if (!response.ok) {
    throw new Error(body?.message || `Error HTTP ${response.status}`);
  }
  return body as AuthSessionResponse;
}
