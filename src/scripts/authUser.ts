import { randomBytes } from 'node:crypto';
import { loadEnv } from '../config/env.js';
import { authModules, type AuthModule } from '../services/authService.js';
import { SqlAuthenticationService } from '../services/sqlAuthenticationService.js';

const args = process.argv.slice(2);

if (args.includes('--secret')) {
  console.log(randomBytes(48).toString('base64url'));
  process.exit(0);
}

const username = argument('--username').trim().toLowerCase();
const displayName = argument('--name').trim();
const requestedModules = argument('--modules').split(',').map((value) => value.trim()).filter(Boolean);
const invalidModules = requestedModules.filter((value) => !authModules.includes(value as AuthModule));
const modules = requestedModules.filter((value): value is AuthModule => authModules.includes(value as AuthModule));
const administrator = args.includes('--admin');

if (!username || !/^[a-z0-9._-]{3,80}$/.test(username)) {
  throw new Error('Use --username con 3 a 80 caracteres: letras, numeros, punto, guion o guion bajo.');
}
if (!displayName) throw new Error('Use --name con el nombre visible.');
if (invalidModules.length > 0) throw new Error(`Modulos no reconocidos: ${invalidModules.join(', ')}.`);
if (modules.length === 0) throw new Error('Use --modules con fc, flexo y/o traslado, separados por coma.');

const passwordEnvironmentName = argument('--password-env').trim();
const password = passwordEnvironmentName ? process.env[passwordEnvironmentName] ?? '' : generatePassword();
if (!password) throw new Error(`La variable ${passwordEnvironmentName} no contiene una contrasena.`);

const config = loadEnv();
const service = new SqlAuthenticationService(config);
const access = await service.createAccess({ username, displayName, password, modules, administrator }, 'provisionamiento-servidor');

console.log(`Usuario: ${access.username}`);
console.log(`Nombre: ${access.displayName}`);
console.log(`Modulos: ${access.modules.join(', ')}`);
console.log(`Administrador: ${access.administrator ? 'si' : 'no'}`);
console.log(passwordEnvironmentName ? 'Clave configurada desde variable segura' : `Clave generada: ${password}`);
console.log(`Base: ${config.greFcDb.database}`);
console.log('La clave se almaceno unicamente como hash y no puede recuperarse despues.');

function argument(name: string) {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] ?? '' : '';
}

function generatePassword() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%';
  const bytes = randomBytes(18);
  return [...bytes].map((byte) => alphabet[byte % alphabet.length]).join('');
}
