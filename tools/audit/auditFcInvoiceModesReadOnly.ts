import { loadEnv } from '../../src/config/env.js';
import { createBizlinksPool, sql } from '../../src/integrations/bizlinksSql.js';

type Row = Record<string, unknown>;

async function main() {
  const pool = createBizlinksPool(loadEnv());
  await pool.connect();

  try {
    const result = await new sql.Request(pool).query(`
      SET TRANSACTION ISOLATION LEVEL READ UNCOMMITTED;
      SET NOCOUNT ON;

      SELECT
        CASE WHEN NULLIF(LTRIM(RTRIM(h.tipoMoneda)), '') IS NULL THEN '(VACIO)' ELSE h.tipoMoneda END AS moneda,
        CASE WHEN NULLIF(LTRIM(RTRIM(h.tipoOperacion)), '') IS NULL THEN '(VACIO)' ELSE h.tipoOperacion END AS tipoOperacion,
        CASE WHEN NULLIF(LTRIM(RTRIM(h.codigoDetraccion)), '') IS NULL THEN '000' ELSE h.codigoDetraccion END AS detraccion,
        h.porcentajeDetraccion,
        COUNT(*) AS facturas,
        MIN(CONVERT(decimal(18, 2), h.totalVenta)) AS totalMinimo,
        MAX(CONVERT(decimal(18, 2), h.totalVenta)) AS totalMaximo,
        MAX(h.serieNumero) AS ejemplo
      FROM dbo.SPE_EINVOICEHEADER h
      INNER JOIN dbo.SPE_EINVOICE_RESPONSE r
        ON r.numeroDocumentoEmisor = h.numeroDocumentoEmisor
       AND r.serieNumero = h.serieNumero
       AND r.tipoDocumento = h.tipoDocumento
      WHERE h.serieNumero LIKE 'FF01-%'
        AND h.tipoDocumento = '01'
        AND (
          r.bl_estadoProceso LIKE '%AC_03%'
          OR r.bl_mensajeSunat LIKE '%\"codigo\":\"0\"%'
          OR r.bl_mensajeSunat LIKE '%aceptada%'
        )
      GROUP BY
        CASE WHEN NULLIF(LTRIM(RTRIM(h.tipoMoneda)), '') IS NULL THEN '(VACIO)' ELSE h.tipoMoneda END,
        CASE WHEN NULLIF(LTRIM(RTRIM(h.tipoOperacion)), '') IS NULL THEN '(VACIO)' ELSE h.tipoOperacion END,
        CASE WHEN NULLIF(LTRIM(RTRIM(h.codigoDetraccion)), '') IS NULL THEN '000' ELSE h.codigoDetraccion END,
        h.porcentajeDetraccion
      ORDER BY moneda, tipoOperacion, detraccion;

      SELECT
        ISNULL(NULLIF(LTRIM(RTRIM(d.codigoRazonExoneracion)), ''), '(VACIO)') AS codigoAfectacion,
        ISNULL(NULLIF(LTRIM(RTRIM(d.codigoImporteUnitarioConImpues)), ''), '(VACIO)') AS codigoPrecio,
        d.tasaIgv,
        COUNT(DISTINCT d.serieNumero) AS facturas,
        COUNT(*) AS items,
        MAX(d.serieNumero) AS ejemplo
      FROM dbo.SPE_EINVOICEDETAIL d
      INNER JOIN dbo.SPE_EINVOICE_RESPONSE r
        ON r.numeroDocumentoEmisor = d.numeroDocumentoEmisor
       AND r.serieNumero = d.serieNumero
       AND r.tipoDocumento = d.tipoDocumento
      WHERE d.serieNumero LIKE 'FF01-%'
        AND d.tipoDocumento = '01'
        AND (
          r.bl_estadoProceso LIKE '%AC_03%'
          OR r.bl_mensajeSunat LIKE '%\"codigo\":\"0\"%'
          OR r.bl_mensajeSunat LIKE '%aceptada%'
        )
      GROUP BY
        ISNULL(NULLIF(LTRIM(RTRIM(d.codigoRazonExoneracion)), ''), '(VACIO)'),
        ISNULL(NULLIF(LTRIM(RTRIM(d.codigoImporteUnitarioConImpues)), ''), '(VACIO)'),
        d.tasaIgv
      ORDER BY codigoAfectacion, codigoPrecio, d.tasaIgv;

      ;WITH accepted AS (
        SELECT
          h.serieNumero,
          h.fechaEmision,
          h.tipoMoneda,
          addFields.tipocambio,
          h.tipoOperacion,
          h.codigoDetraccion,
          h.porcentajeDetraccion,
          h.totalDetraccion,
          addFields.formapago,
          addFields.facturaPagoNegociable,
          addFields.fechaVencimiento,
          addFields.montoNetoPendiente,
          addFields.montoPagoCuota1,
          addFields.fechaPagoCuota1,
          h.totalValorVentaNetoOpGravadas,
          h.totalValorVentaNetoOpGratuitas,
          h.totalValorVentaNetoOpExonerada,
          h.totalValorVentaNetoOpNoGravada,
          h.totalIgv,
          h.totalVenta,
          h.numeroDocumentoReferencia_1,
          h.numeroDocumentoReferencia_2,
          h.numeroDocumentoReferencia_3,
          h.numeroDocumentoReferencia_4,
          h.numeroDocumentoReferencia_5,
          (SELECT COUNT(*) FROM dbo.SPE_EINVOICEDETAIL d
            WHERE d.serieNumero = h.serieNumero AND d.tipoDocumento = h.tipoDocumento) AS items,
          (SELECT COUNT(*) FROM dbo.AAA_GUIAFACTURADA g
            WHERE g.NRO_FACTURA = h.serieNumero) AS guiasRelacionadas
        FROM dbo.SPE_EINVOICEHEADER h
        INNER JOIN dbo.SPE_EINVOICE_RESPONSE r
          ON r.numeroDocumentoEmisor = h.numeroDocumentoEmisor
         AND r.serieNumero = h.serieNumero
         AND r.tipoDocumento = h.tipoDocumento
        OUTER APPLY (
          SELECT
            MAX(CASE WHEN a.clave = 'tipocambio' THEN a.valor END) AS tipocambio,
            MAX(CASE WHEN a.clave = 'formapago' THEN a.valor END) AS formapago,
            MAX(CASE WHEN a.clave = 'facturaPagoNegociable' THEN a.valor END) AS facturaPagoNegociable,
            MAX(CASE WHEN a.clave = 'fechaVencimiento' THEN a.valor END) AS fechaVencimiento,
            MAX(CASE WHEN a.clave = 'montoNetoPendiente' THEN a.valor END) AS montoNetoPendiente,
            MAX(CASE WHEN a.clave = 'montoPagoCuota1' THEN a.valor END) AS montoPagoCuota1,
            MAX(CASE WHEN a.clave = 'fechaPagoCuota1' THEN a.valor END) AS fechaPagoCuota1
          FROM dbo.SPE_EINVOICEHEADER_ADD a
          WHERE a.numeroDocumentoEmisor = h.numeroDocumentoEmisor
            AND a.serieNumero = h.serieNumero
            AND a.tipoDocumento = h.tipoDocumento
        ) addFields
        WHERE h.serieNumero LIKE 'FF01-%'
          AND h.tipoDocumento = '01'
          AND (
            r.bl_estadoProceso LIKE '%AC_03%'
            OR r.bl_mensajeSunat LIKE '%\"codigo\":\"0\"%'
            OR r.bl_mensajeSunat LIKE '%aceptada%'
          )
      )
      SELECT *
      FROM (
        SELECT 'USD' AS modalidad, a.*,
          ROW_NUMBER() OVER (PARTITION BY a.tipoMoneda ORDER BY a.serieNumero DESC) AS rn
        FROM accepted a WHERE a.tipoMoneda = 'USD'
        UNION ALL
        SELECT 'DETRACCION_025', a.*,
          ROW_NUMBER() OVER (PARTITION BY a.codigoDetraccion ORDER BY a.serieNumero DESC) AS rn
        FROM accepted a WHERE a.codigoDetraccion = '025'
        UNION ALL
        SELECT 'DETRACCION_037', a.*,
          ROW_NUMBER() OVER (PARTITION BY a.codigoDetraccion ORDER BY a.serieNumero DESC) AS rn
        FROM accepted a WHERE a.codigoDetraccion = '037'
        UNION ALL
        SELECT 'CREDITO', a.*,
          ROW_NUMBER() OVER (PARTITION BY a.facturaPagoNegociable ORDER BY a.serieNumero DESC) AS rn
        FROM accepted a
        WHERE a.facturaPagoNegociable = '1'
           OR a.montoPagoCuota1 IS NOT NULL
           OR a.fechaPagoCuota1 IS NOT NULL
        UNION ALL
        SELECT 'MULTI_ITEM', a.*,
          ROW_NUMBER() OVER (ORDER BY a.items DESC, a.serieNumero DESC) AS rn
        FROM accepted a WHERE a.items > 1
        UNION ALL
        SELECT 'MULTI_GUIA', a.*,
          ROW_NUMBER() OVER (ORDER BY a.guiasRelacionadas DESC, a.serieNumero DESC) AS rn
        FROM accepted a WHERE a.guiasRelacionadas > 1
        UNION ALL
        SELECT 'EXONERADA', a.*,
          ROW_NUMBER() OVER (ORDER BY a.serieNumero DESC) AS rn
        FROM accepted a
        WHERE CONVERT(decimal(18, 2), ISNULL(NULLIF(a.totalValorVentaNetoOpExonerada, ''), '0')) > 0
        UNION ALL
        SELECT 'INAFECTA', a.*,
          ROW_NUMBER() OVER (ORDER BY a.serieNumero DESC) AS rn
        FROM accepted a
        WHERE CONVERT(decimal(18, 2), ISNULL(NULLIF(a.totalValorVentaNetoOpNoGravada, ''), '0')) > 0
        UNION ALL
        SELECT 'GRATUITA', a.*,
          ROW_NUMBER() OVER (ORDER BY a.serieNumero DESC) AS rn
        FROM accepted a
        WHERE CONVERT(decimal(18, 2), ISNULL(NULLIF(a.totalValorVentaNetoOpGratuitas, ''), '0')) > 0
      ) modes
      WHERE rn <= 3
      ORDER BY modalidad, rn;

      SELECT TOP (20)
        h.serieNumero,
        h.fechaEmision,
        h.tipoMoneda,
        h.tipoOperacion,
        h.codigoDetraccion,
        h.porcentajeDetraccion,
        h.totalDetraccion,
        h.totalVenta,
        r.bl_estadoProceso,
        r.bl_mensajeSunat
      FROM dbo.SPE_EINVOICEHEADER h
      INNER JOIN dbo.SPE_EINVOICE_RESPONSE r
        ON r.numeroDocumentoEmisor = h.numeroDocumentoEmisor
       AND r.serieNumero = h.serieNumero
       AND r.tipoDocumento = h.tipoDocumento
      WHERE h.tipoDocumento = '01'
        AND h.codigoDetraccion = '025'
        AND (
          r.bl_estadoProceso LIKE '%AC_03%'
          OR r.bl_mensajeSunat LIKE '%\"codigo\":\"0\"%'
          OR r.bl_mensajeSunat LIKE '%aceptada%'
        )
      ORDER BY h.fechaEmision DESC, h.serieNumero DESC;

      SELECT TOP (30)
        a.serieNumero,
        a.clave,
        a.valor
      FROM dbo.SPE_EINVOICEHEADER_ADD a
      WHERE a.serieNumero IN (
        'FF01-00017172',
        'FF01-00017170',
        'FF01-00017168',
        'FF01-00017171'
      )
      ORDER BY a.serieNumero DESC, a.clave;

      SELECT TOP (20)
        h.serieNumero,
        h.fechaEmision,
        h.numeroDocumentoReferencia_1,
        h.numeroDocumentoReferencia_2,
        h.numeroDocumentoReferencia_3,
        h.numeroDocumentoReferencia_4,
        h.numeroDocumentoReferencia_5,
        (SELECT COUNT(*) FROM dbo.SPE_EINVOICEDETAIL d
          WHERE d.serieNumero = h.serieNumero AND d.tipoDocumento = h.tipoDocumento) AS items
      FROM dbo.SPE_EINVOICEHEADER h
      INNER JOIN dbo.SPE_EINVOICE_RESPONSE r
        ON r.numeroDocumentoEmisor = h.numeroDocumentoEmisor
       AND r.serieNumero = h.serieNumero
       AND r.tipoDocumento = h.tipoDocumento
      WHERE h.serieNumero LIKE 'FF01-%'
        AND h.tipoDocumento = '01'
        AND h.numeroDocumentoReferencia_2 IS NOT NULL
        AND (
          r.bl_estadoProceso LIKE '%AC_03%'
          OR r.bl_mensajeSunat LIKE '%\"codigo\":\"0\"%'
          OR r.bl_mensajeSunat LIKE '%aceptada%'
        )
      ORDER BY h.fechaEmision DESC, h.serieNumero DESC;

      SELECT OBJECT_DEFINITION(OBJECT_ID('dbo.USP_EnviaDocumentoFE')) AS definition;
    `);

    const [
      moneyModes = [],
      taxModes = [],
      examples = [],
      accepted025 = [],
      additionalFields = [],
      multipleReferences = [],
      procedureRows = []
    ] = result.recordsets as Row[][];
    const procedureDefinition = String(procedureRows[0]?.definition ?? '');
    const guideLogicPosition = procedureDefinition.toUpperCase().indexOf('AAA_GUIAFACTURADA');
    const guideLogic = guideLogicPosition >= 0
      ? procedureDefinition.slice(Math.max(0, guideLogicPosition - 1200), guideLogicPosition + 5000)
      : '';
    console.log(JSON.stringify({
      safety: {
        mode: 'READ_ONLY',
        statements: ['SET', 'SELECT'],
        proceduresExecuted: false,
        writesDatabase: false
      },
      moneyAndDetractionModes: moneyModes,
      taxModes,
      representativeAcceptedInvoices: examples,
      acceptedDetraction025AnySeries: accepted025,
      selectedAdditionalFields: additionalFields,
      acceptedMultipleReferences: multipleReferences,
      uspEnviaDocumentoFeGuideLogic: guideLogic
    }, null, 2));
  } finally {
    await pool.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
