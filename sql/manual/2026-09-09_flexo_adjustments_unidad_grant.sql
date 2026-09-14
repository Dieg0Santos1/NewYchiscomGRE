/*
  Permisos minimos para modulo Flexo > Ajustes de unidad de medida.

  Este script NO inserta, NO actualiza y NO elimina datos.
  Solo concede:
    - SELECT en dbo.EMPAQUE y dbo.EMPAQUE_DETALLE para buscar empaques.
    - UPDATE por columna en dbo.EMPAQUE_DETALLE.UNIDADMEDIDA para guardar el ajuste.

  El backend actualiza solo detalles pendientes:
    SERIENUMEROGUIAREMISION IS NULL
    SERIENUMEROGUIAFACTURA IS NULL

  Cambie [gre_app_test] solo si el servicio usa otro usuario SQL.
*/

USE [BIZLINKS_PROD21];
GO

IF USER_ID(N'gre_app_test') IS NULL
BEGIN
  THROW 50001, 'No existe el usuario gre_app_test en BIZLINKS_PROD21.', 1;
END;
GO

GRANT SELECT ON OBJECT::dbo.EMPAQUE TO [gre_app_test];
GRANT SELECT ON OBJECT::dbo.EMPAQUE_DETALLE TO [gre_app_test];
GRANT UPDATE ON OBJECT::dbo.EMPAQUE_DETALLE (UNIDADMEDIDA) TO [gre_app_test];
GO

EXECUTE AS USER = N'gre_app_test';

SELECT
  DB_NAME() AS baseDatos,
  N'dbo.EMPAQUE' AS objeto,
  HAS_PERMS_BY_NAME(N'dbo.EMPAQUE', N'OBJECT', N'SELECT') AS puedeLeer,
  HAS_PERMS_BY_NAME(N'dbo.EMPAQUE', N'OBJECT', N'UPDATE') AS puedeActualizarTablaCompleta;

SELECT
  DB_NAME() AS baseDatos,
  N'dbo.EMPAQUE_DETALLE' AS objeto,
  HAS_PERMS_BY_NAME(N'dbo.EMPAQUE_DETALLE', N'OBJECT', N'SELECT') AS puedeLeer,
  HAS_PERMS_BY_NAME(N'dbo.EMPAQUE_DETALLE', N'OBJECT', N'UPDATE') AS puedeActualizarTablaCompleta;

SELECT
  class_desc AS clase,
  OBJECT_SCHEMA_NAME(major_id) + N'.' + OBJECT_NAME(major_id) AS objeto,
  COL_NAME(major_id, minor_id) AS columna,
  permission_name AS permiso,
  state_desc AS estado
FROM sys.database_permissions
WHERE grantee_principal_id = USER_ID(N'gre_app_test')
  AND major_id = OBJECT_ID(N'dbo.EMPAQUE_DETALLE')
  AND permission_name = N'UPDATE'
ORDER BY columna;

REVERT;
GO
