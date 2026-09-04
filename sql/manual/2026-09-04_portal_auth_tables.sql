/*
  Almacenamiento y trazabilidad de accesos del portal GRE.

  Alcance:
  - Crea objetos NUEVOS solamente en la base propia GRE_FORMULARIOS_TEST.
  - No modifica YCHIDB3, BIZLINKS ni tablas del sistema anterior.
  - La aplicacion puede leer y crear accesos, pero no eliminar ni actualizar.
  - La bitacora es append-only para la aplicacion.

  Revise el nombre de la base y de [gre_app_test] antes de ejecutar.
*/

USE [GRE_FORMULARIOS_TEST];
GO

SET XACT_ABORT ON;
BEGIN TRANSACTION;

IF OBJECT_ID(N'dbo.GRE_PORTAL_USUARIO', N'U') IS NULL
BEGIN
  CREATE TABLE dbo.GRE_PORTAL_USUARIO
  (
    idUsuario int IDENTITY(1,1) NOT NULL CONSTRAINT PK_GRE_PORTAL_USUARIO PRIMARY KEY,
    usuario varchar(80) NOT NULL,
    nombre nvarchar(120) NOT NULL,
    passwordHash varchar(300) NOT NULL,
    esAdministrador bit NOT NULL CONSTRAINT DF_GRE_PORTAL_USUARIO_esAdministrador DEFAULT (0),
    activo bit NOT NULL CONSTRAINT DF_GRE_PORTAL_USUARIO_activo DEFAULT (1),
    creadoEn datetime2(3) NOT NULL CONSTRAINT DF_GRE_PORTAL_USUARIO_creadoEn DEFAULT SYSUTCDATETIME(),
    creadoPor varchar(80) NOT NULL,
    modificadoEn datetime2(3) NULL,
    modificadoPor varchar(80) NULL,
    version rowversion NOT NULL,
    CONSTRAINT UQ_GRE_PORTAL_USUARIO_usuario UNIQUE (usuario),
    CONSTRAINT CK_GRE_PORTAL_USUARIO_usuario CHECK (LEN(LTRIM(RTRIM(usuario))) BETWEEN 3 AND 80),
    CONSTRAINT CK_GRE_PORTAL_USUARIO_nombre CHECK (LEN(LTRIM(RTRIM(nombre))) BETWEEN 1 AND 120),
    CONSTRAINT CK_GRE_PORTAL_USUARIO_passwordHash CHECK (passwordHash LIKE 'scrypt$%$%')
  );
END;

IF OBJECT_ID(N'dbo.GRE_PORTAL_USUARIO_MODULO', N'U') IS NULL
BEGIN
  CREATE TABLE dbo.GRE_PORTAL_USUARIO_MODULO
  (
    idUsuario int NOT NULL,
    modulo varchar(20) NOT NULL,
    asignadoEn datetime2(3) NOT NULL CONSTRAINT DF_GRE_PORTAL_USUARIO_MODULO_asignadoEn DEFAULT SYSUTCDATETIME(),
    asignadoPor varchar(80) NOT NULL,
    CONSTRAINT PK_GRE_PORTAL_USUARIO_MODULO PRIMARY KEY (idUsuario, modulo),
    CONSTRAINT FK_GRE_PORTAL_USUARIO_MODULO_usuario FOREIGN KEY (idUsuario)
      REFERENCES dbo.GRE_PORTAL_USUARIO (idUsuario),
    CONSTRAINT CK_GRE_PORTAL_USUARIO_MODULO_modulo CHECK (modulo IN ('fc', 'flexo', 'traslado'))
  );
END;

IF OBJECT_ID(N'dbo.GRE_PORTAL_ACCESO_EVENTO', N'U') IS NULL
BEGIN
  CREATE TABLE dbo.GRE_PORTAL_ACCESO_EVENTO
  (
    idEvento bigint IDENTITY(1,1) NOT NULL CONSTRAINT PK_GRE_PORTAL_ACCESO_EVENTO PRIMARY KEY,
    fechaEvento datetime2(3) NOT NULL CONSTRAINT DF_GRE_PORTAL_ACCESO_EVENTO_fechaEvento DEFAULT SYSUTCDATETIME(),
    tipoEvento varchar(40) NOT NULL,
    actorUsuario varchar(80) NULL,
    usuarioObjetivo varchar(80) NOT NULL,
    exitoso bit NOT NULL,
    ip varchar(64) NULL,
    userAgent nvarchar(400) NULL,
    detalle nvarchar(500) NULL
  );

  CREATE INDEX IX_GRE_PORTAL_ACCESO_EVENTO_fecha
    ON dbo.GRE_PORTAL_ACCESO_EVENTO (fechaEvento DESC);

  CREATE INDEX IX_GRE_PORTAL_ACCESO_EVENTO_usuario
    ON dbo.GRE_PORTAL_ACCESO_EVENTO (usuarioObjetivo, fechaEvento DESC);
END;

COMMIT TRANSACTION;
GO

IF USER_ID(N'gre_app_test') IS NULL
BEGIN
  THROW 50001, 'No existe el usuario gre_app_test en esta base. Revise el principal de la aplicacion.', 1;
END;
GO

GRANT SELECT, INSERT ON OBJECT::dbo.GRE_PORTAL_USUARIO TO [gre_app_test];
GRANT SELECT, INSERT ON OBJECT::dbo.GRE_PORTAL_USUARIO_MODULO TO [gre_app_test];
GRANT INSERT ON OBJECT::dbo.GRE_PORTAL_ACCESO_EVENTO TO [gre_app_test];

DENY UPDATE, DELETE ON OBJECT::dbo.GRE_PORTAL_USUARIO TO [gre_app_test];
DENY UPDATE, DELETE ON OBJECT::dbo.GRE_PORTAL_USUARIO_MODULO TO [gre_app_test];
DENY SELECT, UPDATE, DELETE ON OBJECT::dbo.GRE_PORTAL_ACCESO_EVENTO TO [gre_app_test];
GO

EXECUTE AS USER = N'gre_app_test';

SELECT
  DB_NAME() AS baseDatos,
  objeto,
  HAS_PERMS_BY_NAME(objeto, N'OBJECT', N'SELECT') AS puedeLeer,
  HAS_PERMS_BY_NAME(objeto, N'OBJECT', N'INSERT') AS puedeInsertar,
  HAS_PERMS_BY_NAME(objeto, N'OBJECT', N'UPDATE') AS puedeActualizar,
  HAS_PERMS_BY_NAME(objeto, N'OBJECT', N'DELETE') AS puedeEliminar
FROM (VALUES
  (N'dbo.GRE_PORTAL_USUARIO'),
  (N'dbo.GRE_PORTAL_USUARIO_MODULO'),
  (N'dbo.GRE_PORTAL_ACCESO_EVENTO')
) objetos(objeto);

REVERT;
GO
