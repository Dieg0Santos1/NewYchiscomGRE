import { loadEnv } from '../../src/config/env.js';
import { createBizlinksPool, createYchiPool, sql } from '../../src/integrations/bizlinksSql.js';

async function main() {
  const config = loadEnv();
  const bizlinks = createBizlinksPool(config);
  const ychi = createYchiPool(config);
  await bizlinks.connect();
  await ychi.connect();

  try {
    const biz = await new sql.Request(bizlinks).query(`
      SET TRANSACTION ISOLATION LEVEL READ UNCOMMITTED;

      SELECT TABLE_NAME, COLUMN_NAME, DATA_TYPE, CHARACTER_MAXIMUM_LENGTH
      FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_NAME IN ('SPE_EINVOICEHEADER', 'SPE_EINVOICEDETAIL', 'AAA_GUIAFACTURADA')
        AND (
          COLUMN_NAME LIKE '%GUIA%'
          OR COLUMN_NAME LIKE '%AUXILIAR250%'
          OR COLUMN_NAME LIKE '%ORDEN%'
        )
      ORDER BY TABLE_NAME, COLUMN_NAME;

      SELECT p.name AS procedureName, param.name AS parameterName,
        TYPE_NAME(param.user_type_id) AS typeName,
        param.max_length AS maxLength,
        param.precision,
        param.scale
      FROM sys.parameters param
      INNER JOIN sys.objects p ON p.object_id = param.object_id
      WHERE p.name IN ('USP_CabeceraFE', 'USP_DetalleFE', 'USP_EnviaDocumentoFE')
        AND (
          param.name LIKE '%GUIA%'
          OR param.name LIKE '%AUXILIAR250%'
          OR param.name LIKE '%ORDEN%'
        )
      ORDER BY p.name, param.parameter_id;

      SELECT TOP (20) h.SERIENUMERO,
        COUNT(DISTINCT gf.NRO_GUIA) AS linkedGuides,
        COUNT(DISTINCT d.textoAuxiliar250_1) AS detailGuideRefs
      FROM dbo.SPE_EINVOICEHEADER h
      LEFT JOIN dbo.AAA_GUIAFACTURADA gf
        ON gf.NRO_FACTURA = h.SERIENUMERO
      LEFT JOIN dbo.SPE_EINVOICEDETAIL d
        ON d.SERIENUMERO = h.SERIENUMERO
       AND d.TIPODOCUMENTO = h.TIPODOCUMENTO
       AND d.NUMERODOCUMENTOEMISOR = h.NUMERODOCUMENTOEMISOR
      WHERE h.TIPODOCUMENTO = '01'
        AND h.SERIENUMERO LIKE 'FF01-%'
      GROUP BY h.SERIENUMERO
      HAVING COUNT(DISTINCT gf.NRO_GUIA) > 1
          OR COUNT(DISTINCT d.textoAuxiliar250_1) > 1
      ORDER BY h.SERIENUMERO DESC;
    `);

    const ychiResult = await new sql.Request(ychi).query(`
      SET TRANSACTION ISOLATION LEVEL READ UNCOMMITTED;
      SELECT TOP (20)
        idDocumento,
        SeriDocu,
        NumeDocu,
        nguia,
        LEN(ISNULL(nguia, '')) AS nguiaLength,
        (LEN(ISNULL(nguia, '')) - LEN(REPLACE(ISNULL(nguia, ''), ',', '')) + 1) AS guidePieces
      FROM dbo.tbDocumentos
      WHERE idTipoDocu = 1
        AND SeriDocu = 'F01'
        AND ISNULL(nguia, '') LIKE '%,%'
      ORDER BY FechaEmision DESC, idDocumento DESC;
    `);

    const [columns, params, multiBizlinks] = biz.recordsets;

    console.log(JSON.stringify({
      safety: 'READ_ONLY',
      bizlinksColumns: columns,
      procedureParameters: params,
      acceptedMultiGuideExamples: multiBizlinks,
      legacyMultiGuideExamples: ychiResult.recordset
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
