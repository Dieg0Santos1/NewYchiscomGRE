import { loadEnv } from '../../config/env.js';
import { createBizlinksPool, sql } from '../../integrations/bizlinksSql.js';
import { getSingleSerieArg } from './args.js';

type Row = Record<string, unknown>;

type TraceObject = {
  schemaName: string;
  objectName: string;
  objectType: string;
  columnName: string;
};

const args = getSingleSerieArg(process.argv.slice(2), 'gre:test:diagnose-e');

if (!args.ok) {
  console.error(args.message);
  process.exit(1);
}

const config = loadEnv();
const pool = createBizlinksPool(config);

await pool.connect();

try {
  const serieNumeroGuia = args.value;
  const header = await queryTable(pool, 'dbo.SPE_DESPATCH', 'serieNumeroGuia', serieNumeroGuia, 'serieNumeroGuia');
  const items = await queryTable(pool, 'dbo.SPE_DESPATCH_ITEM', 'serieNumeroGuia', serieNumeroGuia, 'numeroOrdenItem');
  const responses = await queryTable(pool, 'dbo.SPE_DESPATCH_RESPONSE', 'serieNumeroGuia', serieNumeroGuia, 'serieNumeroGuia');
  const auxiliar = await queryTable(pool, 'dbo.SPE_DESPATCH_AUXILIAR', 'SERIENUMERO', serieNumeroGuia, 'SERIENUMERO');
  const relatedDocs = await queryTable(pool, 'dbo.SPE_DESPATCH_DOCRELACIONADO', 'serieNumeroGuia', serieNumeroGuia, 'serieNumeroGuia');
  const visibleTraces = await searchVisibleTraceObjects(pool, serieNumeroGuia);

  console.log(JSON.stringify({
    serieNumeroGuia,
    readOnly: true,
    expectedContext: 'Diagnostico de guia en E despues de activacion N -> A -> E; no ejecuta SP ni modifica datos.',
    directTables: {
      SPE_DESPATCH: summarizeTableResult(header),
      SPE_DESPATCH_ITEM: summarizeTableResult(items),
      SPE_DESPATCH_RESPONSE: summarizeTableResult(responses),
      SPE_DESPATCH_AUXILIAR: summarizeTableResult(auxiliar),
      SPE_DESPATCH_DOCRELACIONADO: summarizeTableResult(relatedDocs)
    },
    visibleTraceSearch: visibleTraces,
    interpretationHints: [
      'Si SPE_DESPATCH_AUXILIAR esta vacia y la guia aceptada equivalente si la tiene, el flujo directo omitio datos auxiliares.',
      'Si bl_origen difiere de la guia aceptada, revisar el valor predeterminado aplicado por USP_CabeceraGuia.',
      'Si no hay SPE_DESPATCH_RESPONSE, el error ocurrio antes de persistir una respuesta final Bizlinks/SUNAT.'
    ]
  }, null, 2));
} finally {
  await pool.close();
}

async function queryTable(
  pool: sql.ConnectionPool,
  tableName: string,
  columnName: string,
  value: string,
  orderColumn: string
) {
  const [schemaName, objectName] = splitObjectName(tableName);
  const qualifiedName = `${quoteIdentifier(schemaName)}.${quoteIdentifier(objectName)}`;
  const request = new sql.Request(pool);
  request.input('value', sql.VarChar(20), value);

  try {
    const rows = (await request.query<Row>(`
      SELECT TOP (20) *
      FROM ${qualifiedName}
      WHERE ${quoteIdentifier(columnName)} = @value
      ORDER BY ${quoteIdentifier(orderColumn)}
    `)).recordset;

    return { ok: true as const, countShown: rows.length, rows };
  } catch (error) {
    return {
      ok: false as const,
      error: error instanceof Error ? error.message : 'Error desconocido'
    };
  }
}

function summarizeTableResult(result: Awaited<ReturnType<typeof queryTable>>) {
  if (!result.ok) return result;
  return {
    ok: true,
    countShown: result.countShown,
    rows: result.rows
  };
}

async function searchVisibleTraceObjects(pool: sql.ConnectionPool, serieNumeroGuia: string) {
  const objects = (await new sql.Request(pool).query<TraceObject>(`
    SELECT DISTINCT
      s.name AS schemaName,
      o.name AS objectName,
      o.type_desc AS objectType,
      c.name AS columnName
    FROM sys.objects o
    INNER JOIN sys.schemas s
      ON s.schema_id = o.schema_id
    INNER JOIN sys.columns c
      ON c.object_id = o.object_id
    WHERE o.type IN ('U', 'V')
      AND (
        c.name IN ('serieNumeroGuia', 'SERIENUMERO')
        OR c.name LIKE '%Guia%'
        OR c.name LIKE '%Serie%'
      )
      AND (
        o.name LIKE '%DESPATCH%'
        OR o.name LIKE '%RESP%'
        OR o.name LIKE '%SUNAT%'
        OR o.name LIKE '%LOG%'
        OR o.name LIKE '%BITA%'
        OR o.name LIKE '%TRACE%'
        OR o.name LIKE '%ERROR%'
        OR o.name LIKE '%UBL%'
      )
    ORDER BY s.name, o.name, c.name
  `)).recordset;

  const matches = [];

  for (const object of objects) {
    const qualifiedName = `${quoteIdentifier(object.schemaName)}.${quoteIdentifier(object.objectName)}`;
    const request = new sql.Request(pool);
    request.input('serieNumeroGuia', sql.VarChar(20), serieNumeroGuia);

    try {
      const result = await request.query<{ total: number }>(`
        SELECT COUNT(1) AS total
        FROM ${qualifiedName}
        WHERE ${quoteIdentifier(object.columnName)} = @serieNumeroGuia
      `);
      const total = result.recordset[0]?.total ?? 0;

      if (total > 0) {
        matches.push({
          object: `${object.schemaName}.${object.objectName}`,
          type: object.objectType,
          column: object.columnName,
          total
        });
      }
    } catch (error) {
      matches.push({
        object: `${object.schemaName}.${object.objectName}`,
        type: object.objectType,
        column: object.columnName,
        error: error instanceof Error ? error.message : 'Error desconocido'
      });
    }
  }

  return {
    searchedObjects: objects.map((object) => ({
      object: `${object.schemaName}.${object.objectName}`,
      type: object.objectType,
      column: object.columnName
    })),
    matches
  };
}

function splitObjectName(objectName: string): [string, string] {
  const [schemaName, tableName] = objectName.split('.');
  return [schemaName ?? 'dbo', tableName ?? objectName];
}

function quoteIdentifier(value: string) {
  return `[${value.replaceAll(']', ']]')}]`;
}
