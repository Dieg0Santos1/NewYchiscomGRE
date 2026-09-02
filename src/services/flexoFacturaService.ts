import type { AppConfig } from '../config/env.js';
import { createBizlinksPool, createYchiPool, sql } from '../integrations/bizlinksSql.js';
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
    source: 'BIZLINKS_SPE_EINVOICEHEADER';
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
  bl_estadoProceso: string | null;
  bl_mensaje: string | null;
  bl_mensajeSunat: string | null;
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

function roundMoney(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function readPermissionWarning(source: string, error: unknown) {
  const message = error instanceof Error ? error.message : 'sin detalle';

  return `No se pudo validar ${source}: ${message}`;
}
