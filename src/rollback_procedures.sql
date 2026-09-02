-- SCRIPT DE RESTAURACIÓN (ROLLBACK / DESHACER CAMBIOS)
-- Retorna los procedimientos almacenados y vistas a su estado original (una sola fila)

-- 1. RESTAURAR PROCEDIMIENTOS ALMACENADOS
GO
ALTER PROCEDURE [dbo].[RPT_LETRA_Y]
@NUMERO VARCHAR(10)
AS
BEGIN
    SET NOCOUNT ON;
    SELECT * FROM dbo.VW_LETRA_Y WHERE Numero = @NUMERO
END
GO

ALTER PROCEDURE [dbo].[RPT_LETRA_P]
@NUMERO VARCHAR(10)
AS
BEGIN
    SET NOCOUNT ON;
    SELECT * FROM dbo.VW_LETRA_P WHERE Numero = @NUMERO
END
GO

ALTER PROCEDURE [dbo].[RPT_LETRA]
@NUMERO VARCHAR(10)
AS
BEGIN
    SET NOCOUNT ON;
    SELECT * FROM dbo.VW_LETRA WHERE Numero = @NUMERO
END
GO

-- 2. RESTAURAR VISTAS DIRECTAS
ALTER VIEW dbo.VW_LETRA_Y
AS
SELECT     'LET' + dbo.tbDocumentos.NumeDocu AS Numero, 'LIMA' AS LUGAR, dbo.tbDocumentos.FechaEmision AS Fecha_Giro, 
                      dbo.tbDocumentos.FechaVencimiento AS Fecha_vencimiento, CASE tbdocumentos.tica WHEN '1.000' THEN 'S/.' ELSE '$' END AS MONEDA, 
                      dbo.tbDocumentos.Total AS Importe, dbo.tbDocumentos.Observaciones AS Monto, dbo.tbDocumentos.DescClieProv AS Cliente, 
                      dbo.tbClieProv.Direccion, dbo.tbDistrito.nombre AS Departamento, dbo.tbClieProv.RUC, dbo.tbClieProv.telefono1 AS Telefono
FROM         dbo.tbDocumentos INNER JOIN
                      dbo.tbClieProv ON dbo.tbDocumentos.idClieProv = dbo.tbClieProv.idClieProv INNER JOIN
                      dbo.tbDistrito ON dbo.tbDistrito.idDistrito = dbo.tbClieProv.IdDistrito
WHERE     (dbo.tbDocumentos.idTipoDocu = '20') AND (dbo.tbDocumentos.origen = 'Y')
GO

ALTER VIEW dbo.VW_LETRA_P
AS
SELECT     'LET' + dbo.tbDocumentos.NumeDocu AS Numero, 'LIMA' AS LUGAR, dbo.tbDocumentos.FechaEmision AS Fecha_Giro, 
                      dbo.tbDocumentos.FechaVencimiento AS Fecha_vencimiento, CASE tbdocumentos.tica WHEN '1.000' THEN 'S/.' ELSE '$' END AS MONEDA, 
                      dbo.tbDocumentos.Total AS Importe, dbo.tbDocumentos.Observaciones AS Monto, dbo.tbDocumentos.DescClieProv AS Cliente, 
                      dbo.tbClieProv.Direccion, dbo.tbDistrito.nombre AS Departamento, dbo.tbClieProv.RUC, dbo.tbClieProv.telefono1 AS Telefono
FROM         dbo.tbDocumentos INNER JOIN
                      dbo.tbClieProv ON dbo.tbDocumentos.idClieProv = dbo.tbClieProv.idClieProv INNER JOIN
                      dbo.tbDistrito ON dbo.tbDistrito.idDistrito = dbo.tbClieProv.IdDistrito
WHERE     (dbo.tbDocumentos.idTipoDocu = '20') AND (dbo.tbDocumentos.origen = 'P')
GO

ALTER VIEW dbo.VW_LETRA
AS
SELECT     'LET' + dbo.tbDocumentos.NumeDocu AS Numero, 'LIMA' AS LUGAR, dbo.tbDocumentos.FechaEmision AS Fecha_Giro, 
                      dbo.tbDocumentos.FechaVencimiento AS Fecha_vencimiento, CASE tbdocumentos.tica WHEN '1.000' THEN 'S/' ELSE '$' END AS MONEDA, 
                      dbo.tbDocumentos.Total AS Importe, dbo.tbDocumentos.Observaciones AS Monto, dbo.tbDocumentos.DescClieProv AS Cliente, dbo.tbClieProv.Direccion, 
                      dbo.tbDistrito.nombre AS Departamento, dbo.tbClieProv.RUC, dbo.tbClieProv.telefono1 AS Telefono
FROM         dbo.tbDocumentos INNER JOIN
                      dbo.tbClieProv ON dbo.tbDocumentos.idClieProv = dbo.tbClieProv.idClieProv INNER JOIN
                      dbo.tbDistrito ON dbo.tbDistrito.idDistrito = dbo.tbClieProv.IdDistrito
WHERE     (dbo.tbDocumentos.idTipoDocu = '20')
GO
