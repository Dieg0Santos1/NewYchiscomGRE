/*
  Permite facturar guias FC de prueba T999 en el modulo de facturacion FC.
  No modifica registros existentes ni toca tablas Flexo/Ychiscom.
*/

USE GRE_FORMULARIOS_TEST;
GO

IF OBJECT_ID(N'dbo.GRE_FC_SCHEMA_MIGRATION', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.GRE_FC_SCHEMA_MIGRATION
    (
        id int IDENTITY(1,1) NOT NULL CONSTRAINT PK_GRE_FC_SCHEMA_MIGRATION PRIMARY KEY,
        version varchar(50) NOT NULL CONSTRAINT UQ_GRE_FC_SCHEMA_MIGRATION_version UNIQUE,
        descripcion nvarchar(250) NOT NULL,
        aplicadoEn datetime2(3) NOT NULL CONSTRAINT DF_GRE_FC_SCHEMA_MIGRATION_aplicadoEn DEFAULT SYSUTCDATETIME()
    );
END;
GO

IF NOT EXISTS (SELECT 1 FROM dbo.GRE_FC_SCHEMA_MIGRATION WHERE version = '005_allow_t999_fc_facturacion_guides')
BEGIN
    IF OBJECT_ID(N'dbo.CK_FC_FACT_GUIA_serie', N'C') IS NOT NULL
    BEGIN
        ALTER TABLE dbo.FC_FACT_GUIA
            DROP CONSTRAINT CK_FC_FACT_GUIA_serie;
    END;

    ALTER TABLE dbo.FC_FACT_GUIA
        ADD CONSTRAINT CK_FC_FACT_GUIA_serie
        CHECK (serieNumeroGuia LIKE 'T001-%' OR serieNumeroGuia LIKE 'T999-%');

    INSERT INTO dbo.GRE_FC_SCHEMA_MIGRATION (version, descripcion)
    VALUES ('005_allow_t999_fc_facturacion_guides', N'Permite guias T999 en trazabilidad de facturacion FC');
END;
GO
