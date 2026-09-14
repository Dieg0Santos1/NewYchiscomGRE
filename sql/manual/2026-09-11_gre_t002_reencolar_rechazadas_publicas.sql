USE BIZLINKS_PROD21;
GO

/*
  Reproceso controlado de GRE T002 publicas que quedaron en error/rechazo tecnico.

  Objetivo:
  - No fabricar aceptaciones SUNAT.
  - No copiar PDF/CDR/hash/firma/respuesta desde otra guia.
  - Reencolar en Bizlinks guias con datos reales para que el motor vuelva a enviarlas.

  Ejecutar primero con @Ejecutar = 0. Revisa el resumen final.
  Ejecutar con @Ejecutar = 1 solo con aprobacion de Bizlinks/DBA/tributario.

  Series excluidas adrede:
  - T002-00000015 y T002-00000018: no tienen transportista real grabado.
  - T002-00000021: no tiene cabecera en dbo.SPE_DESPATCH; fallo antes por permisos.

  Permisos esperados para el usuario ejecutor:
  - SELECT/UPDATE en dbo.SPE_DESPATCH.
  - SELECT/DELETE en dbo.SPE_DESPATCH_RESPONSE.
  - SELECT en dbo.SPE_DESPATCH_ITEM.
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

IF OBJECT_ID(N'dbo.ZZ_GRE_T002_REPROCESO_20260911_DESPATCH', N'U') IS NULL
BEGIN
  SELECT TOP (0)
    CAST(NULL AS datetime2(0)) AS respaldadoEn,
    CAST(NULL AS sysname) AS respaldadoPor,
    CAST(NULL AS varchar(40)) AS lote,
    d.*
  INTO dbo.ZZ_GRE_T002_REPROCESO_20260911_DESPATCH
  FROM dbo.SPE_DESPATCH d;
END;

IF OBJECT_ID(N'dbo.ZZ_GRE_T002_REPROCESO_20260911_RESPONSE', N'U') IS NULL
BEGIN
  SELECT TOP (0)
    CAST(NULL AS datetime2(0)) AS respaldadoEn,
    CAST(NULL AS sysname) AS respaldadoPor,
    CAST(NULL AS varchar(40)) AS lote,
    r.*
  INTO dbo.ZZ_GRE_T002_REPROCESO_20260911_RESPONSE
  FROM dbo.SPE_DESPATCH_RESPONSE r;
END;

INSERT INTO dbo.ZZ_GRE_T002_REPROCESO_20260911_DESPATCH
SELECT
  @Ahora AS respaldadoEn,
  SUSER_SNAME() AS respaldadoPor,
  'GRE_T002_PUBLICAS_20260911' AS lote,
  d.*
FROM dbo.SPE_DESPATCH d
INNER JOIN @Series s
  ON s.serieNumeroGuia = d.serieNumeroGuia
WHERE d.tipoDocumentoGuia = '09';

INSERT INTO dbo.ZZ_GRE_T002_REPROCESO_20260911_RESPONSE
SELECT
  @Ahora AS respaldadoEn,
  SUSER_SNAME() AS respaldadoPor,
  'GRE_T002_PUBLICAS_20260911' AS lote,
  r.*
FROM dbo.SPE_DESPATCH_RESPONSE r
INNER JOIN @Series s
  ON s.serieNumeroGuia = r.serieNumeroGuia
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
  SELECT s.serieNumeroGuia AS serieSinCabecera
  FROM @Series s
  WHERE NOT EXISTS (
    SELECT 1
    FROM dbo.SPE_DESPATCH d
    WHERE d.serieNumeroGuia = s.serieNumeroGuia
      AND d.tipoDocumentoGuia = '09'
  );

  THROW 51000, 'Hay series sin cabecera SPE_DESPATCH. No se reprocesa.', 1;
END;

IF EXISTS (
  SELECT 1
  FROM dbo.SPE_DESPATCH d
  INNER JOIN @Series s
    ON s.serieNumeroGuia = d.serieNumeroGuia
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
  SELECT
    d.serieNumeroGuia,
    r.bl_estadoRegistro,
    r.bl_estadoProceso,
    r.bl_mensajeSunat,
    r.bl_Ticket,
    r.bl_url_cdr
  FROM dbo.SPE_DESPATCH d
  INNER JOIN @Series s
    ON s.serieNumeroGuia = d.serieNumeroGuia
  LEFT JOIN dbo.SPE_DESPATCH_RESPONSE r
    ON r.tipoDocumentoRemitente = d.tipoDocumentoRemitente
   AND r.numeroDocumentoRemitente = d.numeroDocumentoRemitente
   AND r.serieNumeroGuia = d.serieNumeroGuia
   AND r.tipoDocumentoGuia = d.tipoDocumentoGuia
  WHERE d.tipoDocumentoGuia = '09';

  THROW 51001, 'Alguna serie parece tener aceptacion/ticket/CDR. No se reprocesa.', 1;
END;

IF EXISTS (
  SELECT 1
  FROM dbo.SPE_DESPATCH d
  INNER JOIN @Series s
    ON s.serieNumeroGuia = d.serieNumeroGuia
  WHERE d.tipoDocumentoGuia = '09'
    AND d.modalidadTraslado <> '01'
)
BEGIN
  THROW 51002, 'Este script solo reprocesa guias publicas reales modalidad 01.', 1;
END;

IF EXISTS (
  SELECT 1
  FROM dbo.SPE_DESPATCH d
  INNER JOIN @Series s
    ON s.serieNumeroGuia = d.serieNumeroGuia
  WHERE d.tipoDocumentoGuia = '09'
    AND (
      NULLIF(LTRIM(RTRIM(ISNULL(d.numeroRucTransportista, ''))), '') IS NULL
      OR NULLIF(LTRIM(RTRIM(ISNULL(d.tipoDocumentoTransportista, ''))), '') IS NULL
      OR NULLIF(LTRIM(RTRIM(ISNULL(d.razonSocialTransportista, ''))), '') IS NULL
    )
)
BEGIN
  SELECT
    d.serieNumeroGuia,
    d.numeroRucTransportista,
    d.tipoDocumentoTransportista,
    d.razonSocialTransportista
  FROM dbo.SPE_DESPATCH d
  INNER JOIN @Series s
    ON s.serieNumeroGuia = d.serieNumeroGuia
  WHERE d.tipoDocumentoGuia = '09';

  THROW 51003, 'Alguna serie publica no tiene transportista real completo. No se reprocesa.', 1;
END;

IF EXISTS (
  SELECT 1
  FROM @Series s
  WHERE NOT EXISTS (
    SELECT 1
    FROM dbo.SPE_DESPATCH_ITEM i
    WHERE i.serieNumeroGuia = s.serieNumeroGuia
      AND i.tipoDocumentoGuia = '09'
  )
)
BEGIN
  THROW 51004, 'Alguna serie no tiene items SPE_DESPATCH_ITEM. No se reprocesa.', 1;
END;

UPDATE d
SET
  fechaInicioTraslado = CASE
    WHEN NULLIF(LTRIM(RTRIM(ISNULL(d.fechaInicioTraslado, ''))), '') IS NULL THEN d.fechaEmisionGuia
    ELSE d.fechaInicioTraslado
  END,
  fechaEntregaBienes = CASE
    WHEN NULLIF(LTRIM(RTRIM(ISNULL(d.fechaEntregaBienes, ''))), '') IS NULL THEN d.fechaEmisionGuia
    ELSE d.fechaEntregaBienes
  END,
  codigoPtollegada = NULL,
  bl_estadoRegistro = 'A',
  bl_reintento = 0,
  bl_hasFileResponse = 0
FROM dbo.SPE_DESPATCH d
INNER JOIN @Series s
  ON s.serieNumeroGuia = d.serieNumeroGuia
WHERE d.tipoDocumentoGuia = '09'
  AND d.modalidadTraslado = '01';

DELETE r
FROM dbo.SPE_DESPATCH_RESPONSE r
INNER JOIN @Series s
  ON s.serieNumeroGuia = r.serieNumeroGuia
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
  (SELECT COUNT(1) FROM dbo.SPE_DESPATCH_ITEM i WHERE i.serieNumeroGuia = d.serieNumeroGuia AND i.tipoDocumentoGuia = '09') AS items,
  (SELECT COUNT(1) FROM dbo.SPE_DESPATCH_RESPONSE r WHERE r.serieNumeroGuia = d.serieNumeroGuia AND r.tipoDocumentoGuia = '09') AS responsesRestantes
FROM dbo.SPE_DESPATCH d
INNER JOIN @Series s
  ON s.serieNumeroGuia = d.serieNumeroGuia
WHERE d.tipoDocumentoGuia = '09'
ORDER BY d.serieNumeroGuia;

IF @Ejecutar = 1
BEGIN
  COMMIT TRANSACTION;
  SELECT 'COMMIT_APLICADO' AS resultado, 'Guias reencoladas en Bizlinks con datos reales.' AS detalle;
END
ELSE
BEGIN
  ROLLBACK TRANSACTION;
  SELECT 'ROLLBACK_VISTA_PREVIA' AS resultado, 'Revisar resumen; cambiar @Ejecutar = 1 para aplicar.' AS detalle;
END;
GO
