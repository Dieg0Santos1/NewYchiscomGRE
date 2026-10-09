/*
  Libera FF01-00017174, rechazada por Bizlinks antes de llegar a SUNAT.

  Alcance:
  - conserva SPE_ERROR_LOG como evidencia historica;
  - conserva FF01-00017173 y su relacion con T001-00000101;
  - archiva la traza local rechazada como ARC-00017174;
  - elimina solo los residuos operativos de FF01-00017174;
  - no ejecuta USP_EnviaDocumentoFE ni envia documentos.

  Ejecutar con una cuenta administrativa en el servidor que aloja
  BIZLINKS_PROD21 y GRE_FORMULARIOS_TEST.
*/

SET NOCOUNT ON;
SET XACT_ABORT ON;

DECLARE @Target varchar(13) = 'FF01-00017174';
DECLARE @Replacement varchar(13) = 'FF01-00017173';
DECLARE @Archived varchar(13) = 'ARC-00017174';
DECLARE @EmitterRuc varchar(20) = '20259402965';
DECLARE @OperationId bigint;

BEGIN TRANSACTION;

SELECT @OperationId = o.id
FROM GRE_FORMULARIOS_TEST.dbo.FC_FACT_OPERACION o WITH (UPDLOCK, HOLDLOCK)
WHERE o.serieNumeroFactura = @Target
  AND o.estado = 'RECHAZADA';

IF @OperationId IS NULL
  THROW 51000, 'No existe una unica operacion local RECHAZADA para FF01-00017174.', 1;

IF (SELECT COUNT(*) FROM GRE_FORMULARIOS_TEST.dbo.FC_FACT_OPERACION WHERE serieNumeroFactura = @Target) <> 1
  THROW 51001, 'Existe mas de una operacion local para FF01-00017174.', 1;

IF EXISTS (SELECT 1 FROM GRE_FORMULARIOS_TEST.dbo.FC_FACT_OPERACION WHERE serieNumeroFactura = @Archived)
  THROW 51002, 'Ya existe la serie de archivo ARC-00017174.', 1;

IF EXISTS (SELECT 1 FROM GRE_FORMULARIOS_TEST.dbo.FC_FACT_GUIA WHERE operacionId = @OperationId)
   OR EXISTS (SELECT 1 FROM GRE_FORMULARIOS_TEST.dbo.FC_FACT_DETALLE WHERE operacionId = @OperationId)
  THROW 51003, 'La operacion local conserva guias o detalles y no se liberara.', 1;

IF (SELECT COUNT(*) FROM GRE_FORMULARIOS_TEST.dbo.FC_FACT_ENVIO WHERE operacionId = @OperationId) <> 1
  THROW 51004, 'La operacion local no tiene exactamente un registro de envio.', 1;

IF (SELECT COUNT(*)
    FROM BIZLINKS_PROD21.dbo.SPE_EINVOICEHEADER WITH (UPDLOCK, HOLDLOCK)
    WHERE SERIENUMERO = @Target AND TIPODOCUMENTO = '01'
      AND NUMERODOCUMENTOEMISOR = @EmitterRuc
      AND BL_ESTADOREGISTRO = 'E') <> 1
  THROW 51005, 'La factura no tiene una unica cabecera Bizlinks en estado E.', 1;

IF EXISTS (
    SELECT 1 FROM BIZLINKS_PROD21.dbo.SPE_EINVOICEHEADER
    WHERE SERIENUMERO = @Target AND TIPODOCUMENTO = '01'
      AND NUMERODOCUMENTOEMISOR = @EmitterRuc
      AND BL_SOURCEFILE IS NOT NULL
  )
  THROW 51006, 'Bizlinks ya genero un archivo fuente; no se puede reutilizar.', 1;

IF EXISTS (
    SELECT 1 FROM BIZLINKS_PROD21.dbo.SPE_EINVOICE_RESPONSE WITH (UPDLOCK, HOLDLOCK)
    WHERE SERIENUMERO = @Target AND TIPODOCUMENTO = '01'
  )
  THROW 51007, 'Existe una respuesta Bizlinks/SUNAT; no se puede reutilizar.', 1;

IF EXISTS (
    SELECT 1 FROM BIZLINKS_PROD21.dbo.SPE_JOB_DOWNLOAD WITH (UPDLOCK, HOLDLOCK)
    WHERE serieNumero = @Target AND tipoDocumento = '01'
      AND numeroDocumentoEmisor = @EmitterRuc
  )
  THROW 51008, 'Existe PDF, XML o CDR; no se puede reutilizar.', 1;

IF (SELECT COUNT(*) FROM BIZLINKS_PROD21.dbo.AAA_GUIAFACTURADA WHERE NRO_FACTURA = @Target) <> 1
  THROW 51009, 'La relacion residual de guia no coincide con lo auditado.', 1;

IF NOT EXISTS (
    SELECT 1
    FROM BIZLINKS_PROD21.dbo.AAA_GUIAFACTURADA oldLink
    INNER JOIN BIZLINKS_PROD21.dbo.AAA_GUIAFACTURADA acceptedLink
      ON acceptedLink.NRO_GUIA = oldLink.NRO_GUIA
     AND acceptedLink.NRO_FACTURA = @Replacement
    INNER JOIN BIZLINKS_PROD21.dbo.SPE_EINVOICE_RESPONSE acceptedResponse
      ON acceptedResponse.SERIENUMERO = acceptedLink.NRO_FACTURA
     AND acceptedResponse.TIPODOCUMENTO = '01'
     AND acceptedResponse.process_state = '_3_COMPLETED'
     AND acceptedResponse.bl_mensajeSunat LIKE '%"codigo":"0"%'
    WHERE oldLink.NRO_FACTURA = @Target
  )
  THROW 51010, 'La guia anterior no esta respaldada por FF01-00017173 aceptada.', 1;

INSERT INTO GRE_FORMULARIOS_TEST.dbo.FC_FACT_EVENTO
  (operacionId, envioId, tipo, mensaje, datosJson)
SELECT @OperationId, e.id, 'CORRELATIVO_LIBERADO',
  'Intento rechazado sin respuesta SUNAT archivado para corregir y reutilizar el correlativo',
  '{"serieOriginal":"FF01-00017174","serieArchivada":"ARC-00017174","facturaRespaldo":"FF01-00017173"}'
FROM GRE_FORMULARIOS_TEST.dbo.FC_FACT_ENVIO e
WHERE e.operacionId = @OperationId;

UPDATE GRE_FORMULARIOS_TEST.dbo.FC_FACT_OPERACION
SET serieNumeroFactura = @Archived,
    actualizadoEn = SYSUTCDATETIME(),
    finalizadoEn = COALESCE(finalizadoEn, SYSUTCDATETIME())
WHERE id = @OperationId;

DELETE FROM BIZLINKS_PROD21.dbo.AAA_GUIAFACTURADA
WHERE NRO_FACTURA = @Target;

DELETE FROM BIZLINKS_PROD21.dbo.SPE_EINVOICEHEADER_ADD
WHERE SERIENUMERO = @Target AND TIPODOCUMENTO = '01'
  AND NUMERODOCUMENTOEMISOR = @EmitterRuc;

DELETE FROM BIZLINKS_PROD21.dbo.SPE_EINVOICEDETAIL
WHERE SERIENUMERO = @Target AND TIPODOCUMENTO = '01'
  AND NUMERODOCUMENTOEMISOR = @EmitterRuc;

DELETE FROM BIZLINKS_PROD21.dbo.SPE_EINVOICEHEADER
WHERE SERIENUMERO = @Target AND TIPODOCUMENTO = '01'
  AND NUMERODOCUMENTOEMISOR = @EmitterRuc;

IF EXISTS (SELECT 1 FROM BIZLINKS_PROD21.dbo.SPE_EINVOICEHEADER WHERE SERIENUMERO = @Target AND TIPODOCUMENTO = '01')
   OR EXISTS (SELECT 1 FROM BIZLINKS_PROD21.dbo.SPE_EINVOICEDETAIL WHERE SERIENUMERO = @Target AND TIPODOCUMENTO = '01')
   OR EXISTS (SELECT 1 FROM BIZLINKS_PROD21.dbo.SPE_EINVOICEHEADER_ADD WHERE SERIENUMERO = @Target AND TIPODOCUMENTO = '01')
   OR EXISTS (SELECT 1 FROM BIZLINKS_PROD21.dbo.AAA_GUIAFACTURADA WHERE NRO_FACTURA = @Target)
  THROW 51011, 'La liberacion dejo residuos; se revertira toda la transaccion.', 1;

COMMIT TRANSACTION;

SELECT 'LIBERADA' AS resultado, @Target AS serieNumero;
SELECT serieNumeroFactura, estado
FROM GRE_FORMULARIOS_TEST.dbo.FC_FACT_OPERACION
WHERE id = @OperationId;
SELECT SERIENUMERO, TIPODOCUMENTO, BL_ESTADOREGISTRO
FROM BIZLINKS_PROD21.dbo.SPE_EINVOICEHEADER
WHERE SERIENUMERO IN (@Target, @Replacement) AND TIPODOCUMENTO = '01';
