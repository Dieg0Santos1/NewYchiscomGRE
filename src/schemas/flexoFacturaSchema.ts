import { z } from 'zod';

export const FLEXO_FACTURA_SERIE = 'FF03';
export const FLEXO_FACTURA_SERIE_PATTERN = /^FF03-\d{8}$/;
export const FLEXO_GRE_REFERENCIA_PATTERN = /^T(003|999)-\d{8}$/;
export const FLEXO_DETRACCION_VALUES = ['000', '037', '025', '027'] as const;
export const FLEXO_TIPO_EXCLUSION_VALUES = ['GRAVADA', 'GRATUITA', 'EXONERADA', 'INAFECTA'] as const;
export const FLEXO_MONEDA_VALUES = ['PEN', 'USD'] as const;

const cuotaSchema = z.object({
  fecha: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  monto: z.coerce.number().positive()
});

export const flexoFacturaPreviewSchema = z.object({
  serie: z.literal(FLEXO_FACTURA_SERIE).default(FLEXO_FACTURA_SERIE),
  numero: z.string().regex(/^\d{8}$/).optional().default('00000000'),
  fechaEmision: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  fechaVencimiento: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  moneda: z.enum(FLEXO_MONEDA_VALUES).default('USD'),
  diasPago: z.coerce.number().int().min(0).max(3650).default(0),
  cuotas: z.array(cuotaSchema).max(12, 'La factura permite como maximo 12 cuotas').optional(),
  formaPago: z.string().trim().min(1),
  cuenta: z.string().trim().min(1),
  detraccion: z.enum(FLEXO_DETRACCION_VALUES).default('000'),
  tipoExclusionProducto: z.enum(FLEXO_TIPO_EXCLUSION_VALUES).default('GRAVADA'),
  ordenCompra: z.string().trim().optional().default(''),
  observaciones: z.string().trim().optional().default(''),
  cliente: z.object({
    tipoDocumento: z.string().trim().min(1),
    numeroDocumento: z.string().trim().min(8),
    razonSocial: z.string().trim().min(1)
  }),
  guias: z.array(z.object({
    serieNumeroGuia: z.string().regex(FLEXO_GRE_REFERENCIA_PATTERN)
  })).min(1),
  items: z.array(z.object({
    id: z.string().trim().min(1),
    serieNumeroGuia: z.string().regex(FLEXO_GRE_REFERENCIA_PATTERN),
    codigoProducto: z.string().trim().min(1),
    descripcion: z.string().trim().min(1),
    unidadMedida: z.string().trim().min(1),
    moneda: z.enum(FLEXO_MONEDA_VALUES).optional(),
    cantidad: z.coerce.number().positive(),
    precioUnitario: z.coerce.number().min(0),
    afectoIgv: z.boolean().default(true)
  })).min(1).max(45, 'La factura permite como maximo 45 items')
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

export type FlexoFacturaPreviewInput = z.infer<typeof flexoFacturaPreviewSchema>;
