import { randomUUID } from 'node:crypto';
import { getGreDefaults } from '../../src/config/greDefaults.js';
import { loadEnv } from '../../src/config/env.js';
import { createBizlinksPool, createYchiPool, sql } from '../../src/integrations/bizlinksSql.js';
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

type LegacyMirrorSetup = {
  idClieProv: number;
  idEmpleado: number;
  formaPago: number;
  idUnidad: number;
  idDocumentoAnterior: number;
  tipoCambio: number;
  cuenta: number;
  guiaLegacy: string;
};

const ORLANDO_RUC = '10406265574';
const args = parseArgs(process.argv.slice(2));

async function main() {
  const config = loadEnv();
  const bizlinks = createBizlinksPool(config);
  const ychi = createYchiPool(config);
  await bizlinks.connect();
  await ychi.connect();

  let bizTransaction: sql.Transaction | undefined;
  let legacyTransaction: sql.Transaction | undefined;

  try {
    const guideItems = args.guia
      ? await loadAcceptedFlexoGuideItems(bizlinks, args.guia)
      : await loadLatestAcceptedT999OrlandoGuideItems(bizlinks);

    if (guideItems.length === 0) {
      throw new Error('No se encontro una GRE T999 aceptada y pendiente para Orlando Boritz.');
    }

    const first = guideItems[0]!;
    const next = await getNextFf03(bizlinks);
    const payload = buildPayload(first, guideItems, next);
    const totals = calculateTotals(payload.items);
    const plan = toFcFacturaProcedurePlan(payload, getGreDefaults(config), totals);
    setParam(plan.USP_CabeceraFE, 'BL_ORIGEN', 'W');
    setParam(plan.USP_CabeceraFE, 'textoAuxiliar40_1', 'OFICINA FLEXO');
    for (const detailParams of plan.USP_DetalleFE) {
      setParam(detailParams, 'textoAuxiliar250_1', null);
    }

    bizTransaction = new sql.Transaction(bizlinks);
    await bizTransaction.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);
    await acquireAppLock(bizTransaction, `FLEXO_FE_NO_SEND:${next.serieNumeroFactura}`);
    await acquireAppLock(bizTransaction, 'FLEXO_FE_NO_SEND_FF03_CORRELATIVO');

    await assertFacturaDoesNotExist(bizTransaction, next.serieNumeroFactura);
    await assertGuideStillAvailable(bizTransaction, first.serieNumeroGuia);

    await executeStoredProcedure(bizTransaction, 'dbo.USP_CabeceraFE', plan.USP_CabeceraFE);
    for (const detailParams of plan.USP_DetalleFE) {
      await executeStoredProcedure(bizTransaction, 'dbo.USP_DetalleFE', detailParams);
    }

    await insertGuiaFacturada(bizTransaction, first.serieNumeroGuia, next.serieNumeroFactura);
    await insertRegistroContable(bizTransaction, payload.cuenta, next.serieNumeroFactura);
    await linkEmpaqueDetalle(bizTransaction, next.serieNumeroFactura, guideItems);
    await syncFf03Correlative(bizTransaction, next.numero);
    const bizPreview = await queryBizStatus(bizTransaction, next.serieNumeroFactura, first.serieNumeroGuia);

    legacyTransaction = new sql.Transaction(ychi);
    await legacyTransaction.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);
    await acquireAppLock(legacyTransaction, `FLEXO_LEGACY_F03_NO_SEND:${next.serieNumeroFactura}`);
    await acquireAppLock(legacyTransaction, 'FLEXO_LEGACY_F03_CORRELATIVO');
    const legacyPreview = await mirrorLegacyRollback(legacyTransaction, payload, next.serieNumeroFactura, totals);

    await legacyTransaction.rollback();
    legacyTransaction = undefined;
    await bizTransaction.rollback();
    bizTransaction = undefined;

    const afterBizRollback = await queryBizAfterRollback(bizlinks, next.serieNumeroFactura, first.serieNumeroGuia);
    const afterLegacyRollback = await queryLegacyAfterRollback(ychi, legacyPreview.idDocumento);

    console.log(JSON.stringify({
      safety: 'NO_SEND_ROLLBACK_COMPLETED',
      didNotExecute: ['dbo.USP_EnviaDocumentoFE'],
      operationId: randomUUID(),
      serieNumeroFactura: next.serieNumeroFactura,
      guia: first.serieNumeroGuia,
      cliente: `${payload.cliente.numeroDocumento} - ${payload.cliente.razonSocial}`,
      currency: payload.moneda,
      cuenta: payload.cuenta,
      diasPago: payload.diasPago,
      ordenCompra: payload.ordenCompra,
      priceMode: args.price ? 'CLI_PRICE_ALL_ITEMS' : 'DEFAULT_1_FOR_PREFLIGHT_ONLY',
      totals,
      bizPreview,
      legacyPreview,
      afterBizRollback,
      afterLegacyRollback
    }, null, 2));
  } catch (error) {
    if (legacyTransaction) await rollbackQuietly(legacyTransaction);
    if (bizTransaction) await rollbackQuietly(bizTransaction);
    throw error;
  } finally {
    await ychi.close();
    await bizlinks.close();
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
    observaciones: 'PREFLIGHT SIN ENVIO FF03 FLEXO',
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

async function loadLatestAcceptedT999OrlandoGuideItems(pool: sql.ConnectionPool) {
  const result = await queryAcceptedT999OrlandoGuides(pool);
  if (result.length === 0) return [];

  const selected = result[0]!.serieNumeroGuia;
  return result.filter((row) => row.serieNumeroGuia === selected);
}

async function queryAcceptedT999OrlandoGuides(pool: sql.ConnectionPool, serieNumeroGuia?: string) {
  const request = new sql.Request(pool);
  request.input('ruc', sql.VarChar(20), ORLANDO_RUC);
  request.input('serieNumeroGuia', sql.VarChar(20), serieNumeroGuia ?? '');
  const result = await request.query<GuideItemRow>(`
    SELECT TOP (400)
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
      AND d.serieNumeroGuia LIKE 'T999-%'
      AND d.numeroDocumentoDestinatario = @ruc
      AND (@serieNumeroGuia = '' OR d.serieNumeroGuia = @serieNumeroGuia)
      AND gf.NRO_GUIA IS NULL
      AND (
        r.bl_estadoProceso LIKE '%AC_03%'
        OR r.bl_mensajeSunat LIKE '%"codigo":"0"%'
        OR r.bl_mensajeSunat LIKE '%aceptad%'
      )
    ORDER BY d.fechaEmisionGuia DESC, d.serieNumeroGuia DESC, i.numeroOrdenItem;
  `);

  return result.recordset;
}

async function loadAcceptedFlexoGuideItems(pool: sql.ConnectionPool, serieNumeroGuia: string) {
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
    LEFT JOIN dbo.AAA_GUIAFACTURADA gf
      ON gf.NRO_GUIA = d.serieNumeroGuia
    WHERE d.tipoDocumentoGuia = '09'
      AND (d.serieNumeroGuia LIKE 'T003-%' OR d.serieNumeroGuia LIKE 'T999-%')
      AND d.serieNumeroGuia = @serieNumeroGuia
      AND gf.NRO_GUIA IS NULL
      AND (
        r.bl_estadoProceso LIKE '%AC_03%'
        OR r.bl_mensajeSunat LIKE '%"codigo":"0"%'
        OR r.bl_mensajeSunat LIKE '%aceptad%'
      )
    ORDER BY i.numeroOrdenItem;
  `);

  return result.recordset;
}

async function getNextFf03(pool: sql.ConnectionPool) {
  const result = await new sql.Request(pool).query<{ nextNumber: number }>(`
    SELECT TOP (1) ISNULL(CORRELATIVO, 0) + 1 AS nextNumber
    FROM dbo.AAA_TIPODOCUMENTO
    WHERE SERIE = 'FF03'
      AND TIPODOCUMENTO = '01'
    ORDER BY CORRELATIVO DESC;
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

async function mirrorLegacyRollback(
  transaction: sql.Transaction,
  input: FcFacturaPreviewInput,
  serieNumeroFactura: string,
  totals: ReturnType<typeof calculateTotals>
) {
  const setup = await resolveLegacySetup(transaction, input);
  const request = transaction.request();
  request.input('idClieProv', sql.Int, setup.idClieProv);
  request.input('formaPago', sql.Int, setup.formaPago);
  request.input('Moneda', sql.Char(1), input.moneda === 'USD' ? 'D' : 'S');
  request.input('Tica', sql.Money, setup.tipoCambio);
  request.input('Neto', sql.Money, totals.gravada);
  request.input('Igv', sql.Money, totals.igv);
  request.input('Total', sql.Money, totals.total);
  request.input('Observaciones', sql.VarChar(200), amountWordsPlaceholder(totals.total, input.moneda));
  request.input('fechavencimiento', sql.DateTime, localDate(input.fechaVencimiento ?? addDays(input.fechaEmision, input.diasPago)));
  request.input('OrdenCompra', sql.VarChar(50), input.ordenCompra.slice(0, 50));
  request.input('idDocumentoAnterior', sql.Int, setup.idDocumentoAnterior);
  request.output('idDocumento', sql.Int, 0);
  request.output('NumeDocu', sql.VarChar(10), '');
  request.input('idemp', sql.Int, setup.idEmpleado);
  request.input('cuenta', sql.Int, setup.cuenta);
  request.input('origen', sql.Char(1), 'Y');
  request.input('llevacomp', sql.Char(1), input.ordenCompra.trim() ? 'S' : 'N');
  request.input('gremision', sql.VarChar(750), setup.guiaLegacy);
  request.input('fenumero', sql.VarChar(13), serieNumeroFactura);
  const headerResult = await request.execute('dbo.SPI_FACTURA_ELECTRONICA_FF03');
  const idDocumento = Number(headerResult.output.idDocumento);
  const legacyNumber = String(headerResult.output.NumeDocu ?? '').trim();
  if (!idDocumento || !legacyNumber) throw new Error('El SP legacy no devolvio idDocumento/NumeDocu.');

  const detailResults = [];
  for (const [index, item] of input.items.entries()) {
    const quantity = roundMoney(item.cantidad);
    const price = roundMoney(item.precioUnitario);
    const igvUnit = roundMoney(price * 0.18);
    const detailRequest = transaction.request();
    detailRequest.input('idDocumento', sql.Int, idDocumento);
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
    if (message) throw new Error(`Detalle legacy F03 item ${index + 1}: ${message}`);
    detailResults.push({ item: index + 1, mensaje: message });
  }

  const validation = await validateLegacyMirror(transaction, idDocumento, input.items.length);

  return {
    idDocumento,
    legacySerieNumero: `F03-${legacyNumber}`,
    serieNumeroFactura,
    detailResults,
    guiaLegacy: setup.guiaLegacy,
    validation
  };
}

async function resolveLegacySetup(transaction: sql.Transaction, input: FcFacturaPreviewInput): Promise<LegacyMirrorSetup> {
  const days = input.diasPago;
  const cuenta = Number(input.cuenta);
  if (!Number.isInteger(cuenta) || cuenta <= 0) throw new Error(`Cuenta contable invalida para legacy: ${input.cuenta}.`);
  const guideNumbers = input.guias.map((guide) => legacyGuideNumber(guide.serieNumeroGuia)).filter(Boolean);
  const guiaLegacy = input.guias.map((guide) => legacyGuideLabel(guide.serieNumeroGuia)).join(', ').slice(0, 750);
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
  if (input.moneda === 'USD' && !Number(row.tipoCambio ?? 0)) throw new Error('No se encontro tipo de cambio legacy para USD.');

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

async function validateLegacyMirror(transaction: sql.Transaction, idDocumento: number, expectedItems: number) {
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

async function queryBizStatus(transaction: sql.Transaction, factura: string, guia: string) {
  const request = transaction.request();
  request.input('factura', sql.VarChar(13), factura);
  request.input('guia', sql.VarChar(13), guia);
  const result = await request.query<Record<string, unknown>>(`
    SELECT
      (SELECT COUNT(1) FROM dbo.SPE_EINVOICEHEADER WHERE SERIENUMERO = @factura AND TIPODOCUMENTO = '01') AS headers,
      (SELECT COUNT(1) FROM dbo.SPE_EINVOICEDETAIL WHERE SERIENUMERO = @factura AND TIPODOCUMENTO = '01') AS details,
      (SELECT COUNT(1) FROM dbo.SPE_EINVOICEHEADER_ADD WHERE SERIENUMERO = @factura AND TIPODOCUMENTO = '01') AS headerAdd,
      (SELECT COUNT(1) FROM dbo.SPE_EINVOICE_RESPONSE WHERE SERIENUMERO = @factura AND TIPODOCUMENTO = '01') AS responses,
      (SELECT COUNT(1) FROM dbo.AAA_GUIAFACTURADA WHERE NRO_FACTURA = @factura AND NRO_GUIA = @guia) AS guiaLinks,
      (SELECT COUNT(1) FROM dbo.AAA_REGISTRO_CONTABLE WHERE serieNumero = @factura) AS registroContable,
      (SELECT COUNT(1) FROM dbo.EMPAQUE_DETALLE WHERE SERIENUMEROGUIAFACTURA = @factura) AS empaqueLinks,
      (SELECT TOP (1) bl_estadoRegistro FROM dbo.SPE_EINVOICEHEADER WHERE SERIENUMERO = @factura AND TIPODOCUMENTO = '01') AS estadoHeader;
  `);
  const row = result.recordset[0] ?? {};
  if (Number(row.headers ?? 0) !== 1) throw new Error('No se creo cabecera SPE_EINVOICEHEADER.');
  if (Number(row.details ?? 0) <= 0) throw new Error('No se creo detalle SPE_EINVOICEDETAIL.');
  if (Number(row.responses ?? 0) !== 0) throw new Error('Se genero SPE_EINVOICE_RESPONSE; eso no debe pasar sin envio.');
  if (Number(row.guiaLinks ?? 0) !== 1) throw new Error('No se creo traza AAA_GUIAFACTURADA en rollback.');
  if (Number(row.registroContable ?? 0) !== 1) throw new Error('No se creo registro contable en rollback.');
  return row;
}

async function queryBizAfterRollback(pool: sql.ConnectionPool, factura: string, guia: string) {
  const request = new sql.Request(pool);
  request.input('factura', sql.VarChar(13), factura);
  request.input('guia', sql.VarChar(13), guia);
  const result = await request.query<Record<string, unknown>>(`
    SELECT
      (SELECT COUNT(1) FROM dbo.SPE_EINVOICEHEADER WHERE SERIENUMERO = @factura AND TIPODOCUMENTO = '01') AS headers,
      (SELECT COUNT(1) FROM dbo.SPE_EINVOICEDETAIL WHERE SERIENUMERO = @factura AND TIPODOCUMENTO = '01') AS details,
      (SELECT COUNT(1) FROM dbo.SPE_EINVOICEHEADER_ADD WHERE SERIENUMERO = @factura AND TIPODOCUMENTO = '01') AS headerAdd,
      (SELECT COUNT(1) FROM dbo.SPE_EINVOICE_RESPONSE WHERE SERIENUMERO = @factura AND TIPODOCUMENTO = '01') AS responses,
      (SELECT COUNT(1) FROM dbo.AAA_GUIAFACTURADA WHERE NRO_FACTURA = @factura) AS guiaLinks,
      (SELECT COUNT(1) FROM dbo.AAA_REGISTRO_CONTABLE WHERE serieNumero = @factura) AS registroContable,
      (SELECT COUNT(1) FROM dbo.EMPAQUE_DETALLE WHERE SERIENUMEROGUIAFACTURA = @factura) AS empaqueLinks,
      (SELECT COUNT(1) FROM dbo.AAA_GUIAFACTURADA WHERE NRO_GUIA = @guia) AS guiaStillLinkedElsewhere;
  `);
  return result.recordset[0] ?? {};
}

async function queryLegacyAfterRollback(pool: sql.ConnectionPool, idDocumento: number) {
  const request = new sql.Request(pool);
  request.input('idDocumento', sql.Int, idDocumento);
  const result = await request.query<Record<string, unknown>>(`
    SELECT
      (SELECT COUNT(1) FROM dbo.tbDocumentos WHERE idDocumento = @idDocumento) AS tbDocumentosCreatedStillExists,
      (SELECT COUNT(1) FROM dbo.tbDetFact WHERE idDocumento = @idDocumento) AS tbDetFactCreatedStillExists,
      (SELECT COUNT(1) FROM dbo.TBCTACTE WHERE idDocumento = @idDocumento OR idDocAfectado = @idDocumento) AS tbCtaCteCreatedStillExists,
      (SELECT COUNT(1) FROM dbo.tbDocumentos_Y WHERE idDocumento = @idDocumento) AS tbDocumentosYCreatedStillExists;
  `);
  return result.recordset[0] ?? {};
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
    // Best effort rollback.
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

function legacyGuideNumber(serieNumeroGuia: string) {
  const match = /^T\d{3}-(\d{8})$/.exec(serieNumeroGuia.trim());
  return match ? match[1].slice(-7) : '';
}

function legacyGuideLabel(serieNumeroGuia: string) {
  const number = legacyGuideNumber(serieNumeroGuia);
  return number ? `003-${number}` : serieNumeroGuia.trim();
}

function amountWordsPlaceholder(total: number, moneda: string) {
  const currency = moneda === 'USD' ? 'DOLARES AMERICANOS' : 'SOLES';
  return `IMPORTE ${total.toFixed(2)} ${currency}`.slice(0, 200);
}

function localDate(value: string) {
  return new Date(`${value.slice(0, 10)}T00:00:00-05:00`);
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
