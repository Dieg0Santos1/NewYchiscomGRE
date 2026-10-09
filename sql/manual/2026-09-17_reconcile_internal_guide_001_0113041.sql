/*
  Reconstruye la guia interna 001-0113041 omitida antes de emitir
  la GRE aceptada T001-00000104. No emite ni reenvia documentos.
*/
SET NOCOUNT ON;
SET XACT_ABORT ON;

DECLARE @Numero varchar(20) = '0113041';
DECLARE @Gre varchar(20) = 'T001-00000104';
DECLARE @IdDocumento int = 0;
DECLARE @IdGuia int = 0;
DECLARE @NumeroCreado varchar(50) = '';
DECLARE @OperacionId bigint;
DECLARE @EnvioId bigint;

BEGIN TRANSACTION;

IF EXISTS (
  SELECT 1 FROM YCHIDB3.dbo.tbDocumentos
  WHERE idTipoDocu = 8 AND SeriDocu = '001' AND NumeDocu = @Numero
)
  THROW 51200, 'La guia interna 001-0113041 ya existe.', 1;

IF NOT EXISTS (
  SELECT 1 FROM YCHIDB3.dbo.tbTipoDocu WITH (UPDLOCK, HOLDLOCK)
  WHERE idTipoDocu = 8 AND serie = '001' AND numero = '0113040'
)
  THROW 51201, 'El correlativo legado ya no esta en 001-0113040.', 1;

IF NOT EXISTS (
  SELECT 1
  FROM BIZLINKS_PROD21.dbo.SPE_DESPATCH_RESPONSE
  WHERE serieNumeroGuia = @Gre
    AND process_state = '_3_COMPLETED'
    AND bl_mensajeSunat LIKE '%"codigo":"0"%'
)
  THROW 51202, 'T001-00000104 no tiene respuesta SUNAT aceptada.', 1;

SELECT @OperacionId = o.id, @EnvioId = e.id
FROM GRE_FORMULARIOS_TEST.dbo.GRE_FC_OPERACION o WITH (UPDLOCK, HOLDLOCK)
INNER JOIN GRE_FORMULARIOS_TEST.dbo.GRE_FC_ENVIO e ON e.operacionId = o.id
WHERE e.serieNumeroGuia = @Gre
  AND o.numeroDocumentoDestinatario = '20100047137'
  AND o.estado = 'ACTIVADO';

IF @OperacionId IS NULL OR @EnvioId IS NULL
  THROW 51203, 'No existe una unica traza activa para T001-00000104.', 1;

EXEC YCHIDB3.dbo.SPI_GUIA_REMISION44_YP
  @IDRECEPCIONOT = 9999999,
  @IDMOTIVOTRASLADO = 1,
  @Observaciones = 'OT-616 / SR. ROBERTO ALVARADO.',
  @IDDOCUMENTO = @IdDocumento OUTPUT,
  @IDGUIA = @IdGuia OUTPUT,
  @NumeDocu = @NumeroCreado OUTPUT,
  @Direccion = 'JR. JUNIN 758-774',
  @ordenc = '',
  @formapag = '7',
  @idclie = 739,
  @distrito = 1,
  @idempleado = 91,
  @origen = 'Y';

IF @NumeroCreado <> @Numero
  THROW 51204, 'El procedimiento genero un correlativo distinto de 001-0113041.', 1;

EXEC YCHIDB3.dbo.SPI_DETGUIA_REMISION
  @idGuia = @IdGuia,
  @idRecepcionOT = 9999999,
  @Observaciones = 'PAPEL BOND A-5 21.00 cm. X 14.82 cm. X 1, TIRA:0, RETIRA:0, PAPEL:Bond, DEL:0, AL:0',
  @idDocumentos = @IdDocumento,
  @idprodu = 2198,
  @canti = 50,
  @unid = 'MLL';

IF (SELECT COUNT(*) FROM YCHIDB3.dbo.tbDetGuias WHERE idDocumentos = @IdDocumento) <> 1
  THROW 51205, 'La guia interna no genero exactamente un detalle.', 1;

UPDATE GRE_FORMULARIOS_TEST.dbo.GRE_FC_OPERACION
SET idGuiaFisicaYchiscom = @IdGuia,
    numeroGuiaFisica = '001-0113041',
    idDocumentoYchiscom = @IdDocumento,
    actualizadoEn = SYSUTCDATETIME()
WHERE id = @OperacionId
  AND idGuiaFisicaYchiscom IS NULL
  AND numeroGuiaFisica IS NULL
  AND idDocumentoYchiscom IS NULL;

IF @@ROWCOUNT <> 1
  THROW 51206, 'No se pudo vincular la guia interna con la GRE local.', 1;

INSERT INTO GRE_FORMULARIOS_TEST.dbo.GRE_FC_EVENTO
  (operacionId, envioId, tipo, mensaje, datosJson)
VALUES
  (@OperacionId, @EnvioId, 'GUIA_INTERNA_RECONCILIADA',
   'Guia interna legado reconstruida despues de la emision de la GRE',
   CONCAT('{"guiaInterna":"001-0113041","gre":"', @Gre,
          '","idDocumento":', @IdDocumento, ',"idGuia":', @IdGuia, '}'));

COMMIT TRANSACTION;

SELECT 'GUIA_INTERNA_RECONCILIADA' AS resultado,
  @Numero AS numero, @IdDocumento AS idDocumento, @IdGuia AS idGuia, @Gre AS gre;

SELECT d.idDocumento, d.SeriDocu, d.NumeDocu, d.DescClieProv,
  d.formaPago, d.Estado, dg.idDetGuia, dg.idProducto,
  dg.Cantidad, u.Valor AS unidad, dg.Observaciones
FROM YCHIDB3.dbo.tbDocumentos d
INNER JOIN YCHIDB3.dbo.tbDetGuias dg ON dg.idDocumentos = d.idDocumento
INNER JOIN YCHIDB3.dbo.tbUnidades u ON u.idUnidad = dg.idUnidad
WHERE d.idDocumento = @IdDocumento;
