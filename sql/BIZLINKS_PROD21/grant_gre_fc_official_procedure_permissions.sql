USE BIZLINKS_PROD21;
GO

/*
  Permisos minimos para la prueba tecnica controlada de formularios continuos.

  Ejecutar manualmente con un usuario DBA si se aprueba la siguiente prueba.
  Este script no concede permisos sobre EMPAQUE ni EMPAQUE_DETALLE.
  Este script no inserta, actualiza ni elimina datos.
*/

IF OBJECT_ID(N'dbo.USP_CabeceraGuia', N'P') IS NOT NULL
BEGIN
  GRANT EXECUTE ON OBJECT::dbo.USP_CabeceraGuia TO gre_app_test;
  GRANT VIEW DEFINITION ON OBJECT::dbo.USP_CabeceraGuia TO gre_app_test;
END;
GO

IF OBJECT_ID(N'dbo.USP_DetalleGuia', N'P') IS NOT NULL
BEGIN
  GRANT EXECUTE ON OBJECT::dbo.USP_DetalleGuia TO gre_app_test;
  GRANT VIEW DEFINITION ON OBJECT::dbo.USP_DetalleGuia TO gre_app_test;
END;
GO

IF OBJECT_ID(N'dbo.USP_DocRef', N'P') IS NOT NULL
BEGIN
  GRANT EXECUTE ON OBJECT::dbo.USP_DocRef TO gre_app_test;
  GRANT VIEW DEFINITION ON OBJECT::dbo.USP_DocRef TO gre_app_test;
END;
GO

IF OBJECT_ID(N'dbo.USP_EnvioGuia', N'P') IS NOT NULL
BEGIN
  GRANT EXECUTE ON OBJECT::dbo.USP_EnvioGuia TO gre_app_test;
  GRANT VIEW DEFINITION ON OBJECT::dbo.USP_EnvioGuia TO gre_app_test;
END;
GO

IF OBJECT_ID(N'dbo.USP_ENVIOGUIA', N'P') IS NOT NULL
BEGIN
  GRANT EXECUTE ON OBJECT::dbo.USP_ENVIOGUIA TO gre_app_test;
  GRANT VIEW DEFINITION ON OBJECT::dbo.USP_ENVIOGUIA TO gre_app_test;
END;
GO

IF OBJECT_ID(N'dbo.SPE_DESPATCH_AUXILIAR', N'U') IS NOT NULL
BEGIN
  GRANT SELECT ON OBJECT::dbo.SPE_DESPATCH_AUXILIAR TO gre_app_test;
END;
GO

IF OBJECT_ID(N'dbo.SPE_DESPATCH_DOCRELACIONADO', N'U') IS NOT NULL
BEGIN
  GRANT SELECT ON OBJECT::dbo.SPE_DESPATCH_DOCRELACIONADO TO gre_app_test;
END;
GO
