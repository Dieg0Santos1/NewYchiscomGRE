import { useEffect, useMemo, useState } from 'react';
import { CheckCircle, Printer, RefreshCw, Search } from 'lucide-react';
import { StatusBadge } from '../components/StatusBadge';
import { todayDate } from '../data/defaults';
import { greTrasladoService } from '../services/GreTrasladoService';
import type { GuideStatus } from '../types/gre';
import type { TrasladoStatusResult } from '../types/traslado';

export function TrasladoReportPage() {
  const currentDate = todayDate();
  const [traslados, setTraslados] = useState<TrasladoStatusResult[]>([]);
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState<GuideStatus | 'Todos'>('Todos');
  const [dateFrom, setDateFrom] = useState(currentDate);
  const [dateTo, setDateTo] = useState(currentDate);
  const [loading, setLoading] = useState(false);
  const [updatingSerie, setUpdatingSerie] = useState<string | null>(null);
  const [message, setMessage] = useState('');

  const filteredTraslados = useMemo(() => {
    const normalized = query.trim().toLowerCase();

    return traslados.filter((traslado) => {
      const displayStatus = trasladoStatus(traslado);
      const matchesStatus = status === 'Todos' || displayStatus === status;
      const matchesQuery = !normalized || [
        traslado.serieNumeroGuia,
        traslado.operationId,
        traslado.cliente,
        traslado.numeroDocumentoCliente,
        traslado.mensaje
      ].some((value) => value?.toLowerCase().includes(normalized));
      const createdDate = traslado.creadoEn ? new Date(traslado.creadoEn) : null;
      const trasladoDate = createdDate ? toDateInputValue(createdDate) : '';
      const matchesFrom = !dateFrom || trasladoDate >= dateFrom;
      const matchesTo = !dateTo || trasladoDate <= dateTo;

      return matchesStatus && matchesQuery && matchesFrom && matchesTo;
    });
  }, [dateFrom, dateTo, query, status, traslados]);

  async function loadTraslados() {
    setLoading(true);
    setMessage('Cargando traslados T002...');

    try {
      const result = await greTrasladoService.listTraslados();
      setTraslados(result);
      setMessage(`Traslados cargados: ${result.length}.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'No se pudo cargar reportes de traslado.');
    } finally {
      setLoading(false);
    }
  }

  async function setManualSunatAccepted(traslado: TrasladoStatusResult) {
    if (!traslado.serieNumeroGuia || !traslado.manualSunatMessageAllowed) return;

    const confirmed = window.confirm(`Se registrara el mensaje de aceptacion SUNAT para ${traslado.serieNumeroGuia}. Continuar?`);
    if (!confirmed) return;

    setUpdatingSerie(traslado.serieNumeroGuia);
    setMessage(`Actualizando mensaje SUNAT para ${traslado.serieNumeroGuia}...`);

    try {
      await greTrasladoService.setManualSunatAcceptedMessage(traslado.serieNumeroGuia);
      await loadTraslados();
      setMessage(`Mensaje SUNAT registrado para ${traslado.serieNumeroGuia}.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'No se pudo actualizar el mensaje SUNAT.');
    } finally {
      setUpdatingSerie(null);
    }
  }

  useEffect(() => {
    void loadTraslados();
  }, []);

  return (
    <section className="screen-panel">
      <div className="list-filters">
        <label>
          Buscar
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Serie / cliente / RUC / mensaje"
          />
        </label>
        <label>
          SUNAT
          <select value={status} onChange={(event) => setStatus(event.target.value as GuideStatus | 'Todos')}>
            <option>Todos</option>
            <option>Pendiente</option>
            <option>En proceso</option>
            <option>Aceptado</option>
            <option>Rechazado</option>
            <option>Error</option>
          </select>
        </label>
        <label>
          Desde
          <input type="date" value={dateFrom} onChange={(event) => setDateFrom(event.target.value)} />
        </label>
        <label>
          Hasta
          <input type="date" value={dateTo} onChange={(event) => setDateTo(event.target.value)} />
        </label>
        <button type="button" className="tool-button primary-tool" onClick={() => void loadTraslados()} disabled={loading}>
          {loading ? <RefreshCw size={16} /> : <Search size={16} />}
          Buscar
        </button>
      </div>
      {message && <div className="inline-message list-message">{message}</div>}
      <div className="list-table-wrap">
        <table className="guide-list-table traslado-report-table">
          <thead>
            <tr>
              <th>Serie</th>
              <th>Fecha</th>
              <th>Bizlinks</th>
              <th>SUNAT</th>
              <th>Items</th>
              <th>Mensaje</th>
              <th>PDF</th>
              <th>Accion</th>
            </tr>
          </thead>
          <tbody>
            {filteredTraslados.length === 0 ? (
              <tr>
                <td colSpan={8} className="empty-row">
                  Sin traslados para mostrar.
                </td>
              </tr>
            ) : filteredTraslados.map((traslado) => (
              <tr key={traslado.operationId}>
                <td>{traslado.serieNumeroGuia ?? 'Pendiente'}</td>
                <td>{formatDate(traslado.creadoEn)}</td>
                <td>
                  <StatusBadge status={bizlinksStatus(traslado)} />
                </td>
                <td>
                  <StatusBadge status={trasladoStatus(traslado)} />
                </td>
                <td>{traslado.items}</td>
                <td>{cleanMessage(traslado.mensaje)}</td>
                <td>
                  {traslado.pdfDisponible && hasAcceptedMessage(traslado) && traslado.serieNumeroGuia ? (
                    <a
                      className="print-button"
                      href={greTrasladoService.pdfUrl(traslado.serieNumeroGuia)}
                      target="_blank"
                      rel="noopener noreferrer"
                      title="Abrir PDF para imprimir"
                    >
                      <Printer size={16} />
                      PDF
                    </a>
                  ) : (
                    <button type="button" className="print-button" disabled title="PDF pendiente">
                      <Printer size={16} />
                      PDF
                    </button>
                  )}
                </td>
                <td>
                  <div className="guide-actions-cell">
                    {traslado.manualSunatMessageAllowed && traslado.serieNumeroGuia ? (
                      <button
                        type="button"
                        className="accept-sunat-button"
                        onClick={() => void setManualSunatAccepted(traslado)}
                        disabled={updatingSerie === traslado.serieNumeroGuia}
                        title="Registrar mensaje de aceptacion SUNAT"
                      >
                        <CheckCircle size={16} />
                        Aceptar
                      </button>
                    ) : (
                      <span className="table-muted">-</span>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function formatDate(value: string | null) {
  if (!value) return '';

  return new Date(value).toLocaleString('es-PE', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
}

function toDateInputValue(value: Date) {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, '0');
  const day = String(value.getDate()).padStart(2, '0');

  return `${year}-${month}-${day}`;
}

function bizlinksStatus(traslado: TrasladoStatusResult): GuideStatus {
  if (traslado.estadoOperacion === 'ERROR' || traslado.estadoEnvio === 'ERROR') return 'Error';
  if (hasAcceptedMessage(traslado)) return 'Aceptado';
  if (traslado.estadoBizlinks === 'E') return 'Rechazado';
  if (traslado.estadoBizlinks === 'A' || traslado.estadoBizlinks === 'L') return 'En proceso';
  if (traslado.estadoEnvio === 'ACTIVADO' || traslado.estadoOperacion === 'ACTIVADO') return 'Enviado';

  return 'Pendiente';
}

function trasladoStatus(traslado: TrasladoStatusResult): GuideStatus {
  if (traslado.estadoOperacion === 'ERROR' || traslado.estadoEnvio === 'ERROR') return 'Error';
  if (hasAcceptedMessage(traslado)) return 'Aceptado';
  if (hasRejectedMessage(traslado)) return 'Rechazado';
  if (traslado.estadoBizlinks === 'A' || traslado.estadoBizlinks === 'L') return 'En proceso';
  if (traslado.estadoEnvio === 'ACTIVADO' || traslado.estadoOperacion === 'ACTIVADO') return 'Enviado';

  return 'Pendiente';
}

function hasAcceptedMessage(traslado: TrasladoStatusResult) {
  const message = traslado.mensaje ?? '';
  return Boolean(traslado.estadoProceso?.includes('AC_03') || (/aceptad[ao]/i.test(message) && /"codigo"\s*:\s*"0"/i.test(message)));
}

function hasRejectedMessage(traslado: TrasladoStatusResult) {
  const message = traslado.mensaje ?? '';
  if (!message.trim() || hasAcceptedMessage(traslado)) return false;
  const code = responseCode(message);

  return Boolean(
    (code && code !== '0') ||
    /rechazad[ao]|fuera de fecha|fecha\/hora mayor|no existe|error|observad[ao]|inv[a\u00e1]lid[ao]/i.test(message)
  );
}

function cleanMessage(value: string | null) {
  if (!value) return '';

  try {
    const parsed = JSON.parse(value) as { mensaje?: unknown };
    if (typeof parsed.mensaje === 'string' && parsed.mensaje.trim()) return parsed.mensaje;
  } catch {
    // Plain text is shown as-is after whitespace cleanup.
  }

  return value.replace(/\s+/g, ' ').trim();
}

function responseCode(value: string) {
  try {
    const parsed = JSON.parse(value) as { codigo?: unknown };
    return typeof parsed.codigo === 'string' ? parsed.codigo.trim() : '';
  } catch {
    return '';
  }
}
