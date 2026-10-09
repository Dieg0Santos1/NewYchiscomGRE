import { loadEnv } from '../../src/config/env.js';
import { createBizlinksPool, createYchiPool, sql } from '../../src/integrations/bizlinksSql.js';

type DbColumn = {
  TABLE_NAME: string;
  COLUMN_NAME: string;
  DATA_TYPE: string;
};

function bracket(name: string) {
  return `[${name.replace(/]/g, ']]')}]`;
}

function hasColumn(columns: DbColumn[], table: string, column: string) {
  return columns.some(
    (item) =>
      item.TABLE_NAME.toLowerCase() === table.toLowerCase() &&
      item.COLUMN_NAME.toLowerCase() === column.toLowerCase()
  );
}

function selectIfExists(columns: DbColumn[], table: string, column: string, alias = column, tableAlias?: string) {
  const prefix = tableAlias ? `${tableAlias}.` : '';
  return hasColumn(columns, table, column)
    ? `${prefix}${bracket(column)} AS ${bracket(alias)}`
    : `CAST(NULL AS varchar(4000)) AS ${bracket(alias)}`;
}

async function main() {
  const config = loadEnv();
  const bizlinksPool = createBizlinksPool(config);
  const ychiPool = createYchiPool(config);
  await bizlinksPool.connect();
  await ychiPool.connect();

  try {
    const bizColumnsResult = await new sql.Request(bizlinksPool).query<DbColumn>(`
      SET TRANSACTION ISOLATION LEVEL READ UNCOMMITTED;

      SELECT TABLE_NAME, COLUMN_NAME, DATA_TYPE
      FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = 'dbo'
        AND (
          TABLE_NAME IN (
            'SPE_EINVOICEHEADER',
            'SPE_EINVOICEDETAIL',
            'SPE_EINVOICEHEADER_ADD',
            'SPE_EINVOICE_REFERENCE',
            'SPE_EINVOICE_RESPONSE',
            'AAA_GUIAFACTURADA',
            'AAA_TIPODOCUMENTO'
          )
          OR COLUMN_NAME LIKE '%NCND%'
          OR COLUMN_NAME LIKE '%Afect%'
          OR COLUMN_NAME LIKE '%Referencia%'
          OR COLUMN_NAME LIKE '%Motivo%'
        )
      ORDER BY TABLE_NAME, ORDINAL_POSITION;
    `);
    const bizColumns = bizColumnsResult.recordset;

    const headerSelect = [
      'SERIENUMERO',
      'TIPODOCUMENTO',
      'FECHAEMISION',
      'NUMERODOCUMENTOADQUIRIENTE',
      'RAZONSOCIALADQUIRIENTE',
      'TIPOMONEDA',
      'TOTALVALORVENTANETOOPGRAVADAS',
      'TOTALIGV',
      'TOTALVENTA',
      'ORDENCOMPRA',
      'serieNumeroAfectado',
      'tipoDocumentoAfectado',
      'MotivoNCND',
      'TipoNCND',
      'codigoSerieNumeroAfectado',
      'motivoDocumento',
      'tipoDocumentoReferenciaPrincip',
      'numeroDocumentoReferenciaPrinc',
      'numeroDocumentoReferencia_1',
      'tipoReferencia_1'
    ]
      .map((column) => selectIfExists(bizColumns, 'SPE_EINVOICEHEADER', column, column, 'h'))
      .join(',\n        ');

    const nceHeaders = await new sql.Request(bizlinksPool).query(`
      SET TRANSACTION ISOLATION LEVEL READ UNCOMMITTED;

      SELECT TOP (20)
        ${headerSelect},
        r.bl_estadoRegistro AS responseEstadoRegistro,
        r.bl_estadoProceso,
        r.process_state,
        r.bl_mensajeSunat,
        r.bl_url_pdf,
        r.bl_url_cdr
      FROM dbo.SPE_EINVOICEHEADER h
      LEFT JOIN dbo.SPE_EINVOICE_RESPONSE r
        ON r.NUMERODOCUMENTOEMISOR = h.NUMERODOCUMENTOEMISOR
       AND r.SERIENUMERO = h.SERIENUMERO
       AND r.TIPODOCUMENTO = h.TIPODOCUMENTO
      WHERE h.TIPODOCUMENTO = '07'
         OR h.SERIENUMERO LIKE 'FC03-%'
      ORDER BY h.FECHAEMISION DESC, h.SERIENUMERO DESC;
    `);

    const accepted = nceHeaders.recordset.filter((row: Record<string, unknown>) => {
      const text = Object.values(row).join(' ').toLowerCase();
      return text.includes('acept');
    });
    const sampleSeries = accepted.slice(0, 3).map((row: Record<string, unknown>) => String(row.SERIENUMERO ?? '')).filter(Boolean);

    const detailSelect = [
      'SERIENUMERO',
      'TIPODOCUMENTO',
      'NUMEROORDENITEM',
      'CODIGOPRODUCTO',
      'DESCRIPCION',
      'CANTIDAD',
      'UNIDADMEDIDA',
      'importeUnitarioSinImpuesto',
      'importeUnitarioConImpuesto',
      'importeTotalSinImpuesto',
      'importeIgv',
      'montoBaseIgv',
      'tasaIgv',
      'importeTotalImpuestos',
      'codigoRazonExoneracion'
    ]
      .map((column) => selectIfExists(bizColumns, 'SPE_EINVOICEDETAIL', column))
      .join(',\n        ');

    const details = sampleSeries.length
      ? await new sql.Request(bizlinksPool).query(`
          SET TRANSACTION ISOLATION LEVEL READ UNCOMMITTED;

          SELECT
            ${detailSelect}
          FROM dbo.SPE_EINVOICEDETAIL
          WHERE TIPODOCUMENTO = '07'
            AND SERIENUMERO IN (${sampleSeries.map((value) => `'${value.replace(/'/g, "''")}'`).join(', ')})
          ORDER BY SERIENUMERO DESC, NUMEROORDENITEM;
        `)
      : { recordset: [] };

    const references = hasColumn(bizColumns, 'SPE_EINVOICE_REFERENCE', 'SERIENUMERO')
      ? await new sql.Request(bizlinksPool).query(`
          SET TRANSACTION ISOLATION LEVEL READ UNCOMMITTED;

          SELECT TOP (80) *
          FROM dbo.SPE_EINVOICE_REFERENCE
          WHERE SERIENUMERO IN (${sampleSeries.length ? sampleSeries.map((value) => `'${value.replace(/'/g, "''")}'`).join(', ') : "''"})
             OR SERIENUMERO LIKE 'FC03-%'
          ORDER BY SERIENUMERO DESC;
        `)
      : { recordset: [] };

    const headerAdd = sampleSeries.length
      ? await new sql.Request(bizlinksPool).query(`
          SET TRANSACTION ISOLATION LEVEL READ UNCOMMITTED;

          SELECT TOP (120) *
          FROM dbo.SPE_EINVOICEHEADER_ADD
          WHERE TIPODOCUMENTO = '07'
            AND SERIENUMERO IN (${sampleSeries.map((value) => `'${value.replace(/'/g, "''")}'`).join(', ')})
          ORDER BY SERIENUMERO DESC, clave;
        `)
      : { recordset: [] };

    const guides = sampleSeries.length
      ? await new sql.Request(bizlinksPool).query(`
          SET TRANSACTION ISOLATION LEVEL READ UNCOMMITTED;

          SELECT TOP (80)
            ID,
            RUC_EMISOR,
            NRO_GUIA,
            NRO_FACTURA,
            FECHA_EMISION,
            USUARIO,
            ESTADO,
            NOTACRE
          FROM dbo.AAA_GUIAFACTURADA
          WHERE NOTACRE IN (${sampleSeries.map((value) => `'${value.replace(/'/g, "''")}'`).join(', ')})
          ORDER BY ID DESC;
        `)
      : { recordset: [] };

    const bizObjects = await new sql.Request(bizlinksPool).query(`
      SET TRANSACTION ISOLATION LEVEL READ UNCOMMITTED;

      SELECT o.name, o.type_desc
      FROM sys.objects o
      LEFT JOIN sys.sql_modules m ON m.object_id = o.object_id
      WHERE o.name LIKE '%NC%'
         OR o.name LIKE '%CRED%'
         OR o.name LIKE '%FC03%'
         OR o.name LIKE '%EINVOICE%'
         OR m.definition LIKE '%MotivoNCND%'
         OR m.definition LIKE '%TipoNCND%'
         OR m.definition LIKE '%FC03%'
      ORDER BY o.type_desc, o.name;
    `);

    const ychiObjects = await new sql.Request(ychiPool).query(`
      SET TRANSACTION ISOLATION LEVEL READ UNCOMMITTED;

      SELECT o.name, o.type_desc
      FROM sys.objects o
      LEFT JOIN sys.sql_modules m ON m.object_id = o.object_id
      WHERE o.name LIKE '%NC%'
         OR o.name LIKE '%CRED%'
         OR o.name LIKE '%FC03%'
         OR m.definition LIKE '%FC03%'
         OR m.definition LIKE '%NOTA%'
         OR m.definition LIKE '%CREDITO%'
      ORDER BY o.type_desc, o.name;
    `);

    const ychiDocs = await new sql.Request(ychiPool).query(`
      SET TRANSACTION ISOLATION LEVEL READ UNCOMMITTED;

      SELECT TOP (40)
        d.idDocumento,
        d.idTipoDocu,
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
        d.nguia,
        c.RUC,
        c.Nombre AS clienteNombre
      FROM dbo.tbDocumentos d
      LEFT JOIN dbo.tbClieProv c
        ON c.idClieProv = d.idClieProv
      WHERE d.SeriDocu IN ('FC03', 'C03')
      ORDER BY d.FechaCreacion DESC, d.NumeDocu DESC;
    `);

    const ychiTypes = await new sql.Request(ychiPool).query(`
      SET TRANSACTION ISOLATION LEVEL READ UNCOMMITTED;

      SELECT *
      FROM dbo.tbTipoDocu
      ORDER BY idTipoDocu;
    `);

    console.log(JSON.stringify({
      safety: 'READ_ONLY',
      bizlinksColumns: bizColumns,
      bizlinksRecentCreditNotes: nceHeaders.recordset,
      bizlinksAcceptedSampleSeries: sampleSeries,
      bizlinksAcceptedSampleDetails: details.recordset,
      bizlinksAcceptedSampleReferences: references.recordset,
      bizlinksAcceptedSampleHeaderAdd: headerAdd.recordset,
      bizlinksGuideInvoiceCreditNoteLinks: guides.recordset,
      bizlinksCandidateObjects: bizObjects.recordset,
      ychidb3CandidateObjects: ychiObjects.recordset,
      ychidb3RecentCreditNotes: ychiDocs.recordset,
      ychidb3CreditNoteTypes: ychiTypes.recordset
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
