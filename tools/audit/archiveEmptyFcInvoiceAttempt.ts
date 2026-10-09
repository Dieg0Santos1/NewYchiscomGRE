import { loadEnv } from '../../src/config/env.js';
import { createBizlinksPool, createGreFcPool, sql } from '../../src/integrations/bizlinksSql.js';

const target = process.argv[2]?.trim();
const apply = process.argv.includes('--apply');

if (!/^FF01-\d{8}$/.test(target ?? '')) {
  throw new Error('Uso: npx tsx tools/audit/archiveEmptyFcInvoiceAttempt.ts FF01-00000000 [--apply]');
}

async function main() {
  const config = loadEnv();
  const gre = createGreFcPool(config);
  const biz = createBizlinksPool(config);
  await gre.connect();
  await biz.connect();

  const transaction = new sql.Transaction(gre);
  let started = false;
  try {
    const external = await new sql.Request(biz)
      .input('serie', sql.VarChar(13), target)
      .query<{ headers: number; details: number; responses: number; links: number }>(`
        SELECT
          (SELECT COUNT(1) FROM dbo.SPE_EINVOICEHEADER WHERE SERIENUMERO = @serie AND TIPODOCUMENTO = '01') AS headers,
          (SELECT COUNT(1) FROM dbo.SPE_EINVOICEDETAIL WHERE SERIENUMERO = @serie AND TIPODOCUMENTO = '01') AS details,
          (SELECT COUNT(1) FROM dbo.SPE_EINVOICE_RESPONSE WHERE SERIENUMERO = @serie AND TIPODOCUMENTO = '01') AS responses,
          (SELECT COUNT(1) FROM dbo.AAA_GUIAFACTURADA WHERE NRO_FACTURA = @serie) AS links;
      `);
    const externalCounts = external.recordset[0];
    if (!externalCounts || Object.values(externalCounts).some((count) => Number(count) !== 0)) {
      throw new Error(`No se puede archivar ${target}: tiene datos en Bizlinks.`);
    }

    await transaction.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);
    started = true;
    const request = new sql.Request(transaction);
    request.input('serie', sql.VarChar(13), target);
    const local = await request.query<{
      id: number;
      estado: string;
      guias: number;
      detalles: number;
      envios: number;
    }>(`
      SELECT o.id, o.estado,
        (SELECT COUNT(1) FROM dbo.FC_FACT_GUIA g WHERE g.operacionId = o.id) AS guias,
        (SELECT COUNT(1) FROM dbo.FC_FACT_DETALLE d WHERE d.operacionId = o.id) AS detalles,
        (SELECT COUNT(1) FROM dbo.FC_FACT_ENVIO e WHERE e.operacionId = o.id) AS envios
      FROM dbo.FC_FACT_OPERACION o WITH (UPDLOCK, HOLDLOCK)
      WHERE o.serieNumeroFactura = @serie;
    `);
    if (local.recordset.length !== 1) throw new Error(`Se esperaba un unico intento local para ${target}.`);
    const row = local.recordset[0]!;
    if (
      row.estado !== 'ERROR'
      || Number(row.guias) !== 0
      || Number(row.detalles) !== 0
      || Number(row.envios) !== 1
    ) {
      throw new Error(`El intento ${target} no es un ERROR vacio y no se archivara.`);
    }

    const archivedSerie = `ARC-${target!.slice(-8)}`;
    await new sql.Request(transaction)
      .input('id', sql.BigInt, row.id)
      .input('serie', sql.VarChar(13), target)
      .input('archivedSerie', sql.VarChar(13), archivedSerie)
      .query(`
        INSERT INTO dbo.FC_FACT_EVENTO (operacionId, envioId, tipo, mensaje, datosJson)
        SELECT @id, e.id, 'ARCHIVADO',
          'Intento vacio archivado para liberar un correlativo no enviado a Bizlinks',
          CONCAT('{"serieOriginal":"', @serie, '","serieArchivada":"', @archivedSerie, '"}')
        FROM dbo.FC_FACT_ENVIO e
        WHERE e.operacionId = @id;

        UPDATE dbo.FC_FACT_OPERACION
        SET serieNumeroFactura = @archivedSerie,
            actualizadoEn = SYSUTCDATETIME(),
            finalizadoEn = COALESCE(finalizadoEn, SYSUTCDATETIME())
        WHERE id = @id;
      `);

    if (apply) {
      await transaction.commit();
      started = false;
      console.log(`${target} archivada como ${archivedSerie}. No se modifico Bizlinks.`);
    } else {
      await transaction.rollback();
      started = false;
      console.log(`DRY RUN correcto para ${target}. Use --apply para archivar.`);
    }
  } finally {
    if (started) await transaction.rollback().catch(() => undefined);
    await biz.close();
    await gre.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
