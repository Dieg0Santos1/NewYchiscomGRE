import { createInterface } from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { loadEnv } from '../../config/env.js';
import { greInputSchema } from '../../schemas/greInputSchema.js';
import { assertControlledGreTestDtoIsCurrent } from './payload.js';
import { loadPreviewState } from './state.js';

const config = loadEnv();

if (config.dryRun) {
  console.error('ERROR: gre:test:send requiere DRY_RUN=false.');
  process.exit(1);
}

if (!config.directDbInsertEnabled) {
  console.error('ERROR: gre:test:send requiere GRE_DIRECT_DB_INSERT_ENABLED=true.');
  process.exit(1);
}

const preview = await loadPreviewState();
const dto = greInputSchema.parse(preview.dto);
assertControlledGreTestDtoIsCurrent(dto);
const rl = createInterface({ input, output });

try {
  const confirmation = await rl.question(`Escriba YES para enviar una sola vez operationId ${preview.operationId}: `);

  if (confirmation !== 'YES') {
    console.error('Envio cancelado: confirmacion distinta de YES.');
    process.exit(1);
  }
} finally {
  rl.close();
}

const response = await fetch(preview.endpoint, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'X-Confirm-Send': 'YES',
    'X-Operation-Id': preview.operationId,
    'X-User': 'gre:test:send'
  },
  body: JSON.stringify(dto)
});
const body = await response.json().catch(() => null) as unknown;

console.log(JSON.stringify({
  ok: response.ok,
  statusCode: response.status,
  operationId: preview.operationId,
  serieNumeroGuia: typeof body === 'object' && body !== null && 'generatedSerieNumeroGuia' in body
    ? (body as { generatedSerieNumeroGuia?: unknown }).generatedSerieNumeroGuia
    : null,
  result: body
}, null, 2));

if (!response.ok) {
  process.exitCode = 1;
}
