import { useEffect, useMemo, useState } from 'react';
import { Eye, RefreshCw, Search, Wrench } from 'lucide-react';
import { DeclarationSuccessModal } from '../components/DeclarationSuccessModal';
import { FormField } from '../components/FormField';
import { OtDocumentModal } from '../components/OtDocumentModal';
import { PreviewModal } from '../components/PreviewModal';
import { createDefaultFormState, currentTime, todayDate } from '../data/defaults';
import { ALLOWED_SERIES, ACTIVE_SERIE, type GreSerie } from '../data/series';
import { driverService } from '../services/DriverService';
import { greFormularioService, type PreviewResponse } from '../services/GreFormularioService';
import { workOrderService } from '../services/WorkOrderService';
import type { BackendGuideStatus, DriverCatalogItem, GreFormState, RecipientAddress, WorkOrderDocument } from '../types/gre';
import { toGreInputDto } from '../utils/payload';

type FieldName = keyof GreFormState;

const transferReasons = [
  { code: '01', label: 'VENTA' },
  { code: '14', label: 'VENTA SUJETA A CONFIRMACION DEL COMPRADOR' },
  { code: '02', label: 'COMPRA' },
  { code: '04', label: 'TRASLADO ENTRE ESTABLECIMIENTOS DE LA MISMA EMPRESA' },
  { code: '18', label: 'TRASLADO EMISOR ITINERANTE CP' },
  { code: '08', label: 'IMPORTACION' },
  { code: '09', label: 'EXPORTACION' },
  { code: '13', label: 'TRASLADO A ZONA PRIMARIA' },
  { code: '03', label: 'OTROS' }
];

function pickDefaultDestination(searchType: 'ot' | 'guia', document: WorkOrderDocument) {
  if (searchType === 'guia') return document.destinos[0];
  if (document.destinos.length === 1) return document.destinos[0];

  const recipientNumber = document.destinatario?.numeroDocumentoDestinatario.trim();
  if (recipientNumber !== '20100084768') return undefined;

  return document.destinos.find((address) => {
    const direction = address.direccion.toUpperCase();

    return direction.includes('SEPARADORA') && direction.includes('2187');
  });
}

export function NewGuidePage() {
  const [form, setForm] = useState<GreFormState>(() => createDefaultFormState());
  const [searchType, setSearchType] = useState<'ot' | 'guia'>('ot');
  const [previewOpen, setPreviewOpen] = useState(false);
  const [otDocumentOpen, setOtDocumentOpen] = useState(false);
  const [previewConfirmed, setPreviewConfirmed] = useState(false);
  const [destinationAddresses, setDestinationAddresses] = useState<RecipientAddress[]>([]);
  const [selectedDestinationId, setSelectedDestinationId] = useState('');
  const [otDocuments, setOtDocuments] = useState<WorkOrderDocument[]>([]);
  const [loadMessage, setLoadMessage] = useState('');
  const [previewResponse, setPreviewResponse] = useState<PreviewResponse | null>(null);
  const [previewError, setPreviewError] = useState('');
  const [previewLoading, setPreviewLoading] = useState(false);
  const [declaring, setDeclaring] = useState(false);
  const [declareMessage, setDeclareMessage] = useState('');
  const [successSerie, setSuccessSerie] = useState('');
  const [operationId, setOperationId] = useState('');
  const [backendStatus, setBackendStatus] = useState<BackendGuideStatus | null>(null);
  const [drivers, setDrivers] = useState<DriverCatalogItem[]>([]);
  const [driversMessage, setDriversMessage] = useState('');
  const [seriesMessage, setSeriesMessage] = useState('');

  const payload = useMemo(() => toGreInputDto(form), [form]);
  const includedItems = form.items.filter((item) => item.incluido);
  const isPrivateTransfer = form.modalidadTraslado === '02';
  const hasDriverData =
    form.numeroDocumentoConductor.trim().length > 0 &&
    form.nombreConductor.trim().length > 0 &&
    form.apellidoConductor.trim().length > 0 &&
    form.numeroLicencia.trim().length > 0 &&
    form.numeroPlacaVehiculoPrin.trim().length > 0;
  const isFormValid =
    form.selectedIdDocumentos.trim().length > 0 &&
    form.numeroDocumentoDestinatario.trim().length > 0 &&
    form.razonSocialDestinatario.trim().length > 0 &&
    form.ubigeoPtoLlegada.trim().length >= 6 &&
    form.direccionPtoLlegada.trim().length > 0 &&
    form.codigoPtoLlegada.trim().length > 0 &&
    form.motivoTraslado.trim().length > 0 &&
    form.descripcionMotivoTraslado.trim().length > 0 &&
    form.pesoBrutoTotalBienes > 0 &&
    form.numeroBultos > 0 &&
    (!isPrivateTransfer || form.selectedPrivateDriverId.trim().length > 0) &&
    hasDriverData &&
    includedItems.length > 0 &&
    includedItems.every((item) => item.cantidad > 0 && item.cantidad <= item.cantidadOriginal);
  const canPreview = isFormValid;
  const canDeclare = isFormValid && previewConfirmed && !declaring;
  const declareDisabledReason = !isFormValid
    ? 'Complete motivo, destino, chofer, peso/bultos y cantidades para declarar.'
    : !previewConfirmed
      ? 'Abra Vista previa y pulse Confirmar vista previa para habilitar Declarar.'
      : '';

  useEffect(() => {
    let cancelled = false;

    driverService.listPrivateDrivers()
      .then((items) => {
        if (cancelled) return;
        setDrivers(items);
        setDriversMessage(items.length === 0 ? 'No hay choferes privados disponibles.' : '');
      })
      .catch((error) => {
        if (cancelled) return;
        setDriversMessage(error instanceof Error ? error.message : 'No se pudo cargar choferes.');
      });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    void loadNextSerie();
  }, []);

  function updateField<K extends FieldName>(field: K, value: GreFormState[K]) {
    setPreviewConfirmed(false);
    setDeclareMessage('');
    setBackendStatus(null);
    setForm((current) => ({ ...current, [field]: value }));
  }

  async function loadNextSerie(serie: GreSerie = form.serie as GreSerie) {
    setSeriesMessage('');

    try {
      const nextSerie = await greFormularioService.getNextSerie(serie);

      setForm((current) => ({
        ...current,
        serie: nextSerie.serie,
        numero: nextSerie.numero
      }));
    } catch (error) {
      setSeriesMessage(error instanceof Error ? error.message : `No se pudo cargar el correlativo ${ACTIVE_SERIE}.`);
      setForm((current) => ({ ...current, numero: '00000000' }));
    }
  }

  function changeSerie(serie: GreSerie) {
    setPreviewConfirmed(false);
    setDeclareMessage('');
    setBackendStatus(null);
    setForm((current) => ({ ...current, serie, numero: '' }));
    void loadNextSerie(serie);
  }

  function applyWorkOrderDocument(document: WorkOrderDocument) {
    const selectedAddress = pickDefaultDestination(searchType, document);

    setPreviewConfirmed(false);
    setDestinationAddresses(document.destinos);
    setSelectedDestinationId(selectedAddress?.id ?? '');
    setForm((current) => ({
      ...current,
      selectedIdDocumentos: document.idDocumentos,
      ordenCompra: document.ordenCompra,
      observaciones: mergePurchaseOrderObservation(current.observaciones, document.ordenCompra),
      searchText: document.numeroOt || current.searchText,
      tipoDocumentoDestinatario: document.destinatario?.tipoDocumentoDestinatario ?? '6',
      numeroDocumentoDestinatario: document.destinatario?.numeroDocumentoDestinatario ?? '',
      razonSocialDestinatario: document.destinatario?.razonSocialDestinatario ?? document.cliente,
      direccionPtoLlegada: selectedAddress?.direccion ?? '',
      ubigeoPtoLlegada: selectedAddress?.ubigeo ?? '',
      codigoPtoLlegada: selectedAddress?.codigoDestino ?? '',
      motivoTraslado: searchType === 'guia' ? '01' : current.motivoTraslado,
      descripcionMotivoTraslado: searchType === 'guia' ? 'VENTA' : current.descripcionMotivoTraslado,
      items: document.productos.map((product) => ({
        ...product,
        cantidadOriginal: product.cantidadOriginal ?? product.cantidad,
        cantidadPendiente: 0,
        incluido: true
      }))
    }));
    setOtDocumentOpen(false);
  }

  function mergePurchaseOrderObservation(currentObservation: string, purchaseOrder: string) {
    const trimmedPurchaseOrder = purchaseOrder.trim();
    const observationWithoutOldPurchaseOrder = currentObservation
      .split(/\s*\|\s*/)
      .map((part) => part.trim())
      .filter((part) => part && !/^OC\s*:/i.test(part))
      .join(' | ');

    if (!trimmedPurchaseOrder) return observationWithoutOldPurchaseOrder;

    const purchaseOrderObservation = `OC: ${trimmedPurchaseOrder}`;

    return observationWithoutOldPurchaseOrder
      ? `${purchaseOrderObservation} | ${observationWithoutOldPurchaseOrder}`
      : purchaseOrderObservation;
  }

  function changePurchaseOrder(value: string) {
    setPreviewConfirmed(false);
    setDeclareMessage('');
    setBackendStatus(null);
    setForm((current) => ({
      ...current,
      ordenCompra: value,
      observaciones: mergePurchaseOrderObservation(current.observaciones, value)
    }));
  }

  async function loadDocument() {
    setPreviewConfirmed(false);
    setLoadMessage(searchType === 'guia' ? 'Buscando Miscelánea...' : 'Buscando OT...');

    try {
      const result = await workOrderService.searchByOt(form.searchText, searchType);

      if (result.status === 'OT_NO_ENCONTRADA') {
        setLoadMessage(result.message);
        return;
      }

      if (result.status === 'OT_SIN_DETALLES') {
        setLoadMessage(result.message);
        return;
      }

      if (result.documents.length === 1 && result.documents[0]) {
        applyWorkOrderDocument(result.documents[0]);
        setLoadMessage([
          result.status === 'OT_DISPONIBLE'
            ? (searchType === 'guia' ? `Documento misceláneo disponible. Productos: ${result.documents[0].productos.length}` : `OT disponible. Productos: ${result.documents[0].productos.length}`)
            : result.message,
          ...(result.warnings ?? [])
        ].join(' '));
        return;
      }

      setOtDocuments(result.documents);
      setOtDocumentOpen(true);
      setLoadMessage(searchType === 'guia' ? `Documento misceláneo disponible. Se encontraron ${result.documents.length} registros.` : `OT disponible. Se encontraron ${result.documents.length} documentos relacionados.`);
    } catch (error) {
      setLoadMessage(error instanceof Error ? error.message : (searchType === 'guia' ? 'No se pudo buscar el documento misceláneo.' : 'No se pudo buscar la OT.'));
    }
  }

  function clearForm() {
    setPreviewConfirmed(false);
    setPreviewResponse(null);
    setPreviewError('');
    setDeclareMessage('');
    setBackendStatus(null);
    setOperationId('');
    setLoadMessage('');
    setDestinationAddresses([]);
    setSelectedDestinationId('');
    setOtDocuments([]);
    setOtDocumentOpen(false);
    setForm(createDefaultFormState());
    setSearchType('ot');
    void loadNextSerie();
  }

  function applyDestination(address?: RecipientAddress) {
    updateField('direccionPtoLlegada', address?.direccion ?? '');
    updateField('ubigeoPtoLlegada', address?.ubigeo ?? '');
    updateField('codigoPtoLlegada', address?.codigoDestino ?? '');
  }

  function changeDestination(addressId: string) {
    const address = destinationAddresses.find((item) => item.id === addressId);

    setSelectedDestinationId(addressId);
    applyDestination(address);
  }

  function emissionDateTime() {
    return `${form.fechaEmisionGuia}T${form.horaEmisionGuia.slice(0, 5)}`;
  }

  function updateEmissionDateTime(value: string) {
    const [date, time] = value.split('T');

    if (!date || !time) return;

    updateField('fechaEmisionGuia', date);
    updateField('horaEmisionGuia', `${time}:00`);
  }

  function changeTransferReason(code: string) {
    const reason = transferReasons.find((item) => item.code === code);

    setPreviewConfirmed(false);
    setForm((current) => ({
      ...current,
      motivoTraslado: code,
      descripcionMotivoTraslado: reason?.label ?? ''
    }));
  }

  function changeTransferMode(code: string) {
    setPreviewConfirmed(false);
    setForm((current) => ({
      ...current,
      modalidadTraslado: code,
      selectedPrivateDriverId: '',
      tipoDocumentoConductor: code === '02' ? '1' : current.tipoDocumentoConductor,
      numeroDocumentoConductor: '',
      nombreConductor: '',
      apellidoConductor: '',
      numeroLicencia: '',
      numeroPlacaVehiculoPrin: ''
    }));
  }

  function selectPrivateDriver(driverId: string) {
    const driver = drivers.find((item) => item.id === driverId);

    setPreviewConfirmed(false);
    setForm((current) => ({
      ...current,
      selectedPrivateDriverId: driverId,
      tipoDocumentoConductor: driver?.tipoDocumento ?? '1',
      numeroDocumentoConductor: driver?.numeroDocumento ?? '',
      nombreConductor: driver?.nombres ?? '',
      apellidoConductor: driver?.apellidos ?? '',
      numeroLicencia: driver?.licencia ?? '',
      numeroPlacaVehiculoPrin: driver?.placa ?? ''
    }));
  }

  function serieNumeroValue() {
    return `${form.serie}-${form.numero || '00000000'}`;
  }

  function updateItemQuantity(itemId: string, value: number) {
    const quantity = Number.isFinite(value) ? value : 0;

    setPreviewConfirmed(false);
    setDeclareMessage('');
    setBackendStatus(null);
    setForm((current) => ({
      ...current,
      items: current.items.map((item) => {
        if (item.id !== itemId) return item;

        const nextQuantity = Math.max(0, Math.min(quantity, item.cantidadOriginal));

        return {
          ...item,
          cantidad: nextQuantity,
          cantidadPendiente: Math.max(0, item.cantidadOriginal - nextQuantity),
          incluido: nextQuantity > 0
        };
      })
    }));
  }

  function toggleItemIncluded(itemId: string, included: boolean) {
    setPreviewConfirmed(false);
    setDeclareMessage('');
    setBackendStatus(null);
    setForm((current) => ({
      ...current,
      items: current.items.map((item) => {
        if (item.id !== itemId) return item;

        return {
          ...item,
          incluido: included,
          cantidad: included ? (item.cantidad > 0 ? item.cantidad : item.cantidadOriginal) : 0,
          cantidadPendiente: included ? Math.max(0, item.cantidadOriginal - (item.cantidad > 0 ? item.cantidad : item.cantidadOriginal)) : item.cantidadOriginal
        };
      })
    }));
  }

  async function openPreview() {
    const date = todayDate();
    const time = currentTime();
    const nextForm = {
      ...form,
      fechaEmisionGuia: date,
      horaEmisionGuia: time,
      fechaInicioTraslado: date,
      fechaEntregaBienes: date
    };
    const nextPayload = toGreInputDto(nextForm);

    setForm(nextForm);
    setPreviewOpen(true);
    setPreviewLoading(true);
    setPreviewError('');
    setPreviewResponse(null);
    setPreviewConfirmed(false);

    try {
      setPreviewResponse(await greFormularioService.preview(nextPayload));
    } catch (error) {
      setPreviewError(error instanceof Error ? error.message : 'No se pudo validar la vista previa.');
    } finally {
      setPreviewLoading(false);
    }
  }

  async function declareGuide() {
    if (declaring) return;

    const nextOperationId = createOperationId();
    setOperationId(nextOperationId);
    setDeclaring(true);
    setBackendStatus('EN_PROCESO');
    setDeclareMessage('Declarando y activando en Bizlinks...');

    try {
      const result = await greFormularioService.declare(payload, nextOperationId);
      setBackendStatus('ENVIADO');
      setDeclareMessage(`Guia ${result.generatedSerieNumeroGuia} declarada en Bizlinks. Revise Reportes para la respuesta SUNAT y el PDF.`);
      setSuccessSerie(result.generatedSerieNumeroGuia);
      setPreviewConfirmed(false);
      setPreviewResponse(null);
      setPreviewError('');
      setForm((current) => ({
        ...createDefaultFormState(),
        searchType: current.searchType,
        numero: ''
      }));
      setDestinationAddresses([]);
      setSelectedDestinationId('');
      setOtDocuments([]);
      setOtDocumentOpen(false);
      setLoadMessage('');
      await loadNextSerie();
    } catch (error) {
      setBackendStatus('ERROR');
      setDeclareMessage(error instanceof Error ? error.message : 'No se pudo declarar la GRE.');
    } finally {
      setDeclaring(false);
    }
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

  return (
    <section className="screen-panel">
      <div className="search-strip">
        <FormField label="BUSCAR POR">
          <div className="search-controls">
            <select
              value={searchType}
              onChange={(event) => {
                setSearchType(event.target.value as 'ot' | 'guia');
                setLoadMessage('');
              }}
            >
              <option value="ot">OT</option>
              <option value="guia">MISCELÁNEA</option>
            </select>
            <input
              value={form.searchText}
              onChange={(event) => updateField('searchText', event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  void loadDocument();
                }
              }}
              placeholder={searchType === 'guia' ? "Serie-Número (ej: 001-0112866)" : "Número de OT"}
            />
            <button type="button" className="tool-button primary-tool" onClick={loadDocument}>
              <Search size={16} />
              Buscar
            </button>
            <button type="button" className="tool-button" onClick={clearForm}>
              <RefreshCw size={16} />
              Limpiar
            </button>
          </div>
        </FormField>
        {loadMessage && <div className="inline-message">{loadMessage}</div>}
      </div>

      <div className="form-grid">
        <FormField label="EMPRESA" required>
          <input className="auto-field" value={form.empresa} readOnly />
        </FormField>
        <FormField label="FECHA EMISION">
          <input className="auto-field" type="datetime-local" value={emissionDateTime()} readOnly />
        </FormField>
        <FormField label="TRASLADO">
          <input type="date" value={form.fechaInicioTraslado} onChange={(event) => updateField('fechaInicioTraslado', event.target.value)} />
        </FormField>

        <FormField label="SERIE Y NUMERO" required>
          <select value={form.serie} onChange={(event) => changeSerie(event.target.value as GreSerie)}>
            {ALLOWED_SERIES.map((serie) => (
              <option key={serie} value={serie}>
                {serie}-{form.serie === serie ? form.numero || '00000000' : '...'}
              </option>
            ))}
          </select>
          {seriesMessage && <div className="field-note">{seriesMessage}</div>}
        </FormField>
        <FormField label="DESTINATARIO" required wide>
          <div className="recipient-picker">
            <input
              className="auto-field"
              value={
                form.numeroDocumentoDestinatario
                  ? `${form.tipoDocumentoDestinatario === '6' ? 'RUC' : 'DNI'} ${form.numeroDocumentoDestinatario} - ${
                      form.razonSocialDestinatario
                    }`
                  : ''
              }
              readOnly
              placeholder={searchType === 'guia' ? "Se completa al buscar Miscelánea" : "Se completa al buscar la OT"}
            />
            <button type="button" className="icon-button" title={searchType === 'guia' ? "Destinatario automático desde Miscelánea" : "Destinatario automático desde OT"} disabled>
              <Wrench size={18} />
            </button>
          </div>
        </FormField>

        <FormField label="DESTINO" required wide>
          <div className="destination-line">
            <select
              value={selectedDestinationId}
              onChange={(event) => changeDestination(event.target.value)}
              disabled={destinationAddresses.length === 0}
            >
              <option value="">Seleccione destino</option>
              {destinationAddresses.map((address) => (
                <option key={address.id} value={address.id}>
                  {address.direccion}
                </option>
              ))}
            </select>
            <input
              className="auto-field"
              value={form.ubigeoPtoLlegada}
              readOnly
              placeholder="Ubigeo"
            />
          </div>
        </FormField>

        <FormField label="ORIGEN" required wide>
          <input className="auto-field" value={form.origen} readOnly />
        </FormField>

        <FormField label="MODALIDAD" required>
          <select value={form.modalidadTraslado} onChange={(event) => changeTransferMode(event.target.value)}>
            <option value="01">PUBLICO</option>
            <option value="02">PRIVADO</option>
          </select>
        </FormField>
        <FormField label="MOTIVO" required wide>
          <select value={form.motivoTraslado} onChange={(event) => changeTransferReason(event.target.value)}>
            <option value="">Seleccione un motivo</option>
            {transferReasons.map((reason) => (
              <option key={reason.code} value={reason.code}>
                {reason.label}
              </option>
            ))}
          </select>
        </FormField>

        <FormField label="PESO BRUTO" required>
          <div className="pair compact-pair">
            <input
              type="number"
              min="0.01"
              step="0.01"
              value={form.pesoBrutoTotalBienes}
              onChange={(event) => updateField('pesoBrutoTotalBienes', Number(event.target.value))}
            />
            <select value={form.unidadMedidaPesoBruto} onChange={(event) => updateField('unidadMedidaPesoBruto', event.target.value)}>
              <option value="KGM">KGM</option>
            </select>
          </div>
        </FormField>
        <FormField label="NRO BULTOS">
          <input
            type="number"
            min="1"
            value={form.numeroBultos}
            onChange={(event) => updateField('numeroBultos', Number(event.target.value))}
          />
        </FormField>
        <FormField label="ORDEN COMPRA">
          <input value={form.ordenCompra} onChange={(event) => changePurchaseOrder(event.target.value)} placeholder="Sin OC registrada" />
        </FormField>
        <FormField label="OBSERVACIONES" wide>
          <input value={form.observaciones} onChange={(event) => updateField('observaciones', event.target.value)} />
        </FormField>
      </div>

      <div className="driver-row">
        <FormField label="CHOFER">
          {isPrivateTransfer ? (
            <select value={form.selectedPrivateDriverId} onChange={(event) => selectPrivateDriver(event.target.value)}>
              <option value="">Seleccione chofer</option>
              {drivers.map((driver) => (
                <option key={driver.id} value={driver.id}>
                  {driver.numeroDocumento} - {driver.nombres} {driver.apellidos} - {driver.placa}
                </option>
              ))}
            </select>
          ) : (
            <div className="recipient-line">
              <select value={form.tipoDocumentoConductor} onChange={(event) => updateField('tipoDocumentoConductor', event.target.value)}>
                <option value="1">DNI</option>
                <option value="6">RUC</option>
                <option value="4">C.E.</option>
              </select>
              <input
                value={form.numeroDocumentoConductor}
                onChange={(event) => updateField('numeroDocumentoConductor', event.target.value)}
                placeholder="Numero documento"
              />
              <input value={form.nombreConductor} onChange={(event) => updateField('nombreConductor', event.target.value)} placeholder="Nombres o razon social" />
              <input
                value={form.apellidoConductor}
                onChange={(event) => updateField('apellidoConductor', event.target.value)}
                placeholder="Apellidos"
              />
            </div>
          )}
        </FormField>
        <FormField label="LICENCIA">
          <input
            className={isPrivateTransfer ? 'auto-field' : ''}
            value={form.numeroLicencia}
            readOnly={isPrivateTransfer}
            onChange={(event) => updateField('numeroLicencia', event.target.value)}
          />
        </FormField>
        <FormField label="PLACA">
          <input
            className={isPrivateTransfer ? 'auto-field' : ''}
            value={form.numeroPlacaVehiculoPrin}
            readOnly={isPrivateTransfer}
            onChange={(event) => updateField('numeroPlacaVehiculoPrin', event.target.value)}
          />
        </FormField>
        {driversMessage && <div className="inline-message">{driversMessage}</div>}
      </div>

      <section className="products-area">
        <div className="products-table-wrap">
          <table className="products-table">
            <thead>
              <tr>
                <th>Codigo</th>
                <th>Descripcion generada</th>
                <th>Cantidad OT</th>
                <th>Cantidad a enviar</th>
                <th>Pendiente</th>
                <th>UNIDAD</th>
                <th>Acciones</th>
              </tr>
            </thead>
            <tbody>
              {form.items.length === 0 ? (
                <tr>
                  <td colSpan={7} className="empty-row">
                    {searchType === 'guia' 
                      ? 'Busque un documento misceláneo para cargar productos desde VW_DETGUIA_REMISION.' 
                      : 'Busque una OT para cargar productos desde VW_DETGUIA_REMISION.'}
                  </td>
                </tr>
              ) : (
                form.items.map((item) => (
                  <tr key={item.id}>
                    <td>{item.codigoProducto}</td>
                    <td>{item.descripcion}</td>
                    <td>{item.cantidadOriginal}</td>
                    <td>
                      <input
                        className="quantity-input"
                        type="number"
                        min="0"
                        max={item.cantidadOriginal}
                        step="0.001"
                        value={item.cantidad}
                        disabled={!item.incluido}
                        onChange={(event) => updateItemQuantity(item.id, Number(event.target.value))}
                      />
                    </td>
                    <td>{item.cantidadPendiente}</td>
                    <td>{item.unidadMedida}</td>
                    <td>
                      <label className="include-control">
                        <input
                          type="checkbox"
                          checked={item.incluido}
                          onChange={(event) => toggleItemIncluded(item.id, event.target.checked)}
                        />
                        Incluir
                      </label>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        <div className="declare-area">
          <button type="button" className="preview-button" disabled={!canPreview || previewLoading || declaring} onClick={() => void openPreview()}>
            <Eye size={16} />
            Vista previa
          </button>
          <button type="button" className="declare-button" disabled={!canDeclare} title={declareDisabledReason} onClick={() => void declareGuide()}>
            {declaring ? 'Declarando...' : 'Declarar'}
          </button>
          {!canDeclare && !declaring && <div className="declare-hint">{declareDisabledReason}</div>}
          {(backendStatus || declareMessage || operationId) && (
            <div className="inline-message">
              {backendStatus && <strong>{backendStatus}</strong>}
              {operationId && <div>Operacion: {operationId}</div>}
              {declareMessage && <div>{declareMessage}</div>}
            </div>
          )}
        </div>
      </section>

      {previewOpen && (
        <PreviewModal
          payload={payload}
          ordenCompra={form.ordenCompra}
          backendPreview={previewResponse}
          error={previewError}
          loading={previewLoading}
          onClose={() => setPreviewOpen(false)}
          onConfirm={() => {
            setPreviewConfirmed(true);
            setPreviewOpen(false);
          }}
        />
      )}
      {otDocumentOpen && (
        <OtDocumentModal
          documents={otDocuments}
          onClose={() => setOtDocumentOpen(false)}
          onSelect={applyWorkOrderDocument}
        />
      )}
      {successSerie && (
        <DeclarationSuccessModal
          documentLabel="Guia"
          serieNumero={successSerie}
          onClose={() => setSuccessSerie('')}
        />
      )}
    </section>
  );
}
