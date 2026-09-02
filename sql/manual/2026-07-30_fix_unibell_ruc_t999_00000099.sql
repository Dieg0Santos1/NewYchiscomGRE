/*
  Correccion controlada de RUC destinatario para una guia GRE_FC trazada.

  Contexto:
  - La guia T999-00000099 fue generada por el sistema de formularios continuos.
  - La BD/historico tenia UNIBELL S.A.C. con RUC 20611451354.
  - La guia fisica indica RUC 20511451354.

  Alcance:
  - Actualiza SOLO la guia GRE_FC trazada T999-00000099 en BIZLINKS_PROD21.dbo.SPE_DESPATCH.
  - Actualiza la trazabilidad propia en GRE_FORMULARIOS_TEST.dbo.GRE_FC_OPERACION.
  - Registra evento en GRE_FORMULARIOS_TEST.dbo.GRE_FC_EVENTO.

  No toca:
  - SPE_DESPATCH_ITEM
  - SPE_DESPATCH_RESPONSE
  - EMPAQUE
  - EMPAQUE_DETALLE

  Importante:
  - Este script no reprocesa Bizlinks ni SUNAT.
  - Si la guia ya tiene respuesta de rechazo, corregir el RUC no garantiza que cambie el estado.
*/

SET XACT_ABORT ON;

DECLARE @SerieNumeroGuia varchar(20) = 'T999-00000099';
DECLARE @RucIncorrecto varchar(20) = '20611451354';
DECLARE @RucCorrecto varchar(20) = '20511451354';
DECLARE @RazonSocial nvarchar(250) = N'UNIBELL S.A.C.';

BEGIN TRANSACTION;

DECLARE @OperacionDbId bigint;
DECLARE @EnvioId bigint;

SELECT
  @OperacionDbId = o.id,
  @EnvioId = e.id
FROM GRE_FORMULARIOS_TEST.dbo.GRE_FC_ENVIO e WITH (UPDLOCK, HOLDLOCK)
INNER JOIN GRE_FORMULARIOS_TEST.dbo.GRE_FC_OPERACION o WITH (UPDLOCK, HOLDLOCK)
  ON o.id = e.operacionId
WHERE e.serieNumeroGuia = @SerieNumeroGuia;

IF @OperacionDbId IS NULL OR @EnvioId IS NULL
BEGIN
  THROW 51000, 'La guia no existe en GRE_FC_ENVIO/GRE_FC_OPERACION. No se actualiza.', 1;
END;

IF (
  SELECT COUNT(1)
  FROM BIZLINKS_PROD21.dbo.SPE_DESPATCH WITH (UPDLOCK, HOLDLOCK)
  WHERE serieNumeroGuia = @SerieNumeroGuia
) <> 1
BEGIN
  THROW 51001, 'Se esperaba exactamente una fila en SPE_DESPATCH para la guia. No se actualiza.', 1;
END;

IF NOT EXISTS (
  SELECT 1
  FROM BIZLINKS_PROD21.dbo.SPE_DESPATCH WITH (UPDLOCK, HOLDLOCK)
  WHERE serieNumeroGuia = @SerieNumeroGuia
    AND tipoDocumentoDestinatario = '6'
    AND numeroDocumentoDestinatario = @RucIncorrecto
    AND LTRIM(RTRIM(razonSocialDestinatario)) = @RazonSocial
)
BEGIN
  THROW 51002, 'La guia no tiene el RUC incorrecto esperado o la razon social no coincide. No se actualiza.', 1;
END;

SELECT
  'ANTES SPE_DESPATCH' AS fuente,
  serieNumeroGuia,
  tipoDocumentoDestinatario,
  numeroDocumentoDestinatario,
  razonSocialDestinatario
FROM BIZLINKS_PROD21.dbo.SPE_DESPATCH
WHERE serieNumeroGuia = @SerieNumeroGuia;

SELECT
  'ANTES GRE_FC_OPERACION' AS fuente,
  CONVERT(varchar(36), idOperacion) AS idOperacion,
  tipoDocumentoDestinatario,
  numeroDocumentoDestinatario,
  razonSocialDestinatario
FROM GRE_FORMULARIOS_TEST.dbo.GRE_FC_OPERACION
WHERE id = @OperacionDbId;

UPDATE BIZLINKS_PROD21.dbo.SPE_DESPATCH
SET numeroDocumentoDestinatario = @RucCorrecto
WHERE serieNumeroGuia = @SerieNumeroGuia
  AND tipoDocumentoDestinatario = '6'
  AND numeroDocumentoDestinatario = @RucIncorrecto
  AND LTRIM(RTRIM(razonSocialDestinatario)) = @RazonSocial;

IF @@ROWCOUNT <> 1
BEGIN
  THROW 51003, 'No se actualizo exactamente una fila de SPE_DESPATCH. Se revierte.', 1;
END;

UPDATE GRE_FORMULARIOS_TEST.dbo.GRE_FC_OPERACION
SET numeroDocumentoDestinatario = @RucCorrecto,
    datosJson = CASE
      WHEN datosJson IS NULL THEN datosJson
      ELSE REPLACE(datosJson, @RucIncorrecto, @RucCorrecto)
    END,
    actualizadoEn = SYSUTCDATETIME()
WHERE id = @OperacionDbId
  AND numeroDocumentoDestinatario = @RucIncorrecto;

INSERT INTO GRE_FORMULARIOS_TEST.dbo.GRE_FC_EVENTO
(
  operacionId,
  envioId,
  tipo,
  mensaje,
  datosJson
)
VALUES
(
  @OperacionDbId,
  @EnvioId,
  'RUC_DESTINATARIO_CORREGIDO',
  'Correccion controlada de RUC destinatario en SPE_DESPATCH y GRE_FC_OPERACION',
  (
    SELECT
      @SerieNumeroGuia AS serieNumeroGuia,
      @RucIncorrecto AS rucAnterior,
      @RucCorrecto AS rucNuevo,
      @RazonSocial AS razonSocial,
      SYSUTCDATETIME() AS registradoEn
    FOR JSON PATH, WITHOUT_ARRAY_WRAPPER
  )
);

SELECT
  'DESPUES SPE_DESPATCH' AS fuente,
  serieNumeroGuia,
  tipoDocumentoDestinatario,
  numeroDocumentoDestinatario,
  razonSocialDestinatario
FROM BIZLINKS_PROD21.dbo.SPE_DESPATCH
WHERE serieNumeroGuia = @SerieNumeroGuia;

SELECT
  'DESPUES GRE_FC_OPERACION' AS fuente,
  CONVERT(varchar(36), idOperacion) AS idOperacion,
  tipoDocumentoDestinatario,
  numeroDocumentoDestinatario,
  razonSocialDestinatario
FROM GRE_FORMULARIOS_TEST.dbo.GRE_FC_OPERACION
WHERE id = @OperacionDbId;

COMMIT TRANSACTION;
