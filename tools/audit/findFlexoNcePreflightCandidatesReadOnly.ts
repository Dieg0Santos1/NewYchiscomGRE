import { loadEnv } from '../../src/config/env.js';
import { createBizlinksPool, createYchiPool, sql } from '../../src/integrations/bizlinksSql.js';

type BizInvoice = {
  serieNumero: string;
  fechaEmision: string | null;
  numeroDocumentoAdquiriente: string | null;
  razonSocialAdquiriente: string | null;
  tipoMoneda: string | null;
  totalVenta: string | number | null;
  NRO_GUIA: string | null;
  NOTACRE: string | null;
  bl_estadoProceso: string | null;
  bl_mensajeSunat: string | null;
};

type LegacyInvoice = {
  idDocumento: number;
  idTipoDocu: number;
  SeriDocu: string | null;
  NumeDocu: string | null;
  DescClieProv: string | null;
  correo: string | null;
  FechaCreacion: string | null;
};

async function main() {
  const config = loadEnv();
  const bizlinks = createBizlinksPool(config);
  const ychi = createYchiPool(config);
  await bizlinks.connect();
  await ychi.connect();

  try {
    const biz = await new sql.Request(bizlinks).query<BizInvoice>(`
      SET TRANSACTION ISOLATION LEVEL READ UNCOMMITTED;

      SELECT TOP (120)
        h.serieNumero,
        CONVERT(varchar(10), h.fechaEmision, 120) AS fechaEmision,
        h.numeroDocumentoAdquiriente,
        h.razonSocialAdquiriente,
        h.tipoMoneda,
        h.totalVenta,
        gf.NRO_GUIA,
        gf.NOTACRE,
        r.bl_estadoProceso,
        r.bl_mensajeSunat
      FROM dbo.SPE_EINVOICEHEADER h
      LEFT JOIN dbo.SPE_EINVOICE_RESPONSE r
        ON r.numeroDocumentoEmisor = h.numeroDocumentoEmisor
       AND r.serieNumero = h.serieNumero
       AND r.tipoDocumento = h.tipoDocumento
      LEFT JOIN dbo.AAA_GUIAFACTURADA gf
        ON gf.NRO_FACTURA = h.serieNumero
      WHERE h.tipoDocumento = '01'
        AND h.serieNumero LIKE 'FF03-%'
        AND (
          r.bl_estadoProceso LIKE '%AC_03%'
          OR r.bl_mensajeSunat LIKE '%"codigo":"0"%'
          OR r.bl_mensajeSunat LIKE '%aceptad%'
        )
      ORDER BY h.serieNumero DESC;
    `);

    const legacy = await new sql.Request(ychi).query<LegacyInvoice>(`
      SET TRANSACTION ISOLATION LEVEL READ UNCOMMITTED;

      SELECT TOP (400)
        idDocumento,
        idTipoDocu,
        SeriDocu,
        NumeDocu,
        DescClieProv,
        correo,
        FechaCreacion
      FROM dbo.tbDocumentos
      WHERE idTipoDocu IN (38, 43)
        AND (
          SeriDocu IN ('F03', 'FF03')
          OR correo LIKE 'FF03-%'
        )
      ORDER BY idDocumento DESC;
    `);

    const legacyRows = legacy.recordset;
    const matches = biz.recordset
      .map((row) => {
        const shortNumber = row.serieNumero.slice(-7);
        const eightNumber = row.serieNumero.slice(-8);
        const legacy = legacyRows.find((item) => {
          const correo = String(item.correo ?? '').trim();
          const num = String(item.NumeDocu ?? '').trim();
          return correo === row.serieNumero
            || num.padStart(7, '0') === shortNumber
            || num.padStart(8, '0') === eightNumber;
        });
        return { ...row, legacy: legacy ?? null };
      })
      .filter((row) => row.legacy);

    console.log(JSON.stringify({
      safety: 'READ_ONLY',
      candidates: biz.recordset.slice(0, 25),
      legacyTop: legacyRows.slice(0, 25),
      matches: matches.slice(0, 25)
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
