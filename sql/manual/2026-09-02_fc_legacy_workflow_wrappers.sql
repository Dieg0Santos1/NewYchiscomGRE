/*
  YCHIDB3 - wrappers controlados para el flujo FC legacy.

  IMPORTANTE:
  - Este archivo no es una migracion automatica. Revisar y ejecutar manualmente en YCHIDB3.
  - La aplicacion mantiene FC_LEGACY_WRITE_ENABLED=false hasta una prueba controlada.
  - Este archivo solo instala los wrappers. No concede permisos ni ejecuta el flujo.
  - Si encuentra un wrapper con el mismo nombre, CREATE falla y no lo reemplaza.
*/
USE [YCHIDB3];
GO

IF OBJECT_ID(N'dbo.GRE_WEB_CREAR_PREGUIA_FC', N'P') IS NOT NULL
  RAISERROR('GRE_WEB_CREAR_PREGUIA_FC ya existe. Instalacion detenida para no reemplazarlo.', 16, 1);
GO
CREATE PROCEDURE dbo.GRE_WEB_CREAR_PREGUIA_FC
  @numeroOt varchar(11),
  @cantidad decimal(18,2),
  @del varchar(12) = '',
  @al varchar(12) = ''
AS
BEGIN
  SET NOCOUNT ON;
  SET XACT_ABORT ON;

  DECLARE @idOt int,
          @estadoGuia char(1),
          @cantidadOt decimal(18,2),
          @cantidadAceptada decimal(18,2),
          @idRecepcionOt int,
          @lockResult int,
          @lockResource nvarchar(255);

  IF @cantidad <= 0
  BEGIN
    RAISERROR('La cantidad debe ser mayor que cero.', 16, 1);
    RETURN;
  END

  BEGIN TRY
    BEGIN TRANSACTION;

    SET @lockResource = 'GRE_WEB_PREGUIA_FC_' + @numeroOt;

    EXEC @lockResult = sys.sp_getapplock
      @Resource = @lockResource,
      @LockMode = 'Exclusive',
      @LockOwner = 'Transaction',
      @LockTimeout = 10000;
    IF @lockResult < 0 RAISERROR('No se pudo bloquear la OT para crear la pre-guia.', 16, 1);

    SELECT
      @idOt = ot.idOrdenTrabajo,
      @estadoGuia = ot.EstGuia,
      @cantidadOt = dov.Cantidad
    FROM dbo.tbOrdenTrabajo ot WITH (UPDLOCK, HOLDLOCK)
    INNER JOIN dbo.tbDetOrdenVenta dov ON dov.idDetOrdenVenta = ot.idDetOrdenVenta
    WHERE ot.Numero = @numeroOt;

    IF @idOt IS NULL RAISERROR('La OT no existe.', 16, 1);
    IF ISNULL(@estadoGuia, 'N') NOT IN ('N', 'M')
      RAISERROR('La OT no esta disponible para una nueva pre-guia.', 16, 1);

    SELECT @cantidadAceptada = ISNULL(SUM(CASE WHEN EstadoOT = 'C' THEN Cantidad ELSE 0 END), 0)
    FROM dbo.tbRecepcionOT WITH (UPDLOCK, HOLDLOCK)
    WHERE idOT = @idOt;

    -- El legado admite una demasia maxima de 0.01 observada en cierres historicos.
    IF @cantidadAceptada + @cantidad > @cantidadOt + 0.01
      RAISERROR('La cantidad excede el saldo de la OT.', 16, 1);

    INSERT dbo.tbRecepcionOT (idOT, Cantidad, IDUNIDAD, Del, Al)
    VALUES (@idOt, @cantidad, 10, @del, @al);

    SET @idRecepcionOt = CONVERT(int, SCOPE_IDENTITY());

    UPDATE dbo.tbOrdenTrabajo
    SET EstGuia = 'I'
    WHERE idOrdenTrabajo = @idOt;

    COMMIT TRANSACTION;

    SELECT @idRecepcionOt AS idRecepcionOT,
           @idOt AS idOrdenTrabajo,
           @numeroOt AS numeroOt,
           'I' AS estadoOt,
           'N' AS estadoGuia;
  END TRY
  BEGIN CATCH
    IF XACT_STATE() <> 0 ROLLBACK TRANSACTION;
    DECLARE @error nvarchar(2048) = ERROR_MESSAGE();
    RAISERROR('%s', 16, 1, @error);
  END CATCH
END;
GO

IF OBJECT_ID(N'dbo.GRE_WEB_ACEPTAR_PREGUIA_FC', N'P') IS NOT NULL
  RAISERROR('GRE_WEB_ACEPTAR_PREGUIA_FC ya existe. Instalacion detenida para no reemplazarlo.', 16, 1);
GO
CREATE PROCEDURE dbo.GRE_WEB_ACEPTAR_PREGUIA_FC
  @idRecepcionOT int
AS
BEGIN
  SET NOCOUNT ON;
  SET XACT_ABORT ON;

  DECLARE @idOt int,
          @cantidad decimal(18,2),
          @del varchar(12),
          @al varchar(12),
          @estadoOt char(1),
          @estadoGuia char(1),
          @lockResult int,
          @lockResource nvarchar(255);

  BEGIN TRY
    BEGIN TRANSACTION;

    SET @lockResource = 'GRE_WEB_RECEPCION_FC_' + CONVERT(varchar(20), @idRecepcionOT);

    EXEC @lockResult = sys.sp_getapplock
      @Resource = @lockResource,
      @LockMode = 'Exclusive',
      @LockOwner = 'Transaction',
      @LockTimeout = 10000;
    IF @lockResult < 0 RAISERROR('No se pudo bloquear la pre-guia.', 16, 1);

    SELECT @idOt = idOT,
           @cantidad = Cantidad,
           @del = Del,
           @al = Al,
           @estadoOt = EstadoOT,
           @estadoGuia = EstadoGuia
    FROM dbo.tbRecepcionOT WITH (UPDLOCK, HOLDLOCK)
    WHERE idRecepcionOT = @idRecepcionOT;

    IF @idOt IS NULL RAISERROR('La pre-guia no existe.', 16, 1);

    -- Reintento seguro: no crea un segundo movimiento de ingreso.
    IF @estadoOt = 'C'
    BEGIN
      COMMIT TRANSACTION;
      SELECT @idRecepcionOT AS idRecepcionOT,
             @idOt AS idOrdenTrabajo,
             @estadoOt AS estadoOt,
             @estadoGuia AS estadoGuia,
             CAST(1 AS bit) AS yaAceptada;
      RETURN;
    END

    IF @estadoOt <> 'I' RAISERROR('La pre-guia no esta pendiente de aceptacion.', 16, 1);

    EXEC dbo.SPU_RECEPCION_OT_ESTADO
      @IDRECEPCIONOT = @idRecepcionOT,
      @cantidad = @cantidad,
      @del = @del,
      @al = @al,
      @ESTADOOT = 'C';

    EXEC dbo.SPU_CERRAR_OTGUI @IDORDENTRABAJO = @idOt;

    SELECT @estadoOt = EstadoOT, @estadoGuia = EstadoGuia
    FROM dbo.tbRecepcionOT
    WHERE idRecepcionOT = @idRecepcionOT;

    COMMIT TRANSACTION;

    SELECT @idRecepcionOT AS idRecepcionOT,
           @idOt AS idOrdenTrabajo,
           @estadoOt AS estadoOt,
           @estadoGuia AS estadoGuia,
           CAST(0 AS bit) AS yaAceptada;
  END TRY
  BEGIN CATCH
    IF XACT_STATE() <> 0 ROLLBACK TRANSACTION;
    DECLARE @error nvarchar(2048) = ERROR_MESSAGE();
    RAISERROR('%s', 16, 1, @error);
  END CATCH
END;
GO

IF OBJECT_ID(N'dbo.GRE_WEB_CREAR_GUIA_INTERNA_FC', N'P') IS NOT NULL
  RAISERROR('GRE_WEB_CREAR_GUIA_INTERNA_FC ya existe. Instalacion detenida para no reemplazarlo.', 16, 1);
GO
CREATE PROCEDURE dbo.GRE_WEB_CREAR_GUIA_INTERNA_FC
  @serie varchar(3),
  @recepcionesXml xml,
  @direccion varchar(150),
  @idDistrito int,
  @ordenCompra varchar(50) = '',
  @observaciones varchar(50) = ''
AS
BEGIN
  SET NOCOUNT ON;
  SET XACT_ABORT ON;

  DECLARE @ids TABLE (idRecepcionOT int NOT NULL PRIMARY KEY);
  INSERT @ids (idRecepcionOT)
  SELECT n.value('(text())[1]', 'int')
  FROM @recepcionesXml.nodes('/ids/id') AS x(n);

  DECLARE @cantidadIds int = (SELECT COUNT(*) FROM @ids),
          @cantidadValidas int,
          @cantidadClientes int,
          @idCliente int,
          @idEmpleado int,
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
      @idEmpleado = MIN(ISNULL(solicitud.idEmpleado, 1)),
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

    -- La aceptacion debe haber creado el movimiento de ingreso ligado a cada recepcion.
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
        @IDMOTIVOTRASLADO = 0,
        @Observaciones = @observaciones,
        @IDDOCUMENTO = @idDocumento OUTPUT,
        @IDGUIA = @idGuia OUTPUT,
        @NumeDocu = @numeroDocumento OUTPUT,
        @Direccion = @direccion,
        @ordenc = @ordenCompra,
        @idclie = @idCliente,
        @distrito = @idDistrito,
        @idempleado = @idEmpleado,
        @origen = 'Y';
    ELSE
      EXEC dbo.SPI_GUIA_REMISION_Y_003
        @IDRECEPCIONOT = @primeraRecepcion,
        @IDMOTIVOTRASLADO = 0,
        @Observaciones = @observaciones,
        @IDDOCUMENTO = @idDocumento OUTPUT,
        @IDGUIA = @idGuia OUTPUT,
        @NumeDocu = @numeroDocumento OUTPUT,
        @Direccion = @direccion,
        @ordenc = @ordenCompra,
        @idclie = @idCliente,
        @distrito = @idDistrito,
        @idempleado = @idEmpleado,
        @origen = 'Y';

    DECLARE recepciones CURSOR LOCAL FAST_FORWARD FOR
      SELECT r.idRecepcionOT, r.Cantidad, u.Valor
      FROM @ids i
      INNER JOIN dbo.tbRecepcionOT r ON r.idRecepcionOT = i.idRecepcionOT
      INNER JOIN dbo.tbUnidades u ON u.idUnidad = r.IDUNIDAD
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
           @cantidadIds AS recepcionesIncluidas;
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
