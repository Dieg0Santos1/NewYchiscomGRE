import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { createApp } from '../app.js';
import { monthRange, type ReportesEspecialesService } from '../services/reportesEspecialesService.js';
import { testConfig } from './fixtures.js';

describe('reportes especiales', () => {
  it('calcula rango mensual con fin exclusivo', () => {
    expect(monthRange({ year: 2026, month: 7 })).toEqual({
      start: '2026-07-01 00:00:00',
      endExclusive: '2026-08-01 00:00:00'
    });
    expect(monthRange({ year: 2026, month: 12 })).toEqual({
      start: '2026-12-01 00:00:00',
      endExclusive: '2027-01-01 00:00:00'
    });
  });

  it('expone el rango del reporte', async () => {
    const app = createApp({ config: testConfig });

    await request(app)
      .get('/api/reportes-especiales/facturacion-mensual/range?year=2026&month=7')
      .expect(200)
      .expect((response) => {
        expect(response.body.start).toBe('2026-07-01 00:00:00');
        expect(response.body.endExclusive).toBe('2026-08-01 00:00:00');
      });
  });

  it('descarga archivo xls desde servicio inyectado', async () => {
    const service: ReportesEspecialesService = {
      exportFacturacionMensualExcel: vi.fn().mockResolvedValue({
        filename: 'reporte-especial-ventas-2026-07.xls',
        contentType: 'application/vnd.ms-excel; charset=utf-8',
        body: Buffer.from('excel-body', 'utf8')
      })
    };
    const app = createApp({ config: testConfig, reportesEspecialesService: service });

    await request(app)
      .get('/api/reportes-especiales/facturacion-mensual/export?year=2026&month=7')
      .expect(200)
      .expect('Content-Type', /application\/vnd\.ms-excel/)
      .expect('Content-Disposition', /reporte-especial-ventas-2026-07\.xls/)
      .expect((response) => {
        expect(response.text).toBe('excel-body');
      });

    expect(service.exportFacturacionMensualExcel).toHaveBeenCalledWith({ year: 2026, month: 7 });
  });

  it('muestra el error del servicio cuando falla la exportacion', async () => {
    const service: ReportesEspecialesService = {
      exportFacturacionMensualExcel: vi.fn().mockRejectedValue(new Error('SELECT permission denied'))
    };
    const app = createApp({ config: testConfig, reportesEspecialesService: service });

    await request(app)
      .get('/api/reportes-especiales/facturacion-mensual/export?year=2026&month=7')
      .expect(500)
      .expect((response) => {
        expect(response.body.error).toBe('REPORT_EXPORT_ERROR');
        expect(response.body.message).toBe('SELECT permission denied');
      });
  });
});
