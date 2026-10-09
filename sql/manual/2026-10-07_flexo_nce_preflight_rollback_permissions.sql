/*
  Permisos minimos para validar Nota de Credito Flexo FC03 con rollback.

  No reemplaza objetos.
  No modifica datos de negocio.
  No concede INSERT/UPDATE/DELETE general sobre tablas productivas.
  Las escrituras de la prueba rollback ocurren por SP oficiales o por UPDATE
  acotado a columnas necesarias, dentro de una transaccion que termina en ROLLBACK.

  Ajustar @AppUser si el usuario SQL de la aplicacion no es gre_app_test.
*/

USE BIZLINKS_PROD21;
GO

DECLARE @AppUser sysname = N'gre_app_test';
DECLARE @sql nvarchar(max);

IF USER_ID(@AppUser) IS NULL
BEGIN
  THROW 55000, 'No existe el usuario indicado en BIZLINKS_PROD21.', 1;
END;

SET @sql = N'';

IF OBJECT_ID(N'dbo.SPI_NCREDITO_ELECTRONICA', N'P') IS NOT NULL
  SET @sql += N'GRANT EXECUTE ON OBJECT::dbo.SPI_NCREDITO_ELECTRONICA TO ' + QUOTENAME(@AppUser) + N';' + CHAR(10);

IF OBJECT_ID(N'dbo.USP_DetalleFE', N'P') IS NOT NULL
  SET @sql += N'GRANT EXECUTE ON OBJECT::dbo.USP_DetalleFE TO ' + QUOTENAME(@AppUser) + N';' + CHAR(10);

IF OBJECT_ID(N'dbo.USP_EnviaDocumentoFE', N'P') IS NOT NULL
  SET @sql += N'GRANT EXECUTE ON OBJECT::dbo.USP_EnviaDocumentoFE TO ' + QUOTENAME(@AppUser) + N';' + CHAR(10);

EXEC sp_executesql @sql;

SET @sql = N'
GRANT SELECT ON OBJECT::dbo.SPE_EINVOICEHEADER TO ' + QUOTENAME(@AppUser) + N';
GRANT SELECT ON OBJECT::dbo.SPE_EINVOICEDETAIL TO ' + QUOTENAME(@AppUser) + N';
GRANT SELECT ON OBJECT::dbo.SPE_EINVOICEHEADER_ADD TO ' + QUOTENAME(@AppUser) + N';
GRANT SELECT ON OBJECT::dbo.SPE_EINVOICE_RESPONSE TO ' + QUOTENAME(@AppUser) + N';
GRANT SELECT ON OBJECT::dbo.AAA_GUIAFACTURADA TO ' + QUOTENAME(@AppUser) + N';
GRANT SELECT ON OBJECT::dbo.AAA_TIPODOCUMENTO TO ' + QUOTENAME(@AppUser) + N';
GRANT SELECT ON OBJECT::dbo.EMPAQUE TO ' + QUOTENAME(@AppUser) + N';
GRANT SELECT ON OBJECT::dbo.EMPAQUE_DETALLE TO ' + QUOTENAME(@AppUser) + N';
';
EXEC sp_executesql @sql;

/*
  Escrituras acotadas usadas solo dentro de rollback:
  - Marcar la relacion factura -> NCE en AAA_GUIAFACTURADA.NOTACRE.
  - Simular avance del correlativo FC03.
*/
SET @sql = N'
GRANT UPDATE ON OBJECT::dbo.AAA_GUIAFACTURADA (NOTACRE) TO ' + QUOTENAME(@AppUser) + N';
GRANT UPDATE ON OBJECT::dbo.AAA_TIPODOCUMENTO (CORRELATIVO) TO ' + QUOTENAME(@AppUser) + N';
';
EXEC sp_executesql @sql;

SELECT
  o.name AS procedimiento,
  HAS_PERMS_BY_NAME(N'dbo.' + o.name, N'OBJECT', N'EXECUTE') AS puedeEjecutar
FROM sys.objects o
WHERE o.type = 'P'
  AND o.name IN (
    N'SPI_NCREDITO_ELECTRONICA',
    N'USP_DetalleFE',
    N'USP_EnviaDocumentoFE'
  )
ORDER BY o.name;

SELECT
  OBJECT_NAME(major_id) AS objeto,
  COL_NAME(major_id, minor_id) AS columna,
  permission_name,
  state_desc
FROM sys.database_permissions
WHERE grantee_principal_id = USER_ID(@AppUser)
  AND class = 1
  AND permission_name = 'UPDATE'
  AND major_id IN (
    OBJECT_ID(N'dbo.AAA_GUIAFACTURADA'),
    OBJECT_ID(N'dbo.AAA_TIPODOCUMENTO')
  )
ORDER BY objeto, columna;
GO

USE YCHIDB3;
GO

DECLARE @AppUser sysname = N'gre_app_test';
DECLARE @sql nvarchar(max);

IF USER_ID(@AppUser) IS NULL
BEGIN
  THROW 55001, 'No existe el usuario indicado en YCHIDB3.', 1;
END;

SET @sql = N'';

IF OBJECT_ID(N'dbo.SPI_NOTA_CREDITO_ELECTRONICA_FC03', N'P') IS NOT NULL
  SET @sql += N'GRANT EXECUTE ON OBJECT::dbo.SPI_NOTA_CREDITO_ELECTRONICA_FC03 TO ' + QUOTENAME(@AppUser) + N';' + CHAR(10);

IF OBJECT_ID(N'dbo.SPI_DETNOTA_CREDITO', N'P') IS NOT NULL
  SET @sql += N'GRANT EXECUTE ON OBJECT::dbo.SPI_DETNOTA_CREDITO TO ' + QUOTENAME(@AppUser) + N';' + CHAR(10);

EXEC sp_executesql @sql;

SET @sql = N'
GRANT SELECT ON OBJECT::dbo.tbClieProv TO ' + QUOTENAME(@AppUser) + N';
GRANT SELECT ON OBJECT::dbo.tbDocumentos TO ' + QUOTENAME(@AppUser) + N';
GRANT SELECT ON OBJECT::dbo.tbDocumentos_Y TO ' + QUOTENAME(@AppUser) + N';
GRANT SELECT ON OBJECT::dbo.tbDetNotaCredito TO ' + QUOTENAME(@AppUser) + N';
GRANT SELECT ON OBJECT::dbo.TBCTACTE TO ' + QUOTENAME(@AppUser) + N';
GRANT SELECT ON OBJECT::dbo.tbTipoDocu TO ' + QUOTENAME(@AppUser) + N';
';
EXEC sp_executesql @sql;

SELECT
  o.name AS procedimiento,
  HAS_PERMS_BY_NAME(N'dbo.' + o.name, N'OBJECT', N'EXECUTE') AS puedeEjecutar
FROM sys.objects o
WHERE o.type = 'P'
  AND o.name IN (
    N'SPI_NOTA_CREDITO_ELECTRONICA_FC03',
    N'SPI_DETNOTA_CREDITO'
  )
ORDER BY o.name;

SELECT
  v.objeto,
  HAS_PERMS_BY_NAME(v.objeto, N'OBJECT', N'SELECT') AS puedeLeer
FROM (VALUES
  (N'dbo.tbClieProv'),
  (N'dbo.tbDocumentos'),
  (N'dbo.tbDocumentos_Y'),
  (N'dbo.tbDetNotaCredito'),
  (N'dbo.TBCTACTE'),
  (N'dbo.tbTipoDocu')
) AS v(objeto)
ORDER BY v.objeto;
GO
