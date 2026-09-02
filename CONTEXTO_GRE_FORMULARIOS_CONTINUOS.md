# Contexto técnico — GRE de formularios continuos (Ychiformas)

## Objetivo

Construir un backend nuevo para emitir GRE de **formularios continuos**. El backend debe leer datos desde SQL Server (`YCHIDB3`), completar datos de traslado, construir el JSON validado y llamar al endpoint existente:

```text
POST http://192.168.1.140:92/api/SPE_DESPATCH/declarar
```

No debe insertar directamente en `SPE_DESPATCH` ni `SPE_DESPATCH_ITEM`.

## Hallazgos comprobados

- Frontend existente: Angular compilado (`APP-GUIAREMISION`).
- API existente: .NET 6 compilada (`API-GUIAREMISION`).
- No se dispone del código fuente limpio.
- El botón **Declarar** llama a `/api/SPE_DESPATCH/declarar` con JSON y header `token`.
- La prueba `T999-00000091` devolvió HTTP 200 y luego fue aceptada por SUNAT.
- El insert directo no fue recogido por Bizlinks.
- El payload correcto usa:

```text
bl_estadoRegistro = N
bl_origen = W
bl_reintento = 0
bl_hasFileResponse = 0
```

## Arquitectura

```text
Frontend nuevo
   -> Backend nuevo Node.js + TypeScript
      -> lectura de YCHIDB3
      -> validación y mapeo GRE
      -> POST a la API existente
         -> Bizlinks
            -> SUNAT
```

El token solo debe vivir en el backend y en variables de entorno.

## Series

```text
T999 = pruebas
T001 = formularios continuos en producción
T003 = flexografía
```

Durante la primera fase, rechazar cualquier serie que no sea `T999`.

## Fase 1: backend mínimo

Crear:

1. `GET /health`
2. `POST /api/gre/dry-run`
   - valida datos;
   - construye el payload;
   - no envía nada.
3. `POST /api/gre/send-test`
   - solo llama a la API real si `DRY_RUN=false`;
   - la serie empieza por `T999-`;
   - existe el header `X-Confirm-Send: YES`.
4. Cliente HTTP aislado en `src/integrations/existingGreClient.ts`.
5. Validación con Zod.
6. Logs sanitizados.
7. Timeout y manejo de errores.
8. Pruebas con Vitest.
9. `.env.example` y `.gitignore`.

No conectar todavía a SQL Server en esta fase.

## Payload validado

El endpoint recibe una cabecera, `spE_DESPATCH_ITEM[]` y `SPE_DESPATCH_DOCRELACIONADO[]`.

Ejemplo sanitizado:

```json
{
  "tipoDocumentoRemitente": "6",
  "numeroDocumentoRemitente": "20259402965",
  "serieNumeroGuia": "T999-00000093",
  "tipoDocumentoGuia": "09",
  "bl_estadoRegistro": "N",
  "bl_reintento": 0,
  "bl_origen": "W",
  "bl_hasFileResponse": 0,
  "fechaEmisionGuia": "2026-07-17",
  "horaEmisionGuia": "15:30:00",
  "fechaInicioTraslado": "2026-07-17",
  "fechaEntregaBienes": "2026-07-17",
  "observaciones": "",
  "razonSocialRemitente": "YCHIFORMAS S.A.",
  "correoRemitente": "-",
  "correoDestinatario": "destinatario@ejemplo.com",
  "numeroDocumentoDestinatario": "RUC_DESTINATARIO",
  "tipoDocumentoDestinatario": "6",
  "razonSocialDestinatario": "RAZON SOCIAL DESTINATARIO",
  "motivoTraslado": "01",
  "descripcionMotivoTraslado": "VENTA",
  "pesoBrutoTotalBienes": "10",
  "unidadMedidaPesoBruto": "KGM",
  "modalidadTraslado": "02",
  "numeroBultos": "10",
  "ubigeoPtoPartida": "140109",
  "direccionPtoPartida": "AV. LUNA PIZARRO 1328-1340, LA VICTORIA",
  "ubigeoPtoLLegada": "UBIGEO_LLEGADA",
  "direccionPtoLLegada": "DIRECCION LLEGADA",
  "codigoPtollegada": "1",
  "tipoDocumentoConductor": "1",
  "numeroDocumentoConductor": "DNI_CONDUCTOR",
  "nombreConductor": "NOMBRES",
  "apellidoConductor": "APELLIDOS",
  "numeroLicencia": "LICENCIA",
  "numeroPlacaVehiculoPrin": "PLACA",
  "serieGuiaBaja": "",
  "codigoGuiaBaja": "",
  "tipoGuiaBaja": "",
  "numeroDocumentoRelacionado": "",
  "codigoDocumentoRelacionado": "",
  "numeroDocumentoEstablecimiento": "",
  "tipoDocumentoEstablecimiento": "",
  "razonSocialEstablecimiento": "",
  "numeroRucTransportista": "",
  "tipoDocumentoTransportista": "",
  "razonSocialTransportista": "",
  "numeroRegistroMTC": "",
  "indTransbordoProgramado": "",
  "indRetornoVehiculoEnvaseVacio": "",
  "indRetornoVehiculoVacio": "",
  "indTrasVehiculoCatM1L": "",
  "indRegVehiculoyCond": "",
  "indTrasladoTotalDAMoDS": "",
  "numeroContenedor1": "",
  "numeroContenedor2": "",
  "numeroPrecinto1": "",
  "numeroPrecinto2": "",
  "pesoBrutoTotalItem": "",
  "unidadMedidaPesoBrutoItem": "",
  "sustentoPesoBrutoTotal": "",
  "bL_SOURCEFILE": "",
  "bl_createdAt": null,
  "spE_DESPATCH_ITEM": [
    {
      "codigoEmpaque": 0,
      "codigoProducto": "CODIGO_PRODUCTO",
      "descripcion": "DESCRIPCION PRODUCTO",
      "cantidad": "1",
      "unidadMedida": "MIL",
      "moneda": "-100",
      "tipoCambio": null,
      "importeUnitarioSinImpuesto": 1,
      "serieNumeroGuiaRemision": null,
      "serieNumeroGuiaFactura": null,
      "ordenguia": null,
      "ordenfactura": null,
      "id": "ID_INTERNO_UNICO",
      "unidadmedida": "MIL",
      "codigo": "CODIGO_PRODUCTO",
      "cliente": "RUC_DESTINATARIO"
    }
  ],
  "SPE_DESPATCH_DOCRELACIONADO": []
}
```

El DTO real tiene otros campos opcionales vacíos. El mapper debe centralizar sus valores predeterminados.

## Dependencia pendiente

Flexografía envía `codigoEmpaque` con un ID real. Formularios continuos no utiliza `EMPAQUE`.

La primera prueba del backend nuevo debe verificar si la API acepta:

```json
"codigoEmpaque": 0
```

No asumir el resultado. Registrar HTTP, respuesta y estado posterior de Bizlinks/SUNAT.

## Fase 2: SQL Server

Después de validar el envío manual:

- conexión de solo lectura a `YCHIDB3`;
- repositorios para OT, cliente, productos, cantidades y direcciones;
- consultas parametrizadas;
- nunca utilizar `sa`;
- nunca escribir en la base;
- opcionalmente conexión de solo lectura a `BIZLINKS_PROD21` para consultar estado, respuesta y errores.

## Acceso a la base remota

SQL Server no necesita Workbench. Workbench corresponde a MySQL.

El escritorio remoto es solo una forma de entrar a la computadora. El backend podrá conectarse directamente si dispone de:

- IP o hostname del servidor SQL;
- nombre de instancia, si aplica;
- puerto TCP, normalmente 1433;
- acceso por LAN o VPN;
- firewall habilitado;
- usuario SQL dedicado de solo lectura;
- base exacta y tablas/vistas autorizadas.

Si el servidor SQL no acepta conexiones desde tu laptop, el backend deberá ejecutarse dentro de la red de la empresa o en la misma computadora/servidor.

## Datos que deben pedirse al ingeniero

1. Servidor/IP e instancia de SQL Server.
2. Puerto.
3. Nombre exacto de la base `YCHIDB3`.
4. Usuario de solo lectura, no `sa`.
5. Tablas o vistas de:
   - OT;
   - cliente;
   - productos;
   - cantidades;
   - direcciones;
   - factura o documento relacionado.
6. Máquina donde se desplegará el backend.
7. Forma oficial de obtener/renovar el token de la API existente.
8. Endpoint de consulta de estado/PDF/XML/CDR, si existe.

## Seguridad

- Rotar el token que quedó expuesto durante la investigación.
- Rotar la contraseña SQL antigua si sigue activa.
- No guardar secretos en Git.
- No exponer el token al frontend.
- Envío real desactivado por defecto.
- No implementar anulaciones con `DELETE`.

## Variables de entorno

```env
PORT=3001
NODE_ENV=development
DRY_RUN=true
EXISTING_GRE_API_URL=http://192.168.1.140:92
EXISTING_GRE_API_TOKEN=REEMPLAZAR_EN_LOCAL
GRE_REQUEST_TIMEOUT_MS=30000

YCHIDB3_SQL_SERVER=REEMPLAZAR
YCHIDB3_SQL_PORT=1433
YCHIDB3_SQL_DATABASE=YCHIDB3
YCHIDB3_SQL_USER=USUARIO_SOLO_LECTURA
YCHIDB3_SQL_PASSWORD=REEMPLAZAR
YCHIDB3_SQL_ENCRYPT=false
YCHIDB3_SQL_TRUST_SERVER_CERTIFICATE=true

BIZLINKS_SQL_SERVER=REEMPLAZAR
BIZLINKS_SQL_PORT=1433
BIZLINKS_SQL_DATABASE=BIZLINKS_PROD21
BIZLINKS_SQL_USER=USUARIO_SOLO_LECTURA
BIZLINKS_SQL_PASSWORD=REEMPLAZAR
```

## Stack

- Node.js LTS
- TypeScript
- Express
- Zod
- Axios o fetch nativo
- Pino
- Vitest
- `mssql` en la fase 2

## Criterios de aceptación de la fase 1

- `npm run dev` inicia el proyecto.
- `GET /health` responde 200.
- `dry-run` produce el payload sin enviar.
- `send-test` se bloquea con `DRY_RUN=true`.
- `send-test` se bloquea sin `X-Confirm-Send: YES`.
- Solo acepta T999.
- Rechaza cantidad cero o negativa.
- Rechaza campos obligatorios incompletos.
- El token nunca aparece en logs o respuestas.
- Typecheck y tests pasan.
- No existe escritura directa a SQL Server.
