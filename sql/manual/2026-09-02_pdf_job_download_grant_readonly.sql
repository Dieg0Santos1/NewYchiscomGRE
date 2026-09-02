/*
  Permiso estrictamente de solo lectura para diagnosticar la entrega de PDF
  cuando dbo.SPE_DESPATCH_RESPONSE.bl_url_pdf apunta al servicio /files de
  Bizlinks pero dicho servicio no responde.

  No inserta, actualiza ni elimina datos. No ejecuta procedimientos.
  Cambie [gre_app_test] únicamente si el servicio usa otro usuario de BD.
*/

USE [BIZLINKS_PROD21];
GO

IF USER_ID(N'gre_app_test') IS NULL
BEGIN
  THROW 50001, 'No existe el usuario gre_app_test en BIZLINKS_PROD21.', 1;
END;
GO

GRANT SELECT ON OBJECT::dbo.SPE_JOB_DOWNLOAD TO [gre_app_test];
GO

EXECUTE AS USER = N'gre_app_test';

SELECT
  DB_NAME() AS baseDatos,
  N'dbo.SPE_JOB_DOWNLOAD' AS objeto,
  N'gre_app_test' AS usuario,
  HAS_PERMS_BY_NAME(N'dbo.SPE_JOB_DOWNLOAD', N'OBJECT', N'SELECT') AS puedeLeer,
  HAS_PERMS_BY_NAME(N'dbo.SPE_JOB_DOWNLOAD', N'OBJECT', N'INSERT') AS puedeInsertar,
  HAS_PERMS_BY_NAME(N'dbo.SPE_JOB_DOWNLOAD', N'OBJECT', N'UPDATE') AS puedeActualizar,
  HAS_PERMS_BY_NAME(N'dbo.SPE_JOB_DOWNLOAD', N'OBJECT', N'DELETE') AS puedeEliminar;

REVERT;
GO
