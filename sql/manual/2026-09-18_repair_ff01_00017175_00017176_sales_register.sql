/*
  Repara el Registro de Ventas legacy para FF01-00017175 y FF01-00017176.

  Ambas facturas ya fueron aceptadas por Bizlinks/SUNAT. Este script no
  reenvia documentos y no modifica Bizlinks; solo crea las filas faltantes
  en YCHIDB3.dbo.tbDocumentos para que el reporte antiguo pueda listarlas.
*/

SET NOCOUNT ON;
SET XACT_ABORT ON;

DECLARE @EmitterRuc varchar(20) = '20259402965';

DECLARE @Rows table (
  serieNumeroFactura varchar(13) NOT NULL,
  legacyNumero varchar(50) NOT NULL,
  ruc varchar(20) NOT NULL,
  razonSocial varchar(100) NOT NULL,
  idClieProv int NOT NULL,
  idEmpleado int NOT NULL,
  formaPago int NOT NULL,
  moneda char(1) NOT NULL,
  tica money NOT NULL,
  neto money NOT NULL,
  igv money NOT NULL,
  total money NOT NULL,
  observaciones varchar(750) NOT NULL,
  fechaEmision datetime NOT NULL,
  fechaVencimiento datetime NOT NULL,
  idDocumentoAnterior int NOT NULL,
  cuenta varchar(50) NOT NULL,
  nguia varchar(750) NOT NULL
);

INSERT INTO @Rows (
  serieNumeroFactura, legacyNumero, ruc, razonSocial, idClieProv,
  idEmpleado, formaPago, moneda, tica, neto, igv, total, observaciones,
  fechaEmision, fechaVencimiento, idDocumentoAnterior, cuenta, nguia
)
VALUES
  ('FF01-00017175', '0017175', '20307214386', 'INDUSTRIAS MANRIQUE S.A.C.',
   1763, 91, 92, 'D', 3.372, 145.00, 26.10, 171.10,
   'CIENTO SETENTA Y UNO CON 10/100 DOLARES AMERICANOS',
   '2026-09-17', '2026-10-17', 326147, '7022111', 'T001-00101'),
  ('FF01-00017176', '0017176', '20481252475',
   'ASOCIACION FONDO CONTRA ACCIDENTES DE TRANSITO DE LA PROVINCIA DE TRUJILLO',
   4539, 154, 5, 'S', 1.000, 2084.76, 375.26, 2460.02,
   'DOS MIL CUATROCIENTOS SESENTA CON 02/100 SOLES',
   '2026-09-17', '2026-09-17', 326150, '7022111', 'T001-00102');

BEGIN TRANSACTION;

IF EXISTS (
  SELECT 1
  FROM @Rows src
  WHERE NOT EXISTS (
    SELECT 1
    FROM BIZLINKS_PROD21.dbo.SPE_EINVOICEHEADER h WITH (UPDLOCK, HOLDLOCK)
    INNER JOIN BIZLINKS_PROD21.dbo.SPE_EINVOICE_RESPONSE r WITH (UPDLOCK, HOLDLOCK)
      ON r.NUMERODOCUMENTOEMISOR = h.NUMERODOCUMENTOEMISOR
     AND r.SERIENUMERO = h.SERIENUMERO
     AND r.TIPODOCUMENTO = h.TIPODOCUMENTO
    WHERE h.NUMERODOCUMENTOEMISOR = @EmitterRuc COLLATE Modern_Spanish_CI_AI
      AND h.SERIENUMERO = src.serieNumeroFactura COLLATE Modern_Spanish_CI_AI
      AND h.TIPODOCUMENTO = '01' COLLATE Modern_Spanish_CI_AI
      AND h.BL_ESTADOREGISTRO = 'L'
      AND r.process_state = '_3_COMPLETED'
      AND r.bl_mensajeSunat LIKE '%"codigo":"0"%'
  )
)
  THROW 51600, 'Una factura no esta aceptada en Bizlinks/SUNAT; no se reparara Registro de Ventas.', 1;

IF EXISTS (
  SELECT 1
  FROM @Rows src
  WHERE NOT EXISTS (
    SELECT 1
    FROM YCHIDB3.dbo.tbClieProv c WITH (UPDLOCK, HOLDLOCK)
    WHERE c.idClieProv = src.idClieProv
      AND c.RUC = src.ruc COLLATE SQL_Latin1_General_CP1_CI_AS
      AND c.tipoClieProv = 'C' COLLATE SQL_Latin1_General_CP1_CI_AS
      AND c.Estado = 'A' COLLATE SQL_Latin1_General_CP1_CI_AS
  )
)
  THROW 51601, 'Un cliente legacy no coincide con lo auditado.', 1;

IF EXISTS (
  SELECT 1
  FROM @Rows src
  WHERE NOT EXISTS (
    SELECT 1
    FROM YCHIDB3.dbo.tbPropiedades p WITH (UPDLOCK, HOLDLOCK)
    WHERE p.idPropiedades = src.formaPago
      AND p.tipo = 'FPAG' COLLATE SQL_Latin1_General_CP1_CI_AS
  )
)
  THROW 51602, 'Una forma de pago legacy no coincide con lo auditado.', 1;

IF EXISTS (
  SELECT 1
  FROM @Rows src
  WHERE NOT EXISTS (
    SELECT 1
    FROM YCHIDB3.dbo.tbDocumentos g WITH (UPDLOCK, HOLDLOCK)
    WHERE g.idDocumento = src.idDocumentoAnterior
      AND g.idTipoDocu = 8
  )
)
  THROW 51603, 'Una guia interna legacy no existe como documento base.', 1;

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
  '',
  src.cuenta,
  'Y',
  'N',
  NULL,
  'N',
  'N',
  src.nguia
FROM @Rows src
WHERE NOT EXISTS (
  SELECT 1
  FROM YCHIDB3.dbo.tbDocumentos d WITH (UPDLOCK, HOLDLOCK)
  WHERE d.idTipoDocu = 1
    AND d.SeriDocu = 'F01' COLLATE SQL_Latin1_General_CP1_CI_AS
    AND d.NumeDocu = src.legacyNumero COLLATE SQL_Latin1_General_CP1_CI_AS
);

IF EXISTS (
  SELECT 1
  FROM @Rows src
  WHERE NOT EXISTS (
    SELECT 1
    FROM YCHIDB3.dbo.tbDocumentos d
    WHERE d.idTipoDocu = 1
      AND d.SeriDocu = 'F01' COLLATE SQL_Latin1_General_CP1_CI_AS
      AND d.NumeDocu = src.legacyNumero COLLATE SQL_Latin1_General_CP1_CI_AS
      AND d.Estado = 'A' COLLATE SQL_Latin1_General_CP1_CI_AS
  )
)
  THROW 51604, 'No quedaron todas las facturas en tbDocumentos; se revertira.', 1;

COMMIT TRANSACTION;

SELECT 'REGISTRO_VENTAS_REPARADO' AS resultado,
  COUNT(*) AS facturasLegacy
FROM YCHIDB3.dbo.tbDocumentos
WHERE idTipoDocu = 1
  AND SeriDocu = 'F01' COLLATE SQL_Latin1_General_CP1_CI_AS
  AND NumeDocu IN ('0017175' COLLATE SQL_Latin1_General_CP1_CI_AS, '0017176' COLLATE SQL_Latin1_General_CP1_CI_AS);

SELECT idDocumento, idTipoDocu, SeriDocu, NumeDocu, FechaEmision, Estado,
  DescClieProv, Moneda, Tica, Neto, Igv, Total, idEmpleado, formaPago,
  nguia, cuenta, idDocumentoAnterior
FROM YCHIDB3.dbo.tbDocumentos
WHERE idTipoDocu = 1
  AND SeriDocu = 'F01' COLLATE SQL_Latin1_General_CP1_CI_AS
  AND NumeDocu IN ('0017175' COLLATE SQL_Latin1_General_CP1_CI_AS, '0017176' COLLATE SQL_Latin1_General_CP1_CI_AS)
ORDER BY NumeDocu;
