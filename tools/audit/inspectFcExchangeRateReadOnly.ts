import { loadEnv } from '../../src/config/env.js';
import { createBizlinksPool, createYchiPool, sql } from '../../src/integrations/bizlinksSql.js';

async function main() {
  const config = loadEnv();
  const bizlinks = createBizlinksPool(config);
  const ychiscom = createYchiPool(config);
  await bizlinks.connect();
  await ychiscom.connect();

  try {
    const [functionInfo, dependencies, acceptedUsd] = await Promise.all([
      new sql.Request(ychiscom).query(`
        SET TRANSACTION ISOLATION LEVEL READ UNCOMMITTED;
        SELECT OBJECT_DEFINITION(OBJECT_ID('dbo.F_TicaVenta')) AS definition;
      `),
      new sql.Request(ychiscom).query(`
        SET TRANSACTION ISOLATION LEVEL READ UNCOMMITTED;
        SELECT
          referenced_schema_name,
          referenced_entity_name,
          referenced_minor_name
        FROM sys.dm_sql_referenced_entities('dbo.F_TicaVenta', 'OBJECT');
      `),
      new sql.Request(bizlinks).query(`
        SET TRANSACTION ISOLATION LEVEL READ UNCOMMITTED;
        SELECT TOP (30)
          h.serieNumero,
          h.fechaEmision,
          h.tipoMoneda,
          h.totalVenta,
          h.codigoDetraccion,
          h.porcentajeDetraccion,
          h.totalDetraccion,
          CASE
            WHEN CONVERT(decimal(18, 6), ISNULL(NULLIF(h.totalVenta, ''), '0')) > 0
             AND CONVERT(decimal(18, 6), ISNULL(NULLIF(h.porcentajeDetraccion, ''), '0')) > 0
            THEN CONVERT(decimal(18, 6), h.totalDetraccion)
              / (CONVERT(decimal(18, 6), h.totalVenta)
                * CONVERT(decimal(18, 6), h.porcentajeDetraccion) / 100)
            ELSE NULL
          END AS tipoCambioDerivado
        FROM dbo.SPE_EINVOICEHEADER h
        INNER JOIN dbo.SPE_EINVOICE_RESPONSE r
          ON r.numeroDocumentoEmisor = h.numeroDocumentoEmisor
         AND r.serieNumero = h.serieNumero
         AND r.tipoDocumento = h.tipoDocumento
        WHERE h.serieNumero LIKE 'FF01-%'
          AND h.tipoDocumento = '01'
          AND h.tipoMoneda = 'USD'
          AND h.codigoDetraccion IS NOT NULL
          AND h.totalDetraccion IS NOT NULL
          AND (
            r.bl_estadoProceso LIKE '%AC_03%'
            OR r.bl_mensajeSunat LIKE '%\"codigo\":\"0\"%'
            OR r.bl_mensajeSunat LIKE '%aceptada%'
          )
        ORDER BY h.fechaEmision DESC, h.serieNumero DESC;
      `)
    ]);

    console.log(JSON.stringify({
      safety: 'READ_ONLY',
      fTicaVentaDefinition: functionInfo.recordset[0]?.definition ?? null,
      dependencies: dependencies.recordset,
      acceptedUsdDetractions: acceptedUsd.recordset
    }, null, 2));
  } finally {
    await ychiscom.close();
    await bizlinks.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

