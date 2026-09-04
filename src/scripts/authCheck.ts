import { loadEnv } from '../config/env.js';
import { SqlAuthenticationService } from '../services/sqlAuthenticationService.js';

const config = loadEnv();
if (!config.auth.enabled) {
  throw new Error('AUTH_ENABLED debe ser true para habilitar el inicio de sesion.');
}

const service = new SqlAuthenticationService(config);
const accesses = await service.listAccesses();
if (!accesses.some((access) => access.active && access.administrator)) {
  throw new Error('No existe un SuperAdmin activo en la base de datos.');
}
console.log(`OK: autenticacion SQL habilitada; ${accesses.length} acceso(s) y al menos un SuperAdmin activo.`);
