import type { ReactNode } from 'react';

type AppProps = {
  route: string;
  onNavigate: (route: string) => void;
  children: ReactNode;
};

export default function App({ route, onNavigate, children }: AppProps) {
  const isActive = (target: string) => (route === target ? 'active' : undefined);
  const module = route.startsWith('/flexo') ? 'flexo' : route.startsWith('/traslado') ? 'traslado' : 'fc';
  const routes = module === 'flexo'
    ? {
        guias: '/flexo/guias/nueva',
        facturas: '/flexo/facturas',
        reportes: '/flexo/reportes',
        especiales: '/reportes/especiales'
      }
    : module === 'traslado'
    ? {
        guias: '/traslado/guias/nueva',
        facturas: '/traslado/facturas',
        reportes: '/traslado/reportes',
        especiales: '/reportes/especiales'
      }
    : {
        guias: '/guias/nueva',
        facturas: '/facturas',
        reportes: '/guias/listado',
        especiales: '/reportes/especiales'
      };

  const switchModule = (nextModule: 'fc' | 'flexo' | 'traslado') => {
    if (nextModule === module) return;
    onNavigate(
      nextModule === 'flexo'
        ? '/flexo/guias/nueva'
        : nextModule === 'traslado'
          ? '/traslado/guias/nueva'
          : '/guias/nueva'
    );
  };

  return (
    <div className="app-shell">
      <header className={`topbar topbar-${module}`}>
        <div className="topbar-main">
          <div className="topbar-title">Ychiformas - Facturacion</div>
          <div className="module-switch" aria-label="Rubro">
            <button type="button" className={module === 'fc' ? 'active' : ''} onClick={() => switchModule('fc')}>FC</button>
            <button type="button" className={module === 'flexo' ? 'active' : ''} onClick={() => switchModule('flexo')}>Flexo</button>
            <button type="button" className={module === 'traslado' ? 'active' : ''} onClick={() => switchModule('traslado')}>Traslado</button>
          </div>
        </div>
        <nav className="topbar-nav" aria-label="Principal">
          {module === 'fc' && (
            <>
              <a className={isActive('/fc/pre-guias')} href="#/fc/pre-guias" onClick={() => onNavigate('/fc/pre-guias')}>
                Pre-guias
              </a>
              <a className={isActive('/fc/guias-internas')} href="#/fc/guias-internas" onClick={() => onNavigate('/fc/guias-internas')}>
                Guias internas
              </a>
            </>
          )}
          <a
            className={isActive(routes.guias)}
            href={`#${routes.guias}`}
            onClick={() => onNavigate(routes.guias)}
          >
            {module === 'fc' ? 'GRE' : 'Guias'}
          </a>
          {module !== 'traslado' && (
            <a
              className={isActive(routes.facturas)}
              href={`#${routes.facturas}`}
              onClick={() => onNavigate(routes.facturas)}
            >
              Facturas
            </a>
          )}
          <a
            className={isActive(routes.reportes)}
            href={`#${routes.reportes}`}
            onClick={() => onNavigate(routes.reportes)}
          >
            Reportes
          </a>
          {module === 'fc' && (
            <a
              className={isActive(routes.especiales)}
              href={`#${routes.especiales}`}
              onClick={() => onNavigate(routes.especiales)}
            >
              Especiales
            </a>
          )}
          <a aria-disabled="true">Salir</a>
        </nav>
      </header>
      <main className="page">
        {children}
      </main>
    </div>
  );
}
