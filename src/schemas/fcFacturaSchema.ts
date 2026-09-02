import { z } from 'zod';

export const FC_FACTURA_SERIE = 'FF01';
export const FC_FACTURA_SERIE_NUMERO_PREVIEW = `${FC_FACTURA_SERIE}-00000000`;
export const FC_FACTURA_SERIE_PATTERN = /^FF01-\d{8}$/;
export const FC_GRE_REFERENCIA_PATTERN = /^T(?:001|999)-\d{8}$/;
export const FC_TIPO_DETRACCION_VALUES = ['037', '025'] as const;
export const FC_TIPO_EXCLUSION_VALUES = ['GRAVADA', 'GRATUITA', 'EXONERADA', 'INAFECTA'] as const;

export const fcFacturaPreviewSchema = z.object({
  serie: z.literal(FC_FACTURA_SERIE).default(FC_FACTURA_SERIE),
  numero: z.string().regex(/^\d{8}$/).optional().default('00000000'),
  fechaEmision: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  moneda: z.literal('PEN').default('PEN'),
  formaPago: z.string().trim().min(1),
  cuenta: z.string().trim().min(1),
  tipoDetraccion: z.enum(FC_TIPO_DETRACCION_VALUES).default('037'),
  tipoExclusionProducto: z.enum(FC_TIPO_EXCLUSION_VALUES).default('GRAVADA'),
  vendedor: z.object({
    idEmpleado: z.coerce.number().int().positive().nullable().optional().default(null),
    nombre: z.string().trim().optional().default('')
  }).optional().default({ idEmpleado: null, nombre: '' }),
  ordenCompra: z.string().trim().optional().default(''),
  observaciones: z.string().trim().optional().default(''),
  cliente: z.object({
    tipoDocumento: z.string().trim().min(1),
    numeroDocumento: z.string().trim().min(8),
    razonSocial: z.string().trim().min(1)
  }),
  guias: z.array(z.object({
    serieNumeroGuia: z.string().regex(FC_GRE_REFERENCIA_PATTERN)
  })).min(1),
  items: z.array(z.object({
    id: z.string().trim().min(1),
    serieNumeroGuia: z.string().regex(FC_GRE_REFERENCIA_PATTERN),
    codigoProducto: z.string().trim().min(1),
    descripcion: z.string().trim().min(1),
    unidadMedida: z.string().trim().min(1),
    cantidad: z.coerce.number().positive(),
    precioUnitario: z.coerce.number().min(0),
    afectoIgv: z.boolean().default(true)
  })).min(1)
});

export type FcFacturaPreviewInput = z.infer<typeof fcFacturaPreviewSchema>;
