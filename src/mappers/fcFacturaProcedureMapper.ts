import type { GreDefaults } from '../config/greDefaults.js';
import type { FcFacturaPreviewInput } from '../schemas/fcFacturaSchema.js';
import type { StoredProcedureParam } from './speDespatchProcedureMapper.js';

export type FcFacturaProcedurePlan = {
  USP_CabeceraFE: StoredProcedureParam[];
  USP_DetalleFE: StoredProcedureParam[][];
  USP_EnviaDocumentoFE: StoredProcedureParam[];
};

type Totals = {
  gravada: number;
  gratuita?: number;
  exonerada?: number;
  inafecta?: number;
  igv: number;
  total: number;
};

const BANCO_NACION_DETRACCION = '00-099022671';

export function toFcFacturaProcedurePlan(
  input: FcFacturaPreviewInput,
  defaults: GreDefaults,
  totals: Totals
): FcFacturaProcedurePlan {
  const serieNumero = `${input.serie}-${input.numero}`;

  return {
    USP_CabeceraFE: toUspCabeceraFeParams(input, defaults, totals, serieNumero),
    USP_DetalleFE: input.items.map((item, index) => toUspDetalleFeParams(input, defaults, serieNumero, item, index)),
    USP_EnviaDocumentoFE: [
      { name: 'NUMERODOCUMENTOEMISOR', value: defaults.remitente.numeroDocumento },
      { name: 'SERIENUMERO', value: serieNumero },
      { name: 'TIPODOCUMENTO', value: '01' }
    ]
  };
}

function toUspCabeceraFeParams(
  input: FcFacturaPreviewInput,
  defaults: GreDefaults,
  totals: Totals,
  serieNumero: string
): StoredProcedureParam[] {
  const firstGuide = input.guias[0]?.serieNumeroGuia ?? '';
  const guideReference = firstGuide ? `0${firstGuide}` : null;
  const detraction = detractionSettings(input.tipoDetraccion);
  const detractionInInvoiceCurrency = detraction ? roundMoney(totals.total * detraction.percent / 100) : 0;
  const totalDetraction = detraction
    ? roundMoney(detractionInInvoiceCurrency * (input.moneda === 'USD' ? roundMoney(requiredExchangeRate(input)) : 1))
    : 0;
  const netPending = roundMoney(totals.total - detractionInInvoiceCurrency);
  const paymentSchedule = invoicePaymentSchedule(input, { total: netPending });
  const dueDate = paymentSchedule.dueDate;
  const isCredit = paymentSchedule.isCredit;

  return withDefaults(headerParamNames, {
    NUMERODOCUMENTOEMISOR: defaults.remitente.numeroDocumento,
    SERIENUMERO: serieNumero,
    TIPODOCUMENTO: '01',
    TIPODOCUMENTOEMISOR: defaults.remitente.tipoDocumento,
    BL_ESTADOREGISTRO: 'N',
    BL_REINTENTO: '0',
    BL_ORIGEN: 'D',
    BL_HASFILERESPONSE: '0',
    CORREOADQUIRIENTE: '-',
    CORREOEMISOR: defaults.remitente.correo,
    DEPARTAMENTOEMISOR: 'LIMA',
    DIRECCIONEMISOR: defaults.puntoPartida.direccion,
    DISTRITOEMISOR: 'LA VICTORIA',
    FECHAEMISION: input.fechaEmision,
    NOMBRECOMERCIALEMISOR: defaults.remitente.razonSocial,
    NUMERODOCUMENTOADQUIRIENTE: input.cliente.numeroDocumento,
    PAISEMISOR: 'PE',
    PROVINCIAEMISOR: 'LIMA',
    RAZONSOCIALADQUIRIENTE: input.cliente.razonSocial,
    RAZONSOCIALEMISOR: defaults.remitente.razonSocial,
    codigoLeyenda_1: '1000',
    textoLeyenda_1: invoiceAmountInWords(totals.total, input.moneda),
    tipoDocumentoAdquiriente: input.cliente.tipoDocumento,
    tipoMoneda: input.moneda,
    totalIGV: money(totals.igv),
    totalISC: '0.00',
    totalOtrosCargos: '0.00',
    totalOtrosTributos: '0.00',
    totalValorVentaNetoOpExonerada: money(totals.exonerada ?? 0),
    totalValorVentaNetoOpGratuitas: money(totals.gratuita ?? 0),
    totalValorVentaNetoOpGravadas: money(totals.gravada),
    totalValorVentaNetoOpNoGravada: money(totals.inafecta ?? 0),
    totalvalorVentaNetoOpExporta: '0.00',
    totalVenta: money(totals.total),
    // FF01 fiscal address verified against accepted invoice FF01-00017146.
    // The GRE departure ubigeo uses a different legacy catalog.
    ubigeoEmisor: '150115',
    urbanizacion: 'FUNDO MATUTE',
    // Accepted FF01 USD invoices leave this Bizlinks extension empty. The
    // exchange rate is only used to express the detraction in PEN.
    tipocambio: null,
    direccionAdquiriente: input.cliente.direccionFiscal?.direccion ?? '-',
    totalImpuestos: money(totals.igv),
    // USP_EnviaDocumentoFE sets 9218 for guide invoices; its text must exist.
    codigoAuxiliar40_1: '9218',
    textoAuxiliar40_1: input.vendedor.nombre.trim().slice(0, 40) || '-',
    tipoOperacion: detraction ? '1001' : '0101',
    horaEmision: currentTime(),
    codigoLocalAnexoEmisor: '0000',
    GUIAREMISION: guideReference,
    ORDENCOMPRA: emptyToDash(input.ordenCompra),
    TIPOGUIAREMISION: firstGuide ? '09' : null,
    // Accepted credit FF01 documents use Bizlinks code 999. The descriptive
    // payment term remains in local trace data and diasPago drives the quota.
    formapago: isCredit ? '999' : null,
    ubigeoAdquiriente: input.cliente.direccionFiscal?.ubigeo ?? '-',
    urbanizacionAdquiriente: '-',
    provinciaAdquiriente: input.cliente.direccionFiscal?.provincia ?? '-',
    departamentoAdquiriente: input.cliente.direccionFiscal?.departamento ?? '-',
    distritoAdquiriente: input.cliente.direccionFiscal?.distrito ?? '-',
    paisAdquiriente: input.cliente.direccionFiscal?.pais ?? 'PE',
    facturaPagoNegociable: isCredit ? '1' : '0',
    // USP_CabeceraFE accumulates every cuota into this parameter before
    // persisting montoNetoPendiente. Start at zero to avoid doubling it.
    montoNetoPendiente: isCredit ? '0.00' : null,
    ...paymentScheduleParams(paymentSchedule.cuotas),
    CODIGODETRACCION: detraction?.code ?? null,
    PORCENTAJEDETRACCION: detraction ? money(detraction.percent) : null,
    TOTALDETRACCION: detraction ? money(totalDetraction) : null,
    BANCONACION: detraction ? BANCO_NACION_DETRACCION : null,
    fechaVencimiento: dueDate
  });
}

function toUspDetalleFeParams(
  input: FcFacturaPreviewInput,
  defaults: GreDefaults,
  serieNumero: string,
  item: FcFacturaPreviewInput['items'][number],
  index: number
): StoredProcedureParam[] {
  const base = roundMoney(item.cantidad * item.precioUnitario);
  const tax = taxSettings(input.tipoExclusionProducto);
  const igv = tax.igvRate > 0 ? roundMoney(base * tax.igvRate) : 0;
  const total = roundMoney(base + igv);

  return withDefaults(detailParamNames, {
    NUMERODOCUMENTOEMISOR: defaults.remitente.numeroDocumento,
    SERIENUMERO: serieNumero,
    TIPODOCUMENTO: '01',
    TIPODOCUMENTOEMISOR: defaults.remitente.tipoDocumento,
    NUMEROORDENITEM: String(index + 1),
    CANTIDAD: quantity(item.cantidad),
    CODIGOPRODUCTO: item.codigoProducto,
    CODIGORAZONEXONERACION: tax.reasonCode,
    DESCRIPCION: invoiceItemDescription(item.descripcion, input.numeroRegistro),
    IMPORTEDESCUENTO: '0.00',
    importeTotalSinImpuesto: money(base),
    importeUnitarioConImpuesto: money(total / item.cantidad),
    importeUnitarioSinImpuesto: money(item.precioUnitario),
    CODIGOIMPORTEREFERENCIAL: null,
    IMPORTEREFERENCIAL: null,
    UNIDADMEDIDA: normalizeUnit(item.unidadMedida),
    codigoImporteUnitarioConImpuesto: tax.unitPriceCode,
    ImporteIGV: money(igv),
    ImporteISC: '0.00',
    importeCargo: '0.00',
    // Accepted FF01 invoices leave this optional catalog code empty.
    codigoProductoSUNAT: null,
    montoBaseIgv: money(base),
    tasaIGV: money(tax.igvRate * 100),
    importeTotalImpuestos: money(igv),
    importeBaseDescuento: '0.00',
    factorDescuento: '0.00',
    textoAuxiliar250_1: item.serieNumeroGuia
  });
}

function withDefaults(names: string[], values: Record<string, string | number | null | undefined>) {
  return names.map((name) => ({
    name,
    value: values[name] ?? null
  }));
}

function money(value: number) {
  return roundMoney(value).toFixed(2);
}

function quantity(value: number) {
  return String(value);
}

function roundMoney(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function normalizeUnit(value: string) {
  const unit = value.trim().toUpperCase();
  if (unit === 'UND') return 'NIU';
  if (unit === 'UNIDAD') return 'NIU';
  if (unit === 'MILLAR') return 'MIL';
  if (unit === 'MLL') return 'MIL';
  return unit || 'NIU';
}

function detractionSettings(value: string) {
  if (value === '000') return null;
  if (value === '025') return { code: '025', percent: 10 };

  return { code: '037', percent: 12 };
}

function taxSettings(value: string) {
  switch (value) {
    case 'GRATUITA':
      return { reasonCode: '21', unitPriceCode: '02', igvRate: 0 };
    case 'EXONERADA':
      return { reasonCode: '20', unitPriceCode: '01', igvRate: 0 };
    case 'INAFECTA':
      return { reasonCode: '30', unitPriceCode: '01', igvRate: 0 };
    case 'GRAVADA':
    default:
      return { reasonCode: '10', unitPriceCode: '01', igvRate: 0.18 };
  }
}

function emptyToDash(value: string | null | undefined) {
  const trimmed = value?.trim() ?? '';
  return trimmed ? trimmed : '-';
}

export function effectiveDueDate(input: Pick<FcFacturaPreviewInput, 'fechaEmision' | 'fechaVencimiento' | 'diasPago'> & Pick<Partial<FcFacturaPreviewInput>, 'cuotas'>) {
  return invoicePaymentSchedule(input, { total: 0 }).dueDate;
}

export function invoiceItemDescription(description: string, numeroRegistro?: string | null) {
  const base = description.trim();
  const registrationNumber = numeroRegistro?.trim();

  return registrationNumber ? `${base}  NR ${registrationNumber}` : base;
}

function dueDateFromPayment(fechaEmision: string, days: number) {
  const date = new Date(`${fechaEmision}T00:00:00-05:00`);
  date.setDate(date.getDate() + days);

  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0')
  ].join('-');
}

function invoicePaymentSchedule(
  input: Pick<FcFacturaPreviewInput, 'fechaEmision' | 'fechaVencimiento' | 'diasPago' | 'cuotas'>,
  totals: Pick<Totals, 'total'>
) {
  const cuotas = input.cuotas ?? [];
  const normalizedCuotas = cuotas
    .filter((cuota) => cuota.fecha.trim() && cuota.monto > 0)
    .slice(0, 12)
    .map((cuota) => ({
      fecha: cuota.fecha.trim(),
      monto: roundMoney(cuota.monto)
    }));
  const isCredit = normalizedCuotas.length > 0 || input.diasPago > 0;
  const dueDate = normalizedCuotas.length > 0
    ? normalizedCuotas.reduce((latest, cuota) => cuota.fecha > latest ? cuota.fecha : latest, normalizedCuotas[0]!.fecha)
    : input.fechaVencimiento?.trim() || dueDateFromPayment(input.fechaEmision, input.diasPago);

  return {
    isCredit,
    dueDate,
    cuotas: normalizedCuotas.length > 0
      ? normalizedCuotas
      : isCredit
        ? [{ fecha: dueDate, monto: roundMoney(totals.total) }]
        : []
  };
}

function paymentScheduleParams(cuotas: Array<{ fecha: string; monto: number }>) {
  const values: Record<string, string | null> = {};
  for (let index = 1; index <= 12; index += 1) {
    const cuota = cuotas[index - 1];
    values[`montoPagoCuota${index}`] = cuota ? money(cuota.monto) : null;
    values[`fechaPagoCuota${index}`] = cuota?.fecha ?? null;
  }
  return values;
}

function requiredExchangeRate(input: FcFacturaPreviewInput) {
  if (!input.tipoCambio || input.tipoCambio <= 0) {
    throw new Error(`No hay tipo de cambio de venta para ${input.fechaEmision}`);
  }

  return input.tipoCambio;
}

function currentTime() {
  return new Date().toLocaleTimeString('es-PE', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
    timeZone: 'America/Lima'
  });
}

export function invoiceAmountInWords(total: number, moneda: 'PEN' | 'USD') {
  const rounded = roundMoney(total);
  let integerPart = Math.floor(rounded);
  let cents = Math.round((rounded - integerPart) * 100);
  if (cents === 100) {
    integerPart += 1;
    cents = 0;
  }

  const currency = moneda === 'PEN' ? 'SOLES' : 'DOLARES AMERICANOS';
  return `${numberToSpanishWords(integerPart)} CON ${String(cents).padStart(2, '0')}/100 ${currency}`;
}

function numberToSpanishWords(value: number): string {
  if (value === 0) return 'CERO';
  if (value < 0) return `MENOS ${numberToSpanishWords(Math.abs(value))}`;

  const millions = Math.floor(value / 1_000_000);
  const thousands = Math.floor((value % 1_000_000) / 1000);
  const rest = value % 1000;
  const parts: string[] = [];

  if (millions > 0) {
    parts.push(millions === 1 ? 'UN MILLON' : `${apocopateUno(numberBelowThousandToWords(millions))} MILLONES`);
  }

  if (thousands > 0) {
    parts.push(thousands === 1 ? 'MIL' : `${apocopateUno(numberBelowThousandToWords(thousands))} MIL`);
  }

  if (rest > 0) {
    parts.push(numberBelowThousandToWords(rest));
  }

  return parts.join(' ');
}

function numberBelowThousandToWords(value: number): string {
  const units = [
    '',
    'UNO',
    'DOS',
    'TRES',
    'CUATRO',
    'CINCO',
    'SEIS',
    'SIETE',
    'OCHO',
    'NUEVE',
    'DIEZ',
    'ONCE',
    'DOCE',
    'TRECE',
    'CATORCE',
    'QUINCE',
    'DIECISEIS',
    'DIECISIETE',
    'DIECIOCHO',
    'DIECINUEVE'
  ];
  const tens = ['', '', 'VEINTE', 'TREINTA', 'CUARENTA', 'CINCUENTA', 'SESENTA', 'SETENTA', 'OCHENTA', 'NOVENTA'];
  const hundreds = ['', 'CIENTO', 'DOSCIENTOS', 'TRESCIENTOS', 'CUATROCIENTOS', 'QUINIENTOS', 'SEISCIENTOS', 'SETECIENTOS', 'OCHOCIENTOS', 'NOVECIENTOS'];

  if (value < 20) return units[value]!;
  if (value < 30) return value === 20 ? 'VEINTE' : `VEINTI${units[value - 20]!.toLowerCase()}`.toUpperCase();
  if (value < 100) {
    const ten = Math.floor(value / 10);
    const unit = value % 10;
    return unit === 0 ? tens[ten]! : `${tens[ten]} Y ${units[unit]}`;
  }
  if (value === 100) return 'CIEN';

  const hundred = Math.floor(value / 100);
  const rest = value % 100;
  return rest === 0 ? hundreds[hundred]! : `${hundreds[hundred]} ${numberBelowThousandToWords(rest)}`;
}

function apocopateUno(value: string) {
  return value
    .replace(/VEINTIUNO$/u, 'VEINTIUN')
    .replace(/ Y UNO$/u, ' Y UN')
    .replace(/UNO$/u, 'UN');
}

const headerParamNames = [
  'NUMERODOCUMENTOEMISOR',
  'SERIENUMERO',
  'TIPODOCUMENTO',
  'TIPODOCUMENTOEMISOR',
  'BL_ESTADOREGISTRO',
  'BL_REINTENTO',
  'BL_ORIGEN',
  'BL_HASFILERESPONSE',
  'CORREOADQUIRIENTE',
  'CORREOEMISOR',
  'DEPARTAMENTOEMISOR',
  'DIRECCIONEMISOR',
  'DISTRITOEMISOR',
  'FECHAEMISION',
  'NOMBRECOMERCIALEMISOR',
  'NUMERODOCUMENTOADQUIRIENTE',
  'PAISEMISOR',
  'PROVINCIAEMISOR',
  'RAZONSOCIALADQUIRIENTE',
  'RAZONSOCIALEMISOR',
  'serieNumeroAfectado',
  'codigoLeyenda_1',
  'textoLeyenda_1',
  'tipoDocumentoAdquiriente',
  'tipoMoneda',
  'totalIGV',
  'totalISC',
  'totalOtrosCargos',
  'totalOtrosTributos',
  'totalValorVentaNetoOpExonerada',
  'totalValorVentaNetoOpGratuitas',
  'totalValorVentaNetoOpGravadas',
  'totalValorVentaNetoOpNoGravada',
  'totalvalorVentaNetoOpExporta',
  'totalVenta',
  'ubigeoEmisor',
  'urbanizacion',
  'tipoDocumentoAfectado',
  'MotivoNCND',
  'TipoNCND',
  'tipocambio',
  'direccionAdquiriente',
  'totalImpuestos',
  'codigoAuxiliar40_1',
  'textoAuxiliar40_1',
  'tipoOperacion',
  'horaEmision',
  'codigoLocalAnexoEmisor',
  'GUIAREMISION',
  'ORDENCOMPRA',
  'TIPOGUIAREMISION',
  'formapago',
  'ubigeoAdquiriente',
  'urbanizacionAdquiriente',
  'provinciaAdquiriente',
  'departamentoAdquiriente',
  'distritoAdquiriente',
  'paisAdquiriente',
  'codigoDescuento',
  'montoBaseDescuentoGlobal',
  'porcentajeDsctoGlobal',
  'descuentosGlobales',
  'TOTALDESCUENTOS',
  'CODIGODETRACCION',
  'PORCENTAJEDETRACCION',
  'TOTALDETRACCION',
  'BANCONACION',
  'CODIGOFORMAANTICIPO',
  'PORCENTAJEPERCEPCION',
  'TOTALVENTACONPERCEPCION',
  'BASEIMPONIBLEPERCEPCION',
  'REGIMENPERCEPCION',
  'TOTALPERCEPCION',
  'TOTALRETENCION',
  'PORCENTAJERETENCION',
  'totalDocumentoAnticipo',
  'codigoSerieNumeroAfectado',
  'textoleyenda_2',
  'facturaPagoNegociable',
  'montoNetoPendiente',
  'montoPagoCuota1',
  'montoPagoCuota2',
  'montoPagoCuota3',
  'montoPagoCuota4',
  'montoPagoCuota5',
  'montoPagoCuota6',
  'montoPagoCuota7',
  'montoPagoCuota8',
  'montoPagoCuota9',
  'montoPagoCuota10',
  'montoPagoCuota11',
  'montoPagoCuota12',
  'fechaPagoCuota1',
  'fechaPagoCuota2',
  'fechaPagoCuota3',
  'fechaPagoCuota4',
  'fechaPagoCuota5',
  'fechaPagoCuota6',
  'fechaPagoCuota7',
  'fechaPagoCuota8',
  'fechaPagoCuota9',
  'fechaPagoCuota10',
  'fechaPagoCuota11',
  'fechaPagoCuota12',
  'textoAuxiliar100_2',
  'textoAuxiliar100_3',
  'textoAuxiliar100_4',
  'textoAuxiliar100_5',
  'textoAuxiliar100_6',
  'textoAuxiliar100_7',
  'textoAuxiliar100_8',
  'textoAuxiliar100_9',
  'textoAuxiliar500_2',
  'textoAuxiliar500_3',
  'textoAuxiliar500_4',
  'textoAuxiliar500_5',
  'textoAuxiliar250_10',
  'textoAuxiliar250_11',
  'fechaVencimiento'
];

const detailParamNames = [
  'NUMERODOCUMENTOEMISOR',
  'SERIENUMERO',
  'TIPODOCUMENTO',
  'TIPODOCUMENTOEMISOR',
  'NUMEROORDENITEM',
  'CANTIDAD',
  'CODIGOPRODUCTO',
  'CODIGORAZONEXONERACION',
  'DESCRIPCION',
  'IMPORTEDESCUENTO',
  'importeTotalSinImpuesto',
  'importeUnitarioConImpuesto',
  'importeUnitarioSinImpuesto',
  'CODIGOIMPORTEREFERENCIAL',
  'IMPORTEREFERENCIAL',
  'UNIDADMEDIDA',
  'codigoImporteUnitarioConImpuesto',
  'ImporteIGV',
  'ImporteISC',
  'importeCargo',
  'codigoProductoSUNAT',
  'montoBaseIgv',
  'tasaIGV',
  'importeTotalImpuestos',
  'importeBaseDescuento',
  'factorDescuento',
  'textoAuxiliar250_1',
  'textoAuxiliar250_2',
  'textoAuxiliar250_3',
  'textoAuxiliar250_4',
  'textoAuxiliar250_5',
  'textoAuxiliar250_6',
  'textoAuxiliar250_7',
  'textoAuxiliar250_8',
  'textoAuxiliar250_9',
  'textoAuxiliar500_1'
];
