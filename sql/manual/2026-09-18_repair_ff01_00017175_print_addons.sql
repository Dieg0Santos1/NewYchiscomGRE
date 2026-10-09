/*
  Repara la representacion impresa antigua de FF01-00017175.

  La factura fue aceptada por Bizlinks/SUNAT, pero Crystal Reports no muestra
  datos si falta alguna fila requerida por VW_FACTURA_HEADER. Para este caso
  falta SPE_EINVOICEHEADER_ADD.clave = 'ordenCompra'.

  No reenvia documentos, no cambia importes, no cambia estado SUNAT.
*/

SET NOCOUNT ON;
SET XACT_ABORT ON;

DECLARE @Factura varchar(13) = 'FF01-00017175';
DECLARE @Emisor varchar(20) = '20259402965';

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
  THROW 51300, 'La factura no esta emitida/aceptada como L con CDR codigo 0.', 1;

IF EXISTS (
  SELECT 1
  FROM BIZLINKS_PROD21.dbo.SPE_EINVOICEHEADER_ADD WITH (UPDLOCK, HOLDLOCK)
  WHERE NUMERODOCUMENTOEMISOR = @Emisor
    AND SERIENUMERO = @Factura
    AND TIPODOCUMENTO = '01'
    AND clave = 'ordenCompra'
)
  THROW 51301, 'La fila ordenCompra ya existe; no se modifica nada.', 1;

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

IF NOT EXISTS (
  SELECT 1
  FROM BIZLINKS_PROD21.dbo.SPE_EINVOICEHEADER_ADD
  WHERE NUMERODOCUMENTOEMISOR = @Emisor
    AND SERIENUMERO = @Factura
    AND TIPODOCUMENTO = '01'
    AND clave = 'ordenCompra'
    AND valor = '-'
)
  THROW 51302, 'No se pudo crear ordenCompra; se revertira.', 1;

COMMIT TRANSACTION;

SELECT 'ORDENCOMPRA_REPARADA' AS resultado, @Factura AS serieNumeroFactura;

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
