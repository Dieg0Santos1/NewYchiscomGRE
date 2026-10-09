/*
  Completa los campos que usa la representacion impresa antigua para
  facturas FF01 emitidas desde el sistema nuevo.

  Incluye:
  - FF01-00017175
  - FF01-00017176
  - FF01-00017185
  - FF01-00017186

  No reenvia documentos, no cambia importes, no cambia estado SUNAT.
  Conserva PDF/XML/CDR y solo actualiza textos auxiliares de impresion.
*/

SET NOCOUNT ON;
SET XACT_ABORT ON;

DECLARE @Emisor varchar(20) = '20259402965';

DECLARE @Fix table (
  serieNumeroFactura varchar(13) NOT NULL PRIMARY KEY,
  legacyNumero varchar(7) NOT NULL,
  textoLeyenda nvarchar(200) NOT NULL,
  condicion nvarchar(100) NOT NULL,
  tipoCambioImpresion nvarchar(40) NOT NULL,
  detraccionFlag nvarchar(1) NOT NULL,
  formaPagoNombre nvarchar(100) NOT NULL
);

INSERT INTO @Fix (
  serieNumeroFactura,
  legacyNumero,
  textoLeyenda,
  condicion,
  tipoCambioImpresion,
  detraccionFlag,
  formaPagoNombre
)
VALUES
  ('FF01-00017175', '0017175',
   'CIENTO SETENTA Y UNO CON 10/100 DOLARES AMERICANOS',
   N'Factura 30 d' + NCHAR(237) + N'as', '3.37', 'N', N'Factura 30 d' + NCHAR(237) + N'as'),
  ('FF01-00017176', '0017176',
   'DOS MIL CUATROCIENTOS SESENTA CON 02/100 SOLES',
   'Contado C/E', '1.00', 'N', 'Contado C/E'),
  ('FF01-00017185', '0017185',
   'DOCE MIL TRESCIENTOS DIECINUEVE CON 20/100 SOLES',
   N'Factura 30 d' + NCHAR(237) + N'as', '1.00', 'N', N'Factura 30 d' + NCHAR(237) + N'as'),
  ('FF01-00017186', '0017186',
   'NOVECIENTOS NOVENTA Y OCHO CON 75/100 SOLES',
   N'Factura 30 d' + NCHAR(237) + N'as', '1.00', 'N', N'Factura 30 d' + NCHAR(237) + N'as');

BEGIN TRANSACTION;

IF EXISTS (
    SELECT 1
    FROM @Fix f
    WHERE NOT EXISTS (
      SELECT 1
      FROM BIZLINKS_PROD21.dbo.SPE_EINVOICEHEADER h WITH (UPDLOCK, HOLDLOCK)
      INNER JOIN BIZLINKS_PROD21.dbo.SPE_EINVOICE_RESPONSE r WITH (UPDLOCK, HOLDLOCK)
        ON r.NUMERODOCUMENTOEMISOR = h.NUMERODOCUMENTOEMISOR
       AND r.SERIENUMERO = h.SERIENUMERO
       AND r.TIPODOCUMENTO = h.TIPODOCUMENTO
      WHERE h.NUMERODOCUMENTOEMISOR = @Emisor
        AND h.SERIENUMERO COLLATE SQL_Latin1_General_CP1_CI_AS
          = f.serieNumeroFactura COLLATE SQL_Latin1_General_CP1_CI_AS
        AND h.TIPODOCUMENTO = '01'
        AND h.BL_ESTADOREGISTRO = 'L'
        AND r.process_state = '_3_COMPLETED'
        AND r.bl_mensajeSunat LIKE '%"codigo":"0"%'
    )
  )
  THROW 51900, 'Una factura no esta aceptada como L con CDR codigo 0; no se reparara impresion.', 1;

UPDATE h
SET h.textoLeyenda_1 = f.textoLeyenda,
    h.codigoAuxiliar100_1 = '9415',
    h.textoAuxiliar100_1 = f.condicion,
    h.codigoAuxiliar40_2 = '9999',
    h.textoAuxiliar40_2 = f.tipoCambioImpresion,
    h.codigoAuxiliar40_3 = '9998',
    h.textoAuxiliar40_3 = f.detraccionFlag
FROM BIZLINKS_PROD21.dbo.SPE_EINVOICEHEADER h
INNER JOIN @Fix f
  ON f.serieNumeroFactura COLLATE SQL_Latin1_General_CP1_CI_AS
   = h.SERIENUMERO COLLATE SQL_Latin1_General_CP1_CI_AS
WHERE h.NUMERODOCUMENTOEMISOR = @Emisor
  AND h.TIPODOCUMENTO = '01';

IF @@ROWCOUNT <> 4
  THROW 51901, 'No se actualizaron exactamente cuatro cabeceras Bizlinks.', 1;

UPDATE d
SET d.Observaciones = f.textoLeyenda,
    d.formaPago = p.idPropiedades
FROM YCHIDB3.dbo.tbDocumentos d
INNER JOIN @Fix f
  ON f.legacyNumero COLLATE SQL_Latin1_General_CP1_CI_AS
   = d.NumeDocu COLLATE SQL_Latin1_General_CP1_CI_AS
INNER JOIN YCHIDB3.dbo.tbPropiedades p
  ON p.tipo = 'FPAG'
 AND (
   p.Nombre COLLATE SQL_Latin1_General_CP1_CI_AS = f.formaPagoNombre COLLATE SQL_Latin1_General_CP1_CI_AS
   OR p.Valor COLLATE SQL_Latin1_General_CP1_CI_AS = f.formaPagoNombre COLLATE SQL_Latin1_General_CP1_CI_AS
 )
WHERE d.idTipoDocu = 1
  AND d.SeriDocu = 'F01';

IF EXISTS (
    SELECT 1
    FROM BIZLINKS_PROD21.dbo.SPE_EINVOICEHEADER h
    INNER JOIN @Fix f
      ON f.serieNumeroFactura COLLATE SQL_Latin1_General_CP1_CI_AS
       = h.SERIENUMERO COLLATE SQL_Latin1_General_CP1_CI_AS
    WHERE h.NUMERODOCUMENTOEMISOR = @Emisor
      AND h.TIPODOCUMENTO = '01'
      AND (
        ISNULL(h.textoLeyenda_1, '') COLLATE SQL_Latin1_General_CP1_CI_AS
          <> f.textoLeyenda COLLATE SQL_Latin1_General_CP1_CI_AS
        OR ISNULL(h.textoAuxiliar100_1, '') COLLATE SQL_Latin1_General_CP1_CI_AS
          <> f.condicion COLLATE SQL_Latin1_General_CP1_CI_AS
        OR ISNULL(h.textoAuxiliar40_3, '') COLLATE SQL_Latin1_General_CP1_CI_AS
          <> f.detraccionFlag COLLATE SQL_Latin1_General_CP1_CI_AS
      )
  )
  THROW 51902, 'Alguna cabecera no quedo lista para impresion legacy; se revertira.', 1;

IF EXISTS (
    SELECT 1
    FROM YCHIDB3.dbo.tbDocumentos d
    INNER JOIN @Fix f
      ON f.legacyNumero COLLATE SQL_Latin1_General_CP1_CI_AS
       = d.NumeDocu COLLATE SQL_Latin1_General_CP1_CI_AS
    WHERE d.idTipoDocu = 1
      AND d.SeriDocu = 'F01'
      AND ISNULL(d.Observaciones, '') COLLATE SQL_Latin1_General_CP1_CI_AS
        <> f.textoLeyenda COLLATE SQL_Latin1_General_CP1_CI_AS
  )
  THROW 51903, 'Alguna factura legacy existente no quedo con Observaciones en letras; se revertira.', 1;

COMMIT TRANSACTION;

SELECT 'IMPRESION_LEGACY_REPARADA_LOTE' AS resultado,
  COUNT(*) AS facturasReparadas
FROM @Fix;

SELECT h.SERIENUMERO, h.textoLeyenda_1, h.codigoAuxiliar100_1,
  h.textoAuxiliar100_1, h.codigoAuxiliar40_2, h.textoAuxiliar40_2,
  h.codigoAuxiliar40_3, h.textoAuxiliar40_3
FROM BIZLINKS_PROD21.dbo.SPE_EINVOICEHEADER h
INNER JOIN @Fix f
  ON f.serieNumeroFactura COLLATE SQL_Latin1_General_CP1_CI_AS
   = h.SERIENUMERO COLLATE SQL_Latin1_General_CP1_CI_AS
WHERE h.NUMERODOCUMENTOEMISOR = @Emisor
  AND h.TIPODOCUMENTO = '01'
ORDER BY h.SERIENUMERO;

SELECT d.idDocumento, d.SeriDocu, d.NumeDocu, d.formaPago, p.Nombre AS formaPagoNombre,
  d.Observaciones
FROM @Fix f
LEFT JOIN YCHIDB3.dbo.tbDocumentos d
  ON d.idTipoDocu = 1
 AND d.SeriDocu = 'F01'
 AND d.NumeDocu COLLATE SQL_Latin1_General_CP1_CI_AS
   = f.legacyNumero COLLATE SQL_Latin1_General_CP1_CI_AS
LEFT JOIN YCHIDB3.dbo.tbPropiedades p ON p.idPropiedades = d.formaPago
ORDER BY f.legacyNumero;
