/*
  Migracion idempotente para GRE_FORMULARIOS_TEST.
  Crea tablas propias de trazabilidad. No reemplaza EMPAQUE, EMPAQUE_DETALLE,
  SPE_DESPATCH ni SPE_DESPATCH_ITEM.
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

IF NOT EXISTS (SELECT 1 FROM dbo.GRE_FC_SCHEMA_MIGRATION WHERE version = '001_create_gre_fc_tables')
BEGIN
    IF OBJECT_ID(N'dbo.GRE_FC_OPERACION', N'U') IS NULL
    BEGIN
        CREATE TABLE dbo.GRE_FC_OPERACION
        (
            id bigint IDENTITY(1,1) NOT NULL CONSTRAINT PK_GRE_FC_OPERACION PRIMARY KEY,
            idOperacion uniqueidentifier NOT NULL,
            numeroOT varchar(30) NULL,
            idOrdenTrabajo int NULL,
            idOrdenVenta int NULL,
            tipoDocumentoDestinatario varchar(2) NOT NULL,
            numeroDocumentoDestinatario varchar(20) NOT NULL,
            razonSocialDestinatario nvarchar(250) NOT NULL,
            ubigeoPtoLlegada varchar(10) NULL,
            direccionPtoLlegada nvarchar(500) NULL,
            modalidadTraslado varchar(2) NOT NULL,
            motivoTraslado varchar(2) NOT NULL,
            pesoBrutoTotalBienes decimal(18, 3) NOT NULL,
            numeroBultos int NOT NULL,
            estado varchar(40) NOT NULL,
            usuario nvarchar(128) NULL,
            datosJson nvarchar(max) NOT NULL,
            creadoEn datetime2(3) NOT NULL CONSTRAINT DF_GRE_FC_OPERACION_creadoEn DEFAULT SYSUTCDATETIME(),
            actualizadoEn datetime2(3) NOT NULL CONSTRAINT DF_GRE_FC_OPERACION_actualizadoEn DEFAULT SYSUTCDATETIME(),
            finalizadoEn datetime2(3) NULL,
            CONSTRAINT UQ_GRE_FC_OPERACION_idOperacion UNIQUE (idOperacion),
            CONSTRAINT CK_GRE_FC_OPERACION_estado CHECK (estado IN ('PREPARANDO', 'INSERTADO_BIZLINKS', 'ERROR'))
        );
    END;

    IF OBJECT_ID(N'dbo.GRE_FC_DETALLE', N'U') IS NULL
    BEGIN
        CREATE TABLE dbo.GRE_FC_DETALLE
        (
            id bigint IDENTITY(1,1) NOT NULL CONSTRAINT PK_GRE_FC_DETALLE PRIMARY KEY,
            operacionId bigint NOT NULL,
            idDetGuiaOrigen int NULL,
            codigo varchar(80) NOT NULL,
            descripcion nvarchar(1000) NOT NULL,
            cantidad decimal(18, 6) NOT NULL,
            unidad varchar(20) NOT NULL,
            creadoEn datetime2(3) NOT NULL CONSTRAINT DF_GRE_FC_DETALLE_creadoEn DEFAULT SYSUTCDATETIME(),
            CONSTRAINT FK_GRE_FC_DETALLE_OPERACION FOREIGN KEY (operacionId)
                REFERENCES dbo.GRE_FC_OPERACION(id)
        );
    END;

    IF OBJECT_ID(N'dbo.GRE_FC_ENVIO', N'U') IS NULL
    BEGIN
        CREATE TABLE dbo.GRE_FC_ENVIO
        (
            id bigint IDENTITY(1,1) NOT NULL CONSTRAINT PK_GRE_FC_ENVIO PRIMARY KEY,
            operacionId bigint NOT NULL,
            serie varchar(4) NULL,
            numero varchar(8) NULL,
            serieNumeroGuia varchar(20) NULL,
            estado varchar(40) NOT NULL,
            intentos int NOT NULL CONSTRAINT DF_GRE_FC_ENVIO_intentos DEFAULT 0,
            mensaje nvarchar(max) NULL,
            respuestaJson nvarchar(max) NULL,
            creadoEn datetime2(3) NOT NULL CONSTRAINT DF_GRE_FC_ENVIO_creadoEn DEFAULT SYSUTCDATETIME(),
            actualizadoEn datetime2(3) NOT NULL CONSTRAINT DF_GRE_FC_ENVIO_actualizadoEn DEFAULT SYSUTCDATETIME(),
            insertadoBizlinksEn datetime2(3) NULL,
            CONSTRAINT FK_GRE_FC_ENVIO_OPERACION FOREIGN KEY (operacionId)
                REFERENCES dbo.GRE_FC_OPERACION(id),
            CONSTRAINT CK_GRE_FC_ENVIO_estado CHECK (estado IN ('PREPARANDO', 'INSERTADO_BIZLINKS', 'ERROR'))
        );
    END;

    IF OBJECT_ID(N'dbo.GRE_FC_EVENTO', N'U') IS NULL
    BEGIN
        CREATE TABLE dbo.GRE_FC_EVENTO
        (
            id bigint IDENTITY(1,1) NOT NULL CONSTRAINT PK_GRE_FC_EVENTO PRIMARY KEY,
            operacionId bigint NULL,
            envioId bigint NULL,
            tipo varchar(60) NOT NULL,
            mensaje nvarchar(max) NULL,
            datosJson nvarchar(max) NULL,
            creadoEn datetime2(3) NOT NULL CONSTRAINT DF_GRE_FC_EVENTO_creadoEn DEFAULT SYSUTCDATETIME(),
            CONSTRAINT FK_GRE_FC_EVENTO_OPERACION FOREIGN KEY (operacionId)
                REFERENCES dbo.GRE_FC_OPERACION(id),
            CONSTRAINT FK_GRE_FC_EVENTO_ENVIO FOREIGN KEY (envioId)
                REFERENCES dbo.GRE_FC_ENVIO(id)
        );
    END;

    IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'UQ_GRE_FC_ENVIO_serieNumeroGuia' AND object_id = OBJECT_ID(N'dbo.GRE_FC_ENVIO'))
    BEGIN
        CREATE UNIQUE INDEX UQ_GRE_FC_ENVIO_serieNumeroGuia
            ON dbo.GRE_FC_ENVIO(serieNumeroGuia)
            WHERE serieNumeroGuia IS NOT NULL;
    END;

    IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_GRE_FC_OPERACION_numeroOT' AND object_id = OBJECT_ID(N'dbo.GRE_FC_OPERACION'))
    BEGIN
        CREATE INDEX IX_GRE_FC_OPERACION_numeroOT
            ON dbo.GRE_FC_OPERACION(numeroOT);
    END;

    IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_GRE_FC_DETALLE_operacionId' AND object_id = OBJECT_ID(N'dbo.GRE_FC_DETALLE'))
    BEGIN
        CREATE INDEX IX_GRE_FC_DETALLE_operacionId
            ON dbo.GRE_FC_DETALLE(operacionId);
    END;

    IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_GRE_FC_ENVIO_operacionId' AND object_id = OBJECT_ID(N'dbo.GRE_FC_ENVIO'))
    BEGIN
        CREATE INDEX IX_GRE_FC_ENVIO_operacionId
            ON dbo.GRE_FC_ENVIO(operacionId);
    END;

    IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_GRE_FC_EVENTO_operacionId' AND object_id = OBJECT_ID(N'dbo.GRE_FC_EVENTO'))
    BEGIN
        CREATE INDEX IX_GRE_FC_EVENTO_operacionId
            ON dbo.GRE_FC_EVENTO(operacionId);
    END;

    INSERT INTO dbo.GRE_FC_SCHEMA_MIGRATION (version, descripcion)
    VALUES ('001_create_gre_fc_tables', N'Crea GRE_FC_OPERACION, GRE_FC_DETALLE, GRE_FC_ENVIO y GRE_FC_EVENTO');
END;
GO
