import { describe, expect, it } from 'vitest';
import { mapGuideStatusForReport } from '../services/greFormularioQueryService.js';

describe('GRE Formularios report status', () => {
  it('muestra rechazado cuando Bizlinks/SUNAT devuelve mensaje de RUC inexistente', () => {
    expect(mapGuideStatusForReport(
      {
        estadoOperacion: 'ACTIVADO',
        estadoEnvio: 'ACTIVADO'
      },
      {
        bl_estadoRegistro: 'L',
        responseEstadoRegistro: 'L',
        bl_estadoProceso: 'SIGNED/ED_06',
        process_state: '_2_CONSULT',
        bl_mensaje: null,
        bl_mensajeSunat: 'El número del RUC del Destinatario no existe'
      }
    )).toBe('RECHAZADA');
  });

  it('mantiene en proceso cuando no hay mensaje SUNAT', () => {
    expect(mapGuideStatusForReport(
      {
        estadoOperacion: 'ACTIVADO',
        estadoEnvio: 'ACTIVADO'
      },
      {
        bl_estadoRegistro: 'L',
        responseEstadoRegistro: 'L',
        bl_estadoProceso: 'SIGNED/ED_06',
        process_state: '_2_CONSULT',
        bl_mensaje: null,
        bl_mensajeSunat: null
      }
    )).toBe('EN_PROCESO');
  });
});
