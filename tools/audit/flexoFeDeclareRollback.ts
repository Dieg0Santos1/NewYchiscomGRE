import { randomUUID } from 'node:crypto';
import { getGreDefaults } from '../../src/config/greDefaults.js';
import { loadEnv } from '../../src/config/env.js';
import { createBizlinksPool, sql } from '../../src/integrations/bizlinksSql.js';
import { toFcFacturaProcedurePlan } from '../../src/mappers/fcFacturaProcedureMapper.js';
import type { StoredProcedureParam } from '../../src/mappers/speDespatchProcedureMapper.js';
import type { FcFacturaPreviewInput } from '../../src/schemas/fcFacturaSchema.js';

type GuideItemRow = {
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
  codigoEmpaque: number | null;
  ordenGuia: string | null;
  ordenCompra: string | null;
};

const args = parseArgs(process.argv.slice(2));

async function main() {
  const config = loadEnv();
  const pool = createBizlinksPool(config);
  await pool.connect();

  let transaction: sql.Transaction | undefined;

  try {
    const guideItems = args.guia
      ? await loadAcceptedGuideItems(pool, args.guia)
      : await loadLatestPendingAcceptedGuideItems(pool);

    if (guideItems.length === 0) {
      throw new Error('No se encontro una GRE Flexo aceptada y pendiente de facturar.');
    }

    const first = guideItems[0]!;
    const next = await getNextFf03(pool);
    const payload = buildPayload(first, guideItems, next);
    const totals = calculateTotals(payload.items);
    const plan = toFcFacturaProcedurePlan(payload, getGreDefaults(config), totals);
    setParam(plan.USP_CabeceraFE, 'BL_ORIGEN', 'W');
    setParam(plan.USP_CabeceraFE, 'textoAuxiliar40_1', 'OFICINA FLEXO');
    for (const detailParams of plan.USP_DetalleFE) {
      setParam(detailParams, 'textoAuxiliar250_1', null);
    }

    transaction = new sql.Transaction(pool);
    await transaction.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);
    await acquireAppLock(transaction, `FLEXO_FE_ROLLBACK_${next.serieNumeroFactura}`);

    await assertFacturaDoesNotExist(transaction, next.serieNumeroFactura);
    await assertGuideStillAvailable(transaction, first.serieNumeroGuia);

    await executeStoredProcedure(transaction, 'dbo.USP_CabeceraFE', plan.USP_CabeceraFE);
    for (const detailParams of plan.USP_DetalleFE) {
      await executeStoredProcedure(transaction, 'dbo.USP_DetalleFE', detailParams);
    }

    await insertGuiaFacturada(transaction, first.serieNumeroGuia, next.serieNumeroFactura);
    await insertRegistroContable(transaction, payload.cuenta, next.serieNumeroFactura);
    await executeStoredProcedure(transaction, 'dbo.USP_EnviaDocumentoFE', plan.USP_EnviaDocumentoFE);
    await linkEmpaqueDetalle(transaction, next.serieNumeroFactura, guideItems);
    await syncFf03Correlative(transaction, next.numero);

    const status = await queryStatus(transaction, next.serieNumeroFactura, first.serieNumeroGuia);

    await transaction.rollback();
    transaction = undefined;

    const afterRollback = await queryAfterRollback(pool, next.serieNumeroFactura, first.serieNumeroGuia);

    console.log(JSON.stringify({
      safety: 'ROLLBACK_COMPLETED',
      operationId: randomUUID(),
      serieNumeroFactura: next.serieNumeroFactura,
      guia: first.serieNumeroGuia,
      cliente: `${payload.cliente.numeroDocumento} - ${payload.cliente.razonSocial}`,
      currency: payload.moneda,
      cuenta: payload.cuenta,
      diasPago: payload.diasPago,
      ordenCompra: payload.ordenCompra,
      priceMode: args.price ? 'CLI_PRICE_ALL_ITEMS' : 'DEFAULT_1_FOR_ROLLBACK_ONLY',
      totals,
      insertedPreview: status,
      afterRollback
    }, null, 2));
  } catch (error) {
    if (transaction) await rollbackQuietly(transaction);
    throw error;
  } finally {
    await pool.close();
  }
}

function buildPayload(
  first: GuideItemRow,
  items: GuideItemRow[],
  next: { numero: string; serieNumeroFactura: string }
): FcFacturaPreviewInput {
  const fechaEmision = currentLimaDate();
  const diasPago = args.days;
  const fechaVencimiento = addDays(fechaEmision, diasPago);

  return {
    serie: 'FF03',
    numero: next.numero,
    fechaEmision,
    fechaVencimiento,
    moneda: args.currency,
    tipoCambio: args.currency === 'USD' ? 1 : 1,
    formaPago: diasPago > 0 ? `Factura ${diasPago} dias` : 'Contado',
    diasPago,
    cuenta: args.cuenta,
    tipoDetraccion: '000',
    tipoExclusionProducto: 'GRAVADA',
    vendedor: {
      idEmpleado: 0,
      nombre: 'OFICINA FLEXO'
    },
    ordenCompra: args.oc ?? first.ordenCompra?.trim() ?? '',
    observaciones: 'ROLLBACK FF03 FLEXO',
    cliente: {
      tipoDocumento: first.tipoDocumentoDestinatario?.trim() || '6',
      numeroDocumento: first.numeroDocumentoDestinatario?.trim() ?? '',
      razonSocial: first.razonSocialDestinatario?.trim() ?? ''
    },
    guias: [{ serieNumeroGuia: first.serieNumeroGuia }],
    items: items.map((item, index) => ({
      id: `${item.serieNumeroGuia}-${item.numeroOrdenItem ?? index + 1}`,
      serieNumeroGuia: item.serieNumeroGuia,
      codigoProducto: item.codigo?.trim() ?? '',
      descripcion: item.descripcion?.trim() ?? '',
      unidadMedida: normalizeUnit(item.unidadMedida ?? ''),
      cantidad: Number(item.cantidad ?? 0),
      precioUnitario: args.price ?? 1,
      afectoIgv: true
    }))
  } as FcFacturaPreviewInput;
}

async function loadLatestPendingAcceptedGuideItems(pool: sql.ConnectionPool) {
  const result = await new sql.Request(pool).query<GuideItemRow>(`
    SELECT TOP (200)
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
      ed.CODIGOEMPAQUE AS codigoEmpaque,
      ed.ORDENGUIA AS ordenGuia,
      e.ORDENCOMPRA AS ordenCompra
    FROM dbo.SPE_DESPATCH d
    INNER JOIN dbo.SPE_DESPATCH_ITEM i
      ON i.tipoDocumentoRemitente = d.tipoDocumentoRemitente
     AND i.numeroDocumentoRemitente = d.numeroDocumentoRemitente
     AND i.serieNumeroGuia = d.serieNumeroGuia
     AND i.tipoDocumentoGuia = d.tipoDocumentoGuia
    INNER JOIN dbo.SPE_DESPATCH_RESPONSE r
      ON r.tipoDocumentoRemitente = d.tipoDocumentoRemitente
     AND r.numeroDocumentoRemitente = d.numeroDocumentoRemitente
     AND r.serieNumeroGuia = d.serieNumeroGuia
     AND r.tipoDocumentoGuia = d.tipoDocumentoGuia
    LEFT JOIN dbo.EMPAQUE_DETALLE ed
      ON ed.SERIENUMEROGUIAREMISION = d.serieNumeroGuia
     AND ed.ORDENGUIA = i.numeroOrdenItem
    LEFT JOIN dbo.EMPAQUE e
      ON e.CODIGOEMPAQUE = ed.CODIGOEMPAQUE
    LEFT JOIN dbo.AAA_GUIAFACTURADA gf
      ON gf.NRO_GUIA = d.serieNumeroGuia
    WHERE d.tipoDocumentoGuia = '09'
      AND (d.serieNumeroGuia LIKE 'T003-%' OR d.serieNumeroGuia LIKE 'T999-%')
      AND gf.NRO_GUIA IS NULL
      AND (
        r.bl_estadoProceso LIKE '%AC_03%'
        OR r.bl_mensajeSunat LIKE '%"codigo":"0"%'
        OR r.bl_mensajeSunat LIKE '%aceptad%'
      )
    ORDER BY d.fechaEmisionGuia DESC, d.serieNumeroGuia DESC, i.numeroOrdenItem
  `);

  if (result.recordset.length === 0) return [];

  const selected = result.recordset[0]!.serieNumeroGuia;
  return result.recordset.filter((row) => row.serieNumeroGuia === selected);
}

async function loadAcceptedGuideItems(pool: sql.ConnectionPool, serieNumeroGuia: string) {
  const request = new sql.Request(pool);
  request.input('serieNumeroGuia', sql.VarChar(20), serieNumeroGuia);
  const result = await request.query<GuideItemRow>(`
    SELECT
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
      ed.CODIGOEMPAQUE AS codigoEmpaque,
      ed.ORDENGUIA AS ordenGuia,
      e.ORDENCOMPRA AS ordenCompra
    FROM dbo.SPE_DESPATCH d
    INNER JOIN dbo.SPE_DESPATCH_ITEM i
      ON i.tipoDocumentoRemitente = d.tipoDocumentoRemitente
     AND i.numeroDocumentoRemitente = d.numeroDocumentoRemitente
     AND i.serieNumeroGuia = d.serieNumeroGuia
     AND i.tipoDocumentoGuia = d.tipoDocumentoGuia
    INNER JOIN dbo.SPE_DESPATCH_RESPONSE r
      ON r.tipoDocumentoRemitente = d.tipoDocumentoRemitente
     AND r.numeroDocumentoRemitente = d.numeroDocumentoRemitente
     AND r.serieNumeroGuia = d.serieNumeroGuia
     AND r.tipoDocumentoGuia = d.tipoDocumentoGuia
    LEFT JOIN dbo.EMPAQUE_DETALLE ed
      ON ed.SERIENUMEROGUIAREMISION = d.serieNumeroGuia
     AND ed.ORDENGUIA = i.numeroOrdenItem
    LEFT JOIN dbo.EMPAQUE e
      ON e.CODIGOEMPAQUE = ed.CODIGOEMPAQUE
    WHERE d.serieNumeroGuia = @serieNumeroGuia
      AND d.tipoDocumentoGuia = '09'
      AND (
        r.bl_estadoProceso LIKE '%AC_03%'
        OR r.bl_mensajeSunat LIKE '%"codigo":"0"%'
        OR r.bl_mensajeSunat LIKE '%aceptad%'
      )
    ORDER BY i.numeroOrdenItem
  `);

  return result.recordset;
}

async function getNextFf03(pool: sql.ConnectionPool) {
  const result = await new sql.Request(pool).query<{ nextNumber: number }>(`
    SELECT TOP (1) ISNULL(CORRELATIVO, 0) + 1 AS nextNumber
    FROM dbo.AAA_TIPODOCUMENTO
    WHERE SERIE = 'FF03'
      AND TIPODOCUMENTO = '01'
    ORDER BY CORRELATIVO DESC
  `);
  const nextNumber = Number(result.recordset[0]?.nextNumber ?? 1);
  const numero = String(nextNumber).padStart(8, '0');

  return {
    numero,
    serieNumeroFactura: `FF03-${numero}`
  };
}

async function executeStoredProcedure(transaction: sql.Transaction, procedureName: string, params: StoredProcedureParam[]) {
  const request = transaction.request();
  for (const param of params) {
    request.input(param.name, sql.NVarChar, param.value);
  }
  await request.execute(procedureName);
}

async function insertGuiaFacturada(transaction: sql.Transaction, serieNumeroGuia: string, serieNumeroFactura: string) {
  const request = transaction.request();
  request.input('ruc', sql.VarChar(11), '20259402965');
  request.input('guia', sql.VarChar(13), serieNumeroGuia);
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

async function linkEmpaqueDetalle(transaction: sql.Transaction, serieNumeroFactura: string, items: GuideItemRow[]) {
  for (const [index, item] of items.entries()) {
    if (!item.codigoEmpaque || !item.codigo?.trim()) continue;
    const request = transaction.request();
    request.input('factura', sql.VarChar(13), serieNumeroFactura);
    request.input('ordenFactura', sql.VarChar(4), String(index + 1));
    request.input('codigoEmpaque', sql.Int, item.codigoEmpaque);
    request.input('codigoProducto', sql.VarChar(80), item.codigo.trim());
    request.input('guia', sql.VarChar(13), item.serieNumeroGuia);
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

async function assertGuideStillAvailable(transaction: sql.Transaction, serieNumeroGuia: string) {
  const request = transaction.request();
  request.input('guia', sql.VarChar(13), serieNumeroGuia);
  const result = await request.query<{ guiaFacturada: number; itemsFacturados: number }>(`
    SELECT
      (SELECT COUNT(1) FROM dbo.AAA_GUIAFACTURADA WITH (UPDLOCK, HOLDLOCK) WHERE NRO_GUIA = @guia) AS guiaFacturada,
      (SELECT COUNT(1) FROM dbo.EMPAQUE_DETALLE WITH (UPDLOCK, HOLDLOCK)
        WHERE SERIENUMEROGUIAREMISION = @guia
          AND SERIENUMEROGUIAFACTURA IS NOT NULL) AS itemsFacturados;
  `);
  const row = result.recordset[0];
  if (Number(row?.guiaFacturada ?? 0) > 0 || Number(row?.itemsFacturados ?? 0) > 0) {
    throw new Error(`La guia ${serieNumeroGuia} ya esta facturada o tiene items vinculados a factura.`);
  }
}

async function queryStatus(transaction: sql.Transaction, factura: string, guia: string) {
  const request = transaction.request();
  request.input('factura', sql.VarChar(13), factura);
  request.input('guia', sql.VarChar(13), guia);
  const result = await request.query(`
    SELECT
      (SELECT COUNT(1) FROM dbo.SPE_EINVOICEHEADER WHERE SERIENUMERO = @factura AND TIPODOCUMENTO = '01') AS headers,
      (SELECT COUNT(1) FROM dbo.SPE_EINVOICEDETAIL WHERE SERIENUMERO = @factura AND TIPODOCUMENTO = '01') AS details,
      (SELECT COUNT(1) FROM dbo.SPE_EINVOICEHEADER_ADD WHERE SERIENUMERO = @factura AND TIPODOCUMENTO = '01') AS headerAdd,
      (SELECT COUNT(1) FROM dbo.AAA_GUIAFACTURADA WHERE NRO_FACTURA = @factura AND NRO_GUIA = @guia) AS guiaLinks,
      (SELECT COUNT(1) FROM dbo.AAA_REGISTRO_CONTABLE WHERE serieNumero = @factura) AS registroContable,
      (SELECT COUNT(1) FROM dbo.EMPAQUE_DETALLE WHERE SERIENUMEROGUIAFACTURA = @factura) AS empaqueLinks,
      (SELECT TOP (1) bl_estadoRegistro FROM dbo.SPE_EINVOICEHEADER WHERE SERIENUMERO = @factura AND TIPODOCUMENTO = '01') AS estadoHeader;
  `);

  return result.recordset[0];
}

async function queryAfterRollback(pool: sql.ConnectionPool, factura: string, guia: string) {
  const request = new sql.Request(pool);
  request.input('factura', sql.VarChar(13), factura);
  request.input('guia', sql.VarChar(13), guia);
  const result = await request.query(`
    SELECT
      (SELECT COUNT(1) FROM dbo.SPE_EINVOICEHEADER WHERE SERIENUMERO = @factura AND TIPODOCUMENTO = '01') AS headers,
      (SELECT COUNT(1) FROM dbo.SPE_EINVOICEDETAIL WHERE SERIENUMERO = @factura AND TIPODOCUMENTO = '01') AS details,
      (SELECT COUNT(1) FROM dbo.SPE_EINVOICEHEADER_ADD WHERE SERIENUMERO = @factura AND TIPODOCUMENTO = '01') AS headerAdd,
      (SELECT COUNT(1) FROM dbo.AAA_GUIAFACTURADA WHERE NRO_FACTURA = @factura) AS guiaLinks,
      (SELECT COUNT(1) FROM dbo.AAA_REGISTRO_CONTABLE WHERE serieNumero = @factura) AS registroContable,
      (SELECT COUNT(1) FROM dbo.EMPAQUE_DETALLE WHERE SERIENUMEROGUIAFACTURA = @factura) AS empaqueLinks,
      (SELECT COUNT(1) FROM dbo.AAA_GUIAFACTURADA WHERE NRO_GUIA = @guia) AS guiaStillLinkedElsewhere;
  `);

  return result.recordset[0];
}

async function acquireAppLock(transaction: sql.Transaction, resource: string) {
  const request = transaction.request();
  request.input('Resource', sql.NVarChar(255), resource);
  request.input('LockMode', sql.VarChar(32), 'Exclusive');
  request.input('LockOwner', sql.VarChar(32), 'Transaction');
  request.input('LockTimeout', sql.Int, 10000);
  const result = await request.execute('sp_getapplock');
  const code = Number(result.returnValue ?? 0);
  if (code < 0) throw new Error(`No se pudo obtener app lock ${resource}. Codigo ${code}.`);
}

async function rollbackQuietly(transaction: sql.Transaction) {
  try {
    await transaction.rollback();
  } catch {
    // Ignore rollback failures in diagnostic script.
  }
}

function calculateTotals(items: FcFacturaPreviewInput['items']) {
  const gravada = roundMoney(items.reduce((sum, item) => sum + item.cantidad * item.precioUnitario, 0));
  const igv = roundMoney(gravada * 0.18);

  return {
    gravada,
    gratuita: 0,
    exonerada: 0,
    inafecta: 0,
    igv,
    total: roundMoney(gravada + igv)
  };
}

function normalizeUnit(value: string) {
  const unit = value.trim().toUpperCase();
  if (unit === 'UND' || unit === 'UNIDAD' || unit === 'ROLLS' || unit === 'ROLLOS' || unit === 'ROLLO' || unit === 'ROL' || unit === 'ROLL') return 'NIU';
  if (unit === 'MILLAR' || unit === 'MLL') return 'MIL';
  return unit || 'NIU';
}

function setParam(params: StoredProcedureParam[], name: string, value: string | number | null) {
  const param = params.find((item) => item.name.toUpperCase() === name.toUpperCase());
  if (param) param.value = value;
}

function roundMoney(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
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

function addDays(dateText: string, days: number) {
  const date = new Date(`${dateText}T00:00:00-05:00`);
  date.setDate(date.getDate() + days);

  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0')
  ].join('-');
}

function parseArgs(raw: string[]) {
  const options = new Map<string, string>();
  for (let index = 0; index < raw.length; index += 1) {
    const current = raw[index]!;
    if (!current.startsWith('--')) continue;
    const key = current.slice(2);
    const value = raw[index + 1] && !raw[index + 1]!.startsWith('--') ? raw[++index]! : 'true';
    options.set(key, value);
  }

  const currency = (options.get('currency') ?? 'USD').toUpperCase();
  if (currency !== 'PEN' && currency !== 'USD') throw new Error('Use --currency PEN o --currency USD.');

  const days = Number(options.get('days') ?? 0);
  if (!Number.isInteger(days) || days < 0 || days > 180) throw new Error('--days debe ser entero entre 0 y 180.');

  const priceText = options.get('price');
  const price = priceText == null ? undefined : Number(priceText);
  if (price != null && (!Number.isFinite(price) || price <= 0)) throw new Error('--price debe ser mayor a cero.');

  return {
    guia: options.get('guia')?.toUpperCase(),
    currency: currency as 'PEN' | 'USD',
    days,
    price,
    cuenta: options.get('cuenta') ?? '7022121',
    oc: options.get('oc')
  };
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
