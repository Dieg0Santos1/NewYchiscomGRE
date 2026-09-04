import { z } from 'zod';
import { GRE_FC_SERIE_FORMAT_MESSAGE, GRE_FC_SERIE_PATTERN } from '../config/greSeries.js';

const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Debe tener formato YYYY-MM-DD');
const timeSchema = z.string().regex(/^\d{2}:\d{2}:\d{2}$/, 'Debe tener formato HH:mm:ss');
const fcSerieSchema = z.string().regex(GRE_FC_SERIE_PATTERN, GRE_FC_SERIE_FORMAT_MESSAGE);
const positiveNumber = z.coerce.number().positive('Debe ser mayor que cero');

const conductorSchema = z.object({
  tipoDocumentoConductor: z.string().min(1),
  numeroDocumentoConductor: z.string().min(1),
  nombreConductor: z.string().min(1),
  apellidoConductor: z.string().min(1),
  numeroLicencia: z.string().min(1)
});

export const greItemInputSchema = z.object({
  codigoEmpaque: z.coerce.number().int().nonnegative().default(0),
  codigoProducto: z.string().min(1),
  descripcion: z.string().trim().min(3).max(500),
  cantidad: positiveNumber,
  cantidadOriginal: positiveNumber.optional(),
  cantidadPendiente: z.coerce.number().nonnegative().optional(),
  unidadMedida: z.string().min(1).default('MIL'),
  moneda: z.string().min(1).default('-100'),
  importeUnitarioSinImpuesto: z.coerce.number().nonnegative().default(1),
  id: z.string().min(1).optional()
}).superRefine((value, ctx) => {
  if (value.cantidadOriginal !== undefined && value.cantidad > value.cantidadOriginal) {
    ctx.addIssue({
      code: 'custom',
      path: ['cantidad'],
      message: 'La cantidad a enviar no puede superar la cantidad original'
    });
  }

  if (
    value.cantidadOriginal !== undefined
    && value.cantidadPendiente !== undefined
    && Math.abs((value.cantidadOriginal - value.cantidad) - value.cantidadPendiente) > 0.000001
  ) {
    ctx.addIssue({
      code: 'custom',
      path: ['cantidadPendiente'],
      message: 'La cantidad pendiente debe coincidir con cantidadOriginal - cantidad'
    });
  }
});

export const greInputSchema = z
  .object({
    serieNumeroGuia: fcSerieSchema,
    fechaEmisionGuia: dateSchema,
    horaEmisionGuia: timeSchema,
    fechaInicioTraslado: dateSchema,
    fechaEntregaBienes: dateSchema,
    observaciones: z.string().max(250).default(''),
    correoDestinatario: z.string().min(1).default('-'),
    trazabilidadYchiscom: z.object({
      origenOperacion: z.enum(['FRONT_MANUAL', 'YCHISCOM_AUTOMATICO']).default('FRONT_MANUAL'),
      idGuiaFisicaYchiscom: z.coerce.number().int().positive().nullable().optional(),
      numeroGuiaFisica: z.string().max(30).nullable().optional(),
      idDocumentoYchiscom: z.coerce.number().int().positive().nullable().optional()
    }).optional(),
    destinatario: z.object({
      tipoDocumentoDestinatario: z.string().min(1).default('6'),
      numeroDocumentoDestinatario: z.string().min(1),
      razonSocialDestinatario: z.string().min(1)
    }),
    traslado: z.object({
      motivoTraslado: z.string().min(1).default('01'),
      descripcionMotivoTraslado: z.string().min(1).default('VENTA'),
      pesoBrutoTotalBienes: positiveNumber,
      unidadMedidaPesoBruto: z.string().min(1).default('KGM'),
      modalidadTraslado: z.string().min(1).default('02'),
      numeroBultos: z.coerce.number().int().positive(),
      ubigeoPtoLlegada: z.string().min(6),
      direccionPtoLlegada: z.string().min(1),
      codigoPtoLlegada: z.string().min(1).default('1')
    }),
    conductor: conductorSchema.optional(),
    vehiculo: z.object({
      numeroPlacaVehiculoPrin: z.string().min(1)
    }).optional(),
    items: z.array(greItemInputSchema).min(1, 'Debe existir al menos un detalle')
  })
  .superRefine((value, ctx) => {
    if (value.traslado.modalidadTraslado === '02' && !value.conductor) {
      ctx.addIssue({
        code: 'custom',
        path: ['conductor'],
        message: 'Los datos del conductor son obligatorios para modalidadTraslado 02'
      });
    }

    if (value.traslado.modalidadTraslado === '02' && !value.vehiculo) {
      ctx.addIssue({
        code: 'custom',
        path: ['vehiculo'],
        message: 'Los datos del vehiculo son obligatorios para modalidadTraslado 02'
      });
    }
  });

export type GreInputDto = z.infer<typeof greInputSchema>;
