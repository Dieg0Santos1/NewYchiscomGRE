import { useEffect, useMemo, useState } from 'react';
import { Eye, PackageSearch, RefreshCw, Search, Send } from 'lucide-react';
import { CharacterCounter } from '../components/CharacterCounter';
import { FlexoGuidePreviewModal } from '../components/FlexoGuidePreviewModal';
import { FormField } from '../components/FormField';
import { currentTime, todayDate } from '../data/defaults';
import {
  SUNAT_GRE_ITEM_DESCRIPTION_MAX_LENGTH,
  SUNAT_GRE_ITEM_DESCRIPTION_MIN_LENGTH,
  SUNAT_GRE_OBSERVATION_MAX_LENGTH,
  SUNAT_GRE_TRANSFER_REASONS
} from '../data/sunatGre';
import { driverService } from '../services/DriverService';
import { flexoService } from '../services/FlexoService';
import type { DriverCatalogItem } from '../types/gre';
import type {
  FlexoCliente,
  FlexoDestino,
  FlexoEmpaque,
  FlexoGuideSerie,
  FlexoGuidePreviewInput,
  FlexoGuidePreviewResponse
} from '../types/flexo';
import { driverIdentity, driverPlates, uniqueDrivers } from '../utils/drivers';

const transferReasons = SUNAT_GRE_TRANSFER_REASONS;

type FlexoGuideState = {
  serie: FlexoGuideSerie;
  serieNumeroGuia: string;
  fechaEmision: string;
  fechaTraslado: string;
  destino: FlexoDestino;
  modalidadTraslado: string;
  motivoTraslado: string;
  descripcionMotivoTraslado: string;
  pesoBruto: number;
  unidadPeso: string;
  numeroBultos: number;
  ordenCompra: string;
  observaciones: string;
  selectedDriverId: string;
  conductor: FlexoGuidePreviewInput['conductor'];
  empaques: FlexoEmpaque[];
};

function defaultState(): FlexoGuideState {
  const date = todayDate();

  return {
    serie: 'T003',
    serieNumeroGuia: 'T003-00000001',
    fechaEmision: `${date}T${currentTime().slice(0, 5)}`,
    fechaTraslado: date,
    destino: { id: '', ubigeo: '', direccion: '' },
    modalidadTraslado: '02',
    motivoTraslado: '',
    descripcionMotivoTraslado: '',
    pesoBruto: 1,
    unidadPeso: 'KGM',
    numeroBultos: 1,
    ordenCompra: '',
    observaciones: '',
    selectedDriverId: '',
    conductor: {
      tipoDocumento: '1',
      numeroDocumento: '',
      nombres: '',
      apellidos: '',
      licencia: '',
      placa: ''
    },
    empaques: []
  };
}

export function FlexoGuidePage() {
  const [form, setForm] = useState<FlexoGuideState>(() => defaultState());
  const [query, setQuery] = useState('');
  const [clientes, setClientes] = useState<FlexoCliente[]>([]);
  const [cliente, setCliente] = useState<FlexoCliente | null>(null);
  const [destinos, setDestinos] = useState<FlexoDestino[]>([]);
  const [drivers, setDrivers] = useState<DriverCatalogItem[]>([]);
  const [message, setMessage] = useState('');
  const [loadingClientes, setLoadingClientes] = useState(false);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [preview, setPreview] = useState<FlexoGuidePreviewResponse | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewConfirmed, setPreviewConfirmed] = useState(false);
  const [empaqueModalOpen, setEmpaqueModalOpen] = useState(false);

  const items = useMemo(() => form.empaques.flatMap((item) => item.items), [form.empaques]);
  const selectableDrivers = useMemo(() => uniqueDrivers(drivers), [drivers]);
  const selectablePlates = useMemo(
    () => driverPlates(drivers, form.selectedDriverId),
    [drivers, form.selectedDriverId]
  );
  const selectedClientLabel = cliente ? `${cliente.numeroDocumento} - ${cliente.razonSocial}` : '';
  const canPreview = Boolean(
    cliente &&
    form.destino.ubigeo &&
    form.destino.direccion &&
    form.motivoTraslado &&
    form.pesoBruto > 0 &&
    form.numeroBultos > 0 &&
    form.observaciones.length <= SUNAT_GRE_OBSERVATION_MAX_LENGTH &&
    items.every((item) =>
      item.descripcion.trim().length >= SUNAT_GRE_ITEM_DESCRIPTION_MIN_LENGTH &&
      item.descripcion.trim().length <= SUNAT_GRE_ITEM_DESCRIPTION_MAX_LENGTH
    ) &&
    form.empaques.length > 0
  );

  useEffect(() => {
    void loadNextSerie();
    driverService.listPrivateDrivers()
      .then(setDrivers)
      .catch((error) => setMessage(error instanceof Error ? error.message : 'No se pudo cargar choferes.'));
  }, []);

  useEffect(() => {
    if (cliente && query === selectedClientLabel) return;
    if (query.trim().length < 2) {
      setClientes([]);
      return;
    }

    const timeout = window.setTimeout(() => {
      void searchClientes(false);
    }, 300);

    return () => window.clearTimeout(timeout);
  }, [cliente, query, selectedClientLabel]);

  function invalidatePreview() {
    setPreview(null);
    setPreviewOpen(false);
    setPreviewConfirmed(false);
  }

  async function loadNextSerie(serie: FlexoGuideSerie = form.serie) {
    try {
      const result = await flexoService.getNextSerie(serie);
      setForm((current) => ({ ...current, serie: result.serie, serieNumeroGuia: result.serieNumeroGuia }));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : `No se pudo cargar el correlativo ${serie}.`);
    }
  }

  function changeSerie(serie: FlexoGuideSerie) {
    invalidatePreview();
    setForm((current) => ({ ...current, serie, serieNumeroGuia: `${serie}-00000001` }));
    void loadNextSerie(serie);
  }

  async function searchClientes(showStatus = true) {
    setLoadingClientes(true);
    if (showStatus) setMessage('Buscando clientes Flexo...');

    try {
      const result = await flexoService.searchClientes(query);
      setClientes(result);
      if (showStatus) setMessage(result.length > 0 ? `${result.length} cliente(s) encontrados.` : 'Sin clientes para mostrar.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'No se pudo buscar clientes Flexo.');
    } finally {
      setLoadingClientes(false);
    }
  }

  async function selectCliente(nextCliente: FlexoCliente) {
    setCliente(nextCliente);
    setQuery(`${nextCliente.numeroDocumento} - ${nextCliente.razonSocial}`);
    setClientes([]);
    invalidatePreview();
    setMessage(`Cargando destinos de ${nextCliente.razonSocial}...`);

    try {
      const result = await flexoService.listDestinos(nextCliente.numeroDocumento);
      setDestinos(result);
      setForm((current) => ({
        ...current,
        destino: result[0] ?? { id: '', ubigeo: '', direccion: '' },
        ordenCompra: '',
        empaques: []
      }));
      setMessage(result.length > 0 ? 'Cliente seleccionado.' : 'Cliente seleccionado sin destinos historicos.');
    } catch (error) {
      setDestinos([]);
      setMessage(error instanceof Error ? error.message : 'No se pudo cargar destinos del cliente.');
    }
  }

  function changeMotivo(value: string) {
    const reason = transferReasons.find((item) => item.code === value);
    invalidatePreview();
    setForm((current) => ({
      ...current,
      motivoTraslado: value,
      descripcionMotivoTraslado: reason?.description ?? ''
    }));
  }

  function changeDriver(driverId: string) {
    const driver = drivers.find((item) => driverIdentity(item) === driverId);
    const plates = driverPlates(drivers, driverId);
    invalidatePreview();
    setForm((current) => ({
      ...current,
      selectedDriverId: driverId,
      conductor: {
        tipoDocumento: driver?.tipoDocumento ?? '1',
        numeroDocumento: driver?.numeroDocumento ?? '',
        nombres: driver?.nombres ?? '',
        apellidos: driver?.apellidos ?? '',
        licencia: driver?.licencia ?? '',
        placa: plates.length === 1 ? plates[0]! : ''
      }
    }));
  }

  function assignEmpaques(nextEmpaques: FlexoEmpaque[]) {
    const purchaseOrders = [...new Set(nextEmpaques.map((item) => item.ordenCompra).filter(Boolean))];
    invalidatePreview();
    setForm((current) => ({
      ...current,
      empaques: nextEmpaques,
      ordenCompra: purchaseOrders.length === 1 ? purchaseOrders[0] ?? '' : current.ordenCompra,
      destino: nextEmpaques[0]?.destino.ubigeo ? nextEmpaques[0].destino : current.destino
    }));
    setEmpaqueModalOpen(false);
    setMessage(nextEmpaques.length > 0 ? `${nextEmpaques.length} empaque(s) asignados.` : 'Sin empaques asignados.');
  }

  async function openPreview() {
    if (!cliente) return;
    setPreviewLoading(true);
    setMessage('Validando vista previa Flexo...');

    try {
      const result = await flexoService.previewGuia(buildPreviewPayload(cliente));
      setPreview(result);
      setPreviewOpen(true);
      setPreviewConfirmed(false);
      setMessage(`Vista previa lista para ${result.serieNumeroGuia}.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'No se pudo generar vista previa Flexo.');
    } finally {
      setPreviewLoading(false);
    }
  }

  function clearForm() {
    setForm(defaultState());
    setCliente(null);
    setQuery('');
    setClientes([]);
    setDestinos([]);
    invalidatePreview();
    setMessage('');
    void loadNextSerie('T003');
  }

  function buildPreviewPayload(currentCliente: FlexoCliente): FlexoGuidePreviewInput {
    return {
      serieNumeroGuia: form.serieNumeroGuia,
      fechaEmision: form.fechaEmision,
      fechaTraslado: form.fechaTraslado,
      cliente: {
        tipoDocumento: currentCliente.tipoDocumento,
        numeroDocumento: currentCliente.numeroDocumento,
        razonSocial: currentCliente.razonSocial
      },
      destino: form.destino,
      modalidadTraslado: form.modalidadTraslado,
      motivoTraslado: form.motivoTraslado,
      descripcionMotivoTraslado: form.descripcionMotivoTraslado,
      pesoBruto: form.pesoBruto,
      unidadPeso: form.unidadPeso,
      numeroBultos: form.numeroBultos,
      ordenCompra: form.ordenCompra,
      observaciones: form.observaciones,
      conductor: form.conductor,
      empaques: form.empaques
    };
  }

  return (
    <section className="screen-panel">
      <div className="search-strip flexo-client-strip">
        <FormField label="CLIENTE" required wide>
          <div className="client-search-box">
            <input
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
                if (cliente) {
                  setCliente(null);
                  invalidatePreview();
                }
              }}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  void searchClientes();
                }
              }}
              placeholder="RUC o razon social"
            />
            <button type="button" className="tool-button primary-tool" onClick={() => void searchClientes()} disabled={loadingClientes}>
              <Search size={16} />
              Buscar
            </button>
            <button type="button" className="tool-button" onClick={clearForm}>
              <RefreshCw size={16} />
              Limpiar
            </button>
            {clientes.length > 0 && (
              <div className="client-results flexo-client-results">
                <strong>Seleccione un cliente</strong>
                {clientes.map((item) => (
                  <button key={item.id} type="button" onClick={() => void selectCliente(item)}>
                    <span>{item.numeroDocumento}</span>
                    <b>{item.razonSocial}</b>
                  </button>
                ))}
              </div>
            )}
          </div>
        </FormField>
        {message && <div className="inline-message">{message}</div>}
      </div>

      <div className="form-grid flexo-form-grid">
        <FormField label="EMPRESA" required>
          <input className="auto-field" value="20259402965-6-YCHIFORMAS S.A." readOnly />
        </FormField>
        <FormField label="FECHA EMISION">
          <input
            type="datetime-local"
            value={form.fechaEmision}
            onChange={(event) => {
              invalidatePreview();
              setForm((current) => ({ ...current, fechaEmision: event.target.value }));
            }}
          />
        </FormField>
        <FormField label="TRASLADO">
          <input
            type="date"
            value={form.fechaTraslado}
            onChange={(event) => {
              invalidatePreview();
              setForm((current) => ({ ...current, fechaTraslado: event.target.value }));
            }}
          />
        </FormField>
        <FormField label="SERIE Y NUMERO" required>
          <div className="series-control">
            <select value={form.serie} onChange={(event) => changeSerie(event.target.value as FlexoGuideSerie)}>
              <option value="T003">T003</option>
              <option value="T999">T999</option>
            </select>
            <input className="auto-field" value={form.serieNumeroGuia} readOnly />
          </div>
        </FormField>
        <FormField label="DESTINATARIO" required wide>
          <input className="auto-field" value={selectedClientLabel} readOnly placeholder="Seleccione un cliente" />
        </FormField>
        <FormField label="DESTINO" required wide>
          <div className="destination-line">
            <select
              value={form.destino.id}
              onChange={(event) => {
                const next = destinos.find((item) => item.id === event.target.value);
                invalidatePreview();
                setForm((current) => ({ ...current, destino: next ?? { id: '', ubigeo: '', direccion: '' } }));
              }}
            >
              <option value="">Seleccione destino</option>
              {destinos.map((item) => (
                <option value={item.id} key={item.id}>{item.direccion}</option>
              ))}
            </select>
            <input className="auto-field" value={form.destino.ubigeo} readOnly placeholder="Ubigeo" />
          </div>
        </FormField>
        <FormField label="ORIGEN" required wide>
          <input className="auto-field" value="140109-AV. LUNA PIZARRO NRO. 1328(1332-1336-1340 PUERTA DE INGRESO 1340)" readOnly />
        </FormField>
        <FormField label="MODALIDAD" required>
          <select
            value={form.modalidadTraslado}
            onChange={(event) => {
              invalidatePreview();
              setForm((current) => ({ ...current, modalidadTraslado: event.target.value }));
            }}
          >
            <option value="02">PRIVADO</option>
            <option value="01">PUBLICO</option>
          </select>
        </FormField>
        <FormField label="MOTIVO" required wide>
          <select value={form.motivoTraslado} onChange={(event) => changeMotivo(event.target.value)}>
            <option value="">Seleccione un motivo</option>
            {transferReasons.map((item) => (
              <option value={item.code} key={item.code}>{item.label}</option>
            ))}
          </select>
        </FormField>
        <FormField label="PESO BRUTO" required>
          <div className="pair compact-pair">
            <input
              type="number"
              min="0.01"
              step="0.01"
              value={form.pesoBruto}
              onChange={(event) => {
                invalidatePreview();
                setForm((current) => ({ ...current, pesoBruto: Number(event.target.value) }));
              }}
            />
            <select
              value={form.unidadPeso}
              onChange={(event) => {
                invalidatePreview();
                setForm((current) => ({ ...current, unidadPeso: event.target.value }));
              }}
            >
              <option value="KGM">KGM</option>
            </select>
          </div>
        </FormField>
        <FormField label="NRO BULTOS">
          <input
            type="number"
            min="1"
            value={form.numeroBultos}
            onChange={(event) => {
              invalidatePreview();
              setForm((current) => ({ ...current, numeroBultos: Number(event.target.value) }));
            }}
          />
        </FormField>
        <FormField label="ORDEN COMPRA">
          <input
            value={form.ordenCompra}
            onChange={(event) => {
              invalidatePreview();
              setForm((current) => ({ ...current, ordenCompra: event.target.value }));
            }}
            placeholder="Sin OC registrada"
          />
        </FormField>
        <FormField label="OBSERVACIONES" wide>
          <div className="limited-field">
            <input
              value={form.observaciones}
              maxLength={SUNAT_GRE_OBSERVATION_MAX_LENGTH}
              onChange={(event) => {
                invalidatePreview();
                setForm((current) => ({ ...current, observaciones: event.target.value }));
              }}
            />
            <CharacterCounter current={form.observaciones.length} maximum={SUNAT_GRE_OBSERVATION_MAX_LENGTH} />
          </div>
        </FormField>
      </div>

      <div className="driver-row flexo-driver-row">
        <FormField label="CHOFER">
          <select value={form.selectedDriverId} onChange={(event) => changeDriver(event.target.value)}>
            <option value="">Seleccione chofer</option>
            {selectableDrivers.map((driver) => (
              <option value={driverIdentity(driver)} key={driverIdentity(driver)}>
                {driver.nombres} {driver.apellidos} - DNI {driver.numeroDocumento} - Lic. {driver.licencia}
              </option>
            ))}
          </select>
        </FormField>
        <FormField label="LICENCIA">
          <input className="auto-field" value={form.conductor.licencia} readOnly />
        </FormField>
        <FormField label="PLACA">
          <select
            value={form.conductor.placa}
            disabled={!form.selectedDriverId || selectablePlates.length === 0}
            onChange={(event) => {
              invalidatePreview();
              setForm((current) => ({
                ...current,
                conductor: { ...current.conductor, placa: event.target.value }
              }));
            }}
          >
            <option value="">Seleccione placa</option>
            {selectablePlates.map((plate) => <option key={plate} value={plate}>{plate}</option>)}
          </select>
        </FormField>
      </div>

      <section className="products-area">
        <div className="products-table-wrap">
          <div className="flexo-table-actions">
            <button type="button" className="tool-button primary-tool" disabled={!cliente} onClick={() => setEmpaqueModalOpen(true)}>
              <PackageSearch size={16} />
              Empaques
            </button>
          </div>
          <table className="products-table flexo-selected-table">
            <thead>
              <tr>
                <th>Codigo</th>
                <th>Descripcion generada</th>
                <th>Cantidad</th>
                <th>Um</th>
                <th>Empaque</th>
              </tr>
            </thead>
            <tbody>
              {items.length === 0 ? (
                <tr>
                  <td colSpan={5} className="empty-row">Seleccione un cliente y asigne empaques pendientes.</td>
                </tr>
              ) : items.map((item) => (
                <tr key={item.id}>
                  <td>{item.codigoProducto}</td>
                  <td>{item.descripcion}</td>
                  <td>{item.cantidad}</td>
                  <td>{item.unidadMedida}</td>
                  <td>{item.codigoEmpaque}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="declare-area">
          <button type="button" className="preview-button" disabled={!canPreview || previewLoading} onClick={() => void openPreview()}>
            <Eye size={16} />
            {previewLoading ? 'Validando' : 'Vista previa'}
          </button>
          <button type="button" className="declare-button" disabled title="Pendiente replicar escritura Flexo con auditoria">
            <Send size={16} />
            Declarar bloqueado
          </button>
          {previewConfirmed && <div className="declare-hint">Vista previa confirmada.</div>}
        </div>
      </section>

      {previewOpen && preview && (
        <FlexoGuidePreviewModal
          preview={preview}
          onClose={() => setPreviewOpen(false)}
          onConfirm={() => {
            setPreviewConfirmed(true);
            setPreviewOpen(false);
            setMessage(`Vista previa confirmada para ${preview.serieNumeroGuia}.`);
          }}
        />
      )}

      {empaqueModalOpen && cliente && (
        <FlexoEmpaqueModal
          cliente={cliente}
          selected={form.empaques}
          onClose={() => setEmpaqueModalOpen(false)}
          onAssign={assignEmpaques}
        />
      )}
    </section>
  );
}

function FlexoEmpaqueModal({
  cliente,
  selected,
  onClose,
  onAssign
}: {
  cliente: FlexoCliente;
  selected: FlexoEmpaque[];
  onClose: () => void;
  onAssign: (items: FlexoEmpaque[]) => void;
}) {
  const [desde, setDesde] = useState(todayDate());
  const [hasta, setHasta] = useState(todayDate());
  const [filtro, setFiltro] = useState('');
  const [empaques, setEmpaques] = useState<FlexoEmpaque[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set(selected.map((item) => item.id)));
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');

  async function loadEmpaques() {
    setLoading(true);
    setMessage('Buscando empaques...');

    try {
      const result = await flexoService.listEmpaques({
        numeroDocumento: cliente.numeroDocumento,
        desde,
        hasta,
        filtro
      });
      setEmpaques(result);
      setMessage(result.length > 0 ? `${result.length} empaque(s) pendiente(s).` : 'Sin empaques pendientes para ese rango.');
    } catch (error) {
      setEmpaques([]);
      setMessage(error instanceof Error ? error.message : 'No se pudo buscar empaques.');
    } finally {
      setLoading(false);
    }
  }

  function toggle(id: string, checked: boolean) {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  function assign() {
    onAssign(empaques.filter((item) => selectedIds.has(item.id)));
  }

  return (
    <div className="modal-backdrop">
      <div className="modal-card flexo-empaque-modal">
        <header className="modal-header">
          <h2>EMPAQUE</h2>
        </header>
        <div className="flexo-empaque-filters">
          <label>
            Desde
            <input type="date" value={desde} onChange={(event) => setDesde(event.target.value)} />
          </label>
          <label>
            Hasta
            <input type="date" value={hasta} onChange={(event) => setHasta(event.target.value)} />
          </label>
          <label>
            Filtrar
            <div className="inline-search">
              <input value={filtro} onChange={(event) => setFiltro(event.target.value)} placeholder="Cod. empaque" />
              <button type="button" className="icon-button" onClick={() => void loadEmpaques()} disabled={loading}>
                <Search size={18} />
              </button>
            </div>
          </label>
        </div>
        {message && <div className="inline-message flexo-modal-message">{message}</div>}
        <div className="flexo-empaque-table-wrap">
          <table className="flexo-empaque-table">
            <colgroup>
              <col className="empaque-check-col" />
              <col className="empaque-info-col" />
              <col className="empaque-detail-col" />
            </colgroup>
            <thead>
              <tr>
                <th></th>
                <th>EMPAQUE</th>
                <th>DETALLES</th>
              </tr>
            </thead>
            <tbody>
              {empaques.length === 0 ? (
                <tr>
                  <td colSpan={3} className="empty-row">Busque empaques pendientes del cliente.</td>
                </tr>
              ) : empaques.map((item) => (
                <tr key={item.id}>
                  <td>
                    <input
                      className="small-checkbox"
                      type="checkbox"
                      checked={selectedIds.has(item.id)}
                      onChange={(event) => toggle(item.id, event.target.checked)}
                    />
                  </td>
                  <td>
                    <div className="flexo-empaque-facts">
                      <span><b>Cod:</b> {item.codigoEmpaque}</span>
                      <span><b>Nro Lote:</b> {item.ticket || 'Sin dato'}</span>
                      {item.ordenCompra && <span><b>O/Compra:</b> {item.ordenCompra}</span>}
                      <span><b>Fecha:</b> {formatEmpaqueDate(item.fechaCreacion)}</span>
                      <span><b>Cliente:</b> {cliente.numeroDocumento}</span>
                    </div>
                  </td>
                  <td>
                    <div className="flexo-empaque-details">
                      {item.items.length === 0 ? (
                        <div className="flexo-detail-card">Sin detalle</div>
                      ) : item.items.map((detail) => (
                        <div className="flexo-detail-card" key={detail.id}>
                          <div>{detail.codigoProducto} - {detail.descripcion}</div>
                          <div>cant.: {formatQuantity(detail.cantidad)} ({detail.unidadMedida})</div>
                        </div>
                      ))}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <footer className="modal-actions">
          <button type="button" className="secondary-button" onClick={onClose}>Salir</button>
          <button type="button" className="primary-button" onClick={assign}>Asignar</button>
        </footer>
      </div>
    </div>
  );
}

function formatEmpaqueDate(value: string | null) {
  if (!value) return 'Sin fecha';

  return new Date(value).toLocaleDateString('es-PE', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric'
  });
}

function formatQuantity(value: number) {
  return Number.isInteger(value) ? String(value) : String(Number(value.toFixed(3)));
}
