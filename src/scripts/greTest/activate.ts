import { createInterface } from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { loadEnv } from '../../config/env.js';
import { GreFormularioActivationService, validateActivationGuards } from '../../services/greFormularioActivationService.js';
import { getSingleUuidArg } from './args.js';

const operationIdArg = getSingleUuidArg(process.argv.slice(2), 'gre:test:activate');

if (!operationIdArg.ok) {
  console.error(operationIdArg.message);
  process.exit(1);
}

const operationId = operationIdArg.value;
const config = loadEnv();

try {
  validateActivationGuards(config);
} catch (error) {
  console.error(`ERROR: ${error instanceof Error ? error.message : 'Validacion de seguridad fallida.'}`);
  process.exit(1);
}

const rl = createInterface({ input, output });

try {
  const confirmation = await rl.question(`Escriba YES para activar solo la guia existente T999-00000096 de operationId ${operationId}: `);

  if (confirmation !== 'YES') {
    console.error('Activacion cancelada: confirmacion distinta de YES.');
    process.exit(1);
  }
} finally {
  rl.close();
}

const service = new GreFormularioActivationService(config);

try {
  const result = await service.activateExistingGuide(operationId);
  console.log(JSON.stringify(result, null, 2));
} catch (error) {
  console.error(JSON.stringify({
    ok: false,
    operationId,
    activated: false,
    error: error instanceof Error ? error.message : 'Error desconocido'
  }, null, 2));
  process.exitCode = 1;
}
