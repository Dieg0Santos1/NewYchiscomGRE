import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { GreInputDto } from '../../schemas/greInputSchema.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..', '..', '..');
const stateDir = path.join(projectRoot, '.gre-test');
const previewPath = path.join(stateDir, 'last-preview.json');

export type GreTestPreviewState = {
  operationId: string;
  createdAt: string;
  endpoint: string;
  headers: {
    'Content-Type': 'application/json';
    'X-Confirm-Send': 'YES';
    'X-Operation-Id': string;
  };
  dto: GreInputDto;
};

export async function savePreviewState(state: GreTestPreviewState) {
  await fs.mkdir(stateDir, { recursive: true });
  await fs.writeFile(previewPath, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
}

export async function loadPreviewState() {
  const raw = await fs.readFile(previewPath, 'utf8');
  return JSON.parse(raw) as GreTestPreviewState;
}

export function getPreviewPath() {
  return previewPath;
}
