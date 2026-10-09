import { loadEnv } from '../../src/config/env.js';
import { createBizlinksPool, createYchiPool, sql } from '../../src/integrations/bizlinksSql.js';

const factura = process.argv[2]?.trim().toUpperCase() || 'FF03-00011208';

async function main() {
  const config = loadEnv();
  const bizlinks = createBizlinksPool(config);
  const ychi = createYchiPool(config);
  await bizlinks.connect();
  await ychi.connect();

  try {
    const biz = await new sql.Request(bizlinks)
      .input('factura', sql.VarChar(20), factura)
      .query(`
        SET TRANSACTION ISOLATION LEVEL READ UNCOMMITTED;

        SELECT COLUMN_NAME, DATA_TYPE
        FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_NAME = 'SPE_EINVOICEDETAIL'
        ORDER BY ORDINAL_POSITION;

        SELECT TOP (10) *
        FROM dbo.SPE_EINVOICEDETAIL
        WHERE SERIENUMERO = @factura
        ORDER BY NUMEROORDENITEM;

        SELECT TOP (1)
          h.SERIENUMERO,
          h.FECHAEMISION,
          h.NUMERODOCUMENTOADQUIRIENTE,
          h.RAZONSOCIALADQUIRIENTE,
          h.TIPOMONEDA,
          h.TOTALVALORVENTANETOOPGRAVADAS,
          h.TOTALIGV,
          h.TOTALVENTA,
          addDue.VALOR AS fechaVencimiento,
          addOc.VALOR AS ordenCompra,
          gf.NRO_GUIA
        FROM dbo.SPE_EINVOICEHEADER h
        LEFT JOIN dbo.SPE_EINVOICEHEADER_ADD addDue
          ON addDue.SERIENUMERO = h.SERIENUMERO
         AND addDue.TIPODOCUMENTO = h.TIPODOCUMENTO
         AND addDue.CLAVE = 'fechaVencimiento'
        LEFT JOIN dbo.SPE_EINVOICEHEADER_ADD addOc
          ON addOc.SERIENUMERO = h.SERIENUMERO
         AND addOc.TIPODOCUMENTO = h.TIPODOCUMENTO
         AND addOc.CLAVE = 'ordenCompra'
        LEFT JOIN dbo.AAA_GUIAFACTURADA gf
          ON gf.NRO_FACTURA = h.SERIENUMERO
        WHERE h.SERIENUMERO = @factura
          AND h.TIPODOCUMENTO = '01';
      `);

    const header = biz.recordsets[2]?.[0] as { NUMERODOCUMENTOADQUIRIENTE?: string; TIPOMONEDA?: string } | undefined;
    const ruc = header?.NUMERODOCUMENTOADQUIRIENTE ?? '';

    const ychiResult = await new sql.Request(ychi)
      .input('ruc', sql.VarChar(20), ruc)
      .query(`
        SET TRANSACTION ISOLATION LEVEL READ UNCOMMITTED;

        SELECT TOP (20)
          idClieProv,
          Nombre,
          RUC,
          idempleado,
          tipoClieProv,
          Estado,
          origen
        FROM dbo.tbClieProv
        WHERE RUC = @ruc
        ORDER BY CASE WHEN tipoClieProv = 'C' AND Estado = 'A' THEN 0 ELSE 1 END,
          CASE WHEN origen = 'Y' THEN 0 ELSE 1 END,
          idClieProv DESC;

        SELECT TOP (80)
          idPropiedades,
          Nombre,
          Valor,
          Descripcion
        FROM dbo.tbPropiedades
        WHERE tipo = 'FPAG'
          AND ISNULL(Valor, '') NOT LIKE '(obsoleto)%'
          AND ISNULL(Nombre, '') NOT LIKE '(obsoleto)%'
        ORDER BY
          CASE WHEN Nombre LIKE '%Contado%' THEN 0 ELSE 1 END,
          CASE WHEN ISNUMERIC(Descripcion) = 1 THEN CAST(Descripcion AS int) ELSE 9999 END,
          Nombre;

        SELECT TOP (50)
          idUnidad,
          Valor
        FROM dbo.tbUnidades
        WHERE Valor IN ('NIU','UND','UNIDAD','MIL','MILLAR')
        ORDER BY idUnidad;

        SELECT TOP (10)
          idProducto,
          Nombre
        FROM dbo.tbProductos
        WHERE idProducto IN (6969, 3724)
           OR Nombre LIKE '%SERVICIO%'
        ORDER BY CASE WHEN idProducto = 6969 THEN 0 ELSE 1 END, idProducto;
      `);

    console.log(JSON.stringify({
      safety: 'READ_ONLY',
      factura,
      bizlinksDetailColumns: biz.recordsets[0],
      bizlinksDetails: biz.recordsets[1],
      bizlinksHeader: biz.recordsets[2],
      ychiClientes: ychiResult.recordsets[0],
      ychiFormasPago: ychiResult.recordsets[1],
      ychiUnidades: ychiResult.recordsets[2],
      ychiProductos: ychiResult.recordsets[3]
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
