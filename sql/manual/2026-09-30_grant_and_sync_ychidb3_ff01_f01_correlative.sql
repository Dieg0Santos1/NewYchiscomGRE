/*
  Corrige de forma conservadora el permiso y correlativo legacy para FF01/F01.

  Que hace:
  - Concede a gre_app_test solo UPDATE sobre YCHIDB3.dbo.tbTipoDocu.
  - Calcula el maximo FF01 ya emitido/registrado.
  - Sube tbTipoDocu FF01/F01 solo si estan por debajo del maximo.

  Que NO hace:
  - No inserta facturas.
  - No borra registros.
  - No modifica Bizlinks.
  - No baja correlativos existentes.
*/

SET NOCOUNT ON;
SET XACT_ABORT ON;

DECLARE @AppUser sysname = N'gre_app_test';
DECLARE @MaxNumero int;
DECLARE @MaxFF01 varchar(8);
DECLARE @MaxF01 varchar(7);

SELECT @MaxNumero = MAX(numero)
FROM (
  SELECT CONVERT(int, RIGHT(h.SERIENUMERO, 8)) AS numero
  FROM BIZLINKS_PROD21.dbo.SPE_EINVOICEHEADER h
  WHERE h.TIPODOCUMENTO = '01'
    AND h.SERIENUMERO LIKE 'FF01-[0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9]'
    AND ISNUMERIC(RIGHT(h.SERIENUMERO, 8)) = 1

  UNION ALL

  SELECT CONVERT(int, d.NumeDocu) AS numero
  FROM YCHIDB3.dbo.tbDocumentos d
  WHERE d.idTipoDocu = 1
    AND d.SeriDocu COLLATE SQL_Latin1_General_CP1_CI_AS = 'F01'
    AND ISNUMERIC(d.NumeDocu) = 1
) src;

IF @MaxNumero IS NULL OR @MaxNumero <= 0
  THROW 52200, 'No se pudo calcular el maximo FF01/F01 emitido.', 1;

SET @MaxFF01 = RIGHT('00000000' + CONVERT(varchar(20), @MaxNumero), 8);
SET @MaxF01 = RIGHT('0000000' + CONVERT(varchar(20), @MaxNumero), 7);

USE YCHIDB3;

BEGIN TRANSACTION;

IF NOT EXISTS (
    SELECT 1
    FROM sys.database_principals
    WHERE name = @AppUser
  )
  THROW 52201, 'No existe el usuario gre_app_test en YCHIDB3.', 1;

GRANT UPDATE ON OBJECT::dbo.tbTipoDocu TO [gre_app_test];

IF NOT EXISTS (
    SELECT 1
    FROM dbo.tbTipoDocu WITH (UPDLOCK, HOLDLOCK)
    WHERE idTipoDocu = 42
      AND serie COLLATE SQL_Latin1_General_CP1_CI_AS = 'FF01'
  )
  THROW 52202, 'No existe tbTipoDocu idTipoDocu 42 / FF01.', 1;

IF NOT EXISTS (
    SELECT 1
    FROM dbo.tbTipoDocu WITH (UPDLOCK, HOLDLOCK)
    WHERE idTipoDocu = 1
      AND serie COLLATE SQL_Latin1_General_CP1_CI_AS = 'F01'
  )
  THROW 52203, 'No existe tbTipoDocu idTipoDocu 1 / F01.', 1;

UPDATE dbo.tbTipoDocu
SET numero = @MaxFF01
WHERE idTipoDocu = 42
  AND serie COLLATE SQL_Latin1_General_CP1_CI_AS = 'FF01'
  AND (
    ISNUMERIC(numero) = 0
    OR CONVERT(int, numero) < @MaxNumero
  );

UPDATE dbo.tbTipoDocu
SET numero = @MaxF01
WHERE idTipoDocu = 1
  AND serie COLLATE SQL_Latin1_General_CP1_CI_AS = 'F01'
  AND (
    ISNUMERIC(numero) = 0
    OR CONVERT(int, numero) < @MaxNumero
  );

IF EXISTS (
    SELECT 1
    FROM dbo.tbTipoDocu
    WHERE idTipoDocu = 42
      AND serie COLLATE SQL_Latin1_General_CP1_CI_AS = 'FF01'
      AND (
        ISNUMERIC(numero) = 0
        OR CONVERT(int, numero) < @MaxNumero
      )
  )
  THROW 52204, 'FF01 quedo por debajo del maximo emitido; se revertira.', 1;

IF EXISTS (
    SELECT 1
    FROM dbo.tbTipoDocu
    WHERE idTipoDocu = 1
      AND serie COLLATE SQL_Latin1_General_CP1_CI_AS = 'F01'
      AND (
        ISNUMERIC(numero) = 0
        OR CONVERT(int, numero) < @MaxNumero
      )
  )
  THROW 52205, 'F01 quedo por debajo del maximo emitido; se revertira.', 1;

COMMIT TRANSACTION;

SELECT 'CORRELATIVO_FF01_F01_SINCRONIZADO' AS resultado,
  @MaxNumero AS maxNumeroDetectado,
  @MaxFF01 AS ff01Minimo,
  @MaxF01 AS f01Minimo;

SELECT USER_NAME() AS usuarioActual,
  HAS_PERMS_BY_NAME('dbo.tbTipoDocu', 'OBJECT', 'SELECT') AS puedeSelectTbTipoDocu,
  HAS_PERMS_BY_NAME('dbo.tbTipoDocu', 'OBJECT', 'UPDATE') AS puedeUpdateTbTipoDocu;

EXECUTE AS USER = 'gre_app_test';

SELECT USER_NAME() AS usuarioValidado,
  HAS_PERMS_BY_NAME('dbo.tbTipoDocu', 'OBJECT', 'SELECT') AS puedeSelectTbTipoDocu,
  HAS_PERMS_BY_NAME('dbo.tbTipoDocu', 'OBJECT', 'UPDATE') AS puedeUpdateTbTipoDocu;

REVERT;

SELECT idTipoDocu, serie, numero
FROM dbo.tbTipoDocu
WHERE idTipoDocu IN (1, 42)
ORDER BY idTipoDocu;
