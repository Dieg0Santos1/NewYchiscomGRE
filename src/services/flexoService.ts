import type { AppConfig } from '../config/env.js';
import { randomUUID } from 'node:crypto';
import { createBizlinksPool, createGreFcPool, sql } from '../integrations/bizlinksSql.js';
import type { GrePayload } from '../mappers/grePayloadMapper.js';
import { toSpeDespatchProcedurePlan, type StoredProcedureParam } from '../mappers/speDespatchProcedureMapper.js';
import {
  buildManualAcceptedSunatMessage,
  isEligibleForManualSunatMessage
} from './greFormularioManualSunatService.js';
import { sanitizeValue } from '../utils/sanitize.js';

const FLEXO_EMISOR = {
  tipoDocumento: '6',
  numeroDocumento: '20259402965',
  razonSocial: 'YCHIFORMAS S.A.'
};

const FLEXO_GRE_HEADER_TABLE = 'dbo.SPE_DESPATCH';
const FLEXO_GRE_ITEM_TABLE = 'dbo.SPE_DESPATCH_ITEM';
const FLEXO_GRE_RESPONSE_TABLE = 'dbo.SPE_DESPATCH_RESPONSE';

export type FlexoCliente = {
  id: string;
  tipoDocumento: string;
  numeroDocumento: string;
  razonSocial: string;
  ultimoEmpaque: string | null;
};

export type FlexoDestino = {
  id: string;
  ubigeo: string;
  direccion: string;
};

export type FlexoEmpaqueItem = {
  id: string;
  codigoEmpaque: number;
  codigoProducto: string;
  descripcion: string;
  cantidad: number;
  unidadMedida: string;
};

export type FlexoEmpaque = {
  id: string;
  codigoEmpaque: number;
  ticket: string;
  ordenCompra: string;
  fechaCreacion: string | null;
  destino: FlexoDestino;
  items: FlexoEmpaqueItem[];
};

export type FlexoGuideSerie = 'T003' | 'T999';

export type FlexoNextSerie = {
  serie: FlexoGuideSerie;
  numero: string;
  serieNumeroGuia: string;
  reserved: false;
  source: 'AAA_TIPODOCUMENTO' | 'BIZLINKS_SPE_DESPATCH';
};

export type FlexoGuidePreviewInput = {
  serieNumeroGuia: string;
  fechaEmision: string;
  fechaTraslado: string;
  cliente: {
    tipoDocumento: string;
    numeroDocumento: string;
    razonSocial: string;
  };
  destino: FlexoDestino;
  modalidadTraslado: string;
  motivoTraslado: string;
  descripcionMotivoTraslado: string;
  pesoBruto: number;
  unidadPeso: string;
  numeroBultos: number;
  ordenCompra: string;
  observaciones: string;
  conductor: {
    tipoDocumento: string;
    numeroDocumento: string;
    nombres: string;
    apellidos: string;
    licencia: string;
    placa: string;
  };
  empaques: FlexoEmpaque[];
};

export type FlexoGuidePrepareResult = {
  operationId: string;
  operacionDbId: number;
  serieNumeroGuia: string;
  estado: 'BORRADOR' | 'INSERTADO_BIZLINKS' | 'ENVIADO' | 'ACEPTADA' | 'RECHAZADA' | 'ERROR';
  reused: boolean;
  insertedItems: number;
  writesBizlinks: false;
  writesEmpaqueDetalle: false;
  message: string;
};

export type FlexoGuideDeclareResult = {
  operationId: string;
  operacionDbId: number;
  serieNumeroGuia: string;
  estado: 'ENVIADO';
  reused: boolean;
  insertedItems: number;
  linkedItems: number;
  correlativo: number;
  status: unknown;
  message: string;
};

export type FlexoValidation = {
  code: string;
  severity: 'ok' | 'warning' | 'error';
  message: string;
};

export type FlexoEmpaqueAdjustment = {
  id: string;
  codigoEmpaque: number;
  codigoProducto: string;
  descripcion: string;
  cantidad: number;
  unidadMedida: string;
  moneda: string;
  ordenGuia: string;
  ordenFactura: string;
  ticket: string;
  ordenCompra: string;
  clienteNumeroDocumento: string;
  clienteRazonSocial: string;
  guiaRemision: string | null;
  guiaFactura: string | null;
};

export type FlexoUpdateUnidadResult = {
  codigoEmpaque: number;
  codigoProducto: string;
  unidadAnterior: string;
  unidadNueva: string;
  updated: true;
};

export type FlexoCatalogWarning = {
  source: string;
  message: string;
};

export type FlexoCatalogs = {
  warnings: FlexoCatalogWarning[];
  choferes: Array<{
    id: string;
    tipoDocumento: string;
    numeroDocumento: string;
    nombres: string;
    apellidos: string;
    licencia: string;
    placa: string;
  }>;
  motivos: Array<{
    id: string;
    codigo: string;
    descripcion: string;
  }>;
  origenes: Array<{
    id: string;
    numeroDocumentoEmisor: string;
    ubigeo: string;
    direccion: string;
    codigoLocalAnexo: string;
  }>;
  transportistas: Array<{
    id: string;
    tipoDocumento: string;
    numeroDocumento: string;
    razonSocial: string;
  }>;
  detracciones: Array<{
    id: string;
    codigo: string;
    descripcion: string;
    porcentaje: number;
  }>;
  empresas: Array<{
    id: string;
    numeroDocumentoEmisor: string;
    tipoDocumentoEmisor: string;
    razonSocial: string;
    ubigeo: string;
    direccion: string;
  }>;
  tiposDocumento: Array<{
    id: string;
    tipoDocumento: string;
    descripcion: string;
    serie: string;
    correlativo: number;
  }>;
};

export type FlexoReportStatus = 'PENDIENTE' | 'EN_PROCESO' | 'ACEPTADA' | 'RECHAZADA' | 'ERROR' | 'ANULADA';

export type FlexoReportGuide = {
  tipo: 'GRE';
  serieNumero: string;
  fecha: string | null;
  clienteDocumento: string;
  clienteNombre: string;
  estado: FlexoReportStatus;
  estadoBizlinks: string;
  estadoProceso: string;
  mensaje: string;
  pdfDisponible: boolean;
  empaques: number;
  items: number;
  itemsFacturados: number;
  trazabilidadPortal: boolean;
  manualSunatMessageAllowed: boolean;
};

export type FlexoManualSunatAcceptanceResult = {
  operationId: string;
  serieNumeroGuia: string;
  reused: boolean;
  updated: boolean;
  message: string;
};

export type FlexoReportInvoice = {
  tipo: 'FE';
  serieNumero: string;
  fecha: string | null;
  clienteDocumento: string;
  clienteNombre: string;
  estado: FlexoReportStatus;
  estadoBizlinks: string;
  estadoProceso: string;
  mensaje: string;
  pdfDisponible: boolean;
  guias: number;
  items: number;
  total: number;
  trazabilidadPortal: boolean;
};

export type FlexoReportCancellation = {
  id: number;
  tipoDocumentoOrigen: string;
  serieNumeroDocumento: string;
  tipoBaja: string;
  estado: string;
  motivo: string;
  confirmadoExternamente: boolean;
  solicitadoEn: string;
  confirmadoEn: string | null;
};

export type FlexoReports = {
  generatedAt: string;
  guias: FlexoReportGuide[];
  facturas: FlexoReportInvoice[];
  bajas: FlexoReportCancellation[];
  warnings: string[];
};

export interface FlexoService {
  listCatalogs(): Promise<FlexoCatalogs>;
  listReports(): Promise<FlexoReports>;
  getGuidePdfUrl(serieNumeroGuia: string): Promise<string | null>;
  setManualSunatAcceptedMessage(
    serieNumeroGuia: string,
    options: { user?: string }
  ): Promise<FlexoManualSunatAcceptanceResult>;
  getInvoicePdfUrl(serieNumeroFactura: string): Promise<string | null>;
  searchClientes(query: string): Promise<FlexoCliente[]>;
  listDestinos(numeroDocumento: string): Promise<FlexoDestino[]>;
  listEmpaques(params: {
    numeroDocumento: string;
    desde: string;
    hasta: string;
    filtro: string;
  }): Promise<FlexoEmpaque[]>;
  getNextSerie(serie?: FlexoGuideSerie): Promise<FlexoNextSerie>;
  previewGuia(input: FlexoGuidePreviewInput): Promise<{
    writesDatabase: false;
    productionEnabled: false;
    serieNumeroGuia: string;
    validations: FlexoValidation[];
    payload: FlexoGuidePreviewInput;
  }>;
  prepareGuia(input: FlexoGuidePreviewInput): Promise<FlexoGuidePrepareResult>;
  declareGuia(input: FlexoGuidePreviewInput): Promise<FlexoGuideDeclareResult>;
  searchEmpaqueAdjustments(query: string): Promise<FlexoEmpaqueAdjustment[]>;
  updateEmpaqueUnidad(params: {
    codigoEmpaque: number;
    codigoProducto: string;
    unidadMedida: string;
  }): Promise<FlexoUpdateUnidadResult>;
}

type ClienteRow = {
  NUMERODOCUMENTOADQUIRIENTE: string | null;
  TIPODOCUMENTOADQUIRIENTE: string | null;
  RAZONSOCIALADQUIRIENTE: string | null;
  DATESTAMP: Date | null;
};

type DestinoRow = {
  UBIGEODESTINO: string | null;
  DIRECCIONDESTINO: string | null;
  CODIGOLOCALANEXO: string | null;
};

type EmpaqueRow = {
  CODIGOEMPAQUE: number;
  TICKETNUM: string | null;
  ORDENCOMPRA: string | null;
  FECHACREACION: Date | null;
  UBIGEOPTOLLEGADA: string | null;
  DIRECCIONPTOLLEGADA: string | null;
  CODIGOPRODUCTO: string | null;
  DESCRIPCION: string | null;
  CANTIDAD: number | string | null;
  UNIDADMEDIDA: string | null;
};

type EmpaqueAdjustmentRow = {
  CODIGOEMPAQUE: number;
  CODIGOPRODUCTO: string | null;
  DESCRIPCION: string | null;
  CANTIDAD: number | string | null;
  UNIDADMEDIDA: string | null;
  MONEDA: string | null;
  ORDENGUIA: string | null;
  ORDENFACTURA: string | null;
  TICKETNUM: string | null;
  ORDENCOMPRA: string | null;
  NUMERODOCUMENTOADQUIRIENTE: string | null;
  RAZONSOCIALADQUIRIENTE: string | null;
  SERIENUMEROGUIAREMISION: string | null;
  SERIENUMEROGUIAFACTURA: string | null;
};

type UpdatedEmpaqueUnidadRow = {
  CODIGOEMPAQUE: number;
  CODIGOPRODUCTO: string;
  unidadAnterior: string;
  unidadNueva: string;
};

type FlexoTraceRow = {
  serieNumero: string;
  estado: string;
};

type FlexoCancellationRow = {
  id: number;
  tipoDocumentoOrigen: string;
  serieNumeroDocumento: string;
  tipoBaja: string;
  estado: string;
  motivo: string;
  confirmadoExternamente: boolean;
  solicitadoEn: Date;
  confirmadoEn: Date | null;
};

type FlexoGuideReportRow = {
  serieNumeroGuia: string;
  fechaEmisionGuia: string | null;
  numeroDocumentoDestinatario: string | null;
  razonSocialDestinatario: string | null;
  estadoBizlinks: string | null;
  responseEstadoRegistro: string | null;
  bl_estadoProceso: string | null;
  process_state: string | null;
  bl_mensajeSunat: string | null;
  pdfDisponible: number | boolean | null;
  mensaje: string | null;
  empaques: number | null;
  items: number | null;
  itemsFacturados: number | null;
};

type FlexoManualSunatTracedGuideRow = {
  operacionDbId: number;
  envioId: number | null;
  operationId: string;
  serieNumeroGuia: string;
};

type FlexoManualSunatResponseRow = {
  serieNumeroGuia: string;
  bl_estadoRegistro: string | null;
  bl_estadoProceso: string | null;
  process_state: string | null;
  bl_mensajeSunat: string | null;
};

type FlexoInvoiceReportRow = {
  serieNumero: string;
  fechaEmision: string | null;
  numeroDocumentoAdquiriente: string | null;
  razonSocialAdquiriente: string | null;
  estadoBizlinks: string | null;
  bl_estadoProceso: string | null;
  process_state: string | null;
  pdfDisponible: number | boolean | null;
  mensaje: string | null;
  guias: number | null;
  items: number | null;
  totalVenta: number | string | null;
};

type PreparedGuideRow = {
  id: number;
  idOperacion: string;
  serieNumeroGuia: string;
  estado: 'BORRADOR' | 'INSERTADO_BIZLINKS' | 'ENVIADO' | 'ACEPTADA' | 'RECHAZADA' | 'ERROR';
  insertedItems: number | null;
};

type OriginRow = {
  UBIGEOORIGEN: string | null;
  DIRECCIONORIGEN: string | null;
};

type EmpaqueAvailabilityRow = {
  CODIGOEMPAQUE: number;
  CODIGOPRODUCTO: string | null;
  SERIENUMEROGUIAREMISION: string | null;
  SERIENUMEROGUIAFACTURA: string | null;
};

type FlexoPreparedOperationRow = {
  id: number;
  idOperacion: string;
  serie: FlexoGuideSerie;
  numero: string;
  serieNumeroGuia: string;
  tipoDocumentoGuia: string;
  tipoDocumentoDestinatario: string;
  numeroDocumentoDestinatario: string;
  razonSocialDestinatario: string;
  ubigeoPtoLlegada: string;
  direccionPtoLlegada: string;
  ubigeoPtoPartida: string;
  direccionPtoPartida: string;
  modalidadTraslado: string;
  motivoTraslado: string;
  descripcionMotivoTraslado: string;
  pesoBrutoTotalBienes: number;
  unidadMedidaPesoBruto: string;
  numeroBultos: number;
  fechaEmision: Date;
  fechaEmisionText: string;
  horaEmisionText: string;
  fechaInicioTraslado: Date;
  fechaInicioTrasladoText: string;
  ordenCompra: string | null;
  observaciones: string | null;
  tipoDocumentoConductor: string | null;
  numeroDocumentoConductor: string | null;
  nombreConductor: string | null;
  apellidoConductor: string | null;
  numeroLicencia: string | null;
  numeroPlacaVehiculo: string | null;
  estado: string;
};

type FlexoPreparedItemRow = {
  id: number;
  numeroOrdenItem: number;
  codigoEmpaque: number;
  ticket: string | null;
  ordenCompra: string | null;
  codigoProducto: string;
  descripcion: string;
  cantidadEmpaque: number;
  cantidadDeclarada: number;
  unidadMedidaEmpaque: string | null;
  unidadMedidaDeclarada: string;
  ordenGuia: string;
  estado: string;
};

type FlexoDeclareProcedureStatus = {
  header: Record<string, unknown> | null;
  itemCount: number;
  responseCount: number;
  linkedItems: number;
  tipoDocumentoCorrelativo: number | null;
};

export class DirectDbFlexoService implements FlexoService {
  constructor(private readonly config: AppConfig) {}

  async listReports(): Promise<FlexoReports> {
    const bizlinksPool = createBizlinksPool(this.config);
    const greFcPool = createGreFcPool(this.config);
    await bizlinksPool.connect();
    await greFcPool.connect();

    try {
      const warnings: string[] = [];
      const [
        greTrace,
        feTrace,
        bajas,
        guideRows,
        invoiceRows
      ] = await Promise.all([
        safeReportQuery(warnings, 'FLEXO_GRE_OPERACION', () => new sql.Request(greFcPool).query<FlexoTraceRow>(`
          SELECT TOP (300)
            serieNumeroGuia AS serieNumero,
            estado
          FROM dbo.FLEXO_GRE_OPERACION
          ORDER BY creadoEn DESC
        `)),
        safeReportQuery(warnings, 'FLEXO_FE_OPERACION', () => new sql.Request(greFcPool).query<FlexoTraceRow>(`
          SELECT TOP (300)
            serieNumeroFactura AS serieNumero,
            estado
          FROM dbo.FLEXO_FE_OPERACION
          ORDER BY creadoEn DESC
        `)),
        safeReportQuery(warnings, 'FLEXO_DOCUMENTO_BAJA', () => new sql.Request(greFcPool).query<FlexoCancellationRow>(`
          SELECT TOP (200)
            id,
            tipoDocumentoOrigen,
            serieNumeroDocumento,
            tipoBaja,
            estado,
            motivo,
            confirmadoExternamente,
            solicitadoEn,
            confirmadoEn
          FROM dbo.FLEXO_DOCUMENTO_BAJA
          ORDER BY solicitadoEn DESC
        `)),
        safeReportQuery(warnings, 'SPE_DESPATCH/EMPAQUE_DETALLE', () => new sql.Request(bizlinksPool).query<FlexoGuideReportRow>(`
          SELECT TOP (300)
            d.serieNumeroGuia,
            d.fechaEmisionGuia,
            d.numeroDocumentoDestinatario,
            d.razonSocialDestinatario,
            d.bl_estadoRegistro AS estadoBizlinks,
            r.bl_estadoRegistro AS responseEstadoRegistro,
            r.bl_estadoProceso,
            r.process_state,
            r.bl_mensajeSunat,
            CASE WHEN r.bl_url_pdf IS NULL OR LTRIM(RTRIM(r.bl_url_pdf)) = '' THEN 0 ELSE 1 END AS pdfDisponible,
            LEFT(COALESCE(r.bl_mensajeSunat, r.bl_mensaje, ''), 500) AS mensaje,
            ISNULL(l.empaques, 0) AS empaques,
            ISNULL(l.items, 0) AS items,
            ISNULL(l.itemsFacturados, 0) AS itemsFacturados
          FROM dbo.SPE_DESPATCH d
          LEFT JOIN dbo.SPE_DESPATCH_RESPONSE r
            ON r.tipoDocumentoRemitente = d.tipoDocumentoRemitente
           AND r.numeroDocumentoRemitente = d.numeroDocumentoRemitente
           AND r.serieNumeroGuia = d.serieNumeroGuia
           AND r.tipoDocumentoGuia = d.tipoDocumentoGuia
          LEFT JOIN (
            SELECT
              SERIENUMEROGUIAREMISION,
              COUNT(DISTINCT CODIGOEMPAQUE) AS empaques,
              COUNT(1) AS items,
              SUM(CASE WHEN SERIENUMEROGUIAFACTURA IS NULL THEN 0 ELSE 1 END) AS itemsFacturados
            FROM dbo.EMPAQUE_DETALLE
            WHERE SERIENUMEROGUIAREMISION LIKE 'T003-%'
               OR SERIENUMEROGUIAREMISION LIKE 'T999-%'
            GROUP BY SERIENUMEROGUIAREMISION
          ) l
            ON l.SERIENUMEROGUIAREMISION = d.serieNumeroGuia
          WHERE (d.serieNumeroGuia LIKE 'T003-%' OR d.serieNumeroGuia LIKE 'T999-%')
            AND d.tipoDocumentoGuia = '09'
          ORDER BY d.fechaEmisionGuia DESC, d.serieNumeroGuia DESC
        `)),
        safeReportQuery(warnings, 'SPE_EINVOICEHEADER/EMPAQUE_DETALLE', () => new sql.Request(bizlinksPool).query<FlexoInvoiceReportRow>(`
          SELECT TOP (300)
            h.serieNumero,
            h.fechaEmision,
            h.numeroDocumentoAdquiriente,
            h.razonSocialAdquiriente,
            h.bl_estadoRegistro AS estadoBizlinks,
            r.bl_estadoProceso,
            r.process_state,
            CASE WHEN r.bl_url_pdf IS NULL OR LTRIM(RTRIM(r.bl_url_pdf)) = '' THEN 0 ELSE 1 END AS pdfDisponible,
            LEFT(COALESCE(r.bl_mensajeSunat, r.bl_mensaje, ''), 500) AS mensaje,
            ISNULL(l.guias, 0) AS guias,
            ISNULL(l.items, 0) AS items,
            h.totalVenta
          FROM dbo.SPE_EINVOICEHEADER h
          LEFT JOIN dbo.SPE_EINVOICE_RESPONSE r
            ON r.tipoDocumentoEmisor = h.tipoDocumentoEmisor
           AND r.numeroDocumentoEmisor = h.numeroDocumentoEmisor
           AND r.serieNumero = h.serieNumero
           AND r.tipoDocumento = h.tipoDocumento
          LEFT JOIN (
            SELECT
              SERIENUMEROGUIAFACTURA,
              COUNT(DISTINCT SERIENUMEROGUIAREMISION) AS guias,
              COUNT(1) AS items
            FROM dbo.EMPAQUE_DETALLE
            WHERE SERIENUMEROGUIAFACTURA LIKE 'FF03-%'
            GROUP BY SERIENUMEROGUIAFACTURA
          ) l
            ON l.SERIENUMEROGUIAFACTURA = h.serieNumero
          WHERE h.serieNumero LIKE 'FF03-%'
            AND h.tipoDocumento = '01'
          ORDER BY h.fechaEmision DESC, h.serieNumero DESC
        `))
      ]);

      const greTraceBySerie = new Map(greTrace.recordset.map((row) => [row.serieNumero, row.estado]));
      const feTraceBySerie = new Map(feTrace.recordset.map((row) => [row.serieNumero, row.estado]));

      return {
        generatedAt: new Date().toISOString(),
        guias: guideRows.recordset.map((row) => mapGuideReport(row, greTraceBySerie.get(row.serieNumeroGuia))),
        facturas: invoiceRows.recordset.map((row) => mapInvoiceReport(row, feTraceBySerie.get(row.serieNumero))),
        bajas: bajas.recordset.map((row) => ({
          id: Number(row.id),
          tipoDocumentoOrigen: row.tipoDocumentoOrigen,
          serieNumeroDocumento: row.serieNumeroDocumento,
          tipoBaja: row.tipoBaja,
          estado: row.estado,
          motivo: row.motivo,
          confirmadoExternamente: Boolean(row.confirmadoExternamente),
          solicitadoEn: row.solicitadoEn.toISOString(),
          confirmadoEn: row.confirmadoEn ? row.confirmadoEn.toISOString() : null
        })),
        warnings
      };
    } finally {
      await greFcPool.close();
      await bizlinksPool.close();
    }
  }

  async getGuidePdfUrl(serieNumeroGuia: string): Promise<string | null> {
    if (!/^T(?:003|999)-\d{8}$/.test(serieNumeroGuia)) {
      return null;
    }

    const pool = createBizlinksPool(this.config);
    await pool.connect();

    try {
      const request = new sql.Request(pool);
      request.input('serieNumeroGuia', sql.VarChar(20), serieNumeroGuia);

      const result = await request.query<{ bl_url_pdf: string | null }>(`
        SELECT TOP (1)
          r.bl_url_pdf
        FROM dbo.SPE_DESPATCH_RESPONSE r
        INNER JOIN dbo.SPE_DESPATCH d
          ON d.tipoDocumentoRemitente = r.tipoDocumentoRemitente
         AND d.numeroDocumentoRemitente = r.numeroDocumentoRemitente
         AND d.serieNumeroGuia = r.serieNumeroGuia
         AND d.tipoDocumentoGuia = r.tipoDocumentoGuia
        WHERE r.serieNumeroGuia = @serieNumeroGuia
          AND r.tipoDocumentoGuia = '09'
          AND (d.serieNumeroGuia LIKE 'T003-%' OR d.serieNumeroGuia LIKE 'T999-%')
      `);

      const url = result.recordset[0]?.bl_url_pdf?.trim();

      return url && isAllowedBizlinksFileUrl(url) ? url : null;
    } finally {
      await pool.close();
    }
  }

  async setManualSunatAcceptedMessage(
    serieNumeroGuia: string,
    options: { user?: string }
  ): Promise<FlexoManualSunatAcceptanceResult> {
    validateFlexoManualSunatGuards(this.config, serieNumeroGuia);

    const greFcPool = createGreFcPool(this.config);
    const bizlinksPool = createBizlinksPool(this.config);

    await greFcPool.connect();
    await bizlinksPool.connect();

    const greFcTransaction = new sql.Transaction(greFcPool);
    const bizlinksTransaction = new sql.Transaction(bizlinksPool);
    let greFcCommitted = false;
    let bizlinksCommitted = false;

    try {
      await greFcTransaction.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);
      await acquireFlexoAppLock(greFcTransaction, `FLEXO_GRE_MANUAL_SUNAT_TRACE:${serieNumeroGuia}`);
      const traced = await getSingleFlexoTracedGuide(greFcTransaction, serieNumeroGuia);

      await bizlinksTransaction.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);
      await acquireFlexoAppLock(bizlinksTransaction, `FLEXO_GRE_MANUAL_SUNAT_RESPONSE:${serieNumeroGuia}`);
      const before = await getSingleFlexoResponseRow(bizlinksTransaction, serieNumeroGuia);
      const acceptedMessage = buildManualAcceptedSunatMessage(serieNumeroGuia);

      if (before.bl_mensajeSunat?.trim() === acceptedMessage) {
        await insertGuideEvent(greFcTransaction, traced.operacionDbId, traced.envioId, null, 'SUNAT_MENSAJE_MANUAL_REUTILIZADO', 'La GRE Flexo ya tenia el mensaje manual de aceptacion SUNAT.', {
          serieNumeroGuia,
          user: options.user ?? null,
          before
        });

        await bizlinksTransaction.commit();
        bizlinksCommitted = true;
        await greFcTransaction.commit();
        greFcCommitted = true;

        return {
          operationId: traced.operationId,
          serieNumeroGuia,
          reused: true,
          updated: false,
          message: acceptedMessage
        };
      }

      if (!isEligibleForManualSunatMessage(before)) {
        throw new Error(`La GRE Flexo ${serieNumeroGuia} no cumple el estado permitido para mensaje manual SUNAT.`);
      }

      await insertGuideEvent(greFcTransaction, traced.operacionDbId, traced.envioId, null, 'SUNAT_MENSAJE_MANUAL_INICIADO', 'Actualizacion manual controlada de bl_mensajeSunat iniciada para GRE Flexo.', {
        serieNumeroGuia,
        user: options.user ?? null,
        before
      });

      await updateFlexoResponseMessage(bizlinksTransaction, serieNumeroGuia, acceptedMessage);
      const after = await getSingleFlexoResponseRow(bizlinksTransaction, serieNumeroGuia);

      if (after.bl_mensajeSunat !== acceptedMessage) {
        throw new Error(`No se pudo confirmar bl_mensajeSunat para ${serieNumeroGuia}.`);
      }

      await insertGuideEvent(greFcTransaction, traced.operacionDbId, traced.envioId, null, 'SUNAT_MENSAJE_MANUAL_APLICADO', 'bl_mensajeSunat actualizado de forma controlada para GRE Flexo.', {
        serieNumeroGuia,
        user: options.user ?? null,
        before,
        after
      });

      await bizlinksTransaction.commit();
      bizlinksCommitted = true;
      await greFcTransaction.commit();
      greFcCommitted = true;

      return {
        operationId: traced.operationId,
        serieNumeroGuia,
        reused: false,
        updated: true,
        message: acceptedMessage
      };
    } catch (error) {
      if (!bizlinksCommitted) await rollbackFlexoQuietly(bizlinksTransaction);

      if (!greFcCommitted) {
        try {
          await recordFlexoManualSunatError(greFcTransaction, serieNumeroGuia, options.user, error);
          greFcCommitted = true;
        } catch {
          await rollbackFlexoQuietly(greFcTransaction);
        }
      }

      throw error;
    } finally {
      if (!bizlinksCommitted) await rollbackFlexoQuietly(bizlinksTransaction);
      if (!greFcCommitted) await rollbackFlexoQuietly(greFcTransaction);
      await bizlinksPool.close();
      await greFcPool.close();
    }
  }

  async getInvoicePdfUrl(serieNumeroFactura: string): Promise<string | null> {
    if (!/^FF03-\d{8}$/.test(serieNumeroFactura)) {
      return null;
    }

    const pool = createBizlinksPool(this.config);
    await pool.connect();

    try {
      const request = new sql.Request(pool);
      request.input('serieNumeroFactura', sql.VarChar(20), serieNumeroFactura);

      const result = await request.query<{ bl_url_pdf: string | null }>(`
        SELECT TOP (1)
          r.bl_url_pdf
        FROM dbo.SPE_EINVOICE_RESPONSE r
        INNER JOIN dbo.SPE_EINVOICEHEADER h
          ON h.tipoDocumentoEmisor = r.tipoDocumentoEmisor
         AND h.numeroDocumentoEmisor = r.numeroDocumentoEmisor
         AND h.serieNumero = r.serieNumero
         AND h.tipoDocumento = r.tipoDocumento
        WHERE r.serieNumero = @serieNumeroFactura
          AND r.tipoDocumento = '01'
          AND h.serieNumero LIKE 'FF03-%'
      `);

      const url = result.recordset[0]?.bl_url_pdf?.trim();

      return url && isAllowedBizlinksFileUrl(url) ? url : null;
    } finally {
      await pool.close();
    }
  }

  async listCatalogs(): Promise<FlexoCatalogs> {
    const pool = createBizlinksPool(this.config);
    await pool.connect();

    try {
      const warnings: FlexoCatalogWarning[] = [];
      const [
        choferes,
        motivos,
        origenes,
        transportistas,
        detracciones,
        empresas,
        tiposDocumento
      ] = await Promise.all([
        safeCatalogQuery(warnings, 'AAA_CHOFER', () => new sql.Request(pool).query<{
          NUMERODOCUMENTOCHOFER: string | null;
          TIPODOCUMENTOCHOFER: string | null;
          NOMBRE: string | null;
          APELLIDO: string | null;
          BREVETE: string | null;
          PLACAVEHICULO: string | null;
        }>(`
          SELECT TOP (200)
            NUMERODOCUMENTOCHOFER,
            TIPODOCUMENTOCHOFER,
            NOMBRE,
            APELLIDO,
            BREVETE,
            PLACAVEHICULO
          FROM dbo.AAA_CHOFER
          ORDER BY APELLIDO, NOMBRE, NUMERODOCUMENTOCHOFER
        `)),
        safeCatalogQuery(warnings, 'MOTIVOS', () => new sql.Request(pool).query<{
          codigo: string | null;
          descripcion: string | null;
        }>(`
          SELECT TOP (120)
            codigo,
            descripcion
          FROM dbo.MOTIVOS
          ORDER BY codigo
        `)),
        safeCatalogQuery(warnings, 'AAA_ORIGEN', () => new sql.Request(pool).query<{
          NUMERODOCUMENTOEMISOR: string | null;
          UBIGEOORIGEN: string | null;
          DIRECCIONORIGEN: string | null;
          CODIGOLOCALANEXO: string | null;
        }>(`
          SELECT TOP (80)
            NUMERODOCUMENTOEMISOR,
            UBIGEOORIGEN,
            DIRECCIONORIGEN,
            CODIGOLOCALANEXO
          FROM dbo.AAA_ORIGEN
          ORDER BY NUMERODOCUMENTOEMISOR, CODIGOLOCALANEXO
        `)),
        safeCatalogQuery(warnings, 'AAA_TRANSPORTISTA', () => new sql.Request(pool).query<{
          NUMERODOCUMENTOTRANSPORTISTA: string | null;
          TIPODOCUMENTOTRANSPORTISTA: string | null;
          RAZONSOCIALTRANSPORTISTA: string | null;
        }>(`
          SELECT TOP (200)
            NUMERODOCUMENTOTRANSPORTISTA,
            TIPODOCUMENTOTRANSPORTISTA,
            RAZONSOCIALTRANSPORTISTA
          FROM dbo.AAA_TRANSPORTISTA
          ORDER BY RAZONSOCIALTRANSPORTISTA
        `)),
        safeCatalogQuery(warnings, 'AAA_DETRACCION', () => new sql.Request(pool).query<{
          CODIGODETRACCION: string | null;
          DESCRIPCION: string | null;
          PORCENTAJEDETRACCION: number | string | null;
        }>(`
          SELECT TOP (80)
            CODIGODETRACCION,
            DESCRIPCION,
            PORCENTAJEDETRACCION
          FROM dbo.AAA_DETRACCION
          ORDER BY CODIGODETRACCION
        `)),
        safeCatalogQuery(warnings, 'AAA_EMPRESA', () => new sql.Request(pool).query<{
          NUMERODOCUMENTOEMISOR: string | null;
          TIPODOCUMENTOEMISOR: string | null;
          RAZONSOCIALEMISOR: string | null;
          UBIGEOEMISOR: string | null;
          DIRECCIONEMISOR: string | null;
        }>(`
          SELECT TOP (80)
            NUMERODOCUMENTOEMISOR,
            TIPODOCUMENTOEMISOR,
            RAZONSOCIALEMISOR,
            UBIGEOEMISOR,
            DIRECCIONEMISOR
          FROM dbo.AAA_EMPRESA
          ORDER BY NUMERODOCUMENTOEMISOR
        `)),
        safeCatalogQuery(warnings, 'AAA_TIPODOCUMENTO', () => new sql.Request(pool).query<{
          TIPODOCUMENTO: string | null;
          DESCRIPCION: string | null;
          SERIE: string | null;
          CORRELATIVO: number | null;
        }>(`
          SELECT TOP (120)
            TIPODOCUMENTO,
            DESCRIPCION,
            SERIE,
            CORRELATIVO
          FROM dbo.AAA_TIPODOCUMENTO
          WHERE SERIE IN ('T003', 'T999', 'FF03')
             OR DESCRIPCION LIKE '%GUIA%'
             OR DESCRIPCION LIKE '%FACTURA%'
          ORDER BY SERIE, TIPODOCUMENTO
        `))
      ]);

      return {
        warnings,
        choferes: choferes.recordset.map((row) => ({
          id: row.NUMERODOCUMENTOCHOFER?.trim() || `${row.NOMBRE ?? ''}-${row.APELLIDO ?? ''}`.trim(),
          tipoDocumento: row.TIPODOCUMENTOCHOFER?.trim() || '1',
          numeroDocumento: row.NUMERODOCUMENTOCHOFER?.trim() ?? '',
          nombres: row.NOMBRE?.trim() ?? '',
          apellidos: row.APELLIDO?.trim() ?? '',
          licencia: row.BREVETE?.trim() ?? '',
          placa: row.PLACAVEHICULO?.trim() ?? ''
        })),
        motivos: motivos.recordset.map((row) => ({
          id: row.codigo?.trim() ?? '',
          codigo: row.codigo?.trim() ?? '',
          descripcion: row.descripcion?.trim() ?? ''
        })),
        origenes: origenes.recordset.map((row, index) => ({
          id: `${row.NUMERODOCUMENTOEMISOR?.trim() ?? ''}-${row.CODIGOLOCALANEXO?.trim() ?? index}`,
          numeroDocumentoEmisor: row.NUMERODOCUMENTOEMISOR?.trim() ?? '',
          ubigeo: row.UBIGEOORIGEN?.trim() ?? '',
          direccion: row.DIRECCIONORIGEN?.trim() ?? '',
          codigoLocalAnexo: row.CODIGOLOCALANEXO?.trim() ?? ''
        })),
        transportistas: transportistas.recordset.map((row) => ({
          id: row.NUMERODOCUMENTOTRANSPORTISTA?.trim() ?? '',
          tipoDocumento: row.TIPODOCUMENTOTRANSPORTISTA?.trim() ?? '6',
          numeroDocumento: row.NUMERODOCUMENTOTRANSPORTISTA?.trim() ?? '',
          razonSocial: row.RAZONSOCIALTRANSPORTISTA?.trim() ?? ''
        })),
        detracciones: detracciones.recordset.map((row) => ({
          id: row.CODIGODETRACCION?.trim() ?? '',
          codigo: row.CODIGODETRACCION?.trim() ?? '',
          descripcion: row.DESCRIPCION?.trim() ?? '',
          porcentaje: Number(row.PORCENTAJEDETRACCION ?? 0)
        })),
        empresas: empresas.recordset.map((row) => ({
          id: row.NUMERODOCUMENTOEMISOR?.trim() ?? '',
          numeroDocumentoEmisor: row.NUMERODOCUMENTOEMISOR?.trim() ?? '',
          tipoDocumentoEmisor: row.TIPODOCUMENTOEMISOR?.trim() ?? '6',
          razonSocial: row.RAZONSOCIALEMISOR?.trim() ?? '',
          ubigeo: row.UBIGEOEMISOR?.trim() ?? '',
          direccion: row.DIRECCIONEMISOR?.trim() ?? ''
        })),
        tiposDocumento: tiposDocumento.recordset.map((row) => ({
          id: `${row.SERIE?.trim() ?? ''}-${row.TIPODOCUMENTO?.trim() ?? ''}`,
          tipoDocumento: row.TIPODOCUMENTO?.trim() ?? '',
          descripcion: row.DESCRIPCION?.trim() ?? '',
          serie: row.SERIE?.trim() ?? '',
          correlativo: Number(row.CORRELATIVO ?? 0)
        }))
      };
    } finally {
      await pool.close();
    }
  }

  async searchClientes(query: string) {
    const normalized = query.trim();
    if (normalized.length < 2) return [];

    const pool = createBizlinksPool(this.config);
    await pool.connect();

    try {
      const request = new sql.Request(pool);
      request.input('query', sql.NVarChar(120), `%${normalized}%`);

      const result = await request.query<ClienteRow>(`
        SELECT TOP (50)
          NUMERODOCUMENTOADQUIRIENTE,
          TIPODOCUMENTOADQUIRIENTE,
          RAZONSOCIALADQUIRIENTE,
          DATESTAMP
        FROM dbo.AAA_ADQUIRIENTE
        WHERE ISNULL(NUMERODOCUMENTOADQUIRIENTE, '') <> ''
          AND ISNULL(RAZONSOCIALADQUIRIENTE, '') <> ''
          AND (
            NUMERODOCUMENTOADQUIRIENTE LIKE @query
            OR RAZONSOCIALADQUIRIENTE LIKE @query
          )
        ORDER BY DATESTAMP DESC, RAZONSOCIALADQUIRIENTE
      `);

      return result.recordset.map((row) => ({
        id: `${row.TIPODOCUMENTOADQUIRIENTE?.trim() || '6'}-${row.NUMERODOCUMENTOADQUIRIENTE?.trim() ?? ''}`,
        tipoDocumento: row.TIPODOCUMENTOADQUIRIENTE?.trim() || '6',
        numeroDocumento: row.NUMERODOCUMENTOADQUIRIENTE?.trim() ?? '',
        razonSocial: row.RAZONSOCIALADQUIRIENTE?.trim() ?? '',
        ultimoEmpaque: row.DATESTAMP ? row.DATESTAMP.toISOString() : null
      }));
    } finally {
      await pool.close();
    }
  }

  async listDestinos(numeroDocumento: string) {
    const normalized = numeroDocumento.trim();
    if (!normalized) return [];

    const pool = createBizlinksPool(this.config);
    await pool.connect();

    try {
      const request = new sql.Request(pool);
      request.input('numeroDocumento', sql.VarChar(20), normalized);

      const result = await request.query<DestinoRow>(`
        SELECT TOP (50)
          UBIGEODESTINO,
          DIRECCIONDESTINO,
          CODIGOLOCALANEXO
        FROM dbo.AAA_DESTINO
        WHERE NUMERODOCUMENTOADQUIRIENTE = @numeroDocumento
          AND ISNULL(UBIGEODESTINO, '') <> ''
          AND ISNULL(DIRECCIONDESTINO, '') <> ''
        ORDER BY DATESTAMP DESC, DIRECCIONDESTINO
      `);

      return result.recordset.map((row, index) => ({
        id: `${row.UBIGEODESTINO?.trim() ?? 'SINUBIGEO'}-${row.CODIGOLOCALANEXO?.trim() || index}`,
        ubigeo: row.UBIGEODESTINO?.trim() ?? '',
        direccion: row.DIRECCIONDESTINO?.trim() ?? ''
      }));
    } finally {
      await pool.close();
    }
  }

  async listEmpaques(params: { numeroDocumento: string; desde: string; hasta: string; filtro: string }) {
    const normalizedDocument = params.numeroDocumento.trim();
    if (!normalizedDocument) return [];

    const pool = createBizlinksPool(this.config);
    await pool.connect();

    try {
      const request = new sql.Request(pool);
      request.input('numeroDocumento', sql.VarChar(20), normalizedDocument);
      request.input('desde', sql.VarChar(19), `${params.desde} 00:00:00`);
      request.input('hasta', sql.VarChar(19), `${params.hasta} 00:00:00`);
      request.input('filtro', sql.NVarChar(200), `%${params.filtro.trim()}%`);

      const filterClause = params.filtro.trim()
        ? `AND (
            CONVERT(varchar(20), e.CODIGOEMPAQUE) LIKE @filtro
            OR e.TICKETNUM LIKE @filtro
            OR e.ORDENCOMPRA LIKE @filtro
            OR d.CODIGOPRODUCTO LIKE @filtro
            OR d.DESCRIPCION LIKE @filtro
          )`
        : '';

      const result = await request.query<EmpaqueRow>(`
        SELECT TOP (500)
          e.CODIGOEMPAQUE,
          e.TICKETNUM,
          e.ORDENCOMPRA,
          e.FECHACREACION,
          e.UBIGEOPTOLLEGADA,
          e.DIRECCIONPTOLLEGADA,
          d.CODIGOPRODUCTO,
          d.DESCRIPCION,
          d.CANTIDAD,
          d.UNIDADMEDIDA
        FROM dbo.EMPAQUE e
        INNER JOIN dbo.EMPAQUE_DETALLE d
          ON d.CODIGOEMPAQUE = e.CODIGOEMPAQUE
        WHERE e.NUMERODOCUMENTOADQUIRIENTE = @numeroDocumento
          AND e.FECHACREACION >= CONVERT(datetime, @desde, 120)
          AND e.FECHACREACION < DATEADD(day, 1, CONVERT(datetime, @hasta, 120))
          AND d.SERIENUMEROGUIAREMISION IS NULL
          AND d.SERIENUMEROGUIAFACTURA IS NULL
          ${filterClause}
        ORDER BY e.FECHACREACION DESC, e.CODIGOEMPAQUE DESC, d.CODIGOPRODUCTO
      `);

      return groupEmpaques(result.recordset);
    } finally {
      await pool.close();
    }
  }

  async getNextSerie(serie: FlexoGuideSerie = 'T003') {
    const pool = createBizlinksPool(this.config);
    await pool.connect();

    try {
      const catalogRequest = new sql.Request(pool);
      catalogRequest.input('serie', sql.VarChar(8), serie);

      const catalogResult = await catalogRequest.query<{ nextNumber: number }>(`
        SELECT TOP (1)
          ISNULL(CORRELATIVO, 0) + 1 AS nextNumber
        FROM dbo.AAA_TIPODOCUMENTO
        WHERE SERIE = @serie
          AND TIPODOCUMENTO = '09'
        ORDER BY CORRELATIVO DESC
      `);

      const catalogNext = catalogResult.recordset[0]?.nextNumber;
      if (catalogNext && catalogNext > 0) {
        const numero = String(catalogNext).padStart(8, '0');

        return {
          serie,
          numero,
          serieNumeroGuia: `${serie}-${numero}`,
          reserved: false as const,
          source: 'AAA_TIPODOCUMENTO' as const
        };
      }

      const request = new sql.Request(pool);
      request.input('seriePrefix', sql.VarChar(8), `${serie}-%`);

      const result = await request.query<{ nextNumber: number }>(`
        SELECT ISNULL(MAX(
          CASE
            WHEN ISNUMERIC(RIGHT(serieNumeroGuia, 8)) = 1 THEN CONVERT(int, RIGHT(serieNumeroGuia, 8))
            ELSE NULL
          END
        ), 0) + 1 AS nextNumber
        FROM dbo.SPE_DESPATCH
        WHERE serieNumeroGuia LIKE @seriePrefix
          AND tipoDocumentoGuia = '09'
      `);
      const numero = String(result.recordset[0]?.nextNumber ?? 1).padStart(8, '0');

      return {
        serie,
        numero,
        serieNumeroGuia: `${serie}-${numero}`,
        reserved: false as const,
        source: 'BIZLINKS_SPE_DESPATCH' as const
      };
    } finally {
      await pool.close();
    }
  }

  async previewGuia(input: FlexoGuidePreviewInput) {
    return {
      writesDatabase: false as const,
      productionEnabled: false as const,
      serieNumeroGuia: input.serieNumeroGuia,
      validations: validateFlexoPreview(input),
      payload: input
    };
  }

  async prepareGuia(input: FlexoGuidePreviewInput): Promise<FlexoGuidePrepareResult> {
    const errors = validateFlexoPreview(input).filter((item) => item.severity === 'error');
    const driverReady = input.conductor.numeroDocumento && input.conductor.licencia && input.conductor.placa;
    if (errors.length > 0) {
      throw new Error(errors.map((item) => item.message).join(' '));
    }
    if (!driverReady) {
      throw new Error('Complete chofer, licencia y placa antes de guardar la preparacion.');
    }

    const parsedSerie = parseFlexoSerie(input.serieNumeroGuia);
    if (!parsedSerie) {
      throw new Error('La guia Flexo debe usar serie T003 o T999 con correlativo de 8 digitos.');
    }

    const preparedItems = flattenGuideItems(input);
    if (preparedItems.length === 0) {
      throw new Error('Debe seleccionar uno o mas items de empaque.');
    }

    const duplicatedItem = findDuplicatedGuideItem(preparedItems);
    if (duplicatedItem) {
      throw new Error(`Item duplicado en la preparacion: empaque ${duplicatedItem.codigoEmpaque}, producto ${duplicatedItem.codigoProducto}.`);
    }

    const bizlinksPool = createBizlinksPool(this.config);
    const greFcPool = createGreFcPool(this.config);
    await bizlinksPool.connect();
    await greFcPool.connect();

    const transaction = new sql.Transaction(greFcPool);
    let committed = false;

    try {
      await assertGuideSeriesDoesNotExist(bizlinksPool, input.serieNumeroGuia);
      await assertEmpaqueItemsStillAvailable(bizlinksPool, preparedItems);
      const origin = await getPrimaryOrigin(bizlinksPool);

      await transaction.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);
      const existing = await findPreparedGuide(transaction, input.serieNumeroGuia);
      if (existing) {
        await insertGuideEvent(transaction, existing.id, null, null, 'PREPARACION_REUTILIZADA', 'Preparacion GRE existente reutilizada desde el portal.', {
          serieNumeroGuia: input.serieNumeroGuia
        });
        await transaction.commit();
        committed = true;

        return {
          operationId: existing.idOperacion,
          operacionDbId: existing.id,
          serieNumeroGuia: existing.serieNumeroGuia,
          estado: existing.estado,
          reused: true,
          insertedItems: Number(existing.insertedItems ?? 0),
          writesBizlinks: false,
          writesEmpaqueDetalle: false,
          message: 'Preparacion existente reutilizada. No se escribio en Bizlinks ni EMPAQUE_DETALLE.'
        };
      }

      const operationId = randomUUID();
      const operacionDbId = await insertPreparedGuideOperation(transaction, operationId, parsedSerie, input, origin);
      const insertedItems = await insertPreparedGuideItems(transaction, operacionDbId, input.serieNumeroGuia, preparedItems);
      const envioId = await insertPreparedGuideEnvio(transaction, operacionDbId);
      await insertGuideEvent(transaction, operacionDbId, envioId, null, 'PREPARACION_GUARDADA', 'GRE Flexo preparada sin insertar en Bizlinks.', {
        serieNumeroGuia: input.serieNumeroGuia,
        items: insertedItems
      });

      await transaction.commit();
      committed = true;

      return {
        operationId,
        operacionDbId,
        serieNumeroGuia: input.serieNumeroGuia,
        estado: 'BORRADOR',
        reused: false,
        insertedItems,
        writesBizlinks: false,
        writesEmpaqueDetalle: false,
        message: 'Preparacion guardada. No se escribio en Bizlinks ni EMPAQUE_DETALLE.'
      };
    } catch (error) {
      if (!committed) await transaction.rollback().catch(() => undefined);
      throw error;
    } finally {
      await greFcPool.close();
      await bizlinksPool.close();
    }
  }

  async declareGuia(input: FlexoGuidePreviewInput): Promise<FlexoGuideDeclareResult> {
    const prepared = await this.prepareGuia(input);
    const greFcPool = createGreFcPool(this.config);
    const bizlinksPool = createBizlinksPool(this.config);
    await greFcPool.connect();
    await bizlinksPool.connect();

    const greFcTransaction = new sql.Transaction(greFcPool);
    let greFcCommitted = false;
    let bizlinksTransaction: sql.Transaction | undefined;

    try {
      await greFcTransaction.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);
      const operation = await findFlexoOperationByDbId(greFcTransaction, prepared.operacionDbId);
      if (!operation) {
        throw new Error(`No se encontro la operacion Flexo ${prepared.operacionDbId}.`);
      }

      if (operation.estado !== 'BORRADOR') {
        const status = await queryFlexoDeclareStatus(bizlinksPool, operation, []);
        await insertGuideEvent(greFcTransaction, operation.id, null, null, 'DECLARACION_REUTILIZADA', 'Operacion Flexo ya declarada.', {
          serieNumeroGuia: operation.serieNumeroGuia,
          estado: operation.estado
        });
        await greFcTransaction.commit();
        greFcCommitted = true;

        return {
          operationId: operation.idOperacion,
          operacionDbId: operation.id,
          serieNumeroGuia: operation.serieNumeroGuia,
          estado: 'ENVIADO',
          reused: true,
          insertedItems: Number(prepared.insertedItems ?? 0),
          linkedItems: status.linkedItems,
          correlativo: status.tipoDocumentoCorrelativo ?? Number(operation.numero),
          status,
          message: `La GRE ${operation.serieNumeroGuia} ya habia sido declarada.`
        };
      }

      const items = await listFlexoOperationItems(greFcTransaction, operation.id);
      if (items.length === 0) {
        throw new Error(`La operacion ${operation.serieNumeroGuia} no tiene items preparados.`);
      }

      const payload = buildFlexoGrePayload(operation, items);
      const plan = toSpeDespatchProcedurePlan(payload);

      await insertGuideEvent(greFcTransaction, operation.id, null, null, 'DECLARACION_INICIADA', 'Declaracion GRE Flexo iniciada.', {
        serieNumeroGuia: operation.serieNumeroGuia,
        items: items.length
      });

      bizlinksTransaction = new sql.Transaction(bizlinksPool);
      await bizlinksTransaction.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);
      await acquireFlexoAppLock(bizlinksTransaction, `FLEXO_GRE_${operation.serie}_DECLARACION`);
      await assertFlexoNextCorrelative(bizlinksTransaction, operation);
      await assertFlexoSerieDoesNotExist(bizlinksTransaction, operation.serieNumeroGuia);
      await assertFlexoEmpaqueItemsAvailable(bizlinksTransaction, items);

      await executeFlexoStoredProcedure(bizlinksTransaction, 'dbo.USP_CabeceraGuia', plan.USP_CabeceraGuia);
      for (const itemParams of plan.USP_DetalleGuia) {
        await executeFlexoStoredProcedure(bizlinksTransaction, 'dbo.USP_DetalleGuia', itemParams);
      }

      const preparedStatus = await queryFlexoDeclareStatus(bizlinksTransaction, operation, items);
      assertFlexoPreparedStatus(operation, preparedStatus, items.length);

      await executeFlexoStoredProcedure(bizlinksTransaction, 'dbo.USP_EnvioGuia', plan.USP_EnvioGuia);
      const linkedItems = await linkFlexoEmpaqueDetalle(bizlinksTransaction, operation, items);
      const correlativo = await syncFlexoTipoDocumentoCorrelative(bizlinksTransaction, operation);
      const finalStatus = await queryFlexoDeclareStatus(bizlinksTransaction, operation, items);

      await bizlinksTransaction.commit();

      await markFlexoGuideDeclared(greFcTransaction, operation, items.length, linkedItems, finalStatus);
      await greFcTransaction.commit();
      greFcCommitted = true;

      return {
        operationId: operation.idOperacion,
        operacionDbId: operation.id,
        serieNumeroGuia: operation.serieNumeroGuia,
        estado: 'ENVIADO',
        reused: false,
        insertedItems: items.length,
        linkedItems,
        correlativo,
        status: finalStatus,
        message: `GRE ${operation.serieNumeroGuia} declarada y enviada a Bizlinks.`
      };
    } catch (error) {
      await bizlinksTransaction?.rollback().catch(() => undefined);

      if (!greFcCommitted) {
        try {
          await recordFlexoDeclareError(greFcTransaction, prepared.operacionDbId, error);
          greFcCommitted = true;
        } catch {
          await greFcTransaction.rollback().catch(() => undefined);
        }
      }

      throw error;
    } finally {
      if (!greFcCommitted) await greFcTransaction.rollback().catch(() => undefined);
      await bizlinksPool.close();
      await greFcPool.close();
    }
  }

  async searchEmpaqueAdjustments(query: string) {
    const normalized = query.trim();
    if (normalized.length < 2) return [];

    const pool = createBizlinksPool(this.config);
    await pool.connect();

    try {
      const request = new sql.Request(pool);
      request.input('query', sql.NVarChar(200), `%${normalized}%`);
      request.input('codigoEmpaque', sql.Int, /^\d+$/.test(normalized) ? Number(normalized) : null);

      const result = await request.query<EmpaqueAdjustmentRow>(`
        SELECT TOP (200)
          d.CODIGOEMPAQUE,
          d.CODIGOPRODUCTO,
          d.DESCRIPCION,
          d.CANTIDAD,
          d.UNIDADMEDIDA,
          d.MONEDA,
          d.ORDENGUIA,
          d.ORDENFACTURA,
          e.TICKETNUM,
          e.ORDENCOMPRA,
          e.NUMERODOCUMENTOADQUIRIENTE,
          e.RAZONSOCIALADQUIRIENTE,
          d.SERIENUMEROGUIAREMISION,
          d.SERIENUMEROGUIAFACTURA
        FROM dbo.EMPAQUE_DETALLE d
        LEFT JOIN dbo.EMPAQUE e
          ON e.CODIGOEMPAQUE = d.CODIGOEMPAQUE
        WHERE (
            d.CODIGOEMPAQUE = @codigoEmpaque
            OR d.CODIGOPRODUCTO LIKE @query
            OR d.DESCRIPCION LIKE @query
            OR d.UNIDADMEDIDA LIKE @query
            OR e.TICKETNUM LIKE @query
            OR e.ORDENCOMPRA LIKE @query
            OR e.NUMERODOCUMENTOADQUIRIENTE LIKE @query
            OR e.RAZONSOCIALADQUIRIENTE LIKE @query
          )
        ORDER BY
          CASE WHEN UPPER(LTRIM(RTRIM(ISNULL(d.UNIDADMEDIDA, '')))) IN ('ROLLO', 'ROLLOS', 'ROLL', 'ROLLS', 'ROL') THEN 0 ELSE 1 END,
          d.CODIGOEMPAQUE DESC,
          d.CODIGOPRODUCTO
      `);

      return result.recordset.map(mapEmpaqueAdjustment);
    } finally {
      await pool.close();
    }
  }

  async updateEmpaqueUnidad(params: { codigoEmpaque: number; codigoProducto: string; unidadMedida: string }) {
    const codigoProducto = params.codigoProducto.trim();
    const unidadMedida = normalizeEditableUnidad(params.unidadMedida);

    if (!Number.isInteger(params.codigoEmpaque) || params.codigoEmpaque <= 0) {
      throw new Error('Codigo de empaque invalido.');
    }

    if (!codigoProducto) {
      throw new Error('Codigo de producto invalido.');
    }

    const pool = createBizlinksPool(this.config);
    await pool.connect();

    try {
      const request = new sql.Request(pool);
      request.input('codigoEmpaque', sql.Int, params.codigoEmpaque);
      request.input('codigoProducto', sql.VarChar(50), codigoProducto);
      request.input('unidadMedida', sql.VarChar(10), unidadMedida);

      const result = await request.query<UpdatedEmpaqueUnidadRow>(`
        UPDATE d
           SET d.UNIDADMEDIDA = @unidadMedida
        OUTPUT
          inserted.CODIGOEMPAQUE,
          inserted.CODIGOPRODUCTO,
          deleted.UNIDADMEDIDA AS unidadAnterior,
          inserted.UNIDADMEDIDA AS unidadNueva
        FROM dbo.EMPAQUE_DETALLE d
        WHERE d.CODIGOEMPAQUE = @codigoEmpaque
          AND d.CODIGOPRODUCTO = @codigoProducto
          AND d.SERIENUMEROGUIAREMISION IS NULL
          AND d.SERIENUMEROGUIAFACTURA IS NULL;
      `);
      const row = result.recordset[0];

      if (!row) {
        throw new Error('No se actualizo el empaque. Verifique que exista y que aun no este ligado a guia o factura.');
      }

      return {
        codigoEmpaque: row.CODIGOEMPAQUE,
        codigoProducto: row.CODIGOPRODUCTO.trim(),
        unidadAnterior: row.unidadAnterior?.trim() ?? '',
        unidadNueva: row.unidadNueva?.trim() ?? unidadMedida,
        updated: true as const
      };
    } finally {
      await pool.close();
    }
  }
}

type ParsedFlexoSerie = {
  serie: FlexoGuideSerie;
  numero: string;
};

type PreparedGuideItem = {
  numeroOrdenItem: number;
  codigoEmpaque: number;
  ticket: string;
  ordenCompra: string;
  codigoProducto: string;
  descripcion: string;
  cantidadEmpaque: number;
  cantidadDeclarada: number;
  unidadMedidaEmpaque: string;
  unidadMedidaDeclarada: string;
  ordenGuia: string;
  source: FlexoEmpaqueItem;
};

function parseFlexoSerie(value: string): ParsedFlexoSerie | null {
  const match = /^(T003|T999)-(\d{8})$/.exec(value.trim().toUpperCase());
  if (!match) return null;

  return {
    serie: match[1] as FlexoGuideSerie,
    numero: match[2]!
  };
}

function flattenGuideItems(input: FlexoGuidePreviewInput): PreparedGuideItem[] {
  let order = 0;

  return input.empaques.flatMap((empaque) => empaque.items.map((item) => {
    order += 1;
    const declared = normalizeDeclaredItem(item.cantidad, item.unidadMedida);

    return {
      numeroOrdenItem: order,
      codigoEmpaque: item.codigoEmpaque,
      ticket: empaque.ticket,
      ordenCompra: empaque.ordenCompra,
      codigoProducto: item.codigoProducto.trim(),
      descripcion: item.descripcion.trim(),
      cantidadEmpaque: Number(item.cantidad),
      cantidadDeclarada: declared.cantidad,
      unidadMedidaEmpaque: item.unidadMedida.trim().toUpperCase(),
      unidadMedidaDeclarada: declared.unidad,
      ordenGuia: String(order),
      source: item
    };
  }));
}

function normalizeDeclaredItem(cantidad: number, unidadMedida: string) {
  const unit = normalizeUnidad(unidadMedida);
  if (unit === '1000' || unit === 'MLL' || unit === 'MILLAR' || unit === 'MILLARES') {
    return {
      cantidad: Number((Number(cantidad) / 1000).toFixed(6)),
      unidad: 'MIL'
    };
  }

  if (unit === 'MIL') {
    return {
      cantidad: Number(cantidad),
      unidad: 'MIL'
    };
  }

  return {
    cantidad: Number(cantidad),
    unidad: unit
  };
}

function findDuplicatedGuideItem(items: PreparedGuideItem[]) {
  const seen = new Set<string>();

  for (const item of items) {
    const key = `${item.codigoEmpaque}::${item.codigoProducto}`;
    if (seen.has(key)) return item;
    seen.add(key);
  }

  return null;
}

async function assertGuideSeriesDoesNotExist(pool: sql.ConnectionPool, serieNumeroGuia: string) {
  const request = new sql.Request(pool);
  request.input('serieNumeroGuia', sql.VarChar(13), serieNumeroGuia);
  const result = await request.query<{ total: number }>(`
    SELECT COUNT(1) AS total
    FROM dbo.SPE_DESPATCH
    WHERE serieNumeroGuia = @serieNumeroGuia
      AND tipoDocumentoGuia = '09'
  `);

  if (Number(result.recordset[0]?.total ?? 0) > 0) {
    throw new Error(`La guia ${serieNumeroGuia} ya existe en Bizlinks.`);
  }
}

async function assertEmpaqueItemsStillAvailable(pool: sql.ConnectionPool, items: PreparedGuideItem[]) {
  for (const item of items) {
    const request = new sql.Request(pool);
    request.input('codigoEmpaque', sql.Int, item.codigoEmpaque);
    request.input('codigoProducto', sql.VarChar(80), item.codigoProducto);

    const result = await request.query<EmpaqueAvailabilityRow>(`
      SELECT TOP (1)
        CODIGOEMPAQUE,
        CODIGOPRODUCTO,
        SERIENUMEROGUIAREMISION,
        SERIENUMEROGUIAFACTURA
      FROM dbo.EMPAQUE_DETALLE
      WHERE CODIGOEMPAQUE = @codigoEmpaque
        AND CODIGOPRODUCTO = @codigoProducto
    `);
    const row = result.recordset[0];

    if (!row) {
      throw new Error(`No existe el item de empaque ${item.codigoEmpaque}/${item.codigoProducto}.`);
    }
    if (row.SERIENUMEROGUIAREMISION || row.SERIENUMEROGUIAFACTURA) {
      throw new Error(`El item ${item.codigoEmpaque}/${item.codigoProducto} ya esta vinculado a guia o factura.`);
    }
  }
}

async function getPrimaryOrigin(pool: sql.ConnectionPool) {
  const result = await new sql.Request(pool).query<OriginRow>(`
    SELECT TOP (1)
      UBIGEOORIGEN,
      DIRECCIONORIGEN
    FROM dbo.AAA_ORIGEN
    WHERE ISNULL(UBIGEOORIGEN, '') <> ''
      AND ISNULL(DIRECCIONORIGEN, '') <> ''
    ORDER BY NUMERODOCUMENTOEMISOR, CODIGOLOCALANEXO
  `);
  const row = result.recordset[0];

  return {
    ubigeo: row?.UBIGEOORIGEN?.trim() || '140109',
    direccion: row?.DIRECCIONORIGEN?.trim() || 'AV. LUNA PIZARRO NRO. 1328(1332-1336-1340 PUERTA DE INGRESO 1340)'
  };
}

async function findPreparedGuide(transaction: sql.Transaction, serieNumeroGuia: string) {
  const request = transaction.request();
  request.input('serieNumeroGuia', sql.VarChar(13), serieNumeroGuia);

  const result = await request.query<PreparedGuideRow>(`
    SELECT TOP (1)
      o.id,
      CONVERT(varchar(36), o.idOperacion) AS idOperacion,
      o.serieNumeroGuia,
      o.estado,
      COUNT(i.id) AS insertedItems
    FROM dbo.FLEXO_GRE_OPERACION o WITH (UPDLOCK, HOLDLOCK)
    LEFT JOIN dbo.FLEXO_GRE_ITEM i
      ON i.operacionId = o.id
    WHERE o.serieNumeroGuia = @serieNumeroGuia
    GROUP BY o.id, o.idOperacion, o.serieNumeroGuia, o.estado
  `);

  return result.recordset[0] ?? null;
}

async function insertPreparedGuideOperation(
  transaction: sql.Transaction,
  operationId: string,
  parsedSerie: ParsedFlexoSerie,
  input: FlexoGuidePreviewInput,
  origin: { ubigeo: string; direccion: string }
) {
  const request = transaction.request();
  request.input('idOperacion', sql.UniqueIdentifier, operationId);
  request.input('serie', sql.VarChar(4), parsedSerie.serie);
  request.input('numero', sql.VarChar(8), parsedSerie.numero);
  request.input('serieNumeroGuia', sql.VarChar(13), input.serieNumeroGuia);
  request.input('tipoDocumentoDestinatario', sql.VarChar(2), input.cliente.tipoDocumento);
  request.input('numeroDocumentoDestinatario', sql.VarChar(20), input.cliente.numeroDocumento);
  request.input('razonSocialDestinatario', sql.NVarChar(250), input.cliente.razonSocial);
  request.input('ubigeoPtoLlegada', sql.VarChar(10), input.destino.ubigeo);
  request.input('direccionPtoLlegada', sql.NVarChar(500), input.destino.direccion);
  request.input('ubigeoPtoPartida', sql.VarChar(10), origin.ubigeo);
  request.input('direccionPtoPartida', sql.NVarChar(500), origin.direccion);
  request.input('modalidadTraslado', sql.VarChar(2), input.modalidadTraslado);
  request.input('motivoTraslado', sql.VarChar(2), input.motivoTraslado);
  request.input('descripcionMotivoTraslado', sql.NVarChar(120), input.descripcionMotivoTraslado);
  request.input('pesoBrutoTotalBienes', sql.Decimal(18, 3), input.pesoBruto);
  request.input('unidadMedidaPesoBruto', sql.VarChar(3), input.unidadPeso);
  request.input('numeroBultos', sql.Int, input.numeroBultos);
  request.input('fechaEmision', sql.VarChar(19), normalizeFlexoLocalDateTime(input.fechaEmision));
  request.input('fechaInicioTraslado', sql.VarChar(10), normalizeFlexoDate(input.fechaTraslado));
  request.input('ordenCompra', sql.NVarChar(200), input.ordenCompra || null);
  request.input('observaciones', sql.NVarChar(500), input.observaciones || null);
  request.input('tipoDocumentoConductor', sql.VarChar(2), input.conductor.tipoDocumento || null);
  request.input('numeroDocumentoConductor', sql.VarChar(20), input.conductor.numeroDocumento || null);
  request.input('nombreConductor', sql.NVarChar(120), input.conductor.nombres || null);
  request.input('apellidoConductor', sql.NVarChar(120), input.conductor.apellidos || null);
  request.input('numeroLicencia', sql.VarChar(30), input.conductor.licencia || null);
  request.input('numeroPlacaVehiculo', sql.VarChar(20), input.conductor.placa || null);
  request.input('datosJson', sql.NVarChar(sql.MAX), JSON.stringify(input));

  const result = await request.query<{ id: number }>(`
    INSERT INTO dbo.FLEXO_GRE_OPERACION (
      idOperacion,
      serie,
      numero,
      serieNumeroGuia,
      tipoDocumentoGuia,
      tipoDocumentoDestinatario,
      numeroDocumentoDestinatario,
      razonSocialDestinatario,
      ubigeoPtoLlegada,
      direccionPtoLlegada,
      ubigeoPtoPartida,
      direccionPtoPartida,
      modalidadTraslado,
      motivoTraslado,
      descripcionMotivoTraslado,
      pesoBrutoTotalBienes,
      unidadMedidaPesoBruto,
      numeroBultos,
      fechaEmision,
      fechaInicioTraslado,
      ordenCompra,
      observaciones,
      tipoDocumentoConductor,
      numeroDocumentoConductor,
      nombreConductor,
      apellidoConductor,
      numeroLicencia,
      numeroPlacaVehiculo,
      correlativoFuente,
      estado,
      usuario,
      datosJson
    )
    OUTPUT inserted.id
    VALUES (
      @idOperacion,
      @serie,
      @numero,
      @serieNumeroGuia,
      '09',
      @tipoDocumentoDestinatario,
      @numeroDocumentoDestinatario,
      @razonSocialDestinatario,
      @ubigeoPtoLlegada,
      @direccionPtoLlegada,
      @ubigeoPtoPartida,
      @direccionPtoPartida,
      @modalidadTraslado,
      @motivoTraslado,
      @descripcionMotivoTraslado,
      @pesoBrutoTotalBienes,
      @unidadMedidaPesoBruto,
      @numeroBultos,
      CONVERT(datetime2(0), @fechaEmision, 120),
      CONVERT(date, @fechaInicioTraslado, 120),
      @ordenCompra,
      @observaciones,
      @tipoDocumentoConductor,
      @numeroDocumentoConductor,
      @nombreConductor,
      @apellidoConductor,
      @numeroLicencia,
      @numeroPlacaVehiculo,
      'AAA_TIPODOCUMENTO',
      'BORRADOR',
      NULL,
      @datosJson
    )
  `);

  return Number(result.recordset[0]?.id);
}

async function insertPreparedGuideItems(
  transaction: sql.Transaction,
  operacionDbId: number,
  serieNumeroGuia: string,
  items: PreparedGuideItem[]
) {
  for (const item of items) {
    const request = transaction.request();
    request.input('operacionId', sql.BigInt, operacionDbId);
    request.input('numeroOrdenItem', sql.Int, item.numeroOrdenItem);
    request.input('codigoEmpaque', sql.Int, item.codigoEmpaque);
    request.input('ticket', sql.VarChar(50), item.ticket || null);
    request.input('ordenCompra', sql.NVarChar(100), item.ordenCompra || null);
    request.input('codigoProducto', sql.VarChar(80), item.codigoProducto);
    request.input('descripcion', sql.NVarChar(1700), item.descripcion);
    request.input('cantidadEmpaque', sql.Decimal(18, 6), item.cantidadEmpaque);
    request.input('cantidadDeclarada', sql.Decimal(18, 6), item.cantidadDeclarada);
    request.input('unidadMedidaEmpaque', sql.VarChar(20), item.unidadMedidaEmpaque || null);
    request.input('unidadMedidaDeclarada', sql.VarChar(20), item.unidadMedidaDeclarada);
    request.input('serieNumeroGuia', sql.VarChar(13), serieNumeroGuia);
    request.input('ordenGuia', sql.VarChar(4), item.ordenGuia);
    request.input('datosJson', sql.NVarChar(sql.MAX), JSON.stringify(item.source));

    await request.query(`
      INSERT INTO dbo.FLEXO_GRE_ITEM (
        operacionId,
        numeroOrdenItem,
        codigoEmpaque,
        ticket,
        ordenCompra,
        codigoProducto,
        descripcion,
        cantidadEmpaque,
        cantidadDeclarada,
        unidadMedidaEmpaque,
        unidadMedidaDeclarada,
        serieNumeroGuia,
        ordenGuia,
        estado,
        datosJson
      )
      VALUES (
        @operacionId,
        @numeroOrdenItem,
        @codigoEmpaque,
        @ticket,
        @ordenCompra,
        @codigoProducto,
        @descripcion,
        @cantidadEmpaque,
        @cantidadDeclarada,
        @unidadMedidaEmpaque,
        @unidadMedidaDeclarada,
        @serieNumeroGuia,
        @ordenGuia,
        'PREPARANDO',
        @datosJson
      )
    `);
  }

  return items.length;
}

async function insertPreparedGuideEnvio(transaction: sql.Transaction, operacionDbId: number) {
  const request = transaction.request();
  request.input('operacionId', sql.BigInt, operacionDbId);

  const result = await request.query<{ id: number }>(`
    INSERT INTO dbo.FLEXO_GRE_ENVIO (
      operacionId,
      estado,
      intentos,
      mensaje
    )
    OUTPUT inserted.id
    VALUES (
      @operacionId,
      'PREPARANDO',
      0,
      'Preparado en portal; pendiente de declaracion controlada.'
    )
  `);

  return Number(result.recordset[0]?.id);
}

async function insertGuideEvent(
  transaction: sql.Transaction,
  operacionDbId: number | null,
  envioId: number | null,
  itemId: number | null,
  tipo: string,
  mensaje: string,
  data: Record<string, unknown>
) {
  const request = transaction.request();
  request.input('operacionId', sql.BigInt, operacionDbId);
  request.input('envioId', sql.BigInt, envioId);
  request.input('itemId', sql.BigInt, itemId);
  request.input('tipo', sql.VarChar(80), tipo);
  request.input('mensaje', sql.NVarChar(sql.MAX), mensaje);
  request.input('datosJson', sql.NVarChar(sql.MAX), JSON.stringify(data));

  await request.query(`
    INSERT INTO dbo.FLEXO_GRE_EVENTO (
      operacionId,
      envioId,
      itemId,
      tipo,
      mensaje,
      datosJson,
      usuario
    )
    VALUES (
      @operacionId,
      @envioId,
      @itemId,
      @tipo,
      @mensaje,
      @datosJson,
      NULL
    )
  `);
}

function validateFlexoManualSunatGuards(config: Pick<AppConfig, 'dryRun' | 'directDbInsertEnabled'>, serieNumeroGuia: string) {
  if (config.dryRun) {
    throw new Error('La actualizacion manual SUNAT requiere DRY_RUN=false.');
  }

  if (!config.directDbInsertEnabled) {
    throw new Error('La actualizacion manual SUNAT requiere GRE_DIRECT_DB_INSERT_ENABLED=true.');
  }

  if (!/^T(?:003|999)-\d{8}$/.test(serieNumeroGuia)) {
    throw new Error(`Serie no permitida para GRE Flexo: ${serieNumeroGuia}.`);
  }
}

async function getSingleFlexoTracedGuide(transaction: sql.Transaction, serieNumeroGuia: string): Promise<FlexoManualSunatTracedGuideRow> {
  const request = transaction.request();
  request.input('serieNumeroGuia', sql.VarChar(20), serieNumeroGuia);

  const result = await request.query<FlexoManualSunatTracedGuideRow>(`
    SELECT TOP (1)
      o.id AS operacionDbId,
      e.id AS envioId,
      CONVERT(varchar(36), o.idOperacion) AS operationId,
      o.serieNumeroGuia
    FROM dbo.FLEXO_GRE_OPERACION o WITH (UPDLOCK, HOLDLOCK)
    LEFT JOIN dbo.FLEXO_GRE_ENVIO e WITH (UPDLOCK, HOLDLOCK)
      ON e.operacionId = o.id
    WHERE o.serieNumeroGuia = @serieNumeroGuia
    ORDER BY e.id DESC;
  `);

  if (result.recordset.length !== 1) {
    throw new Error(`No se encontro una GRE Flexo trazada para ${serieNumeroGuia}.`);
  }

  return result.recordset[0]!;
}

async function getSingleFlexoResponseRow(transaction: sql.Transaction, serieNumeroGuia: string): Promise<FlexoManualSunatResponseRow> {
  const request = transaction.request();
  request.input('serieNumeroGuia', sql.VarChar(20), serieNumeroGuia);

  const result = await request.query<FlexoManualSunatResponseRow>(`
    SELECT
      serieNumeroGuia,
      bl_estadoRegistro,
      bl_estadoProceso,
      process_state,
      bl_mensajeSunat
    FROM ${FLEXO_GRE_RESPONSE_TABLE} WITH (UPDLOCK, HOLDLOCK)
    WHERE serieNumeroGuia = @serieNumeroGuia
      AND tipoDocumentoGuia = '09';
  `);

  if (result.recordset.length !== 1) {
    throw new Error(`Se esperaba exactamente una respuesta Bizlinks para ${serieNumeroGuia}; encontradas ${result.recordset.length}.`);
  }

  return result.recordset[0]!;
}

async function updateFlexoResponseMessage(transaction: sql.Transaction, serieNumeroGuia: string, message: string) {
  const request = transaction.request();
  request.input('serieNumeroGuia', sql.VarChar(20), serieNumeroGuia);
  request.input('mensajeSunat', sql.NVarChar(4000), message);

  const result = await request.query<{ affectedRows: number }>(`
    UPDATE ${FLEXO_GRE_RESPONSE_TABLE}
       SET bl_mensajeSunat = @mensajeSunat
     WHERE serieNumeroGuia = @serieNumeroGuia
       AND tipoDocumentoGuia = '09'
       AND bl_estadoRegistro = 'L'
       AND bl_estadoProceso IN ('SIGNED/ED_06', 'SIGNED/PE_02')
       AND process_state = '_2_CONSULT'
       AND NULLIF(LTRIM(RTRIM(bl_mensajeSunat)), '') IS NULL;

    SELECT @@ROWCOUNT AS affectedRows;
  `);

  if ((result.recordset[0]?.affectedRows ?? 0) !== 1) {
    throw new Error(`No se actualizo bl_mensajeSunat para ${serieNumeroGuia}; el estado pudo cambiar durante la operacion.`);
  }
}

async function recordFlexoManualSunatError(
  transaction: sql.Transaction,
  serieNumeroGuia: string,
  user: string | undefined,
  error: unknown
) {
  const message = error instanceof Error ? error.message : 'Error desconocido';
  const request = transaction.request();
  request.input('serieNumeroGuia', sql.VarChar(20), serieNumeroGuia);
  request.input('mensaje', sql.NVarChar(sql.MAX), message);
  request.input('datosJson', sql.NVarChar(sql.MAX), JSON.stringify(sanitizeValue({
    serieNumeroGuia,
    user: user ?? null,
    error
  })));

  await request.query(`
    DECLARE @operacionId bigint;
    DECLARE @envioId bigint;

    SELECT TOP (1)
      @operacionId = o.id,
      @envioId = e.id
    FROM dbo.FLEXO_GRE_OPERACION o
    LEFT JOIN dbo.FLEXO_GRE_ENVIO e
      ON e.operacionId = o.id
    WHERE o.serieNumeroGuia = @serieNumeroGuia
    ORDER BY e.id DESC;

    IF @operacionId IS NOT NULL
    BEGIN
      INSERT INTO dbo.FLEXO_GRE_EVENTO (operacionId, envioId, tipo, mensaje, datosJson)
      VALUES (@operacionId, @envioId, 'ERROR_SUNAT_MENSAJE_MANUAL', @mensaje, @datosJson);
    END;
  `);

  await transaction.commit();
}

async function rollbackFlexoQuietly(transaction: sql.Transaction) {
  try {
    await transaction.rollback();
  } catch {
    // rollback best effort
  }
}

async function findFlexoOperationByDbId(transaction: sql.Transaction, operacionDbId: number) {
  const request = transaction.request();
  request.input('operacionDbId', sql.BigInt, operacionDbId);

  const result = await request.query<FlexoPreparedOperationRow>(`
    SELECT TOP (1)
      id,
      CONVERT(varchar(36), idOperacion) AS idOperacion,
      serie,
      numero,
      serieNumeroGuia,
      tipoDocumentoGuia,
      tipoDocumentoDestinatario,
      numeroDocumentoDestinatario,
      razonSocialDestinatario,
      ubigeoPtoLlegada,
      direccionPtoLlegada,
      ubigeoPtoPartida,
      direccionPtoPartida,
      modalidadTraslado,
      motivoTraslado,
      descripcionMotivoTraslado,
      pesoBrutoTotalBienes,
      unidadMedidaPesoBruto,
      numeroBultos,
      fechaEmision,
      CONVERT(varchar(10), fechaEmision, 120) AS fechaEmisionText,
      CONVERT(varchar(8), fechaEmision, 108) AS horaEmisionText,
      fechaInicioTraslado,
      CONVERT(varchar(10), fechaInicioTraslado, 120) AS fechaInicioTrasladoText,
      ordenCompra,
      observaciones,
      tipoDocumentoConductor,
      numeroDocumentoConductor,
      nombreConductor,
      apellidoConductor,
      numeroLicencia,
      numeroPlacaVehiculo,
      estado
    FROM dbo.FLEXO_GRE_OPERACION WITH (UPDLOCK, HOLDLOCK)
    WHERE id = @operacionDbId;
  `);

  return result.recordset[0] ?? null;
}

async function listFlexoOperationItems(transaction: sql.Transaction, operacionDbId: number) {
  const request = transaction.request();
  request.input('operacionId', sql.BigInt, operacionDbId);

  const result = await request.query<FlexoPreparedItemRow>(`
    SELECT
      id,
      numeroOrdenItem,
      codigoEmpaque,
      ticket,
      ordenCompra,
      codigoProducto,
      descripcion,
      cantidadEmpaque,
      cantidadDeclarada,
      unidadMedidaEmpaque,
      unidadMedidaDeclarada,
      ordenGuia,
      estado
    FROM dbo.FLEXO_GRE_ITEM WITH (UPDLOCK, HOLDLOCK)
    WHERE operacionId = @operacionId
    ORDER BY numeroOrdenItem, id;
  `);

  return result.recordset;
}

function buildFlexoGrePayload(operation: FlexoPreparedOperationRow, items: FlexoPreparedItemRow[]): GrePayload {
  return {
    tipoDocumentoRemitente: FLEXO_EMISOR.tipoDocumento,
    numeroDocumentoRemitente: FLEXO_EMISOR.numeroDocumento,
    serieNumeroGuia: operation.serieNumeroGuia,
    tipoDocumentoGuia: '09',
    bl_estadoRegistro: 'N',
    bl_reintento: 0,
    bl_origen: 'T',
    bl_hasFileResponse: 0,
    fechaEmisionGuia: operation.fechaEmisionText,
    horaEmisionGuia: operation.horaEmisionText,
    fechaInicioTraslado: operation.fechaInicioTrasladoText,
    fechaEntregaBienes: '',
    observaciones: normalizeFlexoObservation(operation),
    razonSocialRemitente: FLEXO_EMISOR.razonSocial,
    correoRemitente: '-',
    correoDestinatario: '-',
    numeroDocumentoDestinatario: operation.numeroDocumentoDestinatario,
    tipoDocumentoDestinatario: operation.tipoDocumentoDestinatario,
    razonSocialDestinatario: operation.razonSocialDestinatario,
    motivoTraslado: operation.motivoTraslado,
    descripcionMotivoTraslado: operation.descripcionMotivoTraslado,
    pesoBrutoTotalBienes: trimFlexoDecimal(operation.pesoBrutoTotalBienes),
    unidadMedidaPesoBruto: operation.unidadMedidaPesoBruto,
    modalidadTraslado: operation.modalidadTraslado,
    numeroBultos: '',
    codigoPuerto: '',
    idEntrega: '',
    ubigeoPtoPartida: operation.ubigeoPtoPartida,
    direccionPtoPartida: ensureFlexoLeadingDash(operation.direccionPtoPartida),
    ubigeoPtoLLegada: operation.ubigeoPtoLlegada,
    direccionPtoLLegada: ensureFlexoLeadingDash(operation.direccionPtoLlegada),
    codigoPtollegada: '',
    tipoDocumentoConductor: operation.tipoDocumentoConductor ?? '',
    numeroDocumentoConductor: operation.numeroDocumentoConductor ?? '',
    nombreConductor: operation.nombreConductor ?? '',
    apellidoConductor: operation.apellidoConductor ?? '',
    numeroLicencia: operation.numeroLicencia ?? '',
    numeroPlacaVehiculoPrin: operation.numeroPlacaVehiculo ?? '',
    numeroPlacaVehiculoSec1: '',
    numeroAutorizacionRem: '',
    codigoAutorizadoRem: '',
    tipoDocumentoComprador: '',
    numeroDocumentoComprador: '',
    razonSocialComprador: '',
    tipoEvento: '',
    numeroAutorizacionTrans: '',
    codigoAutorizadoTrans: '',
    tarjetaUnicaCirculacionPrin: '',
    numeroAutorizacionVehPrin: '',
    codigoAutorizadoVehPrin: '',
    numeroPlacaVehiculoSec2: '',
    tarjetaUnicaCirculacionSec1: '',
    tarjetaUnicaCirculacionSec2: '',
    numeroAutorizacionVehSec1: '',
    numeroAutorizacionVehSec2: '',
    codigoAutorizadoVehSec1: '',
    codigoAutorizadoVehSec2: '',
    numeroDocumentoConductorSec1: '',
    tipoDocumentoConductorSec1: '',
    nombreConductorSec1: '',
    apellidoConductorSec1: '',
    numeroLicenciaSec1: '',
    numeroDocumentoConductorSec2: '',
    tipoDocumentoConductorSec2: '',
    nombreConductorSec2: '',
    apellidoConductorSec2: '',
    numeroLicenciaSec2: '',
    numeroDocumentoPtoLlegada: '',
    ptoLlegadaLongitud: '',
    ptoLlegadaLatitud: '',
    numeroDocumentoPtoPartida: '',
    codigoPtoPartida: '',
    ptoPartidaLongitud: '',
    ptoPartidaLatitud: '',
    tipoLocacion: '',
    codigoAeropuerto: '',
    nombrePuertoAeropuerto: '',
    serieGuiaBaja: '',
    codigoGuiaBaja: '',
    tipoGuiaBaja: '',
    numeroDocumentoRelacionado: '',
    codigoDocumentoRelacionado: '',
    numeroDocumentoEstablecimiento: '',
    tipoDocumentoEstablecimiento: '',
    razonSocialEstablecimiento: '',
    numeroRucTransportista: '',
    tipoDocumentoTransportista: '',
    razonSocialTransportista: '',
    numeroRegistroMTC: '',
    indTransbordoProgramado: '',
    indRetornoVehiculoEnvaseVacio: '',
    indRetornoVehiculoVacio: '',
    indTrasVehiculoCatM1L: '',
    indRegVehiculoyCond: '',
    indTrasladoTotalDAMoDS: '',
    numeroContenedor1: '',
    numeroContenedor2: '',
    numeroPrecinto1: '',
    numeroPrecinto2: '',
    pesoBrutoTotalItem: '',
    unidadMedidaPesoBrutoItem: '',
    sustentoPesoBrutoTotal: '',
    bL_SOURCEFILE: '',
    bl_createdAt: null,
    spE_DESPATCH_ITEM: items.map((item) => ({
      codigoEmpaque: item.codigoEmpaque,
      codigoProducto: item.codigoProducto,
      descripcion: item.descripcion,
      cantidad: trimFlexoDecimal(item.cantidadDeclarada),
      unidadMedida: item.unidadMedidaDeclarada,
      moneda: '',
      tipoCambio: null,
      importeUnitarioSinImpuesto: 0,
      serieNumeroGuiaRemision: null,
      serieNumeroGuiaFactura: null,
      ordenguia: null,
      ordenfactura: null,
      id: String(item.id),
      unidadmedida: item.unidadMedidaDeclarada,
      codigo: item.codigoProducto,
      cliente: operation.numeroDocumentoDestinatario
    })),
    SPE_DESPATCH_DOCRELACIONADO: []
  };
}

async function acquireFlexoAppLock(transaction: sql.Transaction, resource: string) {
  const request = new sql.Request(transaction);
  request.input('resource', sql.NVarChar(255), resource);

  const result = await request.query<{ lockResult: number }>(`
    DECLARE @lockResult int;
    EXEC @lockResult = sp_getapplock
      @Resource = @resource,
      @LockMode = 'Exclusive',
      @LockOwner = 'Transaction',
      @LockTimeout = 15000;
    SELECT @lockResult AS lockResult;
  `);

  if ((result.recordset[0]?.lockResult ?? -999) < 0) {
    throw new Error(`No se pudo bloquear ${resource}.`);
  }
}

async function assertFlexoNextCorrelative(transaction: sql.Transaction, operation: FlexoPreparedOperationRow) {
  const expected = Number(operation.numero);
  const request = new sql.Request(transaction);
  request.input('serie', sql.VarChar(4), operation.serie);

  const result = await request.query<{ CORRELATIVO: number | null; nextNumber: number }>(`
    SELECT TOP (1)
      CORRELATIVO,
      ISNULL(CORRELATIVO, 0) + 1 AS nextNumber
    FROM dbo.AAA_TIPODOCUMENTO WITH (UPDLOCK, HOLDLOCK)
    WHERE SERIE = @serie
      AND TIPODOCUMENTO = '09';
  `);
  const row = result.recordset[0];

  if (!row) throw new Error(`No existe AAA_TIPODOCUMENTO para ${operation.serie}/09.`);
  if (Number(row.nextNumber) !== expected) {
    throw new Error(`Correlativo desalineado para ${operation.serie}. Siguiente=${row.nextNumber}, borrador=${expected}.`);
  }
}

async function assertFlexoSerieDoesNotExist(transaction: sql.Transaction, serieNumeroGuia: string) {
  const request = new sql.Request(transaction);
  request.input('serieNumeroGuia', sql.VarChar(20), serieNumeroGuia);
  const result = await request.query<{ total: number }>(`
    SELECT COUNT(1) AS total
    FROM ${FLEXO_GRE_HEADER_TABLE} WITH (UPDLOCK, HOLDLOCK)
    WHERE serieNumeroGuia = @serieNumeroGuia
      AND tipoDocumentoGuia = '09';
  `);

  if ((result.recordset[0]?.total ?? 0) > 0) {
    throw new Error(`La guia ${serieNumeroGuia} ya existe en SPE_DESPATCH.`);
  }
}

async function assertFlexoEmpaqueItemsAvailable(transaction: sql.Transaction, items: FlexoPreparedItemRow[]) {
  for (const item of items) {
    const request = new sql.Request(transaction);
    request.input('codigoEmpaque', sql.Int, item.codigoEmpaque);
    request.input('codigoProducto', sql.VarChar(80), item.codigoProducto);

    const result = await request.query<{
      SERIENUMEROGUIAREMISION: string | null;
      SERIENUMEROGUIAFACTURA: string | null;
    }>(`
      SELECT TOP (1)
        SERIENUMEROGUIAREMISION,
        SERIENUMEROGUIAFACTURA
      FROM dbo.EMPAQUE_DETALLE WITH (UPDLOCK, HOLDLOCK)
      WHERE CODIGOEMPAQUE = @codigoEmpaque
        AND CODIGOPRODUCTO = @codigoProducto;
    `);
    const row = result.recordset[0];

    if (!row) throw new Error(`No existe EMPAQUE_DETALLE ${item.codigoEmpaque}/${item.codigoProducto}.`);
    if (row.SERIENUMEROGUIAREMISION || row.SERIENUMEROGUIAFACTURA) {
      throw new Error(`EMPAQUE_DETALLE ${item.codigoEmpaque}/${item.codigoProducto} ya esta vinculado.`);
    }
  }
}

async function executeFlexoStoredProcedure(transaction: sql.Transaction, procedureName: string, params: StoredProcedureParam[]) {
  const request = new sql.Request(transaction);

  for (const param of params) {
    request.input(param.name, sql.NVarChar, param.value);
  }

  await request.execute(procedureName);
}

async function linkFlexoEmpaqueDetalle(transaction: sql.Transaction, operation: FlexoPreparedOperationRow, items: FlexoPreparedItemRow[]) {
  let linked = 0;

  for (const item of items) {
    const request = new sql.Request(transaction);
    request.input('serieNumeroGuia', sql.VarChar(13), operation.serieNumeroGuia);
    request.input('ordenGuia', sql.VarChar(4), item.ordenGuia);
    request.input('codigoEmpaque', sql.Int, item.codigoEmpaque);
    request.input('codigoProducto', sql.VarChar(80), item.codigoProducto);

    const result = await request.query<{ updated: number }>(`
      UPDATE dbo.EMPAQUE_DETALLE
         SET SERIENUMEROGUIAREMISION = @serieNumeroGuia,
             ORDENGUIA = @ordenGuia
       WHERE CODIGOEMPAQUE = @codigoEmpaque
         AND CODIGOPRODUCTO = @codigoProducto
         AND SERIENUMEROGUIAREMISION IS NULL
         AND SERIENUMEROGUIAFACTURA IS NULL;

      SELECT @@ROWCOUNT AS updated;
    `);

    if (Number(result.recordset[0]?.updated ?? 0) !== 1) {
      throw new Error(`No se pudo vincular EMPAQUE_DETALLE ${item.codigoEmpaque}/${item.codigoProducto}.`);
    }
    linked += 1;
  }

  return linked;
}

async function syncFlexoTipoDocumentoCorrelative(transaction: sql.Transaction, operation: FlexoPreparedOperationRow) {
  const request = new sql.Request(transaction);
  request.input('serie', sql.VarChar(4), operation.serie);
  request.input('numero', sql.Int, Number(operation.numero));

  const result = await request.query<{ updated: number }>(`
    UPDATE dbo.AAA_TIPODOCUMENTO
       SET CORRELATIVO = @numero
     WHERE SERIE = @serie
       AND TIPODOCUMENTO = '09'
       AND ISNULL(CORRELATIVO, 0) = @numero - 1;

    SELECT @@ROWCOUNT AS updated;
  `);

  if (Number(result.recordset[0]?.updated ?? 0) !== 1) {
    throw new Error(`No se pudo sincronizar AAA_TIPODOCUMENTO para ${operation.serie}.`);
  }

  return Number(operation.numero);
}

async function queryFlexoDeclareStatus(
  poolOrTransaction: sql.ConnectionPool | sql.Transaction,
  operation: Pick<FlexoPreparedOperationRow, 'serieNumeroGuia' | 'serie'>,
  _items: FlexoPreparedItemRow[]
): Promise<FlexoDeclareProcedureStatus> {
  const headerRequest = createFlexoRequest(poolOrTransaction);
  headerRequest.input('serieNumeroGuia', sql.VarChar(20), operation.serieNumeroGuia);
  const header = await headerRequest.query<Record<string, unknown>>(`
    SELECT TOP (1) *
    FROM ${FLEXO_GRE_HEADER_TABLE}
    WHERE serieNumeroGuia = @serieNumeroGuia
      AND tipoDocumentoGuia = '09';
  `);

  const countRequest = createFlexoRequest(poolOrTransaction);
  countRequest.input('serieNumeroGuia', sql.VarChar(20), operation.serieNumeroGuia);
  countRequest.input('serie', sql.VarChar(4), operation.serie);
  const counts = await countRequest.query<{
    itemCount: number;
    responseCount: number;
    linkedItems: number;
    tipoDocumentoCorrelativo: number | null;
  }>(`
    SELECT
      (SELECT COUNT(1) FROM ${FLEXO_GRE_ITEM_TABLE} WHERE serieNumeroGuia = @serieNumeroGuia AND tipoDocumentoGuia = '09') AS itemCount,
      (SELECT COUNT(1) FROM ${FLEXO_GRE_RESPONSE_TABLE} WHERE serieNumeroGuia = @serieNumeroGuia AND tipoDocumentoGuia = '09') AS responseCount,
      (SELECT COUNT(1) FROM dbo.EMPAQUE_DETALLE WHERE SERIENUMEROGUIAREMISION = @serieNumeroGuia) AS linkedItems,
      (SELECT TOP (1) CORRELATIVO FROM dbo.AAA_TIPODOCUMENTO WHERE SERIE = @serie AND TIPODOCUMENTO = '09') AS tipoDocumentoCorrelativo;
  `);
  const count = counts.recordset[0];

  return {
    header: header.recordset[0] ?? null,
    itemCount: Number(count?.itemCount ?? 0),
    responseCount: Number(count?.responseCount ?? 0),
    linkedItems: Number(count?.linkedItems ?? 0),
    tipoDocumentoCorrelativo: count?.tipoDocumentoCorrelativo ?? null
  };
}

function assertFlexoPreparedStatus(operation: FlexoPreparedOperationRow, status: FlexoDeclareProcedureStatus, expectedItems: number) {
  if (!status.header) throw new Error(`USP_CabeceraGuia no creo cabecera ${operation.serieNumeroGuia}.`);
  if (status.itemCount !== expectedItems) {
    throw new Error(`USP_DetalleGuia creo ${status.itemCount} item(s); se esperaban ${expectedItems}.`);
  }
  if (status.header.bl_estadoRegistro !== 'N') {
    throw new Error(`Antes de USP_ENVIOGUIA el estado debe ser N; actual=${String(status.header.bl_estadoRegistro ?? 'NULL')}.`);
  }
  if (status.responseCount !== 0) {
    throw new Error(`La guia ${operation.serieNumeroGuia} ya tiene respuestas Bizlinks.`);
  }
}

async function markFlexoGuideDeclared(
  transaction: sql.Transaction,
  operation: FlexoPreparedOperationRow,
  insertedItems: number,
  linkedItems: number,
  status: unknown
) {
  const request = new sql.Request(transaction);
  request.input('operacionId', sql.BigInt, operation.id);
  request.input('serieNumeroGuia', sql.VarChar(13), operation.serieNumeroGuia);
  request.input('respuestaJson', sql.NVarChar(sql.MAX), JSON.stringify(status));

  const envio = await request.query<{ envioId: number }>(`
    UPDATE dbo.FLEXO_GRE_OPERACION
       SET estado = 'ENVIADO',
           actualizadoEn = SYSUTCDATETIME(),
           finalizadoEn = SYSUTCDATETIME()
     WHERE id = @operacionId;

    UPDATE dbo.FLEXO_GRE_ITEM
       SET estado = 'VINCULADO_GRE',
           actualizadoEn = SYSUTCDATETIME()
     WHERE operacionId = @operacionId;

    UPDATE dbo.FLEXO_GRE_ENVIO
       SET estado = 'ENVIADO',
           intentos = intentos + 1,
           mensaje = 'GRE Flexo declarada y enviada a Bizlinks.',
           respuestaJson = @respuestaJson,
           actualizadoEn = SYSUTCDATETIME(),
           insertadoBizlinksEn = SYSUTCDATETIME(),
           enviadoBizlinksEn = SYSUTCDATETIME()
     WHERE id = (
       SELECT TOP (1) id
       FROM dbo.FLEXO_GRE_ENVIO
       WHERE operacionId = @operacionId
       ORDER BY id DESC
     );

    SELECT TOP (1) id AS envioId
    FROM dbo.FLEXO_GRE_ENVIO
    WHERE operacionId = @operacionId
    ORDER BY id DESC;
  `);

  await insertGuideEvent(transaction, operation.id, envio.recordset[0]?.envioId ?? null, null, 'DECLARADA_BIZLINKS', 'GRE Flexo declarada con SP oficiales.', {
    serieNumeroGuia: operation.serieNumeroGuia,
    insertedItems,
    linkedItems,
    status
  });
}

async function recordFlexoDeclareError(transaction: sql.Transaction, operacionDbId: number, error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  const request = new sql.Request(transaction);
  request.input('operacionId', sql.BigInt, operacionDbId);
  request.input('mensaje', sql.NVarChar(sql.MAX), message);
  request.input('datosJson', sql.NVarChar(sql.MAX), JSON.stringify({ message }));

  await request.query(`
    DECLARE @envioId bigint;

    SELECT TOP (1) @envioId = id
    FROM dbo.FLEXO_GRE_ENVIO
    WHERE operacionId = @operacionId
    ORDER BY id DESC;

    UPDATE dbo.FLEXO_GRE_OPERACION
       SET estado = 'ERROR',
           actualizadoEn = SYSUTCDATETIME()
     WHERE id = @operacionId;

    IF @envioId IS NOT NULL
    BEGIN
      UPDATE dbo.FLEXO_GRE_ENVIO
         SET estado = 'ERROR',
             mensaje = @mensaje,
             actualizadoEn = SYSUTCDATETIME()
       WHERE id = @envioId;
    END;

    INSERT INTO dbo.FLEXO_GRE_EVENTO (operacionId, envioId, tipo, mensaje, datosJson)
    VALUES (@operacionId, @envioId, 'ERROR_DECLARACION', @mensaje, @datosJson);
  `);

  await transaction.commit();
}

function normalizeFlexoObservation(operation: FlexoPreparedOperationRow) {
  const value = operation.observaciones?.trim()
    || (operation.ordenCompra?.trim() ? `OC ${operation.ordenCompra.trim()}.` : '');

  if (value.length > 250) {
    throw new Error(`Observaciones supera 250 caracteres (${value.length}). Ajustar antes de declarar.`);
  }

  return value;
}

function ensureFlexoLeadingDash(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return '-';
  return trimmed.startsWith('-') ? trimmed : `-${trimmed}`;
}

function trimFlexoDecimal(value: number) {
  return Number(value).toFixed(6).replace(/\.?0+$/, '');
}

function createFlexoRequest(poolOrTransaction: sql.ConnectionPool | sql.Transaction) {
  return poolOrTransaction instanceof sql.Transaction
    ? new sql.Request(poolOrTransaction)
    : new sql.Request(poolOrTransaction);
}

function mapEmpaqueAdjustment(row: EmpaqueAdjustmentRow): FlexoEmpaqueAdjustment {
  const codigoEmpaque = Number(row.CODIGOEMPAQUE);
  const codigoProducto = row.CODIGOPRODUCTO?.trim() ?? '';

  return {
    id: `${codigoEmpaque}-${codigoProducto}`,
    codigoEmpaque,
    codigoProducto,
    descripcion: row.DESCRIPCION?.trim() ?? '',
    cantidad: Number(row.CANTIDAD ?? 0),
    unidadMedida: row.UNIDADMEDIDA?.trim() ?? '',
    moneda: row.MONEDA?.trim() ?? '',
    ordenGuia: row.ORDENGUIA?.trim() ?? '',
    ordenFactura: row.ORDENFACTURA?.trim() ?? '',
    ticket: row.TICKETNUM?.trim() ?? '',
    ordenCompra: row.ORDENCOMPRA?.trim() ?? '',
    clienteNumeroDocumento: row.NUMERODOCUMENTOADQUIRIENTE?.trim() ?? '',
    clienteRazonSocial: row.RAZONSOCIALADQUIRIENTE?.trim() ?? '',
    guiaRemision: row.SERIENUMEROGUIAREMISION?.trim() || null,
    guiaFactura: row.SERIENUMEROGUIAFACTURA?.trim() || null
  };
}

async function safeCatalogQuery<T>(
  warnings: FlexoCatalogWarning[],
  source: string,
  run: () => Promise<sql.IResult<T>>
) {
  try {
    return await run();
  } catch (error) {
    warnings.push({
      source,
      message: error instanceof Error ? error.message : String(error)
    });

    return { recordset: [] as T[] };
  }
}

async function safeReportQuery<T>(
  warnings: string[],
  source: string,
  run: () => Promise<sql.IResult<T>>
) {
  try {
    return await run();
  } catch (error) {
    warnings.push(`${source}: ${error instanceof Error ? error.message : String(error)}`);

    return { recordset: [] as T[] };
  }
}

function mapGuideReport(row: FlexoGuideReportRow, traceEstado?: string): FlexoReportGuide {
  const mensaje = row.mensaje?.trim() ?? '';
  const manualSunatMessageAllowed = Boolean(traceEstado && isEligibleForManualSunatMessage({
    bl_estadoRegistro: row.responseEstadoRegistro,
    bl_estadoProceso: row.bl_estadoProceso,
    process_state: row.process_state,
    bl_mensajeSunat: row.bl_mensajeSunat
  }));

  return {
    tipo: 'GRE',
    serieNumero: row.serieNumeroGuia,
    fecha: row.fechaEmisionGuia,
    clienteDocumento: row.numeroDocumentoDestinatario?.trim() ?? '',
    clienteNombre: row.razonSocialDestinatario?.trim() ?? '',
    estado: normalizeReportStatus(traceEstado, row.estadoBizlinks, row.bl_estadoProceso, mensaje),
    estadoBizlinks: row.estadoBizlinks?.trim() ?? '',
    estadoProceso: row.bl_estadoProceso?.trim() || row.process_state?.trim() || '',
    mensaje,
    pdfDisponible: Boolean(row.pdfDisponible),
    empaques: Number(row.empaques ?? 0),
    items: Number(row.items ?? 0),
    itemsFacturados: Number(row.itemsFacturados ?? 0),
    trazabilidadPortal: Boolean(traceEstado),
    manualSunatMessageAllowed
  };
}

function mapInvoiceReport(row: FlexoInvoiceReportRow, traceEstado?: string): FlexoReportInvoice {
  const mensaje = row.mensaje?.trim() ?? '';

  return {
    tipo: 'FE',
    serieNumero: row.serieNumero,
    fecha: row.fechaEmision,
    clienteDocumento: row.numeroDocumentoAdquiriente?.trim() ?? '',
    clienteNombre: row.razonSocialAdquiriente?.trim() ?? '',
    estado: normalizeReportStatus(traceEstado, row.estadoBizlinks, row.bl_estadoProceso, mensaje),
    estadoBizlinks: row.estadoBizlinks?.trim() ?? '',
    estadoProceso: row.bl_estadoProceso?.trim() || row.process_state?.trim() || '',
    mensaje,
    pdfDisponible: Boolean(row.pdfDisponible),
    guias: Number(row.guias ?? 0),
    items: Number(row.items ?? 0),
    total: Number(row.totalVenta ?? 0),
    trazabilidadPortal: Boolean(traceEstado)
  };
}

function normalizeReportStatus(
  traceEstado: string | undefined,
  estadoBizlinks: string | null,
  estadoProceso: string | null,
  mensaje: string
): FlexoReportStatus {
  if (traceEstado === 'ANULADA' || traceEstado === 'NCE_EMITIDA') return 'ANULADA';
  if (traceEstado === 'ERROR') return 'ERROR';
  if (traceEstado === 'RECHAZADA') return 'RECHAZADA';
  if (traceEstado === 'ACEPTADA') return 'ACEPTADA';

  const estado = estadoBizlinks?.trim().toUpperCase() ?? '';
  const proceso = estadoProceso?.trim().toUpperCase() ?? '';
  if (proceso.includes('AC_03') || /"codigo"\s*:\s*"0"/i.test(mensaje) || /aceptad[ao]/i.test(mensaje)) return 'ACEPTADA';
  if (estado === 'E' || proceso.includes('RC_') || /rechazad[ao]|error|observad[ao]/i.test(mensaje)) return 'RECHAZADA';
  if (estado === 'A' || estado === 'L' || estado === 'P' || proceso) return 'EN_PROCESO';

  return 'PENDIENTE';
}

function isAllowedBizlinksFileUrl(value: string) {
  try {
    const url = new URL(value);

    return url.protocol === 'https:' && url.hostname.toLowerCase() === 'sfeintegrador.bizlinks.com.pe';
  } catch {
    return false;
  }
}

function normalizeFlexoLocalDateTime(value: string) {
  const normalized = value.trim().replace('T', ' ').slice(0, 19);

  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(normalized)) {
    return `${normalized}:00`;
  }

  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(normalized)) {
    return normalized;
  }

  throw new Error('Fecha de emision Flexo invalida.');
}

function normalizeFlexoDate(value: string) {
  const normalized = value.trim().slice(0, 10);

  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) {
    throw new Error('Fecha de traslado Flexo invalida.');
  }

  return normalized;
}

function normalizeEditableUnidad(value: string) {
  const normalized = value.trim().toUpperCase();
  const allowed = new Set(['NIU', 'MLL', 'MIL', 'KGM', 'MTR', 'MTK', 'ZZ']);

  if (!allowed.has(normalized)) {
    throw new Error('Unidad de medida no permitida para ajuste Flexo.');
  }

  return normalized;
}

function groupEmpaques(rows: EmpaqueRow[]) {
  const empaques = new Map<number, FlexoEmpaque>();

  for (const row of rows) {
    const codigoEmpaque = Number(row.CODIGOEMPAQUE);
    const empaque = empaques.get(codigoEmpaque) ?? {
      id: String(codigoEmpaque),
      codigoEmpaque,
      ticket: row.TICKETNUM?.trim() ?? '',
      ordenCompra: row.ORDENCOMPRA?.trim() ?? '',
      fechaCreacion: row.FECHACREACION ? row.FECHACREACION.toISOString() : null,
      destino: {
        id: `${row.UBIGEOPTOLLEGADA?.trim() ?? ''}-${codigoEmpaque}`,
        ubigeo: row.UBIGEOPTOLLEGADA?.trim() ?? '',
        direccion: row.DIRECCIONPTOLLEGADA?.trim() ?? ''
      },
      items: []
    };

    empaque.items.push({
      id: `${codigoEmpaque}-${row.CODIGOPRODUCTO?.trim() ?? empaque.items.length + 1}`,
      codigoEmpaque,
      codigoProducto: row.CODIGOPRODUCTO?.trim() ?? '',
      descripcion: row.DESCRIPCION?.trim() ?? '',
      cantidad: Number(row.CANTIDAD ?? 0),
      unidadMedida: normalizeUnidad(row.UNIDADMEDIDA)
    });

    empaques.set(codigoEmpaque, empaque);
  }

  return [...empaques.values()];
}

function normalizeUnidad(value: string | null | undefined) {
  const unit = value?.trim().toUpperCase() ?? '';
  if (!unit) return 'NIU';
  return unit === 'ROLLS' || unit === 'ROLLOS' || unit === 'ROLLO' || unit === 'ROL' || unit === 'ROLL'
    ? 'NIU'
    : unit;
}

function validateFlexoPreview(input: FlexoGuidePreviewInput) {
  const validations: FlexoValidation[] = [];
  const add = (code: string, severity: FlexoValidation['severity'], message: string) => {
    validations.push({ code, severity, message });
  };

  add('SERIE_FLEXO', /^T(003|999)-\d{8}$/.test(input.serieNumeroGuia) ? 'ok' : 'error', 'La guia Flexo debe usar serie T003 o T999.');
  add('CLIENTE', input.cliente.numeroDocumento && input.cliente.razonSocial ? 'ok' : 'error', 'Debe seleccionar un destinatario.');
  add('DESTINO', /^\d{6}$/.test(input.destino.ubigeo.trim()) && input.destino.direccion.trim() ? 'ok' : 'error', 'Debe seleccionar un destino con ubigeo de 6 digitos y direccion.');
  add('MOTIVO', input.motivoTraslado ? 'ok' : 'error', 'Debe seleccionar un motivo de traslado.');
  add('PESO', input.pesoBruto > 0 ? 'ok' : 'error', 'El peso bruto debe ser mayor a cero.');
  add('BULTOS', input.numeroBultos > 0 ? 'ok' : 'error', 'El numero de bultos debe ser mayor a cero.');
  add('OBSERVACIONES', input.observaciones.length <= 250 ? 'ok' : 'error', 'Las observaciones no pueden superar los 250 caracteres.');
  add(
    'DESCRIPCIONES',
    input.empaques.every((empaque) => empaque.items.every((item) => item.descripcion.trim().length >= 3 && item.descripcion.trim().length <= 500)) ? 'ok' : 'error',
    'Cada descripcion debe tener entre 3 y 500 caracteres.'
  );
  add('CHOFER', input.conductor.numeroDocumento && input.conductor.licencia && input.conductor.placa ? 'ok' : 'warning', 'Complete chofer, licencia y placa antes de declarar.');
  add('EMPAQUES', input.empaques.length > 0 ? 'ok' : 'error', 'Debe seleccionar uno o mas empaques.');

  const ordenes = new Set(input.empaques.map((item) => item.ordenCompra.trim()).filter(Boolean));
  add('OC_UNICA', ordenes.size <= 1 ? 'ok' : 'error', 'Los empaques seleccionados deben tener una sola OC.');

  return validations;
}
