import { loadEnv } from '../../src/config/env.js';
import { createBizlinksPool, createYchiPool, sql } from '../../src/integrations/bizlinksSql.js';

const factura = process.argv[2]?.trim() || 'FF03-00010950';

async function main() {
  const config = loadEnv();
  const bizlinksPool = createBizlinksPool(config);
  const ychiPool = createYchiPool(config);

  await bizlinksPool.connect();
  await ychiPool.connect();

  try {
    const bizRequest = new sql.Request(bizlinksPool);
    bizRequest.input('factura', sql.VarChar(20), factura);

    const bizlinks = await bizRequest.query(`
      SELECT 'SPE_EINVOICEHEADER' AS origen,
        h.SERIENUMERO AS factura,
        h.FECHAEMISION AS fecha,
        h.NUMERODOCUMENTOADQUIRIENTE AS ruc,
        h.RAZONSOCIALADQUIRIENTE AS cliente,
        h.BL_ESTADOREGISTRO AS estadoRegistro,
        CAST(NULL AS varchar(100)) AS estadoProceso,
        CAST(NULL AS varchar(max)) AS mensaje,
        CAST(NULL AS varchar(max)) AS pdf
      FROM dbo.SPE_EINVOICEHEADER h
      WHERE h.SERIENUMERO = @factura
        AND h.TIPODOCUMENTO = '01'

      UNION ALL

      SELECT 'SPE_EINVOICE_RESPONSE' AS origen,
        r.SERIENUMERO AS factura,
        CAST(NULL AS datetime) AS fecha,
        r.NUMERODOCUMENTOEMISOR AS ruc,
        CAST(NULL AS varchar(250)) AS cliente,
        r.bl_estadoRegistro AS estadoRegistro,
        r.bl_estadoProceso AS estadoProceso,
        COALESCE(r.bl_mensajeSunat, r.bl_mensaje) AS mensaje,
        r.bl_url_pdf AS pdf
      FROM dbo.SPE_EINVOICE_RESPONSE r
      WHERE r.SERIENUMERO = @factura
        AND r.TIPODOCUMENTO = '01'
      ORDER BY origen;
    `);

    const linkRequest = new sql.Request(bizlinksPool);
    linkRequest.input('factura', sql.VarChar(20), factura);
    const links = await linkRequest.query(`
      SELECT
        d.SERIENUMEROGUIAFACTURA AS factura,
        d.SERIENUMEROGUIAREMISION AS guia,
        e.CODIGOEMPAQUE AS empaque,
        e.TICKETNUM AS ticket,
        e.ORDENCOMPRA AS oc,
        e.NUMERODOCUMENTOADQUIRIENTE AS ruc,
        e.RAZONSOCIALADQUIRIENTE AS cliente,
        d.CODIGOPRODUCTO AS codigoProducto,
        d.DESCRIPCION AS descripcion,
        d.CANTIDAD AS cantidad,
        d.UNIDADMEDIDA AS unidadMedida,
        d.ORDENGUIA AS ordenGuia,
        d.ORDENFACTURA AS ordenFactura
      FROM dbo.EMPAQUE_DETALLE d
      INNER JOIN dbo.EMPAQUE e
        ON e.CODIGOEMPAQUE = d.CODIGOEMPAQUE
      WHERE d.SERIENUMEROGUIAFACTURA = @factura
      ORDER BY d.SERIENUMEROGUIAREMISION, e.CODIGOEMPAQUE, d.CODIGOPRODUCTO;
    `);

    const aaaRequest = new sql.Request(bizlinksPool);
    aaaRequest.input('factura', sql.VarChar(20), factura);
    const aaa = await aaaRequest.query(`
      SELECT *
      FROM dbo.AAA_GUIAFACTURADA
      WHERE NRO_FACTURA = @factura
    `).catch((error: unknown) => ({
      recordset: [{ error: error instanceof Error ? error.message : String(error) }]
    }));

    const ychiRequest = new sql.Request(ychiPool);
    ychiRequest.input('facturaFull', sql.VarChar(20), factura);
    ychiRequest.input('serie', sql.VarChar(10), factura.split('-')[0] ?? '');
    ychiRequest.input('numero', sql.VarChar(20), factura.split('-')[1] ?? '');
    ychiRequest.input('numero7', sql.VarChar(20), (factura.split('-')[1] ?? '').slice(-7));
    ychiRequest.input('numero6', sql.VarChar(20), (factura.split('-')[1] ?? '').slice(-6));
    const ychiscom = await ychiRequest.query(`
      SELECT TOP (20)
        idDocumento,
        idTipoDocu,
        idEmpleado,
        idClieProv,
        SeriDocu,
        NumeDocu,
        DescClieProv,
        Neto,
        Igv,
        Total,
        FechaEmision,
        FechaCreacion,
        FechaVencimiento,
        Estado,
        cuenta,
        nguia
      FROM dbo.tbDocumentos
      WHERE (SeriDocu = @serie AND NumeDocu = @numero)
         OR (SeriDocu = @serie AND NumeDocu = @numero7)
         OR (SeriDocu = @serie AND NumeDocu = @numero6)
         OR CONCAT(SeriDocu, '-', NumeDocu) = @facturaFull
         OR nguia LIKE '%' + @facturaFull + '%'
         OR (SeriDocu = @serie AND NumeDocu LIKE '%' + @numero6)
      ORDER BY FechaCreacion DESC;
    `).catch((error: unknown) => ({
      recordset: [{ error: error instanceof Error ? error.message : String(error) }]
    }));

    console.log(JSON.stringify({
      factura,
      bizlinks: bizlinks.recordset,
      links: links.recordset,
      aaaGuiaFacturada: aaa.recordset,
      ychiscom: ychiscom.recordset
    }, null, 2));
  } finally {
    await ychiPool.close();
    await bizlinksPool.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
