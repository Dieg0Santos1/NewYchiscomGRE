import { useEffect, useMemo, useState, type Dispatch, type SetStateAction } from 'react';
import { AlertTriangle, ClipboardList, Eye, RefreshCw, Search, Send, X } from 'lucide-react';
import { DeclarationSuccessModal } from '../components/DeclarationSuccessModal';
import { FormField } from '../components/FormField';
import { InvoicePreviewModal } from '../components/InvoicePreviewModal';
import { todayDate } from '../data/defaults';
import { facturaFcService } from '../services/FacturaFcService';
import type {
  FcFacturaCliente,
  FcFacturaCuenta,
  FcFacturaFormaPago,
  FcFacturaGuiaPendiente,
  FcFacturaItem,
  FcFacturaPreviewResponse
} from '../types/factura';

export function InvoicePage() {
  const [query, setQuery] = useState('');
  const [clientes, setClientes] = useState<FcFacturaCliente[]>([]);
  const [cliente, setCliente] = useState<FcFacturaCliente | null>(null);
  const [guias, setGuias] = useState<FcFacturaGuiaPendiente[]>([]);
  const [selectedGuides, setSelectedGuides] = useState<Set<string>>(() => new Set());
  const [items, setItems] = useState<FcFacturaItem[]>([]);
  const [cuentas, setCuentas] = useState<FcFacturaCuenta[]>([]);
  const [formasPago, setFormasPago] = useState<FcFacturaFormaPago[]>([]);
  const [itemInputs, setItemInputs] = useState<ItemInputState>({});
  const [serieNumeroFactura, setSerieNumeroFactura] = useState('FF01-00000001');
  const [formaPagoTipo, setFormaPagoTipo] = useState<'CONTADO' | 'CREDITO'>('CONTADO');
  const [formaPago, setFormaPago] = useState('');
  const [cuenta, setCuenta] = useState('');
  const [tipoDetraccion, setTipoDetraccion] = useState<'037' | '025'>('037');
  const [tipoExclusionProducto, setTipoExclusionProducto] = useState<'GRAVADA' | 'GRATUITA' | 'EXONERADA' | 'INAFECTA'>('GRAVADA');
  const [vendedor, setVendedor] = useState({ idEmpleado: null as number | null, nombre: '' });
  const [ordenCompra, setOrdenCompra] = useState('');
  const [observaciones, setObservaciones] = useState('');
  const [message, setMessage] = useState('');
  const [warnings, setWarnings] = useState<string[]>([]);
  const [catalogWarnings, setCatalogWarnings] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [declaring, setDeclaring] = useState(false);
  const [preview, setPreview] = useState<FcFacturaPreviewResponse | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewConfirmed, setPreviewConfirmed] = useState(false);
  const [declareConfirmOpen, setDeclareConfirmOpen] = useState(false);
  const [successSerie, setSuccessSerie] = useState('');

  const totals = useMemo(() => calculateTotals(items, tipoExclusionProducto), [items, tipoExclusionProducto]);
  const selectedGuideRows = guias.filter((guide) => selectedGuides.has(guide.serieNumeroGuia));
  const selectedCuenta = cuentas.find((item) => item.cuenta === cuenta);
  const canPreview = Boolean(cliente && selectedGuides.size > 0 && items.length > 0 && formaPago.trim() && cuenta.trim());
  const selectedClientLabel = cliente ? `${cliente.numeroDocumento} - ${cliente.razonSocial}` : '';
  const previewReady = Boolean(preview && preview.validations.every((item) => item.severity !== 'error'));
  const declarationBlockReason = getDeclarationBlockReason({
    cliente,
    selectedGuides,
    items,
    formaPago,
    cuenta,
    totals,
    preview,
    previewReady,
    previewConfirmed
  });
  const canDeclare = !declarationBlockReason;
  const filteredFormasPago = formasPago.filter((item) => {
    if (formaPagoTipo === 'CONTADO') {
      return item.dias === 0 || /contado|transferencia|adelantado|tarjeta/i.test(item.nombre);
    }

    return item.dias > 0 || /credito|factura|letra|cheque/i.test(item.nombre);
  });

  useEffect(() => {
    let cancelled = false;

    Promise.all([
      facturaFcService.getNextSerie(),
      facturaFcService.listCuentas(),
      facturaFcService.listFormasPago()
    ])
      .then(([serieResult, cuentasResult, formasPagoResult]) => {
        if (cancelled) return;

        setSerieNumeroFactura(serieResult.serieNumeroFactura);
        setCuentas(cuentasResult.cuentas);
        setCatalogWarnings(cuentasResult.warnings);
        setCuenta(cuentasResult.cuentas[0]?.cuenta ?? '');
        setFormasPago(formasPagoResult);
        setFormaPago(defaultFormaPago(formasPagoResult, 'CONTADO'));
      })
      .catch((error) => {
        if (cancelled) return;
        setCatalogWarnings([error instanceof Error ? error.message : 'No se pudieron cargar catalogos.']);
        setFormaPago('CONTADO');
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
    if (showStatus) setMessage('Buscando clientes...');
    setPreview(null);
    setPreviewConfirmed(false);

    try {
      const result = await facturaFcService.searchClientes(query);
      setClientes(result);
      if (showStatus) {
        setMessage(result.length > 0 ? `${result.length} cliente(s) encontrados.` : 'Sin clientes para mostrar.');
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'No se pudo buscar clientes.');
    } finally {
      setLoading(false);
    }
  }

  async function selectCliente(nextCliente: FcFacturaCliente) {
    setCliente(nextCliente);
    setQuery(`${nextCliente.numeroDocumento} - ${nextCliente.razonSocial}`);
    setClientes([]);
    setSelectedGuides(new Set());
    setItems([]);
    setItemInputs({});
    setPreview(null);
    setPreviewConfirmed(false);
    setLoading(true);
    setMessage(`Cargando GRE aceptadas de ${nextCliente.razonSocial}...`);

    try {
      const result = await facturaFcService.listGuiasPendientes(nextCliente.numeroDocumento);
      setGuias(result.guias);
      setVendedor(result.vendedor ?? { idEmpleado: null, nombre: '' });
      setWarnings(result.warnings.filter(isUserFacingWarning));
      setMessage(result.guias.length > 0 ? `${result.guias.length} GRE pendiente(s) para facturar.` : 'No hay GRE aceptadas pendientes para este cliente.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'No se pudo cargar GRE pendientes.');
      setGuias([]);
      setWarnings([]);
      setVendedor({ idEmpleado: null, nombre: '' });
      setItemInputs({});
    } finally {
      setLoading(false);
    }
  }

  function toggleGuide(guide: FcFacturaGuiaPendiente, checked: boolean) {
    const nextSelected = new Set(selectedGuides);
    if (checked) {
      nextSelected.add(guide.serieNumeroGuia);
    } else {
      nextSelected.delete(guide.serieNumeroGuia);
    }

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
    setPreviewConfirmed(false);
  }

  function updateItem(itemId: string, patch: Partial<FcFacturaItem>) {
    setItems((current) => current.map((item) => item.id === itemId ? { ...item, ...patch } : item));
    setPreview(null);
    setPreviewConfirmed(false);
  }

  async function openPreview() {
    if (!cliente) return;

    setPreviewLoading(true);
    setPreviewConfirmed(false);
    setMessage('Calculando vista previa...');

    try {
      const result = await facturaFcService.preview(buildInvoicePayload(cliente));
      setPreview(result);
      setPreviewOpen(true);
      setMessage(`Vista previa lista para ${result.serieNumeroFactura}.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'No se pudo generar vista previa.');
    } finally {
      setPreviewLoading(false);
    }
  }

  function requestDeclareInvoice() {
    if (!cliente || !canDeclare) {
      setMessage(declarationBlockReason || 'Complete y confirme la vista previa antes de declarar la factura.');
      return;
    }

    setDeclareConfirmOpen(true);
  }

  async function declareInvoice() {
    if (!cliente || !canDeclare) {
      setMessage(declarationBlockReason || 'Complete y confirme la vista previa antes de declarar la factura.');
      setDeclareConfirmOpen(false);
      return;
    }

    setDeclaring(true);
    setDeclareConfirmOpen(false);
    setMessage(`Declarando factura ${serieNumeroFactura}...`);

    try {
      const operationId = createOperationId();
      const result = await facturaFcService.declare(buildInvoicePayload(cliente), operationId);
      const nextSerie = await facturaFcService.getNextSerie();
      setSerieNumeroFactura(nextSerie.serieNumeroFactura);
      clearInvoiceAfterDeclare();
      setMessage(result.reused
        ? `Factura ${result.serieNumeroFactura} ya habia sido procesada.`
        : `Factura ${result.serieNumeroFactura} enviada a Bizlinks.`);
      setSuccessSerie(result.serieNumeroFactura);
    } catch (error) {
      setMessage(formatInvoiceError(error, 'No se pudo declarar la factura.'));
    } finally {
      setDeclaring(false);
    }
  }

  function buildInvoicePayload(currentCliente: FcFacturaCliente) {
    return {
      serie: 'FF01' as const,
      numero: serieNumeroFactura.split('-')[1] ?? '00000001',
      fechaEmision: todayDate(),
      moneda: 'PEN' as const,
      formaPago,
      cuenta,
      tipoDetraccion,
      tipoExclusionProducto,
      vendedor,
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
    setPreviewConfirmed(false);
    setMessage('');
    setVendedor({ idEmpleado: null, nombre: '' });
    setOrdenCompra('');
    setObservaciones('');
  }

  function clearInvoiceAfterDeclare() {
    setQuery('');
    setClientes([]);
    setCliente(null);
    setGuias([]);
    setSelectedGuides(new Set());
    setItems([]);
    setItemInputs({});
    setWarnings([]);
    setPreview(null);
    setPreviewConfirmed(false);
    setVendedor({ idEmpleado: null, nombre: '' });
    setOrdenCompra('');
    setObservaciones('');
    setTipoExclusionProducto('GRAVADA');
    setTipoDetraccion('037');
    setFormaPagoTipo('CONTADO');
    setFormaPago(defaultFormaPago(formasPago, 'CONTADO'));
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
    setPreviewConfirmed(false);
    setVendedor({ idEmpleado: null, nombre: '' });
  }

  function changeFormaPagoTipo(nextType: 'CONTADO' | 'CREDITO') {
    setFormaPagoTipo(nextType);
    setFormaPago(defaultFormaPago(formasPago, nextType));
    setPreview(null);
    setPreviewConfirmed(false);
  }

  function changeCuenta(value: string) {
    setCuenta(value);
    setPreview(null);
    setPreviewConfirmed(false);
  }

  function changeTipoDetraccion(value: '037' | '025') {
    setTipoDetraccion(value);
    setPreview(null);
    setPreviewConfirmed(false);
  }

  function changeFormaPago(value: string) {
    setFormaPago(value);
    setPreview(null);
    setPreviewConfirmed(false);
  }

  function changeOrdenCompra(value: string) {
    setOrdenCompra(value);
    setPreview(null);
    setPreviewConfirmed(false);
  }

  function changeObservaciones(value: string) {
    setObservaciones(value);
    setPreview(null);
    setPreviewConfirmed(false);
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
        <FormField label="VENDEDOR">
          <input className="auto-field invoice-control-md" value={vendedor.nombre || 'Seleccione un cliente'} readOnly />
        </FormField>

        <FormField label="TIPO DOCUMENTO" required>
          <input className="auto-field invoice-control-sm" value="Factura" readOnly />
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
                placeholder={cliente ? `${cliente.numeroDocumento} - ${cliente.razonSocial}` : 'RUC o razon social'}
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

        <FormField label="SERIE Y NUMERO" required>
          <input className="auto-field invoice-control-sm" value={serieNumeroFactura} readOnly />
        </FormField>
        <FormField label="CUENTA CONTABLE">
          <select value={cuenta} onChange={(event) => changeCuenta(event.target.value)}>
            <option value="">Seleccionar</option>
            {cuentas.map((item) => (
              <option key={item.id} value={item.cuenta}>
                {item.label}
              </option>
            ))}
          </select>
          {selectedCuenta && <div className="field-note">Cuenta: {selectedCuenta.cuenta}</div>}
        </FormField>
        <FormField label="TIPODET">
          <select value={tipoDetraccion} onChange={(event) => changeTipoDetraccion(event.target.value as '037' | '025')}>
            <option value="037">037 - 12%</option>
            <option value="025">025 - 10%</option>
          </select>
        </FormField>

        <FormField label="FORMA PAGO" required>
          <div className="payment-controls">
            <select value={formaPagoTipo} onChange={(event) => changeFormaPagoTipo(event.target.value as 'CONTADO' | 'CREDITO')}>
              <option value="CONTADO">Contado</option>
              <option value="CREDITO">Credito</option>
            </select>
            <select value={formaPago} onChange={(event) => changeFormaPago(event.target.value)}>
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
          <input value={ordenCompra} onChange={(event) => changeOrdenCompra(event.target.value)} placeholder="Orden de compra" />
        </FormField>
        <FormField label="TIPO EXCLUSION" wide>
          <div className="invoice-exclusion-options">
            {(['GRAVADA', 'GRATUITA', 'EXONERADA', 'INAFECTA'] as const).map((option) => (
              <label key={option}>
                <input
                  type="radio"
                  name="tipoExclusionProducto"
                  value={option}
                  checked={tipoExclusionProducto === option}
                  onChange={() => {
                    setTipoExclusionProducto(option);
                    setPreview(null);
                    setPreviewConfirmed(false);
                  }}
                />
                <span>{displayExclusion(option)}</span>
              </label>
            ))}
          </div>
        </FormField>
        <label className="form-field invoice-observations-field">
          <span>OBSERVACIONES</span>
          <textarea
            value={observaciones}
            onChange={(event) => changeObservaciones(event.target.value)}
            placeholder="Observaciones"
          />
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
            <h2>Guias T001 aceptadas pendientes</h2>
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
                    <td colSpan={5} className="empty-row">Seleccione un cliente para cargar GRE aceptadas no facturadas.</td>
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
          <button
            type="button"
            className="declare-button"
            disabled={!canDeclare || declaring}
            title={canDeclare ? 'Declarar factura en Bizlinks' : declarationBlockReason}
            onClick={requestDeclareInvoice}
          >
            <Send size={16} />
            {declaring ? 'Declarando' : 'Declarar'}
          </button>
          {!canDeclare && !declaring && <div className="declare-hint">{declarationBlockReason}</div>}
        </aside>
      </section>
      {successSerie && (
        <DeclarationSuccessModal
          documentLabel="Factura"
          serieNumero={successSerie}
          onClose={() => setSuccessSerie('')}
        />
      )}
      {previewOpen && preview && (
        <InvoicePreviewModal
          preview={preview}
          items={items}
          tipoExclusionProducto={tipoExclusionProducto}
          onClose={() => setPreviewOpen(false)}
          onConfirm={() => {
            setPreviewConfirmed(true);
            setPreviewOpen(false);
            setMessage(`Vista previa confirmada para ${preview.serieNumeroFactura}.`);
          }}
        />
      )}
      {declareConfirmOpen && cliente && (
        <InvoiceDeclareConfirmModal
          serieNumeroFactura={serieNumeroFactura}
          cliente={cliente.razonSocial}
          total={totals.total}
          guideCount={selectedGuides.size}
          itemCount={items.length}
          declaring={declaring}
          onCancel={() => setDeclareConfirmOpen(false)}
          onConfirm={() => void declareInvoice()}
        />
      )}
      {declaring && (
        <InvoiceSendingModal
          serieNumeroFactura={serieNumeroFactura}
          cliente={cliente?.razonSocial ?? ''}
        />
      )}
    </section>
  );
}

type InvoiceDeclareConfirmModalProps = {
  serieNumeroFactura: string;
  cliente: string;
  total: number;
  guideCount: number;
  itemCount: number;
  declaring: boolean;
  onCancel: () => void;
  onConfirm: () => void;
};

function InvoiceDeclareConfirmModal({
  serieNumeroFactura,
  cliente,
  total,
  guideCount,
  itemCount,
  declaring,
  onCancel,
  onConfirm
}: InvoiceDeclareConfirmModalProps) {
  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="invoice-declare-confirm-title">
      <section className="success-modal invoice-confirm-modal">
        <button type="button" className="success-modal-close" aria-label="Cerrar" onClick={onCancel} disabled={declaring}>
          <X size={18} />
        </button>
        <div className="success-modal-icon invoice-confirm-icon">
          <AlertTriangle size={42} />
        </div>
        <h2 id="invoice-declare-confirm-title">Confirmar declaracion</h2>
        <div className="success-modal-serie">{serieNumeroFactura}</div>
        <p>
          Se enviara la factura de {cliente} a Bizlinks para procesamiento SUNAT.
        </p>
        <dl className="invoice-confirm-summary">
          <div><dt>Guias</dt><dd>{guideCount}</dd></div>
          <div><dt>Items</dt><dd>{itemCount}</dd></div>
          <div><dt>Total</dt><dd>{total.toFixed(2)}</dd></div>
        </dl>
        <div className="success-modal-actions">
          <button type="button" className="secondary-button" onClick={onCancel} disabled={declaring}>
            Cancelar
          </button>
          <button type="button" className="tool-button primary-tool" onClick={onConfirm} disabled={declaring}>
            <Send size={16} />
            {declaring ? 'Enviando' : 'Enviar a Bizlinks'}
          </button>
        </div>
      </section>
    </div>
  );
}

type InvoiceSendingModalProps = {
  serieNumeroFactura: string;
  cliente: string;
};

function InvoiceSendingModal({ serieNumeroFactura, cliente }: InvoiceSendingModalProps) {
  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="invoice-sending-title">
      <section className="success-modal invoice-confirm-modal">
        <div className="success-modal-icon invoice-sending-icon">
          <RefreshCw size={42} />
        </div>
        <h2 id="invoice-sending-title">Enviando a Bizlinks</h2>
        <div className="success-modal-serie">{serieNumeroFactura}</div>
        <p>
          La factura de {cliente || 'cliente seleccionado'} se esta registrando en Bizlinks.
          Al terminar podra verla en Reportes para seguir el estado SUNAT y el PDF.
        </p>
      </section>
    </div>
  );
}

type TipoExclusionProducto = 'GRAVADA' | 'GRATUITA' | 'EXONERADA' | 'INAFECTA';
type ItemNumberField = 'cantidad' | 'precioUnitario';
type ItemInputState = Record<string, Partial<Record<ItemNumberField, string>>>;

function calculateTotals(items: FcFacturaItem[], tipoExclusionProducto: TipoExclusionProducto) {
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

function guideAmount(guide: FcFacturaGuiaPendiente, currentItems: FcFacturaItem[], tipoExclusionProducto: TipoExclusionProducto) {
  return currentItems
    .filter((item) => item.serieNumeroGuia === guide.serieNumeroGuia)
    .reduce((sum, item) => sum + lineTotal(item, tipoExclusionProducto), 0);
}

function lineTotal(item: FcFacturaItem, tipoExclusionProducto: TipoExclusionProducto = 'GRAVADA') {
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

function itemInputValue(inputs: ItemInputState, item: FcFacturaItem, field: ItemNumberField) {
  return inputs[item.id]?.[field] ?? editableNumber(item[field]);
}

function updateItemNumber(
  itemId: string,
  field: ItemNumberField,
  value: string,
  updateItem: (itemId: string, patch: Partial<FcFacturaItem>) => void,
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

function formatDate(value: string | null) {
  if (!value) return '';

  return new Date(value).toLocaleDateString('es-PE', {
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

function formatDueDate(formaPago: string) {
  const match = /(\d+)/.exec(formaPago);
  const days = match ? Number(match[1]) : 0;
  const date = new Date();
  date.setDate(date.getDate() + days);

  return formatDateTime(date);
}

function displayFormaPagoName(value: string) {
  return value
    .replace(/d(?:i|\u00ed|\u00c3\u00ad|\ufffd)as/gi, 'dias')
    .replace(/\u00c3\u00a9/gi, 'e')
    .replace(/\u00c3\u00ad/gi, 'i')
    .replace(/\ufffd/g, '');
}

function displayExclusion(value: TipoExclusionProducto) {
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

function isUserFacingWarning(value: string) {
  return !/AAA_GUIAFACTURADA|tbGuiasFactura|permiso SELECT|permission was denied|Pendiente auditar|No se pudo validar no duplicidad/i.test(value);
}

function getDeclarationBlockReason(input: {
  cliente: FcFacturaCliente | null;
  selectedGuides: Set<string>;
  items: FcFacturaItem[];
  formaPago: string;
  cuenta: string;
  totals: ReturnType<typeof calculateTotals>;
  preview: FcFacturaPreviewResponse | null;
  previewReady: boolean;
  previewConfirmed: boolean;
}) {
  if (!input.cliente) return 'Seleccione un cliente antes de declarar.';
  if (input.selectedGuides.size === 0) return 'Seleccione una o mas GRE aceptadas para facturar.';
  if (input.items.length === 0) return 'Seleccione una guia con items para facturar.';
  if (!input.formaPago.trim()) return 'Seleccione una forma de pago.';
  if (!input.cuenta.trim()) return 'Seleccione una cuenta contable.';
  if (input.items.some((item) => item.precioUnitario <= 0)) return 'Complete el Prec.U de todos los items antes de declarar.';
  if (input.totals.total <= 0) return 'La factura debe tener total mayor a cero.';
  if (!input.preview) return 'Genere la vista previa antes de declarar.';

  const previewError = input.preview.validations.find((item) => item.severity === 'error');
  if (previewError) return previewError.message;
  if (!input.previewReady) return 'La vista previa tiene validaciones pendientes.';
  if (!input.previewConfirmed) return 'Confirme la vista previa para habilitar Declarar.';

  return '';
}

function defaultFormaPago(items: FcFacturaFormaPago[], type: 'CONTADO' | 'CREDITO') {
  const preferred = type === 'CONTADO'
    ? items.find((item) => /contado/i.test(item.nombre) && item.dias === 0)
    : items.find((item) => item.dias > 0 && /factura/i.test(item.nombre));

  return preferred?.valor ?? items[0]?.valor ?? (type === 'CONTADO' ? 'CONTADO' : 'CREDITO');
}

function formatInvoiceError(error: unknown, fallback: string) {
  const message = error instanceof Error ? error.message : '';
  if (!message.trim()) return fallback;

  return message
    .replace(/^Error:\s*/i, '')
    .replace(/\s+/g, ' ')
    .trim();
}
