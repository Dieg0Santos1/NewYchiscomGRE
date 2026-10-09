import { loadEnv } from '../../src/config/env.js';
import { createBizlinksPool, createYchiPool, sql } from '../../src/integrations/bizlinksSql.js';

const factura = process.argv[2]?.trim().toUpperCase() || 'FF03-00011208';

type BizHeader = {
  SERIENUMERO: string;
  FECHAEMISION: Date | string;
  NUMERODOCUMENTOADQUIRIENTE: string;
  RAZONSOCIALADQUIRIENTE: string;
  TIPOMONEDA: string;
  TOTALVALORVENTANETOOPGRAVADAS: string;
  TOTALIGV: string;
  TOTALVENTA: string;
  fechaVencimiento: string | null;
  ordenCompra: string | null;
  NRO_GUIA: string | null;
};

type BizDetail = {
  numeroOrdenItem: string;
  cantidad: string;
  descripcion: string;
  importeUnitarioSinImpuesto: string;
  importeTotalSinImpuesto: string;
  importeIgv: string;
  unidadMedida: string | null;
};

function asNumber(value: unknown) {
  const parsed = Number(String(value ?? '0').replace(',', '.'));
  return Number.isFinite(parsed) ? parsed : 0;
}

function asDate(value: Date | string | null | undefined) {
  if (value instanceof Date) return value;
  if (!value) return new Date();
  return new Date(`${String(value).slice(0, 10)}T00:00:00-05:00`);
}

function amountWordsPlaceholder(total: number, moneda: string) {
  const currency = moneda === 'USD' ? 'DOLARES AMERICANOS' : 'SOLES';
  return `IMPORTE ${total.toFixed(2)} ${currency}`.slice(0, 200);
}

async function main() {
  const config = loadEnv();
  const bizlinks = createBizlinksPool(config);
  const ychi = createYchiPool(config);
  await bizlinks.connect();
  await ychi.connect();

  let transaction: sql.Transaction | undefined;

  try {
    const bizResult = await new sql.Request(bizlinks)
      .input('factura', sql.VarChar(20), factura)
      .query(`
        SET TRANSACTION ISOLATION LEVEL READ UNCOMMITTED;

        SELECT TOP (1)
          h.SERIENUMERO,
          h.FECHAEMISION,
          h.NUMERODOCUMENTOADQUIRIENTE,
          h.RAZONSOCIALADQUIRIENTE,
          h.TIPOMONEDA,
          h.TOTALVALORVENTANETOOPGRAVADAS,
          h.TOTALIGV,
          h.TOTALVENTA,
          addDue.VALOR AS fechaVencimiento,
          addOc.VALOR AS ordenCompra,
          gf.NRO_GUIA
        FROM dbo.SPE_EINVOICEHEADER h
        LEFT JOIN dbo.SPE_EINVOICEHEADER_ADD addDue
          ON addDue.SERIENUMERO = h.SERIENUMERO
         AND addDue.TIPODOCUMENTO = h.TIPODOCUMENTO
         AND addDue.CLAVE = 'fechaVencimiento'
        LEFT JOIN dbo.SPE_EINVOICEHEADER_ADD addOc
          ON addOc.SERIENUMERO = h.SERIENUMERO
         AND addOc.TIPODOCUMENTO = h.TIPODOCUMENTO
         AND addOc.CLAVE = 'ordenCompra'
        LEFT JOIN dbo.AAA_GUIAFACTURADA gf
          ON gf.NRO_FACTURA = h.SERIENUMERO
        WHERE h.SERIENUMERO = @factura
          AND h.TIPODOCUMENTO = '01';

        SELECT
          numeroOrdenItem,
          cantidad,
          descripcion,
          importeUnitarioSinImpuesto,
          importeTotalSinImpuesto,
          importeIgv,
          unidadMedida
        FROM dbo.SPE_EINVOICEDETAIL
        WHERE SERIENUMERO = @factura
          AND TIPODOCUMENTO = '01'
        ORDER BY numeroOrdenItem;
      `);

    const header = bizResult.recordsets[0]?.[0] as BizHeader | undefined;
    const details = (bizResult.recordsets[1] ?? []) as BizDetail[];
    if (!header) throw new Error(`No existe cabecera Bizlinks para ${factura}.`);
    if (details.length === 0) throw new Error(`No existe detalle Bizlinks para ${factura}.`);

    transaction = new sql.Transaction(ychi);
    await transaction.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);
    await acquireAppLock(transaction, `FLEXO_LEGACY_F03_ROLLBACK:${factura}`);

    const setup = await resolveLegacyInputs(transaction, header);
    const before = await snapshot(transaction, factura);

    const idDocumento = { value: 0 };
    const numeDocu = { value: '' };

    const headerRequest = transaction.request();
    headerRequest.input('idClieProv', sql.Int, setup.idClieProv);
    headerRequest.input('formaPago', sql.Int, setup.formaPago);
    headerRequest.input('Moneda', sql.Char(1), header.TIPOMONEDA === 'USD' ? 'D' : 'S');
    headerRequest.input('Tica', sql.Money, setup.tipoCambio);
    headerRequest.input('Neto', sql.Money, asNumber(header.TOTALVALORVENTANETOOPGRAVADAS));
    headerRequest.input('Igv', sql.Money, asNumber(header.TOTALIGV));
    headerRequest.input('Total', sql.Money, asNumber(header.TOTALVENTA));
    headerRequest.input('Observaciones', sql.VarChar(200), amountWordsPlaceholder(asNumber(header.TOTALVENTA), header.TIPOMONEDA));
    headerRequest.input('fechavencimiento', sql.DateTime, asDate(header.fechaVencimiento));
    headerRequest.input('OrdenCompra', sql.VarChar(50), (header.ordenCompra ?? '').slice(0, 50));
    headerRequest.input('idDocumentoAnterior', sql.Int, setup.idDocumentoAnterior);
    headerRequest.output('idDocumento', sql.Int, idDocumento.value);
    headerRequest.output('NumeDocu', sql.VarChar(10), numeDocu.value);
    headerRequest.input('idemp', sql.Int, setup.idEmpleado);
    headerRequest.input('cuenta', sql.Int, setup.cuenta);
    headerRequest.input('origen', sql.Char(1), 'Y');
    headerRequest.input('llevacomp', sql.Char(1), (header.ordenCompra ?? '').trim() ? 'S' : 'N');
    headerRequest.input('gremision', sql.VarChar(750), legacyGuide(header.NRO_GUIA));
    headerRequest.input('fenumero', sql.VarChar(13), factura);
    const headerExec = await headerRequest.execute('dbo.SPI_FACTURA_ELECTRONICA_FF03');
    const createdId = Number(headerExec.output.idDocumento);
    const legacyNumber = String(headerExec.output.NumeDocu ?? '');
    if (!createdId || !legacyNumber) throw new Error('El SP legacy no devolvio idDocumento/NumeDocu.');

    const detailResults = [];
    for (const detail of details) {
      const quantity = asNumber(detail.cantidad);
      const price = asNumber(detail.importeUnitarioSinImpuesto);
      const lineIgv = asNumber(detail.importeIgv);
      const igvUnit = quantity > 0 ? Math.round((lineIgv / quantity + Number.EPSILON) * 100) / 100 : 0;
      const detailRequest = transaction.request();
      detailRequest.input('idDocumento', sql.Int, createdId);
      detailRequest.input('idProducto', sql.Int, 6969);
      detailRequest.input('idDetOrdenVenta', sql.Int, 0);
      detailRequest.input('Cantidad', sql.Decimal(18, 2), quantity);
      detailRequest.input('Precio', sql.Decimal(18, 2), price);
      detailRequest.input('Igv', sql.Decimal(18, 2), igvUnit);
      detailRequest.input('Total', sql.Decimal(18, 2), 0);
      detailRequest.input('idRecepcionOt', sql.Int, 0);
      detailRequest.input('idUnidad', sql.Int, setup.idUnidad);
      detailRequest.input('idguia', sql.Int, 0);
      detailRequest.input('DESCC', sql.VarChar(250), detail.descripcion.slice(0, 250));
      detailRequest.input('nguia', sql.VarChar(750), legacyGuide(header.NRO_GUIA));
      detailRequest.output('Mensaje', sql.VarChar(50), '');
      const result = await detailRequest.execute('dbo.SPI_DETFACT_NGUIA');
      detailResults.push({
        numeroOrdenItem: detail.numeroOrdenItem,
        mensaje: result.output.Mensaje ?? ''
      });
    }

    const created = await inspectCreated(transaction, createdId);
    const afterInsideTransaction = await snapshot(transaction, factura);

    await transaction.rollback();
    transaction = undefined;

    const afterRollback = await snapshotWithPool(ychi, factura, createdId);

    console.log(JSON.stringify({
      safety: 'ROLLBACK_ONLY',
      factura,
      setup,
      before,
      createdHeader: { idDocumento: createdId, legacyNumber, legacySerie: `F03-${legacyNumber}` },
      detailResults,
      created,
      afterInsideTransaction,
      afterRollback
    }, null, 2));
  } catch (error) {
    if (transaction) {
      try {
        await transaction.rollback();
      } catch {
        // Best effort rollback.
      }
    }
    throw error;
  } finally {
    await ychi.close();
    await bizlinks.close();
  }
}

async function resolveLegacyInputs(transaction: sql.Transaction, header: BizHeader) {
  const total = asNumber(header.TOTALVENTA);
  const moneda = header.TIPOMONEDA === 'USD' ? 'D' : 'S';
  const dueDate = asDate(header.fechaVencimiento);
  const issueDate = asDate(header.FECHAEMISION);
  const days = Math.max(0, Math.round((dueDate.getTime() - issueDate.getTime()) / 86400000));

  const request = transaction.request();
  request.input('ruc', sql.VarChar(20), header.NUMERODOCUMENTOADQUIRIENTE);
  request.input('days', sql.VarChar(10), String(days));
  request.input('daysInt', sql.Int, days);
  request.input('cuenta', sql.Int, 7022121);
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
           Descripcion,
           CASE WHEN ISNUMERIC(Descripcion) = 1 THEN CAST(Descripcion AS int) ELSE 9999 END AS diasCatalogo
         FROM dbo.tbPropiedades WITH (UPDLOCK, HOLDLOCK)
         WHERE tipo = 'FPAG'
           AND ISNULL(Valor, '') NOT LIKE '(obsoleto)%'
           AND ISNULL(Nombre, '') NOT LIKE '(obsoleto)%'
           AND (
             Nombre LIKE 'Factura%'
             OR Valor LIKE 'Factura%'
           )
       ) fp
       WHERE (
           LTRIM(RTRIM(Nombre)) = 'Factura ' + @days + ' dias'
           OR LTRIM(RTRIM(Valor)) = 'Factura ' + @days + ' dias'
           OR ABS(diasCatalogo - @daysInt) <= 5
         )
       ORDER BY
         CASE
           WHEN LTRIM(RTRIM(Nombre)) = 'Factura ' + @days + ' dias' THEN 0
           ELSE 1
         END,
         ABS(diasCatalogo - @daysInt),
         CASE WHEN Nombre LIKE 'Factura %' THEN 0 ELSE 1 END,
         idPropiedades) AS formaPago,
      (SELECT TOP (1) idUnidad
       FROM dbo.tbUnidades
       WHERE idUnidad = 10 OR Valor IN ('MIL', 'MILLAR', 'UND', 'Und')
       ORDER BY CASE WHEN idUnidad = 10 THEN 0 WHEN Valor IN ('MIL', 'MILLAR') THEN 1 ELSE 2 END, idUnidad) AS idUnidad,
      (SELECT TOP (1) idDocumento
       FROM dbo.tbDocumentos WITH (UPDLOCK, HOLDLOCK)
       WHERE idTipoDocu = 38
       ORDER BY idDocumento DESC) AS idDocumentoAnterior,
      (SELECT TOP (1) venta
       FROM dbo.tbTica
       ORDER BY fecha DESC) AS tipoCambio;
  `);

  const row = result.recordset[0];
  if (!row?.idClieProv) throw new Error(`No existe cliente legacy activo para RUC ${header.NUMERODOCUMENTOADQUIRIENTE}.`);
  if (!row.formaPago) throw new Error(`No se encontro forma de pago legacy para ${days} dias.`);
  if (!row.idUnidad) throw new Error('No se encontro unidad legacy para detalle.');

  return {
    idClieProv: row.idClieProv,
    idEmpleado: row.idEmpleado ?? 1,
    formaPago: row.formaPago,
    idUnidad: row.idUnidad,
    idDocumentoAnterior: row.idDocumentoAnterior ?? 0,
    tipoCambio: moneda === 'D' ? Number(row.tipoCambio ?? 0) : 1,
    cuenta: 7022121,
    days,
    total,
    moneda
  };
}

function legacyGuide(value: string | null) {
  const guide = value?.trim() ?? '';
  const match = /^T\d{3}-(\d{8})$/.exec(guide);
  if (!match) return guide.slice(0, 750);
  return `003-${match[1].slice(-7)}`;
}

async function inspectCreated(transaction: sql.Transaction, idDocumento: number) {
  const request = transaction.request();
  request.input('idDocumento', sql.Int, idDocumento);
  const result = await request.query(`
    SELECT * FROM dbo.tbDocumentos WHERE idDocumento = @idDocumento;
    SELECT * FROM dbo.tbDetFact WHERE idDocumento = @idDocumento ORDER BY idDetFact;
    SELECT * FROM dbo.TBCTACTE WHERE idDocumento = @idDocumento OR idDocAfectado = @idDocumento;
    SELECT * FROM dbo.TBDOCUMENTOS_Y WHERE idDocumento = @idDocumento;
    SELECT idTipoDocu, serie, numero FROM dbo.tbTipoDocu WHERE idTipoDocu IN (38, 43) ORDER BY idTipoDocu;
  `);
  return {
    tbDocumentos: result.recordsets[0],
    tbDetFact: result.recordsets[1],
    tbCtaCte: result.recordsets[2],
    tbDocumentosY: result.recordsets[3],
    tbTipoDocu: result.recordsets[4]
  };
}

async function snapshot(transaction: sql.Transaction, facturaValue: string) {
  const request = transaction.request();
  request.input('factura', sql.VarChar(13), facturaValue);
  const result = await request.query(`
    SELECT
      (SELECT COUNT(1) FROM dbo.tbDocumentos WHERE idTipoDocu = 38) AS tbDocumentosF03,
      (SELECT COUNT(1) FROM dbo.tbDetFact) AS tbDetFact,
      (SELECT COUNT(1) FROM dbo.TBCTACTE) AS tbCtaCte,
      (SELECT COUNT(1) FROM dbo.TBDOCUMENTOS_Y WHERE idTipoDocu = 38) AS tbDocumentosYF03;
    SELECT idTipoDocu, serie, numero FROM dbo.tbTipoDocu WHERE idTipoDocu IN (38, 43) ORDER BY idTipoDocu;
  `);
  return {
    counts: result.recordsets[0]?.[0] ?? null,
    tbTipoDocu: result.recordsets[1] ?? []
  };
}

async function snapshotWithPool(pool: sql.ConnectionPool, facturaValue: string, idDocumento: number) {
  const request = new sql.Request(pool);
  request.input('factura', sql.VarChar(13), facturaValue);
  request.input('idDocumento', sql.Int, idDocumento);
  const result = await request.query(`
    SET TRANSACTION ISOLATION LEVEL READ UNCOMMITTED;
    SELECT
      (SELECT COUNT(1) FROM dbo.tbDocumentos WHERE idDocumento = @idDocumento) AS tbDocumentosCreatedStillExists,
      (SELECT COUNT(1) FROM dbo.tbDetFact WHERE idDocumento = @idDocumento) AS tbDetFactCreatedStillExists,
      (SELECT COUNT(1) FROM dbo.TBCTACTE WHERE idDocumento = @idDocumento OR idDocAfectado = @idDocumento) AS tbCtaCteCreatedStillExists,
      (SELECT COUNT(1) FROM dbo.TBDOCUMENTOS_Y WHERE idDocumento = @idDocumento) AS tbDocumentosYCreatedStillExists;
    SELECT idTipoDocu, serie, numero FROM dbo.tbTipoDocu WHERE idTipoDocu IN (38, 43) ORDER BY idTipoDocu;
  `);

  return {
    createdRowsStillExist: result.recordsets[0]?.[0] ?? null,
    tbTipoDocu: result.recordsets[1] ?? []
  };
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

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
