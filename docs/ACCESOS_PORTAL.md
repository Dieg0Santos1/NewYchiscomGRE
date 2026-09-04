# Accesos y permisos del portal

El portal admite tres permisos independientes:

- `traslado`: módulo **Guía 2** (serie T002).
- `fc`: formularios continuos, pre-guías, guías internas, facturación y reportes FC.
- `flexo`: guías y facturación Flexo.

Los accesos se almacenan en las tablas `GRE_PORTAL_*` de la base configurada mediante `GRE_FC_SQL_*`. YCHIDB3 y BIZLINKS permanecen fuera de este almacenamiento y no reciben escrituras de autenticación.

La contraseña se conserva únicamente como hash `scrypt`. La auditoría registra altas e intentos de inicio de sesión, pero nunca contraseñas ni hashes.

## Instalación inicial

1. Revise y ejecute manualmente:

   `sql/manual/2026-09-04_portal_auth_tables.sql`

2. Genere una clave de firma:

```powershell
npm run --silent auth:user -- --secret
```

3. Configure el `.env` del servidor:

```dotenv
AUTH_ENABLED=true
AUTH_SESSION_SECRET=VALOR_GENERADO_DE_32_CARACTERES_O_MAS
AUTH_SESSION_HOURS=12
AUTH_COOKIE_SECURE=false
```

Use `AUTH_COOKIE_SECURE=true` solamente cuando el sitio se publique mediante HTTPS.

## Crear el SuperAdmin inicial

La primera cuenta administrativa se provisiona desde el servidor. La contraseña se captura sin incluirla en los argumentos del proceso:

```powershell
$credential = Get-Credential -UserName SuperAdmin -Message "Credencial inicial del portal"
$env:AUTH_NEW_USER_PASSWORD = $credential.GetNetworkCredential().Password
npm run auth:user -- --username SuperAdmin --name "SuperAdmin" --modules fc,flexo,traslado --admin --password-env AUTH_NEW_USER_PASSWORD
Remove-Item Env:AUTH_NEW_USER_PASSWORD
```

El comando inserta el usuario, sus tres permisos y el evento de auditoría en una sola transacción.

## Panel de administración

El panel `Administración > Accesos` permite al SuperAdmin:

- consultar cuentas, estado, módulos, creador y fecha;
- crear credenciales permanentes con una contraseña elegida;
- asignar acceso a FC, Flexo y/o Guía 2.

El backend valida el permiso administrativo independientemente de la visibilidad del botón. Los usuarios normales reciben HTTP 403 al intentar acceder a estas API.

## Despliegue

```powershell
git pull origin dev
npm install
npm run build:prod
npm run db:check
npm run auth:check
Restart-Service GRE_Formularios_Continuos
```

Compruebe el servicio:

```powershell
Get-Service GRE_Formularios_Continuos
Invoke-RestMethod http://localhost:3001/health
```

La base GRE es la fuente única: ya no es necesario copiar ni respaldar `config/auth-users.json`.
