import { loadEnv } from '../../src/config/env.js';
import { createYchiPool, sql } from '../../src/integrations/bizlinksSql.js';

const ot = process.argv[2]?.trim() || '02600674';
const addressHint = process.argv[3]?.trim() || 'SEPARADORA';

async function main() {
  const config = loadEnv();
  const pool = createYchiPool(config);

  await pool.connect();

  try {
    const request = new sql.Request(pool);
    const searchTerms = buildOtSearchTerms(ot);
    const searchParams = searchTerms.map((term, index) => {
      const name = `ot${index}`;
      request.input(name, sql.VarChar(50), term);
      return `@${name}`;
    });
    request.input('addressHint', sql.NVarChar(100), `%${addressHint}%`);

    const otRows = await request.query(`
      SELECT TOP (20)
        ot.numero AS numeroOt,
        b.PROFORMA AS proforma,
        b.[RAZON SOCIAL] AS razonSocial,
        b.IDOT,
        b.idDetOrdenVenta,
        b.idOrdenVenta,
        ot.idOrdenTrabajo
      FROM dbo.tbOrdenTrabajo ot
      LEFT JOIN dbo.VW_BUSCAS_DOCUMENTOS b
        ON b.IDOT = ot.idOrdenTrabajo
      WHERE ot.numero IN (${searchParams.join(', ')})
      ORDER BY ot.idOrdenTrabajo DESC, b.idOrdenVenta DESC;
    `);

    const orderIds = [...new Set(
      otRows.recordset
        .map((row: any) => row.idOrdenVenta)
        .filter((id: unknown): id is number => Number.isInteger(id))
    )];

    const productRequest = new sql.Request(pool);
    const orderParams = orderIds.map((id, index) => {
      const name = `order${index}`;
      productRequest.input(name, sql.Int, id);
      return `@${name}`;
    });

    const products = orderParams.length === 0
      ? { recordset: [] }
      : await productRequest.query(`
        SELECT TOP (200)
          idDetGuia,
          idOrdenVenta,
          idDocumentos,
          FORMATO,
          MEDIDA,
          PAPEL,
          UNIDAD,
          Cantidad,
          NumeroDel,
          NumeroAl,
          Serie
        FROM dbo.VW_DETGUIA_REMISION
        WHERE idOrdenVenta IN (${orderParams.join(', ')})
          AND ISNULL(idDocumentos, 0) > 0
        ORDER BY idOrdenVenta, idDetGuia;
      `);

    const documentIds = [...new Set(
      products.recordset
        .map((row: any) => row.idDocumentos)
        .filter((id: unknown): id is number => Number.isInteger(id))
    )];

    const docRequest = new sql.Request(pool);
    const idParams = documentIds.map((id, index) => {
      const name = `id${index}`;
      docRequest.input(name, sql.Int, id);
      return `@${name}`;
    });

    const documents = idParams.length === 0
      ? { recordset: [] }
      : await docRequest.query(`
        SELECT TOP (50)
          doc.idDocumento,
          doc.idTipoDocu,
          doc.SeriDocu,
          doc.NumeDocu,
          doc.DescClieProv,
          doc.idClieProv,
          c.RUC,
          c.Nombre,
          c.Direccion AS direccionPrincipal,
          c.ubigeo AS ubigeoCliente,
          dpto.nombre AS departamento,
          prov.nombre AS provincia,
          dist.nombre AS distrito
        FROM dbo.tbDocumentos doc
        LEFT JOIN dbo.tbClieProv c
          ON c.idClieProv = doc.idClieProv
        LEFT JOIN dbo.tbDepartamento dpto
          ON dpto.idDepartamento = c.idDepartamento
        LEFT JOIN dbo.tbProvincia prov
          ON prov.idProvincia = c.IdProvincia
        LEFT JOIN dbo.tbDistrito dist
          ON dist.idDistrito = c.IdDistrito
        WHERE doc.idDocumento IN (${idParams.join(', ')})
        ORDER BY doc.idDocumento DESC;
      `);

    const clientIds = [...new Set(
      documents.recordset
        .map((row: any) => row.idClieProv)
        .filter((id: unknown): id is number => Number.isInteger(id))
    )];

    const addressRequest = new sql.Request(pool);
    const clientParams = clientIds.map((id, index) => {
      const name = `client${index}`;
      addressRequest.input(name, sql.Int, id);
      return `@${name}`;
    });
    addressRequest.input('addressHint', sql.NVarChar(100), `%${addressHint}%`);

    const clientAddresses = clientParams.length === 0
      ? { recordset: [] }
      : await addressRequest.query(`
        SELECT
          'principal' AS origen,
          c.idClieProv,
          CAST(NULL AS int) AS idClieDireccion,
          c.RUC,
          c.Nombre,
          c.Direccion AS direccion,
          c.ubigeo,
          dpto.nombre AS departamento,
          prov.nombre AS provincia,
          dist.nombre AS distrito
        FROM dbo.tbClieProv c
        LEFT JOIN dbo.tbDepartamento dpto
          ON dpto.idDepartamento = c.idDepartamento
        LEFT JOIN dbo.tbProvincia prov
          ON prov.idProvincia = c.IdProvincia
        LEFT JOIN dbo.tbDistrito dist
          ON dist.idDistrito = c.IdDistrito
        WHERE c.idClieProv IN (${clientParams.join(', ')})

        UNION ALL

        SELECT
          'tbcliedireccion' AS origen,
          cd.idclieprov AS idClieProv,
          cd.idcliedireccion AS idClieDireccion,
          c.RUC,
          c.Nombre,
          cd.direccion,
          c.ubigeo,
          dpto.nombre AS departamento,
          prov.nombre AS provincia,
          dist.nombre AS distrito
        FROM dbo.tbcliedireccion cd
        INNER JOIN dbo.tbClieProv c
          ON c.idClieProv = cd.idclieprov
        LEFT JOIN dbo.tbDepartamento dpto
          ON dpto.idDepartamento = c.idDepartamento
        LEFT JOIN dbo.tbProvincia prov
          ON prov.idProvincia = c.IdProvincia
        LEFT JOIN dbo.tbDistrito dist
          ON dist.idDistrito = c.IdDistrito
        WHERE cd.idclieprov IN (${clientParams.join(', ')})
        ORDER BY origen, idClieDireccion;
      `);

    const documentColumns = await request.query(`
      SELECT COLUMN_NAME
      FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = 'dbo'
        AND TABLE_NAME = 'tbDocumentos'
        AND (
          COLUMN_NAME COLLATE Latin1_General_CI_AI LIKE '%dire%'
          OR COLUMN_NAME COLLATE Latin1_General_CI_AI LIKE '%lugar%'
          OR COLUMN_NAME COLLATE Latin1_General_CI_AI LIKE '%ubigeo%'
          OR COLUMN_NAME COLLATE Latin1_General_CI_AI LIKE '%entrega%'
          OR COLUMN_NAME COLLATE Latin1_General_CI_AI LIKE '%dest%'
        )
      ORDER BY ORDINAL_POSITION;
    `);

    const detGuiaColumns = await request.query(`
      SELECT COLUMN_NAME
      FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = 'dbo'
        AND TABLE_NAME = 'VW_DETGUIA_REMISION'
        AND (
          COLUMN_NAME COLLATE Latin1_General_CI_AI LIKE '%dire%'
          OR COLUMN_NAME COLLATE Latin1_General_CI_AI LIKE '%lugar%'
          OR COLUMN_NAME COLLATE Latin1_General_CI_AI LIKE '%ubigeo%'
          OR COLUMN_NAME COLLATE Latin1_General_CI_AI LIKE '%entrega%'
          OR COLUMN_NAME COLLATE Latin1_General_CI_AI LIKE '%dest%'
        )
      ORDER BY ORDINAL_POSITION;
    `);

    const addressMatches = await request.query(`
      SELECT TOP (50)
        'tbClieProv' AS origen,
        c.idClieProv,
        CAST(NULL AS int) AS idClieDireccion,
        c.RUC,
        c.Nombre,
        c.Direccion AS direccion,
        c.ubigeo
      FROM dbo.tbClieProv c
      WHERE c.Direccion LIKE @addressHint

      UNION ALL

      SELECT TOP (50)
        'tbcliedireccion' AS origen,
        cd.idclieprov AS idClieProv,
        cd.idcliedireccion AS idClieDireccion,
        c.RUC,
        c.Nombre,
        cd.direccion,
        c.ubigeo
      FROM dbo.tbcliedireccion cd
      INNER JOIN dbo.tbClieProv c
        ON c.idClieProv = cd.idclieprov
      WHERE cd.direccion LIKE @addressHint
      ORDER BY origen, idClieProv, idClieDireccion;
    `);

    console.log(JSON.stringify({
      ot,
      searchTerms,
      otRows: otRows.recordset,
      products: products.recordset,
      documents: documents.recordset,
      documentAddressColumns: documentColumns.recordset.map((row: any) => row.COLUMN_NAME),
      detGuiaAddressColumns: detGuiaColumns.recordset.map((row: any) => row.COLUMN_NAME),
      clientAddresses: clientAddresses.recordset,
      addressMatches: addressMatches.recordset
    }, null, 2));
  } finally {
    await pool.close();
  }
}

function buildOtSearchTerms(input: string) {
  const trimmed = input.trim();
  const normalized = trimmed.toUpperCase().replace(/\s+/g, '');
  const terms = new Set<string>([trimmed, normalized]);
  const digits = normalized.replace(/\D+/g, '');

  if (digits) {
    terms.add(digits);
    terms.add(`OT${digits}`);
    terms.add(`OT0${digits}`);
  }

  return [...terms].filter(Boolean);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
