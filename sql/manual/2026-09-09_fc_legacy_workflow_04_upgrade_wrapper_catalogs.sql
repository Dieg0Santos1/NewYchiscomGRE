/*
  YCHIDB3 - actualizacion controlada del wrapper de guia interna FC.

  Objetivo:
  - Dejar el flujo listo para prueba desde el portal sin depender de una
    bandera de entorno.
  - Permitir que la guia interna use vendedor, motivo, cantidad y U.M.
    seleccionados desde el portal.

  Este script no inserta, actualiza ni elimina datos operativos. Solo cambia
  la definicion del procedimiento wrapper.
*/
USE [YCHIDB3];
GO

IF OBJECT_ID(N'dbo.GRE_WEB_CREAR_GUIA_INTERNA_FC', N'P') IS NULL
BEGIN
  THROW 50001, 'No existe dbo.GRE_WEB_CREAR_GUIA_INTERNA_FC. Instale primero 2026-09-02_fc_legacy_workflow_wrappers.sql.', 1;
END;
GO

ALTER PROCEDURE dbo.GRE_WEB_CREAR_GUIA_INTERNA_FC
  @serie varchar(3),
  @recepcionesXml xml,
  @direccion varchar(150),
  @idDistrito int,
  @ordenCompra varchar(50) = '',
  @observaciones varchar(50) = '',
  @formaPago varchar(80) = '',
  @idEmpleado int = NULL,
  @idMotivoTraslado int = 0,
  @detallesXml xml = NULL
AS
BEGIN
  SET NOCOUNT ON;
  SET XACT_ABORT ON;

  DECLARE @ids TABLE (idRecepcionOT int NOT NULL PRIMARY KEY);
  DECLARE @detalles TABLE (
    idRecepcionOT int NOT NULL PRIMARY KEY,
    descripcion varchar(250) NULL,
    cantidad decimal(18,2) NULL,
    unidad varchar(50) NULL
  );

  INSERT @ids (idRecepcionOT)
  SELECT n.value('(text())[1]', 'int')
  FROM @recepcionesXml.nodes('/ids/id') AS x(n);

  IF @detallesXml IS NOT NULL
  BEGIN
    INSERT @detalles (idRecepcionOT, descripcion, cantidad, unidad)
    SELECT
      n.value('@idRecepcionOT', 'int'),
      n.value('(descripcion/text())[1]', 'varchar(250)'),
      n.value('(cantidad/text())[1]', 'decimal(18,2)'),
      n.value('(unidad/text())[1]', 'varchar(50)')
    FROM @detallesXml.nodes('/detalles/detalle') AS x(n)
    WHERE n.value('@idRecepcionOT', 'int') > 0;
  END

  DECLARE @cantidadIds int = (SELECT COUNT(*) FROM @ids),
          @cantidadValidas int,
          @cantidadClientes int,
          @idCliente int,
          @idEmpleadoDocumento int,
          @primeraRecepcion int,
          @idDocumento int = 0,
          @idGuia int = 0,
          @numeroDocumento varchar(50) = '',
          @lockResult int,
          @lockResource nvarchar(255),
          @idRecepcion int,
          @cantidad decimal(18,2),
          @unidad varchar(50);

  IF @serie NOT IN ('001', '003')
  BEGIN
    RAISERROR('Serie interna invalida.', 16, 1);
    RETURN;
  END
  IF @cantidadIds = 0
  BEGIN
    RAISERROR('Debe incluir al menos una recepcion.', 16, 1);
    RETURN;
  END
  IF EXISTS (SELECT 1 FROM @detalles WHERE cantidad <= 0 OR NULLIF(LTRIM(RTRIM(unidad)), '') IS NULL)
  BEGIN
    RAISERROR('Cada detalle debe tener cantidad mayor que cero y unidad.', 16, 1);
    RETURN;
  END
  IF EXISTS (SELECT 1 FROM @detalles d WHERE NOT EXISTS (SELECT 1 FROM @ids i WHERE i.idRecepcionOT = d.idRecepcionOT))
  BEGIN
    RAISERROR('El detalle enviado no corresponde a las recepciones seleccionadas.', 16, 1);
    RETURN;
  END
  IF NULLIF(LTRIM(RTRIM(@direccion)), '') IS NULL
  BEGIN
    RAISERROR('La direccion es obligatoria.', 16, 1);
    RETURN;
  END
  IF @idDistrito <= 0
  BEGIN
    RAISERROR('El distrito es invalido.', 16, 1);
    RETURN;
  END

  BEGIN TRY
    BEGIN TRANSACTION;

    SET @lockResource = 'GRE_WEB_GUIA_INTERNA_FC_' + @serie;

    EXEC @lockResult = sys.sp_getapplock
      @Resource = @lockResource,
      @LockMode = 'Exclusive',
      @LockOwner = 'Transaction',
      @LockTimeout = 15000;
    IF @lockResult < 0 RAISERROR('No se pudo reservar el correlativo de la guia.', 16, 1);

    SELECT
      @cantidadValidas = COUNT(*),
      @cantidadClientes = COUNT(DISTINCT solicitud.idClieProv),
      @idCliente = MIN(solicitud.idClieProv),
      @idEmpleadoDocumento = COALESCE(@idEmpleado, MIN(ISNULL(solicitud.idEmpleado, 1))),
      @primeraRecepcion = MIN(r.idRecepcionOT)
    FROM @ids i
    INNER JOIN dbo.tbRecepcionOT r WITH (UPDLOCK, HOLDLOCK) ON r.idRecepcionOT = i.idRecepcionOT
    INNER JOIN dbo.tbOrdenTrabajo ot ON ot.idOrdenTrabajo = r.idOT
    INNER JOIN dbo.tbDetOrdenVenta dov ON dov.idDetOrdenVenta = ot.idDetOrdenVenta
    INNER JOIN dbo.tbOrdenVenta ov ON ov.idOrdenVenta = dov.idOrdenVenta
    INNER JOIN dbo.tbDetSoliProf dsp ON dsp.idDetSoliProf = ov.idDetSoliProf
    INNER JOIN dbo.tbDocumentos solicitud ON solicitud.idDocumento = dsp.idDocumento
    WHERE r.EstadoOT = 'C' AND r.EstadoGuia = 'N';

    IF @cantidadValidas <> @cantidadIds
      RAISERROR('Una o mas recepciones no existen, no estan aceptadas o ya fueron guiadas.', 16, 1);
    IF @cantidadClientes <> 1
      RAISERROR('Todas las recepciones deben pertenecer al mismo cliente.', 16, 1);

    IF EXISTS (
      SELECT 1
      FROM @ids i
      WHERE NOT EXISTS (
        SELECT 1 FROM dbo.tbDetGuias dg
        WHERE dg.idRecepcionOT = i.idRecepcionOT AND ISNULL(dg.idDocumentos, 0) = 0
      )
    ) RAISERROR('Falta el movimiento de ingreso de una recepcion; no se emitira la guia.', 16, 1);

    IF @serie = '001'
      EXEC dbo.SPI_GUIA_REMISION44_YP
        @IDRECEPCIONOT = @primeraRecepcion,
        @IDMOTIVOTRASLADO = @idMotivoTraslado,
        @Observaciones = @observaciones,
        @IDDOCUMENTO = @idDocumento OUTPUT,
        @IDGUIA = @idGuia OUTPUT,
        @NumeDocu = @numeroDocumento OUTPUT,
        @Direccion = @direccion,
        @ordenc = @ordenCompra,
        @idclie = @idCliente,
        @distrito = @idDistrito,
        @idempleado = @idEmpleadoDocumento,
        @origen = 'Y';
    ELSE
      EXEC dbo.SPI_GUIA_REMISION_Y_003
        @IDRECEPCIONOT = @primeraRecepcion,
        @IDMOTIVOTRASLADO = @idMotivoTraslado,
        @Observaciones = @observaciones,
        @IDDOCUMENTO = @idDocumento OUTPUT,
        @IDGUIA = @idGuia OUTPUT,
        @NumeDocu = @numeroDocumento OUTPUT,
        @Direccion = @direccion,
        @ordenc = @ordenCompra,
        @idclie = @idCliente,
        @distrito = @idDistrito,
        @idempleado = @idEmpleadoDocumento,
        @origen = 'Y';

    DECLARE recepciones CURSOR LOCAL FAST_FORWARD FOR
      SELECT
        r.idRecepcionOT,
        COALESCE(d.cantidad, r.Cantidad) AS cantidad,
        COALESCE(NULLIF(LTRIM(RTRIM(d.unidad)), ''), u.Valor) AS unidad
      FROM @ids i
      INNER JOIN dbo.tbRecepcionOT r ON r.idRecepcionOT = i.idRecepcionOT
      INNER JOIN dbo.tbUnidades u ON u.idUnidad = r.IDUNIDAD
      LEFT JOIN @detalles d ON d.idRecepcionOT = r.idRecepcionOT
      ORDER BY r.idRecepcionOT;

    OPEN recepciones;
    FETCH NEXT FROM recepciones INTO @idRecepcion, @cantidad, @unidad;
    WHILE @@FETCH_STATUS = 0
    BEGIN
      IF @serie = '001'
        EXEC dbo.SPI_DETGUIA_REMISION
          @idGuia = @idGuia,
          @idRecepcionOT = @idRecepcion,
          @Observaciones = @observaciones,
          @idDocumentos = @idDocumento,
          @idprodu = 0,
          @canti = @cantidad,
          @unid = @unidad;
      ELSE
        EXEC dbo.SPI_DETGUIA_REMISION_Y_003
          @idGuia = @idGuia,
          @idRecepcionOT = @idRecepcion,
          @Observaciones = @observaciones,
          @idDocumentos = @idDocumento,
          @idprodu = 0,
          @canti = @cantidad,
          @unid = @unidad;

      FETCH NEXT FROM recepciones INTO @idRecepcion, @cantidad, @unidad;
    END
    CLOSE recepciones;
    DEALLOCATE recepciones;

    COMMIT TRANSACTION;

    SELECT @idDocumento AS idDocumento,
           @idGuia AS idGuia,
           @serie AS serie,
           @numeroDocumento AS numero,
           @serie + '-' + @numeroDocumento AS serieNumero,
           @cantidadIds AS recepcionesIncluidas,
           @idEmpleadoDocumento AS idEmpleado,
           @idMotivoTraslado AS idMotivoTraslado,
           @formaPago AS formaPago;
  END TRY
  BEGIN CATCH
    IF CURSOR_STATUS('local', 'recepciones') >= 0 CLOSE recepciones;
    IF CURSOR_STATUS('local', 'recepciones') > -3 DEALLOCATE recepciones;
    IF XACT_STATE() <> 0 ROLLBACK TRANSACTION;
    DECLARE @error nvarchar(2048) = ERROR_MESSAGE();
    RAISERROR('%s', 16, 1, @error);
  END CATCH
END;
GO
