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
  const dueDate = dueDateFromPayment(input.fechaEmision, input.formaPago);
  const isCredit = dueDate !== input.fechaEmision;
  const guideReference = firstGuide ? `0${firstGuide}` : null;
  const detraction = detractionSettings(input.tipoDetraccion);
  const totalDetraction = roundMoney(totals.total * detraction.percent / 100);

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
    CORREOEMISOR: '-',
    DEPARTAMENTOEMISOR: '-',
    DIRECCIONEMISOR: defaults.puntoPartida.direccion,
    DISTRITOEMISOR: '-',
    FECHAEMISION: input.fechaEmision,
    NOMBRECOMERCIALEMISOR: defaults.remitente.razonSocial,
    NUMERODOCUMENTOADQUIRIENTE: input.cliente.numeroDocumento,
    PAISEMISOR: 'PE',
    PROVINCIAEMISOR: '-',
    RAZONSOCIALADQUIRIENTE: input.cliente.razonSocial,
    RAZONSOCIALEMISOR: defaults.remitente.razonSocial,
    codigoLeyenda_1: '1000',
    textoLeyenda_1: moneyLegend(totals.total, input.moneda),
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
    ubigeoEmisor: defaults.puntoPartida.ubigeo,
    urbanizacion: '-',
    tipocambio: input.moneda === 'PEN' ? '1.000' : null,
    direccionAdquiriente: '-',
    totalImpuestos: money(totals.igv),
    tipoOperacion: '0101',
    horaEmision: currentTime(),
    codigoLocalAnexoEmisor: '0000',
    GUIAREMISION: guideReference,
    ORDENCOMPRA: emptyToNull(input.ordenCompra),
    TIPOGUIAREMISION: firstGuide ? '09' : null,
    formapago: input.formaPago,
    ubigeoAdquiriente: '-',
    urbanizacionAdquiriente: '-',
    provinciaAdquiriente: '-',
    departamentoAdquiriente: '-',
    distritoAdquiriente: '-',
    paisAdquiriente: 'PE',
    facturaPagoNegociable: isCredit ? '1' : '0',
    montoNetoPendiente: isCredit ? money(totals.total) : null,
    montoPagoCuota1: isCredit ? money(totals.total) : null,
    fechaPagoCuota1: isCredit ? dueDate : null,
    CODIGODETRACCION: detraction.code,
    PORCENTAJEDETRACCION: money(detraction.percent),
    TOTALDETRACCION: money(totalDetraction),
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
    DESCRIPCION: item.descripcion,
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
    codigoProductoSUNAT: '-',
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
  if (value === '025') return { code: '025', percent: 10 };

  return { code: '037', percent: 12 };
}

function taxSettings(value: string) {
  switch (value) {
    case 'GRATUITA':
      return { reasonCode: '21', unitPriceCode: '02', igvRate: 0 };
    case 'EXONERADA':
      return { reasonCode: '20', unitPriceCode: '02', igvRate: 0 };
    case 'INAFECTA':
      return { reasonCode: '30', unitPriceCode: '02', igvRate: 0 };
    case 'GRAVADA':
    default:
      return { reasonCode: '10', unitPriceCode: '01', igvRate: 0.18 };
  }
}

function emptyToNull(value: string | null | undefined) {
  const trimmed = value?.trim() ?? '';
  return trimmed ? trimmed : null;
}

function dueDateFromPayment(fechaEmision: string, formaPago: string) {
  const match = /(\d+)/.exec(formaPago);
  const days = match ? Number(match[1]) : 0;
  const date = new Date(`${fechaEmision}T00:00:00-05:00`);
  date.setDate(date.getDate() + days);

  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0')
  ].join('-');
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

function moneyLegend(total: number, moneda: 'PEN' | 'USD') {
  const label = moneda === 'PEN' ? 'SOLES' : 'DOLARES';
  return `${money(total)} ${label}`;
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
