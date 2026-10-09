import { useEffect, useMemo, useState } from 'react';
import { CheckCircle, FileText, RefreshCw, Search } from 'lucide-react';
import { StatusBadge } from '../components/StatusBadge';
import { todayDate } from '../data/defaults';
import { flexoService } from '../services/FlexoService';
import type {
  FlexoReportCancellation,
  FlexoReportGuide,
  FlexoReportInvoice,
  FlexoReportStatus
} from '../types/flexo';
import type { GuideStatus } from '../types/gre';

type FlexoReportTab = 'gre' | 'facturas' | 'bajas';
type FlexoStatusFilter = 'TODOS' | FlexoReportStatus;
const REPORT_PAGE_SIZE = 10;

export function FlexoReportsPage() {
  const currentDate = todayDate();
  const [tab, setTab] = useState<FlexoReportTab>(() => initialFlexoReportTab());
  const [guias, setGuias] = useState<FlexoReportGuide[]>([]);
  const [facturas, setFacturas] = useState<FlexoReportInvoice[]>([]);
  const [bajas, setBajas] = useState<FlexoReportCancellation[]>([]);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState<FlexoStatusFilter>('TODOS');
  const [dateFrom, setDateFrom] = useState(currentDate);
  const [dateTo, setDateTo] = useState(currentDate);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');
  const [page, setPage] = useState(1);
  const [updatingSerie, setUpdatingSerie] = useState<string | null>(null);

  const filteredGuides = useMemo(
    () => guias.filter((item) => matchesDocument(item, query, status, dateFrom, dateTo)),
    [dateFrom, dateTo, guias, query, status]
  );
  const filteredInvoices = useMemo(
    () => facturas.filter((item) => matchesDocument(item, query, status, dateFrom, dateTo)),
    [dateFrom, dateTo, facturas, query, status]
  );
  const filteredCancellations = useMemo(
    () => bajas.filter((item) => matchesCancellation(item, query, dateFrom, dateTo)),
    [bajas, dateFrom, dateTo, query]
  );
  const activeRows = tab === 'gre' ? filteredGuides : tab === 'facturas' ? filteredInvoices : filteredCancellations;
  const activeTotal = activeRows.length;
  const shouldPaginate = tab === 'gre' || tab === 'facturas';
  const totalPages = shouldPaginate ? Math.max(1, Math.ceil(activeTotal / REPORT_PAGE_SIZE)) : 1;
  const safePage = Math.min(page, totalPages);
  const pagedGuides = shouldPaginate && tab === 'gre' ? paginateRows(filteredGuides, safePage) : filteredGuides;
  const pagedInvoices = shouldPaginate && tab === 'facturas' ? paginateRows(filteredInvoices, safePage) : filteredInvoices;

  async function loadReports() {
    setLoading(true);
    setMessage('Cargando reportes Flexo...');

    try {
      const result = await flexoService.listReports();
      setGuias(result.guias);
      setFacturas(result.facturas);
      setBajas(result.bajas);
      setWarnings(result.warnings);
      setMessage(`GRE: ${result.guias.length}. Facturas: ${result.facturas.length}. Bajas/NCE: ${result.bajas.length}.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'No se pudo cargar reportes Flexo.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadReports();
  }, []);

  useEffect(() => {
    const syncTabFromHash = () => setTab(initialFlexoReportTab());
    window.addEventListener('hashchange', syncTabFromHash);

    return () => window.removeEventListener('hashchange', syncTabFromHash);
  }, []);

  useEffect(() => {
    setPage(1);
  }, [dateFrom, dateTo, query, status, tab]);

  useEffect(() => {
    if (page > totalPages) setPage(totalPages);
  }, [page, totalPages]);

  async function setManualSunatAccepted(row: FlexoReportGuide) {
    if (!row.manualSunatMessageAllowed) return;

    const confirmed = window.confirm(`Se registrara el mensaje de aceptacion SUNAT para ${row.serieNumero}. Continuar?`);
    if (!confirmed) return;

    setUpdatingSerie(row.serieNumero);
    setMessage(`Actualizando mensaje SUNAT para ${row.serieNumero}...`);

    try {
      await flexoService.setManualSunatAcceptedMessage(row.serieNumero);
      await loadReports();
      setMessage(`Mensaje SUNAT registrado para ${row.serieNumero}.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'No se pudo actualizar el mensaje SUNAT.');
    } finally {
      setUpdatingSerie(null);
    }
  }

  return (
    <section className="screen-panel">
      <div className="list-filters">
        <label>
          Vista
          <select value={tab} onChange={(event) => setTab(event.target.value as FlexoReportTab)}>
            <option value="gre">GRE</option>
            <option value="facturas">Facturas</option>
            <option value="bajas">Bajas/NCE</option>
          </select>
        </label>
        <label>
          Buscar
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Serie / cliente / RUC / mensaje" />
        </label>
        <label>
          Estado
          <select value={status} onChange={(event) => setStatus(event.target.value as FlexoStatusFilter)} disabled={tab === 'bajas'}>
            <option value="TODOS">Todos</option>
            <option value="PENDIENTE">Pendiente</option>
            <option value="EN_PROCESO">En proceso</option>
            <option value="ACEPTADA">Aceptada</option>
            <option value="RECHAZADA">Rechazada</option>
            <option value="ERROR">Error</option>
            <option value="ANULADA">Anulada</option>
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
        <button type="button" className="tool-button primary-tool" onClick={() => void loadReports()} disabled={loading}>
          {loading ? <RefreshCw size={16} /> : <Search size={16} />}
          Buscar
        </button>
      </div>

      {message && <div className="inline-message list-message">{message}</div>}
      {warnings.map((warning) => <div key={warning} className="inline-message list-message">{warning}</div>)}

      <div className="list-table-wrap">
        {tab === 'gre' ? <GuideTable rows={pagedGuides} updatingSerie={updatingSerie} onAccept={setManualSunatAccepted} /> : null}
        {tab === 'facturas' ? <InvoiceTable rows={pagedInvoices} /> : null}
        {tab === 'bajas' ? <CancellationTable rows={filteredCancellations} /> : null}
      </div>

      <div className="pagination-bar">
        {shouldPaginate ? (
          <>
            <button type="button" className="secondary-button compact-action" disabled={safePage <= 1} onClick={() => setPage((current) => Math.max(1, current - 1))}>
              Atras
            </button>
            <span>{activeTotal} registro(s) · pagina {safePage} de {totalPages}</span>
            <button type="button" className="secondary-button compact-action" disabled={safePage >= totalPages} onClick={() => setPage((current) => Math.min(totalPages, current + 1))}>
              Siguiente
            </button>
          </>
        ) : (
          <span>{activeTotal} registro(s)</span>
        )}
      </div>
    </section>
  );
}

function paginateRows<T>(rows: T[], page: number) {
  const start = (page - 1) * REPORT_PAGE_SIZE;
  return rows.slice(start, start + REPORT_PAGE_SIZE);
}

function initialFlexoReportTab(): FlexoReportTab {
  const query = window.location.hash.split('?')[1] ?? '';
  const requestedTab = new URLSearchParams(query).get('tab');

  return requestedTab === 'facturas' || requestedTab === 'bajas' || requestedTab === 'gre'
    ? requestedTab
    : 'gre';
}

function GuideTable({
  rows,
  updatingSerie,
  onAccept
}: {
  rows: FlexoReportGuide[];
  updatingSerie: string | null;
  onAccept: (row: FlexoReportGuide) => void;
}) {
  return (
    <table className="guide-list-table flexo-report-table flexo-gre-report-table">
      <thead>
        <tr>
          <th>GRE</th>
          <th>Fecha</th>
          <th>Cliente</th>
          <th>Estado</th>
          <th>Mensaje</th>
          <th>PDF</th>
        </tr>
      </thead>
      <tbody>
        {rows.length === 0 ? (
          <tr><td colSpan={6} className="empty-row">Sin GRE para mostrar.</td></tr>
        ) : rows.map((row) => (
          <tr key={row.serieNumero}>
            <td>{row.serieNumero}</td>
            <td>{formatDate(row.fecha)}</td>
            <td title={`${row.clienteDocumento} - ${row.clienteNombre}`}>{row.clienteDocumento} - {row.clienteNombre}</td>
            <td>
              <div className="flexo-status-actions">
                <StatusBadge status={displayStatus(row.estado)} />
                {row.manualSunatMessageAllowed ? (
                  <button
                    type="button"
                    className="accept-sunat-button"
                    onClick={() => onAccept(row)}
                    disabled={updatingSerie === row.serieNumero}
                    title="Registrar mensaje de aceptacion SUNAT"
                  >
                    <CheckCircle size={16} />
                    Aceptar
                  </button>
                ) : null}
              </div>
            </td>
            <td className="report-message-cell" title={cleanMessage(row.mensaje)}>{cleanMessage(row.mensaje)}</td>
            <td className="report-action-cell"><PdfLink available={row.pdfDisponible && row.estado === 'ACEPTADA'} href={flexoService.guidePdfUrl(row.serieNumero)} /></td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function InvoiceTable({ rows }: { rows: FlexoReportInvoice[] }) {
  return (
    <table className="guide-list-table factura-list-table flexo-report-table flexo-invoice-report-table">
      <thead>
        <tr>
          <th>Factura</th>
          <th>Fecha</th>
          <th>Cliente</th>
          <th>Estado</th>
          <th>Total</th>
          <th>Mensaje</th>
          <th>PDF</th>
        </tr>
      </thead>
      <tbody>
        {rows.length === 0 ? (
          <tr><td colSpan={7} className="empty-row">Sin facturas para mostrar.</td></tr>
        ) : rows.map((row) => (
          <tr key={row.serieNumero}>
            <td>{row.serieNumero}</td>
            <td>{formatDate(row.fecha)}</td>
            <td title={`${row.clienteDocumento} - ${row.clienteNombre}`}>{row.clienteDocumento} - {row.clienteNombre}</td>
            <td><StatusBadge status={displayStatus(row.estado)} /></td>
            <td>{row.total.toFixed(2)}</td>
            <td className="report-message-cell" title={cleanMessage(row.mensaje)}>{cleanMessage(row.mensaje)}</td>
            <td className="report-action-cell"><PdfLink available={row.pdfDisponible && row.estado === 'ACEPTADA'} href={flexoService.invoicePdfUrl(row.serieNumero)} /></td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function PdfLink({ available, href }: { available: boolean; href: string }) {
  if (!available) {
    return (
      <button type="button" className="icon-action-button" disabled title="PDF no disponible">
        <FileText size={16} />
      </button>
    );
  }

  return (
    <a className="icon-action-button" href={href} target="_blank" rel="noreferrer" title="Ver PDF">
      <FileText size={16} />
    </a>
  );
}

function CancellationTable({ rows }: { rows: FlexoReportCancellation[] }) {
  return (
    <table className="guide-list-table flexo-report-table flexo-cancel-report-table">
      <thead>
        <tr>
          <th>Documento</th>
          <th>Tipo</th>
          <th>Estado</th>
          <th>Confirmado</th>
          <th>Solicitado</th>
          <th>Motivo</th>
        </tr>
      </thead>
      <tbody>
        {rows.length === 0 ? (
          <tr><td colSpan={6} className="empty-row">Sin bajas o NCE registradas.</td></tr>
        ) : rows.map((row) => (
          <tr key={row.id}>
            <td>{row.serieNumeroDocumento}</td>
            <td>{row.tipoDocumentoOrigen} / {row.tipoBaja}</td>
            <td>{row.estado}</td>
            <td>{row.confirmadoExternamente ? 'Si' : 'No'}</td>
            <td>{formatDate(row.solicitadoEn)}</td>
            <td title={row.motivo}>{row.motivo}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function matchesDocument(
  item: FlexoReportGuide | FlexoReportInvoice,
  query: string,
  status: FlexoStatusFilter,
  dateFrom: string,
  dateTo: string
) {
  const normalized = query.trim().toLowerCase();
  const itemDate = item.fecha ? item.fecha.slice(0, 10) : '';
  const matchesQuery = !normalized || [
    item.serieNumero,
    item.clienteDocumento,
    item.clienteNombre,
    item.mensaje
  ].some((value) => value.toLowerCase().includes(normalized));
  const matchesStatus = status === 'TODOS' || item.estado === status;

  return matchesQuery && matchesStatus && matchesDate(itemDate, dateFrom, dateTo);
}

function matchesCancellation(item: FlexoReportCancellation, query: string, dateFrom: string, dateTo: string) {
  const normalized = query.trim().toLowerCase();
  const itemDate = item.solicitadoEn.slice(0, 10);
  const matchesQuery = !normalized || [
    item.serieNumeroDocumento,
    item.tipoDocumentoOrigen,
    item.tipoBaja,
    item.estado,
    item.motivo
  ].some((value) => value.toLowerCase().includes(normalized));

  return matchesQuery && matchesDate(itemDate, dateFrom, dateTo);
}

function matchesDate(itemDate: string, dateFrom: string, dateTo: string) {
  if (!itemDate) return true;
  return (!dateFrom || itemDate >= dateFrom) && (!dateTo || itemDate <= dateTo);
}

function displayStatus(status: FlexoReportStatus): GuideStatus {
  switch (status) {
    case 'ACEPTADA':
      return 'Aceptado';
    case 'RECHAZADA':
      return 'Rechazado';
    case 'ERROR':
      return 'Error';
    case 'EN_PROCESO':
      return 'En proceso';
    case 'ANULADA':
      return 'Rechazado';
    case 'PENDIENTE':
    default:
      return 'Pendiente';
  }
}

function formatDate(value: string | null) {
  if (!value) return '';

  const dateOnly = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (dateOnly) {
    return `${dateOnly[3]}/${dateOnly[2]}/${dateOnly[1]}`;
  }

  return new Date(value).toLocaleString('es-PE', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
}

function cleanMessage(value: string) {
  if (!value) return '';

  try {
    const parsed = JSON.parse(value) as { mensaje?: unknown };
    if (typeof parsed.mensaje === 'string') return parsed.mensaje;
  } catch {
    // Plain text is already useful.
  }

  return value.replace(/\s+/g, ' ').trim();
}
