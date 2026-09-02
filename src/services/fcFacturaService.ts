import type { AppConfig } from '../config/env.js';
import { getGreDefaults } from '../config/greDefaults.js';
import { createBizlinksPool, createGreFcPool, createYchiPool, sql } from '../integrations/bizlinksSql.js';
import { toFcFacturaProcedurePlan } from '../mappers/fcFacturaProcedureMapper.js';
import type { StoredProcedureParam } from '../mappers/speDespatchProcedureMapper.js';
import {
  FC_FACTURA_SERIE,
  FC_FACTURA_SERIE_NUMERO_PREVIEW,
  type FcFacturaPreviewInput
} from '../schemas/fcFacturaSchema.js';
import { getDownloadedPdf, type PdfDelivery } from './bizlinksPdfDownloadService.js';

export type FcFacturaCliente = {
  id: string;
  tipoDocumento: string;
  numeroDocumento: string;
  razonSocial: string;
  fuente: 'GRE_FC' | 'BIZLINKS';
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
  searchClientes(query: string): Promise<FcFacturaCliente[]>;
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
    payload: FcFacturaPreviewInput;
    procedurePlan: ReturnType<typeof toFcFacturaProcedurePlan>;
  }>;
  declarar(input: FcFacturaPreviewInput, options: FcFacturaDeclareOptions): Promise<FcFacturaDeclareResult>;
  listFacturas(): Promise<FcFacturaStatusResult[]>;
  getFacturaPdf(serieNumeroFactura: string): Promise<PdfDelivery | null>;
}

export class DirectDbFcFacturaService implements FcFacturaService {
  constructor(private readonly config: AppConfig) {}

  async searchClientes(query: string): Promise<FcFacturaCliente[]> {
    const normalized = query.trim();
    const greFcPool = createGreFcPool(this.config);
    const bizlinksPool = createBizlinksPool(this.config);

    await greFcPool.connect();
    await bizlinksPool.connect();

    try {
      const results = [
        ...await searchClientesFromGreFc(greFcPool, normalized),
        ...await searchClientesFromBizlinks(bizlinksPool, normalized)
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

      return [...byDocument.values()].slice(0, 50);
    } finally {
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
      const nextNumber = await nextFacturaNumber(bizlinksPool, greFcPool);
      const numero = String(nextNumber).padStart(8, '0');

      return {
        serie: FC_FACTURA_SERIE,
        numero,
        serieNumeroFactura: `${FC_FACTURA_SERIE}-${numero}`,
        reserved: false,
        source: 'BIZLINKS_SPE_EINVOICEHEADER_AND_GRE_FC_TRACE'
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
    const validations = validatePreview(input);
    const totals = calculateTotalsByExclusion(input.items, input.tipoExclusionProducto);

    return {
      writesDatabase: false as const,
      productionEnabled: true as const,
      serieNumeroFactura: `${FC_FACTURA_SERIE}-${input.numero}`,
      totals,
      validations,
      payload: input,
      procedurePlan: toFcFacturaProcedurePlan(input, getGreDefaults(this.config), totals)
    };
  }

  async declarar(input: FcFacturaPreviewInput, options: FcFacturaDeclareOptions): Promise<FcFacturaDeclareResult> {
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

      const generatedSerieNumeroFactura = await nextFacturaSerie(bizlinksTransaction, greFcTransaction);
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
      for (const detailParams of plan.USP_DetalleFE) {
        await executeStoredProcedure(bizlinksTransaction, 'dbo.USP_DetalleFE', detailParams);
      }
      await insertGuideInvoiceLinks(bizlinksTransaction, declaredInput, getGreDefaults(this.config).remitente.numeroDocumento);
      await executeStoredProcedure(bizlinksTransaction, 'dbo.USP_EnviaDocumentoFE', plan.USP_EnviaDocumentoFE);

      const status = await queryFacturaProcedureStatus(bizlinksTransaction, generatedSerieNumeroFactura);
      assertFacturaInserted(status, generatedSerieNumeroFactura, declaredInput.items.length);

      await bizlinksTransaction.commit();
      const guides = await insertFacturaGuidesSnapshotIfEmpty(greFcTransaction, prepared.operacionDbId, declaredInput);
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
          await recordFacturaErrorAndCommit(greFcTransaction, options.operationId, error);
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
          o.estado AS estadoOperacion,
          e.estado AS estadoEnvio,
          MAX(CONVERT(nvarchar(4000), e.mensaje)) AS mensajeEnvio,
          o.total,
          COUNT(d.id) AS items
        FROM dbo.FC_FACT_OPERACION o
        LEFT JOIN dbo.FC_FACT_ENVIO e
          ON e.operacionId = o.id
        LEFT JOIN dbo.FC_FACT_DETALLE d
          ON d.operacionId = o.id
        GROUP BY
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

async function assertGuidesNotAlreadyTraced(
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
    LEFT JOIN ${quoteIdentifier(bizlinksDatabase)}.dbo.SPE_EINVOICEHEADER h
      ON h.SERIENUMERO COLLATE DATABASE_DEFAULT = o.serieNumeroFactura
     AND h.TIPODOCUMENTO = '01'
    WHERE g.serieNumeroGuia IN (${params.join(', ')})
      AND o.estado IN ('PREPARANDO', 'INSERTADO_BIZLINKS', 'ACTIVADO', 'ACEPTADA')
      AND ISNULL(h.bl_estadoRegistro, '') <> 'E'
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
  request.input('fechaVencimiento', sql.DateTime2, dueDateFromPaymentDate(input.fechaEmision, input.formaPago));
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
  input: FcFacturaPreviewInput
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
          INSERT INTO dbo.FC_FACT_GUIA (
            operacionId,
            serieNumeroGuia,
            totalGuia
          )
          VALUES (
            @operacionDbId,
            @serieNumeroGuia,
            @totalGuia
          );
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

async function recordFacturaErrorAndCommit(transaction: sql.Transaction, operationId: string, error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  const request = new sql.Request(transaction);
  request.input('operationId', sql.UniqueIdentifier, operationId);
  request.input('message', sql.NVarChar(sql.MAX), message);

  await request.query(`
    DECLARE @operacionId bigint = (
      SELECT TOP (1) id
      FROM dbo.FC_FACT_OPERACION
      WHERE idOperacion = @operationId
      ORDER BY id DESC
    );
    DECLARE @envioId bigint = (
      SELECT TOP (1) id
      FROM dbo.FC_FACT_ENVIO
      WHERE operacionId = @operacionId
      ORDER BY id DESC
    );

    IF @operacionId IS NOT NULL
    BEGIN
      UPDATE dbo.FC_FACT_OPERACION
      SET estado = 'ERROR', actualizadoEn = SYSUTCDATETIME()
      WHERE id = @operacionId;
    END;

    IF @envioId IS NOT NULL
    BEGIN
      UPDATE dbo.FC_FACT_ENVIO
      SET estado = 'ERROR', mensaje = @message, actualizadoEn = SYSUTCDATETIME()
      WHERE id = @envioId;
    END;

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
  bizlinksSource: sql.ConnectionPool | sql.Transaction,
  greFcSource?: sql.ConnectionPool | sql.Transaction
) {
  const bizlinksRequest = createRequest(bizlinksSource);
  bizlinksRequest.input('seriePrefix', sql.VarChar(8), `${FC_FACTURA_SERIE}-%`);

  const bizlinks = await bizlinksRequest.query<{ maxNumber: number | null }>(`
    SELECT MAX(
      CASE
        WHEN ISNUMERIC(RIGHT(SERIENUMERO, 8)) = 1 THEN CONVERT(int, RIGHT(SERIENUMERO, 8))
        ELSE NULL
      END
    ) AS maxNumber
    FROM dbo.SPE_EINVOICEHEADER WITH (UPDLOCK, HOLDLOCK)
    WHERE SERIENUMERO LIKE @seriePrefix
      AND TIPODOCUMENTO = '01'
  `);

  let greFcMax = 0;
  if (greFcSource) {
    const greFcRequest = createRequest(greFcSource);
    greFcRequest.input('seriePrefix', sql.VarChar(8), `${FC_FACTURA_SERIE}-%`);

    const greFc = await greFcRequest.query<{ maxNumber: number | null }>(`
      SELECT MAX(
        CASE
          WHEN ISNUMERIC(RIGHT(serieNumeroFactura, 8)) = 1 THEN CONVERT(int, RIGHT(serieNumeroFactura, 8))
          ELSE NULL
        END
      ) AS maxNumber
      FROM dbo.FC_FACT_OPERACION WITH (UPDLOCK, HOLDLOCK)
      WHERE serieNumeroFactura LIKE @seriePrefix
    `);
    greFcMax = Number(greFc.recordset[0]?.maxNumber ?? 0);
  }

  return Math.max(Number(bizlinks.recordset[0]?.maxNumber ?? 0), greFcMax) + 1;
}

async function nextFacturaSerie(transaction: sql.Transaction, greFcTransaction?: sql.Transaction) {
  const nextNumber = await nextFacturaNumber(transaction, greFcTransaction);

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
      r.bl_mensaje,
      r.bl_mensajeSunat,
      r.bl_url_pdf
    FROM dbo.SPE_EINVOICEHEADER h
    LEFT JOIN dbo.SPE_EINVOICE_RESPONSE r
      ON r.NUMERODOCUMENTOEMISOR = h.NUMERODOCUMENTOEMISOR
     AND r.SERIENUMERO = h.SERIENUMERO
     AND r.TIPODOCUMENTO = h.TIPODOCUMENTO
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

  await request.execute(procedureName);
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

function dueDateFromPaymentDate(fechaEmision: string, formaPago: string) {
  return new Date(`${dueDateFromPayment(fechaEmision, formaPago)}T00:00:00-05:00`);
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
    code: 'MONEDA_PEN',
    severity: input.moneda === 'PEN' ? 'ok' : 'error',
    message: 'La factura FC se emite en soles (PEN).'
  });

  validations.push({
    code: 'TIPO_DETRACCION',
    severity: ['037', '025'].includes(input.tipoDetraccion) ? 'ok' : 'error',
    message: `TipoDet aplicado: ${input.tipoDetraccion === '025' ? '025 - 10%' : '037 - 12%'}.`
  });

  validations.push({
    code: 'TIPO_EXCLUSION_PRODUCTO',
    severity: ['GRAVADA', 'GRATUITA', 'EXONERADA', 'INAFECTA'].includes(input.tipoExclusionProducto) ? 'ok' : 'error',
    message: `Tipo de exclusion del producto: ${input.tipoExclusionProducto}.`
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

function normalizeInvoiceUnit(value: string) {
  const unit = value.trim().toUpperCase();
  if (unit === 'UND' || unit === 'UNIDAD') return 'NIU';
  if (unit === 'MILLAR') return 'MIL';
  if (unit === 'MLL') return 'MIL';
  return unit || 'NIU';
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
