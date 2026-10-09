import { loadEnv } from '../../src/config/env.js';
import { createBizlinksPool, createGreFcPool, createYchiPool, sql } from '../../src/integrations/bizlinksSql.js';

const series = process.argv.slice(2);
const targetSeries = series.length > 0 ? series : ['FF01-00017175', 'FF01-00017176'];

function bindSeries(request: sql.Request, prefix = 'serie') {
  return targetSeries.map((serie, index) => {
    const name = `${prefix}${index}`;
    request.input(name, sql.VarChar(13), serie);
    return `@${name}`;
  }).join(', ');
}

async function main() {
  const config = loadEnv();
  const bizlinks = createBizlinksPool(config);
  const greFc = createGreFcPool(config);
  const ychi = createYchiPool(config);
  await bizlinks.connect();
  await greFc.connect();
  await ychi.connect();

  try {
    const bizReq = new sql.Request(bizlinks);
    const bizIn = bindSeries(bizReq);
    const biz = await bizReq.query(`
      SET TRANSACTION ISOLATION LEVEL READ UNCOMMITTED;
      SELECT h.SERIENUMERO, h.FECHAEMISION,
        h.NUMERODOCUMENTOADQUIRIENTE, h.RAZONSOCIALADQUIRIENTE,
        h.TIPOMONEDA, h.TOTALVALORVENTANETOOPGRAVADAS, h.TOTALIGV, h.TOTALVENTA,
        h.BL_ESTADOREGISTRO, r.process_state, r.bl_mensajeSunat
      FROM dbo.SPE_EINVOICEHEADER h
      LEFT JOIN dbo.SPE_EINVOICE_RESPONSE r
        ON r.NUMERODOCUMENTOEMISOR = h.NUMERODOCUMENTOEMISOR
       AND r.SERIENUMERO = h.SERIENUMERO
       AND r.TIPODOCUMENTO = h.TIPODOCUMENTO
      WHERE h.SERIENUMERO IN (${bizIn}) AND h.TIPODOCUMENTO = '01'
      ORDER BY h.SERIENUMERO;
    `);

    const addReq = new sql.Request(bizlinks);
    const addIn = bindSeries(addReq);
    const adds = await addReq.query(`
      SET TRANSACTION ISOLATION LEVEL READ UNCOMMITTED;
      SELECT SERIENUMERO, clave, valor
      FROM dbo.SPE_EINVOICEHEADER_ADD
      WHERE SERIENUMERO IN (${addIn}) AND TIPODOCUMENTO = '01'
        AND clave IN ('ordenCompra', 'fechaVencimiento')
      ORDER BY SERIENUMERO, clave;
    `);

    const greReq = new sql.Request(greFc);
    const greIn = bindSeries(greReq);
    const gre = await greReq.query(`
      SET TRANSACTION ISOLATION LEVEL READ UNCOMMITTED;
      SELECT o.id, o.serieNumeroFactura, o.fechaEmision, o.fechaVencimiento,
        o.numeroDocumentoCliente, o.razonSocialCliente, o.moneda, o.formaPago,
        o.cuenta, o.ordenCompra, o.gravada, o.igv, o.total, o.usuario,
        o.datosJson,
        STUFF((
          SELECT ',' + g.serieNumeroGuia
          FROM dbo.FC_FACT_GUIA g
          WHERE g.operacionId = o.id
          ORDER BY g.serieNumeroGuia
          FOR XML PATH(''), TYPE
        ).value('.', 'nvarchar(max)'), 1, 1, '') AS guias
      FROM dbo.FC_FACT_OPERACION o
      WHERE o.serieNumeroFactura IN (${greIn})
      ORDER BY o.serieNumeroFactura;
    `);

    const ychiReq = new sql.Request(ychi);
    targetSeries.forEach((serie, index) => {
      const number = Number(serie.split('-')[1] ?? '0');
      ychiReq.input(`num${index}`, sql.VarChar(7), String(number).padStart(7, '0'));
    });
    const ychiIn = targetSeries.map((_, index) => `@num${index}`).join(', ');
    const ychiRows = await ychiReq.query(`
      SET TRANSACTION ISOLATION LEVEL READ UNCOMMITTED;
      SELECT idDocumento, idTipoDocu, SeriDocu, NumeDocu, FechaEmision,
        FechaVencimiento, Estado, idClieProv, DescClieProv, Moneda,
        Tica, Neto, IGV, Total, idEmpleado, formaPago, nguia, cuenta,
        idDocumentoAnterior, origen
      FROM dbo.tbDocumentos
      WHERE idTipoDocu = 1 AND SeriDocu = 'F01' AND NumeDocu IN (${ychiIn})
      ORDER BY NumeDocu;
    `);

    const neighbors = await new sql.Request(ychi).query(`
      SET TRANSACTION ISOLATION LEVEL READ UNCOMMITTED;
      SELECT idDocumento, SeriDocu, NumeDocu, FechaEmision, Estado,
        DescClieProv, Moneda, Tica, Neto, IGV, Total, idEmpleado,
        formaPago, nguia, cuenta, idDocumentoAnterior
      FROM dbo.tbDocumentos
      WHERE idTipoDocu = 1 AND SeriDocu = 'F01'
        AND NumeDocu BETWEEN '0017173' AND '0017180'
      ORDER BY NumeDocu;
    `);

    const relatedGuides = await new sql.Request(greFc).query(`
      SET TRANSACTION ISOLATION LEVEL READ UNCOMMITTED;
      SELECT e.serieNumeroGuia, o.idDocumentoYchiscom, o.numeroGuiaFisica,
        o.idGuiaFisicaYchiscom, o.numeroOT, o.idOrdenTrabajo, o.idOrdenVenta,
        o.numeroDocumentoDestinatario, o.razonSocialDestinatario
      FROM dbo.GRE_FC_ENVIO e
      INNER JOIN dbo.GRE_FC_OPERACION o ON o.id = e.operacionId
      WHERE e.serieNumeroGuia IN ('T001-00000101', 'T001-00000102')
      ORDER BY e.serieNumeroGuia;
    `).catch((error: unknown) => ({ recordset: [{ error: error instanceof Error ? error.message : String(error) }] }));

    const clients = await new sql.Request(ychi).query(`
      SET TRANSACTION ISOLATION LEVEL READ UNCOMMITTED;
      SELECT *
      FROM dbo.tbClieProv
      WHERE RUC IN ('20307214386', '20481252475')
      ORDER BY RUC;
    `);

    const payments = await new sql.Request(ychi).query(`
      SET TRANSACTION ISOLATION LEVEL READ UNCOMMITTED;
      SELECT TOP (50) idPropiedades, tipo, Nombre, Descripcion, Valor
      FROM dbo.tbPropiedades
      WHERE tipo = 'FPAG'
        AND (
          Nombre LIKE '%Factura%'
          OR Valor LIKE '%Factura%'
          OR Nombre LIKE '%Contado%'
          OR Valor LIKE '%Contado%'
        )
      ORDER BY idPropiedades;
    `).catch((error: unknown) => ({ recordset: [{ error: error instanceof Error ? error.message : String(error) }] }));

    console.log(JSON.stringify({
      safety: 'READ_ONLY',
      targetSeries,
      bizlinks: biz.recordset,
      headerAdd: adds.recordset,
      localTrace: gre.recordset.map((row: any) => ({
        ...row,
        datosJson: row.datosJson ? JSON.parse(row.datosJson) : null
      })),
      legacyTargets: ychiRows.recordset,
      legacyNeighbors: neighbors.recordset,
      relatedGuides: relatedGuides.recordset,
      clients: clients.recordset,
      payments: payments.recordset
    }, null, 2));
  } finally {
    await ychi.close();
    await greFc.close();
    await bizlinks.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
