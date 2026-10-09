import type { AppConfig } from '../config/env.js';
import { getGreDefaults } from '../config/greDefaults.js';
import { createBizlinksPool, createYchiPool, sql } from '../integrations/bizlinksSql.js';
import {
  FLEXO_CREDIT_NOTE_SERIE,
  type FlexoCreditNotePreviewInput
} from '../schemas/flexoCreditNoteSchema.js';

type InvoiceHeader = {
  serieNumero: string;
  tipoDocumento: string;
  fechaEmision: string;
  numeroDocumentoAdquiriente: string;
  tipoDocumentoAdquiriente: string | null;
  razonSocialAdquiriente: string;
  tipoMoneda: string;
  totalValorVentaNetoOpGravadas: string | number | null;
  totalIgv: string | number | null;
  totalVenta: string | number | null;
  correoAdquiriente: string | null;
  direccionAdquiriente: string | null;
  ubigeoAdquiriente: string | null;
  urbanizacionAdquiriente: string | null;
  provinciaAdquiriente: string | null;
  departamentoAdquiriente: string | null;
  distritoAdquiriente: string | null;
  paisAdquiriente: string | null;
  vendedor: string | null;
};

type InvoiceDetail = {
  numeroOrdenItem: string | null;
  codigoProducto: string | null;
  descripcion: string | null;
  cantidad: string | number | null;
  unidadMedida: string | null;
  importeUnitarioSinImpuesto: string | number | null;
  importeUnitarioConImpuesto: string | number | null;
  importeTotalSinImpuesto: string | number | null;
  importeIgv: string | number | null;
  montoBaseIgv: string | number | null;
  tasaIgv: string | number | null;
  importeTotalImpuestos: string | number | null;
  codigoRazonExoneracion: string | null;
};

type GuiaLink = {
  NRO_GUIA: string | null;
  NRO_FACTURA: string | null;
  NOTACRE: string | null;
};

type MotivoNce = {
  codigo: string;
  descripcion: string;
  fullDocument: boolean;
};

type LegacySetup = {
  idClieProv: number;
  idFactura: number;
  moneda: 'S' | 'D';
  cuentaNc: number;
};

export type FlexoCreditNoteValidation = {
  code: string;
  severity: 'ok' | 'warning' | 'error';
  message: string;
};

export type FlexoCreditNoteInvoice = {
  serieNumeroFactura: string;
  fechaEmision: string | null;
  cliente: {
    tipoDocumento: string;
    numeroDocumento: string;
    razonSocial: string;
  };
  moneda: string;
  total: number;
  guias: string[];
  notacres: string[];
};

export interface FlexoCreditNoteService {
  searchFacturas(query: string): Promise<{ facturas: FlexoCreditNoteInvoice[] }>;
  getNextSerie(): Promise<{
    serie: typeof FLEXO_CREDIT_NOTE_SERIE;
    numero: string;
    serieNumeroNotaCredito: string;
    reserved: false;
    source: 'AAA_TIPODOCUMENTO';
  }>;
  preview(input: FlexoCreditNotePreviewInput): Promise<{
    writesDatabase: false;
    productionEnabled: false;
    serieNumeroNotaCredito: string;
    facturaAfectada: string;
    motivo: MotivoNce;
    cliente: string;
    moneda: string;
    totals: ReturnType<typeof resolveTotals>;
    guias: GuiaLink[];
    items: number;
    validations: FlexoCreditNoteValidation[];
  }>;
  declarar(input: FlexoCreditNotePreviewInput, options: { operationId: string; user?: string }): Promise<{
    operationId: string;
    serieNumeroNotaCredito: string;
    facturaAfectada: string;
    insertedHeader: boolean;
    insertedItems: number;
    activated: boolean;
    status: Record<string, unknown>;
    legacyMirror: Record<string, unknown>;
  }>;
}

export class DirectDbFlexoCreditNoteService implements FlexoCreditNoteService {
  constructor(private readonly config: AppConfig) {}

  async searchFacturas(query: string) {
    const normalized = query.trim();
    if (normalized.length < 2) return { facturas: [] };

    const pool = createBizlinksPool(this.config);
    await pool.connect();

    try {
      const request = new sql.Request(pool);
      request.input('query', sql.VarChar(250), `%${normalized}%`);

      const result = await request.query<{
        serieNumeroFactura: string;
        fechaEmision: string | null;
        tipoDocumentoAdquiriente: string | null;
        numeroDocumentoAdquiriente: string;
        razonSocialAdquiriente: string;
        tipoMoneda: string;
        totalVenta: string | number | null;
        guias: string | null;
        notacres: string | null;
      }>(`
        SET TRANSACTION ISOLATION LEVEL READ UNCOMMITTED;

        SELECT TOP (50)
          h.SERIENUMERO AS serieNumeroFactura,
          CONVERT(varchar(10), h.FECHAEMISION, 120) AS fechaEmision,
          h.TIPODOCUMENTOADQUIRIENTE AS tipoDocumentoAdquiriente,
          h.NUMERODOCUMENTOADQUIRIENTE AS numeroDocumentoAdquiriente,
          h.RAZONSOCIALADQUIRIENTE AS razonSocialAdquiriente,
          h.TIPOMONEDA AS tipoMoneda,
          h.TOTALVENTA AS totalVenta,
          STUFF((
            SELECT ',' + gf2.NRO_GUIA
            FROM dbo.AAA_GUIAFACTURADA gf2
            WHERE gf2.NRO_FACTURA = h.SERIENUMERO
            FOR XML PATH(''), TYPE
          ).value('.', 'varchar(max)'), 1, 1, '') AS guias,
          STUFF((
            SELECT ',' + gf3.NOTACRE
            FROM dbo.AAA_GUIAFACTURADA gf3
            WHERE gf3.NRO_FACTURA = h.SERIENUMERO
              AND ISNULL(gf3.NOTACRE, '') <> ''
            FOR XML PATH(''), TYPE
          ).value('.', 'varchar(max)'), 1, 1, '') AS notacres
        FROM dbo.SPE_EINVOICEHEADER h
        INNER JOIN dbo.SPE_EINVOICE_RESPONSE r
          ON r.NUMERODOCUMENTOEMISOR = h.NUMERODOCUMENTOEMISOR
         AND r.SERIENUMERO = h.SERIENUMERO
         AND r.TIPODOCUMENTO = h.TIPODOCUMENTO
        WHERE h.TIPODOCUMENTO = '01'
          AND h.SERIENUMERO LIKE 'FF03-%'
          AND (
            r.bl_estadoProceso LIKE '%AC_03%'
            OR r.bl_mensajeSunat LIKE '%"codigo":"0"%'
            OR r.bl_mensajeSunat LIKE '%aceptad%'
          )
          AND (
            h.SERIENUMERO LIKE @query
            OR h.NUMERODOCUMENTOADQUIRIENTE LIKE @query
            OR h.RAZONSOCIALADQUIRIENTE LIKE @query
          )
        ORDER BY h.FECHAEMISION DESC, h.SERIENUMERO DESC;
      `);

      return {
        facturas: result.recordset.map((row) => ({
          serieNumeroFactura: row.serieNumeroFactura,
          fechaEmision: row.fechaEmision,
          cliente: {
            tipoDocumento: row.tipoDocumentoAdquiriente?.trim() || '6',
            numeroDocumento: row.numeroDocumentoAdquiriente,
            razonSocial: row.razonSocialAdquiriente
          },
          moneda: row.tipoMoneda,
          total: num(row.totalVenta),
          guias: splitCsv(row.guias),
          notacres: splitCsv(row.notacres)
        }))
      };
    } finally {
      await pool.close();
    }
  }

  async getNextSerie() {
    const pool = createBizlinksPool(this.config);
    await pool.connect();

    try {
      const next = await getNextFc03(pool);
      return {
        serie: FLEXO_CREDIT_NOTE_SERIE as typeof FLEXO_CREDIT_NOTE_SERIE,
        numero: next.numero,
        serieNumeroNotaCredito: next.serieNumeroNotaCredito,
        reserved: false as const,
        source: 'AAA_TIPODOCUMENTO' as const
      };
    } finally {
      await pool.close();
    }
  }

  async preview(input: FlexoCreditNotePreviewInput) {
    const pool = createBizlinksPool(this.config);
    const ychiPool = createYchiPool(this.config);
    await pool.connect();
    await ychiPool.connect();

    try {
      const source = await loadSourceInvoice(pool, input.facturaAfectada, false);
      const next = await getNextFc03(pool);
      const motivo = resolveMotivo(input.motivo);
      const totals = resolveTotals(source.header, source.details);
      const legacyCheck = await checkLegacySourceInvoice(ychiPool, source.header, source.guiaLinks);
      const validations = validateCreditNoteInput(input, source, motivo, legacyCheck);

      return {
        writesDatabase: false as const,
        productionEnabled: false as const,
        serieNumeroNotaCredito: next.serieNumeroNotaCredito,
        facturaAfectada: input.facturaAfectada,
        motivo,
        cliente: `${source.header.numeroDocumentoAdquiriente} - ${source.header.razonSocialAdquiriente}`,
        moneda: source.header.tipoMoneda,
        totals,
        guias: source.guiaLinks,
        items: source.details.length,
        validations
      };
    } finally {
      await ychiPool.close();
      await pool.close();
    }
  }

  async declarar(input: FlexoCreditNotePreviewInput, options: { operationId: string; user?: string }) {
    const motivo = resolveMotivo(input.motivo);
    assertCreditNoteReady(input, motivo);

    const bizlinksPool = createBizlinksPool(this.config);
    const ychiPool = createYchiPool(this.config);
    await bizlinksPool.connect();
    await ychiPool.connect();

    let bizTransaction: sql.Transaction | undefined;
    let legacyTransaction: sql.Transaction | undefined;

    try {
      const source = await loadSourceInvoice(bizlinksPool, input.facturaAfectada, false);
      const totals = resolveTotals(source.header, source.details);

      bizTransaction = new sql.Transaction(bizlinksPool);
      await bizTransaction.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);
      await acquireAppLock(bizTransaction, `FLEXO_NCE:${options.operationId}`);
      await acquireAppLock(bizTransaction, 'FLEXO_NCE_FC03_CORRELATIVO');

      const next = await getNextFc03(bizTransaction);
      await assertCreditNoteDoesNotExist(bizTransaction, next.serieNumeroNotaCredito);
      await assertSourceInvoiceStillAvailable(bizTransaction, input.facturaAfectada);
      await executeBizlinksCreditNoteHeader(
        bizTransaction,
        this.config,
        source.header,
        next.serieNumeroNotaCredito,
        motivo,
        totals,
        input.observaciones
      );
      for (const [index, detail] of source.details.entries()) {
        await executeBizlinksCreditNoteDetail(bizTransaction, this.config, next.serieNumeroNotaCredito, detail, index);
      }
      await linkCreditNoteToGuides(bizTransaction, source.guiaLinks, next.serieNumeroNotaCredito);
      await syncFc03Correlative(bizTransaction, next.numero);

      legacyTransaction = new sql.Transaction(ychiPool);
      await legacyTransaction.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);
      await acquireAppLock(legacyTransaction, `FLEXO_LEGACY_NCE:${options.operationId}`);
      await acquireAppLock(legacyTransaction, 'FLEXO_LEGACY_NCE_FC03_CORRELATIVO');
      const legacyMirror = await mirrorLegacyCreditNote(
        legacyTransaction,
        source.header,
        source.guiaLinks,
        source.details,
        next.serieNumeroNotaCredito,
        motivo,
        totals,
        input.cuentaNc
      );

      await executeBizlinksActivate(bizTransaction, next.serieNumeroNotaCredito);
      const status = await queryCreditNoteStatus(bizTransaction, next.serieNumeroNotaCredito, input.facturaAfectada, source.details.length);

      await bizTransaction.commit();
      bizTransaction = undefined;
      await legacyTransaction.commit();
      legacyTransaction = undefined;

      return {
        operationId: options.operationId,
        serieNumeroNotaCredito: next.serieNumeroNotaCredito,
        facturaAfectada: input.facturaAfectada,
        insertedHeader: true,
        insertedItems: source.details.length,
        activated: true,
        status,
        legacyMirror
      };
    } catch (error) {
      if (bizTransaction) await rollbackQuietly(bizTransaction);
      if (legacyTransaction) await rollbackQuietly(legacyTransaction);
      throw error;
    } finally {
      await ychiPool.close();
      await bizlinksPool.close();
    }
  }
}

async function loadSourceInvoice(
  pool: sql.ConnectionPool,
  serieNumeroFactura: string,
  allowAlreadyCredited: boolean
) {
  const request = new sql.Request(pool);
  request.input('factura', sql.VarChar(13), serieNumeroFactura);
  const result = await request.query<InvoiceHeader | InvoiceDetail | GuiaLink>(`
    SET TRANSACTION ISOLATION LEVEL READ UNCOMMITTED;

    SELECT TOP (1)
      h.serieNumero,
      h.tipoDocumento,
      CONVERT(varchar(10), h.fechaEmision, 120) AS fechaEmision,
      h.numeroDocumentoAdquiriente,
      h.tipoDocumentoAdquiriente,
      h.razonSocialAdquiriente,
      h.tipoMoneda,
      h.totalValorVentaNetoOpGravadas,
      h.totalIgv,
      h.totalVenta,
      h.correoAdquiriente,
      MAX(CASE WHEN a.clave = 'direccionAdquiriente' THEN a.valor END) AS direccionAdquiriente,
      MAX(CASE WHEN a.clave = 'ubigeoAdquiriente' THEN a.valor END) AS ubigeoAdquiriente,
      MAX(CASE WHEN a.clave = 'urbanizacionAdquiriente' THEN a.valor END) AS urbanizacionAdquiriente,
      MAX(CASE WHEN a.clave = 'provinciaAdquiriente' THEN a.valor END) AS provinciaAdquiriente,
      MAX(CASE WHEN a.clave = 'departamentoAdquiriente' THEN a.valor END) AS departamentoAdquiriente,
      MAX(CASE WHEN a.clave = 'distritoAdquiriente' THEN a.valor END) AS distritoAdquiriente,
      MAX(CASE WHEN a.clave = 'paisAdquiriente' THEN a.valor END) AS paisAdquiriente,
      MAX(e.VENDEDOR) AS vendedor
    FROM dbo.SPE_EINVOICEHEADER h
    LEFT JOIN dbo.SPE_EINVOICEHEADER_ADD a
      ON a.numeroDocumentoEmisor = h.numeroDocumentoEmisor
     AND a.serieNumero = h.serieNumero
     AND a.tipoDocumento = h.tipoDocumento
    LEFT JOIN dbo.AAA_GUIAFACTURADA gf
      ON gf.NRO_FACTURA = h.serieNumero
    LEFT JOIN dbo.EMPAQUE_DETALLE ed
      ON ed.SERIENUMEROGUIAFACTURA = h.serieNumero
    LEFT JOIN dbo.EMPAQUE e
      ON e.CODIGOEMPAQUE = ed.CODIGOEMPAQUE
    LEFT JOIN dbo.SPE_EINVOICE_RESPONSE r
      ON r.numeroDocumentoEmisor = h.numeroDocumentoEmisor
     AND r.serieNumero = h.serieNumero
     AND r.tipoDocumento = h.tipoDocumento
    WHERE h.serieNumero = @factura
      AND h.tipoDocumento = '01'
      AND (
        r.bl_estadoProceso LIKE '%AC_03%'
        OR r.bl_mensajeSunat LIKE '%"codigo":"0"%'
        OR r.bl_mensajeSunat LIKE '%aceptad%'
      )
    GROUP BY
      h.serieNumero,
      h.tipoDocumento,
      h.fechaEmision,
      h.numeroDocumentoAdquiriente,
      h.tipoDocumentoAdquiriente,
      h.razonSocialAdquiriente,
      h.tipoMoneda,
      h.totalValorVentaNetoOpGravadas,
      h.totalIgv,
      h.totalVenta,
      h.correoAdquiriente;

    SELECT
      numeroOrdenItem,
      codigoProducto,
      descripcion,
      cantidad,
      unidadMedida,
      importeUnitarioSinImpuesto,
      importeUnitarioConImpuesto,
      importeTotalSinImpuesto,
      importeIgv,
      montoBaseIgv,
      tasaIgv,
      importeTotalImpuestos,
      codigoRazonExoneracion
    FROM dbo.SPE_EINVOICEDETAIL
    WHERE serieNumero = @factura
      AND tipoDocumento = '01'
    ORDER BY numeroOrdenItem;

    SELECT
      NRO_GUIA,
      NRO_FACTURA,
      NOTACRE
    FROM dbo.AAA_GUIAFACTURADA
    WHERE NRO_FACTURA = @factura
    ORDER BY ID;
  `);

  const header = result.recordsets[0]?.[0] as InvoiceHeader | undefined;
  const details = (result.recordsets[1] ?? []) as InvoiceDetail[];
  const guiaLinks = (result.recordsets[2] ?? []) as GuiaLink[];
  if (!header) throw new Error(`No se encontro factura FF03 aceptada para ${serieNumeroFactura}.`);
  if (details.length === 0) throw new Error(`La factura ${serieNumeroFactura} no tiene detalle Bizlinks.`);
  if (guiaLinks.length === 0) throw new Error(`La factura ${serieNumeroFactura} no tiene trazabilidad AAA_GUIAFACTURADA.`);
  const alreadyNce = guiaLinks.filter((row) => row.NOTACRE?.trim());
  if (alreadyNce.length > 0 && !allowAlreadyCredited) {
    throw new Error(`La factura ${serieNumeroFactura} ya tiene nota de credito: ${alreadyNce.map((row) => row.NOTACRE).join(', ')}.`);
  }

  return { header, details, guiaLinks };
}

async function getNextFc03(poolOrTransaction: sql.ConnectionPool | sql.Transaction) {
  const result = await poolOrTransaction.request().query<{ nextNumber: number }>(`
    SELECT TOP (1) ISNULL(CORRELATIVO, 0) + 1 AS nextNumber
    FROM dbo.AAA_TIPODOCUMENTO ${poolOrTransaction instanceof sql.Transaction ? 'WITH (UPDLOCK, HOLDLOCK)' : ''}
    WHERE SERIE = 'FC03'
      AND TIPODOCUMENTO = '07'
    ORDER BY CORRELATIVO DESC;
  `);
  const nextNumber = Number(result.recordset[0]?.nextNumber ?? 1);
  const numero = String(nextNumber).padStart(8, '0');
  return { numero, serieNumeroNotaCredito: `${FLEXO_CREDIT_NOTE_SERIE}-${numero}` };
}

function validateCreditNoteInput(
  input: FlexoCreditNotePreviewInput,
  source: { header: InvoiceHeader; details: InvoiceDetail[]; guiaLinks: GuiaLink[] },
  motivo: MotivoNce,
  legacyCheck: { idClieProv: number | null; idFactura: number | null }
): FlexoCreditNoteValidation[] {
  const alreadyNce = source.guiaLinks.filter((row) => row.NOTACRE?.trim());
  return [
    {
      code: 'FACTURA_ACEPTADA',
      severity: 'ok',
      message: `Factura afectada aceptada: ${input.facturaAfectada}.`
    },
    {
      code: 'MOTIVO_NCE',
      severity: motivo.fullDocument ? 'ok' : 'error',
      message: motivo.fullDocument
        ? `Motivo SUNAT ${motivo.codigo}: ${motivo.descripcion}.`
        : 'Devolucion por item requiere seleccion parcial de items antes de habilitar declaracion.'
    },
    {
      code: 'DETALLE_ORIGEN',
      severity: source.details.length > 0 ? 'ok' : 'error',
      message: `La nota usara ${source.details.length} item(s) desde la factura aceptada.`
    },
    {
      code: 'GUIA_FACTURADA',
      severity: source.guiaLinks.length > 0 ? 'ok' : 'error',
      message: 'La factura tiene relacion AAA_GUIAFACTURADA para marcar NOTACRE.'
    },
    {
      code: 'SIN_NCE_PREVIA',
      severity: alreadyNce.length === 0 ? 'ok' : 'error',
      message: alreadyNce.length === 0
        ? 'La factura aun no tiene NOTACRE registrado.'
        : `La factura ya tiene NOTACRE: ${alreadyNce.map((row) => row.NOTACRE).join(', ')}.`
    },
    {
      code: 'CUENTA_NC',
      severity: /^\d+$/.test(input.cuentaNc) ? 'ok' : 'error',
      message: `Cuenta NC: ${input.cuentaNc}.`
    },
    {
      code: 'LEGACY_F03',
      severity: legacyCheck.idClieProv && legacyCheck.idFactura ? 'ok' : 'error',
      message: legacyCheck.idClieProv && legacyCheck.idFactura
        ? `Factura legacy F03 encontrada: idDocumento ${legacyCheck.idFactura}.`
        : 'No se encontro factura legacy F03/FF03 en YCHIDB3 para la factura afectada.'
    }
  ];
}

async function checkLegacySourceInvoice(pool: sql.ConnectionPool, source: InvoiceHeader, guiaLinks: GuiaLink[]) {
  const request = new sql.Request(pool);
  request.input('ruc', sql.VarChar(20), source.numeroDocumentoAdquiriente);
  request.input('facturaNumero', sql.VarChar(8), source.serieNumero.slice(-8).slice(-7));
  request.input('facturaElectronica', sql.VarChar(13), source.serieNumero);
  request.input('fechaEmision', sql.VarChar(10), source.fechaEmision.slice(0, 10));
  request.input('total', sql.Decimal(18, 2), num(source.totalVenta));
  const guideParams = legacyGuideLabels(guiaLinks).map((value, index) => {
    const name = `guide${index}`;
    request.input(name, sql.VarChar(20), value);
    return `@${name}`;
  });
  const guidePredicate = guideParams.length > 0
    ? guideParams.map((param) => `d.nguia LIKE '%' + ${param} + '%'`).join(' OR ')
    : '1 = 0';

  const result = await request.query<{
    idClieProv: number | null;
    idFactura: number | null;
  }>(`
    SET TRANSACTION ISOLATION LEVEL READ UNCOMMITTED;

    SELECT
      (SELECT TOP (1) idClieProv
       FROM dbo.tbClieProv
       WHERE RUC = @ruc AND tipoClieProv = 'C' AND Estado = 'A'
       ORDER BY CASE WHEN origen = 'Y' THEN 0 ELSE 1 END, idClieProv DESC) AS idClieProv,
      (SELECT TOP (1) idDocumento
       FROM dbo.tbDocumentos d
       INNER JOIN dbo.tbClieProv c ON c.idClieProv = d.idClieProv
       WHERE d.idTipoDocu IN (38, 43)
         AND c.RUC = @ruc
         AND (
           (
             (d.SeriDocu IN ('F03', 'FF03') OR d.correo = @facturaElectronica)
             AND (
               RIGHT('0000000' + LTRIM(RTRIM(d.NumeDocu)), 7) = @facturaNumero
               OR d.correo = @facturaElectronica
             )
           )
           OR (
             d.idTipoDocu = 38
             AND d.SeriDocu = 'F03'
             AND ABS(CONVERT(decimal(18,2), d.Total) - @total) <= 0.02
             AND ABS(DATEDIFF(day, d.FechaEmision, CONVERT(date, @fechaEmision))) <= 2
             AND (${guidePredicate})
           )
         )
       ORDER BY d.idDocumento DESC) AS idFactura;
  `);

  return result.recordset[0] ?? { idClieProv: null, idFactura: null };
}

function assertCreditNoteReady(input: FlexoCreditNotePreviewInput, motivo: MotivoNce) {
  if (!motivo.fullDocument) {
    throw new Error('La devolucion por item aun no esta habilitada para declarar desde Flexo; requiere seleccion parcial de detalle.');
  }
  if (!/^\d+$/.test(input.cuentaNc)) throw new Error('La cuenta contable NC debe ser numerica.');
}

async function assertSourceInvoiceStillAvailable(transaction: sql.Transaction, facturaAfectada: string) {
  const request = transaction.request();
  request.input('factura', sql.VarChar(13), facturaAfectada);
  const result = await request.query<{ already: number; accepted: number }>(`
    SELECT
      (SELECT COUNT(1) FROM dbo.AAA_GUIAFACTURADA WITH (UPDLOCK, HOLDLOCK) WHERE NRO_FACTURA = @factura AND ISNULL(NOTACRE, '') <> '') AS already,
      (SELECT COUNT(1)
       FROM dbo.SPE_EINVOICEHEADER h WITH (UPDLOCK, HOLDLOCK)
       INNER JOIN dbo.SPE_EINVOICE_RESPONSE r WITH (UPDLOCK, HOLDLOCK)
         ON r.NUMERODOCUMENTOEMISOR = h.NUMERODOCUMENTOEMISOR
        AND r.SERIENUMERO = h.SERIENUMERO
        AND r.TIPODOCUMENTO = h.TIPODOCUMENTO
       WHERE h.SERIENUMERO = @factura
         AND h.TIPODOCUMENTO = '01'
         AND (
           r.bl_estadoProceso LIKE '%AC_03%'
           OR r.bl_mensajeSunat LIKE '%"codigo":"0"%'
           OR r.bl_mensajeSunat LIKE '%aceptad%'
         )) AS accepted;
  `);
  const row = result.recordset[0];
  if (Number(row?.accepted ?? 0) !== 1) throw new Error(`La factura ${facturaAfectada} ya no figura como aceptada.`);
  if (Number(row?.already ?? 0) > 0) throw new Error(`La factura ${facturaAfectada} ya tiene NOTACRE.`);
}

async function executeBizlinksCreditNoteHeader(
  transaction: sql.Transaction,
  config: AppConfig,
  source: InvoiceHeader,
  serieNumeroNota: string,
  motivo: MotivoNce,
  totals: ReturnType<typeof resolveTotals>,
  observaciones: string
) {
  const defaults = getGreDefaults(config);
  const request = transaction.request();
  request.input('correoEmisor', sql.VarChar(100), defaults.remitente.correo);
  request.input('correoAdquiriente', sql.VarChar(100), source.correoAdquiriente?.trim() || '-');
  request.input('numeroDocumentoEmisor', sql.VarChar(20), defaults.remitente.numeroDocumento);
  request.input('tipoDocumentoEmisor', sql.VarChar(1), defaults.remitente.tipoDocumento);
  request.input('tipoDocumento', sql.VarChar(2), '07');
  request.input('razonSocialEmisor', sql.VarChar(100), defaults.remitente.razonSocial);
  request.input('nombreComercialEmisor', sql.VarChar(100), defaults.remitente.razonSocial);
  request.input('serieNumero', sql.VarChar(13), serieNumeroNota);
  request.input('fechaEmision', sql.VarChar(10), currentLimaDate());
  request.input('ubigeoEmisor', sql.VarChar(6), '150115');
  request.input('direccionEmisor', sql.VarChar(100), defaults.puntoPartida.direccion.slice(0, 100));
  request.input('urbanizacion', sql.VarChar(25), 'FUNDO MATUTE');
  request.input('provinciaEmisor', sql.VarChar(30), 'LIMA');
  request.input('departamentoEmisor', sql.VarChar(30), 'LIMA');
  request.input('distritoEmisor', sql.VarChar(30), 'LA VICTORIA');
  request.input('paisEmisor', sql.VarChar(2), 'PE');
  request.input('numeroDocumentoAdquiriente', sql.VarChar(15), source.numeroDocumentoAdquiriente);
  request.input('tipoDocumentoAdquiriente', sql.VarChar(1), source.tipoDocumentoAdquiriente?.trim() || '6');
  request.input('razonSocialAdquiriente', sql.VarChar(100), source.razonSocialAdquiriente.slice(0, 100));
  request.input('tipoMoneda', sql.VarChar(3), source.tipoMoneda);
  request.input('totalValorVentaNetoOpGravadas', sql.VarChar(15), money(totals.gravada));
  request.input('totalValorVentaNetoOpNoGravada', sql.Numeric(12, 2), 0);
  request.input('totalValorVentaNetoOpExonerada', sql.Numeric(12, 2), 0);
  request.input('totalValorVentaNetoOpGratuitas', sql.Numeric(15, 2), 0);
  request.input('totalIgv', sql.VarChar(15), money(totals.igv));
  request.input('totaldescuentos', sql.Numeric(12, 2), 0);
  request.input('totalVenta', sql.VarChar(15), money(totals.total));
  request.input('codigoLeyenda_1', sql.VarChar(4), '1000');
  request.input('textoLeyenda_1', sql.VarChar(200), amountWordsPlaceholder(totals.total, source.tipoMoneda));
  request.input('codigoSerieNumeroAfectado', sql.VarChar(2), motivo.codigo);
  request.input('serieNumeroAfectado', sql.VarChar(13), source.serieNumero);
  request.input('motivoDocumento', sql.VarChar(500), (observaciones.trim() || motivo.descripcion).slice(0, 500));
  request.input('tipoDocumentoReferenciaPrincip', sql.VarChar(2), '01');
  request.input('numeroDocumentoReferenciaPrinc', sql.VarChar(13), source.serieNumero);
  request.input('direccionAdquiriente', sql.VarChar(100), source.direccionAdquiriente?.trim().slice(0, 100) || '-');
  request.input('ubigeoAdquiriente', sql.VarChar(6), source.ubigeoAdquiriente?.trim().slice(0, 6) || '-');
  request.input('urbanizacionAdquiriente', sql.VarChar(25), source.urbanizacionAdquiriente?.trim().slice(0, 25) || '-');
  request.input('provinciaAdquiriente', sql.VarChar(30), source.provinciaAdquiriente?.trim().slice(0, 30) || '-');
  request.input('departamentoAdquiriente', sql.VarChar(30), source.departamentoAdquiriente?.trim().slice(0, 30) || '-');
  request.input('distritoAdquiriente', sql.VarChar(30), source.distritoAdquiriente?.trim().slice(0, 30) || '-');
  request.input('paisAdquiriente', sql.VarChar(30), source.paisAdquiriente?.trim().slice(0, 30) || 'PE');
  request.input('montodescuentog', sql.VarChar(15), '0');
  request.input('textoLeyenda_20', sql.VarChar(15), source.fechaEmision);
  request.input('lblvendedor', sql.VarChar(15), source.vendedor?.trim().slice(0, 15) || 'OFICINA');
  request.input('horaEmision', sql.VarChar(10), currentLimaTime());
  await request.execute('dbo.SPI_NCREDITO_ELECTRONICA');
}

async function executeBizlinksCreditNoteDetail(
  transaction: sql.Transaction,
  config: AppConfig,
  serieNumeroNota: string,
  detail: InvoiceDetail,
  index: number
) {
  const defaults = getGreDefaults(config);
  const request = transaction.request();
  request.input('NUMERODOCUMENTOEMISOR', sql.NVarChar(20), defaults.remitente.numeroDocumento);
  request.input('SERIENUMERO', sql.NVarChar(13), serieNumeroNota);
  request.input('TIPODOCUMENTO', sql.NVarChar(2), '07');
  request.input('TIPODOCUMENTOEMISOR', sql.NVarChar(1), defaults.remitente.tipoDocumento);
  request.input('NUMEROORDENITEM', sql.NVarChar(4), String(index + 1));
  request.input('CANTIDAD', sql.NVarChar(25), String(detail.cantidad ?? '0'));
  request.input('CODIGOPRODUCTO', sql.NVarChar(30), detail.codigoProducto?.trim().slice(0, 30) || '-');
  request.input('CODIGORAZONEXONERACION', sql.NVarChar(2), detail.codigoRazonExoneracion?.trim() || '10');
  request.input('DESCRIPCION', sql.NVarChar(1700), detail.descripcion?.trim().slice(0, 1700) || '-');
  request.input('IMPORTEDESCUENTO', sql.NVarChar(25), '0.00');
  request.input('importeTotalSinImpuesto', sql.NVarChar(15), money(num(detail.importeTotalSinImpuesto)));
  request.input('importeUnitarioConImpuesto', sql.NVarChar(25), money(num(detail.importeUnitarioConImpuesto)));
  request.input('importeUnitarioSinImpuesto', sql.NVarChar(25), num(detail.importeUnitarioSinImpuesto).toFixed(5));
  request.input('CODIGOIMPORTEREFERENCIAL', sql.NVarChar(15), null);
  request.input('IMPORTEREFERENCIAL', sql.NVarChar(15), null);
  request.input('UNIDADMEDIDA', sql.NVarChar(5), normalizeUnit(detail.unidadMedida ?? 'NIU'));
  request.input('codigoImporteUnitarioConImpuesto', sql.NVarChar(2), '01');
  request.input('ImporteIGV', sql.NVarChar(15), money(num(detail.importeIgv)));
  request.input('ImporteISC', sql.NVarChar(15), '0.00');
  request.input('importeCargo', sql.NVarChar(15), '0.00');
  request.input('codigoProductoSUNAT', sql.NVarChar(30), null);
  request.input('montoBaseIgv', sql.NVarChar(15), money(num(detail.montoBaseIgv || detail.importeTotalSinImpuesto)));
  request.input('tasaIGV', sql.NVarChar(15), money(num(detail.tasaIgv) || 18));
  request.input('importeTotalImpuestos', sql.NVarChar(15), money(num(detail.importeTotalImpuestos || detail.importeIgv)));
  request.input('importeBaseDescuento', sql.NVarChar(15), '0.00');
  request.input('factorDescuento', sql.NVarChar(4), '0.00');
  request.input('textoAuxiliar250_1', sql.NVarChar(250), '');
  request.input('textoAuxiliar250_2', sql.NVarChar(250), '');
  request.input('textoAuxiliar250_3', sql.NVarChar(250), '');
  request.input('textoAuxiliar250_4', sql.NVarChar(250), '');
  request.input('textoAuxiliar250_5', sql.NVarChar(250), '');
  request.input('textoAuxiliar250_6', sql.NVarChar(250), '');
  request.input('textoAuxiliar250_7', sql.NVarChar(250), '');
  request.input('textoAuxiliar250_8', sql.NVarChar(250), '');
  request.input('textoAuxiliar250_9', sql.NVarChar(250), '');
  request.input('textoAuxiliar500_1', sql.NVarChar(250), '');
  await request.execute('dbo.USP_DetalleFE');
}

async function linkCreditNoteToGuides(transaction: sql.Transaction, guiaLinks: GuiaLink[], serieNumeroNota: string) {
  for (const guide of guiaLinks) {
    const request = transaction.request();
    request.input('guia', sql.VarChar(13), guide.NRO_GUIA);
    request.input('factura', sql.VarChar(13), guide.NRO_FACTURA);
    request.input('nota', sql.VarChar(13), serieNumeroNota);
    await request.query(`
      UPDATE dbo.AAA_GUIAFACTURADA
      SET NOTACRE = @nota
      WHERE NRO_GUIA = @guia
        AND NRO_FACTURA = @factura
        AND NOTACRE IS NULL;
    `);
  }
}

async function executeBizlinksActivate(transaction: sql.Transaction, serieNumeroNota: string) {
  const request = transaction.request();
  request.input('NUMERODOCUMENTOEMISOR', sql.NVarChar(20), '20259402965');
  request.input('SERIENUMERO', sql.NVarChar(13), serieNumeroNota);
  request.input('TIPODOCUMENTO', sql.NVarChar(2), '07');
  await request.execute('dbo.USP_EnviaDocumentoFE');
}

async function syncFc03Correlative(transaction: sql.Transaction, numero: string) {
  const request = transaction.request();
  request.input('numero', sql.Int, Number(numero));
  await request.query(`
    UPDATE dbo.AAA_TIPODOCUMENTO
    SET CORRELATIVO = @numero
    WHERE SERIE = 'FC03'
      AND TIPODOCUMENTO = '07'
      AND ISNULL(CORRELATIVO, 0) < @numero;
  `);
}

async function mirrorLegacyCreditNote(
  transaction: sql.Transaction,
  source: InvoiceHeader,
  guiaLinks: GuiaLink[],
  details: InvoiceDetail[],
  serieNumeroNota: string,
  motivo: MotivoNce,
  totals: ReturnType<typeof resolveTotals>,
  cuentaNc: string
) {
  const setup = await resolveLegacySetup(transaction, source, guiaLinks, cuentaNc);
  const request = transaction.request();
  request.input('idClieProv', sql.Int, setup.idClieProv);
  request.input('idfactura', sql.Int, setup.idFactura);
  request.input('Factura', sql.VarChar(25), source.serieNumero);
  request.input('Moneda', sql.Char(1), setup.moneda);
  request.input('Neto', sql.Money, totals.gravada);
  request.input('Igv', sql.Money, totals.igv);
  request.input('Total', sql.Money, totals.total);
  request.input('Letras', sql.VarChar(150), `${motivo.descripcion} ${source.serieNumero}`.slice(0, 150));
  request.output('idDocumento', sql.Int, 0);
  request.output('NumeDocu', sql.VarChar(15), '');
  request.input('cuentanc', sql.Int, setup.cuentaNc);
  request.input('origen', sql.Char(1), 'Y');
  request.input('fenumero', sql.VarChar(13), serieNumeroNota);
  const result = await request.execute('dbo.SPI_NOTA_CREDITO_ELECTRONICA_FC03');
  const idDocumento = Number(result.output.idDocumento);
  const legacyNumber = String(result.output.NumeDocu ?? '').trim();
  if (!idDocumento || !legacyNumber) throw new Error('El SP legacy NCE no devolvio idDocumento/NumeDocu.');

  for (const detail of details) {
    const detailRequest = transaction.request();
    detailRequest.input('idNotaCredito', sql.Int, idDocumento);
    detailRequest.input('Descripcion', sql.VarChar(490), (detail.descripcion ?? '-').slice(0, 490));
    detailRequest.input('Cantidad', sql.Decimal(18, 2), num(detail.cantidad));
    detailRequest.input('Precio', sql.Money, num(detail.importeUnitarioSinImpuesto));
    await detailRequest.execute('dbo.SPI_DETNOTA_CREDITO');
  }

  const validation = await validateLegacyMirror(transaction, idDocumento, details.length);
  return {
    idDocumento,
    legacySerieNumero: `C03-${legacyNumber}`,
    electronicSerieNumero: serieNumeroNota,
    validation
  };
}

async function resolveLegacySetup(
  transaction: sql.Transaction,
  source: InvoiceHeader,
  guiaLinks: GuiaLink[],
  cuentaNc: string
): Promise<LegacySetup> {
  const request = transaction.request();
  request.input('ruc', sql.VarChar(20), source.numeroDocumentoAdquiriente);
  request.input('facturaNumero', sql.VarChar(8), source.serieNumero.slice(-8).slice(-7));
  request.input('facturaElectronica', sql.VarChar(13), source.serieNumero);
  request.input('fechaEmision', sql.VarChar(10), source.fechaEmision.slice(0, 10));
  request.input('total', sql.Decimal(18, 2), num(source.totalVenta));
  const guideParams = legacyGuideLabels(guiaLinks).map((value, index) => {
    const name = `guide${index}`;
    request.input(name, sql.VarChar(20), value);
    return `@${name}`;
  });
  const guidePredicate = guideParams.length > 0
    ? guideParams.map((param) => `d.nguia LIKE '%' + ${param} + '%'`).join(' OR ')
    : '1 = 0';

  const result = await request.query<{
    idClieProv: number | null;
    idFactura: number | null;
  }>(`
    SELECT
      (SELECT TOP (1) idClieProv
       FROM dbo.tbClieProv WITH (UPDLOCK, HOLDLOCK)
       WHERE RUC = @ruc AND tipoClieProv = 'C' AND Estado = 'A'
       ORDER BY CASE WHEN origen = 'Y' THEN 0 ELSE 1 END, idClieProv DESC) AS idClieProv,
      (SELECT TOP (1) idDocumento
       FROM dbo.tbDocumentos d WITH (UPDLOCK, HOLDLOCK)
       INNER JOIN dbo.tbClieProv c ON c.idClieProv = d.idClieProv
       WHERE d.idTipoDocu IN (38, 43)
         AND c.RUC = @ruc
         AND (
           (
             (d.SeriDocu IN ('F03', 'FF03') OR d.correo = @facturaElectronica)
             AND (
               RIGHT('0000000' + LTRIM(RTRIM(d.NumeDocu)), 7) = @facturaNumero
               OR d.correo = @facturaElectronica
             )
           )
           OR (
             d.idTipoDocu = 38
             AND d.SeriDocu = 'F03'
             AND ABS(CONVERT(decimal(18,2), d.Total) - @total) <= 0.02
             AND ABS(DATEDIFF(day, d.FechaEmision, CONVERT(date, @fechaEmision))) <= 2
             AND (${guidePredicate})
           )
         )
       ORDER BY d.idDocumento DESC) AS idFactura;
  `);
  const row = result.recordset[0];
  if (!row?.idClieProv) throw new Error(`No existe cliente legacy activo para RUC ${source.numeroDocumentoAdquiriente}.`);
  if (!row.idFactura) throw new Error(`No existe factura legacy F03/FF03 para ${source.serieNumero}.`);

  return {
    idClieProv: row.idClieProv,
    idFactura: row.idFactura,
    moneda: source.tipoMoneda === 'USD' ? 'D' : 'S',
    cuentaNc: Number(cuentaNc)
  };
}

async function validateLegacyMirror(transaction: sql.Transaction, idDocumento: number, expectedItems: number) {
  const request = transaction.request();
  request.input('idDocumento', sql.Int, idDocumento);
  const result = await request.query<Record<string, unknown>>(`
    SELECT
      (SELECT COUNT(1) FROM dbo.tbDocumentos WHERE idDocumento = @idDocumento AND idTipoDocu = 41 AND SeriDocu = 'C03') AS headers,
      (SELECT COUNT(1) FROM dbo.tbDetNotaCredito WHERE idDocumento = @idDocumento) AS details,
      (SELECT COUNT(1) FROM dbo.TBCTACTE WHERE idDocumento = @idDocumento OR idDocAfectado = @idDocumento) AS ctaCte,
      (SELECT COUNT(1) FROM dbo.tbDocumentos_Y WHERE idDocumento = @idDocumento AND idTipoDocu = 41 AND SeriDocu = 'C03') AS headersY;
  `);
  const row = result.recordset[0] ?? {};
  if (Number(row.headers ?? 0) !== 1) throw new Error('No se creo cabecera legacy C03.');
  if (Number(row.details ?? 0) !== expectedItems) throw new Error('No se creo detalle legacy tbDetNotaCredito esperado.');
  if (Number(row.ctaCte ?? 0) !== 1) throw new Error('No se creo cuenta corriente legacy de NCE.');
  if (Number(row.headersY ?? 0) !== 1) throw new Error('No se creo copia legacy tbDocumentos_Y C03.');
  return row;
}

async function assertCreditNoteDoesNotExist(transaction: sql.Transaction, serieNumeroNota: string) {
  const request = transaction.request();
  request.input('nota', sql.VarChar(13), serieNumeroNota);
  const result = await request.query<{ total: number }>(`
    SELECT
      (SELECT COUNT(1) FROM dbo.SPE_EINVOICEHEADER WITH (UPDLOCK, HOLDLOCK) WHERE SERIENUMERO = @nota AND TIPODOCUMENTO = '07')
      + (SELECT COUNT(1) FROM dbo.SPE_EINVOICEDETAIL WITH (UPDLOCK, HOLDLOCK) WHERE SERIENUMERO = @nota AND TIPODOCUMENTO = '07')
      + (SELECT COUNT(1) FROM dbo.SPE_EINVOICE_RESPONSE WITH (UPDLOCK, HOLDLOCK) WHERE SERIENUMERO = @nota AND TIPODOCUMENTO = '07')
      + (SELECT COUNT(1) FROM dbo.AAA_GUIAFACTURADA WITH (UPDLOCK, HOLDLOCK) WHERE NOTACRE = @nota) AS total;
  `);
  if (Number(result.recordset[0]?.total ?? 0) > 0) throw new Error(`La nota ${serieNumeroNota} ya existe o tiene trazas.`);
}

async function queryCreditNoteStatus(
  transaction: sql.Transaction,
  serieNumeroNota: string,
  facturaAfectada: string,
  expectedItems: number
) {
  const request = transaction.request();
  request.input('nota', sql.VarChar(13), serieNumeroNota);
  request.input('factura', sql.VarChar(13), facturaAfectada);
  const result = await request.query<Record<string, unknown>>(`
    SELECT
      (SELECT COUNT(1) FROM dbo.SPE_EINVOICEHEADER WHERE SERIENUMERO = @nota AND TIPODOCUMENTO = '07') AS headers,
      (SELECT COUNT(1) FROM dbo.SPE_EINVOICEDETAIL WHERE SERIENUMERO = @nota AND TIPODOCUMENTO = '07') AS details,
      (SELECT COUNT(1) FROM dbo.SPE_EINVOICEHEADER_ADD WHERE SERIENUMERO = @nota AND TIPODOCUMENTO = '07') AS headerAdd,
      (SELECT COUNT(1) FROM dbo.SPE_EINVOICE_RESPONSE WHERE SERIENUMERO = @nota AND TIPODOCUMENTO = '07') AS responses,
      (SELECT COUNT(1) FROM dbo.AAA_GUIAFACTURADA WHERE NRO_FACTURA = @factura AND NOTACRE = @nota) AS guiaLinks,
      (SELECT TOP (1) bl_estadoRegistro FROM dbo.SPE_EINVOICEHEADER WHERE SERIENUMERO = @nota AND TIPODOCUMENTO = '07') AS estadoHeader,
      (SELECT TOP (1) numeroDocumentoReferenciaPrinc FROM dbo.SPE_EINVOICEHEADER WHERE SERIENUMERO = @nota AND TIPODOCUMENTO = '07') AS facturaAfectada,
      (SELECT TOP (1) tipoDocumentoReferenciaPrincip FROM dbo.SPE_EINVOICEHEADER WHERE SERIENUMERO = @nota AND TIPODOCUMENTO = '07') AS tipoReferencia,
      (SELECT TOP (1) codigoSerieNumeroAfectado FROM dbo.SPE_EINVOICEHEADER WHERE SERIENUMERO = @nota AND TIPODOCUMENTO = '07') AS motivoCodigo;
  `);
  const row = result.recordset[0] ?? {};
  if (Number(row.headers ?? 0) !== 1) throw new Error('No se creo cabecera NCE Bizlinks.');
  if (Number(row.details ?? 0) !== expectedItems) throw new Error('No se creo el detalle NCE Bizlinks esperado.');
  if (Number(row.guiaLinks ?? 0) <= 0) throw new Error('No se vinculo AAA_GUIAFACTURADA.NOTACRE.');
  if (String(row.estadoHeader ?? '') !== 'A') throw new Error('La cabecera NCE no quedo activada.');
  if (String(row.facturaAfectada ?? '') !== facturaAfectada) throw new Error('La NCE no referencia la factura afectada esperada.');
  return row;
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
    // Best effort rollback.
  }
}

function resolveTotals(header: InvoiceHeader, details: InvoiceDetail[]) {
  const detailGravada = roundMoney(details.reduce((sum, item) => sum + num(item.importeTotalSinImpuesto), 0));
  const detailIgv = roundMoney(details.reduce((sum, item) => sum + num(item.importeIgv), 0));
  const gravada = detailGravada || num(header.totalValorVentaNetoOpGravadas);
  const igv = detailIgv || num(header.totalIgv);
  const total = roundMoney(gravada + igv) || num(header.totalVenta);
  return { gravada, igv, total };
}

function resolveMotivo(value: FlexoCreditNotePreviewInput['motivo']): MotivoNce {
  const motives: Record<FlexoCreditNotePreviewInput['motivo'], MotivoNce> = {
    anulacion: { codigo: '01', descripcion: 'Anulacion de la operacion', fullDocument: true },
    ruc: { codigo: '02', descripcion: 'Anulacion por error en el RUC', fullDocument: true },
    total: { codigo: '06', descripcion: 'Devolucion total', fullDocument: true },
    item: { codigo: '07', descripcion: 'Devolucion por item', fullDocument: false }
  };
  return motives[value];
}

function normalizeUnit(value: string) {
  const unit = value.trim().toUpperCase();
  if (unit === 'UND' || unit === 'UNIDAD' || unit === 'ROLLS' || unit === 'ROLLOS' || unit === 'ROLLO' || unit === 'ROL' || unit === 'ROLL') return 'NIU';
  if (unit === 'MILLAR' || unit === 'MLL') return 'MIL';
  return unit || 'NIU';
}

function amountWordsPlaceholder(total: number, moneda: string) {
  const currency = moneda === 'USD' ? 'DOLARES AMERICANOS' : 'SOLES';
  return `IMPORTE ${total.toFixed(2)} ${currency}`.slice(0, 200);
}

function currentLimaDate() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Lima',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(new Date());
  const lookup = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${lookup.year}-${lookup.month}-${lookup.day}`;
}

function currentLimaTime() {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'America/Lima',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  }).formatToParts(new Date());
  const lookup = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${lookup.hour}:${lookup.minute}:${lookup.second}`;
}

function splitCsv(value: string | null) {
  return (value ?? '').split(',').map((item) => item.trim()).filter(Boolean);
}

function legacyGuideLabels(guiaLinks: GuiaLink[]) {
  return [...new Set(guiaLinks
    .map((guide) => {
      const value = guide.NRO_GUIA?.trim() ?? '';
      const match = /^T\d{3}-(\d{8})$/.exec(value);
      return match ? `003-${match[1].slice(-7)}` : '';
    })
    .filter(Boolean))];
}

function num(value: string | number | null | undefined) {
  const parsed = Number(String(value ?? '0').replace(',', '.'));
  return Number.isFinite(parsed) ? parsed : 0;
}

function money(value: number) {
  return roundMoney(value).toFixed(2);
}

function roundMoney(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}
