import { loadEnv } from '../../src/config/env.js';
import type { ExistingGreClient } from '../../src/integrations/existingGreClient.js';
import { createYchiPool, sql } from '../../src/integrations/bizlinksSql.js';
import { FcLegacyWorkflowService } from '../../src/services/fcLegacyWorkflowService.js';
import { GreFormularioQueryService } from '../../src/services/greFormularioQueryService.js';

const config = loadEnv();
const fcService = new FcLegacyWorkflowService(config);
const noExternalFallback: ExistingGreClient = {
  declareGre: async () => { throw new Error('No disponible en auditoria read-only.'); },
  getDestinos: async () => []
};

const [workOrders, pending, ready] = await Promise.all([
  fcService.searchWorkOrders('OT02600674'),
  fcService.searchReceptions('', 'pending'),
  fcService.searchReceptions('', 'ready')
]);

console.log(JSON.stringify({
  workOrderSample: workOrders[0] ?? null,
  pendingReceptionCount: pending.length,
  readyReceptionCount: ready.length
}, null, 2));

const pool = createYchiPool(config);
await pool.connect();
try {
  const result = await new sql.Request(pool).query<{ serieNumero: string }>(`
    SET TRANSACTION ISOLATION LEVEL READ UNCOMMITTED;
    SELECT serieNumero
    FROM (
      SELECT TOP (1) SeriDocu + '-' + NumeDocu AS serieNumero, idDocumento
      FROM dbo.tbDocumentos d
      WHERE idTipoDocu = 8 AND SeriDocu = '001'
        AND EXISTS (SELECT 1 FROM dbo.VW_DETGUIA_REMISION v WHERE v.idDocumentos = d.idDocumento)
      ORDER BY idDocumento DESC
    ) g001
    UNION ALL
    SELECT serieNumero
    FROM (
      SELECT TOP (1) SeriDocu + '-' + NumeDocu AS serieNumero, idDocumento
      FROM dbo.tbDocumentos d
      WHERE idTipoDocu = 39 AND SeriDocu = '003'
        AND EXISTS (SELECT 1 FROM dbo.VW_DETGUIA_REMISION v WHERE v.idDocumentos = d.idDocumento)
      ORDER BY idDocumento DESC
    ) g003;
  `);

  const greQuery = new GreFormularioQueryService(config, noExternalFallback);
  for (const row of result.recordset) {
    const guide = await greQuery.searchByPhysicalGuide(row.serieNumero);
    console.log(JSON.stringify({
      searchedGuide: row.serieNumero,
      status: guide.status,
      trace: guide.documents[0]?.trazabilidadYchiscom ?? null,
      items: guide.documents[0]?.productos.length ?? 0
    }, null, 2));
  }
} finally {
  await pool.close();
}
