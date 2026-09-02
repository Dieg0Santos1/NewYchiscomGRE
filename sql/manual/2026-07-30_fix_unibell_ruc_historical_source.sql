/*
  Correccion de fuente historica para destinatario UNIBELL S.A.C.

  Objetivo:
  - Evitar que el sistema GRE Formularios Continuos vuelva a cargar el RUC incorrecto
    20611451354 desde el historico Bizlinks.
  - Dejar como RUC correcto 20511451354 para nuevas busquedas por OT.

  Alcance:
  - BIZLINKS_PROD21.dbo.SPE_DESPATCH:
      Corrige filas historicas del destinatario UNIBELL S.A.C. con RUC 20611451354.
  - GRE_FORMULARIOS_TEST.dbo.GRE_FC_OPERACION:
      Corrige trazabilidad propia si alguna operacion GRE_FC guardo el RUC incorrecto.
  - GRE_FORMULARIOS_TEST.dbo.GRE_FC_EVENTO:
      Registra auditoria para operaciones GRE_FC afectadas.

  No toca:
  - SPE_DESPATCH_ITEM
  - SPE_DESPATCH_RESPONSE
  - SPE_DESPATCH_AUXILIAR
  - EMPAQUE
  - EMPAQUE_DETALLE

  Uso:
  1. Ejecutar con @Ejecutar = 0 para revisar el impacto. Hace ROLLBACK.
  2. Si el resultado es correcto, cambiar @Ejecutar = 1 y ejecutar nuevamente.
*/

SET XACT_ABORT ON;

USE BIZLINKS_PROD21;

DECLARE @Ejecutar bit = 0; -- Cambiar a 1 solo despues de revisar la vista previa.
DECLARE @RucIncorrecto varchar(20) = '20611451354';
DECLARE @RucCorrecto varchar(20) = '20511451354';
DECLARE @RazonSocial nvarchar(250) = N'UNIBELL S.A.C.';

IF LEN(@RucCorrecto) <> 11 OR LEN(@RucIncorrecto) <> 11
BEGIN
  THROW 51100, 'Los RUC deben tener 11 digitos.', 1;
END;

BEGIN TRANSACTION;

IF OBJECT_ID('tempdb..#SpeDespatchAfectado') IS NOT NULL
BEGIN
  DROP TABLE #SpeDespatchAfectado;
END;

CREATE TABLE #SpeDespatchAfectado
(
  serieNumeroGuia varchar(20) COLLATE DATABASE_DEFAULT NOT NULL,
  tipoDocumentoDestinatario varchar(20) COLLATE DATABASE_DEFAULT NULL,
  numeroDocumentoDestinatarioAnterior varchar(20) COLLATE DATABASE_DEFAULT NULL,
  razonSocialDestinatario nvarchar(250) COLLATE DATABASE_DEFAULT NULL,
  bl_createdAt datetime NULL
);

INSERT INTO #SpeDespatchAfectado
(
  serieNumeroGuia,
  tipoDocumentoDestinatario,
  numeroDocumentoDestinatarioAnterior,
  razonSocialDestinatario,
  bl_createdAt
)
SELECT
  serieNumeroGuia,
  tipoDocumentoDestinatario,
  numeroDocumentoDestinatario,
  razonSocialDestinatario,
  bl_createdAt
FROM BIZLINKS_PROD21.dbo.SPE_DESPATCH WITH (UPDLOCK, HOLDLOCK)
WHERE tipoDocumentoDestinatario = '6'
  AND numeroDocumentoDestinatario = @RucIncorrecto
  AND UPPER(LTRIM(RTRIM(razonSocialDestinatario COLLATE DATABASE_DEFAULT))) = UPPER(@RazonSocial COLLATE DATABASE_DEFAULT);

SELECT
  'VISTA_PREVIA_BIZLINKS_SPE_DESPATCH' AS fuente,
  COUNT(1) AS filasAActualizar
FROM #SpeDespatchAfectado;

SELECT
  'VISTA_PREVIA_BIZLINKS_SPE_DESPATCH_DETALLE' AS fuente,
  serieNumeroGuia,
  tipoDocumentoDestinatario,
  numeroDocumentoDestinatarioAnterior,
  @RucCorrecto AS numeroDocumentoDestinatarioNuevo,
  razonSocialDestinatario,
  bl_createdAt
FROM #SpeDespatchAfectado
ORDER BY bl_createdAt DESC, serieNumeroGuia DESC;

SELECT
  'VISTA_PREVIA_GRE_FC_OPERACION' AS fuente,
  COUNT(1) AS filasAActualizar
FROM GRE_FORMULARIOS_TEST.dbo.GRE_FC_OPERACION WITH (UPDLOCK, HOLDLOCK)
WHERE tipoDocumentoDestinatario = '6'
  AND numeroDocumentoDestinatario = @RucIncorrecto
  AND UPPER(LTRIM(RTRIM(razonSocialDestinatario COLLATE DATABASE_DEFAULT))) = UPPER(@RazonSocial COLLATE DATABASE_DEFAULT);

UPDATE d
SET numeroDocumentoDestinatario = @RucCorrecto
FROM BIZLINKS_PROD21.dbo.SPE_DESPATCH d
INNER JOIN #SpeDespatchAfectado a
  ON a.serieNumeroGuia COLLATE DATABASE_DEFAULT = d.serieNumeroGuia COLLATE DATABASE_DEFAULT
WHERE d.tipoDocumentoDestinatario = '6'
  AND d.numeroDocumentoDestinatario = @RucIncorrecto
  AND UPPER(LTRIM(RTRIM(d.razonSocialDestinatario COLLATE DATABASE_DEFAULT))) = UPPER(@RazonSocial COLLATE DATABASE_DEFAULT);

DECLARE @SpeUpdated int = @@ROWCOUNT;

IF @SpeUpdated <> (SELECT COUNT(1) FROM #SpeDespatchAfectado)
BEGIN
  THROW 51101, 'La cantidad actualizada en SPE_DESPATCH no coincide con la vista previa. Se revierte.', 1;
END;

DECLARE @GreFcAfectado TABLE
(
  operacionId bigint NOT NULL,
  envioId bigint NULL,
  serieNumeroGuia varchar(20) COLLATE DATABASE_DEFAULT NULL,
  idOperacion uniqueidentifier NOT NULL
);

INSERT INTO @GreFcAfectado
(
  operacionId,
  envioId,
  serieNumeroGuia,
  idOperacion
)
SELECT
  o.id,
  e.id,
  e.serieNumeroGuia,
  o.idOperacion
FROM GRE_FORMULARIOS_TEST.dbo.GRE_FC_OPERACION o WITH (UPDLOCK, HOLDLOCK)
LEFT JOIN GRE_FORMULARIOS_TEST.dbo.GRE_FC_ENVIO e WITH (UPDLOCK, HOLDLOCK)
  ON e.operacionId = o.id
WHERE o.tipoDocumentoDestinatario = '6'
  AND o.numeroDocumentoDestinatario = @RucIncorrecto
  AND UPPER(LTRIM(RTRIM(o.razonSocialDestinatario COLLATE DATABASE_DEFAULT))) = UPPER(@RazonSocial COLLATE DATABASE_DEFAULT);

UPDATE o
SET numeroDocumentoDestinatario = @RucCorrecto,
    datosJson = CASE
      WHEN datosJson IS NULL THEN datosJson
      ELSE REPLACE(datosJson, @RucIncorrecto, @RucCorrecto)
    END,
    actualizadoEn = SYSUTCDATETIME()
FROM GRE_FORMULARIOS_TEST.dbo.GRE_FC_OPERACION o
INNER JOIN @GreFcAfectado a
  ON a.operacionId = o.id;

INSERT INTO GRE_FORMULARIOS_TEST.dbo.GRE_FC_EVENTO
(
  operacionId,
  envioId,
  tipo,
  mensaje,
  datosJson
)
SELECT
  a.operacionId,
  a.envioId,
  'RUC_DESTINATARIO_HISTORICO_CORREGIDO',
  'Correccion controlada de RUC destinatario historico para UNIBELL S.A.C.',
  (
    SELECT
      a.serieNumeroGuia,
      CONVERT(varchar(36), a.idOperacion) AS idOperacion,
      @RucIncorrecto AS rucAnterior,
      @RucCorrecto AS rucNuevo,
      @RazonSocial AS razonSocial,
      SYSUTCDATETIME() AS registradoEn
    FOR JSON PATH, WITHOUT_ARRAY_WRAPPER
  )
FROM @GreFcAfectado a;

SELECT
  'RESULTADO_BIZLINKS_SPE_DESPATCH' AS fuente,
  COUNT(1) AS filasConRucCorrecto
FROM BIZLINKS_PROD21.dbo.SPE_DESPATCH
WHERE tipoDocumentoDestinatario = '6'
  AND numeroDocumentoDestinatario = @RucCorrecto
  AND UPPER(LTRIM(RTRIM(razonSocialDestinatario COLLATE DATABASE_DEFAULT))) = UPPER(@RazonSocial COLLATE DATABASE_DEFAULT);

SELECT
  'RESTANTES_RUC_INCORRECTO' AS fuente,
  COUNT(1) AS filasRestantes
FROM BIZLINKS_PROD21.dbo.SPE_DESPATCH
WHERE tipoDocumentoDestinatario = '6'
  AND numeroDocumentoDestinatario = @RucIncorrecto
  AND UPPER(LTRIM(RTRIM(razonSocialDestinatario COLLATE DATABASE_DEFAULT))) = UPPER(@RazonSocial COLLATE DATABASE_DEFAULT);

IF @Ejecutar = 1
BEGIN
  COMMIT TRANSACTION;
  SELECT 'COMMIT_REALIZADO' AS resultado;
END
ELSE
BEGIN
  ROLLBACK TRANSACTION;
  SELECT 'ROLLBACK_VISTA_PREVIA' AS resultado, 'Cambiar @Ejecutar = 1 para aplicar.' AS instruccion;
END;
