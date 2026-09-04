import { FormEvent, useEffect, useState } from 'react';
import { Plus, ShieldCheck, Users, X } from 'lucide-react';
import { adminAccessService } from '../services/AdminAccessService';
import type { AuthAccess, AuthModule, CreateAuthAccess } from '../types/auth';

const moduleOptions: Array<{ value: AuthModule; label: string }> = [
  { value: 'fc', label: 'FC' },
  { value: 'flexo', label: 'Flexo' },
  { value: 'traslado', label: 'Guía 2' }
];

const emptyForm: CreateAuthAccess = {
  displayName: '',
  username: '',
  password: '',
  modules: []
};

export function AdminAccessPage() {
  const [accesses, setAccesses] = useState<AuthAccess[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [message, setMessage] = useState('');
  const [form, setForm] = useState<CreateAuthAccess>(emptyForm);

  useEffect(() => {
    void loadAccesses();
  }, []);

  async function loadAccesses() {
    setLoading(true);
    setMessage('');
    try {
      setAccesses(await adminAccessService.list());
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'No se pudieron cargar los accesos.');
    } finally {
      setLoading(false);
    }
  }

  function toggleModule(module: AuthModule) {
    setForm((current) => ({
      ...current,
      modules: current.modules.includes(module)
        ? current.modules.filter((item) => item !== module)
        : [...current.modules, module]
    }));
  }

  async function createAccess(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (form.modules.length === 0) {
      setMessage('Seleccione al menos un módulo.');
      return;
    }

    setSaving(true);
    setMessage('');
    try {
      const access = await adminAccessService.create(form);
      setAccesses((current) => [...current, access].sort((left, right) => left.displayName.localeCompare(right.displayName, 'es')));
      setForm(emptyForm);
      setModalOpen(false);
      setMessage(`Acceso permanente creado para ${access.displayName}.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'No se pudo crear el acceso.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="screen-panel admin-access-screen">
      <header className="admin-access-header">
        <div>
          <span className="admin-access-eyebrow"><ShieldCheck size={16} /> Administración</span>
          <h1>Accesos al sistema</h1>
          <p>Credenciales permanentes y permisos asignados por módulo.</p>
        </div>
        <button type="button" className="primary-button admin-new-access" onClick={() => { setForm(emptyForm); setMessage(''); setModalOpen(true); }}>
          <Plus size={18} /> Nuevo acceso
        </button>
      </header>

      {message && <div className="inline-message admin-access-message">{message}</div>}

      <div className="admin-access-summary">
        <Users size={20} />
        <strong>{accesses.length}</strong>
        <span>acceso(s) configurado(s)</span>
      </div>

      <div className="admin-access-table-wrap">
        <table className="admin-access-table">
          <thead>
            <tr>
              <th>Nombre</th>
              <th>Usuario</th>
              <th>Perfil</th>
              <th>Módulos</th>
              <th>Estado</th>
              <th>Creado por</th>
              <th>Fecha de creación</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={7} className="admin-table-empty">Cargando accesos...</td></tr>
            ) : accesses.length === 0 ? (
              <tr><td colSpan={7} className="admin-table-empty">No hay accesos configurados.</td></tr>
            ) : accesses.map((access) => (
              <tr key={access.username}>
                <td><strong>{access.displayName}</strong></td>
                <td>{access.username}</td>
                <td>{access.administrator ? <span className="admin-role-badge">SuperAdmin</span> : 'Usuario'}</td>
                <td><div className="admin-module-list">{access.modules.map((module) => <span key={module}>{moduleLabel(module)}</span>)}</div></td>
                <td><span className={access.active ? 'admin-status-active' : 'admin-status-inactive'}>{access.active ? 'Activo' : 'Inactivo'}</span></td>
                <td>{access.createdBy || 'Configuración inicial'}</td>
                <td>{formatDate(access.createdAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {modalOpen && (
        <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="new-access-title">
          <section className="admin-access-modal">
            <header className="modal-titlebar">
              <div>
                <h2 id="new-access-title">Nuevo acceso</h2>
                <p>La contraseña quedará vigente hasta que el administrador la cambie.</p>
              </div>
              <button type="button" className="modal-close" onClick={() => setModalOpen(false)} aria-label="Cerrar"><X size={20} /></button>
            </header>
            <form className="admin-access-form" onSubmit={createAccess}>
              <label>
                Nombre completo
                <input value={form.displayName} maxLength={120} onChange={(event) => setForm((current) => ({ ...current, displayName: event.target.value }))} required autoFocus />
              </label>
              <label>
                Usuario
                <input value={form.username} minLength={3} maxLength={80} pattern="[A-Za-z0-9._-]+" autoComplete="off" onChange={(event) => setForm((current) => ({ ...current, username: event.target.value }))} required />
              </label>
              <label>
                Contraseña permanente
                <input type="password" value={form.password} minLength={8} maxLength={128} autoComplete="new-password" onChange={(event) => setForm((current) => ({ ...current, password: event.target.value }))} required />
                <small>Mínimo 8 caracteres. La contraseña no se mostrará nuevamente.</small>
              </label>
              <fieldset>
                <legend>Módulos permitidos</legend>
                <div className="admin-module-options">
                  {moduleOptions.map((module) => (
                    <label key={module.value}>
                      <input type="checkbox" checked={form.modules.includes(module.value)} onChange={() => toggleModule(module.value)} />
                      <span>{module.label}</span>
                    </label>
                  ))}
                </div>
              </fieldset>
              {message && <div className="login-error" role="alert">{message}</div>}
              <footer className="admin-access-actions">
                <button type="button" className="secondary-button" onClick={() => setModalOpen(false)}>Cancelar</button>
                <button type="submit" className="primary-button" disabled={saving}>{saving ? 'Creando...' : 'Crear acceso'}</button>
              </footer>
            </form>
          </section>
        </div>
      )}
    </section>
  );
}

function moduleLabel(module: AuthModule) {
  if (module === 'traslado') return 'Guía 2';
  if (module === 'flexo') return 'Flexo';
  return 'FC';
}

function formatDate(value?: string) {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString('es-PE');
}
