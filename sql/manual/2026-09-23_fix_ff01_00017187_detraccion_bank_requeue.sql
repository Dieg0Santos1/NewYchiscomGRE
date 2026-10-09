/*
  Corrige FF01-00017187 rechazada por Bizlinks con error 7778:
  faltaba numeroCtaBancoNacion para una operacion sujeta a detraccion.

  No borra SPE_ERROR_LOG; lo conserva como evidencia. Solo debe ejecutarse
  si no existe respuesta Bizlinks/SUNAT ni archivo fuente/XML/PDF/CDR.
*/

SET NOCOUNT ON;
SET XACT_ABORT ON;

DECLARE @Factura varchar(13) = 'FF01-00017187';
DECLARE @Emisor varchar(20) = '20259402965';
DECLARE @BancoNacion varchar(20) = '00-099022671';

BEGIN TRANSACTION;

IF (SELECT COUNT(*)
    FROM BIZLINKS_PROD21.dbo.SPE_EINVOICEHEADER WITH (UPDLOCK, HOLDLOCK)
    WHERE SERIENUMERO = @Factura
      AND TIPODOCUMENTO = '01'
      AND NUMERODOCUMENTOEMISOR = @Emisor
      AND BL_ESTADOREGISTRO = 'E') <> 1
  THROW 51700, 'La factura no tiene una unica cabecera Bizlinks en estado E.', 1;

IF NOT EXISTS (
    SELECT 1
    FROM BIZLINKS_PROD21.dbo.SPE_ERROR_LOG
    WHERE SERIENUMERO = @Factura
      AND TIPODOCUMENTO = '01'
      AND CODIGOERROR = '7778'
      AND DESCRIPCIONERROR LIKE '%numeroCtaBancoNacion%'
  )
  THROW 51701, 'No existe el error 7778 esperado por numeroCtaBancoNacion.', 1;

IF EXISTS (
    SELECT 1
    FROM BIZLINKS_PROD21.dbo.SPE_EINVOICE_RESPONSE WITH (UPDLOCK, HOLDLOCK)
    WHERE SERIENUMERO = @Factura
      AND TIPODOCUMENTO = '01'
  )
  THROW 51702, 'Ya existe respuesta Bizlinks/SUNAT; no se reencolara.', 1;

IF EXISTS (
    SELECT 1
    FROM BIZLINKS_PROD21.dbo.SPE_JOB_DOWNLOAD WITH (UPDLOCK, HOLDLOCK)
    WHERE serieNumero = @Factura
      AND tipoDocumento = '01'
      AND numeroDocumentoEmisor = @Emisor
  )
  THROW 51703, 'Ya existe PDF, XML o CDR; no se reencolara.', 1;

IF EXISTS (
    SELECT 1
    FROM BIZLINKS_PROD21.dbo.SPE_EINVOICEHEADER
    WHERE SERIENUMERO = @Factura
      AND TIPODOCUMENTO = '01'
      AND NUMERODOCUMENTOEMISOR = @Emisor
      AND BL_SOURCEFILE IS NOT NULL
  )
  THROW 51704, 'Bizlinks ya genero archivo fuente; no se reencolara.', 1;

IF EXISTS (
    SELECT 1
    FROM BIZLINKS_PROD21.dbo.SPE_EINVOICEHEADER
    WHERE SERIENUMERO = @Factura
      AND TIPODOCUMENTO = '01'
      AND NUMERODOCUMENTOEMISOR = @Emisor
      AND (
        tipoOperacion <> '1001'
        OR ISNULL(codigoDetraccion, '') <> '037'
        OR ISNULL(porcentajeDetraccion, '') = ''
        OR ISNULL(totalDetraccion, '') = ''
      )
  )
  THROW 51705, 'La cabecera no coincide con una operacion 1001 con detraccion completa.', 1;

UPDATE BIZLINKS_PROD21.dbo.SPE_EINVOICEHEADER
SET numeroCtaBancoNacion = @BancoNacion,
    BL_ESTADOREGISTRO = 'A',
    BL_REINTENTO = 0,
    BL_HASFILERESPONSE = 0
WHERE SERIENUMERO = @Factura
  AND TIPODOCUMENTO = '01'
  AND NUMERODOCUMENTOEMISOR = @Emisor;

IF @@ROWCOUNT <> 1
  THROW 51706, 'No se actualizo exactamente una cabecera.', 1;

IF EXISTS (
    SELECT 1
    FROM BIZLINKS_PROD21.dbo.SPE_EINVOICEHEADER
    WHERE SERIENUMERO = @Factura
      AND TIPODOCUMENTO = '01'
      AND NUMERODOCUMENTOEMISOR = @Emisor
      AND (
        ISNULL(numeroCtaBancoNacion, '') <> @BancoNacion
        OR BL_ESTADOREGISTRO <> 'A'
      )
  )
  THROW 51707, 'La factura no quedo corregida/reencolada; se revertira.', 1;

COMMIT TRANSACTION;

SELECT 'FACTURA_REENCOLADA' AS resultado,
  @Factura AS serieNumeroFactura,
  @BancoNacion AS numeroCtaBancoNacion;

SELECT SERIENUMERO, BL_ESTADOREGISTRO, tipoOperacion, codigoDetraccion,
  porcentajeDetraccion, totalDetraccion, numeroCtaBancoNacion, totalVenta
FROM BIZLINKS_PROD21.dbo.SPE_EINVOICEHEADER
WHERE SERIENUMERO = @Factura
  AND TIPODOCUMENTO = '01'
  AND NUMERODOCUMENTOEMISOR = @Emisor;
