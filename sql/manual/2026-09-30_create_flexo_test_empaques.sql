/*
  Crea dos empaques de prueba Flexo pendientes para ensayar GRE T003 desde el portal.

  IMPORTANTE:
  - Este script SI inserta datos en BIZLINKS_PROD21.dbo.EMPAQUE y dbo.EMPAQUE_DETALLE.
  - No reemplaza ni actualiza registros existentes.
  - Usa CODIGOEMPAQUE alto 990001/990002 para minimizar choque con operacion real.
  - Usa cliente oficial existente en AAA_ADQUIRIENTE/AAA_DESTINO:
      20100898242 - LABORATORIOS SMA.SAC
  - Los items quedan pendientes:
      SERIENUMEROGUIAREMISION = NULL
      SERIENUMEROGUIAFACTURA = NULL

  Recomendacion:
  - Ejecutar primero dejando @Commit = 0 para vista previa con ROLLBACK.
  - Si el resultado es correcto, cambiar @Commit = 1 y ejecutar.
*/

USE BIZLINKS_PROD21;
GO

SET XACT_ABORT ON;

DECLARE @Commit bit = 0; -- 0 = ROLLBACK / 1 = COMMIT

DECLARE @CodigoEmpaque1 int = 990001;
DECLARE @CodigoEmpaque2 int = 990002;
DECLARE @RucCliente nvarchar(50) = N'20100898242';
DECLARE @RazonSocial nvarchar(200) = N'LABORATORIOS SMA.SAC';
DECLARE @DireccionAdquiriente nvarchar(200) = N'Av. Luna Pizarro 1340, La Victoria';
DECLARE @UbigeoAdquiriente nvarchar(50) = N'15033';
DECLARE @DireccionDestino nvarchar(200) = N'CALLE RENE DESCARTES N° 391, URB. SANTA RAQUEL II ETAPA';
DECLARE @UbigeoDestino nvarchar(50) = N'150101';
DECLARE @OrdenCompra nvarchar(100) = N'FLEXO-PRUEBA-GRE';
DECLARE @Vendedor nvarchar(200) = N'PRUEBA PORTAL GRE';
DECLARE @FechaCreacion datetime = GETDATE();

BEGIN TRY
  BEGIN TRAN;

  IF NOT EXISTS (
    SELECT 1
    FROM dbo.AAA_ADQUIRIENTE
    WHERE NUMERODOCUMENTOADQUIRIENTE = @RucCliente
  )
  BEGIN
    THROW 51001, 'El cliente de prueba no existe en AAA_ADQUIRIENTE. No se inserta.', 1;
  END;

  IF NOT EXISTS (
    SELECT 1
    FROM dbo.AAA_DESTINO
    WHERE NUMERODOCUMENTOADQUIRIENTE = @RucCliente
      AND UBIGEODESTINO = @UbigeoDestino
  )
  BEGIN
    THROW 51002, 'El destino de prueba no existe en AAA_DESTINO. No se inserta.', 1;
  END;

  IF EXISTS (
    SELECT 1
    FROM dbo.EMPAQUE
    WHERE CODIGOEMPAQUE IN (@CodigoEmpaque1, @CodigoEmpaque2)
  )
  BEGIN
    THROW 51003, 'Ya existe alguno de los CODIGOEMPAQUE de prueba. Cambie los codigos antes de ejecutar.', 1;
  END;

  IF EXISTS (
    SELECT 1
    FROM dbo.EMPAQUE_DETALLE
    WHERE CODIGOEMPAQUE IN (@CodigoEmpaque1, @CodigoEmpaque2)
  )
  BEGIN
    THROW 51004, 'Ya existe detalle para alguno de los CODIGOEMPAQUE de prueba. Cambie los codigos antes de ejecutar.', 1;
  END;

  INSERT INTO dbo.EMPAQUE (
    CODIGOEMPAQUE,
    NUMERODOCUMENTOADQUIRIENTE,
    RAZONSOCIALADQUIRIENTE,
    DIRECCIONADQUIRIENTE,
    UBIGEOADQUIRIENTE,
    DIRECCIONPTOLLEGADA,
    UBIGEOPTOLLEGADA,
    ORDENCOMPRA,
    VENDEDOR,
    FECHACREACION,
    TICKETNUM
  )
  VALUES
  (
    @CodigoEmpaque1,
    @RucCliente,
    @RazonSocial,
    @DireccionAdquiriente,
    @UbigeoAdquiriente,
    @DireccionDestino,
    @UbigeoDestino,
    @OrdenCompra,
    @Vendedor,
    @FechaCreacion,
    'FLEXO990001'
  ),
  (
    @CodigoEmpaque2,
    @RucCliente,
    @RazonSocial,
    @DireccionAdquiriente,
    @UbigeoAdquiriente,
    @DireccionDestino,
    @UbigeoDestino,
    @OrdenCompra,
    @Vendedor,
    @FechaCreacion,
    'FLEXO990002'
  );

  INSERT INTO dbo.EMPAQUE_DETALLE (
    CODIGOEMPAQUE,
    CODIGOPRODUCTO,
    DESCRIPCION,
    CANTIDAD,
    UNIDADMEDIDA,
    MONEDA,
    TIPOCAMBIO,
    IMPORTEUNITARIOSINIMPUESTO,
    SERIENUMEROGUIAREMISION,
    SERIENUMEROGUIAFACTURA,
    ORDENGUIA,
    ORDENFACTURA
  )
  VALUES
  (
    @CodigoEmpaque1,
    N'FLEXO-PRUEBA-001',
    N'ETIQUETA ADHESIVA PRUEBA PORTAL GRE FLEXO Nro Lote: FLEXO990001',
    12000.000,
    N'1000',
    N'-100',
    NULL,
    10.00000,
    NULL,
    NULL,
    NULL,
    NULL
  ),
  (
    @CodigoEmpaque2,
    N'FLEXO-PRUEBA-002',
    N'TROQUEL PRUEBA PORTAL GRE FLEXO Nro Lote: FLEXO990002',
    1.000,
    N'NIU',
    N'-100',
    NULL,
    5.00000,
    NULL,
    NULL,
    NULL,
    NULL
  );

  SELECT
    'EMPAQUE_CREADO' AS fuente,
    e.*
  FROM dbo.EMPAQUE e
  WHERE e.CODIGOEMPAQUE IN (@CodigoEmpaque1, @CodigoEmpaque2)
  ORDER BY e.CODIGOEMPAQUE;

  SELECT
    'DETALLE_CREADO' AS fuente,
    d.*
  FROM dbo.EMPAQUE_DETALLE d
  WHERE d.CODIGOEMPAQUE IN (@CodigoEmpaque1, @CodigoEmpaque2)
  ORDER BY d.CODIGOEMPAQUE, d.CODIGOPRODUCTO;

  IF @Commit = 1
  BEGIN
    COMMIT;
    SELECT 'COMMIT aplicado. Empaques de prueba creados.' AS resultado;
  END
  ELSE
  BEGIN
    ROLLBACK;
    SELECT 'ROLLBACK aplicado. Cambie @Commit = 1 para crear los empaques.' AS resultado;
  END;
END TRY
BEGIN CATCH
  IF @@TRANCOUNT > 0 ROLLBACK;
  THROW;
END CATCH;
