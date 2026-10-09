import { loadEnv } from '../../src/config/env.js';
import { createBizlinksPool, sql } from '../../src/integrations/bizlinksSql.js';

type PendingGuideCurrencyRow = {
  monedaRaw: string | null;
  monedaNormalizada: 'PEN' | 'USD' | 'SIN_MONEDA' | 'OTRA';
  serieNumeroGuia: string;
  fechaEmisionGuia: Date | string | null;
  numeroDocumentoDestinatario: string;
  razonSocialDestinatario: string;
  items: number;
  empaques: number;
};

async function main() {
  const config = loadEnv();
  const pool = createBizlinksPool(config);
  await pool.connect();

  try {
    const distinct = await new sql.Request(pool).query<{
      scope: string;
      monedaRaw: string | null;
      total: number;
      exampleGuide: string | null;
      exampleClient: string | null;
    }>(`
      WITH accepted AS (
        SELECT DISTINCT
          d.serieNumeroGuia,
          d.numeroDocumentoDestinatario,
          d.razonSocialDestinatario
        FROM dbo.SPE_DESPATCH d
        INNER JOIN dbo.SPE_DESPATCH_RESPONSE r
          ON r.tipoDocumentoRemitente = d.tipoDocumentoRemitente
         AND r.numeroDocumentoRemitente = d.numeroDocumentoRemitente
         AND r.serieNumeroGuia = d.serieNumeroGuia
         AND r.tipoDocumentoGuia = d.tipoDocumentoGuia
        WHERE d.tipoDocumentoGuia = '09'
          AND (d.serieNumeroGuia LIKE 'T003-%' OR d.serieNumeroGuia LIKE 'T999-%')
          AND (
            r.bl_estadoProceso LIKE '%AC_03%'
            OR r.bl_mensajeSunat LIKE '%"codigo":"0"%'
            OR r.bl_mensajeSunat LIKE '%aceptad%'
          )
      )
      SELECT
        CASE WHEN gf.NRO_GUIA IS NULL THEN 'ACEPTADA_PENDIENTE' ELSE 'ACEPTADA_HISTORICA' END AS scope,
        NULLIF(LTRIM(RTRIM(ed.MONEDA)), '') AS monedaRaw,
        COUNT(DISTINCT accepted.serieNumeroGuia) AS total,
        MAX(accepted.serieNumeroGuia) AS exampleGuide,
        MAX(CONCAT(accepted.numeroDocumentoDestinatario, ' - ', accepted.razonSocialDestinatario)) AS exampleClient
      FROM accepted
      INNER JOIN dbo.EMPAQUE_DETALLE ed
        ON ed.SERIENUMEROGUIAREMISION = accepted.serieNumeroGuia
      LEFT JOIN dbo.AAA_GUIAFACTURADA gf
        ON gf.NRO_GUIA = accepted.serieNumeroGuia
      GROUP BY
        CASE WHEN gf.NRO_GUIA IS NULL THEN 'ACEPTADA_PENDIENTE' ELSE 'ACEPTADA_HISTORICA' END,
        NULLIF(LTRIM(RTRIM(ed.MONEDA)), '')
      ORDER BY scope, monedaRaw;
    `);

    console.log('\nResumen de MONEDA cruda en EMPAQUE_DETALLE');
    console.table(distinct.recordset);

    const result = await new sql.Request(pool).query<PendingGuideCurrencyRow>(`
      WITH guide_currency AS (
        SELECT
          d.serieNumeroGuia,
          MAX(d.fechaEmisionGuia) AS fechaEmisionGuia,
          d.numeroDocumentoDestinatario,
          d.razonSocialDestinatario,
          MAX(NULLIF(LTRIM(RTRIM(ed.MONEDA)), '')) AS monedaRaw,
          COUNT(DISTINCT CONCAT(i.serieNumeroGuia, '|', i.numeroOrdenItem, '|', i.codigo)) AS items,
          COUNT(DISTINCT ed.CODIGOEMPAQUE) AS empaques
        FROM dbo.SPE_DESPATCH d
        INNER JOIN dbo.SPE_DESPATCH_ITEM i
          ON i.tipoDocumentoRemitente = d.tipoDocumentoRemitente
         AND i.numeroDocumentoRemitente = d.numeroDocumentoRemitente
         AND i.serieNumeroGuia = d.serieNumeroGuia
         AND i.tipoDocumentoGuia = d.tipoDocumentoGuia
        INNER JOIN dbo.SPE_DESPATCH_RESPONSE r
          ON r.tipoDocumentoRemitente = d.tipoDocumentoRemitente
         AND r.numeroDocumentoRemitente = d.numeroDocumentoRemitente
         AND r.serieNumeroGuia = d.serieNumeroGuia
         AND r.tipoDocumentoGuia = d.tipoDocumentoGuia
        OUTER APPLY (
          SELECT TOP (1)
            detalle.MONEDA,
            detalle.CODIGOEMPAQUE
          FROM dbo.EMPAQUE_DETALLE detalle
          WHERE detalle.SERIENUMEROGUIAREMISION = d.serieNumeroGuia
            AND (
              detalle.ORDENGUIA = i.numeroOrdenItem
              OR detalle.CODIGOPRODUCTO = i.codigo
            )
          ORDER BY
            CASE WHEN detalle.ORDENGUIA = i.numeroOrdenItem THEN 0 ELSE 1 END,
            detalle.CODIGOEMPAQUE
        ) ed
        LEFT JOIN dbo.AAA_GUIAFACTURADA gf
          ON gf.NRO_GUIA = d.serieNumeroGuia
        WHERE d.tipoDocumentoGuia = '09'
          AND (d.serieNumeroGuia LIKE 'T003-%' OR d.serieNumeroGuia LIKE 'T999-%')
          AND gf.NRO_GUIA IS NULL
          AND (
            r.bl_estadoProceso LIKE '%AC_03%'
            OR r.bl_mensajeSunat LIKE '%"codigo":"0"%'
            OR r.bl_mensajeSunat LIKE '%aceptad%'
          )
        GROUP BY
          d.serieNumeroGuia,
          d.numeroDocumentoDestinatario,
          d.razonSocialDestinatario
      ),
      ranked AS (
        SELECT
          monedaRaw,
          CASE
            WHEN monedaRaw IS NULL THEN 'SIN_MONEDA'
            WHEN UPPER(monedaRaw) IN ('USD', 'D', '$', 'DOLAR', 'DOLARES', '-100') THEN 'USD'
            WHEN UPPER(monedaRaw) IN ('PEN', 'S', 'S/', 'S/.', 'SOL', 'SOLES', '1', '1.000') THEN 'PEN'
            ELSE 'OTRA'
          END AS monedaNormalizada,
          serieNumeroGuia,
          fechaEmisionGuia,
          numeroDocumentoDestinatario,
          razonSocialDestinatario,
          items,
          empaques,
          ROW_NUMBER() OVER (
            PARTITION BY CASE
              WHEN monedaRaw IS NULL THEN 'SIN_MONEDA'
              WHEN UPPER(monedaRaw) IN ('USD', 'D', '$', 'DOLAR', 'DOLARES', '-100') THEN 'USD'
              WHEN UPPER(monedaRaw) IN ('PEN', 'S', 'S/', 'S/.', 'SOL', 'SOLES', '1', '1.000') THEN 'PEN'
              ELSE 'OTRA'
            END
            ORDER BY fechaEmisionGuia DESC, serieNumeroGuia DESC
          ) AS rn
        FROM guide_currency
      )
      SELECT
        monedaRaw,
        monedaNormalizada,
        serieNumeroGuia,
        fechaEmisionGuia,
        numeroDocumentoDestinatario,
        razonSocialDestinatario,
        items,
        empaques
      FROM ranked
      WHERE rn <= 8
      ORDER BY
        CASE monedaNormalizada WHEN 'USD' THEN 1 WHEN 'PEN' THEN 2 WHEN 'SIN_MONEDA' THEN 3 ELSE 4 END,
        fechaEmisionGuia DESC,
        serieNumeroGuia DESC;
    `);

    console.table(result.recordset.map((row) => ({
      moneda: row.monedaNormalizada,
      monedaRaw: row.monedaRaw,
      guia: row.serieNumeroGuia,
      fecha: row.fechaEmisionGuia ? new Date(row.fechaEmisionGuia).toISOString().slice(0, 10) : null,
      ruc: row.numeroDocumentoDestinatario,
      cliente: row.razonSocialDestinatario,
      items: row.items,
      empaques: row.empaques
    })));
  } finally {
    await pool.close();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
