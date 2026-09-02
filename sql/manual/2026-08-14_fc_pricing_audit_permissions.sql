/*
  Permisos SOLO LECTURA para completar auditoria de precio sugerido en facturacion FC.
  Ejecutar en YCHIDB3 con un usuario administrador.
  No otorga INSERT/UPDATE/DELETE/ALTER.
*/

USE YCHIDB3;
GO

GRANT SELECT ON OBJECT::dbo.tbCotizador TO [gre_app_test];
GRANT SELECT ON OBJECT::dbo.tbDetSoliCant TO [gre_app_test];
GRANT SELECT ON OBJECT::dbo.tbDetOrdenVenta TO [gre_app_test];
GRANT SELECT ON OBJECT::dbo.tbOrdenVenta TO [gre_app_test];
GRANT SELECT ON OBJECT::dbo.tbDetOTcant TO [gre_app_test];
GRANT SELECT ON OBJECT::dbo.tbDetGuias TO [gre_app_test];
GRANT SELECT ON OBJECT::dbo.tbGuias TO [gre_app_test];
GO
