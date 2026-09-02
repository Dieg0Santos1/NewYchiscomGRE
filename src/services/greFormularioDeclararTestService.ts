import type { AppConfig } from '../config/env.js';
import { extractGreFcSerie } from '../config/greSeries.js';
import { getGreDefaults } from '../config/greDefaults.js';
import { createBizlinksPool, createGreFcPool, sql } from '../integrations/bizlinksSql.js';
import type { GrePayload } from '../mappers/grePayloadMapper.js';
import { mapGreInputToPayload } from '../mappers/grePayloadMapper.js';
import { toSpeDespatchProcedurePlan, type StoredProcedureParam } from '../mappers/speDespatchProcedureMapper.js';
import type { GreInputDto } from '../schemas/greInputSchema.js';
import { privateDriverExists } from './greFormularioQueryService.js';
import { sanitizeValue } from '../utils/sanitize.js';

const HEADER_TABLE = 'dbo.SPE_DESPATCH';
const ITEM_TABLE = 'dbo.SPE_DESPATCH_ITEM';
const AUX_TABLE = 'dbo.SPE_DESPATCH_AUXILIAR';
const RESPONSE_TABLE = 'dbo.SPE_DESPATCH_RESPONSE';

export type DeclararTestResult = {
  operationId: string;
  reused: boolean;
  generatedSerieNumeroGuia: string;
  insertedHeader: boolean;
  insertedItems: number;
  activated: boolean;
  status: unknown;
};

export type DeclararTestOptions = {
  operationId: string;
  user?: string;
};

export interface GreFormularioDeclararTestService {
  declarar(input: GreInputDto, options: DeclararTestOptions): Promise<DeclararTestResult>;
}

type ExistingEnvio = {
  operacionDbId: number;
  envioId: number;
  serieNumeroGuia: string;
  estado: string;
  intentos: number;
};

type PreparedEnvio = {
  operacionDbId: number;
  envioId: number;
  serieNumeroGuia: string | null;
};

type ProcedureExecutionStatus = {
  header: Record<string, unknown> | null;
  headerCount: number;
  itemCount: number;
  auxCount: number;
  responseCount: number;
};

export class DirectDbGreFormularioDeclararTestService implements GreFormularioDeclararTestService {
  constructor(private readonly config: AppConfig) {}

  async declarar(input: GreInputDto, options: DeclararTestOptions): Promise<DeclararTestResult> {
    const greFcPool = createGreFcPool(this.config);
    const bizlinksPool = createBizlinksPool(this.config);

    await greFcPool.connect();
    await bizlinksPool.connect();

    const greFcTransaction = new sql.Transaction(greFcPool);
    let greFcCommitted = false;
    let bizlinksTransaction: sql.Transaction | undefined;

    try {
      await greFcTransaction.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);
      await acquireAppLock(greFcTransaction, `GRE_FC_OPERACION:${options.operationId}`);

      const existing = await findProcessedOperation(greFcTransaction, options.operationId);

      if (existing) {
        const status = await queryInsertedStatus(bizlinksPool, existing.serieNumeroGuia);
        await insertEvent(greFcTransaction, existing.operacionDbId, existing.envioId, 'REUTILIZADO', 'Operacion ya procesada', {
          serieNumeroGuia: existing.serieNumeroGuia
        });
        await greFcTransaction.commit();
        greFcCommitted = true;

        return {
          operationId: options.operationId,
          reused: true,
          generatedSerieNumeroGuia: existing.serieNumeroGuia,
          insertedHeader: false,
          insertedItems: 0,
          activated: existing.estado === 'ACTIVADO',
          status
        };
      }

      const payload = mapGreInputToPayload(input, getGreDefaults(this.config));
      const requestedSerie = extractGreFcSerie(input.serieNumeroGuia);
      if (!requestedSerie) {
        throw new Error(`Serie no permitida para formularios continuos: ${input.serieNumeroGuia}`);
      }
      const prepared = await prepareOperation(greFcTransaction, input, options, payload);
      let generatedSerieNumeroGuia = prepared.serieNumeroGuia;

      bizlinksTransaction = new sql.Transaction(bizlinksPool);
      await bizlinksTransaction.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);
      await acquireAppLock(bizlinksTransaction, `GRE_FC_${requestedSerie}_CORRELATIVO`);
      await assertPrivateDriverStillExists(bizlinksTransaction, input);

      if (generatedSerieNumeroGuia) {
        const existingBizlinks = await queryInsertedStatus(bizlinksTransaction, generatedSerieNumeroGuia);

        if (existingBizlinks) {
          await markInsertedBizlinks(
            greFcTransaction,
            prepared,
            generatedSerieNumeroGuia,
            input.items.length,
            existingBizlinks
          );
          await bizlinksTransaction.commit();
          await greFcTransaction.commit();
          greFcCommitted = true;

          return {
            operationId: options.operationId,
            reused: true,
            generatedSerieNumeroGuia,
            insertedHeader: false,
            insertedItems: 0,
            activated: existingBizlinks.bl_estadoRegistro === 'A' || existingBizlinks.bl_estadoRegistro === 'E' || existingBizlinks.bl_estadoRegistro === 'L',
            status: existingBizlinks
          };
        }
      } else {
        generatedSerieNumeroGuia = await nextActiveSerie(bizlinksTransaction, requestedSerie);
        await updateEnvioSerie(greFcTransaction, prepared.envioId, generatedSerieNumeroGuia);
      }

      payload.serieNumeroGuia = generatedSerieNumeroGuia;
      await assertSerieDoesNotExist(bizlinksTransaction, generatedSerieNumeroGuia);
      await insertEvent(greFcTransaction, prepared.operacionDbId, prepared.envioId, 'SP_PREVIEW_VALIDADO', 'Parametros de SP preparados antes de ejecutar Bizlinks', {
        serieNumeroGuia: generatedSerieNumeroGuia,
        procedurePlan: sanitizeValue(toSpeDespatchProcedurePlan(payload))
      });

      await executeOfficialGreProcedures(bizlinksTransaction, payload);
      const preparedStatus = await queryProcedureExecutionStatus(bizlinksTransaction, generatedSerieNumeroGuia);

      assertPreparedForActivation(preparedStatus, generatedSerieNumeroGuia, payload.spE_DESPATCH_ITEM.length);
      await executeUspEnvioGuia(bizlinksTransaction, toSpeDespatchProcedurePlan(payload).USP_EnvioGuia);

      const activatedStatus = await queryProcedureExecutionStatus(bizlinksTransaction, generatedSerieNumeroGuia);
      if (activatedStatus.header?.bl_estadoRegistro !== 'A') {
        throw new Error(`USP_ENVIOGUIA no dejo ${generatedSerieNumeroGuia} en A. Estado: ${String(activatedStatus.header?.bl_estadoRegistro ?? 'NULL')}`);
      }

      await bizlinksTransaction.commit();
      await markInsertedBizlinks(greFcTransaction, prepared, generatedSerieNumeroGuia, payload.spE_DESPATCH_ITEM.length, activatedStatus, true);
      await greFcTransaction.commit();
      greFcCommitted = true;

      return {
        operationId: options.operationId,
        reused: false,
        generatedSerieNumeroGuia,
        insertedHeader: true,
        insertedItems: payload.spE_DESPATCH_ITEM.length,
        activated: true,
        status: activatedStatus
      };
    } catch (error) {
      await rollbackQuietly(bizlinksTransaction);

      if (!greFcCommitted) {
        try {
          await recordErrorAndCommit(greFcTransaction, options.operationId, error);
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

async function assertPrivateDriverStillExists(transaction: sql.Transaction, input: GreInputDto) {
  if (input.traslado.modalidadTraslado !== '02') return;
  if (!input.conductor || !input.vehiculo) {
    throw new Error('Modalidad privada requiere conductor y vehiculo');
  }

  const exists = await privateDriverExists(transaction, {
    ...input.conductor,
    numeroPlacaVehiculoPrin: input.vehiculo.numeroPlacaVehiculoPrin
  });

  if (!exists) {
    throw new Error('El chofer privado enviado no existe o no coincide con AAA_CHOFER');
  }
}

async function prepareOperation(
  transaction: sql.Transaction,
  input: GreInputDto,
  options: DeclararTestOptions,
  payload: GrePayload
): Promise<PreparedEnvio> {
  const operacionDbId = await upsertOperation(transaction, input, options);
  await insertDetailsSnapshotIfEmpty(transaction, operacionDbId, input);
  const envio = await upsertEnvioPreparando(transaction, operacionDbId);
  await insertEvent(transaction, operacionDbId, envio.envioId, 'PREPARANDO', 'Operacion preparada antes de insertar en Bizlinks', {
    serieSolicitada: input.serieNumeroGuia,
    items: input.items.length,
    payload: sanitizeValue(payload)
  });

  return {
    operacionDbId,
    envioId: envio.envioId,
    serieNumeroGuia: envio.serieNumeroGuia
  };
}

async function findProcessedOperation(transaction: sql.Transaction, operationId: string): Promise<ExistingEnvio | null> {
  const request = new sql.Request(transaction);
  request.input('idOperacion', sql.UniqueIdentifier, operationId);

  const result = await request.query<ExistingEnvio>(`
    SELECT TOP (1)
      o.id AS operacionDbId,
      e.id AS envioId,
      e.serieNumeroGuia,
      e.estado,
      e.intentos
    FROM dbo.GRE_FC_OPERACION o
    INNER JOIN dbo.GRE_FC_ENVIO e
      ON e.operacionId = o.id
    WHERE o.idOperacion = @idOperacion
      AND e.estado IN ('INSERTADO_BIZLINKS', 'ACTIVADO')
      AND e.serieNumeroGuia IS NOT NULL
    ORDER BY e.id DESC
  `);

  return result.recordset[0] ?? null;
}

async function upsertOperation(transaction: sql.Transaction, input: GreInputDto, options: DeclararTestOptions) {
  const request = new sql.Request(transaction);

  request.input('idOperacion', sql.UniqueIdentifier, options.operationId);
  request.input('tipoDocumentoDestinatario', sql.VarChar(2), input.destinatario.tipoDocumentoDestinatario);
  request.input('numeroDocumentoDestinatario', sql.VarChar(20), input.destinatario.numeroDocumentoDestinatario);
  request.input('razonSocialDestinatario', sql.NVarChar(250), input.destinatario.razonSocialDestinatario);
  request.input('ubigeoPtoLlegada', sql.VarChar(10), input.traslado.ubigeoPtoLlegada);
  request.input('direccionPtoLlegada', sql.NVarChar(500), input.traslado.direccionPtoLlegada);
  request.input('modalidadTraslado', sql.VarChar(2), input.traslado.modalidadTraslado);
  request.input('motivoTraslado', sql.VarChar(2), input.traslado.motivoTraslado);
  request.input('pesoBrutoTotalBienes', sql.Decimal(18, 3), input.traslado.pesoBrutoTotalBienes);
  request.input('numeroBultos', sql.Int, input.traslado.numeroBultos);
  request.input('usuario', sql.NVarChar(128), options.user ?? null);
  request.input('datosJson', sql.NVarChar(sql.MAX), JSON.stringify(input));

  const result = await request.query<{ id: number }>(`
    IF EXISTS (SELECT 1 FROM dbo.GRE_FC_OPERACION WHERE idOperacion = @idOperacion)
    BEGIN
      UPDATE dbo.GRE_FC_OPERACION
      SET estado = 'PREPARANDO',
          actualizadoEn = SYSUTCDATETIME(),
          usuario = COALESCE(@usuario, usuario)
      WHERE idOperacion = @idOperacion;

      SELECT id
      FROM dbo.GRE_FC_OPERACION
      WHERE idOperacion = @idOperacion;
    END
    ELSE
    BEGIN
      INSERT INTO dbo.GRE_FC_OPERACION
      (
        idOperacion,
        tipoDocumentoDestinatario,
        numeroDocumentoDestinatario,
        razonSocialDestinatario,
        ubigeoPtoLlegada,
        direccionPtoLlegada,
        modalidadTraslado,
        motivoTraslado,
        pesoBrutoTotalBienes,
        numeroBultos,
        estado,
        usuario,
        datosJson
      )
      OUTPUT INSERTED.id
      VALUES
      (
        @idOperacion,
        @tipoDocumentoDestinatario,
        @numeroDocumentoDestinatario,
        @razonSocialDestinatario,
        @ubigeoPtoLlegada,
        @direccionPtoLlegada,
        @modalidadTraslado,
        @motivoTraslado,
        @pesoBrutoTotalBienes,
        @numeroBultos,
        'PREPARANDO',
        @usuario,
        @datosJson
      );
    END
  `);

  const id = result.recordset[0]?.id;
  if (!id) throw new Error('No se pudo registrar GRE_FC_OPERACION');
  return id;
}

async function insertDetailsSnapshotIfEmpty(transaction: sql.Transaction, operacionDbId: number, input: GreInputDto) {
  const countRequest = new sql.Request(transaction);
  countRequest.input('operacionId', sql.BigInt, operacionDbId);
  const countResult = await countRequest.query<{ total: number }>(`
    SELECT COUNT(1) AS total
    FROM dbo.GRE_FC_DETALLE
    WHERE operacionId = @operacionId
  `);

  if ((countResult.recordset[0]?.total ?? 0) > 0) return;

  for (const item of input.items) {
    const request = new sql.Request(transaction);
    const idDetGuiaOrigen = Number(item.id);

    request.input('operacionId', sql.BigInt, operacionDbId);
    request.input('idDetGuiaOrigen', sql.Int, Number.isInteger(idDetGuiaOrigen) ? idDetGuiaOrigen : null);
    request.input('codigo', sql.VarChar(80), item.codigoProducto);
    request.input('descripcion', sql.NVarChar(1000), item.descripcion);
    request.input('cantidad', sql.Decimal(18, 6), item.cantidad);
    request.input('unidad', sql.VarChar(20), item.unidadMedida);

    await request.query(`
      INSERT INTO dbo.GRE_FC_DETALLE
      (
        operacionId,
        idDetGuiaOrigen,
        codigo,
        descripcion,
        cantidad,
        unidad
      )
      VALUES
      (
        @operacionId,
        @idDetGuiaOrigen,
        @codigo,
        @descripcion,
        @cantidad,
        @unidad
      );
    `);
  }
}

async function upsertEnvioPreparando(transaction: sql.Transaction, operacionDbId: number) {
  const request = new sql.Request(transaction);
  request.input('operacionId', sql.BigInt, operacionDbId);

  const result = await request.query<{ envioId: number; serieNumeroGuia: string | null }>(`
    IF EXISTS (SELECT 1 FROM dbo.GRE_FC_ENVIO WHERE operacionId = @operacionId)
    BEGIN
      UPDATE dbo.GRE_FC_ENVIO
      SET estado = 'PREPARANDO',
          intentos = intentos + 1,
          actualizadoEn = SYSUTCDATETIME()
      WHERE id = (
        SELECT TOP (1) id
        FROM dbo.GRE_FC_ENVIO
        WHERE operacionId = @operacionId
        ORDER BY id DESC
      );

      SELECT TOP (1)
        id AS envioId,
        serieNumeroGuia
      FROM dbo.GRE_FC_ENVIO
      WHERE operacionId = @operacionId
      ORDER BY id DESC;
    END
    ELSE
    BEGIN
      INSERT INTO dbo.GRE_FC_ENVIO (operacionId, estado, intentos)
      OUTPUT INSERTED.id AS envioId, INSERTED.serieNumeroGuia
      VALUES (@operacionId, 'PREPARANDO', 1);
    END
  `);

  const envio = result.recordset[0];
  if (!envio) throw new Error('No se pudo registrar GRE_FC_ENVIO');
  return envio;
}

async function updateEnvioSerie(transaction: sql.Transaction, envioId: number, serieNumeroGuia: string) {
  const [serie, numero] = serieNumeroGuia.split('-');
  const request = new sql.Request(transaction);

  request.input('envioId', sql.BigInt, envioId);
  request.input('serie', sql.VarChar(4), serie);
  request.input('numero', sql.VarChar(8), numero);
  request.input('serieNumeroGuia', sql.VarChar(20), serieNumeroGuia);

  await request.query(`
    UPDATE dbo.GRE_FC_ENVIO
    SET serie = @serie,
        numero = @numero,
        serieNumeroGuia = @serieNumeroGuia,
        actualizadoEn = SYSUTCDATETIME()
    WHERE id = @envioId;
  `);
}

async function markInsertedBizlinks(
  transaction: sql.Transaction,
  prepared: PreparedEnvio,
  serieNumeroGuia: string,
  insertedItems: number,
  status: unknown,
  activated = false
) {
  const [serie, numero] = serieNumeroGuia.split('-');
  const request = new sql.Request(transaction);

  request.input('operacionId', sql.BigInt, prepared.operacionDbId);
  request.input('envioId', sql.BigInt, prepared.envioId);
  request.input('serie', sql.VarChar(4), serie);
  request.input('numero', sql.VarChar(8), numero);
  request.input('serieNumeroGuia', sql.VarChar(20), serieNumeroGuia);
  request.input('respuestaJson', sql.NVarChar(sql.MAX), JSON.stringify(status));
  request.input('estado', sql.VarChar(40), activated ? 'ACTIVADO' : 'INSERTADO_BIZLINKS');

  await request.query(`
    UPDATE dbo.GRE_FC_ENVIO
    SET serie = @serie,
        numero = @numero,
        serieNumeroGuia = @serieNumeroGuia,
        estado = @estado,
        respuestaJson = @respuestaJson,
        actualizadoEn = SYSUTCDATETIME(),
        insertadoBizlinksEn = SYSUTCDATETIME()
    WHERE id = @envioId;

    UPDATE dbo.GRE_FC_OPERACION
    SET estado = @estado,
        actualizadoEn = SYSUTCDATETIME(),
        finalizadoEn = SYSUTCDATETIME()
    WHERE id = @operacionId;
  `);

  await insertEvent(transaction, prepared.operacionDbId, prepared.envioId, activated ? 'ACTIVADA_BIZLINKS' : 'INSERTADO_BIZLINKS', activated ? 'SP oficiales ejecutados y activacion confirmada' : 'Insercion en Bizlinks confirmada', {
    serieNumeroGuia,
    insertedItems,
    status
  });
}

async function recordErrorAndCommit(transaction: sql.Transaction, operationId: string, error: unknown) {
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
      VALUES (@operacionId, @envioId, 'ERROR', @mensaje, @datosJson);
    END;
  `);

  await transaction.commit();
}

async function nextActiveSerie(transaction: sql.Transaction, serie: string) {
  const request = new sql.Request(transaction);
  request.input('seriePrefix', sql.VarChar(6), `${serie}-%`);

  const result = await request.query<{ nextNumber: number }>(`
    SELECT ISNULL(MAX(
      CASE
        WHEN ISNUMERIC(RIGHT(serieNumeroGuia, 8)) = 1 THEN CONVERT(int, RIGHT(serieNumeroGuia, 8))
        ELSE NULL
      END
    ), 0) + 1 AS nextNumber
    FROM ${HEADER_TABLE} WITH (UPDLOCK, HOLDLOCK)
    WHERE serieNumeroGuia LIKE @seriePrefix
  `);
  const nextNumber = result.recordset[0]?.nextNumber;

  if (!nextNumber || nextNumber < 1) {
    throw new Error(`No se pudo generar correlativo ${serie}`);
  }

  return `${serie}-${String(nextNumber).padStart(8, '0')}`;
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

async function assertSerieDoesNotExist(transaction: sql.Transaction, serieNumeroGuia: string) {
  const request = new sql.Request(transaction);
  request.input('serieNumeroGuia', sql.VarChar(20), serieNumeroGuia);

  const result = await request.query<{ total: number }>(`
    SELECT COUNT(1) AS total
    FROM ${HEADER_TABLE}
    WHERE serieNumeroGuia = @serieNumeroGuia
  `);

  if ((result.recordset[0]?.total ?? 0) > 0) {
    throw new Error(`La guia ${serieNumeroGuia} ya existe`);
  }
}

async function executeOfficialGreProcedures(transaction: sql.Transaction, payload: GrePayload) {
  const plan = toSpeDespatchProcedurePlan(payload);

  await executeStoredProcedure(transaction, 'dbo.USP_CabeceraGuia', plan.USP_CabeceraGuia);

  for (const itemParams of plan.USP_DetalleGuia) {
    await executeStoredProcedure(transaction, 'dbo.USP_DetalleGuia', itemParams);
  }

  for (const docRefParams of plan.USP_DocRef) {
    await executeStoredProcedure(transaction, 'dbo.USP_DocRef', docRefParams);
  }
}

async function executeUspEnvioGuia(transaction: sql.Transaction, params: StoredProcedureParam[]) {
  await executeStoredProcedure(transaction, 'dbo.USP_EnvioGuia', params);
}

async function executeStoredProcedure(transaction: sql.Transaction, procedureName: string, params: StoredProcedureParam[]) {
  const request = new sql.Request(transaction);

  for (const param of params) {
    request.input(param.name, sql.NVarChar, param.value);
  }

  await request.execute(procedureName);
}

async function queryProcedureExecutionStatus(
  poolOrTransaction: sql.ConnectionPool | sql.Transaction,
  serieNumeroGuia: string
): Promise<ProcedureExecutionStatus> {
  const request = createRequest(poolOrTransaction);
  request.input('serieNumeroGuia', sql.VarChar(20), serieNumeroGuia);

  const headerResult = await request.query<Record<string, unknown>>(`
    SELECT *
    FROM ${HEADER_TABLE}
    WHERE serieNumeroGuia = @serieNumeroGuia
  `);

  const countRequest = createRequest(poolOrTransaction);
  countRequest.input('serieNumeroGuia', sql.VarChar(20), serieNumeroGuia);
  const countResult = await countRequest.query<{ itemCount: number; auxCount: number; responseCount: number }>(`
    SELECT
      (SELECT COUNT(1) FROM ${ITEM_TABLE} WHERE serieNumeroGuia = @serieNumeroGuia) AS itemCount,
      (SELECT COUNT(1) FROM ${AUX_TABLE} WHERE SERIENUMERO = @serieNumeroGuia) AS auxCount,
      (SELECT COUNT(1) FROM ${RESPONSE_TABLE} WHERE serieNumeroGuia = @serieNumeroGuia) AS responseCount
  `);

  return {
    header: headerResult.recordset[0] ?? null,
    headerCount: headerResult.recordset.length,
    itemCount: countResult.recordset[0]?.itemCount ?? 0,
    auxCount: countResult.recordset[0]?.auxCount ?? 0,
    responseCount: countResult.recordset[0]?.responseCount ?? 0
  };
}

function assertPreparedForActivation(status: ProcedureExecutionStatus, serieNumeroGuia: string, expectedItems: number) {
  if (status.headerCount !== 1) {
    throw new Error(`Se esperaba exactamente un encabezado para ${serieNumeroGuia}; encontrados ${status.headerCount}`);
  }

  if (!status.header) {
    throw new Error(`USP_CabeceraGuia no genero encabezado para ${serieNumeroGuia}`);
  }

  if (status.itemCount !== expectedItems) {
    throw new Error(`USP_DetalleGuia genero ${status.itemCount} item(s), se esperaban ${expectedItems}`);
  }

  if (status.header.bl_estadoRegistro !== 'N') {
    throw new Error(`Antes de USP_ENVIOGUIA ${serieNumeroGuia} debe estar en N. Estado: ${String(status.header.bl_estadoRegistro ?? 'NULL')}`);
  }

  if (status.responseCount !== 0) {
    throw new Error(`La guia ${serieNumeroGuia} ya tiene ${status.responseCount} respuesta(s), no se activara`);
  }
}

async function queryInsertedStatus(poolOrTransaction: sql.ConnectionPool | sql.Transaction, serieNumeroGuia: string) {
  const request = createRequest(poolOrTransaction);
  request.input('serieNumeroGuia', sql.VarChar(20), serieNumeroGuia);

  const result = await request.query(`
    SELECT TOP (1)
      serieNumeroGuia,
      bl_estadoRegistro,
      bl_origen,
      bl_reintento,
      bl_hasFileResponse,
      bl_createdAt
    FROM ${HEADER_TABLE}
    WHERE serieNumeroGuia = @serieNumeroGuia
  `);

  return result.recordset[0] ?? null;
}

function createRequest(poolOrTransaction: sql.ConnectionPool | sql.Transaction) {
  return poolOrTransaction instanceof sql.Transaction
    ? new sql.Request(poolOrTransaction)
    : new sql.Request(poolOrTransaction);
}

async function insertEvent(
  transaction: sql.Transaction,
  operacionId: number,
  envioId: number | null,
  tipo: string,
  mensaje: string,
  datos: unknown
) {
  const request = new sql.Request(transaction);

  request.input('operacionId', sql.BigInt, operacionId);
  request.input('envioId', sql.BigInt, envioId);
  request.input('tipo', sql.VarChar(60), tipo);
  request.input('mensaje', sql.NVarChar(sql.MAX), mensaje);
  request.input('datosJson', sql.NVarChar(sql.MAX), JSON.stringify(datos));

  await request.query(`
    INSERT INTO dbo.GRE_FC_EVENTO (operacionId, envioId, tipo, mensaje, datosJson)
    VALUES (@operacionId, @envioId, @tipo, @mensaje, @datosJson);
  `);
}

async function rollbackQuietly(transaction?: sql.Transaction) {
  if (!transaction) return;

  try {
    await transaction.rollback();
  } catch {
    // rollback best effort
  }
}
