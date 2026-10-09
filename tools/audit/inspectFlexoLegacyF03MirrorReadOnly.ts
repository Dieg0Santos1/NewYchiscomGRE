import { loadEnv } from '../../src/config/env.js';
import { createBizlinksPool, createYchiPool, sql } from '../../src/integrations/bizlinksSql.js';

const legacyNumero = process.argv[2]?.trim() || '0005932';
const bizlinksFactura = process.argv[3]?.trim().toUpperCase() || 'FF03-00011208';

function printSection(title: string, value: unknown) {
  console.log(`\n=== ${title} ===`);
  console.log(JSON.stringify(value, null, 2));
}

async function main() {
  const config = loadEnv();
  const ychi = createYchiPool(config);
  const bizlinksPool = createBizlinksPool(config);
  await ychi.connect();
  await bizlinksPool.connect();

  try {
    const legacyHeader = await new sql.Request(ychi)
      .input('legacyNumero', sql.VarChar(20), legacyNumero)
      .query(`
        SET TRANSACTION ISOLATION LEVEL READ UNCOMMITTED;
        SELECT TOP (1)
          d.*,
          c.RUC,
          c.Nombre AS clienteNombre,
          c.idempleado AS vendedorCliente,
          fp.Nombre AS formaPagoNombre,
          fp.Valor AS formaPagoValor,
          fp.Descripcion AS formaPagoDias
        FROM dbo.tbDocumentos d
        LEFT JOIN dbo.tbClieProv c ON c.idClieProv = d.idClieProv
        LEFT JOIN dbo.tbPropiedades fp ON fp.idPropiedades = d.formaPago
        WHERE d.idTipoDocu = 38
          AND d.SeriDocu = 'F03'
          AND d.NumeDocu = @legacyNumero;
      `);

    const idDocumento = legacyHeader.recordset[0]?.idDocumento;

    const detail = idDocumento
      ? await new sql.Request(ychi)
        .input('idDocumento', sql.Int, idDocumento)
        .query(`
          SET TRANSACTION ISOLATION LEVEL READ UNCOMMITTED;
          SELECT *
          FROM dbo.tbDetFact
          WHERE idDocumento = @idDocumento
          ORDER BY idDetFact;
        `)
      : { recordset: [] };

    const detailColumns = await new sql.Request(ychi).query(`
      SET TRANSACTION ISOLATION LEVEL READ UNCOMMITTED;
      SELECT COLUMN_NAME, DATA_TYPE, CHARACTER_MAXIMUM_LENGTH, NUMERIC_PRECISION, NUMERIC_SCALE, IS_NULLABLE
      FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_NAME = 'tbDetFact'
      ORDER BY ORDINAL_POSITION;
    `);

    const tipoDocu = await new sql.Request(ychi).query(`
      SET TRANSACTION ISOLATION LEVEL READ UNCOMMITTED;
      SELECT *
      FROM dbo.tbTipoDocu
      WHERE idTipoDocu IN (38, 43)
         OR serie IN ('F03', 'FF03')
      ORDER BY idTipoDocu;
    `);

    const reportProcedures = await new sql.Request(ychi).query(`
      SET TRANSACTION ISOLATION LEVEL READ UNCOMMITTED;
      SELECT TOP (80)
        SCHEMA_NAME(o.schema_id) AS schemaName,
        o.name AS objectName,
        o.type_desc AS objectType,
        CASE
          WHEN m.definition LIKE '%idTipoDocu = 38%' THEN 'idTipoDocu = 38'
          WHEN m.definition LIKE '%idTipoDocu=38%' THEN 'idTipoDocu=38'
          WHEN m.definition LIKE '%F03%' THEN 'F03'
          WHEN m.definition LIKE '%tbDetFact%' THEN 'tbDetFact'
          ELSE 'match'
        END AS matchedBy
      FROM sys.objects o
      INNER JOIN sys.sql_modules m ON m.object_id = o.object_id
      WHERE (
          m.definition LIKE '%idTipoDocu = 38%'
          OR m.definition LIKE '%idTipoDocu=38%'
          OR m.definition LIKE '%F03%'
          OR (m.definition LIKE '%tbDocumentos%' AND m.definition LIKE '%tbDetFact%' AND m.definition LIKE '%comision%')
          OR o.name LIKE '%COMISION%'
          OR o.name LIKE '%FF03%'
        )
        AND o.name NOT LIKE 'dt_%'
      ORDER BY o.type_desc, o.name;
    `);

    const bizlinks = await new sql.Request(bizlinksPool)
      .input('factura', sql.VarChar(20), bizlinksFactura)
      .query(`
        SET TRANSACTION ISOLATION LEVEL READ UNCOMMITTED;
        SELECT
          h.SERIENUMERO,
          h.FECHAEMISION,
          h.NUMERODOCUMENTOADQUIRIENTE,
          h.RAZONSOCIALADQUIRIENTE,
          h.TIPOMONEDA,
          h.TOTALVALORVENTANETOOPGRAVADAS,
          h.TOTALIGV,
          h.TOTALVENTA,
          rc.cuenta,
          gf.NRO_GUIA,
          r.bl_estadoProceso,
          r.bl_mensajeSunat
        FROM dbo.SPE_EINVOICEHEADER h
        LEFT JOIN dbo.AAA_REGISTRO_CONTABLE rc
          ON rc.serieNumero = h.SERIENUMERO
         AND rc.tipoDoc = h.TIPODOCUMENTO
        LEFT JOIN dbo.AAA_GUIAFACTURADA gf
          ON gf.NRO_FACTURA = h.SERIENUMERO
        LEFT JOIN dbo.SPE_EINVOICE_RESPONSE r
          ON r.SERIENUMERO = h.SERIENUMERO
         AND r.TIPODOCUMENTO = h.TIPODOCUMENTO
         AND r.NUMERODOCUMENTOEMISOR = h.NUMERODOCUMENTOEMISOR
        WHERE h.SERIENUMERO = @factura
          AND h.TIPODOCUMENTO = '01';
      `);

    printSection('Safety', { mode: 'READ_ONLY', legacyNumero, bizlinksFactura });
    printSection('YCHIDB3 F03 header', legacyHeader.recordset);
    printSection('YCHIDB3 F03 tbDetFact', detail.recordset);
    printSection('YCHIDB3 tbDetFact columns', detailColumns.recordset);
    printSection('YCHIDB3 tbTipoDocu F03 candidates', tipoDocu.recordset);
    printSection('YCHIDB3 consumers/report procedures', reportProcedures.recordset);
    printSection('Bizlinks FF03 reference', bizlinks.recordset);
  } finally {
    await bizlinksPool.close();
    await ychi.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
