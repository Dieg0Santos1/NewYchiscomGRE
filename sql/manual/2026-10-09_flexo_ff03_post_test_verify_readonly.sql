/*
  Verificacion post-prueba para Factura Flexo FF03.

  Solo lectura sobre tablas de negocio. No envia a Bizlinks/SUNAT.
  No inserta, actualiza ni elimina registros permanentes.

  Uso:
  1. Cambiar @SerieNumeroFactura por la factura probada.
  2. Ejecutar completo.
  3. Revisar que:
     - Bizlinks tenga cabecera, detalles y respuesta.
     - AAA_GUIAFACTURADA tenga las guias enlazadas.
     - EMPAQUE_DETALLE tenga items vinculados a la factura.
     - YCHIDB3 tenga F03 en tbDocumentos, tbDetFact, TBCTACTE y tbDocumentos_Y.
*/

SET NOCOUNT ON;

DECLARE @SerieNumeroFactura varchar(13) = 'FF03-00000000';
DECLARE @Emisor varchar(20) = '20259402965';
DECLARE @Numero8 varchar(8) = RIGHT(@SerieNumeroFactura, 8);
DECLARE @Numero7 varchar(7) = RIGHT(@SerieNumeroFactura, 7);
DECLARE @Numero6 varchar(6) = RIGHT(@SerieNumeroFactura, 6);

IF OBJECT_ID('tempdb..#LegacyFactura') IS NOT NULL DROP TABLE #LegacyFactura;

SELECT TOP (20)
  d.idDocumento,
  d.idTipoDocu,
  d.SeriDocu,
  d.NumeDocu,
  d.FechaEmision,
  d.FechaVencimiento,
  d.idClieProv,
  c.RUC,
  d.DescClieProv,
  d.Moneda,
  d.Tica,
  d.Neto,
  d.Igv,
  d.Total,
  d.nguia,
  d.correo,
  d.Estado
INTO #LegacyFactura
FROM YCHIDB3.dbo.tbDocumentos d
LEFT JOIN YCHIDB3.dbo.tbClieProv c
  ON c.idClieProv = d.idClieProv
WHERE d.idTipoDocu = 38
  AND d.SeriDocu IN ('F03', 'FF03')
  AND (
    d.correo COLLATE SQL_Latin1_General_CP1_CI_AS = @SerieNumeroFactura COLLATE SQL_Latin1_General_CP1_CI_AS
    OR d.NumeDocu COLLATE SQL_Latin1_General_CP1_CI_AS IN (
      @Numero8 COLLATE SQL_Latin1_General_CP1_CI_AS,
      @Numero7 COLLATE SQL_Latin1_General_CP1_CI_AS,
      @Numero6 COLLATE SQL_Latin1_General_CP1_CI_AS
    )
    OR d.NumeDocu COLLATE SQL_Latin1_General_CP1_CI_AS LIKE '%' + @Numero6 COLLATE SQL_Latin1_General_CP1_CI_AS
  )
ORDER BY
  CASE WHEN d.correo COLLATE SQL_Latin1_General_CP1_CI_AS = @SerieNumeroFactura COLLATE SQL_Latin1_General_CP1_CI_AS THEN 0 ELSE 1 END,
  d.idDocumento DESC;

SELECT
  'RESUMEN' AS seccion,
  @SerieNumeroFactura AS serieNumeroFactura,
  (SELECT COUNT(1)
   FROM BIZLINKS_PROD21.dbo.SPE_EINVOICEHEADER h
   WHERE h.NUMERODOCUMENTOEMISOR = @Emisor COLLATE Modern_Spanish_CI_AI
     AND h.SERIENUMERO = @SerieNumeroFactura COLLATE Modern_Spanish_CI_AI
     AND h.TIPODOCUMENTO = '01' COLLATE Modern_Spanish_CI_AI) AS bizlinksCabecera,
  (SELECT COUNT(1)
   FROM BIZLINKS_PROD21.dbo.SPE_EINVOICEDETAIL d
   WHERE d.SERIENUMERO = @SerieNumeroFactura COLLATE Modern_Spanish_CI_AI
     AND d.TIPODOCUMENTO = '01' COLLATE Modern_Spanish_CI_AI) AS bizlinksDetalles,
  (SELECT COUNT(1)
   FROM BIZLINKS_PROD21.dbo.SPE_EINVOICE_RESPONSE r
   WHERE r.NUMERODOCUMENTOEMISOR = @Emisor COLLATE Modern_Spanish_CI_AI
     AND r.SERIENUMERO = @SerieNumeroFactura COLLATE Modern_Spanish_CI_AI
     AND r.TIPODOCUMENTO = '01' COLLATE Modern_Spanish_CI_AI) AS bizlinksRespuesta,
  (SELECT COUNT(1)
   FROM BIZLINKS_PROD21.dbo.AAA_GUIAFACTURADA gf
   WHERE gf.NRO_FACTURA = @SerieNumeroFactura COLLATE Modern_Spanish_CI_AI) AS guiasFacturadas,
  (SELECT COUNT(1)
   FROM BIZLINKS_PROD21.dbo.EMPAQUE_DETALLE ed
   WHERE ed.SERIENUMEROGUIAFACTURA = @SerieNumeroFactura COLLATE Modern_Spanish_CI_AI) AS itemsEmpaqueVinculados,
  (SELECT COUNT(1) FROM #LegacyFactura) AS ychidb3CabecerasF03,
  (SELECT COUNT(1)
   FROM YCHIDB3.dbo.tbDetFact df
   INNER JOIN #LegacyFactura lf ON lf.idDocumento = df.idDocumento) AS ychidb3DetallesF03,
  (SELECT COUNT(1)
   FROM YCHIDB3.dbo.TBCTACTE cc
   INNER JOIN #LegacyFactura lf
     ON lf.idDocumento = cc.idDocumento
     OR lf.idDocumento = cc.idDocAfectado) AS ychidb3CuentaCorriente,
  (SELECT COUNT(1)
   FROM YCHIDB3.dbo.tbDocumentos_Y y
   INNER JOIN #LegacyFactura lf ON lf.idDocumento = y.idDocumento) AS ychidb3DocumentoY;

SELECT 'BIZLINKS_CABECERA' AS seccion,
  h.NUMERODOCUMENTOEMISOR,
  h.SERIENUMERO,
  h.TIPODOCUMENTO,
  h.FECHAEMISION,
  h.NUMERODOCUMENTOADQUIRIENTE,
  h.RAZONSOCIALADQUIRIENTE,
  h.TIPOMONEDA,
  h.TOTALVALORVENTANETOOPGRAVADAS,
  h.TOTALIGV,
  h.TOTALVENTA,
  h.BL_ESTADOREGISTRO
FROM BIZLINKS_PROD21.dbo.SPE_EINVOICEHEADER h
WHERE h.NUMERODOCUMENTOEMISOR = @Emisor COLLATE Modern_Spanish_CI_AI
  AND h.SERIENUMERO = @SerieNumeroFactura COLLATE Modern_Spanish_CI_AI
  AND h.TIPODOCUMENTO = '01' COLLATE Modern_Spanish_CI_AI;

SELECT 'BIZLINKS_RESPUESTA' AS seccion,
  r.SERIENUMERO,
  r.TIPODOCUMENTO,
  r.process_state,
  r.bl_estadoProceso,
  r.bl_mensajeSunat,
  r.FECHACREACION
FROM BIZLINKS_PROD21.dbo.SPE_EINVOICE_RESPONSE r
WHERE r.NUMERODOCUMENTOEMISOR = @Emisor COLLATE Modern_Spanish_CI_AI
  AND r.SERIENUMERO = @SerieNumeroFactura COLLATE Modern_Spanish_CI_AI
  AND r.TIPODOCUMENTO = '01' COLLATE Modern_Spanish_CI_AI
ORDER BY r.FECHACREACION DESC;

SELECT 'BIZLINKS_DETALLE' AS seccion,
  d.SERIENUMERO,
  d.numeroOrdenItem,
  d.codigoProducto,
  d.descripcion,
  d.cantidad,
  d.importeUnitarioSinImpuesto,
  d.importeIGV,
  d.importeTotalSinImpuesto
FROM BIZLINKS_PROD21.dbo.SPE_EINVOICEDETAIL d
WHERE d.SERIENUMERO = @SerieNumeroFactura COLLATE Modern_Spanish_CI_AI
  AND d.TIPODOCUMENTO = '01' COLLATE Modern_Spanish_CI_AI
ORDER BY
  CASE WHEN ISNUMERIC(d.numeroOrdenItem) = 1 THEN CONVERT(int, d.numeroOrdenItem) ELSE 9999 END,
  d.numeroOrdenItem;

SELECT 'GUIAS_FACTURADAS' AS seccion,
  gf.NRO_FACTURA,
  gf.NRO_GUIA,
  gf.NOTACRE
FROM BIZLINKS_PROD21.dbo.AAA_GUIAFACTURADA gf
WHERE gf.NRO_FACTURA = @SerieNumeroFactura COLLATE Modern_Spanish_CI_AI
ORDER BY gf.NRO_GUIA;

SELECT 'EMPAQUE_DETALLE_VINCULADO' AS seccion,
  ed.CODIGOEMPAQUE,
  ed.CODIGOPRODUCTO,
  ed.SERIENUMEROGUIAREMISION,
  ed.SERIENUMEROGUIAFACTURA,
  ed.DESCRIPCION,
  ed.CANTIDAD,
  ed.IMPORTEUNITARIO
FROM BIZLINKS_PROD21.dbo.EMPAQUE_DETALLE ed
WHERE ed.SERIENUMEROGUIAFACTURA = @SerieNumeroFactura COLLATE Modern_Spanish_CI_AI
ORDER BY ed.SERIENUMEROGUIAREMISION, ed.CODIGOEMPAQUE, ed.CODIGOPRODUCTO;

SELECT 'YCHIDB3_CABECERA_F03' AS seccion, *
FROM #LegacyFactura
ORDER BY idDocumento DESC;

SELECT 'YCHIDB3_DETALLE_F03' AS seccion,
  df.idDocumento,
  df.idProducto,
  df.Descripcion,
  df.Cantidad,
  df.Precio,
  df.Igv,
  df.Neto,
  df.Total,
  df.numorden
FROM YCHIDB3.dbo.tbDetFact df
INNER JOIN #LegacyFactura lf
  ON lf.idDocumento = df.idDocumento
ORDER BY df.idDocumento, df.numorden, df.Descripcion;

SELECT 'YCHIDB3_CUENTA_CORRIENTE' AS seccion,
  cc.*
FROM YCHIDB3.dbo.TBCTACTE cc
INNER JOIN #LegacyFactura lf
  ON lf.idDocumento = cc.idDocumento
  OR lf.idDocumento = cc.idDocAfectado
ORDER BY cc.idDocumento, cc.idDocAfectado;

SELECT 'YCHIDB3_DOCUMENTOS_Y' AS seccion,
  y.idDocumento,
  y.idTipoDocu,
  y.SeriDocu,
  y.NumeDocu,
  y.DescClieProv,
  y.Moneda,
  y.Tica,
  y.Neto,
  y.Igv,
  y.Total,
  y.FechaEmision,
  y.FechaVencimiento,
  y.Estado,
  y.correo
FROM YCHIDB3.dbo.tbDocumentos_Y y
INNER JOIN #LegacyFactura lf
  ON lf.idDocumento = y.idDocumento
ORDER BY y.idDocumento DESC;
