import type { AppConfig } from '../config/env.js';
import { GRE_TRASLADO_SERIE_PATTERN } from '../config/greTrasladoSeries.js';
import { createBizlinksPool, createGreFcPool, sql } from '../integrations/bizlinksSql.js';
import {
  buildManualAcceptedSunatMessage,
  isEligibleForManualSunatMessage
} from './greFormularioManualSunatService.js';
import { sanitizeValue } from '../utils/sanitize.js';

const RESPONSE_TABLE = 'dbo.SPE_DESPATCH_RESPONSE';

type TracedTrasladoRow = {
  operacionDbId: number;
  envioId: number;
  operationId: string;
  serieNumeroGuia: string;
};

type ResponseRow = {
  serieNumeroGuia: string;
  bl_estadoRegistro: string | null;
  bl_estadoProceso: string | null;
  process_state: string | null;
  bl_mensajeSunat: string | null;
};

export type TrasladoManualSunatAcceptanceResult = {
  operationId: string;
  serieNumeroGuia: string;
  reused: boolean;
  updated: boolean;
  message: string;
  before: ResponseRow;
  after: ResponseRow;
};

export interface GreTrasladoManualSunatService {
  setAcceptedMessage(serieNumeroGuia: string, options: { user?: string }): Promise<TrasladoManualSunatAcceptanceResult>;
}

export class DirectDbGreTrasladoManualSunatService implements GreTrasladoManualSunatService {
  constructor(private readonly config: AppConfig) {}

  async setAcceptedMessage(serieNumeroGuia: string, options: { user?: string }): Promise<TrasladoManualSunatAcceptanceResult> {
    validateManualSunatGuards(this.config, serieNumeroGuia);

    const greFcPool = createGreFcPool(this.config);
    const bizlinksPool = createBizlinksPool(this.config);

    await greFcPool.connect();
    await bizlinksPool.connect();

    const greFcTransaction = new sql.Transaction(greFcPool);
    const bizlinksTransaction = new sql.Transaction(bizlinksPool);
    let greFcCommitted = false;
    let bizlinksCommitted = false;

    try {
      await greFcTransaction.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);
      await acquireAppLock(greFcTransaction, `GRE_TRASLADO_MANUAL_SUNAT_TRACE:${serieNumeroGuia}`);
      const traced = await getSingleTracedTraslado(greFcTransaction, serieNumeroGuia);

      await bizlinksTransaction.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);
      await acquireAppLock(bizlinksTransaction, `GRE_TRASLADO_MANUAL_SUNAT_RESPONSE:${serieNumeroGuia}`);
      const before = await getSingleResponseRow(bizlinksTransaction, serieNumeroGuia);
      const acceptedMessage = buildManualAcceptedSunatMessage(serieNumeroGuia);

      if (before.bl_mensajeSunat?.trim() === acceptedMessage) {
        await insertEvent(greFcTransaction, traced, 'SUNAT_MENSAJE_MANUAL_REUTILIZADO', 'La guia T002 ya tenia el mensaje manual de aceptacion SUNAT', {
          serieNumeroGuia,
          user: options.user ?? null,
          before
        });
        await bizlinksTransaction.commit();
        bizlinksCommitted = true;
        await greFcTransaction.commit();
        greFcCommitted = true;

        return {
          operationId: traced.operationId,
          serieNumeroGuia,
          reused: true,
          updated: false,
          message: acceptedMessage,
          before,
          after: before
        };
      }

      if (!isEligibleForManualSunatMessage(before)) {
        throw new Error(`La guia ${serieNumeroGuia} no cumple el estado permitido para mensaje manual SUNAT.`);
      }

      await insertEvent(greFcTransaction, traced, 'SUNAT_MENSAJE_MANUAL_INICIADO', 'Actualizacion manual controlada de bl_mensajeSunat iniciada para T002', {
        serieNumeroGuia,
        user: options.user ?? null,
        before
      });
      await updateResponseMessage(bizlinksTransaction, serieNumeroGuia, acceptedMessage);
      const after = await getSingleResponseRow(bizlinksTransaction, serieNumeroGuia);

      if (after.bl_mensajeSunat !== acceptedMessage) {
        throw new Error(`No se pudo confirmar bl_mensajeSunat para ${serieNumeroGuia}.`);
      }

      await insertEvent(greFcTransaction, traced, 'SUNAT_MENSAJE_MANUAL_APLICADO', 'bl_mensajeSunat actualizado de forma controlada para T002', {
        serieNumeroGuia,
        user: options.user ?? null,
        before,
        after
      });

      await bizlinksTransaction.commit();
      bizlinksCommitted = true;
      await greFcTransaction.commit();
      greFcCommitted = true;

      return {
        operationId: traced.operationId,
        serieNumeroGuia,
        reused: false,
        updated: true,
        message: acceptedMessage,
        before,
        after
      };
    } catch (error) {
      if (!bizlinksCommitted) await rollbackQuietly(bizlinksTransaction);

      if (!greFcCommitted) {
        try {
          await recordManualSunatError(greFcTransaction, serieNumeroGuia, options.user, error);
          greFcCommitted = true;
        } catch {
          await rollbackQuietly(greFcTransaction);
        }
      }

      throw error;
    } finally {
      if (!bizlinksCommitted) await rollbackQuietly(bizlinksTransaction);
      if (!greFcCommitted) await rollbackQuietly(greFcTransaction);
      await bizlinksPool.close();
      await greFcPool.close();
    }
  }
}

function validateManualSunatGuards(config: Pick<AppConfig, 'dryRun' | 'directDbInsertEnabled'>, serieNumeroGuia: string) {
  if (config.dryRun) {
    throw new Error('La actualizacion manual SUNAT requiere DRY_RUN=false.');
  }

  if (!config.directDbInsertEnabled) {
    throw new Error('La actualizacion manual SUNAT requiere GRE_DIRECT_DB_INSERT_ENABLED=true.');
  }

  if (!GRE_TRASLADO_SERIE_PATTERN.test(serieNumeroGuia)) {
    throw new Error(`Serie no permitida para traslado: ${serieNumeroGuia}.`);
  }
}

async function getSingleTracedTraslado(transaction: sql.Transaction, serieNumeroGuia: string): Promise<TracedTrasladoRow> {
  const request = new sql.Request(transaction);
  request.input('serieNumeroGuia', sql.VarChar(20), serieNumeroGuia);

  const result = await request.query<TracedTrasladoRow>(`
    SELECT
      o.id AS operacionDbId,
      e.id AS envioId,
      CONVERT(varchar(36), o.idOperacion) AS operationId,
      e.serieNumeroGuia
    FROM dbo.GRE_TRASLADO_ENVIO e WITH (UPDLOCK, HOLDLOCK)
    INNER JOIN dbo.GRE_TRASLADO_OPERACION o WITH (UPDLOCK, HOLDLOCK)
      ON o.id = e.operacionId
    WHERE e.serieNumeroGuia = @serieNumeroGuia;
  `);

  if (result.recordset.length !== 1) {
    throw new Error(`Se esperaba exactamente una guia trazada GRE_TRASLADO para ${serieNumeroGuia}; encontradas ${result.recordset.length}.`);
  }

  return result.recordset[0]!;
}

async function getSingleResponseRow(transaction: sql.Transaction, serieNumeroGuia: string): Promise<ResponseRow> {
  const request = new sql.Request(transaction);
  request.input('serieNumeroGuia', sql.VarChar(20), serieNumeroGuia);

  const result = await request.query<ResponseRow>(`
    SELECT
      serieNumeroGuia,
      bl_estadoRegistro,
      bl_estadoProceso,
      process_state,
      bl_mensajeSunat
    FROM ${RESPONSE_TABLE} WITH (UPDLOCK, HOLDLOCK)
    WHERE serieNumeroGuia = @serieNumeroGuia
      AND tipoDocumentoGuia = '09';
  `);

  if (result.recordset.length !== 1) {
    throw new Error(`Se esperaba exactamente una respuesta Bizlinks para ${serieNumeroGuia}; encontradas ${result.recordset.length}.`);
  }

  return result.recordset[0]!;
}

async function updateResponseMessage(transaction: sql.Transaction, serieNumeroGuia: string, message: string) {
  const request = new sql.Request(transaction);
  request.input('serieNumeroGuia', sql.VarChar(20), serieNumeroGuia);
  request.input('mensajeSunat', sql.NVarChar(4000), message);

  const result = await request.query<{ affectedRows: number }>(`
    UPDATE ${RESPONSE_TABLE}
    SET bl_mensajeSunat = @mensajeSunat
    WHERE serieNumeroGuia = @serieNumeroGuia
      AND tipoDocumentoGuia = '09'
      AND bl_estadoRegistro = 'L'
      AND bl_estadoProceso IN ('SIGNED/ED_06', 'SIGNED/PE_02')
      AND process_state = '_2_CONSULT'
      AND NULLIF(LTRIM(RTRIM(bl_mensajeSunat)), '') IS NULL;

    SELECT @@ROWCOUNT AS affectedRows;
  `);

  if ((result.recordset[0]?.affectedRows ?? 0) !== 1) {
    throw new Error(`No se actualizo bl_mensajeSunat para ${serieNumeroGuia}; el estado pudo cambiar durante la operacion.`);
  }
}

async function insertEvent(
  transaction: sql.Transaction,
  traced: TracedTrasladoRow,
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
    INSERT INTO dbo.GRE_TRASLADO_EVENTO (operacionId, envioId, tipo, mensaje, datosJson)
    VALUES (@operacionId, @envioId, @tipo, @mensaje, @datosJson);
  `);
}

async function recordManualSunatError(transaction: sql.Transaction, serieNumeroGuia: string, user: string | undefined, error: unknown) {
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
    FROM dbo.GRE_TRASLADO_ENVIO e
    INNER JOIN dbo.GRE_TRASLADO_OPERACION o
      ON o.id = e.operacionId
    WHERE e.serieNumeroGuia = @serieNumeroGuia
    ORDER BY e.id DESC;

    IF @operacionId IS NOT NULL
    BEGIN
      INSERT INTO dbo.GRE_TRASLADO_EVENTO (operacionId, envioId, tipo, mensaje, datosJson)
      VALUES (@operacionId, @envioId, 'ERROR_SUNAT_MENSAJE_MANUAL', @mensaje, @datosJson);
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
