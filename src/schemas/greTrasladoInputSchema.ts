import { z } from 'zod';
import { GRE_TRASLADO_SERIE_FORMAT_MESSAGE, GRE_TRASLADO_SERIE_PATTERN } from '../config/greTrasladoSeries.js';

const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Debe tener formato YYYY-MM-DD');
const timeSchema = z.string().regex(/^\d{2}:\d{2}:\d{2}$/, 'Debe tener formato HH:mm:ss');
const positiveNumber = z.coerce.number().positive('Debe ser mayor que cero');

const conductorSchema = z.object({
  tipoDocumentoConductor: z.string().min(1).max(2),
  numeroDocumentoConductor: z.string().min(1).max(11),
  nombreConductor: z.string().min(1).max(50),
  apellidoConductor: z.string().min(1).max(50),
  numeroLicencia: z.string().min(1).max(10)
});

const transportistaSchema = z.object({
  tipoDocumentoTransportista: z.string().min(1).max(2),
  numeroRucTransportista: z.string().min(11).max(11),
  razonSocialTransportista: z.string().min(1).max(100)
});

const trasladoMotivoSchema = z.enum(['01', '14', '02', '04', '18', '08', '09', '13', '03']);
const trasladoModalidadSchema = z.enum(['01', '02']);

export const greTrasladoItemInputSchema = z.object({
  codigoEmpaque: z.literal(0).default(0),
  codigoProducto: z.string().trim().min(1).max(16),
  descripcion: z.string().trim().min(1).max(500),
  cantidad: positiveNumber,
  cantidadOriginal: positiveNumber.optional(),
  cantidadPendiente: z.coerce.number().nonnegative().optional(),
  unidadMedida: z.string().trim().min(1).max(3).default('NIU'),
  moneda: z.string().min(1).default('-100'),
  importeUnitarioSinImpuesto: z.coerce.number().nonnegative().default(1),
  id: z.string().min(1).optional()
});

export const greTrasladoInputSchema = z
  .object({
    serieNumeroGuia: z.string().regex(GRE_TRASLADO_SERIE_PATTERN, GRE_TRASLADO_SERIE_FORMAT_MESSAGE),
    referenciaInterna: z.string().trim().max(80).optional().default(''),
    fechaEmisionGuia: dateSchema,
    horaEmisionGuia: timeSchema,
    fechaInicioTraslado: dateSchema,
    fechaEntregaBienes: dateSchema,
    observaciones: z.string().max(250).default(''),
    correoDestinatario: z.string().max(100).default('-'),
    destinatario: z.object({
      tipoDocumentoDestinatario: z.string().min(1).max(2).default('6'),
      numeroDocumentoDestinatario: z.string().min(1).max(15),
      razonSocialDestinatario: z.string().min(1).max(100)
    }),
    traslado: z.object({
      motivoTraslado: trasladoMotivoSchema.default('03'),
      descripcionMotivoTraslado: z.string().min(1).max(100).default('OTROS'),
      pesoBrutoTotalBienes: positiveNumber,
      unidadMedidaPesoBruto: z.literal('KGM').default('KGM'),
      modalidadTraslado: trasladoModalidadSchema.default('02'),
      numeroBultos: z.coerce.number().int().positive(),
      ubigeoPtoLlegada: z.string().regex(/^\d{6}$/, 'Debe ser un ubigeo de 6 digitos'),
      direccionPtoLlegada: z.string().min(1).max(100),
      codigoPtoLlegada: z.string().min(1).max(4).default('1')
    }),
    conductor: conductorSchema.optional(),
    vehiculo: z.object({
      numeroPlacaVehiculoPrin: z.string().min(1).max(8)
    }).optional(),
    transportista: transportistaSchema.optional(),
    items: z.array(greTrasladoItemInputSchema).min(1, 'Debe existir al menos un detalle')
  })
  .superRefine((value, ctx) => {
    if (value.traslado.modalidadTraslado === '02') {
      if (!value.conductor) {
        ctx.addIssue({
          code: 'custom',
          path: ['conductor'],
          message: 'Los datos del conductor son obligatorios para transporte privado'
        });
      }

      if (!value.vehiculo) {
        ctx.addIssue({
          code: 'custom',
          path: ['vehiculo'],
          message: 'Los datos del vehiculo son obligatorios para transporte privado'
        });
      }
    }

    if (value.traslado.modalidadTraslado === '01' && !value.transportista) {
      ctx.addIssue({
        code: 'custom',
        path: ['transportista'],
        message: 'Los datos del transportista son obligatorios para transporte publico'
      });
    }
  });

export type GreTrasladoInputDto = z.infer<typeof greTrasladoInputSchema>;
