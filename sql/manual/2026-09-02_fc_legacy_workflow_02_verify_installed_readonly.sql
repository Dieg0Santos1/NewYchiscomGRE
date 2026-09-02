/*
  Verificacion posterior a la instalacion y anterior al GRANT.
  Completamente read-only: solo consulta metadatos y permisos.

  Resultado esperado:
    wrappersInstalados = 3
    wrappersConExecuteParaApp = 0
    listoParaConcederExecute = 1
*/
USE [YCHIDB3];
GO

SELECT
  SCHEMA_NAME(p.schema_id) + N'.' + p.name AS wrapper,
  p.create_date AS creadoEn,
  p.modify_date AS modificadoEn,
  CASE WHEN m.definition IS NULL THEN 0 ELSE 1 END AS definicionVisible,
  CASE WHEN EXISTS (
    SELECT 1
    FROM sys.database_permissions dp
    WHERE dp.grantee_principal_id = DATABASE_PRINCIPAL_ID(N'gre_app_test')
      AND dp.major_id = p.object_id
      AND dp.permission_name = N'EXECUTE'
      AND dp.state IN (N'G', N'W')
  ) THEN 1 ELSE 0 END AS appPuedeEjecutar
FROM sys.procedures p
LEFT JOIN sys.sql_modules m ON m.object_id = p.object_id
WHERE p.schema_id = SCHEMA_ID(N'dbo')
  AND p.name IN (
    N'GRE_WEB_CREAR_PREGUIA_FC',
    N'GRE_WEB_ACEPTAR_PREGUIA_FC',
    N'GRE_WEB_CREAR_GUIA_INTERNA_FC'
  )
ORDER BY p.name;

DECLARE @wrappersInstalados int = (
  SELECT COUNT(*) FROM sys.procedures
  WHERE schema_id = SCHEMA_ID(N'dbo')
    AND name IN (
      N'GRE_WEB_CREAR_PREGUIA_FC',
      N'GRE_WEB_ACEPTAR_PREGUIA_FC',
      N'GRE_WEB_CREAR_GUIA_INTERNA_FC'
    )
);

DECLARE @wrappersConExecuteParaApp int = (
  SELECT COUNT(DISTINCT major_id)
  FROM sys.database_permissions
  WHERE grantee_principal_id = DATABASE_PRINCIPAL_ID(N'gre_app_test')
    AND permission_name = N'EXECUTE'
    AND state IN (N'G', N'W')
    AND major_id IN (
      OBJECT_ID(N'dbo.GRE_WEB_CREAR_PREGUIA_FC'),
      OBJECT_ID(N'dbo.GRE_WEB_ACEPTAR_PREGUIA_FC'),
      OBJECT_ID(N'dbo.GRE_WEB_CREAR_GUIA_INTERNA_FC')
    )
);

SELECT
  @wrappersInstalados AS wrappersInstalados,
  @wrappersConExecuteParaApp AS wrappersConExecuteParaApp,
  CASE WHEN @wrappersInstalados = 3 AND @wrappersConExecuteParaApp = 0 THEN 1 ELSE 0 END AS listoParaConcederExecute;
GO
