import { loadEnv } from '../../src/config/env.js';
import { createBizlinksPool, createYchiPool, sql } from '../../src/integrations/bizlinksSql.js';

const requestedReference = process.argv[2]?.trim();

type MultiGuideInvoice = {
  factura: string;
  linkedGuides: number;
  itemGuideRefs: number;
  empaqueGuides: number;
  details: number;
  cliente: string | null;
  ruc: string | null;
  mensaje: string | null;
};

async function main() {
  const config = loadEnv();
  const bizlinks = createBizlinksPool(config);
  const ychi = createYchiPool(config);
  await bizlinks.connect();
  await ychi.connect();

  try {
    const candidates = await new sql.Request(bizlinks).query<MultiGuideInvoice>(`
      SET TRANSACTION ISOLATION LEVEL READ UNCOMMITTED;

      SELECT TOP (10)
        h.SERIENUMERO AS factura,
        COUNT(DISTINCT gf.NRO_GUIA) AS linkedGuides,
        COUNT(DISTINCT NULLIF(d.textoAuxiliar250_1, '')) AS itemGuideRefs,
        COUNT(DISTINCT NULLIF(ed.SERIENUMEROGUIAREMISION, '')) AS empaqueGuides,
        COUNT(DISTINCT d.NUMEROORDENITEM) AS details,
        MIN(h.RAZONSOCIALADQUIRIENTE) AS cliente,
        MIN(h.NUMERODOCUMENTOADQUIRIENTE) AS ruc,
        LEFT(MIN(COALESCE(r.bl_mensajeSunat, r.bl_mensaje, '')), 180) AS mensaje
      FROM dbo.SPE_EINVOICEHEADER h
      INNER JOIN dbo.SPE_EINVOICE_RESPONSE r
        ON r.NUMERODOCUMENTOEMISOR = h.NUMERODOCUMENTOEMISOR
       AND r.SERIENUMERO = h.SERIENUMERO
       AND r.TIPODOCUMENTO = h.TIPODOCUMENTO
      LEFT JOIN dbo.AAA_GUIAFACTURADA gf
        ON gf.NRO_FACTURA = h.SERIENUMERO
      LEFT JOIN dbo.SPE_EINVOICEDETAIL d
        ON d.NUMERODOCUMENTOEMISOR = h.NUMERODOCUMENTOEMISOR
       AND d.SERIENUMERO = h.SERIENUMERO
       AND d.TIPODOCUMENTO = h.TIPODOCUMENTO
      LEFT JOIN dbo.EMPAQUE_DETALLE ed
        ON ed.SERIENUMEROGUIAFACTURA = h.SERIENUMERO
      WHERE h.TIPODOCUMENTO = '01'
        AND h.SERIENUMERO LIKE 'FF03-%'
        AND r.process_state = '_3_COMPLETED'
        AND (
          r.bl_mensajeSunat LIKE '%"codigo":"0"%'
          OR r.bl_mensajeSunat LIKE '%aceptad%'
          OR r.bl_mensaje LIKE '%aceptad%'
        )
      GROUP BY h.SERIENUMERO
      HAVING COUNT(DISTINCT gf.NRO_GUIA) > 1
          OR COUNT(DISTINCT NULLIF(d.textoAuxiliar250_1, '')) > 1
          OR COUNT(DISTINCT NULLIF(ed.SERIENUMEROGUIAREMISION, '')) > 1
      ORDER BY h.SERIENUMERO DESC;
    `);

    const reference = requestedReference || candidates.recordset[0]?.factura;
    if (!reference) {
      console.log(JSON.stringify({
        safety: 'READ_ONLY',
        message: 'No se encontraron FF03 aceptadas con mas de una guia.',
        candidates: []
      }, null, 2));
      return;
    }

    const req = new sql.Request(bizlinks);
    req.input('factura', sql.VarChar(13), reference);
    const details = await req.query(`
      SET TRANSACTION ISOLATION LEVEL READ UNCOMMITTED;

      SELECT
        'AAA_GUIAFACTURADA' AS source,
        CAST(ID AS varchar(30)) AS orden,
        NRO_FACTURA AS factura,
        NRO_GUIA AS guia,
        ESTADO AS estado,
        CAST(NULL AS varchar(250)) AS producto,
        CAST(NULL AS varchar(4000)) AS descripcion
      FROM dbo.AAA_GUIAFACTURADA
      WHERE NRO_FACTURA = @factura

      UNION ALL

      SELECT
        'SPE_EINVOICEDETAIL',
        NUMEROORDENITEM,
        SERIENUMERO,
        textoAuxiliar250_1,
        CAST(NULL AS varchar(30)),
        CODIGOPRODUCTO,
        DESCRIPCION
      FROM dbo.SPE_EINVOICEDETAIL
      WHERE SERIENUMERO = @factura
        AND TIPODOCUMENTO = '01'

      UNION ALL

      SELECT
        'EMPAQUE_DETALLE',
        CAST(ORDENFACTURA AS varchar(30)),
        SERIENUMEROGUIAFACTURA,
        SERIENUMEROGUIAREMISION,
        CAST(NULL AS varchar(30)),
        CODIGOPRODUCTO,
        DESCRIPCION
      FROM dbo.EMPAQUE_DETALLE
      WHERE SERIENUMEROGUIAFACTURA = @factura

      ORDER BY source, guia, orden;
    `);

    const legacyReq = new sql.Request(ychi);
    legacyReq.input('factura', sql.VarChar(13), reference);
    const legacy = await legacyReq.query(`
      SET TRANSACTION ISOLATION LEVEL READ UNCOMMITTED;

      SELECT TOP (10)
        idDocumento,
        idTipoDocu,
        SeriDocu,
        NumeDocu,
        FechaEmision,
        Estado,
        DescClieProv,
        nguia,
        idDocumentoAnterior
      FROM dbo.tbDocumentos
      WHERE SeriDocu IN ('FF03', 'F03')
        AND (
          NumeDocu LIKE '%' + RIGHT(@factura, 6)
          OR NumeDocu LIKE '%' + RIGHT(@factura, 7)
          OR NumeDocu LIKE '%' + RIGHT(@factura, 8)
        )
      ORDER BY idDocumento DESC;
    `);

    console.log(JSON.stringify({
      safety: 'READ_ONLY',
      candidates: candidates.recordset,
      selectedReference: reference,
      referenceRows: details.recordset,
      legacyRows: legacy.recordset
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
