export async function apiGet<T>(url: string): Promise<T> {
  const response = await fetch(url, {
    headers: {
      Accept: 'application/json'
    }
  });

  return parseResponse<T>(response);
}

export async function apiPost<T>(url: string, body: unknown, headers: Record<string, string> = {}): Promise<T> {
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      ...headers
    },
    body: JSON.stringify(body)
  });

  return parseResponse<T>(response);
}

export async function apiPatch<T>(url: string, body: unknown, headers: Record<string, string> = {}): Promise<T> {
  const response = await fetch(url, {
    method: 'PATCH',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      ...headers
    },
    body: JSON.stringify(body)
  });

  return parseResponse<T>(response);
}

async function parseResponse<T>(response: Response): Promise<T> {
  const body = await response.json().catch(() => null) as unknown;

  if (!response.ok) {
    if (response.status === 401) window.dispatchEvent(new Event('gre-auth-expired'));
    const message = body && typeof body === 'object' && 'issues' in body
      ? formatValidationIssues((body as { issues?: unknown }).issues)
      : body && typeof body === 'object' && 'message' in body
      ? String((body as { message?: unknown }).message)
      : `Error HTTP ${response.status}`;

    throw new Error(message);
  }

  return body as T;
}

function formatValidationIssues(issues: unknown) {
  if (!Array.isArray(issues)) return 'Error de validacion';

  const details = issues
    .map((issue) => {
      if (!issue || typeof issue !== 'object') return '';

      const record = issue as { path?: unknown; message?: unknown };
      const path = Array.isArray(record.path) ? record.path.join('.') : String(record.path ?? '');
      const message = String(record.message ?? 'Valor invalido');

      return path ? `${path}: ${message}` : message;
    })
    .filter(Boolean);

  return details.length > 0 ? details.join(' | ') : 'Error de validacion';
}
