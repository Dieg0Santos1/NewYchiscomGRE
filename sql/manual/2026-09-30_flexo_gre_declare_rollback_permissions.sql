/*
  Permisos minimos para ensayar y luego habilitar declaracion GRE Flexo T003/T999.

  No reemplaza objetos ni modifica datos.
  No concede UPDATE general sobre tablas completas cuando SQL Server permite
  conceder UPDATE por columna.

  Ajustar @AppUser si el usuario SQL de la aplicacion no es gre_app_test.
*/

USE BIZLINKS_PROD21;
GO

DECLARE @AppUser sysname = N'gre_app_test';
DECLARE @sql nvarchar(max);

IF USER_ID(@AppUser) IS NULL
BEGIN
  THROW 51000, 'No existe el usuario indicado en BIZLINKS_PROD21.', 1;
END;

/*
  Procedimientos oficiales GRE usados por Flexo.
*/
SET @sql = N'';

IF OBJECT_ID(N'dbo.USP_CABECERAGUIA', N'P') IS NOT NULL
  SET @sql += N'GRANT EXECUTE ON OBJECT::dbo.USP_CABECERAGUIA TO ' + QUOTENAME(@AppUser) + N';' + CHAR(10);

IF OBJECT_ID(N'dbo.USP_DETALLEGUIA', N'P') IS NOT NULL
  SET @sql += N'GRANT EXECUTE ON OBJECT::dbo.USP_DETALLEGUIA TO ' + QUOTENAME(@AppUser) + N';' + CHAR(10);

IF OBJECT_ID(N'dbo.USP_ENVIOGUIA', N'P') IS NOT NULL
  SET @sql += N'GRANT EXECUTE ON OBJECT::dbo.USP_ENVIOGUIA TO ' + QUOTENAME(@AppUser) + N';' + CHAR(10);

IF OBJECT_ID(N'dbo.SPI_GUIA_ELECTRONICA', N'P') IS NOT NULL
  SET @sql += N'GRANT EXECUTE ON OBJECT::dbo.SPI_GUIA_ELECTRONICA TO ' + QUOTENAME(@AppUser) + N';' + CHAR(10);

IF OBJECT_ID(N'dbo.SPI_DETALLE_GUIA_ELECTRONICA', N'P') IS NOT NULL
  SET @sql += N'GRANT EXECUTE ON OBJECT::dbo.SPI_DETALLE_GUIA_ELECTRONICA TO ' + QUOTENAME(@AppUser) + N';' + CHAR(10);

EXEC sp_executesql @sql;

/*
  Lecturas necesarias para validacion y reporte del rollback.
*/
SET @sql = N'
GRANT SELECT ON OBJECT::dbo.AAA_TIPODOCUMENTO TO ' + QUOTENAME(@AppUser) + N';
GRANT SELECT ON OBJECT::dbo.EMPAQUE_DETALLE TO ' + QUOTENAME(@AppUser) + N';
GRANT SELECT ON OBJECT::dbo.SPE_DESPATCH TO ' + QUOTENAME(@AppUser) + N';
GRANT SELECT ON OBJECT::dbo.SPE_DESPATCH_ITEM TO ' + QUOTENAME(@AppUser) + N';
GRANT SELECT ON OBJECT::dbo.SPE_DESPATCH_RESPONSE TO ' + QUOTENAME(@AppUser) + N';
';
EXEC sp_executesql @sql;

/*
  Escrituras acotadas que se ejecutaran dentro de transaccion:
  - Subir correlativo oficial de la serie declarada.
  - Vincular items de empaque a la GRE emitida.
*/
SET @sql = N'
GRANT UPDATE ON OBJECT::dbo.AAA_TIPODOCUMENTO (CORRELATIVO) TO ' + QUOTENAME(@AppUser) + N';
GRANT UPDATE ON OBJECT::dbo.EMPAQUE_DETALLE (SERIENUMEROGUIAREMISION) TO ' + QUOTENAME(@AppUser) + N';
GRANT UPDATE ON OBJECT::dbo.EMPAQUE_DETALLE (ORDENGUIA) TO ' + QUOTENAME(@AppUser) + N';
';
EXEC sp_executesql @sql;

/*
  Verificacion.
*/
SELECT
  N'dbo.AAA_TIPODOCUMENTO' AS objeto,
  HAS_PERMS_BY_NAME(N'dbo.AAA_TIPODOCUMENTO', N'OBJECT', N'SELECT') AS puedeLeer,
  HAS_PERMS_BY_NAME(N'dbo.AAA_TIPODOCUMENTO', N'OBJECT', N'UPDATE') AS puedeActualizarTablaCompleta;

SELECT
  N'dbo.EMPAQUE_DETALLE' AS objeto,
  HAS_PERMS_BY_NAME(N'dbo.EMPAQUE_DETALLE', N'OBJECT', N'SELECT') AS puedeLeer,
  HAS_PERMS_BY_NAME(N'dbo.EMPAQUE_DETALLE', N'OBJECT', N'UPDATE') AS puedeActualizarTablaCompleta;

SELECT
  OBJECT_NAME(major_id) AS objeto,
  COL_NAME(major_id, minor_id) AS columna,
  permission_name,
  state_desc
FROM sys.database_permissions
WHERE grantee_principal_id = USER_ID(@AppUser)
  AND class = 1
  AND (
    major_id = OBJECT_ID(N'dbo.AAA_TIPODOCUMENTO')
    OR major_id = OBJECT_ID(N'dbo.EMPAQUE_DETALLE')
  )
  AND permission_name = 'UPDATE'
ORDER BY objeto, columna;

SELECT
  o.name AS procedimiento,
  HAS_PERMS_BY_NAME(N'dbo.' + o.name, N'OBJECT', N'EXECUTE') AS puedeEjecutar
FROM sys.objects o
WHERE o.type = 'P'
  AND o.name IN (
    N'USP_CABECERAGUIA',
    N'USP_DETALLEGUIA',
    N'USP_ENVIOGUIA',
    N'SPI_GUIA_ELECTRONICA',
    N'SPI_DETALLE_GUIA_ELECTRONICA'
  )
ORDER BY o.name;
