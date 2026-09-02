import { runPendingMigrations } from './migrationRunner.js';

runPendingMigrations().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : 'Error desconocido';
  console.error(`Error ejecutando migraciones: ${message}`);
  process.exitCode = 1;
});
