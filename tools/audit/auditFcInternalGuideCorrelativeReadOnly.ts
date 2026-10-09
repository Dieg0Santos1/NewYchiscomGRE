import { loadEnv } from '../../src/config/env.js';
import { createYchiPool, sql } from '../../src/integrations/bizlinksSql.js';
import { FcLegacyWorkflowService } from '../../src/services/fcLegacyWorkflowService.js';

function relevantDefinitionLines(definition: string | null) {
  return (definition ?? '')
    .split(/\r?\n/)
    .map((line, index) => ({ line: index + 1, text: line.trim() }))
    .filter(({ text }) => /tbTipoDocu|numero|NumeDocu|UPDATE/i.test(text));
}

async function main() {
  const config = loadEnv();
  const service = new FcLegacyWorkflowService(config);
  const pool = createYchiPool(config);
  await pool.connect();
  try {
    const [catalog, documents, procedures, portalNext] = await Promise.all([
      new sql.Request(pool).query(`
        SET TRANSACTION ISOLATION LEVEL READ UNCOMMITTED;
        SELECT *
        FROM dbo.tbTipoDocu
        WHERE idTipoDocu IN (8, 39)
          AND serie IN ('001', '003')
        ORDER BY idTipoDocu, serie;
      `),
      new sql.Request(pool).query(`
        SET TRANSACTION ISOLATION LEVEL READ UNCOMMITTED;
        SELECT TOP (12)
          idDocumento, idTipoDocu, SeriDocu, NumeDocu, FechaEmision,
          DescClieProv, idDocumentoAnterior
        FROM dbo.tbDocumentos
        WHERE (idTipoDocu = 8 AND SeriDocu = '001')
           OR (idTipoDocu = 39 AND SeriDocu = '003')
        ORDER BY idDocumento DESC;
      `),
      new sql.Request(pool).query<{ name: string; definition: string | null }>(`
        SELECT o.name, OBJECT_DEFINITION(o.object_id) AS definition
        FROM sys.objects o
        WHERE o.object_id IN (
          OBJECT_ID(N'dbo.SPI_GUIA_REMISION44_YP'),
          OBJECT_ID(N'dbo.SPI_GUIA_REMISION_Y_003'),
          OBJECT_ID(N'dbo.GRE_WEB_CREAR_GUIA_INTERNA_FC')
        )
        ORDER BY o.name;
      `),
      service.getNextInternalGuide('001')
    ]);

    console.log(JSON.stringify({
      safety: 'READ_ONLY',
      portalNext,
      legacyCatalog: catalog.recordset,
      recentPhysicalGuides: documents.recordset,
      correlativoProcedureLines: procedures.recordset.map((row) => ({
        procedure: row.name,
        lines: relevantDefinitionLines(row.definition)
      }))
    }, null, 2));
  } finally {
    await pool.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
