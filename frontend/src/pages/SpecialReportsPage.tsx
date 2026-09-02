import { useState } from 'react';
import { Download } from 'lucide-react';

const months = [
  { value: 1, label: 'Enero' },
  { value: 2, label: 'Febrero' },
  { value: 3, label: 'Marzo' },
  { value: 4, label: 'Abril' },
  { value: 5, label: 'Mayo' },
  { value: 6, label: 'Junio' },
  { value: 7, label: 'Julio' },
  { value: 8, label: 'Agosto' },
  { value: 9, label: 'Septiembre' },
  { value: 10, label: 'Octubre' },
  { value: 11, label: 'Noviembre' },
  { value: 12, label: 'Diciembre' }
];

export function SpecialReportsPage() {
  const today = new Date();
  const defaultMonth = today.getMonth() + 1;
  const defaultYear = today.getFullYear();
  const [error, setError] = useState('');
  const [isDownloading, setIsDownloading] = useState(false);

  async function downloadReport(formData: FormData) {
    const year = String(formData.get('year') ?? defaultYear);
    const month = String(formData.get('month') ?? defaultMonth);
    const url = `/api/reportes-especiales/facturacion-mensual/export?year=${encodeURIComponent(year)}&month=${encodeURIComponent(month)}`;

    setError('');
    setIsDownloading(true);

    try {
      const response = await fetch(url);
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        throw new Error(body?.message ?? `Error HTTP ${response.status}`);
      }

      const blob = await response.blob();
      const disposition = response.headers.get('content-disposition') ?? '';
      const match = disposition.match(/filename="([^"]+)"/);
      const filename = match?.[1] ?? `reporte-especial-${year}-${month.padStart(2, '0')}.xls`;
      const href = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = href;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(href);
    } catch (downloadError) {
      setError(downloadError instanceof Error ? downloadError.message : 'No se pudo descargar el reporte.');
    } finally {
      setIsDownloading(false);
    }
  }

  return (
    <section className="screen-panel special-report-screen">
      <div className="special-report-header">
        <h1>Reportes Especiales</h1>
        <p>Reporte mensual de ventas</p>
      </div>

      <form
        className="special-report-form"
        onSubmit={(event) => {
          event.preventDefault();
          downloadReport(new FormData(event.currentTarget));
        }}
      >
        <label>
          Mes
          <select name="month" defaultValue={defaultMonth}>
            {months.map((month) => (
              <option key={month.value} value={month.value}>
                {month.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          Periodo
          <input
            name="year"
            type="number"
            min="2000"
            max="2100"
            defaultValue={defaultYear}
          />
        </label>
        <button type="submit" className="preview-button special-report-download" disabled={isDownloading}>
          <Download size={16} />
          {isDownloading ? 'Generando' : 'Descargar Excel'}
        </button>
      </form>

      {error && <div className="special-report-error">{error}</div>}
    </section>
  );
}
