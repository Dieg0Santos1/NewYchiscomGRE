/*
  GRE FC / Guia 2 - destinos manuales para cliente/proveedor.

  Objetivo:
  - Crear una tabla propia del portal en GRE_FORMULARIOS_TEST para direcciones
    de destino registradas desde Guia 2 y GRE FC.
  - La app consulta primero esta tabla y luego las fuentes existentes:
      * YCHIDB3.dbo.tbClieProv / dbo.tbcliedireccion
      * BIZLINKS_PROD21.dbo.SPE_DESPATCH como historial
  - No escribe ni modifica YCHIDB3, Bizlinks ni tablas historicas existentes.
  - Script idempotente y no destructivo.

  Auditoria previa:
  - GRE_FC_SQL_DATABASE apunta a GRE_FORMULARIOS_TEST.
  - gre_app_test no tiene INSERT/UPDATE en YCHIDB3.dbo.tbcliedireccion.
*/

USE [GRE_FORMULARIOS_TEST];
GO

SET XACT_ABORT ON;
BEGIN TRAN;

IF OBJECT_ID(N'dbo.GRE_FC_DESTINO_MANUAL', N'U') IS NULL
BEGIN
  CREATE TABLE dbo.GRE_FC_DESTINO_MANUAL
  (
    id bigint IDENTITY(1,1) NOT NULL CONSTRAINT PK_GRE_FC_DESTINO_MANUAL PRIMARY KEY,
    numeroDocumentoDestinatario varchar(20) NOT NULL,
    ubigeo varchar(6) NOT NULL,
    direccion nvarchar(250) NOT NULL,
    esPrincipal bit NOT NULL CONSTRAINT DF_GRE_FC_DESTINO_MANUAL_esPrincipal DEFAULT 0,
    activo bit NOT NULL CONSTRAINT DF_GRE_FC_DESTINO_MANUAL_activo DEFAULT 1,
    creadoPor nvarchar(100) NOT NULL CONSTRAINT DF_GRE_FC_DESTINO_MANUAL_creadoPor DEFAULT N'system',
    creadoEn datetime2(3) NOT NULL CONSTRAINT DF_GRE_FC_DESTINO_MANUAL_creadoEn DEFAULT SYSUTCDATETIME(),
    actualizadoPor nvarchar(100) NOT NULL CONSTRAINT DF_GRE_FC_DESTINO_MANUAL_actualizadoPor DEFAULT N'system',
    actualizadoEn datetime2(3) NOT NULL CONSTRAINT DF_GRE_FC_DESTINO_MANUAL_actualizadoEn DEFAULT SYSUTCDATETIME(),
    CONSTRAINT CK_GRE_FC_DESTINO_MANUAL_ubigeo CHECK (ubigeo LIKE '[0-9][0-9][0-9][0-9][0-9][0-9]'),
    CONSTRAINT CK_GRE_FC_DESTINO_MANUAL_documento CHECK (LEN(LTRIM(RTRIM(numeroDocumentoDestinatario))) > 0),
    CONSTRAINT CK_GRE_FC_DESTINO_MANUAL_direccion CHECK (LEN(LTRIM(RTRIM(direccion))) > 0)
  );
END;

IF NOT EXISTS (
  SELECT 1
  FROM sys.indexes
  WHERE name = 'UX_GRE_FC_DESTINO_MANUAL_activo'
    AND object_id = OBJECT_ID(N'dbo.GRE_FC_DESTINO_MANUAL')
)
BEGIN
  CREATE UNIQUE INDEX UX_GRE_FC_DESTINO_MANUAL_activo
    ON dbo.GRE_FC_DESTINO_MANUAL(numeroDocumentoDestinatario, ubigeo, direccion)
    WHERE activo = 1;
END;

IF NOT EXISTS (
  SELECT 1
  FROM sys.indexes
  WHERE name = 'IX_GRE_FC_DESTINO_MANUAL_lookup'
    AND object_id = OBJECT_ID(N'dbo.GRE_FC_DESTINO_MANUAL')
)
BEGIN
  CREATE INDEX IX_GRE_FC_DESTINO_MANUAL_lookup
    ON dbo.GRE_FC_DESTINO_MANUAL(numeroDocumentoDestinatario, activo, esPrincipal, creadoEn DESC)
    INCLUDE (ubigeo, direccion);
END;

IF USER_ID(N'gre_app_test') IS NOT NULL
BEGIN
  GRANT SELECT, INSERT, UPDATE ON OBJECT::dbo.GRE_FC_DESTINO_MANUAL TO gre_app_test;
END;

COMMIT;

SELECT
  'GRE_FC_DESTINO_MANUAL lista' AS resultado,
  OBJECT_SCHEMA_NAME(OBJECT_ID(N'dbo.GRE_FC_DESTINO_MANUAL')) AS esquema,
  OBJECT_NAME(OBJECT_ID(N'dbo.GRE_FC_DESTINO_MANUAL')) AS tabla;
