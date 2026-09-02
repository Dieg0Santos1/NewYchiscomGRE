import { loadEnv } from '../../src/config/env.js';
import { createGreFcPool, sql } from '../../src/integrations/bizlinksSql.js';

const operationId = process.argv[2]?.trim();

if (!operationId) {
  console.error('Uso: npx tsx tools/audit/checkFcFacturaOperation.ts <operationId>');
  process.exit(1);
}

async function main() {
  const pool = createGreFcPool(loadEnv());
  await pool.connect();

  try {
    const request = new sql.Request(pool);
    request.input('operationId', sql.UniqueIdentifier, operationId);
    const result = await request.query(`
      SELECT
        o.id,
        CONVERT(varchar(36), o.idOperacion) AS operationId,
        o.serieNumeroFactura,
        o.estado,
        o.creadoEn,
        o.actualizadoEn
      FROM dbo.FC_FACT_OPERACION o
      WHERE o.idOperacion = @operationId;

      SELECT
        e.id,
        e.estado,
        e.intentos,
        e.mensaje,
        e.respuestaJson,
        e.pdfUrl,
        e.creadoEn,
        e.actualizadoEn,
        e.insertadoBizlinksEn,
        e.enviadoBizlinksEn,
        e.respuestaBizlinksEn
      FROM dbo.FC_FACT_ENVIO e
      INNER JOIN dbo.FC_FACT_OPERACION o
        ON o.id = e.operacionId
      WHERE o.idOperacion = @operationId
      ORDER BY e.id DESC;

      SELECT TOP (20)
        ev.tipo,
        ev.mensaje,
        ev.datosJson,
        ev.creadoEn
      FROM dbo.FC_FACT_EVENTO ev
      INNER JOIN dbo.FC_FACT_OPERACION o
        ON o.id = ev.operacionId
      WHERE o.idOperacion = @operationId
      ORDER BY ev.id DESC;
    `);

    console.dir(result.recordsets, { depth: null, colors: false });
  } finally {
    await pool.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
