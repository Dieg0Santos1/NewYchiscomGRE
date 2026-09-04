import type { AppConfig } from '../config/env.js';
import { createBizlinksPool, sql } from '../integrations/bizlinksSql.js';

export type FlexoCliente = {
  id: string;
  tipoDocumento: string;
  numeroDocumento: string;
  razonSocial: string;
  ultimoEmpaque: string | null;
};

export type FlexoDestino = {
  id: string;
  ubigeo: string;
  direccion: string;
};

export type FlexoEmpaqueItem = {
  id: string;
  codigoEmpaque: number;
  codigoProducto: string;
  descripcion: string;
  cantidad: number;
  unidadMedida: string;
};

export type FlexoEmpaque = {
  id: string;
  codigoEmpaque: number;
  ticket: string;
  ordenCompra: string;
  fechaCreacion: string | null;
  destino: FlexoDestino;
  items: FlexoEmpaqueItem[];
};

export type FlexoGuideSerie = 'T003' | 'T999';

export type FlexoNextSerie = {
  serie: FlexoGuideSerie;
  numero: string;
  serieNumeroGuia: string;
  reserved: false;
  source: 'BIZLINKS_SPE_DESPATCH';
};

export type FlexoGuidePreviewInput = {
  serieNumeroGuia: string;
  fechaEmision: string;
  fechaTraslado: string;
  cliente: {
    tipoDocumento: string;
    numeroDocumento: string;
    razonSocial: string;
  };
  destino: FlexoDestino;
  modalidadTraslado: string;
  motivoTraslado: string;
  descripcionMotivoTraslado: string;
  pesoBruto: number;
  unidadPeso: string;
  numeroBultos: number;
  ordenCompra: string;
  observaciones: string;
  conductor: {
    tipoDocumento: string;
    numeroDocumento: string;
    nombres: string;
    apellidos: string;
    licencia: string;
    placa: string;
  };
  empaques: FlexoEmpaque[];
};

export type FlexoValidation = {
  code: string;
  severity: 'ok' | 'warning' | 'error';
  message: string;
};

export interface FlexoService {
  searchClientes(query: string): Promise<FlexoCliente[]>;
  listDestinos(numeroDocumento: string): Promise<FlexoDestino[]>;
  listEmpaques(params: {
    numeroDocumento: string;
    desde: string;
    hasta: string;
    filtro: string;
  }): Promise<FlexoEmpaque[]>;
  getNextSerie(serie?: FlexoGuideSerie): Promise<FlexoNextSerie>;
  previewGuia(input: FlexoGuidePreviewInput): Promise<{
    writesDatabase: false;
    productionEnabled: false;
    serieNumeroGuia: string;
    validations: FlexoValidation[];
    payload: FlexoGuidePreviewInput;
  }>;
}

type ClienteRow = {
  NUMERODOCUMENTOADQUIRIENTE: string | null;
  RAZONSOCIALADQUIRIENTE: string | null;
  ultimoEmpaque: Date | null;
};

type DestinoRow = {
  UBIGEOPTOLLEGADA: string | null;
  DIRECCIONPTOLLEGADA: string | null;
};

type EmpaqueRow = {
  CODIGOEMPAQUE: number;
  TICKETNUM: string | null;
  ORDENCOMPRA: string | null;
  FECHACREACION: Date | null;
  UBIGEOPTOLLEGADA: string | null;
  DIRECCIONPTOLLEGADA: string | null;
  CODIGOPRODUCTO: string | null;
  DESCRIPCION: string | null;
  CANTIDAD: number | string | null;
  UNIDADMEDIDA: string | null;
};

export class DirectDbFlexoService implements FlexoService {
  constructor(private readonly config: AppConfig) {}

  async searchClientes(query: string) {
    const normalized = query.trim();
    if (normalized.length < 2) return [];

    const pool = createBizlinksPool(this.config);
    await pool.connect();

    try {
      const request = new sql.Request(pool);
      request.input('query', sql.NVarChar(120), `%${normalized}%`);

      const result = await request.query<ClienteRow>(`
        SELECT TOP (50)
          NUMERODOCUMENTOADQUIRIENTE,
          RAZONSOCIALADQUIRIENTE,
          MAX(FECHACREACION) AS ultimoEmpaque
        FROM dbo.EMPAQUE
        WHERE ISNULL(NUMERODOCUMENTOADQUIRIENTE, '') <> ''
          AND ISNULL(RAZONSOCIALADQUIRIENTE, '') <> ''
          AND (
            NUMERODOCUMENTOADQUIRIENTE LIKE @query
            OR RAZONSOCIALADQUIRIENTE LIKE @query
          )
        GROUP BY NUMERODOCUMENTOADQUIRIENTE, RAZONSOCIALADQUIRIENTE
        ORDER BY MAX(FECHACREACION) DESC
      `);

      return result.recordset.map((row) => ({
        id: `6-${row.NUMERODOCUMENTOADQUIRIENTE?.trim() ?? ''}`,
        tipoDocumento: '6',
        numeroDocumento: row.NUMERODOCUMENTOADQUIRIENTE?.trim() ?? '',
        razonSocial: row.RAZONSOCIALADQUIRIENTE?.trim() ?? '',
        ultimoEmpaque: row.ultimoEmpaque ? row.ultimoEmpaque.toISOString() : null
      }));
    } finally {
      await pool.close();
    }
  }

  async listDestinos(numeroDocumento: string) {
    const normalized = numeroDocumento.trim();
    if (!normalized) return [];

    const pool = createBizlinksPool(this.config);
    await pool.connect();

    try {
      const request = new sql.Request(pool);
      request.input('numeroDocumento', sql.VarChar(20), normalized);

      const result = await request.query<DestinoRow>(`
        SELECT TOP (50)
          UBIGEOPTOLLEGADA,
          DIRECCIONPTOLLEGADA
        FROM dbo.EMPAQUE
        WHERE NUMERODOCUMENTOADQUIRIENTE = @numeroDocumento
          AND ISNULL(UBIGEOPTOLLEGADA, '') <> ''
          AND ISNULL(DIRECCIONPTOLLEGADA, '') <> ''
        GROUP BY UBIGEOPTOLLEGADA, DIRECCIONPTOLLEGADA
        ORDER BY MAX(FECHACREACION) DESC
      `);

      return result.recordset.map((row, index) => ({
        id: `${row.UBIGEOPTOLLEGADA?.trim() ?? 'SINUBIGEO'}-${index}`,
        ubigeo: row.UBIGEOPTOLLEGADA?.trim() ?? '',
        direccion: row.DIRECCIONPTOLLEGADA?.trim() ?? ''
      }));
    } finally {
      await pool.close();
    }
  }

  async listEmpaques(params: { numeroDocumento: string; desde: string; hasta: string; filtro: string }) {
    const normalizedDocument = params.numeroDocumento.trim();
    if (!normalizedDocument) return [];

    const pool = createBizlinksPool(this.config);
    await pool.connect();

    try {
      const request = new sql.Request(pool);
      request.input('numeroDocumento', sql.VarChar(20), normalizedDocument);
      request.input('desde', sql.VarChar(19), `${params.desde} 00:00:00`);
      request.input('hasta', sql.VarChar(19), `${params.hasta} 00:00:00`);
      request.input('filtro', sql.NVarChar(200), `%${params.filtro.trim()}%`);

      const filterClause = params.filtro.trim()
        ? `AND (
            CONVERT(varchar(20), e.CODIGOEMPAQUE) LIKE @filtro
            OR e.TICKETNUM LIKE @filtro
            OR e.ORDENCOMPRA LIKE @filtro
            OR d.CODIGOPRODUCTO LIKE @filtro
            OR d.DESCRIPCION LIKE @filtro
          )`
        : '';

      const result = await request.query<EmpaqueRow>(`
        SELECT TOP (500)
          e.CODIGOEMPAQUE,
          e.TICKETNUM,
          e.ORDENCOMPRA,
          e.FECHACREACION,
          e.UBIGEOPTOLLEGADA,
          e.DIRECCIONPTOLLEGADA,
          d.CODIGOPRODUCTO,
          d.DESCRIPCION,
          d.CANTIDAD,
          d.UNIDADMEDIDA
        FROM dbo.EMPAQUE e
        INNER JOIN dbo.EMPAQUE_DETALLE d
          ON d.CODIGOEMPAQUE = e.CODIGOEMPAQUE
        WHERE e.NUMERODOCUMENTOADQUIRIENTE = @numeroDocumento
          AND e.FECHACREACION >= CONVERT(datetime, @desde, 120)
          AND e.FECHACREACION < DATEADD(day, 1, CONVERT(datetime, @hasta, 120))
          AND d.SERIENUMEROGUIAREMISION IS NULL
          AND d.SERIENUMEROGUIAFACTURA IS NULL
          ${filterClause}
        ORDER BY e.FECHACREACION DESC, e.CODIGOEMPAQUE DESC, d.CODIGOPRODUCTO
      `);

      return groupEmpaques(result.recordset);
    } finally {
      await pool.close();
    }
  }

  async getNextSerie(serie: FlexoGuideSerie = 'T003') {
    const pool = createBizlinksPool(this.config);
    await pool.connect();

    try {
      const request = new sql.Request(pool);
      request.input('seriePrefix', sql.VarChar(8), `${serie}-%`);

      const result = await request.query<{ nextNumber: number }>(`
        SELECT ISNULL(MAX(
          CASE
            WHEN ISNUMERIC(RIGHT(serieNumeroGuia, 8)) = 1 THEN CONVERT(int, RIGHT(serieNumeroGuia, 8))
            ELSE NULL
          END
        ), 0) + 1 AS nextNumber
        FROM dbo.SPE_DESPATCH
        WHERE serieNumeroGuia LIKE @seriePrefix
          AND tipoDocumentoGuia = '09'
      `);
      const numero = String(result.recordset[0]?.nextNumber ?? 1).padStart(8, '0');

      return {
        serie,
        numero,
        serieNumeroGuia: `${serie}-${numero}`,
        reserved: false as const,
        source: 'BIZLINKS_SPE_DESPATCH' as const
      };
    } finally {
      await pool.close();
    }
  }

  async previewGuia(input: FlexoGuidePreviewInput) {
    return {
      writesDatabase: false as const,
      productionEnabled: false as const,
      serieNumeroGuia: input.serieNumeroGuia,
      validations: validateFlexoPreview(input),
      payload: input
    };
  }
}

function groupEmpaques(rows: EmpaqueRow[]) {
  const empaques = new Map<number, FlexoEmpaque>();

  for (const row of rows) {
    const codigoEmpaque = Number(row.CODIGOEMPAQUE);
    const empaque = empaques.get(codigoEmpaque) ?? {
      id: String(codigoEmpaque),
      codigoEmpaque,
      ticket: row.TICKETNUM?.trim() ?? '',
      ordenCompra: row.ORDENCOMPRA?.trim() ?? '',
      fechaCreacion: row.FECHACREACION ? row.FECHACREACION.toISOString() : null,
      destino: {
        id: `${row.UBIGEOPTOLLEGADA?.trim() ?? ''}-${codigoEmpaque}`,
        ubigeo: row.UBIGEOPTOLLEGADA?.trim() ?? '',
        direccion: row.DIRECCIONPTOLLEGADA?.trim() ?? ''
      },
      items: []
    };

    empaque.items.push({
      id: `${codigoEmpaque}-${row.CODIGOPRODUCTO?.trim() ?? empaque.items.length + 1}`,
      codigoEmpaque,
      codigoProducto: row.CODIGOPRODUCTO?.trim() ?? '',
      descripcion: row.DESCRIPCION?.trim() ?? '',
      cantidad: Number(row.CANTIDAD ?? 0),
      unidadMedida: normalizeUnidad(row.UNIDADMEDIDA)
    });

    empaques.set(codigoEmpaque, empaque);
  }

  return [...empaques.values()];
}

function normalizeUnidad(value: string | null | undefined) {
  const unit = value?.trim().toUpperCase() ?? '';
  if (!unit) return 'NIU';
  return unit === 'ROLLS' || unit === 'ROLLOS' || unit === 'ROLLO' || unit === 'ROL' || unit === 'ROLL'
    ? 'NIU'
    : unit;
}

function validateFlexoPreview(input: FlexoGuidePreviewInput) {
  const validations: FlexoValidation[] = [];
  const add = (code: string, severity: FlexoValidation['severity'], message: string) => {
    validations.push({ code, severity, message });
  };

  add('SERIE_FLEXO', /^T(003|999)-\d{8}$/.test(input.serieNumeroGuia) ? 'ok' : 'error', 'La guia Flexo debe usar serie T003 o T999.');
  add('CLIENTE', input.cliente.numeroDocumento && input.cliente.razonSocial ? 'ok' : 'error', 'Debe seleccionar un destinatario.');
  add('DESTINO', input.destino.ubigeo && input.destino.direccion ? 'ok' : 'error', 'Debe seleccionar un destino con ubigeo y direccion.');
  add('MOTIVO', input.motivoTraslado ? 'ok' : 'error', 'Debe seleccionar un motivo de traslado.');
  add('PESO', input.pesoBruto > 0 ? 'ok' : 'error', 'El peso bruto debe ser mayor a cero.');
  add('BULTOS', input.numeroBultos > 0 ? 'ok' : 'error', 'El numero de bultos debe ser mayor a cero.');
  add('OBSERVACIONES', input.observaciones.length <= 250 ? 'ok' : 'error', 'Las observaciones no pueden superar los 250 caracteres.');
  add(
    'DESCRIPCIONES',
    input.empaques.every((empaque) => empaque.items.every((item) => item.descripcion.trim().length >= 3 && item.descripcion.trim().length <= 500)) ? 'ok' : 'error',
    'Cada descripcion debe tener entre 3 y 500 caracteres.'
  );
  add('CHOFER', input.conductor.numeroDocumento && input.conductor.licencia && input.conductor.placa ? 'ok' : 'warning', 'Complete chofer, licencia y placa antes de declarar.');
  add('EMPAQUES', input.empaques.length > 0 ? 'ok' : 'error', 'Debe seleccionar uno o mas empaques.');

  const ordenes = new Set(input.empaques.map((item) => item.ordenCompra.trim()).filter(Boolean));
  add('OC_UNICA', ordenes.size <= 1 ? 'ok' : 'error', 'Los empaques seleccionados deben tener una sola OC.');

  return validations;
}
