import type { AppConfig } from '../config/env.js';
import { createBizlinksPool, createGreFcPool, sql } from '../integrations/bizlinksSql.js';
import { sanitizeValue } from '../utils/sanitize.js';

const CONTROLLED_SERIE = 'T999-00000096';

type ActivationEnvio = {
  operacionDbId: number;
  envioId: number;
  operacionEstado: string;
  envioEstado: string;
  serieNumeroGuia: string;
};

type SpeDespatchHeader = {
  tipoDocumentoRemitente: string;
  numeroDocumentoRemitente: string;
  serieNumeroGuia: string;
  tipoDocumentoGuia: string;
  bl_estadoRegistro: string | null;
  bl_origen: string | null;
  bl_reintento: number | null;
  bl_hasFileResponse: number | null;
};

export type ActivationResult = {
  operationId: string;
  serieNumeroGuia: string;
  reused: boolean;
  executedProcedure: boolean;
  before: {
    bl_estadoRegistro: string | null;
    bl_origen: string | null;
    items: number;
    responses: number;
  };
  after: {
    bl_estadoRegistro: string | null;
  };
};

export function validateActivationGuards(config: Pick<AppConfig, 'dryRun' | 'directDbInsertEnabled'>) {
  if (config.dryRun) {
    throw new Error('gre:test:activate requiere DRY_RUN=false.');
  }

  if (!config.directDbInsertEnabled) {
    throw new Error('gre:test:activate requiere GRE_DIRECT_DB_INSERT_ENABLED=true.');
  }
}

export function assertControlledSerie(serieNumeroGuia: string) {
  if (!/^T999-\d{8}$/.test(serieNumeroGuia)) {
    throw new Error(`Serie no permitida para activacion: ${serieNumeroGuia}. Solo T999.`);
  }

  if (serieNumeroGuia !== CONTROLLED_SERIE) {
    throw new Error(`Esta prueba controlada solo permite ${CONTROLLED_SERIE}. Serie encontrada: ${serieNumeroGuia}.`);
  }
}

export function isReusableBizlinksState(blEstadoRegistro: unknown, responseCount: number) {
  if (responseCount > 0) return true;
  if (typeof blEstadoRegistro !== 'string') return false;
  return ['A', 'L'].includes(blEstadoRegistro.toUpperCase());
}

export class GreFormularioActivationService {
  constructor(private readonly config: AppConfig) {}

  async activateExistingGuide(operationId: string): Promise<ActivationResult> {
    validateActivationGuards(this.config);

    const greFcPool = createGreFcPool(this.config);
    const bizlinksPool = createBizlinksPool(this.config);

    await greFcPool.connect();
    await bizlinksPool.connect();

    const greFcTransaction = new sql.Transaction(greFcPool);
    let greFcCommitted = false;
    let bizlinksTransaction: sql.Transaction | undefined;

    try {
      await greFcTransaction.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);
      await acquireAppLock(greFcTransaction, `GRE_FC_ACTIVATE_OPERATION:${operationId}`);

      const envio = await getActivationEnvio(greFcTransaction, operationId);
      assertControlledSerie(envio.serieNumeroGuia);
      await assertActivationStateConstraints(greFcTransaction);

      bizlinksTransaction = new sql.Transaction(bizlinksPool);
      await bizlinksTransaction.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);
      await acquireAppLock(bizlinksTransaction, `GRE_FC_ACTIVATE:${operationId}:${envio.serieNumeroGuia}`);

      const headerRows = await getSpeDespatchHeaders(bizlinksTransaction, envio.serieNumeroGuia);
      if (headerRows.length !== 1) {
        throw new Error(`Se esperaba exactamente un encabezado SPE_DESPATCH para ${envio.serieNumeroGuia}; encontrados ${headerRows.length}.`);
      }

      const header = headerRows[0]!;
      const itemCount = await getSpeDespatchItemCount(bizlinksTransaction, envio.serieNumeroGuia);
      if (itemCount < 1) {
        throw new Error(`La guia ${envio.serieNumeroGuia} no tiene items en SPE_DESPATCH_ITEM.`);
      }

      const responseCount = await getSpeDespatchResponseCount(bizlinksTransaction, envio.serieNumeroGuia);
      const before = {
        bl_estadoRegistro: header.bl_estadoRegistro,
        bl_origen: header.bl_origen,
        items: itemCount,
        responses: responseCount
      };

      if (isReusableBizlinksState(header.bl_estadoRegistro, responseCount) || envio.envioEstado === 'ACTIVADO') {
        await markActivatedIfNeeded(greFcTransaction, envio, header, {
          reused: true,
          reason: 'Guia ya activada/procesada o con respuesta Bizlinks',
          before
        });
        await bizlinksTransaction.commit();
        await greFcTransaction.commit();
        greFcCommitted = true;

        return {
          operationId,
          serieNumeroGuia: envio.serieNumeroGuia,
          reused: true,
          executedProcedure: false,
          before,
          after: {
            bl_estadoRegistro: header.bl_estadoRegistro
          }
        };
      }

      if (header.bl_estadoRegistro !== 'N') {
        throw new Error(`La guia ${envio.serieNumeroGuia} debe estar en bl_estadoRegistro=N antes de activar. Estado actual: ${header.bl_estadoRegistro ?? 'NULL'}.`);
      }

      if (envio.envioEstado === 'ACTIVADO' || envio.operacionEstado === 'ACTIVADO') {
        throw new Error(`La operacion ${operationId} ya figura ACTIVADO en GRE_FC.`);
      }

      await insertEvent(greFcTransaction, envio.operacionDbId, envio.envioId, 'ACTIVACION_INICIADA', 'Activacion controlada iniciada antes de USP_ENVIOGUIA', {
        serieNumeroGuia: envio.serieNumeroGuia,
        before
      });

      await executeUspEnvioGuia(bizlinksTransaction, header);
      const activatedHeader = await getSingleSpeDespatchHeader(bizlinksTransaction, envio.serieNumeroGuia);

      if (activatedHeader.bl_estadoRegistro !== 'A') {
        throw new Error(`USP_ENVIOGUIA finalizo pero ${envio.serieNumeroGuia} quedo en ${activatedHeader.bl_estadoRegistro ?? 'NULL'}, no en A.`);
      }

      await markActivated(greFcTransaction, envio, activatedHeader, {
        reused: false,
        before,
        after: { bl_estadoRegistro: activatedHeader.bl_estadoRegistro }
      });

      await bizlinksTransaction.commit();
      await greFcTransaction.commit();
      greFcCommitted = true;

      return {
        operationId,
        serieNumeroGuia: envio.serieNumeroGuia,
        reused: false,
        executedProcedure: true,
        before,
        after: {
          bl_estadoRegistro: activatedHeader.bl_estadoRegistro
        }
      };
    } catch (error) {
      await rollbackQuietly(bizlinksTransaction);

      if (!greFcCommitted) {
        try {
          await recordActivationError(greFcTransaction, operationId, error);
          greFcCommitted = true;
        } catch {
          await rollbackQuietly(greFcTransaction);
        }
      }

      throw error;
    } finally {
      if (!greFcCommitted) {
        await rollbackQuietly(greFcTransaction);
      }
      await bizlinksPool.close();
      await greFcPool.close();
    }
  }
}

async function getActivationEnvio(transaction: sql.Transaction, operationId: string): Promise<ActivationEnvio> {
  const request = new sql.Request(transaction);
  request.input('idOperacion', sql.UniqueIdentifier, operationId);

  const result = await request.query<ActivationEnvio & { serieNumeroGuia: string | null }>(`
    SELECT
      o.id AS operacionDbId,
      e.id AS envioId,
      o.estado AS operacionEstado,
      e.estado AS envioEstado,
      e.serieNumeroGuia
    FROM dbo.GRE_FC_OPERACION o WITH (UPDLOCK, HOLDLOCK)
    INNER JOIN dbo.GRE_FC_ENVIO e WITH (UPDLOCK, HOLDLOCK)
      ON e.operacionId = o.id
    WHERE o.idOperacion = @idOperacion
    ORDER BY e.id DESC;
  `);

  if (result.recordset.length !== 1) {
    throw new Error(`Se esperaba exactamente un envio GRE_FC para operationId ${operationId}; encontrados ${result.recordset.length}.`);
  }

  const envio = result.recordset[0]!;
  if (!envio.serieNumeroGuia) {
    throw new Error(`GRE_FC_ENVIO no tiene serieNumeroGuia para operationId ${operationId}.`);
  }

  return {
    ...envio,
    serieNumeroGuia: envio.serieNumeroGuia
  };
}

async function assertActivationStateConstraints(transaction: sql.Transaction) {
  const result = await new sql.Request(transaction).query<{ name: string; definition: string | null }>(`
    SELECT name, definition
    FROM sys.check_constraints
    WHERE parent_object_id IN (OBJECT_ID('dbo.GRE_FC_OPERACION'), OBJECT_ID('dbo.GRE_FC_ENVIO'))
      AND name IN ('CK_GRE_FC_OPERACION_estado', 'CK_GRE_FC_ENVIO_estado');
  `);
  const constraints = new Map(result.recordset.map((row) => [row.name, row.definition ?? '']));
  const missingOrOutdated = ['CK_GRE_FC_OPERACION_estado', 'CK_GRE_FC_ENVIO_estado']
    .filter((name) => !constraints.get(name)?.includes('ACTIVADO'));

  if (missingOrOutdated.length > 0) {
    throw new Error(`Migracion pendiente: aplicar migrations/GRE_FORMULARIOS_TEST/002_add_activation_states.sql antes de activar. Constraints sin ACTIVADO: ${missingOrOutdated.join(', ')}.`);
  }
}

async function getSpeDespatchHeaders(transaction: sql.Transaction, serieNumeroGuia: string) {
  const request = new sql.Request(transaction);
  request.input('serieNumeroGuia', sql.VarChar(20), serieNumeroGuia);

  const result = await request.query<SpeDespatchHeader>(`
    SELECT
      tipoDocumentoRemitente,
      numeroDocumentoRemitente,
      serieNumeroGuia,
      tipoDocumentoGuia,
      bl_estadoRegistro,
      bl_origen,
      bl_reintento,
      bl_hasFileResponse
    FROM dbo.SPE_DESPATCH WITH (UPDLOCK, HOLDLOCK)
    WHERE serieNumeroGuia = @serieNumeroGuia;
  `);

  return result.recordset;
}

async function getSingleSpeDespatchHeader(transaction: sql.Transaction, serieNumeroGuia: string) {
  const rows = await getSpeDespatchHeaders(transaction, serieNumeroGuia);

  if (rows.length !== 1) {
    throw new Error(`Se esperaba exactamente un encabezado SPE_DESPATCH para ${serieNumeroGuia}; encontrados ${rows.length}.`);
  }

  return rows[0]!;
}

async function getSpeDespatchItemCount(transaction: sql.Transaction, serieNumeroGuia: string) {
  const request = new sql.Request(transaction);
  request.input('serieNumeroGuia', sql.VarChar(20), serieNumeroGuia);

  const result = await request.query<{ total: number }>(`
    SELECT COUNT(1) AS total
    FROM dbo.SPE_DESPATCH_ITEM WITH (HOLDLOCK)
    WHERE serieNumeroGuia = @serieNumeroGuia;
  `);

  return result.recordset[0]?.total ?? 0;
}

async function getSpeDespatchResponseCount(transaction: sql.Transaction, serieNumeroGuia: string) {
  const request = new sql.Request(transaction);
  request.input('serieNumeroGuia', sql.VarChar(20), serieNumeroGuia);

  let result: sql.IResult<{ total: number }>;

  try {
    result = await request.query<{ total: number }>(`
      SELECT COUNT(1) AS total
      FROM dbo.SPE_DESPATCH_RESPONSE WITH (HOLDLOCK)
      WHERE serieNumeroGuia = @serieNumeroGuia;
    `);
  } catch (error) {
    if (isSqlPermissionDenied(error)) {
      throw new Error('Permiso requerido faltante: gre_app_test necesita SELECT sobre dbo.SPE_DESPATCH_RESPONSE para verificar que no exista respuesta antes de activar.');
    }

    throw error;
  }

  return result.recordset[0]?.total ?? 0;
}

async function executeUspEnvioGuia(transaction: sql.Transaction, header: SpeDespatchHeader) {
  const request = new sql.Request(transaction);
  request.input('tipoDocumentoRemitente', sql.VarChar(100), header.tipoDocumentoRemitente);
  request.input('numeroDocumentoRemitente', sql.VarChar(100), header.numeroDocumentoRemitente);
  request.input('serieNumeroGuia', sql.VarChar(100), header.serieNumeroGuia);
  request.input('tipoDocumentoGuia', sql.VarChar(100), header.tipoDocumentoGuia);

  await request.execute('dbo.USP_ENVIOGUIA');
}

async function markActivatedIfNeeded(
  transaction: sql.Transaction,
  envio: ActivationEnvio,
  header: SpeDespatchHeader,
  datos: unknown
) {
  if (envio.envioEstado === 'ACTIVADO' && envio.operacionEstado === 'ACTIVADO') return;

  await markActivated(transaction, envio, header, datos);
}

async function markActivated(
  transaction: sql.Transaction,
  envio: ActivationEnvio,
  header: SpeDespatchHeader,
  datos: unknown
) {
  const request = new sql.Request(transaction);
  request.input('operacionId', sql.BigInt, envio.operacionDbId);
  request.input('envioId', sql.BigInt, envio.envioId);
  request.input('respuestaJson', sql.NVarChar(sql.MAX), JSON.stringify(sanitizeValue(datos)));

  await request.query(`
    UPDATE dbo.GRE_FC_ENVIO
    SET estado = 'ACTIVADO',
        respuestaJson = @respuestaJson,
        actualizadoEn = SYSUTCDATETIME()
    WHERE id = @envioId;

    UPDATE dbo.GRE_FC_OPERACION
    SET estado = 'ACTIVADO',
        actualizadoEn = SYSUTCDATETIME(),
        finalizadoEn = SYSUTCDATETIME()
    WHERE id = @operacionId;
  `);

  await insertEvent(transaction, envio.operacionDbId, envio.envioId, 'ACTIVADA_BIZLINKS', 'Activacion Bizlinks confirmada en SPE_DESPATCH.bl_estadoRegistro=A', {
    serieNumeroGuia: header.serieNumeroGuia,
    estado: header.bl_estadoRegistro,
    datos
  });
}

async function recordActivationError(transaction: sql.Transaction, operationId: string, error: unknown) {
  const message = error instanceof Error ? error.message : 'Error desconocido';
  const request = new sql.Request(transaction);
  request.input('idOperacion', sql.UniqueIdentifier, operationId);
  request.input('mensaje', sql.NVarChar(sql.MAX), message);
  request.input('datosJson', sql.NVarChar(sql.MAX), JSON.stringify(sanitizeValue(error)));

  await request.query(`
    DECLARE @operacionId bigint;
    DECLARE @envioId bigint;

    SELECT @operacionId = id
    FROM dbo.GRE_FC_OPERACION
    WHERE idOperacion = @idOperacion;

    SELECT TOP (1) @envioId = id
    FROM dbo.GRE_FC_ENVIO
    WHERE operacionId = @operacionId
    ORDER BY id DESC;

    IF @envioId IS NOT NULL
    BEGIN
      UPDATE dbo.GRE_FC_ENVIO
      SET estado = 'ERROR',
          mensaje = @mensaje,
          actualizadoEn = SYSUTCDATETIME()
      WHERE id = @envioId;
    END;

    IF @operacionId IS NOT NULL
    BEGIN
      UPDATE dbo.GRE_FC_OPERACION
      SET estado = 'ERROR',
          actualizadoEn = SYSUTCDATETIME(),
          finalizadoEn = SYSUTCDATETIME()
      WHERE id = @operacionId;

      INSERT INTO dbo.GRE_FC_EVENTO (operacionId, envioId, tipo, mensaje, datosJson)
      VALUES (@operacionId, @envioId, 'ERROR_ACTIVACION', @mensaje, @datosJson);
    END;
  `);

  await transaction.commit();
}

async function insertEvent(
  transaction: sql.Transaction,
  operacionId: number,
  envioId: number,
  tipo: string,
  mensaje: string,
  datos: unknown
) {
  const request = new sql.Request(transaction);
  request.input('operacionId', sql.BigInt, operacionId);
  request.input('envioId', sql.BigInt, envioId);
  request.input('tipo', sql.VarChar(60), tipo);
  request.input('mensaje', sql.NVarChar(sql.MAX), mensaje);
  request.input('datosJson', sql.NVarChar(sql.MAX), JSON.stringify(sanitizeValue(datos)));

  await request.query(`
    INSERT INTO dbo.GRE_FC_EVENTO (operacionId, envioId, tipo, mensaje, datosJson)
    VALUES (@operacionId, @envioId, @tipo, @mensaje, @datosJson);
  `);
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

async function rollbackQuietly(transaction?: sql.Transaction) {
  if (!transaction) return;

  try {
    await transaction.rollback();
  } catch {
    // rollback best effort
  }
}

function isSqlPermissionDenied(error: unknown) {
  return typeof error === 'object'
    && error !== null
    && 'number' in error
    && (error as { number?: unknown }).number === 229;
}
