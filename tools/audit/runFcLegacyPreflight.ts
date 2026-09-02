import { readFile } from 'node:fs/promises';
import { loadEnv } from '../../src/config/env.js';
import { createYchiPool } from '../../src/integrations/bizlinksSql.js';

const scriptUrl = new URL('../../sql/manual/2026-09-02_fc_legacy_workflow_01_preflight_readonly.sql', import.meta.url);
const script = await readFile(scriptUrl, 'utf8');
const batches = script
  .split(/^\s*GO\s*$/gim)
  .map((batch) => batch.trim())
  .filter(Boolean);

const pool = createYchiPool(loadEnv());
await pool.connect();
try {
  for (const batch of batches) {
    const result = await pool.request().batch(batch);
    for (const recordset of result.recordsets as unknown as Array<Array<Record<string, unknown>>>) {
      console.log(JSON.stringify(Array.from(recordset), null, 2));
    }
  }
} finally {
  await pool.close();
}
