import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { createApp } from '../app.js';
import { testConfig, validGreInput } from './fixtures.js';

const operationId = '11111111-1111-4111-8111-111111111111';

describe('POST /api/gre-formularios/declarar-test', () => {
  it('GET /api/catalogos/destinos/:numeroDocumento usa el cliente inyectado', async () => {
    const getDestinos = vi.fn().mockResolvedValue([
      {
        id: '10406265574-150101-1-AV. TOMAS VALLE 917 DPTO. T-404',
        codigoDestino: '1',
        ubigeo: '150101',
        direccion: 'AV. TOMAS VALLE 917 DPTO. T-404',
        textoOriginal: '150101-AV. TOMAS VALLE 917 DPTO. T-404'
      }
    ]);
    const app = createApp({
      config: testConfig,
      existingGreClient: {
        declareGre: vi.fn(),
        getDestinos
      }
    });

    await request(app)
      .get('/api/catalogos/destinos/10406265574')
      .expect(200)
      .expect((response) => {
        expect(response.body.ok).toBe(true);
        expect(response.body.numeroDocumento).toBe('10406265574');
        expect(response.body.destinos[0].ubigeo).toBe('150101');
      });

    expect(getDestinos).toHaveBeenCalledWith('10406265574');
  });

  it('genera preview sin llamar al servicio de declaracion', async () => {
    const declarar = vi.fn();
    const app = createApp({
      config: { ...testConfig, dryRun: true, directDbInsertEnabled: false },
      greFormularioDeclararTestService: { declarar }
    });

    await request(app)
      .post('/api/gre-formularios/preview')
      .send(validGreInput)
      .expect(200)
      .expect((response) => {
        expect(response.body.ok).toBe(true);
        expect(response.body.writesDatabase).toBe(false);
        expect(response.body.payload.serieNumeroGuia).toBe(validGreInput.serieNumeroGuia);
        expect(response.body.procedurePlan.USP_CabeceraGuia).toBeInstanceOf(Array);
      });

    expect(declarar).not.toHaveBeenCalled();
  });

  it('bloquea escritura directa cuando DRY_RUN=true', async () => {
    const declarar = vi.fn();
    const app = createApp({
      config: { ...testConfig, dryRun: true, directDbInsertEnabled: true },
      greFormularioDeclararTestService: { declarar }
    });

    await request(app)
      .post('/api/gre-formularios/declarar-test')
      .set('X-Confirm-Send', 'YES')
      .send(validGreInput)
      .expect(403)
      .expect((response) => {
        expect(response.body.error).toBe('SEND_DISABLED_DRY_RUN');
      });

    expect(declarar).not.toHaveBeenCalled();
  });

  it('bloquea escritura directa si GRE_DIRECT_DB_INSERT_ENABLED=false', async () => {
    const declarar = vi.fn();
    const app = createApp({
      config: { ...testConfig, dryRun: false, directDbInsertEnabled: false },
      greFormularioDeclararTestService: { declarar }
    });

    await request(app)
      .post('/api/gre-formularios/declarar-test')
      .set('X-Confirm-Send', 'YES')
      .send(validGreInput)
      .expect(403)
      .expect((response) => {
        expect(response.body.error).toBe('DIRECT_DB_INSERT_DISABLED');
      });

    expect(declarar).not.toHaveBeenCalled();
  });

  it('requiere X-Confirm-Send YES', async () => {
    const declarar = vi.fn();
    const app = createApp({
      config: { ...testConfig, dryRun: false, directDbInsertEnabled: true },
      greFormularioDeclararTestService: { declarar }
    });

    await request(app)
      .post('/api/gre-formularios/declarar-test')
      .send(validGreInput)
      .expect(403)
      .expect((response) => {
        expect(response.body.error).toBe('SEND_CONFIRMATION_REQUIRED');
      });

    expect(declarar).not.toHaveBeenCalled();
  });

  it('acepta T999 como serie de prueba controlada', async () => {
    const declarar = vi.fn();
    const app = createApp({
      config: { ...testConfig, dryRun: false, directDbInsertEnabled: true },
      greFormularioDeclararTestService: { declarar }
    });

    await request(app)
      .post('/api/gre-formularios/declarar-test')
      .set('X-Confirm-Send', 'YES')
      .set('X-Operation-Id', operationId)
      .send({ ...validGreInput, serieNumeroGuia: 'T999-00000001' })
      .expect(200);

    expect(declarar).toHaveBeenCalledTimes(1);
  });

  it('rechaza series distintas a T001 o T999', async () => {
    const declarar = vi.fn();
    const app = createApp({
      config: { ...testConfig, dryRun: false, directDbInsertEnabled: true },
      greFormularioDeclararTestService: { declarar }
    });

    await request(app)
      .post('/api/gre-formularios/declarar-test')
      .set('X-Confirm-Send', 'YES')
      .set('X-Operation-Id', operationId)
      .send({ ...validGreInput, serieNumeroGuia: 'T003-00000001' })
      .expect(400)
      .expect((response) => {
        expect(response.body.error).toBe('VALIDATION_ERROR');
      });

    expect(declarar).not.toHaveBeenCalled();
  });

  it('requiere X-Operation-Id UUID para idempotencia', async () => {
    const declarar = vi.fn();
    const app = createApp({
      config: { ...testConfig, dryRun: false, directDbInsertEnabled: true },
      greFormularioDeclararTestService: { declarar }
    });

    await request(app)
      .post('/api/gre-formularios/declarar-test')
      .set('X-Confirm-Send', 'YES')
      .send(validGreInput)
      .expect(400)
      .expect((response) => {
        expect(response.body.error).toBe('OPERATION_ID_REQUIRED');
      });

    expect(declarar).not.toHaveBeenCalled();
  });

  it('con todos los candados habilitados usa solo el servicio inyectado', async () => {
    const declarar = vi.fn().mockResolvedValue({
      operationId,
      generatedSerieNumeroGuia: 'T001-00000096',
      insertedHeader: true,
      insertedItems: 1,
      activated: true,
      status: {
        serieNumeroGuia: 'T001-00000096',
        bl_estadoRegistro: 'A'
      }
    });
    const app = createApp({
      config: { ...testConfig, dryRun: false, directDbInsertEnabled: true },
      greFormularioDeclararTestService: { declarar }
    });

    await request(app)
      .post('/api/gre-formularios/declarar-test')
      .set('X-Confirm-Send', 'YES')
      .set('X-Operation-Id', operationId)
      .set('X-User', 'qa-formularios')
      .send(validGreInput)
      .expect(200)
      .expect((response) => {
        expect(response.body.ok).toBe(true);
        expect(response.body.generatedSerieNumeroGuia).toBe('T001-00000096');
        expect(response.body.insertedItems).toBe(1);
        expect(response.body.activated).toBe(true);
      });

    expect(declarar).toHaveBeenCalledTimes(1);
    expect(declarar).toHaveBeenCalledWith(validGreInput, {
      operationId,
      user: 'qa-formularios'
    });
  });
});

describe('POST /api/gre-formularios/guides/:serieNumeroGuia/manual-sunat-accepted', () => {
  it('bloquea la actualizacion manual cuando DRY_RUN=true', async () => {
    const setAcceptedMessage = vi.fn();
    const app = createApp({
      config: { ...testConfig, dryRun: true, directDbInsertEnabled: true },
      greFormularioManualSunatService: { setAcceptedMessage }
    });

    await request(app)
      .post('/api/gre-formularios/guides/T999-00000099/manual-sunat-accepted')
      .set('X-Confirm-Manual-Sunat', 'YES')
      .expect(403)
      .expect((response) => {
        expect(response.body.error).toBe('MANUAL_SUNAT_DISABLED_DRY_RUN');
      });

    expect(setAcceptedMessage).not.toHaveBeenCalled();
  });

  it('requiere confirmacion interna del frontend', async () => {
    const setAcceptedMessage = vi.fn();
    const app = createApp({
      config: { ...testConfig, dryRun: false, directDbInsertEnabled: true },
      greFormularioManualSunatService: { setAcceptedMessage }
    });

    await request(app)
      .post('/api/gre-formularios/guides/T999-00000099/manual-sunat-accepted')
      .expect(403)
      .expect((response) => {
        expect(response.body.error).toBe('MANUAL_SUNAT_CONFIRMATION_REQUIRED');
      });

    expect(setAcceptedMessage).not.toHaveBeenCalled();
  });

  it('con candados abiertos delega al servicio manual sin tocar otros servicios', async () => {
    const setAcceptedMessage = vi.fn().mockResolvedValue({
      operationId,
      serieNumeroGuia: 'T999-00000099',
      reused: false,
      updated: true,
      message: '{"codigo":"0","mensaje":"El Comprobante numero T999-00000099, ha sido aceptado"}',
      before: {
        serieNumeroGuia: 'T999-00000099',
        bl_estadoRegistro: 'L',
        bl_estadoProceso: 'SIGNED/ED_06',
        process_state: '_2_CONSULT',
        bl_mensajeSunat: null
      },
      after: {
        serieNumeroGuia: 'T999-00000099',
        bl_estadoRegistro: 'L',
        bl_estadoProceso: 'SIGNED/ED_06',
        process_state: '_2_CONSULT',
        bl_mensajeSunat: '{"codigo":"0","mensaje":"El Comprobante numero T999-00000099, ha sido aceptado"}'
      }
    });
    const app = createApp({
      config: { ...testConfig, dryRun: false, directDbInsertEnabled: true },
      greFormularioManualSunatService: { setAcceptedMessage }
    });

    await request(app)
      .post('/api/gre-formularios/guides/T999-00000099/manual-sunat-accepted')
      .set('X-Confirm-Manual-Sunat', 'YES')
      .set('X-User', 'qa-formularios')
      .expect(200)
      .expect((response) => {
        expect(response.body.ok).toBe(true);
        expect(response.body.updated).toBe(true);
        expect(response.body.serieNumeroGuia).toBe('T999-00000099');
      });

    expect(setAcceptedMessage).toHaveBeenCalledWith('T999-00000099', {
      user: 'qa-formularios'
    });
  });
});

describe('POST /api/gre-formularios/guides/:serieNumeroGuia/release-ots', () => {
  it('bloquea la liberacion de OT cuando DRY_RUN=true', async () => {
    const releaseWorkOrders = vi.fn();
    const app = createApp({
      config: { ...testConfig, dryRun: true, directDbInsertEnabled: true },
      greFormularioReleaseOtService: { releaseWorkOrders }
    });

    await request(app)
      .post('/api/gre-formularios/guides/T999-00000099/release-ots')
      .set('X-Confirm-Release-OT', 'YES')
      .expect(403)
      .expect((response) => {
        expect(response.body.error).toBe('RELEASE_OT_DISABLED_DRY_RUN');
      });

    expect(releaseWorkOrders).not.toHaveBeenCalled();
  });

  it('requiere confirmacion interna del frontend para liberar OT', async () => {
    const releaseWorkOrders = vi.fn();
    const app = createApp({
      config: { ...testConfig, dryRun: false, directDbInsertEnabled: true },
      greFormularioReleaseOtService: { releaseWorkOrders }
    });

    await request(app)
      .post('/api/gre-formularios/guides/T999-00000099/release-ots')
      .expect(403)
      .expect((response) => {
        expect(response.body.error).toBe('RELEASE_OT_CONFIRMATION_REQUIRED');
      });

    expect(releaseWorkOrders).not.toHaveBeenCalled();
  });

  it('con candados abiertos delega al servicio de liberacion sin tocar otros servicios', async () => {
    const releaseWorkOrders = vi.fn().mockResolvedValue({
      operationId,
      serieNumeroGuia: 'T999-00000099',
      reused: false,
      updated: true,
      affectedRows: 2,
      idsOT: [95376, 95377],
      before: [
        { idOT: 95376, estadoGuia: 'S' },
        { idOT: 95377, estadoGuia: 'S' }
      ],
      after: [
        { idOT: 95376, estadoGuia: 'N' },
        { idOT: 95377, estadoGuia: 'N' }
      ]
    });
    const app = createApp({
      config: { ...testConfig, dryRun: false, directDbInsertEnabled: true },
      greFormularioReleaseOtService: { releaseWorkOrders }
    });

    await request(app)
      .post('/api/gre-formularios/guides/T999-00000099/release-ots')
      .set('X-Confirm-Release-OT', 'YES')
      .set('X-User', 'qa-formularios')
      .expect(200)
      .expect((response) => {
        expect(response.body.ok).toBe(true);
        expect(response.body.updated).toBe(true);
        expect(response.body.affectedRows).toBe(2);
      });

    expect(releaseWorkOrders).toHaveBeenCalledWith('T999-00000099', {
      user: 'qa-formularios'
    });
  });
});
