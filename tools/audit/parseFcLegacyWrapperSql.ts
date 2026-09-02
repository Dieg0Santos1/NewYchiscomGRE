import { readFile } from 'node:fs/promises';
import { loadEnv } from '../../src/config/env.js';
import { createYchiPool, sql } from '../../src/integrations/bizlinksSql.js';

const config = loadEnv();
const scriptNames = [
  '2026-09-02_fc_legacy_workflow_01_preflight_readonly.sql',
  '2026-09-02_fc_legacy_workflow_wrappers.sql',
  '2026-09-02_fc_legacy_workflow_02_verify_installed_readonly.sql',
  '2026-09-02_fc_legacy_workflow_03_grant_execute.sql'
];

const pool = createYchiPool(config);
await pool.connect();
const transaction = new sql.Transaction(pool);

try {
  await transaction.begin();
  await new sql.Request(transaction).batch('SET PARSEONLY ON;');
  for (const scriptName of scriptNames) {
    const scriptUrl = new URL(`../../sql/manual/${scriptName}`, import.meta.url);
    const script = await readFile(scriptUrl, 'utf8');
    const batches = script
      .split(/^\s*GO\s*$/gim)
      .map((batch) => batch.replace(/^\s*USE\s+\[YCHIDB3\];\s*/i, '').trim())
      .filter(Boolean);

    for (let index = 0; index < batches.length; index += 1) {
      await new sql.Request(transaction).batch(batches[index]!);
      console.log(`${scriptName} - batch ${index + 1}/${batches.length}: sintaxis valida`);
    }
  }
  await new sql.Request(transaction).batch('SET PARSEONLY OFF;');
  await transaction.rollback();
} catch (error) {
  try { await transaction.rollback(); } catch { /* best effort */ }
  throw error;
} finally {
  await pool.close();
}
