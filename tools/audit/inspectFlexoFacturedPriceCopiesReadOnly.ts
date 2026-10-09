import { loadEnv } from '../../src/config/env.js';
import { createBizlinksPool, createYchiPool, sql } from '../../src/integrations/bizlinksSql.js';

const factura = process.argv[2]?.trim() || 'FF03-00011251';

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
    const biz = await new sql.Request(bizlinks)
      .input('factura', sql.VarChar(20), factura)
      .query(`
        SET TRANSACTION ISOLATION LEVEL READ UNCOMMITTED;
        SELECT h.SERIENUMERO, h.FECHAEMISION,
          h.BL_ESTADOREGISTRO, r.process_state, r.bl_estadoProceso,
          r.bl_mensajeSunat,
          h.TOTALVALORVENTANETOOPGRAVADAS, h.TOTALIGV, h.TOTALVENTA,
          d.numeroOrdenItem, d.descripcion, d.cantidad,
          d.importeUnitarioSinImpuesto, d.importeTotalSinImpuesto,
          d.importeIGV, d.importeUnitarioConImpuesto
        FROM dbo.SPE_EINVOICEHEADER h
        LEFT JOIN dbo.SPE_EINVOICE_RESPONSE r
          ON r.NUMERODOCUMENTOEMISOR = h.NUMERODOCUMENTOEMISOR
         AND r.SERIENUMERO = h.SERIENUMERO
         AND r.TIPODOCUMENTO = h.TIPODOCUMENTO
        LEFT JOIN dbo.SPE_EINVOICEDETAIL d
          ON d.NUMERODOCUMENTOEMISOR = h.NUMERODOCUMENTOEMISOR
         AND d.SERIENUMERO = h.SERIENUMERO
         AND d.TIPODOCUMENTO = h.TIPODOCUMENTO
        WHERE h.SERIENUMERO = @factura
          AND h.TIPODOCUMENTO = '01'
        ORDER BY d.numeroOrdenItem;
      `);

    const legacyNumbers = [
      factura.split('-')[1]?.slice(-6),
      factura.split('-')[1]?.slice(-7),
      factura.split('-')[1]
    ].filter(Boolean);

    const req = new sql.Request(ychi);
    const params = legacyNumbers.map((numero, index) => {
      const name = `num${index}`;
      req.input(name, sql.VarChar(20), numero);
      return `@${name}`;
    });

    const legacy = await req.query(`
      SET TRANSACTION ISOLATION LEVEL READ UNCOMMITTED;
      SELECT d.idDocumento, d.idTipoDocu, d.SeriDocu, d.NumeDocu,
        d.FechaEmision, d.Neto, d.Igv, d.Total,
        df.idDetFact, df.Descripcion, df.Cantidad, df.Precio,
        df.Igv AS IgvUnitario, df.Neto AS DetNeto, df.Total AS DetTotal
      FROM dbo.tbDocumentos d
      LEFT JOIN dbo.tbDetFact df ON df.idDocumento = d.idDocumento
      WHERE d.idTipoDocu = 38
        AND d.SeriDocu = 'F03'
        AND d.NumeDocu IN (${params.join(', ')})
      ORDER BY d.NumeDocu, df.idDetFact;
    `);

    printSection('Bizlinks factura/detalle', biz.recordset);
    printSection('YCHIDB3 espejo legacy F03', legacy.recordset);
  } finally {
    await ychi.close();
    await bizlinks.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
