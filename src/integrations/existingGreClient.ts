import type { AppConfig } from '../config/env.js';
import type { GrePayload } from '../mappers/grePayloadMapper.js';
import { sanitizeValue } from '../utils/sanitize.js';

export class ExistingGreClientError extends Error {
  constructor(
    message: string,
    public readonly statusCode?: number,
    public readonly responseBody?: unknown
  ) {
    super(message);
    this.name = 'ExistingGreClientError';
  }
}

export type ExistingGreClient = {
  declareGre(payload: GrePayload): Promise<unknown>;
  getDestinos(numeroDocumentoAdquiriente: string): Promise<GreDestino[]>;
};

export type GreDestino = {
  id: string;
  codigoDestino: string;
  ubigeo: string;
  direccion: string;
  textoOriginal: string;
};

export function createExistingGreClient(config: AppConfig): ExistingGreClient {
  return {
    async declareGre(payload: GrePayload) {
      if (!config.existingGreApiToken) {
        throw new ExistingGreClientError('EXISTING_GRE_API_TOKEN no configurado');
      }

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), config.requestTimeoutMs);

      try {
        const response = await fetch(`${config.existingGreApiUrl}/api/SPE_DESPATCH/declarar`, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            token: config.existingGreApiToken
          },
          body: JSON.stringify(payload),
          signal: controller.signal
        });

        const responseText = await response.text();
        const responseBody = parseResponseBody(responseText);

        if (!response.ok) {
          throw new ExistingGreClientError(
            `La API existente respondio HTTP ${response.status}`,
            response.status,
            sanitizeValue(responseBody, [config.existingGreApiToken])
          );
        }

        return sanitizeValue(responseBody, [config.existingGreApiToken]);
      } catch (error) {
        if (error instanceof ExistingGreClientError) {
          throw error;
        }

        if (error instanceof Error && error.name === 'AbortError') {
          throw new ExistingGreClientError('Timeout al llamar a la API existente');
        }

        throw new ExistingGreClientError('Error al llamar a la API existente');
      } finally {
        clearTimeout(timeout);
      }
    },

    async getDestinos(numeroDocumentoAdquiriente: string) {
      const numeroDocumento = numeroDocumentoAdquiriente.trim();

      if (!numeroDocumento) {
        throw new ExistingGreClientError('Numero de documento requerido para consultar destinos');
      }

      if (!config.existingGreApiToken) {
        throw new ExistingGreClientError('EXISTING_GRE_API_TOKEN no configurado');
      }

      const responseBody = await postExistingApi(config, '/api/AAA/GetDestino', {
        NUMERODOCUMENTOADQUIRIENTE: numeroDocumento
      });

      if (!Array.isArray(responseBody)) {
        throw new ExistingGreClientError('Respuesta GetDestino mal formada');
      }

      return responseBody.map((item) => parseDestino(numeroDocumento, item));
    }
  };
}

async function postExistingApi(config: AppConfig, path: string, body: unknown) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.requestTimeoutMs);

  try {
    const response = await fetch(`${config.existingGreApiUrl}${path}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        token: config.existingGreApiToken
      },
      body: JSON.stringify(body),
      signal: controller.signal
    });

    const responseText = await response.text();
    const responseBody = parseResponseBody(responseText);

    if (!response.ok) {
      throw new ExistingGreClientError(
        `La API existente respondio HTTP ${response.status}`,
        response.status,
        sanitizeValue(responseBody, [config.existingGreApiToken])
      );
    }

    return sanitizeValue(responseBody, [config.existingGreApiToken]);
  } catch (error) {
    if (error instanceof ExistingGreClientError) {
      throw error;
    }

    if (error instanceof Error && error.name === 'AbortError') {
      throw new ExistingGreClientError('Timeout al llamar a la API existente');
    }

    throw new ExistingGreClientError('Error al llamar a la API existente');
  } finally {
    clearTimeout(timeout);
  }
}

function parseResponseBody(responseText: string): unknown {
  if (!responseText) return null;

  try {
    return JSON.parse(responseText);
  } catch {
    return responseText;
  }
}

function parseDestino(numeroDocumentoEsperado: string, raw: unknown): GreDestino {
  if (!raw || typeof raw !== 'object') {
    throw new ExistingGreClientError('Respuesta GetDestino mal formada');
  }

  const item = raw as { id?: unknown; text?: unknown };
  const id = typeof item.id === 'string' ? item.id.trim() : '';
  const text = typeof item.text === 'string' ? item.text.trim() : '';
  const textSeparatorIndex = text.indexOf('-');

  if (!id || !text || textSeparatorIndex <= 0) {
    throw new ExistingGreClientError('Respuesta GetDestino mal formada');
  }

  const ubigeoFromText = text.slice(0, textSeparatorIndex).trim();
  const direccionFromText = text.slice(textSeparatorIndex + 1).trim();
  const [numeroDocumento, ubigeoFromId, codigoDestino, ...direccionParts] = id.split('-');
  const direccionFromId = direccionParts.join('-').trim();
  const ubigeo = ubigeoFromId?.trim() || ubigeoFromText;
  const direccion = direccionFromId || direccionFromText;

  if (
    !numeroDocumento?.trim()
    || numeroDocumento.trim() !== numeroDocumentoEsperado
    || !/^\d{6}$/.test(ubigeo)
    || !codigoDestino?.trim()
    || !direccion
  ) {
    throw new ExistingGreClientError('Respuesta GetDestino mal formada');
  }

  return {
    id,
    codigoDestino: codigoDestino.trim(),
    ubigeo,
    direccion,
    textoOriginal: text
  };
}
