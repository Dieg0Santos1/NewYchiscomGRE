import { loadEnv } from '../../src/config/env.js';
import { createBizlinksPool, sql } from '../../src/integrations/bizlinksSql.js';

const target = process.argv[2]?.trim() || 'FF01-00017174';

async function main() {
  const pool = createBizlinksPool(loadEnv());
  await pool.connect();

  try {
    const request = new sql.Request(pool);
    request.input('target', sql.VarChar(13), target);
    const result = await request.query(`
      SET TRANSACTION ISOLATION LEVEL READ UNCOMMITTED;

      ;WITH acceptedCreditUsd AS (
        SELECT TOP (10)
          h.SERIENUMERO
        FROM dbo.SPE_EINVOICEHEADER h
        INNER JOIN dbo.SPE_EINVOICE_RESPONSE r
          ON r.NUMERODOCUMENTOEMISOR = h.NUMERODOCUMENTOEMISOR
         AND r.SERIENUMERO = h.SERIENUMERO
         AND r.TIPODOCUMENTO = h.TIPODOCUMENTO
        WHERE h.TIPODOCUMENTO = '01'
          AND h.SERIENUMERO LIKE 'FF01-%'
          AND h.tipoMoneda = 'USD'
          AND h.codigoDetraccion IS NULL
          AND EXISTS (
            SELECT 1
            FROM dbo.SPE_EINVOICEHEADER_ADD a
            WHERE a.NUMERODOCUMENTOEMISOR = h.NUMERODOCUMENTOEMISOR
              AND a.SERIENUMERO = h.SERIENUMERO
              AND a.TIPODOCUMENTO = h.TIPODOCUMENTO
              AND a.clave = 'montoPagoCuota1'
          )
          AND (
            r.bl_estadoProceso LIKE '%AC_03%'
            OR r.bl_mensajeSunat LIKE '%"codigo":"0"%'
          )
        ORDER BY h.fechaEmision DESC, h.SERIENUMERO DESC
      ), selected AS (
        SELECT @target AS SERIENUMERO
        UNION ALL
        SELECT SERIENUMERO FROM acceptedCreditUsd
      )
      SELECT
        h.SERIENUMERO,
        h.fechaEmision,
        h.tipoMoneda,
        h.totalValorVentaNetoOpGravadas,
        h.totalIGV,
        h.totalVenta,
        h.codigoDetraccion,
        a.clave,
        a.valor
      FROM selected s
      INNER JOIN dbo.SPE_EINVOICEHEADER h
        ON h.SERIENUMERO = s.SERIENUMERO
       AND h.TIPODOCUMENTO = '01'
      LEFT JOIN dbo.SPE_EINVOICEHEADER_ADD a
        ON a.NUMERODOCUMENTOEMISOR = h.NUMERODOCUMENTOEMISOR
       AND a.SERIENUMERO = h.SERIENUMERO
       AND a.TIPODOCUMENTO = h.TIPODOCUMENTO
       AND a.clave IN (
         'formapago',
         'formaPagoNegociable',
         'facturaPagoNegociable',
         'montoNetoPendiente',
         'montoPagoCuota1',
         'fechaPagoCuota1',
         'fechaVencimiento',
         'tipocambio'
       )
      ORDER BY h.fechaEmision DESC, h.SERIENUMERO DESC, a.clave;
    `);
    const definitions = await new sql.Request(pool).query(`
      SET TRANSACTION ISOLATION LEVEL READ UNCOMMITTED;
      SELECT
        name,
        OBJECT_DEFINITION(object_id) AS definition
      FROM sys.procedures
      WHERE name IN ('USP_CabeceraFE', 'USP_EnviaDocumentoFE');
    `);

    console.log(JSON.stringify({
      safety: 'READ_ONLY',
      target,
      rows: result.recordset,
      definitions: definitions.recordset
    }, null, 2));
  } finally {
    await pool.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
