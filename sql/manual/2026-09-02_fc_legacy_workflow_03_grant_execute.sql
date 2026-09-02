/*
  Fase 3 - concede unicamente EXECUTE sobre los tres wrappers a gre_app_test.
  No concede INSERT, UPDATE, DELETE ni ALTER y no ejecuta el flujo.
*/
USE [YCHIDB3];
GO

IF OBJECT_ID(N'dbo.GRE_WEB_CREAR_PREGUIA_FC', N'P') IS NULL
   OR OBJECT_ID(N'dbo.GRE_WEB_ACEPTAR_PREGUIA_FC', N'P') IS NULL
   OR OBJECT_ID(N'dbo.GRE_WEB_CREAR_GUIA_INTERNA_FC', N'P') IS NULL
BEGIN
  RAISERROR('Falta uno o mas wrappers. No se concedieron permisos.', 16, 1);
  RETURN;
END;

GRANT EXECUTE ON OBJECT::dbo.GRE_WEB_CREAR_PREGUIA_FC TO [gre_app_test];
GRANT EXECUTE ON OBJECT::dbo.GRE_WEB_ACEPTAR_PREGUIA_FC TO [gre_app_test];
GRANT EXECUTE ON OBJECT::dbo.GRE_WEB_CREAR_GUIA_INTERNA_FC TO [gre_app_test];

SELECT
  OBJECT_SCHEMA_NAME(p.major_id) + N'.' + OBJECT_NAME(p.major_id) AS objeto,
  p.permission_name AS permiso,
  p.state_desc AS estado
FROM sys.database_permissions p
WHERE p.grantee_principal_id = DATABASE_PRINCIPAL_ID(N'gre_app_test')
  AND p.major_id IN (
    OBJECT_ID(N'dbo.GRE_WEB_CREAR_PREGUIA_FC'),
    OBJECT_ID(N'dbo.GRE_WEB_ACEPTAR_PREGUIA_FC'),
    OBJECT_ID(N'dbo.GRE_WEB_CREAR_GUIA_INTERNA_FC')
  )
ORDER BY objeto;
GO
