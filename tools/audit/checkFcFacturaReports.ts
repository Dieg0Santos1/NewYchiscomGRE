import { loadEnv } from '../../src/config/env.js';
import { DirectDbFcFacturaService } from '../../src/services/fcFacturaService.js';

async function main() {
  const service = new DirectDbFcFacturaService(loadEnv());
  const facturas = await service.listFacturas();
  const requestedSerie = process.argv[2]?.trim();
  const selected = requestedSerie
    ? facturas.filter((factura) => factura.serieNumeroFactura === requestedSerie)
    : facturas;

  console.log(JSON.stringify({
    count: facturas.length,
    selected: selected.length > 0 ? selected : facturas.slice(0, 1)
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
