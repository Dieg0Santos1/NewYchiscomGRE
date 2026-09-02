import { useEffect, useMemo, useState } from 'react';
import { CheckCircle, Printer, RefreshCw, RotateCcw, Search } from 'lucide-react';
import { StatusBadge } from '../components/StatusBadge';
import { todayDate } from '../data/defaults';
import { facturaFcService } from '../services/FacturaFcService';
import { greFormularioService } from '../services/GreFormularioService';
import type { FcFacturaStatusResult } from '../types/factura';
import type { GuideStatus, GuideStatusResult } from '../types/gre';

type ReportDocumentType = 'guias' | 'facturas';

export function GuideListPage() {
  const currentDate = todayDate();
  const [guides, setGuides] = useState<GuideStatusResult[]>([]);
  const [facturas, setFacturas] = useState<FcFacturaStatusResult[]>([]);
  const [documentType, setDocumentType] = useState<ReportDocumentType>('guias');
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState<GuideStatus | 'Todos'>('Todos');
  const [dateFrom, setDateFrom] = useState(currentDate);
  const [dateTo, setDateTo] = useState(currentDate);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [updatingSerie, setUpdatingSerie] = useState<string | null>(null);
  const [releasingSerie, setReleasingSerie] = useState<string | null>(null);
  const [message, setMessage] = useState('');

  const filteredGuides = useMemo(() => {
    const normalized = query.trim().toLowerCase();

    return guides.filter((guide) => {
      const displayStatus = sunatStatus(guide);
      const matchesStatus = status === 'Todos' || displayStatus === status;
      const matchesQuery = !normalized || [
        guide.serieNumeroGuia,
        guide.operationId,
        guide.mensaje
      ].some((value) => value?.toLowerCase().includes(normalized));
      const createdDate = guide.creadoEn ? new Date(guide.creadoEn) : null;
      const guideDate = createdDate ? toDateInputValue(createdDate) : '';
      const matchesFrom = !dateFrom || guideDate >= dateFrom;
      const matchesTo = !dateTo || guideDate <= dateTo;

      return matchesStatus && matchesQuery && matchesFrom && matchesTo;
    });
  }, [dateFrom, dateTo, guides, query, status]);
  const filteredFacturas = useMemo(() => {
    const normalized = query.trim().toLowerCase();

    return facturas.filter((factura) => {
      const displayStatus = facturaStatus(factura);
      const matchesStatus = status === 'Todos' || displayStatus === status;
      const matchesQuery = !normalized || [
        factura.serieNumeroFactura,
        factura.operationId,
        factura.cliente,
        factura.numeroDocumentoCliente,
        factura.mensaje
      ].some((value) => value?.toLowerCase().includes(normalized));
      const createdDate = factura.creadoEn ? new Date(factura.creadoEn) : null;
      const invoiceDate = createdDate ? toDateInputValue(createdDate) : '';
      const matchesFrom = !dateFrom || invoiceDate >= dateFrom;
      const matchesTo = !dateTo || invoiceDate <= dateTo;

      return matchesStatus && matchesQuery && matchesFrom && matchesTo;
    });
  }, [dateFrom, dateTo, facturas, query, status]);
  const activeTotal = documentType === 'guias' ? filteredGuides.length : filteredFacturas.length;
  const totalPages = Math.max(1, Math.ceil(activeTotal / 10));
  const visibleGuides = filteredGuides.slice((page - 1) * 10, page * 10);
  const visibleFacturas = filteredFacturas.slice((page - 1) * 10, page * 10);
  const documentLabel = documentType === 'guias' ? 'guia(s)' : 'factura(s)';

  async function loadGuides() {
    setLoading(true);
    setMessage('Cargando guias...');

    try {
      const [guideResult, facturaResult] = await Promise.all([
        greFormularioService.listGuides(),
        facturaFcService.listFacturas()
      ]);
      setGuides(guideResult);
      setFacturas(facturaResult);
      setPage(1);
      setMessage(`Guias cargadas: ${guideResult.length}. Facturas cargadas: ${facturaResult.length}.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'No se pudo cargar el listado.');
    } finally {
      setLoading(false);
    }
  }

  async function setManualSunatAccepted(guide: GuideStatusResult) {
    if (!guide.serieNumeroGuia || !guide.manualSunatMessageAllowed) return;

    const confirmed = window.confirm(`Se registrara el mensaje de aceptacion SUNAT para ${guide.serieNumeroGuia}. Continuar?`);
    if (!confirmed) return;

    setUpdatingSerie(guide.serieNumeroGuia);
    setMessage(`Actualizando mensaje SUNAT para ${guide.serieNumeroGuia}...`);

    try {
      await greFormularioService.setManualSunatAcceptedMessage(guide.serieNumeroGuia);
      await loadGuides();
      setMessage(`Mensaje SUNAT registrado para ${guide.serieNumeroGuia}.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'No se pudo actualizar el mensaje SUNAT.');
    } finally {
      setUpdatingSerie(null);
    }
  }

  async function releaseWorkOrders(guide: GuideStatusResult) {
    if (!guide.serieNumeroGuia || guide.items <= 0) return;

    const confirmed = window.confirm(
      `Se liberaran las OT de la guia ${guide.serieNumeroGuia} para que puedan usarse en una nueva GRE. Esta accion no anula SUNAT ni modifica Bizlinks. Continuar?`
    );
    if (!confirmed) return;

    setReleasingSerie(guide.serieNumeroGuia);
    setMessage(`Liberando OT de ${guide.serieNumeroGuia}...`);

    try {
      const result = await greFormularioService.releaseWorkOrders(guide.serieNumeroGuia);
      await loadGuides();
      setMessage(result.reused
        ? `Las OT de ${guide.serieNumeroGuia} ya estaban liberadas.`
        : `OT liberadas para ${guide.serieNumeroGuia}. Registros actualizados: ${result.affectedRows}.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'No se pudo liberar las OT.');
    } finally {
      setReleasingSerie(null);
    }
  }

  function formatSerie(value: string | null) {
    return value ?? 'Pendiente';
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

  function cleanMessage(value: string | null) {
    if (!value) return '';

    try {
      const parsed = JSON.parse(value) as { mensaje?: unknown; codigo?: unknown };
      const message = typeof parsed.mensaje === 'string' ? parsed.mensaje : '';

      if (message) return message;
    } catch {
      // plain text messages are already useful enough for the user.
    }

    return value
      .replace(/^The UPDATE statement conflicted.*$/i, 'No se pudo actualizar el estado interno. Revise con sistemas.')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function bizlinksStatus(guide: GuideStatusResult): GuideStatus {
    if (guide.estadoBizlinks === 'E') return 'Rechazado';
    if (guide.estadoBizlinks === 'A' || guide.estadoBizlinks === 'L') return 'Aceptado';
    if (guide.estadoEnvio === 'ACTIVADO' || guide.estadoOperacion === 'ACTIVADO') return 'Enviado';
    if (guide.estado === 'ERROR') return 'Error';

    return 'Pendiente';
  }

  function sunatStatus(guide: GuideStatusResult): GuideStatus {
    if (guide.estado === 'ACEPTADA') return 'Aceptado';
    if (guide.respuestaSunat && guide.estado === 'RECHAZADA') return 'Rechazado';
    if (guide.estado === 'ERROR') return 'Error';
    if (guide.estadoBizlinks === 'A' || guide.estadoBizlinks === 'L' || guide.estado === 'EN_PROCESO') return 'En proceso';

    return 'Pendiente';
  }

  function facturaStatus(factura: FcFacturaStatusResult): GuideStatus {
    if (factura.estadoBizlinks === 'E' || factura.estadoOperacion === 'RECHAZADA') return 'Rechazado';
    if (factura.estadoOperacion === 'ERROR') return 'Error';
    if (factura.estadoBizlinks === 'A' || factura.estadoBizlinks === 'L' || factura.estadoOperacion === 'ACEPTADA') return 'Aceptado';
    if (factura.estadoEnvio === 'ACTIVADO' || factura.estadoOperacion === 'ACTIVADO') return 'En proceso';

    return 'Pendiente';
  }

  useEffect(() => {
    void loadGuides();
  }, []);

  useEffect(() => {
    setPage(1);
  }, [dateFrom, dateTo, documentType, query, status]);

  useEffect(() => {
    if (page > totalPages) setPage(totalPages);
  }, [page, totalPages]);

  return (
    <section className="screen-panel">
      <div className="list-filters">
        <label>
          Documento
          <select value={documentType} onChange={(event) => setDocumentType(event.target.value as ReportDocumentType)}>
            <option value="guias">Guias</option>
            <option value="facturas">Facturas</option>
          </select>
        </label>
        <label>
          Buscar
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={documentType === 'guias' ? 'Serie / operationId / mensaje' : 'Serie / cliente / RUC / mensaje'}
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
        <button type="button" className="tool-button primary-tool" onClick={() => void loadGuides()} disabled={loading}>
          {loading ? <RefreshCw size={16} /> : <Search size={16} />}
          Buscar
        </button>
      </div>
      {message && <div className="inline-message list-message">{message}</div>}
      <div className="list-table-wrap">
        {documentType === 'guias' ? (
          <table className="guide-list-table">
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
              {visibleGuides.length === 0 ? (
                <tr>
                  <td colSpan={8} className="empty-row">
                    Sin guias para mostrar.
                  </td>
                </tr>
              ) : (
                visibleGuides.map((guide) => (
                  <tr key={guide.operationId} className={guide.workOrdersReleased ? 'guide-row-released' : undefined}>
                    <td>{formatSerie(guide.serieNumeroGuia)}</td>
                    <td>{formatDate(guide.creadoEn)}</td>
                    <td>
                      <StatusBadge status={bizlinksStatus(guide)} />
                    </td>
                    <td>
                      <StatusBadge status={sunatStatus(guide)} />
                    </td>
                    <td>{guide.items}</td>
                    <td>{cleanMessage(guide.mensaje)}</td>
                    <td>
                      {guide.pdfDisponible && guide.serieNumeroGuia ? (
                        <a
                          className="print-button"
                          href={greFormularioService.pdfUrl(guide.serieNumeroGuia)}
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
                        {guide.workOrdersReleased ? (
                          <span className="released-label">OT liberada</span>
                        ) : null}
                        {!guide.workOrdersReleased && guide.manualSunatMessageAllowed && guide.serieNumeroGuia ? (
                          <button
                            type="button"
                            className="accept-sunat-button"
                            onClick={() => void setManualSunatAccepted(guide)}
                            disabled={updatingSerie === guide.serieNumeroGuia}
                            title="Registrar mensaje de aceptacion SUNAT"
                          >
                            <CheckCircle size={16} />
                            Aceptar
                          </button>
                        ) : null}
                        {!guide.workOrdersReleased && guide.serieNumeroGuia && guide.items > 0 ? (
                          <button
                            type="button"
                            className="release-ot-button"
                            onClick={() => void releaseWorkOrders(guide)}
                            disabled={releasingSerie === guide.serieNumeroGuia}
                            title="Liberar OT para volver a generar guia"
                          >
                            <RotateCcw size={16} />
                            Liberar OT
                          </button>
                        ) : null}
                        {!guide.workOrdersReleased && !guide.manualSunatMessageAllowed && (!guide.serieNumeroGuia || guide.items <= 0) ? (
                          <span className="table-muted">-</span>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        ) : (
          <table className="guide-list-table">
            <thead>
              <tr>
                <th>Serie</th>
                <th>Fecha</th>
                <th>Cliente</th>
                <th>Bizlinks</th>
                <th>SUNAT</th>
                <th>Items</th>
                <th>Total</th>
                <th>Mensaje</th>
                <th>PDF</th>
              </tr>
            </thead>
            <tbody>
              {visibleFacturas.length === 0 ? (
                <tr>
                  <td colSpan={9} className="empty-row">
                    Sin facturas para mostrar.
                  </td>
                </tr>
              ) : visibleFacturas.map((factura) => (
                <tr key={factura.operationId}>
                  <td>{factura.serieNumeroFactura}</td>
                  <td>{formatDate(factura.creadoEn)}</td>
                  <td>{factura.numeroDocumentoCliente} - {factura.cliente}</td>
                  <td>
                    <StatusBadge status={facturaStatus(factura)} />
                  </td>
                  <td>
                    <StatusBadge status={facturaStatus(factura)} />
                  </td>
                  <td>{factura.items}</td>
                  <td>{factura.total.toFixed(2)}</td>
                  <td>{cleanMessage(factura.mensaje)}</td>
                  <td>
                    {factura.pdfDisponible ? (
                      <a
                        className="print-button"
                        href={facturaFcService.pdfUrl(factura.serieNumeroFactura)}
                        target="_blank"
                        rel="noopener noreferrer"
                        title="Abrir PDF de factura"
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
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      <div className="pagination-bar">
        <button type="button" className="secondary-button" disabled={page <= 1} onClick={() => setPage((current) => Math.max(1, current - 1))}>
          Atras
        </button>
        <span>
          Pagina {page} de {totalPages} - {activeTotal} {documentLabel}
        </span>
        <button type="button" className="secondary-button" disabled={page >= totalPages} onClick={() => setPage((current) => Math.min(totalPages, current + 1))}>
          Siguiente
        </button>
      </div>
    </section>
  );
}
