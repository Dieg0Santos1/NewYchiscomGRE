/* Verificacion de solo lectura posterior a la instalacion. */
USE [GRE_FORMULARIOS_TEST];
GO

SELECT
  OBJECT_SCHEMA_NAME(object_id) + N'.' + OBJECT_NAME(object_id) AS objeto,
  type_desc AS tipo
FROM sys.objects
WHERE object_id IN (
  OBJECT_ID(N'dbo.GRE_PORTAL_USUARIO'),
  OBJECT_ID(N'dbo.GRE_PORTAL_USUARIO_MODULO'),
  OBJECT_ID(N'dbo.GRE_PORTAL_ACCESO_EVENTO')
)
ORDER BY objeto;

SELECT
  (SELECT COUNT_BIG(*) FROM dbo.GRE_PORTAL_USUARIO) AS usuarios,
  (SELECT COUNT_BIG(*) FROM dbo.GRE_PORTAL_USUARIO_MODULO) AS permisosModulo,
  (SELECT COUNT_BIG(*) FROM dbo.GRE_PORTAL_ACCESO_EVENTO) AS eventosAuditoria;
GO
