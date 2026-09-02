import { loadEnv } from '../config/env.js';
import { createYchiPool, sql } from '../integrations/bizlinksSql.js';

type TableRow = {
  TABLE_SCHEMA: string;
  TABLE_NAME: string;
};

type ColumnRow = {
  TABLE_SCHEMA: string;
  TABLE_NAME: string;
  COLUMN_NAME: string;
  DATA_TYPE: string;
  ORDINAL_POSITION: number;
};

const tableNameHints = [
  'tbDocumentos',
  'tbDetFact',
  'CAF',
  'CANA',
  'CANB'
];

const columnHints = [
  'DesSoli',
  'Precio',
  'Prec',
  'Monto',
  'Total',
  'SubTotal',
  'Importe',
  'Valor',
  'Cot',
  'Coti',
  'Soli',
  'Guia',
  'NGuia',
  'Orden',
  'OT',
  'Codigo',
  'Descripcion'
];

async function main() {
  const config = loadEnv();
  const pool = createYchiPool(config);
  await pool.connect();

  try {
    console.log('# Auditoria FC precios sugeridos');
    console.log(`Base: ${config.ychiDb.database}`);
    console.log('Modo: SOLO LECTURA, no ejecuta INSERT/UPDATE/DELETE/ALTER');
    console.log('');

    const candidateTables = await listCandidateTables(pool);
    printTable('Tablas candidatas por nombre', candidateTables.map((row) => ({
      schema: row.TABLE_SCHEMA,
      table: row.TABLE_NAME
    })));

    const exactOrNearTables = candidateTables.filter((row) =>
      tableNameHints.some((hint) => row.TABLE_NAME.toLowerCase().includes(hint.toLowerCase()))
    );
    const tableColumns = await listColumnsForTables(pool, exactOrNearTables);
    printColumns('Columnas de tablas candidatas', tableColumns);

    const relevantColumns = await listRelevantColumns(pool);
    printColumns('Columnas candidatas por nombre de campo', relevantColumns);

    await printTbDocumentosSamples(pool);
    await printSamplesByRelevantTables(pool, relevantColumns);
    await printFocusedPricingAudit(pool);
  } finally {
    await pool.close();
  }
}

async function listCandidateTables(pool: sql.ConnectionPool) {
  const result = await new sql.Request(pool).query<TableRow>(`
    SELECT
      TABLE_SCHEMA,
      TABLE_NAME
    FROM INFORMATION_SCHEMA.TABLES
    WHERE TABLE_TYPE = 'BASE TABLE'
      AND (
        TABLE_NAME LIKE '%Docu%'
        OR TABLE_NAME LIKE '%CAF%'
        OR TABLE_NAME LIKE '%CANA%'
        OR TABLE_NAME LIKE '%CANB%'
        OR TABLE_NAME LIKE '%Cot%'
        OR TABLE_NAME LIKE '%Soli%'
        OR TABLE_NAME LIKE '%Fact%'
      )
    ORDER BY TABLE_NAME
  `);

  return result.recordset;
}

async function listColumnsForTables(pool: sql.ConnectionPool, tables: TableRow[]) {
  if (tables.length === 0) return [];

  const request = new sql.Request(pool);
  const filters = tables.map((table, index) => {
    request.input(`schema${index}`, sql.NVarChar(128), table.TABLE_SCHEMA);
    request.input(`table${index}`, sql.NVarChar(128), table.TABLE_NAME);

    return `(TABLE_SCHEMA = @schema${index} AND TABLE_NAME = @table${index})`;
  });

  const result = await request.query<ColumnRow>(`
    SELECT
      TABLE_SCHEMA,
      TABLE_NAME,
      COLUMN_NAME,
      DATA_TYPE,
      ORDINAL_POSITION
    FROM INFORMATION_SCHEMA.COLUMNS
    WHERE ${filters.join(' OR ')}
    ORDER BY TABLE_NAME, ORDINAL_POSITION
  `);

  return result.recordset;
}

async function listRelevantColumns(pool: sql.ConnectionPool) {
  const request = new sql.Request(pool);
  const filters = columnHints.map((hint, index) => {
    request.input(`hint${index}`, sql.NVarChar(128), `%${hint}%`);
    return `COLUMN_NAME LIKE @hint${index}`;
  });

  const result = await request.query<ColumnRow>(`
    SELECT TOP (300)
      TABLE_SCHEMA,
      TABLE_NAME,
      COLUMN_NAME,
      DATA_TYPE,
      ORDINAL_POSITION
    FROM INFORMATION_SCHEMA.COLUMNS
    WHERE ${filters.join(' OR ')}
    ORDER BY TABLE_NAME, ORDINAL_POSITION
  `);

  return result.recordset;
}

async function printTbDocumentosSamples(pool: sql.ConnectionPool) {
  const columns = await listColumnsForTables(pool, [{ TABLE_SCHEMA: 'dbo', TABLE_NAME: 'tbDocumentos' }]);
  if (columns.length === 0) return;

  const selectedColumns = pickExistingColumns(columns, [
    'idDocumento',
    'idDocumentos',
    'idTipoDocu',
    'SeriDocu',
    'NumeDocu',
    'FechaEmision',
    'FechaVencimiento',
    'nguia',
    'DescClieProv',
    'Subtotal',
    'SubTotal',
    'IGV',
    'Total',
    'cuenta',
    'Observaciones',
    'idClieProv'
  ]);

  if (selectedColumns.length === 0) return;

  const request = new sql.Request(pool);
  const result = await request.query<Record<string, unknown>>(`
    SELECT TOP (10)
      ${selectedColumns.map((column) => `[${column}]`).join(', ')}
    FROM dbo.tbDocumentos
    WHERE ISNULL(CONVERT(varchar(4000), nguia), '') LIKE '%T001-%'
       OR ISNULL(CONVERT(varchar(4000), SeriDocu), '') IN ('FF01', 'F01', 'FF03', 'FC01', 'FC03')
    ORDER BY FechaEmision DESC
  `);

  printTable('Muestra tbDocumentos relacionada a T001/facturas', result.recordset);
}

async function printSamplesByRelevantTables(pool: sql.ConnectionPool, columns: ColumnRow[]) {
  const byTable = new Map<string, ColumnRow[]>();

  for (const column of columns) {
    const key = `${column.TABLE_SCHEMA}.${column.TABLE_NAME}`;
    if (!byTable.has(key)) byTable.set(key, []);
    byTable.get(key)?.push(column);
  }

  const prioritized = [...byTable.entries()]
    .filter(([key]) => /(^|\.)(CAF|CANA|CANB|tbDetFact|tbDocumentos)$/i.test(key)
      || /Cot|Soli|Fact|Docu/i.test(key))
    .slice(0, 12);

  for (const [key, tableColumns] of prioritized) {
    const [schemaName, tableName] = key.split('.');
    const selectedColumns = pickExistingColumns(tableColumns, [
      'idDocumento',
      'idTipoDocu',
      'SeriDocu',
      'NumeDocu',
      'FechaEmision',
      'DesSoli',
      'Codigo',
      'Descripcion',
      'Precio',
      'Prec',
      'PrecioUnitario',
      'Monto',
      'Importe',
      'Valor',
      'Total',
      'SubTotal',
      'nguia',
      'OT',
      'Orden'
    ]);

    if (selectedColumns.length === 0) continue;

    try {
      const result = await new sql.Request(pool).query<Record<string, unknown>>(`
        SELECT TOP (5)
          ${selectedColumns.map((column) => `[${column}]`).join(', ')}
        FROM ${quoteName(schemaName)}.${quoteName(tableName)}
      `);
      printTable(`Muestra ${key}`, result.recordset);
    } catch (error) {
      console.log(`## Muestra ${key}`);
      console.log(error instanceof Error ? error.message : String(error));
      console.log('');
    }
  }
}

async function printFocusedPricingAudit(pool: sql.ConnectionPool) {
  const permissions = await new sql.Request(pool).query<Record<string, unknown>>(`
    SELECT *
    FROM (
      VALUES
        ('dbo.tbDocumentos'),
        ('dbo.tbDetFact'),
        ('dbo.tbCotizador'),
        ('dbo.tbDetSoliCant'),
        ('dbo.tbDetOrdenVenta'),
        ('dbo.tbOrdenVenta'),
        ('dbo.tbDetOTcant'),
        ('dbo.tbRecepcionOT')
    ) AS src(objectName)
    CROSS APPLY (
      SELECT
        HAS_PERMS_BY_NAME(src.objectName, 'OBJECT', 'SELECT') AS canSelect
    ) p
  `);
  printTable('Permisos SELECT fuentes candidatas', permissions.recordset);

  const exactNames = await new sql.Request(pool).query<Record<string, unknown>>(`
    SELECT
      o.type_desc,
      SCHEMA_NAME(o.schema_id) AS schemaName,
      o.name
    FROM sys.objects o
    WHERE o.name IN ('CAF', 'CANA', 'CANB')
       OR o.name LIKE '%CAF%'
       OR o.name LIKE '%CANA%'
       OR o.name LIKE '%CANB%'
    ORDER BY o.name
  `);
  printTable('Objetos CAF/CANA/CANB', exactNames.recordset);

  const desSoli = await new sql.Request(pool).query<Record<string, unknown>>(`
    SELECT
      TABLE_SCHEMA,
      TABLE_NAME,
      COLUMN_NAME,
      DATA_TYPE
    FROM INFORMATION_SCHEMA.COLUMNS
    WHERE COLUMN_NAME = 'DesSoli'
       OR COLUMN_NAME LIKE '%DesSoli%'
    ORDER BY TABLE_NAME, ORDINAL_POSITION
  `);
  printTable('Columnas DesSoli', desSoli.recordset);

  const oldInvoiceDetails = await new sql.Request(pool).query<Record<string, unknown>>(`
    SELECT TOP (40)
      doc.idDocumento,
      doc.SeriDocu,
      doc.NumeDocu,
      doc.FechaEmision,
      doc.nguia,
      doc.DescClieProv,
      doc.Neto AS NetoDocumento,
      doc.Igv AS IgvDocumento,
      doc.Total AS TotalDocumento,
      det.idDetFact,
      det.idDetOrdenVenta,
      det.idRecepcionOt,
      det.numorden,
      det.Descripcion,
      det.Cantidad,
      det.Precio,
      det.Igv AS IgvDetalle,
      det.Neto AS NetoDetalle,
      det.Total AS TotalDetalle
    FROM dbo.tbDocumentos doc
    INNER JOIN dbo.tbDetFact det
      ON det.idDocumento = doc.idDocumento
    WHERE doc.idTipoDocu = 1
      AND doc.SeriDocu IN ('F01', 'FF01', 'FC01', 'FC03', 'FF03')
      AND ISNULL(CONVERT(varchar(4000), doc.nguia), '') LIKE '%T001%'
    ORDER BY doc.FechaEmision DESC, det.idDetFact
  `);
  printTable('Detalle facturas antiguas con T001', oldInvoiceDetails.recordset);

  const exactGuide = await new sql.Request(pool)
    .input('guide', sql.VarChar(30), '%T001-00000019%')
    .query<Record<string, unknown>>(`
      SELECT TOP (20)
        doc.idDocumento,
        doc.SeriDocu,
        doc.NumeDocu,
        doc.FechaEmision,
        doc.nguia,
        doc.DescClieProv,
        det.Descripcion,
        det.Cantidad,
        det.Precio,
        det.Neto,
        det.Igv,
        det.Total,
        det.idDetOrdenVenta,
        det.idRecepcionOt,
        det.numorden
      FROM dbo.tbDocumentos doc
      LEFT JOIN dbo.tbDetFact det
        ON det.idDocumento = doc.idDocumento
      WHERE ISNULL(CONVERT(varchar(4000), doc.nguia), '') LIKE @guide
      ORDER BY doc.FechaEmision DESC
    `);
  printTable('Busqueda exacta guia T001-00000019 en factura historica', exactGuide.recordset);

  const ovColumns = await listColumnsForTables(pool, [
    { TABLE_SCHEMA: 'dbo', TABLE_NAME: 'tbDetOrdenVenta' },
    { TABLE_SCHEMA: 'dbo', TABLE_NAME: 'tbOrdenVenta' },
    { TABLE_SCHEMA: 'dbo', TABLE_NAME: 'tbDetSoliCant' },
    { TABLE_SCHEMA: 'dbo', TABLE_NAME: 'tbCotizador' }
  ]);
  printColumns('Columnas orden/cotizacion candidatas', ovColumns);
}

function pickExistingColumns(columns: ColumnRow[], preferred: string[]) {
  const existing = new Map(columns.map((column) => [column.COLUMN_NAME.toLowerCase(), column.COLUMN_NAME]));

  return preferred
    .map((column) => existing.get(column.toLowerCase()))
    .filter((column): column is string => Boolean(column));
}

function printColumns(title: string, rows: ColumnRow[]) {
  printTable(title, rows.map((row) => ({
    table: `${row.TABLE_SCHEMA}.${row.TABLE_NAME}`,
    column: row.COLUMN_NAME,
    type: row.DATA_TYPE,
    ordinal: row.ORDINAL_POSITION
  })));
}

function printTable(title: string, rows: Array<Record<string, unknown>>) {
  console.log(`## ${title}`);
  if (rows.length === 0) {
    console.log('Sin resultados.');
    console.log('');
    return;
  }

  for (const row of rows.slice(0, 80)) {
    console.log(JSON.stringify(row, null, 0));
  }
  if (rows.length > 80) {
    console.log(`... ${rows.length - 80} filas omitidas`);
  }
  console.log('');
}

function quoteName(value: string) {
  return `[${value.replace(/]/g, ']]')}]`;
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
