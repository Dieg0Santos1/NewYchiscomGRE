import { loadEnv } from '../../src/config/env.js';
import { createBizlinksPool, sql } from '../../src/integrations/bizlinksSql.js';

async function main() {
  const pool = createBizlinksPool(loadEnv());
  await pool.connect();

  try {
    const result = await new sql.Request(pool).query(`
      WITH guide_currency AS (
        SELECT
          d.SERIENUMEROGUIAREMISION AS guia,
          COUNT(DISTINCT NULLIF(LTRIM(RTRIM(d.MONEDA)), '')) AS monedasDistintas,
          MIN(NULLIF(LTRIM(RTRIM(d.MONEDA)), '')) AS monedaMin,
          MAX(NULLIF(LTRIM(RTRIM(d.MONEDA)), '')) AS monedaMax,
          COUNT(*) AS items
        FROM dbo.EMPAQUE_DETALLE d
        WHERE d.SERIENUMEROGUIAREMISION IS NOT NULL
          AND LTRIM(RTRIM(d.SERIENUMEROGUIAREMISION)) <> ''
          AND (d.SERIENUMEROGUIAREMISION LIKE 'T003-%' OR d.SERIENUMEROGUIAREMISION LIKE 'T999-%')
        GROUP BY d.SERIENUMEROGUIAREMISION
      )
      SELECT TOP (20)
        guia,
        monedasDistintas,
        monedaMin,
        monedaMax,
        items
      FROM guide_currency
      WHERE monedasDistintas > 1
      ORDER BY items DESC, guia DESC;

      WITH guide_currency AS (
        SELECT
          d.SERIENUMEROGUIAREMISION AS guia,
          COUNT(DISTINCT NULLIF(LTRIM(RTRIM(d.MONEDA)), '')) AS monedasDistintas
        FROM dbo.EMPAQUE_DETALLE d
        WHERE d.SERIENUMEROGUIAREMISION IS NOT NULL
          AND LTRIM(RTRIM(d.SERIENUMEROGUIAREMISION)) <> ''
          AND (d.SERIENUMEROGUIAREMISION LIKE 'T003-%' OR d.SERIENUMEROGUIAREMISION LIKE 'T999-%')
        GROUP BY d.SERIENUMEROGUIAREMISION
      )
      SELECT
        SUM(CASE WHEN monedasDistintas > 1 THEN 1 ELSE 0 END) AS guiasMixtas,
        SUM(CASE WHEN monedasDistintas = 1 THEN 1 ELSE 0 END) AS guiasUnaMoneda,
        SUM(CASE WHEN monedasDistintas = 0 THEN 1 ELSE 0 END) AS guiasSinMoneda,
        COUNT(1) AS guiasRevisadas
      FROM guide_currency;
    `);

    console.log('Guias con mas de una moneda:');
    console.table(result.recordsets[0]);
    console.log('Resumen:');
    console.table(result.recordsets[1]);
  } finally {
    await pool.close();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
