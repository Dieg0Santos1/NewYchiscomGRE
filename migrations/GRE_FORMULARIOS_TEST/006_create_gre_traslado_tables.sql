/*
  Crea trazabilidad propia para GRE Traslado T002.
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

IF NOT EXISTS (SELECT 1 FROM dbo.GRE_FC_SCHEMA_MIGRATION WHERE version = '006_create_gre_traslado_tables')
BEGIN
    IF OBJECT_ID(N'dbo.GRE_TRASLADO_OPERACION', N'U') IS NULL
    BEGIN
        CREATE TABLE dbo.GRE_TRASLADO_OPERACION
        (
            id bigint IDENTITY(1,1) NOT NULL CONSTRAINT PK_GRE_TRASLADO_OPERACION PRIMARY KEY,
            idOperacion uniqueidentifier NOT NULL,
            referenciaInterna nvarchar(80) NULL,
            tipoDocumentoDestinatario varchar(2) NOT NULL,
            numeroDocumentoDestinatario varchar(20) NOT NULL,
            razonSocialDestinatario nvarchar(250) NOT NULL,
            ubigeoPtoLlegada varchar(10) NOT NULL,
            direccionPtoLlegada nvarchar(500) NOT NULL,
            modalidadTraslado varchar(2) NOT NULL,
            motivoTraslado varchar(2) NOT NULL,
            pesoBrutoTotalBienes decimal(18, 3) NOT NULL,
            numeroBultos int NOT NULL,
            tipoDocumentoTransportista varchar(2) NULL,
            numeroRucTransportista varchar(11) NULL,
            razonSocialTransportista nvarchar(100) NULL,
            estado varchar(40) NOT NULL,
            usuario nvarchar(128) NULL,
            datosJson nvarchar(max) NOT NULL,
            creadoEn datetime2(3) NOT NULL CONSTRAINT DF_GRE_TRASLADO_OPERACION_creadoEn DEFAULT SYSUTCDATETIME(),
            actualizadoEn datetime2(3) NOT NULL CONSTRAINT DF_GRE_TRASLADO_OPERACION_actualizadoEn DEFAULT SYSUTCDATETIME(),
            finalizadoEn datetime2(3) NULL,
            CONSTRAINT UQ_GRE_TRASLADO_OPERACION_idOperacion UNIQUE (idOperacion),
            CONSTRAINT CK_GRE_TRASLADO_OPERACION_estado CHECK (estado IN ('PREPARANDO', 'INSERTADO_BIZLINKS', 'ACTIVADO', 'ERROR')),
            CONSTRAINT CK_GRE_TRASLADO_OPERACION_motivo CHECK (motivoTraslado IN ('01', '14', '02', '04', '18', '08', '09', '13', '03')),
            CONSTRAINT CK_GRE_TRASLADO_OPERACION_modalidad CHECK (modalidadTraslado IN ('01', '02'))
        );
    END;

    IF OBJECT_ID(N'dbo.GRE_TRASLADO_DETALLE', N'U') IS NULL
    BEGIN
        CREATE TABLE dbo.GRE_TRASLADO_DETALLE
        (
            id bigint IDENTITY(1,1) NOT NULL CONSTRAINT PK_GRE_TRASLADO_DETALLE PRIMARY KEY,
            operacionId bigint NOT NULL,
            codigo varchar(16) NOT NULL,
            descripcion nvarchar(500) NOT NULL,
            cantidad decimal(18, 6) NOT NULL,
            unidad varchar(3) NOT NULL,
            creadoEn datetime2(3) NOT NULL CONSTRAINT DF_GRE_TRASLADO_DETALLE_creadoEn DEFAULT SYSUTCDATETIME(),
            CONSTRAINT FK_GRE_TRASLADO_DETALLE_OPERACION FOREIGN KEY (operacionId)
                REFERENCES dbo.GRE_TRASLADO_OPERACION(id)
        );
    END;

    IF OBJECT_ID(N'dbo.GRE_TRASLADO_ENVIO', N'U') IS NULL
    BEGIN
        CREATE TABLE dbo.GRE_TRASLADO_ENVIO
        (
            id bigint IDENTITY(1,1) NOT NULL CONSTRAINT PK_GRE_TRASLADO_ENVIO PRIMARY KEY,
            operacionId bigint NOT NULL,
            serie varchar(4) NULL,
            numero varchar(8) NULL,
            serieNumeroGuia varchar(20) NULL,
            estado varchar(40) NOT NULL,
            intentos int NOT NULL CONSTRAINT DF_GRE_TRASLADO_ENVIO_intentos DEFAULT 0,
            mensaje nvarchar(max) NULL,
            respuestaJson nvarchar(max) NULL,
            creadoEn datetime2(3) NOT NULL CONSTRAINT DF_GRE_TRASLADO_ENVIO_creadoEn DEFAULT SYSUTCDATETIME(),
            actualizadoEn datetime2(3) NOT NULL CONSTRAINT DF_GRE_TRASLADO_ENVIO_actualizadoEn DEFAULT SYSUTCDATETIME(),
            insertadoBizlinksEn datetime2(3) NULL,
            CONSTRAINT FK_GRE_TRASLADO_ENVIO_OPERACION FOREIGN KEY (operacionId)
                REFERENCES dbo.GRE_TRASLADO_OPERACION(id),
            CONSTRAINT CK_GRE_TRASLADO_ENVIO_estado CHECK (estado IN ('PREPARANDO', 'INSERTADO_BIZLINKS', 'ACTIVADO', 'ERROR'))
        );
    END;

    IF OBJECT_ID(N'dbo.GRE_TRASLADO_EVENTO', N'U') IS NULL
    BEGIN
        CREATE TABLE dbo.GRE_TRASLADO_EVENTO
        (
            id bigint IDENTITY(1,1) NOT NULL CONSTRAINT PK_GRE_TRASLADO_EVENTO PRIMARY KEY,
            operacionId bigint NULL,
            envioId bigint NULL,
            tipo varchar(60) NOT NULL,
            mensaje nvarchar(max) NULL,
            datosJson nvarchar(max) NULL,
            creadoEn datetime2(3) NOT NULL CONSTRAINT DF_GRE_TRASLADO_EVENTO_creadoEn DEFAULT SYSUTCDATETIME(),
            CONSTRAINT FK_GRE_TRASLADO_EVENTO_OPERACION FOREIGN KEY (operacionId)
                REFERENCES dbo.GRE_TRASLADO_OPERACION(id),
            CONSTRAINT FK_GRE_TRASLADO_EVENTO_ENVIO FOREIGN KEY (envioId)
                REFERENCES dbo.GRE_TRASLADO_ENVIO(id)
        );
    END;

    IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'UQ_GRE_TRASLADO_ENVIO_serieNumeroGuia' AND object_id = OBJECT_ID(N'dbo.GRE_TRASLADO_ENVIO'))
    BEGIN
        CREATE UNIQUE INDEX UQ_GRE_TRASLADO_ENVIO_serieNumeroGuia
            ON dbo.GRE_TRASLADO_ENVIO(serieNumeroGuia)
            WHERE serieNumeroGuia IS NOT NULL;
    END;

    IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_GRE_TRASLADO_DETALLE_operacionId' AND object_id = OBJECT_ID(N'dbo.GRE_TRASLADO_DETALLE'))
    BEGIN
        CREATE INDEX IX_GRE_TRASLADO_DETALLE_operacionId
            ON dbo.GRE_TRASLADO_DETALLE(operacionId);
    END;

    IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_GRE_TRASLADO_ENVIO_operacionId' AND object_id = OBJECT_ID(N'dbo.GRE_TRASLADO_ENVIO'))
    BEGIN
        CREATE INDEX IX_GRE_TRASLADO_ENVIO_operacionId
            ON dbo.GRE_TRASLADO_ENVIO(operacionId);
    END;

    INSERT INTO dbo.GRE_FC_SCHEMA_MIGRATION (version, descripcion)
    VALUES ('006_create_gre_traslado_tables', N'Crea trazabilidad GRE_TRASLADO para guias T002');
END;
GO
