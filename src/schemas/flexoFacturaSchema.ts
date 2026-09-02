import { z } from 'zod';

export const FLEXO_FACTURA_SERIE = 'FF03';
export const FLEXO_FACTURA_SERIE_PATTERN = /^FF03-\d{8}$/;
export const FLEXO_GRE_REFERENCIA_PATTERN = /^T(003|999)-\d{8}$/;
export const FLEXO_DETRACCION_VALUES = ['000', '037', '025', '027'] as const;
export const FLEXO_TIPO_EXCLUSION_VALUES = ['GRAVADA', 'GRATUITA', 'EXONERADA', 'INAFECTA'] as const;

export const flexoFacturaPreviewSchema = z.object({
  serie: z.literal(FLEXO_FACTURA_SERIE).default(FLEXO_FACTURA_SERIE),
  numero: z.string().regex(/^\d{8}$/).optional().default('00000000'),
  fechaEmision: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  moneda: z.literal('PEN').default('PEN'),
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
    cantidad: z.coerce.number().positive(),
    precioUnitario: z.coerce.number().min(0),
    afectoIgv: z.boolean().default(true)
  })).min(1)
});

export type FlexoFacturaPreviewInput = z.infer<typeof flexoFacturaPreviewSchema>;
