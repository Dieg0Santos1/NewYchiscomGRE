import { X } from 'lucide-react';
import type { WorkOrderDocument } from '../types/gre';

type OtDocumentModalProps = {
  documents: WorkOrderDocument[];
  onClose: () => void;
  onSelect: (document: WorkOrderDocument) => void;
};

export function OtDocumentModal({ documents, onClose, onSelect }: OtDocumentModalProps) {
  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="ot-document-title">
      <section className="recipient-modal">
        <header className="modal-titlebar">
          <h2 id="ot-document-title">Seleccionar documento de OT</h2>
          <button className="icon-button" type="button" onClick={onClose} aria-label="Cerrar seleccion de OT">
            <X size={18} />
          </button>
        </header>

        <div className="recipient-table-wrap">
          <table>
            <thead>
              <tr>
                <th>Numero de OT</th>
                <th>Cliente</th>
                <th>Fecha</th>
                <th>Orden compra</th>
                <th>Descripcion o referencia</th>
                <th>Accion</th>
              </tr>
            </thead>
            <tbody>
              {documents.map((document) => (
                <tr key={document.idDocumentos}>
                  <td>{document.numeroOt}</td>
                  <td>{document.cliente}</td>
                  <td>{document.fecha}</td>
                  <td>{document.ordenCompra || '-'}</td>
                  <td>{document.referencia}</td>
                  <td>
                    <button type="button" className="select-row-button" onClick={() => onSelect(document)}>
                      Seleccionar
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
