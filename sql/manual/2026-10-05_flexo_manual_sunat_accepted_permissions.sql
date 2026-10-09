/*
  Permisos minimos para habilitar el boton de ayuda "Aceptar" en reportes GRE Flexo.

  No reemplaza objetos ni modifica datos.
  No concede UPDATE general sobre SPE_DESPATCH_RESPONSE; solo permite actualizar
  la columna bl_mensajeSunat bajo las validaciones de la aplicacion.

  Ajustar @AppUser si el usuario SQL de la aplicacion no es gre_app_test.
*/

USE BIZLINKS_PROD21;
GO

DECLARE @AppUser sysname = N'gre_app_test';
DECLARE @sql nvarchar(max);

IF USER_ID(@AppUser) IS NULL
BEGIN
  THROW 54000, 'No existe el usuario indicado en BIZLINKS_PROD21.', 1;
END;

IF OBJECT_ID(N'dbo.SPE_DESPATCH_RESPONSE', N'U') IS NULL
BEGIN
  THROW 54001, 'No existe dbo.SPE_DESPATCH_RESPONSE en BIZLINKS_PROD21.', 1;
END;

SET @sql = N'
GRANT SELECT ON OBJECT::dbo.SPE_DESPATCH_RESPONSE TO ' + QUOTENAME(@AppUser) + N';
GRANT UPDATE ON OBJECT::dbo.SPE_DESPATCH_RESPONSE (bl_mensajeSunat) TO ' + QUOTENAME(@AppUser) + N';
';
EXEC sp_executesql @sql;

SELECT
  N'dbo.SPE_DESPATCH_RESPONSE' AS objeto,
  HAS_PERMS_BY_NAME(N'dbo.SPE_DESPATCH_RESPONSE', N'OBJECT', N'SELECT') AS puedeLeer,
  HAS_PERMS_BY_NAME(N'dbo.SPE_DESPATCH_RESPONSE', N'OBJECT', N'UPDATE') AS puedeActualizarTablaCompleta;

SELECT
  OBJECT_NAME(major_id) AS objeto,
  COL_NAME(major_id, minor_id) AS columna,
  permission_name,
  state_desc
FROM sys.database_permissions
WHERE grantee_principal_id = USER_ID(@AppUser)
  AND class = 1
  AND major_id = OBJECT_ID(N'dbo.SPE_DESPATCH_RESPONSE')
  AND permission_name = 'UPDATE'
ORDER BY objeto, columna;
GO

USE GRE_FORMULARIOS_TEST;
GO

DECLARE @AppUser sysname = N'gre_app_test';
DECLARE @sql nvarchar(max);

IF USER_ID(@AppUser) IS NULL
BEGIN
  THROW 54002, 'No existe el usuario indicado en GRE_FORMULARIOS_TEST.', 1;
END;

IF OBJECT_ID(N'dbo.FLEXO_GRE_OPERACION', N'U') IS NULL
  THROW 54003, 'No existe dbo.FLEXO_GRE_OPERACION en GRE_FORMULARIOS_TEST.', 1;

IF OBJECT_ID(N'dbo.FLEXO_GRE_ENVIO', N'U') IS NULL
  THROW 54004, 'No existe dbo.FLEXO_GRE_ENVIO en GRE_FORMULARIOS_TEST.', 1;

IF OBJECT_ID(N'dbo.FLEXO_GRE_EVENTO', N'U') IS NULL
  THROW 54005, 'No existe dbo.FLEXO_GRE_EVENTO en GRE_FORMULARIOS_TEST.', 1;

SET @sql = N'
GRANT SELECT ON OBJECT::dbo.FLEXO_GRE_OPERACION TO ' + QUOTENAME(@AppUser) + N';
GRANT SELECT ON OBJECT::dbo.FLEXO_GRE_ENVIO TO ' + QUOTENAME(@AppUser) + N';
GRANT INSERT ON OBJECT::dbo.FLEXO_GRE_EVENTO TO ' + QUOTENAME(@AppUser) + N';
';
EXEC sp_executesql @sql;

SELECT
  v.objeto,
  v.permiso,
  HAS_PERMS_BY_NAME(v.objeto, N'OBJECT', v.permiso) AS permitido
FROM (VALUES
  (N'dbo.FLEXO_GRE_OPERACION', N'SELECT'),
  (N'dbo.FLEXO_GRE_ENVIO', N'SELECT'),
  (N'dbo.FLEXO_GRE_EVENTO', N'INSERT')
) AS v(objeto, permiso)
ORDER BY v.objeto, v.permiso;
GO
