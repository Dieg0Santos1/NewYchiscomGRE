/*
  Crea catalogo propio de choferes para alta manual desde Traslado T002.
  No modifica YCHIDB3, BIZLINKS_PROD21, AAA_CHOFER ni tablas SPE.
*/

USE GRE_FORMULARIOS_TEST;
GO

IF OBJECT_ID(N'dbo.GRE_FC_SCHEMA_MIGRATION', N'U') IS NULL
BEGIN
    THROW 50001, 'No existe dbo.GRE_FC_SCHEMA_MIGRATION. Ejecute primero las migraciones base.', 1;
END;
GO

IF NOT EXISTS (SELECT 1 FROM dbo.GRE_FC_SCHEMA_MIGRATION WHERE version = '012_create_gre_manual_drivers')
BEGIN
    SET XACT_ABORT ON;
    BEGIN TRANSACTION;

    IF OBJECT_ID(N'dbo.GRE_CHOFER_MANUAL', N'U') IS NULL
    BEGIN
        CREATE TABLE dbo.GRE_CHOFER_MANUAL
        (
            id bigint IDENTITY(1,1) NOT NULL CONSTRAINT PK_GRE_CHOFER_MANUAL PRIMARY KEY,
            tipoDocumento varchar(2) NOT NULL CONSTRAINT DF_GRE_CHOFER_MANUAL_tipoDocumento DEFAULT ('1'),
            numeroDocumento varchar(11) NOT NULL,
            nombres nvarchar(80) NOT NULL,
            apellidos nvarchar(80) NOT NULL,
            licencia varchar(20) NOT NULL,
            placa varchar(8) NOT NULL,
            activo bit NOT NULL CONSTRAINT DF_GRE_CHOFER_MANUAL_activo DEFAULT (1),
            creadoPor nvarchar(128) NULL,
            creadoEn datetime2(3) NOT NULL CONSTRAINT DF_GRE_CHOFER_MANUAL_creadoEn DEFAULT SYSUTCDATETIME(),
            CONSTRAINT UQ_GRE_CHOFER_MANUAL_documento_licencia_placa UNIQUE (tipoDocumento, numeroDocumento, licencia, placa),
            CONSTRAINT CK_GRE_CHOFER_MANUAL_tipoDocumento CHECK (tipoDocumento = '1'),
            CONSTRAINT CK_GRE_CHOFER_MANUAL_numeroDocumento CHECK (numeroDocumento NOT LIKE '%[^0-9]%' AND LEN(numeroDocumento) BETWEEN 8 AND 11),
            CONSTRAINT CK_GRE_CHOFER_MANUAL_placa CHECK (LEN(LTRIM(RTRIM(placa))) BETWEEN 5 AND 8)
        );
    END;

    INSERT INTO dbo.GRE_FC_SCHEMA_MIGRATION (version, descripcion)
    VALUES ('012_create_gre_manual_drivers', N'Crea catalogo manual de choferes para Traslado T002');

    COMMIT TRANSACTION;
END;
GO

IF USER_ID(N'gre_app_test') IS NULL
BEGIN
    THROW 50002, 'No existe el usuario gre_app_test en esta base.', 1;
END;
GO

GRANT SELECT, INSERT ON OBJECT::dbo.GRE_CHOFER_MANUAL TO [gre_app_test];
DENY UPDATE, DELETE ON OBJECT::dbo.GRE_CHOFER_MANUAL TO [gre_app_test];
GO

SELECT
    DB_NAME() AS baseDatos,
    OBJECT_ID(N'dbo.GRE_CHOFER_MANUAL', N'U') AS choferManualObjectId;

EXECUTE AS USER = N'gre_app_test';
SELECT
    HAS_PERMS_BY_NAME(N'dbo.GRE_CHOFER_MANUAL', N'OBJECT', N'SELECT') AS puedeLeer,
    HAS_PERMS_BY_NAME(N'dbo.GRE_CHOFER_MANUAL', N'OBJECT', N'INSERT') AS puedeInsertar,
    HAS_PERMS_BY_NAME(N'dbo.GRE_CHOFER_MANUAL', N'OBJECT', N'UPDATE') AS puedeActualizar,
    HAS_PERMS_BY_NAME(N'dbo.GRE_CHOFER_MANUAL', N'OBJECT', N'DELETE') AS puedeEliminar;
REVERT;
GO
