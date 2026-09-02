import { loadEnv } from '../../config/env.js';
import { createBizlinksPool, sql } from '../../integrations/bizlinksSql.js';
import { getTwoSerieArgs } from './args.js';

type Row = Record<string, unknown>;

type ColumnMeta = {
  columnName: string;
  dataType: string;
  maxLength: number;
  precision: number;
  scale: number;
  isNullable: boolean;
};

type ResponseObject = {
  schemaName: string;
  objectName: string;
  objectType: string;
};

const args = getTwoSerieArgs();

if (!args.ok) {
  console.error(args.message);
  process.exit(1);
}

const config = loadEnv();
const pool = createBizlinksPool(config);

await pool.connect();

try {
  const headerDiff = await compareSingleRowTable(pool, 'dbo.SPE_DESPATCH', args.left, args.right);
  const itemDiff = await compareItemRows(pool, args.left, args.right);
  const responseSearch = await searchResponseObjects(pool, args.right);

  console.log(JSON.stringify({
    left: args.left,
    right: args.right,
    readOnly: true,
    SPE_DESPATCH: headerDiff,
    SPE_DESPATCH_ITEM: itemDiff,
    responseSearch
  }, null, 2));
} finally {
  await pool.close();
}

async function compareSingleRowTable(pool: sql.ConnectionPool, tableName: string, leftSerie: string, rightSerie: string) {
  const columns = await getColumnMetadata(pool, tableName);
  const left = await getRowsBySerie(pool, tableName, leftSerie);
  const right = await getRowsBySerie(pool, tableName, rightSerie);

  return {
    counts: {
      [leftSerie]: left.length,
      [rightSerie]: right.length
    },
    differences: diffRows(left[0] ?? null, right[0] ?? null, columns)
  };
}

async function compareItemRows(pool: sql.ConnectionPool, leftSerie: string, rightSerie: string) {
  const tableName = 'dbo.SPE_DESPATCH_ITEM';
  const columns = await getColumnMetadata(pool, tableName);
  const leftRows = await getRowsBySerie(pool, tableName, leftSerie);
  const rightRows = await getRowsBySerie(pool, tableName, rightSerie);
  const max = Math.max(leftRows.length, rightRows.length);
  const itemDiffs = [];

  for (let index = 0; index < max; index += 1) {
    const left = leftRows[index] ?? null;
    const right = rightRows[index] ?? null;
    const differences = diffRows(left, right, columns);

    if (differences.length > 0) {
      itemDiffs.push({
        index: index + 1,
        leftNumeroOrdenItem: left?.numeroOrdenItem ?? null,
        rightNumeroOrdenItem: right?.numeroOrdenItem ?? null,
        differences
      });
    }
  }

  return {
    counts: {
      [leftSerie]: leftRows.length,
      [rightSerie]: rightRows.length
    },
    differentItems: itemDiffs
  };
}

function diffRows(left: Row | null, right: Row | null, columns: ColumnMeta[]) {
  const differences = [];

  for (const column of columns) {
    const leftValue = left?.[column.columnName] ?? null;
    const rightValue = right?.[column.columnName] ?? null;

    if (!sameSqlValue(leftValue, rightValue)) {
      differences.push({
        column: column.columnName,
        type: {
          dataType: column.dataType,
          maxLength: column.maxLength,
          precision: column.precision,
          scale: column.scale,
          nullable: column.isNullable
        },
        left: describeValue(leftValue),
        right: describeValue(rightValue)
      });
    }
  }

  return differences;
}

function sameSqlValue(left: unknown, right: unknown) {
  if (left instanceof Date && right instanceof Date) return left.getTime() === right.getTime();
  return left === right;
}

function describeValue(value: unknown) {
  if (value === null || value === undefined) return { kind: 'NULL', value: null };
  if (value instanceof Date) return { kind: 'fecha', value: value.toISOString() };
  if (typeof value === 'string') return { kind: value.length === 0 ? 'cadena_vacia' : 'cadena', value };
  if (typeof value === 'number') return { kind: 'numero', value };
  if (typeof value === 'boolean') return { kind: 'booleano', value };
  return { kind: typeof value, value };
}

async function getRowsBySerie(pool: sql.ConnectionPool, tableName: string, serieNumeroGuia: string) {
  const request = new sql.Request(pool);
  request.input('serieNumeroGuia', sql.VarChar(20), serieNumeroGuia);
  const orderBy = tableName.toUpperCase().endsWith('SPE_DESPATCH_ITEM')
    ? `
    ORDER BY
      CASE
        WHEN ISNUMERIC(numeroOrdenItem) = 1 THEN CONVERT(int, numeroOrdenItem)
        ELSE 2147483647
      END,
      numeroOrdenItem`
    : '';

  return (await request.query<Row>(`
    SELECT *
    FROM ${tableName}
    WHERE serieNumeroGuia = @serieNumeroGuia
    ${orderBy}
  `)).recordset;
}

async function getColumnMetadata(pool: sql.ConnectionPool, tableName: string) {
  const [schemaName, objectName] = tableName.split('.');
  const request = new sql.Request(pool);
  request.input('schemaName', sql.NVarChar(128), schemaName);
  request.input('objectName', sql.NVarChar(128), objectName);

  return (await request.query<ColumnMeta>(`
    SELECT
      c.name AS columnName,
      ty.name AS dataType,
      c.max_length AS maxLength,
      c.precision,
      c.scale,
      CONVERT(bit, c.is_nullable) AS isNullable
    FROM sys.objects o
    INNER JOIN sys.schemas s
      ON s.schema_id = o.schema_id
    INNER JOIN sys.columns c
      ON c.object_id = o.object_id
    INNER JOIN sys.types ty
      ON ty.user_type_id = c.user_type_id
    WHERE s.name = @schemaName
      AND o.name = @objectName
    ORDER BY c.column_id
  `)).recordset;
}

async function searchResponseObjects(pool: sql.ConnectionPool, serieNumeroGuia: string) {
  const objects = (await pool.request().query<ResponseObject>(`
    SELECT DISTINCT
      s.name AS schemaName,
      o.name AS objectName,
      o.type_desc AS objectType
    FROM sys.objects o
    INNER JOIN sys.schemas s
      ON s.schema_id = o.schema_id
    INNER JOIN sys.columns c
      ON c.object_id = o.object_id
    WHERE o.type IN ('U', 'V')
      AND c.name = 'serieNumeroGuia'
      AND (
        o.name LIKE '%RESP%'
        OR o.name LIKE '%SUNAT%'
        OR o.name LIKE '%BIZ%'
        OR o.name LIKE '%DESPATCH%'
        OR o.name LIKE '%GRE%'
        OR o.name LIKE '%UBL%'
      )
    ORDER BY s.name, o.name
  `)).recordset;
  const results = [];

  for (const object of objects) {
    const qualifiedName = `[${object.schemaName.replaceAll(']', ']]')}].[${object.objectName.replaceAll(']', ']]')}]`;
    const request = new sql.Request(pool);
    request.input('serieNumeroGuia', sql.VarChar(20), serieNumeroGuia);

    try {
      const rows = (await request.query<Row>(`
        SELECT TOP (5) *
        FROM ${qualifiedName}
        WHERE serieNumeroGuia = @serieNumeroGuia
      `)).recordset;

      if (rows.length > 0) {
        results.push({
          object: `${object.schemaName}.${object.objectName}`,
          type: object.objectType,
          countShown: rows.length,
          rows
        });
      }
    } catch (error) {
      results.push({
        object: `${object.schemaName}.${object.objectName}`,
        type: object.objectType,
        error: error instanceof Error ? error.message : 'Error desconocido'
      });
    }
  }

  return {
    searchedObjects: objects.map((object) => `${object.schemaName}.${object.objectName}`),
    matches: results
  };
}
