import { describe, expect, it } from 'vitest';
import {
  assertControlledGreTestDtoIsCurrent,
  buildControlledGreTestDto
} from '../scripts/greTest/payload.js';

describe('controlled GRE test payload', () => {
  it('genera fechas y hora desde el momento del preview en Lima', () => {
    const now = new Date('2026-07-22T16:35:40.000Z');
    const dto = buildControlledGreTestDto(now);

    expect(dto.fechaEmisionGuia).toBe('2026-07-22');
    expect(dto.fechaInicioTraslado).toBe('2026-07-22');
    expect(dto.fechaEntregaBienes).toBe('2026-07-22');
    expect(dto.horaEmisionGuia).toBe('11:35:40');
    expect(dto.traslado.direccionPtoLlegada).toBe('AV. TOMAS VALLE 917 DPTO. T-404');
  });

  it('rechaza un preview antiguo antes de enviar', () => {
    const dto = buildControlledGreTestDto(new Date('2026-07-22T16:00:00.000Z'));

    expect(() =>
      assertControlledGreTestDtoIsCurrent(dto, new Date('2026-07-22T16:45:01.000Z'))
    ).toThrow(/Preview T999 no vigente/);
  });
});
