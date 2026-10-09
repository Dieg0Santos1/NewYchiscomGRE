import { loadEnv } from '../../src/config/env.js';
import { createBizlinksPool, createYchiPool, sql } from '../../src/integrations/bizlinksSql.js';

const explicitFactura = process.argv[2]?.trim().toUpperCase();

async function main() {
  const config = loadEnv();
  const bizlinksPool = createBizlinksPool(config);
  const ychiPool = createYchiPool(config);

  await bizlinksPool.connect();
  await ychiPool.connect();

  try {
    const factura = explicitFactura ?? await findAcceptedFlexoInvoice(bizlinksPool);
    if (!factura) {
      console.log(JSON.stringify({ error: 'No se encontro FF03 aceptada con guia vinculada.' }, null, 2));
      return;
    }

    const guides = await query(bizlinksPool, `
      SELECT
        g.ID,
        g.RUC_EMISOR,
        g.NRO_GUIA,
        g.NRO_FACTURA,
        CONVERT(varchar(19), g.FECHA_EMISION, 120) AS FECHA_EMISION,
        g.USUARIO,
        g.ESTADO,
        g.NOTACRE
      FROM dbo.AAA_GUIAFACTURADA g
      WHERE g.NRO_FACTURA = @factura
      ORDER BY g.ID
    `, { factura });

    const guideSeries = guides.map((row: any) => row.NRO_GUIA).filter(Boolean);
    const headerColumns = await existingColumns(bizlinksPool, 'SPE_EINVOICEHEADER', [
      'SERIENUMERO',
      'TIPODOCUMENTO',
      'BL_ESTADOREGISTRO',
      'BL_REINTENTO',
      'BL_ORIGEN',
      'BL_HASFILERESPONSE',
      'FECHAEMISION',
      'horaEmision',
      'NUMERODOCUMENTOEMISOR',
      'TIPODOCUMENTOEMISOR',
      'RAZONSOCIALEMISOR',
      'NOMBRECOMERCIALEMISOR',
      'numeroDocumentoAdquiriente',
      'tipoDocumentoAdquiriente',
      'razonSocialAdquiriente',
      'correoAdquiriente',
      'direccionAdquiriente',
      'ubigeoAdquiriente',
      'tipoMoneda',
      'tipocambio',
      'totalValorVentaNetoOpGravadas',
      'totalValorVentaNetoOpExoneradas',
      'totalValorVentaNetoOpNoGravada',
      'totalIgv',
      'totalImpuestos',
      'totalVenta',
      'tipoOperacion',
      'GUIAREMISION',
      'TIPOGUIAREMISION',
      'ORDENCOMPRA',
      'formapago',
      'facturaPagoNegociable',
      'codigoDetraccion',
      'porcentajeDetraccion',
      'totalDetraccion',
      'fechaVencimiento',
      'montoNetoPendiente',
      'montoPagoCuota1',
      'fechaPagoCuota1',
      'codigoLeyenda_1',
      'textoLeyenda_1'
    ]);

    const detailColumns = await existingColumns(bizlinksPool, 'SPE_EINVOICEDETAIL', [
      'NUMEROORDENITEM',
      'CANTIDAD',
      'unidadMedida',
      'CODIGOPRODUCTO',
      'codigoProductoSUNAT',
      'descripcion',
      'CODIGORAZONEXONERACION',
      'importeUnitarioSinImpuesto',
      'importeUnitarioConImpuesto',
      'importeTotalSinImpuesto',
      'importeIgv',
      'tasaIgv',
      'importeTotalImpuestos',
      'montoBaseIgv',
      'textoAuxiliar250_1'
    ]);

    const header = await query(bizlinksPool, `
      SELECT TOP (1)
        ${headerColumns.map((column) => `h.[${column}]`).join(',\n        ')},
        r.bl_estadoRegistro AS responseEstadoRegistro,
        r.bl_estadoProceso,
        r.process_state,
        r.bl_mensajeSunat,
        r.bl_mensaje,
        r.bl_url_pdf
      FROM dbo.SPE_EINVOICEHEADER h
      LEFT JOIN dbo.SPE_EINVOICE_RESPONSE r
        ON r.tipoDocumentoEmisor = h.tipoDocumentoEmisor
       AND r.numeroDocumentoEmisor = h.numeroDocumentoEmisor
       AND r.serieNumero = h.serieNumero
       AND r.tipoDocumento = h.tipoDocumento
      WHERE h.SERIENUMERO = @factura
        AND h.TIPODOCUMENTO = '01'
    `, { factura });

    const detail = await query(bizlinksPool, `
      SELECT
        ${detailColumns.map((column) => `d.[${column}]`).join(',\n        ')}
      FROM dbo.SPE_EINVOICEDETAIL d
      WHERE d.SERIENUMERO = @factura
        AND d.TIPODOCUMENTO = '01'
      ORDER BY CASE WHEN ISNUMERIC(d.NUMEROORDENITEM) = 1 THEN CONVERT(int, d.NUMEROORDENITEM) ELSE 9999 END
    `, { factura });

    const add = await query(bizlinksPool, `
      SELECT clave, valor
      FROM dbo.SPE_EINVOICEHEADER_ADD
      WHERE SERIENUMERO = @factura
        AND TIPODOCUMENTO = '01'
      ORDER BY clave
    `, { factura });

    const registroContable = await query(bizlinksPool, `
      SELECT *
      FROM dbo.AAA_REGISTRO_CONTABLE
      WHERE serieNumero = @factura
         OR serieNumero = REPLACE(@factura, 'FF03-', 'F03-')
      ORDER BY id DESC
    `, { factura });

    const empaqueLinks = guideSeries.length > 0
      ? await queryWithList(bizlinksPool, `
          SELECT
            d.CODIGOEMPAQUE,
            d.CODIGOPRODUCTO,
            d.DESCRIPCION,
            d.CANTIDAD,
            d.UNIDADMEDIDA,
            d.MONEDA,
            d.SERIENUMEROGUIAREMISION,
            d.ORDENGUIA,
            d.SERIENUMEROGUIAFACTURA,
            d.ORDENFACTURA
          FROM dbo.EMPAQUE_DETALLE d
          WHERE d.SERIENUMEROGUIAFACTURA = @factura
             OR d.SERIENUMEROGUIAREMISION IN (__LIST__)
          ORDER BY d.SERIENUMEROGUIAREMISION, d.ORDENGUIA, d.ORDENFACTURA, d.CODIGOEMPAQUE, d.CODIGOPRODUCTO
        `, 'serie', guideSeries, { factura })
      : [];

    const ychiscom = await query(ychiPool, `
      SELECT TOP (20)
        idDocumento,
        idTipoDocu,
        SeriDocu,
        NumeDocu,
        DescClieProv,
        Neto,
        Igv,
        Total,
        FechaEmision,
        FechaCreacion,
        Estado,
        cuenta,
        nguia
      FROM dbo.tbDocumentos
      WHERE (SeriDocu IN ('FF03', 'F03') AND NumeDocu LIKE '%' + RIGHT(@factura, 6))
         OR nguia LIKE '%' + @factura + '%'
      ORDER BY FechaCreacion DESC
    `, { factura });

    const tipoDocumento = await query(bizlinksPool, `
      SELECT NUMERODOCUMENTOEMISOR, TIPODOCUMENTO, SERIE, CORRELATIVO
      FROM dbo.AAA_TIPODOCUMENTO
      WHERE SERIE = 'FF03'
        AND TIPODOCUMENTO = '01'
    `);

    console.log(JSON.stringify({
      factura,
      columns: {
        header: headerColumns,
        detail: detailColumns
      },
      guides,
      header,
      detail,
      add,
      registroContable,
      empaqueLinks,
      ychiscom,
      tipoDocumento
    }, null, 2));
  } finally {
    await ychiPool.close();
    await bizlinksPool.close();
  }
}

async function findAcceptedFlexoInvoice(pool: sql.ConnectionPool) {
  const result = await new sql.Request(pool).query<{ SERIENUMERO: string }>(`
    SELECT TOP (1)
      h.SERIENUMERO
    FROM dbo.SPE_EINVOICEHEADER h
    INNER JOIN dbo.SPE_EINVOICE_RESPONSE r
      ON r.tipoDocumentoEmisor = h.tipoDocumentoEmisor
     AND r.numeroDocumentoEmisor = h.numeroDocumentoEmisor
     AND r.serieNumero = h.serieNumero
     AND r.tipoDocumento = h.tipoDocumento
    INNER JOIN dbo.AAA_GUIAFACTURADA g
      ON g.NRO_FACTURA = h.SERIENUMERO
    WHERE h.SERIENUMERO LIKE 'FF03-%'
      AND h.TIPODOCUMENTO = '01'
      AND (
        r.bl_estadoProceso LIKE '%AC_03%'
        OR r.bl_mensajeSunat LIKE '%"codigo":"0"%'
        OR r.bl_mensajeSunat LIKE '%aceptad%'
      )
      AND (g.NRO_GUIA LIKE 'T003-%' OR g.NRO_GUIA LIKE 'T999-%')
    ORDER BY h.FECHAEMISION DESC, h.SERIENUMERO DESC
  `);

  return result.recordset[0]?.SERIENUMERO?.trim() ?? null;
}

async function query<T = Record<string, unknown>>(
  pool: sql.ConnectionPool,
  text: string,
  inputs: Record<string, string> = {}
) {
  const request = new sql.Request(pool);
  for (const [name, value] of Object.entries(inputs)) {
    request.input(name, sql.VarChar(50), value);
  }
  const result = await request.query<T>(text);
  return result.recordset;
}

async function queryWithList<T = Record<string, unknown>>(
  pool: sql.ConnectionPool,
  text: string,
  listParamPrefix: string,
  values: string[],
  inputs: Record<string, string>
) {
  const request = new sql.Request(pool);
  for (const [name, value] of Object.entries(inputs)) {
    request.input(name, sql.VarChar(50), value);
  }
  const params = values.map((value, index) => {
    const name = `${listParamPrefix}${index}`;
    request.input(name, sql.VarChar(50), value);
    return `@${name}`;
  });
  const result = await request.query<T>(text.replace('__LIST__', params.join(', ')));
  return result.recordset;
}

async function existingColumns(pool: sql.ConnectionPool, tableName: string, candidates: string[]) {
  const request = new sql.Request(pool);
  request.input('tableName', sql.VarChar(128), tableName);
  const result = await request.query<{ COLUMN_NAME: string }>(`
    SELECT COLUMN_NAME
    FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = 'dbo'
      AND TABLE_NAME = @tableName
  `);
  const existing = new Map(result.recordset.map((row) => [row.COLUMN_NAME.toLowerCase(), row.COLUMN_NAME]));

  return candidates
    .map((candidate) => existing.get(candidate.toLowerCase()))
    .filter((column): column is string => Boolean(column));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
