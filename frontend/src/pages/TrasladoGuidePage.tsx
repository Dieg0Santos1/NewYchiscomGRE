import { useEffect, useMemo, useState } from 'react';
import { Eye, Plus, RefreshCw, Search, Send, Trash2, X } from 'lucide-react';
import { DeclarationSuccessModal } from '../components/DeclarationSuccessModal';
import { FormField } from '../components/FormField';
import { currentTime, sunatDateTime, todayDate } from '../data/defaults';
import { driverService } from '../services/DriverService';
import { facturaFcService } from '../services/FacturaFcService';
import { greFormularioService } from '../services/GreFormularioService';
import { greTrasladoService } from '../services/GreTrasladoService';
import type { FcFacturaCliente } from '../types/factura';
import type { DriverCatalogItem, RecipientAddress } from '../types/gre';
import type {
  GreTrasladoInputDto,
  TrasladoFormState,
  TrasladoItem,
  TrasladoModalidadCode,
  TrasladoMotivoCode,
  TrasladoPreviewResponse
} from '../types/traslado';

const trasladoMotivos: Array<{ codigo: TrasladoMotivoCode; descripcion: string; label: string }> = [
  { codigo: '03', descripcion: 'OTROS', label: '03 - OTROS' },
  { codigo: '02', descripcion: 'COMPRA', label: '02 - COMPRA' }
];

const trasladoModalidades: Array<{ codigo: TrasladoModalidadCode; label: string }> = [
  { codigo: '02', label: '02 - PRIVADO' },
  { codigo: '01', label: '01 - PUBLICO' }
];

const trasladoRemitente = {
  tipoDocumento: '6',
  numeroDocumento: '20259402965',
  razonSocial: 'YCHIFORMAS S.A.'
} as const;
const trasladoLocalRemitente = {
  ubigeo: '140109',
  direccion: 'AV. LUNA PIZARRO NRO. 1328(1332-1336-1340 PUERTA DE INGRESO 1340)',
  codigo: '1'
} as const;
const compraRemitenteLabel = `${trasladoRemitente.numeroDocumento} - ${trasladoRemitente.razonSocial}`;

function defaultState(): TrasladoFormState {
  const date = todayDate();

  return {
    serieNumeroGuia: 'T002-00000001',
    referenciaInterna: '',
    fechaEmisionGuia: date,
    horaEmisionGuia: currentTime(),
    fechaInicioTraslado: date,
    fechaEntregaBienes: date,
    observaciones: '',
    correoDestinatario: '-',
    tipoDocumentoDestinatario: '6',
    numeroDocumentoDestinatario: '',
    razonSocialDestinatario: '',
    ubigeoPtoLlegada: '',
    direccionPtoLlegada: '',
    codigoPtoLlegada: '1',
    motivoTraslado: '03',
    descripcionMotivoTraslado: 'OTROS',
    modalidadTraslado: '02',
    pesoBrutoTotalBienes: 1,
    numeroBultos: 1,
    selectedDriverId: '',
    tipoDocumentoConductor: '1',
    numeroDocumentoConductor: '',
    nombreConductor: '',
    apellidoConductor: '',
    numeroLicencia: '',
    numeroPlacaVehiculoPrin: '',
    tipoDocumentoTransportista: '6',
    numeroRucTransportista: '',
    razonSocialTransportista: '',
    items: [newItem(1)]
  };
}

function newItem(index: number): TrasladoItem {
  const code = `TRAS-${String(index).padStart(3, '0')}`;

  return {
    id: `${code}-${Date.now()}-${index}`,
    codigoProducto: code,
    descripcion: '',
    cantidad: 1,
    unidadMedida: 'NIU'
  };
}

export function TrasladoGuidePage() {
  const [form, setForm] = useState<TrasladoFormState>(() => defaultState());
  const [cliente, setCliente] = useState<FcFacturaCliente | null>(null);
  const [query, setQuery] = useState('');
  const [clientes, setClientes] = useState<FcFacturaCliente[]>([]);
  const [destinos, setDestinos] = useState<RecipientAddress[]>([]);
  const [selectedDestinoId, setSelectedDestinoId] = useState('');
  const [loadingClientes, setLoadingClientes] = useState(false);
  const [drivers, setDrivers] = useState<DriverCatalogItem[]>([]);
  const [message, setMessage] = useState('');
  const [preview, setPreview] = useState<TrasladoPreviewResponse | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState('');
  const [previewConfirmed, setPreviewConfirmed] = useState(false);
  const [declaring, setDeclaring] = useState(false);
  const [operationId, setOperationId] = useState('');
  const [successSerie, setSuccessSerie] = useState('');

  const payload = useMemo(() => toTrasladoInputDto(form), [form]);
  const selectedClientLabel = cliente ? `${cliente.numeroDocumento} - ${cliente.razonSocial}` : '';
  const isCompra = form.motivoTraslado === '02';
  const isCompraRecipientValid = !isCompra || isRemitenteDestinatario(form);
  const hasDriverData = Boolean(
    form.selectedDriverId &&
    form.numeroDocumentoConductor &&
    form.nombreConductor &&
    form.apellidoConductor &&
    form.numeroLicencia &&
    form.numeroPlacaVehiculoPrin
  );
  const hasTransportistaData = Boolean(
    form.tipoDocumentoTransportista.trim() &&
    /^\d{11}$/.test(form.numeroRucTransportista.trim()) &&
    form.razonSocialTransportista.trim()
  );
  const hasTransportData = form.modalidadTraslado === '02' ? hasDriverData : hasTransportistaData;
  const validItems = form.items.filter((item) =>
    item.codigoProducto.trim() &&
    item.descripcion.trim() &&
    item.cantidad > 0 &&
    item.unidadMedida.trim()
  );
  const isFormValid = Boolean(
    /^T002-\d{8}$/.test(form.serieNumeroGuia) &&
    form.numeroDocumentoDestinatario.trim() &&
    form.razonSocialDestinatario.trim() &&
    isCompraRecipientValid &&
    /^\d{6}$/.test(form.ubigeoPtoLlegada.trim()) &&
    form.direccionPtoLlegada.trim() &&
    form.codigoPtoLlegada.trim() &&
    form.motivoTraslado &&
    form.descripcionMotivoTraslado.trim() &&
    form.pesoBrutoTotalBienes > 0 &&
    form.numeroBultos > 0 &&
    hasTransportData &&
    validItems.length > 0 &&
    validItems.length === form.items.length
  );
  const canDeclare = isFormValid && previewConfirmed && !declaring;
  const declareHint = !isCompraRecipientValid
    ? 'Para 02 - COMPRA, el destinatario debe ser el remitente.'
    : !isFormValid
    ? 'Complete cliente, destino, motivo, transporte, peso/bultos y cada item manual.'
    : !previewConfirmed
      ? 'Abra Vista previa y confirme antes de declarar.'
      : '';

  useEffect(() => {
    void loadNextSerie();
    driverService.listPrivateDrivers()
      .then(setDrivers)
      .catch((error) => setMessage(error instanceof Error ? error.message : 'No se pudo cargar choferes.'));
  }, []);

  useEffect(() => {
    if (isCompra && query === compraRemitenteLabel) return;
    if (cliente && query === selectedClientLabel) return;
    if (query.trim().length < 2) {
      setClientes([]);
      return;
    }

    const timeout = window.setTimeout(() => {
      void searchClientes(false);
    }, 300);

    return () => window.clearTimeout(timeout);
  }, [cliente, isCompra, query, selectedClientLabel]);

  function invalidatePreview() {
    setPreview(null);
    setPreviewConfirmed(false);
    setPreviewError('');
  }

  function updateField<K extends keyof TrasladoFormState>(field: K, value: TrasladoFormState[K]) {
    invalidatePreview();
    setForm((current) => ({ ...current, [field]: value }));
  }

  async function loadNextSerie() {
    try {
      const result = await greTrasladoService.getNextSerie();
      setForm((current) => ({ ...current, serieNumeroGuia: result.serieNumeroGuia }));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'No se pudo cargar correlativo T002.');
    }
  }

  async function searchClientes(showStatus = true) {
    if (isCompra) {
      setClientes([]);
      if (showStatus) setMessage('Para 02 - COMPRA, el destinatario se consigna como el remitente.');
      return;
    }

    setLoadingClientes(true);
    if (showStatus) setMessage('Buscando clientes...');
    invalidatePreview();

    try {
      const result = await facturaFcService.searchClientes(query);
      setClientes(result);
      if (showStatus) {
        setMessage(result.length > 0 ? `${result.length} cliente(s) encontrados.` : 'Sin clientes para mostrar.');
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'No se pudo buscar clientes.');
    } finally {
      setLoadingClientes(false);
    }
  }

  async function selectCliente(nextCliente: FcFacturaCliente) {
    invalidatePreview();
    setCliente(nextCliente);
    setQuery(`${nextCliente.numeroDocumento} - ${nextCliente.razonSocial}`);
    setClientes([]);
    setDestinos([]);
    setSelectedDestinoId('');
    setForm((current) => ({
      ...current,
      tipoDocumentoDestinatario: nextCliente.tipoDocumento || '6',
      numeroDocumentoDestinatario: nextCliente.numeroDocumento,
      razonSocialDestinatario: nextCliente.razonSocial,
      direccionPtoLlegada: '',
      ubigeoPtoLlegada: '',
      codigoPtoLlegada: '1'
    }));
    setMessage(`Cargando destino de ${nextCliente.razonSocial}...`);

    try {
      const result = await greFormularioService.getDestinos(nextCliente.numeroDocumento);
      const firstDestination = result[0];
      setDestinos(result);
      setSelectedDestinoId(firstDestination?.id ?? '');
      setForm((current) => ({
        ...current,
        direccionPtoLlegada: firstDestination?.direccion ?? '',
        ubigeoPtoLlegada: firstDestination?.ubigeo ?? '',
        codigoPtoLlegada: firstDestination?.codigoDestino ?? '1'
      }));
      setMessage(firstDestination
        ? isCompleteDestination(firstDestination)
          ? `Cliente seleccionado con destino: ${firstDestination.ubigeo} - ${firstDestination.direccion}.`
          : `Cliente seleccionado con destino: ${firstDestination.direccion}. Complete el ubigeo.`
        : 'Cliente seleccionado sin destino historico. Complete destino manualmente.');
    } catch (error) {
      setMessage(error instanceof Error
        ? `Cliente seleccionado, pero no se pudo cargar destino: ${error.message}`
        : 'Cliente seleccionado, pero no se pudo cargar destino.');
    }
  }

  function changeClientQuery(value: string) {
    if (isCompra) return;

    invalidatePreview();
    setQuery(value);

    if (!cliente || value === selectedClientLabel) return;

    setCliente(null);
    setDestinos([]);
    setSelectedDestinoId('');
    setForm((current) => ({
      ...current,
      tipoDocumentoDestinatario: '6',
      numeroDocumentoDestinatario: '',
      razonSocialDestinatario: ''
    }));
  }

  function selectDestino(destinoId: string) {
    invalidatePreview();
    setSelectedDestinoId(destinoId);
    const destino = destinos.find((item) => item.id === destinoId);

    setForm((current) => ({
      ...current,
      direccionPtoLlegada: destino?.direccion ?? current.direccionPtoLlegada,
      ubigeoPtoLlegada: destino?.ubigeo ?? current.ubigeoPtoLlegada,
      codigoPtoLlegada: destino?.codigoDestino ?? current.codigoPtoLlegada
    }));
  }

  function updateDestinationField<K extends 'direccionPtoLlegada' | 'ubigeoPtoLlegada' | 'codigoPtoLlegada'>(field: K, value: TrasladoFormState[K]) {
    if (field === 'direccionPtoLlegada') setSelectedDestinoId('');
    updateField(field, value);
  }

  function selectMotivo(codigo: TrasladoMotivoCode) {
    const motivo = trasladoMotivos.find((item) => item.codigo === codigo) ?? trasladoMotivos[0]!;
    invalidatePreview();
    setCliente(null);
    setClientes([]);
    setDestinos([]);
    setSelectedDestinoId('');
    setQuery(codigo === '02' ? compraRemitenteLabel : '');
    setForm((current) => ({
      ...current,
      motivoTraslado: motivo.codigo,
      descripcionMotivoTraslado: motivo.descripcion,
      tipoDocumentoDestinatario: codigo === '02' ? trasladoRemitente.tipoDocumento : current.motivoTraslado === '02' ? '6' : current.tipoDocumentoDestinatario,
      numeroDocumentoDestinatario: codigo === '02' ? trasladoRemitente.numeroDocumento : current.motivoTraslado === '02' ? '' : current.numeroDocumentoDestinatario,
      razonSocialDestinatario: codigo === '02' ? trasladoRemitente.razonSocial : current.motivoTraslado === '02' ? '' : current.razonSocialDestinatario,
      direccionPtoLlegada: codigo === '02' ? trasladoLocalRemitente.direccion : current.motivoTraslado === '02' ? '' : current.direccionPtoLlegada,
      ubigeoPtoLlegada: codigo === '02' ? trasladoLocalRemitente.ubigeo : current.motivoTraslado === '02' ? '' : current.ubigeoPtoLlegada,
      codigoPtoLlegada: codigo === '02' ? trasladoLocalRemitente.codigo : current.motivoTraslado === '02' ? '1' : current.codigoPtoLlegada
    }));
    setMessage(codigo === '02'
      ? 'Para 02 - COMPRA, SUNAT exige destinatario igual al remitente. Se completo el destino con el local de YCHIFORMAS.'
      : '');
  }

  function selectModalidad(codigo: TrasladoModalidadCode) {
    invalidatePreview();
    setForm((current) => ({
      ...current,
      modalidadTraslado: codigo,
      selectedDriverId: codigo === '02' ? current.selectedDriverId : '',
      numeroDocumentoConductor: codigo === '02' ? current.numeroDocumentoConductor : '',
      nombreConductor: codigo === '02' ? current.nombreConductor : '',
      apellidoConductor: codigo === '02' ? current.apellidoConductor : '',
      numeroLicencia: codigo === '02' ? current.numeroLicencia : '',
      numeroPlacaVehiculoPrin: codigo === '02' ? current.numeroPlacaVehiculoPrin : '',
      numeroRucTransportista: codigo === '01' ? current.numeroRucTransportista : '',
      razonSocialTransportista: codigo === '01' ? current.razonSocialTransportista : ''
    }));
  }

  function selectDriver(driverId: string) {
    const driver = drivers.find((item) => item.id === driverId);
    invalidatePreview();
    setForm((current) => ({
      ...current,
      selectedDriverId: driverId,
      tipoDocumentoConductor: driver?.tipoDocumento ?? '1',
      numeroDocumentoConductor: driver?.numeroDocumento ?? '',
      nombreConductor: driver?.nombres ?? '',
      apellidoConductor: driver?.apellidos ?? '',
      numeroLicencia: driver?.licencia ?? '',
      numeroPlacaVehiculoPrin: driver?.placa ?? ''
    }));
  }

  function updateItem(itemId: string, patch: Partial<TrasladoItem>) {
    invalidatePreview();
    setForm((current) => ({
      ...current,
      items: current.items.map((item) => item.id === itemId ? { ...item, ...patch } : item)
    }));
  }

  function addItem() {
    invalidatePreview();
    setForm((current) => ({
      ...current,
      items: [...current.items, newItem(current.items.length + 1)]
    }));
  }

  function removeItem(itemId: string) {
    invalidatePreview();
    setForm((current) => ({
      ...current,
      items: current.items.length === 1
        ? [{ ...current.items[0]!, descripcion: '', cantidad: 1, unidadMedida: 'NIU' }]
        : current.items.filter((item) => item.id !== itemId)
    }));
  }

  async function openPreview() {
    const { date, time } = sunatDateTime();
    const nextForm = {
      ...form,
      fechaEmisionGuia: date,
      horaEmisionGuia: time,
      fechaInicioTraslado: date,
      fechaEntregaBienes: date
    };

    setForm(nextForm);
    setPreviewOpen(true);
    setPreviewLoading(true);
    setPreviewError('');
    setPreview(null);
    setPreviewConfirmed(false);

    try {
      setPreview(await greTrasladoService.preview(toTrasladoInputDto(nextForm)));
      setMessage('Vista previa validada para Traslado T002.');
    } catch (error) {
      setPreviewError(error instanceof Error ? error.message : 'No se pudo validar la vista previa.');
    } finally {
      setPreviewLoading(false);
    }
  }

  async function declareGuide() {
    if (!canDeclare) return;
    const nextOperationId = createOperationId();
    const { date, time } = sunatDateTime();
    const declarationForm = {
      ...form,
      fechaEmisionGuia: date,
      horaEmisionGuia: time,
      fechaInicioTraslado: date,
      fechaEntregaBienes: date
    };
    const declarationPayload = toTrasladoInputDto(declarationForm);

    setOperationId(nextOperationId);
    setDeclaring(true);
    setMessage('Declarando traslado T002 en Bizlinks...');
    setForm(declarationForm);

    try {
      const result = await greTrasladoService.declare(declarationPayload, nextOperationId);
      setSuccessSerie(result.generatedSerieNumeroGuia);
      setMessage(`Traslado ${result.generatedSerieNumeroGuia} declarado en Bizlinks.`);
      setPreviewConfirmed(false);
      setPreview(null);
      setCliente(null);
      setQuery('');
      setClientes([]);
      setDestinos([]);
      setSelectedDestinoId('');
      setForm(defaultState());
      await loadNextSerie();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'No se pudo declarar el traslado.');
    } finally {
      setDeclaring(false);
    }
  }

  function clearForm() {
    invalidatePreview();
    setOperationId('');
    setSuccessSerie('');
    setMessage('');
    setCliente(null);
    setQuery('');
    setClientes([]);
    setDestinos([]);
    setSelectedDestinoId('');
    setForm(defaultState());
    void loadNextSerie();
  }

  return (
    <section className="screen-panel traslado-screen">
      <div className="search-strip traslado-strip">
        <FormField label="CLIENTE" required wide>
          <div className="invoice-client-combo">
            <div className="invoice-client-picker">
              <input
                value={query}
                onChange={(event) => changeClientQuery(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault();
                    void searchClientes();
                  }
                }}
                placeholder={isCompra ? compraRemitenteLabel : cliente ? `${cliente.numeroDocumento} - ${cliente.razonSocial}` : 'RUC o razon social'}
                disabled={isCompra}
              />
              <button type="button" className="icon-button" title="Buscar cliente" onClick={() => void searchClientes()} disabled={loadingClientes || isCompra}>
                <Search size={18} />
              </button>
              <button type="button" className="icon-button" title="Limpiar traslado" onClick={clearForm}>
                <RefreshCw size={18} />
              </button>
            </div>
            {clientes.length > 0 && !cliente && !isCompra && (
              <section className="client-suggestions traslado-client-suggestions">
                <div className="client-suggestions-title">Seleccione un cliente</div>
                {clientes.map((item) => (
                  <button key={item.id} type="button" onClick={() => void selectCliente(item)}>
                    <span>{item.numeroDocumento}</span>
                    <strong>{item.razonSocial}</strong>
                    <em>{item.fuente}</em>
                  </button>
                ))}
              </section>
            )}
          </div>
        </FormField>
        {message && <div className="inline-message">{message}</div>}
      </div>

      <div className="form-grid traslado-form-grid">
        <FormField label="EMPRESA" required>
          <input className="auto-field" value="20259402965-6-YCHIFORMAS S.A." readOnly />
        </FormField>
        <FormField label="FECHA EMISION">
          <input className="auto-field" type="datetime-local" value={`${form.fechaEmisionGuia}T${form.horaEmisionGuia.slice(0, 5)}`} readOnly />
        </FormField>
        <FormField label="TRASLADO">
          <input type="date" value={form.fechaInicioTraslado} onChange={(event) => updateField('fechaInicioTraslado', event.target.value)} />
        </FormField>

        <FormField label="SERIE Y NUMERO" required>
          <input className="auto-field" value={form.serieNumeroGuia} readOnly />
        </FormField>
        <FormField label="REFERENCIA">
          <input value={form.referenciaInterna} maxLength={80} onChange={(event) => updateField('referenciaInterna', event.target.value)} placeholder="Ej: activos, oficina, prestamo" />
        </FormField>
        <FormField label="MOTIVO" required>
          <select value={form.motivoTraslado} onChange={(event) => selectMotivo(event.target.value as TrasladoMotivoCode)}>
            {trasladoMotivos.map((motivo) => (
              <option key={motivo.codigo} value={motivo.codigo}>{motivo.label}</option>
            ))}
          </select>
        </FormField>

        <FormField label="DOC CLIENTE" required>
          <div className="recipient-line traslado-doc-line">
            <input className="auto-field" value={form.tipoDocumentoDestinatario} readOnly />
            <input className="auto-field" value={form.numeroDocumentoDestinatario} readOnly />
          </div>
        </FormField>
        <FormField label="RAZON SOCIAL" required wide>
          <input className="auto-field" value={form.razonSocialDestinatario} readOnly />
        </FormField>

        <FormField label="DESTINO" required wide>
          <div className="traslado-destination-line">
            {destinos.length > 0 ? (
              <select value={selectedDestinoId} onChange={(event) => selectDestino(event.target.value)}>
                <option value="">Seleccione destino</option>
                {destinos.map((destino) => (
                  <option key={destino.id} value={destino.id}>
                    {destino.ubigeo ? `${destino.ubigeo} - ` : ''}{destino.direccion}
                  </option>
                ))}
              </select>
            ) : (
              <input value={form.direccionPtoLlegada} maxLength={100} onChange={(event) => updateDestinationField('direccionPtoLlegada', event.target.value)} placeholder="Direccion de llegada" />
            )}
            <input value={form.ubigeoPtoLlegada} maxLength={6} onChange={(event) => updateDestinationField('ubigeoPtoLlegada', event.target.value.replace(/\D/g, ''))} placeholder="Ubigeo" />
          </div>
        </FormField>

        <FormField label="ORIGEN" required wide>
          <input className="auto-field" value="140109-AV. LUNA PIZARRO NRO. 1328(1332-1336-1340 PUERTA DE INGRESO 1340)" readOnly />
        </FormField>

        <FormField label="MODALIDAD" required>
          <select value={form.modalidadTraslado} onChange={(event) => selectModalidad(event.target.value as TrasladoModalidadCode)}>
            {trasladoModalidades.map((modalidad) => (
              <option key={modalidad.codigo} value={modalidad.codigo}>{modalidad.label}</option>
            ))}
          </select>
        </FormField>
        <FormField label="PESO BRUTO" required>
          <div className="pair compact-pair">
            <input type="number" min="0.01" step="0.01" value={form.pesoBrutoTotalBienes} onChange={(event) => updateField('pesoBrutoTotalBienes', Number(event.target.value))} />
            <input className="auto-field" value="KGM" readOnly />
          </div>
        </FormField>
        <FormField label="NRO BULTOS" required>
          <input type="number" min="1" value={form.numeroBultos} onChange={(event) => updateField('numeroBultos', Number(event.target.value))} />
        </FormField>
        <FormField label="OBSERVACIONES" wide>
          <input value={form.observaciones} maxLength={250} onChange={(event) => updateField('observaciones', event.target.value)} />
        </FormField>
      </div>

      {form.modalidadTraslado === '02' ? (
        <div className="driver-row traslado-driver-row">
          <FormField label="CHOFER" required>
            <select value={form.selectedDriverId} onChange={(event) => selectDriver(event.target.value)}>
              <option value="">Seleccione chofer</option>
              {drivers.map((driver) => (
                <option value={driver.id} key={driver.id}>
                  {driver.numeroDocumento} - {driver.nombres} {driver.apellidos} - {driver.placa}
                </option>
              ))}
            </select>
          </FormField>
          <FormField label="LICENCIA">
            <input className="auto-field" value={form.numeroLicencia} readOnly />
          </FormField>
          <FormField label="PLACA">
            <input className="auto-field" value={form.numeroPlacaVehiculoPrin} readOnly />
          </FormField>
        </div>
      ) : (
        <div className="driver-row traslado-transportista-row">
          <FormField label="TRANSPORTISTA" required>
            <div className="traslado-transportista-line">
              <select value={form.tipoDocumentoTransportista} onChange={(event) => updateField('tipoDocumentoTransportista', event.target.value)}>
                <option value="6">RUC</option>
              </select>
              <input value={form.numeroRucTransportista} maxLength={11} onChange={(event) => updateField('numeroRucTransportista', event.target.value.replace(/\D/g, ''))} placeholder="RUC transportista" />
            </div>
          </FormField>
          <FormField label="RAZON SOCIAL" required wide>
            <input value={form.razonSocialTransportista} maxLength={100} onChange={(event) => updateField('razonSocialTransportista', event.target.value.toUpperCase())} placeholder="Razon social transportista" />
          </FormField>
        </div>
      )}

      <section className="products-area">
        <div className="products-table-wrap">
          <div className="flexo-table-actions">
            <button type="button" className="tool-button primary-tool" onClick={addItem}>
              <Plus size={16} />
              Item
            </button>
          </div>
          <table className="products-table traslado-items-table">
            <thead>
              <tr>
                <th>Codigo</th>
                <th>Descripcion manual</th>
                <th>Cantidad</th>
                <th>Unidad</th>
                <th>Acciones</th>
              </tr>
            </thead>
            <tbody>
              {form.items.map((item) => (
                <tr key={item.id}>
                  <td>
                    <input value={item.codigoProducto} maxLength={16} onChange={(event) => updateItem(item.id, { codigoProducto: event.target.value.toUpperCase() })} />
                  </td>
                  <td>
                    <input value={item.descripcion} maxLength={500} onChange={(event) => updateItem(item.id, { descripcion: event.target.value.toUpperCase() })} placeholder="Ej: LAPTOP LENOVO COLOR NEGRO" />
                  </td>
                  <td>
                    <input type="number" min="0.001" step="0.001" value={item.cantidad} onChange={(event) => updateItem(item.id, { cantidad: Number(event.target.value) })} />
                  </td>
                  <td>
                    <select value={item.unidadMedida} onChange={(event) => updateItem(item.id, { unidadMedida: event.target.value })}>
                      <option value="NIU">NIU</option>
                      <option value="KGM">KGM</option>
                      <option value="MTR">MTR</option>
                      <option value="ZZ">ZZ</option>
                    </select>
                  </td>
                  <td>
                    <button type="button" className="icon-button" title="Quitar item" onClick={() => removeItem(item.id)}>
                      <Trash2 size={18} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="declare-area">
          <button type="button" className="preview-button" disabled={!isFormValid || previewLoading || declaring} onClick={() => void openPreview()}>
            <Eye size={16} />
            {previewLoading ? 'Validando' : 'Vista previa'}
          </button>
          <button type="button" className="declare-button" disabled={!canDeclare} title={declareHint} onClick={() => void declareGuide()}>
            <Send size={16} />
            {declaring ? 'Declarando' : 'Declarar'}
          </button>
          {!canDeclare && !declaring && <div className="declare-hint">{declareHint}</div>}
          {operationId && <div className="inline-message">Operacion: {operationId}</div>}
        </div>
      </section>

      {previewOpen && (
        <TrasladoPreviewModal
          payload={payload}
          backendPreview={preview}
          error={previewError}
          loading={previewLoading}
          onClose={() => setPreviewOpen(false)}
          onConfirm={() => {
            setPreviewConfirmed(true);
            setPreviewOpen(false);
          }}
        />
      )}

      {successSerie && (
        <DeclarationSuccessModal
          documentLabel="Traslado"
          serieNumero={successSerie}
          reportsPath="/traslado/reportes"
          onClose={() => setSuccessSerie('')}
        />
      )}
    </section>
  );
}

function toTrasladoInputDto(form: TrasladoFormState): GreTrasladoInputDto {
  const payload: GreTrasladoInputDto = {
    serieNumeroGuia: form.serieNumeroGuia,
    referenciaInterna: form.referenciaInterna,
    fechaEmisionGuia: form.fechaEmisionGuia,
    horaEmisionGuia: form.horaEmisionGuia,
    fechaInicioTraslado: form.fechaInicioTraslado,
    fechaEntregaBienes: form.fechaEntregaBienes,
    observaciones: form.observaciones,
    correoDestinatario: form.correoDestinatario.trim() || '-',
    destinatario: {
      tipoDocumentoDestinatario: form.tipoDocumentoDestinatario,
      numeroDocumentoDestinatario: form.numeroDocumentoDestinatario,
      razonSocialDestinatario: form.razonSocialDestinatario
    },
    traslado: {
      motivoTraslado: form.motivoTraslado,
      descripcionMotivoTraslado: form.descripcionMotivoTraslado,
      pesoBrutoTotalBienes: form.pesoBrutoTotalBienes,
      unidadMedidaPesoBruto: 'KGM',
      modalidadTraslado: form.modalidadTraslado,
      numeroBultos: form.numeroBultos,
      ubigeoPtoLlegada: form.ubigeoPtoLlegada,
      direccionPtoLlegada: form.direccionPtoLlegada,
      codigoPtoLlegada: form.codigoPtoLlegada
    },
    items: form.items.map((item) => ({
      ...item,
      codigoEmpaque: 0,
      cantidadOriginal: item.cantidad,
      cantidadPendiente: 0,
      moneda: '-100',
      importeUnitarioSinImpuesto: 1
    }))
  };

  if (form.modalidadTraslado === '02') {
    payload.conductor = {
      tipoDocumentoConductor: form.tipoDocumentoConductor,
      numeroDocumentoConductor: form.numeroDocumentoConductor,
      nombreConductor: form.nombreConductor,
      apellidoConductor: form.apellidoConductor,
      numeroLicencia: form.numeroLicencia
    };
    payload.vehiculo = {
      numeroPlacaVehiculoPrin: form.numeroPlacaVehiculoPrin
    };
  } else {
    payload.transportista = {
      tipoDocumentoTransportista: form.tipoDocumentoTransportista,
      numeroRucTransportista: form.numeroRucTransportista,
      razonSocialTransportista: form.razonSocialTransportista
    };
  }

  return payload;
}

function TrasladoPreviewModal({
  payload,
  backendPreview,
  error,
  loading,
  onClose,
  onConfirm
}: {
  payload: GreTrasladoInputDto;
  backendPreview: unknown;
  error: string;
  loading: boolean;
  onClose: () => void;
  onConfirm: () => void;
}) {
  const motivo = trasladoMotivos.find((item) => item.codigo === payload.traslado.motivoTraslado)?.label ?? payload.traslado.motivoTraslado;
  const modalidad = trasladoModalidades.find((item) => item.codigo === payload.traslado.modalidadTraslado)?.label ?? payload.traslado.modalidadTraslado;

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="traslado-preview-title">
      <section className="preview-modal">
        <header className="preview-header">
          <div>
            <h2 id="traslado-preview-title">Vista previa de traslado</h2>
            <p>Revision previa. No envia a Bizlinks ni SUNAT.</p>
          </div>
          <button className="icon-button" type="button" onClick={onClose} aria-label="Cerrar vista previa">
            <X size={20} />
          </button>
        </header>
        <div className="preview-content">
          <div className="preview-grid">
            <div>
              <span>Serie</span>
              <strong>{payload.serieNumeroGuia}</strong>
            </div>
            <div>
              <span>Motivo</span>
              <strong>{motivo}</strong>
            </div>
            <div>
              <span>Cliente</span>
              <strong>{payload.destinatario.razonSocialDestinatario}</strong>
            </div>
            <div>
              <span>Items</span>
              <strong>{payload.items.length}</strong>
            </div>
          </div>

          <section className="preview-section">
            <h3>Traslado</h3>
            <dl className="preview-list">
              <div>
                <dt>Destino</dt>
                <dd>{payload.traslado.ubigeoPtoLlegada} - {payload.traslado.direccionPtoLlegada}</dd>
              </div>
              <div>
                <dt>Modalidad</dt>
                <dd>{modalidad}</dd>
              </div>
              <div>
                <dt>Peso</dt>
                <dd>{payload.traslado.pesoBrutoTotalBienes} KGM</dd>
              </div>
              <div>
                <dt>Bultos</dt>
                <dd>{payload.traslado.numeroBultos}</dd>
              </div>
              {payload.traslado.modalidadTraslado === '02' ? (
                <>
                  <div>
                    <dt>Chofer</dt>
                    <dd>{payload.conductor?.numeroDocumentoConductor} - {payload.conductor?.nombreConductor} {payload.conductor?.apellidoConductor}</dd>
                  </div>
                  <div>
                    <dt>Licencia</dt>
                    <dd>{payload.conductor?.numeroLicencia}</dd>
                  </div>
                  <div>
                    <dt>Placa</dt>
                    <dd>{payload.vehiculo?.numeroPlacaVehiculoPrin}</dd>
                  </div>
                </>
              ) : (
                <div>
                  <dt>Transportista</dt>
                  <dd>{payload.transportista?.numeroRucTransportista} - {payload.transportista?.razonSocialTransportista}</dd>
                </div>
              )}
            </dl>
          </section>

          <section className="preview-section">
            <h3>Items manuales</h3>
            <table className="preview-items-table">
              <thead>
                <tr>
                  <th>Codigo</th>
                  <th>Descripcion</th>
                  <th>Cantidad</th>
                  <th>Unidad</th>
                </tr>
              </thead>
              <tbody>
                {payload.items.map((item) => (
                  <tr key={item.id}>
                    <td>{item.codigoProducto}</td>
                    <td>{item.descripcion}</td>
                    <td>{item.cantidad}</td>
                    <td>{item.unidadMedida}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>

          {loading && <div className="inline-message">Validando con backend...</div>}
          {error && <div className="inline-message error-message">{error}</div>}
          <details className="technical-preview">
            <summary>Detalle tecnico</summary>
            <pre>{JSON.stringify(payload, null, 2)}</pre>
            {backendPreview !== undefined && <pre>{JSON.stringify(backendPreview, null, 2)}</pre>}
          </details>
        </div>
        <footer className="preview-actions">
          <button type="button" className="secondary-button" onClick={onClose}>Cerrar</button>
          <button type="button" className="confirm-preview-button" disabled={loading || Boolean(error)} onClick={onConfirm}>
            Confirmar vista previa
          </button>
        </footer>
      </section>
    </div>
  );
}

function createOperationId() {
  if (globalThis.crypto && typeof globalThis.crypto.randomUUID === 'function') {
    return globalThis.crypto.randomUUID();
  }

  const bytes = new Uint8Array(16);
  if (globalThis.crypto && typeof globalThis.crypto.getRandomValues === 'function') {
    globalThis.crypto.getRandomValues(bytes);
  } else {
    for (let index = 0; index < bytes.length; index += 1) {
      bytes[index] = Math.floor(Math.random() * 256);
    }
  }

  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;

  const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');

  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function isCompleteDestination(destination: RecipientAddress) {
  return Boolean(destination.ubigeo && /^\d{6}$/.test(destination.ubigeo) && destination.direccion.trim());
}

function isRemitenteDestinatario(form: TrasladoFormState) {
  return form.tipoDocumentoDestinatario.trim() === trasladoRemitente.tipoDocumento
    && form.numeroDocumentoDestinatario.trim() === trasladoRemitente.numeroDocumento;
}
