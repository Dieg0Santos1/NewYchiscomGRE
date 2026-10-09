import { loadEnv } from '../../src/config/env.js';
import { createGreFcPool, createYchiPool, sql } from '../../src/integrations/bizlinksSql.js';

const target = process.argv[2]?.trim() || '113041';
const reference = process.argv[3]?.trim() || '113008';

async function main() {
  const config = loadEnv();
  const pool = createYchiPool(config);
  const grePool = createGreFcPool(config);
  await pool.connect();
  await grePool.connect();

  try {
    const request = new sql.Request(pool);
    request.input('target', sql.VarChar(20), target);
    request.input('reference', sql.VarChar(20), reference);
    const result = await request.query(`
      SET TRANSACTION ISOLATION LEVEL READ UNCOMMITTED;

      SELECT TOP (20) *
      FROM dbo.tbDocumentos
      WHERE idTipoDocu = 8
        AND SeriDocu = '001'
        AND (NumeDocu IN (@target, @reference)
          OR RIGHT(REPLICATE('0', 20) + LTRIM(RTRIM(NumeDocu)), 6) IN (
            RIGHT(REPLICATE('0', 20) + @target, 6),
            RIGHT(REPLICATE('0', 20) + @reference, 6)
          ))
      ORDER BY idDocumento DESC;

      SELECT d.idDocumento, d.SeriDocu, d.NumeDocu, d.DescClieProv,
        dg.*, r.EstadoOT, r.EstadoGuia, r.EstadoFactura, ot.numero AS numeroOt
      FROM dbo.tbDocumentos d
      INNER JOIN dbo.tbDetGuias dg ON dg.idDocumentos = d.idDocumento
      LEFT JOIN dbo.tbRecepcionOT r ON r.idRecepcionOT = dg.idRecepcionOT
      LEFT JOIN dbo.tbOrdenTrabajo ot ON ot.idOrdenTrabajo = r.idOT
      WHERE d.idTipoDocu = 8
        AND d.SeriDocu = '001'
        AND (d.NumeDocu IN (@target, @reference)
          OR RIGHT(REPLICATE('0', 20) + LTRIM(RTRIM(d.NumeDocu)), 6) IN (
            RIGHT(REPLICATE('0', 20) + @target, 6),
            RIGHT(REPLICATE('0', 20) + @reference, 6)
          ))
      ORDER BY d.NumeDocu, dg.idDetGuia;

      SELECT g.*
      FROM dbo.tbGuias g
      WHERE g.idGuia IN (
        SELECT DISTINCT dg.idGuia
        FROM dbo.tbDetGuias dg
        INNER JOIN dbo.tbDocumentos d ON d.idDocumento = dg.idDocumentos
        WHERE d.idTipoDocu = 8
          AND d.SeriDocu = '001'
          AND (d.NumeDocu IN (@target, @reference)
            OR RIGHT(REPLICATE('0', 20) + LTRIM(RTRIM(d.NumeDocu)), 6) IN (
              RIGHT(REPLICATE('0', 20) + @target, 6),
              RIGHT(REPLICATE('0', 20) + @reference, 6)
            ))
      );

      SELECT COLUMN_NAME, DATA_TYPE, CHARACTER_MAXIMUM_LENGTH
      FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = 'dbo'
        AND TABLE_NAME = 'tbGuiasFactura'
      ORDER BY ORDINAL_POSITION;

      SELECT o.name, o.type_desc,
        CASE WHEN m.definition LIKE '%tbGuiasFactura%' THEN 1 ELSE 0 END AS usaTbGuiasFactura
      FROM sys.objects o
      INNER JOIN sys.sql_modules m ON m.object_id = o.object_id
      WHERE m.definition LIKE '%tbGuiasFactura%'
         OR o.name IN ('SPI_GUIA_REMISION44_YP', 'GRE_WEB_CREAR_GUIA_INTERNA_FC')
      ORDER BY o.name;

      SELECT idTipoDocu, serie, numero
      FROM dbo.tbTipoDocu
      WHERE idTipoDocu = 8 AND serie = '001';

      SELECT TABLE_NAME, COLUMN_NAME, DATA_TYPE
      FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = 'dbo'
        AND TABLE_NAME IN ('tbProductos', 'VW_PRODUCTOS_PARAVENTA', 'VW_PRODUCTOS', 'VW_PRODUCTOS_TODOS')
      ORDER BY TABLE_NAME, ORDINAL_POSITION;

      SELECT d.SeriDocu, d.NumeDocu, d.DescClieProv,
        dg.*, g.fecha AS fechaGuia
      FROM dbo.tbDetGuias dg
      LEFT JOIN dbo.tbDocumentos d ON d.idDocumento = dg.idDocumentos
      LEFT JOIN dbo.tbGuias g ON g.IdGuia = dg.idGuia
      WHERE dg.idDetGuia = 880231;

      SELECT o.name, m.definition
      FROM sys.objects o
      INNER JOIN sys.sql_modules m ON m.object_id = o.object_id
      WHERE o.name IN ('SPI_GUIA_REMISION44_YP', 'SPI_DETGUIA_REMISION');
    `);

    const greTrace = await new sql.Request(grePool)
      .input('greSerie', sql.VarChar(20), 'T001-00000104')
      .input('physicalTarget', sql.VarChar(30), `%${target}%`)
      .query(`
        SELECT *
        FROM dbo.GRE_FC_OPERACION o
        WHERE o.numeroGuiaFisica LIKE @physicalTarget
           OR EXISTS (
             SELECT 1 FROM dbo.GRE_FC_ENVIO e
             WHERE e.operacionId = o.id AND e.serieNumeroGuia = @greSerie
           )
        ORDER BY id DESC;

        SELECT d.*
        FROM dbo.GRE_FC_DETALLE d
        INNER JOIN dbo.GRE_FC_OPERACION o ON o.id = d.operacionId
        WHERE o.numeroGuiaFisica LIKE @physicalTarget
           OR EXISTS (
             SELECT 1 FROM dbo.GRE_FC_ENVIO e
             WHERE e.operacionId = o.id AND e.serieNumeroGuia = @greSerie
           )
        ORDER BY d.id;

        SELECT e.*
        FROM dbo.GRE_FC_ENVIO e
        INNER JOIN dbo.GRE_FC_OPERACION o ON o.id = e.operacionId
        WHERE e.serieNumeroGuia = @greSerie
           OR o.numeroGuiaFisica LIKE @physicalTarget
        ORDER BY e.id;
      `);

    console.log(JSON.stringify({
      safety: 'READ_ONLY',
      target,
      reference,
      documents: result.recordsets[0],
      details: result.recordsets[1],
      guides: result.recordsets[2],
      guideInvoiceColumns: result.recordsets[3],
      relatedObjects: result.recordsets[4],
      correlative: result.recordsets[5],
      productMetadata: result.recordsets[6],
      sourceDetail880231: result.recordsets[7],
      legacyProcedureDefinitions: result.recordsets[8],
      guideInvoiceRows: 'SELECT permission required on dbo.tbGuiasFactura',
      greOperations: greTrace.recordsets[0],
      greDetails: greTrace.recordsets[1],
      greSends: greTrace.recordsets[2]
    }, null, 2));
  } finally {
    await grePool.close();
    await pool.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
