USE BIZLINKS_PROD21;
GO

/*
  Reemision/reencolado de GRE T002 privadas rechazadas por codigo SUNAT 2108:
  "Presentacion fuera de fecha o con Fecha/hora mayor a la recepcion en SUNAT".

  Contexto:
  - Las operaciones fueron corregidas a transporte privado real.
  - Algunas conservaron fechaEmisionGuia/fechaInicioTraslado del 2026-09-09
    y fueron reenviadas el 2026-09-11, generando rechazo 2108.

  Accion:
  - Respalda cabecera y respuestas actuales.
  - Valida que no exista aceptacion SUNAT previa.
  - Actualiza fechaEmisionGuia, fechaInicioTraslado y horaEmisionGuia a la fecha/hora actual
    del servidor menos 15 minutos.
  - Mantiene modalidad privada con chofer/placa/licencia reales.
  - Elimina respuestas no aceptadas de esas series para permitir reproceso.
  - Reencola con bl_estadoRegistro = 'A'.

  Ejecutar primero con @Ejecutar = 0.
  Cambiar a @Ejecutar = 1 solo si el preview es correcto.

  No incluye T002-00000027 porque ya tiene fecha 2026-09-11 y esta pendiente PE_02.
*/

SET XACT_ABORT ON;

DECLARE @Ejecutar bit = 0;
DECLARE @ReemisionAt datetime = DATEADD(MINUTE, -15, GETDATE());
DECLARE @FechaReemision varchar(10) = CONVERT(varchar(10), @ReemisionAt, 23);
DECLARE @HoraReemision varchar(8) = CONVERT(varchar(8), @ReemisionAt, 108);

DECLARE @TipoDocumentoConductor varchar(2) = '1';
DECLARE @NumeroDocumentoConductor varchar(11) = '09517108';
DECLARE @NombreConductor varchar(250) = 'JUAN JOSE';
DECLARE @ApellidoConductor varchar(250) = 'APARICIO HERRERA';
DECLARE @NumeroLicencia varchar(10) = 'Q09517108';
DECLARE @NumeroPlacaVehiculoPrin varchar(8) = 'A45895';

DECLARE @Series TABLE
(
  serieNumeroGuia varchar(13) NOT NULL PRIMARY KEY
);

INSERT INTO @Series (serieNumeroGuia)
VALUES
  ('T002-00000015'),
  ('T002-00000016'),
  ('T002-00000017'),
  ('T002-00000018'),
  ('T002-00000019'),
  ('T002-00000020'),
  ('T002-00000022');

BEGIN TRANSACTION;

IF OBJECT_ID(N'dbo.ZZ_GRE_T002_2108_20260911_DESPATCH', N'U') IS NULL
BEGIN
  SELECT TOP (0)
    CAST(NULL AS datetime2(0)) AS respaldadoEn,
    CAST(NULL AS sysname) AS respaldadoPor,
    CAST(NULL AS varchar(40)) AS lote,
    d.*
  INTO dbo.ZZ_GRE_T002_2108_20260911_DESPATCH
  FROM dbo.SPE_DESPATCH d;
END;

IF OBJECT_ID(N'dbo.ZZ_GRE_T002_2108_20260911_RESPONSE', N'U') IS NULL
BEGIN
  SELECT TOP (0)
    CAST(NULL AS datetime2(0)) AS respaldadoEn,
    CAST(NULL AS sysname) AS respaldadoPor,
    CAST(NULL AS varchar(40)) AS lote,
    r.*
  INTO dbo.ZZ_GRE_T002_2108_20260911_RESPONSE
  FROM dbo.SPE_DESPATCH_RESPONSE r;
END;

INSERT INTO dbo.ZZ_GRE_T002_2108_20260911_DESPATCH
SELECT SYSDATETIME(), SUSER_SNAME(), 'GRE_T002_2108_20260911', d.*
FROM dbo.SPE_DESPATCH d
INNER JOIN @Series s
  ON s.serieNumeroGuia = d.serieNumeroGuia
WHERE d.tipoDocumentoGuia = '09';

INSERT INTO dbo.ZZ_GRE_T002_2108_20260911_RESPONSE
SELECT SYSDATETIME(), SUSER_SNAME(), 'GRE_T002_2108_20260911', r.*
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

  THROW 51400, 'Hay series sin cabecera SPE_DESPATCH. No se reprocesa.', 1;
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
  THROW 51401, 'Hay series sin items SPE_DESPATCH_ITEM. No se reprocesa.', 1;
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

  THROW 51402, 'Alguna serie ya parece aceptada por SUNAT. No se reprocesa.', 1;
END;

UPDATE d
SET
  fechaEmisionGuia = @FechaReemision,
  horaEmisionGuia = @HoraReemision,
  fechaInicioTraslado = @FechaReemision,
  fechaEntregaBienes = NULL,
  modalidadTraslado = '02',
  numeroRucTransportista = NULL,
  tipoDocumentoTransportista = NULL,
  razonSocialTransportista = NULL,
  numeroDocumentoConductor = @NumeroDocumentoConductor,
  tipoDocumentoConductor = @TipoDocumentoConductor,
  nombreConductor = @NombreConductor,
  apellidoConductor = @ApellidoConductor,
  numeroLicencia = @NumeroLicencia,
  numeroPlacaVehiculoPrin = @NumeroPlacaVehiculoPrin,
  codigoPtoPartida = NULL,
  codigoPtollegada = NULL,
  numeroDocumentoPtoPartida = NULL,
  numeroDocumentoPtoLlegada = NULL,
  bl_estadoRegistro = 'A',
  bl_reintento = 0,
  bl_hasFileResponse = 0,
  bl_createdAt = @ReemisionAt
FROM dbo.SPE_DESPATCH d
INNER JOIN @Series s
  ON s.serieNumeroGuia = d.serieNumeroGuia
WHERE d.tipoDocumentoGuia = '09';

DELETE r
FROM dbo.SPE_DESPATCH_RESPONSE r
INNER JOIN @Series s
  ON s.serieNumeroGuia = r.serieNumeroGuia
WHERE r.tipoDocumentoGuia = '09'
  AND NOT (
    r.bl_estadoProceso LIKE '%AC_03%'
    OR r.bl_mensajeSunat LIKE '%"codigo":"0"%'
    OR r.bl_mensajeSunat LIKE '%ha sido aceptado%'
  );

SELECT
  d.serieNumeroGuia,
  d.bl_estadoRegistro,
  d.modalidadTraslado,
  d.fechaEmisionGuia,
  d.horaEmisionGuia,
  d.fechaInicioTraslado,
  d.fechaEntregaBienes,
  d.numeroDocumentoConductor,
  d.tipoDocumentoConductor,
  d.nombreConductor,
  d.apellidoConductor,
  d.numeroLicencia,
  d.numeroPlacaVehiculoPrin,
  (SELECT COUNT(1) FROM dbo.SPE_DESPATCH_RESPONSE r WHERE r.serieNumeroGuia = d.serieNumeroGuia AND r.tipoDocumentoGuia = '09') AS responsesRestantes
FROM dbo.SPE_DESPATCH d
INNER JOIN @Series s
  ON s.serieNumeroGuia = d.serieNumeroGuia
WHERE d.tipoDocumentoGuia = '09'
ORDER BY d.serieNumeroGuia;

IF @Ejecutar = 1
BEGIN
  COMMIT TRANSACTION;
  SELECT 'COMMIT_APLICADO' AS resultado, CONCAT('Guias reencoladas con fecha=', @FechaReemision, ' hora=', @HoraReemision) AS detalle;
END
ELSE
BEGIN
  ROLLBACK TRANSACTION;
  SELECT 'ROLLBACK_VISTA_PREVIA' AS resultado, CONCAT('Preview con fecha=', @FechaReemision, ' hora=', @HoraReemision, '. Cambiar @Ejecutar = 1 para aplicar.') AS detalle;
END;
GO
