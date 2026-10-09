import { loadEnv } from '../../src/config/env.js';
import { createBizlinksPool, createYchiPool, sql } from '../../src/integrations/bizlinksSql.js';

async function main() {
  const config = loadEnv();
  const bizlinks = createBizlinksPool(config);
  const ychi = createYchiPool(config);
  await bizlinks.connect();
  await ychi.connect();

  try {
    const [catalog, legacyDocuments] = await Promise.all([
      new sql.Request(bizlinks).query(`
        SET TRANSACTION ISOLATION LEVEL READ UNCOMMITTED;
        SELECT NUMERODOCUMENTOEMISOR, TIPODOCUMENTO, TIPODOCUMENTOAFECTO,
          DESCRIPCION, SERIE, CORRELATIVO
        FROM dbo.AAA_TIPODOCUMENTO
        ORDER BY SERIE;
      `),
      new sql.Request(ychi).query(`
        SET TRANSACTION ISOLATION LEVEL READ UNCOMMITTED;
        SELECT TOP (20) *
        FROM dbo.tbDocumentos
        WHERE SeriDocu IN ('F01', 'FF01')
          AND (
            CONVERT(varchar(40), NumeDocu) LIKE '%17173%'
            OR CONVERT(varchar(40), NumeDocu) LIKE '%17174%'
          );
      `).catch((error: unknown) => ({
        recordset: [{ error: error instanceof Error ? error.message : String(error) }]
      }))
    ]);

    console.log(JSON.stringify({
      safety: 'READ_ONLY',
      aaaTipoDocumento: catalog.recordset,
      tbDocumentos17173_17174: legacyDocuments.recordset
    }, null, 2));
  } finally {
    await ychi.close();
    await bizlinks.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
