# Evidencia de reproceso FF01-00017171

Fecha: 2026-09-16

## Documento

- Factura: `FF01-00017171`
- Cliente: `10406265574 - ORLANDO BORITZ LLERENA DELGADO`
- Guia relacionada: `T001-00000093`
- Base gravada: `S/ 0.50`
- IGV: `S/ 0.09`
- Total: `S/ 0.59`
- Items: `1`

## Fallos originales

1. Bizlinks `7122`: se envio `codigoAuxiliar40_1 = 9218` sin el texto
   auxiliar correspondiente al vendedor.
2. Bizlinks `7451`: se envio `codigoProductoSunat = '-'`; el campo opcional
   exige ocho caracteres cuando tiene valor.
3. La operacion se habia enviado como sujeta a detraccion `037 / 12%` pese a
   que el total era `S/ 0.59`.

Los registros de `SPE_ERROR_LOG` no se eliminaron.

## Comparacion aplicada

Se comparo con las facturas FF01 aceptadas `FF01-00017146`,
`FF01-00017169`, `FF01-00017170` y `FF01-00017172`.

| Campo | FF01 aceptadas | FF01-00017171 corregida |
| --- | --- | --- |
| `tipoOperacion` | `0101` sin detraccion | `0101` |
| `codigoDetraccion` | `NULL` | `NULL` |
| `porcentajeDetraccion` | `NULL` | `NULL` |
| `totalDetraccion` | `NULL` | `NULL` |
| `codigoProductoSunat` | `NULL` | `NULL` |
| `unidadMedida` | `MIL` | `MIL` |
| `codigoAuxiliar40_1` | `9218` | `9218` |
| `textoAuxiliar40_1` | vendedor | `OFICINA OFICINAFLEXO` |
| `ubigeoEmisor` | `150115` | `150115` |
| distrito emisor | `LA VICTORIA` | `LA VICTORIA` |

## Resultado final

- Cabecera Bizlinks: `BL_ESTADOREGISTRO = L`
- Respuesta Bizlinks: `SIGNED/AC_03`
- Proceso: `_3_COMPLETED`
- Mensaje SUNAT: codigo `0`, factura aceptada
- PDF Bizlinks: generado y guardado como
  `evidencias/FF01-00017171_BIZLINKS.pdf`
- UBL y CDR: disponibles en Bizlinks

La factura fue aceptada por SUNAT. El siguiente paso es solicitar formalmente
la baja a Bizlinks/SUNAT y esperar su confirmacion antes de liberar la guia o
modificar relaciones internas.
