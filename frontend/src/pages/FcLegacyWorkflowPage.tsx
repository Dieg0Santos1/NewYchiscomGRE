import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { ArrowRight, CheckCircle2, FilePlus2, ListFilter, Search, X } from 'lucide-react';
import { fcLegacyWorkflowService } from '../services/FcLegacyWorkflowService';
import type { FcLegacyCatalogs, FcLegacyClient, FcLegacyGuideItem, FcLegacyReception, FcLegacyWorkOrder } from '../types/fcLegacy';

type Props = { mode: 'pre-guide' | 'internal-guide' };
type Picker = 'clients' | 'work-orders' | 'pending' | 'ready' | null;

export function FcLegacyWorkflowPage({ mode }: Props) {
  const [writeEnabled, setWriteEnabled] = useState(false);
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(false);
  const [catalogs, setCatalogs] = useState<FcLegacyCatalogs>({
    formasPago: [],
    vendedores: [],
    motivos: [],
    warnings: []
  });
  const [catalogsLoading, setCatalogsLoading] = useState(false);
  const [picker, setPicker] = useState<Picker>(null);
  const [modalQuery, setModalQuery] = useState('');
  const [clientQuery, setClientQuery] = useState('');
  const [descriptionQuery, setDescriptionQuery] = useState('');
  const [clients, setClients] = useState<FcLegacyClient[]>([]);
  const [workOrders, setWorkOrders] = useState<FcLegacyWorkOrder[]>([]);
  const [pending, setPending] = useState<FcLegacyReception[]>([]);
  const [ready, setReady] = useState<FcLegacyReception[]>([]);
  const [selectedClient, setSelectedClient] = useState<FcLegacyClient | null>(null);
  const [selectedOt, setSelectedOt] = useState<FcLegacyWorkOrder | null>(null);
  const [selectedReceptions, setSelectedReceptions] = useState<FcLegacyReception[]>([]);
  const [guideItems, setGuideItems] = useState<FcLegacyGuideItem[]>([]);
  const [preGuide, setPreGuide] = useState({ cantidad: 0, del: '', al: '' });
  const [guide, setGuide] = useState({
    serie: '001' as '001' | '003',
    direccion: '',
    idDistrito: 0,
    ordenCompra: '',
    observaciones: '',
    formaPago: '',
    idEmpleado: null as number | null,
    idMotivoTraslado: 0
  });
  const [lastInternalGuide, setLastInternalGuide] = useState<{ serieNumero?: string } | null>(null);
  const [nextInternalGuide, setNextInternalGuide] = useState('');

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
    setGuideItems([]);
    setClientQuery('');
    setDescriptionQuery('');
    setCatalogsLoading(mode === 'internal-guide');
    const catalogsRequest = mode === 'internal-guide'
      ? fcLegacyWorkflowService.catalogs()
      : Promise.resolve({ formasPago: [], vendedores: [], motivos: [], warnings: [] });
    Promise.all([
      fcLegacyWorkflowService.capabilities(),
      catalogsRequest
    ])
      .then(([capabilities, loadedCatalogs]) => {
        setWriteEnabled(capabilities.writeEnabled);
        setCatalogs(loadedCatalogs);
        setGuide((current) => ({
          ...current,
          formaPago: current.formaPago || loadedCatalogs.formasPago[0]?.valor || loadedCatalogs.formasPago[0]?.nombre || '',
          idEmpleado: current.idEmpleado ?? loadedCatalogs.vendedores[0]?.idEmpleado ?? null,
          idMotivoTraslado: current.idMotivoTraslado ?? loadedCatalogs.motivos[0]?.idMotivoTraslado ?? 0
        }));
      })
      .catch((error) => setMessage(error instanceof Error ? error.message : 'No se pudo consultar el modo operativo.'))
      .finally(() => setCatalogsLoading(false));
  }, [mode]);

  useEffect(() => {
    if (mode !== 'internal-guide') return;
    fcLegacyWorkflowService.nextInternalGuide(guide.serie)
      .then((result) => setNextInternalGuide(result.serieNumero))
      .catch(() => setNextInternalGuide(`${guide.serie}-por asignar`));
  }, [guide.serie, mode]);

  async function openPicker(nextPicker: Exclude<Picker, null>, initialQuery = '') {
    if ((nextPicker === 'work-orders' || nextPicker === 'ready') && !selectedClient) {
      setMessage('Primero selecciona el cliente para mantener ligada la trazabilidad.');
      return;
    }
    setPicker(nextPicker);
    setModalQuery(initialQuery);
    await loadPicker(nextPicker, initialQuery);
  }

  async function loadPicker(target = picker, query = modalQuery) {
    if (!target) return;
    setLoading(true);
    try {
      if (target === 'clients') {
        const rows = await fcLegacyWorkflowService.searchClients(query, mode);
        setClients(rows);
        setMessage(mode === 'internal-guide'
          ? `${rows.length} cliente(s) con OT recepcionada encontrados.`
          : `${rows.length} cliente(s) con OT pendiente encontrados.`);
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
        setMessage(rows.length === 0 && query.trim()
          ? `No se encontraron recepciones para "${query}" dentro del cliente seleccionado. Revisa si la OV pertenece a otro cliente.`
          : `${rows.length} recepcion(es) aceptadas disponibles.`);
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'No se pudo consultar el flujo antiguo.');
    } finally {
      setLoading(false);
    }
  }

  function chooseClient(row: FcLegacyClient) {
    setSelectedClient(row);
    setClientQuery(row.cliente);
    setSelectedOt(null);
    setSelectedReceptions([]);
    setGuideItems([]);
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
      setGuideItems((current) => current.filter((item) => item.idRecepcionOT !== row.idRecepcionOT));
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
    setDescriptionQuery(row.descripcion || `${row.numeroOt} | ${row.del} - ${row.al}`);
    setGuideItems((current) => current.some((item) => item.idRecepcionOT === row.idRecepcionOT)
      ? current
      : [...current, {
          idRecepcionOT: row.idRecepcionOT,
          descripcion: row.descripcion || `${row.numeroOt} | ${row.del} - ${row.al}`,
          cantidad: Number(row.cantidad || 0),
          unidad: row.unidad || 'MLL'
        }]
    );
  }

  function updateGuideItem(idRecepcionOT: number, patch: Partial<FcLegacyGuideItem>) {
    setGuideItems((current) => current.map((item) => item.idRecepcionOT === idRecepcionOT ? { ...item, ...patch } : item));
  }

  function searchClientsFromInput(value: string) {
    setClientQuery(value);
    setPicker('clients');
    setModalQuery(value);
    if (value.trim().length >= 2) void loadPicker('clients', value);
  }

  function searchReadyFromDescription(value: string) {
    setDescriptionQuery(value);
    if (!selectedClient) {
      setMessage('Primero selecciona el cliente.');
      return;
    }
    setPicker('ready');
    setModalQuery(value);
    void loadPicker('ready', value);
  }

  async function createInternalGuide() {
    if (!writeEnabled || selectedIds.length === 0) return;
    if (!window.confirm(`Emitir guia interna ${guide.serie} con ${selectedIds.length} recepcion(es)?`)) return;
    setLoading(true);
    try {
      const result = await fcLegacyWorkflowService.createInternalGuide({ ...guide, idRecepciones: selectedIds, detalles: guideItems });
      const serieNumero = result.internalGuide?.serieNumero ?? guide.serie;
      setLastInternalGuide({ serieNumero });
      setMessage(`Guia interna ${serieNumero} creada con trazabilidad por recepcion. Ya puede buscarse en GRE.`);
      setSelectedReceptions([]);
      setGuideItems([]);
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
        <span className={writeEnabled ? 'legacy-mode-enabled' : 'legacy-mode-readonly'}>{writeEnabled ? 'Listo para prueba' : 'Sin permisos de escritura'}</span>
      </div>
      <LegacyFlowSteps current={mode === 'pre-guide' ? 1 : 2} />
      {!writeEnabled && <div className="legacy-safety-note">La pantalla esta cargada, pero el backend no pudo confirmar disponibilidad de escritura legacy.</div>}
      {catalogs.warnings.length > 0 && <div className="legacy-safety-note">Catalogos parcialmente cargados: {catalogs.warnings[0]}</div>}
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
          {lastInternalGuide?.serieNumero && (
            <div className="legacy-next-action">
              <div>
                <strong>Guia interna creada: {lastInternalGuide.serieNumero}</strong>
                <span>El siguiente paso es buscar esta guia fisica en GRE y declarar la electronica.</span>
              </div>
              <a className="primary-button" href="#/guias/nueva">
                Ir a GRE <ArrowRight size={17} />
              </a>
            </div>
          )}

          <div className="legacy-guide-shell">
            <div className="legacy-guide-number"><span>N#:</span><strong>{nextInternalGuide || `${guide.serie}-por asignar`}</strong></div>
            <div className="legacy-guide-form">
              <label className="legacy-wide-field legacy-lookup-field">Cliente<div><input value={clientQuery || selectedClient?.cliente || ''} placeholder="Escribe cliente, RUC, OT u OV" onChange={(event) => searchClientsFromInput(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') void openPicker('clients', clientQuery); }} /><button type="button" className="icon-button" onClick={() => void openPicker('clients', clientQuery)} title="Buscar cliente"><Search size={17} /></button></div></label>
              <label className="legacy-short-field">Serie<select value={guide.serie} onChange={(event) => setGuide({ ...guide, serie: event.target.value as '001' | '003' })}><option value="001">001</option><option value="003">003</option></select></label>
              <label>Forma pago<select value={guide.formaPago} disabled={catalogsLoading} onChange={(event) => setGuide({ ...guide, formaPago: event.target.value })}><option value="">Seleccione forma de pago</option>{catalogs.formasPago.map((row) => <option key={row.id} value={row.valor || row.nombre}>{row.nombre}</option>)}</select></label>
              <label>O/C<input value={guide.ordenCompra} onChange={(event) => setGuide({ ...guide, ordenCompra: event.target.value })} /></label>
              <label>Motivo<select value={guide.idMotivoTraslado} disabled={catalogsLoading} onChange={(event) => setGuide({ ...guide, idMotivoTraslado: Number(event.target.value) })}>{catalogs.motivos.map((row) => <option key={row.idMotivoTraslado} value={row.idMotivoTraslado}>{row.nombre}</option>)}</select></label>
              <label className="legacy-wide-field">Direccion entrega<input value={guide.direccion} onChange={(event) => setGuide({ ...guide, direccion: event.target.value })} /></label>
              <label className="legacy-short-field">Distrito fiscal<input type="number" min="1" value={guide.idDistrito || ''} onChange={(event) => setGuide({ ...guide, idDistrito: Number(event.target.value) })} /></label>
              <label>Vendedor<select value={guide.idEmpleado ?? ''} disabled={catalogsLoading} onChange={(event) => setGuide({ ...guide, idEmpleado: event.target.value ? Number(event.target.value) : null })}><option value="">Seleccione vendedor</option>{catalogs.vendedores.map((row) => <option key={row.idEmpleado} value={row.idEmpleado}>{row.nombre}</option>)}</select></label>
              <label className="legacy-wide-field legacy-lookup-field">Descripcion<div><input value={descriptionQuery || guideItems[0]?.descripcion || ''} placeholder="Escribe OT, OV o descripcion" onChange={(event) => searchReadyFromDescription(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') void openPicker('ready', descriptionQuery); }} /><button type="button" className="icon-button" onClick={() => void openPicker('ready', descriptionQuery)} title="Seleccionar OT recepcionada"><Search size={17} /></button></div></label>
              <label className="legacy-wide-field">Observaciones<input maxLength={50} value={guide.observaciones} onChange={(event) => setGuide({ ...guide, observaciones: event.target.value })} placeholder="Maximo 50 caracteres en Ychiscom" /></label>
              <button type="button" className="primary-button" disabled={!writeEnabled || selectedIds.length === 0 || !guide.direccion || guide.idDistrito <= 0 || guideItems.some((item) => item.cantidad <= 0 || !item.unidad.trim()) || loading} onClick={() => void createInternalGuide()}><FilePlus2 size={17} /> Emitir guia ({selectedIds.length})</button>
            </div>
            <SelectedReceptionTable rows={selectedReceptions} items={guideItems} onChange={updateGuideItem} onRemove={toggleReception} />
          </div>
        </div>
      )}

      {picker === 'clients' && <LegacyPickerModal title="Seleccionar cliente" query={modalQuery} setQuery={setModalQuery} loading={loading} resultCount={clients.length} onSearch={() => void loadPicker()} onClose={() => setPicker(null)} placeholder="Buscar por cliente, RUC, OT u OV"><ClientTable rows={clients} onSelect={chooseClient} /></LegacyPickerModal>}
      {picker === 'work-orders' && <LegacyPickerModal title={`Seleccionar OT / OV${selectedClient ? ` - ${selectedClient.cliente}` : ''}`} query={modalQuery} setQuery={setModalQuery} loading={loading} resultCount={workOrders.length} onSearch={() => void loadPicker()} onClose={() => setPicker(null)} placeholder="Buscar por OT u OV"><WorkOrderTable rows={workOrders} onSelect={chooseOt} /></LegacyPickerModal>}
      {picker === 'pending' && <LegacyPickerModal title="Pre-guias pendientes de aceptacion" query={modalQuery} setQuery={setModalQuery} loading={loading} resultCount={pending.length} onSearch={() => void loadPicker()} onClose={() => setPicker(null)} placeholder="Buscar por recepcion, OT, OV o cliente"><ReceptionTable rows={pending} actionLabel="Aceptar" disabled={!writeEnabled || loading} onAction={acceptPreGuide} /></LegacyPickerModal>}
      {picker === 'ready' && <LegacyPickerModal title={`OT recepcionadas${selectedClient ? ` - ${selectedClient.cliente}` : ''}`} query={modalQuery} setQuery={setModalQuery} loading={loading} resultCount={ready.length} onSearch={() => void loadPicker()} onClose={() => setPicker(null)} placeholder="Buscar por recepcion, OT, OV o descripcion" footer={<button type="button" className="primary-button" onClick={() => setPicker(null)}>Usar {selectedIds.length} seleccionada(s)</button>}><ReadyReceptionPicker rows={ready} selectedIds={selectedIds} onToggle={toggleReception} /></LegacyPickerModal>}
    </section>
  );
}

function LegacyFlowSteps({ current }: { current: 1 | 2 }) {
  const steps = [
    'Pre-guia',
    'Guia interna',
    'GRE electronica',
    'Factura'
  ];

  return <div className="legacy-flow-steps">{steps.map((step, index) => <div key={step} className={index + 1 <= current ? 'active' : undefined}><span>{index + 1}</span>{step}</div>)}</div>;
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

  useEffect(() => {
    const handle = window.setTimeout(() => onSearch(), 260);
    return () => window.clearTimeout(handle);
  }, [query]);

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

function ReadyReceptionPicker({ rows, selectedIds, onToggle }: { rows: FcLegacyReception[]; selectedIds: number[]; onToggle: (row: FcLegacyReception) => void }) {
  const [sortDirection, setSortDirection] = useState<'desc' | 'asc'>('desc');
  const [selectedOvKey, setSelectedOvKey] = useState('');
  const groups = useMemo(() => {
    const map = new Map<string, {
      key: string;
      ovNumero: string;
      formato: string;
      medida: string;
      numCopias: number;
      estadoGuia: string;
      rows: FcLegacyReception[];
    }>();
    for (const row of rows) {
      const key = `${row.idOrdenVenta}-${row.numeroOvLegacy || row.numeroOv || row.idOrdenVenta}`;
      const current = map.get(key);
      if (current) {
        current.rows.push(row);
        current.numCopias = Math.max(current.numCopias, Number(row.numCopias || 0));
      } else {
        map.set(key, {
          key,
          ovNumero: row.numeroOvLegacy || row.numeroOv || String(row.idOrdenVenta),
          formato: row.formato || row.descripcion?.split(' X ')[0] || '-',
          medida: row.medida || '-',
          numCopias: Number(row.numCopias || 0),
          estadoGuia: row.estadoGuia || '-',
          rows: [row]
        });
      }
    }
    return Array.from(map.values()).sort((left, right) => {
      const diff = legacyOvSortValue(left.ovNumero) - legacyOvSortValue(right.ovNumero);
      return sortDirection === 'asc' ? diff : -diff;
    });
  }, [rows, sortDirection]);

  useEffect(() => {
    if (groups.length === 0) {
      setSelectedOvKey('');
      return;
    }
    if (!groups.some((group) => group.key === selectedOvKey)) setSelectedOvKey(groups[0].key);
  }, [groups, selectedOvKey]);

  const selectedGroup = groups.find((group) => group.key === selectedOvKey) ?? groups[0];

  return <div className="legacy-ready-picker"><section><h3>Ordenes de Venta Pendientes</h3><table className="legacy-table"><thead><tr><th></th><th><button type="button" className="legacy-sort-button" onClick={() => setSortDirection((current) => current === 'desc' ? 'asc' : 'desc')}>OV_NUMERO {sortDirection === 'desc' ? '↓' : '↑'}</button></th><th>FORMATO</th><th>MEDIDA</th><th>NUMCOPIAS</th><th>ESTADOGUIA</th></tr></thead><tbody>{groups.length === 0 ? <tr><td className="empty-row" colSpan={6}>Sin resultados</td></tr> : groups.map((group) => <tr key={group.key} className={group.key === selectedGroup?.key ? 'legacy-row-selected' : ''} onClick={() => setSelectedOvKey(group.key)}><td>▶</td><td>{group.ovNumero}</td><td>{group.formato || '-'}</td><td>{group.medida || '-'}</td><td>{group.numCopias || '-'}</td><td>{group.estadoGuia}</td></tr>)}</tbody></table></section><section><h3>Ordenes de Trabajo Pendientes</h3><table className="legacy-table"><thead><tr><th></th><th>NUMERO_OT</th><th>PRODUCTO</th><th>CANTIDAD</th><th>SERIE</th></tr></thead><tbody>{!selectedGroup ? <tr><td className="empty-row" colSpan={5}>Selecciona una OV para ver sus OT.</td></tr> : selectedGroup.rows.map((row) => <tr key={row.idRecepcionOT} className={selectedIds.includes(row.idRecepcionOT) ? 'legacy-row-selected' : ''} onClick={() => onToggle(row)}><td><input type="checkbox" checked={selectedIds.includes(row.idRecepcionOT)} onChange={() => onToggle(row)} onClick={(event) => event.stopPropagation()} /></td><td>{row.numeroOt}</td><td>{row.descripcion || row.formato || '-'}</td><td>{Number(row.cantidad || 0).toFixed(2)}</td><td>{row.serieProducto || '-'}</td></tr>)}</tbody></table></section></div>;
}

function SelectedReceptionTable({
  rows,
  items,
  onChange,
  onRemove
}: {
  rows: FcLegacyReception[];
  items: FcLegacyGuideItem[];
  onChange: (idRecepcionOT: number, patch: Partial<FcLegacyGuideItem>) => void;
  onRemove: (row: FcLegacyReception) => void;
}) {
  const units = ['MLL', 'MIL', 'NIU', 'UND', 'KGM', 'ZZ'];

  return <div className="legacy-selected-table"><table className="legacy-table legacy-detail-table"><thead><tr><th>Item</th><th>OT</th><th>Descripcion</th><th>Cantidad</th><th>U.M.</th><th></th></tr></thead><tbody>{rows.length === 0 ? <tr><td className="empty-row" colSpan={6}>Presione Enter en descripcion o use la lupa para seleccionar OT recepcionadas.</td></tr> : rows.map((row, index) => {
    const item = items.find((candidate) => candidate.idRecepcionOT === row.idRecepcionOT) ?? {
      idRecepcionOT: row.idRecepcionOT,
      descripcion: row.descripcion || `${row.numeroOt} | ${row.del} - ${row.al}`,
      cantidad: Number(row.cantidad || 0),
      unidad: row.unidad || 'MLL'
    };
    return <tr key={row.idRecepcionOT}><td>{index + 1}</td><td>{row.numeroOt}</td><td><input maxLength={250} value={item.descripcion} onChange={(event) => onChange(row.idRecepcionOT, { descripcion: event.target.value })} /></td><td><input type="number" min="0.01" step="0.01" value={item.cantidad || ''} onChange={(event) => onChange(row.idRecepcionOT, { cantidad: Number(event.target.value) })} /></td><td><select value={item.unidad} onChange={(event) => onChange(row.idRecepcionOT, { unidad: event.target.value })}>{units.map((unit) => <option key={unit} value={unit}>{unit}</option>)}{!units.includes(item.unidad) && <option value={item.unidad}>{item.unidad}</option>}</select></td><td><button type="button" className="icon-button" onClick={() => onRemove(row)} title="Quitar"><X size={16} /></button></td></tr>;
  })}</tbody></table></div>;
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

function legacyOvSortValue(value: string) {
  const numeric = value.replace(/\D/g, '');
  return Number(numeric || 0);
}
