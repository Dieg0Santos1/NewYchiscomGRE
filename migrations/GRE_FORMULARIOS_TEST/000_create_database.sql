/*
  Base propia para control y trazabilidad de GRE de formularios continuos.
  Revisar y ejecutar manualmente en SQL Server. No ejecutar contra YCHIDB3 ni BIZLINKS_PROD21.
*/

IF DB_ID(N'GRE_FORMULARIOS_TEST') IS NULL
BEGIN
    CREATE DATABASE GRE_FORMULARIOS_TEST;
END;
GO
