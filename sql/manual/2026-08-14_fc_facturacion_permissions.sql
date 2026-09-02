/*
  Permisos para habilitar facturacion electronica FC en modo controlado.
  Ejecutar con un usuario administrador de SQL Server.

  Este script no debe ejecutarse desde la app. Revisar por etapas.
*/

/* 1) Lectura necesaria para auditoria, reportes, estado SUNAT y PDF */
USE BIZLINKS_PROD21;
GO

GRANT SELECT ON OBJECT::dbo.SPE_EINVOICEHEADER TO [gre_app_test];
GRANT SELECT ON OBJECT::dbo.SPE_EINVOICEDETAIL TO [gre_app_test];
GRANT SELECT ON OBJECT::dbo.SPE_EINVOICE_REFERENCE TO [gre_app_test];
GRANT SELECT ON OBJECT::dbo.SPE_EINVOICE_RESPONSE TO [gre_app_test];
GRANT SELECT ON OBJECT::dbo.SPE_EINVOICEHEADER_ADD TO [gre_app_test];
GRANT SELECT ON OBJECT::dbo.AAA_GUIAFACTURADA TO [gre_app_test];
GO

USE YCHIDB3;
GO

GRANT SELECT ON OBJECT::dbo.tbGuiasFactura TO [gre_app_test];
GRANT SELECT ON OBJECT::dbo.TBTIPODOCU TO [gre_app_test];
GO

/* 2) Escritura solo para prueba controlada de declaracion FC */
USE BIZLINKS_PROD21;
GO

GRANT EXECUTE ON OBJECT::dbo.USP_CabeceraFE TO [gre_app_test];
GRANT EXECUTE ON OBJECT::dbo.USP_DetalleFE TO [gre_app_test];
GRANT EXECUTE ON OBJECT::dbo.USP_EnviaDocumentoFE TO [gre_app_test];

/* USP_EnviaDocumentoFE usa AAA_GUIAFACTURADA para referenciar la GRE.
   Si el SP no inserta esta tabla por si mismo, habilitar INSERT controlado: */
GRANT INSERT ON OBJECT::dbo.AAA_GUIAFACTURADA TO [gre_app_test];
GO

/* 3) Solo si se confirma que el sistema nuevo tambien debe registrar espejo en YCHIDB3 */
USE YCHIDB3;
GO

GRANT INSERT ON OBJECT::dbo.tbDocumentos TO [gre_app_test];
GRANT UPDATE ON OBJECT::dbo.TBTIPODOCU TO [gre_app_test];
GRANT INSERT ON OBJECT::dbo.tbDetFact TO [gre_app_test];
GRANT INSERT ON OBJECT::dbo.tbGuiasFactura TO [gre_app_test];
GO
