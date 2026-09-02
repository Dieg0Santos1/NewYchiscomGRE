/*
  Migracion futura para preparar integracion con Ychiscom.
  No integra aun Ychiscom, no toca YCHIDB3, BIZLINKS_PROD21, EMPAQUE,
  EMPAQUE_DETALLE ni tablas SPE.
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

IF NOT EXISTS (SELECT 1 FROM dbo.GRE_FC_SCHEMA_MIGRATION WHERE version = '003_add_ychiscom_future_fields')
BEGIN
    IF COL_LENGTH('dbo.GRE_FC_OPERACION', 'origenOperacion') IS NULL
    BEGIN
        ALTER TABLE dbo.GRE_FC_OPERACION
            ADD origenOperacion varchar(30) NULL;
    END;

    IF COL_LENGTH('dbo.GRE_FC_OPERACION', 'idGuiaFisicaYchiscom') IS NULL
    BEGIN
        ALTER TABLE dbo.GRE_FC_OPERACION
            ADD idGuiaFisicaYchiscom int NULL;
    END;

    IF COL_LENGTH('dbo.GRE_FC_OPERACION', 'numeroGuiaFisica') IS NULL
    BEGIN
        ALTER TABLE dbo.GRE_FC_OPERACION
            ADD numeroGuiaFisica varchar(30) NULL;
    END;

    IF COL_LENGTH('dbo.GRE_FC_OPERACION', 'idDocumentoYchiscom') IS NULL
    BEGIN
        ALTER TABLE dbo.GRE_FC_OPERACION
            ADD idDocumentoYchiscom int NULL;
    END;

    IF OBJECT_ID(N'dbo.CK_GRE_FC_OPERACION_origenOperacion', N'C') IS NULL
    BEGIN
        EXEC(N'
            ALTER TABLE dbo.GRE_FC_OPERACION
                ADD CONSTRAINT CK_GRE_FC_OPERACION_origenOperacion
                CHECK (
                    origenOperacion IS NULL
                    OR origenOperacion IN (''FRONT_MANUAL'', ''YCHISCOM_AUTOMATICO'')
                );
        ');
    END;

    INSERT INTO dbo.GRE_FC_SCHEMA_MIGRATION (version, descripcion)
    VALUES ('003_add_ychiscom_future_fields', N'Agrega campos opcionales para futura integracion Ychiscom');
END;
GO


