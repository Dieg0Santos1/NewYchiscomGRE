import { loadEnv } from '../../src/config/env.js';
import { createYchiPool, sql } from '../../src/integrations/bizlinksSql.js';

const config = loadEnv();
const pool = createYchiPool(config);
await pool.connect();

try {
  const procedures = await new sql.Request(pool).query<{
    wrapper: string;
    puedeEjecutar: number;
    puedeAlterar: number;
    usaTransaccionSegura: number;
    usaBloqueo: number;
    definicionVisible: number;
  }>(`
    SET TRANSACTION ISOLATION LEVEL READ UNCOMMITTED;
    SELECT
      SCHEMA_NAME(p.schema_id) + '.' + p.name AS wrapper,
      HAS_PERMS_BY_NAME(SCHEMA_NAME(p.schema_id) + '.' + p.name, 'OBJECT', 'EXECUTE') AS puedeEjecutar,
      HAS_PERMS_BY_NAME(SCHEMA_NAME(p.schema_id) + '.' + p.name, 'OBJECT', 'ALTER') AS puedeAlterar,
      CASE WHEN OBJECT_DEFINITION(p.object_id) LIKE '%SET XACT_ABORT ON%' THEN 1 ELSE 0 END AS usaTransaccionSegura,
      CASE WHEN OBJECT_DEFINITION(p.object_id) LIKE '%sp_getapplock%' THEN 1 ELSE 0 END AS usaBloqueo,
      CASE WHEN OBJECT_DEFINITION(p.object_id) IS NULL THEN 0 ELSE 1 END AS definicionVisible
    FROM sys.procedures p
    WHERE p.schema_id = SCHEMA_ID('dbo')
      AND p.name IN (
        'GRE_WEB_CREAR_PREGUIA_FC',
        'GRE_WEB_ACEPTAR_PREGUIA_FC',
        'GRE_WEB_CREAR_GUIA_INTERNA_FC'
      )
    ORDER BY p.name;
  `);

  const candidates = await new sql.Request(pool).query<{
    numeroOt: string;
    cliente: string;
    cantidadOt: number;
    cantidadAceptada: number;
    cantidadPendiente: number;
    estadoGuiaOt: string;
  }>(`
    SET TRANSACTION ISOLATION LEVEL READ UNCOMMITTED;
    WITH recibidas AS (
      SELECT idOT,
        SUM(CASE WHEN EstadoOT = 'C' THEN cantidad ELSE 0 END) AS cantidadAceptada,
        SUM(CASE WHEN EstadoOT = 'I' THEN 1 ELSE 0 END) AS recepcionesPendientes
      FROM dbo.tbRecepcionOT
      GROUP BY idOT
    )
    SELECT TOP (10)
      ot.numero AS numeroOt,
      c.Nombre AS cliente,
      CAST(dov.Cantidad AS decimal(18,2)) AS cantidadOt,
      CAST(ISNULL(r.cantidadAceptada, 0) AS decimal(18,2)) AS cantidadAceptada,
      CAST(dov.Cantidad - ISNULL(r.cantidadAceptada, 0) AS decimal(18,2)) AS cantidadPendiente,
      ISNULL(ot.EstGuia, 'N') AS estadoGuiaOt
    FROM dbo.tbOrdenTrabajo ot
    INNER JOIN dbo.tbDetOrdenVenta dov ON dov.idDetOrdenVenta = ot.idDetOrdenVenta
    INNER JOIN dbo.tbOrdenVenta ov ON ov.idOrdenVenta = dov.idOrdenVenta
    INNER JOIN dbo.tbDetSoliProf dsp ON dsp.idDetSoliProf = ov.idDetSoliProf
    INNER JOIN dbo.tbDocumentos solicitud ON solicitud.idDocumento = dsp.idDocumento
    INNER JOIN dbo.tbClieProv c ON c.idClieProv = solicitud.idClieProv
    LEFT JOIN recibidas r ON r.idOT = ot.idOrdenTrabajo
    WHERE ISNULL(ot.EstGuia, 'N') IN ('N', 'M')
      AND ISNULL(r.recepcionesPendientes, 0) = 0
      AND dov.Cantidad - ISNULL(r.cantidadAceptada, 0) > 0
      AND ISNULL(ot.Estado, '') <> 'Z'
    ORDER BY ot.idOrdenTrabajo DESC;
  `);

  console.log(JSON.stringify({
    applicationWriteFlag: config.fcLegacyWriteEnabled,
    wrappers: procedures.recordset,
    candidateWorkOrdersReadOnly: candidates.recordset
  }, null, 2));
} finally {
  await pool.close();
}
