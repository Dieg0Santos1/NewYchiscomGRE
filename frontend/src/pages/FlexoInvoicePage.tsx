import { useEffect, useMemo, useState, type Dispatch, type SetStateAction } from 'react';
import { ClipboardList, Eye, RefreshCw, Search, Send } from 'lucide-react';
import { FormField } from '../components/FormField';
import { InvoicePreviewModal } from '../components/InvoicePreviewModal';
import { todayDate } from '../data/defaults';
import { flexoFacturaService } from '../services/FlexoFacturaService';
import type {
  FlexoFacturaCliente,
  FlexoFacturaCuenta,
  FlexoFacturaDetraccion,
  FlexoFacturaFormaPago,
  FlexoFacturaGuiaPendiente,
  FlexoFacturaItem,
  FlexoFacturaPreviewResponse,
  FlexoFacturaTipoExclusion
} from '../types/flexoFactura';

const detraccionOptions: Array<{ value: FlexoFacturaDetraccion; label: string }> = [
  { value: '000', label: 'Sin Detraccion' },
  { value: '037', label: 'Otros servicios empresariales 12%' },
  { value: '025', label: 'Fabricacion de bienes por encargo 10%' },
  { value: '027', label: 'Servicio de transporte de bienes 4%' }
];

export function FlexoInvoicePage() {
  const [query, setQuery] = useState('');
  const [clientes, setClientes] = useState<FlexoFacturaCliente[]>([]);
  const [cliente, setCliente] = useState<FlexoFacturaCliente | null>(null);
  const [guias, setGuias] = useState<FlexoFacturaGuiaPendiente[]>([]);
  const [selectedGuides, setSelectedGuides] = useState<Set<string>>(() => new Set());
  const [items, setItems] = useState<FlexoFacturaItem[]>([]);
  const [cuentas, setCuentas] = useState<FlexoFacturaCuenta[]>([]);
  const [formasPago, setFormasPago] = useState<FlexoFacturaFormaPago[]>([]);
  const [itemInputs, setItemInputs] = useState<ItemInputState>({});
  const [serieNumeroFactura, setSerieNumeroFactura] = useState('FF03-00000001');
  const [formaPagoTipo, setFormaPagoTipo] = useState<'CONTADO' | 'CREDITO'>('CONTADO');
  const [formaPago, setFormaPago] = useState('');
  const [cuenta, setCuenta] = useState('');
  const [detraccion, setDetraccion] = useState<FlexoFacturaDetraccion>('037');
  const [tipoExclusionProducto, setTipoExclusionProducto] = useState<FlexoFacturaTipoExclusion>('GRAVADA');
  const [ordenCompra, setOrdenCompra] = useState('');
  const [observaciones, setObservaciones] = useState('');
  const [message, setMessage] = useState('');
  const [warnings, setWarnings] = useState<string[]>([]);
  const [catalogWarnings, setCatalogWarnings] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [preview, setPreview] = useState<FlexoFacturaPreviewResponse | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);

  const totals = useMemo(() => calculateTotals(items, tipoExclusionProducto), [items, tipoExclusionProducto]);
  const selectedGuideRows = guias.filter((guide) => selectedGuides.has(guide.serieNumeroGuia));
  const selectedCuenta = cuentas.find((item) => item.cuenta === cuenta);
  const selectedClientLabel = cliente ? `${cliente.numeroDocumento} - ${cliente.razonSocial}` : '';
  const canPreview = Boolean(cliente && selectedGuides.size > 0 && items.length > 0 && formaPago.trim() && cuenta.trim());
  const filteredFormasPago = formasPago.filter((item) => {
    if (formaPagoTipo === 'CONTADO') {
      return item.dias === 0 || /contado|transferencia|adelantado|tarjeta/i.test(item.nombre);
    }

    return item.dias > 0 || /credito|factura|letra|cheque/i.test(item.nombre);
  });

  useEffect(() => {
    let cancelled = false;

    Promise.all([
      flexoFacturaService.getNextSerie(),
      flexoFacturaService.listCuentas(),
      flexoFacturaService.listFormasPago()
    ])
      .then(([serieResult, cuentasResult, formasPagoResult]) => {
        if (cancelled) return;

        setSerieNumeroFactura(serieResult.serieNumeroFactura);
        setCuentas(cuentasResult.cuentas);
        setCatalogWarnings(cuentasResult.warnings.filter(isUserFacingWarning));
        setCuenta(cuentasResult.cuentas[0]?.cuenta ?? '');
        setFormasPago(formasPagoResult);
        setFormaPago(defaultFormaPago(formasPagoResult, 'CONTADO'));
      })
      .catch((error) => {
        if (cancelled) return;
        setCatalogWarnings([error instanceof Error ? error.message : 'No se pudieron cargar catalogos Flexo.']);
      });

    return () => {
      cancelled = true;
    };
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

  async function searchClientes(showStatus = true) {
    setLoading(true);
    setPreview(null);
    if (showStatus) setMessage('Buscando clientes Flexo...');

    try {
      const result = await flexoFacturaService.searchClientes(query);
      setClientes(result);
      if (showStatus) setMessage(result.length > 0 ? `${result.length} cliente(s) encontrados.` : 'Sin clientes para mostrar.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'No se pudo buscar clientes Flexo.');
    } finally {
      setLoading(false);
    }
  }

  async function selectCliente(nextCliente: FlexoFacturaCliente) {
    setCliente(nextCliente);
    setQuery(`${nextCliente.numeroDocumento} - ${nextCliente.razonSocial}`);
    setClientes([]);
    setSelectedGuides(new Set());
    setItems([]);
    setItemInputs({});
    setPreview(null);
    setLoading(true);
    setMessage(`Cargando guias aceptadas de ${nextCliente.razonSocial}...`);

    try {
      const result = await flexoFacturaService.listGuiasPendientes(nextCliente.numeroDocumento);
      setGuias(result.guias);
      setWarnings(result.warnings.filter(isUserFacingWarning));
      setMessage(result.guias.length > 0 ? `${result.guias.length} guia(s) pendiente(s) para facturar.` : 'No hay guias aceptadas pendientes para este cliente.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'No se pudo cargar guias pendientes Flexo.');
      setGuias([]);
      setWarnings([]);
      setItemInputs({});
    } finally {
      setLoading(false);
    }
  }

  function toggleGuide(guide: FlexoFacturaGuiaPendiente, checked: boolean) {
    const nextSelected = new Set(selectedGuides);
    if (checked) nextSelected.add(guide.serieNumeroGuia);
    else nextSelected.delete(guide.serieNumeroGuia);

    const nextItems = guias
      .filter((item) => nextSelected.has(item.serieNumeroGuia))
      .flatMap((item) => item.items);

    setSelectedGuides(nextSelected);
    setItems(nextItems);
    setItemInputs((current) => {
      const nextInputs: ItemInputState = {};
      nextItems.forEach((item) => {
        if (current[item.id]) nextInputs[item.id] = current[item.id];
      });

      return nextInputs;
    });
    setPreview(null);
  }

  function updateItem(itemId: string, patch: Partial<FlexoFacturaItem>) {
    setItems((current) => current.map((item) => item.id === itemId ? { ...item, ...patch } : item));
    setPreview(null);
  }

  async function openPreview() {
    if (!cliente) return;

    setPreviewLoading(true);
    setMessage('Calculando vista previa Flexo...');

    try {
      const result = await flexoFacturaService.preview(buildInvoicePayload(cliente));
      setPreview(result);
      setPreviewOpen(true);
      setMessage(`Vista previa lista para ${result.serieNumeroFactura}.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'No se pudo generar vista previa Flexo.');
    } finally {
      setPreviewLoading(false);
    }
  }

  function buildInvoicePayload(currentCliente: FlexoFacturaCliente) {
    return {
      serie: 'FF03' as const,
      numero: serieNumeroFactura.split('-')[1] ?? '00000001',
      fechaEmision: todayDate(),
      moneda: 'PEN' as const,
      formaPago,
      cuenta,
      detraccion,
      tipoExclusionProducto,
      ordenCompra,
      observaciones,
      cliente: {
        tipoDocumento: currentCliente.tipoDocumento,
        numeroDocumento: currentCliente.numeroDocumento,
        razonSocial: currentCliente.razonSocial
      },
      guias: [...selectedGuides].map((serieNumeroGuia) => ({ serieNumeroGuia })),
      items
    };
  }

  function clearAll() {
    setQuery('');
    setClientes([]);
    setCliente(null);
    setGuias([]);
    setSelectedGuides(new Set());
    setItems([]);
    setItemInputs({});
    setWarnings([]);
    setPreview(null);
    setMessage('');
    setOrdenCompra('');
    setObservaciones('');
  }

  function changeClientQuery(value: string) {
    setQuery(value);

    if (!cliente || value === selectedClientLabel) return;

    setCliente(null);
    setGuias([]);
    setSelectedGuides(new Set());
    setItems([]);
    setItemInputs({});
    setWarnings([]);
    setPreview(null);
  }

  function changeFormaPagoTipo(nextType: 'CONTADO' | 'CREDITO') {
    setFormaPagoTipo(nextType);
    setFormaPago(defaultFormaPago(formasPago, nextType));
  }

  return (
    <section className="screen-panel invoice-screen">
      <section className="invoice-header-grid">
        <FormField label="EMPRESA" required>
          <input className="auto-field invoice-control-md" value="YCHIFORMAS S.A." readOnly />
        </FormField>
        <FormField label="FECHA EMISION">
          <input className="auto-field invoice-control-md" value={formatDateTime(new Date())} readOnly />
        </FormField>
        <FormField label="TIPO DOCUMENTO" required>
          <input className="auto-field invoice-control-sm" value="Factura" readOnly />
        </FormField>

        <FormField label="SERIE Y NUMERO" required>
          <input className="auto-field invoice-control-sm" value={serieNumeroFactura} readOnly />
        </FormField>
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
                placeholder={cliente ? selectedClientLabel : 'RUC o razon social'}
              />
              <button type="button" className="icon-button" title="Buscar cliente" onClick={() => void searchClientes()} disabled={loading}>
                <Search size={18} />
              </button>
              <button type="button" className="icon-button" title="Limpiar factura" onClick={clearAll}>
                <RefreshCw size={18} />
              </button>
            </div>
            {clientes.length > 0 && !cliente && (
              <section className="client-suggestions">
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

        <FormField label="CUENTA CONTABLE">
          <select value={cuenta} onChange={(event) => setCuenta(event.target.value)}>
            <option value="">Seleccionar</option>
            {cuentas.map((item) => (
              <option key={item.id} value={item.cuenta}>
                {item.label}
              </option>
            ))}
          </select>
          {selectedCuenta && <div className="field-note">Cuenta: {selectedCuenta.cuenta}</div>}
        </FormField>
        <FormField label="DETRACCION">
          <select value={detraccion} onChange={(event) => setDetraccion(event.target.value as FlexoFacturaDetraccion)}>
            {detraccionOptions.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
        </FormField>

        <FormField label="FORMA PAGO" required>
          <div className="payment-controls">
            <select value={formaPagoTipo} onChange={(event) => changeFormaPagoTipo(event.target.value as 'CONTADO' | 'CREDITO')}>
              <option value="CONTADO">Contado</option>
              <option value="CREDITO">Credito</option>
            </select>
            <select value={formaPago} onChange={(event) => setFormaPago(event.target.value)}>
              <option value="">Seleccionar</option>
              {filteredFormasPago.map((item) => (
                <option key={item.id} value={item.valor}>
                  {displayFormaPagoName(item.nombre)}
                </option>
              ))}
            </select>
          </div>
        </FormField>
        <FormField label="OC" wide>
          <input value={ordenCompra} onChange={(event) => setOrdenCompra(event.target.value)} placeholder="Orden de compra" />
        </FormField>
        <FormField label="TIPO EXCLUSION" wide>
          <div className="invoice-exclusion-options">
            {(['GRAVADA', 'GRATUITA', 'EXONERADA', 'INAFECTA'] as const).map((option) => (
              <label key={option}>
                <input
                  type="radio"
                  name="flexoTipoExclusionProducto"
                  value={option}
                  checked={tipoExclusionProducto === option}
                  onChange={() => {
                    setTipoExclusionProducto(option);
                    setPreview(null);
                  }}
                />
                <span>{displayExclusion(option)}</span>
              </label>
            ))}
          </div>
        </FormField>
        <label className="form-field invoice-observations-field">
          <span>OBSERVACIONES</span>
          <textarea value={observaciones} onChange={(event) => setObservaciones(event.target.value)} placeholder="Observaciones" />
        </label>
      </section>

      {(message || catalogWarnings.length > 0) && (
        <div className="invoice-message-row">
          {message && <div className="inline-message">{message}</div>}
          {catalogWarnings.map((warning) => <div key={warning} className="inline-message">{warning}</div>)}
        </div>
      )}

      <section className="invoice-summary-layout">
        <div className="invoice-guides-panel">
          <div className="invoice-section-heading">
            <h2>Guias T003/T999 aceptadas pendientes</h2>
            <span>{selectedGuides.size} seleccionada(s)</span>
          </div>
          {warnings.map((warning) => <div key={warning} className="inline-message">{warning}</div>)}
          <div className="list-table-wrap invoice-table-wrap">
            <table className="invoice-guides-table">
              <thead>
                <tr>
                  <th></th>
                  <th>Nro Guia</th>
                  <th>Fecha</th>
                  <th>SUNAT</th>
                  <th>Monto</th>
                </tr>
              </thead>
              <tbody>
                {guias.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="empty-row">Seleccione un cliente para cargar guias aceptadas no facturadas.</td>
                  </tr>
                ) : guias.map((guide) => (
                  <tr key={guide.serieNumeroGuia}>
                    <td>
                      <input
                        className="invoice-guide-checkbox"
                        type="checkbox"
                        checked={selectedGuides.has(guide.serieNumeroGuia)}
                        onChange={(event) => toggleGuide(guide, event.target.checked)}
                      />
                    </td>
                    <td>{guide.serieNumeroGuia}</td>
                    <td>{formatDate(guide.fecha)}</td>
                    <td>{guide.estadoSunat}</td>
                    <td>{guideAmount(guide, items, tipoExclusionProducto).toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
        <aside className="invoice-side-panel invoice-summary-side">
          <div className="invoice-totals">
            <div><span>Guias</span><strong>{selectedGuideRows.length}</strong></div>
            <div><span>Items</span><strong>{items.length}</strong></div>
            <div><span>Gravada</span><strong>{totals.gravada.toFixed(2)}</strong></div>
            <div><span>IGV</span><strong>{totals.igv.toFixed(2)}</strong></div>
            <div><span>Total</span><strong>{totals.total.toFixed(2)}</strong></div>
          </div>
        </aside>
      </section>

      <section className="invoice-workarea">
        <div className="products-table-wrap">
          <table className="invoice-items-table">
            <thead>
              <tr>
                <th>Item</th>
                <th>Codigo</th>
                <th>Descripcion</th>
                <th>Cant.</th>
                <th>Imp.U</th>
                <th>Prec.U</th>
                <th>Total</th>
              </tr>
            </thead>
            <tbody>
              {items.length === 0 ? (
                <tr>
                  <td colSpan={7} className="empty-row">Seleccione una o mas guias para cargar el detalle.</td>
                </tr>
              ) : items.map((item, index) => (
                <tr key={item.id}>
                  <td>{index + 1}</td>
                  <td>{item.codigoProducto}</td>
                  <td>
                    <strong>{item.serieNumeroGuia}</strong>
                    <div>{item.descripcion}</div>
                  </td>
                  <td>
                    <input
                      className="quantity-input"
                      type="text"
                      inputMode="decimal"
                      value={itemInputValue(itemInputs, item, 'cantidad')}
                      onChange={(event) => updateItemNumber(item.id, 'cantidad', event.target.value, updateItem, setItemInputs)}
                      onBlur={(event) => commitItemNumber(item.id, 'cantidad', event.target.value, setItemInputs)}
                    />
                  </td>
                  <td>{tipoExclusionProducto === 'GRAVADA' ? (item.precioUnitario * 0.18).toFixed(2) : '0.00'}</td>
                  <td>
                    <input
                      className="quantity-input"
                      type="text"
                      inputMode="decimal"
                      value={itemInputValue(itemInputs, item, 'precioUnitario')}
                      onChange={(event) => updateItemNumber(item.id, 'precioUnitario', event.target.value, updateItem, setItemInputs)}
                      onBlur={(event) => commitItemNumber(item.id, 'precioUnitario', event.target.value, setItemInputs)}
                    />
                  </td>
                  <td>{lineTotal(item, tipoExclusionProducto).toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <aside className="invoice-detail-actions">
          <button type="button" className="preview-button" disabled={!canPreview || previewLoading} onClick={() => void openPreview()}>
            {previewLoading ? <ClipboardList size={16} /> : <Eye size={16} />}
            Vista previa
          </button>
          <button type="button" className="declare-button" disabled title="Pendiente replicar escritura Flexo con auditoria">
            <Send size={16} />
            Declarar bloqueado
          </button>
        </aside>
      </section>

      {previewOpen && preview && (
        <InvoicePreviewModal
          preview={preview}
          items={items}
          tipoExclusionProducto={tipoExclusionProducto}
          hideValidations
          onClose={() => setPreviewOpen(false)}
        />
      )}
    </section>
  );
}

type ItemNumberField = 'cantidad' | 'precioUnitario';
type ItemInputState = Record<string, Partial<Record<ItemNumberField, string>>>;

function calculateTotals(items: FlexoFacturaItem[], tipoExclusionProducto: FlexoFacturaTipoExclusion) {
  const base = roundMoney(items.reduce((sum, item) => sum + item.cantidad * item.precioUnitario, 0));
  const gravada = tipoExclusionProducto === 'GRAVADA' ? base : 0;
  const exonerada = tipoExclusionProducto === 'EXONERADA' ? base : 0;
  const inafecta = tipoExclusionProducto === 'INAFECTA' ? base : 0;
  const gratuita = tipoExclusionProducto === 'GRATUITA' ? base : 0;
  const igv = roundMoney(gravada * 0.18);

  return {
    gravada,
    exonerada,
    inafecta,
    gratuita,
    igv,
    total: roundMoney(gravada + exonerada + inafecta + gratuita + igv)
  };
}

function guideAmount(guide: FlexoFacturaGuiaPendiente, currentItems: FlexoFacturaItem[], tipoExclusionProducto: FlexoFacturaTipoExclusion) {
  return currentItems
    .filter((item) => item.serieNumeroGuia === guide.serieNumeroGuia)
    .reduce((sum, item) => sum + lineTotal(item, tipoExclusionProducto), 0);
}

function lineTotal(item: FlexoFacturaItem, tipoExclusionProducto: FlexoFacturaTipoExclusion = 'GRAVADA') {
  const base = item.cantidad * item.precioUnitario;
  return roundMoney(base + (tipoExclusionProducto === 'GRAVADA' ? base * 0.18 : 0));
}

function roundMoney(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function editableNumber(value: number) {
  if (!Number.isFinite(value) || value === 0) return '';

  return String(value);
}

function itemInputValue(inputs: ItemInputState, item: FlexoFacturaItem, field: ItemNumberField) {
  return inputs[item.id]?.[field] ?? editableNumber(item[field]);
}

function updateItemNumber(
  itemId: string,
  field: ItemNumberField,
  value: string,
  updateItem: (itemId: string, patch: Partial<FlexoFacturaItem>) => void,
  setItemInputs: Dispatch<SetStateAction<ItemInputState>>
) {
  const normalized = normalizeDecimalText(value);
  setItemInputs((current) => ({
    ...current,
    [itemId]: {
      ...current[itemId],
      [field]: normalized
    }
  }));
  updateItem(itemId, { [field]: parseDecimalInput(normalized) });
}

function commitItemNumber(
  itemId: string,
  field: ItemNumberField,
  value: string,
  setItemInputs: Dispatch<SetStateAction<ItemInputState>>
) {
  const committed = editableNumber(parseDecimalInput(value));
  setItemInputs((current) => ({
    ...current,
    [itemId]: {
      ...current[itemId],
      [field]: committed
    }
  }));
}

function normalizeDecimalText(value: string) {
  const cleaned = value.replace(',', '.').replace(/[^\d.]/g, '');
  const firstPoint = cleaned.indexOf('.');
  if (firstPoint === -1) return cleaned;

  return `${cleaned.slice(0, firstPoint + 1)}${cleaned.slice(firstPoint + 1).replace(/\./g, '')}`;
}

function parseDecimalInput(value: string) {
  const normalized = normalizeDecimalText(value);
  const parsed = Number(normalized);

  return Number.isFinite(parsed) ? parsed : 0;
}

function formatDate(value: string | null) {
  if (!value) return '';

  return new Date(`${value}T00:00:00`).toLocaleDateString('es-PE', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric'
  });
}

function formatDateTime(value: Date) {
  return value.toLocaleString('es-PE', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
}

function displayFormaPagoName(value: string) {
  return value
    .replace(/d(?:i|\u00ed|\u00c3\u00ad|\ufffd)as/gi, 'dias')
    .replace(/\u00c3\u00a9/gi, 'e')
    .replace(/\u00c3\u00ad/gi, 'i')
    .replace(/\ufffd/g, '');
}

function displayExclusion(value: FlexoFacturaTipoExclusion) {
  switch (value) {
    case 'GRATUITA':
      return 'Gratuita';
    case 'EXONERADA':
      return 'Exonerada';
    case 'INAFECTA':
      return 'Inafecta';
    case 'GRAVADA':
    default:
      return 'Gravada';
  }
}

function defaultFormaPago(items: FlexoFacturaFormaPago[], type: 'CONTADO' | 'CREDITO') {
  const preferred = type === 'CONTADO'
    ? items.find((item) => /contado/i.test(item.nombre) && item.dias === 0)
    : items.find((item) => item.dias > 0 && /factura/i.test(item.nombre));

  return preferred?.valor ?? items[0]?.valor ?? (type === 'CONTADO' ? 'CONTADO' : 'CREDITO');
}

function isUserFacingWarning(value: string) {
  return !/permission was denied|permiso SELECT|AAA_GUIAFACTURADA|tbDocumentos\.nguia/i.test(value);
}
