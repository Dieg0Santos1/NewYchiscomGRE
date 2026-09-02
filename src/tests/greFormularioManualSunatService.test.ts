import { describe, expect, it } from 'vitest';
import {
  buildManualAcceptedSunatMessage,
  isEligibleForManualSunatMessage
} from '../services/greFormularioManualSunatService.js';

describe('GreFormularioManualSunatService helpers', () => {
  it('construye el mismo mensaje de aceptacion que Bizlinks muestra al usuario', () => {
    expect(buildManualAcceptedSunatMessage('T999-00000099')).toBe(
      '{"codigo":"0","mensaje":"El Comprobante numero T999-00000099, ha sido aceptado"}'
    );
  });

  it('permite guias L / SIGNED/ED_06 o SIGNED/PE_02 / _2_CONSULT sin mensaje SUNAT', () => {
    expect(isEligibleForManualSunatMessage({
      bl_estadoRegistro: 'L',
      bl_estadoProceso: 'SIGNED/ED_06',
      process_state: '_2_CONSULT',
      bl_mensajeSunat: null
    })).toBe(true);

    expect(isEligibleForManualSunatMessage({
      bl_estadoRegistro: 'L',
      bl_estadoProceso: 'SIGNED/PE_02',
      process_state: '_2_CONSULT',
      bl_mensajeSunat: null
    })).toBe(true);

    expect(isEligibleForManualSunatMessage({
      bl_estadoRegistro: 'L',
      bl_estadoProceso: 'SIGNED/ED_06',
      process_state: '_2_CONSULT',
      bl_mensajeSunat: '{"codigo":"0"}'
    })).toBe(false);

    expect(isEligibleForManualSunatMessage({
      bl_estadoRegistro: 'A',
      bl_estadoProceso: 'SIGNED/ED_06',
      process_state: '_2_CONSULT',
      bl_mensajeSunat: null
    })).toBe(false);

    expect(isEligibleForManualSunatMessage({
      bl_estadoRegistro: 'L',
      bl_estadoProceso: 'SIGNED/XX_00',
      process_state: '_2_CONSULT',
      bl_mensajeSunat: null
    })).toBe(false);
  });
});
