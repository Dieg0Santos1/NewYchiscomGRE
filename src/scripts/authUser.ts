import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { authModules, hashPassword, type AuthModule, type AuthUserRecord } from '../services/authService.js';

const args = process.argv.slice(2);

if (args.includes('--secret')) {
  console.log(randomBytes(48).toString('base64url'));
  process.exit(0);
}

const username = argument('--username').trim().toLowerCase();
const displayName = argument('--name').trim();
const requestedModules = argument('--modules')
  .split(',')
  .map((value) => value.trim())
  .filter(Boolean);
const invalidModules = requestedModules.filter((value) => !authModules.includes(value as AuthModule));
const modules = requestedModules.filter((value): value is AuthModule => authModules.includes(value as AuthModule));

if (!username || !/^[a-z0-9._-]{3,80}$/.test(username)) {
  throw new Error('Use --username con 3 a 80 caracteres: letras, numeros, punto, guion o guion bajo.');
}
if (!displayName) throw new Error('Use --name con el nombre visible.');
if (invalidModules.length > 0) throw new Error(`Modulos no reconocidos: ${invalidModules.join(', ')}.`);
if (modules.length === 0) throw new Error('Use --modules con fc, flexo y/o traslado, separados por coma.');

const usersFile = resolve(process.env.AUTH_USERS_FILE || 'config/auth-users.json');
const users = loadExistingUsers(usersFile);
const existingIndex = users.findIndex((user) => user.username.toLowerCase() === username);
if (existingIndex >= 0 && !args.includes('--replace')) {
  throw new Error(`El usuario ${username} ya existe. Use --replace para renovar su clave y permisos.`);
}

const password = generatePassword();
const record: AuthUserRecord = {
  username,
  displayName,
  passwordHash: hashPassword(password),
  modules: [...new Set(modules)],
  active: true
};

if (existingIndex >= 0) users[existingIndex] = record;
else users.push(record);

mkdirSync(dirname(usersFile), { recursive: true });
const temporaryFile = `${usersFile}.tmp`;
writeFileSync(temporaryFile, `${JSON.stringify({ users }, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
renameSync(temporaryFile, usersFile);

console.log(`Usuario: ${username}`);
console.log(`Nombre: ${displayName}`);
console.log(`Modulos: ${record.modules.join(', ')}`);
console.log(`Clave temporal: ${password}`);
console.log(`Archivo: ${usersFile}`);
console.log('Guarde la clave ahora: no se almacena en texto plano y no puede recuperarse despues.');

function argument(name: string) {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] ?? '' : '';
}

function loadExistingUsers(file: string): AuthUserRecord[] {
  if (!existsSync(file)) return [];

  const parsed = JSON.parse(readFileSync(file, 'utf8')) as { users?: AuthUserRecord[] };
  if (!Array.isArray(parsed.users)) throw new Error(`Archivo de usuarios invalido: ${file}`);
  return parsed.users;
}

function generatePassword() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%';
  const bytes = randomBytes(18);
  return [...bytes].map((byte) => alphabet[byte % alphabet.length]).join('');
}
