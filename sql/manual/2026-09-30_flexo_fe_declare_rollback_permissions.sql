/*
  Permisos minimos para ensayar en ROLLBACK y luego habilitar declaracion
  de facturas Flexo FF03.

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
  Procedimientos oficiales FE usados por FF03.
*/
SET @sql = N'';

IF OBJECT_ID(N'dbo.USP_CabeceraFE', N'P') IS NOT NULL
  SET @sql += N'GRANT EXECUTE ON OBJECT::dbo.USP_CabeceraFE TO ' + QUOTENAME(@AppUser) + N';' + CHAR(10);

IF OBJECT_ID(N'dbo.USP_DetalleFE', N'P') IS NOT NULL
  SET @sql += N'GRANT EXECUTE ON OBJECT::dbo.USP_DetalleFE TO ' + QUOTENAME(@AppUser) + N';' + CHAR(10);

IF OBJECT_ID(N'dbo.USP_EnviaDocumentoFE', N'P') IS NOT NULL
  SET @sql += N'GRANT EXECUTE ON OBJECT::dbo.USP_EnviaDocumentoFE TO ' + QUOTENAME(@AppUser) + N';' + CHAR(10);

EXEC sp_executesql @sql;

/*
  Lecturas necesarias para validacion, rollback y reportes.
*/
SET @sql = N'
GRANT SELECT ON OBJECT::dbo.AAA_ADQUIRIENTE TO ' + QUOTENAME(@AppUser) + N';
GRANT SELECT ON OBJECT::dbo.AAA_GUIAFACTURADA TO ' + QUOTENAME(@AppUser) + N';
GRANT SELECT ON OBJECT::dbo.AAA_REGISTRO_CONTABLE TO ' + QUOTENAME(@AppUser) + N';
GRANT SELECT ON OBJECT::dbo.AAA_TIPODOCUMENTO TO ' + QUOTENAME(@AppUser) + N';
GRANT SELECT ON OBJECT::dbo.EMPAQUE_DETALLE TO ' + QUOTENAME(@AppUser) + N';
GRANT SELECT ON OBJECT::dbo.SPE_DESPATCH TO ' + QUOTENAME(@AppUser) + N';
GRANT SELECT ON OBJECT::dbo.SPE_DESPATCH_ITEM TO ' + QUOTENAME(@AppUser) + N';
GRANT SELECT ON OBJECT::dbo.SPE_DESPATCH_RESPONSE TO ' + QUOTENAME(@AppUser) + N';
GRANT SELECT ON OBJECT::dbo.SPE_EINVOICEHEADER TO ' + QUOTENAME(@AppUser) + N';
GRANT SELECT ON OBJECT::dbo.SPE_EINVOICEDETAIL TO ' + QUOTENAME(@AppUser) + N';
GRANT SELECT ON OBJECT::dbo.SPE_EINVOICEHEADER_ADD TO ' + QUOTENAME(@AppUser) + N';
GRANT SELECT ON OBJECT::dbo.SPE_EINVOICE_RESPONSE TO ' + QUOTENAME(@AppUser) + N';
GRANT SELECT ON OBJECT::dbo.SPE_ERROR_LOG TO ' + QUOTENAME(@AppUser) + N';
';
EXEC sp_executesql @sql;

/*
  Escrituras acotadas que se ejecutaran dentro de transaccion:
  - Relacion GRE-FE para que USP_EnviaDocumentoFE copie referencia 09.
  - Cuenta contable FF03.
  - Subir correlativo oficial de FF03.
  - Vincular items de empaque a la factura emitida.
*/
SET @sql = N'
GRANT INSERT ON OBJECT::dbo.AAA_GUIAFACTURADA TO ' + QUOTENAME(@AppUser) + N';
GRANT INSERT ON OBJECT::dbo.AAA_REGISTRO_CONTABLE TO ' + QUOTENAME(@AppUser) + N';
GRANT UPDATE ON OBJECT::dbo.AAA_TIPODOCUMENTO (CORRELATIVO) TO ' + QUOTENAME(@AppUser) + N';
GRANT UPDATE ON OBJECT::dbo.EMPAQUE_DETALLE (SERIENUMEROGUIAFACTURA) TO ' + QUOTENAME(@AppUser) + N';
GRANT UPDATE ON OBJECT::dbo.EMPAQUE_DETALLE (ORDENFACTURA) TO ' + QUOTENAME(@AppUser) + N';
';
EXEC sp_executesql @sql;

/*
  Verificacion.
*/
SELECT
  v.objeto,
  v.permiso,
  HAS_PERMS_BY_NAME(v.objeto, N'OBJECT', v.permiso) AS permitido
FROM (VALUES
  (N'dbo.USP_CabeceraFE', N'EXECUTE'),
  (N'dbo.USP_DetalleFE', N'EXECUTE'),
  (N'dbo.USP_EnviaDocumentoFE', N'EXECUTE'),
  (N'dbo.AAA_GUIAFACTURADA', N'SELECT'),
  (N'dbo.AAA_GUIAFACTURADA', N'INSERT'),
  (N'dbo.AAA_REGISTRO_CONTABLE', N'SELECT'),
  (N'dbo.AAA_REGISTRO_CONTABLE', N'INSERT'),
  (N'dbo.AAA_TIPODOCUMENTO', N'SELECT'),
  (N'dbo.EMPAQUE_DETALLE', N'SELECT'),
  (N'dbo.SPE_EINVOICEHEADER', N'SELECT'),
  (N'dbo.SPE_EINVOICEDETAIL', N'SELECT'),
  (N'dbo.SPE_EINVOICEHEADER_ADD', N'SELECT'),
  (N'dbo.SPE_EINVOICE_RESPONSE', N'SELECT')
) AS v(objeto, permiso)
ORDER BY v.objeto, v.permiso;

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
