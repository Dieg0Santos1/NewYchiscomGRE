/*
  Permisos minimos para validar el espejo legacy FF03/F03 con rollback.

  No reemplaza objetos ni modifica datos de negocio.
  Concede EXECUTE sobre procedimientos oficiales legacy y SELECT para auditoria.
  No concede INSERT/UPDATE/DELETE directos sobre tablas legacy; las escrituras
  de la prueba rollback deben ocurrir solo a traves de los SP existentes y
  dentro de una transaccion que termina en ROLLBACK.

  Ajustar @AppUser si el usuario SQL de la aplicacion no es gre_app_test.
*/

USE YCHIDB3;
GO

DECLARE @AppUser sysname = N'gre_app_test';
DECLARE @sql nvarchar(max);

IF USER_ID(@AppUser) IS NULL
BEGIN
  THROW 53000, 'No existe el usuario indicado en YCHIDB3.', 1;
END;

SET @sql = N'';

IF OBJECT_ID(N'dbo.SPI_FACTURA_ELECTRONICA_FF03', N'P') IS NOT NULL
  SET @sql += N'GRANT EXECUTE ON OBJECT::dbo.SPI_FACTURA_ELECTRONICA_FF03 TO ' + QUOTENAME(@AppUser) + N';' + CHAR(10);

IF OBJECT_ID(N'dbo.SPI_DETFACT_NGUIA', N'P') IS NOT NULL
  SET @sql += N'GRANT EXECUTE ON OBJECT::dbo.SPI_DETFACT_NGUIA TO ' + QUOTENAME(@AppUser) + N';' + CHAR(10);

EXEC sp_executesql @sql;

SET @sql = N'
GRANT SELECT ON OBJECT::dbo.tbClieProv TO ' + QUOTENAME(@AppUser) + N';
GRANT SELECT ON OBJECT::dbo.tbPropiedades TO ' + QUOTENAME(@AppUser) + N';
GRANT SELECT ON OBJECT::dbo.tbUnidades TO ' + QUOTENAME(@AppUser) + N';
GRANT SELECT ON OBJECT::dbo.tbProductos TO ' + QUOTENAME(@AppUser) + N';
GRANT SELECT ON OBJECT::dbo.tbDocumentos TO ' + QUOTENAME(@AppUser) + N';
GRANT SELECT ON OBJECT::dbo.tbDetFact TO ' + QUOTENAME(@AppUser) + N';
GRANT SELECT ON OBJECT::dbo.tbTipoDocu TO ' + QUOTENAME(@AppUser) + N';
GRANT SELECT ON OBJECT::dbo.TBCTACTE TO ' + QUOTENAME(@AppUser) + N';
GRANT SELECT ON OBJECT::dbo.tbDocumentos_Y TO ' + QUOTENAME(@AppUser) + N';
';
EXEC sp_executesql @sql;

SELECT
  o.name AS procedimiento,
  HAS_PERMS_BY_NAME(N'dbo.' + o.name, N'OBJECT', N'EXECUTE') AS puedeEjecutar
FROM sys.objects o
WHERE o.type = 'P'
  AND o.name IN (
    N'SPI_FACTURA_ELECTRONICA_FF03',
    N'SPI_DETFACT_NGUIA'
  )
ORDER BY o.name;

SELECT
  v.objeto,
  HAS_PERMS_BY_NAME(v.objeto, N'OBJECT', N'SELECT') AS puedeLeer
FROM (VALUES
  (N'dbo.tbClieProv'),
  (N'dbo.tbPropiedades'),
  (N'dbo.tbUnidades'),
  (N'dbo.tbProductos'),
  (N'dbo.tbDocumentos'),
  (N'dbo.tbDetFact'),
  (N'dbo.tbTipoDocu'),
  (N'dbo.TBCTACTE'),
  (N'dbo.tbDocumentos_Y')
) AS v(objeto)
ORDER BY v.objeto;
