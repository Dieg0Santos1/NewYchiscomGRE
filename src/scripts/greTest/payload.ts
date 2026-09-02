import type { GreInputDto } from '../../schemas/greInputSchema.js';

const limaTimeZone = 'America/Lima';
const maxPreviewAgeMs = 30 * 60 * 1000;

export function buildControlledGreTestDto(now = new Date()): GreInputDto {
  const current = getLimaDateTime(now);

  return {
    serieNumeroGuia: 'T999-00000000',
    fechaEmisionGuia: current.date,
    horaEmisionGuia: current.time,
    fechaInicioTraslado: current.date,
    fechaEntregaBienes: current.date,
    observaciones: 'PRUEBA TECNICA CONTROLADA FORMULARIOS CONTINUOS',
    correoDestinatario: '-',
    destinatario: {
      tipoDocumentoDestinatario: '6',
      numeroDocumentoDestinatario: '10406265574',
      razonSocialDestinatario: 'ORLANDO BORITZ LLERENA DELGADO'
    },
    traslado: {
      motivoTraslado: '01',
      descripcionMotivoTraslado: 'VENTA',
      pesoBrutoTotalBienes: 1,
      unidadMedidaPesoBruto: 'KGM',
      modalidadTraslado: '02',
      numeroBultos: 1,
      ubigeoPtoLlegada: '150101',
      direccionPtoLlegada: 'AV. TOMAS VALLE 917 DPTO. T-404',
      codigoPtoLlegada: '1'
    },
    conductor: {
      tipoDocumentoConductor: '1',
      numeroDocumentoConductor: '09517108',
      nombreConductor: 'JUAN JOSE',
      apellidoConductor: 'APARICIO HERRERA',
      numeroLicencia: 'Q09517108'
    },
    vehiculo: {
      numeroPlacaVehiculoPrin: 'A45895'
    },
    items: [
      {
        codigoEmpaque: 0,
        codigoProducto: '878866',
        descripcion: 'ROLLOS TERMICO 20.30 cm. X 7.95 cm. X 1, Juego X 1, SERIE: 0, DEL: 0, AL: 0, TIRA:0, PAPEL: Bond, DESGLOSE: Ninguno, NUMERACION: Sin dato, C.H.: , C.V.:',
        cantidad: 20,
        unidadMedida: 'UND',
        moneda: '-100',
        importeUnitarioSinImpuesto: 1,
        id: '878866'
      }
    ]
  };
}

export function assertControlledGreTestDtoIsCurrent(dto: GreInputDto, now = new Date()) {
  const current = getLimaDateTime(now);
  const errors = [];

  if (dto.fechaEmisionGuia !== current.date) {
    errors.push(`fechaEmisionGuia=${dto.fechaEmisionGuia}; esperado ${current.date}`);
  }

  if (dto.fechaInicioTraslado !== current.date) {
    errors.push(`fechaInicioTraslado=${dto.fechaInicioTraslado}; esperado ${current.date}`);
  }

  const previewDate = Date.parse(`${dto.fechaEmisionGuia}T${dto.horaEmisionGuia}-05:00`);

  if (Number.isNaN(previewDate)) {
    errors.push(`horaEmisionGuia invalida: ${dto.horaEmisionGuia}`);
  } else {
    const ageMs = now.getTime() - previewDate;

    if (ageMs < -5 * 60 * 1000 || ageMs > maxPreviewAgeMs) {
      errors.push('horaEmisionGuia no corresponde a un preview reciente; vuelva a ejecutar npm run gre:test:preview');
    }
  }

  if (errors.length > 0) {
    throw new Error(`Preview T999 no vigente: ${errors.join('; ')}`);
  }
}

export const controlledGreTestDto: GreInputDto = buildControlledGreTestDto();

function getLimaDateTime(date: Date) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: limaTimeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23'
  }).formatToParts(date);
  const values = new Map(parts.map((part) => [part.type, part.value]));

  return {
    date: `${values.get('year')}-${values.get('month')}-${values.get('day')}`,
    time: `${values.get('hour')}:${values.get('minute')}:${values.get('second')}`
  };
}
