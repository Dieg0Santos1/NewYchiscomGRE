import { loadEnv } from '../../src/config/env.js';
import { createBizlinksPool, createYchiPool, sql } from '../../src/integrations/bizlinksSql.js';

const targetFactura = process.argv[2]?.trim().toUpperCase() || 'FF03-00011208';

async function main() {
  const config = loadEnv();
  const bizlinks = createBizlinksPool(config);
  const ychi = createYchiPool(config);
  await bizlinks.connect();
  await ychi.connect();

  try {
    const invoice = await loadBizlinksInvoice(bizlinks, targetFactura);
    const first = invoice.header[0];
    const guides = invoice.guides.map((row) => row.NRO_GUIA).filter(Boolean);
    const right8 = targetFactura.split('-')[1] ?? '';
    const right7 = right8.slice(-7);
    const right6 = right8.slice(-6);

    const byNumber = await query(ychi, `
      SELECT TOP (80)
        d.*
      FROM dbo.tbDocumentos d
      WHERE d.SeriDocu IN ('F03', 'FF03', 'F3')
         OR d.NumeDocu IN (@right8, @right7, @right6)
         OR d.NumeDocu LIKE '%' + @right6
      ORDER BY d.FechaCreacion DESC;
    `, { right8, right7, right6 });

    const byBusiness = first
      ? await query(ychi, `
          SELECT TOP (120)
            d.*
          FROM dbo.tbDocumentos d
          LEFT JOIN dbo.tbClieProv c
            ON c.idClieProv = d.idClieProv
          WHERE d.idTipoDocu = 1
            AND (
              c.RUC = @ruc
              OR d.DescClieProv LIKE '%' + @cliente + '%'
              OR ABS(CONVERT(float, d.Total) - CONVERT(float, @total)) < 0.05
              OR ABS(CONVERT(float, d.Neto) - CONVERT(float, @neto)) < 0.05
              OR d.nguia IN (${guides.length > 0 ? guides.map((_, index) => `@guia${index}`).join(', ') : `''`})
              OR ${guides.length > 0 ? guides.map((_, index) => `d.nguia LIKE '%' + @guia${index} + '%'`).join(' OR ') : '1 = 0'}
            )
            AND d.FechaEmision >= DATEADD(day, -10, @fecha)
            AND d.FechaEmision < DATEADD(day, 10, @fecha)
          ORDER BY d.FechaCreacion DESC;
        `, {
          ruc: first.numeroDocumentoAdquiriente ?? '',
          cliente: (first.razonSocialAdquiriente ?? '').slice(0, 40),
          total: String(first.totalVenta ?? 0),
          neto: String(first.totalValorVentaNetoOpGravadas ?? 0),
          fecha: first.fechaEmision ?? '',
          ...Object.fromEntries(guides.map((guide, index) => [`guia${index}`, guide]))
        })
      : [];

    const candidateIds = [...new Set([...byNumber, ...byBusiness].map((row: any) => row.idDocumento).filter(Boolean))];
    const details = candidateIds.length > 0
      ? await queryWithList(ychi, `
          SELECT *
          FROM dbo.tbDetFact
          WHERE idDocumento IN (__LIST__)
          ORDER BY idDocumento, numorden, idDetFact;
        `, 'idDocumento', candidateIds.map(String))
      : [];

    const nearbyTypes = await query(ychi, `
      SELECT TOP (80)
        t.*
      FROM dbo.tbTipoDocu t
      WHERE t.SeriDocu LIKE '%03%'
         OR t.Descripcion LIKE '%fact%'
         OR t.Nombre LIKE '%fact%'
      ORDER BY t.idTipoDocu;
    `).catch((error) => [{ error: error instanceof Error ? error.message : String(error) }]);

    const candidateProcedures = await query(ychi, `
      SELECT
        o.type_desc,
        s.name AS schemaName,
        o.name,
        m.definition
      FROM sys.objects o
      INNER JOIN sys.schemas s ON s.schema_id = o.schema_id
      INNER JOIN sys.sql_modules m ON m.object_id = o.object_id
      WHERE o.type IN ('P', 'FN', 'IF', 'TF', 'V')
        AND (
          m.definition LIKE '%tbDocumentos%'
          OR m.definition LIKE '%tbDetFact%'
          OR m.definition LIKE '%F03%'
          OR m.definition LIKE '%FF03%'
          OR m.definition LIKE '%comision%'
          OR m.definition LIKE '%vendedor%'
        )
      ORDER BY o.type_desc, o.name;
    `).catch((error) => [{ error: error instanceof Error ? error.message : String(error) }]);

    console.log(JSON.stringify({
      safety: 'READ_ONLY',
      targetFactura,
      bizlinks: {
        header: invoice.header,
        guides: invoice.guides,
        detailCount: invoice.detail.length
      },
      searches: {
        byNumber: byNumber.map(summarizeDocument),
        byBusiness: byBusiness.map(summarizeDocument),
        details,
        nearbyTypes: nearbyTypes.map((row: any) => ({
          idTipoDocu: row.idTipoDocu,
          SeriDocu: row.SeriDocu,
          NumeDocu: row.NumeDocu,
          Descripcion: row.Descripcion,
          Nombre: row.Nombre
        })),
        candidateProcedures: candidateProcedures.map((row: any) => ({
          type_desc: row.type_desc,
          schemaName: row.schemaName,
          name: row.name,
          definitionSnippet: row.definition ? String(row.definition).slice(0, 260).replace(/\s+/g, ' ') : row.error
        }))
      }
    }, null, 2));
  } finally {
    await ychi.close();
    await bizlinks.close();
  }
}

function summarizeDocument(row: any) {
  return {
    idDocumento: row.idDocumento,
    idTipoDocu: row.idTipoDocu,
    idEmpleado: row.idEmpleado,
    idClieProv: row.idClieProv,
    SeriDocu: row.SeriDocu,
    NumeDocu: row.NumeDocu,
    DescClieProv: row.DescClieProv,
    formaPago: row.formaPago,
    Moneda: row.Moneda,
    Tica: row.Tica,
    Neto: row.Neto,
    Igv: row.Igv,
    Total: row.Total,
    Observaciones: row.Observaciones,
    FechaEmision: row.FechaEmision,
    FechaCreacion: row.FechaCreacion,
    FechaVencimiento: row.FechaVencimiento,
    Estado: row.Estado,
    cuenta: row.cuenta,
    origen: row.origen,
    negociable: row.negociable,
    web: row.web,
    llevacomp: row.llevacomp,
    nguia: row.nguia,
    CORREO: row.CORREO
  };
}

async function loadBizlinksInvoice(pool: sql.ConnectionPool, factura: string) {
  const header = await query<any>(pool, `
    SELECT TOP (1)
      h.SERIENUMERO,
      h.FECHAEMISION,
      h.NUMERODOCUMENTOADQUIRIENTE,
      h.RAZONSOCIALADQUIRIENTE,
      h.TIPOMONEDA,
      h.TOTALVALORVENTANETOOPGRAVADAS,
      h.TOTALIGV,
      h.TOTALVENTA
    FROM dbo.SPE_EINVOICEHEADER h
    WHERE h.SERIENUMERO = @factura
      AND h.TIPODOCUMENTO = '01';
  `, { factura });

  const detail = await query<any>(pool, `
    SELECT *
    FROM dbo.SPE_EINVOICEDETAIL
    WHERE SERIENUMERO = @factura
      AND TIPODOCUMENTO = '01'
    ORDER BY CASE WHEN ISNUMERIC(NUMEROORDENITEM) = 1 THEN CONVERT(int, NUMEROORDENITEM) ELSE 9999 END;
  `, { factura });

  const guides = await query<any>(pool, `
    SELECT *
    FROM dbo.AAA_GUIAFACTURADA
    WHERE NRO_FACTURA = @factura
    ORDER BY ID;
  `, { factura });

  return { header, detail, guides };
}

async function query<T = Record<string, unknown>>(
  pool: sql.ConnectionPool,
  text: string,
  inputs: Record<string, string> = {}
) {
  const request = new sql.Request(pool);
  for (const [name, value] of Object.entries(inputs)) {
    request.input(name, sql.VarChar(120), value);
  }
  const result = await request.query<T>(`
    SET TRANSACTION ISOLATION LEVEL READ UNCOMMITTED;
    ${text}
  `);
  return result.recordset;
}

async function queryWithList<T = Record<string, unknown>>(
  pool: sql.ConnectionPool,
  text: string,
  listParamPrefix: string,
  values: string[]
) {
  const request = new sql.Request(pool);
  const params = values.map((value, index) => {
    const name = `${listParamPrefix}${index}`;
    request.input(name, sql.Int, Number(value));
    return `@${name}`;
  });
  const result = await request.query<T>(`
    SET TRANSACTION ISOLATION LEVEL READ UNCOMMITTED;
    ${text.replace('__LIST__', params.join(', '))}
  `);
  return result.recordset;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
