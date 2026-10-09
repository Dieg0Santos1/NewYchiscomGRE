/*
  Habilita Especiales como permiso independiente del portal GRE.
  No modifica YCHIDB3, BIZLINKS_PROD21 ni tablas SPE.
*/

USE GRE_FORMULARIOS_TEST;
GO

IF OBJECT_ID(N'dbo.GRE_FC_SCHEMA_MIGRATION', N'U') IS NULL
BEGIN
    THROW 50001, 'No existe dbo.GRE_FC_SCHEMA_MIGRATION. Ejecute primero las migraciones anteriores.', 1;
END;
GO

IF NOT EXISTS (SELECT 1 FROM dbo.GRE_FC_SCHEMA_MIGRATION WHERE version = '014_enable_especiales_auth_module')
BEGIN
    SET XACT_ABORT ON;
    BEGIN TRANSACTION;

    IF OBJECT_ID(N'dbo.GRE_PORTAL_USUARIO_MODULO', N'U') IS NULL
    BEGIN
        THROW 50002, 'No existe dbo.GRE_PORTAL_USUARIO_MODULO. Ejecute primero el script de autenticacion del portal.', 1;
    END;

    IF OBJECT_ID(N'dbo.CK_GRE_PORTAL_USUARIO_MODULO_modulo', N'C') IS NOT NULL
    BEGIN
        ALTER TABLE dbo.GRE_PORTAL_USUARIO_MODULO DROP CONSTRAINT CK_GRE_PORTAL_USUARIO_MODULO_modulo;
    END;

    ALTER TABLE dbo.GRE_PORTAL_USUARIO_MODULO WITH CHECK ADD CONSTRAINT CK_GRE_PORTAL_USUARIO_MODULO_modulo
        CHECK (modulo IN ('fc', 'flexo', 'traslado', 'especiales'));

    INSERT INTO dbo.GRE_FC_SCHEMA_MIGRATION (version, descripcion)
    VALUES ('014_enable_especiales_auth_module', N'Habilita Especiales como permiso independiente del portal GRE');

    COMMIT TRANSACTION;
END;
GO

SELECT
    DB_NAME() AS baseDatos,
    name AS restriccion,
    definition AS definicion
FROM sys.check_constraints
WHERE parent_object_id = OBJECT_ID(N'dbo.GRE_PORTAL_USUARIO_MODULO')
  AND name = N'CK_GRE_PORTAL_USUARIO_MODULO_modulo';
GO
