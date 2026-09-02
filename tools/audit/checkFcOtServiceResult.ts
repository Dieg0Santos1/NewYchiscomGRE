import { loadEnv } from '../../src/config/env.js';
import { GreFormularioQueryService } from '../../src/services/greFormularioQueryService.js';

const ot = process.argv[2]?.trim() || '02600674';

async function main() {
  const service = new GreFormularioQueryService(loadEnv());
  const result = await service.searchByOt(ot);

  console.log(JSON.stringify({
    ot,
    status: result.status,
    message: result.message,
    warnings: result.warnings,
    documents: result.documents.map((document) => ({
      numeroOt: document.numeroOt,
      cliente: document.cliente,
      destinatario: document.destinatario,
      destinos: document.destinos.map((destino) => ({
        id: destino.id,
        codigoDestino: destino.codigoDestino,
        ubigeo: destino.ubigeo,
        direccion: destino.direccion
      })),
      productos: document.productos.length
    }))
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
