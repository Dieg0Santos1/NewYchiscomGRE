# FC factura: timeout y rechazo 7122

Auditoria del 2026-09-16, serie FF01.

## Evidencia

- FF01-00017172 y FF01-00017173: ERROR solo en FC_FACT_OPERACION/ENVIO.
  Sin cabecera, detalle, respuesta ni vinculo de guia en Bizlinks al verificar.
- El ultimo evento de 17173 antes del timeout fue SP_PREVIEW_VALIDADO.
- assertGuidesNotAlreadyTraced ejecutaba un JOIN hacia SPE_EINVOICEHEADER
  desde una transaccion SERIALIZABLE en la conexion GRE. Conservaba bloqueos
  de rango que impedian escribir desde la segunda conexion Bizlinks.
- Una prueba de lectura con bloqueo de actualizacion reprodujo el timeout.
  Al usar READCOMMITTED en ese JOIN, termino en 27 ms.
- SPE_ERROR_LOG de FF01-00017171: codigo 7122, codigo auxiliar sin texto.
  USP_EnviaDocumentoFE asigna codigoAuxiliar40_1=9218 para las guias;
  el mapper omitio textoAuxiliar40_1 (vendedor).
- FF01-00017146 tiene respuesta SUNAT codigo 0, SIGNED/AC_03. Su emisor
  usa ubigeo fiscal 150115, LIMA/LIMA/LA VICTORIA, FUNDO MATUTE.

## Correccion y verificacion

- READCOMMITTED solo en la lectura cruzada de cabecera. Se conservan los
  bloqueos de aplicacion por guia, operacion y correlativo.
- Mapper FC: vendedor en auxiliar 9218, con '-' si esta vacio, y domicilio
  fiscal del emisor contrastado con la factura aceptada. Sin modificar GRE.
- Reportes consulta SPE_ERROR_LOG cuando Bizlinks marca E sin mensaje.
- Los errores de procedimientos incluyen el nombre del SP que fallo.
- checkFcFacturaInsertRollback.ts reutiliza un intento ERROR, verifica que
  la cabecera no exista, ejecuta cabecera y detalle en estado N y revierte.
  No ejecuta USP_EnviaDocumentoFE ni confirma ninguna transaccion.
- Prueba SQL: cabecera 210 ms, detalle 4 ms; 1 item, total 0.59,
  tipoOperacion 0101, sin detraccion, ubigeoEmisor 150115.
- Typecheck y 17 pruebas de mapper/rutas pasaron.
- Pendiente: declaracion real del usuario y respuesta de Bizlinks/SUNAT.

## Coexistencia con el sistema antiguo

La vista del siguiente numero no es una reserva compartida. El portal
considera tambien sus intentos ERROR; el antiguo no los ve en Bizlinks.
USP_CabeceraFE borra registros de la misma clave antes de insertar. Una
pantalla antigua con un correlativo desactualizado puede sobrescribir una
factura posterior del portal. No esta resuelta la reserva conjunta entre
ambos sistemas: recargar la numeracion y evitar emision simultanea en FF01.
