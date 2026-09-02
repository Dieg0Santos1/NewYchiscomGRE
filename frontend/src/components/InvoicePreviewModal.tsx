import { AlertTriangle, CheckCircle2, X } from 'lucide-react';

type PreviewInvoiceItem = {
  id: string;
  serieNumeroGuia: string;
  codigoProducto: string;
  descripcion: string;
  cantidad: number;
  precioUnitario: number;
};

type PreviewInvoiceResponse = {
  serieNumeroFactura: string;
  totals: {
    gravada: number;
    igv: number;
    total: number;
  };
  validations: Array<{
    code: string;
    severity: 'ok' | 'warning' | 'error';
    message: string;
  }>;
};

type InvoicePreviewModalProps = {
  preview: PreviewInvoiceResponse;
  items: PreviewInvoiceItem[];
  tipoExclusionProducto: 'GRAVADA' | 'GRATUITA' | 'EXONERADA' | 'INAFECTA';
  hideValidations?: boolean;
  onClose: () => void;
  onConfirm?: () => void;
};

export function InvoicePreviewModal({ preview, items, tipoExclusionProducto, hideValidations = false, onClose, onConfirm }: InvoicePreviewModalProps) {
  const visibleValidations = preview.validations.filter((item) => item.code !== 'PREVIEW_SIN_ESCRITURA');
  const hasWarnings = visibleValidations.some((item) => item.severity !== 'ok');
  const hasErrors = visibleValidations.some((item) => item.severity === 'error');

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="invoice-preview-title">
      <section className="preview-modal">
        <header className="preview-header">
          <div>
            <h2 id="invoice-preview-title">Vista previa de factura</h2>
            <p>Revision previa. No declara hasta pulsar el boton Declarar.</p>
          </div>
          <button className="icon-button" type="button" onClick={onClose} aria-label="Cerrar vista previa">
            <X size={20} />
          </button>
        </header>
        <div className="preview-content">
          <div className="preview-grid">
            <div>
              <span>Serie</span>
              <strong>{preview.serieNumeroFactura}</strong>
            </div>
            <div>
              <span>Guias</span>
              <strong>{new Set(items.map((item) => item.serieNumeroGuia)).size}</strong>
            </div>
            <div>
              <span>Items</span>
              <strong>{items.length}</strong>
            </div>
            <div>
              <span>Total</span>
              <strong>{preview.totals.total.toFixed(2)}</strong>
            </div>
          </div>

          <section className="preview-section">
            <h3>Montos</h3>
            <dl className="preview-list">
              <div>
                <dt>Gravada</dt>
                <dd>{preview.totals.gravada.toFixed(2)}</dd>
              </div>
              <div>
                <dt>IGV</dt>
                <dd>{preview.totals.igv.toFixed(2)}</dd>
              </div>
              <div>
                <dt>Total</dt>
                <dd>{preview.totals.total.toFixed(2)}</dd>
              </div>
              <div>
                <dt>Estado</dt>
                <dd>{hasWarnings ? 'Revisar datos' : 'Lista para declarar'}</dd>
              </div>
            </dl>
          </section>

          {!hideValidations && (
            <section className="preview-section">
              <h3>Validaciones</h3>
              <div className="invoice-preview-validations">
                {visibleValidations.map((item) => (
                  <div key={item.code} className={item.severity === 'ok' ? 'invoice-validation-ok' : 'invoice-validation-warning'}>
                    {item.severity === 'ok' ? <CheckCircle2 size={16} /> : <AlertTriangle size={16} />}
                    <span>{item.message}</span>
                  </div>
                ))}
              </div>
            </section>
          )}

          <section className="preview-section">
            <h3>Detalle</h3>
            <table className="preview-items-table">
              <thead>
                <tr>
                  <th>Codigo</th>
                  <th>Descripcion</th>
                  <th>Cant.</th>
                  <th>Prec.U</th>
                  <th>Total</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item) => (
                  <tr key={item.id}>
                    <td>{item.codigoProducto}</td>
                    <td>{item.descripcion}</td>
                    <td>{item.cantidad}</td>
                    <td>{item.precioUnitario.toFixed(2)}</td>
                    <td>{lineTotal(item, tipoExclusionProducto).toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        </div>
        <footer className="preview-actions">
          <button type="button" className="tool-button" onClick={onClose}>
            Cerrar
          </button>
          <button type="button" className="confirm-preview-button" disabled={hasErrors} onClick={onConfirm ?? onClose}>
            Confirmar vista previa
          </button>
        </footer>
      </section>
    </div>
  );
}

function lineTotal(item: PreviewInvoiceItem, tipoExclusionProducto: InvoicePreviewModalProps['tipoExclusionProducto']) {
  const base = item.cantidad * item.precioUnitario;

  return roundMoney(base + (tipoExclusionProducto === 'GRAVADA' ? base * 0.18 : 0));
}

function roundMoney(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}
