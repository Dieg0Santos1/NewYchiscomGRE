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
  '/traslado/reportes'
]);

function readRoute() {
  const route = window.location.hash.replace(/^#/, '') || '/guias/nueva';
  return routes.has(route) ? route : '/guias/nueva';
}

function Shell() {
  const [route, setRoute] = useState(readRoute);

  useEffect(() => {
    const onHashChange = () => setRoute(readRoute());
    window.addEventListener('hashchange', onHashChange);

    if (!window.location.hash || !routes.has(readRoute())) {
      window.location.hash = '/guias/nueva';
    }

    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  const navigate = (nextRoute: string) => {
    if (routes.has(nextRoute)) {
      setRoute(nextRoute);
    }
  };

  return (
    <App route={route} onNavigate={navigate}>
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
        : route === '/facturas'
          ? <InvoicePage />
          : route === '/guias/listado'
            ? <GuideListPage />
            : <NewGuidePage />}
    </App>
  );
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
