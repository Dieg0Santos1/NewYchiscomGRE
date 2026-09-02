import type { AppConfig } from '../config/env.js';
import { GRE_TRASLADO_SERIE, GRE_TRASLADO_SERIE_PATTERN } from '../config/greTrasladoSeries.js';
import { getGreDefaults } from '../config/greDefaults.js';
import { createBizlinksPool, createGreFcPool, sql } from '../integrations/bizlinksSql.js';
import type { GrePayload } from '../mappers/grePayloadMapper.js';
import { mapGreInputToPayload } from '../mappers/grePayloadMapper.js';
import { toSpeDespatchProcedurePlan, type StoredProcedureParam } from '../mappers/speDespatchProcedureMapper.js';
import type { GreTrasladoInputDto } from '../schemas/greTrasladoInputSchema.js';
import { isEligibleForManualSunatMessage } from './greFormularioManualSunatService.js';
import { privateDriverExists } from './greFormularioQueryService.js';
import { sanitizeValue } from '../utils/sanitize.js';

const HEADER_TABLE = 'dbo.SPE_DESPATCH';
const ITEM_TABLE = 'dbo.SPE_DESPATCH_ITEM';
const AUX_TABLE = 'dbo.SPE_DESPATCH_AUXILIAR';
const RESPONSE_TABLE = 'dbo.SPE_DESPATCH_RESPONSE';
const SUNAT_CLOCK_SAFETY_MINUTES = 15;

type ExistingEnvio = {
  operacionDbId: number;
  envioId: number;
  serieNumeroGuia: string;
  estado: string;
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

type TrasladoBizlinksStatusRow = {
  serieNumeroGuia: string;
  fechaEmisionGuia: string | null;
  horaEmisionGuia: string | null;
  bl_estadoRegistro: string | null;
  responseEstadoRegistro: string | null;
  bl_estadoProceso: string | null;
  process_state: string | null;
  bl_mensaje: string | null;
  bl_mensajeSunat: string | null;
  bl_url_pdf: string | null;
};

export type GreTrasladoStatusResult = {
  operationId: string;
  serieNumeroGuia: string | null;
  creadoEn: string | null;
  cliente: string;
  numeroDocumentoCliente: string;
  motivoTraslado: string;
  modalidadTraslado: string;
  estadoOperacion: string;
  estadoEnvio: string | null;
  estadoBizlinks: string | null;
  estadoProceso: string | null;
  mensaje: string | null;
  pdfDisponible: boolean;
  manualSunatMessageAllowed: boolean;
  items: number;
};

export type GreTrasladoNextSerieResult = {
  serie: typeof GRE_TRASLADO_SERIE;
  numero: string;
  serieNumeroGuia: string;
  reserved: false;
};

export type GreTrasladoDeclararResult = {
  operationId: string;
  reused: boolean;
  generatedSerieNumeroGuia: string;
  insertedHeader: boolean;
  insertedItems: number;
  activated: boolean;
  status: unknown;
};

export type GreTrasladoDeclararOptions = {
  operationId: string;
  user?: string;
};

export interface GreTrasladoService {
  getNextSerie(): Promise<GreTrasladoNextSerieResult>;
  listTraslados(): Promise<GreTrasladoStatusResult[]>;
  getTrasladoPdfUrl(serieNumeroGuia: string): Promise<string | null>;
  declarar(input: GreTrasladoInputDto, options: GreTrasladoDeclararOptions): Promise<GreTrasladoDeclararResult>;
}

export class DirectDbGreTrasladoService implements GreTrasladoService {
  constructor(private readonly config: AppConfig) {}

  async getNextSerie(): Promise<GreTrasladoNextSerieResult> {
    const pool = createBizlinksPool(this.config);
    await pool.connect();

    try {
      const serieNumeroGuia = await nextActiveSerie(pool);
      const [, numero] = serieNumeroGuia.split('-');

      return {
        serie: GRE_TRASLADO_SERIE,
        numero: numero ?? '00000001',
        serieNumeroGuia,
        reserved: false
      };
    } finally {
      await pool.close();
    }
  }

  async listTraslados(): Promise<GreTrasladoStatusResult[]> {
    const greFcPool = createGreFcPool(this.config);
    const bizlinksPool = createBizlinksPool(this.config);

    await greFcPool.connect();
    await bizlinksPool.connect();

    try {
      const result = await new sql.Request(greFcPool).query<{
        operationId: string;
        serieNumeroGuia: string | null;
        creadoEn: Date | null;
        razonSocialDestinatario: string;
        numeroDocumentoDestinatario: string;
        motivoTraslado: string;
        modalidadTraslado: string;
        estadoOperacion: string;
        estadoEnvio: string | null;
        mensajeEnvio: string | null;
        items: number;
      }>(`
        SELECT TOP (300)
          CONVERT(varchar(36), o.idOperacion) AS operationId,
          e.serieNumeroGuia,
          o.creadoEn,
          o.razonSocialDestinatario,
          o.numeroDocumentoDestinatario,
          o.motivoTraslado,
          o.modalidadTraslado,
          o.estado AS estadoOperacion,
          e.estado AS estadoEnvio,
          MAX(CONVERT(nvarchar(4000), e.mensaje)) AS mensajeEnvio,
          COUNT(d.id) AS items
        FROM dbo.GRE_TRASLADO_OPERACION o
        LEFT JOIN dbo.GRE_TRASLADO_ENVIO e
          ON e.operacionId = o.id
        LEFT JOIN dbo.GRE_TRASLADO_DETALLE d
          ON d.operacionId = o.id
        GROUP BY
          o.idOperacion,
          e.serieNumeroGuia,
          o.creadoEn,
          o.razonSocialDestinatario,
          o.numeroDocumentoDestinatario,
          o.motivoTraslado,
          o.modalidadTraslado,
          o.estado,
          e.estado
        ORDER BY o.creadoEn DESC
      `);
      const statuses = await getTrasladoBizlinksStatuses(
        bizlinksPool,
        result.recordset
          .map((row) => row.serieNumeroGuia)
          .filter((serie): serie is string => Boolean(serie))
      );

      return result.recordset.map((row) => {
        const bizlinks = row.serieNumeroGuia ? statuses.get(row.serieNumeroGuia) : undefined;
        const message = bizlinks?.bl_mensajeSunat ?? bizlinks?.bl_mensaje ?? row.mensajeEnvio ?? null;

        return {
          operationId: row.operationId,
          serieNumeroGuia: row.serieNumeroGuia,
          creadoEn: bizlinksDateTime(bizlinks) ?? (row.creadoEn ? row.creadoEn.toISOString() : null),
          cliente: row.razonSocialDestinatario,
          numeroDocumentoCliente: row.numeroDocumentoDestinatario,
          motivoTraslado: row.motivoTraslado,
          modalidadTraslado: row.modalidadTraslado,
          estadoOperacion: row.estadoOperacion,
          estadoEnvio: row.estadoEnvio,
          estadoBizlinks: bizlinks?.bl_estadoRegistro ?? null,
          estadoProceso: bizlinks?.bl_estadoProceso ?? bizlinks?.process_state ?? null,
          mensaje: message,
          pdfDisponible: Boolean(
            row.serieNumeroGuia
            && GRE_TRASLADO_SERIE_PATTERN.test(row.serieNumeroGuia)
            && bizlinks?.bl_url_pdf
            && isAllowedBizlinksFileUrl(bizlinks.bl_url_pdf)
            && hasAcceptedSunatResponse({
              estadoProceso: bizlinks.bl_estadoProceso ?? bizlinks.process_state,
              mensaje: message
            })
          ),
          manualSunatMessageAllowed: Boolean(row.serieNumeroGuia && GRE_TRASLADO_SERIE_PATTERN.test(row.serieNumeroGuia) && bizlinks && isEligibleForManualSunatMessage({
            bl_estadoRegistro: bizlinks.responseEstadoRegistro ?? bizlinks.bl_estadoRegistro,
            bl_estadoProceso: bizlinks.bl_estadoProceso,
            process_state: bizlinks.process_state,
            bl_mensajeSunat: bizlinks.bl_mensajeSunat
          })),
          items: Number(row.items ?? 0)
        };
      });
    } finally {
      await bizlinksPool.close();
      await greFcPool.close();
    }
  }

  async getTrasladoPdfUrl(serieNumeroGuia: string) {
    if (!GRE_TRASLADO_SERIE_PATTERN.test(serieNumeroGuia)) {
      return null;
    }

    const greFcPool = createGreFcPool(this.config);
    const bizlinksPool = createBizlinksPool(this.config);

    await greFcPool.connect();
    await bizlinksPool.connect();

    try {
      const traceRequest = new sql.Request(greFcPool);
      traceRequest.input('serieNumeroGuia', sql.VarChar(20), serieNumeroGuia);

      const trace = await traceRequest.query<{ total: number }>(`
        SELECT COUNT(1) AS total
        FROM dbo.GRE_TRASLADO_ENVIO
        WHERE serieNumeroGuia = @serieNumeroGuia
      `);

      if ((trace.recordset[0]?.total ?? 0) !== 1) return null;

      const pdfRequest = new sql.Request(bizlinksPool);
      pdfRequest.input('serieNumeroGuia', sql.VarChar(20), serieNumeroGuia);

      const pdf = await pdfRequest.query<{ bl_url_pdf: string | null }>(`
        SELECT TOP (1)
          bl_url_pdf
        FROM ${RESPONSE_TABLE}
        WHERE serieNumeroGuia = @serieNumeroGuia
          AND tipoDocumentoGuia = '09'
      `);
      const url = pdf.recordset[0]?.bl_url_pdf?.trim();

      if (!url) return null;

      return isAllowedBizlinksFileUrl(url) ? url : null;
    } finally {
      await bizlinksPool.close();
      await greFcPool.close();
    }
  }

  async declarar(input: GreTrasladoInputDto, options: GreTrasladoDeclararOptions): Promise<GreTrasladoDeclararResult> {
    const declaredInput = withCurrentSunatDates(input);
    const greFcPool = createGreFcPool(this.config);
    const bizlinksPool = createBizlinksPool(this.config);

    await greFcPool.connect();
    await bizlinksPool.connect();

    const greFcTransaction = new sql.Transaction(greFcPool);
    let greFcCommitted = false;
    let bizlinksTransaction: sql.Transaction | undefined;

    try {
      await greFcTransaction.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);
      await acquireAppLock(greFcTransaction, `GRE_TRASLADO_OPERACION:${options.operationId}`);

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

      const payload = mapGreInputToPayload(declaredInput, getGreDefaults(this.config));
      const prepared = await prepareOperation(greFcTransaction, declaredInput, options, payload);
      let generatedSerieNumeroGuia = prepared.serieNumeroGuia;

      bizlinksTransaction = new sql.Transaction(bizlinksPool);
      await bizlinksTransaction.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);
      await acquireAppLock(bizlinksTransaction, 'GRE_TRASLADO_T002_CORRELATIVO');
      await assertPrivateDriverStillExists(bizlinksTransaction, declaredInput);

      if (generatedSerieNumeroGuia) {
        const existingBizlinks = await queryInsertedStatus(bizlinksTransaction, generatedSerieNumeroGuia);
        if (existingBizlinks) {
          await markInsertedBizlinks(greFcTransaction, prepared, generatedSerieNumeroGuia, declaredInput.items.length, existingBizlinks);
          await bizlinksTransaction.commit();
          await greFcTransaction.commit();
          greFcCommitted = true;

          return {
            operationId: options.operationId,
            reused: true,
            generatedSerieNumeroGuia,
            insertedHeader: false,
            insertedItems: 0,
            activated: isActivatedState(existingBizlinks.bl_estadoRegistro),
            status: existingBizlinks
          };
        }
      } else {
        generatedSerieNumeroGuia = await nextActiveSerie(bizlinksTransaction);
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

      await executeStoredProcedure(bizlinksTransaction, 'dbo.USP_EnvioGuia', toSpeDespatchProcedurePlan(payload).USP_EnvioGuia);
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

async function assertPrivateDriverStillExists(transaction: sql.Transaction, input: GreTrasladoInputDto) {
  if (input.traslado.modalidadTraslado !== '02') return;
  if (!input.conductor || !input.vehiculo) {
    throw new Error('Los datos del chofer y vehiculo son obligatorios para transporte privado');
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
  input: GreTrasladoInputDto,
  options: GreTrasladoDeclararOptions,
  payload: GrePayload
): Promise<PreparedEnvio> {
  const operacionDbId = await upsertOperation(transaction, input, options);
  await insertDetailsSnapshotIfEmpty(transaction, operacionDbId, input);
  const envio = await upsertEnvioPreparando(transaction, operacionDbId);
  await insertEvent(transaction, operacionDbId, envio.envioId, 'PREPARANDO', 'Traslado preparado antes de insertar en Bizlinks', {
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
      e.estado
    FROM dbo.GRE_TRASLADO_OPERACION o
    INNER JOIN dbo.GRE_TRASLADO_ENVIO e
      ON e.operacionId = o.id
    WHERE o.idOperacion = @idOperacion
      AND e.estado IN ('INSERTADO_BIZLINKS', 'ACTIVADO')
      AND e.serieNumeroGuia IS NOT NULL
    ORDER BY e.id DESC
  `);

  return result.recordset[0] ?? null;
}

async function upsertOperation(transaction: sql.Transaction, input: GreTrasladoInputDto, options: GreTrasladoDeclararOptions) {
  const request = new sql.Request(transaction);

  request.input('idOperacion', sql.UniqueIdentifier, options.operationId);
  request.input('referenciaInterna', sql.NVarChar(80), input.referenciaInterna || null);
  request.input('tipoDocumentoDestinatario', sql.VarChar(2), input.destinatario.tipoDocumentoDestinatario);
  request.input('numeroDocumentoDestinatario', sql.VarChar(20), input.destinatario.numeroDocumentoDestinatario);
  request.input('razonSocialDestinatario', sql.NVarChar(250), input.destinatario.razonSocialDestinatario);
  request.input('ubigeoPtoLlegada', sql.VarChar(10), input.traslado.ubigeoPtoLlegada);
  request.input('direccionPtoLlegada', sql.NVarChar(500), input.traslado.direccionPtoLlegada);
  request.input('modalidadTraslado', sql.VarChar(2), input.traslado.modalidadTraslado);
  request.input('motivoTraslado', sql.VarChar(2), input.traslado.motivoTraslado);
  request.input('pesoBrutoTotalBienes', sql.Decimal(18, 3), input.traslado.pesoBrutoTotalBienes);
  request.input('numeroBultos', sql.Int, input.traslado.numeroBultos);
  request.input('tipoDocumentoTransportista', sql.VarChar(2), input.transportista?.tipoDocumentoTransportista ?? null);
  request.input('numeroRucTransportista', sql.VarChar(11), input.transportista?.numeroRucTransportista ?? null);
  request.input('razonSocialTransportista', sql.NVarChar(100), input.transportista?.razonSocialTransportista ?? null);
  request.input('usuario', sql.NVarChar(128), options.user ?? null);
  request.input('datosJson', sql.NVarChar(sql.MAX), JSON.stringify(input));

  const result = await request.query<{ id: number }>(`
    IF EXISTS (SELECT 1 FROM dbo.GRE_TRASLADO_OPERACION WHERE idOperacion = @idOperacion)
    BEGIN
      UPDATE dbo.GRE_TRASLADO_OPERACION
      SET estado = 'PREPARANDO',
          actualizadoEn = SYSUTCDATETIME(),
          referenciaInterna = @referenciaInterna,
          tipoDocumentoDestinatario = @tipoDocumentoDestinatario,
          numeroDocumentoDestinatario = @numeroDocumentoDestinatario,
          razonSocialDestinatario = @razonSocialDestinatario,
          ubigeoPtoLlegada = @ubigeoPtoLlegada,
          direccionPtoLlegada = @direccionPtoLlegada,
          modalidadTraslado = @modalidadTraslado,
          motivoTraslado = @motivoTraslado,
          pesoBrutoTotalBienes = @pesoBrutoTotalBienes,
          numeroBultos = @numeroBultos,
          tipoDocumentoTransportista = @tipoDocumentoTransportista,
          numeroRucTransportista = @numeroRucTransportista,
          razonSocialTransportista = @razonSocialTransportista,
          usuario = COALESCE(@usuario, usuario),
          datosJson = @datosJson
      WHERE idOperacion = @idOperacion;

      SELECT id
      FROM dbo.GRE_TRASLADO_OPERACION
      WHERE idOperacion = @idOperacion;
    END
    ELSE
    BEGIN
      INSERT INTO dbo.GRE_TRASLADO_OPERACION
      (
        idOperacion,
        referenciaInterna,
        tipoDocumentoDestinatario,
        numeroDocumentoDestinatario,
        razonSocialDestinatario,
        ubigeoPtoLlegada,
        direccionPtoLlegada,
        modalidadTraslado,
        motivoTraslado,
        pesoBrutoTotalBienes,
        numeroBultos,
        tipoDocumentoTransportista,
        numeroRucTransportista,
        razonSocialTransportista,
        estado,
        usuario,
        datosJson
      )
      OUTPUT INSERTED.id
      VALUES
      (
        @idOperacion,
        @referenciaInterna,
        @tipoDocumentoDestinatario,
        @numeroDocumentoDestinatario,
        @razonSocialDestinatario,
        @ubigeoPtoLlegada,
        @direccionPtoLlegada,
        @modalidadTraslado,
        @motivoTraslado,
        @pesoBrutoTotalBienes,
        @numeroBultos,
        @tipoDocumentoTransportista,
        @numeroRucTransportista,
        @razonSocialTransportista,
        'PREPARANDO',
        @usuario,
        @datosJson
      );
    END
  `);

  const id = result.recordset[0]?.id;
  if (!id) throw new Error('No se pudo registrar GRE_TRASLADO_OPERACION');
  return id;
}

async function insertDetailsSnapshotIfEmpty(transaction: sql.Transaction, operacionDbId: number, input: GreTrasladoInputDto) {
  const countRequest = new sql.Request(transaction);
  countRequest.input('operacionId', sql.BigInt, operacionDbId);
  const countResult = await countRequest.query<{ total: number }>(`
    SELECT COUNT(1) AS total
    FROM dbo.GRE_TRASLADO_DETALLE
    WHERE operacionId = @operacionId
  `);

  if ((countResult.recordset[0]?.total ?? 0) > 0) return;

  for (const item of input.items) {
    const request = new sql.Request(transaction);
    request.input('operacionId', sql.BigInt, operacionDbId);
    request.input('codigo', sql.VarChar(16), item.codigoProducto);
    request.input('descripcion', sql.NVarChar(500), item.descripcion);
    request.input('cantidad', sql.Decimal(18, 6), item.cantidad);
    request.input('unidad', sql.VarChar(3), item.unidadMedida);

    await request.query(`
      INSERT INTO dbo.GRE_TRASLADO_DETALLE (operacionId, codigo, descripcion, cantidad, unidad)
      VALUES (@operacionId, @codigo, @descripcion, @cantidad, @unidad);
    `);
  }
}

async function upsertEnvioPreparando(transaction: sql.Transaction, operacionDbId: number) {
  const request = new sql.Request(transaction);
  request.input('operacionId', sql.BigInt, operacionDbId);

  const result = await request.query<{ envioId: number; serieNumeroGuia: string | null }>(`
    IF EXISTS (SELECT 1 FROM dbo.GRE_TRASLADO_ENVIO WHERE operacionId = @operacionId)
    BEGIN
      UPDATE dbo.GRE_TRASLADO_ENVIO
      SET estado = 'PREPARANDO',
          intentos = intentos + 1,
          actualizadoEn = SYSUTCDATETIME()
      WHERE id = (
        SELECT TOP (1) id
        FROM dbo.GRE_TRASLADO_ENVIO
        WHERE operacionId = @operacionId
        ORDER BY id DESC
      );

      SELECT TOP (1)
        id AS envioId,
        serieNumeroGuia
      FROM dbo.GRE_TRASLADO_ENVIO
      WHERE operacionId = @operacionId
      ORDER BY id DESC;
    END
    ELSE
    BEGIN
      INSERT INTO dbo.GRE_TRASLADO_ENVIO (operacionId, estado, intentos)
      OUTPUT INSERTED.id AS envioId, INSERTED.serieNumeroGuia
      VALUES (@operacionId, 'PREPARANDO', 1);
    END
  `);

  const envio = result.recordset[0];
  if (!envio) throw new Error('No se pudo registrar GRE_TRASLADO_ENVIO');
  return envio;
}

async function updateEnvioSerie(transaction: sql.Transaction, envioId: number, serieNumeroGuia: string) {
  const [, numero] = serieNumeroGuia.split('-');
  const request = new sql.Request(transaction);

  request.input('envioId', sql.BigInt, envioId);
  request.input('serie', sql.VarChar(4), GRE_TRASLADO_SERIE);
  request.input('numero', sql.VarChar(8), numero);
  request.input('serieNumeroGuia', sql.VarChar(20), serieNumeroGuia);

  await request.query(`
    UPDATE dbo.GRE_TRASLADO_ENVIO
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
  const [, numero] = serieNumeroGuia.split('-');
  const request = new sql.Request(transaction);

  request.input('operacionId', sql.BigInt, prepared.operacionDbId);
  request.input('envioId', sql.BigInt, prepared.envioId);
  request.input('serie', sql.VarChar(4), GRE_TRASLADO_SERIE);
  request.input('numero', sql.VarChar(8), numero);
  request.input('serieNumeroGuia', sql.VarChar(20), serieNumeroGuia);
  request.input('respuestaJson', sql.NVarChar(sql.MAX), JSON.stringify(status));
  request.input('estado', sql.VarChar(40), activated ? 'ACTIVADO' : 'INSERTADO_BIZLINKS');

  await request.query(`
    UPDATE dbo.GRE_TRASLADO_ENVIO
    SET serie = @serie,
        numero = @numero,
        serieNumeroGuia = @serieNumeroGuia,
        estado = @estado,
        respuestaJson = @respuestaJson,
        actualizadoEn = SYSUTCDATETIME(),
        insertadoBizlinksEn = SYSUTCDATETIME()
    WHERE id = @envioId;

    UPDATE dbo.GRE_TRASLADO_OPERACION
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
    FROM dbo.GRE_TRASLADO_OPERACION
    WHERE idOperacion = @idOperacion;

    SELECT TOP (1) @envioId = id
    FROM dbo.GRE_TRASLADO_ENVIO
    WHERE operacionId = @operacionId
    ORDER BY id DESC;

    IF @envioId IS NOT NULL
    BEGIN
      UPDATE dbo.GRE_TRASLADO_ENVIO
      SET estado = 'ERROR',
          mensaje = @mensaje,
          actualizadoEn = SYSUTCDATETIME()
      WHERE id = @envioId;
    END;

    IF @operacionId IS NOT NULL
    BEGIN
      UPDATE dbo.GRE_TRASLADO_OPERACION
      SET estado = 'ERROR',
          actualizadoEn = SYSUTCDATETIME(),
          finalizadoEn = SYSUTCDATETIME()
      WHERE id = @operacionId;

      INSERT INTO dbo.GRE_TRASLADO_EVENTO (operacionId, envioId, tipo, mensaje, datosJson)
      VALUES (@operacionId, @envioId, 'ERROR', @mensaje, @datosJson);
    END;
  `);

  await transaction.commit();
}

async function nextActiveSerie(poolOrTransaction: sql.ConnectionPool | sql.Transaction) {
  const request = createRequest(poolOrTransaction);
  request.input('seriePrefix', sql.VarChar(6), `${GRE_TRASLADO_SERIE}-%`);

  const result = await request.query<{ nextNumber: number }>(`
    SELECT ISNULL(MAX(
      CASE
        WHEN ISNUMERIC(RIGHT(serieNumeroGuia, 8)) = 1 THEN CONVERT(int, RIGHT(serieNumeroGuia, 8))
        ELSE NULL
      END
    ), 0) + 1 AS nextNumber
    FROM ${HEADER_TABLE} WITH (UPDLOCK, HOLDLOCK)
    WHERE serieNumeroGuia LIKE @seriePrefix
      AND tipoDocumentoGuia = '09'
  `);
  const nextNumber = result.recordset[0]?.nextNumber;

  if (!nextNumber || nextNumber < 1) {
    throw new Error(`No se pudo generar correlativo ${GRE_TRASLADO_SERIE}`);
  }

  return `${GRE_TRASLADO_SERIE}-${String(nextNumber).padStart(8, '0')}`;
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
      AND tipoDocumentoGuia = '09'
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
  const headerRequest = createRequest(poolOrTransaction);
  headerRequest.input('serieNumeroGuia', sql.VarChar(20), serieNumeroGuia);

  const headerResult = await headerRequest.query<Record<string, unknown>>(`
    SELECT *
    FROM ${HEADER_TABLE}
    WHERE serieNumeroGuia = @serieNumeroGuia
      AND tipoDocumentoGuia = '09'
  `);

  const countRequest = createRequest(poolOrTransaction);
  countRequest.input('serieNumeroGuia', sql.VarChar(20), serieNumeroGuia);
  const countResult = await countRequest.query<{ itemCount: number; auxCount: number; responseCount: number }>(`
    SELECT
      (SELECT COUNT(1) FROM ${ITEM_TABLE} WHERE serieNumeroGuia = @serieNumeroGuia AND tipoDocumentoGuia = '09') AS itemCount,
      (SELECT COUNT(1) FROM ${AUX_TABLE} WHERE SERIENUMERO = @serieNumeroGuia AND TIPODOCUMENTO = '09') AS auxCount,
      (SELECT COUNT(1) FROM ${RESPONSE_TABLE} WHERE serieNumeroGuia = @serieNumeroGuia AND tipoDocumentoGuia = '09') AS responseCount
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
      AND tipoDocumentoGuia = '09'
  `);

  return result.recordset[0] ?? null;
}

async function getTrasladoBizlinksStatuses(pool: sql.ConnectionPool, series: string[]) {
  const statuses = new Map<string, TrasladoBizlinksStatusRow>();
  const uniqueSeries = [...new Set(series)];
  if (uniqueSeries.length === 0) return statuses;

  const request = new sql.Request(pool);
  const params = uniqueSeries.map((serie, index) => {
    const name = `serie${index}`;
    request.input(name, sql.VarChar(20), serie);
    return `@${name}`;
  });

  const result = await request.query<TrasladoBizlinksStatusRow>(`
    SELECT
      d.serieNumeroGuia,
      d.fechaEmisionGuia,
      d.horaEmisionGuia,
      d.bl_estadoRegistro,
      r.bl_estadoRegistro AS responseEstadoRegistro,
      r.bl_estadoProceso,
      r.process_state,
      r.bl_mensaje,
      r.bl_mensajeSunat,
      r.bl_url_pdf
    FROM ${HEADER_TABLE} d
    LEFT JOIN ${RESPONSE_TABLE} r
      ON r.tipoDocumentoRemitente = d.tipoDocumentoRemitente
     AND r.numeroDocumentoRemitente = d.numeroDocumentoRemitente
     AND r.serieNumeroGuia = d.serieNumeroGuia
     AND r.tipoDocumentoGuia = d.tipoDocumentoGuia
    WHERE d.serieNumeroGuia IN (${params.join(', ')})
      AND d.tipoDocumentoGuia = '09'
  `);

  for (const row of result.recordset) {
    statuses.set(row.serieNumeroGuia, row);
  }

  return statuses;
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
    INSERT INTO dbo.GRE_TRASLADO_EVENTO (operacionId, envioId, tipo, mensaje, datosJson)
    VALUES (@operacionId, @envioId, @tipo, @mensaje, @datosJson);
  `);
}

function createRequest(poolOrTransaction: sql.ConnectionPool | sql.Transaction) {
  return poolOrTransaction instanceof sql.Transaction
    ? new sql.Request(poolOrTransaction)
    : new sql.Request(poolOrTransaction);
}

function isActivatedState(value: unknown) {
  return value === 'A' || value === 'E' || value === 'L';
}

function hasAcceptedSunatResponse(value: { estadoProceso: string | null | undefined; mensaje: string | null | undefined }) {
  if (value.estadoProceso?.includes('AC_03')) return true;

  const message = value.mensaje ?? '';
  return /aceptad[ao]/i.test(message) && /"codigo"\s*:\s*"0"/i.test(message);
}

function bizlinksDateTime(row: Pick<TrasladoBizlinksStatusRow, 'fechaEmisionGuia' | 'horaEmisionGuia'> | undefined) {
  const date = row?.fechaEmisionGuia?.trim();
  const time = row?.horaEmisionGuia?.trim();

  if (!date || !time || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}(:\d{2})?$/.test(time)) {
    return null;
  }

  return `${date}T${time.length === 5 ? `${time}:00` : time}-05:00`;
}

function isAllowedBizlinksFileUrl(value: string) {
  try {
    const url = new URL(value);

    return url.protocol === 'https:' && url.hostname.toLowerCase() === 'sfeintegrador.bizlinks.com.pe';
  } catch {
    return false;
  }
}

function withCurrentSunatDates(input: GreTrasladoInputDto): GreTrasladoInputDto {
  const { date, time } = currentSunatDateTime();

  return {
    ...input,
    fechaEmisionGuia: date,
    horaEmisionGuia: time,
    fechaInicioTraslado: date,
    fechaEntregaBienes: date
  };
}

function currentSunatDateTime(now = new Date()) {
  const adjusted = new Date(now.getTime() - SUNAT_CLOCK_SAFETY_MINUTES * 60 * 1000);
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'America/Lima',
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  }).formatToParts(adjusted);
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? '00';

  return {
    date: `${get('year')}-${get('month')}-${get('day')}`,
    time: `${get('hour')}:${get('minute')}:${get('second')}`
  };
}

async function rollbackQuietly(transaction?: sql.Transaction) {
  if (!transaction) return;

  try {
    await transaction.rollback();
  } catch {
    // rollback best effort
  }
}
