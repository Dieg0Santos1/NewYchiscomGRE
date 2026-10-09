import { z } from 'zod';

export const FC_FACTURA_SERIE = 'FF01';
export const FC_FACTURA_SERIE_NUMERO_PREVIEW = `${FC_FACTURA_SERIE}-00000000`;
export const FC_FACTURA_SERIE_PATTERN = /^FF01-\d{8}$/;
export const FC_GRE_REFERENCIA_PATTERN = /^T(?:001|999)-\d{8}$/;
export const FC_TIPO_DETRACCION_VALUES = ['000', '037', '025'] as const;
export const FC_TIPO_EXCLUSION_VALUES = ['GRAVADA', 'GRATUITA', 'EXONERADA', 'INAFECTA'] as const;
export const FC_MONEDA_VALUES = ['PEN', 'USD'] as const;
export const FC_FACTURA_MAX_GUIAS = 5;

const cuotaSchema = z.object({
  fecha: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  monto: z.coerce.number().positive()
});

export const fcFacturaPreviewSchema = z.object({
  serie: z.literal(FC_FACTURA_SERIE).default(FC_FACTURA_SERIE),
  numero: z.string().regex(/^\d{8}$/).optional().default('00000000'),
  fechaEmision: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  fechaVencimiento: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  moneda: z.enum(FC_MONEDA_VALUES).default('PEN'),
  tipoCambio: z.coerce.number().positive().nullable().optional().default(null),
  formaPago: z.string().trim().min(1),
  diasPago: z.coerce.number().int().min(0).max(3650).default(0),
  cuotas: z.array(cuotaSchema).max(12, 'La factura permite como maximo 12 cuotas').optional(),
  cuenta: z.string().trim().min(1),
  tipoDetraccion: z.enum(FC_TIPO_DETRACCION_VALUES).default('000'),
  tipoExclusionProducto: z.enum(FC_TIPO_EXCLUSION_VALUES).default('GRAVADA'),
  vendedor: z.object({
    idEmpleado: z.coerce.number().int().positive().nullable().optional().default(null),
    nombre: z.string().trim().optional().default('')
  }).optional().default({ idEmpleado: null, nombre: '' }),
  ordenCompra: z.string().trim().optional().default(''),
  numeroRegistro: z.string().trim().max(80).optional(),
  observaciones: z.string().trim().optional().default(''),
  cliente: z.object({
    tipoDocumento: z.string().trim().min(1),
    numeroDocumento: z.string().trim().min(8),
    razonSocial: z.string().trim().min(1),
    direccionFiscal: z.object({
      direccion: z.string().trim().min(1),
      ubigeo: z.string().trim().regex(/^\d{6}$/),
      distrito: z.string().trim().min(1),
      provincia: z.string().trim().min(1),
      departamento: z.string().trim().min(1),
      pais: z.string().trim().length(2),
      fuente: z.enum(['AAA_ADQUIRIENTE', 'FACTURA_ACEPTADA', 'YCHIDB3'])
    }).nullable().optional()
  }),
  guias: z.array(z.object({
    serieNumeroGuia: z.string().regex(FC_GRE_REFERENCIA_PATTERN)
  })).min(1).max(FC_FACTURA_MAX_GUIAS, `La factura permite como maximo ${FC_FACTURA_MAX_GUIAS} GRE`),
  items: z.array(z.object({
    id: z.string().trim().min(1),
    serieNumeroGuia: z.string().regex(FC_GRE_REFERENCIA_PATTERN),
    codigoProducto: z.string().trim().min(1),
    descripcion: z.string().trim().min(1),
    unidadMedida: z.string().trim().min(1),
    cantidad: z.coerce.number().positive(),
    precioUnitario: z.coerce.number().min(0),
    afectoIgv: z.boolean().default(true)
  })).min(1).max(45, 'La factura permite como maximo 45 items, limite respaldado por el historial aceptado')
}).superRefine((input, ctx) => {
  if (!input.fechaVencimiento) return;

  if (input.fechaVencimiento < input.fechaEmision) {
    ctx.addIssue({
      code: 'custom',
      path: ['fechaVencimiento'],
      message: 'La fecha de vencimiento no puede ser anterior a la fecha de emision.'
    });
  }

  (input.cuotas ?? []).forEach((cuota, index) => {
    if (cuota.fecha < input.fechaEmision) {
      ctx.addIssue({
        code: 'custom',
        path: ['cuotas', index, 'fecha'],
        message: 'La fecha de cuota no puede ser anterior a la fecha de emision.'
      });
    }
  });
});

export type FcFacturaPreviewInput = z.infer<typeof fcFacturaPreviewSchema>;
