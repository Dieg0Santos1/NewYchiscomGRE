import { loadEnv } from '../../src/config/env.js';
import { createYchiPool, sql } from '../../src/integrations/bizlinksSql.js';

async function main() {
  const pool = createYchiPool(loadEnv());
  await pool.connect();
  try {
    const result = await new sql.Request(pool).query(`
      SET TRANSACTION ISOLATION LEVEL READ UNCOMMITTED;
      SELECT TOP (20)
        idDocumento, idTipoDocu, SeriDocu, NumeDocu, DescClieProv, formaPago,
        Moneda, Tica, Neto, Igv, Total, Observaciones, FechaEmision,
        FechaVencimiento, Estado, idEmpleado, nguia, cuenta, idDocumentoAnterior
      FROM dbo.tbDocumentos
      WHERE idTipoDocu = 1
        AND SeriDocu = 'F01'
        AND NumeDocu IN ('0017179', '0017187')
      ORDER BY NumeDocu;

      SELECT TOP (100)
        p.idPropiedades, p.tipo, p.Nombre, p.Nemonico, p.Valor, p.Descripcion
      FROM dbo.tbPropiedades p
      WHERE p.tipo = 'FPAG'
        AND p.idPropiedades IN (
          SELECT formaPago FROM dbo.tbDocumentos
          WHERE idTipoDocu = 1 AND SeriDocu = 'F01' AND NumeDocu IN ('0017179', '0017187')
        )
      ORDER BY p.idPropiedades;
    `);
    console.log(JSON.stringify({ documentos: result.recordsets[0], formasPago: result.recordsets[1] }, null, 2));
  } finally {
    await pool.close();
  }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
