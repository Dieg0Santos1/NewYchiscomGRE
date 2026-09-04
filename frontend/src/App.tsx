import type { ReactNode } from 'react';
import { ShieldCheck } from 'lucide-react';
import type { AuthModule, AuthUser } from './types/auth';

type AppProps = {
  route: string;
  onNavigate: (route: string) => void;
  children: ReactNode;
  user: AuthUser;
  onLogout: () => void;
};

export default function App({ route, onNavigate, children, user, onLogout }: AppProps) {
  const isActive = (target: string) => (route === target ? 'active' : undefined);
  const isAdminRoute = route === '/administracion/accesos';
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

  const switchModule = (nextModule: AuthModule) => {
    if (nextModule === module && !isAdminRoute) return;
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
      <header className={`topbar topbar-${isAdminRoute ? 'admin' : module}`}>
        <div className="topbar-main">
          {user.administrator && (
            <button
              type="button"
              className={`admin-panel-link${isAdminRoute ? ' active' : ''}`}
              onClick={() => onNavigate('/administracion/accesos')}
            >
              <ShieldCheck size={17} /> Administración
            </button>
          )}
          <div className="topbar-title">Ychiformas - Facturacion</div>
          <div className="topbar-account">
            <div className="module-switch" aria-label="Módulo">
              {user.modules.includes('fc') && <button type="button" className={!isAdminRoute && module === 'fc' ? 'active' : ''} onClick={() => switchModule('fc')}>FC</button>}
              {user.modules.includes('flexo') && <button type="button" className={module === 'flexo' ? 'active' : ''} onClick={() => switchModule('flexo')}>Flexo</button>}
              {user.modules.includes('traslado') && <button type="button" className={module === 'traslado' ? 'active' : ''} onClick={() => switchModule('traslado')}>Guía 2</button>}
            </div>
            <span className="session-user">{user.displayName}</span>
          </div>
        </div>
        <nav className="topbar-nav" aria-label="Principal">
          {isAdminRoute ? (
            <a className="active" href="#/administracion/accesos" onClick={() => onNavigate('/administracion/accesos')}>Accesos</a>
          ) : module === 'fc' && (
            <>
              <a className={isActive('/fc/pre-guias')} href="#/fc/pre-guias" onClick={() => onNavigate('/fc/pre-guias')}>
                Pre-guias
              </a>
              <a className={isActive('/fc/guias-internas')} href="#/fc/guias-internas" onClick={() => onNavigate('/fc/guias-internas')}>
                Guias internas
              </a>
            </>
          )}
          {!isAdminRoute && <a
              className={isActive(routes.guias)}
              href={`#${routes.guias}`}
              onClick={() => onNavigate(routes.guias)}
            >
              {module === 'fc' ? 'GRE' : 'Guias'}
            </a>}
          {!isAdminRoute && module !== 'traslado' && (
            <a
              className={isActive(routes.facturas)}
              href={`#${routes.facturas}`}
              onClick={() => onNavigate(routes.facturas)}
            >
              Facturas
            </a>
          )}
          {!isAdminRoute && <a
            className={isActive(routes.reportes)}
            href={`#${routes.reportes}`}
            onClick={() => onNavigate(routes.reportes)}
          >
            Reportes
          </a>}
          {!isAdminRoute && module === 'fc' && (
            <a
              className={isActive(routes.especiales)}
              href={`#${routes.especiales}`}
              onClick={() => onNavigate(routes.especiales)}
            >
              Especiales
            </a>
          )}
          <button type="button" className="logout-button" onClick={onLogout}>Salir</button>
        </nav>
      </header>
      <main className="page">
        {children}
      </main>
    </div>
  );
}
