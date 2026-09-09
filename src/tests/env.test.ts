import { describe, expect, it } from 'vitest';
import { loadEnv } from '../config/env.js';

describe('configuracion de acceso del portal', () => {
  it('impide publicar el frontend con la autenticacion deshabilitada', () => {
    expect(() => loadEnv({
      SERVE_FRONTEND: 'true',
      AUTH_ENABLED: 'false'
    })).toThrow(/portal no puede publicarse sin control de acceso/);
  });

  it('permite desarrollo separado sin autenticacion', () => {
    const config = loadEnv({
      SERVE_FRONTEND: 'false',
      AUTH_ENABLED: 'false'
    });

    expect(config.auth.enabled).toBe(false);
    expect(config.serveFrontend).toBe(false);
  });

  it('mantiene habilitado el flujo legacy FC aunque exista la bandera heredada apagada', () => {
    const config = loadEnv({
      SERVE_FRONTEND: 'false',
      AUTH_ENABLED: 'false',
      FC_LEGACY_WRITE_ENABLED: 'false'
    });

    expect(config.fcLegacyWriteEnabled).toBe(true);
  });
});
