import { describe, expect, it } from 'vitest';
import {
  assertControlledSerie,
  isReusableBizlinksState,
  validateActivationGuards
} from '../services/greFormularioActivationService.js';

describe('GreFormularioActivationService guards', () => {
  it('requiere DRY_RUN=false', () => {
    expect(() => validateActivationGuards({ dryRun: true, directDbInsertEnabled: true })).toThrow(/DRY_RUN=false/);
  });

  it('requiere GRE_DIRECT_DB_INSERT_ENABLED=true', () => {
    expect(() => validateActivationGuards({ dryRun: false, directDbInsertEnabled: false })).toThrow(/GRE_DIRECT_DB_INSERT_ENABLED=true/);
  });

  it('solo permite activar la guia controlada T999-00000096', () => {
    expect(() => assertControlledSerie('T999-00000096')).not.toThrow();
    expect(() => assertControlledSerie('T999-00000097')).toThrow(/solo permite T999-00000096/);
    expect(() => assertControlledSerie('T001-00000096')).toThrow(/Solo T999/);
  });

  it('considera reutilizable una guia ya activada, liquidada o con respuesta', () => {
    expect(isReusableBizlinksState('A', 0)).toBe(true);
    expect(isReusableBizlinksState('L', 0)).toBe(true);
    expect(isReusableBizlinksState('N', 1)).toBe(true);
    expect(isReusableBizlinksState('N', 0)).toBe(false);
  });
});
