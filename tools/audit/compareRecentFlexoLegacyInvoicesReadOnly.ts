import { loadEnv } from '../../src/config/env.js';
import { createBizlinksPool, createYchiPool, sql } from '../../src/integrations/bizlinksSql.js';

async function main() {
  const config = loadEnv();
  const ychiPool = createYchiPool(config);
  const bizlinksPool = createBizlinksPool(config);
  await ychiPool.connect();
  await bizlinksPool.connect();

  try {
    const ychi = await new sql.Request(ychiPool).query(`
      SET TRANSACTION ISOLATION LEVEL READ UNCOMMITTED;
      SELECT TOP (40)
        d.idDocumento,
        d.idTipoDocu,
        d.idEmpleado,
        d.idClieProv,
        d.SeriDocu,
        d.NumeDocu,
        d.DescClieProv,
        d.formaPago,
        d.Moneda,
        d.Tica,
        d.Neto,
        d.Igv,
        d.Total,
        d.FechaEmision,
        d.FechaCreacion,
        d.FechaVencimiento,
        d.Estado,
        d.cuenta,
        d.origen,
        d.negociable,
        d.web,
        d.llevacomp,
        d.nguia,
        d.CORREO,
        c.RUC,
        c.Nombre AS clienteNombre
      FROM dbo.tbDocumentos d
      LEFT JOIN dbo.tbClieProv c
        ON c.idClieProv = d.idClieProv
      WHERE d.idTipoDocu IN (1, 38)
        AND d.SeriDocu IN ('F03', 'FF03')
      ORDER BY d.FechaCreacion DESC, d.NumeDocu DESC;
    `);

    const bizlinks = await new sql.Request(bizlinksPool).query(`
      SET TRANSACTION ISOLATION LEVEL READ UNCOMMITTED;
      SELECT TOP (40)
        h.SERIENUMERO,
        h.FECHAEMISION,
        h.NUMERODOCUMENTOADQUIRIENTE,
        h.RAZONSOCIALADQUIRIENTE,
        h.TIPOMONEDA,
        h.TOTALVALORVENTANETOOPGRAVADAS,
        h.TOTALIGV,
        h.TOTALVENTA,
        r.bl_estadoProceso,
        r.bl_mensajeSunat
      FROM dbo.SPE_EINVOICEHEADER h
      LEFT JOIN dbo.SPE_EINVOICE_RESPONSE r
        ON r.SERIENUMERO = h.SERIENUMERO
       AND r.TIPODOCUMENTO = h.TIPODOCUMENTO
       AND r.NUMERODOCUMENTOEMISOR = h.NUMERODOCUMENTOEMISOR
      WHERE h.SERIENUMERO LIKE 'FF03-%'
        AND h.TIPODOCUMENTO = '01'
      ORDER BY h.SERIENUMERO DESC;
    `);

    const ychiType = await new sql.Request(ychiPool).query(`
      SET TRANSACTION ISOLATION LEVEL READ UNCOMMITTED;
      SELECT *
      FROM dbo.tbTipoDocu
      WHERE idTipoDocu IN (1, 38)
      ORDER BY idTipoDocu;
    `);

    console.log(JSON.stringify({
      safety: 'READ_ONLY',
      ychidb3RecentF03: ychi.recordset,
      ychidb3TipoDocu: ychiType.recordset,
      bizlinksRecentFF03: bizlinks.recordset
    }, null, 2));
  } finally {
    await bizlinksPool.close();
    await ychiPool.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
