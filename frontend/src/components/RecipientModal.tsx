import { Plus, Search, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { recipientService } from '../services/RecipientService';
import type { Recipient } from '../types/gre';

type RecipientModalProps = {
  onClose: () => void;
  onSelect: (recipient: Recipient) => void;
};

function documentLabel(documentType: string) {
  if (documentType === '6') return 'RUC';
  if (documentType === '1') return 'DNI';
  return documentType;
}

export function RecipientModal({ onClose, onSelect }: RecipientModalProps) {
  const [query, setQuery] = useState('');
  const [recipients, setRecipients] = useState<Recipient[]>([]);
  const [message, setMessage] = useState('');

  async function searchRecipients(nextQuery = query) {
    setMessage('Buscando destinatarios...');

    try {
      const results = await recipientService.search({ query: nextQuery });
      setRecipients(results);
      setMessage(`Destinatarios encontrados: ${results.length}`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'No se pudo buscar destinatarios.');
      setRecipients([]);
    }
  }

  useEffect(() => {
    void searchRecipients('');
  }, []);

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="recipient-title">
      <section className="recipient-modal">
        <header className="modal-titlebar">
          <h2 id="recipient-title">Destinatario</h2>
          <button className="icon-button" type="button" onClick={onClose} aria-label="Cerrar destinatario">
            <X size={18} />
          </button>
        </header>

        <div className="recipient-toolbar">
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') void searchRecipients();
            }}
            placeholder="Buscar por documento o razon social"
          />
          <button type="button" className="tool-button primary-tool" onClick={() => void searchRecipients()}>
            <Search size={16} />
            Buscar
          </button>
          <button type="button" className="tool-button" disabled title="Pendiente de mapeo de servicio y tablas de destinatarios">
            <Plus size={16} />
          </button>
        </div>
        {message && <div className="inline-message list-message">{message}</div>}

        <div className="recipient-table-wrap">
          <table>
            <thead>
              <tr>
                <th>Numero documento</th>
                <th>Tipo documento</th>
                <th>Razon social o nombre</th>
                <th>Direccion</th>
                <th>Accion</th>
              </tr>
            </thead>
            <tbody>
              {recipients.length === 0 ? (
                <tr>
                  <td colSpan={5} className="empty-row">
                    Sin destinatarios encontrados.
                  </td>
                </tr>
              ) : (
                recipients.map((recipient) => (
                  <tr key={recipient.id}>
                    <td>{recipient.numeroDocumentoDestinatario}</td>
                    <td>{documentLabel(recipient.tipoDocumentoDestinatario)}</td>
                    <td>{recipient.razonSocialDestinatario}</td>
                    <td>{recipient.direcciones[0]?.direccion ?? 'Sin direccion'}</td>
                    <td>
                      <button type="button" className="select-row-button" onClick={() => onSelect(recipient)}>
                        Seleccionar
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
