/*
  Permisos read-only para auditoria e integracion de catalogos Flexo.

  Base objetivo: BIZLINKS_PROD21
  Usuario sugerido: gre_app_test

  Importante:
  - No crea, reemplaza ni modifica tablas/procedimientos.
  - No concede INSERT/UPDATE/DELETE/ALTER.
  - No habilita declaracion GRE/FE ni baja/NCE.
  - Las tablas siguen alimentando a los sistemas actuales; este script solo
    permite lectura desde el portal.

  Ajustar @AppUser si el usuario de aplicacion no es gre_app_test.
*/

USE BIZLINKS_PROD21;
GO

DECLARE @AppUser sysname = N'gre_app_test';
DECLARE @sql nvarchar(max);

IF DATABASE_PRINCIPAL_ID(@AppUser) IS NULL
BEGIN
    RAISERROR('El usuario [%s] no existe en BIZLINKS_PROD21.', 16, 1, @AppUser);
    RETURN;
END;

/*
  Catalogos oficiales Flexo requeridos por el portal.
  Ya existe SELECT sobre AAA_CHOFER/EMPAQUE/EMPAQUE_DETALLE/AAA_GUIAFACTURADA
  en algunos ambientes; repetir GRANT SELECT es idempotente.
*/
SET @sql = N'
GRANT SELECT ON OBJECT::dbo.AAA_ADQUIRIENTE TO ' + QUOTENAME(@AppUser) + N';
GRANT SELECT ON OBJECT::dbo.AAA_CHOFER TO ' + QUOTENAME(@AppUser) + N';
GRANT SELECT ON OBJECT::dbo.AAA_CONTABLE TO ' + QUOTENAME(@AppUser) + N';
GRANT SELECT ON OBJECT::dbo.AAA_DESTINO TO ' + QUOTENAME(@AppUser) + N';
GRANT SELECT ON OBJECT::dbo.AAA_DETRACCION TO ' + QUOTENAME(@AppUser) + N';
GRANT SELECT ON OBJECT::dbo.AAA_EMPRESA TO ' + QUOTENAME(@AppUser) + N';
GRANT SELECT ON OBJECT::dbo.AAA_GUIAFACTURADA TO ' + QUOTENAME(@AppUser) + N';
GRANT SELECT ON OBJECT::dbo.AAA_ORIGEN TO ' + QUOTENAME(@AppUser) + N';
GRANT SELECT ON OBJECT::dbo.AAA_REGISTRO_CONTABLE TO ' + QUOTENAME(@AppUser) + N';
GRANT SELECT ON OBJECT::dbo.AAA_TIPODOCUMENTO TO ' + QUOTENAME(@AppUser) + N';
GRANT SELECT ON OBJECT::dbo.AAA_TRANSPORTISTA TO ' + QUOTENAME(@AppUser) + N';
GRANT SELECT ON OBJECT::dbo.MOTIVOS TO ' + QUOTENAME(@AppUser) + N';
';
EXEC sys.sp_executesql @sql;
GO

/*
  Fuentes y tablas SPE necesarias para auditoria/reportes.
  Solo lectura: no permite insertar documentos ni cambiar respuestas.
*/
DECLARE @AppUser sysname = N'gre_app_test';
DECLARE @sql nvarchar(max);

SET @sql = N'
GRANT SELECT ON OBJECT::dbo.EMPAQUE TO ' + QUOTENAME(@AppUser) + N';
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
EXEC sys.sp_executesql @sql;
GO

/*
  Opcional pero recomendado para auditoria tecnica:
  permite inspeccionar definiciones de SP/vistas oficiales sin ejecutar cambios.
*/
DECLARE @AppUser sysname = N'gre_app_test';
DECLARE @sql nvarchar(max);

SET @sql = N'
GRANT VIEW DEFINITION ON OBJECT::dbo.SPI_GUIA_ELECTRONICA TO ' + QUOTENAME(@AppUser) + N';
GRANT VIEW DEFINITION ON OBJECT::dbo.SPI_DETALLE_GUIA_ELECTRONICA TO ' + QUOTENAME(@AppUser) + N';
GRANT VIEW DEFINITION ON OBJECT::dbo.USP_CABECERAGUIA TO ' + QUOTENAME(@AppUser) + N';
GRANT VIEW DEFINITION ON OBJECT::dbo.USP_DETALLEGUIA TO ' + QUOTENAME(@AppUser) + N';
GRANT VIEW DEFINITION ON OBJECT::dbo.USP_ENVIOGUIA TO ' + QUOTENAME(@AppUser) + N';
GRANT VIEW DEFINITION ON OBJECT::dbo.SPI_FACTURA_ELECTRONICA TO ' + QUOTENAME(@AppUser) + N';
GRANT VIEW DEFINITION ON OBJECT::dbo.SPI_DETALLE_FACTURA_ELECTRONICA TO ' + QUOTENAME(@AppUser) + N';
GRANT VIEW DEFINITION ON OBJECT::dbo.USP_EnviaDocumentoFE TO ' + QUOTENAME(@AppUser) + N';
';
EXEC sys.sp_executesql @sql;
GO

/*
  Verificacion read-only de permisos directos concedidos.
  Nota: para validar permisos efectivos, conectarse con el usuario de la app
  y ejecutar HAS_PERMS_BY_NAME/SELECT reales desde esa sesion.
*/
DECLARE @AppUser sysname = N'gre_app_test';

SELECT
    USER_NAME(dp.grantee_principal_id) AS usuario,
    v.objectName,
    MAX(CASE WHEN dp.permission_name = 'SELECT' AND dp.state_desc IN ('GRANT', 'GRANT_WITH_GRANT_OPTION') THEN 1 ELSE 0 END) AS directSelectGrant,
    MAX(CASE WHEN dp.permission_name = 'INSERT' AND dp.state_desc LIKE 'GRANT%' THEN 1 ELSE 0 END) AS directInsertGrant,
    MAX(CASE WHEN dp.permission_name = 'UPDATE' AND dp.state_desc LIKE 'GRANT%' THEN 1 ELSE 0 END) AS directUpdateGrant,
    MAX(CASE WHEN dp.permission_name = 'DELETE' AND dp.state_desc LIKE 'GRANT%' THEN 1 ELSE 0 END) AS directDeleteGrant,
    MAX(CASE WHEN dp.permission_name = 'ALTER' AND dp.state_desc LIKE 'GRANT%' THEN 1 ELSE 0 END) AS directAlterGrant
FROM (VALUES
    ('dbo.AAA_ADQUIRIENTE'),
    ('dbo.AAA_CHOFER'),
    ('dbo.AAA_CONTABLE'),
    ('dbo.AAA_DESTINO'),
    ('dbo.AAA_DETRACCION'),
    ('dbo.AAA_EMPRESA'),
    ('dbo.AAA_GUIAFACTURADA'),
    ('dbo.AAA_ORIGEN'),
    ('dbo.AAA_REGISTRO_CONTABLE'),
    ('dbo.AAA_TIPODOCUMENTO'),
    ('dbo.AAA_TRANSPORTISTA'),
    ('dbo.MOTIVOS'),
    ('dbo.EMPAQUE'),
    ('dbo.EMPAQUE_DETALLE'),
    ('dbo.SPE_DESPATCH'),
    ('dbo.SPE_DESPATCH_ITEM'),
    ('dbo.SPE_DESPATCH_RESPONSE'),
    ('dbo.SPE_EINVOICEHEADER'),
    ('dbo.SPE_EINVOICEDETAIL'),
    ('dbo.SPE_EINVOICEHEADER_ADD'),
    ('dbo.SPE_EINVOICE_RESPONSE'),
    ('dbo.SPE_ERROR_LOG')
) v(objectName)
JOIN sys.objects o
  ON o.object_id = OBJECT_ID(v.objectName)
JOIN sys.database_permissions dp
  ON dp.major_id = o.object_id
 AND dp.class_desc = 'OBJECT_OR_COLUMN'
 AND dp.grantee_principal_id = DATABASE_PRINCIPAL_ID(@AppUser)
GROUP BY USER_NAME(dp.grantee_principal_id), v.objectName
ORDER BY v.objectName;
GO
