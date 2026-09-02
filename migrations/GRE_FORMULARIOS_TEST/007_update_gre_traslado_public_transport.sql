/*
  Permite motivos GRE adicionales y transporte publico en GRE Traslado T002.
  No modifica YCHIDB3, BIZLINKS_PROD21, EMPAQUE, EMPAQUE_DETALLE ni tablas SPE.
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

IF NOT EXISTS (SELECT 1 FROM dbo.GRE_FC_SCHEMA_MIGRATION WHERE version = '007_update_gre_traslado_public_transport')
BEGIN
    IF OBJECT_ID(N'dbo.GRE_TRASLADO_OPERACION', N'U') IS NOT NULL
    BEGIN
        IF OBJECT_ID(N'dbo.CK_GRE_TRASLADO_OPERACION_motivo', N'C') IS NOT NULL
        BEGIN
            ALTER TABLE dbo.GRE_TRASLADO_OPERACION DROP CONSTRAINT CK_GRE_TRASLADO_OPERACION_motivo;
        END;

        IF OBJECT_ID(N'dbo.CK_GRE_TRASLADO_OPERACION_modalidad', N'C') IS NOT NULL
        BEGIN
            ALTER TABLE dbo.GRE_TRASLADO_OPERACION DROP CONSTRAINT CK_GRE_TRASLADO_OPERACION_modalidad;
        END;

        IF COL_LENGTH(N'dbo.GRE_TRASLADO_OPERACION', N'tipoDocumentoTransportista') IS NULL
        BEGIN
            ALTER TABLE dbo.GRE_TRASLADO_OPERACION ADD tipoDocumentoTransportista varchar(2) NULL;
        END;

        IF COL_LENGTH(N'dbo.GRE_TRASLADO_OPERACION', N'numeroRucTransportista') IS NULL
        BEGIN
            ALTER TABLE dbo.GRE_TRASLADO_OPERACION ADD numeroRucTransportista varchar(11) NULL;
        END;

        IF COL_LENGTH(N'dbo.GRE_TRASLADO_OPERACION', N'razonSocialTransportista') IS NULL
        BEGIN
            ALTER TABLE dbo.GRE_TRASLADO_OPERACION ADD razonSocialTransportista nvarchar(100) NULL;
        END;

        IF OBJECT_ID(N'dbo.CK_GRE_TRASLADO_OPERACION_motivo_catalogo', N'C') IS NULL
        BEGIN
            ALTER TABLE dbo.GRE_TRASLADO_OPERACION WITH CHECK ADD CONSTRAINT CK_GRE_TRASLADO_OPERACION_motivo_catalogo
                CHECK (motivoTraslado IN ('01', '14', '02', '04', '18', '08', '09', '13', '03'));
        END;

        IF OBJECT_ID(N'dbo.CK_GRE_TRASLADO_OPERACION_modalidad_catalogo', N'C') IS NULL
        BEGIN
            ALTER TABLE dbo.GRE_TRASLADO_OPERACION WITH CHECK ADD CONSTRAINT CK_GRE_TRASLADO_OPERACION_modalidad_catalogo
                CHECK (modalidadTraslado IN ('01', '02'));
        END;
    END;

    INSERT INTO dbo.GRE_FC_SCHEMA_MIGRATION (version, descripcion)
    VALUES ('007_update_gre_traslado_public_transport', N'Habilita motivos y transporte publico en GRE_TRASLADO');
END;
GO
