import { CheckCircle2, FileText, X } from 'lucide-react';

type DeclarationSuccessModalProps = {
  documentLabel: string;
  serieNumero: string;
  onClose: () => void;
  reportsPath?: string;
  title?: string;
  message?: string;
};

export function DeclarationSuccessModal({
  documentLabel,
  serieNumero,
  onClose,
  reportsPath = '/guias/listado',
  title,
  message
}: DeclarationSuccessModalProps) {
  const isInvoice = documentLabel.toLowerCase().includes('factura');
  const modalTitle = title ?? (isInvoice ? 'Factura enviada' : `${documentLabel} declarada`);
  const modalMessage = message ?? 'El documento fue enviado a Bizlinks. Puede seguir el proceso, revisar la respuesta SUNAT y abrir el PDF desde Reportes.';

  function goToReports() {
    onClose();
    window.location.hash = reportsPath;
  }

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="declaration-success-title">
      <section className="success-modal">
        <button type="button" className="success-modal-close" aria-label="Cerrar" onClick={onClose}>
          <X size={18} />
        </button>
        <div className="success-modal-icon">
          <CheckCircle2 size={44} />
        </div>
        <h2 id="declaration-success-title">{modalTitle}</h2>
        <div className="success-modal-serie">{serieNumero}</div>
        <p>{modalMessage}</p>
        <div className="success-modal-actions">
          <button type="button" className="secondary-button" onClick={onClose}>
            Aceptar
          </button>
          <button type="button" className="tool-button primary-tool" onClick={goToReports}>
            <FileText size={16} />
            Ver reportes
          </button>
        </div>
      </section>
    </div>
  );
}
