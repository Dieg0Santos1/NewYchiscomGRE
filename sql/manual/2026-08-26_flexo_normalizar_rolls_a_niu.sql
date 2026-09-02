/*
  Normaliza unidades de empaques Flexo que Bizlinks/SUNAT no aceptan como item.

  Uso:
  1. Dejar @Confirmar = 0 para revisar los registros candidatos.
  2. Opcional: indicar @CodigoEmpaque para corregir solo un empaque.
  3. Cambiar @Confirmar = 1 solo cuando se quiera actualizar.

  No cambia series, estados, facturas ni guias; solo EMPAQUE_DETALLE.UNIDADMEDIDA.
*/

USE BIZLINKS_PROD21;
GO

DECLARE @Confirmar bit = 0;
DECLARE @CodigoEmpaque int = NULL;
DECLARE @SoloPendientes bit = 1;

IF @Confirmar = 0
BEGIN
    SELECT
        d.CODIGOEMPAQUE,
        e.TICKETNUM,
        e.ORDENCOMPRA,
        e.NUMERODOCUMENTOADQUIRIENTE,
        e.RAZONSOCIALADQUIRIENTE,
        d.CODIGOPRODUCTO,
        d.DESCRIPCION,
        d.CANTIDAD,
        d.UNIDADMEDIDA AS unidadActual,
        'NIU' AS unidadNueva,
        d.SERIENUMEROGUIAREMISION,
        d.SERIENUMEROGUIAFACTURA
    FROM dbo.EMPAQUE_DETALLE d
    LEFT JOIN dbo.EMPAQUE e
        ON e.CODIGOEMPAQUE = d.CODIGOEMPAQUE
    WHERE UPPER(LTRIM(RTRIM(ISNULL(d.UNIDADMEDIDA, '')))) IN ('ROLLO', 'ROLLOS', 'ROLL', 'ROLLS', 'ROL')
      AND (@CodigoEmpaque IS NULL OR d.CODIGOEMPAQUE = @CodigoEmpaque)
      AND (
        @SoloPendientes = 0
        OR (
          d.SERIENUMEROGUIAREMISION IS NULL
          AND d.SERIENUMEROGUIAFACTURA IS NULL
        )
      )
    ORDER BY d.CODIGOEMPAQUE, d.CODIGOPRODUCTO;

    PRINT 'Vista previa solamente. Para actualizar, cambie @Confirmar = 1.';
END
ELSE
BEGIN
    UPDATE d
       SET d.UNIDADMEDIDA = 'NIU'
    OUTPUT
        inserted.CODIGOEMPAQUE,
        inserted.CODIGOPRODUCTO,
        deleted.UNIDADMEDIDA AS unidadAnterior,
        inserted.UNIDADMEDIDA AS unidadNueva
    FROM dbo.EMPAQUE_DETALLE d
    WHERE UPPER(LTRIM(RTRIM(ISNULL(d.UNIDADMEDIDA, '')))) IN ('ROLLO', 'ROLLOS', 'ROLL', 'ROLLS', 'ROL')
      AND (@CodigoEmpaque IS NULL OR d.CODIGOEMPAQUE = @CodigoEmpaque)
      AND (
        @SoloPendientes = 0
        OR (
          d.SERIENUMEROGUIAREMISION IS NULL
          AND d.SERIENUMEROGUIAFACTURA IS NULL
        )
      );
END;
GO
