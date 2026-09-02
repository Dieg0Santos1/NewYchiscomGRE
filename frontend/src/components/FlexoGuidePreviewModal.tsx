import { AlertTriangle, CheckCircle2, X } from 'lucide-react';
import type { FlexoGuidePreviewResponse } from '../types/flexo';

type FlexoGuidePreviewModalProps = {
  preview: FlexoGuidePreviewResponse;
  onClose: () => void;
  onConfirm: () => void;
};

export function FlexoGuidePreviewModal({ preview, onClose, onConfirm }: FlexoGuidePreviewModalProps) {
  const payload = preview.payload;
  const items = payload.empaques.flatMap((item) => item.items);
  const issues = preview.validations.filter((item) => item.severity !== 'ok');
  const hasErrors = preview.validations.some((item) => item.severity === 'error');

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="flexo-guide-preview-title">
      <section className="preview-modal">
        <header className="preview-header">
          <div>
            <h2 id="flexo-guide-preview-title">Vista previa de guia Flexo</h2>
            <p>Revise los datos antes de continuar.</p>
          </div>
          <button className="icon-button" type="button" onClick={onClose} aria-label="Cerrar vista previa">
            <X size={20} />
          </button>
        </header>

        <div className="preview-content">
          <div className="preview-grid">
            <div>
              <span>Serie</span>
              <strong>{preview.serieNumeroGuia}</strong>
            </div>
            <div>
              <span>Cliente</span>
              <strong>{payload.cliente.razonSocial}</strong>
            </div>
            <div>
              <span>Empaques</span>
              <strong>{payload.empaques.length}</strong>
            </div>
            <div>
              <span>Items</span>
              <strong>{items.length}</strong>
            </div>
          </div>

          {issues.length > 0 && (
            <section className="preview-section">
              <h3>Pendientes</h3>
              <div className="invoice-preview-validations">
                {issues.map((item) => (
                  <div key={item.code} className="invoice-validation-warning">
                    <AlertTriangle size={16} />
                    <span>{item.message}</span>
                  </div>
                ))}
              </div>
            </section>
          )}

          {issues.length === 0 && (
            <section className="preview-section">
              <div className="flexo-preview-ready">
                <CheckCircle2 size={18} />
                <span>Datos completos para la vista previa.</span>
              </div>
            </section>
          )}

          <section className="preview-section">
            <h3>Traslado</h3>
            <dl className="preview-list">
              <div>
                <dt>Motivo</dt>
                <dd>{payload.descripcionMotivoTraslado || 'Pendiente'}</dd>
              </div>
              <div>
                <dt>Destino</dt>
                <dd>{payload.destino.ubigeo} - {payload.destino.direccion}</dd>
              </div>
              <div>
                <dt>Peso</dt>
                <dd>{payload.pesoBruto} {payload.unidadPeso}</dd>
              </div>
              <div>
                <dt>Bultos</dt>
                <dd>{payload.numeroBultos}</dd>
              </div>
              <div>
                <dt>OC</dt>
                <dd>{payload.ordenCompra || 'Sin OC registrada'}</dd>
              </div>
              <div>
                <dt>Chofer</dt>
                <dd>{payload.conductor.numeroDocumento || 'Pendiente'} - {payload.conductor.nombres} {payload.conductor.apellidos}</dd>
              </div>
              <div>
                <dt>Licencia</dt>
                <dd>{payload.conductor.licencia || 'Pendiente'}</dd>
              </div>
              <div>
                <dt>Placa</dt>
                <dd>{payload.conductor.placa || 'Pendiente'}</dd>
              </div>
            </dl>
          </section>

          <section className="preview-section">
            <h3>Productos</h3>
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
                {items.map((item) => (
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
        </div>

        <footer className="preview-actions">
          <button type="button" className="secondary-button" onClick={onClose}>
            Cerrar
          </button>
          <button type="button" className="confirm-preview-button" disabled={hasErrors} onClick={onConfirm}>
            Confirmar vista previa
          </button>
        </footer>
      </section>
    </div>
  );
}
