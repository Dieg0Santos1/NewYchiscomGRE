# Despliegue en Windows 24/7

Objetivo: publicar el sistema en una VM Windows como `http://192.168.1.140:94/#/`.

## 1. Preparar la carpeta

Copiar el proyecto a la VM, por ejemplo:

```powershell
D:\Apps\NewSystemGRE
```

Instalar Node.js LTS en la VM y luego ejecutar:

```powershell
cd D:\Apps\NewSystemGRE
npm install
npm --prefix frontend install
npm run build:prod
```

## 2. Configurar `.env`

Crear `D:\Apps\NewSystemGRE\.env` basado en `.env.example`.

Valores productivos esperados:

```env
PORT=94
NODE_ENV=production
SERVE_FRONTEND=true
FRONTEND_DIST_PATH=frontend/dist

DRY_RUN=false
GRE_DIRECT_DB_INSERT_ENABLED=true

GRE_FC_SQL_DATABASE=GRE_FORMULARIOS
YCHI_SQL_DATABASE=YCHIDB3
BIZLINKS_SQL_DATABASE=BIZLINKS_PROD21
```

Usar usuarios SQL de minimo privilegio. No usar `sa`.

## 3. Verificar antes del servicio

```powershell
cd D:\Apps\NewSystemGRE
npm run db:check
npm start
```

En otra consola o navegador:

```text
http://localhost:94/health
http://localhost:94/#/
```

Detener con `Ctrl+C` antes de instalar el servicio.

## 4. Instalar como servicio con NSSM

Descargar NSSM en la VM y ubicar `nssm.exe`, por ejemplo:

```text
C:\Tools\nssm\nssm.exe
```

Instalar servicio:

```powershell
C:\Tools\nssm\nssm.exe install GRE_Formularios_Continuos
```

En la ventana de NSSM:

- Path: ruta de `node.exe`, por ejemplo `C:\Program Files\nodejs\node.exe`
- Startup directory: `D:\Apps\NewSystemGRE`
- Arguments: `dist\src\server.js`

En la pestana `I/O`, configurar logs:

- Output: `D:\Apps\NewSystemGRE\logs\service-out.log`
- Error: `D:\Apps\NewSystemGRE\logs\service-error.log`

Crear carpeta de logs si no existe:

```powershell
New-Item -ItemType Directory -Force D:\Apps\NewSystemGRE\logs
```

Iniciar servicio:

```powershell
Start-Service GRE_Formularios_Continuos
```

Validar:

```text
http://192.168.1.140:94/health
http://192.168.1.140:94/#/
```

## 5. Firewall

Si no abre desde otra PC, habilitar puerto 94:

```powershell
New-NetFirewallRule -DisplayName "GRE Formularios Continuos 94" -Direction Inbound -Protocol TCP -LocalPort 94 -Action Allow
```

## 6. Actualizaciones

Para desplegar una nueva version:

```powershell
Stop-Service GRE_Formularios_Continuos
cd D:\Apps\NewSystemGRE
npm install
npm --prefix frontend install
npm run build:prod
Start-Service GRE_Formularios_Continuos
```

## 7. Notas de separacion

Este sistema muestra sus guias desde `GRE_FC_*` y trabaja con serie `T001`.
No modifica el sistema de flexografia ni sus carpetas.

