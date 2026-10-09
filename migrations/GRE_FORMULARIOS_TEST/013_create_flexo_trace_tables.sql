/*
  Migracion idempotente para trazabilidad productiva Flexo.

  Base objetivo: GRE_FORMULARIOS_TEST

  No modifica BIZLINKS_PROD21, YCHIDB3, EMPAQUE, EMPAQUE_DETALLE, tablas SPE
  ni catalogos AAA_*.

  Estas tablas registran la intencion, el estado, los items y la auditoria del
  portal para GRE T003/T999, FE FF03 y bajas/NCE. La declaracion real seguira
  bloqueada hasta implementar wrappers/SP transaccionales con idempotencia.
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

IF NOT EXISTS (SELECT 1 FROM dbo.GRE_FC_SCHEMA_MIGRATION WHERE version = '013_create_flexo_trace_tables')
BEGIN
    IF OBJECT_ID(N'dbo.FLEXO_GRE_OPERACION', N'U') IS NULL
    BEGIN
        CREATE TABLE dbo.FLEXO_GRE_OPERACION
        (
            id bigint IDENTITY(1,1) NOT NULL CONSTRAINT PK_FLEXO_GRE_OPERACION PRIMARY KEY,
            idOperacion uniqueidentifier NOT NULL,
            serie varchar(4) NOT NULL,
            numero varchar(8) NOT NULL,
            serieNumeroGuia varchar(13) NOT NULL,
            tipoDocumentoGuia varchar(2) NOT NULL CONSTRAINT DF_FLEXO_GRE_OPERACION_tipoDocumentoGuia DEFAULT '09',
            tipoDocumentoDestinatario varchar(2) NOT NULL,
            numeroDocumentoDestinatario varchar(20) NOT NULL,
            razonSocialDestinatario nvarchar(250) NOT NULL,
            ubigeoPtoLlegada varchar(10) NOT NULL,
            direccionPtoLlegada nvarchar(500) NOT NULL,
            ubigeoPtoPartida varchar(10) NOT NULL,
            direccionPtoPartida nvarchar(500) NOT NULL,
            modalidadTraslado varchar(2) NOT NULL,
            motivoTraslado varchar(2) NOT NULL,
            descripcionMotivoTraslado nvarchar(120) NOT NULL,
            pesoBrutoTotalBienes decimal(18, 3) NOT NULL,
            unidadMedidaPesoBruto varchar(3) NOT NULL,
            numeroBultos int NOT NULL,
            fechaEmision datetime2(3) NOT NULL,
            fechaInicioTraslado date NOT NULL,
            ordenCompra nvarchar(200) NULL,
            observaciones nvarchar(500) NULL,
            tipoDocumentoConductor varchar(2) NULL,
            numeroDocumentoConductor varchar(20) NULL,
            nombreConductor nvarchar(120) NULL,
            apellidoConductor nvarchar(120) NULL,
            numeroLicencia varchar(30) NULL,
            numeroPlacaVehiculo varchar(20) NULL,
            correlativoFuente varchar(40) NOT NULL,
            estado varchar(40) NOT NULL,
            usuario nvarchar(128) NULL,
            datosJson nvarchar(max) NOT NULL,
            creadoEn datetime2(3) NOT NULL CONSTRAINT DF_FLEXO_GRE_OPERACION_creadoEn DEFAULT SYSUTCDATETIME(),
            actualizadoEn datetime2(3) NOT NULL CONSTRAINT DF_FLEXO_GRE_OPERACION_actualizadoEn DEFAULT SYSUTCDATETIME(),
            finalizadoEn datetime2(3) NULL,
            CONSTRAINT UQ_FLEXO_GRE_OPERACION_idOperacion UNIQUE (idOperacion),
            CONSTRAINT UQ_FLEXO_GRE_OPERACION_serieNumeroGuia UNIQUE (serieNumeroGuia),
            CONSTRAINT CK_FLEXO_GRE_OPERACION_serie CHECK (serie IN ('T003', 'T999')),
            CONSTRAINT CK_FLEXO_GRE_OPERACION_tipoDocumentoGuia CHECK (tipoDocumentoGuia = '09'),
            CONSTRAINT CK_FLEXO_GRE_OPERACION_estado CHECK (estado IN (
                'BORRADOR',
                'PREPARANDO',
                'INSERTADO_BIZLINKS',
                'ENVIADO',
                'ACEPTADA',
                'RECHAZADA',
                'ERROR',
                'BAJA_SOLICITADA',
                'ANULADA'
            ))
        );
    END;

    IF OBJECT_ID(N'dbo.FLEXO_GRE_ITEM', N'U') IS NULL
    BEGIN
        CREATE TABLE dbo.FLEXO_GRE_ITEM
        (
            id bigint IDENTITY(1,1) NOT NULL CONSTRAINT PK_FLEXO_GRE_ITEM PRIMARY KEY,
            operacionId bigint NOT NULL,
            numeroOrdenItem int NOT NULL,
            codigoEmpaque int NOT NULL,
            ticket varchar(50) NULL,
            ordenCompra nvarchar(100) NULL,
            codigoProducto varchar(80) NOT NULL,
            descripcion nvarchar(1700) NOT NULL,
            cantidadEmpaque decimal(18, 6) NOT NULL,
            cantidadDeclarada decimal(18, 6) NOT NULL,
            unidadMedidaEmpaque varchar(20) NULL,
            unidadMedidaDeclarada varchar(20) NOT NULL,
            serieNumeroGuia varchar(13) NOT NULL,
            ordenGuia varchar(4) NOT NULL,
            serieNumeroFactura varchar(13) NULL,
            ordenFactura varchar(4) NULL,
            estado varchar(40) NOT NULL,
            datosJson nvarchar(max) NULL,
            creadoEn datetime2(3) NOT NULL CONSTRAINT DF_FLEXO_GRE_ITEM_creadoEn DEFAULT SYSUTCDATETIME(),
            actualizadoEn datetime2(3) NOT NULL CONSTRAINT DF_FLEXO_GRE_ITEM_actualizadoEn DEFAULT SYSUTCDATETIME(),
            CONSTRAINT FK_FLEXO_GRE_ITEM_OPERACION FOREIGN KEY (operacionId)
                REFERENCES dbo.FLEXO_GRE_OPERACION(id),
            CONSTRAINT UQ_FLEXO_GRE_ITEM_empaque_producto_guia UNIQUE (codigoEmpaque, codigoProducto, serieNumeroGuia, ordenGuia),
            CONSTRAINT CK_FLEXO_GRE_ITEM_estado CHECK (estado IN (
                'PREPARANDO',
                'VINCULADO_GRE',
                'ACEPTADO_GRE',
                'RECHAZADO_GRE',
                'FACTURADO',
                'LIBERADO',
                'RETENIDO',
                'ERROR'
            ))
        );
    END;

    IF OBJECT_ID(N'dbo.FLEXO_GRE_ENVIO', N'U') IS NULL
    BEGIN
        CREATE TABLE dbo.FLEXO_GRE_ENVIO
        (
            id bigint IDENTITY(1,1) NOT NULL CONSTRAINT PK_FLEXO_GRE_ENVIO PRIMARY KEY,
            operacionId bigint NOT NULL,
            estado varchar(40) NOT NULL,
            intentos int NOT NULL CONSTRAINT DF_FLEXO_GRE_ENVIO_intentos DEFAULT 0,
            mensaje nvarchar(max) NULL,
            respuestaJson nvarchar(max) NULL,
            pdfUrl varchar(4000) NULL,
            cdrUrl varchar(4000) NULL,
            xmlUrl varchar(4000) NULL,
            creadoEn datetime2(3) NOT NULL CONSTRAINT DF_FLEXO_GRE_ENVIO_creadoEn DEFAULT SYSUTCDATETIME(),
            actualizadoEn datetime2(3) NOT NULL CONSTRAINT DF_FLEXO_GRE_ENVIO_actualizadoEn DEFAULT SYSUTCDATETIME(),
            insertadoBizlinksEn datetime2(3) NULL,
            enviadoBizlinksEn datetime2(3) NULL,
            respuestaBizlinksEn datetime2(3) NULL,
            CONSTRAINT FK_FLEXO_GRE_ENVIO_OPERACION FOREIGN KEY (operacionId)
                REFERENCES dbo.FLEXO_GRE_OPERACION(id),
            CONSTRAINT CK_FLEXO_GRE_ENVIO_estado CHECK (estado IN (
                'PREPARANDO',
                'INSERTADO_BIZLINKS',
                'ENVIADO',
                'ACEPTADA',
                'RECHAZADA',
                'ERROR',
                'BAJA_SOLICITADA',
                'ANULADA'
            ))
        );
    END;

    IF OBJECT_ID(N'dbo.FLEXO_GRE_EVENTO', N'U') IS NULL
    BEGIN
        CREATE TABLE dbo.FLEXO_GRE_EVENTO
        (
            id bigint IDENTITY(1,1) NOT NULL CONSTRAINT PK_FLEXO_GRE_EVENTO PRIMARY KEY,
            operacionId bigint NULL,
            envioId bigint NULL,
            itemId bigint NULL,
            tipo varchar(80) NOT NULL,
            mensaje nvarchar(max) NULL,
            datosJson nvarchar(max) NULL,
            usuario nvarchar(128) NULL,
            creadoEn datetime2(3) NOT NULL CONSTRAINT DF_FLEXO_GRE_EVENTO_creadoEn DEFAULT SYSUTCDATETIME(),
            CONSTRAINT FK_FLEXO_GRE_EVENTO_OPERACION FOREIGN KEY (operacionId)
                REFERENCES dbo.FLEXO_GRE_OPERACION(id),
            CONSTRAINT FK_FLEXO_GRE_EVENTO_ENVIO FOREIGN KEY (envioId)
                REFERENCES dbo.FLEXO_GRE_ENVIO(id),
            CONSTRAINT FK_FLEXO_GRE_EVENTO_ITEM FOREIGN KEY (itemId)
                REFERENCES dbo.FLEXO_GRE_ITEM(id)
        );
    END;

    IF OBJECT_ID(N'dbo.FLEXO_FE_OPERACION', N'U') IS NULL
    BEGIN
        CREATE TABLE dbo.FLEXO_FE_OPERACION
        (
            id bigint IDENTITY(1,1) NOT NULL CONSTRAINT PK_FLEXO_FE_OPERACION PRIMARY KEY,
            idOperacion uniqueidentifier NOT NULL,
            serie varchar(4) NOT NULL,
            numero varchar(8) NOT NULL,
            serieNumeroFactura varchar(13) NOT NULL,
            tipoDocumento varchar(2) NOT NULL CONSTRAINT DF_FLEXO_FE_OPERACION_tipoDocumento DEFAULT '01',
            tipoDocumentoCliente varchar(2) NOT NULL,
            numeroDocumentoCliente varchar(20) NOT NULL,
            razonSocialCliente nvarchar(250) NOT NULL,
            fechaEmision datetime2(3) NOT NULL,
            fechaVencimiento date NULL,
            moneda varchar(3) NOT NULL,
            formaPago nvarchar(200) NOT NULL,
            cuenta varchar(50) NOT NULL,
            codigoDetraccion varchar(3) NOT NULL,
            porcentajeDetraccion decimal(9, 2) NOT NULL,
            totalDetraccion decimal(18, 2) NOT NULL,
            tipoExclusionProducto varchar(20) NOT NULL,
            ordenCompra nvarchar(2000) NULL,
            observaciones nvarchar(max) NULL,
            gravada decimal(18, 2) NOT NULL,
            exonerada decimal(18, 2) NOT NULL,
            inafecta decimal(18, 2) NOT NULL,
            gratuita decimal(18, 2) NOT NULL,
            igv decimal(18, 2) NOT NULL,
            total decimal(18, 2) NOT NULL,
            correlativoFuente varchar(40) NOT NULL,
            estado varchar(40) NOT NULL,
            permiteGrePendiente bit NOT NULL CONSTRAINT DF_FLEXO_FE_OPERACION_permiteGrePendiente DEFAULT 0,
            autorizacionGrePendienteJson nvarchar(max) NULL,
            usuario nvarchar(128) NULL,
            datosJson nvarchar(max) NOT NULL,
            creadoEn datetime2(3) NOT NULL CONSTRAINT DF_FLEXO_FE_OPERACION_creadoEn DEFAULT SYSUTCDATETIME(),
            actualizadoEn datetime2(3) NOT NULL CONSTRAINT DF_FLEXO_FE_OPERACION_actualizadoEn DEFAULT SYSUTCDATETIME(),
            finalizadoEn datetime2(3) NULL,
            CONSTRAINT UQ_FLEXO_FE_OPERACION_idOperacion UNIQUE (idOperacion),
            CONSTRAINT UQ_FLEXO_FE_OPERACION_serieNumeroFactura UNIQUE (serieNumeroFactura),
            CONSTRAINT CK_FLEXO_FE_OPERACION_serie CHECK (serie = 'FF03'),
            CONSTRAINT CK_FLEXO_FE_OPERACION_tipoDocumento CHECK (tipoDocumento = '01'),
            CONSTRAINT CK_FLEXO_FE_OPERACION_tipoExclusionProducto CHECK (tipoExclusionProducto IN ('GRAVADA', 'GRATUITA', 'EXONERADA', 'INAFECTA')),
            CONSTRAINT CK_FLEXO_FE_OPERACION_estado CHECK (estado IN (
                'BORRADOR',
                'PREPARANDO',
                'INSERTADO_BIZLINKS',
                'ENVIADO',
                'ACEPTADA',
                'RECHAZADA',
                'ERROR',
                'BAJA_SOLICITADA',
                'ANULADA',
                'NCE_EMITIDA'
            ))
        );
    END;

    IF OBJECT_ID(N'dbo.FLEXO_FE_GUIA', N'U') IS NULL
    BEGIN
        CREATE TABLE dbo.FLEXO_FE_GUIA
        (
            id bigint IDENTITY(1,1) NOT NULL CONSTRAINT PK_FLEXO_FE_GUIA PRIMARY KEY,
            operacionId bigint NOT NULL,
            greOperacionId bigint NULL,
            serieNumeroGuia varchar(13) NOT NULL,
            tipoDocumentoGuia varchar(2) NOT NULL CONSTRAINT DF_FLEXO_FE_GUIA_tipoDocumentoGuia DEFAULT '09',
            estadoGreAlFacturar varchar(40) NOT NULL,
            totalGuia decimal(18, 2) NULL,
            creadoEn datetime2(3) NOT NULL CONSTRAINT DF_FLEXO_FE_GUIA_creadoEn DEFAULT SYSUTCDATETIME(),
            CONSTRAINT FK_FLEXO_FE_GUIA_OPERACION FOREIGN KEY (operacionId)
                REFERENCES dbo.FLEXO_FE_OPERACION(id),
            CONSTRAINT FK_FLEXO_FE_GUIA_GRE_OPERACION FOREIGN KEY (greOperacionId)
                REFERENCES dbo.FLEXO_GRE_OPERACION(id),
            CONSTRAINT CK_FLEXO_FE_GUIA_serie CHECK (serieNumeroGuia LIKE 'T003-%' OR serieNumeroGuia LIKE 'T999-%'),
            CONSTRAINT CK_FLEXO_FE_GUIA_tipoDocumentoGuia CHECK (tipoDocumentoGuia = '09')
        );
    END;

    IF OBJECT_ID(N'dbo.FLEXO_FE_ITEM', N'U') IS NULL
    BEGIN
        CREATE TABLE dbo.FLEXO_FE_ITEM
        (
            id bigint IDENTITY(1,1) NOT NULL CONSTRAINT PK_FLEXO_FE_ITEM PRIMARY KEY,
            operacionId bigint NOT NULL,
            guiaId bigint NULL,
            greItemId bigint NULL,
            numeroOrdenItem int NOT NULL,
            codigoEmpaque int NOT NULL,
            codigoProducto varchar(80) NOT NULL,
            descripcion nvarchar(1700) NOT NULL,
            cantidadDisponibleAlFacturar decimal(18, 6) NOT NULL,
            cantidadFacturada decimal(18, 6) NOT NULL,
            unidadMedida varchar(20) NOT NULL,
            precioUnitario decimal(18, 6) NOT NULL,
            afectoIgv bit NOT NULL,
            valorVenta decimal(18, 2) NOT NULL,
            igv decimal(18, 2) NOT NULL,
            total decimal(18, 2) NOT NULL,
            serieNumeroGuia varchar(13) NOT NULL,
            ordenGuia varchar(4) NULL,
            serieNumeroFactura varchar(13) NOT NULL,
            ordenFactura varchar(4) NOT NULL,
            estado varchar(40) NOT NULL,
            datosJson nvarchar(max) NULL,
            creadoEn datetime2(3) NOT NULL CONSTRAINT DF_FLEXO_FE_ITEM_creadoEn DEFAULT SYSUTCDATETIME(),
            actualizadoEn datetime2(3) NOT NULL CONSTRAINT DF_FLEXO_FE_ITEM_actualizadoEn DEFAULT SYSUTCDATETIME(),
            CONSTRAINT FK_FLEXO_FE_ITEM_OPERACION FOREIGN KEY (operacionId)
                REFERENCES dbo.FLEXO_FE_OPERACION(id),
            CONSTRAINT FK_FLEXO_FE_ITEM_GUIA FOREIGN KEY (guiaId)
                REFERENCES dbo.FLEXO_FE_GUIA(id),
            CONSTRAINT FK_FLEXO_FE_ITEM_GRE_ITEM FOREIGN KEY (greItemId)
                REFERENCES dbo.FLEXO_GRE_ITEM(id),
            CONSTRAINT UQ_FLEXO_FE_ITEM_empaque_producto_factura UNIQUE (codigoEmpaque, codigoProducto, serieNumeroFactura, ordenFactura),
            CONSTRAINT CK_FLEXO_FE_ITEM_estado CHECK (estado IN (
                'PREPARANDO',
                'VINCULADO_FE',
                'ACEPTADO_FE',
                'RECHAZADO_FE',
                'LIBERADO',
                'RETENIDO',
                'ERROR'
            ))
        );
    END;

    IF OBJECT_ID(N'dbo.FLEXO_FE_ENVIO', N'U') IS NULL
    BEGIN
        CREATE TABLE dbo.FLEXO_FE_ENVIO
        (
            id bigint IDENTITY(1,1) NOT NULL CONSTRAINT PK_FLEXO_FE_ENVIO PRIMARY KEY,
            operacionId bigint NOT NULL,
            estado varchar(40) NOT NULL,
            intentos int NOT NULL CONSTRAINT DF_FLEXO_FE_ENVIO_intentos DEFAULT 0,
            mensaje nvarchar(max) NULL,
            respuestaJson nvarchar(max) NULL,
            pdfUrl varchar(4000) NULL,
            cdrUrl varchar(4000) NULL,
            xmlUrl varchar(4000) NULL,
            creadoEn datetime2(3) NOT NULL CONSTRAINT DF_FLEXO_FE_ENVIO_creadoEn DEFAULT SYSUTCDATETIME(),
            actualizadoEn datetime2(3) NOT NULL CONSTRAINT DF_FLEXO_FE_ENVIO_actualizadoEn DEFAULT SYSUTCDATETIME(),
            insertadoBizlinksEn datetime2(3) NULL,
            enviadoBizlinksEn datetime2(3) NULL,
            respuestaBizlinksEn datetime2(3) NULL,
            CONSTRAINT FK_FLEXO_FE_ENVIO_OPERACION FOREIGN KEY (operacionId)
                REFERENCES dbo.FLEXO_FE_OPERACION(id),
            CONSTRAINT CK_FLEXO_FE_ENVIO_estado CHECK (estado IN (
                'PREPARANDO',
                'INSERTADO_BIZLINKS',
                'ENVIADO',
                'ACEPTADA',
                'RECHAZADA',
                'ERROR',
                'BAJA_SOLICITADA',
                'ANULADA',
                'NCE_EMITIDA'
            ))
        );
    END;

    IF OBJECT_ID(N'dbo.FLEXO_FE_EVENTO', N'U') IS NULL
    BEGIN
        CREATE TABLE dbo.FLEXO_FE_EVENTO
        (
            id bigint IDENTITY(1,1) NOT NULL CONSTRAINT PK_FLEXO_FE_EVENTO PRIMARY KEY,
            operacionId bigint NULL,
            envioId bigint NULL,
            itemId bigint NULL,
            tipo varchar(80) NOT NULL,
            mensaje nvarchar(max) NULL,
            datosJson nvarchar(max) NULL,
            usuario nvarchar(128) NULL,
            creadoEn datetime2(3) NOT NULL CONSTRAINT DF_FLEXO_FE_EVENTO_creadoEn DEFAULT SYSUTCDATETIME(),
            CONSTRAINT FK_FLEXO_FE_EVENTO_OPERACION FOREIGN KEY (operacionId)
                REFERENCES dbo.FLEXO_FE_OPERACION(id),
            CONSTRAINT FK_FLEXO_FE_EVENTO_ENVIO FOREIGN KEY (envioId)
                REFERENCES dbo.FLEXO_FE_ENVIO(id),
            CONSTRAINT FK_FLEXO_FE_EVENTO_ITEM FOREIGN KEY (itemId)
                REFERENCES dbo.FLEXO_FE_ITEM(id)
        );
    END;

    IF OBJECT_ID(N'dbo.FLEXO_DOCUMENTO_BAJA', N'U') IS NULL
    BEGIN
        CREATE TABLE dbo.FLEXO_DOCUMENTO_BAJA
        (
            id bigint IDENTITY(1,1) NOT NULL CONSTRAINT PK_FLEXO_DOCUMENTO_BAJA PRIMARY KEY,
            idOperacion uniqueidentifier NOT NULL,
            tipoDocumentoOrigen varchar(10) NOT NULL,
            greOperacionId bigint NULL,
            feOperacionId bigint NULL,
            serieNumeroDocumento varchar(13) NOT NULL,
            tipoBaja varchar(20) NOT NULL,
            motivo nvarchar(500) NOT NULL,
            documentoExterno varchar(13) NULL,
            confirmadoExternamente bit NOT NULL CONSTRAINT DF_FLEXO_DOCUMENTO_BAJA_confirmado DEFAULT 0,
            estado varchar(40) NOT NULL,
            usuarioSolicita nvarchar(128) NULL,
            solicitadoEn datetime2(3) NOT NULL CONSTRAINT DF_FLEXO_DOCUMENTO_BAJA_solicitadoEn DEFAULT SYSUTCDATETIME(),
            confirmadoEn datetime2(3) NULL,
            respuestaJson nvarchar(max) NULL,
            datosJson nvarchar(max) NULL,
            CONSTRAINT UQ_FLEXO_DOCUMENTO_BAJA_idOperacion UNIQUE (idOperacion),
            CONSTRAINT FK_FLEXO_DOCUMENTO_BAJA_GRE FOREIGN KEY (greOperacionId)
                REFERENCES dbo.FLEXO_GRE_OPERACION(id),
            CONSTRAINT FK_FLEXO_DOCUMENTO_BAJA_FE FOREIGN KEY (feOperacionId)
                REFERENCES dbo.FLEXO_FE_OPERACION(id),
            CONSTRAINT CK_FLEXO_DOCUMENTO_BAJA_tipoDocumentoOrigen CHECK (tipoDocumentoOrigen IN ('GRE', 'FE', 'NCE')),
            CONSTRAINT CK_FLEXO_DOCUMENTO_BAJA_tipoBaja CHECK (tipoBaja IN ('COMUNICACION_BAJA', 'ANULACION_GRE', 'NCE', 'LIBERACION_INTERNA')),
            CONSTRAINT CK_FLEXO_DOCUMENTO_BAJA_estado CHECK (estado IN ('SOLICITADA', 'ENVIADA', 'ACEPTADA', 'RECHAZADA', 'ERROR', 'LIBERADA'))
        );
    END;

    IF OBJECT_ID(N'dbo.FLEXO_DOCUMENTO_BAJA_ITEM', N'U') IS NULL
    BEGIN
        CREATE TABLE dbo.FLEXO_DOCUMENTO_BAJA_ITEM
        (
            id bigint IDENTITY(1,1) NOT NULL CONSTRAINT PK_FLEXO_DOCUMENTO_BAJA_ITEM PRIMARY KEY,
            bajaId bigint NOT NULL,
            greItemId bigint NULL,
            feItemId bigint NULL,
            codigoEmpaque int NOT NULL,
            codigoProducto varchar(80) NOT NULL,
            cantidadAfectada decimal(18, 6) NOT NULL,
            liberaParaGre bit NOT NULL CONSTRAINT DF_FLEXO_DOCUMENTO_BAJA_ITEM_liberaGre DEFAULT 0,
            liberaParaFe bit NOT NULL CONSTRAINT DF_FLEXO_DOCUMENTO_BAJA_ITEM_liberaFe DEFAULT 0,
            estado varchar(40) NOT NULL,
            datosJson nvarchar(max) NULL,
            creadoEn datetime2(3) NOT NULL CONSTRAINT DF_FLEXO_DOCUMENTO_BAJA_ITEM_creadoEn DEFAULT SYSUTCDATETIME(),
            CONSTRAINT FK_FLEXO_DOCUMENTO_BAJA_ITEM_BAJA FOREIGN KEY (bajaId)
                REFERENCES dbo.FLEXO_DOCUMENTO_BAJA(id),
            CONSTRAINT FK_FLEXO_DOCUMENTO_BAJA_ITEM_GRE_ITEM FOREIGN KEY (greItemId)
                REFERENCES dbo.FLEXO_GRE_ITEM(id),
            CONSTRAINT FK_FLEXO_DOCUMENTO_BAJA_ITEM_FE_ITEM FOREIGN KEY (feItemId)
                REFERENCES dbo.FLEXO_FE_ITEM(id),
            CONSTRAINT CK_FLEXO_DOCUMENTO_BAJA_ITEM_estado CHECK (estado IN ('PENDIENTE', 'LIBERADO', 'RETENIDO', 'ERROR'))
        );
    END;

    IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_FLEXO_GRE_OPERACION_cliente' AND object_id = OBJECT_ID(N'dbo.FLEXO_GRE_OPERACION'))
    BEGIN
        CREATE INDEX IX_FLEXO_GRE_OPERACION_cliente
            ON dbo.FLEXO_GRE_OPERACION(numeroDocumentoDestinatario, creadoEn DESC);
    END;

    IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_FLEXO_GRE_OPERACION_estado' AND object_id = OBJECT_ID(N'dbo.FLEXO_GRE_OPERACION'))
    BEGIN
        CREATE INDEX IX_FLEXO_GRE_OPERACION_estado
            ON dbo.FLEXO_GRE_OPERACION(estado, creadoEn DESC);
    END;

    IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_FLEXO_GRE_ITEM_empaque' AND object_id = OBJECT_ID(N'dbo.FLEXO_GRE_ITEM'))
    BEGIN
        CREATE INDEX IX_FLEXO_GRE_ITEM_empaque
            ON dbo.FLEXO_GRE_ITEM(codigoEmpaque, codigoProducto);
    END;

    IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_FLEXO_GRE_ENVIO_operacionId' AND object_id = OBJECT_ID(N'dbo.FLEXO_GRE_ENVIO'))
    BEGIN
        CREATE INDEX IX_FLEXO_GRE_ENVIO_operacionId
            ON dbo.FLEXO_GRE_ENVIO(operacionId);
    END;

    IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_FLEXO_GRE_EVENTO_operacionId' AND object_id = OBJECT_ID(N'dbo.FLEXO_GRE_EVENTO'))
    BEGIN
        CREATE INDEX IX_FLEXO_GRE_EVENTO_operacionId
            ON dbo.FLEXO_GRE_EVENTO(operacionId, creadoEn DESC);
    END;

    IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_FLEXO_FE_OPERACION_cliente' AND object_id = OBJECT_ID(N'dbo.FLEXO_FE_OPERACION'))
    BEGIN
        CREATE INDEX IX_FLEXO_FE_OPERACION_cliente
            ON dbo.FLEXO_FE_OPERACION(numeroDocumentoCliente, creadoEn DESC);
    END;

    IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_FLEXO_FE_OPERACION_estado' AND object_id = OBJECT_ID(N'dbo.FLEXO_FE_OPERACION'))
    BEGIN
        CREATE INDEX IX_FLEXO_FE_OPERACION_estado
            ON dbo.FLEXO_FE_OPERACION(estado, creadoEn DESC);
    END;

    IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_FLEXO_FE_GUIA_operacionId' AND object_id = OBJECT_ID(N'dbo.FLEXO_FE_GUIA'))
    BEGIN
        CREATE INDEX IX_FLEXO_FE_GUIA_operacionId
            ON dbo.FLEXO_FE_GUIA(operacionId);
    END;

    IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_FLEXO_FE_ITEM_empaque' AND object_id = OBJECT_ID(N'dbo.FLEXO_FE_ITEM'))
    BEGIN
        CREATE INDEX IX_FLEXO_FE_ITEM_empaque
            ON dbo.FLEXO_FE_ITEM(codigoEmpaque, codigoProducto);
    END;

    IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_FLEXO_FE_ENVIO_operacionId' AND object_id = OBJECT_ID(N'dbo.FLEXO_FE_ENVIO'))
    BEGIN
        CREATE INDEX IX_FLEXO_FE_ENVIO_operacionId
            ON dbo.FLEXO_FE_ENVIO(operacionId);
    END;

    IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_FLEXO_FE_EVENTO_operacionId' AND object_id = OBJECT_ID(N'dbo.FLEXO_FE_EVENTO'))
    BEGIN
        CREATE INDEX IX_FLEXO_FE_EVENTO_operacionId
            ON dbo.FLEXO_FE_EVENTO(operacionId, creadoEn DESC);
    END;

    IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_FLEXO_DOCUMENTO_BAJA_documento' AND object_id = OBJECT_ID(N'dbo.FLEXO_DOCUMENTO_BAJA'))
    BEGINNTO_BAJA_documento
            ON dbo.FLEXO_DOCUMENTO_BAJA(serieNumeroDocumento, estado);
    END;TEM(bajaId);
    END;b

    INSERT INTO dbo.GRE_FC_SCHEMA_MIGRATION 

    IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_FLEXO_DOCUMENTO_BAJA_ITEM_bajaId' AND object_id = OBJECT_ID(N'dbo.FLEXO_DOCUMENTO_BAJA_ITEM'))
    BEGIN
        CREATE INDEX IX_FLEXO_DOCUMENTO_BAJA_ITEM_bajaId
            ON do.FLEXO_DOCUMENTO_BAJA_I(version, descripcion)
    VALUES ('013_create_flexo_trace_tables'
        CREATE INDEX IX_FLEXO_DOCUME, N'Crea trazabilidad productiva FLEXO_* para GRE, FE, bajas/NCE e items');
END;
GO
