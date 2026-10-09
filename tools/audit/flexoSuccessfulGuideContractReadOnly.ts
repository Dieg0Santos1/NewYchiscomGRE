import { loadEnv } from '../../src/config/env.js';
import { createBizlinksPool, sql } from '../../src/integrations/bizlinksSql.js';

type QueryInputs = Record<string, string | number>;

async function query<T>(
  pool: sql.ConnectionPool,
  text: string,
  inputs: QueryInputs = {}
): Promise<T[]> {
  const request = new sql.Request(pool);
  for (const [name, value] of Object.entries(inputs)) {
    if (typeof value === 'number') {
      request.input(name, sql.Int, value);
    } else {
      request.input(name, sql.VarChar(80), value);
    }
  }

  const result = await request.query<T>(text);
  return result.recordset;
}

async function safe<T>(
  source: string,
  fn: () => Promise<T[]>
): Promise<{ source: string; rows: T[] } | { source: string; error: string }> {
  try {
    return { source, rows: await fn() };
  } catch (error) {
    return {
      source,
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

async function main() {
  const pool = createBizlinksPool(loadEnv());
  await pool.connect();

  try {
    const acceptedGuides = await query<{
      serieNumeroGuia: string;
      fechaEmisionGuia: string | null;
      fechaInicioTraslado: string | null;
      numeroDocumentoDestinatario: string | null;
      razonSocialDestinatario: string | null;
      motivoTraslado: string | null;
      descripcionMotivoTraslado: string | null;
      modalidadTraslado: string | null;
      ubigeoPtoPartida: string | null;
      direccionPtoPartida: string | null;
      ubigeoPtoLlegada: string | null;
      direccionPtoLlegada: string | null;
      bl_estadoRegistro: string | null;
      bl_estadoProceso: string | null;
      process_state: string | null;
      empaques: number;
      items: number;
      facturados: number;
    }>(pool, `
      SELECT TOP (12)
        d.serieNumeroGuia,
        CONVERT(varchar(19), d.fechaEmisionGuia, 120) AS fechaEmisionGuia,
        CONVERT(varchar(10), d.fechaInicioTraslado, 120) AS fechaInicioTraslado,
        d.numeroDocumentoDestinatario,
        d.razonSocialDestinatario,
        d.motivoTraslado,
        d.descripcionMotivoTraslado,
        d.modalidadTraslado,
        d.ubigeoPtoPartida,
        d.direccionPtoPartida,
        d.ubigeoPtoLlegada,
        d.direccionPtoLlegada,
        d.bl_estadoRegistro,
        r.bl_estadoProceso,
        r.process_state,
        COUNT(DISTINCT ed.CODIGOEMPAQUE) AS empaques,
        COUNT(ed.CODIGOPRODUCTO) AS items,
        SUM(CASE WHEN ed.SERIENUMEROGUIAFACTURA IS NULL THEN 0 ELSE 1 END) AS facturados
      FROM dbo.SPE_DESPATCH d
      LEFT JOIN dbo.SPE_DESPATCH_RESPONSE r
        ON r.tipoDocumentoRemitente = d.tipoDocumentoRemitente
       AND r.numeroDocumentoRemitente = d.numeroDocumentoRemitente
       AND r.serieNumeroGuia = d.serieNumeroGuia
       AND r.tipoDocumentoGuia = d.tipoDocumentoGuia
      LEFT JOIN dbo.EMPAQUE_DETALLE ed
        ON ed.SERIENUMEROGUIAREMISION = d.serieNumeroGuia
      WHERE d.tipoDocumentoGuia = '09'
        AND (d.serieNumeroGuia LIKE 'T003-%' OR d.serieNumeroGuia LIKE 'T999-%')
        AND (
          r.bl_estadoProceso LIKE '%AC_03%'
          OR r.process_state LIKE '%AC_03%'
          OR COALESCE(r.bl_mensajeSunat, r.bl_mensaje, '') LIKE '%acept%'
        )
      GROUP BY
        d.serieNumeroGuia,
        d.fechaEmisionGuia,
        d.fechaInicioTraslado,
        d.numeroDocumentoDestinatario,
        d.razonSocialDestinatario,
        d.motivoTraslado,
        d.descripcionMotivoTraslado,
        d.modalidadTraslado,
        d.ubigeoPtoPartida,
        d.direccionPtoPartida,
        d.ubigeoPtoLlegada,
        d.direccionPtoLlegada,
        d.bl_estadoRegistro,
        r.bl_estadoProceso,
        r.process_state
      HAVING COUNT(ed.CODIGOPRODUCTO) > 0
      ORDER BY d.fechaEmisionGuia DESC, d.serieNumeroGuia DESC;
    `);

    const selectedGuides = acceptedGuides.slice(0, 5);
    const guideDetails = [];

    for (const guide of selectedGuides) {
      const serieNumeroGuia = guide.serieNumeroGuia;
      const [
        header,
        items,
        empaqueLinks,
        auxiliar,
        relatedDocs
      ] = await Promise.all([
        safe('SPE_DESPATCH', () => query(pool, `
          SELECT TOP (1) *
          FROM dbo.SPE_DESPATCH
          WHERE serieNumeroGuia = @serieNumeroGuia
            AND tipoDocumentoGuia = '09';
        `, { serieNumeroGuia })),
        safe('SPE_DESPATCH_ITEM', () => query(pool, `
          SELECT
            numeroOrdenItem,
            codigo,
            descripcion,
            CONVERT(varchar(50), cantidad) AS cantidad,
            unidadMedida
          FROM dbo.SPE_DESPATCH_ITEM
          WHERE serieNumeroGuia = @serieNumeroGuia
            AND tipoDocumentoGuia = '09'
          ORDER BY CASE WHEN ISNUMERIC(numeroOrdenItem) = 1 THEN CONVERT(int, numeroOrdenItem) ELSE 9999 END, numeroOrdenItem;
        `, { serieNumeroGuia })),
        safe('EMPAQUE_DETALLE', () => query(pool, `
          SELECT
            e.CODIGOEMPAQUE,
            e.TICKETNUM,
            e.ORDENCOMPRA,
            e.NUMERODOCUMENTOADQUIRIENTE,
            e.RAZONSOCIALADQUIRIENTE,
            e.UBIGEOPTOLLEGADA,
            e.DIRECCIONPTOLLEGADA,
            d.CODIGOPRODUCTO,
            d.DESCRIPCION,
            CONVERT(varchar(50), d.CANTIDAD) AS cantidadEmpaque,
            d.UNIDADMEDIDA AS unidadEmpaque,
            d.SERIENUMEROGUIAREMISION,
            d.ORDENGUIA,
            d.SERIENUMEROGUIAFACTURA,
            d.ORDENFACTURA
          FROM dbo.EMPAQUE_DETALLE d
          INNER JOIN dbo.EMPAQUE e
            ON e.CODIGOEMPAQUE = d.CODIGOEMPAQUE
          WHERE d.SERIENUMEROGUIAREMISION = @serieNumeroGuia
          ORDER BY e.CODIGOEMPAQUE, CASE WHEN ISNUMERIC(d.ORDENGUIA) = 1 THEN CONVERT(int, d.ORDENGUIA) ELSE 9999 END, d.CODIGOPRODUCTO;
        `, { serieNumeroGuia })),
        safe('SPE_DESPATCH_AUXILIAR', () => query(pool, `
          SELECT *
          FROM dbo.SPE_DESPATCH_AUXILIAR
          WHERE SERIENUMERO = @serieNumeroGuia
          ORDER BY SERIENUMERO;
        `, { serieNumeroGuia })),
        safe('SPE_DESPATCH_DOCRELACIONADO', () => query(pool, `
          SELECT *
          FROM dbo.SPE_DESPATCH_DOCRELACIONADO
          WHERE serieNumeroGuia = @serieNumeroGuia
          ORDER BY serieNumeroGuia;
        `, { serieNumeroGuia }))
      ]);

      guideDetails.push({
        serieNumeroGuia,
        header,
        items,
        empaqueLinks,
        auxiliar,
        relatedDocs
      });
    }

    const [
      tipoDocumento,
      guideColumns,
      itemColumns,
      procedureParameters
    ] = await Promise.all([
      safe('AAA_TIPODOCUMENTO', () => query(pool, `
        SELECT TIPODOCUMENTO, DESCRIPCION, SERIE, CORRELATIVO
        FROM dbo.AAA_TIPODOCUMENTO
        WHERE SERIE IN ('T003', 'T999')
          AND TIPODOCUMENTO = '09'
        ORDER BY SERIE;
      `)),
      safe('SPE_DESPATCH columns', () => query(pool, `
        SELECT name, system_type_name, max_length, is_nullable
        FROM sys.dm_exec_describe_first_result_set(N'SELECT * FROM dbo.SPE_DESPATCH', NULL, 0)
        ORDER BY column_ordinal;
      `)),
      safe('SPE_DESPATCH_ITEM columns', () => query(pool, `
        SELECT name, system_type_name, max_length, is_nullable
        FROM sys.dm_exec_describe_first_result_set(N'SELECT * FROM dbo.SPE_DESPATCH_ITEM', NULL, 0)
        ORDER BY column_ordinal;
      `)),
      safe('official procedure parameters', () => query(pool, `
        SELECT
          SPECIFIC_NAME AS procedureName,
          PARAMETER_NAME AS parameterName,
          DATA_TYPE AS dataType,
          CHARACTER_MAXIMUM_LENGTH AS maxLength,
          NUMERIC_PRECISION AS numericPrecision,
          NUMERIC_SCALE AS numericScale,
          ORDINAL_POSITION AS ordinalPosition
        FROM INFORMATION_SCHEMA.PARAMETERS
        WHERE SPECIFIC_SCHEMA = 'dbo'
          AND SPECIFIC_NAME IN (
            'SPI_GUIA_ELECTRONICA',
            'SPI_DETALLE_GUIA_ELECTRONICA',
            'USP_CABECERAGUIA',
            'USP_DETALLEGUIA',
            'USP_ENVIOGUIA'
          )
        ORDER BY SPECIFIC_NAME, ORDINAL_POSITION;
      `))
    ]);

    console.log(JSON.stringify({
      generatedAt: new Date().toISOString(),
      acceptedGuides,
      selectedGuides: selectedGuides.map((item) => item.serieNumeroGuia),
      guideDetails,
      tipoDocumento,
      guideColumns,
      itemColumns,
      procedureParameters
    }, null, 2));
  } finally {
    await pool.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
