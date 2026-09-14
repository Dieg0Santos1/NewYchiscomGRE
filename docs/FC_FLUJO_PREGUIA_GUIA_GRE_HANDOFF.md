# Handoff Codex - Flujo FC: pre-guia -> guia interna -> GRE

Fecha de corte: 2026-09-14  
Repositorio local auditado: `D:\CODE\NewYchiscomGRE-dev`  
Rama esperada: `dev`

## Objetivo

Terminar y probar el flujo completo de Formularios Continuos:

1. Crear pre-guia FC desde OT/OV pendiente.
2. Aceptar pre-guia / generar recepcion.
3. Crear guia interna/fisica serie `001` o `003`.
4. Buscar esa guia fisica desde GRE.
5. Declarar GRE electronica `T001`/`T003` en Bizlinks.

La meta no es parchar pantallas aisladas, sino dejar el flujo operativo y trazable.

## Estado actual del flujo

### Frontend

Implementado en:

- `frontend/src/pages/FcLegacyWorkflowPage.tsx`
- `frontend/src/services/FcLegacyWorkflowService.ts`
- `frontend/src/types/fcLegacy.ts`
- `frontend/src/pages/NewGuidePage.tsx`
- `frontend/src/services/GreFormularioService.ts`

Rutas relevantes:

- `/fc/pre-guias`: pantalla de pre-guias FC.
- `/fc/guias-internas`: pantalla de guias internas FC.
- `/guias/nueva`: declaracion GRE electronica FC.

La navegacion FC muestra:

- Pre-guias
- Guias internas
- GRE
- Facturas
- Reportes
- Especiales

La pantalla `FcLegacyWorkflowPage` ya maneja dos modos:

- `pre-guide`: cliente -> OT/OV pendiente -> cantidad/rango -> crear pre-guia.
- `internal-guide`: cliente -> OT recepcionada -> guia interna -> detalle editable -> crear guia fisica.

### Backend

Implementado en:

- `src/routes/fcLegacyWorkflowRoutes.ts`
- `src/services/fcLegacyWorkflowService.ts`
- `src/routes/greFormularioRoutes.ts`
- `src/services/greFormularioQueryService.ts`
- `src/services/greFormularioDeclararTestService.ts`

Endpoints FC legacy:

- `GET /api/fc-legacy/capabilities`
- `GET /api/fc-legacy/catalogs`
- `GET /api/fc-legacy/clients`
- `GET /api/fc-legacy/internal-guides/next`
- `GET /api/fc-legacy/work-orders`
- `GET /api/fc-legacy/receptions`
- `POST /api/fc-legacy/pre-guides`
- `POST /api/fc-legacy/pre-guides/:id/accept`
- `POST /api/fc-legacy/internal-guides`

Endpoints GRE usados al final:

- `GET /api/gre-formularios/work-orders?type=guia`
- `POST /api/gre-formularios/preview`
- `POST /api/gre-formularios/declarar-test`

Las escrituras legacy usan wrappers SQL en `YCHIDB3` y requieren header:

```text
X-Confirm-Legacy-Write: YES
```

La bandera `FC_LEGACY_WRITE_ENABLED` ya no debe ser el controlador operativo del flujo. En `src/config/env.ts`, `fcLegacyWriteEnabled` queda `true` por compatibilidad.

## Estado de base de datos observado

Auditoria read-only ejecutada contra las conexiones configuradas:

### GRE_FORMULARIOS

Tablas FC detectadas:

- `GRE_FC_OPERACION`
- `GRE_FC_DETALLE`
- `GRE_FC_ENVIO`
- `GRE_FC_EVENTO`
- `GRE_FC_DESTINO_MANUAL`
- `GRE_FC_SCHEMA_MIGRATION`
- `FC_FACT_OPERACION`
- `FC_FACT_GUIA`
- `FC_FACT_DETALLE`
- `FC_FACT_ENVIO`
- `FC_FACT_EVENTO`

Migraciones aplicadas detectadas:

- `001_create_gre_fc_tables`
- `002_add_activation_states`
- `003_add_ychiscom_future_fields`
- `004_create_fc_facturacion_tables`
- `005_allow_t999_fc_facturacion_guides`
- `006_create_gre_traslado_tables`
- `007_update_gre_traslado_public_transport`
- `008_add_traslado_transformation_and_recipients`
- `009_restrict_traslado_recipients_to_providers`
- `010_enable_traslado_pickup_reason`
- `011_enable_especiales_auth_module`

### YCHIDB3

Wrappers FC detectados:

- `dbo.GRE_WEB_CREAR_PREGUIA_FC`
- `dbo.GRE_WEB_ACEPTAR_PREGUIA_FC`
- `dbo.GRE_WEB_CREAR_GUIA_INTERNA_FC`

Permisos detectados para usuario app `gre_app_test`:

- `EXECUTE` sobre `GRE_WEB_CREAR_PREGUIA_FC`: si.
- `EXECUTE` sobre `GRE_WEB_ACEPTAR_PREGUIA_FC`: si.
- `EXECUTE` sobre `GRE_WEB_CREAR_GUIA_INTERNA_FC`: si.

Muestras recientes en `GRE_FC_OPERACION/GRE_FC_ENVIO` existen con estado `ACTIVADO`, pero varias no tienen `numeroGuiaFisica`, por lo que no necesariamente prueban el flujo completo desde guia interna.

## Scripts SQL: que conservar y que archivar

No borrar automaticamente scripts manuales: varios son evidencia de produccion o rollback operativo. Recomendacion:

### Conservar para FC legacy

- `sql/manual/2026-09-02_fc_legacy_workflow_01_preflight_readonly.sql`
- `sql/manual/2026-09-02_fc_legacy_workflow_wrappers.sql`
- `sql/manual/2026-09-02_fc_legacy_workflow_02_verify_installed_readonly.sql`
- `sql/manual/2026-09-02_fc_legacy_workflow_03_grant_execute.sql`
- `sql/manual/2026-09-09_fc_legacy_workflow_04_upgrade_wrapper_catalogs.sql`
- `sql/manual/2026-09-09_fc_legacy_workflow_05_grant_description_catalogs_readonly.sql`

### Conservar para GRE FC / destinos

- `sql/manual/2026-09-11_gre_fc_destino_manual.sql`

### No pertenecen al flujo FC pre-guia -> guia -> GRE; mover a archivo si se quiere limpiar

- `sql/manual/2026-08-26_flexo_normalizar_rolls_a_niu.sql`
- `sql/manual/2026-09-09_flexo_adjustments_unidad_grant.sql`
- `sql/manual/2026-09-02_pdf_job_download_grant_readonly.sql`
- `sql/manual/2026-09-04_portal_auth_tables.sql`
- `sql/manual/2026-09-04_portal_auth_update_credentials_permissions.sql`
- `sql/manual/2026-09-04_portal_auth_verify_readonly.sql`
- `sql/manual/2026-09-11_gre_t002_corregir_a_privado_y_reencolar.sql`
- `sql/manual/2026-09-11_gre_t002_reemitir_privadas_por_fecha_2108.sql`
- `sql/manual/2026-09-11_gre_t002_reencolar_7727_sin_codigo_llegada.sql`
- `sql/manual/2026-09-11_gre_t002_reencolar_7786_solo_fecha_entrega_publico.sql`
- `sql/manual/2026-09-11_gre_t002_reencolar_rechazadas_publicas.sql`
- `sql/manual/2026-09-11_gre_traslado_public_transport_header_update_grant.sql`

### Historicos de facturacion FC; no borrar sin validar

- `sql/manual/2026-08-14_fc_facturacion_permissions.sql`
- `sql/manual/2026-08-14_fc_pricing_audit_permissions.sql`
- `sql/manual/2026-07-30_fix_unibell_ruc_historical_source.sql`
- `sql/manual/2026-07-30_fix_unibell_ruc_t999_00000099.sql`

Si se limpia el repo, preferir mover a `sql/manual/archive/` en un commit separado, no eliminar.

## Hallazgos / riesgos actuales

1. El flujo esta implementado, pero falta una prueba real end-to-end con una OT autorizada y comparacion contra Ychiscom antiguo.
2. La pantalla de GRE ya puede buscar guia fisica `001/003` usando `type=guia`, pero hay que confirmar que la guia interna creada por el wrapper aparece inmediatamente en esa busqueda.
3. La trazabilidad existe en backend (`idGuiaFisicaYchiscom`, `numeroGuiaFisica`, `idDocumentoYchiscom`), pero se debe verificar que se grabe cuando la GRE se declara desde una guia fisica y no como `FRONT_MANUAL`.
4. Catalogos de motivos pueden caer a defaults si `dbo.tbMotivoTraslado` no existe o no hay permisos. Eso no debe bloquear, pero conviene mapear el motivo real requerido por la guia interna.
5. `logs/` esta sin versionar y puede limpiarse manualmente; no aporta al flujo.
6. Hay muchos cambios locales mezclados en FC, Flexo, Guia 2, Auth y GRE. Antes de tocar FC, revisar `git status` y evitar sobrescribir trabajo no relacionado.

## Proxima secuencia tecnica recomendada

### 1. Probar read-only primero

Verificar:

- catalogos FC cargan sin 500;
- busqueda de cliente para pre-guia devuelve clientes con OT pendiente;
- busqueda de OT/OV pendiente devuelve registros;
- busqueda de cliente para guia interna devuelve clientes con recepciones listas;
- busqueda de recepciones `ready` devuelve OV y OT con descripcion, medida y copias.

### 2. Probar escritura legacy controlada

Con una OT autorizada:

1. Capturar estado previo en `YCHIDB3`:
   - `tbRecepcionOT`
   - `tbGuias`
   - `tbDetGuias`
   - `tbDocumentos`
   - `tbDocumento_Guia`
2. Crear pre-guia desde `/fc/pre-guias`.
3. Aceptar pre-guia si aplica.
4. Crear guia interna desde `/fc/guias-internas`.
5. Confirmar correlativo y documento fisico serie `001` o `003`.

### 3. Probar GRE electronica desde guia fisica

1. Entrar a `/guias/nueva`.
2. Buscar por guia fisica `001-xxxxxxx` o `003-xxxxxxx`.
3. Confirmar que carga:
   - destinatario;
   - destino;
   - OC si existe;
   - productos;
   - trazabilidad Ychiscom.
4. Vista previa.
5. Declarar.
6. Verificar en `GRE_FORMULARIOS`:
   - `GRE_FC_OPERACION.origenOperacion`
   - `idGuiaFisicaYchiscom`
   - `numeroGuiaFisica`
   - `idDocumentoYchiscom`
   - `GRE_FC_ENVIO.estadoEnvio`

### 4. Si falla

No parchar de frente. Primero ubicar si falla en:

- wrapper YCHIDB3;
- permisos del usuario app;
- busqueda/read model;
- mapper de Bizlinks;
- SP oficial Bizlinks;
- UI que no envia trazabilidad.

## Comandos utiles para el siguiente chat

```powershell
cd D:\CODE\NewYchiscomGRE-dev
git status --short
rg -n "fc-legacy|FcLegacy|GRE_WEB_CREAR|searchByPhysicalGuide|trazabilidadYchiscom|idGuiaFisicaYchiscom" frontend/src src sql/manual
npm test -- --run fcLegacy greFormulario
```

Para levantar local:

```powershell
npm install
npm run dev
```

Si ya hay procesos ocupando puertos, cerrarlos de forma especifica, no matar procesos generales.

## Prompt compacto para otro chat de Codex

```text
Estoy en D:\CODE\NewYchiscomGRE-dev, rama dev. Lee primero docs/FC_FLUJO_PREGUIA_GUIA_GRE_HANDOFF.md y CONTEXTO_CONTINUIDAD_FC_FLEXO.md. Necesito terminar el flujo FC completo: /fc/pre-guias -> /fc/guias-internas -> /guias/nueva declarando GRE desde guia fisica 001/003. No borres SQL manuales; si limpias, archiva en commit separado. No toques Guia 2/T002 ni Flexo salvo que esté rompiendo compilación. Primero audita con rg y pruebas, luego corrige solo lo necesario. Verifica que la GRE declarada desde guia fisica grabe trazabilidad Ychiscom: idGuiaFisicaYchiscom, numeroGuiaFisica e idDocumentoYchiscom.
```

