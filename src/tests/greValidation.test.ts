import { describe, expect, it } from 'vitest';
import { greInputSchema } from '../schemas/greInputSchema.js';
import { validGreInput } from './fixtures.js';

describe('greInputSchema', () => {
  it('acepta codigoEmpaque 0 temporalmente', () => {
    const parsed = greInputSchema.safeParse(validGreInput);

    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.items[0]?.codigoEmpaque).toBe(0);
    }
  });

  it('acepta T999 como serie de prueba controlada', () => {
    const parsed = greInputSchema.safeParse({
      ...validGreInput,
      serieNumeroGuia: 'T999-00000093'
    });

    expect(parsed.success).toBe(true);
  });

  it('rechaza series distintas a T001 o T999 con ocho digitos', () => {
    const parsed = greInputSchema.safeParse({
      ...validGreInput,
      serieNumeroGuia: 'T003-00000093'
    });

    expect(parsed.success).toBe(false);
  });

  it('rechaza cantidad cero o negativa', () => {
    const parsed = greInputSchema.safeParse({
      ...validGreInput,
      items: [{ ...validGreInput.items[0], cantidad: 0 }]
    });

    expect(parsed.success).toBe(false);
  });

  it('acepta envio parcial con cantidad pendiente consistente', () => {
    const parsed = greInputSchema.safeParse({
      ...validGreInput,
      items: [{
        ...validGreInput.items[0],
        cantidadOriginal: 257,
        cantidad: 157,
        cantidadPendiente: 100
      }]
    });

    expect(parsed.success).toBe(true);
  });

  it('rechaza cantidad a enviar mayor a la cantidad original', () => {
    const parsed = greInputSchema.safeParse({
      ...validGreInput,
      items: [{
        ...validGreInput.items[0],
        cantidadOriginal: 257,
        cantidad: 258,
        cantidadPendiente: 0
      }]
    });

    expect(parsed.success).toBe(false);
  });

  it('requiere conductor y vehiculo para modalidadTraslado 02', () => {
    const parsed = greInputSchema.safeParse({
      ...validGreInput,
      conductor: undefined,
      vehiculo: undefined
    });

    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(parsed.error.issues.map((issue) => issue.path.join('.'))).toContain('conductor');
      expect(parsed.error.issues.map((issue) => issue.path.join('.'))).toContain('vehiculo');
    }
  });

  it('aplica los limites SUNAT de observaciones y descripcion', () => {
    expect(greInputSchema.safeParse({
      ...validGreInput,
      observaciones: 'X'.repeat(251)
    }).success).toBe(false);

    expect(greInputSchema.safeParse({
      ...validGreInput,
      items: [{ ...validGreInput.items[0], descripcion: 'X'.repeat(501) }]
    }).success).toBe(false);

    expect(greInputSchema.safeParse({
      ...validGreInput,
      items: [{ ...validGreInput.items[0], descripcion: 'AB' }]
    }).success).toBe(false);
  });
});
