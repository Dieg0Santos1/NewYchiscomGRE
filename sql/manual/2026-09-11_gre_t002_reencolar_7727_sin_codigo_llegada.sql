USE BIZLINKS_PROD21;
GO

/*
  Reproceso de GRE T002 publicas rechazadas por 7727:
  "Codigo de establecimiento anexo del punto de llegada no esta declarado en SUNAT".

  Accion:
  - Respaldar cabecera y respuestas actuales.
  - Dejar codigoPtollegada = NULL.
  - Eliminar solo respuestas/logica visible de rechazo sin aceptacion/ticket/CDR.
  - Reencolar cabecera con bl_estadoRegistro = 'A'.

  Ejecutar primero con @Ejecutar = 0. Cambiar a 1 solo si el preview es correcto.
*/

SET XACT_ABORT ON;

DECLARE @Ejecutar bit = 0;
DECLARE @Ahora datetime2(0) = SYSDATETIME();

DECLARE @Series TABLE
(
  serieNumeroGuia varchar(13) NOT NULL PRIMARY KEY
);

INSERT INTO @Series (serieNumeroGuia)
VALUES
  ('T002-00000016'),
  ('T002-00000017'),
  ('T002-00000019'),
  ('T002-00000020'),
  ('T002-00000022'),
  ('T002-00000027');

BEGIN TRANSACTION;

IF OBJECT_ID(N'dbo.ZZ_GRE_T002_REPROCESO_7727_20260911_DESPATCH', N'U') IS NULL
BEGIN
  SELECT TOP (0)
    CAST(NULL AS datetime2(0)) AS respaldadoEn,
    CAST(NULL AS sysname) AS respaldadoPor,
    CAST(NULL AS varchar(40)) AS lote,
    d.*
  INTO dbo.ZZ_GRE_T002_REPROCESO_7727_20260911_DESPATCH
  FROM dbo.SPE_DESPATCH d;
END;

IF OBJECT_ID(N'dbo.ZZ_GRE_T002_REPROCESO_7727_20260911_RESPONSE', N'U') IS NULL
BEGIN
  SELECT TOP (0)
    CAST(NULL AS datetime2(0)) AS respaldadoEn,
    CAST(NULL AS sysname) AS respaldadoPor,
    CAST(NULL AS varchar(40)) AS lote,
    r.*
  INTO dbo.ZZ_GRE_T002_REPROCESO_7727_20260911_RESPONSE
  FROM dbo.SPE_DESPATCH_RESPONSE r;
END;

INSERT INTO dbo.ZZ_GRE_T002_REPROCESO_7727_20260911_DESPATCH
SELECT @Ahora, SUSER_SNAME(), 'GRE_T002_7727_20260911', d.*
FROM dbo.SPE_DESPATCH d
INNER JOIN @Series s ON s.serieNumeroGuia = d.serieNumeroGuia
WHERE d.tipoDocumentoGuia = '09';

INSERT INTO dbo.ZZ_GRE_T002_REPROCESO_7727_20260911_RESPONSE
SELECT @Ahora, SUSER_SNAME(), 'GRE_T002_7727_20260911', r.*
FROM dbo.SPE_DESPATCH_RESPONSE r
INNER JOIN @Series s ON s.serieNumeroGuia = r.serieNumeroGuia
WHERE r.tipoDocumentoGuia = '09';

IF EXISTS (
  SELECT 1
  FROM @Series s
  WHERE NOT EXISTS (
    SELECT 1
    FROM dbo.SPE_DESPATCH d
    WHERE d.serieNumeroGuia = s.serieNumeroGuia
      AND d.tipoDocumentoGuia = '09'
  )
)
BEGIN
  THROW 51100, 'Hay series sin cabecera SPE_DESPATCH. No se reprocesa.', 1;
END;

IF EXISTS (
  SELECT 1
  FROM dbo.SPE_DESPATCH d
  INNER JOIN @Series s ON s.serieNumeroGuia = d.serieNumeroGuia
  LEFT JOIN dbo.SPE_DESPATCH_RESPONSE r
    ON r.tipoDocumentoRemitente = d.tipoDocumentoRemitente
   AND r.numeroDocumentoRemitente = d.numeroDocumentoRemitente
   AND r.serieNumeroGuia = d.serieNumeroGuia
   AND r.tipoDocumentoGuia = d.tipoDocumentoGuia
  WHERE d.tipoDocumentoGuia = '09'
    AND (
      r.bl_estadoProceso LIKE '%AC_03%'
      OR r.bl_mensajeSunat LIKE '%"codigo":"0"%'
      OR r.bl_mensajeSunat LIKE '%ha sido aceptado%'
      OR NULLIF(LTRIM(RTRIM(ISNULL(r.bl_Ticket, ''))), '') IS NOT NULL
      OR NULLIF(LTRIM(RTRIM(ISNULL(r.bl_url_cdr, ''))), '') IS NOT NULL
    )
)
BEGIN
  THROW 51101, 'Alguna serie parece tener aceptacion/ticket/CDR. No se reprocesa.', 1;
END;

UPDATE d
SET
  codigoPtollegada = NULL,
  fechaInicioTraslado = COALESCE(NULLIF(LTRIM(RTRIM(d.fechaInicioTraslado)), ''), d.fechaEmisionGuia),
  fechaEntregaBienes = COALESCE(NULLIF(LTRIM(RTRIM(d.fechaEntregaBienes)), ''), d.fechaEmisionGuia),
  bl_estadoRegistro = 'A',
  bl_reintento = 0,
  bl_hasFileResponse = 0
FROM dbo.SPE_DESPATCH d
INNER JOIN @Series s ON s.serieNumeroGuia = d.serieNumeroGuia
WHERE d.tipoDocumentoGuia = '09'
  AND d.modalidadTraslado = '01';

DELETE r
FROM dbo.SPE_DESPATCH_RESPONSE r
INNER JOIN @Series s ON s.serieNumeroGuia = r.serieNumeroGuia
WHERE r.tipoDocumentoGuia = '09'
  AND ISNULL(r.bl_estadoRegistro, '') = 'E'
  AND NULLIF(LTRIM(RTRIM(ISNULL(r.bl_mensajeSunat, ''))), '') IS NULL
  AND NULLIF(LTRIM(RTRIM(ISNULL(r.bl_Ticket, ''))), '') IS NULL
  AND NULLIF(LTRIM(RTRIM(ISNULL(r.bl_url_cdr, ''))), '') IS NULL;

SELECT
  d.serieNumeroGuia,
  d.bl_estadoRegistro,
  d.modalidadTraslado,
  d.fechaInicioTraslado,
  d.fechaEntregaBienes,
  d.codigoPtollegada,
  d.numeroRucTransportista,
  d.tipoDocumentoTransportista,
  d.razonSocialTransportista,
  (SELECT COUNT(1) FROM dbo.SPE_DESPATCH_RESPONSE r WHERE r.serieNumeroGuia = d.serieNumeroGuia AND r.tipoDocumentoGuia = '09') AS responsesRestantes
FROM dbo.SPE_DESPATCH d
INNER JOIN @Series s ON s.serieNumeroGuia = d.serieNumeroGuia
WHERE d.tipoDocumentoGuia = '09'
ORDER BY d.serieNumeroGuia;

IF @Ejecutar = 1
BEGIN
  COMMIT TRANSACTION;
  SELECT 'COMMIT_APLICADO' AS resultado, 'Guias reencoladas sin codigoPtollegada para evitar 7727.' AS detalle;
END
ELSE
BEGIN
  ROLLBACK TRANSACTION;
  SELECT 'ROLLBACK_VISTA_PREVIA' AS resultado, 'Revisar preview; cambiar @Ejecutar = 1 para aplicar.' AS detalle;
END;
GO
