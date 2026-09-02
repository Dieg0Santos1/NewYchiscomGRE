import { printMigrationStatus } from './migrationRunner.js';

printMigrationStatus().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : 'Error desconocido';
  console.error(`Error consultando migraciones: ${message}`);
  process.exitCode = 1;
});
