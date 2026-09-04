import { FormEvent, useState } from 'react';
import { LogIn } from 'lucide-react';
import { authService } from '../services/AuthService';
import type { AuthSessionResponse } from '../types/auth';

type LoginPageProps = {
  onAuthenticated: (session: AuthSessionResponse) => void;
};

export function LoginPage({ onAuthenticated }: LoginPageProps) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setMessage('');

    try {
      const session = await authService.login(username, password);
      onAuthenticated(session);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'No se pudo iniciar sesion.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="login-screen">
      <section className="login-card">
        <div className="login-brand">Ychiformas</div>
        <h1>Acceso al sistema</h1>
        <p>Ingrese con la cuenta asignada para operar sus módulos autorizados.</p>
        <form onSubmit={submit}>
          <label>
            Usuario
            <input
              autoComplete="username"
              autoFocus
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              required
            />
          </label>
          <label>
            Contraseña
            <input
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              required
            />
          </label>
          {message && <div className="login-error" role="alert">{message}</div>}
          <button type="submit" disabled={loading}>
            <LogIn size={18} />
            {loading ? 'Ingresando...' : 'Ingresar'}
          </button>
        </form>
      </section>
    </main>
  );
}
