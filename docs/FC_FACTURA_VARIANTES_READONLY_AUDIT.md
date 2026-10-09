# Auditoria de variantes de factura FC (solo lectura)

Fecha: 2026-09-17

## Estado de implementacion

- PEN y USD disponibles; USD lee `TBTICA` con la misma fecha y moneda que usa
  `F_TicaVenta`, sin ejecutar esa funcion por restricciones de permisos.
- La detraccion USD se expresa en PEN con el tipo de cambio redondeado a dos
  decimales, como `FF01-00017172`.
- Credito usa `dias` del catalogo, codigo Bizlinks `999`, una cuota neta de
  detraccion y la fecha de vencimiento calculada con esos dias.
- Se admite una GRE y hasta 45 items por factura. Varias GRE quedan bloqueadas
  hasta implementar de forma determinista las referencias 1 a 5.
- Gratuita, exonerada e inafecta permanecen visibles pero bloqueadas hasta
  contar con una FF01 aceptada de referencia.
- Las formas con varios vencimientos quedan bloqueadas hasta implementar todas
  las cuotas requeridas.

## Seguridad de la auditoria

Se consultaron historicos aceptados de `BIZLINKS_PROD21` y la fuente de tipo
de cambio de `YCHIDB3`. No se ejecutaron procedimientos, no se reservaron
correlativos y no se insertaron, actualizaron ni eliminaron registros.

Herramientas reproducibles:

```powershell
npx tsx tools/audit/auditFcInvoiceModesReadOnly.ts
npx tsx tools/audit/inspectFcExchangeRateReadOnly.ts
```

## Matriz observada

| Variante | Evidencia aceptada | Estado del portal FC |
| --- | --- | --- |
| PEN, gravada, contado, sin detraccion | `FF01-00017171` | Validada de extremo a extremo |
| PEN, gravada, credito, sin detraccion | `FF01-00017170`, `FF01-00017169` | Parcial: una cuota funciona conceptualmente; falta usar los dias del catalogo |
| PEN, gravada, detraccion 037 | `FF01-00017168` | Parcial: porcentaje correcto; cuota neta esta mal si es credito |
| USD, gravada, sin detraccion | `FF01-00017134` | No soportada: schema y UI solo aceptan PEN |
| USD, gravada, detraccion 037 | `FF01-00017172`, `FF01-00017163` | No soportada: falta tipo de cambio y conversion de detraccion a PEN |
| Detraccion 025 | Solo FF03 historicas de 2019 | No certificada para FF01 actual |
| Varios items | FF01 aceptadas recientes con 2 items; historicas hasta 45 | Estructura soportada por el mapper; falta limite explicito |
| Varias guias | `FF01-00017153` y otras con 2-5 referencias | No segura: el portal prepara solo la primera referencia |
| Exonerada/inafecta/gratuita | No se encontraron detalles FF01 aceptados con codigos 20/30/21 | No certificada; la UI las expone sin evidencia suficiente |

## Hallazgos que requieren cambio

### 1. Moneda USD

`fcFacturaPreviewSchema` solo admite `PEN` y la UI fija la moneda en PEN.

La fuente oficial observada para USD es:

```sql
YCHIDB3.dbo.F_TicaVenta('D', @fechaEmision)
```

Esta funcion consulta `YCHIDB3.dbo.TBTICA.venta` para la fecha de emision.

En USD con detraccion, `TOTALDETRACCION` se expresa en PEN:

```text
total USD * porcentaje * tipo de cambio de venta
```

Ejemplo aceptado `FF01-00017172`:

- total: USD 3,540.00;
- detraccion: 12%;
- tipo de cambio derivado: 3.37999;
- detraccion enviada: S/ 1,435.82.

La cuota pendiente sigue expresada en la moneda de la factura:
USD 3,540.00 - USD 424.80 = USD 3,115.20.

### 2. Credito y formas de pago

El catalogo `tbPropiedades` ya devuelve `dias`, pero el payload no lo conserva.
El mapper extrae el primer numero del texto. Esto falla para valores como:

- `0, 30 y 60 dias`: calcula 0 en lugar de 60;
- `50% adelantado y saldo a 60 dias`: calcula 50 en lugar de 60;
- `Factura 60, 70, 80, 90 dias`: calcula 60 en lugar de 90.

Debe agregarse `diasPago` al contrato del preview y usar el valor numerico del
catalogo para vencimiento. Las formas con varios vencimientos requieren varias
cuotas reales o deben bloquearse hasta implementar su distribucion.

En credito con detraccion, el mapper actual usa el total completo como
`montoNetoPendiente` y `montoPagoCuota1`. Debe usar el total menos la
detraccion en la moneda de la factura.

### 3. Varias guias

Hay FF01 aceptadas con hasta cinco referencias. El mapper actual envia solo la
primera guia en `GUIAREMISION`. Ademas, `USP_EnviaDocumentoFE` actualiza solo
`numeroDocumentoReferencia_1` desde `AAA_GUIAFACTURADA`; con varias filas el
resultado no es determinista.

Se debe implementar el mapeo explicito de referencias 1-5 o limitar a una guia
por factura hasta contar con un procedimiento transaccional que lo haga.

### 4. Detraccion 025

El codigo actual mapea `025` a 10%, que coincide con FF03 aceptadas antiguas.
No se encontro una FF01 aceptada con codigo 025, por lo que no debe marcarse
como certificada sin confirmacion contable y un caso FF01 representativo.

### 5. Tipo de afectacion

Los detalles FF01 aceptados encontrados usan:

- `codigoRazonExoneracion = 10`;
- `codigoImporteUnitarioConImpues = 01`;
- IGV 18%.

No hubo evidencia suficiente para certificar gratuita (21), exonerada (20) o
inafecta (30). Conviene ocultar o bloquear esas opciones hasta validar ejemplos
reales y sus totales/leyendas.

## Orden recomendado

1. Conservar habilitado el caso ya certificado: PEN, gravada y una guia.
2. Pasar `diasPago` desde el catalogo y corregir cuota neta con detraccion.
3. Bloquear temporalmente varias guias y afectaciones no certificadas.
4. Implementar USD con tipo de cambio de `F_TicaVenta` y calculos por moneda.
5. Confirmar con Contabilidad el uso actual de 025.
6. Construir pruebas de mapper para cada variante antes de cualquier envio real.
