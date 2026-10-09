import { loadEnv } from '../../src/config/env.js';
import { createBizlinksPool, createYchiPool, sql } from '../../src/integrations/bizlinksSql.js';

const guia = process.argv[2]?.trim() || 'T003-00005443';
const factura = process.argv[3]?.trim() || 'FF03-00011118';

async function query<T>(
  pool: sql.ConnectionPool,
  text: string,
  inputs: Record<string, string> = {}
): Promise<T[]> {
  const request = new sql.Request(pool);
  for (const [name, value] of Object.entries(inputs)) {
    request.input(name, sql.VarChar(50), value);
  }
  const result = await request.query<T>(text);
  return result.recordset;
}

async function safe<T>(fn: () => Promise<T[]>): Promise<T[] | Array<{ error: string }>> {
  try {
    return await fn();
  } catch (error) {
    return [{ error: error instanceof Error ? error.message : String(error) }];
  }
}

async function main() {
  const config = loadEnv();
  const bizlinksPool = createBizlinksPool(config);
  const ychiPool = createYchiPool(config);

  await bizlinksPool.connect();
  await ychiPool.connect();

  try {
    const [
      empaqueItems,
      greHeader,
      greItems,
      feHeader,
      feItems,
      guiaFacturada,
      headerAdd,
      ychiscomDocs
    ] = await Promise.all([
      query(bizlinksPool, `
        SELECT
          e.CODIGOEMPAQUE AS empaque,
          e.TICKETNUM AS ticket,
          e.ORDENCOMPRA AS ordenCompra,
          CONVERT(varchar(10), e.FECHACREACION, 120) AS fechaEmpaque,
          e.NUMERODOCUMENTOADQUIRIENTE AS ruc,
          e.RAZONSOCIALADQUIRIENTE AS cliente,
          e.UBIGEOPTOLLEGADA AS ubigeoDestino,
          e.DIRECCIONPTOLLEGADA AS direccionDestino,
          d.CODIGOPRODUCTO AS codigoProducto,
          d.DESCRIPCION AS descripcion,
          CONVERT(varchar(50), d.CANTIDAD) AS cantidad,
          d.UNIDADMEDIDA AS unidadMedida,
          d.MONEDA AS moneda,
          d.SERIENUMEROGUIAREMISION AS guia,
          d.ORDENGUIA AS ordenGuia,
          d.SERIENUMEROGUIAFACTURA AS factura,
          d.ORDENFACTURA AS ordenFactura
        FROM dbo.EMPAQUE_DETALLE d
        JOIN dbo.EMPAQUE e
          ON e.CODIGOEMPAQUE = d.CODIGOEMPAQUE
        WHERE d.SERIENUMEROGUIAREMISION = @guia
           OR d.SERIENUMEROGUIAFACTURA = @factura
        ORDER BY
          d.SERIENUMEROGUIAREMISION,
          e.CODIGOEMPAQUE,
          CASE WHEN ISNUMERIC(d.ORDENGUIA) = 1 THEN CONVERT(int, d.ORDENGUIA) ELSE 9999 END,
          d.CODIGOPRODUCTO;
      `, { guia, factura }),
      query(bizlinksPool, `
        SELECT
          d.serieNumeroGuia,
          d.fechaEmisionGuia,
          d.fechaInicioTraslado,
          d.numeroDocumentoDestinatario,
          d.razonSocialDestinatario,
          d.motivoTraslado,
          d.descripcionMotivoTraslado,
          d.modalidadTraslado,
          d.ubigeoPtoLlegada,
          d.direccionPtoLlegada,
          d.ubigeoPtoPartida,
          d.direccionPtoPartida,
          d.numeroDocumentoConductor,
          d.bl_estadoRegistro,
          r.bl_estadoProceso,
          r.process_state,
          LEFT(COALESCE(r.bl_mensajeSunat, r.bl_mensaje, ''), 180) AS mensaje
        FROM dbo.SPE_DESPATCH d
        LEFT JOIN dbo.SPE_DESPATCH_RESPONSE r
          ON r.tipoDocumentoRemitente = d.tipoDocumentoRemitente
         AND r.numeroDocumentoRemitente = d.numeroDocumentoRemitente
         AND r.serieNumeroGuia = d.serieNumeroGuia
         AND r.tipoDocumentoGuia = d.tipoDocumentoGuia
        WHERE d.serieNumeroGuia = @guia
          AND d.tipoDocumentoGuia = '09';
      `, { guia }),
      query(bizlinksPool, `
        SELECT
          numeroOrdenItem,
          codigo,
          descripcion,
          CONVERT(varchar(50), cantidad) AS cantidad,
          unidadMedida
        FROM dbo.SPE_DESPATCH_ITEM
        WHERE serieNumeroGuia = @guia
          AND tipoDocumentoGuia = '09'
        ORDER BY CASE WHEN ISNUMERIC(numeroOrdenItem) = 1 THEN CONVERT(int, numeroOrdenItem) ELSE 9999 END, numeroOrdenItem;
      `, { guia }),
      query(bizlinksPool, `
        SELECT
          h.serieNumero,
          h.fechaEmision,
          h.numeroDocumentoAdquiriente,
          h.razonSocialAdquiriente,
          h.tipoMoneda,
          h.totalValorVentaNetoOpGravadas,
          h.totalImpuestos,
          h.totalVenta,
          h.tipoOperacion,
          h.numeroDocumentoReferencia_1,
          h.tipoReferencia_1,
          h.codigoLeyenda_1,
          h.textoLeyenda_1,
          h.bl_estadoRegistro,
          r.bl_estadoProceso,
          r.process_state,
          LEFT(COALESCE(r.bl_mensajeSunat, r.bl_mensaje, ''), 180) AS mensaje
        FROM dbo.SPE_EINVOICEHEADER h
        LEFT JOIN dbo.SPE_EINVOICE_RESPONSE r
          ON r.tipoDocumentoEmisor = h.tipoDocumentoEmisor
         AND r.numeroDocumentoEmisor = h.numeroDocumentoEmisor
         AND r.serieNumero = h.serieNumero
         AND r.tipoDocumento = h.tipoDocumento
        WHERE h.serieNumero = @factura
          AND h.tipoDocumento = '01';
      `, { factura }),
      query(bizlinksPool, `
        SELECT
          numeroOrdenItem,
          codigoProducto,
          descripcion,
          CONVERT(varchar(50), cantidad) AS cantidad,
          unidadMedida,
          importeUnitarioSinImpuesto,
          importeUnitarioConImpuesto,
          importeTotalSinImpuesto,
          importeTotalImpuestos,
          montoBaseIgv,
          textoAuxiliar250_1
        FROM dbo.SPE_EINVOICEDETAIL
        WHERE serieNumero = @factura
          AND tipoDocumento = '01'
        ORDER BY CASE WHEN ISNUMERIC(numeroOrdenItem) = 1 THEN CONVERT(int, numeroOrdenItem) ELSE 9999 END, numeroOrdenItem;
      `, { factura }),
      safe(() => query(bizlinksPool, `
        SELECT *
        FROM dbo.AAA_GUIAFACTURADA
        WHERE NRO_FACTURA = @factura
           OR NRO_GUIA = @guia
        ORDER BY ID;
      `, { guia, factura })),
      safe(() => query(bizlinksPool, `
        SELECT clave, valor
        FROM dbo.SPE_EINVOICEHEADER_ADD
        WHERE serieNumero = @factura
          AND tipoDocumento = '01'
        ORDER BY clave;
      `, { factura })),
      safe(() => query(ychiPool, `
        SELECT TOP 20
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
        WHERE nguia LIKE '%' + @guia + '%'
           OR nguia LIKE '%' + @factura + '%'
           OR (SeriDocu = 'FF03' AND NumeDocu LIKE '%' + RIGHT(@factura, 6))
        ORDER BY FechaCreacion DESC;
      `, { guia, factura }))
    ]);

    console.log(JSON.stringify({
      guia,
      factura,
      empaqueItems,
      greHeader,
      greItems,
      feHeader,
      feItems,
      guiaFacturada,
      headerAdd,
      ychiscomDocs
    }, null, 2));
  } finally {
    await ychiPool.close();
    await bizlinksPool.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
