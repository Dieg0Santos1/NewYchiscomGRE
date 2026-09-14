USE BIZLINKS_PROD21;
GO

/*
  Permiso minimo para normalizar cabecera de Guia 2 / traslado publico antes de USP_EnvioGuia.

  Contexto:
  dbo.USP_CabeceraGuia limpia fechaInicioTraslado cuando modalidadTraslado = '01'.
  La aplicacion solo necesita completar columnas vacias en dbo.SPE_DESPATCH para la guia T002
  que acaba de preparar con los SP oficiales, antes de activar el envio.

  Ejecutar manualmente con un usuario DBA.
  No concede permisos amplios sobre la tabla.
*/

IF OBJECT_ID(N'dbo.SPE_DESPATCH', N'U') IS NOT NULL
BEGIN
  GRANT UPDATE (
    fechaInicioTraslado,
    fechaEntregaBienes,
    codigoPtollegada
  ) ON OBJECT::dbo.SPE_DESPATCH TO gre_app_test;
END;
GO
