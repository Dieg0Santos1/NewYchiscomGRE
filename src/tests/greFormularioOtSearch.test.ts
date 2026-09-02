import { describe, expect, it } from 'vitest';
import { buildOtSearchTerms, normalizeYchiDestinations, parsePhysicalGuideInput } from '../services/greFormularioQueryService.js';

const referenceDate = new Date('2026-07-24T12:00:00-05:00');

describe('gre formularios physical guide input parser', () => {
  it('separa serie y numero con guion y rellena con ceros', () => {
    expect(parsePhysicalGuideInput('1-112948')).toEqual({ serie: '001', numero: '0112948' });
    expect(parsePhysicalGuideInput('001-0112948')).toEqual({ serie: '001', numero: '0112948' });
    expect(parsePhysicalGuideInput('2-45')).toEqual({ serie: '002', numero: '0000045' });
  });

  it('separa serie y numero sin guion si tiene exactamente 10 digitos', () => {
    expect(parsePhysicalGuideInput('0010112948')).toEqual({ serie: '001', numero: '0112948' });
  });

  it('devuelve null para formatos invalidos', () => {
    expect(parsePhysicalGuideInput('invalid')).toBeNull();
    expect(parsePhysicalGuideInput('123456789')).toBeNull(); // 9 digitos
    expect(parsePhysicalGuideInput('12345678901')).toBeNull(); // 11 digitos
  });
});

describe('gre formularios OT search terms', () => {
  it('resuelve una OT abreviada de guia fisica al numero interno del anio actual', () => {
    expect(buildOtSearchTerms('OT-588', referenceDate)).toContain('OT02600588');
  });

  it('resuelve varias OTs abreviadas escritas en observaciones', () => {
    const terms = buildOtSearchTerms('OT-563-564 / SRTA. MELIDA', referenceDate);

    expect(terms).toContain('OT02600563');
    expect(terms).toContain('OT02600564');
  });

  it('mantiene una OT completa sin generar otro numero artificial', () => {
    const terms = buildOtSearchTerms('OT02600588', referenceDate);

    expect(terms).toContain('OT02600588');
    expect(terms).not.toContain('OT0262600588');
  });

  it('resuelve una OT completa escrita con guion o solo con numeros', () => {
    expect(buildOtSearchTerms('OT-02600674', referenceDate)).toContain('OT02600674');
    expect(buildOtSearchTerms('02600674', referenceDate)).toContain('OT02600674');
  });
});

describe('gre formularios YCHIDB3 destinations', () => {
  it('normaliza destinos con ubigeo valido para el selector', () => {
    const destinos = normalizeYchiDestinations([
      {
        idClieProv: 4383,
        idClieDireccion: 5664,
        codigoDestino: 2,
        ubigeo: '150115',
        direccion: 'AV. LUNA PIZARRO 300 - LA VICTORIA '
      }
    ]);

    expect(destinos).toEqual([
      {
        id: 'YCHIDB3-4383-5664-150115',
        codigoDestino: '2',
        ubigeo: '150115',
        direccion: 'AV. LUNA PIZARRO 300 - LA VICTORIA',
        textoOriginal: '150115-AV. LUNA PIZARRO 300 - LA VICTORIA'
      }
    ]);
  });

  it('conserva destinos sin ubigeo valido para completar manualmente y evita duplicados', () => {
    const destinos = normalizeYchiDestinations([
      {
        idClieProv: 4383,
        idClieDireccion: 1,
        codigoDestino: 1,
        ubigeo: '',
        direccion: 'SIN UBIGEO'
      },
      {
        idClieProv: 4383,
        idClieDireccion: 2,
        codigoDestino: 2,
        ubigeo: '150115',
        direccion: 'AV. PASEO DE LA REPUBLICA'
      },
      {
        idClieProv: 4383,
        idClieDireccion: 3,
        codigoDestino: 3,
        ubigeo: '150115',
        direccion: 'AV. PASEO DE LA REPUBLICA '
      }
    ]);

    expect(destinos).toHaveLength(2);
    expect(destinos[0]).toMatchObject({
      codigoDestino: '1',
      ubigeo: '',
      direccion: 'SIN UBIGEO'
    });
    expect(destinos[1]?.codigoDestino).toBe('2');
  });
});
