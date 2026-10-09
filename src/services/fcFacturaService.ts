import type { AppConfig } from '../config/env.js';
import { getGreDefaults } from '../config/greDefaults.js';
import { createBizlinksPool, createGreFcPool, createYchiPool, sql } from '../integrations/bizlinksSql.js';
import {
  effectiveDueDate,
  invoiceAmountInWords,
  invoiceItemDescription,
  toFcFacturaProcedurePlan
} from '../mappers/fcFacturaProcedureMapper.js';
import type { StoredProcedureParam } from '../mappers/speDespatchProcedureMapper.js';
import {
  FC_FACTURA_SERIE,
  FC_FACTURA_SERIE_NUMERO_PREVIEW,
  type FcFacturaPreviewInput
} from '../schemas/fcFacturaSchema.js';
import { getDownloadedPdf, type PdfDelivery } from './bizlinksPdfDownloadService.js';

const FACTURA_DETAIL_DESCRIPTION_MAX_LENGTH = 1700;

export type FcFacturaCliente = {
  id: string;
  tipoDocumento: string;
  numeroDocumento: string;
  razonSocial: string;
  fuente: 'GRE_FC' | 'BIZLINKS' | 'CLIENTE_YCHIDB3' | 'PROVEEDOR';
  direccionFiscal?: FcFacturaDireccionFiscal | null;
};

export type FcFacturaDireccionFiscal = {
  direccion: string;
  ubigeo: string;
  distrito: string;
  provincia: string;
  departamento: string;
  pais: string;
  fuente: 'AAA_ADQUIRIENTE' | 'FACTURA_ACEPTADA' | 'YCHIDB3';
};

export type FcFacturaVendedor = {
  idEmpleado: number | null;
  nombre: string;
};

export type FcFacturaItem = {
  id: string;
  serieNumeroGuia: string;
  codigoProducto: string;
  descripcion: string;
  cantidad: number;
  unidadMedida: string;
  precioUnitario: number;
  afectoIgv: boolean;
};

export type FcFacturaGuiaPendiente = {
  operationId: string;
  serieNumeroGuia: string;
  fecha: string | null;
  cliente: {
    tipoDocumento: string;
    numeroDocumento: string;
    razonSocial: string;
  };
  estadoSunat: 'ACEPTADA';
  items: FcFacturaItem[];
};

export type FcFacturaValidation = {
  code: string;
  severity: 'ok' | 'warning' | 'error';
  message: string;
};

export type FcFacturaCuenta = {
  id: string;
  cuenta: string;
  denominacion: string;
  label: string;
  fuente: 'VIEW_CUENTAS_FACTURA' | 'FC_OFFSET_DEFAULT';
};

export type FcFacturaFormaPago = {
  id: string;
  nombre: string;
  valor: string;
  dias: number;
};

export type FcFacturaNextSerie = {
  serie: typeof FC_FACTURA_SERIE;
  numero: string;
  serieNumeroFactura: string;
  reserved: false;
  source: 'BIZLINKS_SPE_EINVOICEHEADER' | 'BIZLINKS_SPE_EINVOICEHEADER_AND_GRE_FC_TRACE';
};

export type FcFacturaDeclareOptions = {
  operationId: string;
  user?: string;
};

export type FcFacturaDeclareResult = {
  operationId: string;
  reused: boolean;
  serieNumeroFactura: string;
  insertedHeader: boolean;
  insertedItems: number;
  activated: boolean;
  status: FcFacturaProcedureExecutionStatus;
};

export type FcFacturaStatusResult = {
  operationId: string;
  serieNumeroFactura: string;
  creadoEn: string | null;
  cliente: string;
  numeroDocumentoCliente: string;
  estadoOperacion: string;
  estadoEnvio: string | null;
  estadoBizlinks: string | null;
  estadoProceso: string | null;
  mensaje: string | null;
  total: number;
  items: number;
  pdfDisponible: boolean;
};

type GreGuideDetailRow = {
  operationId: string;
  operationPk: number;
  serieNumeroGuia: string;
  creadoEn: Date | null;
  tipoDocumentoDestinatario: string;
  numeroDocumentoDestinatario: string;
  razonSocialDestinatario: string;
  detalleId: number;
  codigo: string;
  descripcion: string;
  cantidad: number | string;
  unidad: string;
};

type BizlinksStatusRow = {
  serieNumeroGuia: string;
  bl_estadoRegistro: string | null;
  responseEstadoRegistro: string | null;
  bl_estadoProceso: string | null;
  process_state: string | null;
  bl_mensaje: string | null;
  bl_mensajeSunat: string | null;
};

type FcFacturaProcedureExecutionStatus = {
  header: Record<string, unknown> | null;
  response: Record<string, unknown> | null;
  headerCount: number;
  itemCount: number;
  responseCount: number;
};

type ExistingFacturaEnvio = {
  operacionDbId: number;
  envioId: number;
  serieNumeroFactura: string;
  estado: string;
};

export interface FcFacturaService {
  searchClientes(query: string, includeYchiRecipients?: boolean): Promise<FcFacturaCliente[]>;
  getNextSerie(): Promise<FcFacturaNextSerie>;
  listCuentas(): Promise<{
    cuentas: FcFacturaCuenta[];
    warnings: string[];
  }>;
  listFormasPago(): Promise<FcFacturaFormaPago[]>;
  listGuiasPendientes(numeroDocumento: string): Promise<{
    guias: FcFacturaGuiaPendiente[];
    vendedor: FcFacturaVendedor | null;
    warnings: string[];
  }>;
  preview(input: FcFacturaPreviewInput): Promise<{
    writesDatabase: false;
    productionEnabled: true;
    serieNumeroFactura: string;
    totals: {
      gravada: number;
      igv: number;
      total: number;
    };
    validations: FcFacturaValidation[];
    financial: ReturnType<typeof calculateFinancialSummary>;
    payload: FcFacturaPreviewInput;
    procedurePlan: ReturnType<typeof toFcFacturaProcedurePlan>;
  }>;
  declarar(input: FcFacturaPreviewInput, options: FcFacturaDeclareOptions): Promise<FcFacturaDeclareResult>;
  listFacturas(): Promise<FcFacturaStatusResult[]>;
  getFacturaPdf(serieNumeroFactura: string): Promise<PdfDelivery | null>;
}

export class DirectDbFcFacturaService implements FcFacturaService {
  constructor(private readonly config: AppConfig) {}

  async searchClientes(query: string, includeYchiRecipients = false): Promise<FcFacturaCliente[]> {
    const normalized = query.trim();
    const greFcPool = createGreFcPool(this.config);
    const bizlinksPool = createBizlinksPool(this.config);
    const ychiPool = createYchiPool(this.config);

    await greFcPool.connect();
    await bizlinksPool.connect();
    await ychiPool.connect();

    try {
      const results = [
        ...await searchClientesFromGreFc(greFcPool, normalized),
        ...await searchClientesFromBizlinks(bizlinksPool, normalized),
        ...(includeYchiRecipients ? await searchRecipientsFromYchi(ychiPool, normalized) : [])
      ];
      const byDocument = new Map<string, FcFacturaCliente>();

      for (const item of results) {
        const numeroDocumento = item.numeroDocumento.trim();
        const razonSocial = item.razonSocial.trim();
        if (!numeroDocumento || !razonSocial) continue;

        const key = `${item.tipoDocumento.trim() || '6'}-${numeroDocumento}`;
        if (!byDocument.has(key)) {
          byDocument.set(key, {
            ...item,
            id: key,
            tipoDocumento: item.tipoDocumento.trim() || '6',
            numeroDocumento,
            razonSocial
          });
        }
      }

      const customers = [...byDocument.values()].slice(0, 50);
      const fiscalAddresses = await findCustomerFiscalAddresses(
        bizlinksPool,
        ychiPool,
        customers.map((customer) => customer.numeroDocumento)
      );

      return customers.map((customer) => ({
        ...customer,
        direccionFiscal: fiscalAddresses.get(customer.numeroDocumento) ?? null
      }));
    } finally {
      await ychiPool.close();
      await bizlinksPool.close();
      await greFcPool.close();
    }
  }

  async getNextSerie(): Promise<FcFacturaNextSerie> {
    const bizlinksPool = createBizlinksPool(this.config);
    const greFcPool = createGreFcPool(this.config);
    await bizlinksPool.connect();
    await greFcPool.connect();

    try {
      const nextNumber = await nextFacturaNumber(bizlinksPool);
      const numero = String(nextNumber).padStart(8, '0');

      return {
        serie: FC_FACTURA_SERIE,
        numero,
        serieNumeroFactura: `${FC_FACTURA_SERIE}-${numero}`,
        reserved: false,
        source: 'BIZLINKS_SPE_EINVOICEHEADER'
      };
    } finally {
      await greFcPool.close();
      await bizlinksPool.close();
    }
  }

  async listCuentas() {
    const ychiPool = createYchiPool(this.config);
    await ychiPool.connect();

    try {
      const warnings: string[] = [];
      const officialAccounts = await listOfficialInvoiceAccounts(ychiPool, warnings);

      if (officialAccounts.length > 0) {
        return {
          cuentas: officialAccounts,
          warnings
        };
      }

      return {
        cuentas: listDefaultFcOffsetAccounts(warnings),
        warnings
      };
    } finally {
      await ychiPool.close();
    }
  }

  async listFormasPago() {
    const ychiPool = createYchiPool(this.config);
    await ychiPool.connect();

    try {
      const result = await new sql.Request(ychiPool).query<{
        idPropiedades: number;
        Nombre: string | null;
        Valor: string | null;
        Descripcion: string | null;
      }>(`
        SELECT TOP (120)
          idPropiedades,
          Nombre,
          Valor,
          Descripcion
        FROM dbo.tbPropiedades
        WHERE tipo = 'FPAG'
          AND ISNULL(Valor, '') NOT LIKE '(obsoleto)%'
          AND ISNULL(Nombre, '') NOT LIKE '(obsoleto)%'
        ORDER BY
          CASE WHEN Nombre LIKE 'Contado%' THEN 0 ELSE 1 END,
          Nombre
      `);

      return result.recordset.map((row) => ({
        id: String(row.idPropiedades),
        nombre: row.Nombre?.trim() || row.Valor?.trim() || String(row.idPropiedades),
        valor: row.Valor?.trim() || row.Nombre?.trim() || '',
        dias: Number(row.Descripcion ?? 0) || 0
      }));
    } finally {
      await ychiPool.close();
    }
  }

  async listGuiasPendientes(numeroDocumento: string) {
    const normalizedDocument = numeroDocumento.trim();
    if (!normalizedDocument) {
      return {
        guias: [],
        vendedor: null,
        warnings: ['Seleccione un cliente para listar GRE pendientes.']
      };
    }

    const greFcPool = createGreFcPool(this.config);
    const bizlinksPool = createBizlinksPool(this.config);
    const ychiPool = createYchiPool(this.config);

    await greFcPool.connect();
    await bizlinksPool.connect();
    await ychiPool.connect();

    try {
      const guideRows = await listGreFcGuideRows(greFcPool, normalizedDocument);
      const series = [...new Set(guideRows.map((row) => row.serieNumeroGuia))];
      const statuses = await getBizlinksStatuses(bizlinksPool, series);
      const duplicateResult = await findAlreadyInvoicedGuides(bizlinksPool, ychiPool, series);
      const sellerResult = await findSellerForCustomer(ychiPool, normalizedDocument);
      const warnings = [...duplicateResult.warnings];
      warnings.push(...sellerResult.warnings);
      const guides = new Map<string, FcFacturaGuiaPendiente>();

      for (const row of guideRows) {
        const status = statuses.get(row.serieNumeroGuia);
        if (!status || !hasSunatAcceptedResponse(status)) continue;
        if (duplicateResult.alreadyInvoiced.has(row.serieNumeroGuia)) continue;

        const guide = guides.get(row.serieNumeroGuia) ?? {
          operationId: row.operationId,
          serieNumeroGuia: row.serieNumeroGuia,
          fecha: row.creadoEn ? row.creadoEn.toISOString() : null,
          cliente: {
            tipoDocumento: row.tipoDocumentoDestinatario,
            numeroDocumento: row.numeroDocumentoDestinatario,
            razonSocial: row.razonSocialDestinatario
          },
          estadoSunat: 'ACEPTADA' as const,
          items: []
        };

        guide.items.push({
          id: `${row.serieNumeroGuia}-${row.detalleId}`,
          serieNumeroGuia: row.serieNumeroGuia,
          codigoProducto: row.codigo,
          descripcion: row.descripcion,
          cantidad: Number(row.cantidad ?? 0),
          unidadMedida: normalizeInvoiceUnit(row.unidad),
          precioUnitario: 0,
          afectoIgv: true
        });
        guides.set(row.serieNumeroGuia, guide);
      }

      if (warnings.length === 0) {
        warnings.push('Validacion de no duplicidad aplicada contra AAA_GUIAFACTURADA y tbDocumentos.nguia.');
      }

      return {
        guias: [...guides.values()],
        vendedor: sellerResult.vendedor,
        warnings
      };
    } finally {
      await ychiPool.close();
      await bizlinksPool.close();
      await greFcPool.close();
    }
  }

  async preview(input: FcFacturaPreviewInput) {
    input = await resolveInvoiceExchangeRate(this.config, input);
    const validations = validatePreview(input);
    const totals = calculateTotalsByExclusion(input.items, input.tipoExclusionProducto);

    return {
      writesDatabase: false as const,
      productionEnabled: true as const,
      serieNumeroFactura: `${FC_FACTURA_SERIE}-${input.numero}`,
      totals,
      validations,
      financial: calculateFinancialSummary(input, totals),
      payload: input,
      procedurePlan: toFcFacturaProcedurePlan(input, getGreDefaults(this.config), totals)
    };
  }

  async declarar(input: FcFacturaPreviewInput, options: FcFacturaDeclareOptions): Promise<FcFacturaDeclareResult> {
    input = await resolveInvoiceExchangeRate(this.config, input);
    const greFcPool = createGreFcPool(this.config);
    const bizlinksPool = createBizlinksPool(this.config);

    await greFcPool.connect();
    await bizlinksPool.connect();

    const greFcTransaction = new sql.Transaction(greFcPool);
    let greFcCommitted = false;
    let bizlinksTransaction: sql.Transaction | undefined;

    try {
      await greFcTransaction.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);
      await acquireAppLock(greFcTransaction, `FC_FACT_OPERACION:${options.operationId}`);

      const existing = await findProcessedFacturaOperation(greFcTransaction, options.operationId);
      if (existing) {
        const status = await queryFacturaProcedureStatus(bizlinksPool, existing.serieNumeroFactura);
        await insertFacturaEvent(greFcTransaction, existing.operacionDbId, existing.envioId, 'REUTILIZADO', 'Operacion de factura ya procesada', {
          serieNumeroFactura: existing.serieNumeroFactura
        });
        await greFcTransaction.commit();
        greFcCommitted = true;

        return {
          operationId: options.operationId,
          reused: true,
          serieNumeroFactura: existing.serieNumeroFactura,
          insertedHeader: false,
          insertedItems: 0,
          activated: ['ACTIVADO', 'ACEPTADA'].includes(existing.estado),
          status
        };
      }

      assertInvoiceReadyForDeclaration(input);
      await acquireFacturaGuideLocks(greFcTransaction, input);
      await assertGuidesNotAlreadyTraced(greFcTransaction, input, this.config.bizlinksDb.database);
      await assertFacturaGuideTraceSchema(greFcTransaction, input);

      bizlinksTransaction = new sql.Transaction(bizlinksPool);
      await bizlinksTransaction.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);
      await acquireAppLock(bizlinksTransaction, `FC_FACT_${FC_FACTURA_SERIE}_CORRELATIVO`);

      const generatedSerieNumeroFactura = await nextFacturaSerie(bizlinksTransaction);
      const numero = generatedSerieNumeroFactura.split('-')[1] ?? '00000001';
      const declaredInput: FcFacturaPreviewInput = {
        ...input,
        serie: FC_FACTURA_SERIE,
        numero
      };
      const totals = calculateTotalsByExclusion(declaredInput.items, declaredInput.tipoExclusionProducto);
      const plan = toFcFacturaProcedurePlan(declaredInput, getGreDefaults(this.config), totals);

      await assertFacturaSerieDoesNotExist(bizlinksTransaction, generatedSerieNumeroFactura);
      const prepared = await prepareFacturaOperation(greFcTransaction, declaredInput, options, totals);
      await insertFacturaEvent(greFcTransaction, prepared.operacionDbId, prepared.envioId, 'SP_PREVIEW_VALIDADO', 'Parametros de SP FE preparados antes de ejecutar Bizlinks', {
        serieNumeroFactura: generatedSerieNumeroFactura,
        procedurePlan: plan
      });

      await executeStoredProcedure(bizlinksTransaction, 'dbo.USP_CabeceraFE', plan.USP_CabeceraFE);
      await updateFacturaLegacyPrintHeaderFields(
        bizlinksTransaction,
        declaredInput,
        totals,
        generatedSerieNumeroFactura,
        getGreDefaults(this.config).remitente.numeroDocumento
      );
      for (const detailParams of plan.USP_DetalleFE) {
        await executeStoredProcedure(bizlinksTransaction, 'dbo.USP_DetalleFE', detailParams);
      }
      await assertFacturaPaymentTerms(
        bizlinksTransaction,
        declaredInput,
        totals,
        getGreDefaults(this.config).remitente.numeroDocumento
      );
      await assertFacturaPrintAddons(
        bizlinksTransaction,
        generatedSerieNumeroFactura,
        getGreDefaults(this.config).remitente.numeroDocumento
      );
      await insertGuideInvoiceLinks(bizlinksTransaction, declaredInput, getGreDefaults(this.config).remitente.numeroDocumento);
      await executeStoredProcedure(bizlinksTransaction, 'dbo.USP_EnviaDocumentoFE', plan.USP_EnviaDocumentoFE);

      const status = await queryFacturaProcedureStatus(bizlinksTransaction, generatedSerieNumeroFactura);
      assertFacturaInserted(status, generatedSerieNumeroFactura, declaredInput.items.length);

      await bizlinksTransaction.commit();
      await syncLegacyFacturaCorrelativeAndRecord(
        this.config,
        greFcTransaction,
        prepared,
        generatedSerieNumeroFactura
      );
      await mirrorLegacyFacturaSalesRegisterAndRecord(
        this.config,
        greFcTransaction,
        prepared,
        generatedSerieNumeroFactura,
        declaredInput,
        totals
      );
      const guides = await insertFacturaGuidesSnapshotIfEmpty(
        greFcTransaction,
        prepared.operacionDbId,
        declaredInput,
        this.config.bizlinksDb.database
      );
      await insertFacturaDetailsSnapshotIfEmpty(greFcTransaction, prepared.operacionDbId, guides, declaredInput);
      await markFacturaInsertedBizlinks(greFcTransaction, prepared, generatedSerieNumeroFactura, declaredInput.items.length, status);
      await greFcTransaction.commit();
      greFcCommitted = true;

      return {
        operationId: options.operationId,
        reused: false,
        serieNumeroFactura: generatedSerieNumeroFactura,
        insertedHeader: true,
        insertedItems: declaredInput.items.length,
        activated: true,
        status
      };
    } catch (error) {
      await rollbackQuietly(bizlinksTransaction);

      if (!greFcCommitted) {
        try {
          await recordFacturaErrorAndCommit(greFcTransaction, options.operationId, error, input, options);
          greFcCommitted = true;
        } catch {
          await rollbackQuietly(greFcTransaction);
        }
      }

      throw error;
    } finally {
      if (!greFcCommitted) {
        await rollbackQuietly(greFcTransaction);
      }
      await bizlinksPool.close();
      await greFcPool.close();
    }
  }

  async listFacturas(): Promise<FcFacturaStatusResult[]> {
    const greFcPool = createGreFcPool(this.config);
    const bizlinksPool = createBizlinksPool(this.config);

    await greFcPool.connect();
    await bizlinksPool.connect();

    try {
      const result = await new sql.Request(greFcPool).query<{
        operationId: string;
        serieNumeroFactura: string;
        creadoEn: Date | null;
        razonSocialCliente: string;
        numeroDocumentoCliente: string;
        estadoOperacion: string;
        estadoEnvio: string | null;
        mensajeEnvio: string | null;
        total: number | string;
        items: number;
      }>(`
        SELECT TOP (300)
          CONVERT(varchar(36), o.idOperacion) AS operationId,
          o.serieNumeroFactura,
          o.creadoEn,
          o.razonSocialCliente,
          o.numeroDocumentoCliente,
          CASE WHEN EXISTS (
            SELECT 1
            FROM dbo.FC_FACT_EVENTO cancellation
            WHERE cancellation.operacionId = o.id
              AND cancellation.tipo IN ('BAJA_ACEPTADA', 'BAJA_ADMINISTRATIVA')
          ) THEN 'ANULADA' ELSE o.estado END AS estadoOperacion,
          CASE WHEN EXISTS (
            SELECT 1
            FROM dbo.FC_FACT_EVENTO cancellation
            WHERE cancellation.operacionId = o.id
              AND cancellation.tipo IN ('BAJA_ACEPTADA', 'BAJA_ADMINISTRATIVA')
          ) THEN 'ANULADA' ELSE e.estado END AS estadoEnvio,
          MAX(CONVERT(nvarchar(4000), e.mensaje)) AS mensajeEnvio,
          o.total,
          COUNT(d.id) AS items
        FROM dbo.FC_FACT_OPERACION o
        LEFT JOIN dbo.FC_FACT_ENVIO e
          ON e.operacionId = o.id
        LEFT JOIN dbo.FC_FACT_DETALLE d
          ON d.operacionId = o.id
        WHERE o.serieNumeroFactura LIKE 'FF01-%'
          AND NOT EXISTS (
            SELECT 1
            FROM dbo.FC_FACT_EVENTO hidden
            WHERE hidden.operacionId = o.id
              AND hidden.tipo = 'OCULTO_REPORTE'
          )
        GROUP BY
          o.id,
          o.idOperacion,
          o.serieNumeroFactura,
          o.creadoEn,
          o.razonSocialCliente,
          o.numeroDocumentoCliente,
          o.estado,
          e.estado,
          o.total
        ORDER BY o.creadoEn DESC
      `);
      const statuses = await getFacturaBizlinksStatuses(bizlinksPool, result.recordset.map((row) => row.serieNumeroFactura));

      return result.recordset.map((row) => {
        const bizlinks = statuses.get(row.serieNumeroFactura);
        const pdfUrl = bizlinks?.pdfUrl?.trim() ?? '';

        return {
          operationId: row.operationId,
          serieNumeroFactura: row.serieNumeroFactura,
          creadoEn: row.creadoEn ? row.creadoEn.toISOString() : null,
          cliente: row.razonSocialCliente,
          numeroDocumentoCliente: row.numeroDocumentoCliente,
          estadoOperacion: row.estadoOperacion,
          estadoEnvio: row.estadoEnvio,
          estadoBizlinks: bizlinks?.estadoRegistro ?? null,
          estadoProceso: bizlinks?.estadoProceso ?? null,
          mensaje: bizlinks?.mensaje ?? row.mensajeEnvio ?? null,
          total: Number(row.total ?? 0),
          items: Number(row.items ?? 0),
          pdfDisponible: Boolean(pdfUrl && isAllowedBizlinksFileUrl(pdfUrl))
        };
      });
    } finally {
      await bizlinksPool.close();
      await greFcPool.close();
    }
  }

  async getFacturaPdf(serieNumeroFactura: string): Promise<PdfDelivery | null> {
    const greFcPool = createGreFcPool(this.config);
    const bizlinksPool = createBizlinksPool(this.config);

    await greFcPool.connect();
    await bizlinksPool.connect();

    try {
      const traceRequest = new sql.Request(greFcPool);
      traceRequest.input('serieNumeroFactura', sql.VarChar(13), serieNumeroFactura);
      const trace = await traceRequest.query<{ total: number }>(`
        SELECT COUNT(1) AS total
        FROM dbo.FC_FACT_OPERACION
        WHERE serieNumeroFactura = @serieNumeroFactura
      `);

      if ((trace.recordset[0]?.total ?? 0) !== 1) return null;

      const downloadedPdf = await getDownloadedPdf(bizlinksPool, this.config, '01', serieNumeroFactura);
      if (downloadedPdf) {
        return { kind: 'buffer', data: downloadedPdf };
      }

      const pdfRequest = new sql.Request(bizlinksPool);
      pdfRequest.input('serieNumeroFactura', sql.VarChar(13), serieNumeroFactura);
      const pdf = await pdfRequest.query<{ bl_url_pdf: string | null }>(`
        SELECT TOP (1)
          bl_url_pdf
        FROM dbo.SPE_EINVOICE_RESPONSE
        WHERE SERIENUMERO = @serieNumeroFactura
          AND TIPODOCUMENTO = '01'
      `);
      const url = pdf.recordset[0]?.bl_url_pdf?.trim();

      return url && isAllowedBizlinksFileUrl(url) ? { kind: 'url', url } : null;
    } finally {
      await bizlinksPool.close();
      await greFcPool.close();
    }
  }
}

async function findProcessedFacturaOperation(
  transaction: sql.Transaction,
  operationId: string
): Promise<ExistingFacturaEnvio | null> {
  const request = new sql.Request(transaction);
  request.input('operationId', sql.UniqueIdentifier, operationId);

  const result = await request.query<ExistingFacturaEnvio>(`
    SELECT TOP (1)
      o.id AS operacionDbId,
      e.id AS envioId,
      o.serieNumeroFactura,
      o.estado
    FROM dbo.FC_FACT_OPERACION o
    INNER JOIN dbo.FC_FACT_ENVIO e
      ON e.operacionId = o.id
    WHERE o.idOperacion = @operationId
      AND o.estado IN ('INSERTADO_BIZLINKS', 'ACTIVADO', 'ACEPTADA')
    ORDER BY o.id DESC
  `);

  return result.recordset[0] ?? null;
}

function assertInvoiceReadyForDeclaration(input: FcFacturaPreviewInput) {
  const validations = validatePreview(input);
  const blocking = validations.filter((item) =>
    item.severity === 'error'
    || item.code === 'PRECIOS_COMPLETOS' && item.severity !== 'ok'
    || item.code === 'TOTALES_POSITIVOS' && item.severity !== 'ok'
  );

  if (blocking.length > 0) {
    throw new Error(blocking.map((item) => item.message).join(' '));
  }
}

async function prepareFacturaOperation(
  transaction: sql.Transaction,
  input: FcFacturaPreviewInput,
  options: FcFacturaDeclareOptions,
  totals: ReturnType<typeof calculateTotals>
) {
  const created = await upsertFacturaOperation(transaction, input, options, totals);
  const envio = await upsertFacturaEnvioPreparando(transaction, created.operacionDbId);
  await insertFacturaEvent(transaction, created.operacionDbId, envio.envioId, 'PREPARANDO', 'Operacion de factura preparada antes de insertar en Bizlinks', {
    serieNumeroFactura: input.serie ? `${input.serie}-${input.numero}` : '',
    guias: input.guias.map((guide) => guide.serieNumeroGuia)
  });

  return {
    operacionDbId: created.operacionDbId,
    envioId: envio.envioId
  };
}

async function acquireFacturaGuideLocks(transaction: sql.Transaction, input: FcFacturaPreviewInput) {
  for (const guide of input.guias) {
    await acquireAppLock(transaction, `FC_FACT_GUIA:${guide.serieNumeroGuia}`);
  }
}

export async function assertGuidesNotAlreadyTraced(
  transaction: sql.Transaction,
  input: FcFacturaPreviewInput,
  bizlinksDatabase: string
) {
  const series = input.guias.map((guide) => guide.serieNumeroGuia);
  if (series.length === 0) return;

  const request = new sql.Request(transaction);
  const params = series.map((serie, index) => {
    const name = `serie${index}`;
    request.input(name, sql.VarChar(20), serie);
    return `@${name}`;
  });

  const result = await request.query<{ serieNumeroGuia: string; serieNumeroFactura: string; estado: string }>(`
    SELECT
      g.serieNumeroGuia,
      o.serieNumeroFactura,
      o.estado
    FROM dbo.FC_FACT_GUIA g
    INNER JOIN dbo.FC_FACT_OPERACION o
      ON o.id = g.operacionId
    -- The separate Bizlinks transaction writes this table next. Do not retain
    -- SERIALIZABLE range locks here; guide app locks protect the local trace.
    LEFT JOIN ${quoteIdentifier(bizlinksDatabase)}.dbo.SPE_EINVOICEHEADER h WITH (READCOMMITTED)
      ON h.SERIENUMERO COLLATE DATABASE_DEFAULT = o.serieNumeroFactura
     AND h.TIPODOCUMENTO = '01'
    WHERE g.serieNumeroGuia IN (${params.join(', ')})
      AND o.estado IN ('PREPARANDO', 'INSERTADO_BIZLINKS', 'ACTIVADO', 'ACEPTADA')
      AND ISNULL(h.bl_estadoRegistro, '') <> 'E'
      AND NOT EXISTS (
        SELECT 1
        FROM dbo.FC_FACT_EVENTO cancellation
        WHERE cancellation.operacionId = o.id
          AND cancellation.tipo IN ('BAJA_ACEPTADA', 'BAJA_ADMINISTRATIVA')
      )
  `);

  if (result.recordset.length > 0) {
    const guides = result.recordset
      .map((row) => `${row.serieNumeroGuia} (${row.serieNumeroFactura})`)
      .join(', ');

    throw new Error(`Una o mas guias ya tienen trazabilidad de facturacion: ${guides}`);
  }
}

async function assertFacturaGuideTraceSchema(transaction: sql.Transaction, input: FcFacturaPreviewInput) {
  const hasT999 = input.guias.some((guide) => guide.serieNumeroGuia.startsWith('T999-'));
  if (!hasT999) return;

  const result = await new sql.Request(transaction).query<{ definition: string | null }>(`
    SELECT definition
    FROM sys.check_constraints
    WHERE name = 'CK_FC_FACT_GUIA_serie'
      AND parent_object_id = OBJECT_ID(N'dbo.FC_FACT_GUIA');
  `);
  const definition = result.recordset[0]?.definition ?? '';

  if (!definition.includes('T999')) {
    throw new Error('La base GRE_FORMULARIOS_TEST aun no permite facturar guias T999. Aplique la migracion 005_allow_t999_fc_facturacion_guides.sql con un usuario SQL con permiso ALTER antes de declarar esta prueba.');
  }
}

async function upsertFacturaOperation(
  transaction: sql.Transaction,
  input: FcFacturaPreviewInput,
  options: FcFacturaDeclareOptions,
  totals: ReturnType<typeof calculateTotals>
) {
  const request = new sql.Request(transaction);
  request.input('idOperacion', sql.UniqueIdentifier, options.operationId);
  request.input('serie', sql.VarChar(4), input.serie);
  request.input('numero', sql.VarChar(8), input.numero);
  request.input('serieNumeroFactura', sql.VarChar(13), `${input.serie}-${input.numero}`);
  request.input('tipoDocumentoCliente', sql.VarChar(2), input.cliente.tipoDocumento);
  request.input('numeroDocumentoCliente', sql.VarChar(20), input.cliente.numeroDocumento);
  request.input('razonSocialCliente', sql.NVarChar(250), input.cliente.razonSocial);
  request.input('fechaEmision', sql.DateTime2, new Date(`${input.fechaEmision}T00:00:00-05:00`));
  request.input('fechaVencimiento', sql.DateTime2, effectiveDueDateAsDate(input));
  request.input('moneda', sql.VarChar(3), input.moneda);
  request.input('formaPago', sql.NVarChar(200), input.formaPago);
  request.input('cuenta', sql.VarChar(50), input.cuenta);
  request.input('ordenCompra', sql.NVarChar(2000), emptyToNull(input.ordenCompra));
  request.input('observaciones', sql.NVarChar(sql.MAX), emptyToNull(input.observaciones));
  request.input('gravada', sql.Decimal(18, 2), totals.gravada);
  request.input('igv', sql.Decimal(18, 2), totals.igv);
  request.input('total', sql.Decimal(18, 2), totals.total);
  request.input('usuario', sql.NVarChar(128), options.user ?? null);
  request.input('datosJson', sql.NVarChar(sql.MAX), JSON.stringify(input));

  const result = await request.query<{ operacionDbId: number }>(`
    IF NOT EXISTS (SELECT 1 FROM dbo.FC_FACT_OPERACION WHERE idOperacion = @idOperacion)
    BEGIN
      INSERT INTO dbo.FC_FACT_OPERACION (
        idOperacion,
        serie,
        numero,
        serieNumeroFactura,
        tipoDocumentoCliente,
        numeroDocumentoCliente,
        razonSocialCliente,
        fechaEmision,
        fechaVencimiento,
        moneda,
        formaPago,
        cuenta,
        ordenCompra,
        observaciones,
        gravada,
        igv,
        total,
        estado,
        usuario,
        datosJson
      )
      VALUES (
        @idOperacion,
        @serie,
        @numero,
        @serieNumeroFactura,
        @tipoDocumentoCliente,
        @numeroDocumentoCliente,
        @razonSocialCliente,
        @fechaEmision,
        @fechaVencimiento,
        @moneda,
        @formaPago,
        @cuenta,
        @ordenCompra,
        @observaciones,
        @gravada,
        @igv,
        @total,
        'PREPARANDO',
        @usuario,
        @datosJson
      );
    END;

    SELECT id AS operacionDbId
    FROM dbo.FC_FACT_OPERACION
    WHERE idOperacion = @idOperacion;
  `);

  return {
    operacionDbId: result.recordset[0]?.operacionDbId
  };
}

async function insertFacturaGuidesSnapshotIfEmpty(
  transaction: sql.Transaction,
  operacionDbId: number,
  input: FcFacturaPreviewInput,
  bizlinksDatabase: string
) {
  const existing = await new sql.Request(transaction)
    .input('operacionDbId', sql.BigInt, operacionDbId)
    .query<{ total: number }>(`
      SELECT COUNT(1) AS total
      FROM dbo.FC_FACT_GUIA
      WHERE operacionId = @operacionDbId
    `);

  if ((existing.recordset[0]?.total ?? 0) === 0) {
    for (const guide of input.guias) {
      const guideItems = input.items.filter((item) => item.serieNumeroGuia === guide.serieNumeroGuia);
      const totalGuia = roundMoney(guideItems.reduce((sum, item) => sum + lineTotal(item, input.tipoExclusionProducto), 0));
      await new sql.Request(transaction)
        .input('operacionDbId', sql.BigInt, operacionDbId)
        .input('serieNumeroGuia', sql.VarChar(20), guide.serieNumeroGuia)
        .input('totalGuia', sql.Decimal(18, 2), totalGuia)
        .query(`
          DECLARE @guiaId bigint,
                  @operacionAnteriorId bigint,
                  @facturaAnterior varchar(13),
                  @estadoBizlinks varchar(10),
                  @bajaAceptada bit = 0;

          SELECT
            @guiaId = g.id,
            @operacionAnteriorId = g.operacionId,
            @facturaAnterior = o.serieNumeroFactura,
            @estadoBizlinks = h.BL_ESTADOREGISTRO,
            @bajaAceptada = CASE WHEN EXISTS (
              SELECT 1
              FROM dbo.FC_FACT_EVENTO cancellation
              WHERE cancellation.operacionId = o.id
                AND cancellation.tipo IN ('BAJA_ACEPTADA', 'BAJA_ADMINISTRATIVA')
            ) THEN 1 ELSE 0 END
          FROM dbo.FC_FACT_GUIA g WITH (UPDLOCK, HOLDLOCK)
          INNER JOIN dbo.FC_FACT_OPERACION o ON o.id = g.operacionId
          LEFT JOIN ${quoteIdentifier(bizlinksDatabase)}.dbo.SPE_EINVOICEHEADER h WITH (READCOMMITTED)
            ON h.SERIENUMERO COLLATE DATABASE_DEFAULT = o.serieNumeroFactura
           AND h.TIPODOCUMENTO = '01'
          WHERE g.serieNumeroGuia = @serieNumeroGuia;

          IF @guiaId IS NULL
          BEGIN
            INSERT INTO dbo.FC_FACT_GUIA (operacionId, serieNumeroGuia, totalGuia)
            VALUES (@operacionDbId, @serieNumeroGuia, @totalGuia);
          END
          ELSE IF @operacionAnteriorId <> @operacionDbId
            AND (ISNULL(@estadoBizlinks, '') = 'E' OR @bajaAceptada = 1)
          BEGIN
            UPDATE dbo.FC_FACT_DETALLE
            SET operacionId = @operacionDbId
            WHERE guiaId = @guiaId;

            UPDATE dbo.FC_FACT_GUIA
            SET operacionId = @operacionDbId,
                totalGuia = @totalGuia
            WHERE id = @guiaId;
          END
          ELSE IF @operacionAnteriorId <> @operacionDbId
          BEGIN
            RAISERROR('La guia %s ya esta relacionada con la factura vigente %s.', 16, 1, @serieNumeroGuia, @facturaAnterior);
          END;
        `);
    }
  }

  const guides = await new sql.Request(transaction)
    .input('operacionDbId', sql.BigInt, operacionDbId)
    .query<{ id: number; serieNumeroGuia: string }>(`
      SELECT id, serieNumeroGuia
      FROM dbo.FC_FACT_GUIA
      WHERE operacionId = @operacionDbId
    `);

  return new Map(guides.recordset.map((row) => [row.serieNumeroGuia, row.id]));
}

async function insertFacturaDetailsSnapshotIfEmpty(
  transaction: sql.Transaction,
  operacionDbId: number,
  guides: Map<string, number>,
  input: FcFacturaPreviewInput
) {
  const existing = await new sql.Request(transaction)
    .input('operacionDbId', sql.BigInt, operacionDbId)
    .query<{ total: number }>(`
      SELECT COUNT(1) AS total
      FROM dbo.FC_FACT_DETALLE
      WHERE operacionId = @operacionDbId
    `);

  if ((existing.recordset[0]?.total ?? 0) > 0) return;

  for (const [index, item] of input.items.entries()) {
    const base = roundMoney(item.cantidad * item.precioUnitario);
    const affectoIgv = input.tipoExclusionProducto === 'GRAVADA';
    const igv = affectoIgv ? roundMoney(base * 0.18) : 0;
    const total = roundMoney(base + igv);

    await new sql.Request(transaction)
      .input('operacionDbId', sql.BigInt, operacionDbId)
      .input('guiaId', sql.BigInt, guides.get(item.serieNumeroGuia) ?? null)
      .input('numeroOrdenItem', sql.Int, index + 1)
      .input('codigoProducto', sql.VarChar(80), item.codigoProducto)
      .input('descripcion', sql.NVarChar(1700), item.descripcion)
      .input('cantidad', sql.Decimal(18, 6), item.cantidad)
      .input('unidadMedida', sql.VarChar(20), item.unidadMedida)
      .input('precioUnitario', sql.Decimal(18, 6), item.precioUnitario)
      .input('afectoIgv', sql.Bit, affectoIgv)
      .input('valorVenta', sql.Decimal(18, 2), base)
      .input('igv', sql.Decimal(18, 2), igv)
      .input('total', sql.Decimal(18, 2), total)
      .input('datosJson', sql.NVarChar(sql.MAX), JSON.stringify(item))
      .query(`
        INSERT INTO dbo.FC_FACT_DETALLE (
          operacionId,
          guiaId,
          numeroOrdenItem,
          codigoProducto,
          descripcion,
          cantidad,
          unidadMedida,
          precioUnitario,
          afectoIgv,
          valorVenta,
          igv,
          total,
          datosJson
        )
        VALUES (
          @operacionDbId,
          @guiaId,
          @numeroOrdenItem,
          @codigoProducto,
          @descripcion,
          @cantidad,
          @unidadMedida,
          @precioUnitario,
          @afectoIgv,
          @valorVenta,
          @igv,
          @total,
          @datosJson
        );
      `);
  }
}

async function upsertFacturaEnvioPreparando(transaction: sql.Transaction, operacionDbId: number) {
  const request = new sql.Request(transaction);
  request.input('operacionDbId', sql.BigInt, operacionDbId);

  const result = await request.query<{ envioId: number }>(`
    IF NOT EXISTS (SELECT 1 FROM dbo.FC_FACT_ENVIO WHERE operacionId = @operacionDbId)
    BEGIN
      INSERT INTO dbo.FC_FACT_ENVIO (
        operacionId,
        estado,
        intentos,
        mensaje
      )
      VALUES (
        @operacionDbId,
        'PREPARANDO',
        0,
        'Preparando factura FC para Bizlinks'
      );
    END;

    SELECT id AS envioId
    FROM dbo.FC_FACT_ENVIO
    WHERE operacionId = @operacionDbId;
  `);

  return {
    envioId: result.recordset[0]?.envioId
  };
}

async function markFacturaInsertedBizlinks(
  transaction: sql.Transaction,
  prepared: { operacionDbId: number; envioId: number },
  serieNumeroFactura: string,
  itemCount: number,
  status: FcFacturaProcedureExecutionStatus
) {
  const request = new sql.Request(transaction);
  request.input('operacionDbId', sql.BigInt, prepared.operacionDbId);
  request.input('envioId', sql.BigInt, prepared.envioId);
  request.input('serieNumeroFactura', sql.VarChar(13), serieNumeroFactura);
  request.input('mensaje', sql.NVarChar(sql.MAX), status.response ? JSON.stringify(status.response) : 'Factura enviada a Bizlinks');
  request.input('respuestaJson', sql.NVarChar(sql.MAX), JSON.stringify(status));

  await request.query(`
    UPDATE dbo.FC_FACT_OPERACION
    SET
      estado = 'ACTIVADO',
      actualizadoEn = SYSUTCDATETIME(),
      finalizadoEn = SYSUTCDATETIME()
    WHERE id = @operacionDbId;

    UPDATE dbo.FC_FACT_ENVIO
    SET
      estado = 'ACTIVADO',
      intentos = intentos + 1,
      mensaje = @mensaje,
      respuestaJson = @respuestaJson,
      actualizadoEn = SYSUTCDATETIME(),
      insertadoBizlinksEn = COALESCE(insertadoBizlinksEn, SYSUTCDATETIME()),
      enviadoBizlinksEn = COALESCE(enviadoBizlinksEn, SYSUTCDATETIME()),
      respuestaBizlinksEn = SYSUTCDATETIME()
    WHERE id = @envioId;
  `);

  await insertFacturaEvent(transaction, prepared.operacionDbId, prepared.envioId, 'ACTIVADO', 'Factura FC insertada y activada en Bizlinks', {
    serieNumeroFactura,
    itemCount,
    status
  });
}

async function syncLegacyFacturaCorrelativeAndRecord(
  config: AppConfig,
  greFcTransaction: sql.Transaction,
  prepared: { operacionDbId: number; envioId: number },
  serieNumeroFactura: string
) {
  try {
    const result = await syncLegacyFacturaCorrelative(config, serieNumeroFactura);
    await insertFacturaEvent(
      greFcTransaction,
      prepared.operacionDbId,
      prepared.envioId,
      'CORRELATIVO_LEGACY_SINCRONIZADO',
      'Correlativo FF01 sincronizado en YCHIDB3.tbTipoDocu para el facturador antiguo',
      result
    );
  } catch (error) {
    await insertFacturaEvent(
      greFcTransaction,
      prepared.operacionDbId,
      prepared.envioId,
      'CORRELATIVO_LEGACY_PENDIENTE',
      error instanceof Error ? error.message : String(error),
      { serieNumeroFactura }
    );
  }
}

async function syncLegacyFacturaCorrelative(config: AppConfig, serieNumeroFactura: string) {
  const [, numeroText = ''] = serieNumeroFactura.split('-');
  const numero = Number(numeroText);
  if (!Number.isInteger(numero) || numero <= 0) {
    throw new Error(`No se pudo sincronizar correlativo legacy para ${serieNumeroFactura}.`);
  }

  const ychiPool = createYchiPool(config);
  await ychiPool.connect();
  const transaction = new sql.Transaction(ychiPool);
  let committed = false;

  try {
    await transaction.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);
    await acquireAppLock(transaction, 'FC_FACTURA_LEGACY_CORRELATIVO_FF01');

    const request = new sql.Request(transaction);
    request.input('ff01Numero', sql.VarChar(8), String(numero).padStart(8, '0'));
    request.input('f01Numero', sql.VarChar(7), String(numero).padStart(7, '0'));
    request.input('numero', sql.Int, numero);
    await request.query(`
      UPDATE dbo.tbTipoDocu
      SET numero = @ff01Numero
      WHERE idTipoDocu = 42
        AND (
          ISNUMERIC(numero) = 0
          OR CAST(numero AS int) < @numero
        );

      UPDATE dbo.tbTipoDocu
      SET numero = @f01Numero
      WHERE idTipoDocu = 1
        AND (
          ISNUMERIC(numero) = 0
          OR CAST(numero AS int) < @numero
        );
    `);

    const state = await new sql.Request(transaction).query<{
      idTipoDocu: number;
      serie: string;
      numero: string;
    }>(`
      SELECT idTipoDocu, serie, numero
      FROM dbo.tbTipoDocu
      WHERE idTipoDocu IN (1, 42)
      ORDER BY idTipoDocu;
    `);

    await transaction.commit();
    committed = true;

    return {
      serieNumeroFactura,
      tbTipoDocu: state.recordset
    };
  } finally {
    if (!committed) await rollbackQuietly(transaction);
    await ychiPool.close();
  }
}

async function mirrorLegacyFacturaSalesRegisterAndRecord(
  config: AppConfig,
  greFcTransaction: sql.Transaction,
  prepared: { operacionDbId: number; envioId: number },
  serieNumeroFactura: string,
  input: FcFacturaPreviewInput,
  totals: ReturnType<typeof calculateTotalsByExclusion>
) {
  try {
    const result = await mirrorLegacyFacturaSalesRegister(
      config,
      greFcTransaction,
      serieNumeroFactura,
      input,
      totals
    );
    await insertFacturaEvent(
      greFcTransaction,
      prepared.operacionDbId,
      prepared.envioId,
      'REGISTRO_VENTAS_LEGACY_SINCRONIZADO',
      'Factura FF01 reflejada en YCHIDB3.tbDocumentos para el Registro de Ventas antiguo',
      result
    );
  } catch (error) {
    await insertFacturaEvent(
      greFcTransaction,
      prepared.operacionDbId,
      prepared.envioId,
      'REGISTRO_VENTAS_LEGACY_PENDIENTE',
      error instanceof Error ? error.message : String(error),
      { serieNumeroFactura }
    );
  }
}

async function mirrorLegacyFacturaSalesRegister(
  config: AppConfig,
  greFcTransaction: sql.Transaction,
  serieNumeroFactura: string,
  input: FcFacturaPreviewInput,
  totals: ReturnType<typeof calculateTotalsByExclusion>
) {
  const [, numeroText = ''] = serieNumeroFactura.split('-');
  const numero = Number(numeroText);
  if (!Number.isInteger(numero) || numero <= 0) {
    throw new Error(`No se pudo crear espejo legacy para ${serieNumeroFactura}.`);
  }

  const guideRows = await findLegacyGuideDocuments(greFcTransaction, input.guias.map((guide) => guide.serieNumeroGuia));
  const firstGuideDocument = guideRows.find((row) => row.idDocumentoYchiscom)?.idDocumentoYchiscom ?? 48;
  const guideLabel = input.guias.map((guide) => legacyGuideLabel(guide.serieNumeroGuia)).join(', ');
  const ychiPool = createYchiPool(config);
  await ychiPool.connect();
  const transaction = new sql.Transaction(ychiPool);
  let committed = false;

  try {
    await transaction.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);
    await acquireAppLock(transaction, 'FC_FACTURA_LEGACY_REGISTRO_VENTAS_FF01');

    const request = new sql.Request(transaction);
    request.input('legacyNumero', sql.VarChar(50), String(numero).padStart(7, '0'));
    request.input('ruc', sql.VarChar(20), input.cliente.numeroDocumento);
    request.input('formaPagoTexto', sql.VarChar(200), input.formaPago);
    request.input('serieNumeroFactura', sql.VarChar(13), serieNumeroFactura);
    request.input('idEmpleadoInput', sql.Int, input.vendedor.idEmpleado ?? null);
    request.input('descClieProvInput', sql.VarChar(100), input.cliente.razonSocial.slice(0, 100));
    request.input('monedaLegacy', sql.Char(1), input.moneda === 'USD' ? 'D' : 'S');
    request.input('tipoCambio', sql.Money, input.moneda === 'USD' ? Number(input.tipoCambio ?? 0) : 1);
    request.input('neto', sql.Money, totals.gravada);
    request.input('igv', sql.Money, totals.igv);
    request.input('total', sql.Money, totals.total);
    request.input('observaciones', sql.VarChar(750), legacyAmountLabel(totals.total, input.moneda));
    request.input('fechaEmision', sql.DateTime, new Date(`${input.fechaEmision}T00:00:00-05:00`));
    request.input('fechaVencimiento', sql.DateTime, effectiveDueDateAsDate(input));
    request.input('idDocumentoAnterior', sql.Int, firstGuideDocument);
    request.input('correo', sql.VarChar(50), (input.ordenCompra?.trim() ?? '').slice(0, 50));
    request.input('cuenta', sql.VarChar(50), input.cuenta);
    request.input('nguia', sql.VarChar(750), guideLabel.slice(0, 750));

    const result = await request.query<{
      idDocumento: number;
      idClieProv: number;
      formaPago: number;
      idDocumentoAnterior: number;
    }>(`
      IF EXISTS (
        SELECT 1
        FROM dbo.tbDocumentos WITH (UPDLOCK, HOLDLOCK)
        WHERE idTipoDocu = 1 AND SeriDocu = 'F01' AND NumeDocu = @legacyNumero
      )
      BEGIN
        SELECT TOP (1)
          idDocumento,
          idClieProv,
          formaPago,
          idDocumentoAnterior
        FROM dbo.tbDocumentos
        WHERE idTipoDocu = 1 AND SeriDocu = 'F01' AND NumeDocu = @legacyNumero;
        RETURN;
      END;

      IF @monedaLegacy = 'D' AND @tipoCambio <= 0
        THROW 51500, 'La factura USD no tiene tipo de cambio legacy valido.', 1;

      DECLARE @idClieProv int;
      SELECT TOP (1) @idClieProv = idClieProv
      FROM dbo.tbClieProv WITH (UPDLOCK, HOLDLOCK)
      WHERE RUC = @ruc
        AND tipoClieProv = 'C'
        AND Estado = 'A'
      ORDER BY CASE WHEN origen = 'Y' THEN 0 ELSE 1 END, idClieProv DESC;

      IF @idClieProv IS NULL
        THROW 51501, 'No existe cliente legacy activo para la factura.', 1;

      DECLARE @formaPago int;
      SELECT TOP (1) @formaPago = idPropiedades
      FROM dbo.tbPropiedades WITH (UPDLOCK, HOLDLOCK)
      WHERE tipo = 'FPAG'
        AND ISNULL(Valor, '') NOT LIKE '(obsoleto)%'
        AND ISNULL(Nombre, '') NOT LIKE '(obsoleto)%'
        AND (
          LTRIM(RTRIM(Nombre)) = @formaPagoTexto
          OR LTRIM(RTRIM(Valor)) = @formaPagoTexto
        )
      ORDER BY idPropiedades;

      IF @formaPago IS NULL
        THROW 51502, 'No existe forma de pago legacy para la factura.', 1;

      DECLARE @idEmpleado int = COALESCE(@idEmpleadoInput, (
        SELECT TOP (1) idempleado
        FROM dbo.tbClieProv
        WHERE idClieProv = @idClieProv
      ), 1);

      INSERT INTO dbo.tbDocumentos (
        idTipoDocu,
        idEmpleado,
        idClieProv,
        idUsuario,
        SeriDocu,
        NumeDocu,
        DescClieProv,
        formaPago,
        Encargado,
        Moneda,
        Tica,
        Neto,
        Igv,
        Total,
        Observaciones,
        FechaEmision,
        FechaCreacion,
        FechaVencimiento,
        idENV,
        Estado,
        EstaCotiza,
        idDocumentoAnterior,
        idTCOP,
        EstadoRecotiz,
        CORREO,
        cuenta,
        origen,
        negociable,
        web,
        intermediario,
        llevacomp,
        nguia
      )
      VALUES (
        1,
        @idEmpleado,
        @idClieProv,
        1,
        'F01',
        @legacyNumero,
        @descClieProvInput,
        @formaPago,
        '',
        @monedaLegacy,
        @tipoCambio,
        @neto,
        @igv,
        @total,
        @observaciones,
        @fechaEmision,
        GETDATE(),
        @fechaVencimiento,
        0,
        'A',
        'P',
        @idDocumentoAnterior,
        0,
        'N',
        @correo,
        @cuenta,
        'Y',
        'N',
        NULL,
        'N',
        CASE WHEN NULLIF(@correo, '') IS NULL THEN 'N' ELSE 'S' END,
        @nguia
      );

      SELECT TOP (1)
        idDocumento,
        idClieProv,
        formaPago,
        idDocumentoAnterior
      FROM dbo.tbDocumentos
      WHERE idTipoDocu = 1 AND SeriDocu = 'F01' AND NumeDocu = @legacyNumero;
    `);

    await transaction.commit();
    committed = true;

    return {
      serieNumeroFactura,
      legacySerieNumero: `F01-${String(numero).padStart(7, '0')}`,
      guideRows,
      tbDocumentos: result.recordset[0] ?? null
    };
  } finally {
    if (!committed) await rollbackQuietly(transaction);
    await ychiPool.close();
  }
}

async function findLegacyGuideDocuments(transaction: sql.Transaction, series: string[]) {
  if (series.length === 0) return [];

  const request = new sql.Request(transaction);
  const params = series.map((serie, index) => {
    const name = `serie${index}`;
    request.input(name, sql.VarChar(20), serie);
    return `@${name}`;
  });

  const result = await request.query<{
    serieNumeroGuia: string;
    idDocumentoYchiscom: number | null;
    numeroGuiaFisica: string | null;
  }>(`
    SELECT e.serieNumeroGuia, o.idDocumentoYchiscom, o.numeroGuiaFisica
    FROM dbo.GRE_FC_ENVIO e
    INNER JOIN dbo.GRE_FC_OPERACION o ON o.id = e.operacionId
    WHERE e.serieNumeroGuia IN (${params.join(', ')})
  `);

  return result.recordset;
}

async function recordFacturaErrorAndCommit(
  transaction: sql.Transaction,
  operationId: string,
  error: unknown,
  input: FcFacturaPreviewInput,
  options: FcFacturaDeclareOptions
) {
  const message = error instanceof Error ? error.message : String(error);
  const totals = calculateTotalsByExclusion(input.items, input.tipoExclusionProducto);
  const request = new sql.Request(transaction);
  request.input('operationId', sql.UniqueIdentifier, operationId);
  request.input('message', sql.NVarChar(sql.MAX), message);
  request.input('serie', sql.VarChar(4), input.serie);
  request.input('numero', sql.VarChar(8), input.numero);
  request.input('serieNumeroFactura', sql.VarChar(13), `${input.serie}-${input.numero}`);
  request.input('tipoDocumentoCliente', sql.VarChar(2), input.cliente.tipoDocumento);
  request.input('numeroDocumentoCliente', sql.VarChar(20), input.cliente.numeroDocumento);
  request.input('razonSocialCliente', sql.NVarChar(250), input.cliente.razonSocial);
  request.input('fechaEmision', sql.DateTime2, new Date(`${input.fechaEmision}T00:00:00-05:00`));
  request.input('fechaVencimiento', sql.DateTime2, effectiveDueDateAsDate(input));
  request.input('moneda', sql.VarChar(3), input.moneda);
  request.input('formaPago', sql.NVarChar(200), input.formaPago);
  request.input('cuenta', sql.VarChar(50), input.cuenta);
  request.input('ordenCompra', sql.NVarChar(2000), emptyToNull(input.ordenCompra));
  request.input('observaciones', sql.NVarChar(sql.MAX), emptyToNull(input.observaciones));
  request.input('gravada', sql.Decimal(18, 2), totals.gravada);
  request.input('igv', sql.Decimal(18, 2), totals.igv);
  request.input('total', sql.Decimal(18, 2), totals.total);
  request.input('usuario', sql.NVarChar(128), options.user ?? null);
  request.input('datosJson', sql.NVarChar(sql.MAX), JSON.stringify(input));

  await request.query(`
    DECLARE @operacionId bigint = (
      SELECT TOP (1) id
      FROM dbo.FC_FACT_OPERACION
      WHERE idOperacion = @operationId
      ORDER BY id DESC
    );

    IF @operacionId IS NULL
    BEGIN
      INSERT INTO dbo.FC_FACT_OPERACION (
        idOperacion,
        serie,
        numero,
        serieNumeroFactura,
        tipoDocumentoCliente,
        numeroDocumentoCliente,
        razonSocialCliente,
        fechaEmision,
        fechaVencimiento,
        moneda,
        formaPago,
        cuenta,
        ordenCompra,
        observaciones,
        gravada,
        igv,
        total,
        estado,
        usuario,
        datosJson
      )
      VALUES (
        @operationId,
        @serie,
        @numero,
        @serieNumeroFactura,
        @tipoDocumentoCliente,
        @numeroDocumentoCliente,
        @razonSocialCliente,
        @fechaEmision,
        @fechaVencimiento,
        @moneda,
        @formaPago,
        @cuenta,
        @ordenCompra,
        @observaciones,
        @gravada,
        @igv,
        @total,
        'ERROR',
        @usuario,
        @datosJson
      );

      SET @operacionId = SCOPE_IDENTITY();
    END;

    DECLARE @envioId bigint = (
      SELECT TOP (1) id
      FROM dbo.FC_FACT_ENVIO
      WHERE operacionId = @operacionId
      ORDER BY id DESC
    );

    IF @envioId IS NULL
    BEGIN
      INSERT INTO dbo.FC_FACT_ENVIO (
        operacionId,
        estado,
        intentos,
        mensaje
      )
      VALUES (
        @operacionId,
        'ERROR',
        0,
        @message
      );

      SET @envioId = SCOPE_IDENTITY();
    END;

    UPDATE dbo.FC_FACT_OPERACION
    SET estado = 'ERROR', actualizadoEn = SYSUTCDATETIME()
    WHERE id = @operacionId;

    UPDATE dbo.FC_FACT_ENVIO
    SET estado = 'ERROR', mensaje = @message, actualizadoEn = SYSUTCDATETIME()
    WHERE id = @envioId;

    INSERT INTO dbo.FC_FACT_EVENTO (
      operacionId,
      envioId,
      tipo,
      mensaje
    )
    VALUES (
      @operacionId,
      @envioId,
      'ERROR',
      @message
    );
  `);

  await transaction.commit();
}

async function insertFacturaEvent(
  transaction: sql.Transaction,
  operacionId: number | null,
  envioId: number | null,
  tipo: string,
  mensaje: string,
  datos?: unknown
) {
  await new sql.Request(transaction)
    .input('operacionId', sql.BigInt, operacionId)
    .input('envioId', sql.BigInt, envioId)
    .input('tipo', sql.VarChar(60), tipo)
    .input('mensaje', sql.NVarChar(sql.MAX), mensaje)
    .input('datosJson', sql.NVarChar(sql.MAX), datos === undefined ? null : JSON.stringify(datos))
    .query(`
      INSERT INTO dbo.FC_FACT_EVENTO (
        operacionId,
        envioId,
        tipo,
        mensaje,
        datosJson
      )
      VALUES (
        @operacionId,
        @envioId,
        @tipo,
        @mensaje,
        @datosJson
      );
    `);
}

async function nextFacturaNumber(
  bizlinksSource: sql.ConnectionPool | sql.Transaction
) {
  const bizlinksRequest = createRequest(bizlinksSource);
  bizlinksRequest.input('seriePrefix', sql.VarChar(8), `${FC_FACTURA_SERIE}-%`);

  const bizlinks = await bizlinksRequest.query<{
    serieNumero: string;
    estadoRegistro: string | null;
  }>(`
    SELECT SERIENUMERO AS serieNumero, BL_ESTADOREGISTRO AS estadoRegistro
    FROM dbo.SPE_EINVOICEHEADER
    WHERE SERIENUMERO LIKE @seriePrefix
      AND TIPODOCUMENTO = '01'
      AND ISNUMERIC(RIGHT(SERIENUMERO, 8)) = 1
  `);

  return nextAvailableFacturaNumber(bizlinks.recordset);
}

export function nextAvailableFacturaNumber(
  rows: Array<{ serieNumero: string; estadoRegistro: string | null }>
) {
  const occupied = new Set<number>();
  let lastValid = 0;

  for (const row of rows) {
    const number = Number(row.serieNumero.slice(-8));
    if (!Number.isInteger(number) || number <= 0) continue;
    occupied.add(number);
    if ((row.estadoRegistro ?? '').trim().toUpperCase() !== 'E') {
      lastValid = Math.max(lastValid, number);
    }
  }

  let candidate = lastValid + 1;
  while (occupied.has(candidate)) candidate += 1;
  return candidate;
}

async function nextFacturaSerie(transaction: sql.Transaction) {
  const nextNumber = await nextFacturaNumber(transaction);

  if (!nextNumber || nextNumber < 1) {
    throw new Error(`No se pudo generar correlativo ${FC_FACTURA_SERIE}`);
  }

  return `${FC_FACTURA_SERIE}-${String(nextNumber).padStart(8, '0')}`;
}

async function assertFacturaSerieDoesNotExist(transaction: sql.Transaction, serieNumeroFactura: string) {
  const request = new sql.Request(transaction);
  request.input('serieNumeroFactura', sql.VarChar(13), serieNumeroFactura);

  const result = await request.query<{ total: number }>(`
    SELECT COUNT(1) AS total
    FROM dbo.SPE_EINVOICEHEADER
    WHERE SERIENUMERO = @serieNumeroFactura
      AND TIPODOCUMENTO = '01'
  `);

  if ((result.recordset[0]?.total ?? 0) > 0) {
    throw new Error(`La factura ${serieNumeroFactura} ya existe en Bizlinks`);
  }
}

async function insertGuideInvoiceLinks(
  transaction: sql.Transaction,
  input: FcFacturaPreviewInput,
  numeroDocumentoEmisor: string
) {
  const serieNumeroFactura = `${input.serie}-${input.numero}`;

  for (const guide of input.guias) {
    await new sql.Request(transaction)
      .input('rucEmisor', sql.VarChar(20), numeroDocumentoEmisor)
      .input('serieNumeroGuia', sql.VarChar(20), guide.serieNumeroGuia)
      .input('serieNumeroFactura', sql.VarChar(13), serieNumeroFactura)
      .input('fechaEmision', sql.DateTime2, new Date(`${input.fechaEmision}T00:00:00-05:00`))
      .query(`
        IF NOT EXISTS (
          SELECT 1
          FROM dbo.AAA_GUIAFACTURADA
          WHERE NRO_GUIA = @serieNumeroGuia
            AND NRO_FACTURA = @serieNumeroFactura
        )
        BEGIN
          INSERT INTO dbo.AAA_GUIAFACTURADA (
            RUC_EMISOR,
            NRO_GUIA,
            NRO_FACTURA,
            FECHA_EMISION,
            USUARIO,
            ESTADO
          )
          VALUES (
            @rucEmisor,
            @serieNumeroGuia,
            @serieNumeroFactura,
            @fechaEmision,
            0,
            'FACTURADO'
          );
        END;
      `);
  }
}

async function queryFacturaProcedureStatus(
  poolOrTransaction: sql.ConnectionPool | sql.Transaction,
  serieNumeroFactura: string
): Promise<FcFacturaProcedureExecutionStatus> {
  const headerRequest = createRequest(poolOrTransaction);
  headerRequest.input('serieNumeroFactura', sql.VarChar(13), serieNumeroFactura);
  const header = await headerRequest.query<Record<string, unknown>>(`
    SELECT TOP (1) *
    FROM dbo.SPE_EINVOICEHEADER
    WHERE SERIENUMERO = @serieNumeroFactura
      AND TIPODOCUMENTO = '01'
  `);

  const responseRequest = createRequest(poolOrTransaction);
  responseRequest.input('serieNumeroFactura', sql.VarChar(13), serieNumeroFactura);
  const response = await responseRequest.query<Record<string, unknown>>(`
    SELECT TOP (1) *
    FROM dbo.SPE_EINVOICE_RESPONSE
    WHERE SERIENUMERO = @serieNumeroFactura
      AND TIPODOCUMENTO = '01'
  `);

  const countRequest = createRequest(poolOrTransaction);
  countRequest.input('serieNumeroFactura', sql.VarChar(13), serieNumeroFactura);
  const counts = await countRequest.query<{ itemCount: number; responseCount: number }>(`
    SELECT
      (SELECT COUNT(1) FROM dbo.SPE_EINVOICEDETAIL WHERE SERIENUMERO = @serieNumeroFactura AND TIPODOCUMENTO = '01') AS itemCount,
      (SELECT COUNT(1) FROM dbo.SPE_EINVOICE_RESPONSE WHERE SERIENUMERO = @serieNumeroFactura AND TIPODOCUMENTO = '01') AS responseCount
  `);

  return {
    header: header.recordset[0] ?? null,
    response: response.recordset[0] ?? null,
    headerCount: header.recordset.length,
    itemCount: counts.recordset[0]?.itemCount ?? 0,
    responseCount: counts.recordset[0]?.responseCount ?? 0
  };
}

function assertFacturaInserted(status: FcFacturaProcedureExecutionStatus, serieNumeroFactura: string, expectedItems: number) {
  if (status.headerCount !== 1) {
    throw new Error(`Se esperaba exactamente un encabezado para ${serieNumeroFactura}; encontrados ${status.headerCount}`);
  }

  if (status.itemCount !== expectedItems) {
    throw new Error(`Se esperaban ${expectedItems} items FE para ${serieNumeroFactura}; encontrados ${status.itemCount}`);
  }

  const estado = String(status.header?.BL_ESTADOREGISTRO ?? status.header?.bl_estadoRegistro ?? '');
  if (!['A', 'L', 'N'].includes(estado)) {
    throw new Error(`Estado Bizlinks inesperado para ${serieNumeroFactura}: ${estado || 'NULL'}`);
  }
}

async function getFacturaBizlinksStatuses(pool: sql.ConnectionPool, series: string[]) {
  const statuses = new Map<string, {
    estadoRegistro: string | null;
    estadoProceso: string | null;
    mensaje: string | null;
    pdfUrl: string | null;
  }>();
  if (series.length === 0) return statuses;

  const request = new sql.Request(pool);
  const params = series.map((serie, index) => {
    const name = `factSerie${index}`;
    request.input(name, sql.VarChar(13), serie);
    return `@${name}`;
  });

  const result = await request.query<{
    SERIENUMERO: string;
    bl_estadoRegistro: string | null;
    bl_estadoProceso: string | null;
    process_state: string | null;
    bl_mensaje: string | null;
    bl_mensajeSunat: string | null;
    bl_url_pdf: string | null;
  }>(`
    SELECT
      h.SERIENUMERO,
      h.BL_ESTADOREGISTRO AS bl_estadoRegistro,
      r.bl_estadoProceso,
      r.process_state,
      COALESCE(NULLIF(r.bl_mensaje, ''), err.mensaje) AS bl_mensaje,
      r.bl_mensajeSunat,
      r.bl_url_pdf
    FROM dbo.SPE_EINVOICEHEADER h
    LEFT JOIN dbo.SPE_EINVOICE_RESPONSE r
      ON r.NUMERODOCUMENTOEMISOR = h.NUMERODOCUMENTOEMISOR
     AND r.SERIENUMERO = h.SERIENUMERO
     AND r.TIPODOCUMENTO = h.TIPODOCUMENTO
    OUTER APPLY (
      SELECT TOP (1)
        CONVERT(nvarchar(30), l.CODIGOERROR) + ': ' + l.DESCRIPCIONERROR AS mensaje
      FROM dbo.SPE_ERROR_LOG l
      WHERE l.NUMERODOCUMENTOEMISOR = h.NUMERODOCUMENTOEMISOR
        AND l.SERIENUMERO = h.SERIENUMERO
        AND l.TIPODOCUMENTO = h.TIPODOCUMENTO
        AND h.BL_ESTADOREGISTRO = 'E'
      ORDER BY l.FECHAREGISTRO DESC
    ) err
    WHERE h.SERIENUMERO IN (${params.join(', ')})
      AND h.TIPODOCUMENTO = '01'
  `);

  for (const row of result.recordset) {
    statuses.set(row.SERIENUMERO, {
      estadoRegistro: row.bl_estadoRegistro,
      estadoProceso: row.bl_estadoProceso ?? row.process_state,
      mensaje: row.bl_mensajeSunat ?? row.bl_mensaje,
      pdfUrl: row.bl_url_pdf
    });
  }

  return statuses;
}

async function executeStoredProcedure(transaction: sql.Transaction, procedureName: string, params: StoredProcedureParam[]) {
  const request = new sql.Request(transaction);

  for (const param of params) {
    request.input(param.name, sql.NVarChar, param.value);
  }

  try {
    await request.execute(procedureName);
  } catch (error) {
    if (error instanceof Error) error.message = `${procedureName}: ${error.message}`;
    throw error;
  }
}

async function acquireAppLock(transaction: sql.Transaction, resource: string) {
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
  const lockResult = result.recordset[0]?.lockResult ?? -999;

  if (lockResult < 0) {
    throw new Error(`No se pudo obtener bloqueo SQL para ${resource}`);
  }
}

function createRequest(poolOrTransaction: sql.ConnectionPool | sql.Transaction) {
  if ('commit' in poolOrTransaction) {
    return new sql.Request(poolOrTransaction);
  }

  return new sql.Request(poolOrTransaction);
}

async function rollbackQuietly(transaction?: sql.Transaction) {
  if (!transaction) return;

  try {
    await transaction.rollback();
  } catch {
    // The original error is more useful than a secondary rollback failure.
  }
}

async function assertFacturaPaymentTerms(
  transaction: sql.Transaction,
  input: FcFacturaPreviewInput,
  totals: ReturnType<typeof calculateTotalsByExclusion>,
  numeroDocumentoEmisor: string
) {
  if (input.diasPago <= 0) return;

  const expected = calculateFinancialSummary(input, totals).netoPendiente;
  const request = new sql.Request(transaction);
  request.input('numeroDocumentoEmisor', sql.NVarChar(20), numeroDocumentoEmisor);
  request.input('serieNumero', sql.NVarChar(13), `${input.serie}-${input.numero}`);
  const result = await request.query<{
    montoNetoPendiente: string | null;
    totalCuotas: number | string | null;
  }>(`
    SELECT
      MAX(CASE WHEN clave = 'montoNetoPendiente' THEN valor END) AS montoNetoPendiente,
      SUM(CASE WHEN clave LIKE 'montoPagoCuota%'
        THEN CONVERT(decimal(18, 2), valor)
        ELSE CONVERT(decimal(18, 2), 0)
      END) AS totalCuotas
    FROM dbo.SPE_EINVOICEHEADER_ADD
    WHERE NUMERODOCUMENTOEMISOR = @numeroDocumentoEmisor
      AND SERIENUMERO = @serieNumero
      AND TIPODOCUMENTO = '01';
  `);
  const persistedNet = Number(result.recordset[0]?.montoNetoPendiente ?? 0);
  const quotaTotal = Number(result.recordset[0]?.totalCuotas ?? 0);

  if (
    Math.abs(persistedNet - expected) > 0.001
    || Math.abs(quotaTotal - expected) > 0.001
    || persistedNet > totals.total
    || quotaTotal > totals.total
  ) {
    throw new Error(
      `Cuotas Bizlinks inconsistentes antes de activar: total=${totalsLabel(totals.total)}, `
      + `neto=${totalsLabel(persistedNet)}, cuotas=${totalsLabel(quotaTotal)}, esperado=${totalsLabel(expected)}.`
    );
  }
}

async function updateFacturaLegacyPrintHeaderFields(
  transaction: sql.Transaction,
  input: FcFacturaPreviewInput,
  totals: ReturnType<typeof calculateTotalsByExclusion>,
  serieNumeroFactura: string,
  numeroDocumentoEmisor: string
) {
  const request = new sql.Request(transaction);
  request.input('numeroDocumentoEmisor', sql.NVarChar(20), numeroDocumentoEmisor);
  request.input('serieNumero', sql.NVarChar(13), serieNumeroFactura);
  request.input('textoLeyenda1', sql.NVarChar(200), invoiceAmountInWords(totals.total, input.moneda));
  request.input('codigoAuxiliar1001', sql.NVarChar(4), '9415');
  request.input('textoAuxiliar1001', sql.NVarChar(100), normalizeLegacyPaymentTerm(input.formaPago));
  request.input('codigoAuxiliar402', sql.NVarChar(4), '9999');
  request.input('textoAuxiliar402', sql.NVarChar(40), legacyPrintExchangeRate(input));
  request.input('codigoAuxiliar403', sql.NVarChar(4), '9998');
  request.input('textoAuxiliar403', sql.NVarChar(1), input.tipoDetraccion === '000' ? 'N' : 'S');

  const result = await request.query<{ affectedRows: number }>(`
    UPDATE dbo.SPE_EINVOICEHEADER
    SET textoLeyenda_1 = @textoLeyenda1,
        codigoAuxiliar100_1 = @codigoAuxiliar1001,
        textoAuxiliar100_1 = @textoAuxiliar1001,
        codigoAuxiliar40_2 = @codigoAuxiliar402,
        textoAuxiliar40_2 = @textoAuxiliar402,
        codigoAuxiliar40_3 = @codigoAuxiliar403,
        textoAuxiliar40_3 = @textoAuxiliar403
    WHERE NUMERODOCUMENTOEMISOR = @numeroDocumentoEmisor
      AND SERIENUMERO = @serieNumero
      AND TIPODOCUMENTO = '01';

    SELECT @@ROWCOUNT AS affectedRows;
  `);

  if (Number(result.recordset[0]?.affectedRows ?? 0) !== 1) {
    throw new Error(`No se pudieron completar los campos de impresion legacy para ${serieNumeroFactura}.`);
  }
}

async function assertFacturaPrintAddons(
  transaction: sql.Transaction,
  serieNumeroFactura: string,
  numeroDocumentoEmisor: string
) {
  const required = [
    'departamentoAdquiriente',
    'direccionAdquiriente',
    'distritoAdquiriente',
    'paisAdquiriente',
    'provinciaAdquiriente',
    'ubigeoAdquiriente',
    'urbanizacionAdquiriente',
    'ordenCompra',
    'fechaVencimiento'
  ];
  const request = new sql.Request(transaction);
  request.input('numeroDocumentoEmisor', sql.NVarChar(20), numeroDocumentoEmisor);
  request.input('serieNumero', sql.NVarChar(13), serieNumeroFactura);
  const values = required.map((clave, index) => {
    const name = `addon${index}`;
    request.input(name, sql.NVarChar(80), clave);
    return `(@${name})`;
  });

  const result = await request.query<{ clave: string; total: number }>(`
    SELECT expected.clave,
      COUNT(addon.clave) AS total
    FROM (VALUES ${values.join(', ')}) expected(clave)
    LEFT JOIN dbo.SPE_EINVOICEHEADER_ADD addon
      ON addon.NUMERODOCUMENTOEMISOR = @numeroDocumentoEmisor
     AND addon.SERIENUMERO = @serieNumero
     AND addon.TIPODOCUMENTO = '01'
     AND addon.clave = expected.clave
    GROUP BY expected.clave
    HAVING COUNT(addon.clave) = 0;
  `);

  if (result.recordset.length > 0) {
    throw new Error(
      `Faltan datos para representacion impresa FF01: ${
        result.recordset.map((row) => row.clave).join(', ')
      }.`
    );
  }
}

async function resolveInvoiceExchangeRate(config: AppConfig, input: FcFacturaPreviewInput): Promise<FcFacturaPreviewInput> {
  if (input.moneda === 'PEN') {
    return { ...input, tipoCambio: 1 };
  }

  const ychiPool = createYchiPool(config);
  await ychiPool.connect();

  try {
    const request = new sql.Request(ychiPool);
    request.input('fecha', sql.DateTime, new Date(`${input.fechaEmision}T00:00:00-05:00`));
    const result = await request.query<{ tipoCambio: number | string | null }>(`
      SELECT CONVERT(decimal(10, 3), venta) AS tipoCambio
      FROM dbo.TBTICA
      WHERE IDMONEDA = 'D'
        AND CONVERT(date, fecha) = CONVERT(date, @fecha);
    `);
    const tipoCambio = Number(result.recordset[0]?.tipoCambio ?? 0);

    if (!Number.isFinite(tipoCambio) || tipoCambio <= 0) {
      throw new Error(`No existe tipo de cambio de venta para ${input.fechaEmision}. Registre el tipo de cambio en Ychiscom antes de emitir en dolares.`);
    }

    return { ...input, tipoCambio };
  } finally {
    await ychiPool.close();
  }
}

function effectiveDueDateAsDate(input: Pick<FcFacturaPreviewInput, 'fechaEmision' | 'fechaVencimiento' | 'diasPago'>) {
  return new Date(`${effectiveDueDate(input)}T00:00:00-05:00`);
}

function lineTotal(item: FcFacturaPreviewInput['items'][number], tipoExclusionProducto: FcFacturaPreviewInput['tipoExclusionProducto'] = 'GRAVADA') {
  const base = item.cantidad * item.precioUnitario;
  return roundMoney(base + (tipoExclusionProducto === 'GRAVADA' ? base * 0.18 : 0));
}

function emptyToNull(value: string | null | undefined) {
  const trimmed = value?.trim() ?? '';

  return trimmed ? trimmed : null;
}

function isAllowedBizlinksFileUrl(value: string) {
  try {
    const url = new URL(value);

    return url.protocol === 'https:' && url.hostname.toLowerCase() === 'sfeintegrador.bizlinks.com.pe';
  } catch {
    return false;
  }
}

async function listOfficialInvoiceAccounts(pool: sql.ConnectionPool, warnings: string[]) {
  try {
    const result = await new sql.Request(pool).query<{
      cuenta: number | string;
      denominacion: string | null;
      tipo: string | null;
      giro: string | null;
      orden: number | null;
      }>(`
        SELECT TOP (120)
          cuenta,
          denominacion,
          tipo,
          giro,
          orden
        FROM dbo.View_CuentasFactura
        WHERE tipo = 'FA'
          AND LTRIM(RTRIM(giro)) = 'O'
        ORDER BY orden, cuenta
      `);

    return result.recordset.map((row) => {
      const cuenta = String(row.cuenta).trim();
      const denominacion = row.denominacion?.trim() || `Cuenta ${cuenta}`;

      return {
        id: cuenta,
        cuenta,
        denominacion,
        label: `${denominacion}-${cuenta}`,
        fuente: 'VIEW_CUENTAS_FACTURA' as const
      };
    });
  } catch (error) {
    warnings.push(readPermissionWarning('View_CuentasFactura', error));
    return [];
  }
}

async function listHistoricalInvoiceAccounts(pool: sql.ConnectionPool, warnings: string[]) {
  try {
    const result = await new sql.Request(pool).query<{
      cuenta: string | null;
      total: number;
      ultimaFecha: Date | null;
    }>(`
      SELECT TOP (50)
        LTRIM(RTRIM(CONVERT(varchar(80), cuenta))) AS cuenta,
        COUNT(*) AS total,
        MAX(FechaEmision) AS ultimaFecha
      FROM dbo.tbDocumentos
      WHERE idTipoDocu = 1
        AND SeriDocu IN ('F01', 'FF01', 'FF03', 'FC01', 'FC03')
        AND cuenta IS NOT NULL
        AND LTRIM(RTRIM(CONVERT(varchar(80), cuenta))) <> ''
      GROUP BY LTRIM(RTRIM(CONVERT(varchar(80), cuenta)))
      ORDER BY MAX(FechaEmision) DESC, COUNT(*) DESC
    `);

    warnings.push('Catalogo de cuentas cargado desde historico tbDocumentos.cuenta porque la vista oficial no tiene permiso SELECT.');

    return result.recordset
      .map((row) => row.cuenta?.trim() ?? '')
      .filter(Boolean)
      .map((cuenta) => ({
        id: cuenta,
        cuenta,
        denominacion: `Cuenta historica factura FC ${cuenta}`,
        label: `Cuenta historica factura FC-${cuenta}`,
        fuente: 'HISTORICO_TBDOCUMENTOS' as const
      }));
  } catch (error) {
    warnings.push(readPermissionWarning('tbDocumentos.cuenta', error));
    return [];
  }
}

function listDefaultFcOffsetAccounts(warnings: string[]): FcFacturaCuenta[] {
  warnings.push('Catalogo de cuentas FC cargado desde defaults OFFSET porque View_CuentasFactura no devolvio datos disponibles.');

  return [
    { cuenta: '7022111', denominacion: 'PRODUCTOS TERMINADOS - OFFSET' },
    { cuenta: '7032112', denominacion: 'SERV ENVIO DE MERCADERIA - OFFSET' },
    { cuenta: '7032113', denominacion: 'OTROS SERVICIOS PRESTADOS OFFSET' },
    { cuenta: '7032111', denominacion: 'SERVICIO EXPRESS - OFFSET' },
    { cuenta: '7564111', denominacion: 'VENTA MAQUINAS Y EQUIPO OFFSET' },
    { cuenta: '7012111', denominacion: 'MERCADERIA - OFFSET' },
    { cuenta: '7793111', denominacion: 'OTROS INGRESOS FINANCIEROS OFFSET' }
  ].map((item) => ({
    id: item.cuenta,
    cuenta: item.cuenta,
    denominacion: item.denominacion,
    label: `${item.denominacion}-${item.cuenta}`,
    fuente: 'FC_OFFSET_DEFAULT' as const
  }));
}

async function findCustomerFiscalAddresses(
  pool: sql.ConnectionPool,
  ychiPool: sql.ConnectionPool,
  customerDocuments: string[]
): Promise<Map<string, FcFacturaDireccionFiscal>> {
  const documents = [...new Set(customerDocuments.map((item) => item.trim()).filter(Boolean))];
  const addresses = new Map<string, FcFacturaDireccionFiscal>();
  if (documents.length === 0) return addresses;

  const request = new sql.Request(pool);
  const values = documents.map((document, index) => {
    const name = `fiscalDocument${index}`;
    request.input(name, sql.VarChar(20), document);
    return `(@${name})`;
  });

  const result = await request.query<{
    numeroDocumento: string;
    direccion: string | null;
    ubigeo: string | null;
    distrito: string | null;
    provincia: string | null;
    departamento: string | null;
    pais: string | null;
    fuente: 'AAA_ADQUIRIENTE' | 'FACTURA_ACEPTADA' | null;
  }>(`
    WITH requested(numeroDocumento) AS (
      SELECT numeroDocumento FROM (VALUES ${values.join(', ')}) source(numeroDocumento)
    )
    SELECT requested.numeroDocumento,
      COALESCE(repository.direccion, history.direccion) AS direccion,
      COALESCE(repository.ubigeo, history.ubigeo) AS ubigeo,
      COALESCE(repository.distrito, history.distrito) AS distrito,
      COALESCE(repository.provincia, history.provincia) AS provincia,
      COALESCE(repository.departamento, history.departamento) AS departamento,
      COALESCE(repository.pais, history.pais, 'PE') AS pais,
      CASE
        WHEN repository.direccion IS NOT NULL THEN 'AAA_ADQUIRIENTE'
        WHEN history.direccion IS NOT NULL THEN 'FACTURA_ACEPTADA'
        ELSE NULL
      END AS fuente
    FROM requested
    OUTER APPLY (
      SELECT TOP (1)
        NULLIF(NULLIF(LTRIM(RTRIM(a.DIRECCIONADQUIRIENTE)), ''), '-') AS direccion,
        NULLIF(NULLIF(LTRIM(RTRIM(a.UBIGEOADQUIRIENTE)), ''), '-') AS ubigeo,
        NULLIF(NULLIF(LTRIM(RTRIM(a.DISTRITOADQUIRIENTE)), ''), '-') AS distrito,
        NULLIF(NULLIF(LTRIM(RTRIM(a.PROVINCIAADQUIRIENTE)), ''), '-') AS provincia,
        NULLIF(NULLIF(LTRIM(RTRIM(a.DEPARTAMENTOADQUIRIENTE)), ''), '-') AS departamento,
        COALESCE(NULLIF(NULLIF(LTRIM(RTRIM(a.PAISADQUIRIENTE)), ''), '-'), 'PE') AS pais
      FROM dbo.AAA_ADQUIRIENTE a
      WHERE LTRIM(RTRIM(a.NUMERODOCUMENTOADQUIRIENTE)) = requested.numeroDocumento
        AND NULLIF(NULLIF(LTRIM(RTRIM(a.DIRECCIONADQUIRIENTE)), ''), '-') IS NOT NULL
        AND LTRIM(RTRIM(a.UBIGEOADQUIRIENTE)) LIKE '[0-9][0-9][0-9][0-9][0-9][0-9]'
      ORDER BY a.DATESTAMP DESC
    ) repository
    OUTER APPLY (
      SELECT TOP (1)
        fiscal.direccion,
        fiscal.ubigeo,
        fiscal.distrito,
        fiscal.provincia,
        fiscal.departamento,
        fiscal.pais
      FROM dbo.SPE_EINVOICEHEADER h
      INNER JOIN dbo.SPE_EINVOICE_RESPONSE response
        ON response.NUMERODOCUMENTOEMISOR = h.NUMERODOCUMENTOEMISOR
       AND response.SERIENUMERO = h.SERIENUMERO
       AND response.TIPODOCUMENTO = h.TIPODOCUMENTO
       AND response.process_state = '_3_COMPLETED'
       AND response.bl_mensajeSunat LIKE '%"codigo":"0"%'
      CROSS APPLY (
        SELECT
          MAX(CASE WHEN extra.clave = 'direccionAdquiriente'
            THEN NULLIF(NULLIF(LTRIM(RTRIM(extra.valor)), ''), '-') END) AS direccion,
          MAX(CASE WHEN extra.clave = 'ubigeoAdquiriente'
            THEN NULLIF(NULLIF(LTRIM(RTRIM(extra.valor)), ''), '-') END) AS ubigeo,
          MAX(CASE WHEN extra.clave = 'distritoAdquiriente'
            THEN NULLIF(NULLIF(LTRIM(RTRIM(extra.valor)), ''), '-') END) AS distrito,
          MAX(CASE WHEN extra.clave = 'provinciaAdquiriente'
            THEN NULLIF(NULLIF(LTRIM(RTRIM(extra.valor)), ''), '-') END) AS provincia,
          MAX(CASE WHEN extra.clave = 'departamentoAdquiriente'
            THEN NULLIF(NULLIF(LTRIM(RTRIM(extra.valor)), ''), '-') END) AS departamento,
          MAX(CASE WHEN extra.clave = 'paisAdquiriente'
            THEN NULLIF(NULLIF(LTRIM(RTRIM(extra.valor)), ''), '-') END) AS pais
        FROM dbo.SPE_EINVOICEHEADER_ADD extra
        WHERE extra.NUMERODOCUMENTOEMISOR = h.NUMERODOCUMENTOEMISOR
          AND extra.SERIENUMERO = h.SERIENUMERO
          AND extra.TIPODOCUMENTO = h.TIPODOCUMENTO
      ) fiscal
      WHERE h.TIPODOCUMENTO = '01'
        AND h.NUMERODOCUMENTOADQUIRIENTE = requested.numeroDocumento
        AND fiscal.direccion IS NOT NULL
        AND fiscal.ubigeo LIKE '[0-9][0-9][0-9][0-9][0-9][0-9]'
      ORDER BY h.FECHAEMISION DESC, h.SERIENUMERO DESC
    ) history;
  `);

  for (const row of result.recordset) {
    if (
      !row.direccion
      || !row.ubigeo
      || !row.distrito
      || !row.provincia
      || !row.departamento
      || !row.fuente
    ) continue;

    addresses.set(row.numeroDocumento.trim(), {
      direccion: row.direccion.trim(),
      ubigeo: row.ubigeo.trim(),
      distrito: row.distrito.trim(),
      provincia: row.provincia.trim(),
      departamento: row.departamento.trim(),
      pais: row.pais?.trim() || 'PE',
      fuente: row.fuente
    });
  }

  const missingDocuments = documents.filter((document) => !addresses.has(document));
  if (missingDocuments.length === 0) return addresses;

  const ychiRequest = new sql.Request(ychiPool);
  const ychiParams = missingDocuments.map((document, index) => {
    const name = `ychiFiscalDocument${index}`;
    ychiRequest.input(name, sql.VarChar(20), document);
    return `@${name}`;
  });
  const ychiResult = await ychiRequest.query<{
    numeroDocumento: string;
    direccion: string;
    ubigeo: string;
    distrito: string;
    provincia: string;
    departamento: string;
  }>(`
    SELECT numeroDocumento, direccion, ubigeo, distrito, provincia, departamento
    FROM (
      SELECT
        REPLACE(REPLACE(LTRIM(RTRIM(c.RUC)), '-', ''), ' ', '') AS numeroDocumento,
        LTRIM(RTRIM(c.Direccion)) AS direccion,
        CASE
          WHEN LTRIM(RTRIM(c.ubigeo)) LIKE '[0-9][0-9][0-9][0-9][0-9][0-9]'
          THEN LTRIM(RTRIM(c.ubigeo))
          ELSE ''
        END AS ubigeo,
        LTRIM(RTRIM(dist.nombre)) AS distrito,
        LTRIM(RTRIM(prov.nombre)) AS provincia,
        LTRIM(RTRIM(dpto.nombre)) AS departamento,
        ROW_NUMBER() OVER (
          PARTITION BY REPLACE(REPLACE(LTRIM(RTRIM(c.RUC)), '-', ''), ' ', '')
          ORDER BY CASE WHEN c.tipoClieProv = 'C' THEN 0 ELSE 1 END, c.idClieProv
        ) AS rowNumber
      FROM dbo.tbClieProv c
      LEFT JOIN dbo.tbDepartamento dpto ON dpto.idDepartamento = c.idDepartamento
      LEFT JOIN dbo.tbProvincia prov ON prov.idProvincia = c.IdProvincia
      LEFT JOIN dbo.tbDistrito dist ON dist.idDistrito = c.IdDistrito
      WHERE c.Estado = 'A'
        AND REPLACE(REPLACE(LTRIM(RTRIM(c.RUC)), '-', ''), ' ', '') IN (${ychiParams.join(', ')})
        AND NULLIF(NULLIF(LTRIM(RTRIM(c.Direccion)), ''), '-') IS NOT NULL
    ) source
    WHERE rowNumber = 1;
  `);

  for (const row of ychiResult.recordset) {
    if (!row.distrito || !row.provincia || !row.departamento) continue;
    addresses.set(row.numeroDocumento.trim(), {
      direccion: row.direccion.trim(),
      ubigeo: row.ubigeo.trim(),
      distrito: row.distrito.trim(),
      provincia: row.provincia.trim(),
      departamento: row.departamento.trim(),
      pais: 'PE',
      fuente: 'YCHIDB3'
    });
  }

  return addresses;
}

async function searchClientesFromGreFc(pool: sql.ConnectionPool, query: string): Promise<FcFacturaCliente[]> {
  const request = new sql.Request(pool);
  request.input('query', sql.NVarChar(250), `%${query}%`);

  const result = await request.query<{
    tipoDocumento: string;
    numeroDocumento: string;
    razonSocial: string;
  }>(`
    SELECT DISTINCT TOP (50)
      tipoDocumentoDestinatario AS tipoDocumento,
      numeroDocumentoDestinatario AS numeroDocumento,
      razonSocialDestinatario AS razonSocial
    FROM dbo.GRE_FC_OPERACION
    WHERE @query = '%%'
      OR numeroDocumentoDestinatario LIKE @query
      OR razonSocialDestinatario LIKE @query
    ORDER BY razonSocialDestinatario
  `);

  return result.recordset.map((row) => ({
    id: `${row.tipoDocumento}-${row.numeroDocumento}`,
    tipoDocumento: row.tipoDocumento,
    numeroDocumento: row.numeroDocumento,
    razonSocial: row.razonSocial,
    fuente: 'GRE_FC'
  }));
}

async function searchClientesFromBizlinks(pool: sql.ConnectionPool, query: string): Promise<FcFacturaCliente[]> {
  const request = new sql.Request(pool);
  request.input('query', sql.NVarChar(250), `%${query}%`);

  const result = await request.query<{
    tipoDocumento: string;
    numeroDocumento: string;
    razonSocial: string;
  }>(`
    SELECT DISTINCT TOP (50)
      tipoDocumentoDestinatario AS tipoDocumento,
      numeroDocumentoDestinatario AS numeroDocumento,
      razonSocialDestinatario AS razonSocial
    FROM dbo.SPE_DESPATCH
    WHERE (serieNumeroGuia LIKE 'T001-%' OR serieNumeroGuia LIKE 'T999-%')
      AND (
        @query = '%%'
        OR numeroDocumentoDestinatario LIKE @query
        OR razonSocialDestinatario LIKE @query
      )
    ORDER BY razonSocialDestinatario
  `);

  return result.recordset.map((row) => ({
    id: `${row.tipoDocumento}-${row.numeroDocumento}`,
    tipoDocumento: row.tipoDocumento,
    numeroDocumento: row.numeroDocumento,
    razonSocial: row.razonSocial,
    fuente: 'BIZLINKS'
  }));
}

async function searchRecipientsFromYchi(pool: sql.ConnectionPool, query: string): Promise<FcFacturaCliente[]> {
  const request = new sql.Request(pool);
  request.input('query', sql.NVarChar(250), `%${query}%`);

  const result = await request.query<{
    tipoDocumento: string;
    numeroDocumento: string;
    razonSocial: string;
    tipoClieProv: string;
  }>(`
    SELECT TOP (50)
      CASE
        WHEN LEN(REPLACE(REPLACE(LTRIM(RTRIM(ISNULL(RUC, ''))), '-', ''), ' ', '')) = 11 THEN '6'
        WHEN LEN(REPLACE(REPLACE(LTRIM(RTRIM(ISNULL(RUC, ''))), '-', ''), ' ', '')) = 8 THEN '1'
        ELSE '0'
      END AS tipoDocumento,
      REPLACE(REPLACE(LTRIM(RTRIM(ISNULL(RUC, ''))), '-', ''), ' ', '') AS numeroDocumento,
      LTRIM(RTRIM(ISNULL(Nombre, ''))) AS razonSocial,
      LTRIM(RTRIM(ISNULL(tipoClieProv, ''))) AS tipoClieProv
    FROM dbo.tbClieProv
    WHERE Estado = 'A'
      AND tipoClieProv IN ('C', 'P')
      AND (
        @query = '%%'
        OR Nombre LIKE @query
        OR ISNULL(RUC, '') LIKE @query
      )
    ORDER BY CASE WHEN tipoClieProv = 'P' THEN 0 ELSE 1 END, Nombre
  `);

  return result.recordset.map((row) => ({
    id: `YCHIDB3-${row.tipoClieProv}-${row.numeroDocumento}`,
    tipoDocumento: row.tipoDocumento,
    numeroDocumento: row.numeroDocumento,
    razonSocial: row.razonSocial,
    fuente: row.tipoClieProv === 'P' ? 'PROVEEDOR' : 'CLIENTE_YCHIDB3'
  }));
}

async function listGreFcGuideRows(pool: sql.ConnectionPool, numeroDocumento: string) {
  const request = new sql.Request(pool);
  request.input('numeroDocumento', sql.VarChar(20), numeroDocumento);

  const result = await request.query<GreGuideDetailRow>(`
    SELECT TOP (500)
      CONVERT(varchar(36), o.idOperacion) AS operationId,
      o.id AS operationPk,
      e.serieNumeroGuia,
      o.creadoEn,
      o.tipoDocumentoDestinatario,
      o.numeroDocumentoDestinatario,
      o.razonSocialDestinatario,
      d.id AS detalleId,
      d.codigo,
      d.descripcion,
      d.cantidad,
      d.unidad
    FROM dbo.GRE_FC_OPERACION o
    INNER JOIN dbo.GRE_FC_ENVIO e
      ON e.operacionId = o.id
    INNER JOIN dbo.GRE_FC_DETALLE d
      ON d.operacionId = o.id
    WHERE (e.serieNumeroGuia LIKE 'T001-%' OR e.serieNumeroGuia LIKE 'T999-%')
      AND o.numeroDocumentoDestinatario = @numeroDocumento
    ORDER BY o.creadoEn DESC, e.serieNumeroGuia, d.id
  `);

  return result.recordset;
}

async function getBizlinksStatuses(pool: sql.ConnectionPool, series: string[]) {
  const statuses = new Map<string, BizlinksStatusRow>();
  if (series.length === 0) return statuses;

  const request = new sql.Request(pool);
  const params = series.map((serie, index) => {
    const name = `serie${index}`;
    request.input(name, sql.VarChar(20), serie);
    return `@${name}`;
  });

  const result = await request.query<BizlinksStatusRow>(`
    SELECT
      d.serieNumeroGuia,
      d.bl_estadoRegistro,
      r.bl_estadoRegistro AS responseEstadoRegistro,
      r.bl_estadoProceso,
      r.process_state,
      r.bl_mensaje,
      r.bl_mensajeSunat
    FROM dbo.SPE_DESPATCH d
    LEFT JOIN dbo.SPE_DESPATCH_RESPONSE r
      ON r.tipoDocumentoRemitente = d.tipoDocumentoRemitente
     AND r.numeroDocumentoRemitente = d.numeroDocumentoRemitente
     AND r.serieNumeroGuia = d.serieNumeroGuia
     AND r.tipoDocumentoGuia = d.tipoDocumentoGuia
    WHERE d.serieNumeroGuia IN (${params.join(', ')})
  `);

  for (const row of result.recordset) {
    statuses.set(row.serieNumeroGuia, row);
  }

  return statuses;
}

async function findAlreadyInvoicedGuides(
  bizlinksPool: sql.ConnectionPool,
  ychiPool: sql.ConnectionPool,
  series: string[]
) {
  const alreadyInvoiced = new Set<string>();
  const warnings: string[] = [];

  if (series.length === 0) {
    return { alreadyInvoiced, warnings };
  }

  try {
    const request = new sql.Request(bizlinksPool);
    const params = series.map((serie, index) => {
      const name = `aaaSerie${index}`;
      request.input(name, sql.VarChar(20), serie);
      return `@${name}`;
    });

    const result = await request.query<{ NRO_GUIA: string | null }>(`
      SELECT DISTINCT gf.NRO_GUIA
      FROM dbo.AAA_GUIAFACTURADA gf
      LEFT JOIN dbo.SPE_EINVOICEHEADER h
        ON h.SERIENUMERO = gf.NRO_FACTURA
       AND h.TIPODOCUMENTO = '01'
      WHERE gf.NRO_GUIA IN (${params.join(', ')})
        AND ISNULL(h.bl_estadoRegistro, '') <> 'E'
    `);

    result.recordset.forEach((row) => {
      if (row.NRO_GUIA) alreadyInvoiced.add(row.NRO_GUIA.trim());
    });
  } catch (error) {
    warnings.push(readPermissionWarning('AAA_GUIAFACTURADA', error));
  }

  try {
    const request = new sql.Request(ychiPool);
    const params = series.map((serie, index) => {
      const name = `ychiSerie${index}`;
      request.input(name, sql.VarChar(20), serie);
      return `@${name}`;
    });

    const result = await request.query<{ nguia: string | null }>(`
      SELECT DISTINCT nguia
      FROM dbo.tbDocumentos
      WHERE idTipoDocu = 1
        AND (
          nguia IN (${params.join(', ')})
          OR ${params.map((param) => `nguia LIKE '%' + ${param} + '%'`).join(' OR ')}
        )
    `);

    for (const row of result.recordset) {
      const nguia = row.nguia ?? '';
      for (const serie of series) {
        if (nguia.includes(serie)) alreadyInvoiced.add(serie);
      }
    }
  } catch (error) {
    warnings.push(readPermissionWarning('tbDocumentos.nguia', error));
  }

  warnings.push('Pendiente auditar tbGuiasFactura cuando exista permiso SELECT directo.');

  return { alreadyInvoiced, warnings };
}

async function findSellerForCustomer(pool: sql.ConnectionPool, numeroDocumento: string): Promise<{
  vendedor: FcFacturaVendedor | null;
  warnings: string[];
}> {
  const warnings: string[] = [];

  try {
    const clientRequest = new sql.Request(pool);
    clientRequest.input('numeroDocumento', sql.VarChar(20), numeroDocumento);
    const client = await clientRequest.query<{ idempleado: number | null }>(`
      SELECT TOP (1)
        idempleado
      FROM dbo.tbClieProv
      WHERE RUC = @numeroDocumento
    `);
    const idEmpleado = client.recordset[0]?.idempleado ?? null;

    if (!idEmpleado) return { vendedor: null, warnings };

    const sellerName = await findSellerName(pool, idEmpleado, warnings);

    return {
      vendedor: {
        idEmpleado,
        nombre: sellerName || `Empleado ${idEmpleado}`
      },
      warnings
    };
  } catch (error) {
    return {
      vendedor: null,
      warnings: [readPermissionWarning('tbClieProv.idempleado', error)]
    };
  }
}

async function findSellerName(pool: sql.ConnectionPool, idEmpleado: number, warnings: string[]) {
  const sources = [
    {
      name: 'VW_VENDEDORES',
      query: `
        SELECT TOP (1)
          Nombre AS vendedor
        FROM dbo.VW_VENDEDORES
        WHERE idEmpleado = @idEmpleado
      `
    },
    {
      name: 'VW_EMPLEADOS',
      query: `
        SELECT TOP (1)
          LTRIM(RTRIM(ISNULL(Nombre, '') + ' ' + ISNULL(Apellido, ''))) AS vendedor
        FROM dbo.VW_EMPLEADOS
        WHERE idEmpleado = @idEmpleado
      `
    }
  ];

  for (const source of sources) {
    try {
      const request = new sql.Request(pool);
      request.input('idEmpleado', sql.Int, idEmpleado);
      const result = await request.query<{ vendedor: string | null }>(source.query);
      const vendedor = result.recordset[0]?.vendedor?.trim();
      if (vendedor) return vendedor;
    } catch (error) {
      warnings.push(readPermissionWarning(source.name, error));
    }
  }

  return '';
}

function readPermissionWarning(source: string, error: unknown) {
  const message = error instanceof Error ? error.message : 'sin detalle';

  return `No se pudo validar no duplicidad contra ${source}: ${message}`;
}

function hasSunatAcceptedResponse(row: BizlinksStatusRow) {
  if (row.bl_estadoProceso?.includes('AC_03')) return true;

  const message = row.bl_mensajeSunat ?? row.bl_mensaje ?? '';

  return /aceptad[ao]/i.test(message) && /"codigo"\s*:\s*"0"/i.test(message);
}

function validatePreview(input: FcFacturaPreviewInput): FcFacturaValidation[] {
  const validations: FcFacturaValidation[] = [];
  const selectedGuides = new Set(input.guias.map((guide) => guide.serieNumeroGuia));
  const itemGuides = new Set(input.items.map((item) => item.serieNumeroGuia));
  const totals = calculateTotalsByExclusion(input.items, input.tipoExclusionProducto);
  const financial = calculateFinancialSummary(input, totals);

  validations.push({
    code: 'SERIE_FACTURA_FF01',
    severity: input.serie === FC_FACTURA_SERIE ? 'ok' : 'error',
    message: `La factura FC usa serie ${FC_FACTURA_SERIE}.`
  });

  validations.push({
    code: 'GRE_REFERENCIADAS_FC',
    severity: [...selectedGuides].every((guide) => /^T(?:001|999)-/.test(guide)) ? 'ok' : 'error',
    message: 'Las GRE seleccionadas se tratan como guias referenciadas T001/T999.'
  });

  validations.push({
    code: 'ITEMS_PERTENECEN_A_GRE',
    severity: [...itemGuides].every((guide) => selectedGuides.has(guide)) ? 'ok' : 'error',
    message: 'Todos los items deben pertenecer a las GRE seleccionadas.'
  });

  validations.push({
    code: 'MONEDA_Y_TIPO_CAMBIO',
    severity: input.moneda === 'PEN' || financial.tipoCambio > 0 ? 'ok' : 'error',
    message: input.moneda === 'PEN'
      ? 'Moneda PEN con tipo de cambio 1.000.'
      : `Moneda USD con tipo de cambio de venta Ychiscom ${financial.tipoCambio.toFixed(3)}.`
  });

  const fiscalAddress = input.cliente.direccionFiscal;
  validations.push({
    code: 'DIRECCION_FISCAL_ADQUIRENTE',
    severity: fiscalAddress ? 'ok' : 'error',
    message: fiscalAddress
      ? `Direccion fiscal: ${fiscalAddress.direccion} (${fiscalAddress.ubigeo}), fuente ${fiscalAddress.fuente}.`
      : 'El cliente no tiene direccion fiscal y ubigeo verificables. Actualice AAA_ADQUIRIENTE antes de declarar.'
  });

  validations.push({
    code: 'TIPO_DETRACCION',
    severity: input.tipoDetraccion === '025' ? 'warning' : 'ok',
    message: input.tipoDetraccion === '025'
      ? 'Detraccion 025 - 10% respaldada por comprobantes Flexo historicos; confirme su aplicacion con Contabilidad.'
      : `TipoDet aplicado: ${input.tipoDetraccion === '000' ? '000 - Sin detraccion' : '037 - 12%'}.`
  });

  validations.push({
    code: 'REGLA_MONTO_DETRACCION',
    severity: detractionAmountSeverity(input.tipoDetraccion, financial.totalEquivalentePen),
    message: detractionAmountMessage(
      input.tipoDetraccion,
      financial.totalEquivalentePen,
      input.moneda,
      totals.total
    )
  });

  validations.push({
    code: 'TIPO_EXCLUSION_PRODUCTO',
    severity: input.tipoExclusionProducto === 'GRATUITA' ? 'error' : 'ok',
    message: exclusionValidationMessage(input.tipoExclusionProducto)
  });

  validations.push({
    code: 'FECHA_VENCIMIENTO',
    severity: effectiveDueDate(input) >= input.fechaEmision ? 'ok' : 'error',
    message: `Vencimiento ${financial.fechaVencimiento}.`
  });

  const paymentNumbers = [...input.formaPago.matchAll(/\d+/g)].map((match) => Number(match[0]));
  const hasMultipleSchedule = input.diasPago > 0 && new Set(paymentNumbers.filter((value) => value > 0)).size > 1;
  validations.push({
    code: 'CRONOGRAMA_PAGO',
    severity: hasMultipleSchedule ? 'error' : 'ok',
    message: hasMultipleSchedule
      ? 'La forma de pago contiene varias fechas. Aun no se generan cuotas multiples; seleccione una forma con un solo vencimiento.'
      : input.diasPago > 0
        ? `Credito a ${input.diasPago} dias, con vencimiento ${financial.fechaVencimiento} y cuota neta ${input.moneda} ${financial.netoPendiente.toFixed(2)}.`
        : 'Pago al contado, sin cuotas pendientes.'
  });

  validations.push({
    code: 'PRECIOS_COMPLETOS',
    severity: input.items.every((item) => item.precioUnitario > 0) ? 'ok' : 'warning',
    message: 'Los precios unitarios deben completarse antes de declarar.'
  });

  validations.push({
    code: 'TOTALES_POSITIVOS',
    severity: totals.total > 0 ? 'ok' : 'warning',
    message: 'La factura debe tener total mayor a cero antes de declararse.'
  });

  const longDescriptions = input.items
    .map((item) => ({
      codigoProducto: item.codigoProducto,
      length: invoiceItemDescription(item.descripcion, input.numeroRegistro).length
    }))
    .filter((item) => item.length > FACTURA_DETAIL_DESCRIPTION_MAX_LENGTH);

  validations.push({
    code: 'DESCRIPCION_NR_BIZLINKS',
    severity: longDescriptions.length === 0 ? 'ok' : 'error',
    message: longDescriptions.length === 0
      ? 'Descripciones de items compatibles con Bizlinks FE.'
      : `Hay descripciones demasiado largas al agregar NR: ${
        longDescriptions.map((item) => `${item.codigoProducto}/${item.length}`).join(', ')
      }.`
  });

  const invalidUnits = input.items
    .map((item) => ({
      serieNumeroGuia: item.serieNumeroGuia,
      codigoProducto: item.codigoProducto,
      unidadMedida: item.unidadMedida,
      unidadNormalizada: normalizeInvoiceUnit(item.unidadMedida)
    }))
    .filter((item) => item.unidadNormalizada.length > 3);

  validations.push({
    code: 'UNIDADES_BIZLINKS_FE',
    severity: invalidUnits.length === 0 ? 'ok' : 'error',
    message: invalidUnits.length === 0
      ? 'Las unidades de medida son compatibles con Bizlinks FE.'
      : `Hay unidades de medida no compatibles con Bizlinks FE: ${invalidUnits.map((item) => `${item.codigoProducto}/${item.unidadMedida}`).join(', ')}. Deben resolverse a codigos de maximo 3 caracteres.`
  });

  validations.push({
    code: 'PREVIEW_SIN_ESCRITURA',
    severity: 'ok',
    message: 'La vista previa no escribe en base de datos; la escritura ocurre solo al declarar.'
  });

  return validations;
}

function detractionAmountSeverity(
  tipoDetraccion: FcFacturaPreviewInput['tipoDetraccion'],
  total: number
): FcFacturaValidation['severity'] {
  if (tipoDetraccion !== '000' && total <= 700) return 'error';
  if (tipoDetraccion === '000' && total > 700) return 'warning';

  return 'ok';
}

function detractionAmountMessage(
  tipoDetraccion: FcFacturaPreviewInput['tipoDetraccion'],
  totalPen: number,
  moneda: FcFacturaPreviewInput['moneda'],
  totalDocumento: number
) {
  const totalLabel = moneda === 'PEN'
    ? `S/ ${totalsLabel(totalDocumento)}`
    : `USD ${totalsLabel(totalDocumento)} (S/ ${totalsLabel(totalPen)})`;

  if (tipoDetraccion !== '000' && totalPen <= 700) {
    return `Para importes de hasta S/ 700.00 no seleccione detraccion ${tipoDetraccion}; use 000 - Sin detraccion para evitar rechazo. Total actual: ${totalLabel}.`;
  }

  if (tipoDetraccion === '000' && totalPen > 700) {
    return `Operacion mayor a S/ 700.00 emitida sin detraccion por seleccion del usuario. Total actual: ${totalLabel}.`;
  }

  return tipoDetraccion === '000'
    ? `Sin detraccion correcto para este importe. Total actual: ${totalLabel}.`
    : `Detraccion ${tipoDetraccion} compatible con el umbral de importe. Total actual: ${totalLabel}.`;
}

function exclusionValidationMessage(tipoExclusionProducto: FcFacturaPreviewInput['tipoExclusionProducto']) {
  switch (tipoExclusionProducto) {
    case 'EXONERADA':
      return 'Operacion exonerada onerosa: codigo de afectacion 20, sin IGV.';
    case 'INAFECTA':
      return 'Operacion inafecta onerosa: codigo de afectacion 30, sin IGV.';
    case 'GRATUITA':
      return 'Operacion gratuita aun no se habilita para declarar: requiere tratamiento especifico de transferencia gratuita.';
    case 'GRAVADA':
    default:
      return 'Operacion gravada al 18%, estructura respaldada por facturas FF01 aceptadas.';
  }
}

function totalsLabel(total: number) {
  return roundMoney(total).toFixed(2);
}

function calculateFinancialSummary(
  input: FcFacturaPreviewInput,
  totals: ReturnType<typeof calculateTotalsByExclusion>
) {
  const tipoCambio = input.moneda === 'USD' ? Number(input.tipoCambio ?? 0) : 1;
  const tipoCambioDetraccion = input.moneda === 'USD' ? roundMoney(tipoCambio) : 1;
  const percent = input.tipoDetraccion === '037' ? 12 : input.tipoDetraccion === '025' ? 10 : 0;
  const detraccionMonedaDocumento = roundMoney(totals.total * percent / 100);

  return {
    moneda: input.moneda,
    tipoCambio,
    diasPago: input.diasPago,
    fechaVencimiento: effectiveDueDate(input),
    totalEquivalentePen: roundMoney(totals.total * tipoCambio),
    detraccionMonedaDocumento,
    detraccionPen: roundMoney(detraccionMonedaDocumento * tipoCambioDetraccion),
    netoPendiente: roundMoney(totals.total - detraccionMonedaDocumento)
  };
}

function normalizeInvoiceUnit(value: string) {
  const unit = value.trim().toUpperCase();
  if (unit === 'UND' || unit === 'UNIDAD') return 'NIU';
  if (unit === 'MILLAR') return 'MIL';
  if (unit === 'MLL') return 'MIL';
  return unit || 'NIU';
}

export function legacyGuideLabel(serieNumeroGuia: string) {
  return serieNumeroGuia.trim();
}

function legacyAmountLabel(total: number, moneda: FcFacturaPreviewInput['moneda']) {
  return invoiceAmountInWords(total, moneda).slice(0, 750);
}

function normalizeLegacyPaymentTerm(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return '-';

  return trimmed
    .replace(/\bdias\b/giu, 'días')
    .replace(/\bdia\b/giu, 'día');
}

function legacyPrintExchangeRate(input: FcFacturaPreviewInput) {
  if (!input.tipoCambio || input.tipoCambio <= 0) return null;
  return roundMoney(input.tipoCambio).toFixed(2);
}

function quoteIdentifier(value: string) {
  return `[${value.replace(/]/g, ']]')}]`;
}

function calculateTotals(items: FcFacturaPreviewInput['items']) {
  return calculateTotalsByExclusion(items, 'GRAVADA');
}

function calculateTotalsByExclusion(
  items: FcFacturaPreviewInput['items'],
  tipoExclusionProducto: FcFacturaPreviewInput['tipoExclusionProducto']
) {
  const base = roundMoney(items.reduce((sum, item) => sum + item.cantidad * item.precioUnitario, 0));
  const gravada = tipoExclusionProducto === 'GRAVADA' ? base : 0;
  const exonerada = tipoExclusionProducto === 'EXONERADA' ? base : 0;
  const inafecta = tipoExclusionProducto === 'INAFECTA' ? base : 0;
  const gratuita = tipoExclusionProducto === 'GRATUITA' ? base : 0;
  const igv = roundMoney(gravada * 0.18);

  return {
    gravada,
    exonerada,
    inafecta,
    gratuita,
    igv,
    total: roundMoney(gravada + exonerada + inafecta + gratuita + igv)
  };
}

function roundMoney(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export const fcFacturaPreviewConstants = {
  serie: FC_FACTURA_SERIE,
  serieNumeroPreview: FC_FACTURA_SERIE_NUMERO_PREVIEW
};
