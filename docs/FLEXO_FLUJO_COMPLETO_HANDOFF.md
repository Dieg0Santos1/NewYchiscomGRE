# Handoff Codex - Flujo completo de Flexografia

Fecha de corte: 2026-09-16  
Repositorio: `D:\CODE\NewYchiscomGRE-dev`  
Rama esperada: `dev`

## Objetivo

Completar el modulo Flexo del portal `Ychiformas - Facturacion` desde la hoja
de empaque de LabelTraxx hasta:

1. GRE Flexo `T003`.
2. Factura electronica Flexo `FF03`.
3. Relacion trazable por item entre empaque, GRE y FE.
4. Reportes de documentos activos, rechazados y anulados.
5. Flujo controlado de baja/anulacion y liberacion de items.

No asumir que las pantallas existentes ya replican el flujo productivo. La
GRE y la FE Flexo tienen UI y vista previa, pero sus declaraciones siguen
bloqueadas.

## Regla de trabajo

- Auditar primero con `rg`, pruebas y consultas SQL de solo lectura.
- No escribir, corregir ni liberar registros productivos manualmente durante
  la auditoria.
- No ejecutar una GRE, FE, NCE o baja real sin una prueba autorizada.
- No conceder `UPDATE` amplio sobre tablas operativas. Preferir procedimientos
  almacenados con permisos minimos, transaccion, bloqueo e idempotencia.
- No borrar SQL manuales. Si se ordenan, moverlos a `sql/manual/archive/` en un
  cambio separado.
- No tocar FC ni Guia 2 salvo que sea necesario para compilacion o para
  reutilizar una pieza comun sin cambiar su comportamiento.
- Antes de implementar, confirmar el contrato real comparando documentos
  Flexo aceptados por Bizlinks/SUNAT con los datos fuente.

## Fuentes y bases de datos

### BIZLINKS_PROD21

Contiene los catalogos operativos Flexo, las hojas de empaque y las tablas que
consume Bizlinks.

Tablas de GRE:

- `dbo.SPE_DESPATCH`
- `dbo.SPE_DESPATCH_ITEM`
- `dbo.SPE_DESPATCH_RESPONSE`

Tablas de FE:

- `dbo.SPE_EINVOICEHEADER`
- `dbo.SPE_EINVOICEDETAIL`
- `dbo.SPE_EINVOICE_RESPONSE`
- `dbo.SPE_EINVOICEHEADER_ADD`
- `dbo.SPE_ERROR_LOG`

Fuentes Flexo y catalogos:

- `dbo.EMPAQUE`
- `dbo.EMPAQUE_DETALLE`
- `dbo.AAA_ADQUIRIENTE`
- `dbo.AAA_CHOFER`
- `dbo.AAA_CONTABLE`
- `dbo.AAA_DESTINO`
- `dbo.AAA_DETRACCION`
- `dbo.AAA_EMPRESA`
- `dbo.AAA_GUIAFACTURADA`
- `dbo.AAA_ORIGEN`
- `dbo.AAA_REGISTRO_CONTABLE`
- `dbo.AAA_TIPODOCUMENTO`
- `dbo.AAA_TRANSPORTISTA`
- `dbo.MOTIVOS`

Nota: la hoja de ruta recibida dice `AAA_ADQUIRENTE`, pero el nombre real
comprobado en la base es `AAA_ADQUIRIENTE`.

### GRE_FORMULARIOS_TEST

Base de trazabilidad propia del portal. Tiene trazabilidad FC y Guia 2, pero
no se encontraron tablas propias `FLEXO_*` ni `GRE_FLEXO_*`.

Las 12 migraciones existentes estan aplicadas. Ninguna crea trazabilidad
completa para GRE/FE Flexo.

### YCHIDB3

Se consulta actualmente como fuente secundaria para formas de pago y para
detectar documentos ya facturados. Antes de agregar escrituras hay que
confirmar si una FE Flexo tambien debe registrarse en `tbDocumentos` y que
procedimiento oficial utiliza el sistema antiguo.

## Mapa funcional entregado por el ingeniero

### Catalogos y repositorios

| Tabla | Funcion informada | Estado en el portal |
|---|---|---|
| `AAA_ADQUIRIENTE` | Clientes. Sus datos deben coincidir exactamente con LabelTraxx. Puede requerir alta manual antes de GRE/FE. | No integrada. El portal busca clientes historicos en `EMPAQUE` o `SPE_DESPATCH`. |
| `AAA_CHOFER` | Choferes propios de Ychiformas para guias/facturas. | Lectura integrada mediante el catalogo comun de choferes. Tambien existe `GRE_CHOFER_MANUAL` para altas del portal; hay que decidir la fuente oficial Flexo. |
| `AAA_CONTABLE` | Catalogo de cuentas contables disponibles para FE. | No se lee directamente. Flexo usa `View_CuentasFactura` y defaults. |
| `AAA_DESTINO` | Multiples destinos por RUC disponibles al hacer GRE. | No integrada. Flexo obtiene destinos historicos desde `EMPAQUE`. |
| `AAA_DETRACCION` | Codigo y porcentaje de detraccion. | No integrada. Las opciones `000`, `037`, `025` y `027` estan codificadas en frontend/schema. |
| `AAA_EMPRESA` | Datos de las empresas emisoras de Ychi. | No integrada. Empresa y datos de emisor estan fijos/configurados. |
| `AAA_GUIAFACTURADA` | Relacion GRE-FE y NCE mediante `NOTACRE`. | Solo lectura para excluir guias y soporte previo en FC. La escritura Flexo aun no existe. |
| `AAA_ORIGEN` | Direcciones de partida de GRE. | No integrada. Flexo muestra un origen fijo. |
| `AAA_REGISTRO_CONTABLE` | Cuenta contable aplicada a cada FE. | No integrada en la declaracion porque la FE Flexo aun no escribe. |
| `AAA_TIPODOCUMENTO` | Series y correlativos de guias/comprobantes. | No integrada. El portal calcula `MAX + 1` desde tablas SPE; esto no reserva el numero ni coordina con otro sistema. |
| `AAA_TRANSPORTISTA` | Transportistas externos para traslado publico. | No integrada en Flexo. La UI permite modalidad publica, pero no completa el contrato del transportista. |
| `MOTIVOS` | Motivos de traslado Flexo. | No integrada. La UI usa un catalogo SUNAT estatico compartido. |

### Hojas de empaque

| Tabla | Funcion comprobada |
|---|---|
| `EMPAQUE` | Cabecera importada desde LabelTraxx: cliente, destino, OC, vendedor, fecha y ticket. |
| `EMPAQUE_DETALLE` | Items: producto, descripcion, cantidad, unidad, moneda, precio/importes y relaciones con GRE/FE. |

Campos de enlace importantes de `EMPAQUE_DETALLE`:

- `SERIENUMEROGUIAREMISION`
- `SERIENUMEROGUIAFACTURA`
- `ORDENGUIA`
- `ORDENFACTURA`

El portal ya permite ajustar `UNIDADMEDIDA` solo si el item aun no esta ligado
a GRE ni FE.

## Flujo operativo informado

1. LabelTraxx genera una hoja de empaque.
2. Un proceso por ODBC registra cabecera y detalle en `EMPAQUE` y
   `EMPAQUE_DETALLE`.
3. Si los datos son correctos, se genera la GRE Flexo.
4. Normalmente se espera la aceptacion de la GRE antes de facturar.
5. Debido a demoras, se requiere evaluar una modalidad de FE anticipada con
   advertencia y responsabilidad explicita del usuario.
6. Una FE puede tomar items de varias guias y no necesariamente todos los
   items de una guia.
7. Deben investigarse los limites reales de guias por FE e items por guia/FE,
   tanto del contrato Bizlinks como de SUNAT y del esquema local.

## Baja y liberacion informadas

### Factura

Proceso manual actual informado:

1. Solicitar la baja en Bizlinks.
2. Esperar confirmacion.
3. Cambiar `AAA_GUIAFACTURADA.NRO_GUIA` a `T003-00000000`.
4. Poner en `NULL` `EMPAQUE_DETALLE.SERIENUMEROGUIAFACTURA` para los items
   afectados.
5. Los items quedan disponibles para otra FE.

Esto describe el proceso actual, pero no debe copiarse como `UPDATE` libre.
Primero hay que comprobar con ejemplos reales:

- estado y respuesta de la baja en Bizlinks/OSE/SUNAT;
- si corresponde comunicacion de baja o NCE segun el caso;
- relacion mediante `AAA_GUIAFACTURADA.NOTACRE`;
- liberacion por item y no por guia completa;
- campos adicionales que deban quedar auditados;
- comportamiento si la factura mezcla items de varias guias.

La implementacion deberia encapsular la liberacion en un SP transaccional que
valide la confirmacion externa, guarde auditoria y modifique solo los items
afectados.

### Guia

El proceso actual informado no cambia datos internos y solicita la baja desde
SOL. Se debe investigar si la comunicacion de baja de GRE puede enviarse por
Bizlinks/API desde el portal y como representar internamente:

- solicitud pendiente;
- aceptada;
- rechazada;
- guia activa;
- guia anulada;
- items liberados o retenidos.

No asumir que una baja permite reutilizar una serie-numero. Los correlativos
emitidos o anulados no deben reciclarse.

## Estado real del codigo

### Pantallas existentes

- `/flexo/ajustes` -> `FlexoAdjustmentsPage`
  - busca `EMPAQUE_DETALLE`;
  - permite cambiar solo `UNIDADMEDIDA` si no hay GRE/FE asociada;
  - es la unica escritura Flexo habilitada actualmente.
- `/flexo/guias/nueva` -> `FlexoGuidePage`
  - busca clientes, destinos y empaques;
  - permite T003/T999, chofer, destino, motivo y vista previa;
  - el boton Declarar esta bloqueado;
  - no existe endpoint de declaracion.
- `/flexo/facturas` -> `FlexoInvoicePage`
  - busca clientes y guias T003/T999 aceptadas;
  - permite varias guias, precios, cantidades, cuenta, pago y detraccion;
  - tiene vista previa FF03;
  - el boton Declarar esta bloqueado;
  - `/api/flexo-facturas/declarar-test` responde 403 deliberadamente.
- `/flexo/reportes`
  - actualmente es un placeholder.

Problema de navegacion comprobado:

- `FlexoGuidePage` existe y la ruta funciona si se abre directamente.
- El selector Flexo y la navegacion visible llevan a `/flexo/ajustes`.
- No hay enlaces visibles a GRE, Facturas ni Reportes Flexo en el encabezado.

### Servicios existentes

Archivos principales:

- `frontend/src/pages/FlexoGuidePage.tsx`
- `frontend/src/pages/FlexoInvoicePage.tsx`
- `frontend/src/pages/FlexoAdjustmentsPage.tsx`
- `frontend/src/services/FlexoService.ts`
- `frontend/src/services/FlexoFacturaService.ts`
- `src/routes/flexoRoutes.ts`
- `src/routes/flexoFacturaRoutes.ts`
- `src/services/flexoService.ts`
- `src/services/flexoFacturaService.ts`
- `src/schemas/flexoFacturaSchema.ts`

Auditorias existentes:

- `tools/audit/flexoReportsAudit.ts`
- `tools/audit/inspectFlexoSalesReportSource.ts`
- `tools/audit/checkFlexoInvoiceRelease.ts`
- `tools/audit/compareFcFlexoInvoiceBizlinks.ts`

SQL manual existente:

- `sql/manual/2026-08-26_flexo_normalizar_rolls_a_niu.sql`
- `sql/manual/2026-09-09_flexo_adjustments_unidad_grant.sql`

Cobertura automatizada encontrada:

- `src/tests/flexoAdjustmentRoutes.test.ts`

No se encontraron pruebas de declaracion GRE Flexo ni FE Flexo porque esos
flujos aun no estan implementados.

## Brechas funcionales prioritarias

1. Los catalogos `AAA_*` no son las fuentes actuales de varias pantallas.
2. El usuario SQL actual solo tiene `SELECT` sobre `AAA_CHOFER`, `EMPAQUE`,
   `EMPAQUE_DETALLE` y `AAA_GUIAFACTURADA`; tiene `INSERT` sobre
   `AAA_GUIAFACTURADA`. No tiene lectura sobre la mayoria de los catalogos de
   la hoja de ruta.
3. La GRE Flexo no declara, no actualiza items de empaque y no tiene
   trazabilidad propia.
4. La FE Flexo no declara, no registra cuenta contable y no relaciona items.
5. La factura solo carga guias aceptadas; no existe flujo controlado para
   facturar mientras la GRE esta pendiente.
6. Al seleccionar una guia, la UI agrega todos sus items. Se puede editar la
   cantidad, pero no seleccionar/desmarcar items individualmente ni controlar
   saldo parcial de forma trazable.
7. No existe reporte Flexo operativo.
8. No existe flujo de NCE, comunicacion de baja, anulacion ni liberacion.
9. `MAX + 1` no reserva correlativos ni coordina con otros sistemas. Debe
   evaluarse `AAA_TIPODOCUMENTO` y el mecanismo oficial antes de declarar.
10. No hay modelo propio de auditoria Flexo para operaciones, items, envios,
    respuestas, bajas y eventos.

## Auditoria inicial requerida

### 1. Catalogos

Solicitar permisos `SELECT` temporales o vistas read-only para constatar:

- contenido y claves de cada `AAA_*` y `MOTIVOS`;
- duplicados y vigencia;
- relacion entre `AAA_CONTABLE`, `View_CuentasFactura` y
  `AAA_REGISTRO_CONTABLE`;
- series/correlativos T003 y FF03 en `AAA_TIPODOCUMENTO`;
- diferencias entre `AAA_ADQUIRIENTE`, `AAA_DESTINO` y LabelTraxx;
- chofer propio frente a transportista publico;
- detracciones activas y porcentajes vigentes validados por Contabilidad.

### 2. GRE Flexo aceptada

Elegir una T003 aceptada y reconstruir de extremo a extremo:

- `EMPAQUE` y `EMPAQUE_DETALLE` antes/despues;
- `SPE_DESPATCH` y `SPE_DESPATCH_ITEM`;
- `SPE_DESPATCH_RESPONSE`;
- SP oficial utilizado para cabecera, detalle y activacion;
- orden de items y campos auxiliares;
- actualizacion de `SERIENUMEROGUIAREMISION` y `ORDENGUIA`;
- origen, destino, motivo, modalidad, chofer/transportista;
- comportamiento ante rechazo y reintento.

### 3. FE Flexo aceptada

Elegir una FF03 aceptada y reconstruir:

- cabecera, detalle, adicionales y respuesta SPE;
- `AAA_GUIAFACTURADA`;
- `EMPAQUE_DETALLE.SERIENUMEROGUIAFACTURA` y `ORDENFACTURA`;
- `AAA_REGISTRO_CONTABLE`;
- forma de pago, cuotas, detraccion y vendedor;
- relacion cuando se facturan items parciales o varias guias;
- SP oficial y orden de ejecucion;
- comportamiento ante rechazo y reintento.

### 4. Baja/NCE

Tomar un caso historico confirmado y comparar antes/despues en todas las
tablas. Confirmar documentalmente con Bizlinks/SUNAT:

- que mecanismo sigue vigente para cada supuesto;
- plazos y estados de respuesta;
- limites de automatizacion del OSE;
- diferencia entre documento no otorgado y documento ya otorgado;
- que datos internos se liberan y cuales permanecen como historial.

### 5. Limites

No inventar numeros. Consultar documentacion oficial vigente y probar el
contrato Bizlinks para determinar:

- maximo de guias referenciadas por FE;
- maximo de items por GRE y por FE;
- longitud/estructura de referencias;
- si una FE puede declararse con GRE aun pendiente en el OSE;
- efecto contable y operativo de facturacion parcial.

## Orden recomendado de implementacion

1. Corregir navegacion Flexo y exponer Ajustes, GRE, Facturas y Reportes.
2. Crear endpoints read-only de catalogos usando `AAA_*`/`MOTIVOS`, con
   permisos minimos.
3. Comparar y corregir el modelo de GRE con una T003 aceptada.
4. Crear trazabilidad Flexo propia mediante migracion idempotente.
5. Implementar declaracion GRE con SP oficial, transaccion e idempotencia.
6. Actualizar `EMPAQUE_DETALLE` por item solo despues del punto de compromiso
   definido y registrar cada transicion.
7. Implementar consulta de estado y Reportes Flexo.
8. Redisenar seleccion de FE por items/saldos, incluyendo varias guias.
9. Implementar FE FF03 contra una factura aceptada de referencia.
10. Agregar modo excepcional para FE con GRE pendiente, con advertencia,
    permiso de usuario y estado visible; no activarlo por defecto.
11. Implementar NCE/baja y liberacion mediante procedimientos auditables.
12. Ejecutar E2E autorizado: LabelTraxx/empaque -> GRE -> aceptacion -> FE ->
    aceptacion -> reportes.

## Criterios minimos de terminado

- Catalogos y datos maestros salen de sus fuentes oficiales.
- Una T003 se genera desde items de empaque, queda trazada y aparece en
  Reportes con respuesta Bizlinks/SUNAT.
- Una FF03 permite seleccionar items concretos de una o varias guias, conserva
  saldos y no duplica items.
- `AAA_GUIAFACTURADA`, `AAA_REGISTRO_CONTABLE` y `EMPAQUE_DETALLE` quedan
  consistentes con la FE.
- Rechazos no bloquean permanentemente empaques ni guias.
- Los correlativos se reservan de forma segura y no chocan con el sistema
  antiguo.
- Una baja/NCE conserva historial y libera solo lo permitido despues de una
  confirmacion externa valida.
- Reportes diferencia pendiente, aceptado, rechazado, baja solicitada,
  anulado y reintento.
- Existen pruebas de mapper, rutas, idempotencia, parcialidades y rollback.
- La prueba E2E autorizada deja evidencia antes/despues por tabla.

## Estado del worktree al crear este handoff

Hay cambios locales sin commit correspondientes al cierre de facturacion FC,
incluyendo frontend, mapper, rutas, servicios, pruebas y dos archivos nuevos.
El siguiente chat debe ejecutar `git status --short` y preservar esos cambios.

No mezclar el primer commit de Flexo con los cambios FC existentes.

## Comandos de inicio

```powershell
cd D:\CODE\NewYchiscomGRE-dev
git branch --show-current
git status --short
rg -n -i "flexo|AAA_|EMPAQUE|T003|FF03" frontend/src src migrations sql tools docs
npm run migrate:status
npm test -- --run src/tests/flexoAdjustmentRoutes.test.ts
```

Para la primera auditoria, usar solo consultas `SELECT`, metadatos y
definiciones de SP. No ejecutar endpoints de declaracion ni scripts de grant.

## Prompt para continuar en otro chat

```text
Estoy en D:\CODE\NewYchiscomGRE-dev, rama dev. Lee completo primero
docs/FLEXO_FLUJO_COMPLETO_HANDOFF.md y luego revisa
CONTEXTO_CONTINUIDAD_FC_FLEXO.md como contexto secundario.

Quiero completar el flujo Flexo desde EMPAQUE/EMPAQUE_DETALLE hasta GRE T003,
factura FF03, reportes y bajas/NCE. Ya existen pantallas parciales, pero la
declaracion de GRE y FE esta bloqueada.

Empieza auditando con rg, pruebas y SQL read-only. Contrasta la hoja de ruta
del ingeniero con las tablas AAA_*, MOTIVOS, EMPAQUE, EMPAQUE_DETALLE, tablas
SPE y procedimientos oficiales. No asumas que las fuentes actuales del portal
son correctas. Identifica una T003 y una FF03 aceptadas como referencias y
reconstruye sus relaciones por item.

No hagas escrituras productivas, no declares documentos reales y no ejecutes
GRANT/UPDATE/DELETE/INSERT/ALTER sin mi autorizacion. No borres SQL manuales.
Preserva los cambios locales FC y no toques FC ni Guia 2 salvo compilacion.

Primera entrega: auditoria comprobable del estado actual, mapa tabla-campo-SP,
brechas contra el flujo informado y plan de implementacion por etapas. Luego
corrige primero la navegacion y los catalogos read-only necesarios, con pruebas.
```
