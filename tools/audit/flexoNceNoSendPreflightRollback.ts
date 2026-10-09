import { getGreDefaults } from '../../src/config/greDefaults.js';
import { loadEnv } from '../../src/config/env.js';
import { createBizlinksPool, createYchiPool, sql } from '../../src/integrations/bizlinksSql.js';

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

type LegacySetup = {
  idClieProv: number;
  idFactura: number;
  moneda: 'S' | 'D';
  cuentaNc: number;
};

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
    const source = await loadSourceInvoice(bizlinks, args.factura);
    const next = await getNextFc03(bizlinks);
    const motivo = resolveMotivo(args.motivo);
    const totals = resolveTotals(source.header, source.details);

    bizTransaction = new sql.Transaction(bizlinks);
    await bizTransaction.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);
    await acquireAppLock(bizTransaction, `FLEXO_NCE_NO_SEND:${next.serieNumero}`);
    await acquireAppLock(bizTransaction, 'FLEXO_NCE_FC03_CORRELATIVO');

    await assertCreditNoteDoesNotExist(bizTransaction, next.serieNumero);
    await executeBizlinksCreditNoteHeader(bizTransaction, source.header, next.serieNumero, motivo, totals);
    for (const [index, detail] of source.details.entries()) {
      await executeBizlinksCreditNoteDetail(bizTransaction, next.serieNumero, detail, index);
    }
    await linkCreditNoteToGuides(bizTransaction, source.guiaLinks, next.serieNumero);
    await syncFc03Correlative(bizTransaction, next.numero);
    await executeBizlinksActivateOnlyInRollback(bizTransaction, next.serieNumero);
    const bizPreview = await queryBizPreview(bizTransaction, next.serieNumero, args.factura, source.details.length);

    legacyTransaction = new sql.Transaction(ychi);
    await legacyTransaction.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);
    await acquireAppLock(legacyTransaction, `FLEXO_LEGACY_NCE_NO_SEND:${next.serieNumero}`);
    await acquireAppLock(legacyTransaction, 'FLEXO_LEGACY_NCE_FC03_CORRELATIVO');
    const legacyPreview = await mirrorLegacyCreditNoteRollback(
      legacyTransaction,
      source.header,
      source.details,
      next.serieNumero,
      motivo,
      totals
    );

    await legacyTransaction.rollback();
    legacyTransaction = undefined;
    await bizTransaction.rollback();
    bizTransaction = undefined;

    const afterBizRollback = await queryBizAfterRollback(bizlinks, next.serieNumero);
    const afterLegacyRollback = await queryLegacyAfterRollback(ychi, legacyPreview.idDocumento);

    console.log(JSON.stringify({
      safety: 'NO_SEND_ROLLBACK_COMPLETED',
      facturaAfectada: args.factura,
      serieNumeroNotaCredito: next.serieNumero,
      motivo,
      cliente: `${source.header.numeroDocumentoAdquiriente} - ${source.header.razonSocialAdquiriente}`,
      moneda: source.header.tipoMoneda,
      totals,
      sourceGuideLinks: source.guiaLinks,
      didNotCommit: true,
      didNotCreateResponse: true,
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

async function loadSourceInvoice(pool: sql.ConnectionPool, serieNumeroFactura: string) {
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
  if (guiaLinks.length === 0 && !args.allowNoGuide) {
    throw new Error(`La factura ${serieNumeroFactura} no tiene trazabilidad AAA_GUIAFACTURADA.`);
  }
  const alreadyNce = guiaLinks.filter((row) => row.NOTACRE?.trim());
  if (alreadyNce.length > 0 && !args.allowAlreadyCredited) {
    throw new Error(
      `La factura ${serieNumeroFactura} ya tiene NOTACRE (${alreadyNce.map((row) => row.NOTACRE).join(', ')}). ` +
      'Use otra FF03 o --allow-already-credited solo para auditoria rollback.'
    );
  }

  return { header, details, guiaLinks };
}

async function getNextFc03(pool: sql.ConnectionPool) {
  const result = await new sql.Request(pool).query<{ nextNumber: number }>(`
    SET TRANSACTION ISOLATION LEVEL READ UNCOMMITTED;

    SELECT TOP (1) ISNULL(CORRELATIVO, 0) + 1 AS nextNumber
    FROM dbo.AAA_TIPODOCUMENTO
    WHERE SERIE = 'FC03'
      AND TIPODOCUMENTO = '07'
    ORDER BY CORRELATIVO DESC;
  `);
  const nextNumber = Number(result.recordset[0]?.nextNumber ?? 1);
  const numero = String(nextNumber).padStart(8, '0');
  return { numero, serieNumero: `FC03-${numero}` };
}

async function executeBizlinksCreditNoteHeader(
  transaction: sql.Transaction,
  source: InvoiceHeader,
  serieNumeroNota: string,
  motivo: ReturnType<typeof resolveMotivo>,
  totals: ReturnType<typeof resolveTotals>
) {
  const defaults = getGreDefaults(loadEnv());
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
  request.input('motivoDocumento', sql.VarChar(500), motivo.descripcion);
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
  serieNumeroNota: string,
  detail: InvoiceDetail,
  index: number
) {
  const defaults = getGreDefaults(loadEnv());
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

async function executeBizlinksActivateOnlyInRollback(transaction: sql.Transaction, serieNumeroNota: string) {
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

async function mirrorLegacyCreditNoteRollback(
  transaction: sql.Transaction,
  source: InvoiceHeader,
  details: InvoiceDetail[],
  serieNumeroNota: string,
  motivo: ReturnType<typeof resolveMotivo>,
  totals: ReturnType<typeof resolveTotals>
) {
  const setup = await resolveLegacySetup(transaction, source);
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
    const quantity = num(detail.cantidad);
    const unitPrice = num(detail.importeUnitarioSinImpuesto);
    const detailRequest = transaction.request();
    detailRequest.input('idNotaCredito', sql.Int, idDocumento);
    detailRequest.input('Descripcion', sql.VarChar(490), (detail.descripcion ?? '-').slice(0, 490));
    detailRequest.input('Cantidad', sql.Decimal(18, 2), quantity);
    detailRequest.input('Precio', sql.Money, unitPrice);
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

async function resolveLegacySetup(transaction: sql.Transaction, source: InvoiceHeader): Promise<LegacySetup> {
  const request = transaction.request();
  request.input('ruc', sql.VarChar(20), source.numeroDocumentoAdquiriente);
  request.input('facturaNumero', sql.VarChar(8), source.serieNumero.slice(-8).slice(-7));
  request.input('facturaElectronica', sql.VarChar(13), source.serieNumero);
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
       FROM dbo.tbDocumentos WITH (UPDLOCK, HOLDLOCK)
       WHERE idTipoDocu IN (38, 43)
         AND (SeriDocu IN ('F03', 'FF03') OR correo = @facturaElectronica)
         AND (
           RIGHT('0000000' + LTRIM(RTRIM(NumeDocu)), 7) = @facturaNumero
           OR correo = @facturaElectronica
         )
       ORDER BY idDocumento DESC) AS idFactura;
  `);
  const row = result.recordset[0];
  if (!row?.idClieProv) throw new Error(`No existe cliente legacy activo para RUC ${source.numeroDocumentoAdquiriente}.`);
  if (!row.idFactura) throw new Error(`No existe factura legacy F03/FF03 para ${source.serieNumero}.`);

  return {
    idClieProv: row.idClieProv,
    idFactura: row.idFactura,
    moneda: source.tipoMoneda === 'USD' ? 'D' : 'S',
    cuentaNc: Number(args.cuentaNc)
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

async function queryBizPreview(
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
  if (Number(row.responses ?? 0) !== 0) throw new Error('Se genero SPE_EINVOICE_RESPONSE antes de declarar; eso no debe pasar.');
  if (!args.allowNoGuide && Number(row.guiaLinks ?? 0) <= 0) throw new Error('No se vinculo AAA_GUIAFACTURADA.NOTACRE.');
  if (String(row.estadoHeader ?? '') !== 'A') throw new Error('La cabecera NCE no quedo activada dentro del rollback.');
  if (String(row.facturaAfectada ?? '') !== facturaAfectada) throw new Error('La NCE no referencia la factura afectada esperada.');
  return row;
}

async function queryBizAfterRollback(pool: sql.ConnectionPool, serieNumeroNota: string) {
  const request = new sql.Request(pool);
  request.input('nota', sql.VarChar(13), serieNumeroNota);
  const result = await request.query<Record<string, unknown>>(`
    SELECT
      (SELECT COUNT(1) FROM dbo.SPE_EINVOICEHEADER WHERE SERIENUMERO = @nota AND TIPODOCUMENTO = '07') AS headers,
      (SELECT COUNT(1) FROM dbo.SPE_EINVOICEDETAIL WHERE SERIENUMERO = @nota AND TIPODOCUMENTO = '07') AS details,
      (SELECT COUNT(1) FROM dbo.SPE_EINVOICEHEADER_ADD WHERE SERIENUMERO = @nota AND TIPODOCUMENTO = '07') AS headerAdd,
      (SELECT COUNT(1) FROM dbo.SPE_EINVOICE_RESPONSE WHERE SERIENUMERO = @nota AND TIPODOCUMENTO = '07') AS responses,
      (SELECT COUNT(1) FROM dbo.AAA_GUIAFACTURADA WHERE NOTACRE = @nota) AS guiaLinks;
  `);
  return result.recordset[0] ?? {};
}

async function queryLegacyAfterRollback(pool: sql.ConnectionPool, idDocumento: number) {
  const request = new sql.Request(pool);
  request.input('idDocumento', sql.Int, idDocumento);
  const result = await request.query<Record<string, unknown>>(`
    SELECT
      (SELECT COUNT(1) FROM dbo.tbDocumentos WHERE idDocumento = @idDocumento) AS tbDocumentosCreatedStillExists,
      (SELECT COUNT(1) FROM dbo.tbDetNotaCredito WHERE idDocumento = @idDocumento) AS tbDetNotaCreditoCreatedStillExists,
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

function resolveTotals(header: InvoiceHeader, details: InvoiceDetail[]) {
  const detailGravada = roundMoney(details.reduce((sum, item) => sum + num(item.importeTotalSinImpuesto), 0));
  const detailIgv = roundMoney(details.reduce((sum, item) => sum + num(item.importeIgv), 0));
  const gravada = detailGravada || num(header.totalValorVentaNetoOpGravadas);
  const igv = detailIgv || num(header.totalIgv);
  const total = roundMoney(gravada + igv) || num(header.totalVenta);
  return { gravada, igv, total };
}

function resolveMotivo(value: string) {
  const normalized = value.trim().toLowerCase();
  const motives: Record<string, { codigo: string; descripcion: string }> = {
    anulacion: { codigo: '01', descripcion: 'Anulación de la operación' },
    operacion: { codigo: '01', descripcion: 'Anulación de la operación' },
    ruc: { codigo: '02', descripcion: 'Anulación por error en el RUC' },
    total: { codigo: '06', descripcion: 'DEVOLUCIÓN TOTAL' },
    item: { codigo: '07', descripcion: 'DEVOLUCIÓN PARCIAL.' },
    parcial: { codigo: '07', descripcion: 'DEVOLUCIÓN PARCIAL.' }
  };
  const motive = motives[normalized];
  if (!motive) throw new Error('Use --motivo anulacion|ruc|total|item.');
  return motive;
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
  const factura = (options.get('factura') ?? 'FF03-00011206').toUpperCase();
  if (!/^FF03-\d{8}$/.test(factura)) throw new Error('Use --factura FF03-00000000.');
  const cuentaNc = options.get('cuenta-nc') ?? '7094121';
  if (!/^\d+$/.test(cuentaNc)) throw new Error('--cuenta-nc debe ser numerica.');

  return {
    factura,
    motivo: options.get('motivo') ?? 'total',
    cuentaNc,
    allowAlreadyCredited: options.has('allow-already-credited'),
    allowNoGuide: options.has('allow-no-guide')
  };
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

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
