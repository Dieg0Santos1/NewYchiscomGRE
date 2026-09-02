/*
  Migracion idempotente para trazabilidad propia de facturacion electronica FC.
  No modifica GRE, EMPAQUE, EMPAQUE_DETALLE, flexografia ni sistema antiguo.
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

IF NOT EXISTS (SELECT 1 FROM dbo.GRE_FC_SCHEMA_MIGRATION WHERE version = '004_create_fc_facturacion_tables')
BEGIN
    IF OBJECT_ID(N'dbo.FC_FACT_OPERACION', N'U') IS NULL
    BEGIN
        CREATE TABLE dbo.FC_FACT_OPERACION
        (
            id bigint IDENTITY(1,1) NOT NULL CONSTRAINT PK_FC_FACT_OPERACION PRIMARY KEY,
            idOperacion uniqueidentifier NOT NULL,
            serie varchar(4) NOT NULL,
            numero varchar(8) NOT NULL,
            serieNumeroFactura varchar(13) NOT NULL,
            tipoDocumento varchar(2) NOT NULL CONSTRAINT DF_FC_FACT_OPERACION_tipoDocumento DEFAULT '01',
            tipoDocumentoCliente varchar(2) NOT NULL,
            numeroDocumentoCliente varchar(20) NOT NULL,
            razonSocialCliente nvarchar(250) NOT NULL,
            fechaEmision datetime2(3) NOT NULL,
            fechaVencimiento datetime2(3) NOT NULL,
            moneda varchar(3) NOT NULL,
            formaPago nvarchar(200) NOT NULL,
            cuenta varchar(50) NOT NULL,
            ordenCompra nvarchar(2000) NULL,
            observaciones nvarchar(max) NULL,
            gravada decimal(18, 2) NOT NULL,
            igv decimal(18, 2) NOT NULL,
            total decimal(18, 2) NOT NULL,
            estado varchar(40) NOT NULL,
            usuario nvarchar(128) NULL,
            datosJson nvarchar(max) NOT NULL,
            creadoEn datetime2(3) NOT NULL CONSTRAINT DF_FC_FACT_OPERACION_creadoEn DEFAULT SYSUTCDATETIME(),
            actualizadoEn datetime2(3) NOT NULL CONSTRAINT DF_FC_FACT_OPERACION_actualizadoEn DEFAULT SYSUTCDATETIME(),
            finalizadoEn datetime2(3) NULL,
            CONSTRAINT UQ_FC_FACT_OPERACION_idOperacion UNIQUE (idOperacion),
            CONSTRAINT UQ_FC_FACT_OPERACION_serieNumeroFactura UNIQUE (serieNumeroFactura),
            CONSTRAINT CK_FC_FACT_OPERACION_estado CHECK (estado IN ('PREPARANDO', 'INSERTADO_BIZLINKS', 'ACTIVADO', 'ACEPTADA', 'RECHAZADA', 'ERROR')),
            CONSTRAINT CK_FC_FACT_OPERACION_serie CHECK (serie = 'FF01'),
            CONSTRAINT CK_FC_FACT_OPERACION_tipoDocumento CHECK (tipoDocumento = '01')
        );
    END;

    IF OBJECT_ID(N'dbo.FC_FACT_GUIA', N'U') IS NULL
    BEGIN
        CREATE TABLE dbo.FC_FACT_GUIA
        (
            id bigint IDENTITY(1,1) NOT NULL CONSTRAINT PK_FC_FACT_GUIA PRIMARY KEY,
            operacionId bigint NOT NULL,
            serieNumeroGuia varchar(20) NOT NULL,
            operationIdGuia uniqueidentifier NULL,
            fechaGuia datetime2(3) NULL,
            totalGuia decimal(18, 2) NULL,
            creadoEn datetime2(3) NOT NULL CONSTRAINT DF_FC_FACT_GUIA_creadoEn DEFAULT SYSUTCDATETIME(),
            CONSTRAINT FK_FC_FACT_GUIA_OPERACION FOREIGN KEY (operacionId)
                REFERENCES dbo.FC_FACT_OPERACION(id),
            CONSTRAINT UQ_FC_FACT_GUIA_serieNumeroGuia UNIQUE (serieNumeroGuia),
            CONSTRAINT CK_FC_FACT_GUIA_serie CHECK (serieNumeroGuia LIKE 'T001-%' OR serieNumeroGuia LIKE 'T999-%')
        );
    END;

    IF OBJECT_ID(N'dbo.FC_FACT_DETALLE', N'U') IS NULL
    BEGIN
        CREATE TABLE dbo.FC_FACT_DETALLE
        (
            id bigint IDENTITY(1,1) NOT NULL CONSTRAINT PK_FC_FACT_DETALLE PRIMARY KEY,
            operacionId bigint NOT NULL,
            guiaId bigint NULL,
            numeroOrdenItem int NOT NULL,
            codigoProducto varchar(80) NOT NULL,
            descripcion nvarchar(1700) NOT NULL,
            cantidad decimal(18, 6) NOT NULL,
            unidadMedida varchar(20) NOT NULL,
            precioUnitario decimal(18, 6) NOT NULL,
            afectoIgv bit NOT NULL,
            valorVenta decimal(18, 2) NOT NULL,
            igv decimal(18, 2) NOT NULL,
            total decimal(18, 2) NOT NULL,
            datosJson nvarchar(max) NULL,
            creadoEn datetime2(3) NOT NULL CONSTRAINT DF_FC_FACT_DETALLE_creadoEn DEFAULT SYSUTCDATETIME(),
            CONSTRAINT FK_FC_FACT_DETALLE_OPERACION FOREIGN KEY (operacionId)
                REFERENCES dbo.FC_FACT_OPERACION(id),
            CONSTRAINT FK_FC_FACT_DETALLE_GUIA FOREIGN KEY (guiaId)
                REFERENCES dbo.FC_FACT_GUIA(id)
        );
    END;

    IF OBJECT_ID(N'dbo.FC_FACT_ENVIO', N'U') IS NULL
    BEGIN
        CREATE TABLE dbo.FC_FACT_ENVIO
        (
            id bigint IDENTITY(1,1) NOT NULL CONSTRAINT PK_FC_FACT_ENVIO PRIMARY KEY,
            operacionId bigint NOT NULL,
            estado varchar(40) NOT NULL,
            intentos int NOT NULL CONSTRAINT DF_FC_FACT_ENVIO_intentos DEFAULT 0,
            mensaje nvarchar(max) NULL,
            respuestaJson nvarchar(max) NULL,
            pdfUrl varchar(4000) NULL,
            creadoEn datetime2(3) NOT NULL CONSTRAINT DF_FC_FACT_ENVIO_creadoEn DEFAULT SYSUTCDATETIME(),
            actualizadoEn datetime2(3) NOT NULL CONSTRAINT DF_FC_FACT_ENVIO_actualizadoEn DEFAULT SYSUTCDATETIME(),
            insertadoBizlinksEn datetime2(3) NULL,
            enviadoBizlinksEn datetime2(3) NULL,
            respuestaBizlinksEn datetime2(3) NULL,
            CONSTRAINT FK_FC_FACT_ENVIO_OPERACION FOREIGN KEY (operacionId)
                REFERENCES dbo.FC_FACT_OPERACION(id),
            CONSTRAINT CK_FC_FACT_ENVIO_estado CHECK (estado IN ('PREPARANDO', 'INSERTADO_BIZLINKS', 'ACTIVADO', 'ACEPTADA', 'RECHAZADA', 'ERROR'))
        );
    END;

    IF OBJECT_ID(N'dbo.FC_FACT_EVENTO', N'U') IS NULL
    BEGIN
        CREATE TABLE dbo.FC_FACT_EVENTO
        (
            id bigint IDENTITY(1,1) NOT NULL CONSTRAINT PK_FC_FACT_EVENTO PRIMARY KEY,
            operacionId bigint NULL,
            envioId bigint NULL,
            tipo varchar(60) NOT NULL,
            mensaje nvarchar(max) NULL,
            datosJson nvarchar(max) NULL,
            creadoEn datetime2(3) NOT NULL CONSTRAINT DF_FC_FACT_EVENTO_creadoEn DEFAULT SYSUTCDATETIME(),
            CONSTRAINT FK_FC_FACT_EVENTO_OPERACION FOREIGN KEY (operacionId)
                REFERENCES dbo.FC_FACT_OPERACION(id),
            CONSTRAINT FK_FC_FACT_EVENTO_ENVIO FOREIGN KEY (envioId)
                REFERENCES dbo.FC_FACT_ENVIO(id)
        );
    END;

    IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_FC_FACT_OPERACION_cliente' AND object_id = OBJECT_ID(N'dbo.FC_FACT_OPERACION'))
    BEGIN
        CREATE INDEX IX_FC_FACT_OPERACION_cliente
            ON dbo.FC_FACT_OPERACION(numeroDocumentoCliente, creadoEn DESC);
    END;

    IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_FC_FACT_OPERACION_estado' AND object_id = OBJECT_ID(N'dbo.FC_FACT_OPERACION'))
    BEGIN
        CREATE INDEX IX_FC_FACT_OPERACION_estado
            ON dbo.FC_FACT_OPERACION(estado, creadoEn DESC);
    END;

    IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_FC_FACT_GUIA_operacionId' AND object_id = OBJECT_ID(N'dbo.FC_FACT_GUIA'))
    BEGIN
        CREATE INDEX IX_FC_FACT_GUIA_operacionId
            ON dbo.FC_FACT_GUIA(operacionId);
    END;

    IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_FC_FACT_DETALLE_operacionId' AND object_id = OBJECT_ID(N'dbo.FC_FACT_DETALLE'))
    BEGIN
        CREATE INDEX IX_FC_FACT_DETALLE_operacionId
            ON dbo.FC_FACT_DETALLE(operacionId, numeroOrdenItem);
    END;

    IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_FC_FACT_ENVIO_operacionId' AND object_id = OBJECT_ID(N'dbo.FC_FACT_ENVIO'))
    BEGIN
        CREATE INDEX IX_FC_FACT_ENVIO_operacionId
            ON dbo.FC_FACT_ENVIO(operacionId);
    END;

    IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_FC_FACT_EVENTO_operacionId' AND object_id = OBJECT_ID(N'dbo.FC_FACT_EVENTO'))
    BEGIN
        CREATE INDEX IX_FC_FACT_EVENTO_operacionId
            ON dbo.FC_FACT_EVENTO(operacionId);
    END;

    INSERT INTO dbo.GRE_FC_SCHEMA_MIGRATION (version, descripcion)
    VALUES ('004_create_fc_facturacion_tables', N'Crea trazabilidad propia FC_FACT_* para facturacion electronica FC');
END;
GO
