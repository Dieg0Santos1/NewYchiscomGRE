/*
  Habilita cambio controlado de credenciales desde el panel SuperAdmin.

  Alcance:
  - Solo aplica sobre GRE_FORMULARIOS_TEST.
  - No modifica YCHIDB3, BIZLINKS ni tablas del sistema anterior.
  - Permite a la aplicacion actualizar columnas puntuales de GRE_PORTAL_USUARIO.
  - Mantiene bloqueado DELETE y mantiene la bitacora como append-only.

  Revise el nombre de la base y de [gre_app_test] antes de ejecutar.
*/

USE [GRE_FORMULARIOS_TEST];
GO

IF USER_ID(N'gre_app_test') IS NULL
BEGIN
  THROW 50001, 'No existe el usuario gre_app_test en esta base. Revise el principal de la aplicacion.', 1;
END;
GO

IF OBJECT_ID(N'dbo.GRE_PORTAL_USUARIO', N'U') IS NULL
BEGIN
  THROW 50002, 'No existe dbo.GRE_PORTAL_USUARIO. Ejecute primero 2026-09-04_portal_auth_tables.sql.', 1;
END;
GO

REVOKE UPDATE ON OBJECT::dbo.GRE_PORTAL_USUARIO FROM [gre_app_test];
GO

GRANT UPDATE ON OBJECT::dbo.GRE_PORTAL_USUARIO
(
  nombre,
  passwordHash,
  esAdministrador,
  activo,
  modificadoEn,
  modificadoPor
) TO [gre_app_test];
GO

DENY DELETE ON OBJECT::dbo.GRE_PORTAL_USUARIO TO [gre_app_test];
DENY UPDATE, DELETE ON OBJECT::dbo.GRE_PORTAL_USUARIO_MODULO TO [gre_app_test];
DENY SELECT, UPDATE, DELETE ON OBJECT::dbo.GRE_PORTAL_ACCESO_EVENTO TO [gre_app_test];
GO

EXECUTE AS USER = N'gre_app_test';

SELECT
  DB_NAME() AS baseDatos,
  HAS_PERMS_BY_NAME(N'dbo.GRE_PORTAL_USUARIO', N'OBJECT', N'SELECT') AS usuarioPuedeLeer,
  HAS_PERMS_BY_NAME(N'dbo.GRE_PORTAL_USUARIO', N'OBJECT', N'INSERT') AS usuarioPuedeInsertar,
  HAS_PERMS_BY_NAME(N'dbo.GRE_PORTAL_USUARIO', N'OBJECT', N'DELETE') AS usuarioPuedeEliminar,
  HAS_PERMS_BY_NAME(N'dbo.GRE_PORTAL_ACCESO_EVENTO', N'OBJECT', N'INSERT') AS eventoPuedeInsertar,
  HAS_PERMS_BY_NAME(N'dbo.GRE_PORTAL_ACCESO_EVENTO', N'OBJECT', N'SELECT') AS eventoPuedeLeer;

SELECT
  subentity_name AS columna,
  permission_name AS permiso
FROM fn_my_permissions(N'dbo.GRE_PORTAL_USUARIO', N'OBJECT')
WHERE permission_name = N'UPDATE'
ORDER BY subentity_name;

REVERT;
GO
