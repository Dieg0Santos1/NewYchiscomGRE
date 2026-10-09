import { loadEnv } from '../../src/config/env.js';
import { createBizlinksPool, sql } from '../../src/integrations/bizlinksSql.js';

const factura = process.argv[2]?.trim() || 'FF01-00017174';

async function main() {
  const pool = createBizlinksPool(loadEnv());
  await pool.connect();

  try {
    const countRequest = new sql.Request(pool);
    countRequest.input('factura', sql.VarChar(13), factura);
    const counts = await countRequest.query(`
      SELECT 'HEADER_TABLE' AS src, COUNT(*) AS total
      FROM dbo.SPE_EINVOICEHEADER
      WHERE serieNumero = @factura
      UNION ALL
      SELECT 'DETAIL_TABLE' AS src, COUNT(*) AS total
      FROM dbo.SPE_EINVOICEDETAIL
      WHERE serieNumero = @factura
      UNION ALL
      SELECT 'ADD' AS src, COUNT(*) AS total
      FROM dbo.SPE_EINVOICEHEADER_ADD
      WHERE serieNumero = @factura
      UNION ALL
      SELECT 'RESPONSE' AS src, COUNT(*) AS total
      FROM dbo.SPE_EINVOICE_RESPONSE
      WHERE serieNumero = @factura;
    `);

    const header = await new sql.Request(pool)
      .input('factura', sql.VarChar(13), factura)
      .query(`
        SELECT TOP (5)
          h.serieNumero,
          h.razonSocialAdquiriente,
          h.bl_estadoRegistro,
          h.tipoDocumento,
          h.numeroDocumentoAdquiriente,
          response.process_state,
          response.bl_estadoRegistro AS responseEstado,
          response.bl_mensajeSunat
        FROM dbo.SPE_EINVOICEHEADER h
        LEFT JOIN dbo.SPE_EINVOICE_RESPONSE response
          ON response.serieNumero = h.serieNumero
         AND response.tipoDocumento = h.tipoDocumento
        WHERE h.serieNumero = @factura;
      `);

    const detail = await new sql.Request(pool)
      .input('factura', sql.VarChar(13), factura)
      .query(`
        SELECT TOP (10)
          serieNumero,
          numeroOrdenItem,
          codigoProducto,
          descripcion,
          cantidad,
          unidadMedida,
          importeUnitarioSinImpuesto,
          importeTotalSinImpuesto
        FROM dbo.SPE_EINVOICEDETAIL
        WHERE serieNumero = @factura
        ORDER BY numeroOrdenItem;
      `);

    const requiredAdd = await new sql.Request(pool)
      .input('factura', sql.VarChar(13), factura)
      .query(`
        SELECT expected.clave,
          MAX(addon.valor) AS valor,
          COUNT(addon.clave) AS total
        FROM (VALUES
          ('departamentoAdquiriente'),
          ('direccionAdquiriente'),
          ('distritoAdquiriente'),
          ('paisAdquiriente'),
          ('provinciaAdquiriente'),
          ('ubigeoAdquiriente'),
          ('urbanizacionAdquiriente'),
          ('ordenCompra'),
          ('fechaVencimiento')
        ) expected(clave)
        LEFT JOIN dbo.SPE_EINVOICEHEADER_ADD addon
          ON addon.serieNumero = @factura
         AND addon.clave = expected.clave
        GROUP BY expected.clave
        ORDER BY expected.clave;
      `);

    console.log(JSON.stringify({
      factura,
      counts: counts.recordset,
      header: header.recordset,
      detail: detail.recordset,
      requiredAdd: requiredAdd.recordset
    }, null, 2));
  } finally {
    await pool.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
