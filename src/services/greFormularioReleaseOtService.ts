import type { AppConfig } from '../config/env.js';
import { GRE_FC_SERIE_PATTERN } from '../config/greSeries.js';
import { createGreFcPool, createYchiPool, sql } from '../integrations/bizlinksSql.js';
import { sanitizeValue } from '../utils/sanitize.js';

type TracedGuideRow = {
  operacionDbId: number;
  envioId: number;
  operationId: string;
  serieNumeroGuia: string;
};

type WorkOrderTraceRow = {
  idDetGuia: number;
  idOrdenVenta: number;
  idOT: number;
};

type ReceptionStateRow = {
  idOT: number;
  estadoGuia: string | null;
};

export type ReleaseWorkOrdersResult = {
  operationId: string;
  serieNumeroGuia: string;
  reused: boolean;
  updated: boolean;
  affectedRows: number;
  idsOT: number[];
  before: ReceptionStateRow[];
  after: ReceptionStateRow[];
};

export interface GreFormularioReleaseOtService {
  releaseWorkOrders(serieNumeroGuia: string, options: { user?: string }): Promise<ReleaseWorkOrdersResult>;
}

export class DirectDbGreFormularioReleaseOtService implements GreFormularioReleaseOtService {
  constructor(private readonly config: AppConfig) {}

  async releaseWorkOrders(serieNumeroGuia: string, options: { user?: string }): Promise<ReleaseWorkOrdersResult> {
    validateReleaseOtGuards(this.config, serieNumeroGuia);

    const greFcPool = createGreFcPool(this.config);
    const ychiPool = createYchiPool(this.config);

    await greFcPool.connect();
    await ychiPool.connect();

    const greFcTransaction = new sql.Transaction(greFcPool);
    const ychiTransaction = new sql.Transaction(ychiPool);
    let greFcCommitted = false;
    let ychiCommitted = false;

    try {
      await greFcTransaction.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);
      await acquireAppLock(greFcTransaction, `GRE_FC_RELEASE_OT_TRACE:${serieNumeroGuia}`);
      const traced = await getSingleTracedGuide(greFcTransaction, serieNumeroGuia);

      if (await wasAlreadyReleased(greFcTransaction, traced.operacionDbId)) {
        await greFcTransaction.commit();
        greFcCommitted = true;

        return {
          operationId: traced.operationId,
          serieNumeroGuia,
          reused: true,
          updated: false,
          affectedRows: 0,
          idsOT: [],
          before: [],
          after: []
        };
      }

      const detailIds = await getDetailIds(greFcTransaction, traced);
      if (detailIds.length === 0) {
        throw new Error(`La guia ${serieNumeroGuia} no tiene detalles trazados para liberar.`);
      }

      await ychiTransaction.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);
      await acquireAppLock(ychiTransaction, `GRE_FC_RELEASE_OT_YCHIDB3:${serieNumeroGuia}`);

      const workOrders = await resolveWorkOrdersFromDetails(ychiTransaction, detailIds);
      const idsOT = [...new Set(workOrders.map((row) => row.idOT).filter((value) => Number.isFinite(value)))];

      if (idsOT.length === 0) {
        throw new Error(`No se pudo resolver IDOT desde los detalles trazados de ${serieNumeroGuia}.`);
      }

      const before = await getReceptionStates(ychiTransaction, idsOT);
      await insertEvent(greFcTransaction, traced, 'OT_LIBERACION_INICIADA', 'Liberacion controlada de OT iniciada', {
        serieNumeroGuia,
        user: options.user ?? null,
        detailIds,
        workOrders,
        before
      });

      const affectedRows = await updateReceptionStatesToAvailable(ychiTransaction, idsOT);
      const after = await getReceptionStates(ychiTransaction, idsOT);

      await insertEvent(greFcTransaction, traced, 'OT_LIBERADA_YCHIDB3', 'EstadoGuia cambiado de S a N en YCHIDB3', {
        serieNumeroGuia,
        user: options.user ?? null,
        detailIds,
        idsOT,
        affectedRows,
        before,
        after
      });

      await ychiTransaction.commit();
      ychiCommitted = true;
      await greFcTransaction.commit();
      greFcCommitted = true;

      return {
        operationId: traced.operationId,
        serieNumeroGuia,
        reused: false,
        updated: affectedRows > 0,
        affectedRows,
        idsOT,
        before,
        after
      };
    } catch (error) {
      if (!ychiCommitted) await rollbackQuietly(ychiTransaction);

      if (!greFcCommitted) {
        try {
          await recordReleaseOtError(greFcTransaction, serieNumeroGuia, options.user, error);
          greFcCommitted = true;
        } catch {
          await rollbackQuietly(greFcTransaction);
        }
      }

      throw error;
    } finally {
      if (!ychiCommitted) await rollbackQuietly(ychiTransaction);
      if (!greFcCommitted) await rollbackQuietly(greFcTransaction);
      await ychiPool.close();
      await greFcPool.close();
    }
  }
}

export function validateReleaseOtGuards(config: Pick<AppConfig, 'dryRun' | 'directDbInsertEnabled'>, serieNumeroGuia: string) {
  if (config.dryRun) {
    throw new Error('La liberacion de OT requiere DRY_RUN=false.');
  }

  if (!config.directDbInsertEnabled) {
    throw new Error('La liberacion de OT requiere GRE_DIRECT_DB_INSERT_ENABLED=true.');
  }

  if (!GRE_FC_SERIE_PATTERN.test(serieNumeroGuia)) {
    throw new Error(`Serie no permitida para formularios continuos: ${serieNumeroGuia}.`);
  }
}

async function getSingleTracedGuide(transaction: sql.Transaction, serieNumeroGuia: string): Promise<TracedGuideRow> {
  const request = new sql.Request(transaction);
  request.input('serieNumeroGuia', sql.VarChar(20), serieNumeroGuia);

  const result = await request.query<TracedGuideRow>(`
    SELECT
      o.id AS operacionDbId,
      e.id AS envioId,
      CONVERT(varchar(36), o.idOperacion) AS operationId,
      e.serieNumeroGuia
    FROM dbo.GRE_FC_ENVIO e WITH (UPDLOCK, HOLDLOCK)
    INNER JOIN dbo.GRE_FC_OPERACION o WITH (UPDLOCK, HOLDLOCK)
      ON o.id = e.operacionId
    WHERE e.serieNumeroGuia = @serieNumeroGuia;
  `);

  if (result.recordset.length !== 1) {
    throw new Error(`Se esperaba exactamente una guia trazada GRE_FC para ${serieNumeroGuia}; encontradas ${result.recordset.length}.`);
  }

  return result.recordset[0]!;
}

async function wasAlreadyReleased(transaction: sql.Transaction, operacionDbId: number) {
  const request = new sql.Request(transaction);
  request.input('operacionId', sql.BigInt, operacionDbId);

  const result = await request.query<{ total: number }>(`
    SELECT COUNT(1) AS total
    FROM dbo.GRE_FC_EVENTO WITH (HOLDLOCK)
    WHERE operacionId = @operacionId
      AND tipo = 'OT_LIBERADA_YCHIDB3';
  `);

  return (result.recordset[0]?.total ?? 0) > 0;
}

async function getDetailIds(transaction: sql.Transaction, traced: TracedGuideRow) {
  const request = new sql.Request(transaction);
  request.input('operacionId', sql.BigInt, traced.operacionDbId);

  const result = await request.query<{ idDetGuiaOrigen: number | null }>(`
    SELECT idDetGuiaOrigen
    FROM dbo.GRE_FC_DETALLE WITH (HOLDLOCK)
    WHERE operacionId = @operacionId
      AND idDetGuiaOrigen IS NOT NULL;
  `);

  return result.recordset
    .map((row) => Number(row.idDetGuiaOrigen))
    .filter((value) => Number.isFinite(value));
}

async function resolveWorkOrdersFromDetails(transaction: sql.Transaction, detailIds: number[]) {
  const request = new sql.Request(transaction);
  const parameters = detailIds.map((id, index) => {
    const name = `idDetGuia${index}`;
    request.input(name, sql.Int, id);
    return `@${name}`;
  });

  const result = await request.query<WorkOrderTraceRow>(`
    SELECT DISTINCT
      d.idDetGuia,
      d.idOrdenVenta,
      b.IDOT AS idOT
    FROM dbo.VW_DETGUIA_REMISION d
    INNER JOIN dbo.VW_BUSCAS_DOCUMENTOS b
      ON b.idOrdenVenta = d.idOrdenVenta
    WHERE d.idDetGuia IN (${parameters.join(', ')})
      AND ISNULL(d.idDocumentos, 0) > 0
      AND b.IDOT IS NOT NULL;
  `);

  return result.recordset;
}

async function getReceptionStates(transaction: sql.Transaction, idsOT: number[]) {
  const request = new sql.Request(transaction);
  const parameters = idsOT.map((id, index) => {
    const name = `idOT${index}`;
    request.input(name, sql.Int, id);
    return `@${name}`;
  });

  const result = await request.query<ReceptionStateRow>(`
    SELECT
      IDOT AS idOT,
      EstadoGuia AS estadoGuia
    FROM dbo.tbRecepcionOT WITH (UPDLOCK, HOLDLOCK)
    WHERE IDOT IN (${parameters.join(', ')})
    ORDER BY IDOT;
  `);

  return result.recordset;
}

async function updateReceptionStatesToAvailable(transaction: sql.Transaction, idsOT: number[]) {
  const request = new sql.Request(transaction);
  const parameters = idsOT.map((id, index) => {
    const name = `idOTUpdate${index}`;
    request.input(name, sql.Int, id);
    return `@${name}`;
  });

  const result = await request.query<{ affectedRows: number }>(`
    UPDATE dbo.tbRecepcionOT
    SET EstadoGuia = 'N'
    WHERE IDOT IN (${parameters.join(', ')})
      AND EstadoGuia = 'S';

    SELECT @@ROWCOUNT AS affectedRows;
  `);

  return result.recordset[0]?.affectedRows ?? 0;
}

async function insertEvent(
  transaction: sql.Transaction,
  traced: TracedGuideRow,
  tipo: string,
  mensaje: string,
  datos: unknown
) {
  const request = new sql.Request(transaction);
  request.input('operacionId', sql.BigInt, traced.operacionDbId);
  request.input('envioId', sql.BigInt, traced.envioId);
  request.input('tipo', sql.VarChar(60), tipo);
  request.input('mensaje', sql.NVarChar(sql.MAX), mensaje);
  request.input('datosJson', sql.NVarChar(sql.MAX), JSON.stringify(sanitizeValue(datos)));

  await request.query(`
    INSERT INTO dbo.GRE_FC_EVENTO (operacionId, envioId, tipo, mensaje, datosJson)
    VALUES (@operacionId, @envioId, @tipo, @mensaje, @datosJson);
  `);
}

async function recordReleaseOtError(transaction: sql.Transaction, serieNumeroGuia: string, user: string | undefined, error: unknown) {
  const message = error instanceof Error ? error.message : 'Error desconocido';
  const request = new sql.Request(transaction);
  request.input('serieNumeroGuia', sql.VarChar(20), serieNumeroGuia);
  request.input('mensaje', sql.NVarChar(sql.MAX), message);
  request.input('datosJson', sql.NVarChar(sql.MAX), JSON.stringify(sanitizeValue({ serieNumeroGuia, user: user ?? null, error })));

  await request.query(`
    DECLARE @operacionId bigint;
    DECLARE @envioId bigint;

    SELECT TOP (1)
      @operacionId = o.id,
      @envioId = e.id
    FROM dbo.GRE_FC_ENVIO e
    INNER JOIN dbo.GRE_FC_OPERACION o
      ON o.id = e.operacionId
    WHERE e.serieNumeroGuia = @serieNumeroGuia
    ORDER BY e.id DESC;

    IF @operacionId IS NOT NULL
    BEGIN
      INSERT INTO dbo.GRE_FC_EVENTO (operacionId, envioId, tipo, mensaje, datosJson)
      VALUES (@operacionId, @envioId, 'ERROR_OT_LIBERACION', @mensaje, @datosJson);
    END;
  `);

  await transaction.commit();
}

async function acquireAppLock(transaction: sql.Transaction, resource: string) {
  const request = new sql.Request(transaction);
  request.input('resource', sql.NVarChar(255), resource);

  const result = await request.query<{ lockResult: number }>(`
    DECLARE @lockResult int;
    EXEC @lockResult = sp_getapplock
      @Resource = @resource,
      @LockMode = 'Exclusive',
      @LockOwner = 'Transaction',
      @LockTimeout = 15000;
    SELECT @lockResult AS lockResult;
  `);
  const lockResult = result.recordset[0]?.lockResult ?? -999;

  if (lockResult < 0) {
    throw new Error(`No se pudo obtener bloqueo SQL para ${resource}`);
  }
}

async function rollbackQuietly(transaction: sql.Transaction) {
  try {
    await transaction.rollback();
  } catch {
    // rollback best effort
  }
}
