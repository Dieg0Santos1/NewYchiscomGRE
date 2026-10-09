import { loadEnv } from '../../src/config/env.js';
import { createBizlinksPool, createGreFcPool, createYchiPool, sql } from '../../src/integrations/bizlinksSql.js';

const fromDate = process.argv[2] ?? '2026-09-21';

function ff01LegacyNumber(serieNumero: string) {
  const numero = Number(serieNumero.split('-')[1] ?? '0');
  return Number.isInteger(numero) && numero > 0 ? String(numero).padStart(7, '0') : null;
}

function printSection(title: string, value: unknown) {
  console.log(`\n=== ${title} ===`);
  console.log(JSON.stringify(value, null, 2));
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
    bizReq.input('fromDate', sql.Date, fromDate);
    const biz = await bizReq.query<{
      SERIENUMERO: string;
      FECHAEMISION: Date | null;
      NUMERODOCUMENTOADQUIRIENTE: string | null;
      RAZONSOCIALADQUIRIENTE: string | null;
      TIPOMONEDA: string | null;
      TOTALVENTA: number | null;
      BL_ESTADOREGISTRO: string | null;
      process_state: string | null;
      bl_estadoProceso: string | null;
      bl_mensajeSunat: string | null;
    }>(`
      SET TRANSACTION ISOLATION LEVEL READ UNCOMMITTED;
      SELECT h.SERIENUMERO, h.FECHAEMISION, h.NUMERODOCUMENTOADQUIRIENTE,
        h.RAZONSOCIALADQUIRIENTE, h.TIPOMONEDA, h.TOTALVENTA,
        h.BL_ESTADOREGISTRO, r.process_state, r.bl_estadoProceso,
        r.bl_mensajeSunat
      FROM dbo.SPE_EINVOICEHEADER h
      LEFT JOIN dbo.SPE_EINVOICE_RESPONSE r
        ON r.NUMERODOCUMENTOEMISOR = h.NUMERODOCUMENTOEMISOR
       AND r.SERIENUMERO = h.SERIENUMERO
       AND r.TIPODOCUMENTO = h.TIPODOCUMENTO
      WHERE h.TIPODOCUMENTO = '01'
        AND h.FECHAEMISION >= @fromDate
        AND (h.SERIENUMERO LIKE 'FF01-%' OR h.SERIENUMERO LIKE 'FF03-%')
      ORDER BY h.SERIENUMERO;
    `);

    const ychiReq = new sql.Request(ychi);
    ychiReq.input('fromDate', sql.Date, fromDate);
    const legacy = await ychiReq.query<{
      idDocumento: number;
      SeriDocu: string | null;
      NumeDocu: string | null;
      FechaEmision: Date | null;
      FechaCreacion: Date | null;
      Estado: string | null;
      DescClieProv: string | null;
      Total: number | null;
      idEmpleado: number | null;
      formaPago: number | null;
      cuenta: string | null;
      nguia: string | null;
      Observaciones: string | null;
    }>(`
      SET TRANSACTION ISOLATION LEVEL READ UNCOMMITTED;
      SELECT idDocumento, SeriDocu, NumeDocu, FechaEmision, FechaCreacion,
        Estado, DescClieProv, Total, idEmpleado, formaPago, cuenta, nguia,
        Observaciones
      FROM dbo.tbDocumentos
      WHERE idTipoDocu = 1
        AND (FechaEmision >= @fromDate OR FechaCreacion >= @fromDate)
      ORDER BY FechaCreacion DESC, NumeDocu DESC;
    `);

    const fcLocal = await new sql.Request(greFc)
      .input('fromDate', sql.Date, fromDate)
      .query(`
        SET TRANSACTION ISOLATION LEVEL READ UNCOMMITTED;
        SELECT id, serieNumeroFactura, estado, fechaEmision,
          numeroDocumentoCliente, razonSocialCliente, moneda, formaPago,
          total, creadoEn, actualizadoEn
        FROM dbo.FC_FACT_OPERACION
        WHERE creadoEn >= @fromDate OR fechaEmision >= @fromDate
        ORDER BY serieNumeroFactura;
      `).catch((error: unknown) => ({ recordset: [{ error: error instanceof Error ? error.message : String(error) }] }));

    const fcEvents = await new sql.Request(greFc)
      .input('fromDate', sql.Date, fromDate)
      .query(`
        SET TRANSACTION ISOLATION LEVEL READ UNCOMMITTED;
        SELECT o.serieNumeroFactura, e.tipo, e.mensaje, e.creadoEn, e.datosJson
        FROM dbo.FC_FACT_EVENTO e
        INNER JOIN dbo.FC_FACT_OPERACION o ON o.id = e.operacionId
        WHERE e.creadoEn >= @fromDate
          AND (e.tipo LIKE '%REGISTRO_VENTAS%' OR e.mensaje LIKE '%tbDocumentos%')
        ORDER BY e.creadoEn DESC;
      `).catch((error: unknown) => ({ recordset: [{ error: error instanceof Error ? error.message : String(error) }] }));

    const flexoLocal = await new sql.Request(greFc)
      .input('fromDate', sql.Date, fromDate)
      .query(`
        SET TRANSACTION ISOLATION LEVEL READ UNCOMMITTED;
        SELECT id, serieNumeroFactura, estado, fechaEmision,
          numeroDocumentoCliente, razonSocialCliente, moneda, formaPago,
          total, creadoEn, actualizadoEn
        FROM dbo.FLEXO_FE_OPERACION
        WHERE creadoEn >= @fromDate OR fechaEmision >= @fromDate
        ORDER BY serieNumeroFactura;
      `).catch((error: unknown) => ({ recordset: [{ error: error instanceof Error ? error.message : String(error) }] }));

    const legacyRows = legacy.recordset;
    const matched = biz.recordset.map((row) => {
      const serie = row.SERIENUMERO;
      const numero = serie.split('-')[1] ?? '';
      const numero7 = ff01LegacyNumber(serie);
      const numero6 = numero.slice(-6);
      const isFf01 = serie.startsWith('FF01-');
      const candidates = legacyRows.filter((legacyRow) => {
        const seriDocu = legacyRow.SeriDocu?.trim();
        const numeDocu = legacyRow.NumeDocu?.trim();
        if (isFf01) return seriDocu === 'F01' && numeDocu === numero7;
        return (
          (seriDocu === 'FF03' || seriDocu === 'F03') &&
          (numeDocu === numero || numeDocu === numero7 || numeDocu === numero6 || Boolean(numeDocu?.endsWith(numero6)))
        );
      });
      const legacyRow = candidates[0] ?? null;
      return {
        serie,
        fecha: row.FECHAEMISION,
        cliente: row.RAZONSOCIALADQUIRIENTE,
        ruc: row.NUMERODOCUMENTOADQUIRIENTE,
        total: row.TOTALVENTA,
        bizlinks: row.BL_ESTADOREGISTRO,
        proceso: row.process_state,
        sunat: row.bl_estadoProceso,
        legacyEsperado: isFf01 ? `F01-${numero7}` : 'FF03/F03',
        tbDocumentos: legacyRow ? {
          idDocumento: legacyRow.idDocumento,
          serie: legacyRow.SeriDocu,
          numero: legacyRow.NumeDocu,
          fechaCreacion: legacyRow.FechaCreacion,
          estado: legacyRow.Estado,
          total: legacyRow.Total,
          vendedor: legacyRow.idEmpleado,
          formaPago: legacyRow.formaPago,
          cuenta: legacyRow.cuenta,
          guia: legacyRow.nguia,
          observaciones: legacyRow.Observaciones
        } : null
      };
    });

    printSection('Resumen Bizlinks vs tbDocumentos', {
      desde: fromDate,
      bizlinksFacturas: biz.recordset.length,
      ychiFacturasLegacy: legacy.recordset.length,
      faltantesEnTbDocumentos: matched.filter((row) => !row.tbDocumentos).map((row) => row.serie)
    });
    printSection('Detalle comparativo', matched);
    printSection('FC local', fcLocal.recordset);
    printSection('Eventos FC registro ventas', fcEvents.recordset);
    printSection('Flexo local', flexoLocal.recordset);
    printSection('Ultimas tbDocumentos idTipoDocu=1', legacy.recordset.slice(0, 25));
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
