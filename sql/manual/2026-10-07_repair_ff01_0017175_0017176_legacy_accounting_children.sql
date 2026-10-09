/*
  Completa piezas legacy faltantes para FF01-00017175 y FF01-00017176.

  Contexto auditado:
  - Ambas facturas ya existen y estan aceptadas en Bizlinks/SUNAT.
  - Ambas ya existen en YCHIDB3.dbo.tbDocumentos como F01-0017175/F01-0017176.
  - Faltan las filas hijas que usan contabilidad/cobranzas/reportes legacy:
    dbo.tbDetFact, dbo.TBCTACTE y dbo.tbDocumentos_Y.

  Seguridad:
  - No reenvia a Bizlinks ni SUNAT.
  - No modifica Bizlinks.
  - No inserta cabeceras en tbDocumentos.
  - Es idempotente: no duplica si las filas ya existen.
  - Ejecutar primero con @Aplicar = 0 para validar.
  - Cambiar @Aplicar = 1 solo cuando el resultado de auditoria sea correcto.
*/

SET NOCOUNT ON;
SET XACT_ABORT ON;

DECLARE @Aplicar bit = 0;
DECLARE @Emisor varchar(20) = '20259402965';

IF OBJECT_ID('tempdb..#Target') IS NOT NULL DROP TABLE #Target;
IF OBJECT_ID('tempdb..#Detail') IS NOT NULL DROP TABLE #Detail;

CREATE TABLE #Target (
  serieNumeroFactura varchar(13) NOT NULL PRIMARY KEY,
  legacyNumero varchar(7) NOT NULL,
  idDocumento int NOT NULL,
  moneda char(1) NOT NULL,
  tica decimal(18,4) NOT NULL,
  total decimal(18,2) NOT NULL
);

CREATE TABLE #Detail (
  serieNumeroFactura varchar(13) NOT NULL,
  idDocumento int NOT NULL,
  numeroOrdenItem int NOT NULL,
  descripcion varchar(500) NOT NULL,
  cantidad decimal(18,2) NOT NULL,
  precio decimal(18,2) NOT NULL,
  igvUnitario decimal(18,2) NOT NULL
);

INSERT INTO #Target (
  serieNumeroFactura,
  legacyNumero,
  idDocumento,
  moneda,
  tica,
  total
)
SELECT v.serieNumeroFactura, v.legacyNumero, d.idDocumento,
  d.Moneda, CONVERT(decimal(18,4), d.Tica), CONVERT(decimal(18,2), d.Total)
FROM (VALUES
  ('FF01-00017175', '0017175'),
  ('FF01-00017176', '0017176')
) AS v(serieNumeroFactura, legacyNumero)
INNER JOIN YCHIDB3.dbo.tbDocumentos d
  ON d.idTipoDocu = 1
 AND d.SeriDocu COLLATE SQL_Latin1_General_CP1_CI_AS = 'F01'
 AND d.NumeDocu COLLATE SQL_Latin1_General_CP1_CI_AS
   = v.legacyNumero COLLATE SQL_Latin1_General_CP1_CI_AS
WHERE d.Estado COLLATE SQL_Latin1_General_CP1_CI_AS = 'A';

IF (SELECT COUNT(*) FROM #Target) <> 2
  THROW 56000, 'No se encontraron exactamente las dos cabeceras activas F01-0017175/F01-0017176 en tbDocumentos.', 1;

IF EXISTS (
  SELECT 1
  FROM #Target t
  WHERE NOT EXISTS (
    SELECT 1
    FROM BIZLINKS_PROD21.dbo.SPE_EINVOICEHEADER h
    INNER JOIN BIZLINKS_PROD21.dbo.SPE_EINVOICE_RESPONSE r
      ON r.NUMERODOCUMENTOEMISOR = h.NUMERODOCUMENTOEMISOR
     AND r.SERIENUMERO = h.SERIENUMERO
     AND r.TIPODOCUMENTO = h.TIPODOCUMENTO
    WHERE h.NUMERODOCUMENTOEMISOR = @Emisor COLLATE Modern_Spanish_CI_AI
      AND h.SERIENUMERO = t.serieNumeroFactura COLLATE Modern_Spanish_CI_AI
      AND h.TIPODOCUMENTO = '01' COLLATE Modern_Spanish_CI_AI
      AND h.BL_ESTADOREGISTRO = 'L'
      AND r.process_state = '_3_COMPLETED'
      AND r.bl_mensajeSunat LIKE '%"codigo":"0"%'
  )
)
  THROW 56001, 'Una factura no esta aceptada en Bizlinks/SUNAT; no se repara legacy.', 1;

INSERT INTO #Detail (
  serieNumeroFactura,
  idDocumento,
  numeroOrdenItem,
  descripcion,
  cantidad,
  precio,
  igvUnitario
)
SELECT
  t.serieNumeroFactura,
  t.idDocumento,
  CONVERT(int, d.numeroOrdenItem) AS numeroOrdenItem,
  LEFT(CONVERT(varchar(500), d.descripcion), 500) AS descripcion,
  CONVERT(decimal(18,2), d.cantidad) AS cantidad,
  CONVERT(decimal(18,2), d.importeUnitarioSinImpuesto) AS precio,
  CONVERT(decimal(18,2), ROUND(
    CONVERT(decimal(18,6), d.importeIGV) / NULLIF(CONVERT(decimal(18,6), d.cantidad), 0),
    2
  )) AS igvUnitario
FROM #Target t
INNER JOIN BIZLINKS_PROD21.dbo.SPE_EINVOICEDETAIL d
  ON d.SERIENUMERO COLLATE Modern_Spanish_CI_AI
   = t.serieNumeroFactura COLLATE Modern_Spanish_CI_AI
 AND d.TIPODOCUMENTO = '01' COLLATE Modern_Spanish_CI_AI;

IF (SELECT COUNT(*) FROM #Detail) <> 2
  THROW 56002, 'No se encontraron exactamente dos detalles Bizlinks para las facturas objetivo.', 1;

IF EXISTS (
  SELECT 1
  FROM #Detail
  WHERE numeroOrdenItem IS NULL
    OR cantidad <= 0
    OR precio <= 0
    OR descripcion = ''
)
  THROW 56003, 'Un detalle no tiene numero, cantidad, precio o descripcion validos.', 1;

SELECT 'AUDITORIA_CABECERAS' AS seccion, *
FROM #Target
ORDER BY serieNumeroFactura;

SELECT 'AUDITORIA_DETALLES_A_INSERTAR' AS seccion,
  d.*,
  2198 AS idProductoUsado,
  10 AS idUnidadUsada,
  0 AS idDetOrdenVentaUsado,
  0 AS idRecepcionOtUsado
FROM #Detail d
ORDER BY d.serieNumeroFactura, d.numeroOrdenItem;

SELECT 'AUDITORIA_EXISTENTES' AS seccion,
  t.serieNumeroFactura,
  t.legacyNumero,
  t.idDocumento,
  (SELECT COUNT(1) FROM YCHIDB3.dbo.tbDetFact df WHERE df.idDocumento = t.idDocumento) AS tbDetFact,
  (SELECT COUNT(1) FROM YCHIDB3.dbo.TBCTACTE cc WHERE cc.idDocumento = t.idDocumento OR cc.idDocAfectado = t.idDocumento) AS TBCTACTE,
  (SELECT COUNT(1) FROM YCHIDB3.dbo.tbDocumentos_Y y WHERE y.idDocumento = t.idDocumento) AS tbDocumentos_Y
FROM #Target t
ORDER BY t.serieNumeroFactura;

IF @Aplicar <> 1
BEGIN
  SELECT 'MODO_SIMULACION_SIN_INSERTAR' AS resultado;
  RETURN;
END;

BEGIN TRANSACTION;

INSERT INTO YCHIDB3.dbo.tbDocumentos_Y (
  idDocumento,
  idTipoDocu,
  idEmpleado,
  idClieProv,
  idUsuario,
  SeriDocu,
  NumeDocu,
  DescClieProv,
  formaPago,
  Encargado,
  Moneda,
  Tica,
  Neto,
  Igv,
  Total,
  Observaciones,
  FechaEmision,
  FechaCreacion,
  FechaVencimiento,
  idENV,
  Estado,
  EstaCotiza,
  idDocumentoAnterior,
  idTCOP,
  EstadoRecotiz,
  CORREO,
  cuenta,
  origen,
  negociable,
  llevacomp
)
SELECT
  d.idDocumento,
  d.idTipoDocu,
  d.idEmpleado,
  d.idClieProv,
  d.idUsuario,
  d.SeriDocu,
  d.NumeDocu,
  d.DescClieProv,
  d.formaPago,
  d.Encargado,
  d.Moneda,
  d.Tica,
  d.Neto,
  d.Igv,
  d.Total,
  d.Observaciones,
  d.FechaEmision,
  d.FechaCreacion,
  d.FechaVencimiento,
  d.idENV,
  d.Estado,
  d.EstaCotiza,
  d.idDocumentoAnterior,
  d.idTCOP,
  d.EstadoRecotiz,
  d.CORREO,
  d.cuenta,
  d.origen,
  d.negociable,
  d.llevacomp
FROM #Target t
INNER JOIN YCHIDB3.dbo.tbDocumentos d WITH (UPDLOCK, HOLDLOCK)
  ON d.idDocumento = t.idDocumento
WHERE NOT EXISTS (
  SELECT 1
  FROM YCHIDB3.dbo.tbDocumentos_Y y WITH (UPDLOCK, HOLDLOCK)
  WHERE y.idDocumento = d.idDocumento
);

INSERT INTO YCHIDB3.dbo.TBCTACTE (
  idDocumento,
  idDocAfectado,
  Concepto,
  operacion,
  monto,
  moneda,
  tica
)
SELECT
  t.idDocumento,
  t.idDocumento,
  'FACTURA DE VENTA F01 - ' + t.legacyNumero,
  'I',
  t.total,
  t.moneda,
  t.tica
FROM #Target t
WHERE NOT EXISTS (
  SELECT 1
  FROM YCHIDB3.dbo.TBCTACTE cc WITH (UPDLOCK, HOLDLOCK)
  WHERE cc.idDocumento = t.idDocumento
    AND cc.idDocAfectado = t.idDocumento
);

INSERT INTO YCHIDB3.dbo.tbDetFact (
  idDocumento,
  idProducto,
  idDetOrdenVenta,
  idRecepcionOt,
  idUnidad,
  Descripcion,
  Cantidad,
  Precio,
  Igv,
  Neto,
  Total,
  numorden
)
SELECT
  d.idDocumento,
  2198,
  0,
  0,
  10,
  d.descripcion,
  d.cantidad,
  d.precio,
  d.igvUnitario,
  0,
  0,
  NULL
FROM #Detail d
WHERE NOT EXISTS (
  SELECT 1
  FROM YCHIDB3.dbo.tbDetFact df WITH (UPDLOCK, HOLDLOCK)
  WHERE df.idDocumento = d.idDocumento
    AND df.Descripcion COLLATE SQL_Latin1_General_CP1_CI_AS
      = d.descripcion COLLATE SQL_Latin1_General_CP1_CI_AS
);

IF EXISTS (
  SELECT 1
  FROM #Target t
  WHERE (SELECT COUNT(1) FROM YCHIDB3.dbo.tbDocumentos_Y y WHERE y.idDocumento = t.idDocumento) <> 1
     OR (SELECT COUNT(1) FROM YCHIDB3.dbo.TBCTACTE cc WHERE cc.idDocumento = t.idDocumento AND cc.idDocAfectado = t.idDocumento) <> 1
     OR (SELECT COUNT(1) FROM YCHIDB3.dbo.tbDetFact df WHERE df.idDocumento = t.idDocumento) < 1
)
BEGIN
  SELECT 'BLOQUEANTE_POST_VALIDACION' AS seccion,
    t.serieNumeroFactura,
    t.legacyNumero,
    t.idDocumento,
    (SELECT COUNT(1) FROM YCHIDB3.dbo.tbDetFact df WHERE df.idDocumento = t.idDocumento) AS tbDetFact,
    (SELECT COUNT(1) FROM YCHIDB3.dbo.TBCTACTE cc WHERE cc.idDocumento = t.idDocumento AND cc.idDocAfectado = t.idDocumento) AS TBCTACTE,
    (SELECT COUNT(1) FROM YCHIDB3.dbo.tbDocumentos_Y y WHERE y.idDocumento = t.idDocumento) AS tbDocumentos_Y
  FROM #Target t;

  THROW 56004, 'No quedaron completas las tres piezas legacy; se revertira.', 1;
END;

COMMIT TRANSACTION;

SELECT 'REPARACION_LEGACY_HIJOS_COMPLETADA' AS resultado;

SELECT 'POST_VALIDACION' AS seccion,
  t.serieNumeroFactura,
  t.legacyNumero,
  t.idDocumento,
  (SELECT COUNT(1) FROM YCHIDB3.dbo.tbDetFact df WHERE df.idDocumento = t.idDocumento) AS tbDetFact,
  (SELECT COUNT(1) FROM YCHIDB3.dbo.TBCTACTE cc WHERE cc.idDocumento = t.idDocumento AND cc.idDocAfectado = t.idDocumento) AS TBCTACTE,
  (SELECT COUNT(1) FROM YCHIDB3.dbo.tbDocumentos_Y y WHERE y.idDocumento = t.idDocumento) AS tbDocumentos_Y
FROM #Target t
ORDER BY t.serieNumeroFactura;
