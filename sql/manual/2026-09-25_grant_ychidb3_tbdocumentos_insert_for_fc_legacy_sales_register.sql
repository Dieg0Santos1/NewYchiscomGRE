/*
  Restaura el permiso minimo para que el sistema nuevo pueda reflejar
  las facturas FF01 en YCHIDB3.dbo.tbDocumentos.

  Ejecutar con usuario administrador de SQL Server.
  No modifica facturas ni inserta documentos; solo concede permiso INSERT.
*/

USE YCHIDB3;
GO

GRANT INSERT ON OBJECT::dbo.tbDocumentos TO [gre_app_test];
GO

SELECT SUSER_SNAME() AS loginEjecutor,
  HAS_PERMS_BY_NAME('dbo.tbDocumentos', 'OBJECT', 'INSERT') AS ejecutorPuedeInsertar;

EXECUTE AS USER = 'gre_app_test';

SELECT USER_NAME() AS usuarioValidado,
  HAS_PERMS_BY_NAME('dbo.tbDocumentos', 'OBJECT', 'SELECT') AS puedeSelect,
  HAS_PERMS_BY_NAME('dbo.tbDocumentos', 'OBJECT', 'INSERT') AS puedeInsert,
  HAS_PERMS_BY_NAME('dbo.tbDocumentos', 'OBJECT', 'UPDATE') AS puedeUpdate;

REVERT;
