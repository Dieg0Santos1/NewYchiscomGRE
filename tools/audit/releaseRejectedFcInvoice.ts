import { loadEnv } from '../../src/config/env.js';
import { createBizlinksPool, createGreFcPool, sql } from '../../src/integrations/bizlinksSql.js';

const target = process.argv[2]?.trim();
const replacement = process.argv[3]?.trim();
const apply = process.argv.includes('--apply');

if (!/^FF01-\d{8}$/.test(target ?? '') || !/^FF01-\d{8}$/.test(replacement ?? '')) {
  throw new Error(
    'Uso: npx tsx tools/audit/releaseRejectedFcInvoice.ts FF01-00000000 FF01-00000000 [--apply]'
  );
}

type ExternalSnapshot = {
  headerCount: number;
  detailCount: number;
  addCount: number;
  responseCount: number;
  downloadCount: number;
  linkCount: number;
  sourceFileCount: number;
  errorHeaderCount: number;
  replacementAcceptedCount: number;
  replacementLinkCount: number;
};

type LocalSnapshot = {
  id: number;
  estado: string;
  guideCount: number;
  detailCount: number;
  sendCount: number;
};

async function main() {
  const config = loadEnv();
  const gre = createGreFcPool(config);
  const biz = createBizlinksPool(config);
  await gre.connect();
  await biz.connect();

  const greTransaction = new sql.Transaction(gre);
  const bizTransaction = new sql.Transaction(biz);
  let greStarted = false;
  let bizStarted = false;

  try {
    await greTransaction.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);
    greStarted = true;
    await bizTransaction.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);
    bizStarted = true;

    const local = await readLocalSnapshot(greTransaction);
    const external = await readExternalSnapshot(bizTransaction, config.remitente.numeroDocumento);
    assertSafe(local, external);

    const archivedSerie = `ARC-${target!.slice(-8)}`;
    if (!apply) {
      await bizTransaction.rollback();
      bizStarted = false;
      await greTransaction.rollback();
      greStarted = false;
      console.log(JSON.stringify({
        mode: 'DRY_RUN',
        target,
        replacement,
        archivedSerie,
        before: { local, external },
        preservedErrorLog: true
      }, null, 2));
      console.log('Simulacion correcta; no se intento modificar ninguna tabla.');
      return;
    }

    await new sql.Request(greTransaction)
      .input('id', sql.BigInt, local.id)
      .input('target', sql.VarChar(13), target)
      .input('replacement', sql.VarChar(13), replacement)
      .input('archivedSerie', sql.VarChar(13), archivedSerie)
      .query(`
        INSERT INTO dbo.FC_FACT_EVENTO (operacionId, envioId, tipo, mensaje, datosJson)
        SELECT @id, e.id, 'CORRELATIVO_LIBERADO',
          'Intento rechazado sin respuesta SUNAT archivado para corregir y reutilizar el correlativo',
          CONCAT('{"serieOriginal":"', @target,
            '","serieArchivada":"', @archivedSerie,
            '","facturaRespaldo":"', @replacement, '"}')
        FROM dbo.FC_FACT_ENVIO e
        WHERE e.operacionId = @id;

        UPDATE dbo.FC_FACT_OPERACION
        SET serieNumeroFactura = @archivedSerie,
            actualizadoEn = SYSUTCDATETIME(),
            finalizadoEn = COALESCE(finalizadoEn, SYSUTCDATETIME())
        WHERE id = @id;
      `);

    const deleted = await new sql.Request(bizTransaction)
      .input('target', sql.VarChar(13), target)
      .input('emitterRuc', sql.VarChar(20), config.remitente.numeroDocumento)
      .query(`
        DELETE FROM dbo.AAA_GUIAFACTURADA
        WHERE NRO_FACTURA = @target;
        DECLARE @links int = @@ROWCOUNT;

        DELETE FROM dbo.SPE_EINVOICEHEADER_ADD
        WHERE SERIENUMERO = @target
          AND TIPODOCUMENTO = '01'
          AND NUMERODOCUMENTOEMISOR = @emitterRuc;
        DECLARE @additional int = @@ROWCOUNT;

        DELETE FROM dbo.SPE_EINVOICEDETAIL
        WHERE SERIENUMERO = @target
          AND TIPODOCUMENTO = '01'
          AND NUMERODOCUMENTOEMISOR = @emitterRuc;
        DECLARE @details int = @@ROWCOUNT;

        DELETE FROM dbo.SPE_EINVOICEHEADER
        WHERE SERIENUMERO = @target
          AND TIPODOCUMENTO = '01'
          AND NUMERODOCUMENTOEMISOR = @emitterRuc;
        DECLARE @headers int = @@ROWCOUNT;

        SELECT @links AS links, @additional AS additionalRows,
          @details AS details, @headers AS headers;
      `);

    const remaining = await readExternalSnapshot(bizTransaction, config.remitente.numeroDocumento);
    if (
      remaining.headerCount !== 0
      || remaining.detailCount !== 0
      || remaining.addCount !== 0
      || remaining.responseCount !== 0
      || remaining.downloadCount !== 0
      || remaining.linkCount !== 0
    ) {
      throw new Error(`La liberacion dejo residuos: ${JSON.stringify(remaining)}.`);
    }

    const result = {
      mode: apply ? 'APPLY' : 'DRY_RUN',
      target,
      replacement,
      archivedSerie,
      before: { local, external },
      deleted: deleted.recordset[0],
      preservedErrorLog: true
    };

    await bizTransaction.commit();
    bizStarted = false;
    await greTransaction.commit();
    greStarted = false;

    console.log(JSON.stringify(result, null, 2));
    console.log(`${target} quedo libre. No se ejecuto USP_EnviaDocumentoFE.`);
  } finally {
    if (bizStarted) await bizTransaction.rollback().catch(() => undefined);
    if (greStarted) await greTransaction.rollback().catch(() => undefined);
    await biz.close();
    await gre.close();
  }
}

async function readLocalSnapshot(transaction: sql.Transaction): Promise<LocalSnapshot> {
  const result = await new sql.Request(transaction)
    .input('target', sql.VarChar(13), target)
    .query<LocalSnapshot>(`
      SELECT o.id, o.estado,
        (SELECT COUNT(1) FROM dbo.FC_FACT_GUIA g WHERE g.operacionId = o.id) AS guideCount,
        (SELECT COUNT(1) FROM dbo.FC_FACT_DETALLE d WHERE d.operacionId = o.id) AS detailCount,
        (SELECT COUNT(1) FROM dbo.FC_FACT_ENVIO e WHERE e.operacionId = o.id) AS sendCount
      FROM dbo.FC_FACT_OPERACION o WITH (UPDLOCK, HOLDLOCK)
      WHERE o.serieNumeroFactura = @target;
    `);
  if (result.recordset.length !== 1) {
    throw new Error(`Se esperaba un unico intento local para ${target}.`);
  }
  return result.recordset[0]!;
}

async function readExternalSnapshot(
  transaction: sql.Transaction,
  emitterRuc: string
): Promise<ExternalSnapshot> {
  const result = await new sql.Request(transaction)
    .input('target', sql.VarChar(13), target)
    .input('replacement', sql.VarChar(13), replacement)
    .input('emitterRuc', sql.VarChar(20), emitterRuc)
    .query<ExternalSnapshot>(`
      SELECT
        (SELECT COUNT(1) FROM dbo.SPE_EINVOICEHEADER WITH (UPDLOCK, HOLDLOCK)
          WHERE SERIENUMERO = @target AND TIPODOCUMENTO = '01'
            AND NUMERODOCUMENTOEMISOR = @emitterRuc) AS headerCount,
        (SELECT COUNT(1) FROM dbo.SPE_EINVOICEDETAIL WITH (UPDLOCK, HOLDLOCK)
          WHERE SERIENUMERO = @target AND TIPODOCUMENTO = '01'
            AND NUMERODOCUMENTOEMISOR = @emitterRuc) AS detailCount,
        (SELECT COUNT(1) FROM dbo.SPE_EINVOICEHEADER_ADD WITH (UPDLOCK, HOLDLOCK)
          WHERE SERIENUMERO = @target AND TIPODOCUMENTO = '01'
            AND NUMERODOCUMENTOEMISOR = @emitterRuc) AS addCount,
        (SELECT COUNT(1) FROM dbo.SPE_EINVOICE_RESPONSE WITH (UPDLOCK, HOLDLOCK)
          WHERE SERIENUMERO = @target AND TIPODOCUMENTO = '01') AS responseCount,
        (SELECT COUNT(1) FROM dbo.SPE_JOB_DOWNLOAD WITH (UPDLOCK, HOLDLOCK)
          WHERE serieNumero = @target AND tipoDocumento = '01'
            AND numeroDocumentoEmisor = @emitterRuc) AS downloadCount,
        (SELECT COUNT(1) FROM dbo.AAA_GUIAFACTURADA WITH (UPDLOCK, HOLDLOCK)
          WHERE NRO_FACTURA = @target) AS linkCount,
        (SELECT COUNT(1) FROM dbo.SPE_EINVOICEHEADER
          WHERE SERIENUMERO = @target AND TIPODOCUMENTO = '01'
            AND NUMERODOCUMENTOEMISOR = @emitterRuc
            AND BL_SOURCEFILE IS NOT NULL) AS sourceFileCount,
        (SELECT COUNT(1) FROM dbo.SPE_EINVOICEHEADER
          WHERE SERIENUMERO = @target AND TIPODOCUMENTO = '01'
            AND NUMERODOCUMENTOEMISOR = @emitterRuc
            AND BL_ESTADOREGISTRO = 'E') AS errorHeaderCount,
        (SELECT COUNT(1) FROM dbo.SPE_EINVOICE_RESPONSE
          WHERE SERIENUMERO = @replacement AND TIPODOCUMENTO = '01'
            AND process_state = '_3_COMPLETED'
            AND bl_mensajeSunat LIKE '%"codigo":"0"%') AS replacementAcceptedCount,
        (SELECT COUNT(1) FROM dbo.AAA_GUIAFACTURADA oldLink
          INNER JOIN dbo.AAA_GUIAFACTURADA acceptedLink
            ON acceptedLink.NRO_GUIA = oldLink.NRO_GUIA
           AND acceptedLink.NRO_FACTURA = @replacement
          WHERE oldLink.NRO_FACTURA = @target) AS replacementLinkCount;
    `);
  return result.recordset[0]!;
}

function assertSafe(local: LocalSnapshot, external: ExternalSnapshot) {
  if (local.estado !== 'RECHAZADA') throw new Error(`Estado local inesperado: ${local.estado}.`);
  if (Number(local.guideCount) !== 0 || Number(local.detailCount) !== 0 || Number(local.sendCount) !== 1) {
    throw new Error(`La trazabilidad local no es un intento rechazado vacio: ${JSON.stringify(local)}.`);
  }
  if (Number(external.headerCount) !== 1 || Number(external.errorHeaderCount) !== 1) {
    throw new Error('La factura no tiene una unica cabecera externa en estado E.');
  }
  if (Number(external.detailCount) < 1 || Number(external.addCount) < 1 || Number(external.linkCount) !== 1) {
    throw new Error(`Los residuos externos no tienen la forma esperada: ${JSON.stringify(external)}.`);
  }
  if (
    Number(external.responseCount) !== 0
    || Number(external.downloadCount) !== 0
    || Number(external.sourceFileCount) !== 0
  ) {
    throw new Error('Existe respuesta, descarga o archivo fuente; el correlativo no se puede liberar.');
  }
  if (Number(external.replacementAcceptedCount) !== 1 || Number(external.replacementLinkCount) !== 1) {
    throw new Error(`La guia anterior no esta respaldada por ${replacement} aceptada.`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
