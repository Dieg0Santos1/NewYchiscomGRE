import { loadEnv } from '../../src/config/env.js';
import { createBizlinksPool, sql } from '../../src/integrations/bizlinksSql.js';

const invoice = process.argv[2]?.trim() || 'FF01-00017173';
const customerRuc = process.argv[3]?.trim() || '20307214386';

async function main() {
  const pool = createBizlinksPool(loadEnv());
  await pool.connect();

  try {
    const request = new sql.Request(pool);
    request.input('invoice', sql.VarChar(13), invoice);
    request.input('customerRuc', sql.VarChar(20), customerRuc);

    const result = await request.query(`
      SELECT *
      FROM dbo.AAA_ADQUIRIENTE
      WHERE LTRIM(RTRIM(NUMERODOCUMENTOADQUIRIENTE)) = @customerRuc;

      SELECT TOP (20)
        h.SERIENUMERO,
        h.FECHAEMISION,
        h.BL_ESTADOREGISTRO,
        MAX(CASE WHEN a.clave = 'direccionAdquiriente' THEN a.valor END) AS direccionAdquiriente,
        MAX(CASE WHEN a.clave = 'ubigeoAdquiriente' THEN a.valor END) AS ubigeoAdquiriente,
        MAX(CASE WHEN a.clave = 'distritoAdquiriente' THEN a.valor END) AS distritoAdquiriente,
        MAX(CASE WHEN a.clave = 'provinciaAdquiriente' THEN a.valor END) AS provinciaAdquiriente,
        MAX(CASE WHEN a.clave = 'departamentoAdquiriente' THEN a.valor END) AS departamentoAdquiriente,
        MAX(CASE WHEN a.clave = 'paisAdquiriente' THEN a.valor END) AS paisAdquiriente,
        r.bl_estadoProceso,
        r.process_state,
        r.bl_mensajeSunat,
        r.bl_Ticket
      FROM dbo.SPE_EINVOICEHEADER h
      LEFT JOIN dbo.SPE_EINVOICEHEADER_ADD a
        ON a.NUMERODOCUMENTOEMISOR = h.NUMERODOCUMENTOEMISOR
       AND a.SERIENUMERO = h.SERIENUMERO
       AND a.TIPODOCUMENTO = h.TIPODOCUMENTO
      LEFT JOIN dbo.SPE_EINVOICE_RESPONSE r
        ON r.NUMERODOCUMENTOEMISOR = h.NUMERODOCUMENTOEMISOR
       AND r.SERIENUMERO = h.SERIENUMERO
       AND r.TIPODOCUMENTO = h.TIPODOCUMENTO
      WHERE h.TIPODOCUMENTO = '01'
        AND h.NUMERODOCUMENTOADQUIRIENTE = @customerRuc
      GROUP BY h.SERIENUMERO, h.FECHAEMISION, h.BL_ESTADOREGISTRO,
        r.bl_estadoProceso, r.process_state, r.bl_mensajeSunat, r.bl_Ticket
      ORDER BY h.FECHAEMISION DESC, h.SERIENUMERO DESC;

      SELECT a.clave, a.valor
      FROM dbo.SPE_EINVOICEHEADER_ADD a
      WHERE a.SERIENUMERO = @invoice
        AND a.TIPODOCUMENTO = '01'
      ORDER BY a.clave;

      SELECT TABLE_NAME
      FROM INFORMATION_SCHEMA.TABLES
      WHERE TABLE_TYPE = 'BASE TABLE'
        AND (
          TABLE_NAME LIKE '%VOID%'
          OR TABLE_NAME LIKE '%BAJA%'
          OR TABLE_NAME LIKE '%CANCEL%'
          OR TABLE_NAME LIKE '%SUMMARY%'
        )
      ORDER BY TABLE_NAME;

      SELECT o.name, o.type_desc
      FROM sys.objects o
      INNER JOIN sys.sql_modules m ON m.object_id = o.object_id
      WHERE m.definition LIKE '%SPE_VOIDED%'
         OR m.definition LIKE '%COMUNICACION%BAJA%'
         OR m.definition LIKE '%comunicacion%baja%'
      ORDER BY o.name;

      SELECT TABLE_NAME, COLUMN_NAME, DATA_TYPE
      FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_NAME IN (
        'SPE_CANCELHEADER', 'SPE_CANCELDETAIL', 'SPE_CANCEL_RESPONSE', 'BL_CANCEL_TRACE'
      )
      ORDER BY TABLE_NAME, ORDINAL_POSITION;

      SELECT
        d.resumenId,
        d.tipoDocumento,
        d.serieDocumentoBaja,
        d.numeroDocumentoBaja,
        d.motivoBaja,
        d.bl_createdAt,
        h.bl_estadoRegistro AS headerEstado,
        r.bl_estadoRegistro AS responseEstado,
        r.bl_estadoProceso,
        r.process_state,
        r.bl_mensaje,
        r.bl_mensajeSunat,
        r.bl_url_cdr,
        r.bl_fechaRespuestaSunat
      FROM dbo.SPE_CANCELDETAIL d
      LEFT JOIN dbo.SPE_CANCELHEADER h
        ON h.numeroDocumentoEmisor = d.numeroDocumentoEmisor
       AND h.resumenId = d.resumenId
       AND h.tipoDocumentoEmisor = d.tipoDocumentoEmisor
      LEFT JOIN dbo.SPE_CANCEL_RESPONSE r
        ON r.numeroDocumentoEmisor = d.numeroDocumentoEmisor
       AND r.resumenId = d.resumenId
       AND r.tipoDocumentoEmisor = d.tipoDocumentoEmisor
      WHERE d.tipoDocumento = '01'
        AND d.serieDocumentoBaja = LEFT(@invoice, 4)
        AND RIGHT('00000000' + d.numeroDocumentoBaja, 8) = RIGHT(@invoice, 8)
      ORDER BY d.bl_createdAt DESC;
    `);

    console.log(JSON.stringify({
      safety: 'READ_ONLY',
      invoice,
      customerRuc,
      customerRepository: result.recordsets[0],
      acceptedInvoices: result.recordsets[1],
      invoiceAdditionalData: result.recordsets[2],
      cancellationTables: result.recordsets[3],
      cancellationObjects: result.recordsets[4],
      cancellationColumns: result.recordsets[5],
      cancellationStatus: result.recordsets[6]
    }, null, 2));
  } finally {
    await pool.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
