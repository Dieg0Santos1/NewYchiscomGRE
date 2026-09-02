import { loadEnv } from '../../config/env.js';
import { createBizlinksPool, createGreFcPool, sql } from '../../integrations/bizlinksSql.js';
import { getSingleUuidArg } from './args.js';

const operationIdArg = getSingleUuidArg();

if (!operationIdArg.ok) {
  console.error(operationIdArg.message);
  process.exit(1);
}

const operationId = operationIdArg.value;
const config = loadEnv();
const greFcPool = createGreFcPool(config);
const bizlinksPool = createBizlinksPool(config);

await greFcPool.connect();
await bizlinksPool.connect();

try {
  const operationResult = await new sql.Request(greFcPool)
    .input('idOperacion', sql.UniqueIdentifier, operationId)
    .query<Record<string, unknown>>(`
      SELECT *
      FROM dbo.GRE_FC_OPERACION
      WHERE idOperacion = @idOperacion
    `);
  const operation = operationResult.recordset[0];

  const detalleResult = await new sql.Request(greFcPool)
    .input('idOperacion', sql.UniqueIdentifier, operationId)
    .query<Record<string, unknown>>(`
      SELECT d.*
      FROM dbo.GRE_FC_DETALLE d
      INNER JOIN dbo.GRE_FC_OPERACION o
        ON o.id = d.operacionId
      WHERE o.idOperacion = @idOperacion
      ORDER BY d.id
    `);

  const envioResult = await new sql.Request(greFcPool)
    .input('idOperacion', sql.UniqueIdentifier, operationId)
    .query<Record<string, unknown>>(`
      SELECT e.*
      FROM dbo.GRE_FC_ENVIO e
      INNER JOIN dbo.GRE_FC_OPERACION o
        ON o.id = e.operacionId
      WHERE o.idOperacion = @idOperacion
      ORDER BY e.id
    `);

  const eventoResult = await new sql.Request(greFcPool)
    .input('idOperacion', sql.UniqueIdentifier, operationId)
    .query<Record<string, unknown>>(`
      SELECT ev.*
      FROM dbo.GRE_FC_EVENTO ev
      INNER JOIN dbo.GRE_FC_OPERACION o
        ON o.id = ev.operacionId
      WHERE o.idOperacion = @idOperacion
      ORDER BY ev.id
    `);

  const envio = envioResult.recordset[0];
  const serieNumeroGuia = typeof envio?.serieNumeroGuia === 'string' ? envio.serieNumeroGuia : null;
  let speDespatch: Record<string, unknown>[] = [];
  let speItems: Record<string, unknown>[] = [];

  if (serieNumeroGuia) {
    speDespatch = (await new sql.Request(bizlinksPool)
      .input('serieNumeroGuia', sql.VarChar(20), serieNumeroGuia)
      .query<Record<string, unknown>>(`
        SELECT *
        FROM dbo.SPE_DESPATCH
        WHERE serieNumeroGuia = @serieNumeroGuia
      `)).recordset;

    speItems = (await new sql.Request(bizlinksPool)
      .input('serieNumeroGuia', sql.VarChar(20), serieNumeroGuia)
      .query<Record<string, unknown>>(`
        SELECT *
        FROM dbo.SPE_DESPATCH_ITEM
        WHERE serieNumeroGuia = @serieNumeroGuia
        ORDER BY
          CASE
            WHEN ISNUMERIC(numeroOrdenItem) = 1 THEN CONVERT(int, numeroOrdenItem)
            ELSE 2147483647
          END,
          numeroOrdenItem
      `)).recordset;
  }

  console.log(JSON.stringify({
    operationId,
    serieNumeroGuia,
    counts: {
      GRE_FC_OPERACION: operationResult.recordset.length,
      GRE_FC_DETALLE: detalleResult.recordset.length,
      GRE_FC_ENVIO: envioResult.recordset.length,
      GRE_FC_EVENTO: eventoResult.recordset.length,
      SPE_DESPATCH: speDespatch.length,
      SPE_DESPATCH_ITEM: speItems.length
    },
    expectedExactlyOne: {
      operation: operationResult.recordset.length === 1,
      envio: envioResult.recordset.length === 1,
      encabezado: speDespatch.length === 1,
      items: speItems.length
    },
    estado: {
      greOperacion: operation?.estado ?? null,
      greEnvio: envio?.estado ?? null,
      bizlinksRegistro: speDespatch[0]?.bl_estadoRegistro ?? null,
      bizlinksOrigen: speDespatch[0]?.bl_origen ?? null,
      bizlinksReintento: speDespatch[0]?.bl_reintento ?? null,
      bizlinksHasFileResponse: speDespatch[0]?.bl_hasFileResponse ?? null
    },
    greFc: {
      operacion: operation ?? null,
      envio: envioResult.recordset,
      detalle: detalleResult.recordset,
      eventos: eventoResult.recordset
    },
    bizlinks: {
      encabezado: speDespatch,
      items: speItems
    }
  }, null, 2));
} finally {
  await bizlinksPool.close();
  await greFcPool.close();
}
