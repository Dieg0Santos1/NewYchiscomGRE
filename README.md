# Backend GRE Formularios Continuos

Backend minimo para construir y validar payloads GRE de formularios continuos antes de integrarlos con la API existente y Bizlinks.

## Estado de seguridad

- `DRY_RUN=true` por defecto.
- `DRY_RUN=true` bloquea cualquier escritura experimental.
- Las migraciones se entregan como archivos SQL para revision; no se ejecutan automaticamente.
- No se crean objetos en `YCHIDB3` ni `BIZLINKS_PROD21`.
- No se usa `EMPAQUE` ni `EMPAQUE_DETALLE` para formularios continuos.
- No expone el token en logs, respuestas ni errores.
- `POST /api/gre/send-test` esta bloqueado mientras `DRY_RUN=true`.
- El envio real no debe habilitarse hasta validacion manual del codigo.

## Comandos

```bash
npm install
npm --prefix frontend install
npm run dev
npm run build:prod
npm start
npm run typecheck
npm test
```

## Produccion Windows

Para publicar frontend y backend juntos en una VM Windows 24/7, revisar:

```text
docs/PRODUCCION_WINDOWS.md
```

## Variables de entorno

Copiar `.env.example` a `.env` solo en local y reemplazar placeholders. No guardar secretos en Git.

```env
PORT=3001
NODE_ENV=development
DRY_RUN=true
EXISTING_GRE_API_URL=http://192.168.1.140:92
EXISTING_GRE_API_TOKEN=REEMPLAZAR_SOLO_EN_EL_ARCHIVO_LOCAL_ENV
GRE_REQUEST_TIMEOUT_MS=30000
```

Los datos del remitente y punto de partida viven centralizados en configuracion:

```env
GRE_REMITENTE_TIPO_DOCUMENTO=6
GRE_REMITENTE_NUMERO_DOCUMENTO=20259402965
GRE_REMITENTE_RAZON_SOCIAL=YCHIFORMAS S.A.
GRE_REMITENTE_CORREO=-
GRE_PARTIDA_UBIGEO=140109
GRE_PARTIDA_DIRECCION=AV. LUNA PIZARRO 1328-1340, LA VICTORIA
```

Las conexiones SQL se separan por responsabilidad y pueden usar usuarios distintos:

```env
GRE_FC_SQL_DATABASE=GRE_FORMULARIOS_TEST
BIZLINKS_SQL_DATABASE=BIZLINKS_PROD21
YCHI_SQL_DATABASE=YCHIDB3
```

`GRE_FC_SQL_USER`, `BIZLINKS_SQL_USER` y `YCHI_SQL_USER` deben ser cuentas de minimo privilegio. El usuario `sa` esta bloqueado por codigo.

## Endpoints

### Health

```bash
curl http://localhost:3001/health
```

### Dry-run

Valida el DTO simple y devuelve el payload completo que se enviaria a `/api/SPE_DESPATCH/declarar`, sin llamar a la API existente.

```bash
curl -X POST http://localhost:3001/api/gre/dry-run \
  -H "Content-Type: application/json" \
  -d '{
    "serieNumeroGuia": "T999-00000093",
    "fechaEmisionGuia": "2026-07-17",
    "horaEmisionGuia": "15:30:00",
    "fechaInicioTraslado": "2026-07-17",
    "fechaEntregaBienes": "2026-07-17",
    "observaciones": "",
    "correoDestinatario": "destinatario@example.com",
    "destinatario": {
      "tipoDocumentoDestinatario": "6",
      "numeroDocumentoDestinatario": "20111111111",
      "razonSocialDestinatario": "CLIENTE DE PRUEBA S.A.C."
    },
    "traslado": {
      "motivoTraslado": "01",
      "descripcionMotivoTraslado": "VENTA",
      "pesoBrutoTotalBienes": 10,
      "unidadMedidaPesoBruto": "KGM",
      "modalidadTraslado": "02",
      "numeroBultos": 10,
      "ubigeoPtoLlegada": "150101",
      "direccionPtoLlegada": "DIRECCION LLEGADA SANITIZADA",
      "codigoPtoLlegada": "1"
    },
    "conductor": {
      "tipoDocumentoConductor": "1",
      "numeroDocumentoConductor": "12345678",
      "nombreConductor": "NOMBRES",
      "apellidoConductor": "APELLIDOS",
      "numeroLicencia": "LICENCIA123"
    },
    "vehiculo": {
      "numeroPlacaVehiculoPrin": "ABC123"
    },
    "items": [
      {
        "codigoEmpaque": 0,
        "codigoProducto": "PROD001",
        "descripcion": "PRODUCTO DE PRUEBA",
        "cantidad": 1,
        "unidadMedida": "MIL",
        "importeUnitarioSinImpuesto": 1,
        "id": "ITEM-1"
      }
    ]
  }'
```

### Send-test

Implementado con protecciones, pero no habilitado por defecto.

Para que intente usar el cliente HTTP deben cumplirse todas las condiciones:

- `DRY_RUN=false`.
- Serie `T999-` con ocho digitos.
- Header `X-Confirm-Send: YES`.

No activar todavia sin autorizacion expresa.

```bash
curl -X POST http://localhost:3001/api/gre/send-test \
  -H "Content-Type: application/json" \
  -H "X-Confirm-Send: YES" \
  -d '{ "...": "mismo cuerpo del dry-run" }'
```

## Dependencia pendiente

Para formularios continuos se acepta temporalmente `codigoEmpaque: 0` en el DTO y en el payload. Falta validar con la API existente si Bizlinks/SUNAT aceptan ese valor para la primera prueba controlada.

## Endpoint experimental directo

`POST /api/gre-formularios/declarar-test` existe solo para una prueba controlada de Bizlinks sin depender de `EMPAQUE` ni `EMPAQUE_DETALLE`.

Candados obligatorios:

- `DRY_RUN=false`.
- `GRE_DIRECT_DB_INSERT_ENABLED=true`.
- Header `X-Confirm-Send: YES`.
- Header `X-Operation-Id: <UUID>` para idempotencia de la operacion.
- Serie de entrada `T999-00000000`.
- Usuario SQL distinto de `sa`.

El endpoint obtiene bloqueos SQL con `sp_getapplock` dentro de la transaccion, genera internamente el siguiente correlativo libre `T999`, valida que no exista en `SPE_DESPATCH`, contrasta las columnas del payload contra las tablas reales, inserta `SPE_DESPATCH` y `SPE_DESPATCH_ITEM`, y consulta el estado insertado. No habilita `T001` ni produccion.

Antes de insertar en Bizlinks registra `PREPARANDO` en `GRE_FORMULARIOS_TEST`; despues de confirmar la transaccion en Bizlinks registra `INSERTADO_BIZLINKS`. Si se reintenta con el mismo `X-Operation-Id`, reutiliza el resultado ya procesado.

## Migraciones propias

Los scripts estan en `migrations/GRE_FORMULARIOS_TEST/`:

- `000_create_database.sql`: crea `GRE_FORMULARIOS_TEST` si no existe.
- `001_create_gre_fc_tables.sql`: crea `GRE_FC_OPERACION`, `GRE_FC_DETALLE`, `GRE_FC_ENVIO`, `GRE_FC_EVENTO` y `GRE_FC_SCHEMA_MIGRATION`.

Ejecutarlos manualmente solo despues de revision. No deben ejecutarse contra `YCHIDB3` ni `BIZLINKS_PROD21`.
