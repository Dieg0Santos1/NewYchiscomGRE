import { loadEnv } from '../../src/config/env.js';
import { DirectDbFcFacturaService } from '../../src/services/fcFacturaService.js';

async function main() {
  const service = new DirectDbFcFacturaService(loadEnv());
  const facturas = await service.listFacturas();

  console.log(JSON.stringify({
    count: facturas.length,
    first: facturas[0] ?? null
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
