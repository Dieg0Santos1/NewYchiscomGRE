import { loadEnv } from '../../src/config/env.js';
import { createBizlinksPool, createYchiPool, sql } from '../../src/integrations/bizlinksSql.js';

async function main() {
  const config = loadEnv();
  const ychiPool = createYchiPool(config);
  const bizlinksPool = createBizlinksPool(config);
  await ychiPool.connect();
  await bizlinksPool.connect();

  try {
    const formasPago = await new sql.Request(ychiPool).query<{
      Nombre: string | null;
      Valor: string | null;
      Descripcion: string | null;
    }>(`
      SELECT TOP (200)
        Nombre,
        Valor,
        Descripcion
      FROM dbo.tbPropiedades
      WHERE tipo = 'FPAG'
        AND ISNULL(Valor, '') NOT LIKE '(obsoleto)%'
        AND ISNULL(Nombre, '') NOT LIKE '(obsoleto)%'
      ORDER BY
        CASE WHEN Nombre LIKE 'Contado%' THEN 0 ELSE 1 END,
        Nombre;
    `);

    const variants = await new sql.Request(bizlinksPool).query<{
      tipoMoneda: string | null;
      pagoNegociable: string | null;
      diasVencimiento: number | null;
      facturas: number;
      ejemplo: string;
    }>(`
      SELECT
        h.tipoMoneda,
        ISNULL(neg.valor, 'NULL') AS pagoNegociable,
        DATEDIFF(day, h.fechaEmision, CONVERT(date, venc.valor)) AS diasVencimiento,
        COUNT(*) AS facturas,
        MAX(h.SERIENUMERO) AS ejemplo
      FROM dbo.SPE_EINVOICEHEADER h
      LEFT JOIN dbo.SPE_EINVOICEHEADER_ADD neg
        ON neg.SERIENUMERO = h.SERIENUMERO
       AND neg.TIPODOCUMENTO = h.TIPODOCUMENTO
       AND neg.clave = 'facturaPagoNegociable'
      LEFT JOIN dbo.SPE_EINVOICEHEADER_ADD venc
        ON venc.SERIENUMERO = h.SERIENUMERO
       AND venc.TIPODOCUMENTO = h.TIPODOCUMENTO
       AND venc.clave = 'fechaVencimiento'
      WHERE h.SERIENUMERO LIKE 'FF03-%'
        AND h.TIPODOCUMENTO = '01'
        AND h.bl_estadoRegistro = 'L'
        AND h.tipoOperacion = '0101'
      GROUP BY
        h.tipoMoneda,
        ISNULL(neg.valor, 'NULL'),
        DATEDIFF(day, h.fechaEmision, CONVERT(date, venc.valor))
      ORDER BY facturas DESC;
    `);

    console.log(JSON.stringify({
      safety: 'READ_ONLY',
      formasPago: formasPago.recordset
        .map((row) => ({
          nombre: row.Nombre?.trim() ?? '',
          valor: row.Valor?.trim() ?? '',
          descripcion: row.Descripcion?.trim() ?? '',
          diasParseados: Number(row.Descripcion) || 0,
          soporteUnaCuota: /^\d+$/.test(row.Descripcion?.trim() ?? '')
        }))
        .filter((row) => /Factura|Credito|Contado|adelantado/i.test(`${row.nombre} ${row.valor}`)),
      acceptedPaymentVariants: variants.recordset
    }, null, 2));
  } finally {
    await bizlinksPool.close();
    await ychiPool.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
