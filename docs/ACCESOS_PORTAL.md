# Accesos y permisos del portal

El portal admite tres permisos independientes:

- `traslado`: módulo **Guía 2** (serie T002).
- `fc`: flujo de formularios continuos, pre-guías, guías internas, facturación y reportes FC.
- `flexo`: guías y facturación Flexo.

Una cuenta puede recibir uno o varios permisos. La validación se realiza tanto en la interfaz como en la API. El backend reemplaza el encabezado `X-User` con el usuario autenticado para mantener una identidad confiable en la trazabilidad.

## Configuración inicial en el servidor

Genere una clave de firma:

```powershell
npm run --silent auth:user -- --secret
```

Copie el valor generado al `.env` del servidor y configure:

```dotenv
AUTH_ENABLED=true
AUTH_SESSION_SECRET=VALOR_GENERADO_DE_32_CARACTERES_O_MAS
AUTH_USERS_FILE=config/auth-users.json
AUTH_SESSION_HOURS=12
AUTH_COOKIE_SECURE=false
```

Use `AUTH_COOKIE_SECURE=true` solamente cuando el sitio se publique mediante HTTPS. El archivo `config/auth-users.json` está excluido de Git y contiene únicamente hashes de contraseña.

## Crear la cuenta de Mary

Ejecute desde la carpeta desplegada:

```powershell
npm run auth:user -- --username mary --name "Mary" --modules traslado
```

El comando muestra una contraseña generada una sola vez. Entréguela de forma privada; no la copie en Git, chats grupales ni documentos compartidos.

Después de crear o cambiar usuarios, reinicie el servicio:

```powershell
npm run auth:check
Restart-Service GRE_Formularios_Continuos
```

## Crear otros perfiles

Solo FC y Flexo:

```powershell
npm run auth:user -- --username usuario --name "Nombre Apellido" --modules fc,flexo
```

Acceso a los tres módulos:

```powershell
npm run auth:user -- --username administrador --name "Administrador" --modules fc,flexo,traslado
```

Para renovar la contraseña o cambiar permisos de una cuenta existente:

```powershell
npm run auth:user -- --username mary --name "Mary" --modules traslado --replace
```

El comando genera una nueva contraseña y deja inválida la anterior después de reiniciar el servicio.

## Panel de administración

El panel `Administración > Accesos` permite al SuperAdmin:

- consultar las cuentas activas y sus módulos;
- crear credenciales permanentes con una contraseña elegida;
- asignar acceso a FC, Flexo y/o Guía 2.

Las contraseñas se almacenan exclusivamente como hash `scrypt` y nunca se devuelven a la interfaz. Cada alta registra fecha y usuario administrador creador.

El SuperAdmin inicial se provisiona una sola vez desde el servidor. Para evitar escribir la contraseña en los argumentos del proceso, cárguela mediante una variable de entorno temporal:

```powershell
$credential = Get-Credential -UserName SuperAdmin -Message "Credencial inicial del portal"
$env:AUTH_NEW_USER_PASSWORD = $credential.GetNetworkCredential().Password
npm run auth:user -- --username SuperAdmin --name "SuperAdmin" --modules fc,flexo,traslado --admin --password-env AUTH_NEW_USER_PASSWORD
Remove-Item Env:AUTH_NEW_USER_PASSWORD
```

El archivo `config/auth-users.json` debe conservarse entre despliegues; no debe publicarse en Git ni reemplazarse al copiar una nueva versión.

## Despliegue

```powershell
git pull origin dev
npm install
npm --prefix frontend install
npm run build:prod
npm run db:check
npm run auth:check
Restart-Service GRE_Formularios_Continuos
```

Compruebe que el servicio esté activo y que la pantalla de acceso aparezca:

```powershell
Get-Service GRE_Formularios_Continuos
Invoke-RestMethod http://localhost:3001/health
```
