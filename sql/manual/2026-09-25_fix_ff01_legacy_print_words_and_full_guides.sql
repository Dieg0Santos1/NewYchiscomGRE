/*
  Sanea datos legacy de impresion/registro para facturas FF01 emitidas desde
  el sistema nuevo.

  Corrige:
  - YCHIDB3.dbo.tbDocumentos.nguia con la guia completa T001-00000120.
  - BIZLINKS_PROD21.dbo.SPE_EINVOICEHEADER.textoLeyenda_1 desde
    tbDocumentos.Observaciones cuando Bizlinks quedo con texto numerico.
  - BIZLINKS_PROD21.dbo.SPE_EINVOICEHEADER.textoAuxiliar100_1 con la
    condicion/forma de pago para la representacion impresa antigua.

  No reenvia documentos, no cambia importes, no cambia estados SUNAT.
*/

SET NOCOUNT ON;
SET XACT_ABORT ON;

DECLARE @Desde date = '2026-09-17';
DECLARE @Emisor varchar(20) = '20259402965';

IF OBJECT_ID('tempdb..#Fix') IS NOT NULL DROP TABLE #Fix;

CREATE TABLE #Fix (
  operacionId bigint NOT NULL,
  serieNumeroFactura varchar(13) NOT NULL,
  legacyNumero varchar(7) NOT NULL,
  guiaCompleta varchar(750) NOT NULL,
  textoLeyenda varchar(750) NOT NULL,
  condicion nvarchar(100) NOT NULL,
  idDocumento int NULL,
  guiaActual varchar(750) NULL,
  textoLeyendaActual varchar(750) NULL,
  condicionActual nvarchar(100) NULL
);

;WITH Guias AS (
  SELECT
    o.id AS operacionId,
    STUFF((
      SELECT ', ' + g2.serieNumeroGuia
      FROM GRE_FORMULARIOS_TEST.dbo.FC_FACT_GUIA g2
      WHERE g2.operacionId = o.id
      ORDER BY g2.serieNumeroGuia
      FOR XML PATH(''), TYPE
    ).value('.', 'varchar(max)'), 1, 2, '') AS guiaCompleta,
    MIN(g.serieNumeroGuia) AS primeraGuia
  FROM GRE_FORMULARIOS_TEST.dbo.FC_FACT_OPERACION o
  INNER JOIN GRE_FORMULARIOS_TEST.dbo.FC_FACT_GUIA g
    ON g.operacionId = o.id
  WHERE o.serie = 'FF01'
    AND o.fechaEmision >= @Desde
  GROUP BY o.id
)
INSERT INTO #Fix (
  operacionId,
  serieNumeroFactura,
  legacyNumero,
  guiaCompleta,
  textoLeyenda,
  condicion,
  idDocumento,
  guiaActual,
  textoLeyendaActual,
  condicionActual
)
SELECT
  o.id,
  o.serieNumeroFactura,
  RIGHT('0000000' + CONVERT(varchar(20), CONVERT(int, o.numero)), 7) AS legacyNumero,
  LEFT(g.guiaCompleta, 750),
  LEFT(d.Observaciones, 750),
  LEFT(o.formaPago, 100),
  d.idDocumento,
  d.nguia,
  h.textoLeyenda_1,
  h.textoAuxiliar100_1
FROM GRE_FORMULARIOS_TEST.dbo.FC_FACT_OPERACION o WITH (UPDLOCK, HOLDLOCK)
INNER JOIN Guias g ON g.operacionId = o.id
INNER JOIN BIZLINKS_PROD21.dbo.SPE_EINVOICEHEADER h WITH (UPDLOCK, HOLDLOCK)
  ON h.NUMERODOCUMENTOEMISOR COLLATE SQL_Latin1_General_CP1_CI_AS
   = @Emisor COLLATE SQL_Latin1_General_CP1_CI_AS
 AND h.SERIENUMERO COLLATE SQL_Latin1_General_CP1_CI_AS
   = o.serieNumeroFactura COLLATE SQL_Latin1_General_CP1_CI_AS
 AND h.TIPODOCUMENTO COLLATE SQL_Latin1_General_CP1_CI_AS = '01'
INNER JOIN BIZLINKS_PROD21.dbo.SPE_EINVOICE_RESPONSE r WITH (UPDLOCK, HOLDLOCK)
  ON r.NUMERODOCUMENTOEMISOR = h.NUMERODOCUMENTOEMISOR
 AND r.SERIENUMERO = h.SERIENUMERO
 AND r.TIPODOCUMENTO = h.TIPODOCUMENTO
LEFT JOIN YCHIDB3.dbo.tbDocumentos d WITH (UPDLOCK, HOLDLOCK)
  ON d.idTipoDocu = 1
 AND d.SeriDocu COLLATE SQL_Latin1_General_CP1_CI_AS = 'F01'
 AND d.NumeDocu COLLATE SQL_Latin1_General_CP1_CI_AS
   = RIGHT('0000000' + CONVERT(varchar(20), CONVERT(int, o.numero)), 7) COLLATE SQL_Latin1_General_CP1_CI_AS
WHERE o.estado IN ('ACTIVADO', 'ACEPTADA')
  AND ISNUMERIC(o.numero) = 1
  AND h.BL_ESTADOREGISTRO = 'L'
  AND r.process_state = '_3_COMPLETED'
  AND r.bl_mensajeSunat LIKE '%"codigo":"0"%';

SELECT 'ANTES_DE_CORREGIR' AS auditoria, *
FROM #Fix
ORDER BY serieNumeroFactura;

IF EXISTS (
  SELECT 1
  FROM #Fix
  WHERE idDocumento IS NULL
     OR ISNULL(guiaCompleta, '') = ''
     OR ISNULL(textoLeyenda, '') = ''
     OR ISNULL(condicion, '') = ''
     OR textoLeyenda LIKE '[0-9]%'
)
BEGIN
  SELECT 'BLOQUEANTE_DATOS_INCOMPLETOS' AS auditoria, *
  FROM #Fix
  WHERE idDocumento IS NULL
     OR ISNULL(guiaCompleta, '') = ''
     OR ISNULL(textoLeyenda, '') = ''
     OR ISNULL(condicion, '') = ''
     OR textoLeyenda LIKE '[0-9]%';

  THROW 52100, 'Hay facturas con datos incompletos o texto SON no convertido; no se aplicara la correccion.', 1;
END;

BEGIN TRANSACTION;

UPDATE d
SET d.nguia = f.guiaCompleta
FROM YCHIDB3.dbo.tbDocumentos d
INNER JOIN #Fix f ON f.idDocumento = d.idDocumento
WHERE ISNULL(d.nguia, '') COLLATE SQL_Latin1_General_CP1_CI_AS
   <> f.guiaCompleta COLLATE SQL_Latin1_General_CP1_CI_AS;

UPDATE h
SET h.textoLeyenda_1 = f.textoLeyenda,
    h.codigoAuxiliar100_1 = '9415',
    h.textoAuxiliar100_1 = f.condicion
FROM BIZLINKS_PROD21.dbo.SPE_EINVOICEHEADER h
INNER JOIN #Fix f
  ON f.serieNumeroFactura COLLATE SQL_Latin1_General_CP1_CI_AS
   = h.SERIENUMERO COLLATE SQL_Latin1_General_CP1_CI_AS
WHERE h.NUMERODOCUMENTOEMISOR COLLATE SQL_Latin1_General_CP1_CI_AS
    = @Emisor COLLATE SQL_Latin1_General_CP1_CI_AS
  AND h.TIPODOCUMENTO COLLATE SQL_Latin1_General_CP1_CI_AS = '01'
  AND (
    ISNULL(h.textoLeyenda_1, '') LIKE '[0-9]%'
    OR ISNULL(h.textoLeyenda_1, '') = ''
    OR ISNULL(h.textoAuxiliar100_1, '') COLLATE SQL_Latin1_General_CP1_CI_AS
      <> f.condicion COLLATE SQL_Latin1_General_CP1_CI_AS
  );

IF EXISTS (
  SELECT 1
  FROM #Fix f
  INNER JOIN YCHIDB3.dbo.tbDocumentos d ON d.idDocumento = f.idDocumento
  INNER JOIN BIZLINKS_PROD21.dbo.SPE_EINVOICEHEADER h
    ON h.SERIENUMERO COLLATE SQL_Latin1_General_CP1_CI_AS
     = f.serieNumeroFactura COLLATE SQL_Latin1_General_CP1_CI_AS
   AND h.NUMERODOCUMENTOEMISOR COLLATE SQL_Latin1_General_CP1_CI_AS
     = @Emisor COLLATE SQL_Latin1_General_CP1_CI_AS
   AND h.TIPODOCUMENTO COLLATE SQL_Latin1_General_CP1_CI_AS = '01'
  WHERE ISNULL(d.nguia, '') COLLATE SQL_Latin1_General_CP1_CI_AS
       <> f.guiaCompleta COLLATE SQL_Latin1_General_CP1_CI_AS
     OR ISNULL(h.textoLeyenda_1, '') LIKE '[0-9]%'
     OR ISNULL(h.textoLeyenda_1, '') = ''
     OR ISNULL(h.textoAuxiliar100_1, '') COLLATE SQL_Latin1_General_CP1_CI_AS
       <> f.condicion COLLATE SQL_Latin1_General_CP1_CI_AS
)
BEGIN
  SELECT 'BLOQUEANTE_POST_VALIDACION' AS auditoria, f.*,
    d.nguia AS guiaFinal,
    h.textoLeyenda_1 AS textoLeyendaFinal,
    h.textoAuxiliar100_1 AS condicionFinal
  FROM #Fix f
  INNER JOIN YCHIDB3.dbo.tbDocumentos d ON d.idDocumento = f.idDocumento
  INNER JOIN BIZLINKS_PROD21.dbo.SPE_EINVOICEHEADER h
    ON h.SERIENUMERO COLLATE SQL_Latin1_General_CP1_CI_AS
     = f.serieNumeroFactura COLLATE SQL_Latin1_General_CP1_CI_AS
   AND h.NUMERODOCUMENTOEMISOR COLLATE SQL_Latin1_General_CP1_CI_AS
     = @Emisor COLLATE SQL_Latin1_General_CP1_CI_AS
   AND h.TIPODOCUMENTO COLLATE SQL_Latin1_General_CP1_CI_AS = '01'
  WHERE ISNULL(d.nguia, '') COLLATE SQL_Latin1_General_CP1_CI_AS
       <> f.guiaCompleta COLLATE SQL_Latin1_General_CP1_CI_AS
     OR ISNULL(h.textoLeyenda_1, '') LIKE '[0-9]%'
     OR ISNULL(h.textoLeyenda_1, '') = ''
     OR ISNULL(h.textoAuxiliar100_1, '') COLLATE SQL_Latin1_General_CP1_CI_AS
       <> f.condicion COLLATE SQL_Latin1_General_CP1_CI_AS;

  THROW 52101, 'Post-validacion fallo; se revertira la correccion.', 1;
END;

COMMIT TRANSACTION;

SELECT 'IMPRESION_LEGACY_FF01_SANEADA' AS resultado,
  COUNT(*) AS facturasRevisadas
FROM #Fix;

SELECT f.serieNumeroFactura, d.idDocumento, d.nguia,
  h.textoLeyenda_1, h.codigoAuxiliar100_1,
  h.textoAuxiliar100_1
FROM #Fix f
INNER JOIN YCHIDB3.dbo.tbDocumentos d ON d.idDocumento = f.idDocumento
INNER JOIN BIZLINKS_PROD21.dbo.SPE_EINVOICEHEADER h
  ON h.SERIENUMERO COLLATE SQL_Latin1_General_CP1_CI_AS
   = f.serieNumeroFactura COLLATE SQL_Latin1_General_CP1_CI_AS
 AND h.NUMERODOCUMENTOEMISOR COLLATE SQL_Latin1_General_CP1_CI_AS
   = @Emisor COLLATE SQL_Latin1_General_CP1_CI_AS
 AND h.TIPODOCUMENTO COLLATE SQL_Latin1_General_CP1_CI_AS = '01'
ORDER BY f.serieNumeroFactura;
