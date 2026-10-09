import type { AppConfig } from '../config/env.js';
import { getGreDefaults } from '../config/greDefaults.js';
import { createBizlinksPool, createYchiPool, sql } from '../integrations/bizlinksSql.js';
import { invoiceAmountInWords, toFcFacturaProcedurePlan } from '../mappers/fcFacturaProcedureMapper.js';
import type { StoredProcedureParam } from '../mappers/speDespatchProcedureMapper.js';
import type { FcFacturaPreviewInput } from '../schemas/fcFacturaSchema.js';
import {
  FLEXO_FACTURA_SERIE,
  type FlexoFacturaPreviewInput
} from '../schemas/flexoFacturaSchema.js';

export type FlexoFacturaCliente = {
  id: string;
  tipoDocumento: string;
  numeroDocumento: string;
  razonSocial: string;
  fuente: 'BIZLINKS_FLEXO';
};

export type FlexoFacturaCuenta = {
  id: string;
  cuenta: string;
  denominacion: string;
  label: string;
  fuente: 'VIEW_CUENTAS_FACTURA' | 'FLEXO_DEFAULT';
};

export type FlexoFacturaFormaPago = {
  id: string;
  nombre: string;
  valor: string;
  dias: number;
};

export type FlexoFacturaItem = {
  id: string;
  serieNumeroGuia: string;
  codigoProducto: string;
  descripcion: string;
  cantidad: number;
  unidadMedida: string;
  moneda?: 'PEN' | 'USD';
  precioUnitario: number;
  afectoIgv: boolean;
};

export type FlexoFacturaGuiaPendiente = {
  operationId: string;
  serieNumeroGuia: string;
  fecha: string | null;
  cliente: {
    tipoDocumento: string;
    numeroDocumento: string;
    razonSocial: string;
  };
  estadoSunat: 'ACEPTADA';
  items: FlexoFacturaItem[];
};

export type FlexoFacturaValidation = {
  code: string;
  severity: 'ok' | 'warning' | 'error';
  message: string;
};

export interface FlexoFacturaService {
  searchClientes(query: string): Promise<FlexoFacturaCliente[]>;
  getNextSerie(): Promise<{
    serie: typeof FLEXO_FACTURA_SERIE;
    numero: string;
    serieNumeroFactura: string;
    reserved: false;
    source: 'AAA_TIPODOCUMENTO' | 'BIZLINKS_SPE_EINVOICEHEADER';
  }>;
  listCuentas(): Promise<{ cuentas: FlexoFacturaCuenta[]; warnings: string[] }>;
  listFormasPago(): Promise<FlexoFacturaFormaPago[]>;
  listGuiasPendientes(numeroDocumento: string): Promise<{
    guias: FlexoFacturaGuiaPendiente[];
    warnings: string[];
  }>;
  preview(input: FlexoFacturaPreviewInput): Promise<{
    writesDatabase: false;
    productionEnabled: false;
    serieNumeroFactura: string;
    totals: ReturnType<typeof calculateTotalsByExclusion>;
    validations: FlexoFacturaValidation[];
    payload: FlexoFacturaPreviewInput;
    procedurePlan: Record<string, unknown>;
  }>;
  declarar(input: FlexoFacturaPreviewInput, options: { operationId: string; user?: string }): Promise<{
    operationId: string;
    serieNumeroFactura: string;
    insertedHeader: boolean;
    insertedItems: number;
    activated: boolean;
    status: Record<string, unknown> | null;
    legacyMirror?: Record<string, unknown>;
  }>;
}

type FlexoGuideRow = {
  serieNumeroGuia: string;
  fechaEmisionGuia: string | null;
  tipoDocumentoDestinatario: string | null;
  numeroDocumentoDestinatario: string | null;
  razonSocialDestinatario: string | null;
  numeroOrdenItem: string | null;
  codigo: string | null;
  descripcion: string | null;
  cantidad: string | null;
  unidadMedida: string | null;
  moneda: string | null;
  bl_estadoProceso: string | null;
  bl_mensaje: string | null;
  bl_mensajeSunat: string | null;
};

type FlexoInvoiceGuideItem = {
  serieNumeroGuia: string;
  numeroOrdenItem: string | null;
  codigo: string | null;
  codigoEmpaque: number | null;
  moneda?: 'PEN' | 'USD';
};

export class DirectDbFlexoFacturaService implements FlexoFacturaService {
  constructor(private readonly config: AppConfig) {}

  async searchClientes(query: string) {
    const normalized = query.trim();
    if (normalized.length < 2) return [];

    const pool = createBizlinksPool(this.config);
    await pool.connect();

    try {
      const request = new sql.Request(pool);
      request.input('query', sql.NVarChar(250), `%${normalized}%`);

      const result = await request.query<{
        tipoDocumento: string | null;
        numeroDocumento: string | null;
        razonSocial: string | null;
      }>(`
        SELECT DISTINCT TOP (50)
          tipoDocumentoDestinatario AS tipoDocumento,
          numeroDocumentoDestinatario AS numeroDocumento,
          razonSocialDestinatario AS razonSocial
        FROM dbo.SPE_DESPATCH
        WHERE (serieNumeroGuia LIKE 'T003-%' OR serieNumeroGuia LIKE 'T999-%')
          AND ISNULL(numeroDocumentoDestinatario, '') <> ''
          AND ISNULL(razonSocialDestinatario, '') <> ''
          AND (
            numeroDocumentoDestinatario LIKE @query
            OR razonSocialDestinatario LIKE @query
          )
        ORDER BY razonSocialDestinatario
      `);

      return result.recordset.map((row) => ({
        id: `${row.tipoDocumento?.trim() || '6'}-${row.numeroDocumento?.trim() ?? ''}`,
        tipoDocumento: row.tipoDocumento?.trim() || '6',
        numeroDocumento: row.numeroDocumento?.trim() ?? '',
        razonSocial: row.razonSocial?.trim() ?? '',
        fuente: 'BIZLINKS_FLEXO' as const
      }));
    } finally {
      await pool.close();
    }
  }

  async getNextSerie() {
    const pool = createBizlinksPool(this.config);
    await pool.connect();

    try {
      const catalogRequest = new sql.Request(pool);
      catalogRequest.input('serie', sql.VarChar(8), FLEXO_FACTURA_SERIE);

      const catalogResult = await catalogRequest.query<{ nextNumber: number }>(`
        SELECT TOP (1)
          ISNULL(CORRELATIVO, 0) + 1 AS nextNumber
        FROM dbo.AAA_TIPODOCUMENTO
        WHERE SERIE = @serie
          AND TIPODOCUMENTO = '01'
        ORDER BY CORRELATIVO DESC
      `);

      const catalogNext = catalogResult.recordset[0]?.nextNumber;
      if (catalogNext && catalogNext > 0) {
        const numero = String(catalogNext).padStart(8, '0');

        return {
          serie: FLEXO_FACTURA_SERIE as typeof FLEXO_FACTURA_SERIE,
          numero,
          serieNumeroFactura: `${FLEXO_FACTURA_SERIE}-${numero}`,
          reserved: false as const,
          source: 'AAA_TIPODOCUMENTO' as const
        };
      }

      const request = new sql.Request(pool);
      request.input('seriePrefix', sql.VarChar(8), `${FLEXO_FACTURA_SERIE}-%`);

      const result = await request.query<{ nextNumber: number }>(`
        SELECT ISNULL(MAX(
          CASE
            WHEN ISNUMERIC(RIGHT(serieNumero, 8)) = 1 THEN CONVERT(int, RIGHT(serieNumero, 8))
            ELSE NULL
          END
        ), 0) + 1 AS nextNumber
        FROM dbo.SPE_EINVOICEHEADER
        WHERE serieNumero LIKE @seriePrefix
          AND tipoDocumento = '01'
      `);
      const numero = String(result.recordset[0]?.nextNumber ?? 1).padStart(8, '0');

      return {
        serie: FLEXO_FACTURA_SERIE as typeof FLEXO_FACTURA_SERIE,
        numero,
        serieNumeroFactura: `${FLEXO_FACTURA_SERIE}-${numero}`,
        reserved: false as const,
        source: 'BIZLINKS_SPE_EINVOICEHEADER' as const
      };
    } finally {
      await pool.close();
    }
  }

  async listCuentas() {
    const pool = createYchiPool(this.config);
    await pool.connect();

    try {
      const warnings: string[] = [];
      const cuentas = await listOfficialFlexoAccounts(pool, warnings);

      return {
        cuentas: cuentas.length > 0 ? cuentas : listDefaultFlexoAccounts(warnings),
        warnings
      };
    } finally {
      await pool.close();
    }
  }

  async listFormasPago() {
    const pool = createYchiPool(this.config);
    await pool.connect();

    try {
      const result = await new sql.Request(pool).query<{
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
      await pool.close();
    }
  }

  async listGuiasPendientes(numeroDocumento: string) {
    const normalizedDocument = numeroDocumento.trim();
    if (!normalizedDocument) {
      return {
        guias: [],
        warnings: ['Seleccione un cliente para listar guias Flexo pendientes.']
      };
    }

    const bizlinksPool = createBizlinksPool(this.config);
    const ychiPool = createYchiPool(this.config);
    await bizlinksPool.connect();
    await ychiPool.connect();

    try {
      const guideRows = await listFlexoGuideRows(bizlinksPool, normalizedDocument);
      const series = [...new Set(guideRows.map((row) => row.serieNumeroGuia))];
      const duplicateResult = await findAlreadyInvoicedGuides(bizlinksPool, ychiPool, series);
      const guides = new Map<string, FlexoFacturaGuiaPendiente>();

      for (const row of guideRows) {
        if (!hasSunatAcceptedResponse(row)) continue;
        if (duplicateResult.alreadyInvoiced.has(row.serieNumeroGuia)) continue;

        const serieNumeroGuia = row.serieNumeroGuia.trim();
        const guide = guides.get(serieNumeroGuia) ?? {
          operationId: serieNumeroGuia,
          serieNumeroGuia,
          fecha: row.fechaEmisionGuia,
          cliente: {
            tipoDocumento: row.tipoDocumentoDestinatario?.trim() || '6',
            numeroDocumento: row.numeroDocumentoDestinatario?.trim() ?? '',
            razonSocial: row.razonSocialDestinatario?.trim() ?? ''
          },
          estadoSunat: 'ACEPTADA' as const,
          items: []
        };

        guide.items.push({
          id: `${serieNumeroGuia}-${row.numeroOrdenItem ?? guide.items.length + 1}`,
          serieNumeroGuia,
          codigoProducto: row.codigo?.trim() ?? '',
          descripcion: row.descripcion?.trim() ?? '',
          cantidad: Number(row.cantidad ?? 0),
          unidadMedida: normalizeInvoiceUnit(row.unidadMedida ?? ''),
          moneda: normalizeCurrency(row.moneda),
          precioUnitario: 0,
          afectoIgv: true
        });
        guides.set(serieNumeroGuia, guide);
      }

      return {
        guias: [...guides.values()],
        warnings: duplicateResult.warnings
      };
    } finally {
      await ychiPool.close();
      await bizlinksPool.close();
    }
  }

  async preview(input: FlexoFacturaPreviewInput) {
    const totals = calculateTotalsByExclusion(input.items, input.tipoExclusionProducto);

    return {
      writesDatabase: false as const,
      productionEnabled: false as const,
      serieNumeroFactura: `${FLEXO_FACTURA_SERIE}-${input.numero}`,
      totals,
      validations: validatePreview(input, totals),
      payload: input,
      procedurePlan: {
        mode: 'PREVIEW_ONLY',
        facturaSerie: FLEXO_FACTURA_SERIE,
        guiasReferenciadas: input.guias.map((item) => item.serieNumeroGuia),
        message: 'No se ejecutan inserts ni procedimientos de facturacion Flexo en esta version.'
      }
    };
  }

  async declarar(input: FlexoFacturaPreviewInput, options: { operationId: string; user?: string }) {
    assertReadyForDeclaration(input);

    const pool = createBizlinksPool(this.config);
    const ychiPool = createYchiPool(this.config);
    await pool.connect();
    await ychiPool.connect();

    let transaction: sql.Transaction | undefined;
    let legacyTransaction: sql.Transaction | undefined;
    let legacyCommitted = false;
    let committedLegacyMirror: Awaited<ReturnType<typeof mirrorLegacyFlexoF03>> | undefined;

    try {
      transaction = new sql.Transaction(pool);
      await transaction.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);
      await acquireAppLock(transaction, `FLEXO_FE:${options.operationId}`);
      await acquireAppLock(transaction, `FLEXO_FE_${FLEXO_FACTURA_SERIE}_CORRELATIVO`);

      const next = await nextFf03(transaction);
      const declaredInput: FlexoFacturaPreviewInput = {
        ...input,
        serie: FLEXO_FACTURA_SERIE,
        numero: next.numero
      };
      const totals = calculateTotalsByExclusion(declaredInput.items, declaredInput.tipoExclusionProducto);
      const guideItems = await assertGuidesAvailableAndAccepted(transaction, declaredInput);
      const plan = buildFlexoFacturaProcedurePlan(declaredInput, this.config, totals);

      await assertFacturaDoesNotExist(transaction, next.serieNumeroFactura);
      await executeStoredProcedure(transaction, 'dbo.USP_CabeceraFE', plan.USP_CabeceraFE);
      for (const detailParams of plan.USP_DetalleFE) {
        await executeStoredProcedure(transaction, 'dbo.USP_DetalleFE', detailParams);
      }
      await insertGuiaFacturada(transaction, declaredInput, next.serieNumeroFactura);
      await insertRegistroContable(transaction, declaredInput.cuenta, next.serieNumeroFactura);

      legacyTransaction = new sql.Transaction(ychiPool);
      await legacyTransaction.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);
      await acquireAppLock(legacyTransaction, `FLEXO_LEGACY_F03:${options.operationId}`);
      await acquireAppLock(legacyTransaction, 'FLEXO_LEGACY_F03_CORRELATIVO');
      const legacyMirror = await mirrorLegacyFlexoF03(
        legacyTransaction,
        declaredInput,
        next.serieNumeroFactura,
        totals
      );

      await legacyTransaction.commit();
      legacyTransaction = undefined;
      legacyCommitted = true;
      committedLegacyMirror = legacyMirror;
      await executeStoredProcedure(transaction, 'dbo.USP_EnviaDocumentoFE', plan.USP_EnviaDocumentoFE);
      await linkEmpaqueDetalleFactura(transaction, next.serieNumeroFactura, guideItems);
      await syncFf03Correlative(transaction, next.numero);

      const status = await queryFacturaStatus(transaction, next.serieNumeroFactura);
      assertDeclaredStatus(status, declaredInput.items.length);

      await transaction.commit();
      transaction = undefined;

      return {
        operationId: options.operationId,
        serieNumeroFactura: next.serieNumeroFactura,
        insertedHeader: true,
        insertedItems: declaredInput.items.length,
        activated: true,
        status: {
          ...status,
          legacyMirror
        },
        legacyMirror
      };
    } catch (error) {
      if (transaction) await rollbackQuietly(transaction);
      if (legacyTransaction) await rollbackQuietly(legacyTransaction);
      if (legacyCommitted) {
        const detail = committedLegacyMirror
          ? ` Legacy creado: ${committedLegacyMirror.legacySerieNumero} (idDocumento ${committedLegacyMirror.idDocumento}).`
          : '';
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(`La factura Flexo no se activo en Bizlinks despues de confirmar el espejo legacy en YCHIDB3.${detail} Revisar antes de reintentar. Error original: ${message}`);
      }
      throw error;
    } finally {
      await ychiPool.close();
      await pool.close();
    }
  }
}

function buildFlexoFacturaProcedurePlan(
  input: FlexoFacturaPreviewInput,
  config: AppConfig,
  totals: ReturnType<typeof calculateTotalsByExclusion>
) {
  const fcInput = toFcCompatibleInput(input);
  const plan = toFcFacturaProcedurePlan(fcInput, getGreDefaults(config), totals);

  setParam(plan.USP_CabeceraFE, 'BL_ORIGEN', 'W');
  setParam(plan.USP_CabeceraFE, 'textoAuxiliar40_1', 'OFICINA FLEXO');
  for (const detail of plan.USP_DetalleFE) {
    setParam(detail, 'textoAuxiliar250_1', null);
  }

  return plan;
}

function toFcCompatibleInput(input: FlexoFacturaPreviewInput): FcFacturaPreviewInput {
  return {
    serie: FLEXO_FACTURA_SERIE as FcFacturaPreviewInput['serie'],
    numero: input.numero,
    fechaEmision: input.fechaEmision,
    fechaVencimiento: input.fechaVencimiento,
    moneda: input.moneda,
    tipoCambio: 1,
    formaPago: input.formaPago,
    diasPago: input.diasPago,
    cuotas: input.cuotas,
    cuenta: input.cuenta,
    tipoDetraccion: input.detraccion === '027' ? '037' : input.detraccion,
    tipoExclusionProducto: input.tipoExclusionProducto,
    vendedor: {
      idEmpleado: null,
      nombre: 'OFICINA FLEXO'
    },
    ordenCompra: input.ordenCompra,
    observaciones: input.observaciones,
    cliente: input.cliente,
    guias: input.guias,
    items: input.items
  } as FcFacturaPreviewInput;
}

function setParam(params: StoredProcedureParam[], name: string, value: string | number | null) {
  const param = params.find((item) => item.name.toUpperCase() === name.toUpperCase());
  if (param) param.value = value;
}

async function listFlexoGuideRows(pool: sql.ConnectionPool, numeroDocumento: string) {
  const request = new sql.Request(pool);
  request.input('numeroDocumento', sql.VarChar(20), numeroDocumento);

  const result = await request.query<FlexoGuideRow>(`
    SELECT TOP (800)
      d.serieNumeroGuia,
      d.fechaEmisionGuia,
      d.tipoDocumentoDestinatario,
      d.numeroDocumentoDestinatario,
      d.razonSocialDestinatario,
      i.numeroOrdenItem,
      i.codigo,
      i.descripcion,
      i.cantidad,
      i.unidadMedida,
      ed.MONEDA AS moneda,
      r.bl_estadoProceso,
      r.bl_mensaje,
      r.bl_mensajeSunat
    FROM dbo.SPE_DESPATCH d
    INNER JOIN dbo.SPE_DESPATCH_ITEM i
      ON i.tipoDocumentoRemitente = d.tipoDocumentoRemitente
     AND i.numeroDocumentoRemitente = d.numeroDocumentoRemitente
     AND i.serieNumeroGuia = d.serieNumeroGuia
     AND i.tipoDocumentoGuia = d.tipoDocumentoGuia
    LEFT JOIN dbo.SPE_DESPATCH_RESPONSE r
      ON r.tipoDocumentoRemitente = d.tipoDocumentoRemitente
     AND r.numeroDocumentoRemitente = d.numeroDocumentoRemitente
     AND r.serieNumeroGuia = d.serieNumeroGuia
     AND r.tipoDocumentoGuia = d.tipoDocumentoGuia
    OUTER APPLY (
      SELECT TOP (1)
        detalle.MONEDA
      FROM dbo.EMPAQUE_DETALLE detalle
      WHERE detalle.SERIENUMEROGUIAREMISION = d.serieNumeroGuia
        AND (
          detalle.ORDENGUIA = i.numeroOrdenItem
          OR detalle.CODIGOPRODUCTO = i.codigo
        )
      ORDER BY
        CASE WHEN detalle.ORDENGUIA = i.numeroOrdenItem THEN 0 ELSE 1 END,
        detalle.CODIGOEMPAQUE
    ) ed
    WHERE (d.serieNumeroGuia LIKE 'T003-%' OR d.serieNumeroGuia LIKE 'T999-%')
      AND d.numeroDocumentoDestinatario = @numeroDocumento
    ORDER BY d.fechaEmisionGuia DESC, d.serieNumeroGuia DESC, i.numeroOrdenItem
  `);

  return result.recordset;
}

async function listOfficialFlexoAccounts(pool: sql.ConnectionPool, warnings: string[]) {
  try {
    const result = await new sql.Request(pool).query<{
      cuenta: number | string;
      denominacion: string | null;
    }>(`
      SELECT TOP (80)
        cuenta,
        denominacion
      FROM dbo.View_CuentasFactura
      WHERE tipo = 'FA'
        AND LTRIM(RTRIM(giro)) = 'F'
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
    warnings.push(readPermissionWarning('View_CuentasFactura Flexo', error));
    return [];
  }
}

function listDefaultFlexoAccounts(warnings: string[]): FlexoFacturaCuenta[] {
  warnings.push('Catalogo de cuentas Flexo cargado desde defaults porque View_CuentasFactura no devolvio datos disponibles.');

  return [
    { cuenta: '7022121', denominacion: 'PRODUCTOS TERMINADOS - VENTA LOCAL TERCEROS FLEXOG' },
    { cuenta: '7012121', denominacion: 'MERCADERIA - VENTA LOCAL TERCEROS FLEXOGRAFIA' },
    { cuenta: '7032121', denominacion: 'SERVICIO EXPRESS - FLEXOGRAFIA' },
    { cuenta: '7032122', denominacion: 'SERV ENVIO DE MERCADERIA - FLEXOGRAFIA' },
    { cuenta: '7032123', denominacion: 'OTROS SERVICIOS PRESTADOS FLEXOGRAFIA' },
    { cuenta: '7564121', denominacion: 'PROPIEDAD, PLANTA Y EQUIPO FLEXOGRAFIA' },
    { cuenta: '7793121', denominacion: 'OTROS INGRESOS FINANCIEROS FLEXOGRAFIA' }
  ].map((item) => ({
    id: item.cuenta,
    cuenta: item.cuenta,
    denominacion: item.denominacion,
    label: `${item.denominacion}-${item.cuenta}`,
    fuente: 'FLEXO_DEFAULT' as const
  }));
}

async function findAlreadyInvoicedGuides(
  bizlinksPool: sql.ConnectionPool,
  ychiPool: sql.ConnectionPool,
  series: string[]
) {
  const alreadyInvoiced = new Set<string>();
  const warnings: string[] = [];

  if (series.length === 0) return { alreadyInvoiced, warnings };

  try {
    const request = new sql.Request(bizlinksPool);
    const params = series.map((serie, index) => {
      const name = `serie${index}`;
      request.input(name, sql.VarChar(20), serie);
      return `@${name}`;
    });

    const result = await request.query<{ NRO_GUIA: string | null }>(`
      SELECT DISTINCT NRO_GUIA
      FROM dbo.AAA_GUIAFACTURADA
      WHERE NRO_GUIA IN (${params.join(', ')})
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

  return { alreadyInvoiced, warnings };
}

function hasSunatAcceptedResponse(row: Pick<FlexoGuideRow, 'bl_estadoProceso' | 'bl_mensaje' | 'bl_mensajeSunat'>) {
  if (row.bl_estadoProceso?.includes('AC_03')) return true;

  const message = row.bl_mensajeSunat ?? row.bl_mensaje ?? '';

  return /aceptad[ao]/i.test(message) && /"codigo"\s*:\s*"0"/i.test(message);
}

function validatePreview(
  input: FlexoFacturaPreviewInput,
  totals: ReturnType<typeof calculateTotalsByExclusion>
): FlexoFacturaValidation[] {
  const selectedGuides = new Set(input.guias.map((guide) => guide.serieNumeroGuia));
  const itemGuides = new Set(input.items.map((item) => item.serieNumeroGuia));
  const itemCurrencies = [...new Set(input.items.map((item) => item.moneda).filter(Boolean))];

  return [
    {
      code: 'SERIE_FACTURA_FF03',
      severity: input.serie === FLEXO_FACTURA_SERIE ? 'ok' : 'error',
      message: `La factura Flexo usa serie ${FLEXO_FACTURA_SERIE}.`
    },
    {
      code: 'GUIAS_REFERENCIADAS_FLEXO',
      severity: [...selectedGuides].every((guide) => /^T(003|999)-/.test(guide)) ? 'ok' : 'error',
      message: 'Las guias seleccionadas se tratan como guias referenciadas T003/T999.'
    },
    {
      code: 'ITEMS_PERTENECEN_A_GUIAS',
      severity: [...itemGuides].every((guide) => selectedGuides.has(guide)) ? 'ok' : 'error',
      message: 'Todos los items deben pertenecer a las guias seleccionadas.'
    },
    {
      code: 'CUENTA_FLEXO',
      severity: input.cuenta.trim() ? 'ok' : 'error',
      message: 'Debe seleccionar una cuenta contable Flexo.'
    },
    {
      code: 'DETRACCION_FLEXO',
      severity: ['000', '037', '025', '027'].includes(input.detraccion) ? 'ok' : 'error',
      message: `Detraccion seleccionada: ${input.detraccion}.`
    },
    {
      code: 'MONEDA_EMPAQUE_DETALLE',
      severity: itemCurrencies.length === 1 && itemCurrencies[0] === input.moneda ? 'ok' : 'error',
      message: itemCurrencies.length === 1
        ? `Moneda validada desde EMPAQUE_DETALLE: ${itemCurrencies[0]}.`
        : 'Los items deben tener una unica moneda tomada de EMPAQUE_DETALLE.'
    },
    {
      code: 'PRECIOS_COMPLETOS',
      severity: input.items.every((item) => item.precioUnitario > 0) ? 'ok' : 'warning',
      message: 'Los precios unitarios deben completarse antes de declarar.'
    },
    {
      code: 'TOTALES_POSITIVOS',
      severity: totals.total > 0 ? 'ok' : 'warning',
      message: 'La factura debe tener total mayor a cero antes de declararse.'
    },
    {
      code: 'PREVIEW_SIN_ESCRITURA',
      severity: 'ok',
      message: 'Modo preview/dry-run: no se ejecutan procedimientos de facturacion ni escrituras.'
    }
  ];
}

function calculateTotalsByExclusion(
  items: FlexoFacturaPreviewInput['items'],
  tipoExclusionProducto: FlexoFacturaPreviewInput['tipoExclusionProducto']
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

function normalizeInvoiceUnit(value: string) {
  const unit = value.trim().toUpperCase();
  if (unit === 'UND' || unit === 'UNIDAD' || unit === 'ROLLS' || unit === 'ROLLOS' || unit === 'ROLLO' || unit === 'ROL' || unit === 'ROLL') return 'NIU';
  if (unit === 'MILLAR') return 'MIL';
  return unit || 'NIU';
}

function normalizeCurrency(value: string | null | undefined): 'PEN' | 'USD' | undefined {
  const normalized = value?.trim().toUpperCase();
  if (!normalized) return undefined;
  if (normalized === '-100' || normalized === 'USD' || normalized === 'D' || normalized === '$' || normalized.includes('DOLAR')) return 'USD';
  if (normalized === '1' || normalized === '1.000' || normalized === 'PEN' || normalized === 'S' || normalized === 'S/' || normalized.includes('SOL')) return 'PEN';
  return undefined;
}

function roundMoney(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function assertReadyForDeclaration(input: FlexoFacturaPreviewInput) {
  const totals = calculateTotalsByExclusion(input.items, input.tipoExclusionProducto);
  const errors = validatePreview(input, totals).filter((issue) => issue.severity === 'error');
  if (errors.length > 0) {
    throw new Error(errors.map((issue) => issue.message).join(' '));
  }
  if (input.items.some((item) => item.precioUnitario <= 0) || totals.total <= 0) {
    throw new Error('Complete precios mayores a cero antes de declarar la factura Flexo.');
  }
  if (input.tipoExclusionProducto !== 'GRAVADA') {
    throw new Error('Solo facturas Flexo gravadas estan habilitadas para declaracion FF03. Gratuita, exonerada e inafecta requieren auditoria con caso aceptado.');
  }
  if (input.detraccion !== '000') {
    throw new Error('Solo facturas Flexo sin detraccion estan habilitadas para declaracion FF03. Las detracciones requieren auditoria y rollback especifico antes de produccion.');
  }
  assertFlexoInvoiceCurrencyReady(input);
  assertFlexoPaymentReady(input, totals.total);
}

function assertFlexoInvoiceCurrencyReady(input: FlexoFacturaPreviewInput) {
  const itemCurrencies = [...new Set(input.items.map((item) => item.moneda).filter(Boolean))];
  if (itemCurrencies.length === 0) {
    throw new Error('La factura Flexo requiere moneda tomada de EMPAQUE_DETALLE antes de declarar.');
  }
  if (itemCurrencies.length > 1) {
    throw new Error('No se puede declarar una factura Flexo con items en PEN y USD. Separe la facturacion por moneda.');
  }
  if (itemCurrencies[0] !== input.moneda) {
    throw new Error(`La moneda de la factura (${input.moneda}) no coincide con la moneda de la hoja de empaque (${itemCurrencies[0]}).`);
  }
}

function assertFlexoPaymentReady(input: FlexoFacturaPreviewInput, total: number) {
  const normalized = normalizePaymentLabel(input.formaPago);
  const cuotas = input.cuotas ?? [];
  if (/^contado/.test(normalized)) {
    if (cuotas.length > 0) throw new Error('Las facturas al contado no deben registrar cuotas.');
    return;
  }
  if (!/^credito|^factura/.test(normalized)) {
    throw new Error('La forma de pago debe ser Contado o Credito para la declaracion FF03 Flexo.');
  }
  if (cuotas.length === 0) {
    throw new Error('Las facturas a credito requieren al menos una cuota con fecha y monto.');
  }
  const cuotaTotal = roundMoney(cuotas.reduce((sum, cuota) => sum + cuota.monto, 0));
  if (Math.abs(cuotaTotal - roundMoney(total)) > 0.01) {
    throw new Error(`La suma de cuotas (${cuotaTotal.toFixed(2)}) debe coincidir con el total (${roundMoney(total).toFixed(2)}).`);
  }
  if (cuotas.some((cuota) => cuota.fecha < input.fechaEmision)) {
    throw new Error('Ninguna cuota puede vencer antes de la fecha de emision.');
  }
}

function isSafeSingleInstallmentPayment(value: string) {
  const normalized = normalizePaymentLabel(value);

  if (normalized.includes(',') || normalized.includes('%')) return false;
  if (normalized.includes('adelantado') || normalized.includes('saldo')) return false;

  return /^contado/.test(normalized)
    || /^factura( negociable)?( a)? \d+ dias\.?$/.test(normalized);
}

function normalizePaymentLabel(value: string) {
  return value
    .trim()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .toLowerCase();
}

async function nextFf03(transaction: sql.Transaction) {
  const result = await transaction.request().query<{ nextNumber: number }>(`
    SELECT TOP (1) ISNULL(CORRELATIVO, 0) + 1 AS nextNumber
    FROM dbo.AAA_TIPODOCUMENTO WITH (UPDLOCK, HOLDLOCK)
    WHERE SERIE = 'FF03'
      AND TIPODOCUMENTO = '01'
    ORDER BY CORRELATIVO DESC
  `);
  const nextNumber = Number(result.recordset[0]?.nextNumber ?? 1);
  const numero = String(nextNumber).padStart(8, '0');

  return {
    numero,
    serieNumeroFactura: `${FLEXO_FACTURA_SERIE}-${numero}`
  };
}

async function assertFacturaDoesNotExist(transaction: sql.Transaction, serieNumeroFactura: string) {
  const request = transaction.request();
  request.input('factura', sql.VarChar(13), serieNumeroFactura);
  const result = await request.query<{ total: number }>(`
    SELECT
      (SELECT COUNT(1) FROM dbo.SPE_EINVOICEHEADER WITH (UPDLOCK, HOLDLOCK) WHERE SERIENUMERO = @factura AND TIPODOCUMENTO = '01')
      + (SELECT COUNT(1) FROM dbo.SPE_EINVOICEDETAIL WITH (UPDLOCK, HOLDLOCK) WHERE SERIENUMERO = @factura AND TIPODOCUMENTO = '01')
      + (SELECT COUNT(1) FROM dbo.SPE_EINVOICE_RESPONSE WITH (UPDLOCK, HOLDLOCK) WHERE SERIENUMERO = @factura AND TIPODOCUMENTO = '01')
      + (SELECT COUNT(1) FROM dbo.AAA_GUIAFACTURADA WITH (UPDLOCK, HOLDLOCK) WHERE NRO_FACTURA = @factura)
      + (SELECT COUNT(1) FROM dbo.AAA_REGISTRO_CONTABLE WITH (UPDLOCK, HOLDLOCK) WHERE serieNumero = @factura) AS total;
  `);

  if (Number(result.recordset[0]?.total ?? 0) > 0) {
    throw new Error(`La factura ${serieNumeroFactura} ya existe o tiene trazas.`);
  }
}

async function assertGuidesAvailableAndAccepted(transaction: sql.Transaction, input: FlexoFacturaPreviewInput) {
  const selected = [...new Set(input.guias.map((guide) => guide.serieNumeroGuia))];
  const request = transaction.request();
  const params = selected.map((serie, index) => {
    const name = `guia${index}`;
    request.input(name, sql.VarChar(13), serie);
    return `@${name}`;
  });

  const result = await request.query<FlexoInvoiceGuideItem & {
    bl_estadoProceso: string | null;
    bl_mensaje: string | null;
    bl_mensajeSunat: string | null;
    nroFactura: string | null;
    facturaEmpaque: string | null;
    monedaRaw: string | null;
  }>(`
    SELECT
      d.serieNumeroGuia,
      i.numeroOrdenItem,
      i.codigo,
      ed.CODIGOEMPAQUE AS codigoEmpaque,
      ed.MONEDA AS monedaRaw,
      r.bl_estadoProceso,
      r.bl_mensaje,
      r.bl_mensajeSunat,
      gf.NRO_FACTURA AS nroFactura,
      ed.SERIENUMEROGUIAFACTURA AS facturaEmpaque
    FROM dbo.SPE_DESPATCH d WITH (UPDLOCK, HOLDLOCK)
    INNER JOIN dbo.SPE_DESPATCH_ITEM i WITH (UPDLOCK, HOLDLOCK)
      ON i.tipoDocumentoRemitente = d.tipoDocumentoRemitente
     AND i.numeroDocumentoRemitente = d.numeroDocumentoRemitente
     AND i.serieNumeroGuia = d.serieNumeroGuia
     AND i.tipoDocumentoGuia = d.tipoDocumentoGuia
    INNER JOIN dbo.SPE_DESPATCH_RESPONSE r
      ON r.tipoDocumentoRemitente = d.tipoDocumentoRemitente
     AND r.numeroDocumentoRemitente = d.numeroDocumentoRemitente
     AND r.serieNumeroGuia = d.serieNumeroGuia
     AND r.tipoDocumentoGuia = d.tipoDocumentoGuia
    LEFT JOIN dbo.AAA_GUIAFACTURADA gf WITH (UPDLOCK, HOLDLOCK)
      ON gf.NRO_GUIA = d.serieNumeroGuia
    LEFT JOIN dbo.EMPAQUE_DETALLE ed WITH (UPDLOCK, HOLDLOCK)
      ON ed.SERIENUMEROGUIAREMISION = d.serieNumeroGuia
     AND ed.ORDENGUIA = i.numeroOrdenItem
    WHERE d.tipoDocumentoGuia = '09'
      AND d.serieNumeroGuia IN (${params.join(', ')})
    ORDER BY d.serieNumeroGuia, i.numeroOrdenItem;
  `);

  const rows = result.recordset;
  const availableByKey = new Map(rows.map((row) => [flexoGuideItemKey(row.serieNumeroGuia, row.numeroOrdenItem, row.codigo), row]));
  const payloadByKey = new Map(input.items.map((item) => [flexoGuideItemKey(item.serieNumeroGuia, item.id, item.codigoProducto), item]));

  for (const serie of selected) {
    const guideRows = rows.filter((row) => row.serieNumeroGuia === serie);
    const guidePayload = input.items.filter((item) => item.serieNumeroGuia === serie);
    if (guideRows.length === 0) throw new Error(`La guia ${serie} no existe o no tiene detalle aceptado.`);
    if (guidePayload.length !== guideRows.length) {
      throw new Error(`La guia ${serie} debe facturarse completa: ${guideRows.length} item(s) reales y ${guidePayload.length} item(s) recibidos.`);
    }
    if (!guideRows.every(hasSunatAcceptedResponse)) throw new Error(`La guia ${serie} no esta aceptada por SUNAT.`);
    if (guideRows.some((row) => !row.codigoEmpaque)) {
      throw new Error(`La guia ${serie} no tiene todos sus items vinculados a EMPAQUE_DETALLE; no se puede facturar desde Flexo.`);
    }
    if (guideRows.some((row) => row.nroFactura || row.facturaEmpaque)) {
      throw new Error(`La guia ${serie} ya esta facturada o tiene items vinculados a factura.`);
    }
  }

  for (const item of input.items) {
    const key = flexoGuideItemKey(item.serieNumeroGuia, item.id, item.codigoProducto);
    if (!availableByKey.has(key)) {
      throw new Error(`El item ${item.id} de la guia ${item.serieNumeroGuia} no coincide con el detalle aceptado de Bizlinks/EMPAQUE_DETALLE.`);
    }
  }

  for (const row of rows) {
    const key = flexoGuideItemKey(row.serieNumeroGuia, row.numeroOrdenItem, row.codigo);
    if (!payloadByKey.has(key)) {
      throw new Error(`El item ${row.numeroOrdenItem ?? '-'} de la guia ${row.serieNumeroGuia} no fue incluido en la factura.`);
    }
  }

  assertGuideRowsMatchPayloadCurrency(rows, input);

  return input.items.map((item) => {
    const row = availableByKey.get(flexoGuideItemKey(item.serieNumeroGuia, item.id, item.codigoProducto));
    if (!row) throw new Error(`No se pudo resolver EMPAQUE_DETALLE para ${item.serieNumeroGuia} item ${item.id}.`);

    return {
      serieNumeroGuia: row.serieNumeroGuia,
      numeroOrdenItem: row.numeroOrdenItem,
      codigo: row.codigo,
      codigoEmpaque: row.codigoEmpaque,
      moneda: normalizeCurrency(row.monedaRaw)
    };
  });
}

function flexoGuideItemKey(serieNumeroGuia: string | null | undefined, numeroOrdenItem: string | number | null | undefined, codigo: string | null | undefined) {
  return [
    serieNumeroGuia?.trim().toUpperCase() ?? '',
    String(numeroOrdenItem ?? '').trim(),
    codigo?.trim().toUpperCase() ?? ''
  ].join('|');
}

function assertGuideRowsMatchPayloadCurrency(
  rows: Array<FlexoInvoiceGuideItem & { monedaRaw: string | null }>,
  input: FlexoFacturaPreviewInput
) {
  const rowCurrencies = [...new Set(rows.map((row) => normalizeCurrency(row.monedaRaw)).filter(Boolean))];
  if (rowCurrencies.length === 0) {
    throw new Error('No se pudo confirmar la moneda de EMPAQUE_DETALLE para las guias seleccionadas.');
  }
  if (rowCurrencies.length > 1) {
    throw new Error('Las guias seleccionadas mezclan monedas en EMPAQUE_DETALLE. Separe la facturacion por moneda.');
  }
  if (rowCurrencies[0] !== input.moneda) {
    throw new Error(`La moneda declarada ${input.moneda} no coincide con EMPAQUE_DETALLE ${rowCurrencies[0]}.`);
  }
}

async function executeStoredProcedure(transaction: sql.Transaction, procedureName: string, params: StoredProcedureParam[]) {
  const request = transaction.request();
  for (const param of params) {
    request.input(param.name, sql.NVarChar, param.value);
  }
  await request.execute(procedureName);
}

async function insertGuiaFacturada(transaction: sql.Transaction, input: FlexoFacturaPreviewInput, serieNumeroFactura: string) {
  for (const guide of input.guias) {
    const request = transaction.request();
    request.input('ruc', sql.VarChar(11), '20259402965');
    request.input('guia', sql.VarChar(13), guide.serieNumeroGuia);
    request.input('factura', sql.VarChar(13), serieNumeroFactura);
    await request.query(`
      INSERT INTO dbo.AAA_GUIAFACTURADA (
        RUC_EMISOR,
        NRO_GUIA,
        NRO_FACTURA,
        FECHA_EMISION,
        USUARIO,
        ESTADO,
        NOTACRE
      )
      VALUES (
        @ruc,
        @guia,
        @factura,
        GETDATE(),
        1,
        'ACEPTADA',
        NULL
      );
    `);
  }
}

async function insertRegistroContable(transaction: sql.Transaction, cuenta: string, serieNumeroFactura: string) {
  const request = transaction.request();
  request.input('cuenta', sql.VarChar(100), cuenta);
  request.input('serieNumeroFactura', sql.VarChar(20), serieNumeroFactura);
  await request.query(`
    INSERT INTO dbo.AAA_REGISTRO_CONTABLE (
      cuenta,
      serieNumero,
      tipoDoc,
      numeroDocumentoEmisor,
      tipoDocumentoEmisor
    )
    VALUES (
      @cuenta,
      @serieNumeroFactura,
      '01',
      '20259402965',
      '6'
    );
  `);
}

async function linkEmpaqueDetalleFactura(transaction: sql.Transaction, serieNumeroFactura: string, rows: FlexoInvoiceGuideItem[]) {
  for (const [index, row] of rows.entries()) {
    if (!row.codigoEmpaque || !row.codigo?.trim()) continue;
    const request = transaction.request();
    request.input('factura', sql.VarChar(13), serieNumeroFactura);
    request.input('ordenFactura', sql.VarChar(4), String(index + 1));
    request.input('codigoEmpaque', sql.Int, row.codigoEmpaque);
    request.input('codigoProducto', sql.VarChar(80), row.codigo.trim());
    request.input('guia', sql.VarChar(13), row.serieNumeroGuia);
    await request.query(`
      UPDATE dbo.EMPAQUE_DETALLE
      SET SERIENUMEROGUIAFACTURA = @factura,
          ORDENFACTURA = @ordenFactura
      WHERE CODIGOEMPAQUE = @codigoEmpaque
        AND CODIGOPRODUCTO = @codigoProducto
        AND SERIENUMEROGUIAREMISION = @guia
        AND SERIENUMEROGUIAFACTURA IS NULL;
    `);
  }
}

async function syncFf03Correlative(transaction: sql.Transaction, numero: string) {
  const request = transaction.request();
  request.input('numero', sql.Int, Number(numero));
  await request.query(`
    UPDATE dbo.AAA_TIPODOCUMENTO
    SET CORRELATIVO = @numero
    WHERE SERIE = 'FF03'
      AND TIPODOCUMENTO = '01'
      AND ISNULL(CORRELATIVO, 0) < @numero;
  `);
}

type FlexoLegacyMirrorSetup = {
  idClieProv: number;
  idEmpleado: number;
  formaPago: number;
  idUnidad: number;
  idDocumentoAnterior: number;
  tipoCambio: number;
  cuenta: number;
  guiaLegacy: string;
};

async function mirrorLegacyFlexoF03(
  transaction: sql.Transaction,
  input: FlexoFacturaPreviewInput,
  serieNumeroFactura: string,
  totals: ReturnType<typeof calculateTotalsByExclusion>
) {
  const setup = await resolveLegacyFlexoF03Setup(transaction, input);
  const idDocumento = { value: 0 };
  const numeDocu = { value: '' };
  const request = transaction.request();
  request.input('idClieProv', sql.Int, setup.idClieProv);
  request.input('formaPago', sql.Int, setup.formaPago);
  request.input('Moneda', sql.Char(1), input.moneda === 'USD' ? 'D' : 'S');
  request.input('Tica', sql.Money, setup.tipoCambio);
  request.input('Neto', sql.Money, totals.gravada);
  request.input('Igv', sql.Money, totals.igv);
  request.input('Total', sql.Money, totals.total);
  request.input('Observaciones', sql.VarChar(200), invoiceAmountInWords(totals.total, input.moneda).slice(0, 200));
  request.input('fechavencimiento', sql.DateTime, localDate(input.fechaVencimiento ?? effectiveDateByDays(input.fechaEmision, input.diasPago)));
  request.input('OrdenCompra', sql.VarChar(50), input.ordenCompra.slice(0, 50));
  request.input('idDocumentoAnterior', sql.Int, setup.idDocumentoAnterior);
  request.output('idDocumento', sql.Int, idDocumento.value);
  request.output('NumeDocu', sql.VarChar(10), numeDocu.value);
  request.input('idemp', sql.Int, setup.idEmpleado);
  request.input('cuenta', sql.Int, setup.cuenta);
  request.input('origen', sql.Char(1), 'Y');
  request.input('llevacomp', sql.Char(1), input.ordenCompra.trim() ? 'S' : 'N');
  request.input('gremision', sql.VarChar(750), setup.guiaLegacy);
  request.input('fenumero', sql.VarChar(13), serieNumeroFactura);

  const headerResult = await request.execute('dbo.SPI_FACTURA_ELECTRONICA_FF03');
  const legacyId = Number(headerResult.output.idDocumento);
  const legacyNumber = String(headerResult.output.NumeDocu ?? '').trim();
  if (!legacyId || !legacyNumber) {
    throw new Error('El espejo legacy F03 no devolvio idDocumento/NumeDocu.');
  }

  const detailResults: Array<{ item: string; mensaje: string }> = [];
  for (const [index, item] of input.items.entries()) {
    const quantity = roundMoney(item.cantidad);
    const price = roundMoney(item.precioUnitario);
    const igvUnit = roundMoney(price * 0.18);
    const detailRequest = transaction.request();
    detailRequest.input('idDocumento', sql.Int, legacyId);
    detailRequest.input('idProducto', sql.Int, 6969);
    detailRequest.input('idDetOrdenVenta', sql.Int, 0);
    detailRequest.input('Cantidad', sql.Decimal(18, 2), quantity);
    detailRequest.input('Precio', sql.Decimal(18, 2), price);
    detailRequest.input('Igv', sql.Decimal(18, 2), igvUnit);
    detailRequest.input('Total', sql.Decimal(18, 2), 0);
    detailRequest.input('idRecepcionOt', sql.Int, 0);
    detailRequest.input('idUnidad', sql.Int, setup.idUnidad);
    detailRequest.input('idguia', sql.Int, 0);
    detailRequest.input('DESCC', sql.VarChar(250), item.descripcion.slice(0, 250));
    detailRequest.input('nguia', sql.VarChar(750), setup.guiaLegacy);
    detailRequest.output('Mensaje', sql.VarChar(50), '');
    const detailResult = await detailRequest.execute('dbo.SPI_DETFACT_NGUIA');
    const message = String(detailResult.output.Mensaje ?? '').trim();
    if (message) {
      throw new Error(`Detalle legacy F03 item ${index + 1}: ${message}`);
    }
    detailResults.push({ item: String(index + 1), mensaje: message });
  }

  const validation = await validateLegacyFlexoF03Mirror(transaction, legacyId, input.items.length);

  return {
    idDocumento: legacyId,
    legacySerieNumero: `F03-${legacyNumber}`,
    serieNumeroFactura,
    detalleItems: detailResults.length,
    guiaLegacy: setup.guiaLegacy,
    validation
  };
}

async function resolveLegacyFlexoF03Setup(transaction: sql.Transaction, input: FlexoFacturaPreviewInput): Promise<FlexoLegacyMirrorSetup> {
  const days = input.diasPago;
  const cuenta = Number(input.cuenta);
  if (!Number.isInteger(cuenta) || cuenta <= 0) {
    throw new Error(`Cuenta contable Flexo invalida para legacy: ${input.cuenta}.`);
  }
  const guiaLegacy = input.guias.map((guide) => legacyFlexoGuideLabel(guide.serieNumeroGuia)).join(', ').slice(0, 750);
  const guideNumbers = input.guias.map((guide) => legacyFlexoGuideNumber(guide.serieNumeroGuia)).filter(Boolean);
  const request = transaction.request();
  request.input('ruc', sql.VarChar(20), input.cliente.numeroDocumento);
  request.input('formaPago', sql.VarChar(200), input.formaPago);
  request.input('days', sql.VarChar(10), String(days));
  request.input('daysInt', sql.Int, days);
  const guideParams = guideNumbers.map((value, index) => {
    const name = `guide${index}`;
    request.input(name, sql.VarChar(20), value);
    return `@${name}`;
  });
  const guidePredicate = guideParams.length > 0
    ? `SeriDocu = '003' AND NumeDocu IN (${guideParams.join(', ')})`
    : '1 = 0';

  const result = await request.query<{
    idClieProv: number | null;
    idEmpleado: number | null;
    formaPago: number | null;
    idUnidad: number | null;
    idDocumentoAnterior: number | null;
    tipoCambio: number | null;
  }>(`
    SELECT
      (SELECT TOP (1) idClieProv
       FROM dbo.tbClieProv WITH (UPDLOCK, HOLDLOCK)
       WHERE RUC = @ruc AND tipoClieProv = 'C' AND Estado = 'A'
       ORDER BY CASE WHEN origen = 'Y' THEN 0 ELSE 1 END, idClieProv DESC) AS idClieProv,
      (SELECT TOP (1) idempleado
       FROM dbo.tbClieProv
       WHERE RUC = @ruc AND tipoClieProv = 'C' AND Estado = 'A'
       ORDER BY CASE WHEN origen = 'Y' THEN 0 ELSE 1 END, idClieProv DESC) AS idEmpleado,
      (SELECT TOP (1) idPropiedades
       FROM (
         SELECT
           idPropiedades,
           Nombre,
           Valor,
           CASE WHEN ISNUMERIC(Descripcion) = 1 THEN CAST(Descripcion AS int) ELSE 9999 END AS diasCatalogo
         FROM dbo.tbPropiedades WITH (UPDLOCK, HOLDLOCK)
         WHERE tipo = 'FPAG'
           AND ISNULL(Valor, '') NOT LIKE '(obsoleto)%'
           AND ISNULL(Nombre, '') NOT LIKE '(obsoleto)%'
       ) fp
       WHERE LTRIM(RTRIM(Nombre)) = @formaPago
          OR LTRIM(RTRIM(Valor)) = @formaPago
          OR (
            (Nombre LIKE 'Factura%' OR Valor LIKE 'Factura%')
            AND ABS(diasCatalogo - @daysInt) <= 5
          )
       ORDER BY
         CASE WHEN LTRIM(RTRIM(Nombre)) = @formaPago OR LTRIM(RTRIM(Valor)) = @formaPago THEN 0 ELSE 1 END,
         ABS(diasCatalogo - @daysInt),
         CASE WHEN Nombre LIKE 'Factura %' THEN 0 ELSE 1 END,
         idPropiedades) AS formaPago,
      (SELECT TOP (1) idUnidad
       FROM dbo.tbUnidades
       WHERE idUnidad = 10 OR Valor IN ('MIL', 'MILLAR', 'UND', 'Und')
       ORDER BY CASE WHEN idUnidad = 10 THEN 0 WHEN Valor IN ('MIL', 'MILLAR') THEN 1 ELSE 2 END, idUnidad) AS idUnidad,
      (SELECT TOP (1) idDocumento
       FROM dbo.tbDocumentos WITH (UPDLOCK, HOLDLOCK)
       WHERE ${guidePredicate}
       ORDER BY idDocumento DESC) AS idDocumentoAnterior,
      (SELECT TOP (1) venta
       FROM dbo.tbTica
       ORDER BY fecha DESC) AS tipoCambio;
  `);

  const row = result.recordset[0];
  if (!row?.idClieProv) throw new Error(`No existe cliente legacy activo para RUC ${input.cliente.numeroDocumento}.`);
  if (!row.formaPago) throw new Error(`No se encontro forma de pago legacy compatible con "${input.formaPago}".`);
  if (!row.idUnidad) throw new Error('No se encontro unidad legacy para detalle F03.');
  if (input.moneda === 'USD' && !Number(row.tipoCambio ?? 0)) {
    throw new Error('No se encontro tipo de cambio legacy para factura USD.');
  }

  return {
    idClieProv: row.idClieProv,
    idEmpleado: row.idEmpleado ?? 1,
    formaPago: row.formaPago,
    idUnidad: row.idUnidad,
    idDocumentoAnterior: row.idDocumentoAnterior ?? 0,
    tipoCambio: input.moneda === 'USD' ? Number(row.tipoCambio) : 1,
    cuenta,
    guiaLegacy
  };
}

async function validateLegacyFlexoF03Mirror(transaction: sql.Transaction, idDocumento: number, expectedItems: number) {
  const request = transaction.request();
  request.input('idDocumento', sql.Int, idDocumento);
  const result = await request.query<Record<string, unknown>>(`
    SELECT
      (SELECT COUNT(1) FROM dbo.tbDocumentos WHERE idDocumento = @idDocumento AND idTipoDocu = 38 AND SeriDocu = 'F03') AS headers,
      (SELECT COUNT(1) FROM dbo.tbDetFact WHERE idDocumento = @idDocumento) AS details,
      (SELECT COUNT(1) FROM dbo.TBCTACTE WHERE idDocumento = @idDocumento OR idDocAfectado = @idDocumento) AS ctaCte,
      (SELECT COUNT(1) FROM dbo.tbDocumentos_Y WHERE idDocumento = @idDocumento AND idTipoDocu = 38 AND SeriDocu = 'F03') AS headersY;
  `);
  const validation = result.recordset[0] ?? {};
  if (Number(validation.headers ?? 0) !== 1) throw new Error('No se creo cabecera legacy F03.');
  if (Number(validation.details ?? 0) !== expectedItems) throw new Error('No se creo el detalle legacy F03 esperado.');
  if (Number(validation.ctaCte ?? 0) !== 1) throw new Error('No se creo la cuenta corriente legacy F03.');
  if (Number(validation.headersY ?? 0) !== 1) throw new Error('No se creo la copia legacy tbDocumentos_Y F03.');
  return validation;
}

function effectiveDateByDays(fechaEmision: string, days: number) {
  const date = localDate(fechaEmision);
  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
}

function localDate(value: string) {
  return new Date(`${value.slice(0, 10)}T00:00:00-05:00`);
}

function legacyFlexoGuideNumber(serieNumeroGuia: string) {
  const match = /^T\d{3}-(\d{8})$/.exec(serieNumeroGuia.trim());
  return match ? match[1].slice(-7) : '';
}

function legacyFlexoGuideLabel(serieNumeroGuia: string) {
  const number = legacyFlexoGuideNumber(serieNumeroGuia);
  return number ? `003-${number}` : serieNumeroGuia.trim();
}

async function queryFacturaStatus(transaction: sql.Transaction, serieNumeroFactura: string) {
  const request = transaction.request();
  request.input('factura', sql.VarChar(13), serieNumeroFactura);
  const result = await request.query<Record<string, unknown>>(`
    SELECT
      (SELECT COUNT(1) FROM dbo.SPE_EINVOICEHEADER WHERE SERIENUMERO = @factura AND TIPODOCUMENTO = '01') AS headers,
      (SELECT COUNT(1) FROM dbo.SPE_EINVOICEDETAIL WHERE SERIENUMERO = @factura AND TIPODOCUMENTO = '01') AS details,
      (SELECT COUNT(1) FROM dbo.SPE_EINVOICEHEADER_ADD WHERE SERIENUMERO = @factura AND TIPODOCUMENTO = '01') AS headerAdd,
      (SELECT COUNT(1) FROM dbo.AAA_GUIAFACTURADA WHERE NRO_FACTURA = @factura) AS guiaLinks,
      (SELECT COUNT(1) FROM dbo.AAA_REGISTRO_CONTABLE WHERE serieNumero = @factura) AS registroContable,
      (SELECT COUNT(1) FROM dbo.EMPAQUE_DETALLE WHERE SERIENUMEROGUIAFACTURA = @factura) AS empaqueLinks,
      (SELECT TOP (1) bl_estadoRegistro FROM dbo.SPE_EINVOICEHEADER WHERE SERIENUMERO = @factura AND TIPODOCUMENTO = '01') AS estadoHeader;
  `);

  return result.recordset[0] ?? null;
}

function assertDeclaredStatus(status: Record<string, unknown> | null, expectedItems: number) {
  if (!status) throw new Error('No se pudo validar la factura insertada.');
  if (Number(status.headers ?? 0) !== 1) throw new Error('USP_CabeceraFE no dejo una cabecera FF03 valida.');
  if (Number(status.details ?? 0) !== expectedItems) throw new Error('USP_DetalleFE no dejo el detalle FF03 esperado.');
  if (Number(status.guiaLinks ?? 0) < 1) throw new Error('No se registro el vinculo guia-factura.');
  if (Number(status.registroContable ?? 0) !== 1) throw new Error('No se registro AAA_REGISTRO_CONTABLE.');
  if (Number(status.empaqueLinks ?? 0) !== expectedItems) throw new Error('No se vincularon todos los items de EMPAQUE_DETALLE a la factura.');
}

async function acquireAppLock(transaction: sql.Transaction, resource: string) {
  const request = transaction.request();
  request.input('Resource', sql.NVarChar(255), resource);
  request.input('LockMode', sql.VarChar(32), 'Exclusive');
  request.input('LockOwner', sql.VarChar(32), 'Transaction');
  request.input('LockTimeout', sql.Int, 10000);
  const result = await request.execute('sp_getapplock');
  const code = Number(result.returnValue ?? 0);
  if (code < 0) throw new Error(`No se pudo obtener bloqueo SQL ${resource}. Codigo ${code}.`);
}

async function rollbackQuietly(transaction: sql.Transaction) {
  try {
    await transaction.rollback();
  } catch {
    // Nothing else can be done safely after a rollback failure.
  }
}

function readPermissionWarning(source: string, error: unknown) {
  const message = error instanceof Error ? error.message : 'sin detalle';

  return `No se pudo validar ${source}: ${message}`;
}
