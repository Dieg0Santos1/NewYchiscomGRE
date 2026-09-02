import type { GreFormState } from '../types/gre';

function pad(value: number) {
  return String(value).padStart(2, '0');
}

const SUNAT_CLOCK_SAFETY_MINUTES = 15;

export function todayDate() {
  const now = new Date();
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

export function currentTime() {
  const now = new Date();
  return `${pad(now.getHours())}:${pad(now.getMinutes())}:00`;
}

export function sunatDateTime() {
  const adjusted = new Date(Date.now() - SUNAT_CLOCK_SAFETY_MINUTES * 60 * 1000);
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'America/Lima',
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  }).formatToParts(adjusted);
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? '00';

  return {
    date: `${get('year')}-${get('month')}-${get('day')}`,
    time: `${get('hour')}:${get('minute')}:${get('second')}`
  };
}

export function createDefaultFormState(): GreFormState {
  const date = todayDate();

  return {
    searchText: '',
    searchType: 'OT',
    selectedIdDocumentos: '',
    ordenCompra: '',
    empresa: '20259402965-6-YCHIFORMAS S.A.',
    fechaEmisionGuia: date,
    horaEmisionGuia: currentTime(),
    fechaInicioTraslado: date,
    fechaEntregaBienes: date,
    serie: ACTIVE_SERIE,
    numero: '',
    tipoDocumentoDestinatario: '6',
    numeroDocumentoDestinatario: '',
    razonSocialDestinatario: '',
    correoDestinatario: '-',
    ubigeoPtoLlegada: '',
    direccionPtoLlegada: '',
    codigoPtoLlegada: '1',
    origen: '140109-AV. LUNA PIZARRO NRO. 1328(1332-1336-1340 PUERTA DE INGRESO 1340)',
    modalidadTraslado: '02',
    motivoTraslado: '',
    descripcionMotivoTraslado: '',
    pesoBrutoTotalBienes: 1,
    unidadMedidaPesoBruto: 'KGM',
    numeroBultos: 1,
    observaciones: '',
    tipoDocumentoConductor: '1',
    numeroDocumentoConductor: '',
    nombreConductor: '',
    apellidoConductor: '',
    numeroLicencia: '',
    numeroPlacaVehiculoPrin: '',
    selectedPrivateDriverId: '',
    items: []
  };
}
import { ACTIVE_SERIE } from './series';
