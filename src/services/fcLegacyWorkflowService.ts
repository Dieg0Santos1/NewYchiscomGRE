import type { AppConfig } from '../config/env.js';
import { createYchiPool, sql } from '../integrations/bizlinksSql.js';

export type FcPreGuideRow = {
  idOrdenTrabajo: number;
  numeroOt: string;
  idOrdenVenta: number;
  numeroOv: string;
  cliente: string;
  idClieProv: number;
  cantidadOt: number;
  cantidadAceptada: number;
  cantidadPendiente: number;
  recepciones: number;
  serie: string;
  numeroDel: string;
  numeroAl: string;
  estadoGuiaOt: string;
  estadoPlanta: string;
};

export type FcLegacyClientRow = {
  idClieProv: number;
  cliente: string;
  ruc: string;
  direccion: string;
  idDistrito: number;
  otsPendientes: number;
  cantidadPendiente: number;
};

export type FcLegacyFormaPagoRow = {
  id: string;
  nombre: string;
  valor: string;
  dias: number;
};

export type FcLegacyVendedorRow = {
  idEmpleado: number;
  nombre: string;
};

export type FcLegacyMotivoRow = {
  idMotivoTraslado: number;
  nombre: string;
};

export type FcLegacyCatalogs = {
  formasPago: FcLegacyFormaPagoRow[];
  vendedores: FcLegacyVendedorRow[];
  motivos: FcLegacyMotivoRow[];
  warnings: string[];
};

export type FcLegacyClientPurpose = 'pre-guide' | 'internal-guide';

export type FcReceptionRow = {
  idRecepcionOT: number;
  idOrdenTrabajo: number;
  numeroOt: string;
  idOrdenVenta: number;
  numeroOv: string;
  numeroOvLegacy: string;
  idClieProv: number;
  cliente: string;
  cantidad: number;
  unidad: string;
  del: string;
  al: string;
  fechaRegistro: Date;
  estadoOt: string;
  estadoGuia: string;
  estadoFactura: string;
  serieProducto: string;
  formato: string;
  medida: string;
  numCopias: number;
  descripcion: string;
  direccion: string;
  idDistrito: number;
};

export class FcLegacyWorkflowService {
  constructor(private readonly config: AppConfig) {}

  capabilities() {
    return { writeEnabled: true, confirmationRequired: true };
  }

  async catalogs(): Promise<FcLegacyCatalogs> {
    const pool = createYchiPool(this.config);
    await pool.connect();

    try {
      const warnings: string[] = [];

      const [formasPago, vendedores, motivos] = await Promise.all([
        listLegacyPaymentTerms(pool, warnings),
        listLegacySellers(pool, warnings),
        listLegacyTransferReasons(pool, warnings)
      ]);

      return {
        formasPago,
        vendedores,
        motivos: motivos.length > 0 ? motivos : defaultLegacyTransferReasons(),
        warnings
      };
    } finally {
      await pool.close();
    }
  }

  async getNextInternalGuide(serie: '001' | '003') {
    const pool = createYchiPool(this.config);
    await pool.connect();
    try {
      const request = new sql.Request(pool);
      request.input('serie', sql.VarChar(3), serie);
      request.input('idTipoDocu', sql.Int, serie === '003' ? 39 : 8);
      const result = await request.query<{ numero: string | null }>(`
        SET TRANSACTION ISOLATION LEVEL READ UNCOMMITTED;
        SELECT TOP (1) numero
        FROM dbo.tbTipoDocu
        WHERE idTipoDocu = @idTipoDocu
          AND serie = @serie
          AND ISNUMERIC(numero) = 1;
      `);
      const latest = result.recordset[0];
      const nextNumber = Number(latest?.numero ?? 0) + 1;
      const numero = String(nextNumber);
      return { serie, numero, serieNumero: `${serie}-${numero}` };
    } finally {
      await pool.close();
    }
  }

  async searchClients(query: string, purpose: FcLegacyClientPurpose = 'pre-guide'): Promise<FcLegacyClientRow[]> {
    if (purpose === 'internal-guide') return this.searchInternalGuideClients(query);
    const pool = createYchiPool(this.config);
    await pool.connect();
    try {
      const request = new sql.Request(pool);
      request.input('query', sql.VarChar(100), `%${query.trim()}%`);
      request.input('queryBase', sql.VarChar(100), legacyLike(query));
      const result = await request.query<FcLegacyClientRow>(`
        SET TRANSACTION ISOLATION LEVEL READ UNCOMMITTED;
        WITH recibidas AS (
          SELECT idOT,
            SUM(CASE WHEN EstadoOT = 'C' THEN cantidad ELSE 0 END) AS cantidadAceptada
          FROM dbo.tbRecepcionOT
          GROUP BY idOT
        ),
        pendientes AS (
          SELECT
            c.idClieProv,
            c.Nombre AS cliente,
            ISNULL(c.RUC, '') AS ruc,
            ISNULL(c.Direccion, '') AS direccion,
            ISNULL(c.IdDistrito, 0) AS idDistrito,
            ot.idOrdenTrabajo,
            CAST(dov.Cantidad - ISNULL(r.cantidadAceptada, 0) AS decimal(18,2)) AS cantidadPendiente
          FROM dbo.tbOrdenTrabajo ot
          INNER JOIN dbo.tbDetOrdenVenta dov ON dov.idDetOrdenVenta = ot.idDetOrdenVenta
          INNER JOIN dbo.tbOrdenVenta ov ON ov.idOrdenVenta = dov.idOrdenVenta
          INNER JOIN dbo.tbDetSoliProf dsp ON dsp.idDetSoliProf = ov.idDetSoliProf
          INNER JOIN dbo.tbDocumentos solicitud ON solicitud.idDocumento = dsp.idDocumento
          INNER JOIN dbo.tbClieProv c ON c.idClieProv = solicitud.idClieProv
          LEFT JOIN recibidas r ON r.idOT = ot.idOrdenTrabajo
          WHERE (@query = '%%'
            OR c.Nombre LIKE @query
            OR ISNULL(c.RUC, '') LIKE @query
            OR ot.numero LIKE @query
            OR ov.Numero LIKE @query
            OR ov.Numero LIKE @queryBase
            OR CONVERT(varchar(20), dov.idOrdenVenta) LIKE @queryBase)
            AND ISNULL(ot.Estado, '') <> 'Z'
            AND ISNULL(ot.EstGuia, 'N') IN ('N', 'M')
            AND dov.Cantidad - ISNULL(r.cantidadAceptada, 0) > 0
        )
        SELECT TOP (100)
          idClieProv,
          cliente,
          ruc,
          direccion,
          idDistrito,
          COUNT(DISTINCT idOrdenTrabajo) AS otsPendientes,
          CAST(SUM(cantidadPendiente) AS decimal(18,2)) AS cantidadPendiente
        FROM pendientes
        GROUP BY idClieProv, cliente, ruc, direccion, idDistrito
        ORDER BY cliente;
      `);
      return result.recordset;
    } finally {
      await pool.close();
    }
  }

  async searchWorkOrders(query: string, idClieProv?: number): Promise<FcPreGuideRow[]> {
    const pool = createYchiPool(this.config);
    await pool.connect();
    try {
      const request = new sql.Request(pool);
      request.input('query', sql.VarChar(100), `%${query.trim()}%`);
      request.input('queryBase', sql.VarChar(100), legacyLike(query));
      request.input('idClieProv', sql.Int, idClieProv ?? null);
      const result = await request.query<FcPreGuideRow>(`
        SET TRANSACTION ISOLATION LEVEL READ UNCOMMITTED;
        WITH recibidas AS (
          SELECT idOT,
            SUM(CASE WHEN EstadoOT = 'C' THEN cantidad ELSE 0 END) AS cantidadAceptada,
            COUNT(*) AS recepciones
          FROM dbo.tbRecepcionOT
          GROUP BY idOT
        )
        SELECT TOP (100)
          ot.idOrdenTrabajo,
          ot.numero AS numeroOt,
          dov.idOrdenVenta,
          ov.Numero AS numeroOv,
          c.Nombre AS cliente,
          c.idClieProv,
          CAST(dov.Cantidad AS decimal(18,2)) AS cantidadOt,
          CAST(ISNULL(r.cantidadAceptada, 0) AS decimal(18,2)) AS cantidadAceptada,
          CAST(dov.Cantidad - ISNULL(r.cantidadAceptada, 0) AS decimal(18,2)) AS cantidadPendiente,
          ISNULL(r.recepciones, 0) AS recepciones,
          dov.Serie AS serie,
          dov.NumeroDel AS numeroDel,
          dov.NumeroAl AS numeroAl,
          ISNULL(ot.EstGuia, 'N') AS estadoGuiaOt,
          ISNULL(ot.EstadoPlanta, '') AS estadoPlanta
        FROM dbo.tbOrdenTrabajo ot
        INNER JOIN dbo.tbDetOrdenVenta dov ON dov.idDetOrdenVenta = ot.idDetOrdenVenta
        INNER JOIN dbo.tbOrdenVenta ov ON ov.idOrdenVenta = dov.idOrdenVenta
        INNER JOIN dbo.tbDetSoliProf dsp ON dsp.idDetSoliProf = ov.idDetSoliProf
        INNER JOIN dbo.tbDocumentos solicitud ON solicitud.idDocumento = dsp.idDocumento
        INNER JOIN dbo.tbClieProv c ON c.idClieProv = solicitud.idClieProv
        LEFT JOIN recibidas r ON r.idOT = ot.idOrdenTrabajo
        WHERE (@query = '%%'
          OR ot.numero LIKE @query
          OR c.Nombre LIKE @query
          OR ov.Numero LIKE @query
          OR ov.Numero LIKE @queryBase
          OR CONVERT(varchar(20), dov.idOrdenVenta) LIKE @query
          OR CONVERT(varchar(20), dov.idOrdenVenta) LIKE @queryBase)
          AND ISNULL(ot.Estado, '') <> 'Z'
          AND ISNULL(ot.EstGuia, 'N') IN ('N', 'M')
          AND (@idClieProv IS NULL OR c.idClieProv = @idClieProv)
          AND dov.Cantidad - ISNULL(r.cantidadAceptada, 0) > 0
        ORDER BY ot.idOrdenTrabajo DESC;
      `);
      return result.recordset;
    } finally {
      await pool.close();
    }
  }

  async searchReceptions(query: string, state: 'ready' | 'pending' | 'all' = 'ready', idClieProv?: number): Promise<FcReceptionRow[]> {
    const pool = createYchiPool(this.config);
    await pool.connect();
    try {
      const request = new sql.Request(pool);
      request.input('query', sql.VarChar(100), `%${query.trim()}%`);
      request.input('queryBase', sql.VarChar(100), legacyLike(query));
      request.input('state', sql.VarChar(10), state);
      request.input('idClieProv', sql.Int, idClieProv ?? null);
      try {
        const result = await request.query<FcReceptionRow>(`
        SET TRANSACTION ISOLATION LEVEL READ UNCOMMITTED;
        SELECT TOP (200)
          r.idRecepcionOT,
          ot.idOrdenTrabajo,
          ot.numero AS numeroOt,
          dov.idOrdenVenta,
          ov.Numero AS numeroOv,
          LTRIM(RTRIM(ISNULL(ov.Numero, '') + '-' + CONVERT(varchar(15), ISNULL(dov.item, 0)))) AS numeroOvLegacy,
          c.idClieProv,
          c.Nombre AS cliente,
          CAST(r.cantidad AS decimal(18,2)) AS cantidad,
          u.Valor AS unidad,
          r.Del AS del,
          r.Al AS al,
          r.FechaRegistro,
          r.EstadoOT AS estadoOt,
          r.EstadoGuia AS estadoGuia,
          r.EstadoFactura AS estadoFactura,
          dov.Serie AS serieProducto,
          ISNULL(legacyDetalle.formato, '') AS formato,
          ISNULL(legacyDetalle.medida, '') AS medida,
          ISNULL(dsp.cantidadCopias, 0) AS numCopias,
          COALESCE(NULLIF(legacyDetalle.descripcion, ''), LTRIM(RTRIM(
            ISNULL(ot.numero, '') COLLATE DATABASE_DEFAULT +
            CASE WHEN ISNULL(dov.Serie, '') <> '' THEN ' SERIE ' COLLATE DATABASE_DEFAULT + ISNULL(dov.Serie, '') COLLATE DATABASE_DEFAULT ELSE '' END +
            CASE WHEN ISNULL(r.Del, '') <> '' THEN ' DEL ' COLLATE DATABASE_DEFAULT + ISNULL(r.Del, '') COLLATE DATABASE_DEFAULT ELSE '' END +
            CASE WHEN ISNULL(r.Al, '') <> '' THEN ' AL ' COLLATE DATABASE_DEFAULT + ISNULL(r.Al, '') COLLATE DATABASE_DEFAULT ELSE '' END
          ))) AS descripcion,
          c.Direccion AS direccion,
          c.IdDistrito AS idDistrito
        FROM dbo.tbRecepcionOT r
        INNER JOIN dbo.tbOrdenTrabajo ot ON ot.idOrdenTrabajo = r.idOT
        INNER JOIN dbo.tbDetOrdenVenta dov ON dov.idDetOrdenVenta = ot.idDetOrdenVenta
        INNER JOIN dbo.tbOrdenVenta ov ON ov.idOrdenVenta = dov.idOrdenVenta
        INNER JOIN dbo.tbDetSoliProf dsp ON dsp.idDetSoliProf = ov.idDetSoliProf
        INNER JOIN dbo.tbDocumentos solicitud ON solicitud.idDocumento = dsp.idDocumento
        INNER JOIN dbo.tbClieProv c ON c.idClieProv = solicitud.idClieProv
        INNER JOIN dbo.tbUnidades u ON u.idUnidad = r.IDUNIDAD
        INNER JOIN dbo.tbMedidas medida ON medida.idMedida = ov.IdMedida
        LEFT JOIN dbo.tbEquivMed equivMed ON equivMed.idMedida = medida.idMedida
        LEFT JOIN dbo.tbDetSoliProf_detalle dspDetalle ON dspDetalle.idDetSoliProf = dsp.idDetSoliProf
        LEFT JOIN dbo.tbFormatos formato ON formato.idFormatos = ov.IdFormato
        OUTER APPLY (
          SELECT
            LTRIM(RTRIM(ISNULL(
              CASE
                WHEN dsp.idFormato = 34 THEN dspDetalle.Formato
                WHEN dsp.idFormato < 34 THEN formato.nombre
                WHEN dsp.idFormato > 34 AND dsp.idFormato < 100 THEN formato.nombre
                ELSE dspDetalle.Formato
              END,
              ''
            ))) AS formato,
            LTRIM(RTRIM(ISNULL(
              CASE
                WHEN LEFT(ISNULL(dsp.observaciones, ''), 3) = 'MCM'
                  THEN ISNULL(equivMed.nombre, '') COLLATE DATABASE_DEFAULT
                ELSE
                  CAST(medida.enteroAncho AS varchar(20)) COLLATE DATABASE_DEFAULT + ' ' COLLATE DATABASE_DEFAULT +
                  CAST(medida.numeradorAncho AS varchar(20)) COLLATE DATABASE_DEFAULT + '/' COLLATE DATABASE_DEFAULT +
                  CAST(medida.denominadorAncho AS varchar(20)) COLLATE DATABASE_DEFAULT + ' X ' COLLATE DATABASE_DEFAULT +
                  CAST(medida.enteroLargo AS varchar(20)) COLLATE DATABASE_DEFAULT + ' ' COLLATE DATABASE_DEFAULT +
                  CAST(medida.numeradorLargo AS varchar(20)) COLLATE DATABASE_DEFAULT + '/' COLLATE DATABASE_DEFAULT +
                  CAST(medida.denominadorLargo AS varchar(20)) COLLATE DATABASE_DEFAULT
              END,
              ''
            ))) AS medida,
            LTRIM(RTRIM(
              ISNULL(
                CASE
                  WHEN dsp.idFormato = 34 THEN dspDetalle.Formato
                  WHEN dsp.idFormato < 34 THEN formato.nombre
                  WHEN dsp.idFormato > 34 AND dsp.idFormato < 100 THEN formato.nombre
                  ELSE dspDetalle.Formato
                END,
                ''
              ) COLLATE DATABASE_DEFAULT +
              ' ' COLLATE DATABASE_DEFAULT +
              ISNULL(
                CASE
                  WHEN LEFT(ISNULL(dsp.observaciones, ''), 3) = 'MCM'
                    THEN ISNULL(equivMed.nombre, '') COLLATE DATABASE_DEFAULT + ' X ' COLLATE DATABASE_DEFAULT + CAST(dsp.cantidadCopias AS varchar(20)) COLLATE DATABASE_DEFAULT
                  ELSE
                    CAST(medida.enteroAncho AS varchar(20)) COLLATE DATABASE_DEFAULT + ' ' COLLATE DATABASE_DEFAULT +
                    CAST(medida.numeradorAncho AS varchar(20)) COLLATE DATABASE_DEFAULT + '/' COLLATE DATABASE_DEFAULT +
                    CAST(medida.denominadorAncho AS varchar(20)) COLLATE DATABASE_DEFAULT + ' X ' COLLATE DATABASE_DEFAULT +
                    CAST(medida.enteroLargo AS varchar(20)) COLLATE DATABASE_DEFAULT + ' ' COLLATE DATABASE_DEFAULT +
                    CAST(medida.numeradorLargo AS varchar(20)) COLLATE DATABASE_DEFAULT + '/' COLLATE DATABASE_DEFAULT +
                    CAST(medida.denominadorLargo AS varchar(20)) COLLATE DATABASE_DEFAULT + ' X ' COLLATE DATABASE_DEFAULT +
                    CAST(dsp.cantidadCopias AS varchar(20)) COLLATE DATABASE_DEFAULT
                END,
                ''
              ) COLLATE DATABASE_DEFAULT
            )) AS descripcion
        ) legacyDetalle
        WHERE (@query = '%%'
          OR ot.numero LIKE @query
          OR c.Nombre LIKE @query
          OR CONVERT(varchar(20), r.idRecepcionOT) LIKE @query
          OR CONVERT(varchar(20), dov.idOrdenVenta) LIKE @query
          OR CONVERT(varchar(20), dov.idOrdenVenta) LIKE @queryBase
          OR ov.Numero LIKE @query
          OR ov.Numero LIKE @queryBase
          OR legacyDetalle.descripcion LIKE @query
          OR legacyDetalle.descripcion LIKE @queryBase)
          AND (@idClieProv IS NULL OR c.idClieProv = @idClieProv)
          AND (
            @state = 'all'
            OR (@state = 'pending' AND r.EstadoOT = 'I')
            OR (@state = 'ready' AND r.EstadoOT = 'C' AND r.EstadoGuia = 'N')
          )
        ORDER BY r.FechaRegistro DESC, r.idRecepcionOT DESC;
      `);
        return result.recordset;
      } catch (error) {
        if (!isLegacyMetadataPermissionError(error)) throw error;
        const fallbackRequest = new sql.Request(pool);
        fallbackRequest.input('query', sql.VarChar(100), `%${query.trim()}%`);
        fallbackRequest.input('queryBase', sql.VarChar(100), legacyLike(query));
        fallbackRequest.input('state', sql.VarChar(10), state);
        fallbackRequest.input('idClieProv', sql.Int, idClieProv ?? null);
        const fallback = await fallbackRequest.query<FcReceptionRow>(`
        SET TRANSACTION ISOLATION LEVEL READ UNCOMMITTED;
        SELECT TOP (200)
          r.idRecepcionOT,
          ot.idOrdenTrabajo,
          ot.numero AS numeroOt,
          dov.idOrdenVenta,
          ov.Numero AS numeroOv,
          LTRIM(RTRIM(ISNULL(ov.Numero, '') + '-' + CONVERT(varchar(15), ISNULL(dov.item, 0)))) AS numeroOvLegacy,
          c.idClieProv,
          c.Nombre AS cliente,
          CAST(r.cantidad AS decimal(18,2)) AS cantidad,
          u.Valor AS unidad,
          r.Del AS del,
          r.Al AS al,
          r.FechaRegistro,
          r.EstadoOT AS estadoOt,
          r.EstadoGuia AS estadoGuia,
          r.EstadoFactura AS estadoFactura,
          dov.Serie AS serieProducto,
          '' AS formato,
          '' AS medida,
          0 AS numCopias,
          LTRIM(RTRIM(
            ISNULL(ot.numero, '') COLLATE DATABASE_DEFAULT +
            CASE WHEN ISNULL(dov.Serie, '') <> '' THEN ' SERIE ' COLLATE DATABASE_DEFAULT + ISNULL(dov.Serie, '') COLLATE DATABASE_DEFAULT ELSE '' END +
            CASE WHEN ISNULL(r.Del, '') <> '' THEN ' DEL ' COLLATE DATABASE_DEFAULT + ISNULL(r.Del, '') COLLATE DATABASE_DEFAULT ELSE '' END +
            CASE WHEN ISNULL(r.Al, '') <> '' THEN ' AL ' COLLATE DATABASE_DEFAULT + ISNULL(r.Al, '') COLLATE DATABASE_DEFAULT ELSE '' END
          )) AS descripcion,
          c.Direccion AS direccion,
          c.IdDistrito AS idDistrito
        FROM dbo.tbRecepcionOT r
        INNER JOIN dbo.tbOrdenTrabajo ot ON ot.idOrdenTrabajo = r.idOT
        INNER JOIN dbo.tbDetOrdenVenta dov ON dov.idDetOrdenVenta = ot.idDetOrdenVenta
        INNER JOIN dbo.tbOrdenVenta ov ON ov.idOrdenVenta = dov.idOrdenVenta
        INNER JOIN dbo.tbDetSoliProf dsp ON dsp.idDetSoliProf = ov.idDetSoliProf
        INNER JOIN dbo.tbDocumentos solicitud ON solicitud.idDocumento = dsp.idDocumento
        INNER JOIN dbo.tbClieProv c ON c.idClieProv = solicitud.idClieProv
        INNER JOIN dbo.tbUnidades u ON u.idUnidad = r.IDUNIDAD
        WHERE (@query = '%%'
          OR ot.numero LIKE @query
          OR c.Nombre LIKE @query
          OR CONVERT(varchar(20), r.idRecepcionOT) LIKE @query
          OR CONVERT(varchar(20), dov.idOrdenVenta) LIKE @query
          OR CONVERT(varchar(20), dov.idOrdenVenta) LIKE @queryBase
          OR ov.Numero LIKE @query
          OR ov.Numero LIKE @queryBase)
          AND (@idClieProv IS NULL OR c.idClieProv = @idClieProv)
          AND (
            @state = 'all'
            OR (@state = 'pending' AND r.EstadoOT = 'I')
            OR (@state = 'ready' AND r.EstadoOT = 'C' AND r.EstadoGuia = 'N')
          )
        ORDER BY r.FechaRegistro DESC, r.idRecepcionOT DESC;
      `);
        return fallback.recordset;
      }
    } finally {
      await pool.close();
    }
  }

  async createPreGuide(input: { numeroOt: string; cantidad: number; del: string; al: string }) {
    const pool = createYchiPool(this.config);
    await pool.connect();
    try {
      const request = new sql.Request(pool);
      request.input('numeroOt', sql.VarChar(11), input.numeroOt);
      request.input('cantidad', sql.Decimal(18, 2), input.cantidad);
      request.input('del', sql.VarChar(12), input.del);
      request.input('al', sql.VarChar(12), input.al);
      const result = await request.execute('dbo.GRE_WEB_CREAR_PREGUIA_FC');
      return findProcedureRow(result.recordsets, 'idRecepcionOT');
    } finally { await pool.close(); }
  }

  async acceptPreGuide(input: { idRecepcionOT: number }) {
    const pool = createYchiPool(this.config);
    await pool.connect();
    try {
      const request = new sql.Request(pool);
      request.input('idRecepcionOT', sql.Int, input.idRecepcionOT);
      const result = await request.execute('dbo.GRE_WEB_ACEPTAR_PREGUIA_FC');
      return findProcedureRow(result.recordsets, 'idRecepcionOT');
    } finally { await pool.close(); }
  }

  async createInternalGuide(input: {
    serie: '001' | '003';
    idRecepciones: number[];
    direccion: string;
    idDistrito: number;
    ordenCompra: string;
    observaciones: string;
    formaPago?: string;
    idEmpleado?: number | null;
    idMotivoTraslado?: number | null;
    detalles?: Array<{
      idRecepcionOT: number;
      descripcion: string;
      cantidad: number;
      unidad: string;
    }>;
  }) {
    const pool = createYchiPool(this.config);
    await pool.connect();
    try {
      const request = new sql.Request(pool);
      const xml = `<ids>${input.idRecepciones.map((id) => `<id>${id}</id>`).join('')}</ids>`;
      const detallesXml = `<detalles>${(input.detalles ?? []).map((item) => [
        `<detalle idRecepcionOT="${escapeXml(String(item.idRecepcionOT))}">`,
        `<descripcion>${escapeXml(item.descripcion)}</descripcion>`,
        `<cantidad>${escapeXml(String(item.cantidad))}</cantidad>`,
        `<unidad>${escapeXml(item.unidad)}</unidad>`,
        '</detalle>'
      ].join('')).join('')}</detalles>`;
      request.input('serie', sql.VarChar(3), input.serie);
      request.input('recepcionesXml', sql.Xml, xml);
      request.input('direccion', sql.VarChar(150), input.direccion);
      request.input('idDistrito', sql.Int, input.idDistrito);
      request.input('ordenCompra', sql.VarChar(50), input.ordenCompra);
      request.input('observaciones', sql.VarChar(50), input.observaciones);
      request.input('formaPago', sql.VarChar(80), input.formaPago ?? '');
      request.input('idEmpleado', sql.Int, input.idEmpleado ?? null);
      request.input('idMotivoTraslado', sql.Int, input.idMotivoTraslado ?? 0);
      request.input('detallesXml', sql.Xml, detallesXml);
      const result = await request.execute('dbo.GRE_WEB_CREAR_GUIA_INTERNA_FC');
      return findProcedureRow(result.recordsets, 'serieNumero');
    } finally { await pool.close(); }
  }

  private async searchInternalGuideClients(query: string): Promise<FcLegacyClientRow[]> {
    const pool = createYchiPool(this.config);
    await pool.connect();
    try {
      const request = new sql.Request(pool);
      request.input('query', sql.VarChar(100), `%${query.trim()}%`);
      request.input('queryBase', sql.VarChar(100), legacyLike(query));
      const result = await request.query<FcLegacyClientRow>(`
        SET TRANSACTION ISOLATION LEVEL READ UNCOMMITTED;
        SELECT TOP (100)
          c.idClieProv,
          c.Nombre AS cliente,
          ISNULL(c.RUC, '') AS ruc,
          ISNULL(c.Direccion, '') AS direccion,
          ISNULL(c.IdDistrito, 0) AS idDistrito,
          COUNT(DISTINCT ot.idOrdenTrabajo) AS otsPendientes,
          CAST(SUM(r.Cantidad) AS decimal(18,2)) AS cantidadPendiente
        FROM dbo.tbRecepcionOT r
        INNER JOIN dbo.tbOrdenTrabajo ot ON ot.idOrdenTrabajo = r.idOT
        INNER JOIN dbo.tbDetOrdenVenta dov ON dov.idDetOrdenVenta = ot.idDetOrdenVenta
        INNER JOIN dbo.tbOrdenVenta ov ON ov.idOrdenVenta = dov.idOrdenVenta
        INNER JOIN dbo.tbDetSoliProf dsp ON dsp.idDetSoliProf = ov.idDetSoliProf
        INNER JOIN dbo.tbDocumentos solicitud ON solicitud.idDocumento = dsp.idDocumento
        INNER JOIN dbo.tbClieProv c ON c.idClieProv = solicitud.idClieProv
        WHERE (@query = '%%'
          OR c.Nombre LIKE @query
          OR ISNULL(c.RUC, '') LIKE @query
          OR ot.numero LIKE @query
          OR ov.Numero LIKE @query
          OR ov.Numero LIKE @queryBase
          OR CONVERT(varchar(20), dov.idOrdenVenta) LIKE @queryBase
          OR CONVERT(varchar(20), r.idRecepcionOT) LIKE @query)
          AND r.EstadoOT = 'C'
          AND r.EstadoGuia = 'N'
        GROUP BY c.idClieProv, c.Nombre, c.RUC, c.Direccion, c.IdDistrito
        ORDER BY c.Nombre;
      `);
      return result.recordset;
    } finally {
      await pool.close();
    }
  }
}

function findProcedureRow(recordsets: unknown, key: string): Record<string, unknown> | undefined {
  const sets = recordsets as Array<Array<Record<string, unknown>>>;
  for (const set of sets) {
    const row = Array.from(set).find((candidate) => key in candidate);
    if (row) return row;
  }
  return undefined;
}

function legacyLike(value: string) {
  const trimmed = value.trim();
  const withoutLegacyLineSuffix = trimmed.replace(/-\d+$/, '');
  return `%${withoutLegacyLineSuffix}%`;
}

function isLegacyMetadataPermissionError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes('SELECT permission was denied')
    || message.includes('Invalid object name')
    || message.includes('Invalid column name');
}

async function listLegacyPaymentTerms(pool: sql.ConnectionPool, warnings: string[]): Promise<FcLegacyFormaPagoRow[]> {
  try {
    const result = await new sql.Request(pool).query<{
      idPropiedades: number;
      Nombre: string | null;
      Valor: string | null;
      Descripcion: string | null;
    }>(`
      SET TRANSACTION ISOLATION LEVEL READ UNCOMMITTED;
      SELECT TOP (120)
        idPropiedades,
        Nombre,
        Valor,
        Descripcion
      FROM dbo.tbPropiedades
      WHERE tipo = 'FPAG'
        AND ISNULL(Valor, '') NOT LIKE '(obsoleto)%'
        AND ISNULL(Nombre, '') NOT LIKE '(obsoleto)%'
      ORDER BY
        CASE WHEN Nombre LIKE 'Contado%' THEN 0 ELSE 1 END,
        Nombre;
    `);

    return result.recordset.map((row) => ({
      id: String(row.idPropiedades),
      nombre: row.Nombre?.trim() || row.Valor?.trim() || String(row.idPropiedades),
      valor: row.Valor?.trim() || row.Nombre?.trim() || '',
      dias: Number(row.Descripcion ?? 0) || 0
    }));
  } catch (error) {
    warnings.push(catalogWarning('formas de pago', error));
    return [];
  }
}

async function listLegacySellers(pool: sql.ConnectionPool, warnings: string[]): Promise<FcLegacyVendedorRow[]> {
  const sources = [
    `
      SET TRANSACTION ISOLATION LEVEL READ UNCOMMITTED;
      SELECT DISTINCT TOP (150)
        idEmpleado,
        LTRIM(RTRIM(Nombre)) AS nombre
      FROM dbo.VW_VENDEDORES
      WHERE idEmpleado IS NOT NULL
        AND NULLIF(LTRIM(RTRIM(Nombre)), '') IS NOT NULL
      ORDER BY nombre;
    `,
    `
      SET TRANSACTION ISOLATION LEVEL READ UNCOMMITTED;
      SELECT DISTINCT TOP (150)
        idEmpleado,
        LTRIM(RTRIM(ISNULL(Nombre, '') + ' ' + ISNULL(Apellido, ''))) AS nombre
      FROM dbo.VW_EMPLEADOS
      WHERE idEmpleado IS NOT NULL
        AND NULLIF(LTRIM(RTRIM(ISNULL(Nombre, '') + ' ' + ISNULL(Apellido, ''))), '') IS NOT NULL
      ORDER BY nombre;
    `
  ];

  for (const query of sources) {
    try {
      const result = await new sql.Request(pool).query<FcLegacyVendedorRow>(query);
      if (result.recordset.length > 0) return result.recordset;
    } catch (error) {
      warnings.push(catalogWarning('vendedores', error));
    }
  }

  return [];
}

async function listLegacyTransferReasons(pool: sql.ConnectionPool, warnings: string[]): Promise<FcLegacyMotivoRow[]> {
  const sources = [
    `
      SET TRANSACTION ISOLATION LEVEL READ UNCOMMITTED;
      SELECT DISTINCT TOP (100)
        idMotivoTraslado,
        LTRIM(RTRIM(Descripcion)) AS nombre
      FROM dbo.tbMotivoTraslado
      WHERE idMotivoTraslado IS NOT NULL
        AND NULLIF(LTRIM(RTRIM(Descripcion)), '') IS NOT NULL
      ORDER BY nombre;
    `,
    `
      SET TRANSACTION ISOLATION LEVEL READ UNCOMMITTED;
      SELECT DISTINCT TOP (100)
        idMotivoTraslado,
        LTRIM(RTRIM(Nombre)) AS nombre
      FROM dbo.tbMotivoTraslado
      WHERE idMotivoTraslado IS NOT NULL
        AND NULLIF(LTRIM(RTRIM(Nombre)), '') IS NOT NULL
      ORDER BY nombre;
    `
  ];

  for (const query of sources) {
    try {
      const result = await new sql.Request(pool).query<FcLegacyMotivoRow>(query);
      if (result.recordset.length > 0) return result.recordset;
    } catch {
      continue;
    }
  }

  return [
    ...defaultLegacyTransferReasons()
  ];
}

function defaultLegacyTransferReasons(): FcLegacyMotivoRow[] {
  return [
    { idMotivoTraslado: 0, nombre: 'Segun guia interna' },
    { idMotivoTraslado: 17, nombre: 'Traslado' },
    { idMotivoTraslado: 18, nombre: 'Transformacion' }
  ];
}

function catalogWarning(source: string, error: unknown) {
  const message = error instanceof Error ? error.message : 'sin detalle';
  return `No se pudo cargar ${source} desde YCHIDB3: ${message}`;
}

function escapeXml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}
