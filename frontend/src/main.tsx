import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { FlexoGuidePage } from './pages/FlexoGuidePage';
import { FlexoInvoicePage } from './pages/FlexoInvoicePage';
import { FcLegacyWorkflowPage } from './pages/FcLegacyWorkflowPage';
import { GuideListPage } from './pages/GuideListPage';
import { InvoicePage } from './pages/InvoicePage';
import { NewGuidePage } from './pages/NewGuidePage';
import { SpecialReportsPage } from './pages/SpecialReportsPage';
import { TrasladoGuidePage } from './pages/TrasladoGuidePage';
import { TrasladoReportPage } from './pages/TrasladoReportPage';
import { LoginPage } from './pages/LoginPage';
import { AdminAccessPage } from './pages/AdminAccessPage';
import { authService } from './services/AuthService';
import type { AuthModule, AuthSessionResponse, AuthUser } from './types/auth';
import './styles.css';

const routes = new Set([
  '/fc/pre-guias',
  '/fc/guias-internas',
  '/guias/nueva',
  '/guias/listado',
  '/facturas',
  '/reportes/especiales',
  '/flexo/guias/nueva',
  '/flexo/facturas',
  '/flexo/reportes',
  '/traslado/guias/nueva',
  '/traslado/reportes',
  '/administracion/accesos'
]);

function readRoute() {
  const route = window.location.hash.replace(/^#/, '') || '/guias/nueva';
  return routes.has(route) ? route : '/guias/nueva';
}

function Shell() {
  const [route, setRoute] = useState(readRoute);
  const [session, setSession] = useState<AuthSessionResponse | null>();

  useEffect(() => {
    void authService.getSession()
      .then(setSession)
      .catch(() => setSession(null));

    const onExpired = () => setSession(null);
    window.addEventListener('gre-auth-expired', onExpired);
    return () => window.removeEventListener('gre-auth-expired', onExpired);
  }, []);

  useEffect(() => {
    if (!session) return;

    const syncRoute = () => {
      const requested = readRoute();
      const nextRoute = isRouteAllowed(requested, session.user)
        ? requested
        : defaultRoute(session.user.modules);
      setRoute(nextRoute);
      if (window.location.hash !== `#${nextRoute}`) window.location.hash = nextRoute;
    };
    const onHashChange = () => syncRoute();
    window.addEventListener('hashchange', onHashChange);
    syncRoute();

    return () => window.removeEventListener('hashchange', onHashChange);
  }, [session]);

  const navigate = (nextRoute: string) => {
    if (session && routes.has(nextRoute) && isRouteAllowed(nextRoute, session.user)) {
      setRoute(nextRoute);
      window.location.hash = nextRoute;
    }
  };

  if (session === undefined) {
    return <main className="login-screen"><div className="login-loading">Validando acceso...</div></main>;
  }

  if (session === null) {
    return <LoginPage onAuthenticated={setSession} />;
  }

  const logout = async () => {
    await authService.logout().catch(() => undefined);
    setSession(null);
  };

  return (
    <App route={route} onNavigate={navigate} user={session.user} onLogout={() => void logout()}>
      {route === '/fc/pre-guias'
        ? <FcLegacyWorkflowPage mode="pre-guide" />
        : route === '/fc/guias-internas'
          ? <FcLegacyWorkflowPage mode="internal-guide" />
          : route === '/flexo/guias/nueva'
            ? <FlexoGuidePage />
        : route === '/flexo/facturas'
          ? <FlexoInvoicePage />
          : route === '/flexo/reportes'
            ? <FlexoPlaceholder title="Reportes Flexo" />
            : route === '/traslado/guias/nueva'
              ? <TrasladoGuidePage />
              : route === '/traslado/reportes'
                ? <TrasladoReportPage />
            : route === '/reportes/especiales'
        ? <SpecialReportsPage />
        : route === '/administracion/accesos'
          ? <AdminAccessPage />
        : route === '/facturas'
          ? <InvoicePage />
          : route === '/guias/listado'
            ? <GuideListPage />
            : <NewGuidePage />}
    </App>
  );
}

function moduleForRoute(route: string): AuthModule {
  if (route.startsWith('/traslado')) return 'traslado';
  if (route.startsWith('/flexo')) return 'flexo';
  return 'fc';
}

function isRouteAllowed(route: string, user: AuthUser) {
  if (route === '/administracion/accesos') return user.administrator;
  return routes.has(route) && user.modules.includes(moduleForRoute(route));
}

function defaultRoute(modules: AuthModule[]) {
  if (modules.includes('fc')) return '/guias/nueva';
  if (modules.includes('flexo')) return '/flexo/guias/nueva';
  return '/traslado/guias/nueva';
}

function FlexoPlaceholder({ title }: { title: string }) {
  return (
    <section className="screen-panel placeholder-screen">
      <h1>{title}</h1>
      <p>Modulo en preparacion.</p>
    </section>
  );
}

createRoot(document.getElementById('root') as HTMLElement).render(
  <StrictMode>
    <Shell />
  </StrictMode>
);
