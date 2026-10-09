import { describe, expect, it } from 'vitest';
import { legacyGuideLabel } from '../services/fcFacturaService.js';

describe('fc factura legacy sales register', () => {
  it('mantiene la guia completa para tbDocumentos.nguia', () => {
    expect(legacyGuideLabel('T001-00000120')).toBe('T001-00000120');
    expect(legacyGuideLabel(' T001-00000120 ')).toBe('T001-00000120');
  });
});
