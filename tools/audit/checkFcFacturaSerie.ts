import { loadEnv } from '../../src/config/env.js';
import { createBizlinksPool, createGreFcPool, sql } from '../../src/integrations/bizlinksSql.js';

const factura = process.argv[2]?.trim() || 'FF01-00017145';

async function main() {
  const config = loadEnv();
  const greFcPool = createGreFcPool(config);
  const bizlinksPool = createBizlinksPool(config);

  await greFcPool.connect();
  await bizlinksPool.connect();

  try {
    const greRequest = new sql.Request(greFcPool);
    greRequest.input('factura', sql.VarChar(13), factura);

    const operaciones = await greRequest.query(`
      SELECT
        o.id,
        CONVERT(varchar(36), o.idOperacion) AS operationId,
        o.serieNumeroFactura,
        o.estado AS estadoOperacion,
        o.numeroDocumentoCliente,
        o.razonSocialCliente,
        o.total,
        o.creadoEn,
        o.actualizadoEn,
        o.finalizadoEn,
        e.estado AS estadoEnvio,
        e.intentos,
        e.mensaje,
        e.pdfUrl,
        e.insertadoBizlinksEn,
        e.enviadoBizlinksEn,
        e.respuestaBizlinksEn
      FROM dbo.FC_FACT_OPERACION o
      LEFT JOIN dbo.FC_FACT_ENVIO e
        ON e.operacionId = o.id
      WHERE o.serieNumeroFactura = @factura
      ORDER BY o.id DESC;
    `);

    const guias = await greRequest.query(`
      SELECT
        o.serieNumeroFactura,
        g.serieNumeroGuia,
        g.operationIdGuia,
        g.totalGuia,
        g.creadoEn
      FROM dbo.FC_FACT_GUIA g
      INNER JOIN dbo.FC_FACT_OPERACION o
        ON o.id = g.operacionId
      WHERE o.serieNumeroFactura = @factura
      ORDER BY g.id;
    `);

    const detallesTrace = await greRequest.query(`
      SELECT
        o.serieNumeroFactura,
        COUNT(d.id) AS items
      FROM dbo.FC_FACT_OPERACION o
      LEFT JOIN dbo.FC_FACT_DETALLE d
        ON d.operacionId = o.id
      WHERE o.serieNumeroFactura = @factura
      GROUP BY o.serieNumeroFactura;
    `);

    const bizRequest = new sql.Request(bizlinksPool);
    bizRequest.input('factura', sql.VarChar(13), factura);

    const header = await bizRequest.query(`
      SELECT TOP (20)
        SERIENUMERO,
        TIPODOCUMENTO,
        FECHAEMISION,
        NUMERODOCUMENTOADQUIRIENTE,
        RAZONSOCIALADQUIRIENTE,
        BL_ESTADOREGISTRO
      FROM dbo.SPE_EINVOICEHEADER
      WHERE SERIENUMERO = @factura
        AND TIPODOCUMENTO = '01'
      ORDER BY FECHAEMISION DESC;
    `);

    const detailCount = await bizRequest.query(`
      SELECT COUNT(1) AS items
      FROM dbo.SPE_EINVOICEDETAIL
      WHERE SERIENUMERO = @factura
        AND TIPODOCUMENTO = '01';
    `);

    const response = await bizRequest.query(`
      SELECT TOP (20)
        SERIENUMERO,
        TIPODOCUMENTO,
        bl_estadoRegistro,
        bl_estadoProceso,
        process_state,
        bl_mensaje,
        bl_mensajeSunat,
        bl_url_pdf
      FROM dbo.SPE_EINVOICE_RESPONSE
      WHERE SERIENUMERO = @factura
        AND TIPODOCUMENTO = '01'
      ORDER BY SERIENUMERO;
    `);

    const guiaFacturada = await bizRequest.query(`
      SELECT TOP (50)
        RUC_EMISOR,
        NRO_GUIA,
        NRO_FACTURA,
        FECHA_EMISION,
        USUARIO,
        ESTADO
      FROM dbo.AAA_GUIAFACTURADA
      WHERE NRO_FACTURA = @factura
      ORDER BY FECHA_EMISION DESC;
    `).catch((error: unknown) => ({
      recordset: [{ error: error instanceof Error ? error.message : String(error) }]
    }));

    console.log(JSON.stringify({
      factura,
      libre: operaciones.recordset.length === 0
        && header.recordset.length === 0
        && Number(detailCount.recordset[0]?.items ?? 0) === 0
        && response.recordset.length === 0
        && guiaFacturada.recordset.length === 0,
      greFc: {
        operaciones: operaciones.recordset,
        guias: guias.recordset,
        detallesTrace: detallesTrace.recordset
      },
      bizlinks: {
        header: header.recordset,
        detailCount: detailCount.recordset,
        response: response.recordset,
        guiaFacturada: guiaFacturada.recordset
      }
    }, null, 2));
  } finally {
    await bizlinksPool.close();
    await greFcPool.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
