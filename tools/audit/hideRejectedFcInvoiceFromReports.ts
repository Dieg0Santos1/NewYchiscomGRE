import { loadEnv } from '../../src/config/env.js';
import { createBizlinksPool, createGreFcPool, sql } from '../../src/integrations/bizlinksSql.js';

const target = process.argv[2]?.trim();
const apply = process.argv.includes('--apply');

if (!/^FF01-\d{8}$/.test(target ?? '')) {
  throw new Error('Uso: npx tsx tools/audit/hideRejectedFcInvoiceFromReports.ts FF01-00000000 [--apply]');
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
      .query<{ headers: number; rejected: number }>(`
        SELECT
          COUNT(1) AS headers,
          SUM(CASE WHEN BL_ESTADOREGISTRO = 'E' THEN 1 ELSE 0 END) AS rejected
        FROM dbo.SPE_EINVOICEHEADER
        WHERE SERIENUMERO = @serie
          AND TIPODOCUMENTO = '01';
      `);
    const status = external.recordset[0];
    if (Number(status?.headers ?? 0) !== 1 || Number(status?.rejected ?? 0) !== 1) {
      throw new Error(`${target} no es una unica factura rechazada en Bizlinks; no se ocultara.`);
    }

    await transaction.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);
    started = true;
    const local = await new sql.Request(transaction)
      .input('serie', sql.VarChar(13), target)
      .query<{ id: number; envioId: number | null; estado: string }>(`
        SELECT o.id, e.id AS envioId, o.estado
        FROM dbo.FC_FACT_OPERACION o WITH (UPDLOCK, HOLDLOCK)
        LEFT JOIN dbo.FC_FACT_ENVIO e ON e.operacionId = o.id
        WHERE o.serieNumeroFactura = @serie;
      `);
    if (local.recordset.length !== 1) {
      throw new Error(`Se esperaba una unica operacion local para ${target}.`);
    }
    const row = local.recordset[0]!;

    await new sql.Request(transaction)
      .input('operacionId', sql.BigInt, row.id)
      .input('envioId', sql.BigInt, row.envioId)
      .input('serie', sql.VarChar(13), target)
      .query(`
        IF NOT EXISTS (
          SELECT 1
          FROM dbo.FC_FACT_EVENTO
          WHERE operacionId = @operacionId
            AND tipo = 'OCULTO_REPORTE'
        )
        BEGIN
          INSERT INTO dbo.FC_FACT_EVENTO (operacionId, envioId, tipo, mensaje, datosJson)
          VALUES (
            @operacionId,
            @envioId,
            'OCULTO_REPORTE',
            'Factura rechazada ocultada del reporte operativo; evidencia conservada',
            CONCAT('{"serieNumeroFactura":"', @serie, '","estadoBizlinks":"E"}')
          );
        END;
      `);

    if (apply) {
      await transaction.commit();
      started = false;
      console.log(`${target} quedo oculta del reporte. La evidencia no fue eliminada.`);
    } else {
      await transaction.rollback();
      started = false;
      console.log(`DRY RUN correcto para ${target}. Use --apply para ocultarla.`);
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
