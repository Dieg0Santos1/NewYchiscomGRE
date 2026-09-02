import { afterEach, describe, expect, it, vi } from 'vitest';
import { createExistingGreClient, ExistingGreClientError } from '../integrations/existingGreClient.js';
import { testConfig } from './fixtures.js';

describe('existingGreClient.getDestinos', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('normaliza destinos y conserva direcciones con guiones', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      text: vi.fn().mockResolvedValue(JSON.stringify([
        {
          id: '10406265574-150101-1-AV. TOMAS VALLE 917 DPTO. T-404',
          text: '150101-AV. TOMAS VALLE 917 DPTO. T-404'
        }
      ]))
    }));

    const client = createExistingGreClient(testConfig);
    const destinos = await client.getDestinos('10406265574');

    expect(destinos).toEqual([
      {
        id: '10406265574-150101-1-AV. TOMAS VALLE 917 DPTO. T-404',
        codigoDestino: '1',
        ubigeo: '150101',
        direccion: 'AV. TOMAS VALLE 917 DPTO. T-404',
        textoOriginal: '150101-AV. TOMAS VALLE 917 DPTO. T-404'
      }
    ]);
    expect(fetch).toHaveBeenCalledWith(
      'http://192.168.1.140:92/api/AAA/GetDestino',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ NUMERODOCUMENTOADQUIRIENTE: '10406265574' })
      })
    );
  });

  it('rechaza respuestas mal formadas', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      text: vi.fn().mockResolvedValue(JSON.stringify([{ id: 'bad', text: '150101' }]))
    }));

    const client = createExistingGreClient(testConfig);

    await expect(client.getDestinos('10406265574')).rejects.toBeInstanceOf(ExistingGreClientError);
  });
});
