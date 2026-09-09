/*
  Permisos estrictamente de solo lectura para que el flujo FC web pueda
  construir la descripcion de guia interna igual que el sistema antiguo:
  FORMATO + MEDIDA + numero de copias.

  No inserta, no actualiza, no elimina datos y no ejecuta procedimientos.
  Cambie [gre_app_test] solo si el servicio usa otro usuario de BD.
*/

USE [YCHIDB3];
GO

IF USER_ID(N'gre_app_test') IS NULL
BEGIN
  THROW 50001, 'No existe el usuario gre_app_test en YCHIDB3.', 1;
END;
GO

GRANT SELECT ON OBJECT::dbo.tbFormatos TO [gre_app_test];
GRANT SELECT ON OBJECT::dbo.tbMedidas TO [gre_app_test];
GRANT SELECT ON OBJECT::dbo.tbEquivMed TO [gre_app_test];
GRANT SELECT ON OBJECT::dbo.tbDetSoliProf_detalle TO [gre_app_test];
GRANT SELECT ON OBJECT::dbo.tbTipoDocu TO [gre_app_test];
GO

EXECUTE AS USER = N'gre_app_test';

SELECT N'dbo.tbFormatos' AS objeto, HAS_PERMS_BY_NAME(N'dbo.tbFormatos', N'OBJECT', N'SELECT') AS puedeLeer;
SELECT N'dbo.tbMedidas' AS objeto, HAS_PERMS_BY_NAME(N'dbo.tbMedidas', N'OBJECT', N'SELECT') AS puedeLeer;
SELECT N'dbo.tbEquivMed' AS objeto, HAS_PERMS_BY_NAME(N'dbo.tbEquivMed', N'OBJECT', N'SELECT') AS puedeLeer;
SELECT N'dbo.tbDetSoliProf_detalle' AS objeto, HAS_PERMS_BY_NAME(N'dbo.tbDetSoliProf_detalle', N'OBJECT', N'SELECT') AS puedeLeer;
SELECT N'dbo.tbTipoDocu' AS objeto, HAS_PERMS_BY_NAME(N'dbo.tbTipoDocu', N'OBJECT', N'SELECT') AS puedeLeer;

REVERT;
GO
