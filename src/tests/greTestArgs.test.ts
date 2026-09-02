import { describe, expect, it } from 'vitest';
import { getSingleUuidArg } from '../scripts/greTest/args.js';

describe('greTest args', () => {
  it('acepta UUID valido y descarta marcador npm ***', () => {
    const result = getSingleUuidArg(['***', '696db1ee-d8ec-43e3-80c8-886f4afe1d24'], 'gre:test:activate');

    expect(result).toEqual({
      ok: true,
      value: '696db1ee-d8ec-43e3-80c8-886f4afe1d24'
    });
  });

  it('rechaza valores que no son UUID', () => {
    const result = getSingleUuidArg(['no-es-uuid'], 'gre:test:activate');

    expect(result.ok).toBe(false);
  });
});
