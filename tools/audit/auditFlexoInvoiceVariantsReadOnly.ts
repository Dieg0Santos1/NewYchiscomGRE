import { loadEnv } from '../../src/config/env.js';
import { createBizlinksPool, sql } from '../../src/integrations/bizlinksSql.js';

async function main() {
  const pool = createBizlinksPool(loadEnv());
  await pool.connect();

  try {
    const result = await new sql.Request(pool).query(`
      SET TRANSACTION ISOLATION LEVEL READ UNCOMMITTED;
      SET NOCOUNT ON;

      IF OBJECT_ID('tempdb..#enriched') IS NOT NULL DROP TABLE #enriched;

      ;WITH accepted AS (
        SELECT
          h.SERIENUMERO,
          h.FECHAEMISION,
          h.NUMERODOCUMENTOADQUIRIENTE,
          h.RAZONSOCIALADQUIRIENTE,
          h.tipoMoneda,
          h.tipoOperacion,
          h.codigoDetraccion,
          h.porcentajeDetraccion,
          h.totalDetraccion,
          h.totalValorVentaNetoOpGravadas,
          h.totalValorVentaNetoOpGratuitas,
          h.totalValorVentaNetoOpExonerada,
          h.totalValorVentaNetoOpNoGravada,
          h.totalIgv,
          h.totalVenta
        FROM dbo.SPE_EINVOICEHEADER h
        INNER JOIN dbo.SPE_EINVOICE_RESPONSE r
          ON r.NUMERODOCUMENTOEMISOR = h.NUMERODOCUMENTOEMISOR
         AND r.SERIENUMERO = h.SERIENUMERO
         AND r.TIPODOCUMENTO = h.TIPODOCUMENTO
        WHERE h.TIPODOCUMENTO = '01'
          AND h.SERIENUMERO LIKE 'FF03-%'
          AND (
            r.bl_estadoProceso LIKE '%AC_03%'
            OR r.bl_mensajeSunat LIKE '%"codigo":"0"%'
            OR r.bl_mensajeSunat LIKE '%aceptad%'
          )
      ),
      enriched AS (
        SELECT
          a.*,
          MAX(CASE WHEN ad.clave = 'formaPagoNegociable' THEN ad.valor END) AS formaPagoNegociable,
          MAX(CASE WHEN ad.clave = 'montoPagoCuota1' THEN ad.valor END) AS montoPagoCuota1,
          MAX(CASE WHEN ad.clave = 'fechaPagoCuota1' THEN ad.valor END) AS fechaPagoCuota1,
          MAX(CASE WHEN ad.clave = 'fechaVencimiento' THEN ad.valor END) AS fechaVencimiento,
          MAX(CASE WHEN ad.clave = 'ordenCompra' THEN ad.valor END) AS ordenCompra,
          COUNT(DISTINCT gf.NRO_GUIA) AS guias,
          COUNT(DISTINCT d.NUMEROORDENITEM) AS items,
          MAX(rc.cuenta) AS cuenta
        FROM accepted a
        LEFT JOIN dbo.SPE_EINVOICEHEADER_ADD ad
          ON ad.SERIENUMERO = a.SERIENUMERO
         AND ad.TIPODOCUMENTO = '01'
        LEFT JOIN dbo.AAA_GUIAFACTURADA gf
          ON gf.NRO_FACTURA = a.SERIENUMERO
        LEFT JOIN dbo.SPE_EINVOICEDETAIL d
          ON d.SERIENUMERO = a.SERIENUMERO
         AND d.TIPODOCUMENTO = '01'
        LEFT JOIN dbo.AAA_REGISTRO_CONTABLE rc
          ON rc.serieNumero = a.SERIENUMERO
         AND rc.tipoDoc = '01'
        GROUP BY
          a.SERIENUMERO,
          a.FECHAEMISION,
          a.NUMERODOCUMENTOADQUIRIENTE,
          a.RAZONSOCIALADQUIRIENTE,
          a.tipoMoneda,
          a.tipoOperacion,
          a.codigoDetraccion,
          a.porcentajeDetraccion,
          a.totalDetraccion,
          a.totalValorVentaNetoOpGravadas,
          a.totalValorVentaNetoOpGratuitas,
          a.totalValorVentaNetoOpExonerada,
          a.totalValorVentaNetoOpNoGravada,
          a.totalIgv,
          a.totalVenta
      )
      SELECT *
      INTO #enriched
      FROM enriched;

      SELECT TOP (30)
        SERIENUMERO,
        FECHAEMISION,
        tipoMoneda,
        tipoOperacion,
        codigoDetraccion,
        porcentajeDetraccion,
        totalDetraccion,
        formaPagoNegociable,
        montoPagoCuota1,
        fechaPagoCuota1,
        fechaVencimiento,
        ordenCompra,
        cuenta,
        guias,
        items,
        NUMERODOCUMENTOADQUIRIENTE,
        RAZONSOCIALADQUIRIENTE,
        totalValorVentaNetoOpGravadas,
        totalIgv,
        totalVenta
      FROM #enriched
      ORDER BY FECHAEMISION DESC, SERIENUMERO DESC;

      SELECT
        tipoMoneda,
        tipoOperacion,
        ISNULL(NULLIF(codigoDetraccion, ''), '(SIN_DETRACCION)') AS detraccion,
        ISNULL(NULLIF(formaPagoNegociable, ''), '0') AS pagoNegociable,
        COUNT(*) AS facturas,
        MAX(SERIENUMERO) AS ejemplo
      FROM #enriched
      GROUP BY
        tipoMoneda,
        tipoOperacion,
        ISNULL(NULLIF(codigoDetraccion, ''), '(SIN_DETRACCION)'),
        ISNULL(NULLIF(formaPagoNegociable, ''), '0')
      ORDER BY facturas DESC;
    `);

    console.log(JSON.stringify({
      safety: 'READ_ONLY',
      recentAccepted: result.recordsets[0],
      summary: result.recordsets[1]
    }, null, 2));
  } finally {
    await pool.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
