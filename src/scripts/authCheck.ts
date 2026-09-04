import { loadEnv } from '../config/env.js';
import { FileAuthenticationService } from '../services/authService.js';

const config = loadEnv();
if (!config.auth.enabled) {
  throw new Error('AUTH_ENABLED debe ser true para habilitar el inicio de sesion.');
}

new FileAuthenticationService(config);
console.log('OK: autenticacion habilitada, secreto valido y archivo de usuarios legible.');
