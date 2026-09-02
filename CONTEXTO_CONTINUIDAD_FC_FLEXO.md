# Contexto de continuidad - Ychiformas Facturacion

Fecha de corte: 2026-08-31

## Avance 2026-09-02 - pre-guia y guia interna FC

Se completo la auditoria read-only del flujo antiguo y se implemento en el portal la primera version protegida:

1. Pre-guia/recepcion (`tbRecepcionOT`).
2. Aceptacion de la recepcion y movimiento de ingreso (`tbGuias`/`tbDetGuias`).
3. Guia fisica/interna serie `001` o `003` (`tbDocumentos`, `tbDocumento_Guia`, `tbGuias`, `tbDetGuias`).
4. La GRE electronica `T001`/`T999` conserva los identificadores de la guia fisica en `GRE_FC_OPERACION`.

Hallazgos que deben mantenerse:

- Una guia interna puede agrupar varias recepciones y varias OT.
- `tbDocumentos.idDocumentoAnterior` solo conserva una recepcion; la relacion completa se reconstruye con `tbDetGuias.idRecepcionOT`.
- Cada recepcion aceptada tiene un movimiento de ingreso con `idDocumentos = 0` y luego un detalle de salida con `idDocumentos > 0`.
- No se debe liberar por `IDOT`: una OT puede tener recepciones parciales. La liberacion fue limitada a los `idRecepcionOT` trazados en cada detalle.
- La serie `003` usa `idTipoDocu = 39`; la busqueda de guia fisica del portal ya contempla tanto `001` como `003`.

Protecciones incorporadas:

- `FC_LEGACY_WRITE_ENABLED=false` por defecto.
- Los endpoints de escritura exigen ademas `X-Confirm-Legacy-Write: YES`.
- Los wrappers usan transaccion, `XACT_ABORT`, bloqueos de aplicacion, validacion por recepcion e idempotencia al aceptar.
- El usuario de aplicacion solo recibira `EXECUTE` sobre los wrappers; no se requieren nuevos permisos directos de INSERT/UPDATE/DELETE.
- El despliegue se separo para evitar habilitar escritura durante la instalacion:
  - `2026-09-02_fc_legacy_workflow_01_preflight_readonly.sql`: solo valida dependencias y colisiones.
  - `2026-09-02_fc_legacy_workflow_wrappers.sql`: crea los wrappers, no concede permisos y no reemplaza wrappers existentes.
  - `2026-09-02_fc_legacy_workflow_02_verify_installed_readonly.sql`: verifica instalacion y confirma que la app aun no puede ejecutarlos.
  - `2026-09-02_fc_legacy_workflow_03_grant_execute.sql`: concede solamente `EXECUTE` sobre los tres wrappers.
  Ninguno fue ejecutado durante la implementacion.

Pantallas nuevas:

- `#/fc/pre-guias`
- `#/fc/guias-internas`

UX actualizado el 2026-09-02:

- Se retiraron las tablas de 100/200 filas de la pantalla principal.
- La seleccion de OT/OV, pre-guias pendientes y recepciones se realiza en modales independientes.
- Cada modal tiene busqueda por OT, numero de OV, recepcion o cliente, encabezado fijo, scroll interno y paginacion de 15 filas.
- La pantalla principal conserva solo el formulario y un resumen de la OT/recepciones seleccionadas.
- El selector de pre-guia solo lista OT elegibles (`EstGuia N/M` con cantidad pendiente).

Secuencia pendiente para activacion controlada:

1. Ejecutar la prevalidacion read-only y comprobar `puedeInstalar = 1`.
2. Instalar los wrappers sin permisos.
3. Ejecutar la verificacion read-only y comprobar `listoParaConcederExecute = 1`.
4. Conceder `EXECUTE` con el script separado, manteniendo la bandera apagada.
5. Comprobar que las pantallas consultan correctamente.
6. Elegir una OT de prueba autorizada y capturar el estado antes de la operacion.
7. Activar temporalmente `FC_LEGACY_WRITE_ENABLED=true`, reiniciar la app y ejecutar pre-guia, aceptacion y guia interna.
8. Comparar cabecera, detalles, movimientos y estados contra el flujo antiguo.
9. Buscar la guia fisica desde la pantalla GRE, declarar la electronica y verificar los campos `idGuiaFisicaYchiscom`, `numeroGuiaFisica` e `idDocumentoYchiscom`.

Estado de despliegue al 2026-09-02 10:30 (America/Lima):

- Preflight ejecutado: 14/14 dependencias, 0 colisiones, `puedeInstalar = 1`.
- Tres wrappers instalados y con definicion visible.
- `gre_app_test` tiene `EXECUTE = 1` y `ALTER = 0` sobre los tres wrappers.
- Los tres wrappers conservan `XACT_ABORT` y `sp_getapplock`.
- `FC_LEGACY_WRITE_ENABLED` permanece en `false`; el portal no puede iniciar escrituras todavia.
- Siguiente bloqueo deliberado: el usuario debe autorizar expresamente una OT de prueba antes de activar temporalmente la bandera.

## Proyecto

Repositorio local:

`D:\CODE\NewSystemGRE`

Sistema web nuevo para centralizar guias y facturas de Ychiformas. Actualmente maneja:

- Formularios Continuos (FC)
- Inicio de replica de Flexografia (Flexo)

Nombre/header deseado del portal:

`Ychiformas - Facturacion`

Selector de rubro:

- `FC`
- `Flexo`

Color de header:

- FC: verde
- Flexo: azul

## Bases de datos principales

### GRE_FORMULARIOS_TEST

Base propia del sistema web nuevo para trazabilidad de operaciones FC.

Tablas relevantes:

- `dbo.GRE_FC_OPERACION`
- `dbo.GRE_FC_ENVIO`
- `dbo.GRE_FC_DETALLE`
- `dbo.GRE_FC_EVENTO`
- `dbo.FC_FACT_OPERACION`
- `dbo.FC_FACT_GUIA`
- `dbo.FC_FACT_DETALLE`
- `dbo.FC_FACT_ENVIO`
- `dbo.FC_FACT_EVENTO`
- `dbo.GRE_FC_SCHEMA_MIGRATION`

### BIZLINKS_PROD21

Base usada por Bizlinks/integrador.

Tablas relevantes para guias:

- `dbo.SPE_DESPATCH`
- `dbo.SPE_DESPATCH_ITEM`
- `dbo.SPE_DESPATCH_RESPONSE`

Tablas relevantes para facturas:

- `dbo.SPE_EINVOICEHEADER`
- `dbo.SPE_EINVOICEDETAIL`
- `dbo.SPE_EINVOICE_RESPONSE`
- `dbo.SPE_EINVOICEHEADER_ADD`
- `dbo.AAA_GUIAFACTURADA`

Tablas Flexo:

- `dbo.EMPAQUE`
- `dbo.EMPAQUE_DETALLE`

### YCHIDB3

Base del sistema antiguo Ychiscom.

Tablas/vistas conocidas:

- `dbo.tbDocumentos`
- `dbo.tbClieProv`
- `dbo.tbRecepcionOT`
- `dbo.VW_DETGUIA_REMISION`

Pendiente auditar para replicar flujo completo:

- Tablas de pre-guia/recepcion e inspeccion.
- Tablas exactas de guia interna serie `001`/`003`.
- Relacion entre pre-guia, guia interna, OT, items y factura.

## Flujo actual FC implementado

### Guia electronica FC

Pantalla actual:

- Busca por OT o guia fisica.
- Jala cliente/destinatario.
- Jala destino.
- Jala productos desde `VW_DETGUIA_REMISION`.
- Permite declarar GRE electronica hacia Bizlinks.

Series de guia FC:

- `T001`
- `T999` para pruebas

### Factura FC

Pantalla actual:

- Busca cliente.
- Lista GRE aceptadas por Bizlinks/SUNAT.
- Permite seleccionar guias.
- Completa datos de factura.
- Hace vista previa.
- Declara factura hacia Bizlinks.

Serie de factura FC:

- `FF01`

Guia referenciada para factura FC:

- Antes solo `T001`.
- Se agrego soporte en codigo para `T999`.

Pendiente BD:

- Aplicar migracion `005_allow_t999_fc_facturacion_guides.sql` con usuario SQL con permiso `ALTER`.
- El usuario actual de la app no pudo aplicar esa migracion porque no tiene permiso suficiente para cambiar el constraint `CK_FC_FACT_GUIA_serie`.

## Cambios recientes importantes

### Factura FC - envio a Bizlinks

Se corrigio:

- El boton `Enviar a Bizlinks` no enviaba en algunos entornos por uso directo de `crypto.randomUUID()`.
- Se agrego fallback `createOperationId()`.
- Se quito error por tipo incorrecto en parametros:
  - `BL_REINTENTO` debe ir como string `'0'`.
  - `BL_HASFILERESPONSE` debe ir como string `'0'`.

### Factura FC - correlativo

Se corrigio:

- `nextFacturaSerie()` ahora mira tanto Bizlinks como trazabilidad interna `GRE_FORMULARIOS_TEST`.
- Evita reutilizar correlativos fallidos que ya quedaron registrados.

Ultimo correlativo confirmado libre:

- `FF01-00017147`

### Factura FC - unidad de medida

Problema encontrado:

- Factura `FF01-00017146` fue rechazada.
- Comparando contra factura aceptada `FF01-00017144`, el detalle rechazado tenia `unidadMedida = MLL`.
- Facturas aceptadas usan `MIL`.

Correccion:

- `MLL` ahora se normaliza a `MIL`.
- `MILLAR` tambien se normaliza a `MIL`.
- `UND`/`UNIDAD` se normalizan a `NIU`.

### Factura FC - guia bloqueada por factura rechazada

Problema:

- Una factura rechazada en Bizlinks dejaba la guia registrada como facturada en trazabilidad.
- Eso hacia que la guia no aparezca para reintento.

Correccion:

- Si `SPE_EINVOICEHEADER.bl_estadoRegistro = 'E'`, esa factura no bloquea la guia para volver a facturar.
- Se corrigio conflicto de collation entre `GRE_FORMULARIOS_TEST` y `BIZLINKS_PROD21` usando `COLLATE DATABASE_DEFAULT`.

### T999 para facturacion FC

Se cambio:

- `FC_GRE_REFERENCIA_PATTERN` ahora acepta `T001` y `T999`.
- Busqueda de clientes/guia pendiente para factura FC ahora incluye `T001` y `T999`.
- UI ahora dice `Guias T001/T999 aceptadas pendientes`.

Migracion agregada:

`migrations/GRE_FORMULARIOS_TEST/005_allow_t999_fc_facturacion_guides.sql`

Esta cambia `CK_FC_FACT_GUIA_serie` para permitir:

```sql
serieNumeroGuia LIKE 'T001-%' OR serieNumeroGuia LIKE 'T999-%'
```

Estado:

- Pendiente de aplicar por falta de permiso `ALTER`.

## Datos de prueba recientes

### Cliente PEVISA

RUC:

`20100084768`

Guia:

`T001-00000067`

Factura rechazada:

`FF01-00017146`

Causa probable:

`unidadMedida = MLL`; ya corregido para nuevos intentos.

### Cliente Orlando Boritz

Cliente:

`ORLANDO BORITZ LLERENA DELGADO`

Documento:

`10406265574`

Guia de prueba encontrada:

`T999-00000097`

Estado:

- Aceptada.
- Pendiente para facturar.
- Unidad actual normalizada: `NIU`.

Uso esperado:

- Probar factura `FF01` referenciando guia `T999`.

## Scripts/auditorias agregadas

Ubicacion:

`tools/audit`

Scripts recientes:

- `checkFcFacturaSerie.ts`
- `checkFcFacturaOperation.ts`
- `compareInvoiceFocus.ts`
- `listBizlinksInvoiceColumns.ts`
- `listRecentFf01Invoices.ts`
- `checkFcGuideBlockQuery.ts`
- `checkGreFcFactTables.ts`

Comandos utiles:

```powershell
npx tsx tools/audit/checkFcFacturaSerie.ts FF01-00017147
npx tsx tools/audit/checkFcGuideBlockQuery.ts T001-00000067
npx tsx tools/audit/checkGreFcFactTables.ts
npm run migrate:status
```

## Pendiente inmediato antes de probar T999 en factura FC

Aplicar migracion `005` con usuario SQL con permisos:

```powershell
npm run migrate
```

Si falla por permiso, ejecutar el script SQL manualmente en SSMS con usuario admin.

Permiso minimo requerido:

```sql
USE GRE_FORMULARIOS_TEST;
GO

GRANT ALTER ON OBJECT::dbo.FC_FACT_GUIA TO [USUARIO_APP_AQUI];
GRANT VIEW DEFINITION ON OBJECT::dbo.FC_FACT_GUIA TO [USUARIO_APP_AQUI];
GRANT SELECT ON OBJECT::dbo.GRE_FC_SCHEMA_MIGRATION TO [USUARIO_APP_AQUI];
GRANT INSERT ON OBJECT::dbo.GRE_FC_SCHEMA_MIGRATION TO [USUARIO_APP_AQUI];
GO
```

## Nueva prioridad: cerrar flujo FC completo

El ingeniero indico que el sistema antiguo no solo hacia GRE/factura electronica. Antes de llegar al portal nuevo, el flujo real FC era:

1. Crear pre-guia en sistema antiguo.
2. Crear guia interna en sistema antiguo.
3. La guia interna recibe OT/items/cantidades/serie/del/al.
4. Luego en el sistema web nuevo se busca la OT o guia y se genera la GRE electronica.
5. Luego se factura.

Riesgo actual:

- El portal nuevo se esta saltando parte de la trazabilidad operativa del sistema antiguo.
- Si se reemplaza el sistema viejo sin replicar ese flujo, podria perderse historial operativo, estados, horas/procesos y relacion documental.

Objetivo nuevo:

Replicar en el portal web el flujo antiguo de FC:

- Pre-guia / recepcion e inspeccion.
- Guia interna serie `001`/`003`.
- Registro de items y cantidades.
- Relacion con OT.
- Estados equivalentes a Ychiscom.
- Luego GRE electronica Bizlinks.
- Luego factura electronica Bizlinks.

Importante:

- No inventar tablas paralelas para lo que el sistema antiguo ya usa, salvo auditoria propia.
- Primero hacer auditoria read-only de una OT/guia real de prueba para identificar tablas y columnas exactas.
- Despues implementar pantallas nuevas.

## Auditoria pendiente para flujo antiguo FC

Necesitamos rastrear una OT de prueba, idealmente de Orlando Boritz, y ver:

- Donde queda la pre-guia.
- Donde queda la guia interna.
- Que columnas cambian en `tbRecepcionOT`.
- Que filas crea/modifica en `tbDocumentos`.
- Como se relaciona `tbDocumentos` con `VW_DETGUIA_REMISION`.
- Como se guarda `Cantidad`, `Serie`, `DEL`, `AL`, `idRecepcionOT`, `idOT`, `idOrdenVenta`, `idDetGuia`.
- Que estados usa para liberar o bloquear OT/items.

Primera pregunta tecnica para el siguiente chat:

> Audita read-only el flujo antiguo FC de pre-guia y guia interna para una OT/cliente de prueba, identifica tablas/columnas y propone como replicarlo en el portal web sin perder trazabilidad.

## Procesos locales

Ultimo estado conocido:

- Backend se estuvo levantando con `npm run dev` en `http://localhost:3001`.
- Frontend Vite se estuvo usando en `http://127.0.0.1:5173/`.

Si se abre nuevo chat, verificar procesos antes de asumir que siguen activos.

Comandos:

```powershell
npm run dev
npm --prefix frontend run dev
```

## Notas de estilo/operacion

- No hacer `UPDATE`, `DELETE`, `INSERT` ni `ALTER` manual en BD sin autorizacion explicita.
- Para auditorias usar consultas read-only.
- Para cambios de esquema usar migraciones SQL idempotentes.
- Antes de enviar a Bizlinks, evitar dejar registros parciales.
- Mensajes al usuario deben ser claros, no errores genericos.
