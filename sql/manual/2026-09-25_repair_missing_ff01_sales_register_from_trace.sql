/*
  Repara facturas FF01 aceptadas desde el sistema nuevo que no existan en
  YCHIDB3.dbo.tbDocumentos para Registro de Ventas legacy.

  - Detecta facturas aceptadas desde @Desde.
  - No duplica: si F01-00xxxxx ya existe, la respeta.
  - Valida cliente, forma de pago, vendedor, guia interna, cuenta, moneda,
    tipo de cambio y texto en letras antes de insertar.
  - No modifica Bizlinks ni reenvia documentos.

  Requisito previo para que el sistema lo haga solo en adelante:
  sql/manual/2026-09-25_grant_ychidb3_tbdocumentos_insert_for_fc_legacy_sales_register.sql
*/

SET NOCOUNT ON;
SET XACT_ABORT ON;

DECLARE @Desde date = '2026-09-17';
DECLARE @Emisor varchar(20) = '20259402965';
DECLARE @Aplicar bit = 1;

IF OBJECT_ID('tempdb..#Repair') IS NOT NULL DROP TABLE #Repair;
IF OBJECT_ID('tempdb..#Inserted') IS NOT NULL DROP TABLE #Inserted;

CREATE TABLE #Repair (
  operacionId bigint NOT NULL,
  envioId bigint NULL,
  serieNumeroFactura varchar(13) NOT NULL,
  legacyNumero varchar(7) NOT NULL,
  ruc varchar(20) NOT NULL,
  razonSocial varchar(100) NOT NULL,
  idClieProv int NULL,
  idEmpleado int NULL,
  formaPago int NULL,
  formaPagoTexto nvarchar(200) NOT NULL,
  moneda char(1) NOT NULL,
  tica money NOT NULL,
  neto money NOT NULL,
  igv money NOT NULL,
  total money NOT NULL,
  observaciones varchar(750) NULL,
  fechaEmision datetime NOT NULL,
  fechaVencimiento datetime NOT NULL,
  idDocumentoAnterior int NULL,
  cuenta varchar(50) NOT NULL,
  ordenCompra varchar(50) NOT NULL,
  nguia varchar(750) NOT NULL,
  yaExiste bit NOT NULL
);

CREATE TABLE #Inserted (
  operacionId bigint NOT NULL,
  envioId bigint NULL,
  serieNumeroFactura varchar(13) NOT NULL,
  legacyNumero varchar(7) NOT NULL,
  idDocumento int NOT NULL
);

;WITH SourceRows AS (
  SELECT
    o.id AS operacionId,
    e.id AS envioId,
    o.serieNumeroFactura,
    RIGHT('0000000' + CONVERT(varchar(20), TRY_CONVERT(int, o.numero)), 7) AS legacyNumero,
    o.numeroDocumentoCliente AS ruc,
    LEFT(o.razonSocialCliente, 100) AS razonSocial,
    o.formaPago AS formaPagoTexto,
    CASE WHEN o.moneda = 'USD' THEN 'D' ELSE 'S' END AS moneda,
    CASE
      WHEN o.moneda = 'USD'
        THEN TRY_CONVERT(money, JSON_VALUE(o.datosJson, '$.tipoCambio'))
      ELSE CONVERT(money, 1)
    END AS tica,
    CONVERT(money, o.gravada) AS neto,
    CONVERT(money, o.igv) AS igv,
    CONVERT(money, o.total) AS total,
    LEFT(COALESCE(
      NULLIF(h.textoLeyenda_1 COLLATE SQL_Latin1_General_CP1_CI_AS, ''),
      NULLIF(JSON_VALUE(o.datosJson, '$.textoLeyenda_1') COLLATE SQL_Latin1_General_CP1_CI_AS, '')
    ), 750) AS observaciones,
    CONVERT(datetime, o.fechaEmision) AS fechaEmision,
    CONVERT(datetime, o.fechaVencimiento) AS fechaVencimiento,
    NULLIF(LEFT(COALESCE(o.ordenCompra, ''), 50), '') AS ordenCompra,
    o.cuenta,
    TRY_CONVERT(int, JSON_VALUE(o.datosJson, '$.vendedor.idEmpleado')) AS idEmpleadoJson
  FROM GRE_FORMULARIOS_TEST.dbo.FC_FACT_OPERACION o WITH (UPDLOCK, HOLDLOCK)
  INNER JOIN GRE_FORMULARIOS_TEST.dbo.FC_FACT_ENVIO e WITH (UPDLOCK, HOLDLOCK)
    ON e.operacionId = o.id
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
  WHERE o.serie = 'FF01'
    AND o.fechaEmision >= @Desde
    AND o.estado IN ('ACTIVADO', 'ACEPTADA')
    AND h.BL_ESTADOREGISTRO = 'L'
    AND r.process_state = '_3_COMPLETED'
    AND r.bl_mensajeSunat LIKE '%"codigo":"0"%'
),
Guides AS (
  SELECT
    o.id AS operacionId,
    MIN(go.idDocumentoYchiscom) AS idDocumentoAnterior,
    STUFF((
      SELECT ', ' + g2.serieNumeroGuia
      FROM GRE_FORMULARIOS_TEST.dbo.FC_FACT_GUIA g2
      WHERE g2.operacionId = o.id
      ORDER BY g2.serieNumeroGuia
      FOR XML PATH(''), TYPE
    ).value('.', 'varchar(max)'), 1, 2, '') AS nguia
  FROM GRE_FORMULARIOS_TEST.dbo.FC_FACT_OPERACION o
  INNER JOIN GRE_FORMULARIOS_TEST.dbo.FC_FACT_GUIA g
    ON g.operacionId = o.id
  LEFT JOIN GRE_FORMULARIOS_TEST.dbo.GRE_FC_ENVIO ge
    ON ge.serieNumeroGuia COLLATE SQL_Latin1_General_CP1_CI_AS
     = g.serieNumeroGuia COLLATE SQL_Latin1_General_CP1_CI_AS
  LEFT JOIN GRE_FORMULARIOS_TEST.dbo.GRE_FC_OPERACION go
    ON go.id = ge.operacionId
  WHERE o.fechaEmision >= @Desde
  GROUP BY o.id
)
INSERT INTO #Repair (
  operacionId, envioId, serieNumeroFactura, legacyNumero, ruc, razonSocial,
  idClieProv, idEmpleado, formaPago, formaPagoTexto, moneda, tica, neto, igv,
  total, observaciones, fechaEmision, fechaVencimiento, idDocumentoAnterior,
  cuenta, ordenCompra, nguia, yaExiste
)
SELECT
  s.operacionId,
  s.envioId,
  s.serieNumeroFactura,
  s.legacyNumero,
  s.ruc,
  s.razonSocial,
  c.idClieProv,
  COALESCE(s.idEmpleadoJson, c.idempleado, 1) AS idEmpleado,
  p.idPropiedades AS formaPago,
  s.formaPagoTexto,
  s.moneda,
  s.tica,
  s.neto,
  s.igv,
  s.total,
  s.observaciones,
  s.fechaEmision,
  s.fechaVencimiento,
  g.idDocumentoAnterior,
  s.cuenta,
  ISNULL(s.ordenCompra, '') AS ordenCompra,
  LEFT(ISNULL(g.nguia, ''), 750) AS nguia,
  CASE WHEN d.idDocumento IS NULL THEN 0 ELSE 1 END AS yaExiste
FROM SourceRows s
LEFT JOIN Guides g ON g.operacionId = s.operacionId
OUTER APPLY (
  SELECT TOP (1) c.idClieProv, c.idempleado
  FROM YCHIDB3.dbo.tbClieProv c WITH (UPDLOCK, HOLDLOCK)
  WHERE c.RUC COLLATE SQL_Latin1_General_CP1_CI_AS
      = s.ruc COLLATE SQL_Latin1_General_CP1_CI_AS
    AND c.tipoClieProv COLLATE SQL_Latin1_General_CP1_CI_AS = 'C'
    AND c.Estado COLLATE SQL_Latin1_General_CP1_CI_AS = 'A'
  ORDER BY CASE WHEN c.origen = 'Y' THEN 0 ELSE 1 END, c.idClieProv DESC
) c
OUTER APPLY (
  SELECT TOP (1) p.idPropiedades
  FROM YCHIDB3.dbo.tbPropiedades p WITH (UPDLOCK, HOLDLOCK)
  WHERE p.tipo COLLATE SQL_Latin1_General_CP1_CI_AS = 'FPAG'
    AND ISNULL(p.Valor, '') COLLATE SQL_Latin1_General_CP1_CI_AS NOT LIKE '(obsoleto)%'
    AND ISNULL(p.Nombre, '') COLLATE SQL_Latin1_General_CP1_CI_AS NOT LIKE '(obsoleto)%'
    AND (
      LTRIM(RTRIM(p.Nombre)) COLLATE SQL_Latin1_General_CP1_CI_AS
        = s.formaPagoTexto COLLATE SQL_Latin1_General_CP1_CI_AS
      OR LTRIM(RTRIM(p.Valor)) COLLATE SQL_Latin1_General_CP1_CI_AS
        = s.formaPagoTexto COLLATE SQL_Latin1_General_CP1_CI_AS
    )
  ORDER BY p.idPropiedades
) p
LEFT JOIN YCHIDB3.dbo.tbDocumentos d WITH (UPDLOCK, HOLDLOCK)
  ON d.idTipoDocu = 1
 AND d.SeriDocu COLLATE SQL_Latin1_General_CP1_CI_AS = 'F01'
 AND d.NumeDocu COLLATE SQL_Latin1_General_CP1_CI_AS
   = s.legacyNumero COLLATE SQL_Latin1_General_CP1_CI_AS;

SELECT 'FACTURAS_DETECTADAS' AS auditoria, *
FROM #Repair
ORDER BY serieNumeroFactura;

SELECT TOP (1)
  'FACTURA_REFERENCIA_LEGACY' AS auditoria,
  d.idDocumento, d.SeriDocu, d.NumeDocu, d.FechaEmision, d.FechaCreacion,
  d.Estado, d.DescClieProv, d.Moneda, d.Tica, d.Neto, d.Igv, d.Total,
  d.idEmpleado, d.formaPago, d.cuenta, d.nguia, d.idDocumentoAnterior,
  d.Observaciones, d.origen, d.EstaCotiza, d.EstadoRecotiz
FROM YCHIDB3.dbo.tbDocumentos d
WHERE d.idTipoDocu = 1
  AND d.SeriDocu COLLATE SQL_Latin1_General_CP1_CI_AS = 'F01'
  AND d.FechaEmision < @Desde
  AND d.Estado COLLATE SQL_Latin1_General_CP1_CI_AS = 'A'
ORDER BY d.FechaEmision DESC, d.idDocumento DESC;

IF EXISTS (
  SELECT 1
  FROM #Repair
  WHERE yaExiste = 0
    AND (
      idClieProv IS NULL
      OR idEmpleado IS NULL
      OR formaPago IS NULL
      OR idDocumentoAnterior IS NULL
      OR ISNULL(cuenta, '') = ''
      OR ISNULL(nguia, '') = ''
      OR ISNULL(observaciones, '') = ''
      OR observaciones LIKE '[0-9]%'
      OR (moneda = 'D' AND ISNULL(tica, 0) <= 0)
      OR total <= 0
    )
)
BEGIN
  SELECT 'BLOQUEANTE_DATOS_INCOMPLETOS' AS auditoria, *
  FROM #Repair
  WHERE yaExiste = 0
    AND (
      idClieProv IS NULL
      OR idEmpleado IS NULL
      OR formaPago IS NULL
      OR idDocumentoAnterior IS NULL
      OR ISNULL(cuenta, '') = ''
      OR ISNULL(nguia, '') = ''
      OR ISNULL(observaciones, '') = ''
      OR observaciones LIKE '[0-9]%'
      OR (moneda = 'D' AND ISNULL(tica, 0) <= 0)
      OR total <= 0
    )
  ORDER BY serieNumeroFactura;

  THROW 52000, 'Hay facturas faltantes con datos incompletos; no se insertara nada.', 1;
END;

IF @Aplicar <> 1
BEGIN
  SELECT 'MODO_SIMULACION_SIN_INSERTAR' AS resultado,
    COUNT(*) AS facturasFaltantes
  FROM #Repair
  WHERE yaExiste = 0;
  RETURN;
END;

BEGIN TRANSACTION;

INSERT INTO YCHIDB3.dbo.tbDocumentos (
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
  web,
  intermediario,
  llevacomp,
  nguia
)
SELECT
  1,
  src.idEmpleado,
  src.idClieProv,
  1,
  'F01',
  src.legacyNumero,
  src.razonSocial,
  src.formaPago,
  '',
  src.moneda,
  src.tica,
  src.neto,
  src.igv,
  src.total,
  src.observaciones,
  src.fechaEmision,
  GETDATE(),
  src.fechaVencimiento,
  0,
  'A',
  'P',
  src.idDocumentoAnterior,
  0,
  'N',
  src.ordenCompra,
  src.cuenta,
  'Y',
  'N',
  NULL,
  'N',
  CASE WHEN NULLIF(src.ordenCompra, '') IS NULL THEN 'N' ELSE 'S' END,
  src.nguia
FROM #Repair src
WHERE src.yaExiste = 0
  AND NOT EXISTS (
    SELECT 1
    FROM YCHIDB3.dbo.tbDocumentos d WITH (UPDLOCK, HOLDLOCK)
    WHERE d.idTipoDocu = 1
      AND d.SeriDocu COLLATE SQL_Latin1_General_CP1_CI_AS = 'F01'
      AND d.NumeDocu COLLATE SQL_Latin1_General_CP1_CI_AS
        = src.legacyNumero COLLATE SQL_Latin1_General_CP1_CI_AS
  );

INSERT INTO #Inserted (
  operacionId,
  envioId,
  serieNumeroFactura,
  legacyNumero,
  idDocumento
)
SELECT
  src.operacionId,
  src.envioId,
  src.serieNumeroFactura,
  src.legacyNumero,
  d.idDocumento
FROM #Repair src
INNER JOIN YCHIDB3.dbo.tbDocumentos d WITH (UPDLOCK, HOLDLOCK)
  ON d.idTipoDocu = 1
 AND d.SeriDocu COLLATE SQL_Latin1_General_CP1_CI_AS = 'F01'
 AND d.NumeDocu COLLATE SQL_Latin1_General_CP1_CI_AS
   = src.legacyNumero COLLATE SQL_Latin1_General_CP1_CI_AS
WHERE src.yaExiste = 0;

INSERT INTO GRE_FORMULARIOS_TEST.dbo.FC_FACT_EVENTO
  (operacionId, envioId, tipo, mensaje, datosJson)
SELECT i.operacionId, i.envioId, 'REGISTRO_VENTAS_LEGACY_REPARADO',
  'Factura FF01 insertada en YCHIDB3.tbDocumentos por reparacion controlada',
  CONCAT('{"serieNumeroFactura":"', i.serieNumeroFactura,
         '","legacy":"F01-', i.legacyNumero,
         '","idDocumento":', i.idDocumento, '}')
FROM #Inserted i;

IF EXISTS (
  SELECT 1
  FROM #Repair src
  WHERE NOT EXISTS (
    SELECT 1
    FROM YCHIDB3.dbo.tbDocumentos d
    WHERE d.idTipoDocu = 1
      AND d.SeriDocu COLLATE SQL_Latin1_General_CP1_CI_AS = 'F01'
      AND d.NumeDocu COLLATE SQL_Latin1_General_CP1_CI_AS
        = src.legacyNumero COLLATE SQL_Latin1_General_CP1_CI_AS
      AND d.Estado COLLATE SQL_Latin1_General_CP1_CI_AS = 'A'
      AND d.idEmpleado IS NOT NULL
      AND d.formaPago IS NOT NULL
      AND d.idDocumentoAnterior IS NOT NULL
      AND ISNULL(d.cuenta, '') <> ''
      AND ISNULL(d.nguia, '') <> ''
      AND ISNULL(d.Observaciones, '') <> ''
      AND d.Observaciones NOT LIKE '[0-9]%'
  )
)
BEGIN
  SELECT 'BLOQUEANTE_POST_VALIDACION' AS auditoria, src.*
  FROM #Repair src
  WHERE NOT EXISTS (
    SELECT 1
    FROM YCHIDB3.dbo.tbDocumentos d
    WHERE d.idTipoDocu = 1
      AND d.SeriDocu COLLATE SQL_Latin1_General_CP1_CI_AS = 'F01'
      AND d.NumeDocu COLLATE SQL_Latin1_General_CP1_CI_AS
        = src.legacyNumero COLLATE SQL_Latin1_General_CP1_CI_AS
      AND d.Estado COLLATE SQL_Latin1_General_CP1_CI_AS = 'A'
      AND d.idEmpleado IS NOT NULL
      AND d.formaPago IS NOT NULL
      AND d.idDocumentoAnterior IS NOT NULL
      AND ISNULL(d.cuenta, '') <> ''
      AND ISNULL(d.nguia, '') <> ''
      AND ISNULL(d.Observaciones, '') <> ''
      AND d.Observaciones NOT LIKE '[0-9]%'
  );

  THROW 52001, 'Post-validacion fallo; se revertira la reparacion.', 1;
END;

COMMIT TRANSACTION;

SELECT 'REGISTRO_VENTAS_REPARADO_DESDE_TRAZA' AS resultado,
  COUNT(*) AS facturasInsertadas
FROM #Inserted;

SELECT i.serieNumeroFactura, d.idDocumento, d.SeriDocu, d.NumeDocu,
  d.FechaEmision, d.FechaCreacion, d.Estado, d.DescClieProv, d.Moneda,
  d.Tica, d.Neto, d.Igv, d.Total, d.idEmpleado, d.formaPago, d.cuenta,
  d.nguia, d.idDocumentoAnterior, d.Observaciones
FROM #Inserted i
INNER JOIN YCHIDB3.dbo.tbDocumentos d
  ON d.idDocumento = i.idDocumento
ORDER BY i.serieNumeroFactura;

SELECT 'FACTURAS_YA_EXISTENTES_O_REPARADAS' AS auditoria,
  r.serieNumeroFactura, d.idDocumento, d.SeriDocu, d.NumeDocu,
  d.Estado, d.Total, d.idEmpleado, d.formaPago, d.cuenta, d.nguia,
  d.idDocumentoAnterior, d.Observaciones
FROM #Repair r
INNER JOIN YCHIDB3.dbo.tbDocumentos d
  ON d.idTipoDocu = 1
 AND d.SeriDocu COLLATE SQL_Latin1_General_CP1_CI_AS = 'F01'
 AND d.NumeDocu COLLATE SQL_Latin1_General_CP1_CI_AS
   = r.legacyNumero COLLATE SQL_Latin1_General_CP1_CI_AS
ORDER BY r.serieNumeroFactura;
