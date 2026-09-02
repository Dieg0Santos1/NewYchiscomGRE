import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { CheckCircle2, FilePlus2, ListFilter, Search, X } from 'lucide-react';
import { fcLegacyWorkflowService } from '../services/FcLegacyWorkflowService';
import type { FcLegacyClient, FcLegacyReception, FcLegacyWorkOrder } from '../types/fcLegacy';

type Props = { mode: 'pre-guide' | 'internal-guide' };
type Picker = 'clients' | 'work-orders' | 'pending' | 'ready' | null;

export function FcLegacyWorkflowPage({ mode }: Props) {
  const [writeEnabled, setWriteEnabled] = useState(false);
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(false);
  const [picker, setPicker] = useState<Picker>(null);
  const [modalQuery, setModalQuery] = useState('');
  const [clients, setClients] = useState<FcLegacyClient[]>([]);
  const [workOrders, setWorkOrders] = useState<FcLegacyWorkOrder[]>([]);
  const [pending, setPending] = useState<FcLegacyReception[]>([]);
  const [ready, setReady] = useState<FcLegacyReception[]>([]);
  const [selectedClient, setSelectedClient] = useState<FcLegacyClient | null>(null);
  const [selectedOt, setSelectedOt] = useState<FcLegacyWorkOrder | null>(null);
  const [selectedReceptions, setSelectedReceptions] = useState<FcLegacyReception[]>([]);
  const [preGuide, setPreGuide] = useState({ cantidad: 0, del: '', al: '' });
  const [guide, setGuide] = useState({
    serie: '001' as '001' | '003',
    direccion: '',
    idDistrito: 0,
    ordenCompra: '',
    observaciones: '',
    formaPago: '',
    vendedor: ''
  });

  const selectedIds = useMemo(() => selectedReceptions.map((row) => row.idRecepcionOT), [selectedReceptions]);
  const selectedReceptionTotal = useMemo(
    () => selectedReceptions.reduce((total, row) => total + Number(row.cantidad || 0), 0),
    [selectedReceptions]
  );

  useEffect(() => {
    setPicker(null);
    setMessage('');
    setSelectedClient(null);
    setSelectedOt(null);
    setSelectedReceptions([]);
    fcLegacyWorkflowService.capabilities()
      .then((result) => setWriteEnabled(result.writeEnabled))
      .catch((error) => setMessage(error instanceof Error ? error.message : 'No se pudo consultar el modo operativo.'));
  }, [mode]);

  async function openPicker(nextPicker: Exclude<Picker, null>) {
    if ((nextPicker === 'work-orders' || nextPicker === 'ready') && !selectedClient) {
      setMessage('Primero selecciona el cliente para mantener ligada la trazabilidad.');
      return;
    }
    setPicker(nextPicker);
    setModalQuery('');
    await loadPicker(nextPicker, '');
  }

  async function loadPicker(target = picker, query = modalQuery) {
    if (!target) return;
    setLoading(true);
    try {
      if (target === 'clients') {
        const rows = await fcLegacyWorkflowService.searchClients(query);
        setClients(rows);
        setMessage(`${rows.length} cliente(s) con OT pendiente encontrados.`);
      } else if (target === 'work-orders') {
        const rows = await fcLegacyWorkflowService.searchWorkOrders(query, selectedClient?.idClieProv);
        setWorkOrders(rows);
        setMessage(`${rows.length} OT/OV disponibles para el cliente.`);
      } else if (target === 'pending') {
        const rows = await fcLegacyWorkflowService.searchReceptions(query, 'pending', selectedClient?.idClieProv);
        setPending(rows);
        setMessage(`${rows.length} pre-guia(s) pendiente(s) encontradas.`);
      } else {
        const rows = await fcLegacyWorkflowService.searchReceptions(query, 'ready', selectedClient?.idClieProv);
        setReady(rows);
        setMessage(`${rows.length} recepcion(es) aceptadas disponibles.`);
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'No se pudo consultar el flujo antiguo.');
    } finally {
      setLoading(false);
    }
  }

  function chooseClient(row: FcLegacyClient) {
    setSelectedClient(row);
    setSelectedOt(null);
    setSelectedReceptions([]);
    setPreGuide({ cantidad: 0, del: '', al: '' });
    setGuide((current) => ({ ...current, direccion: row.direccion ?? '', idDistrito: row.idDistrito ?? 0 }));
    setPicker(null);
    setMessage(`Cliente ${row.cliente} seleccionado.`);
  }

  function chooseOt(row: FcLegacyWorkOrder) {
    if (selectedClient && row.idClieProv !== selectedClient.idClieProv) {
      setMessage('La OT no pertenece al cliente seleccionado.');
      return;
    }
    setSelectedOt(row);
    setPreGuide({ cantidad: Math.max(0, row.cantidadPendiente), del: row.numeroDel ?? '', al: row.numeroAl ?? '' });
    setPicker(null);
    setMessage(`OT ${row.numeroOt} ligada a ${row.cliente}.`);
  }

  async function createPreGuide() {
    if (!selectedOt || !writeEnabled) return;
    if (!window.confirm(`Crear pre-guia para ${selectedOt.numeroOt} por ${preGuide.cantidad}?`)) return;
    setLoading(true);
    try {
      await fcLegacyWorkflowService.createPreGuide({ numeroOt: selectedOt.numeroOt, ...preGuide });
      setMessage(`Pre-guia creada para ${selectedOt.numeroOt}. Debe aceptarse antes de generar la guia interna.`);
      setSelectedOt(null);
      setPreGuide({ cantidad: 0, del: '', al: '' });
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'No se pudo crear la pre-guia.');
    } finally { setLoading(false); }
  }

  async function acceptPreGuide(row: FcLegacyReception) {
    if (!writeEnabled) return;
    if (!window.confirm(`Aceptar la pre-guia ${row.idRecepcionOT} de ${row.numeroOt}? Esta accion crea su movimiento de ingreso.`)) return;
    setLoading(true);
    try {
      await fcLegacyWorkflowService.acceptPreGuide(row.idRecepcionOT);
      setMessage(`Pre-guia ${row.idRecepcionOT} aceptada y ligada a su movimiento de ingreso.`);
      await loadPicker('pending', modalQuery);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'No se pudo aceptar la pre-guia.');
    } finally { setLoading(false); }
  }

  function toggleReception(row: FcLegacyReception) {
    if (selectedIds.includes(row.idRecepcionOT)) {
      setSelectedReceptions((current) => current.filter((item) => item.idRecepcionOT !== row.idRecepcionOT));
      return;
    }
    if (selectedClient && row.idClieProv !== selectedClient.idClieProv) {
      setMessage('La recepcion no pertenece al cliente seleccionado.');
      return;
    }
    if (selectedReceptions.length === 0) {
      setGuide((current) => ({ ...current, direccion: row.direccion ?? '', idDistrito: row.idDistrito ?? 0 }));
    }
    setSelectedReceptions((current) => [...current, row]);
  }

  async function createInternalGuide() {
    if (!writeEnabled || selectedIds.length === 0) return;
    if (!window.confirm(`Emitir guia interna ${guide.serie} con ${selectedIds.length} recepcion(es)?`)) return;
    setLoading(true);
    try {
      const result = await fcLegacyWorkflowService.createInternalGuide({ ...guide, idRecepciones: selectedIds });
      setMessage(`Guia interna ${result.internalGuide?.serieNumero ?? guide.serie} creada con trazabilidad por recepcion.`);
      setSelectedReceptions([]);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'No se pudo crear la guia interna.');
    } finally { setLoading(false); }
  }

  return (
    <section className="screen-panel legacy-workflow">
      <div className="legacy-heading">
        <div>
          <h1>{mode === 'pre-guide' ? 'Pre-guias FC' : 'Guias internas FC'}</h1>
          <p>{mode === 'pre-guide' ? 'Cliente, OT/OV y rango de recepcion.' : 'Cliente, recepciones aceptadas y datos de guia fisica.'}</p>
        </div>
        <span className={writeEnabled ? 'legacy-mode-enabled' : 'legacy-mode-readonly'}>{writeEnabled ? 'Escritura controlada habilitada' : 'Solo lectura'}</span>
      </div>
      {!writeEnabled && <div className="legacy-safety-note">Modo de revision activo. Puedes buscar y seleccionar registros; crear, aceptar y emitir siguen bloqueados.</div>}
      {message && <p className="inline-message legacy-message">{message}</p>}

      {mode === 'pre-guide' ? (
        <div className="legacy-content">
          <div className="legacy-action-grid legacy-pre-guide-grid">
            <SelectionCard title="Cliente" description="Primero busca el cliente; la OT/OV quedara filtrada por esta seleccion." buttonLabel="Buscar cliente" onOpen={() => void openPicker('clients')}>
              <ClientSummary client={selectedClient} />
            </SelectionCard>

            <SelectionCard title="OT / OV" description="Solo se muestran ordenes pendientes del cliente seleccionado." buttonLabel="Buscar OT / OV" onOpen={() => void openPicker('work-orders')}>
              {selectedOt ? <div className="legacy-selected-summary"><strong>{selectedOt.numeroOt}</strong><span>OV {selectedOt.numeroOv || selectedOt.idOrdenVenta} | Serie {selectedOt.serie || '-'}</span><span>Pendiente: {selectedOt.cantidadPendiente} de {selectedOt.cantidadOt}</span></div> : <div className="legacy-empty-selection">Ninguna OT seleccionada</div>}
            </SelectionCard>
          </div>

          <div className="legacy-form-card legacy-pre-guide-form">
            <h2>Nueva pre-guia</h2>
            <label>Cliente<input value={selectedClient?.cliente ?? ''} readOnly placeholder="Selecciona un cliente" /></label>
            <label>N# OT<input value={selectedOt?.numeroOt ?? ''} readOnly placeholder="Selecciona una OT" /></label>
            <label>Cantidad<input type="number" step="0.01" min="0.01" value={preGuide.cantidad || ''} onChange={(event) => setPreGuide({ ...preGuide, cantidad: Number(event.target.value) })} /></label>
            <label>Serie<input value={selectedOt?.serie ?? ''} readOnly /></label>
            <label>Del<input value={preGuide.del} onChange={(event) => setPreGuide({ ...preGuide, del: event.target.value })} /></label>
            <label>Al<input value={preGuide.al} onChange={(event) => setPreGuide({ ...preGuide, al: event.target.value })} /></label>
            <button type="button" className="primary-button" disabled={!writeEnabled || !selectedOt || preGuide.cantidad <= 0 || loading} onClick={() => void createPreGuide()}><FilePlus2 size={17} /> Crear pre-guia</button>
          </div>

          <SelectionCard title="Inspeccion pendiente" description="Las pre-guias pendientes se revisan en una ventana con buscador y scroll interno." buttonLabel="Ver pendientes" onOpen={() => void openPicker('pending')}>
            <div className="legacy-empty-selection">Usa esta vista para aceptar la pre-guia despues de crearla.</div>
          </SelectionCard>
        </div>
      ) : (
        <div className="legacy-content">
          <div className="legacy-action-grid legacy-guide-top-grid">
            <SelectionCard title="Cliente" description="Selecciona el cliente antes de buscar recepciones." buttonLabel="Buscar cliente" onOpen={() => void openPicker('clients')}>
              <ClientSummary client={selectedClient} />
            </SelectionCard>

            <SelectionCard title="Recepciones" description="Solo se agrupan recepciones aceptadas del mismo cliente." buttonLabel="Seleccionar recepciones" onOpen={() => void openPicker('ready')}>
              {selectedReceptions.length > 0 ? <div className="legacy-selected-summary"><strong>{selectedReceptions.length} recepcion(es)</strong><span>Total seleccionado: {selectedReceptionTotal.toFixed(2)}</span><div className="legacy-selection-chips">{selectedReceptions.map((row) => <button key={row.idRecepcionOT} type="button" onClick={() => toggleReception(row)} title="Quitar recepcion">#{row.idRecepcionOT} | {row.numeroOt} <X size={13} /></button>)}</div></div> : <div className="legacy-empty-selection">Ninguna recepcion seleccionada</div>}
            </SelectionCard>
          </div>

          <div className="legacy-guide-shell">
            <div className="legacy-guide-number"><span>N#:</span><strong>{guide.serie}-por asignar</strong></div>
            <div className="legacy-guide-form">
              <label className="legacy-wide-field">Cliente<input value={selectedClient?.cliente ?? ''} readOnly placeholder="Selecciona un cliente" /></label>
              <label>Serie<select value={guide.serie} onChange={(event) => setGuide({ ...guide, serie: event.target.value as '001' | '003' })}><option value="001">001</option><option value="003">003</option></select></label>
              <label>Forma pago<input value={guide.formaPago} onChange={(event) => setGuide({ ...guide, formaPago: event.target.value })} placeholder="Pendiente de catalogo" /></label>
              <label>O/C<input value={guide.ordenCompra} onChange={(event) => setGuide({ ...guide, ordenCompra: event.target.value })} /></label>
              <label>Motivo<input value={guide.observaciones} onChange={(event) => setGuide({ ...guide, observaciones: event.target.value })} /></label>
              <label className="legacy-wide-field">Direccion entrega<input value={guide.direccion} onChange={(event) => setGuide({ ...guide, direccion: event.target.value })} /></label>
              <label>Distrito fiscal<input type="number" min="1" value={guide.idDistrito || ''} onChange={(event) => setGuide({ ...guide, idDistrito: Number(event.target.value) })} /></label>
              <label>Vendedor<input value={guide.vendedor} onChange={(event) => setGuide({ ...guide, vendedor: event.target.value })} placeholder="Pendiente de catalogo" /></label>
              <button type="button" className="primary-button" disabled={!writeEnabled || selectedIds.length === 0 || !guide.direccion || guide.idDistrito <= 0 || loading} onClick={() => void createInternalGuide()}><FilePlus2 size={17} /> Emitir guia ({selectedIds.length})</button>
            </div>
            <SelectedReceptionTable rows={selectedReceptions} />
          </div>
        </div>
      )}

      {picker === 'clients' && <LegacyPickerModal title="Seleccionar cliente" query={modalQuery} setQuery={setModalQuery} loading={loading} resultCount={clients.length} onSearch={() => void loadPicker()} onClose={() => setPicker(null)} placeholder="Buscar por cliente, RUC, OT u OV"><ClientTable rows={clients} onSelect={chooseClient} /></LegacyPickerModal>}
      {picker === 'work-orders' && <LegacyPickerModal title={`Seleccionar OT / OV${selectedClient ? ` - ${selectedClient.cliente}` : ''}`} query={modalQuery} setQuery={setModalQuery} loading={loading} resultCount={workOrders.length} onSearch={() => void loadPicker()} onClose={() => setPicker(null)} placeholder="Buscar por OT u OV"><WorkOrderTable rows={workOrders} onSelect={chooseOt} /></LegacyPickerModal>}
      {picker === 'pending' && <LegacyPickerModal title="Pre-guias pendientes de aceptacion" query={modalQuery} setQuery={setModalQuery} loading={loading} resultCount={pending.length} onSearch={() => void loadPicker()} onClose={() => setPicker(null)} placeholder="Buscar por recepcion, OT, OV o cliente"><ReceptionTable rows={pending} actionLabel="Aceptar" disabled={!writeEnabled || loading} onAction={acceptPreGuide} /></LegacyPickerModal>}
      {picker === 'ready' && <LegacyPickerModal title={`Seleccionar recepciones${selectedClient ? ` - ${selectedClient.cliente}` : ''}`} query={modalQuery} setQuery={setModalQuery} loading={loading} resultCount={ready.length} onSearch={() => void loadPicker()} onClose={() => setPicker(null)} placeholder="Buscar por recepcion, OT u OV" footer={<button type="button" className="primary-button" onClick={() => setPicker(null)}>Usar {selectedIds.length} seleccionada(s)</button>}><ReceptionTable rows={ready} selectedIds={selectedIds} onToggle={toggleReception} /></LegacyPickerModal>}
    </section>
  );
}

function SelectionCard({ title, description, buttonLabel, onOpen, children }: { title: string; description: string; buttonLabel: string; onOpen: () => void; children: ReactNode }) {
  return <section className="legacy-selection-card"><div className="legacy-selection-card-header"><div><h2>{title}</h2><p>{description}</p></div><button type="button" className="secondary-button" onClick={onOpen}><ListFilter size={17} /> {buttonLabel}</button></div>{children}</section>;
}

function ClientSummary({ client }: { client: FcLegacyClient | null }) {
  if (!client) return <div className="legacy-empty-selection">Ningun cliente seleccionado</div>;
  return <div className="legacy-selected-summary"><strong>{client.cliente}</strong><span>RUC {client.ruc || '-'}</span><span>{client.otsPendientes} OT pendiente(s) | {client.cantidadPendiente} unidad(es)</span></div>;
}

function LegacyPickerModal({ title, query, setQuery, loading, resultCount, onSearch, onClose, footer, placeholder, children }: { title: string; query: string; setQuery: (value: string) => void; loading: boolean; resultCount: number; onSearch: () => void; onClose: () => void; footer?: ReactNode; placeholder: string; children: ReactNode }) {
  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => event.key === 'Escape' && onClose();
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [onClose]);

  return <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label={title} onMouseDown={(event) => event.target === event.currentTarget && onClose()}><section className="legacy-picker-modal"><header className="legacy-picker-header"><div><h2>{title}</h2><span>{loading ? 'Consultando...' : `${resultCount} resultado(s)`}</span></div><button type="button" className="icon-button" onClick={onClose} aria-label="Cerrar"><X size={19} /></button></header><div className="legacy-picker-search"><input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') onSearch(); }} placeholder={placeholder} /><button type="button" className="primary-button" disabled={loading} onClick={onSearch}><Search size={17} /> Buscar</button></div><div className="legacy-picker-table">{children}</div><footer className="legacy-picker-footer"><span>Los resultados permanecen dentro de esta ventana.</span><div>{footer}<button type="button" className="secondary-button" onClick={onClose}>Cerrar</button></div></footer></section></div>;
}

function ClientTable({ rows, onSelect }: { rows: FcLegacyClient[]; onSelect: (row: FcLegacyClient) => void }) {
  const pager = useTablePager(rows);
  return <><table className="legacy-table"><thead><tr><th>Cliente</th><th>RUC</th><th>Direccion</th><th>OT pendientes</th><th>Cantidad</th><th></th></tr></thead><tbody>{rows.length === 0 ? <tr><td className="empty-row" colSpan={6}>Sin resultados</td></tr> : pager.visibleRows.map((row) => <tr key={row.idClieProv}><td>{row.cliente}</td><td>{row.ruc || '-'}</td><td>{row.direccion || '-'}</td><td>{row.otsPendientes}</td><td>{row.cantidadPendiente}</td><td><button type="button" className="select-row-button" onClick={() => onSelect(row)}>Seleccionar</button></td></tr>)}</tbody></table><TablePager {...pager} /></>;
}

function WorkOrderTable({ rows, onSelect }: { rows: FcLegacyWorkOrder[]; onSelect: (row: FcLegacyWorkOrder) => void }) {
  const pager = useTablePager(rows);
  return <><table className="legacy-table"><thead><tr><th>OT</th><th>OV</th><th>Cliente</th><th>Cantidad</th><th>Aceptada</th><th>Pendiente</th><th>Serie</th><th>Estado</th><th></th></tr></thead><tbody>{rows.length === 0 ? <tr><td className="empty-row" colSpan={9}>Sin resultados</td></tr> : pager.visibleRows.map((row) => <tr key={row.idOrdenTrabajo}><td>{row.numeroOt}</td><td>{row.numeroOv || row.idOrdenVenta}</td><td>{row.cliente}</td><td>{row.cantidadOt}</td><td>{row.cantidadAceptada}</td><td>{row.cantidadPendiente}</td><td>{row.serie || '-'}</td><td>{row.estadoGuiaOt}</td><td><button type="button" className="select-row-button" onClick={() => onSelect(row)}>Seleccionar</button></td></tr>)}</tbody></table><TablePager {...pager} /></>;
}

function ReceptionTable({ rows, selectedIds = [], onToggle, actionLabel, onAction, disabled = false }: { rows: FcLegacyReception[]; selectedIds?: number[]; onToggle?: (row: FcLegacyReception) => void; actionLabel?: string; onAction?: (row: FcLegacyReception) => void; disabled?: boolean }) {
  const pager = useTablePager(rows);
  return <><table className="legacy-table"><thead><tr>{onToggle && <th></th>}<th>Recepcion</th><th>OT</th><th>OV</th><th>Cliente</th><th>Cantidad</th><th>Rango</th><th>Estado</th>{onAction && <th></th>}</tr></thead><tbody>{rows.length === 0 ? <tr><td className="empty-row" colSpan={onToggle || onAction ? 9 : 7}>Sin resultados</td></tr> : pager.visibleRows.map((row) => <tr key={row.idRecepcionOT} className={selectedIds.includes(row.idRecepcionOT) ? 'legacy-row-selected' : ''}>{onToggle && <td><input type="checkbox" checked={selectedIds.includes(row.idRecepcionOT)} onChange={() => onToggle(row)} /></td>}<td>{row.idRecepcionOT}</td><td>{row.numeroOt}</td><td>{row.numeroOv || row.idOrdenVenta}</td><td>{row.cliente}</td><td>{row.cantidad} {row.unidad}</td><td>{row.del} - {row.al}</td><td>{row.estadoOt}/{row.estadoGuia}</td>{onAction && <td><button type="button" className="select-row-button" disabled={disabled} onClick={() => onAction(row)}><CheckCircle2 size={15} /> {actionLabel}</button></td>}</tr>)}</tbody></table><TablePager {...pager} /></>;
}

function SelectedReceptionTable({ rows }: { rows: FcLegacyReception[] }) {
  return <div className="legacy-selected-table"><table className="legacy-table"><thead><tr><th>Item</th><th>Descripcion</th><th>Cantidad</th><th>Unidad</th></tr></thead><tbody>{rows.length === 0 ? <tr><td className="empty-row" colSpan={4}>Sin recepciones seleccionadas</td></tr> : rows.map((row, index) => <tr key={row.idRecepcionOT}><td>{index + 1}</td><td>{row.numeroOt} | {row.del} - {row.al}</td><td>{row.cantidad}</td><td>{row.unidad}</td></tr>)}</tbody></table></div>;
}

function useTablePager<T>(rows: T[]) {
  const pageSize = 15;
  const [page, setPage] = useState(0);
  const pageCount = Math.max(1, Math.ceil(rows.length / pageSize));
  useEffect(() => setPage(0), [rows]);
  const safePage = Math.min(page, pageCount - 1);
  return {
    visibleRows: rows.slice(safePage * pageSize, (safePage + 1) * pageSize),
    page: safePage,
    pageCount,
    totalRows: rows.length,
    setPage
  };
}

function TablePager({ page, pageCount, totalRows, setPage }: { page: number; pageCount: number; totalRows: number; setPage: (page: number) => void }) {
  if (totalRows <= 15) return null;
  return <div className="legacy-table-pager"><span>Pagina {page + 1} de {pageCount} | {totalRows} registros</span><div><button type="button" className="secondary-button" disabled={page === 0} onClick={() => setPage(page - 1)}>Anterior</button><button type="button" className="secondary-button" disabled={page >= pageCount - 1} onClick={() => setPage(page + 1)}>Siguiente</button></div></div>;
}
