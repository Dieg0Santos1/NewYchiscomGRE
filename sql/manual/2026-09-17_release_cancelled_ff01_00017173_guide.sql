/*
  Libera T001-00000101 despues de la baja de FF01-00017173.

  FF01-00017173 fue aceptada por SUNAT y su numero NO se reutiliza.
  Este script conserva cabecera, detalle, XML, PDF y CDR. Prefiere una CDR
  de baja aceptada. Si Bizlinks/SUNAT aun no publican esa respuesta, permite
  la liberacion administrativa expresamente autorizada por el ingeniero.
  Tambien elimina el enlace operativo de EMPAQUE_DETALLE si existiera.
*/

SET NOCOUNT ON;
SET XACT_ABORT ON;

DECLARE @Invoice varchar(13) = 'FF01-00017173';
DECLARE @Guide varchar(13) = 'T001-00000101';
DECLARE @ReleasedGuidePlaceholder varchar(13) = 'T003-00000000';
DECLARE @AdministrativeReleaseAuthorized bit = 1;
DECLARE @OperationId bigint;
DECLARE @CancellationId varchar(100);
DECLARE @ReleaseEvent varchar(30);
DECLARE @ReleaseMessage nvarchar(500);

BEGIN TRANSACTION;

SELECT @OperationId = o.id
FROM GRE_FORMULARIOS_TEST.dbo.FC_FACT_OPERACION o WITH (UPDLOCK, HOLDLOCK)
WHERE o.serieNumeroFactura = @Invoice
  AND o.estado = 'ACEPTADA';

IF @OperationId IS NULL
  THROW 51100, 'No existe la operacion local ACEPTADA de FF01-00017173.', 1;

IF (SELECT COUNT(*)
    FROM GRE_FORMULARIOS_TEST.dbo.FC_FACT_OPERACION
    WHERE serieNumeroFactura = @Invoice AND estado = 'ACEPTADA') <> 1
  THROW 51107, 'No existe una unica operacion local ACEPTADA para la factura.', 1;

IF (SELECT COUNT(*)
    FROM GRE_FORMULARIOS_TEST.dbo.FC_FACT_ENVIO
    WHERE operacionId = @OperationId) <> 1
  THROW 51108, 'La operacion local no tiene exactamente un registro de envio.', 1;

IF NOT EXISTS (
    SELECT 1
    FROM BIZLINKS_PROD21.dbo.SPE_EINVOICE_RESPONSE r
    WHERE r.SERIENUMERO = @Invoice
      AND r.TIPODOCUMENTO = '01'
      AND r.process_state = '_3_COMPLETED'
      AND r.bl_mensajeSunat LIKE '%"codigo":"0"%'
  )
  THROW 51101, 'FF01-00017173 no tiene una CDR de emision aceptada.', 1;

SELECT TOP (1) @CancellationId = d.resumenId
FROM BIZLINKS_PROD21.dbo.SPE_CANCELDETAIL d WITH (UPDLOCK, HOLDLOCK)
INNER JOIN BIZLINKS_PROD21.dbo.SPE_CANCEL_RESPONSE r WITH (UPDLOCK, HOLDLOCK)
  ON r.numeroDocumentoEmisor = d.numeroDocumentoEmisor
 AND r.resumenId = d.resumenId
 AND r.tipoDocumentoEmisor = d.tipoDocumentoEmisor
WHERE d.tipoDocumento = '01'
  AND d.serieDocumentoBaja = LEFT(@Invoice, 4)
  AND RIGHT('00000000' + LTRIM(RTRIM(d.numeroDocumentoBaja)), 8) = RIGHT(@Invoice, 8)
  AND r.process_state = '_3_COMPLETED'
  AND (
    r.bl_estadoProceso IN ('AC_03', 'ACEPTADA', 'ACCEPTED')
    OR r.bl_mensajeSunat LIKE '%"codigo":"0"%'
    OR r.bl_mensajeSunat LIKE '%aceptad%'
  )
ORDER BY d.bl_createdAt DESC;

IF @CancellationId IS NOT NULL
BEGIN
  SET @ReleaseEvent = 'BAJA_ACEPTADA';
  SET @ReleaseMessage = 'Baja externa aceptada; guia liberada para una nueva factura sin reutilizar el correlativo anulado';
END
ELSE
BEGIN
  IF @AdministrativeReleaseAuthorized <> 1
    THROW 51102, 'La comunicacion de baja aun no tiene CDR aceptada y la liberacion administrativa no fue autorizada.', 1;

  IF NOT EXISTS (
      SELECT 1
      FROM BIZLINKS_PROD21.dbo.SPE_EINVOICEHEADER h
      WHERE h.SERIENUMERO = @Invoice
        AND h.TIPODOCUMENTO = '01'
        AND h.BL_ESTADOREGISTRO = 'B'
    )
    THROW 51112, 'La cabecera no tiene el estado B indicado por el ingeniero para la baja administrativa.', 1;

  SET @CancellationId = 'AUTORIZACION-ADMINISTRATIVA-INGENIERO';
  SET @ReleaseEvent = 'BAJA_ADMINISTRATIVA';
  SET @ReleaseMessage = 'Baja administrativa indicada por el ingeniero; guia liberada sin reutilizar el correlativo original';
END;

IF (SELECT COUNT(*)
    FROM BIZLINKS_PROD21.dbo.AAA_GUIAFACTURADA
    WHERE NRO_FACTURA = @Invoice AND NRO_GUIA = @Guide) <> 1
  THROW 51103, 'La relacion factura-guia no coincide con lo auditado.', 1;

IF NOT EXISTS (
    SELECT 1
    FROM GRE_FORMULARIOS_TEST.dbo.FC_FACT_GUIA g
    WHERE g.operacionId = @OperationId
      AND g.serieNumeroGuia = @Guide
  )
  THROW 51104, 'La trazabilidad local no contiene la guia esperada.', 1;

IF EXISTS (
    SELECT 1
    FROM GRE_FORMULARIOS_TEST.dbo.FC_FACT_EVENTO e
    WHERE e.operacionId = @OperationId
      AND e.tipo IN ('BAJA_ACEPTADA', 'BAJA_ADMINISTRATIVA')
  )
  THROW 51105, 'La baja ya fue conciliada anteriormente.', 1;

UPDATE BIZLINKS_PROD21.dbo.AAA_GUIAFACTURADA
SET NRO_GUIA = @ReleasedGuidePlaceholder,
    ESTADO = 'ANULADO'
WHERE NRO_FACTURA = @Invoice
  AND NRO_GUIA = @Guide;

UPDATE BIZLINKS_PROD21.dbo.EMPAQUE_DETALLE
SET SERIENUMEROGUIAFACTURA = NULL
WHERE SERIENUMEROGUIAFACTURA = @Invoice;

INSERT INTO GRE_FORMULARIOS_TEST.dbo.FC_FACT_EVENTO
  (operacionId, envioId, tipo, mensaje, datosJson)
SELECT @OperationId, e.id, @ReleaseEvent,
  @ReleaseMessage,
  CONCAT('{"facturaAnulada":"', @Invoice,
    '","guiaLiberada":"', @Guide,
    '","resumenBaja":"', STRING_ESCAPE(@CancellationId, 'json'), '"}')
FROM GRE_FORMULARIOS_TEST.dbo.FC_FACT_ENVIO e
WHERE e.operacionId = @OperationId;

IF @@ROWCOUNT <> 1
  THROW 51109, 'No se pudo registrar exactamente un evento de baja aceptada.', 1;

IF EXISTS (
    SELECT 1
    FROM BIZLINKS_PROD21.dbo.AAA_GUIAFACTURADA
    WHERE NRO_FACTURA = @Invoice AND NRO_GUIA = @Guide
  )
  THROW 51106, 'La guia no se libero; se revertira la transaccion.', 1;

IF EXISTS (
    SELECT 1
    FROM BIZLINKS_PROD21.dbo.EMPAQUE_DETALLE
    WHERE SERIENUMEROGUIAFACTURA = @Invoice
  )
  THROW 51111, 'EMPAQUE_DETALLE conserva referencias a la factura; se revertira la transaccion.', 1;

IF NOT EXISTS (
    SELECT 1
    FROM BIZLINKS_PROD21.dbo.SPE_EINVOICEHEADER h
    WHERE h.SERIENUMERO = @Invoice
      AND h.TIPODOCUMENTO = '01'
  ) OR NOT EXISTS (
    SELECT 1
    FROM BIZLINKS_PROD21.dbo.SPE_EINVOICE_RESPONSE r
    WHERE r.SERIENUMERO = @Invoice
      AND r.TIPODOCUMENTO = '01'
  )
  THROW 51110, 'La evidencia de la factura original fue alterada; se revertira la transaccion.', 1;

COMMIT TRANSACTION;

SELECT 'GUIA_LIBERADA' AS resultado,
  @Invoice AS facturaAnulada,
  @Guide AS guiaLiberada,
  @CancellationId AS resumenBaja;

SELECT NRO_GUIA, NRO_FACTURA, ESTADO, NOTACRE
FROM BIZLINKS_PROD21.dbo.AAA_GUIAFACTURADA
WHERE NRO_FACTURA = @Invoice;

SELECT o.serieNumeroFactura, o.estado, e.tipo, e.mensaje, e.datosJson
FROM GRE_FORMULARIOS_TEST.dbo.FC_FACT_OPERACION o
INNER JOIN GRE_FORMULARIOS_TEST.dbo.FC_FACT_EVENTO e ON e.operacionId = o.id
WHERE o.id = @OperationId
  AND e.tipo IN ('BAJA_ACEPTADA', 'BAJA_ADMINISTRATIVA');
