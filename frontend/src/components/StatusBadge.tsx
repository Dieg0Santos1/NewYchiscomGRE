import type { GuideStatus } from '../types/gre';

const statusClass: Record<GuideStatus, string> = {
  Pendiente: 'status-generated',
  Generado: 'status-generated',
  Enviado: 'status-sent',
  'En proceso': 'status-processing',
  Aceptado: 'status-accepted',
  Rechazado: 'status-rejected',
  Error: 'status-rejected'
};

export function StatusBadge({ status }: { status: GuideStatus }) {
  return <span className={`status-badge ${statusClass[status]}`}>{status}</span>;
}
