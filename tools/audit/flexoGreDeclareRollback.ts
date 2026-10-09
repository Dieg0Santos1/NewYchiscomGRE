import { loadEnv } from '../../src/config/env.js';
import { createBizlinksPool, createGreFcPool, sql } from '../../src/integrations/bizlinksSql.js';
import type { GrePayload } from '../../src/mappers/grePayloadMapper.js';
import { toSpeDespatchProcedurePlan, type StoredProcedureParam } from '../../src/mappers/speDespatchProcedureMapper.js';

type FlexoOperationRow = {
  id: number;
  idOperacion: string;
  serie: string;
  numero: string;
  serieNumeroGuia: string;
  tipoDocumentoGuia: string;
  tipoDocumentoDestinatario: string;
  numeroDocumentoDestinatario: string;
  razonSocialDestinatario: string;
  ubigeoPtoLlegada: string;
  direccionPtoLlegada: string;
  ubigeoPtoPartida: string;
  direccionPtoPartida: string;
  modalidadTraslado: string;
  motivoTraslado: string;
  descripcionMotivoTraslado: string;
  pesoBrutoTotalBienes: number;
  unidadMedidaPesoBruto: string;
  numeroBultos: number;
  fechaEmision: Date;
  fechaEmisionText: string;
  horaEmisionText: string;
  fechaInicioTraslado: Date;
  fechaInicioTrasladoText: string;
  ordenCompra: string | null;
  observaciones: string | null;
  tipoDocumentoConductor: string | null;
  numeroDocumentoConductor: string | null;
  nombreConductor: string | null;
  apellidoConductor: string | null;
  numeroLicencia: string | null;
  numeroPlacaVehiculo: string | null;
  estado: string;
};

type FlexoItemRow = {
  id: number;
  numeroOrdenItem: number;
  codigoEmpaque: number;
  ticket: string | null;
  ordenCompra: string | null;
  codigoProducto: string;
  descripcion: string;
  cantidadEmpaque: number;
  cantidadDeclarada: number;
  unidadMedidaEmpaque: string | null;
  unidadMedidaDeclarada: string;
  ordenGuia: string;
  estado: string;
};

type ProcedureStatus = {
  header: Record<string, unknown> | null;
  itemCount: number;
  responseCount: number;
  empaqueLinked: number;
  tipoDocumentoCorrelativo: number | null;
};

const HEADER_TABLE = 'dbo.SPE_DESPATCH';
const ITEM_TABLE = 'dbo.SPE_DESPATCH_ITEM';
const RESPONSE_TABLE = 'dbo.SPE_DESPATCH_RESPONSE';
const EMISOR = {
  tipoDocumento: '6',
  numeroDocumento: '20259402965',
  razonSocial: 'YCHIFORMAS S.A.'
};

async function main() {
  const target = process.argv[2]?.trim();
  if (!target) {
    throw new Error('Uso: npx tsx tools/audit/flexoGreDeclareRollback.ts <id|uuid|T003-00000000>');
  }

  const config = loadEnv();
  const greFcPool = createGreFcPool(config);
  const bizlinksPool = createBizlinksPool(config);
  await greFcPool.connect();
  await bizlinksPool.connect();

  let transaction: sql.Transaction | undefined;

  try {
    const operation = await findOperation(greFcPool, target);
    const items = await listOperationItems(greFcPool, operation.id);
    if (items.length === 0) {
      throw new Error(`La operacion ${operation.serieNumeroGuia} no tiene items preparados.`);
    }

    const payload = buildPayload(operation, items);
    const plan = toSpeDespatchProcedurePlan(payload);

    transaction = new sql.Transaction(bizlinksPool);
    await transaction.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);
    await acquireAppLock(transaction, `FLEXO_GRE_${operation.serie}_DECLARACION`);
    await assertNextCorrelative(transaction, operation);
    await assertSerieDoesNotExist(transaction, operation.serieNumeroGuia);
    await assertEmpaqueItemsAvailable(transaction, items);

    await executeStoredProcedure(transaction, 'dbo.USP_CabeceraGuia', plan.USP_CabeceraGuia);
    for (const itemParams of plan.USP_DetalleGuia) {
      await executeStoredProcedure(transaction, 'dbo.USP_DetalleGuia', itemParams);
    }

    const preparedStatus = await queryProcedureStatus(transaction, operation, items);
    assertPreparedStatus(operation, preparedStatus, items.length);

    await executeStoredProcedure(transaction, 'dbo.USP_EnvioGuia', plan.USP_EnvioGuia);
    await linkEmpaqueDetalle(transaction, operation, items);
    await syncTipoDocumentoCorrelative(transaction, operation);

    const finalStatus = await queryProcedureStatus(transaction, operation, items);

    console.log(JSON.stringify({
      ok: true,
      mode: 'ROLLBACK_ONLY',
      rolledBack: true,
      operation: {
        id: operation.id,
        idOperacion: operation.idOperacion,
        serieNumeroGuia: operation.serieNumeroGuia,
        estado: operation.estado,
        items: items.length
      },
      contract: {
        serieNumeroGuia: payload.serieNumeroGuia,
        observaciones: payload.observaciones,
        fechaEmisionGuia: payload.fechaEmisionGuia,
        horaEmisionGuia: payload.horaEmisionGuia,
        fechaInicioTraslado: payload.fechaInicioTraslado,
        numeroBultosEnviado: payload.numeroBultos || null,
        direccionPtoPartida: payload.direccionPtoPartida,
        direccionPtoLlegada: payload.direccionPtoLLegada,
        items: payload.spE_DESPATCH_ITEM.map((item, index) => ({
          orden: String(index + 1),
          codigo: item.codigo,
          cantidad: item.cantidad,
          unidadMedida: item.unidadMedida,
          descripcion: item.descripcion,
          codigoEmpaque: item.codigoEmpaque
        }))
      },
      preparedStatus,
      finalStatus,
      note: 'La transaccion se revierte en finally. No queda SPE, EMPAQUE_DETALLE ni AAA_TIPODOCUMENTO modificado.'
    }, null, 2));
  } finally {
    if (transaction) {
      await transaction.rollback().catch(() => undefined);
    }
    await bizlinksPool.close();
    await greFcPool.close();
  }
}

async function findOperation(pool: sql.ConnectionPool, target: string): Promise<FlexoOperationRow> {
  const request = new sql.Request(pool);
  request.input('target', sql.NVarChar(80), target);
  request.input('targetId', sql.BigInt, /^\d+$/.test(target) ? Number(target) : null);

  const result = await request.query<FlexoOperationRow>(`
    SELECT TOP (1)
      id,
      CONVERT(varchar(36), idOperacion) AS idOperacion,
      serie,
      numero,
      serieNumeroGuia,
      tipoDocumentoGuia,
      tipoDocumentoDestinatario,
      numeroDocumentoDestinatario,
      razonSocialDestinatario,
      ubigeoPtoLlegada,
      direccionPtoLlegada,
      ubigeoPtoPartida,
      direccionPtoPartida,
      modalidadTraslado,
      motivoTraslado,
      descripcionMotivoTraslado,
      pesoBrutoTotalBienes,
      unidadMedidaPesoBruto,
      numeroBultos,
      fechaEmision,
      CONVERT(varchar(10), fechaEmision, 120) AS fechaEmisionText,
      CONVERT(varchar(8), fechaEmision, 108) AS horaEmisionText,
      fechaInicioTraslado,
      CONVERT(varchar(10), fechaInicioTraslado, 120) AS fechaInicioTrasladoText,
      ordenCompra,
      observaciones,
      tipoDocumentoConductor,
      numeroDocumentoConductor,
      nombreConductor,
      apellidoConductor,
      numeroLicencia,
      numeroPlacaVehiculo,
      estado
    FROM dbo.FLEXO_GRE_OPERACION
    WHERE id = @targetId
       OR CONVERT(varchar(36), idOperacion) = @target
       OR serieNumeroGuia = @target
    ORDER BY id DESC;
  `);

  const operation = result.recordset[0];
  if (!operation) {
    throw new Error(`No se encontro FLEXO_GRE_OPERACION para ${target}.`);
  }
  if (operation.estado !== 'BORRADOR') {
    throw new Error(`La operacion ${operation.serieNumeroGuia} esta en ${operation.estado}; se esperaba BORRADOR.`);
  }

  return operation;
}

async function listOperationItems(pool: sql.ConnectionPool, operacionId: number): Promise<FlexoItemRow[]> {
  const request = new sql.Request(pool);
  request.input('operacionId', sql.BigInt, operacionId);

  const result = await request.query<FlexoItemRow>(`
    SELECT
      id,
      numeroOrdenItem,
      codigoEmpaque,
      ticket,
      ordenCompra,
      codigoProducto,
      descripcion,
      cantidadEmpaque,
      cantidadDeclarada,
      unidadMedidaEmpaque,
      unidadMedidaDeclarada,
      ordenGuia,
      estado
    FROM dbo.FLEXO_GRE_ITEM
    WHERE operacionId = @operacionId
    ORDER BY numeroOrdenItem, id;
  `);

  return result.recordset;
}

function buildPayload(operation: FlexoOperationRow, items: FlexoItemRow[]): GrePayload {
  const observations = normalizeObservation(operation);
  return {
    tipoDocumentoRemitente: EMISOR.tipoDocumento,
    numeroDocumentoRemitente: EMISOR.numeroDocumento,
    serieNumeroGuia: operation.serieNumeroGuia,
    tipoDocumentoGuia: '09',
    bl_estadoRegistro: 'N',
    bl_reintento: 0,
    bl_origen: 'T',
    bl_hasFileResponse: 0,
    fechaEmisionGuia: operation.fechaEmisionText,
    horaEmisionGuia: operation.horaEmisionText,
    fechaInicioTraslado: operation.fechaInicioTrasladoText,
    fechaEntregaBienes: '',
    observaciones: observations,
    razonSocialRemitente: EMISOR.razonSocial,
    correoRemitente: '-',
    correoDestinatario: '-',
    numeroDocumentoDestinatario: operation.numeroDocumentoDestinatario,
    tipoDocumentoDestinatario: operation.tipoDocumentoDestinatario,
    razonSocialDestinatario: operation.razonSocialDestinatario,
    motivoTraslado: operation.motivoTraslado,
    descripcionMotivoTraslado: operation.descripcionMotivoTraslado,
    pesoBrutoTotalBienes: trimDecimal(operation.pesoBrutoTotalBienes),
    unidadMedidaPesoBruto: operation.unidadMedidaPesoBruto,
    modalidadTraslado: operation.modalidadTraslado,
    numeroBultos: '',
    codigoPuerto: '',
    idEntrega: '',
    ubigeoPtoPartida: operation.ubigeoPtoPartida,
    direccionPtoPartida: ensureLeadingDash(operation.direccionPtoPartida),
    ubigeoPtoLLegada: operation.ubigeoPtoLlegada,
    direccionPtoLLegada: ensureLeadingDash(operation.direccionPtoLlegada),
    codigoPtollegada: '',
    tipoDocumentoConductor: operation.tipoDocumentoConductor ?? '',
    numeroDocumentoConductor: operation.numeroDocumentoConductor ?? '',
    nombreConductor: operation.nombreConductor ?? '',
    apellidoConductor: operation.apellidoConductor ?? '',
    numeroLicencia: operation.numeroLicencia ?? '',
    numeroPlacaVehiculoPrin: operation.numeroPlacaVehiculo ?? '',
    numeroPlacaVehiculoSec1: '',
    numeroAutorizacionRem: '',
    codigoAutorizadoRem: '',
    tipoDocumentoComprador: '',
    numeroDocumentoComprador: '',
    razonSocialComprador: '',
    tipoEvento: '',
    numeroAutorizacionTrans: '',
    codigoAutorizadoTrans: '',
    tarjetaUnicaCirculacionPrin: '',
    numeroAutorizacionVehPrin: '',
    codigoAutorizadoVehPrin: '',
    numeroPlacaVehiculoSec2: '',
    tarjetaUnicaCirculacionSec1: '',
    tarjetaUnicaCirculacionSec2: '',
    numeroAutorizacionVehSec1: '',
    numeroAutorizacionVehSec2: '',
    codigoAutorizadoVehSec1: '',
    codigoAutorizadoVehSec2: '',
    numeroDocumentoConductorSec1: '',
    tipoDocumentoConductorSec1: '',
    nombreConductorSec1: '',
    apellidoConductorSec1: '',
    numeroLicenciaSec1: '',
    numeroDocumentoConductorSec2: '',
    tipoDocumentoConductorSec2: '',
    nombreConductorSec2: '',
    apellidoConductorSec2: '',
    numeroLicenciaSec2: '',
    numeroDocumentoPtoLlegada: '',
    ptoLlegadaLongitud: '',
    ptoLlegadaLatitud: '',
    numeroDocumentoPtoPartida: '',
    codigoPtoPartida: '',
    ptoPartidaLongitud: '',
    ptoPartidaLatitud: '',
    tipoLocacion: '',
    codigoAeropuerto: '',
    nombrePuertoAeropuerto: '',
    serieGuiaBaja: '',
    codigoGuiaBaja: '',
    tipoGuiaBaja: '',
    numeroDocumentoRelacionado: '',
    codigoDocumentoRelacionado: '',
    numeroDocumentoEstablecimiento: '',
    tipoDocumentoEstablecimiento: '',
    razonSocialEstablecimiento: '',
    numeroRucTransportista: '',
    tipoDocumentoTransportista: '',
    razonSocialTransportista: '',
    numeroRegistroMTC: '',
    indTransbordoProgramado: '',
    indRetornoVehiculoEnvaseVacio: '',
    indRetornoVehiculoVacio: '',
    indTrasVehiculoCatM1L: '',
    indRegVehiculoyCond: '',
    indTrasladoTotalDAMoDS: '',
    numeroContenedor1: '',
    numeroContenedor2: '',
    numeroPrecinto1: '',
    numeroPrecinto2: '',
    pesoBrutoTotalItem: '',
    unidadMedidaPesoBrutoItem: '',
    sustentoPesoBrutoTotal: '',
    bL_SOURCEFILE: '',
    bl_createdAt: null,
    spE_DESPATCH_ITEM: items.map((item) => ({
      codigoEmpaque: item.codigoEmpaque,
      codigoProducto: item.codigoProducto,
      descripcion: item.descripcion,
      cantidad: trimDecimal(item.cantidadDeclarada),
      unidadMedida: item.unidadMedidaDeclarada,
      moneda: '',
      tipoCambio: null,
      importeUnitarioSinImpuesto: null,
      serieNumeroGuiaRemision: null,
      serieNumeroGuiaFactura: null,
      ordenguia: item.ordenGuia,
      ordenfactura: null,
      id: String(item.id),
      unidadmedida: item.unidadMedidaDeclarada,
      codigo: item.codigoProducto,
      cliente: operation.numeroDocumentoDestinatario
    })),
    SPE_DESPATCH_DOCRELACIONADO: []
  };
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

  if ((result.recordset[0]?.lockResult ?? -999) < 0) {
    throw new Error(`No se pudo bloquear ${resource}.`);
  }
}

async function assertNextCorrelative(transaction: sql.Transaction, operation: FlexoOperationRow) {
  const expected = Number(operation.numero);
  const request = new sql.Request(transaction);
  request.input('serie', sql.VarChar(4), operation.serie);

  const result = await request.query<{ CORRELATIVO: number | null; nextNumber: number }>(`
    SELECT TOP (1)
      CORRELATIVO,
      ISNULL(CORRELATIVO, 0) + 1 AS nextNumber
    FROM dbo.AAA_TIPODOCUMENTO WITH (UPDLOCK, HOLDLOCK)
    WHERE SERIE = @serie
      AND TIPODOCUMENTO = '09';
  `);
  const row = result.recordset[0];

  if (!row) {
    throw new Error(`No existe AAA_TIPODOCUMENTO para ${operation.serie}/09.`);
  }
  if (Number(row.nextNumber) !== expected) {
    throw new Error(`Correlativo desalineado para ${operation.serie}. AAA_TIPODOCUMENTO siguiente=${row.nextNumber}, borrador=${expected}. Regenerar preparacion.`);
  }
}

async function assertSerieDoesNotExist(transaction: sql.Transaction, serieNumeroGuia: string) {
  const request = new sql.Request(transaction);
  request.input('serieNumeroGuia', sql.VarChar(20), serieNumeroGuia);

  const result = await request.query<{ total: number }>(`
    SELECT COUNT(1) AS total
    FROM ${HEADER_TABLE} WITH (UPDLOCK, HOLDLOCK)
    WHERE serieNumeroGuia = @serieNumeroGuia
      AND tipoDocumentoGuia = '09';
  `);

  if ((result.recordset[0]?.total ?? 0) > 0) {
    throw new Error(`La guia ${serieNumeroGuia} ya existe en SPE_DESPATCH.`);
  }
}

async function assertEmpaqueItemsAvailable(transaction: sql.Transaction, items: FlexoItemRow[]) {
  for (const item of items) {
    const request = new sql.Request(transaction);
    request.input('codigoEmpaque', sql.Int, item.codigoEmpaque);
    request.input('codigoProducto', sql.VarChar(80), item.codigoProducto);

    const result = await request.query<{
      SERIENUMEROGUIAREMISION: string | null;
      SERIENUMEROGUIAFACTURA: string | null;
    }>(`
      SELECT TOP (1)
        SERIENUMEROGUIAREMISION,
        SERIENUMEROGUIAFACTURA
      FROM dbo.EMPAQUE_DETALLE WITH (UPDLOCK, HOLDLOCK)
      WHERE CODIGOEMPAQUE = @codigoEmpaque
        AND CODIGOPRODUCTO = @codigoProducto;
    `);
    const row = result.recordset[0];

    if (!row) {
      throw new Error(`No existe EMPAQUE_DETALLE ${item.codigoEmpaque}/${item.codigoProducto}.`);
    }
    if (row.SERIENUMEROGUIAREMISION || row.SERIENUMEROGUIAFACTURA) {
      throw new Error(`EMPAQUE_DETALLE ${item.codigoEmpaque}/${item.codigoProducto} ya esta vinculado.`);
    }
  }
}

async function executeStoredProcedure(transaction: sql.Transaction, procedureName: string, params: StoredProcedureParam[]) {
  const request = new sql.Request(transaction);

  for (const param of params) {
    request.input(param.name, sql.NVarChar, param.value);
  }

  await request.execute(procedureName);
}

async function linkEmpaqueDetalle(transaction: sql.Transaction, operation: FlexoOperationRow, items: FlexoItemRow[]) {
  for (const item of items) {
    const request = new sql.Request(transaction);
    request.input('serieNumeroGuia', sql.VarChar(13), operation.serieNumeroGuia);
    request.input('ordenGuia', sql.VarChar(4), item.ordenGuia);
    request.input('codigoEmpaque', sql.Int, item.codigoEmpaque);
    request.input('codigoProducto', sql.VarChar(80), item.codigoProducto);

    const result = await request.query<{ updated: number }>(`
      UPDATE dbo.EMPAQUE_DETALLE
         SET SERIENUMEROGUIAREMISION = @serieNumeroGuia,
             ORDENGUIA = @ordenGuia
       WHERE CODIGOEMPAQUE = @codigoEmpaque
         AND CODIGOPRODUCTO = @codigoProducto
         AND SERIENUMEROGUIAREMISION IS NULL
         AND SERIENUMEROGUIAFACTURA IS NULL;

      SELECT @@ROWCOUNT AS updated;
    `);

    if (Number(result.recordset[0]?.updated ?? 0) !== 1) {
      throw new Error(`No se pudo vincular EMPAQUE_DETALLE ${item.codigoEmpaque}/${item.codigoProducto}.`);
    }
  }
}

async function syncTipoDocumentoCorrelative(transaction: sql.Transaction, operation: FlexoOperationRow) {
  const request = new sql.Request(transaction);
  request.input('serie', sql.VarChar(4), operation.serie);
  request.input('numero', sql.Int, Number(operation.numero));

  const result = await request.query<{ updated: number }>(`
    UPDATE dbo.AAA_TIPODOCUMENTO
       SET CORRELATIVO = @numero
     WHERE SERIE = @serie
       AND TIPODOCUMENTO = '09'
       AND ISNULL(CORRELATIVO, 0) = @numero - 1;

    SELECT @@ROWCOUNT AS updated;
  `);

  if (Number(result.recordset[0]?.updated ?? 0) !== 1) {
    throw new Error(`No se pudo sincronizar AAA_TIPODOCUMENTO para ${operation.serie}.`);
  }
}

async function queryProcedureStatus(
  transaction: sql.Transaction,
  operation: FlexoOperationRow,
  items: FlexoItemRow[]
): Promise<ProcedureStatus> {
  const headerRequest = new sql.Request(transaction);
  headerRequest.input('serieNumeroGuia', sql.VarChar(20), operation.serieNumeroGuia);
  const header = await headerRequest.query<Record<string, unknown>>(`
    SELECT TOP (1) *
    FROM ${HEADER_TABLE}
    WHERE serieNumeroGuia = @serieNumeroGuia
      AND tipoDocumentoGuia = '09';
  `);

  const countRequest = new sql.Request(transaction);
  countRequest.input('serieNumeroGuia', sql.VarChar(20), operation.serieNumeroGuia);
  countRequest.input('serie', sql.VarChar(4), operation.serie);
  const counts = await countRequest.query<{
    itemCount: number;
    responseCount: number;
    empaqueLinked: number;
    tipoDocumentoCorrelativo: number | null;
  }>(`
    SELECT
      (SELECT COUNT(1) FROM ${ITEM_TABLE} WHERE serieNumeroGuia = @serieNumeroGuia AND tipoDocumentoGuia = '09') AS itemCount,
      (SELECT COUNT(1) FROM ${RESPONSE_TABLE} WHERE serieNumeroGuia = @serieNumeroGuia AND tipoDocumentoGuia = '09') AS responseCount,
      (SELECT COUNT(1) FROM dbo.EMPAQUE_DETALLE WHERE SERIENUMEROGUIAREMISION = @serieNumeroGuia) AS empaqueLinked,
      (SELECT TOP (1) CORRELATIVO FROM dbo.AAA_TIPODOCUMENTO WHERE SERIE = @serie AND TIPODOCUMENTO = '09') AS tipoDocumentoCorrelativo;
  `);
  const count = counts.recordset[0];

  return {
    header: header.recordset[0] ?? null,
    itemCount: Number(count?.itemCount ?? 0),
    responseCount: Number(count?.responseCount ?? 0),
    empaqueLinked: Number(count?.empaqueLinked ?? 0),
    tipoDocumentoCorrelativo: count?.tipoDocumentoCorrelativo ?? null
  };
}

function assertPreparedStatus(operation: FlexoOperationRow, status: ProcedureStatus, expectedItems: number) {
  if (!status.header) {
    throw new Error(`USP_CabeceraGuia no creo cabecera ${operation.serieNumeroGuia}.`);
  }
  if (status.itemCount !== expectedItems) {
    throw new Error(`USP_DetalleGuia creo ${status.itemCount} item(s); se esperaban ${expectedItems}.`);
  }
  if (status.header.bl_estadoRegistro !== 'N') {
    throw new Error(`Antes de USP_ENVIOGUIA el estado debe ser N; actual=${String(status.header.bl_estadoRegistro ?? 'NULL')}.`);
  }
  if (status.responseCount !== 0) {
    throw new Error(`La guia ${operation.serieNumeroGuia} ya tiene respuestas Bizlinks.`);
  }
}

function normalizeObservation(operation: FlexoOperationRow) {
  const value = operation.observaciones?.trim()
    || (operation.ordenCompra?.trim() ? `OC ${operation.ordenCompra.trim()}.` : '');

  if (value.length > 250) {
    throw new Error(`Observaciones supera 250 caracteres (${value.length}). Ajustar antes de declarar.`);
  }

  return value;
}

function ensureLeadingDash(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return '-';
  return trimmed.startsWith('-') ? trimmed : `-${trimmed}`;
}

function trimDecimal(value: number) {
  return Number(value).toFixed(6).replace(/\.?0+$/, '');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
