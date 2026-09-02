import { randomUUID } from 'node:crypto';
import { loadEnv } from '../../config/env.js';
import { getGreDefaults } from '../../config/greDefaults.js';
import { mapGreInputToPayload } from '../../mappers/grePayloadMapper.js';
import { toSpeDespatchProcedurePlan } from '../../mappers/speDespatchProcedureMapper.js';
import { greInputSchema } from '../../schemas/greInputSchema.js';
import { buildControlledGreTestDto } from './payload.js';
import { getPreviewPath, savePreviewState } from './state.js';

const config = loadEnv();
const dto = greInputSchema.parse(buildControlledGreTestDto());
const operationId = randomUUID();
const endpoint = `http://localhost:${config.port}/api/gre-formularios/declarar-test`;
const payload = mapGreInputToPayload(dto, getGreDefaults(config));
const procedurePlan = toSpeDespatchProcedurePlan(payload);

await savePreviewState({
  operationId,
  createdAt: new Date().toISOString(),
  endpoint,
  headers: {
    'Content-Type': 'application/json',
    'X-Confirm-Send': 'YES',
    'X-Operation-Id': operationId
  },
  dto
});

console.log(JSON.stringify({
  ok: true,
  mode: 'preview',
  writesDatabase: false,
  operationId,
  endpoint,
  savedPreview: getPreviewPath(),
  request: {
    method: 'POST',
    url: endpoint,
    headers: {
      'Content-Type': 'application/json',
      'X-Confirm-Send': 'YES',
      'X-Operation-Id': operationId
    },
    body: dto
  },
  apiPayloadPreview: payload,
  procedureParamsPreview: procedurePlan,
  expectedProcedureFlow: [
    'dbo.USP_CabeceraGuia',
    'dbo.USP_DetalleGuia por cada item',
    'dbo.USP_DocRef solo si existen documentos relacionados',
    'dbo.USP_EnvioGuia despues de validar encabezado, items, estado N y ausencia de respuesta'
  ],
  note: 'El correlativo real T999 se reserva dentro del endpoint durante gre:test:send. El preview no inserta ni ejecuta procedimientos.'
}, null, 2));
