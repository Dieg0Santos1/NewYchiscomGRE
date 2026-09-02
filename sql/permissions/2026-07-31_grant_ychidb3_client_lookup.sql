/*
  Permisos minimos para resolver destinatario/destino desde YCHIDB3.

  Objetivo:
  - Permitir que el sistema GRE Formularios Continuos resuelva el destinatario
    desde tbDocumentos.idClieProv -> tbClieProv.
  - Permitir lectura de direcciones del cliente en tbcliedireccion para la
    siguiente etapa de destinos.

  No otorga permisos de escritura.
*/

USE YCHIDB3;
GO

GRANT SELECT ON OBJECT::dbo.tbClieProv TO gre_app_test;
GO

GRANT SELECT ON OBJECT::dbo.tbcliedireccion TO gre_app_test;
GO
