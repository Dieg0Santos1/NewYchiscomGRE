/*
  Completa los campos que usa la representacion impresa antigua para
  FF01-00017187, ya aceptada por Bizlinks/SUNAT.

  No reenvia documentos, no cambia importes, no cambia estado SUNAT.
*/

SET NOCOUNT ON;
SET XACT_ABORT ON;

DECLARE @Factura varchar(13) = 'FF01-00017187';
DECLARE @Emisor varchar(20) = '20259402965';
DECLARE @LegacyNumero varchar(7) = '0017187';
DECLARE @TextoLeyenda nvarchar(200) = 'NOVECIENTOS TREINTA Y SEIS CON 92/100 DOLARES AMERICANOS';
DECLARE @Condicion nvarchar(100) = N'Factura 30 d' + NCHAR(237) + N'as';
DECLARE @TipoCambio nvarchar(40) = '3.36';
DECLARE @FormaPagoLegacy int;

BEGIN TRANSACTION;

IF NOT EXISTS (
    SELECT 1
    FROM BIZLINKS_PROD21.dbo.SPE_EINVOICEHEADER h WITH (UPDLOCK, HOLDLOCK)
    INNER JOIN BIZLINKS_PROD21.dbo.SPE_EINVOICE_RESPONSE r WITH (UPDLOCK, HOLDLOCK)
      ON r.NUMERODOCUMENTOEMISOR = h.NUMERODOCUMENTOEMISOR
     AND r.SERIENUMERO = h.SERIENUMERO
     AND r.TIPODOCUMENTO = h.TIPODOCUMENTO
    WHERE h.NUMERODOCUMENTOEMISOR = @Emisor
      AND h.SERIENUMERO = @Factura
      AND h.TIPODOCUMENTO = '01'
      AND r.process_state = '_3_COMPLETED'
      AND r.bl_mensajeSunat LIKE '%"codigo":"0"%'
  )
  THROW 51800, 'FF01-00017187 no tiene CDR aceptada; no se reparara impresion.', 1;

UPDATE BIZLINKS_PROD21.dbo.SPE_EINVOICEHEADER
SET textoLeyenda_1 = @TextoLeyenda,
    codigoAuxiliar100_1 = '9415',
    textoAuxiliar100_1 = @Condicion,
    codigoAuxiliar40_2 = '9999',
    textoAuxiliar40_2 = @TipoCambio,
    codigoAuxiliar40_3 = '9998',
    textoAuxiliar40_3 = 'S'
WHERE NUMERODOCUMENTOEMISOR = @Emisor
  AND SERIENUMERO = @Factura
  AND TIPODOCUMENTO = '01';

IF @@ROWCOUNT <> 1
  THROW 51801, 'No se actualizo exactamente una cabecera Bizlinks.', 1;

IF EXISTS (
    SELECT 1
    FROM YCHIDB3.dbo.tbDocumentos WITH (UPDLOCK, HOLDLOCK)
    WHERE idTipoDocu = 1
      AND SeriDocu = 'F01'
      AND NumeDocu = @LegacyNumero
  )
BEGIN
  SELECT TOP (1) @FormaPagoLegacy = idPropiedades
  FROM YCHIDB3.dbo.tbPropiedades WITH (UPDLOCK, HOLDLOCK)
  WHERE tipo = 'FPAG'
    AND (
      Nombre COLLATE SQL_Latin1_General_CP1_CI_AS IN (
        @Condicion COLLATE SQL_Latin1_General_CP1_CI_AS,
        'Factura 30 dias' COLLATE SQL_Latin1_General_CP1_CI_AS
      )
      OR Valor COLLATE SQL_Latin1_General_CP1_CI_AS IN (
        @Condicion COLLATE SQL_Latin1_General_CP1_CI_AS,
        'Factura 30 dias' COLLATE SQL_Latin1_General_CP1_CI_AS
      )
    )
  ORDER BY idPropiedades;

  IF @FormaPagoLegacy IS NULL
    THROW 51802, 'Existe la factura legacy, pero no se encontro forma de pago Factura 30 dias.', 1;

  UPDATE YCHIDB3.dbo.tbDocumentos
  SET Observaciones = @TextoLeyenda,
      formaPago = @FormaPagoLegacy
  WHERE idTipoDocu = 1
    AND SeriDocu = 'F01'
    AND NumeDocu = @LegacyNumero;

  IF @@ROWCOUNT <> 1
    THROW 51803, 'No se actualizo exactamente una factura legacy.', 1;
END;

IF EXISTS (
    SELECT 1
    FROM BIZLINKS_PROD21.dbo.SPE_EINVOICEHEADER
    WHERE NUMERODOCUMENTOEMISOR = @Emisor
      AND SERIENUMERO = @Factura
      AND TIPODOCUMENTO = '01'
      AND (
        ISNULL(textoLeyenda_1, '') COLLATE SQL_Latin1_General_CP1_CI_AS
          <> @TextoLeyenda COLLATE SQL_Latin1_General_CP1_CI_AS
        OR ISNULL(textoAuxiliar100_1, '') COLLATE SQL_Latin1_General_CP1_CI_AS
          <> @Condicion COLLATE SQL_Latin1_General_CP1_CI_AS
        OR ISNULL(textoAuxiliar40_3, '') COLLATE SQL_Latin1_General_CP1_CI_AS
          <> 'S' COLLATE SQL_Latin1_General_CP1_CI_AS
      )
  )
  THROW 51804, 'La cabecera no quedo lista para impresion legacy; se revertira.', 1;

COMMIT TRANSACTION;

SELECT 'IMPRESION_LEGACY_REPARADA' AS resultado,
  @Factura AS serieNumeroFactura,
  @Condicion AS condicion,
  @TextoLeyenda AS textoLeyenda;

SELECT SERIENUMERO, textoLeyenda_1, codigoAuxiliar100_1, textoAuxiliar100_1,
  codigoAuxiliar40_2, textoAuxiliar40_2, codigoAuxiliar40_3, textoAuxiliar40_3
FROM BIZLINKS_PROD21.dbo.SPE_EINVOICEHEADER
WHERE NUMERODOCUMENTOEMISOR = @Emisor
  AND SERIENUMERO = @Factura
  AND TIPODOCUMENTO = '01';

SELECT idDocumento, SeriDocu, NumeDocu, formaPago, Observaciones
FROM YCHIDB3.dbo.tbDocumentos
WHERE idTipoDocu = 1
  AND SeriDocu = 'F01'
  AND NumeDocu = @LegacyNumero;
