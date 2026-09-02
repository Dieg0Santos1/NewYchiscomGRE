import { loadEnv } from '../../src/config/env.js';
import { createBizlinksPool, createGreFcPool, sql } from '../../src/integrations/bizlinksSql.js';

const fcFactura = process.argv[2]?.trim() || 'FF01-00017146';
const referenceFactura = process.argv[3]?.trim() || 'FF03-00010961';

const headerColumns = [
  'SERIENUMERO',
  'TIPODOCUMENTO',
  'BL_ESTADOREGISTRO',
  'BL_REINTENTO',
  'BL_ORIGEN',
  'BL_HASFILERESPONSE',
  'FECHAEMISION',
  'horaEmision',
  'NUMERODOCUMENTOEMISOR',
  'TIPODOCUMENTOEMISOR',
  'RAZONSOCIALEMISOR',
  'NOMBRECOMERCIALEMISOR',
  'NUMERODOCUMENTOADQUIRIENTE',
  'tipoDocumentoAdquiriente',
  'RAZONSOCIALADQUIRIENTE',
  'tipoMoneda',
  'tipocambio',
  'totalValorVentaNetoOpGravadas',
  'totalIGV',
  'totalImpuestos',
  'totalVenta',
  'tipoOperacion',
  'GUIAREMISION',
  'TIPOGUIAREMISION',
  'ORDENCOMPRA',
  'formapago',
  'facturaPagoNegociable',
  'CODIGODETRACCION',
  'PORCENTAJEDETRACCION',
  'TOTALDETRACCION',
  'fechaVencimiento',
  'montoNetoPendiente',
  'montoPagoCuota1',
  'fechaPagoCuota1',
  'codigoLeyenda_1',
  'textoLeyenda_1'
];

const detailColumns = [
  'SERIENUMERO',
  'TIPODOCUMENTO',
  'NUMEROORDENITEM',
  'CANTIDAD',
  'UNIDADMEDIDA',
  'CODIGOPRODUCTO',
  'DESCRIPCION',
  'CODIGORAZONEXONERACION',
  'importeUnitarioSinImpuesto',
  'importeUnitarioConImpuesto',
  'importeTotalSinImpuesto',
  'ImporteIGV',
  'tasaIGV',
  'importeTotalImpuestos',
  'montoBaseIgv',
  'codigoImporteUnitarioConImpuesto',
  'textoAuxiliar250_1'
];

async function main() {
  const config = loadEnv();
  const bizlinksPool = createBizlinksPool(config);
  const greFcPool = createGreFcPool(config);

  await bizlinksPool.connect();
  await greFcPool.connect();

  try {
    const [headerExisting, detailExisting] = await Promise.all([
      existingColumns(bizlinksPool, 'SPE_EINVOICEHEADER', headerColumns),
      existingColumns(bizlinksPool, 'SPE_EINVOICEDETAIL', detailColumns)
    ]);

    const [fcHeader, refHeader, fcDetail, refDetail] = await Promise.all([
      selectColumns(bizlinksPool, 'SPE_EINVOICEHEADER', headerExisting, fcFactura),
      selectColumns(bizlinksPool, 'SPE_EINVOICEHEADER', headerExisting, referenceFactura),
      selectColumns(bizlinksPool, 'SPE_EINVOICEDETAIL', detailExisting, fcFactura, 'NUMEROORDENITEM'),
      selectColumns(bizlinksPool, 'SPE_EINVOICEDETAIL', detailExisting, referenceFactura, 'NUMEROORDENITEM')
    ]);

    const eventRequest = new sql.Request(greFcPool);
    eventRequest.input('factura', sql.VarChar(13), fcFactura);
    const events = await eventRequest.query(`
      SELECT TOP (20)
        ev.tipo,
        ev.mensaje,
        ev.datosJson,
        ev.creadoEn
      FROM dbo.FC_FACT_EVENTO ev
      LEFT JOIN dbo.FC_FACT_OPERACION o
        ON o.id = ev.operacionId
      WHERE o.serieNumeroFactura = @factura
         OR ev.datosJson LIKE '%' + @factura + '%'
      ORDER BY ev.id DESC;
    `);

    console.log(JSON.stringify({
      fcFactura,
      referenceFactura,
      columns: {
        header: headerExisting,
        detail: detailExisting
      },
      fc: {
        header: fcHeader.recordset,
        detail: fcDetail.recordset
      },
      reference: {
        header: refHeader.recordset,
        detail: refDetail.recordset
      },
      fcEvents: events.recordset.map((row: any) => ({
        ...row,
        datosJson: tryParseJson(row.datosJson)
      }))
    }, null, 2));
  } finally {
    await greFcPool.close();
    await bizlinksPool.close();
  }
}

async function existingColumns(pool: sql.ConnectionPool, tableName: string, columns: string[]) {
  const request = new sql.Request(pool);
  request.input('tableName', sql.VarChar(128), tableName);
  const result = await request.query<{ COLUMN_NAME: string }>(`
    SELECT COLUMN_NAME
    FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = 'dbo'
      AND TABLE_NAME = @tableName
  `);
  const existing = new Set(result.recordset.map((row) => row.COLUMN_NAME));

  return columns.filter((column) => existing.has(column));
}

function selectColumns(
  pool: sql.ConnectionPool,
  tableName: string,
  columns: string[],
  factura: string,
  orderBy = 'SERIENUMERO'
) {
  const request = new sql.Request(pool);
  request.input('factura', sql.VarChar(13), factura);

  return request.query(`
    SELECT TOP (20)
      ${columns.map((column) => `[${column}]`).join(',\n      ')}
    FROM dbo.${tableName}
    WHERE SERIENUMERO = @factura
      AND TIPODOCUMENTO = '01'
    ORDER BY [${orderBy}];
  `);
}

function tryParseJson(value: unknown) {
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
