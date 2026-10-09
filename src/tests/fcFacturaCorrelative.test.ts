import { describe, expect, it } from 'vitest';
import { nextAvailableFacturaNumber } from '../services/fcFacturaService.js';

describe('correlativo de factura FC', () => {
  it('rellena el primer hueco posterior a la ultima factura vigente', () => {
    expect(nextAvailableFacturaNumber([
      { serieNumero: 'FF01-00017172', estadoRegistro: 'L' },
      { serieNumero: 'FF01-00017174', estadoRegistro: 'E' }
    ])).toBe(17173);
  });

  it('salta numeros rechazados que ya existen en Bizlinks', () => {
    expect(nextAvailableFacturaNumber([
      { serieNumero: 'FF01-00017172', estadoRegistro: 'L' },
      { serieNumero: 'FF01-00017173', estadoRegistro: 'L' },
      { serieNumero: 'FF01-00017174', estadoRegistro: 'E' }
    ])).toBe(17175);
  });
});
