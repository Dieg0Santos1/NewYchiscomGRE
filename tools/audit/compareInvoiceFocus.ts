import { loadEnv } from '../../src/config/env.js';
import { createBizlinksPool, sql } from '../../src/integrations/bizlinksSql.js';

const currentFactura = process.argv[2]?.trim() || 'FF01-00017146';
const referenceFactura = process.argv[3]?.trim() || 'FF03-00010961';

const headerColumns = [
  'SERIENUMERO',
  'BL_ESTADOREGISTRO',
  'BL_REINTENTO',
  'BL_ORIGEN',
  'BL_HASFILERESPONSE',
  'FECHAEMISION',
  'horaEmision',
  'numeroDocumentoAdquiriente',
  'razonSocialAdquiriente',
  'correoAdquiriente',
  'direccionAdquiriente',
  'ubigeoAdquiriente',
  'tipoMoneda',
  'tipocambio',
  'totalValorVentaNetoOpGravadas',
  'totalIgv',
  'totalImpuestos',
  'totalVenta',
  'tipoOperacion',
  'GUIAREMISION',
  'TIPOGUIAREMISION',
  'ORDENCOMPRA',
  'formapago',
  'facturaPagoNegociable',
  'codigoDetraccion',
  'porcentajeDetraccion',
  'totalDetraccion',
  'fechaVencimiento',
  'montoNetoPendiente',
  'montoPagoCuota1',
  'fechaPagoCuota1'
];

const detailColumns = [
  'NUMEROORDENITEM',
  'CANTIDAD',
  'unidadMedida',
  'CODIGOPRODUCTO',
  'descripcion',
  'CODIGORAZONEXONERACION',
  'importeUnitarioSinImpuesto',
  'importeUnitarioConImpuesto',
  'importeTotalSinImpuesto',
  'importeIgv',
  'tasaIgv',
  'importeTotalImpuestos',
  'montoBaseIgv',
  'codigoImporteUnitarioConImpues',
  'textoAuxiliar250_1'
];

async function main() {
  const config = loadEnv();
  const pool = createBizlinksPool(config);
  await pool.connect();

  try {
    const [headers, details, response] = await Promise.all([
      selectRows(pool, 'SPE_EINVOICEHEADER', headerColumns, [currentFactura, referenceFactura]),
      selectRows(pool, 'SPE_EINVOICEDETAIL', detailColumns, [currentFactura, referenceFactura], 'NUMEROORDENITEM'),
      selectResponse(pool, [currentFactura, referenceFactura])
    ]);

    const byFactura = (rows: any[]) =>
      Object.fromEntries(rows.map((row) => [row.SERIENUMERO, row]));

    console.dir(
      {
        facturas: [currentFactura, referenceFactura],
        headers: byFactura(headers),
        details,
        response
      },
      { depth: null, colors: false }
    );
  } finally {
    await pool.close();
  }
}

async function selectRows(
  pool: sql.ConnectionPool,
  tableName: string,
  columns: string[],
  facturas: string[],
  orderBy = 'SERIENUMERO'
) {
  const existing = await existingColumns(pool, tableName, columns);
  const request = new sql.Request(pool);
  facturas.forEach((factura, index) => request.input(`factura${index}`, sql.VarChar(13), factura));

  const result = await request.query(`
    SELECT ${['SERIENUMERO', ...existing.filter((column) => column !== 'SERIENUMERO')]
      .map((column) => `[${column}]`)
      .join(', ')}
    FROM dbo.${tableName}
    WHERE SERIENUMERO IN (${facturas.map((_, index) => `@factura${index}`).join(', ')})
      AND TIPODOCUMENTO = '01'
    ORDER BY ${orderBy === 'SERIENUMERO' ? 'SERIENUMERO' : `SERIENUMERO, [${orderBy}]`};
  `);

  return result.recordset;
}

async function selectResponse(pool: sql.ConnectionPool, facturas: string[]) {
  const request = new sql.Request(pool);
  facturas.forEach((factura, index) => request.input(`factura${index}`, sql.VarChar(13), factura));

  const result = await request.query(`
    SELECT TOP (20)
      SERIENUMERO,
      bl_estadoRegistro,
      bl_estadoProceso,
      process_state,
      bl_mensajeSunat,
      bl_mensaje,
      bl_url_pdf
    FROM dbo.SPE_EINVOICE_RESPONSE
    WHERE SERIENUMERO IN (${facturas.map((_, index) => `@factura${index}`).join(', ')})
      AND TIPODOCUMENTO = '01'
    ORDER BY SERIENUMERO;
  `);

  return result.recordset;
}

async function existingColumns(pool: sql.ConnectionPool, tableName: string, columns: string[]) {
  const request = new sql.Request(pool);
  request.input('tableName', sql.VarChar(128), tableName);
  const result = await request.query<{ COLUMN_NAME: string }>(`
    SELECT COLUMN_NAME
    FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = 'dbo'
      AND TABLE_NAME = @tableName;
  `);

  const existing = new Set(result.recordset.map((row) => row.COLUMN_NAME));
  return columns.filter((column) => existing.has(column));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
