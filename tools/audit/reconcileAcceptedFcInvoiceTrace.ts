import { loadEnv } from '../../src/config/env.js';
import { createBizlinksPool, createGreFcPool, sql } from '../../src/integrations/bizlinksSql.js';

const acceptedInvoice = process.argv[2]?.trim();
const rejectedInvoice = process.argv[3]?.trim();
const apply = process.argv.includes('--apply');

if (!/^FF01-\d{8}$/.test(acceptedInvoice ?? '') || !/^FF01-\d{8}$/.test(rejectedInvoice ?? '')) {
  throw new Error('Uso: npx tsx tools/audit/reconcileAcceptedFcInvoiceTrace.ts FF01-ACEPTADA FF01-RECHAZADA [--apply]');
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
      .input('accepted', sql.VarChar(13), acceptedInvoice)
      .input('rejected', sql.VarChar(13), rejectedInvoice)
      .query<{
        acceptedHeaders: number;
        acceptedResponses: number;
        rejectedHeaders: number;
      }>(`
        SELECT
          (SELECT COUNT(1) FROM dbo.SPE_EINVOICEHEADER
            WHERE SERIENUMERO = @accepted AND TIPODOCUMENTO = '01' AND BL_ESTADOREGISTRO = 'L') AS acceptedHeaders,
          (SELECT COUNT(1) FROM dbo.SPE_EINVOICE_RESPONSE
            WHERE SERIENUMERO = @accepted AND TIPODOCUMENTO = '01'
              AND bl_mensajeSunat LIKE '%"codigo":"0"%') AS acceptedResponses,
          (SELECT COUNT(1) FROM dbo.SPE_EINVOICEHEADER
            WHERE SERIENUMERO = @rejected AND TIPODOCUMENTO = '01' AND BL_ESTADOREGISTRO = 'E') AS rejectedHeaders;
      `);
    const status = external.recordset[0];
    if (
      Number(status?.acceptedHeaders ?? 0) !== 1
      || Number(status?.acceptedResponses ?? 0) < 1
      || Number(status?.rejectedHeaders ?? 0) !== 1
    ) {
      throw new Error('Los estados externos no corresponden a una factura aceptada y una rechazada.');
    }

    await transaction.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);
    started = true;
    const local = await new sql.Request(transaction)
      .input('accepted', sql.VarChar(13), acceptedInvoice)
      .input('rejected', sql.VarChar(13), rejectedInvoice)
      .query<{
        acceptedId: number;
        acceptedEnvioId: number;
        acceptedGuides: number;
        rejectedId: number;
        rejectedEnvioId: number;
        rejectedGuides: number;
      }>(`
        SELECT
          accepted.id AS acceptedId,
          acceptedEnvio.id AS acceptedEnvioId,
          (SELECT COUNT(1) FROM dbo.FC_FACT_GUIA WHERE operacionId = accepted.id) AS acceptedGuides,
          rejected.id AS rejectedId,
          rejectedEnvio.id AS rejectedEnvioId,
          (SELECT COUNT(1) FROM dbo.FC_FACT_GUIA WHERE operacionId = rejected.id) AS rejectedGuides
        FROM dbo.FC_FACT_OPERACION accepted WITH (UPDLOCK, HOLDLOCK)
        INNER JOIN dbo.FC_FACT_ENVIO acceptedEnvio ON acceptedEnvio.operacionId = accepted.id
        CROSS JOIN dbo.FC_FACT_OPERACION rejected WITH (UPDLOCK, HOLDLOCK)
        INNER JOIN dbo.FC_FACT_ENVIO rejectedEnvio ON rejectedEnvio.operacionId = rejected.id
        WHERE accepted.serieNumeroFactura = @accepted
          AND rejected.serieNumeroFactura = @rejected;
      `);
    if (local.recordset.length !== 1) throw new Error('No se encontraron ambas trazas locales de forma univoca.');
    const row = local.recordset[0]!;
    if (Number(row.acceptedGuides) !== 0 || Number(row.rejectedGuides) < 1) {
      throw new Error('La relacion local no tiene el estado esperado para conciliarse.');
    }

    await new sql.Request(transaction)
      .input('accepted', sql.VarChar(13), acceptedInvoice)
      .input('rejected', sql.VarChar(13), rejectedInvoice)
      .input('acceptedId', sql.BigInt, row.acceptedId)
      .input('acceptedEnvioId', sql.BigInt, row.acceptedEnvioId)
      .input('rejectedId', sql.BigInt, row.rejectedId)
      .input('rejectedEnvioId', sql.BigInt, row.rejectedEnvioId)
      .query(`
        UPDATE d
        SET operacionId = @acceptedId
        FROM dbo.FC_FACT_DETALLE d
        INNER JOIN dbo.FC_FACT_GUIA g ON g.id = d.guiaId
        WHERE g.operacionId = @rejectedId;

        UPDATE dbo.FC_FACT_GUIA
        SET operacionId = @acceptedId
        WHERE operacionId = @rejectedId;

        UPDATE dbo.FC_FACT_OPERACION
        SET estado = 'ACEPTADA', actualizadoEn = SYSUTCDATETIME(), finalizadoEn = SYSUTCDATETIME()
        WHERE id = @acceptedId;

        UPDATE dbo.FC_FACT_ENVIO
        SET estado = 'ACEPTADA', intentos = CASE WHEN intentos < 1 THEN 1 ELSE intentos END,
            mensaje = 'Factura aceptada por Bizlinks/SUNAT; trazabilidad local conciliada',
            actualizadoEn = SYSUTCDATETIME(),
            insertadoBizlinksEn = COALESCE(insertadoBizlinksEn, SYSUTCDATETIME()),
            enviadoBizlinksEn = COALESCE(enviadoBizlinksEn, SYSUTCDATETIME()),
            respuestaBizlinksEn = COALESCE(respuestaBizlinksEn, SYSUTCDATETIME())
        WHERE id = @acceptedEnvioId;

        UPDATE dbo.FC_FACT_OPERACION
        SET estado = 'RECHAZADA', actualizadoEn = SYSUTCDATETIME(), finalizadoEn = COALESCE(finalizadoEn, SYSUTCDATETIME())
        WHERE id = @rejectedId;

        UPDATE dbo.FC_FACT_ENVIO
        SET estado = 'RECHAZADA', actualizadoEn = SYSUTCDATETIME()
        WHERE id = @rejectedEnvioId;

        INSERT INTO dbo.FC_FACT_EVENTO (operacionId, envioId, tipo, mensaje, datosJson)
        VALUES
          (@acceptedId, @acceptedEnvioId, 'CONCILIADO',
            'Factura aceptada externamente; relacion de guia recuperada desde intento rechazado',
            CONCAT('{"facturaAceptada":"', @accepted, '","facturaRechazada":"', @rejected, '"}')),
          (@rejectedId, @rejectedEnvioId, 'TRAZA_TRANSFERIDA',
            'Relacion de guia transferida a la factura aceptada; evidencia del rechazo conservada',
            CONCAT('{"facturaAceptada":"', @accepted, '","facturaRechazada":"', @rejected, '"}'));
      `);

    if (apply) {
      await transaction.commit();
      started = false;
      console.log(`${acceptedInvoice} conciliada; la evidencia de ${rejectedInvoice} se conservo.`);
    } else {
      await transaction.rollback();
      started = false;
      console.log('DRY RUN correcto. Use --apply para conciliar la trazabilidad local.');
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
