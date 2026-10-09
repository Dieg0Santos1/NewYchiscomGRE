import { useEffect, useMemo, useState, type Dispatch, type SetStateAction } from 'react';
import { ClipboardList, Eye, FileText, RefreshCw, Search, Send, X } from 'lucide-react';
import { DeclarationSuccessModal } from '../components/DeclarationSuccessModal';
import { FormField } from '../components/FormField';
import { InvoicePreviewModal } from '../components/InvoicePreviewModal';
import { todayDate } from '../data/defaults';
import { flexoService } from '../services/FlexoService';
import { flexoCreditNoteService } from '../services/FlexoCreditNoteService';
import { flexoFacturaService } from '../services/FlexoFacturaService';
import type {
  FlexoCreditNoteInvoice,
  FlexoCreditNoteMotivo,
  FlexoCreditNotePreviewResponse
} from '../types/flexoCreditNote';
import type {
  FlexoFacturaCliente,
  FlexoFacturaCuenta,
  FlexoFacturaDetraccion,
  FlexoFacturaGuiaPendiente,
  FlexoFacturaItem,
  FlexoFacturaPreviewResponse,
  FlexoFacturaTipoExclusion
} from '../types/flexoFactura';

const fallbackDetraccionOptions: Array<{ value: FlexoFacturaDetraccion; label: string }> = [
  { value: '000', label: 'Sin Detraccion' },
  { value: '037', label: 'Otros servicios empresariales 12%' },
  { value: '025', label: 'Fabricacion de bienes por encargo 10%' }
];

export function FlexoInvoicePage() {
  const [documentMode, setDocumentMode] = useState<'FACTURA' | 'NOTA_CREDITO'>('FACTURA');
  const [query, setQuery] = useState('');
  const [clientes, setClientes] = useState<FlexoFacturaCliente[]>([]);
  const [cliente, setCliente] = useState<FlexoFacturaCliente | null>(null);
  const [guias, setGuias] = useState<FlexoFacturaGuiaPendiente[]>([]);
  const [selectedGuides, setSelectedGuides] = useState<Set<string>>(() => new Set());
  const [items, setItems] = useState<FlexoFacturaItem[]>([]);
  const [cuentas, setCuentas] = useState<FlexoFacturaCuenta[]>([]);
  const [itemInputs, setItemInputs] = useState<ItemInputState>({});
  const [serieNumeroFactura, setSerieNumeroFactura] = useState('FF03-00000001');
  const [formaPagoTipo, setFormaPagoTipo] = useState<'CONTADO' | 'CREDITO'>('CONTADO');
  const [fechaVencimiento, setFechaVencimiento] = useState(todayDate());
  const [cuotas, setCuotas] = useState<FlexoInvoiceQuota[]>([]);
  const [moneda, setMoneda] = useState<'PEN' | 'USD'>('USD');
  const [cuenta, setCuenta] = useState('');
  const [detraccion, setDetraccion] = useState<FlexoFacturaDetraccion>('000');
  const [detraccionOptions, setDetraccionOptions] = useState(fallbackDetraccionOptions);
  const [tipoExclusionProducto, setTipoExclusionProducto] = useState<FlexoFacturaTipoExclusion>('GRAVADA');
  const [ordenCompra, setOrdenCompra] = useState('');
  const [observaciones, setObservaciones] = useState('');
  const [message, setMessage] = useState('');
  const [warnings, setWarnings] = useState<string[]>([]);
  const [catalogWarnings, setCatalogWarnings] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [declaring, setDeclaring] = useState(false);
  const [preview, setPreview] = useState<FlexoFacturaPreviewResponse | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [declareConfirmOpen, setDeclareConfirmOpen] = useState(false);
  const [successInvoice, setSuccessInvoice] = useState('');
  const [guidesModalOpen, setGuidesModalOpen] = useState(false);

  const totals = useMemo(() => calculateTotals(items, tipoExclusionProducto), [items, tipoExclusionProducto]);
  const selectedGuideRows = guias.filter((guide) => selectedGuides.has(guide.serieNumeroGuia));
  const selectedClientLabel = cliente ? `${cliente.numeroDocumento} - ${cliente.razonSocial}` : '';
  const paymentName = formaPagoTipo === 'CONTADO' ? 'Contado' : `Factura ${daysBetween(todayDate(), fechaVencimiento)} dias`;
  const normalizedCuotas = useMemo(() => normalizeQuotas(cuotas), [cuotas]);
  const quotaTotal = roundMoney(normalizedCuotas.reduce((sum, cuota) => sum + cuota.monto, 0));
  const itemCurrencies = useMemo(
    () => [...new Set(items.map((item) => item.moneda).filter(Boolean))] as Array<'PEN' | 'USD'>,
    [items]
  );
  const canPreview = Boolean(cliente && selectedGuides.size > 0 && items.length > 0 && cuenta.trim() && fechaVencimiento);
  const declarationBlockReason = flexoDeclarationBlockReason({
    hasCliente: Boolean(cliente),
    selectedGuides: selectedGuides.size,
    items: items.length,
    hasMissingCurrency: items.some((item) => !item.moneda),
    hasMixedCurrencies: itemCurrencies.length > 1,
    formaPagoTipo,
    fechaEmision: todayDate(),
    fechaVencimiento,
    cuotas: normalizedCuotas,
    quotaTotal,
    hasCuenta: Boolean(cuenta.trim()),
    itemsHavePrice: items.every((item) => item.precioUnitario > 0),
    total: totals.total,
    detraccion,
    tipoExclusionProducto
  });
  const canDeclare = !declarationBlockReason && !declaring;

  useEffect(() => {
    let cancelled = false;

    Promise.all([
      flexoFacturaService.getNextSerie(),
      flexoFacturaService.listCuentas(),
      flexoService.listCatalogs()
    ])
      .then(([serieResult, cuentasResult, flexoCatalogs]) => {
        if (cancelled) return;

        setSerieNumeroFactura(serieResult.serieNumeroFactura);
        setCuentas(cuentasResult.cuentas);
        setCatalogWarnings(cuentasResult.warnings.filter(isUserFacingWarning));
        setCuenta(cuentasResult.cuentas[0]?.cuenta ?? '');
        const officialDetracciones = flexoCatalogs.detracciones
          .filter((item): item is typeof item & { codigo: FlexoFacturaDetraccion } => isFlexoFacturaDetraccion(item.codigo))
          .map((item) => ({
            value: item.codigo,
            label: displayDetraccionOption(item.codigo, item.descripcion, item.porcentaje)
          }));
        if (officialDetracciones.length > 0) {
          setDetraccionOptions(officialDetracciones);
          if (!officialDetracciones.some((item) => item.value === detraccion)) {
            setDetraccion(officialDetracciones[0]!.value);
          }
        }
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

  useEffect(() => {
    if (formaPagoTipo !== 'CREDITO') return;
    if (cuotas.length > 0) return;
    if (totals.total <= 0) return;
    setCuotas([{ id: createOperationId(), fecha: fechaVencimiento, monto: totals.total.toFixed(2) }]);
  }, [cuotas.length, fechaVencimiento, formaPagoTipo, totals.total]);

  useEffect(() => {
    if (itemCurrencies.length === 1 && itemCurrencies[0] !== moneda) {
      setMoneda(itemCurrencies[0]);
    }
  }, [itemCurrencies, moneda]);

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

  async function declareInvoice() {
    if (!cliente || !canDeclare) {
      setMessage(declarationBlockReason || 'Complete cliente, guia, cuenta, forma de pago y precios antes de declarar.');
      return;
    }

    setDeclareConfirmOpen(false);
    setDeclaring(true);
    setPreviewOpen(false);
    setMessage(`Declarando factura Flexo ${serieNumeroFactura}...`);

    try {
      const result = await flexoFacturaService.declare(buildInvoicePayload(cliente), createOperationId());
      const nextSerie = await flexoFacturaService.getNextSerie();
      setSuccessInvoice(result.serieNumeroFactura);
      setSerieNumeroFactura(nextSerie.serieNumeroFactura);
      clearAll();
      setMessage(`Factura ${result.serieNumeroFactura} enviada a Bizlinks y reflejada en tablas legacy.`);
    } catch (error) {
      setMessage(formatFlexoInvoiceError(error));
      await refreshNextSerieQuietly();
    } finally {
      setDeclaring(false);
    }
  }

  function requestDeclareInvoice() {
    if (!cliente || !canDeclare) {
      setMessage(declarationBlockReason || 'Complete cliente, guia, cuenta, forma de pago y precios antes de declarar.');
      return;
    }

    setDeclareConfirmOpen(true);
  }

  async function refreshNextSerieQuietly() {
    try {
      const nextSerie = await flexoFacturaService.getNextSerie();
      setSerieNumeroFactura(nextSerie.serieNumeroFactura);
    } catch {
      // Keep the primary declaration error visible.
    }
  }

  function buildInvoicePayload(currentCliente: FlexoFacturaCliente) {
    return {
      serie: 'FF03' as const,
      numero: serieNumeroFactura.split('-')[1] ?? '00000001',
      fechaEmision: todayDate(),
      fechaVencimiento,
      moneda,
      diasPago: formaPagoTipo === 'CREDITO' ? daysBetween(todayDate(), fechaVencimiento) : 0,
      cuotas: formaPagoTipo === 'CREDITO' ? normalizedCuotas : [],
      formaPago: paymentName,
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
    setGuidesModalOpen(false);
    setMessage('');
    setOrdenCompra('');
    setObservaciones('');
    setFechaVencimiento(todayDate());
    setFormaPagoTipo('CONTADO');
    setCuotas([]);
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
    if (nextType === 'CONTADO') {
      setFechaVencimiento(todayDate());
      setCuotas([]);
      return;
    }
    const dueDate = fechaVencimiento > todayDate() ? fechaVencimiento : addDays(todayDate(), 30);
    setFechaVencimiento(dueDate);
    setCuotas([{ id: createOperationId(), fecha: dueDate, monto: totals.total > 0 ? totals.total.toFixed(2) : '' }]);
  }

  function addQuota() {
    setCuotas((current) => [
      ...current,
      { id: createOperationId(), fecha: fechaVencimiento, monto: '' }
    ]);
  }

  function updateQuota(id: string, patch: Partial<FlexoInvoiceQuota>) {
    setCuotas((current) => current.map((quota) => quota.id === id ? { ...quota, ...patch } : quota));
  }

  function removeQuota(id: string) {
    setCuotas((current) => current.filter((quota) => quota.id !== id));
  }

  if (documentMode === 'NOTA_CREDITO') {
    return <FlexoCreditNotePanel documentMode={documentMode} onDocumentModeChange={setDocumentMode} />;
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
        <FormField label="FECHA VENCIMIENTO" className="flexo-due-field">
          <input
            type="date"
            value={fechaVencimiento}
            min={todayDate()}
            onChange={(event) => {
              setFechaVencimiento(event.target.value);
              if (formaPagoTipo === 'CREDITO' && cuotas.length === 1) {
                setCuotas((current) => current.map((quota) => ({ ...quota, fecha: event.target.value })));
              }
            }}
          />
        </FormField>
        <FormField label="TIPO DOCUMENTO" required>
          <select className="invoice-control-sm" value={documentMode} onChange={(event) => setDocumentMode(event.target.value as 'FACTURA' | 'NOTA_CREDITO')}>
            <option value="FACTURA">Factura</option>
            <option value="NOTA_CREDITO">Nota de Credito</option>
          </select>
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

        <FormField label="CUENTA CONTABLE" className="flexo-account-field">
          <select value={cuenta} onChange={(event) => setCuenta(event.target.value)}>
            <option value="">Seleccionar</option>
            {cuentas.map((item) => (
              <option key={item.id} value={item.cuenta}>
                {item.label}
              </option>
            ))}
          </select>
        </FormField>
        <FormField label="DETRACCION">
          <select value={detraccion} onChange={(event) => setDetraccion(event.target.value as FlexoFacturaDetraccion)}>
            {detraccionOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </FormField>
        <FormField label="MONEDA" className="flexo-currency-field">
          <input className="auto-field" value={moneda} readOnly title="Moneda tomada de la hoja de empaque cuando esta disponible" />
        </FormField>

        <FormField label="FORMA PAGO" required className="flexo-payment-field">
          <div className="payment-controls">
            <select value={formaPagoTipo} onChange={(event) => changeFormaPagoTipo(event.target.value as 'CONTADO' | 'CREDITO')}>
              <option value="CONTADO">CONTADO</option>
              <option value="CREDITO">CREDITO</option>
            </select>
          </div>
        </FormField>
        <FormField label="OC" className="flexo-oc-field">
          <input value={ordenCompra} onChange={(event) => setOrdenCompra(event.target.value)} placeholder="Orden de compra" />
        </FormField>
        <label className="form-field invoice-observations-field">
          <span>OBSERVACIONES</span>
          <div className="flexo-observations-row">
            <textarea value={observaciones} onChange={(event) => setObservaciones(event.target.value)} placeholder="Observaciones" />
            <button
              type="button"
              className="tool-button primary-tool flexo-guides-button"
              onClick={() => setGuidesModalOpen(true)}
              disabled={!cliente}
              title={cliente ? 'Seleccionar guias aceptadas' : 'Seleccione un cliente'}
            >
              <FileText size={16} />
              Guias
            </button>
          </div>
        </label>
      </section>

      {(message || catalogWarnings.length > 0) && (
        <div className="invoice-message-row">
          {message && <div className="inline-message">{message}</div>}
          {catalogWarnings.map((warning) => <div key={warning} className="inline-message">{warning}</div>)}
        </div>
      )}

      {formaPagoTipo === 'CREDITO' && (
        <section className="invoice-summary-layout flexo-quota-layout">
          <div className="invoice-guides-panel">
            <div className="invoice-section-heading">
              <h2>Cuotas</h2>
              <button type="button" className="secondary-button compact-action" onClick={addQuota}>
                Cuotas +
              </button>
            </div>
            <div className="list-table-wrap invoice-table-wrap">
              <table className="invoice-guides-table flexo-quota-table">
                <thead>
                  <tr>
                    <th>Nro</th>
                    <th>Fecha</th>
                    <th>Monto</th>
                    <th>Opt</th>
                  </tr>
                </thead>
                <tbody>
                  {cuotas.length === 0 ? (
                    <tr><td colSpan={4} className="empty-row">Agregue al menos una cuota para credito.</td></tr>
                  ) : cuotas.map((quota, index) => (
                    <tr key={quota.id}>
                      <td>{index + 1}</td>
                      <td>
                        <input
                          type="date"
                          value={quota.fecha}
                          min={todayDate()}
                          onChange={(event) => updateQuota(quota.id, { fecha: event.target.value })}
                        />
                      </td>
                      <td>
                        <input
                          type="text"
                          inputMode="decimal"
                          value={quota.monto}
                          onChange={(event) => updateQuota(quota.id, { monto: normalizeDecimalText(event.target.value) })}
                        />
                      </td>
                      <td>
                        <button type="button" className="icon-action-button" title="Quitar cuota" onClick={() => removeQuota(quota.id)}>
                          <X size={15} />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          <aside className="invoice-side-panel invoice-summary-side">
            <div className="invoice-totals">
              <div><span>Total venta</span><strong>{totals.total.toFixed(2)}</strong></div>
              <div><span>Total cuotas</span><strong>{quotaTotal.toFixed(2)}</strong></div>
              <div><span>Pendiente</span><strong>{roundMoney(totals.total - quotaTotal).toFixed(2)}</strong></div>
            </div>
          </aside>
        </section>
      )}

      <section className="invoice-workarea">
        <div className="products-table-wrap">
          <div className="invoice-section-heading flexo-review-heading">
            <h2>Revision</h2>
            <span>{selectedGuideRows.length} guia(s), {items.length} item(s)</span>
          </div>
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
            className={`declare-button${!canDeclare && !declaring ? ' declare-button-blocked' : ''}`}
            disabled={declaring}
            aria-disabled={!canDeclare || declaring}
            title={canDeclare ? 'Declarar factura Flexo' : declarationBlockReason}
            onClick={requestDeclareInvoice}
          >
            <Send size={16} />
            {declaring ? 'Declarando...' : 'Declarar documento'}
          </button>
          {!canDeclare && !declaring && <div className="declare-hint">{declarationBlockReason}</div>}
        </aside>
      </section>

      {successInvoice && (
        <DeclarationSuccessModal
          documentLabel="Factura Flexo"
          serieNumero={successInvoice}
          reportsPath="/flexo/reportes?tab=facturas"
          onClose={() => setSuccessInvoice('')}
          message="La factura fue enviada a Bizlinks y reflejada en las tablas legacy usadas por ventas, comisiones y reportes. Revise Reportes para confirmar la respuesta SUNAT y abrir el PDF cuando quede aceptada."
        />
      )}
      {declareConfirmOpen && cliente && (
        <FlexoInvoiceDeclareConfirmModal
          serieNumeroFactura={serieNumeroFactura}
          cliente={cliente.razonSocial}
          total={totals.total}
          guideCount={selectedGuides.size}
          itemCount={items.length}
          moneda={moneda}
          declaring={declaring}
          onCancel={() => setDeclareConfirmOpen(false)}
          onConfirm={() => void declareInvoice()}
        />
      )}
      {guidesModalOpen && (
        <FlexoGuidesModal
          guides={guias}
          warnings={warnings}
          selectedGuides={selectedGuides}
          items={items}
          tipoExclusionProducto={tipoExclusionProducto}
          onToggle={toggleGuide}
          onClose={() => setGuidesModalOpen(false)}
        />
      )}
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

type FlexoCreditNotePanelProps = {
  documentMode: 'FACTURA' | 'NOTA_CREDITO';
  onDocumentModeChange: Dispatch<SetStateAction<'FACTURA' | 'NOTA_CREDITO'>>;
};

const creditNoteMotives: Array<{ value: FlexoCreditNoteMotivo; label: string }> = [
  { value: 'anulacion', label: 'Anulacion de la operacion' },
  { value: 'ruc', label: 'Anulacion por error en el RUC' },
  { value: 'total', label: 'Devolucion total' },
  { value: 'item', label: 'Devolucion por item' }
];

function FlexoCreditNotePanel({ documentMode, onDocumentModeChange }: FlexoCreditNotePanelProps) {
  const [query, setQuery] = useState('');
  const [facturas, setFacturas] = useState<FlexoCreditNoteInvoice[]>([]);
  const [factura, setFactura] = useState<FlexoCreditNoteInvoice | null>(null);
  const [serieNumeroNota, setSerieNumeroNota] = useState('FC03-00000001');
  const [motivo, setMotivo] = useState<FlexoCreditNoteMotivo>('total');
  const [cuentaNc, setCuentaNc] = useState('7094121');
  const [observaciones, setObservaciones] = useState('');
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(false);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [declaring, setDeclaring] = useState(false);
  const [preview, setPreview] = useState<FlexoCreditNotePreviewResponse | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [successNote, setSuccessNote] = useState('');

  const selectedLabel = factura ? `${factura.serieNumeroFactura} - ${factura.cliente.numeroDocumento} - ${factura.cliente.razonSocial}` : '';
  const canPreview = Boolean(factura && motivo && cuentaNc.trim());
  const declarationBlockReason = creditNoteBlockReason({ factura, motivo, cuentaNc, preview });
  const canDeclare = !declarationBlockReason && !declaring;

  useEffect(() => {
    let cancelled = false;
    flexoCreditNoteService.getNextSerie()
      .then((result) => {
        if (!cancelled) setSerieNumeroNota(result.serieNumeroNotaCredito);
      })
      .catch((error) => {
        if (!cancelled) setMessage(error instanceof Error ? error.message : 'No se pudo cargar correlativo FC03.');
      });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (factura && query === selectedLabel) return;
    if (query.trim().length < 2) {
      setFacturas([]);
      return;
    }

    const timeout = window.setTimeout(() => {
      void searchFacturas(false);
    }, 300);

    return () => window.clearTimeout(timeout);
  }, [factura, query, selectedLabel]);

  async function searchFacturas(showStatus = true) {
    setLoading(true);
    setPreview(null);
    if (showStatus) setMessage('Buscando facturas FF03 aceptadas...');

    try {
      const result = await flexoCreditNoteService.searchFacturas(query);
      setFacturas(result);
      if (showStatus) setMessage(result.length > 0 ? `${result.length} factura(s) encontradas.` : 'Sin facturas aceptadas para mostrar.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'No se pudo buscar facturas Flexo.');
    } finally {
      setLoading(false);
    }
  }

  function selectFactura(nextFactura: FlexoCreditNoteInvoice) {
    setFactura(nextFactura);
    setQuery(`${nextFactura.serieNumeroFactura} - ${nextFactura.cliente.numeroDocumento} - ${nextFactura.cliente.razonSocial}`);
    setFacturas([]);
    setPreview(null);
    setMessage(nextFactura.notacres.length > 0 ? `Esta factura ya tiene NOTACRE: ${nextFactura.notacres.join(', ')}.` : '');
  }

  function changeQuery(value: string) {
    setQuery(value);
    if (!factura || value === selectedLabel) return;
    setFactura(null);
    setPreview(null);
    setFacturas([]);
  }

  function buildPayload() {
    if (!factura) throw new Error('Seleccione una factura afectada.');
    return {
      facturaAfectada: factura.serieNumeroFactura,
      motivo,
      cuentaNc,
      observaciones
    };
  }

  async function openPreview() {
    if (!factura) return;
    setPreviewLoading(true);
    setMessage(`Validando nota de credito para ${factura.serieNumeroFactura}...`);

    try {
      const result = await flexoCreditNoteService.preview(buildPayload());
      setPreview(result);
      setMessage(`Vista previa lista para ${result.serieNumeroNotaCredito}.`);
    } catch (error) {
      setMessage(formatFlexoCreditNoteError(error));
    } finally {
      setPreviewLoading(false);
    }
  }

  async function declareCreditNote() {
    if (!canDeclare) {
      setMessage(declarationBlockReason || 'Complete la nota de credito antes de declarar.');
      return;
    }

    setConfirmOpen(false);
    setDeclaring(true);
    setMessage(`Declarando nota de credito ${serieNumeroNota}...`);

    try {
      const result = await flexoCreditNoteService.declare(buildPayload(), createOperationId());
      const nextSerie = await flexoCreditNoteService.getNextSerie();
      setSuccessNote(result.serieNumeroNotaCredito);
      setSerieNumeroNota(nextSerie.serieNumeroNotaCredito);
      setFactura(null);
      setFacturas([]);
      setQuery('');
      setPreview(null);
      setObservaciones('');
      setMessage(`Nota de credito ${result.serieNumeroNotaCredito} enviada y reflejada en legacy.`);
    } catch (error) {
      setMessage(formatFlexoCreditNoteError(error));
    } finally {
      setDeclaring(false);
    }
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
          <select className="invoice-control-sm" value={documentMode} onChange={(event) => onDocumentModeChange(event.target.value as 'FACTURA' | 'NOTA_CREDITO')}>
            <option value="FACTURA">Factura</option>
            <option value="NOTA_CREDITO">Nota de Credito</option>
          </select>
        </FormField>
        <FormField label="SERIE Y NUMERO" required>
          <input className="auto-field invoice-control-sm" value={serieNumeroNota} readOnly />
        </FormField>
        <FormField label="SERIE AFECTADA" required wide>
          <div className="invoice-client-combo">
            <div className="invoice-client-picker">
              <input
                value={query}
                onChange={(event) => changeQuery(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault();
                    void searchFacturas();
                  }
                }}
                placeholder="FF03 / RUC / razon social"
              />
              <button type="button" className="icon-button" title="Buscar factura" onClick={() => void searchFacturas()} disabled={loading}>
                <Search size={18} />
              </button>
              <button
                type="button"
                className="icon-button"
                title="Limpiar nota"
                onClick={() => {
                  setFactura(null);
                  setFacturas([]);
                  setQuery('');
                  setPreview(null);
                  setMessage('');
                }}
              >
                <RefreshCw size={18} />
              </button>
            </div>
            {facturas.length > 0 && !factura && (
              <section className="client-suggestions">
                <div className="client-suggestions-title">Seleccione una factura aceptada</div>
                {facturas.map((item) => (
                  <button key={item.serieNumeroFactura} type="button" onClick={() => selectFactura(item)}>
                    <span>{item.serieNumeroFactura}</span>
                    <strong>{item.cliente.numeroDocumento} - {item.cliente.razonSocial}</strong>
                    <em>{item.moneda} {item.total.toFixed(2)}</em>
                  </button>
                ))}
              </section>
            )}
          </div>
        </FormField>
        <FormField label="MOTIVO" required>
          <select value={motivo} onChange={(event) => {
            setMotivo(event.target.value as FlexoCreditNoteMotivo);
            setPreview(null);
          }}>
            {creditNoteMotives.map((item) => (
              <option key={item.value} value={item.value}>{item.label}</option>
            ))}
          </select>
        </FormField>
        <FormField label="CUENTA CONTABLE">
          <input value={cuentaNc} onChange={(event) => {
            setCuentaNc(normalizeDecimalText(event.target.value).replace(/\./g, ''));
            setPreview(null);
          }} />
        </FormField>
        <FormField label="DETRACCION">
          <input className="auto-field" value="Sin Detraccion" readOnly />
        </FormField>
        <label className="form-field invoice-observations-field">
          <span>OBSERVACIONES</span>
          <textarea value={observaciones} onChange={(event) => setObservaciones(event.target.value)} placeholder="Observaciones" />
        </label>
      </section>

      {message && <div className="invoice-message-row"><div className="inline-message">{message}</div></div>}

      <section className="invoice-workarea">
        <div className="products-table-wrap">
          <div className="invoice-section-heading flexo-review-heading">
            <h2>Revision</h2>
            <span>{factura ? `${factura.serieNumeroFactura}` : 'Sin factura afectada'}</span>
          </div>
          <table className="invoice-items-table">
            <thead>
              <tr>
                <th>Factura</th>
                <th>Fecha</th>
                <th>Cliente</th>
                <th>Moneda</th>
                <th>Total</th>
                <th>Guias</th>
                <th>NCE</th>
              </tr>
            </thead>
            <tbody>
              {!factura ? (
                <tr><td colSpan={7} className="empty-row">Seleccione una factura FF03 aceptada.</td></tr>
              ) : (
                <tr>
                  <td>{factura.serieNumeroFactura}</td>
                  <td>{formatDate(factura.fechaEmision)}</td>
                  <td>{factura.cliente.numeroDocumento} - {factura.cliente.razonSocial}</td>
                  <td>{factura.moneda}</td>
                  <td>{factura.total.toFixed(2)}</td>
                  <td>{factura.guias.join(', ') || '-'}</td>
                  <td>{factura.notacres.join(', ') || '-'}</td>
                </tr>
              )}
            </tbody>
          </table>
          {preview && (
            <div className="invoice-confirm-summary flexo-preview-box">
              <div><span>Nota</span><strong>{preview.serieNumeroNotaCredito}</strong></div>
              <div><span>Motivo</span><strong>{preview.motivo.codigo} - {preview.motivo.descripcion}</strong></div>
              <div><span>Items</span><strong>{preview.items}</strong></div>
              <div><span>Gravada</span><strong>{preview.totals.gravada.toFixed(2)}</strong></div>
              <div><span>IGV</span><strong>{preview.totals.igv.toFixed(2)}</strong></div>
              <div><span>Total</span><strong>{preview.moneda} {preview.totals.total.toFixed(2)}</strong></div>
            </div>
          )}
        </div>
        <aside className="invoice-detail-actions">
          <button type="button" className="preview-button" disabled={!canPreview || previewLoading} onClick={() => void openPreview()}>
            {previewLoading ? <ClipboardList size={16} /> : <Eye size={16} />}
            Vista previa
          </button>
          <button
            type="button"
            className={`declare-button${!canDeclare && !declaring ? ' declare-button-blocked' : ''}`}
            disabled={declaring}
            aria-disabled={!canDeclare || declaring}
            title={canDeclare ? 'Declarar nota de credito Flexo' : declarationBlockReason}
            onClick={() => {
              if (!canDeclare) {
                setMessage(declarationBlockReason);
                return;
              }
              setConfirmOpen(true);
            }}
          >
            <Send size={16} />
            {declaring ? 'Declarando...' : 'Declarar documento'}
          </button>
          {!canDeclare && !declaring && <div className="declare-hint">{declarationBlockReason}</div>}
        </aside>
      </section>

      {confirmOpen && factura && preview && (
        <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="flexo-nce-confirm-title">
          <section className="success-modal invoice-confirm-modal">
            <h2 id="flexo-nce-confirm-title">Confirmar nota de credito</h2>
            <p>Se enviara la NCE a Bizlinks, se marcara NOTACRE y se reflejara C03 en YCHIDB3.</p>
            <div className="invoice-confirm-summary">
              <div><span>Nota</span><strong>{preview.serieNumeroNotaCredito}</strong></div>
              <div><span>Factura afectada</span><strong>{factura.serieNumeroFactura}</strong></div>
              <div><span>Cliente</span><strong>{factura.cliente.razonSocial}</strong></div>
              <div><span>Total</span><strong>{preview.moneda} {preview.totals.total.toFixed(2)}</strong></div>
            </div>
            <div className="modal-actions">
              <button type="button" className="secondary-button" onClick={() => setConfirmOpen(false)} disabled={declaring}>Cancelar</button>
              <button type="button" className="declare-button" onClick={() => void declareCreditNote()} disabled={declaring}>
                {declaring ? 'Declarando...' : 'Confirmar y declarar'}
              </button>
            </div>
          </section>
        </div>
      )}
      {successNote && (
        <DeclarationSuccessModal
          documentLabel="Nota de Credito Flexo"
          serieNumero={successNote}
          reportsPath="/flexo/reportes?tab=bajas"
          onClose={() => setSuccessNote('')}
          message="La nota de credito fue enviada a Bizlinks y reflejada en las tablas legacy. Revise Reportes para confirmar respuesta SUNAT."
        />
      )}
    </section>
  );
}

type ItemNumberField = 'cantidad' | 'precioUnitario';
type ItemInputState = Record<string, Partial<Record<ItemNumberField, string>>>;
type FlexoInvoiceQuota = {
  id: string;
  fecha: string;
  monto: string;
};

type DeclarationReadiness = {
  hasCliente: boolean;
  selectedGuides: number;
  items: number;
  hasMissingCurrency: boolean;
  hasMixedCurrencies: boolean;
  formaPagoTipo: 'CONTADO' | 'CREDITO';
  fechaEmision: string;
  fechaVencimiento: string;
  cuotas: Array<{ fecha: string; monto: number }>;
  quotaTotal: number;
  hasCuenta: boolean;
  itemsHavePrice: boolean;
  total: number;
  detraccion: FlexoFacturaDetraccion;
  tipoExclusionProducto: FlexoFacturaTipoExclusion;
};

function flexoDeclarationBlockReason(input: DeclarationReadiness) {
  if (!input.hasCliente) return 'Seleccione un cliente antes de declarar.';
  if (input.selectedGuides === 0 || input.items === 0) return 'Seleccione al menos una GRE aceptada pendiente.';
  if (input.hasMissingCurrency) return 'Todas las guias deben tener moneda en EMPAQUE_DETALLE antes de declarar.';
  if (input.hasMixedCurrencies) return 'No se puede facturar una seleccion con items en PEN y USD. Separe la facturacion por moneda.';
  if (!input.hasCuenta) return 'Seleccione la cuenta contable auditada para Flexo.';
  if (input.fechaVencimiento < input.fechaEmision) return 'La fecha de vencimiento no puede ser anterior a la emision.';
  if (input.detraccion !== '000') return 'La detraccion distinta a 000 queda pendiente de auditoria.';
  if (input.tipoExclusionProducto !== 'GRAVADA') return 'Solo Gravada esta habilitada para la primera declaracion real.';
  if (!input.itemsHavePrice) return 'Ingrese precio unitario mayor a cero en todos los items.';
  if (input.total <= 0) return 'El total de la factura debe ser mayor a cero.';
  if (input.formaPagoTipo === 'CREDITO') {
    if (input.cuotas.length === 0) return 'Agregue al menos una cuota para credito.';
    if (input.cuotas.some((cuota) => cuota.fecha < input.fechaEmision)) return 'Ninguna cuota puede vencer antes de la emision.';
    if (Math.abs(input.quotaTotal - input.total) > 0.01) return 'La suma de cuotas debe coincidir con el total de venta.';
  }

  return '';
}

type FlexoInvoiceDeclareConfirmModalProps = {
  serieNumeroFactura: string;
  cliente: string;
  total: number;
  guideCount: number;
  itemCount: number;
  moneda: 'PEN' | 'USD';
  declaring: boolean;
  onCancel: () => void;
  onConfirm: () => void;
};

function FlexoInvoiceDeclareConfirmModal({
  serieNumeroFactura,
  cliente,
  total,
  guideCount,
  itemCount,
  moneda,
  declaring,
  onCancel,
  onConfirm
}: FlexoInvoiceDeclareConfirmModalProps) {
  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="flexo-invoice-declare-confirm-title">
      <section className="success-modal invoice-confirm-modal">
        <h2 id="flexo-invoice-declare-confirm-title">Confirmar declaracion</h2>
        <p>
          Se enviara la factura a Bizlinks y se reflejara en las tablas legacy de ventas/comisiones.
          Revise estos datos antes de continuar.
        </p>
        <div className="invoice-confirm-summary">
          <div><span>Factura</span><strong>{serieNumeroFactura}</strong></div>
          <div><span>Cliente</span><strong>{cliente}</strong></div>
          <div><span>Guias</span><strong>{guideCount}</strong></div>
          <div><span>Items</span><strong>{itemCount}</strong></div>
          <div><span>Total</span><strong>{moneda} {total.toFixed(2)}</strong></div>
        </div>
        <div className="success-modal-actions">
          <button type="button" className="secondary-button" onClick={onCancel} disabled={declaring}>
            Revisar
          </button>
          <button type="button" className="tool-button primary-tool" onClick={onConfirm} disabled={declaring}>
            <Send size={16} />
            {declaring ? 'Enviando...' : 'Enviar factura'}
          </button>
        </div>
      </section>
    </div>
  );
}

type FlexoGuidesModalProps = {
  guides: FlexoFacturaGuiaPendiente[];
  warnings: string[];
  selectedGuides: Set<string>;
  items: FlexoFacturaItem[];
  tipoExclusionProducto: FlexoFacturaTipoExclusion;
  onToggle: (guide: FlexoFacturaGuiaPendiente, checked: boolean) => void;
  onClose: () => void;
};

function FlexoGuidesModal({
  guides,
  warnings,
  selectedGuides,
  items,
  tipoExclusionProducto,
  onToggle,
  onClose
}: FlexoGuidesModalProps) {
  const selectedCount = selectedGuides.size;

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="flexo-guides-modal-title">
      <section className="success-modal flexo-guides-modal">
        <button type="button" className="success-modal-close" aria-label="Cerrar" onClick={onClose}>
          <X size={18} />
        </button>
        <header className="modal-titlebar">
          <div>
            <h2 id="flexo-guides-modal-title">Guias aceptadas</h2>
            <p>{selectedCount} seleccionada(s)</p>
          </div>
        </header>
        {warnings.map((warning) => <div key={warning} className="inline-message flexo-modal-message">{warning}</div>)}
        <div className="list-table-wrap invoice-table-wrap flexo-guides-modal-table">
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
              {guides.length === 0 ? (
                <tr>
                  <td colSpan={5} className="empty-row">No hay guias aceptadas pendientes para este cliente.</td>
                </tr>
              ) : guides.map((guide) => (
                <tr key={guide.serieNumeroGuia}>
                  <td>
                    <input
                      className="invoice-guide-checkbox"
                      type="checkbox"
                      checked={selectedGuides.has(guide.serieNumeroGuia)}
                      onChange={(event) => onToggle(guide, event.target.checked)}
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
        <div className="success-modal-actions">
          <button type="button" className="secondary-button" onClick={onClose}>
            Aceptar
          </button>
        </div>
      </section>
    </div>
  );
}

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

function addDays(value: string, days: number) {
  const date = new Date(`${value}T00:00:00`);
  date.setDate(date.getDate() + days);

  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0')
  ].join('-');
}

function daysBetween(startValue: string, endValue: string) {
  const start = new Date(`${startValue}T00:00:00-05:00`);
  const end = new Date(`${endValue}T00:00:00-05:00`);
  const diff = Math.round((end.getTime() - start.getTime()) / 86400000);

  return Math.max(0, diff);
}

function normalizeQuotas(quotas: FlexoInvoiceQuota[]) {
  return quotas
    .map((quota) => ({
      fecha: quota.fecha,
      monto: parseDecimalInput(quota.monto)
    }))
    .filter((quota) => quota.fecha && quota.monto > 0);
}

function createOperationId() {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }

  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (char) => {
    const random = Math.random() * 16 | 0;
    const value = char === 'x' ? random : (random & 0x3) | 0x8;
    return value.toString(16);
  });
}

function formatFlexoInvoiceError(error: unknown) {
  if (error instanceof Error) return error.message;
  if (error && typeof error === 'object' && 'message' in error) return String((error as { message: unknown }).message);

  return 'No se pudo declarar la factura Flexo.';
}

function formatFlexoCreditNoteError(error: unknown) {
  if (error instanceof Error) return error.message;
  if (error && typeof error === 'object' && 'message' in error) return String((error as { message: unknown }).message);

  return 'No se pudo declarar la nota de credito Flexo.';
}

function creditNoteBlockReason(input: {
  factura: FlexoCreditNoteInvoice | null;
  motivo: FlexoCreditNoteMotivo;
  cuentaNc: string;
  preview: FlexoCreditNotePreviewResponse | null;
}) {
  if (!input.factura) return 'Seleccione una factura FF03 aceptada.';
  if (input.factura.notacres.length > 0) return `La factura ya tiene NOTACRE: ${input.factura.notacres.join(', ')}.`;
  if (!/^\d+$/.test(input.cuentaNc.trim())) return 'Ingrese una cuenta contable NC numerica.';
  if (input.motivo === 'item') return 'Devolucion por item requiere seleccion parcial y aun no esta habilitada para declarar.';
  if (!input.preview) return 'Genere vista previa antes de declarar.';
  if (input.preview.validations.some((item) => item.severity === 'error')) return 'La vista previa tiene validaciones bloqueantes.';

  return '';
}

function isFlexoFacturaDetraccion(value: string): value is FlexoFacturaDetraccion {
  return value === '000' || value === '037' || value === '025';
}

function displayDetraccionOption(value: FlexoFacturaDetraccion, description?: string, percent?: number) {
  if (value === '000') return 'Sin Detraccion';
  const normalizedDescription = description?.trim() || fallbackDetraccionOptions.find((item) => item.value === value)?.label || '';
  const withoutCode = normalizedDescription.replace(/^\d{3}\s*[-–]\s*/, '').replace(/\s+\d+(?:\.\d+)?%$/, '');
  const normalizedPercent = Number(percent || 0);
  return normalizedPercent > 0 ? `${withoutCode} ${normalizedPercent}%` : withoutCode;
}

function isUserFacingWarning(value: string) {
  return !/permission was denied|permiso SELECT|AAA_GUIAFACTURADA|tbDocumentos\.nguia/i.test(value);
}
