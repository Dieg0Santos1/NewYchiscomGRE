import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getGreDefaults } from '../config/greDefaults.js';
import { mapGreInputToPayload } from '../mappers/grePayloadMapper.js';
import {
  executePreparedGreProceduresForActivation,
  normalizePublicTransportHeaderForSunat
} from '../services/greTrasladoService.js';
import { testConfig, validGreInput } from './fixtures.js';

type SqlCall =
  | { type: 'execute'; procedureName: string }
  | { type: 'query'; sqlText: string };

const calls: SqlCall[] = [];

vi.mock('../integrations/bizlinksSql.js', () => {
  class Request {
    input() {
      return this;
    }

    execute(procedureName: string) {
      calls.push({ type: 'execute', procedureName });
      return Promise.resolve();
    }

    query(sqlText: string) {
      calls.push({ type: 'query', sqlText });

      if (sqlText.includes('SELECT *') && sqlText.includes('SPE_DESPATCH')) {
        const envioExecuted = calls.some((call) => call.type === 'execute' && call.procedureName === 'dbo.USP_EnvioGuia');

        return Promise.resolve({
          recordset: [
            {
              bl_estadoRegistro: envioExecuted ? 'A' : 'N'
            }
          ]
        });
      }

      if (sqlText.includes('AS itemCount')) {
        return Promise.resolve({
          recordset: [
            {
              itemCount: 1,
              auxCount: 0,
              responseCount: 0
            }
          ]
        });
      }

      return Promise.resolve({ recordset: [] });
    }
  }

  class Transaction {}
  class ConnectionPool {}

  return {
    createBizlinksPool: vi.fn(),
    createGreFcPool: vi.fn(),
    sql: {
      Request,
      Transaction,
      ConnectionPool,
      NVarChar: vi.fn((length?: number) => ({ type: 'NVarChar', length })),
      VarChar: vi.fn((length?: number) => ({ type: 'VarChar', length })),
      BigInt: 'BigInt',
      Decimal: vi.fn(),
      Int: 'Int',
      UniqueIdentifier: 'UniqueIdentifier',
      MAX: 'MAX',
      ISOLATION_LEVEL: {
        SERIALIZABLE: 'SERIALIZABLE'
      }
    }
  };
});

describe('GreTrasladoService public transport normalization', () => {
  beforeEach(() => {
    calls.length = 0;
  });

  it('normaliza solo fecha de entrega publica despues de cabecera/detalle y antes de USP_EnvioGuia', async () => {
    const payload = mapGreInputToPayload({
      ...validGreInput,
      fechaEntregaBienes: '2026-09-09',
      traslado: {
        ...validGreInput.traslado,
        modalidadTraslado: '01',
        codigoPtoLlegada: ''
      },
      conductor: undefined,
      vehiculo: undefined,
      transportista: {
        tipoDocumentoTransportista: '6',
        numeroRucTransportista: '20555555555',
        razonSocialTransportista: 'TRANSPORTES PRUEBA S.A.C.'
      }
    }, getGreDefaults(testConfig));

    await executePreparedGreProceduresForActivation({} as never, payload);

    const cabeceraIndex = calls.findIndex((call) => call.type === 'execute' && call.procedureName === 'dbo.USP_CabeceraGuia');
    const detalleIndex = calls.findIndex((call) => call.type === 'execute' && call.procedureName === 'dbo.USP_DetalleGuia');
    const normalizationIndex = calls.findIndex((call) => call.type === 'query' && call.sqlText.includes('fechaEntregaBienes = CASE'));
    const envioIndex = calls.findIndex((call) => call.type === 'execute' && call.procedureName === 'dbo.USP_EnvioGuia');

    expect(cabeceraIndex).toBeGreaterThanOrEqual(0);
    expect(detalleIndex).toBeGreaterThan(cabeceraIndex);
    expect(normalizationIndex).toBeGreaterThan(detalleIndex);
    expect(envioIndex).toBeGreaterThan(normalizationIndex);
    const normalizationSql = calls[normalizationIndex]?.type === 'query' ? calls[normalizationIndex].sqlText : '';
    expect(normalizationSql).toContain('fechaEntregaBienes = CASE');
    expect(normalizationSql).not.toContain('fechaInicioTraslado = CASE');
    expect(normalizationSql).not.toContain('codigoPtollegada = CASE');
  });

  it('no actualiza columnas de cabecera cuando la modalidad es privada', async () => {
    const payload = mapGreInputToPayload(validGreInput, getGreDefaults(testConfig));

    await normalizePublicTransportHeaderForSunat({} as never, payload);

    expect(calls).toEqual([]);
  });
});
