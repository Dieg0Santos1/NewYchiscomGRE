/*
  Repara la representacion impresa antigua de FF01-00017176 y sincroniza
  el correlativo legacy para que el facturador antiguo muestre FF01-00017177.

  No reenvia documentos, no cambia importes, no cambia estado SUNAT.
*/

SET NOCOUNT ON;
SET XACT_ABORT ON;

DECLARE @Factura varchar(13) = 'FF01-00017176';
DECLARE @Emisor varchar(20) = '20259402965';
DECLARE @Numero int = 17176;
DECLARE @NumeroFF01 varchar(8) = '00017176';
DECLARE @NumeroF01 varchar(7) = '0017176';

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
    AND h.BL_ESTADOREGISTRO = 'L'
    AND r.process_state = '_3_COMPLETED'
    AND r.bl_mensajeSunat LIKE '%"codigo":"0"%'
)
  THROW 51400, 'La factura no esta emitida/aceptada como L con CDR codigo 0.', 1;

IF NOT EXISTS (
  SELECT 1
  FROM BIZLINKS_PROD21.dbo.SPE_EINVOICEHEADER_ADD WITH (UPDLOCK, HOLDLOCK)
  WHERE NUMERODOCUMENTOEMISOR = @Emisor
    AND SERIENUMERO = @Factura
    AND TIPODOCUMENTO = '01'
    AND clave = 'ordenCompra'
)
BEGIN
  INSERT INTO BIZLINKS_PROD21.dbo.SPE_EINVOICEHEADER_ADD (
    NUMERODOCUMENTOEMISOR,
    SERIENUMERO,
    TIPODOCUMENTO,
    TIPODOCUMENTOEMISOR,
    clave,
    valor
  )
  VALUES (
    @Emisor,
    @Factura,
    '01',
    '6',
    'ordenCompra',
    '-'
  );
END;

IF NOT EXISTS (
  SELECT 1
  FROM BIZLINKS_PROD21.dbo.SPE_EINVOICEHEADER_ADD
  WHERE NUMERODOCUMENTOEMISOR = @Emisor
    AND SERIENUMERO = @Factura
    AND TIPODOCUMENTO = '01'
    AND clave = 'ordenCompra'
)
  THROW 51401, 'No se pudo asegurar ordenCompra; se revertira.', 1;

IF NOT EXISTS (SELECT 1 FROM YCHIDB3.dbo.tbTipoDocu WITH (UPDLOCK, HOLDLOCK) WHERE idTipoDocu = 42)
  THROW 51402, 'No existe tbTipoDocu idTipoDocu 42 para FF01.', 1;

IF NOT EXISTS (SELECT 1 FROM YCHIDB3.dbo.tbTipoDocu WITH (UPDLOCK, HOLDLOCK) WHERE idTipoDocu = 1)
  THROW 51403, 'No existe tbTipoDocu idTipoDocu 1 para F01.', 1;

UPDATE YCHIDB3.dbo.tbTipoDocu
SET numero = @NumeroFF01
WHERE idTipoDocu = 42
  AND (
    ISNUMERIC(numero) = 0
    OR CAST(numero AS int) < @Numero
  );

UPDATE YCHIDB3.dbo.tbTipoDocu
SET numero = @NumeroF01
WHERE idTipoDocu = 1
  AND (
    ISNUMERIC(numero) = 0
    OR CAST(numero AS int) < @Numero
  );

IF EXISTS (
  SELECT 1
  FROM YCHIDB3.dbo.tbTipoDocu
  WHERE idTipoDocu = 42
    AND CAST(numero AS int) < @Numero
)
  THROW 51404, 'El correlativo FF01 legacy no quedo sincronizado; se revertira.', 1;

IF EXISTS (
  SELECT 1
  FROM YCHIDB3.dbo.tbTipoDocu
  WHERE idTipoDocu = 1
    AND CAST(numero AS int) < @Numero
)
  THROW 51405, 'El correlativo F01 legacy no quedo sincronizado; se revertira.', 1;

COMMIT TRANSACTION;

SELECT 'FF01_00017176_REPARADA_Y_CORRELATIVO_SYNC' AS resultado,
  @Factura AS serieNumeroFactura;

SELECT clave, valor
FROM BIZLINKS_PROD21.dbo.SPE_EINVOICEHEADER_ADD
WHERE NUMERODOCUMENTOEMISOR = @Emisor
  AND SERIENUMERO = @Factura
  AND TIPODOCUMENTO = '01'
  AND clave IN (
    'departamentoAdquiriente',
    'direccionAdquiriente',
    'distritoAdquiriente',
    'paisAdquiriente',
    'provinciaAdquiriente',
    'ubigeoAdquiriente',
    'urbanizacionAdquiriente',
    'ordenCompra',
    'fechaVencimiento'
  )
ORDER BY clave;

SELECT idTipoDocu, serie, numero
FROM YCHIDB3.dbo.tbTipoDocu
WHERE idTipoDocu IN (1, 42)
ORDER BY idTipoDocu;
