/*
  Fase 1 - prevalidacion completamente read-only.
  No crea objetos, no concede permisos y no modifica datos.

  Resultado esperado antes de instalar:
    dependenciasEncontradas = 14
    wrappersExistentes      = 0
    puedeInstalar           = 1
*/
USE [YCHIDB3];
GO

DECLARE @dependencias TABLE (nombre sysname NOT NULL, tipo char(2) NOT NULL);
INSERT @dependencias (nombre, tipo)
VALUES
  (N'dbo.tbRecepcionOT', N'U'),
  (N'dbo.tbOrdenTrabajo', N'U'),
  (N'dbo.tbDetOrdenVenta', N'U'),
  (N'dbo.tbOrdenVenta', N'U'),
  (N'dbo.tbDetSoliProf', N'U'),
  (N'dbo.tbDocumentos', N'U'),
  (N'dbo.tbDetGuias', N'U'),
  (N'dbo.tbUnidades', N'U'),
  (N'dbo.SPU_RECEPCION_OT_ESTADO', N'P'),
  (N'dbo.SPU_CERRAR_OTGUI', N'P'),
  (N'dbo.SPI_GUIA_REMISION44_YP', N'P'),
  (N'dbo.SPI_DETGUIA_REMISION', N'P'),
  (N'dbo.SPI_GUIA_REMISION_Y_003', N'P'),
  (N'dbo.SPI_DETGUIA_REMISION_Y_003', N'P');

SELECT
  d.nombre,
  d.tipo AS tipoEsperado,
  o.type AS tipoEncontrado,
  CASE WHEN o.object_id IS NULL THEN 0 ELSE 1 END AS existe
FROM @dependencias d
LEFT JOIN sys.objects o ON o.object_id = OBJECT_ID(d.nombre)
  AND o.type COLLATE DATABASE_DEFAULT = d.tipo COLLATE DATABASE_DEFAULT
ORDER BY d.nombre;

DECLARE @dependenciasEncontradas int = (
  SELECT COUNT(*) FROM @dependencias d
  WHERE EXISTS (
    SELECT 1 FROM sys.objects o
    WHERE o.object_id = OBJECT_ID(d.nombre)
      AND o.type COLLATE DATABASE_DEFAULT = d.tipo COLLATE DATABASE_DEFAULT
  )
);

DECLARE @wrappersExistentes int = (
  SELECT COUNT(*)
  FROM sys.procedures
  WHERE schema_id = SCHEMA_ID(N'dbo')
    AND name IN (
      N'GRE_WEB_CREAR_PREGUIA_FC',
      N'GRE_WEB_ACEPTAR_PREGUIA_FC',
      N'GRE_WEB_CREAR_GUIA_INTERNA_FC'
    )
);

SELECT
  @dependenciasEncontradas AS dependenciasEncontradas,
  (SELECT COUNT(*) FROM @dependencias) AS dependenciasEsperadas,
  @wrappersExistentes AS wrappersExistentes,
  CASE
    WHEN @dependenciasEncontradas = (SELECT COUNT(*) FROM @dependencias)
      AND @wrappersExistentes = 0
    THEN 1 ELSE 0
  END AS puedeInstalar;
GO
