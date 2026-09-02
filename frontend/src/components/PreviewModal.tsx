import { X } from 'lucide-react';
import type { GreInputDto } from '../types/gre';

type PreviewModalProps = {
  payload: GreInputDto;
  ordenCompra?: string;
  backendPreview?: unknown;
  error?: string;
  loading?: boolean;
  onClose: () => void;
  onConfirm: () => void;
};

export function PreviewModal({ payload, ordenCompra, backendPreview, error, loading = false, onClose, onConfirm }: PreviewModalProps) {
  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="preview-title">
      <section className="preview-modal">
        <header className="preview-header">
          <div>
            <h2 id="preview-title">Vista previa de GRE</h2>
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
              <span>Destinatario</span>
              <strong>{payload.destinatario.razonSocialDestinatario || 'Pendiente'}</strong>
            </div>
            <div>
              <span>Destino</span>
              <strong>{payload.traslado.ubigeoPtoLlegada || 'Pendiente'}</strong>
            </div>
            <div>
              <span>Productos</span>
              <strong>{payload.items.length}</strong>
            </div>
          </div>

          <section className="preview-section">
            <h3>Traslado</h3>
            <dl className="preview-list">
              <div>
                <dt>Motivo</dt>
                <dd>{payload.traslado.descripcionMotivoTraslado}</dd>
              </div>
              <div>
                <dt>Direccion de llegada</dt>
                <dd>{payload.traslado.direccionPtoLlegada}</dd>
              </div>
              <div>
                <dt>Peso</dt>
                <dd>{payload.traslado.pesoBrutoTotalBienes} {payload.traslado.unidadMedidaPesoBruto}</dd>
              </div>
              <div>
                <dt>Bultos</dt>
                <dd>{payload.traslado.numeroBultos}</dd>
              </div>
              <div>
                <dt>Orden de compra</dt>
                <dd>{ordenCompra || 'Sin OC registrada'}</dd>
              </div>
              <div>
                <dt>Chofer</dt>
                <dd>{payload.conductor.numeroDocumentoConductor} - {payload.conductor.nombreConductor} {payload.conductor.apellidoConductor}</dd>
              </div>
              <div>
                <dt>Placa</dt>
                <dd>{payload.vehiculo.numeroPlacaVehiculoPrin}</dd>
              </div>
              <div>
                <dt>Observaciones</dt>
                <dd>{payload.observaciones || 'Sin observaciones'}</dd>
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
          <button type="button" className="secondary-button" onClick={onClose}>
            Cerrar
          </button>
          <button type="button" className="confirm-preview-button" disabled={loading || Boolean(error)} onClick={onConfirm}>
            Confirmar vista previa
          </button>
        </footer>
      </section>
    </div>
  );
}
