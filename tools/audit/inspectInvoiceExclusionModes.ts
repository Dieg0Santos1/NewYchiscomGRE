import { loadEnv } from '../../src/config/env.js';
import { createBizlinksPool, sql } from '../../src/integrations/bizlinksSql.js';

async function main() {
  const pool = createBizlinksPool(loadEnv());
  await pool.connect();

  try {
    const result = await new sql.Request(pool).query(`
      SET TRANSACTION ISOLATION LEVEL READ UNCOMMITTED;
      SET NOCOUNT ON;

      ;WITH accepted AS (
        SELECT
          h.SERIENUMERO,
          h.FECHAEMISION,
          h.NUMERODOCUMENTOADQUIRIENTE,
          h.RAZONSOCIALADQUIRIENTE,
          h.tipoMoneda,
          h.tipoOperacion,
          h.totalValorVentaNetoOpGravadas,
          h.totalValorVentaNetoOpGratuitas,
          h.totalValorVentaNetoOpExonerada,
          h.totalValorVentaNetoOpNoGravada,
          h.totalIgv,
          h.totalImpuestos,
          h.totalVenta,
          LEFT(COALESCE(r.bl_mensajeSunat, r.bl_mensaje, ''), 180) AS mensaje
        FROM dbo.SPE_EINVOICEHEADER h
        INNER JOIN dbo.SPE_EINVOICE_RESPONSE r
          ON r.NUMERODOCUMENTOEMISOR = h.NUMERODOCUMENTOEMISOR
         AND r.SERIENUMERO = h.SERIENUMERO
         AND r.TIPODOCUMENTO = h.TIPODOCUMENTO
        WHERE h.TIPODOCUMENTO = '01'
          AND (h.SERIENUMERO LIKE 'FF01-%' OR h.SERIENUMERO LIKE 'FF03-%')
          AND r.process_state = '_3_COMPLETED'
          AND (
            r.bl_mensajeSunat LIKE '%"codigo":"0"%'
            OR r.bl_mensajeSunat LIKE '%aceptad%'
            OR r.bl_mensaje LIKE '%aceptad%'
          )
      ),
      typed AS (
        SELECT
          CASE
            WHEN CONVERT(decimal(18, 2), ISNULL(NULLIF(totalValorVentaNetoOpGravadas, ''), '0')) > 0 THEN 'GRAVADA'
            WHEN CONVERT(decimal(18, 2), ISNULL(NULLIF(totalValorVentaNetoOpGratuitas, ''), '0')) > 0 THEN 'GRATUITA'
            WHEN CONVERT(decimal(18, 2), ISNULL(NULLIF(totalValorVentaNetoOpExonerada, ''), '0')) > 0 THEN 'EXONERADA'
            WHEN CONVERT(decimal(18, 2), ISNULL(NULLIF(totalValorVentaNetoOpNoGravada, ''), '0')) > 0 THEN 'INAFECTA'
            ELSE 'SIN_BASE'
          END AS tipoExclusion,
          LEFT(SERIENUMERO, 4) AS serie,
          *
        FROM accepted
      )
      SELECT
        serie,
        tipoExclusion,
        COUNT(*) AS facturas,
        MAX(SERIENUMERO) AS ejemplo,
        MIN(CONVERT(decimal(18, 2), ISNULL(NULLIF(totalVenta, ''), '0'))) AS totalMinimo,
        MAX(CONVERT(decimal(18, 2), ISNULL(NULLIF(totalVenta, ''), '0'))) AS totalMaximo
      FROM typed
      GROUP BY serie, tipoExclusion
      ORDER BY serie, tipoExclusion;

      ;WITH detailModes AS (
        SELECT
          LEFT(d.SERIENUMERO, 4) AS serie,
          ISNULL(NULLIF(LTRIM(RTRIM(d.CODIGORAZONEXONERACION)), ''), '(VACIO)') AS codigoAfectacion,
          ISNULL(NULLIF(LTRIM(RTRIM(d.codigoImporteUnitarioConImpues)), ''), '(VACIO)') AS codigoPrecio,
          d.tasaIgv,
          COUNT(DISTINCT d.SERIENUMERO) AS facturas,
          COUNT(*) AS items,
          MAX(d.SERIENUMERO) AS ejemplo
        FROM dbo.SPE_EINVOICEDETAIL d
        INNER JOIN dbo.SPE_EINVOICE_RESPONSE r
          ON r.NUMERODOCUMENTOEMISOR = d.NUMERODOCUMENTOEMISOR
         AND r.SERIENUMERO = d.SERIENUMERO
         AND r.TIPODOCUMENTO = d.TIPODOCUMENTO
        WHERE d.TIPODOCUMENTO = '01'
          AND (d.SERIENUMERO LIKE 'FF01-%' OR d.SERIENUMERO LIKE 'FF03-%')
          AND r.process_state = '_3_COMPLETED'
          AND (
            r.bl_mensajeSunat LIKE '%"codigo":"0"%'
            OR r.bl_mensajeSunat LIKE '%aceptad%'
            OR r.bl_mensaje LIKE '%aceptad%'
          )
        GROUP BY
          LEFT(d.SERIENUMERO, 4),
          ISNULL(NULLIF(LTRIM(RTRIM(d.CODIGORAZONEXONERACION)), ''), '(VACIO)'),
          ISNULL(NULLIF(LTRIM(RTRIM(d.codigoImporteUnitarioConImpues)), ''), '(VACIO)'),
          d.tasaIgv
      )
      SELECT *
      FROM detailModes
      ORDER BY serie, codigoAfectacion, codigoPrecio, tasaIgv;

      ;WITH accepted AS (
        SELECT
          h.*,
          LEFT(COALESCE(r.bl_mensajeSunat, r.bl_mensaje, ''), 180) AS mensaje
        FROM dbo.SPE_EINVOICEHEADER h
        INNER JOIN dbo.SPE_EINVOICE_RESPONSE r
          ON r.NUMERODOCUMENTOEMISOR = h.NUMERODOCUMENTOEMISOR
         AND r.SERIENUMERO = h.SERIENUMERO
         AND r.TIPODOCUMENTO = h.TIPODOCUMENTO
        WHERE h.TIPODOCUMENTO = '01'
          AND (h.SERIENUMERO LIKE 'FF01-%' OR h.SERIENUMERO LIKE 'FF03-%')
          AND r.process_state = '_3_COMPLETED'
          AND (
            r.bl_mensajeSunat LIKE '%"codigo":"0"%'
            OR r.bl_mensajeSunat LIKE '%aceptad%'
            OR r.bl_mensaje LIKE '%aceptad%'
          )
      ),
      examples AS (
        SELECT 'GRATUITA' AS tipoExclusion, *
        FROM accepted
        WHERE CONVERT(decimal(18, 2), ISNULL(NULLIF(totalValorVentaNetoOpGratuitas, ''), '0')) > 0
        UNION ALL
        SELECT 'EXONERADA' AS tipoExclusion, *
        FROM accepted
        WHERE CONVERT(decimal(18, 2), ISNULL(NULLIF(totalValorVentaNetoOpExonerada, ''), '0')) > 0
        UNION ALL
        SELECT 'INAFECTA' AS tipoExclusion, *
        FROM accepted
        WHERE CONVERT(decimal(18, 2), ISNULL(NULLIF(totalValorVentaNetoOpNoGravada, ''), '0')) > 0
      ),
      ranked AS (
        SELECT
          tipoExclusion,
          SERIENUMERO,
          FECHAEMISION,
          NUMERODOCUMENTOADQUIRIENTE,
          RAZONSOCIALADQUIRIENTE,
          tipoMoneda,
          tipoOperacion,
          totalValorVentaNetoOpGravadas,
          totalValorVentaNetoOpGratuitas,
          totalValorVentaNetoOpExonerada,
          totalValorVentaNetoOpNoGravada,
          totalIgv,
          totalImpuestos,
          totalVenta,
          mensaje,
          ROW_NUMBER() OVER (PARTITION BY LEFT(SERIENUMERO, 4), tipoExclusion ORDER BY SERIENUMERO DESC) AS rn
        FROM examples
      )
      SELECT *
      FROM ranked
      WHERE rn <= 5
      ORDER BY LEFT(SERIENUMERO, 4), tipoExclusion, rn;
    `);

    const [headerSummary, detailSummary, examples] = result.recordsets;
    console.log(JSON.stringify({
      safety: 'READ_ONLY',
      headerSummary,
      detailSummary,
      examples
    }, null, 2));
  } finally {
    await pool.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
