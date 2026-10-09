import { mkdir, writeFile } from 'node:fs/promises';
import { loadEnv } from '../../src/config/env.js';
import { createBizlinksPool, sql } from '../../src/integrations/bizlinksSql.js';

const factura = process.argv[2]?.trim();
if (!/^FF01-\d{8}$/.test(factura ?? '')) {
  throw new Error('Uso: npx tsx tools/audit/exportFcFacturaArtifacts.ts FF01-00000000');
}

const pool = createBizlinksPool(loadEnv());
await pool.connect();

try {
  const result = await pool.request()
    .input('factura', sql.VarChar(13), factura)
    .query<{
      bl_estadoProceso: string | null;
      process_state: string | null;
      bl_mensajeSunat: string | null;
      bl_url_pdf: string | null;
      bl_url_ubl: string | null;
      bl_url_cdr: string | null;
      bl_xml: Buffer | string | null;
      bl_cdr: Buffer | string | null;
      bl_xml_rsp: Buffer | string | null;
    }>(`
      SELECT TOP (1) r.bl_estadoProceso, r.process_state, r.bl_mensajeSunat,
        COALESCE(r.bl_url_pdf, j.bl_url_pdf) AS bl_url_pdf,
        COALESCE(r.bl_url_ubl, j.bl_url_ubl) AS bl_url_ubl,
        COALESCE(r.bl_url_cdr, j.bl_url_cdr) AS bl_url_cdr,
        COALESCE(r.bl_xml, j.bl_xml) AS bl_xml,
        COALESCE(r.bl_cdr, j.bl_cdr) AS bl_cdr,
        r.bl_xml_rsp
      FROM dbo.SPE_EINVOICE_RESPONSE r
      OUTER APPLY (
        SELECT TOP (1) d.bl_url_pdf, d.bl_url_ubl, d.bl_url_cdr, d.bl_xml, d.bl_cdr
        FROM dbo.SPE_JOB_DOWNLOAD d
        WHERE d.serieNumero = r.SERIENUMERO AND d.tipoDocumento = r.TIPODOCUMENTO
      ) j
      WHERE r.SERIENUMERO = @factura AND r.TIPODOCUMENTO = '01';
    `);
  const row = result.recordset[0];
  if (!row) throw new Error(`No existe respuesta Bizlinks para ${factura}.`);

  await mkdir('evidencias', { recursive: true });
  const exported: Array<{ file: string; bytes: number }> = [];
  for (const [suffix, value] of [
    ['UBL', row.bl_xml],
    ['CDR', row.bl_cdr],
    ['XML_RESPONSE', row.bl_xml_rsp]
  ] as const) {
    if (value == null) continue;
    const data = Buffer.isBuffer(value) ? value : Buffer.from(value, 'utf8');
    if (data.length === 0) continue;
    const extension = data.subarray(0, 2).toString('ascii') === 'PK' ? 'zip' : 'xml';
    const file = `evidencias/${factura}_${suffix}.${extension}`;
    await writeFile(file, data);
    exported.push({ file, bytes: data.length });
  }

  console.log(JSON.stringify({
    factura,
    estadoProceso: row.bl_estadoProceso,
    processState: row.process_state,
    mensajeSunat: row.bl_mensajeSunat,
    urls: {
      pdf: row.bl_url_pdf,
      ubl: row.bl_url_ubl,
      cdr: row.bl_url_cdr
    },
    exported
  }, null, 2));
} finally {
  await pool.close();
}
