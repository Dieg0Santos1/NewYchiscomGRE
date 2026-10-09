import { loadEnv } from '../../src/config/env.js';
import { createYchiPool, sql } from '../../src/integrations/bizlinksSql.js';

function printSection(title: string, value: unknown) {
  console.log(`\n=== ${title} ===`);
  console.log(JSON.stringify(value, null, 2));
}

async function main() {
  const config = loadEnv();
  const ychi = createYchiPool(config);
  await ychi.connect();

  try {
    const docs = await new sql.Request(ychi).query(`
      SET TRANSACTION ISOLATION LEVEL READ UNCOMMITTED;
      SELECT
        idDocumento, idTipoDocu, SeriDocu, NumeDocu, FechaEmision,
        FechaCreacion, FechaVencimiento, Estado, EstaCotiza, EstadoRecotiz,
        idClieProv, DescClieProv, idEmpleado, idUsuario, formaPago,
        Encargado, Moneda, Tica, Neto, IGV, Total, Observaciones,
        idENV, idDocumentoAnterior, idTCOP, CORREO, cuenta, origen,
        negociable, web, intermediario, llevacomp, nguia
      FROM dbo.tbDocumentos
      WHERE idTipoDocu = 1
        AND SeriDocu = 'F01'
        AND NumeDocu BETWEEN '0017173' AND '0017180'
      ORDER BY NumeDocu;
    `);

    const targetIds = docs.recordset
      .filter((row: any) => ['0017175', '0017176'].includes(String(row.NumeDocu).trim()))
      .map((row: any) => Number(row.idDocumento))
      .filter((id: number) => Number.isFinite(id));

    const neighborIds = docs.recordset
      .filter((row: any) => ['0017174', '0017177', '0017178'].includes(String(row.NumeDocu).trim()))
      .map((row: any) => Number(row.idDocumento))
      .filter((id: number) => Number.isFinite(id));

    const ids = [...targetIds, ...neighborIds];
    const idList = ids.length > 0 ? ids.join(',') : '0';

    const detFact = await new sql.Request(ychi).query(`
      SET TRANSACTION ISOLATION LEVEL READ UNCOMMITTED;
      SELECT *
      FROM dbo.tbDetFact
      WHERE idDocumento IN (${idList})
      ORDER BY idDocumento, idDetFact;
    `).catch((error: unknown) => ({ recordset: [{ error: error instanceof Error ? error.message : String(error) }] }));

    const ctaCte = await new sql.Request(ychi).query(`
      SET TRANSACTION ISOLATION LEVEL READ UNCOMMITTED;
      SELECT *
      FROM dbo.TBCTACTE
      WHERE idDocumento IN (${idList}) OR idDocAfectado IN (${idList})
      ORDER BY idDocumento, idDocAfectado;
    `).catch((error: unknown) => ({ recordset: [{ error: error instanceof Error ? error.message : String(error) }] }));

    const docsY = await new sql.Request(ychi).query(`
      SET TRANSACTION ISOLATION LEVEL READ UNCOMMITTED;
      SELECT *
      FROM dbo.tbDocumentos_Y
      WHERE idDocumento IN (${idList})
      ORDER BY idDocumento;
    `).catch((error: unknown) => ({ recordset: [{ error: error instanceof Error ? error.message : String(error) }] }));

    const childCounts = await new sql.Request(ychi).query(`
      SET TRANSACTION ISOLATION LEVEL READ UNCOMMITTED;
      SELECT d.NumeDocu, d.idDocumento,
        (SELECT COUNT(1) FROM dbo.tbDetFact f WHERE f.idDocumento = d.idDocumento) AS tbDetFact,
        (SELECT COUNT(1) FROM dbo.TBCTACTE c WHERE c.idDocumento = d.idDocumento OR c.idDocAfectado = d.idDocumento) AS TBCTACTE,
        (SELECT COUNT(1) FROM dbo.tbDocumentos_Y y WHERE y.idDocumento = d.idDocumento) AS tbDocumentos_Y
      FROM dbo.tbDocumentos d
      WHERE d.idTipoDocu = 1
        AND d.SeriDocu = 'F01'
        AND d.NumeDocu BETWEEN '0017173' AND '0017180'
      ORDER BY d.NumeDocu;
    `);

    const procedures = await new sql.Request(ychi).query(`
      SET TRANSACTION ISOLATION LEVEL READ UNCOMMITTED;
      SELECT TOP (50)
        o.name,
        CASE WHEN m.definition LIKE '%tbDocumentos%' THEN 1 ELSE 0 END AS usesTbDocumentos,
        CASE WHEN m.definition LIKE '%tbDetFact%' THEN 1 ELSE 0 END AS usesTbDetFact,
        CASE WHEN m.definition LIKE '%TBCTACTE%' THEN 1 ELSE 0 END AS usesTbCtaCte,
        CASE WHEN m.definition LIKE '%tbDocumentos_Y%' THEN 1 ELSE 0 END AS usesTbDocumentosY,
        LEFT(REPLACE(REPLACE(m.definition, CHAR(13), ' '), CHAR(10), ' '), 1200) AS definitionPreview
      FROM sys.objects o
      INNER JOIN sys.sql_modules m ON m.object_id = o.object_id
      WHERE o.type IN ('P', 'V', 'FN', 'IF', 'TF')
        AND (
          o.name LIKE '%VENTA%'
          OR o.name LIKE '%COMISION%'
          OR o.name LIKE '%REGISTRO%'
          OR m.definition LIKE '%tbDetFact%'
          OR m.definition LIKE '%TBCTACTE%'
        )
        AND m.definition LIKE '%tbDocumentos%'
      ORDER BY
        CASE WHEN o.name LIKE '%COMISION%' THEN 0 ELSE 1 END,
        CASE WHEN o.name LIKE '%REGISTRO%' THEN 0 ELSE 1 END,
        o.name;
    `);

    printSection('Facturas F01 0017173-0017180', docs.recordset);
    printSection('Conteos hijos por factura', childCounts.recordset);
    printSection('tbDetFact objetivos y vecinas', detFact.recordset);
    printSection('TBCTACTE objetivos y vecinas', ctaCte.recordset);
    printSection('tbDocumentos_Y objetivos y vecinas', docsY.recordset);
    printSection('Procedimientos/reportes candidatos', procedures.recordset);
  } finally {
    await ychi.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
