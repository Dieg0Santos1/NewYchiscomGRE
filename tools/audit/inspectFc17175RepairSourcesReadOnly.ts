import { loadEnv } from '../../src/config/env.js';
import { createBizlinksPool, createGreFcPool, createYchiPool, sql } from '../../src/integrations/bizlinksSql.js';

function printSection(title: string, value: unknown) {
  console.log(`\n=== ${title} ===`);
  console.log(JSON.stringify(value, null, 2));
}

async function main() {
  const config = loadEnv();
  const bizlinks = createBizlinksPool(config);
  const greFc = createGreFcPool(config);
  const ychi = createYchiPool(config);
  await bizlinks.connect();
  await greFc.connect();
  await ychi.connect();

  try {
    const bizDetail = await new sql.Request(bizlinks).query(`
      SET TRANSACTION ISOLATION LEVEL READ UNCOMMITTED;
      SELECT SERIENUMERO, numeroOrdenItem, descripcion, cantidad,
        unidadMedida, importeUnitarioSinImpuesto,
        importeTotalSinImpuesto, importeUnitarioConImpuesto,
        importeReferencial, importeIGV
      FROM dbo.SPE_EINVOICEDETAIL
      WHERE SERIENUMERO IN ('FF01-00017175', 'FF01-00017176')
        AND TIPODOCUMENTO = '01'
      ORDER BY SERIENUMERO, numeroOrdenItem;
    `);

    const localDetail = await new sql.Request(greFc).query(`
      SET TRANSACTION ISOLATION LEVEL READ UNCOMMITTED;
      SELECT o.serieNumeroFactura, o.id AS operacionId, d.*
      FROM dbo.FC_FACT_OPERACION o
      LEFT JOIN dbo.FC_FACT_DETALLE d ON d.operacionId = o.id
      WHERE o.serieNumeroFactura IN ('FF01-00017175', 'FF01-00017176')
      ORDER BY o.serieNumeroFactura, d.id;
    `);

    const guiaRel = await new sql.Request(greFc).query(`
      SET TRANSACTION ISOLATION LEVEL READ UNCOMMITTED;
      SELECT o.serieNumeroFactura, g.*, go.idDocumentoYchiscom,
        go.numeroGuiaFisica, go.idGuiaFisicaYchiscom
      FROM dbo.FC_FACT_OPERACION o
      LEFT JOIN dbo.FC_FACT_GUIA g ON g.operacionId = o.id
      LEFT JOIN dbo.GRE_FC_ENVIO ge
        ON ge.serieNumeroGuia COLLATE SQL_Latin1_General_CP1_CI_AS
         = g.serieNumeroGuia COLLATE SQL_Latin1_General_CP1_CI_AS
      LEFT JOIN dbo.GRE_FC_OPERACION go ON go.id = ge.operacionId
      WHERE o.serieNumeroFactura IN ('FF01-00017175', 'FF01-00017176')
      ORDER BY o.serieNumeroFactura, g.serieNumeroGuia;
    `);

    const ychiColumns = await new sql.Request(ychi).query(`
      SELECT TABLE_NAME, COLUMN_NAME, DATA_TYPE, CHARACTER_MAXIMUM_LENGTH,
        NUMERIC_PRECISION, NUMERIC_SCALE, IS_NULLABLE, COLUMN_DEFAULT
      FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_NAME IN ('tbDetFact', 'TBCTACTE', 'tbDocumentos_Y')
      ORDER BY TABLE_NAME, ORDINAL_POSITION;
    `);

    const ychiProductColumns = await new sql.Request(ychi).query(`
      SELECT COLUMN_NAME, DATA_TYPE
      FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_NAME = 'tbProductos'
      ORDER BY ORDINAL_POSITION;
    `).catch((error: unknown) => ({ recordset: [{ error: error instanceof Error ? error.message : String(error) }] }));

    const guideDetails = await new sql.Request(ychi).query(`
      SET TRANSACTION ISOLATION LEVEL READ UNCOMMITTED;
      SELECT d.idDocumento, d.idTipoDocu, d.SeriDocu, d.NumeDocu,
        df.*
      FROM dbo.tbDocumentos d
      LEFT JOIN dbo.tbDetFact df ON df.idDocumento = d.idDocumento
      WHERE d.idDocumento IN (326147, 326150)
      ORDER BY d.idDocumento, df.idDetFact;
    `).catch((error: unknown) => ({ recordset: [{ error: error instanceof Error ? error.message : String(error) }] }));

    const legacyProducts = await new sql.Request(ychi).query(`
      SET TRANSACTION ISOLATION LEVEL READ UNCOMMITTED;
      SELECT idProducto, Nombre, IDUNIDAD, Estado
      FROM dbo.tbProductos
      WHERE idProducto IN (2198, 3724)
      ORDER BY idProducto;
    `).catch((error: unknown) => ({ recordset: [{ error: error instanceof Error ? error.message : String(error) }] }));

    const legacyUnits = await new sql.Request(ychi).query(`
      SET TRANSACTION ISOLATION LEVEL READ UNCOMMITTED;
      SELECT *
      FROM dbo.tbUnidades
      WHERE idUnidad IN (10, 27)
      ORDER BY idUnidad;
    `).catch((error: unknown) => ({ recordset: [{ error: error instanceof Error ? error.message : String(error) }] }));

    printSection('Bizlinks SPE_EINVOICEDETAIL', bizDetail.recordset);
    printSection('GRE_FORMULARIOS_TEST FC_FACT_DETALLE', localDetail.recordset);
    printSection('Relacion guia', guiaRel.recordset);
    printSection('Columnas YCHIDB3 destino', ychiColumns.recordset);
    printSection('Columnas tbProductos', ychiProductColumns.recordset);
    printSection('Detalle de guias base legacy', guideDetails.recordset);
    printSection('Productos legacy usados por vecinas', legacyProducts.recordset);
    printSection('Unidades legacy usadas por vecinas', legacyUnits.recordset);
  } finally {
    await ychi.close();
    await greFc.close();
    await bizlinks.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
