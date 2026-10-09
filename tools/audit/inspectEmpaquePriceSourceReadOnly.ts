import { loadEnv } from '../../src/config/env.js';
import { createBizlinksPool, createYchiPool, sql } from '../../src/integrations/bizlinksSql.js';

const codigoEmpaque = Number(process.argv[2] ?? 13444);
const codigoProducto = String(process.argv[3] ?? '00480-0073').trim();

function printSection(title: string, value: unknown) {
  console.log(`\n=== ${title} ===`);
  console.log(JSON.stringify(value, null, 2));
}

async function main() {
  const config = loadEnv();
  const bizlinks = createBizlinksPool(config);
  const ychi = createYchiPool(config);
  await bizlinks.connect();
  await ychi.connect();

  try {
    const detail = await new sql.Request(bizlinks)
      .input('codigoEmpaque', sql.Int, codigoEmpaque)
      .input('codigoProducto', sql.VarChar(50), codigoProducto)
      .query(`
        SET TRANSACTION ISOLATION LEVEL READ UNCOMMITTED;
        SELECT *
        FROM dbo.EMPAQUE_DETALLE
        WHERE CODIGOEMPAQUE = @codigoEmpaque
          AND CODIGOPRODUCTO = @codigoProducto;
      `);

    const header = await new sql.Request(bizlinks)
      .input('codigoEmpaque', sql.Int, codigoEmpaque)
      .query(`
        SET TRANSACTION ISOLATION LEVEL READ UNCOMMITTED;
        SELECT *
        FROM dbo.EMPAQUE
        WHERE CODIGOEMPAQUE = @codigoEmpaque;
      `);

    const allPackDetails = await new sql.Request(bizlinks)
      .input('codigoEmpaque', sql.Int, codigoEmpaque)
      .query(`
        SET TRANSACTION ISOLATION LEVEL READ UNCOMMITTED;
        SELECT CODIGOEMPAQUE, CODIGOPRODUCTO, DESCRIPCION, CANTIDAD,
          UNIDADMEDIDA, MONEDA, TIPOCAMBIO, IMPORTEUNITARIOSINIMPUESTO,
          SERIENUMEROGUIAREMISION, ORDENGUIA, SERIENUMEROGUIAFACTURA,
          ORDENFACTURA
        FROM dbo.EMPAQUE_DETALLE
        WHERE CODIGOEMPAQUE = @codigoEmpaque
        ORDER BY CODIGOPRODUCTO;
      `);

    const detailColumns = await new sql.Request(bizlinks).query(`
      SELECT COLUMN_NAME, DATA_TYPE, CHARACTER_MAXIMUM_LENGTH,
        NUMERIC_PRECISION, NUMERIC_SCALE
      FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_NAME = 'EMPAQUE_DETALLE'
      ORDER BY ORDINAL_POSITION;
    `);

    const bizProcedures = await new sql.Request(bizlinks)
      .input('codigoProducto', sql.VarChar(50), codigoProducto)
      .query(`
        SET TRANSACTION ISOLATION LEVEL READ UNCOMMITTED;
        SELECT TOP (80)
          SCHEMA_NAME(o.schema_id) AS schemaName,
          o.name,
          o.type_desc,
          CASE WHEN m.definition LIKE '%IMPORTEUNITARIOSINIMPUESTO%' THEN 1 ELSE 0 END AS usaImporteUnitario,
          CASE WHEN m.definition LIKE '%EMPAQUE_DETALLE%' THEN 1 ELSE 0 END AS usaEmpaqueDetalle,
          LEFT(REPLACE(REPLACE(m.definition, CHAR(13), ' '), CHAR(10), ' '), 1500) AS definitionPreview
        FROM sys.objects o
        INNER JOIN sys.sql_modules m ON m.object_id = o.object_id
        WHERE m.definition LIKE '%EMPAQUE_DETALLE%'
          AND (
            m.definition LIKE '%IMPORTEUNITARIOSINIMPUESTO%'
            OR m.definition LIKE '%CODIGOEMPAQUE%'
            OR m.definition LIKE '%CODIGOPRODUCTO%'
          )
        ORDER BY usaImporteUnitario DESC, o.name;
      `).catch((error: unknown) => ({ recordset: [{ error: error instanceof Error ? error.message : String(error) }] }));

    const ychiProcedures = await new sql.Request(ychi).query(`
      SET TRANSACTION ISOLATION LEVEL READ UNCOMMITTED;
      SELECT TOP (80)
        SCHEMA_NAME(o.schema_id) AS schemaName,
        o.name,
        o.type_desc,
        CASE WHEN m.definition LIKE '%PRECIO%' THEN 1 ELSE 0 END AS usaPrecio,
        CASE WHEN m.definition LIKE '%tbDetFact%' THEN 1 ELSE 0 END AS usaTbDetFact,
        CASE WHEN m.definition LIKE '%tbProductos%' THEN 1 ELSE 0 END AS usaTbProductos,
        LEFT(REPLACE(REPLACE(m.definition, CHAR(13), ' '), CHAR(10), ' '), 1500) AS definitionPreview
      FROM sys.objects o
      INNER JOIN sys.sql_modules m ON m.object_id = o.object_id
      WHERE (
        m.definition LIKE '%tbDetFact%'
        OR m.definition LIKE '%tbProductos%'
        OR m.definition LIKE '%PRECIO%'
      )
        AND (
          o.name LIKE '%VENTA%'
          OR o.name LIKE '%FACT%'
          OR o.name LIKE '%COT%'
          OR o.name LIKE '%PRECIO%'
          OR o.name LIKE '%ORDEN%'
        )
      ORDER BY usaTbDetFact DESC, usaPrecio DESC, o.name;
    `).catch((error: unknown) => ({ recordset: [{ error: error instanceof Error ? error.message : String(error) }] }));

    const ychiProductColumns = await new sql.Request(ychi).query(`
      SELECT COLUMN_NAME, DATA_TYPE
      FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_NAME IN ('tbProductos', 'tbDetOrdenVenta', 'tbOrdenVenta', 'tbCotizacion', 'tbDetCotizacion')
      ORDER BY TABLE_NAME, ORDINAL_POSITION;
    `).catch((error: unknown) => ({ recordset: [{ error: error instanceof Error ? error.message : String(error) }] }));

    printSection('Parametros', { codigoEmpaque, codigoProducto, mode: 'READ_ONLY' });
    printSection('BIZLINKS EMPAQUE_DETALLE objetivo', detail.recordset);
    printSection('BIZLINKS EMPAQUE cabecera', header.recordset);
    printSection('BIZLINKS todos los detalles del empaque', allPackDetails.recordset);
    printSection('BIZLINKS columnas EMPAQUE_DETALLE', detailColumns.recordset);
    printSection('BIZLINKS procedimientos que leen EMPAQUE_DETALLE', bizProcedures.recordset);
    printSection('YCHIDB3 procedimientos/candidatos de ventas/precios', ychiProcedures.recordset);
    printSection('YCHIDB3 columnas candidatas', ychiProductColumns.recordset);
  } finally {
    await ychi.close();
    await bizlinks.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
