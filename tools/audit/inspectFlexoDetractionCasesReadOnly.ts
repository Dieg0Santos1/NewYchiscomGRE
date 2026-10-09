import { loadEnv } from '../../src/config/env.js';
import { createBizlinksPool, createYchiPool, sql } from '../../src/integrations/bizlinksSql.js';

type BizCase = {
  SERIENUMERO: string;
  FECHAEMISION: Date | string;
  NUMERODOCUMENTOADQUIRIENTE: string;
  RAZONSOCIALADQUIRIENTE: string;
  tipoMoneda: string | null;
  tipoOperacion: string | null;
  codigoDetraccion: string | null;
  porcentajeDetraccion: string | null;
  totalDetraccion: string | null;
  totalValorVentaNetoOpGravadas: string | null;
  totalIgv: string | null;
  totalVenta: string | null;
  facturaPagoNegociable: string | null;
  montoNetoPendiente: string | null;
  montoPagoCuota1: string | null;
  fechaPagoCuota1: string | null;
  fechaVencimiento: string | null;
  formaPago: string | null;
  guias: number;
  items: number;
};

type Row = Record<string, unknown>;

const interesting = /idDocumento|idTipoDocu|SeriDocu|NumeDocu|Fecha|Venc|idClieProv|idEmpleado|Moneda|Tica|Neto|Igv|Total|Detrac|detrac|Saldo|Cuenta|cuenta|Pago|pago|Guia|guia|Orden|orden|observ|Observ|nguia|tica/i;

async function main() {
  const config = loadEnv();
  const bizlinksPool = createBizlinksPool(config);
  const ychiPool = createYchiPool(config);
  await bizlinksPool.connect();
  await ychiPool.connect();

  try {
    const biz = await new sql.Request(bizlinksPool).query<BizCase>(`
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
          h.codigoDetraccion,
          h.porcentajeDetraccion,
          h.totalDetraccion,
          h.totalValorVentaNetoOpGravadas,
          h.totalIgv,
          h.totalVenta,
          MAX(CASE WHEN ad.clave = 'facturaPagoNegociable' THEN ad.valor END) AS facturaPagoNegociable,
          MAX(CASE WHEN ad.clave = 'montoNetoPendiente' THEN ad.valor END) AS montoNetoPendiente,
          MAX(CASE WHEN ad.clave = 'montoPagoCuota1' THEN ad.valor END) AS montoPagoCuota1,
          MAX(CASE WHEN ad.clave = 'fechaPagoCuota1' THEN ad.valor END) AS fechaPagoCuota1,
          MAX(CASE WHEN ad.clave = 'fechaVencimiento' THEN ad.valor END) AS fechaVencimiento,
          MAX(CASE WHEN ad.clave = 'formapago' THEN ad.valor END) AS formaPago,
          COUNT(DISTINCT gf.NRO_GUIA) AS guias,
          COUNT(DISTINCT d.NUMEROORDENITEM) AS items
        FROM dbo.SPE_EINVOICEHEADER h
        INNER JOIN dbo.SPE_EINVOICE_RESPONSE r
          ON r.NUMERODOCUMENTOEMISOR = h.NUMERODOCUMENTOEMISOR
         AND r.SERIENUMERO = h.SERIENUMERO
         AND r.TIPODOCUMENTO = h.TIPODOCUMENTO
        LEFT JOIN dbo.SPE_EINVOICEHEADER_ADD ad
          ON ad.NUMERODOCUMENTOEMISOR = h.NUMERODOCUMENTOEMISOR
         AND ad.SERIENUMERO = h.SERIENUMERO
         AND ad.TIPODOCUMENTO = h.TIPODOCUMENTO
        LEFT JOIN dbo.AAA_GUIAFACTURADA gf
          ON gf.NRO_FACTURA = h.SERIENUMERO
        LEFT JOIN dbo.SPE_EINVOICEDETAIL d
          ON d.NUMERODOCUMENTOEMISOR = h.NUMERODOCUMENTOEMISOR
         AND d.SERIENUMERO = h.SERIENUMERO
         AND d.TIPODOCUMENTO = h.TIPODOCUMENTO
        WHERE h.TIPODOCUMENTO = '01'
          AND h.SERIENUMERO LIKE 'FF03-%'
          AND NULLIF(LTRIM(RTRIM(h.codigoDetraccion)), '') IS NOT NULL
          AND (
            r.bl_estadoProceso LIKE '%AC_03%'
            OR r.bl_mensajeSunat LIKE '%"codigo":"0"%'
            OR r.bl_mensajeSunat LIKE '%aceptad%'
          )
        GROUP BY
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
          h.totalIgv,
          h.totalVenta
      ),
      ranked AS (
        SELECT *,
          ROW_NUMBER() OVER (PARTITION BY codigoDetraccion, facturaPagoNegociable ORDER BY FECHAEMISION DESC, SERIENUMERO DESC) AS rn
        FROM accepted
      )
      SELECT *
      FROM ranked
      WHERE rn <= 3
      ORDER BY codigoDetraccion, facturaPagoNegociable, rn;

      SELECT
        h.tipoMoneda,
        h.tipoOperacion,
        h.codigoDetraccion,
        h.porcentajeDetraccion,
        COUNT(*) AS facturas,
        MIN(CONVERT(decimal(18, 2), h.totalVenta)) AS totalMinimo,
        MAX(CONVERT(decimal(18, 2), h.totalVenta)) AS totalMaximo,
        MAX(h.SERIENUMERO) AS ejemplo
      FROM dbo.SPE_EINVOICEHEADER h
      INNER JOIN dbo.SPE_EINVOICE_RESPONSE r
        ON r.NUMERODOCUMENTOEMISOR = h.NUMERODOCUMENTOEMISOR
       AND r.SERIENUMERO = h.SERIENUMERO
       AND r.TIPODOCUMENTO = h.TIPODOCUMENTO
      WHERE h.TIPODOCUMENTO = '01'
        AND h.SERIENUMERO LIKE 'FF03-%'
        AND NULLIF(LTRIM(RTRIM(h.codigoDetraccion)), '') IS NOT NULL
        AND (
          r.bl_estadoProceso LIKE '%AC_03%'
          OR r.bl_mensajeSunat LIKE '%"codigo":"0"%'
          OR r.bl_mensajeSunat LIKE '%aceptad%'
        )
      GROUP BY h.tipoMoneda, h.tipoOperacion, h.codigoDetraccion, h.porcentajeDetraccion
      ORDER BY h.codigoDetraccion, h.tipoMoneda;

      SELECT
        a.SERIENUMERO,
        a.clave,
        a.valor
      FROM dbo.SPE_EINVOICEHEADER_ADD a
      WHERE a.SERIENUMERO IN (
        SELECT TOP (12) h.SERIENUMERO
        FROM dbo.SPE_EINVOICEHEADER h
        INNER JOIN dbo.SPE_EINVOICE_RESPONSE r
          ON r.NUMERODOCUMENTOEMISOR = h.NUMERODOCUMENTOEMISOR
         AND r.SERIENUMERO = h.SERIENUMERO
         AND r.TIPODOCUMENTO = h.TIPODOCUMENTO
        WHERE h.TIPODOCUMENTO = '01'
          AND h.SERIENUMERO LIKE 'FF03-%'
          AND NULLIF(LTRIM(RTRIM(h.codigoDetraccion)), '') IS NOT NULL
          AND (
            r.bl_estadoProceso LIKE '%AC_03%'
            OR r.bl_mensajeSunat LIKE '%"codigo":"0"%'
            OR r.bl_mensajeSunat LIKE '%aceptad%'
          )
        ORDER BY h.FECHAEMISION DESC, h.SERIENUMERO DESC
      )
      ORDER BY a.SERIENUMERO, a.clave;

      SELECT
        o.name,
        OBJECT_DEFINITION(o.object_id) AS definition
      FROM sys.objects o
      WHERE o.type = 'P'
        AND o.name IN ('USP_CabeceraFE', 'USP_DetalleFE', 'USP_EnviaDocumentoFE');
    `);

    const cases = biz.recordsets[0] as BizCase[];
    const serieParams: string[] = [];
    const ychiRequest = new sql.Request(ychiPool);
    cases.forEach((item, index) => {
      const eight = item.SERIENUMERO.replace(/^FF03-/, '');
      const seven = eight.slice(-7);
      ychiRequest.input(`doc${index}a`, sql.VarChar(20), eight);
      ychiRequest.input(`doc${index}b`, sql.VarChar(20), seven);
      serieParams.push(`@doc${index}a`, `@doc${index}b`);
    });

    const legacy = serieParams.length > 0
      ? await ychiRequest.query<Row>(`
          SET TRANSACTION ISOLATION LEVEL READ UNCOMMITTED;
          SET NOCOUNT ON;

          SELECT *
          FROM dbo.tbDocumentos
          WHERE idTipoDocu = 38
            AND SeriDocu = 'F03'
            AND NumeDocu IN (${serieParams.join(', ')})
          ORDER BY idDocumento DESC;

          SELECT c.*
          FROM dbo.TBCTACTE c
          INNER JOIN dbo.tbDocumentos d
            ON d.idDocumento = c.idDocumento
            OR d.idDocumento = c.idDocAfectado
          WHERE d.idTipoDocu = 38
            AND d.SeriDocu = 'F03'
            AND d.NumeDocu IN (${serieParams.join(', ')})
          ORDER BY c.idDocumento DESC;

          SELECT df.*
          FROM dbo.tbDetFact df
          INNER JOIN dbo.tbDocumentos d
            ON d.idDocumento = df.idDocumento
          WHERE d.idTipoDocu = 38
            AND d.SeriDocu = 'F03'
            AND d.NumeDocu IN (${serieParams.join(', ')})
          ORDER BY df.idDocumento DESC, df.idDetFact;
        `)
      : { recordsets: [[], [], []] };

    console.log(JSON.stringify({
      safety: {
        mode: 'READ_ONLY',
        writesDatabase: false,
        proceduresExecuted: false
      },
      summary: biz.recordsets[1],
      bizlinksCases: cases,
      bizlinksAddFields: biz.recordsets[2],
      bizlinksProcedureDetractionSnippets: (biz.recordsets[3] as Row[]).map((row) => ({
        name: row.name,
        snippet: detractionSnippet(String(row.definition ?? ''))
      })),
      legacy: {
        tbDocumentos: compactRows(legacy.recordsets[0] as Row[]),
        TBCTACTE: compactRows(legacy.recordsets[1] as Row[]),
        tbDetFact: compactRows(legacy.recordsets[2] as Row[])
      }
    }, null, 2));
  } finally {
    await ychiPool.close();
    await bizlinksPool.close();
  }
}

function compactRows(rows: Row[]) {
  return rows.map((row) => {
    const compact: Row = {};
    for (const [key, value] of Object.entries(row)) {
      if (interesting.test(key)) compact[key] = value;
    }
    return compact;
  });
}

function detractionSnippet(text: string) {
  const upper = text.toUpperCase();
  const positions = ['DETRACCION', 'DETRAC', 'TIPOOPERACION', 'BANCONACION', 'MONTO'];
  const found = positions
    .map((needle) => upper.indexOf(needle))
    .filter((position) => position >= 0)
    .sort((a, b) => a - b)[0];
  if (found === undefined) return '';
  return text.slice(Math.max(0, found - 1200), found + 5000);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
