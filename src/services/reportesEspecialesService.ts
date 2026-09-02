import type { AppConfig } from '../config/env.js';
import { createBizlinksPool, sql } from '../integrations/bizlinksSql.js';

export type FacturacionMensualParams = {
  year: number;
  month: number;
};

type FacturacionMensualRow = Record<string, unknown>;

export interface ReportesEspecialesService {
  exportFacturacionMensualExcel(params: FacturacionMensualParams): Promise<{
    filename: string;
    contentType: string;
    body: Buffer;
  }>;
}

export class DirectDbReportesEspecialesService implements ReportesEspecialesService {
  constructor(private readonly config: AppConfig) {}

  async exportFacturacionMensualExcel(params: FacturacionMensualParams) {
    const range = monthRange(params);
    const rows = await this.getFacturacionMensualRows(range.start, range.endExclusive);
    const filename = `reporte-especial-ventas-${params.year}-${String(params.month).padStart(2, '0')}.xls`;

    return {
      filename,
      contentType: 'application/vnd.ms-excel; charset=utf-8',
      body: Buffer.from(`\ufeff${toExcelHtml(rows, {
        title: 'Reporte Especial - Ventas',
        period: `${String(params.month).padStart(2, '0')}/${params.year}`,
        start: range.start,
        endExclusive: range.endExclusive
      })}`, 'utf8')
    };
  }

  private async getFacturacionMensualRows(start: string, endExclusive: string): Promise<FacturacionMensualRow[]> {
    const pool = createBizlinksPool(this.config);
    await pool.connect();

    try {
      const request = new sql.Request(pool);
      request.input('fechaInicio', sql.VarChar(19), start);
      request.input('fechaFinExclusiva', sql.VarChar(19), endExclusive);

      const result = await request.query<FacturacionMensualRow>(`
        SELECT
          e.TICKETNUM AS TICKET,
          d.CODIGOEMPAQUE AS EMPAQUE,
          h.fechaEmision AS FECHA_CREACION,
          e.VENDEDOR,
          e.RAZONSOCIALADQUIRIENTE AS NOMBRE,
          CASE
            WHEN d.DESCRIPCION LIKE '%ETIQUETA%' THEN 'ETIQUETA'
            WHEN d.DESCRIPCION LIKE '%TROQUEL%' THEN 'TROQUEL'
            WHEN d.DESCRIPCION LIKE '%CLISSE%' THEN 'CLISSE'
            ELSE 'OTROS'
          END AS TIPO,
          d.DESCRIPCION AS FORMATO,
          CASE
            WHEN d.UNIDADMEDIDA = '1000'
              THEN CAST((d.CANTIDAD / TRY_CAST(d.UNIDADMEDIDA AS DECIMAL(10, 2))) AS DECIMAL(10,2))
            ELSE d.CANTIDAD
          END AS CANTREAL,
          CASE
            WHEN d.UNIDADMEDIDA = '1000' THEN 'MILLAR'
            WHEN d.UNIDADMEDIDA = 'NIU' THEN 'UNIDAD'
            ELSE 'OTRO'
          END AS UNIDAD,
          d.SERIENUMEROGUIAFACTURA AS NUMERO_FACTURA,
          h.bl_estadoRegistro AS ESTADO,
          gf.NOTACRE AS NOTACREDITO,
          CASE
            WHEN h.tipoMoneda = 'PEN' THEN 'SOLES'
            WHEN h.tipoMoneda = 'USD' THEN 'DOLARES'
            ELSE 'OTROS'
          END AS MONEDA,
          d.IMPORTEUNITARIOSINIMPUESTO AS PRECIO_UNIT,
          REPLACE(t.venta, ',', '.') AS TIPO_CAMBIO,
          CASE
            WHEN d.MONEDA = '-100' THEN
              CASE
                WHEN d.UNIDADMEDIDA IN ('NIU', 'KGM', 'MTK') THEN
                  ((d.CANTIDAD * d.IMPORTEUNITARIOSINIMPUESTO) * CAST(REPLACE(t.venta, ',', '.') AS DECIMAL(10,2)))
                ELSE
                  (((d.CANTIDAD / TRY_CAST(d.UNIDADMEDIDA AS DECIMAL(10, 2))) * d.IMPORTEUNITARIOSINIMPUESTO) *
                    CAST(REPLACE(t.venta, ',', '.') AS DECIMAL(10,2)))
              END
            ELSE
              CASE
                WHEN d.UNIDADMEDIDA = 'NIU' THEN (d.CANTIDAD * d.IMPORTEUNITARIOSINIMPUESTO)
                ELSE ((d.CANTIDAD / TRY_CAST(d.UNIDADMEDIDA AS DECIMAL(10, 2))) * d.IMPORTEUNITARIOSINIMPUESTO)
              END
          END AS TOTAL_SOLIFICADO,
          0 AS PAGADO_SOLES,
          0 AS PAGADO_DOLARES,
          CASE
            WHEN d.MONEDA = '-100' THEN
              CASE
                WHEN d.UNIDADMEDIDA IN ('NIU', 'KGM', 'MTK') THEN
                  ((d.CANTIDAD * d.IMPORTEUNITARIOSINIMPUESTO) * CAST(REPLACE(t.venta, ',', '.') AS DECIMAL(10,2)))
                ELSE
                  (((d.CANTIDAD / TRY_CAST(d.UNIDADMEDIDA AS DECIMAL(10, 2))) * d.IMPORTEUNITARIOSINIMPUESTO) *
                    CAST(REPLACE(t.venta, ',', '.') AS DECIMAL(10,2)))
              END
            ELSE
              CASE
                WHEN d.UNIDADMEDIDA = 'NIU' THEN (d.CANTIDAD * d.IMPORTEUNITARIOSINIMPUESTO)
                ELSE ((d.CANTIDAD / TRY_CAST(d.UNIDADMEDIDA AS DECIMAL(10, 2))) * d.IMPORTEUNITARIOSINIMPUESTO)
              END
          END AS SALDO,
          'PENDIENTE' AS ESTADOFACTURA,
          ha.valor AS FECHAVENCIMIENTO,
          h.fechaEmision AS FACTURADO
        FROM BIZLINKS_PROD21.dbo.EMPAQUE_DETALLE d
        INNER JOIN BIZLINKS_PROD21.dbo.EMPAQUE e
          ON d.CODIGOEMPAQUE = e.CODIGOEMPAQUE
        INNER JOIN BIZLINKS_PROD21.dbo.SPE_EINVOICEHEADER h
          ON d.SERIENUMEROGUIAFACTURA = h.serieNumero
        INNER JOIN YCHIDB3.dbo.tbTica t
          ON CONVERT(varchar(10), h.fechaEmision, 120) = CONVERT(varchar(10), t.fecha, 120)
        INNER JOIN BIZLINKS_PROD21.dbo.SPE_EINVOICEHEADER_ADD ha
          ON d.SERIENUMEROGUIAFACTURA = ha.serieNumero
        INNER JOIN BIZLINKS_PROD21.dbo.AAA_GUIAFACTURADA gf
          ON h.serieNumero = gf.NRO_FACTURA
        WHERE h.bl_estadoRegistro = 'L'
          AND d.SERIENUMEROGUIAFACTURA LIKE '%'
          AND ha.clave = 'fechaVencimiento'
          AND h.fechaEmision >= CONVERT(datetime2, @fechaInicio, 120)
          AND h.fechaEmision < CONVERT(datetime2, @fechaFinExclusiva, 120)
        ORDER BY h.fechaEmision, d.SERIENUMEROGUIAFACTURA, d.CODIGOEMPAQUE
      `);

      return result.recordset;
    } finally {
      await pool.close();
    }
  }
}

export function monthRange(params: FacturacionMensualParams) {
  const start = `${params.year}-${String(params.month).padStart(2, '0')}-01 00:00:00`;
  const nextMonth = params.month === 12 ? 1 : params.month + 1;
  const nextMonthYear = params.month === 12 ? params.year + 1 : params.year;
  const endExclusive = `${nextMonthYear}-${String(nextMonth).padStart(2, '0')}-01 00:00:00`;

  return {
    start,
    endExclusive
  };
}

function toExcelHtml(rows: FacturacionMensualRow[], metadata: {
  title: string;
  period: string;
  start: string;
  endExclusive: string;
}) {
  const columns = rows.length > 0 ? Object.keys(rows[0]!) : defaultColumns;
  const header = columns.map((column) => `<th>${escapeHtml(column)}</th>`).join('');
  const bodyRows = rows.map((row) => {
    const cells = columns.map((column) => `<td>${formatCell(row[column])}</td>`).join('');

    return `<tr>${cells}</tr>`;
  }).join('');

  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <title>${escapeHtml(metadata.title)}</title>
  <style>
    body { font-family: Arial, sans-serif; }
    table { border-collapse: collapse; }
    th, td { border: 1px solid #999; padding: 4px 7px; font-size: 11pt; text-align: center; vertical-align: middle; }
    th { background: #e8eef7; font-weight: bold; }
    .meta td { border: 0; font-weight: bold; text-align: center; }
  </style>
</head>
<body>
  <table class="meta">
    <tr><td>${escapeHtml(metadata.title)}</td></tr>
    <tr><td>Periodo: ${escapeHtml(metadata.period)}</td></tr>
    <tr><td>Rango: ${escapeHtml(metadata.start)} hasta antes de ${escapeHtml(metadata.endExclusive)}</td></tr>
    <tr><td>Filas: ${rows.length}</td></tr>
  </table>
  <br />
  <table>
    <thead><tr>${header}</tr></thead>
    <tbody>${bodyRows}</tbody>
  </table>
</body>
</html>`;
}

function formatCell(value: unknown) {
  if (value instanceof Date) {
    return escapeHtml(value.toISOString().replace('T', ' ').slice(0, 19));
  }

  if (value === null || value === undefined) return '';

  return escapeHtml(String(value));
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const defaultColumns = [
  'TICKET',
  'EMPAQUE',
  'FECHA_CREACION',
  'VENDEDOR',
  'NOMBRE',
  'TIPO',
  'FORMATO',
  'CANTREAL',
  'UNIDAD',
  'NUMERO_FACTURA',
  'ESTADO',
  'NOTACREDITO',
  'MONEDA',
  'PRECIO_UNIT',
  'TIPO_CAMBIO',
  'TOTAL_SOLIFICADO',
  'PAGADO_SOLES',
  'PAGADO_DOLARES',
  'SALDO',
  'ESTADOFACTURA',
  'FECHAVENCIMIENTO',
  'FACTURADO'
];
