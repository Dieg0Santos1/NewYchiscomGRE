import type { AppConfig } from '../config/env.js';
import { GRE_FC_ALLOWED_SERIES, GRE_FC_DEFAULT_SERIE, GRE_FC_SERIE_PATTERN, type GreFcSerie } from '../config/greSeries.js';
import type { ExistingGreClient, GreDestino } from '../integrations/existingGreClient.js';
import { createExistingGreClient, ExistingGreClientError } from '../integrations/existingGreClient.js';
import { createBizlinksPool, createGreFcPool, createYchiPool, sql } from '../integrations/bizlinksSql.js';
import { isEligibleForManualSunatMessage } from './greFormularioManualSunatService.js';

export type WorkOrderProduct = {
  codigoProducto: string;
  descripcion: string;
  cantidad: number;
  cantidadOriginal: number;
  cantidadPendiente: number;
  incluido: boolean;
  unidadMedida: string;
  id: string;
};

export type WorkOrderDocument = {
  idDocumentos: string;
  numeroOt: string;
  cliente: string;
  fecha: string;
  referencia: string;
  ordenCompra: string;
  destinatario: WorkOrderRecipient | null;
  destinos: GreDestino[];
  productos: WorkOrderProduct[];
};

export type WorkOrderSearchStatus =
  | 'OT_DISPONIBLE'
  | 'OT_SIN_DETALLES'
  | 'OT_NO_ENCONTRADA'
  | 'CLIENTE_SIN_DESTINOS'
  | 'DESTINOS_ERROR';

export type WorkOrderSearchResult = {
  status: WorkOrderSearchStatus;
  documents: WorkOrderDocument[];
  message: string;
  warnings?: string[];
};

function mapUnidadMedida(unit: string | null | undefined): string {
  if (!unit) return 'UND';
  const trimmed = unit.trim().toUpperCase();
  if (trimmed === 'BLOCK') return 'SET';
  return trimmed;
}

export type RecipientSearchResult = {
  id: string;
  tipoDocumentoDestinatario: string;
  numeroDocumentoDestinatario: string;
  razonSocialDestinatario: string;
  direcciones: Array<{
    id: string;
    ubigeo?: string;
    direccion: string;
  }>;
};

export type WorkOrderRecipient = {
  tipoDocumentoDestinatario: string;
  numeroDocumentoDestinatario: string;
  razonSocialDestinatario: string;
  fuente: 'YCHIDB3' | 'BIZLINKS_HISTORICO';
};

export type DriverCatalogItem = {
  id: string;
  tipoDocumento: string;
  numeroDocumento: string;
  nombres: string;
  apellidos: string;
  licencia: string;
  placa: string;
};

export type NextSerieResult = {
  serie: GreFcSerie;
  numero: string;
  serieNumeroGuia: string;
  reserved: false;
};

export type GuideStatus = 'GENERADO' | 'ENVIADO' | 'EN_PROCESO' | 'ACEPTADA' | 'RECHAZADA' | 'ERROR';

export type GuideStatusResult = {
  operationId: string;
  serieNumeroGuia: string | null;
  estado: GuideStatus;
  estadoOperacion: string | null;
  estadoEnvio: string | null;
  estadoBizlinks: string | null;
  estadoProceso: string | null;
  mensaje: string | null;
  respuestaSunat: string | null;
  pdfDisponible: boolean;
  manualSunatMessageAllowed: boolean;
  releaseOtAllowed: boolean;
  workOrdersReleased: boolean;
  items: number;
  creadoEn: string | null;
  actualizadoEn: string | null;
};

type WorkOrderRow = {
  numeroOt: string | null;
  numeroOv: string | null;
  proforma: string | null;
  razonSocial: string | null;
  idDetOrdenVenta: number | null;
  idOrdenVenta: number | null;
  idOrdenTrabajo: number | null;
};

type ProductRow = {
  idDetGuia: number | null;
  idOrdenVenta: number | null;
  formato: string | null;
  medida: string | null;
  tira: string | null;
  retira: string | null;
  papel: string | null;
  idDocumentos: number | null;
  unidad: string | null;
  cantidad: number | string | null;
  numeroDel: string | null;
  numeroAl: string | null;
  serie: string | null;
};

type YchiRecipientRow = {
  tipoDocumentoDestinatario: string;
  numeroDocumentoDestinatario: string | null;
  razonSocialDestinatario: string | null;
};

export type YchiDestinationRow = {
  idClieProv: number | null;
  idClieDireccion: number | null;
  codigoDestino: number | null;
  ubigeo: string | null;
  direccion: string | null;
};

type RecipientRow = {
  tipoDocumentoDestinatario: string | null;
  numeroDocumentoDestinatario: string | null;
  razonSocialDestinatario: string | null;
  ubigeoPtoLLegada: string | null;
  direccionPtoLLegada: string | null;
};

type DestinationHistoryRow = {
  ubigeoPtoLLegada: string | null;
  direccionPtoLLegada: string | null;
  codigoPtollegada: string | null;
  bl_createdAt: Date | null;
};

type DriverRow = {
  NUMERODOCUMENTOCHOFER: string;
  TIPODOCUMENTOCHOFER: string;
  NOMBRE: string;
  APELLIDO: string;
  BREVETE: string;
  PLACAVEHICULO: string;
};

type OperationRow = {
  operationId: string;
  serieNumeroGuia: string | null;
  estadoOperacion: string | null;
  estadoEnvio: string | null;
  mensajeEnvio: string | null;
  creadoEn: Date | null;
  actualizadoEn: Date | null;
  items: number;
  otsLiberadas: number;
};

type BizlinksStatusRow = {
  serieNumeroGuia: string;
  bl_estadoRegistro: string | null;
  responseEstadoRegistro: string | null;
  bl_estadoProceso: string | null;
  process_state: string | null;
  bl_mensaje: string | null;
  bl_mensajeSunat: string | null;
  bl_url_pdf: string | null;
};

type BizlinksStatusForReport = {
  bl_estadoRegistro: string | null;
  responseEstadoRegistro?: string | null;
  bl_estadoProceso: string | null;
  process_state?: string | null;
  bl_mensaje: string | null;
  bl_mensajeSunat: string | null;
};

export class GreFormularioQueryService {
  private readonly existingGreClient: ExistingGreClient;

  constructor(private readonly config: AppConfig, existingGreClient?: ExistingGreClient) {
    this.existingGreClient = existingGreClient ?? createExistingGreClient(config);
  }

  async searchByOt(ot: string): Promise<WorkOrderSearchResult> {
    const normalizedOt = ot.trim();
    if (!normalizedOt) {
      return {
        status: 'OT_NO_ENCONTRADA',
        documents: [],
        message: 'Ingrese numero de OT'
      };
    }

    const pool = createYchiPool(this.config);
    await pool.connect();

    try {
      const request = new sql.Request(pool);
      const searchTerms = buildOtSearchTerms(normalizedOt);
      const searchParams = searchTerms.map((term, index) => {
        const name = `ot${index}`;
        request.input(name, sql.VarChar(50), term);
        return `@${name}`;
      });

      const result = await request.query<WorkOrderRow>(`
        SELECT TOP (20)
          COALESCE(b.[Nº OT], ot.numero) AS numeroOt,
          b.[Nº OV] AS numeroOv,
          b.PROFORMA AS proforma,
          b.[RAZON SOCIAL] AS razonSocial,
          b.idDetOrdenVenta,
          b.idOrdenVenta,
          ot.idOrdenTrabajo
        FROM dbo.tbOrdenTrabajo ot
        LEFT JOIN dbo.VW_BUSCAS_DOCUMENTOS b
          ON b.IDOT = ot.idOrdenTrabajo
        WHERE ot.numero IN (${searchParams.join(', ')})
           OR b.[Nº OT] IN (${searchParams.join(', ')})
        ORDER BY ot.idOrdenTrabajo DESC, b.idOrdenVenta DESC
      `);

      if (result.recordset.length === 0) {
        return {
          status: 'OT_NO_ENCONTRADA',
          documents: [],
          message: `No se encontro la OT ${normalizedOt}`
        };
      }

      const bizlinksPool = createBizlinksPool(this.config);
      await bizlinksPool.connect();

  const documents: WorkOrderDocument[] = [];
      let destinosError: string | null = null;
      let usedHistoricalDestinations = false;
      let usedYchiDestinations = false;
      const productWarnings: string[] = [];

      try {
        for (const row of sortRowsBySearchTerms(result.recordset, searchTerms)) {
          const productResult = await getProductsByIdOrdenVenta(pool, row.idOrdenVenta);
          productWarnings.push(...productResult.warnings);
          const internalId = row.idOrdenVenta ?? row.idOrdenTrabajo ?? row.idDetOrdenVenta;
          const destinatario = productResult.destinatario ?? await resolveRecipient(bizlinksPool, row);
          let destinos: GreDestino[] = productResult.destinos;
          usedYchiDestinations = usedYchiDestinations || destinos.length > 0;

          if (destinatario && destinos.length === 0) {
            try {
              destinos = await this.existingGreClient.getDestinos(destinatario.numeroDocumentoDestinatario);
            } catch (error) {
              if (error instanceof ExistingGreClientError) {
                destinosError = error.message;
                destinos = await getDestinosFromBizlinksHistory(bizlinksPool, destinatario.numeroDocumentoDestinatario);
                usedHistoricalDestinations = destinos.length > 0;
              } else {
                throw error;
              }
            }
          }

          documents.push({
            idDocumentos: String(internalId ?? row.numeroOt ?? normalizedOt),
            numeroOt: row.numeroOt ?? normalizedOt,
            cliente: row.razonSocial ?? '',
            fecha: '',
            referencia: [
              row.numeroOv ? `OV ${row.numeroOv}` : '',
              row.proforma ? `PROFORMA ${row.proforma}` : ''
            ].filter(Boolean).join(' / '),
            ordenCompra: productResult.ordenCompra,
            destinatario,
            destinos,
            productos: productResult.productos
          });
        }
      } finally {
        await bizlinksPool.close();
      }

      const responseDocuments = shouldCombineAbbreviatedOtSearch(normalizedOt)
        ? combineDocumentsForSameRecipient(documents)
        : documents;
      const hasProducts = responseDocuments.some((document) => document.productos.length > 0);
      const hasRecipientAndDestination = responseDocuments.some((document) => document.destinatario && document.destinos.length > 0);
      const usedAnyDestinationFallback = usedYchiDestinations || usedHistoricalDestinations;
      const warnings = [
        usedYchiDestinations
          ? 'Destino cargado desde YCHIDB3.'
          : '',
        usedHistoricalDestinations && destinosError
          ? 'Destino cargado desde historial Bizlinks.'
          : '',
        ...uniqueValues(productWarnings)
      ].filter(Boolean);

      return {
        status: destinosError && !usedAnyDestinationFallback
          ? 'DESTINOS_ERROR'
          : hasProducts && !hasRecipientAndDestination
            ? 'CLIENTE_SIN_DESTINOS'
            : hasProducts
              ? 'OT_DISPONIBLE'
              : 'OT_SIN_DETALLES',
        documents: responseDocuments,
        message: destinosError && !usedAnyDestinationFallback
          ? destinosError
          : !hasProducts
          ? `La OT ${normalizedOt} existe, pero no tiene detalles en VW_DETGUIA_REMISION`
          : hasRecipientAndDestination
            ? usedHistoricalDestinations
              ? `OT ${normalizedOt} disponible con destino historico Bizlinks`
              : `OT ${normalizedOt} disponible`
            : `El cliente de esta OT no tiene destinos registrados.`,
        warnings
      };
    } finally {
      await pool.close();
    }
  }

  async searchByPhysicalGuide(guiaInput: string): Promise<WorkOrderSearchResult> {
    const parsed = parsePhysicalGuideInput(guiaInput);
    if (!parsed) {
      return {
        status: 'OT_NO_ENCONTRADA',
        documents: [],
        message: 'Formato de guía física no válido. Ingrese SERIE-NUMERO (ej: 001-0112948).'
      };
    }

    const pool = createYchiPool(this.config);
    await pool.connect();

    try {
      const request = new sql.Request(pool);
      request.input('serie', sql.VarChar(20), parsed.serie);
      request.input('numero', sql.VarChar(20), parsed.numero);

      const docResult = await request.query<{
        idDocumento: number;
        SeriDocu: string;
        NumeDocu: string;
        DescClieProv: string | null;
        Encargado: string | null;
      }>(`
        SELECT TOP (1)
          idDocumento,
          SeriDocu,
          NumeDocu,
          DescClieProv,
          Encargado
        FROM dbo.tbDocumentos
        WHERE idTipoDocu = 8
          AND SeriDocu = @serie
          AND NumeDocu = @numero
      `);

      if (docResult.recordset.length === 0) {
        return {
          status: 'OT_NO_ENCONTRADA',
          documents: [],
          message: `No se encontró la Guía Física ${parsed.serie}-${parsed.numero} en tbDocumentos.`
        };
      }

      const doc = docResult.recordset[0]!;
      const idDocumento = doc.idDocumento;

      const bizlinksPool = createBizlinksPool(this.config);
      await bizlinksPool.connect();

      let destinosError: string | null = null;
      let usedHistoricalDestinations = false;
      let usedYchiDestinations = false;

      try {
        const productsRequest = new sql.Request(pool);
        productsRequest.input('idDocumento', sql.Int, idDocumento);
        const productsResult = await productsRequest.query<ProductRow>(`
          SELECT
            idDetGuia,
            idOrdenVenta,
            FORMATO AS formato,
            MEDIDA AS medida,
            TIRA AS tira,
            RETIRA AS retira,
            PAPEL AS papel,
            idDocumentos,
            UNIDAD AS unidad,
            Cantidad AS cantidad,
            NumeroDel AS numeroDel,
            NumeroAl AS numeroAl,
            Serie AS serie
          FROM dbo.VW_DETGUIA_REMISION
          WHERE idDocumentos = @idDocumento
          ORDER BY idDetGuia
        `);

        const orderPurchaseResult = await getOrderPurchasesByDocumentIds(pool, [idDocumento]);
        const recipientResult = await getRecipientByDocumentIds(pool, [idDocumento]);
        const destinationResult = await getDestinosFromYchiByDocumentIds(pool, [idDocumento]);

        const destinatario = recipientResult.destinatario;
        let destinos = destinationResult.destinos;
        usedYchiDestinations = destinos.length > 0;

        if (destinatario && destinos.length === 0) {
          try {
            destinos = await this.existingGreClient.getDestinos(destinatario.numeroDocumentoDestinatario);
          } catch (error) {
            if (error instanceof ExistingGreClientError) {
              destinosError = error.message;
              destinos = await getDestinosFromBizlinksHistory(bizlinksPool, destinatario.numeroDocumentoDestinatario);
              usedHistoricalDestinations = destinos.length > 0;
            } else {
              throw error;
            }
          }
        }

        const productos = productsResult.recordset.map((row) => {
          const cantidad = Number(row.cantidad ?? 0);
          return {
            codigoProducto: String(row.idDetGuia ?? ''),
            descripcion: buildDescription(row),
            cantidad,
            cantidadOriginal: cantidad,
            cantidadPendiente: 0,
            incluido: true,
            unidadMedida: mapUnidadMedida(row.unidad),
            id: String(row.idDetGuia ?? row.idDocumentos ?? '')
          };
        });

        const document: WorkOrderDocument = {
          idDocumentos: String(idDocumento),
          numeroOt: '',
          cliente: doc.DescClieProv ?? '',
          fecha: '',
          referencia: `GUIA FÍSICA ${doc.SeriDocu}-${doc.NumeDocu}`,
          ordenCompra: orderPurchaseResult.ordenCompra,
          destinatario,
          destinos,
          productos
        };

        const warnings = [
          usedYchiDestinations ? 'Destino cargado desde YCHIDB3.' : '',
          usedHistoricalDestinations && destinosError ? 'Destino cargado desde historial Bizlinks.' : '',
          orderPurchaseResult.warning,
          recipientResult.warning,
          destinationResult.warning
        ].filter(Boolean);

        const hasProducts = productos.length > 0;
        const hasRecipientAndDestination = destinatario && destinos.length > 0;
        const usedAnyDestinationFallback = usedYchiDestinations || usedHistoricalDestinations;

        return {
          status: destinosError && !usedAnyDestinationFallback
            ? 'DESTINOS_ERROR'
            : hasProducts && !hasRecipientAndDestination
              ? 'CLIENTE_SIN_DESTINOS'
              : hasProducts
                ? 'OT_DISPONIBLE'
                : 'OT_SIN_DETALLES',
          documents: [document],
          message: destinosError && !usedAnyDestinationFallback
            ? destinosError
            : !hasProducts
              ? `La Guía Física ${parsed.serie}-${parsed.numero} existe, pero no tiene detalles en VW_DETGUIA_REMISION.`
              : hasRecipientAndDestination
                ? `Guía Física ${parsed.serie}-${parsed.numero} disponible`
                : `El cliente de esta guía no tiene destinos registrados.`,
          warnings
        };

      } finally {
        await bizlinksPool.close();
      }
    } finally {
      await pool.close();
    }
  }

  async getDestinos(numeroDocumento: string) {
    const normalized = numeroDocumento.trim();

    try {
      return {
        numeroDocumento: normalized,
        destinos: await this.existingGreClient.getDestinos(normalized),
        warnings: [] as string[]
      };
    } catch (error) {
      if (!(error instanceof ExistingGreClientError)) throw error;

      const bizlinksPool = createBizlinksPool(this.config);
      await bizlinksPool.connect();

      try {
        return {
          numeroDocumento: normalized,
          destinos: await getDestinosFromBizlinksHistory(bizlinksPool, normalized),
          warnings: [`Destino cargado desde historial Bizlinks porque GetDestino no respondio: ${error.message}`]
        };
      } finally {
        await bizlinksPool.close();
      }
    }
  }

  async searchDrivers(): Promise<DriverCatalogItem[]> {
    const pool = createBizlinksPool(this.config);
    await pool.connect();

    try {
      const result = await new sql.Request(pool).query<DriverRow>(`
        SELECT
          NUMERODOCUMENTOCHOFER,
          TIPODOCUMENTOCHOFER,
          NOMBRE,
          APELLIDO,
          BREVETE,
          PLACAVEHICULO
        FROM dbo.AAA_CHOFER
        ORDER BY NOMBRE, APELLIDO, NUMERODOCUMENTOCHOFER
      `);

      return result.recordset.map(normalizeDriver);
    } finally {
      await pool.close();
    }
  }

  async getNextSerie(serie: GreFcSerie = GRE_FC_DEFAULT_SERIE): Promise<NextSerieResult> {
    const pool = createBizlinksPool(this.config);
    await pool.connect();

    try {
      const request = new sql.Request(pool);
      request.input('seriePrefix', sql.VarChar(6), `${serie}-%`);

      const result = await request.query<{ nextNumber: number }>(`
        SELECT ISNULL(MAX(
          CASE
            WHEN ISNUMERIC(RIGHT(serieNumeroGuia, 8)) = 1 THEN CONVERT(int, RIGHT(serieNumeroGuia, 8))
            ELSE NULL
          END
        ), 0) + 1 AS nextNumber
        FROM dbo.SPE_DESPATCH
        WHERE serieNumeroGuia LIKE @seriePrefix
      `);
      const nextNumber = result.recordset[0]?.nextNumber ?? 1;
      const numero = String(nextNumber).padStart(8, '0');

      return {
        serie,
        numero,
        serieNumeroGuia: `${serie}-${numero}`,
        reserved: false
      };
    } finally {
      await pool.close();
    }
  }

  async privateDriverExists(driver: {
    tipoDocumentoConductor: string;
    numeroDocumentoConductor: string;
    nombreConductor: string;
    apellidoConductor: string;
    numeroLicencia: string;
    numeroPlacaVehiculoPrin: string;
  }) {
    const pool = createBizlinksPool(this.config);
    await pool.connect();

    try {
      return await privateDriverExists(pool, driver);
    } finally {
      await pool.close();
    }
  }

  async searchRecipients(query: string): Promise<RecipientSearchResult[]> {
    const normalizedQuery = query.trim();
    const greFcPool = createGreFcPool(this.config);
    const bizlinksPool = createBizlinksPool(this.config);

    await greFcPool.connect();
    await bizlinksPool.connect();

    try {
      const rows = [
        ...await searchRecipientsFromGreFc(greFcPool, normalizedQuery),
        ...await searchRecipientsFromBizlinks(bizlinksPool, normalizedQuery)
      ];
      const byDocument = new Map<string, RecipientSearchResult>();

      for (const row of rows) {
        const numeroDocumento = row.numeroDocumentoDestinatario?.trim();
        const razonSocial = row.razonSocialDestinatario?.trim();

        if (!numeroDocumento || !razonSocial) continue;

        const tipoDocumento = row.tipoDocumentoDestinatario?.trim() || '6';
        const id = `${tipoDocumento}-${numeroDocumento}`;
        const existing = byDocument.get(id) ?? {
          id,
          tipoDocumentoDestinatario: tipoDocumento,
          numeroDocumentoDestinatario: numeroDocumento,
          razonSocialDestinatario: razonSocial,
          direcciones: []
        };
        const direccion = row.direccionPtoLLegada?.trim();

        if (direccion && !existing.direcciones.some((address) => address.direccion === direccion)) {
          existing.direcciones.push({
            id: `${id}-${existing.direcciones.length + 1}`,
            ubigeo: row.ubigeoPtoLLegada?.trim() || undefined,
            direccion
          });
        }

        byDocument.set(id, existing);
      }

      return [...byDocument.values()].slice(0, 50);
    } finally {
      await bizlinksPool.close();
      await greFcPool.close();
    }
  }

  async listGuides(): Promise<GuideStatusResult[]> {
    const greFcPool = createGreFcPool(this.config);
    await greFcPool.connect();

    try {
      const result = await new sql.Request(greFcPool).query<OperationRow>(`
        SELECT TOP (100)
          CONVERT(varchar(36), o.idOperacion) AS operationId,
          e.serieNumeroGuia,
          o.estado AS estadoOperacion,
          e.estado AS estadoEnvio,
          e.mensaje AS mensajeEnvio,
          o.creadoEn,
          o.actualizadoEn,
          CASE WHEN EXISTS (
            SELECT 1
            FROM dbo.GRE_FC_EVENTO ev
            WHERE ev.operacionId = o.id
              AND ev.tipo = 'OT_LIBERADA_YCHIDB3'
          ) THEN 1 ELSE 0 END AS otsLiberadas,
          COUNT(d.id) AS items
        FROM dbo.GRE_FC_OPERACION o
        LEFT JOIN dbo.GRE_FC_ENVIO e
          ON e.operacionId = o.id
        LEFT JOIN dbo.GRE_FC_DETALLE d
          ON d.operacionId = o.id
        GROUP BY
          o.idOperacion,
          e.serieNumeroGuia,
          o.estado,
          e.estado,
          e.mensaje,
          o.creadoEn,
          o.actualizadoEn,
          o.id
        ORDER BY o.creadoEn DESC
      `);

      return await this.withBizlinksStatuses(result.recordset);
    } finally {
      await greFcPool.close();
    }
  }

  async getStatus(operationId: string): Promise<GuideStatusResult | null> {
    const greFcPool = createGreFcPool(this.config);
    await greFcPool.connect();

    try {
      const request = new sql.Request(greFcPool);
      request.input('operationId', sql.UniqueIdentifier, operationId);

      const result = await request.query<OperationRow>(`
        SELECT TOP (1)
          CONVERT(varchar(36), o.idOperacion) AS operationId,
          e.serieNumeroGuia,
          o.estado AS estadoOperacion,
          e.estado AS estadoEnvio,
          e.mensaje AS mensajeEnvio,
          o.creadoEn,
          o.actualizadoEn,
          CASE WHEN EXISTS (
            SELECT 1
            FROM dbo.GRE_FC_EVENTO ev
            WHERE ev.operacionId = o.id
              AND ev.tipo = 'OT_LIBERADA_YCHIDB3'
          ) THEN 1 ELSE 0 END AS otsLiberadas,
          COUNT(d.id) AS items
        FROM dbo.GRE_FC_OPERACION o
        LEFT JOIN dbo.GRE_FC_ENVIO e
          ON e.operacionId = o.id
        LEFT JOIN dbo.GRE_FC_DETALLE d
          ON d.operacionId = o.id
        WHERE o.idOperacion = @operationId
        GROUP BY
          o.idOperacion,
          e.serieNumeroGuia,
          o.estado,
          e.estado,
          e.mensaje,
          o.creadoEn,
          o.actualizadoEn,
          o.id
      `);
      const statuses = await this.withBizlinksStatuses(result.recordset);

      return statuses[0] ?? null;
    } finally {
      await greFcPool.close();
    }
  }

  async getGuidePdfUrl(serieNumeroGuia: string) {
    if (!GRE_FC_SERIE_PATTERN.test(serieNumeroGuia)) {
      return null;
    }

    const greFcPool = createGreFcPool(this.config);
    const bizlinksPool = createBizlinksPool(this.config);

    await greFcPool.connect();
    await bizlinksPool.connect();

    try {
      const traceRequest = new sql.Request(greFcPool);
      traceRequest.input('serieNumeroGuia', sql.VarChar(20), serieNumeroGuia);

      const trace = await traceRequest.query<{ total: number }>(`
        SELECT COUNT(1) AS total
        FROM dbo.GRE_FC_ENVIO
        WHERE serieNumeroGuia = @serieNumeroGuia
      `);

      if ((trace.recordset[0]?.total ?? 0) !== 1) return null;

      const pdfRequest = new sql.Request(bizlinksPool);
      pdfRequest.input('serieNumeroGuia', sql.VarChar(20), serieNumeroGuia);

      const pdf = await pdfRequest.query<{ bl_url_pdf: string | null }>(`
        SELECT TOP (1)
          bl_url_pdf
        FROM dbo.SPE_DESPATCH_RESPONSE
        WHERE serieNumeroGuia = @serieNumeroGuia
      `);
      const row = pdf.recordset[0];
      const url = row?.bl_url_pdf?.trim();

      if (!url) {
        return null;
      }

      return isAllowedBizlinksFileUrl(url) ? url : null;
    } finally {
      await bizlinksPool.close();
      await greFcPool.close();
    }
  }

  private async withBizlinksStatuses(rows: OperationRow[]) {
    const bizlinksPool = createBizlinksPool(this.config);
    await bizlinksPool.connect();

    try {
      const series = rows.map((row) => row.serieNumeroGuia).filter((serie): serie is string => Boolean(serie));
      const bizlinks = await getBizlinksStatuses(bizlinksPool, series);

      return rows.map((row) => {
        const bizlinksStatus = row.serieNumeroGuia ? bizlinks.get(row.serieNumeroGuia) : undefined;

        return {
          operationId: row.operationId,
          serieNumeroGuia: row.serieNumeroGuia,
          estado: mapGuideStatusForReport(row, bizlinksStatus),
          estadoOperacion: row.estadoOperacion,
          estadoEnvio: row.estadoEnvio,
          estadoBizlinks: bizlinksStatus?.bl_estadoRegistro ?? bizlinksStatus?.responseEstadoRegistro ?? null,
          estadoProceso: bizlinksStatus?.bl_estadoProceso ?? null,
          mensaje: displayStatusMessage(row, bizlinksStatus),
          respuestaSunat: bizlinksStatus?.bl_mensajeSunat ?? null,
          pdfDisponible: Boolean(row.serieNumeroGuia && GRE_FC_SERIE_PATTERN.test(row.serieNumeroGuia) && bizlinksStatus?.bl_url_pdf && isAllowedBizlinksFileUrl(bizlinksStatus.bl_url_pdf)),
          manualSunatMessageAllowed: Boolean(row.serieNumeroGuia && GRE_FC_SERIE_PATTERN.test(row.serieNumeroGuia) && bizlinksStatus && isEligibleForManualSunatMessage({
            bl_estadoRegistro: bizlinksStatus.responseEstadoRegistro ?? bizlinksStatus.bl_estadoRegistro,
            bl_estadoProceso: bizlinksStatus.bl_estadoProceso,
            process_state: bizlinksStatus.process_state,
            bl_mensajeSunat: bizlinksStatus.bl_mensajeSunat
          })),
          releaseOtAllowed: Boolean(
            row.serieNumeroGuia
            && GRE_FC_SERIE_PATTERN.test(row.serieNumeroGuia)
            && row.otsLiberadas === 0
            && row.items > 0
            && (row.estadoOperacion === 'ACTIVADO' || row.estadoEnvio === 'ACTIVADO' || bizlinksStatus)
          ),
          workOrdersReleased: row.otsLiberadas > 0,
          items: row.items,
          creadoEn: row.creadoEn?.toISOString() ?? null,
          actualizadoEn: row.actualizadoEn?.toISOString() ?? null
        };
      });
    } finally {
      await bizlinksPool.close();
    }
  }
}

export async function privateDriverExists(pool: sql.ConnectionPool | sql.Transaction, driver: {
  tipoDocumentoConductor: string;
  numeroDocumentoConductor: string;
  nombreConductor: string;
  apellidoConductor: string;
  numeroLicencia: string;
  numeroPlacaVehiculoPrin: string;
}) {
  const request = createSqlRequest(pool);
  request.input('tipoDocumento', sql.NVarChar(50), driver.tipoDocumentoConductor.trim());
  request.input('numeroDocumento', sql.NVarChar(50), driver.numeroDocumentoConductor.trim());
  request.input('nombres', sql.NVarChar(50), driver.nombreConductor.trim());
  request.input('apellidos', sql.NVarChar(50), driver.apellidoConductor.trim());
  request.input('licencia', sql.NVarChar(50), driver.numeroLicencia.trim());
  request.input('placa', sql.NVarChar(50), driver.numeroPlacaVehiculoPrin.trim());

  const result = await request.query<{ total: number }>(`
    SELECT COUNT(1) AS total
    FROM dbo.AAA_CHOFER
    WHERE TIPODOCUMENTOCHOFER = @tipoDocumento
      AND NUMERODOCUMENTOCHOFER = @numeroDocumento
      AND NOMBRE = @nombres
      AND APELLIDO = @apellidos
      AND BREVETE = @licencia
      AND PLACAVEHICULO = @placa
  `);

  return (result.recordset[0]?.total ?? 0) === 1;
}

function createSqlRequest(poolOrTransaction: sql.ConnectionPool | sql.Transaction) {
  return poolOrTransaction instanceof sql.Transaction
    ? new sql.Request(poolOrTransaction)
    : new sql.Request(poolOrTransaction);
}

async function getProductsByIdOrdenVenta(pool: sql.ConnectionPool, idOrdenVenta: number | null) {
  if (!idOrdenVenta) {
    return {
      ordenCompra: '',
      destinatario: null,
      destinos: [],
      productos: [],
      warnings: []
    };
  }

  const request = new sql.Request(pool);
  request.input('idOrdenVenta', sql.Int, idOrdenVenta);

  const result = await request.query<ProductRow>(`
    SELECT TOP (200)
      idDetGuia,
      idOrdenVenta,
      FORMATO AS formato,
      MEDIDA AS medida,
      TIRA AS tira,
      RETIRA AS retira,
      PAPEL AS papel,
      idDocumentos,
      UNIDAD AS unidad,
      Cantidad AS cantidad,
      NumeroDel AS numeroDel,
      NumeroAl AS numeroAl,
      Serie AS serie
    FROM dbo.VW_DETGUIA_REMISION
    WHERE idOrdenVenta = @idOrdenVenta
      AND ISNULL(idDocumentos, 0) > 0
    ORDER BY idDetGuia
  `);
  const documentIds = result.recordset.map((row) => row.idDocumentos);
  const orderPurchaseResult = await getOrderPurchasesByDocumentIds(pool, documentIds);
  const recipientResult = await getRecipientByDocumentIds(pool, documentIds);
  const destinationResult = await getDestinosFromYchiByDocumentIds(pool, documentIds);

  return {
    ordenCompra: orderPurchaseResult.ordenCompra,
    destinatario: recipientResult.destinatario,
    destinos: destinationResult.destinos,
    warnings: [
      orderPurchaseResult.warning,
      recipientResult.warning,
      destinationResult.warning
    ].filter(Boolean),
    productos: result.recordset.map((row) => {
      const cantidad = Number(row.cantidad ?? 0);

      return {
        codigoProducto: String(row.idDetGuia ?? ''),
        descripcion: buildDescription(row),
        cantidad,
        cantidadOriginal: cantidad,
        cantidadPendiente: 0,
        incluido: true,
        unidadMedida: mapUnidadMedida(row.unidad),
        id: String(row.idDetGuia ?? row.idDocumentos ?? '')
      };
    })
  };
}

async function getOrderPurchasesByDocumentIds(pool: sql.ConnectionPool, ids: Array<number | null>) {
  const documentIds = [...new Set(ids.filter((id): id is number => id !== null && Number.isInteger(id) && id > 0))];
  if (documentIds.length === 0) {
    return {
      ordenCompra: '',
      warning: ''
    };
  }

  const request = new sql.Request(pool);
  const params = documentIds.map((id, index) => {
    const name = `idDocumento${index}`;
    request.input(name, sql.Int, id);
    return `@${name}`;
  });

  try {
    const result = await request.query<{ ordenCompra: string | null }>(`
      SELECT DISTINCT
        Encargado AS ordenCompra
      FROM dbo.tbDocumentos
      WHERE idDocumento IN (${params.join(', ')})
        AND NULLIF(LTRIM(RTRIM(Encargado)), '') IS NOT NULL
      ORDER BY Encargado
    `);

    return {
      ordenCompra: uniqueValues(result.recordset.map((row) => row.ordenCompra ?? '')).join(' / '),
      warning: ''
    };
  } catch (error) {
    return {
      ordenCompra: '',
      warning: error instanceof Error
        ? `No se pudo leer Orden de compra desde tbDocumentos (${error.message}).`
        : 'No se pudo leer Orden de compra desde tbDocumentos.'
    };
  }
}

async function getRecipientByDocumentIds(pool: sql.ConnectionPool, ids: Array<number | null>): Promise<{
  destinatario: WorkOrderRecipient | null;
  warning: string;
}> {
  const documentIds = [...new Set(ids.filter((id): id is number => id !== null && Number.isInteger(id) && id > 0))];
  if (documentIds.length === 0) {
    return {
      destinatario: null,
      warning: ''
    };
  }

  const request = new sql.Request(pool);
  const params = documentIds.map((id, index) => {
    const name = `recipientDocumento${index}`;
    request.input(name, sql.Int, id);
    return `@${name}`;
  });

  try {
    const result = await request.query<YchiRecipientRow>(`
      SELECT DISTINCT
        CASE WHEN LEN(LTRIM(RTRIM(c.RUC))) = 11 THEN '6' ELSE '1' END AS tipoDocumentoDestinatario,
        NULLIF(LTRIM(RTRIM(c.RUC)), '') AS numeroDocumentoDestinatario,
        NULLIF(LTRIM(RTRIM(c.Nombre)), '') AS razonSocialDestinatario
      FROM dbo.tbDocumentos doc
      INNER JOIN dbo.tbClieProv c
        ON c.idClieProv = doc.idClieProv
      WHERE doc.idDocumento IN (${params.join(', ')})
        AND NULLIF(LTRIM(RTRIM(c.RUC)), '') IS NOT NULL
        AND NULLIF(LTRIM(RTRIM(c.Nombre)), '') IS NOT NULL
      ORDER BY razonSocialDestinatario, numeroDocumentoDestinatario
    `);
    const recipients = result.recordset
      .map((row) => {
        const numeroDocumento = row.numeroDocumentoDestinatario?.trim();
        const razonSocial = row.razonSocialDestinatario?.trim();
        const tipoDocumento = row.tipoDocumentoDestinatario?.trim() || '6';

        if (!numeroDocumento || !razonSocial) return null;

        return {
          tipoDocumentoDestinatario: tipoDocumento,
          numeroDocumentoDestinatario: numeroDocumento,
          razonSocialDestinatario: razonSocial,
          fuente: 'YCHIDB3' as const
        };
      })
      .filter((recipient): recipient is WorkOrderRecipient & { fuente: 'YCHIDB3' } => Boolean(recipient));

    if (recipients.length === 1) {
      return {
        destinatario: recipients[0]!,
        warning: ''
      };
    }

    if (recipients.length > 1) {
      return {
        destinatario: null,
        warning: `La OT tiene ${recipients.length} destinatarios distintos en tbDocumentos/tbClieProv. Seleccione manualmente.`
      };
    }

    return {
      destinatario: null,
      warning: ''
    };
  } catch (error) {
    return {
      destinatario: null,
      warning: error instanceof Error
        ? `No se pudo leer destinatario desde tbClieProv (${error.message}).`
        : 'No se pudo leer destinatario desde tbClieProv.'
    };
  }
}

async function getDestinosFromYchiByDocumentIds(pool: sql.ConnectionPool, ids: Array<number | null>): Promise<{
  destinos: GreDestino[];
  warning: string;
}> {
  const documentIds = [...new Set(ids.filter((id): id is number => id !== null && Number.isInteger(id) && id > 0))];
  if (documentIds.length === 0) {
    return {
      destinos: [],
      warning: ''
    };
  }

  const request = new sql.Request(pool);
  const params = documentIds.map((id, index) => {
    const name = `destinationDocumento${index}`;
    request.input(name, sql.Int, id);
    return `@${name}`;
  });

  try {
    const result = await request.query<YchiDestinationRow>(`
      WITH Clientes AS (
        SELECT DISTINCT
          c.idClieProv,
          NULLIF(LTRIM(RTRIM(c.RUC)), '') AS RUC,
          NULLIF(LTRIM(RTRIM(c.Direccion)), '') AS direccionPrincipal,
          NULLIF(LTRIM(RTRIM(c.ubigeo)), '') AS ubigeoCliente,
          dpto.nombre AS departamentoNombre,
          prov.nombre AS provinciaNombre,
          dist.nombre AS distritoNombre
        FROM dbo.tbDocumentos doc
        INNER JOIN dbo.tbClieProv c
          ON c.idClieProv = doc.idClieProv
        LEFT JOIN dbo.tbDepartamento dpto
          ON dpto.idDepartamento = c.idDepartamento
        LEFT JOIN dbo.tbProvincia prov
          ON prov.idProvincia = c.IdProvincia
        LEFT JOIN dbo.tbDistrito dist
          ON dist.idDistrito = c.IdDistrito
        WHERE doc.idDocumento IN (${params.join(', ')})
          AND NULLIF(LTRIM(RTRIM(c.RUC)), '') IS NOT NULL
      ),
      Direcciones AS (
        SELECT
          c.idClieProv,
          CAST(NULL AS int) AS idClieDireccion,
          c.direccionPrincipal AS direccion,
          0 AS orden
        FROM Clientes c
        WHERE c.direccionPrincipal IS NOT NULL

        UNION ALL

        SELECT
          cd.idclieprov AS idClieProv,
          cd.idcliedireccion AS idClieDireccion,
          NULLIF(LTRIM(RTRIM(cd.direccion)), '') AS direccion,
          1 AS orden
        FROM dbo.tbcliedireccion cd
        INNER JOIN Clientes c
          ON c.idClieProv = cd.idclieprov
        WHERE NULLIF(LTRIM(RTRIM(cd.direccion)), '') IS NOT NULL
      ),
      DireccionesConCodigo AS (
        SELECT
          d.*,
          ROW_NUMBER() OVER (PARTITION BY d.idClieProv ORDER BY d.orden, d.idClieDireccion) AS codigoDestino
        FROM Direcciones d
      )
      SELECT
        d.idClieProv,
        d.idClieDireccion,
        d.codigoDestino,
        COALESCE(
          CASE WHEN d.orden = 1 THEN ubigeoPorDireccion.[CODIGO UBIGEO] END,
          CASE WHEN c.ubigeoCliente LIKE '[0-9][0-9][0-9][0-9][0-9][0-9]' THEN c.ubigeoCliente END,
          ubigeoPorCliente.[CODIGO UBIGEO]
        ) AS ubigeo,
        d.direccion
      FROM DireccionesConCodigo d
      INNER JOIN Clientes c
        ON c.idClieProv = d.idClieProv
      OUTER APPLY (
        SELECT TOP (1)
          u.[CODIGO UBIGEO]
        FROM dbo.CatalogoUbigeo u
        WHERE c.departamentoNombre IS NOT NULL
          AND c.provinciaNombre IS NOT NULL
          AND c.distritoNombre IS NOT NULL
          AND UPPER(LTRIM(RTRIM(u.DEPARTAMENTO))) COLLATE DATABASE_DEFAULT = UPPER(LTRIM(RTRIM(c.departamentoNombre))) COLLATE DATABASE_DEFAULT
          AND UPPER(LTRIM(RTRIM(u.PROVINCIA))) COLLATE DATABASE_DEFAULT = UPPER(LTRIM(RTRIM(c.provinciaNombre))) COLLATE DATABASE_DEFAULT
          AND UPPER(LTRIM(RTRIM(u.DISTRITO))) COLLATE DATABASE_DEFAULT = UPPER(LTRIM(RTRIM(c.distritoNombre))) COLLATE DATABASE_DEFAULT
      ) ubigeoPorCliente
      OUTER APPLY (
        SELECT TOP (1)
          u.[CODIGO UBIGEO]
        FROM dbo.CatalogoUbigeo u
        WHERE LEN(LTRIM(RTRIM(u.DISTRITO))) >= 4
          AND UPPER(CONVERT(nvarchar(250), d.direccion)) COLLATE DATABASE_DEFAULT
            LIKE N'%' + UPPER(LTRIM(RTRIM(u.DISTRITO))) COLLATE DATABASE_DEFAULT + N'%'
        ORDER BY
          CASE
            WHEN UPPER(LTRIM(RTRIM(u.PROVINCIA))) COLLATE DATABASE_DEFAULT = 'LIMA'
             AND UPPER(LTRIM(RTRIM(u.DEPARTAMENTO))) COLLATE DATABASE_DEFAULT = 'LIMA'
            THEN 0
            ELSE 1
          END,
          LEN(LTRIM(RTRIM(u.DISTRITO))) DESC,
          u.[CODIGO UBIGEO]
      ) ubigeoPorDireccion
      ORDER BY d.orden, d.idClieDireccion
    `);
    const destinos = normalizeYchiDestinations(result.recordset);
    const skippedRows = result.recordset.length - destinos.length;

    return {
      destinos,
      warning: skippedRows > 0
        ? `Se omitieron ${skippedRows} destino(s) de YCHIDB3 sin ubigeo valido.`
        : ''
    };
  } catch (error) {
    return {
      destinos: [],
      warning: error instanceof Error
        ? `No se pudo leer destinos desde YCHIDB3 (${error.message}).`
        : 'No se pudo leer destinos desde YCHIDB3.'
    };
  }
}

export function normalizeYchiDestinations(rows: YchiDestinationRow[]): GreDestino[] {
  const byAddress = new Map<string, GreDestino>();

  for (const row of rows) {
    const ubigeo = row.ubigeo?.trim() ?? '';
    const direccion = normalizeHistoricalAddress(row.direccion);

    if (!/^\d{6}$/.test(ubigeo) || !direccion) continue;

    const codigoDestino = String(row.codigoDestino ?? byAddress.size + 1);
    const key = `${ubigeo}-${direccion.toUpperCase()}`;

    if (!byAddress.has(key)) {
      byAddress.set(key, {
        id: `YCHIDB3-${row.idClieProv ?? 'CLIENTE'}-${row.idClieDireccion ?? 'PRINCIPAL'}-${ubigeo}`,
        codigoDestino,
        ubigeo,
        direccion,
        textoOriginal: `${ubigeo}-${direccion}`
      });
    }
  }

  return [...byAddress.values()];
}

export function buildOtSearchTerms(input: string, currentDate = new Date()) {
  const trimmed = input.trim();
  const normalized = normalizeOtInput(trimmed);
  if (!normalized) return [];

  const terms = new Set<string>([trimmed, normalized]);
  const compactOt = normalized.replace(/^OT-/, 'OT');
  terms.add(compactOt);

  const digits = normalized.replace(/\D+/g, '');
  if (digits.length >= 6) {
    terms.add(digits);
    terms.add(`OT${digits}`);
  }

  const abbreviatedNumbers = extractAbbreviatedOtNumbers(normalized);

  if (abbreviatedNumbers.length > 0) {
    const yearSuffix = String(currentDate.getFullYear()).slice(-2);
    const prefix = `OT0${yearSuffix}`;

    for (const number of abbreviatedNumbers) {
      terms.add(`${prefix}${number.padStart(5, '0')}`);
    }
  }

  return [...terms].filter(Boolean);
}

function normalizeOtInput(value: string) {
  return value.trim().toUpperCase().replace(/\s+/g, '');
}

function extractAbbreviatedOtNumbers(normalized: string) {
  const direct = /^(?:OT-?)?(\d{1,5}(?:-\d{1,5})*)$/.exec(normalized);
  const embedded = /OT-?(\d{1,5}(?:-\d{1,5})*)(?!\d)/.exec(normalized);
  const body = direct?.[1] ?? embedded?.[1] ?? '';

  return body.split('-').filter(Boolean);
}

function shouldCombineAbbreviatedOtSearch(input: string) {
  return extractAbbreviatedOtNumbers(normalizeOtInput(input)).length > 1;
}

function combineDocumentsForSameRecipient(documents: WorkOrderDocument[]) {
  if (documents.length <= 1) return documents;

  const recipientKeys = new Set(documents.map((document) => {
    return document.destinatario?.numeroDocumentoDestinatario
      ?? document.cliente.trim().toUpperCase();
  }));

  if (recipientKeys.size !== 1) return documents;

  const first = documents[0];
  if (!first) return documents;

  return [{
    ...first,
    idDocumentos: uniqueValues(documents.map((document) => document.idDocumentos)).join(','),
    numeroOt: uniqueValues(documents.map((document) => document.numeroOt)).join(' / '),
    referencia: uniqueValues(documents.map((document) => document.referencia).filter(Boolean)).join(' / '),
    ordenCompra: uniqueValues(documents.map((document) => document.ordenCompra).filter(Boolean)).join(' / '),
    destinos: combineDestinations(documents.flatMap((document) => document.destinos)),
    productos: combineProducts(documents.flatMap((document) => document.productos))
  }];
}

function combineProducts(products: WorkOrderProduct[]) {
  const seenIds = new Set<string>();
  const uniqueProducts: WorkOrderProduct[] = [];

  for (const product of products) {
    if (!seenIds.has(product.id)) {
      seenIds.add(product.id);
      uniqueProducts.push(product);
    }
  }

  return uniqueProducts;
}

function combineDestinations(destinations: GreDestino[]) {
  const byAddress = new Map<string, GreDestino>();

  for (const destination of destinations) {
    const key = `${destination.ubigeo}-${destination.direccion.trim().toUpperCase()}`;
    if (!byAddress.has(key)) {
      byAddress.set(key, destination);
    }
  }

  return [...byAddress.values()];
}

function uniqueValues(values: string[]) {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function sortRowsBySearchTerms(rows: WorkOrderRow[], searchTerms: string[]) {
  const order = new Map(searchTerms.map((term, index) => [normalizeOtInput(term), index]));

  return [...rows].sort((left, right) => {
    const leftOrder = order.get(normalizeOtInput(left.numeroOt ?? '')) ?? Number.MAX_SAFE_INTEGER;
    const rightOrder = order.get(normalizeOtInput(right.numeroOt ?? '')) ?? Number.MAX_SAFE_INTEGER;

    return leftOrder - rightOrder;
  });
}

async function searchRecipientsFromGreFc(pool: sql.ConnectionPool, query: string) {
  const request = new sql.Request(pool);
  request.input('query', sql.NVarChar(250), `%${query}%`);

  return (await request.query<RecipientRow>(`
    SELECT DISTINCT TOP (50)
      tipoDocumentoDestinatario,
      numeroDocumentoDestinatario,
      razonSocialDestinatario,
      ubigeoPtoLlegada AS ubigeoPtoLLegada,
      direccionPtoLlegada AS direccionPtoLLegada
    FROM dbo.GRE_FC_OPERACION
    WHERE @query = '%%'
      OR numeroDocumentoDestinatario LIKE @query
      OR razonSocialDestinatario LIKE @query
    ORDER BY razonSocialDestinatario
  `)).recordset;
}

async function searchRecipientsFromBizlinks(pool: sql.ConnectionPool, query: string) {
  const request = new sql.Request(pool);
  request.input('query', sql.NVarChar(250), `%${query}%`);
  GRE_FC_ALLOWED_SERIES.forEach((serie, index) => {
    request.input(`serie${index}`, sql.VarChar(6), `${serie}-%`);
  });

  return (await request.query<RecipientRow>(`
    SELECT DISTINCT TOP (50)
      tipoDocumentoDestinatario,
      numeroDocumentoDestinatario,
      razonSocialDestinatario,
      ubigeoPtoLLegada,
      direccionPtoLLegada
    FROM dbo.SPE_DESPATCH
    WHERE (${GRE_FC_ALLOWED_SERIES.map((_, index) => `serieNumeroGuia LIKE @serie${index}`).join(' OR ')})
      AND (
        @query = '%%'
        OR numeroDocumentoDestinatario LIKE @query
        OR razonSocialDestinatario LIKE @query
      )
    ORDER BY razonSocialDestinatario
  `)).recordset;
}

async function getDestinosFromBizlinksHistory(pool: sql.ConnectionPool, numeroDocumento: string): Promise<GreDestino[]> {
  const request = new sql.Request(pool);
  request.input('numeroDocumento', sql.VarChar(20), numeroDocumento);

  const result = await request.query<DestinationHistoryRow>(`
    SELECT TOP (50)
      ubigeoPtoLLegada,
      direccionPtoLLegada,
      codigoPtollegada,
      bl_createdAt
    FROM dbo.SPE_DESPATCH
    WHERE numeroDocumentoDestinatario = @numeroDocumento
      AND ISNULL(ubigeoPtoLLegada, '') <> ''
      AND ISNULL(direccionPtoLLegada, '') <> ''
    ORDER BY bl_createdAt DESC
  `);
  const byAddress = new Map<string, GreDestino>();

  for (const row of result.recordset) {
    const ubigeo = row.ubigeoPtoLLegada?.trim() ?? '';
    const direccion = normalizeHistoricalAddress(row.direccionPtoLLegada);

    if (!/^\d{6}$/.test(ubigeo) || !direccion) continue;

    const codigoDestino = row.codigoPtollegada?.trim() || '1';
    const key = `${ubigeo}-${direccion.toUpperCase()}`;

    if (!byAddress.has(key)) {
      byAddress.set(key, {
        id: `${numeroDocumento}-${ubigeo}-${codigoDestino}-${direccion}`,
        codigoDestino,
        ubigeo,
        direccion,
        textoOriginal: `${ubigeo}-${direccion}`
      });
    }
  }

  return [...byAddress.values()];
}

async function getBizlinksStatuses(pool: sql.ConnectionPool, series: string[]) {
  const statuses = new Map<string, BizlinksStatusRow>();
  if (series.length === 0) return statuses;

  const request = new sql.Request(pool);
  const params = series.map((serie, index) => {
    const name = `serie${index}`;
    request.input(name, sql.VarChar(20), serie);
    return `@${name}`;
  });

  const result = await request.query<BizlinksStatusRow>(`
    SELECT
      d.serieNumeroGuia,
      d.bl_estadoRegistro,
      r.bl_estadoRegistro AS responseEstadoRegistro,
      r.bl_estadoProceso,
      r.process_state,
      r.bl_mensaje,
      r.bl_mensajeSunat,
      r.bl_url_pdf
    FROM dbo.SPE_DESPATCH d
    LEFT JOIN dbo.SPE_DESPATCH_RESPONSE r
      ON r.tipoDocumentoRemitente = d.tipoDocumentoRemitente
     AND r.numeroDocumentoRemitente = d.numeroDocumentoRemitente
     AND r.serieNumeroGuia = d.serieNumeroGuia
     AND r.tipoDocumentoGuia = d.tipoDocumentoGuia
    WHERE d.serieNumeroGuia IN (${params.join(', ')})
  `);

  for (const row of result.recordset) {
    statuses.set(row.serieNumeroGuia, row);
  }

  return statuses;
}

function buildDescription(row: ProductRow) {
  const cleanSerie = (row.serie ?? '').trim();
  const showSerie = cleanSerie && cleanSerie !== '0' && cleanSerie !== '-';

  return [
    row.formato,
    row.medida,
    row.tira ? `TIRA:${row.tira}` : '',
    row.retira ? `RETIRA:${row.retira}` : '',
    row.papel ? `PAPEL:${row.papel}` : '',
    showSerie ? `SERIE:${cleanSerie}` : '',
    row.numeroDel ? `DEL:${row.numeroDel}` : '',
    row.numeroAl ? `AL:${row.numeroAl}` : ''
  ].filter(Boolean).join(', ');
}

function normalizeHistoricalAddress(value: string | null) {
  return (value ?? '').trim().replace(/^-+/, '').trim();
}

export function mapGuideStatusForReport(row: {
  estadoOperacion: string | null;
  estadoEnvio: string | null;
}, bizlinks?: BizlinksStatusForReport): GuideStatus {
  if (row.estadoOperacion === 'ERROR' || row.estadoEnvio === 'ERROR') return 'ERROR';
  if (hasSunatAcceptedResponse(bizlinks)) return 'ACEPTADA';
  if (hasSunatRejectedResponse(bizlinks)) return 'RECHAZADA';
  if (bizlinks?.bl_estadoRegistro === 'E') return 'RECHAZADA';
  if (bizlinks?.bl_estadoRegistro === 'L') return 'EN_PROCESO';
  if (bizlinks?.bl_estadoRegistro === 'A') return 'EN_PROCESO';
  if (row.estadoOperacion === 'ACTIVADO' || row.estadoEnvio === 'ACTIVADO') return 'ENVIADO';
  return 'GENERADO';
}

function hasSunatAcceptedResponse(bizlinks?: BizlinksStatusForReport) {
  if (!bizlinks) return false;
  if (bizlinks.bl_estadoProceso?.includes('AC_03')) return true;

  const message = bizlinks.bl_mensajeSunat ?? bizlinks.bl_mensaje ?? '';

  return /aceptad[ao]/i.test(message) && /"codigo"\s*:\s*"0"/i.test(message);
}

function hasSunatRejectedResponse(bizlinks?: BizlinksStatusForReport) {
  if (!bizlinks) return false;

  const message = bizlinks.bl_mensajeSunat ?? bizlinks.bl_mensaje ?? '';
  if (!message.trim()) return false;
  if (hasSunatAcceptedResponse(bizlinks)) return false;

  return /rechazad[ao]|no existe|error|observad[ao]|inv[aá]lid[ao]/i.test(message);
}

function displayStatusMessage(row: OperationRow, bizlinks?: BizlinksStatusRow) {
  const message = bizlinks?.bl_mensajeSunat ?? bizlinks?.bl_mensaje ?? row.mensajeEnvio;
  if (message) return message;

  if (bizlinks?.bl_estadoRegistro === 'L' && !hasSunatAcceptedResponse(bizlinks)) {
    return 'Procesado por Bizlinks. Pendiente de respuesta SUNAT.';
  }

  if (bizlinks?.bl_estadoRegistro === 'A') {
    return 'Bizlinks recogio la guia. Procesamiento en curso.';
  }

  return null;
}

function isAllowedBizlinksFileUrl(value: string) {
  try {
    const url = new URL(value);

    return url.protocol === 'https:' && url.hostname.toLowerCase() === 'sfeintegrador.bizlinks.com.pe';
  } catch {
    return false;
  }
}

async function resolveRecipient(pool: sql.ConnectionPool, row: WorkOrderRow): Promise<WorkOrderRecipient | null> {
  const razonSocial = row.razonSocial?.trim();
  if (!razonSocial) return null;

  const request = new sql.Request(pool);
  request.input('razonSocial', sql.VarChar(250), razonSocial);

  const result = await request.query<RecipientRow>(`
    SELECT DISTINCT TOP (2)
      tipoDocumentoDestinatario,
      numeroDocumentoDestinatario,
      razonSocialDestinatario,
      NULL AS ubigeoPtoLLegada,
      NULL AS direccionPtoLLegada
    FROM dbo.SPE_DESPATCH
    WHERE razonSocialDestinatario = @razonSocial
    ORDER BY numeroDocumentoDestinatario
  `);

  if (result.recordset.length !== 1) return null;

  const recipient = result.recordset[0];
  const numeroDocumento = recipient?.numeroDocumentoDestinatario?.trim();
  const tipoDocumento = recipient?.tipoDocumentoDestinatario?.trim();
  const razonSocialDestinatario = recipient?.razonSocialDestinatario?.trim();

  if (!numeroDocumento || !tipoDocumento || !razonSocialDestinatario) return null;

  return {
    tipoDocumentoDestinatario: tipoDocumento,
    numeroDocumentoDestinatario: numeroDocumento,
    razonSocialDestinatario,
    fuente: 'BIZLINKS_HISTORICO'
  };
}

function normalizeDriver(row: DriverRow): DriverCatalogItem {
  const tipoDocumento = row.TIPODOCUMENTOCHOFER.trim();
  const numeroDocumento = row.NUMERODOCUMENTOCHOFER.trim();
  const nombres = row.NOMBRE.trim();
  const apellidos = row.APELLIDO.trim();
  const licencia = row.BREVETE.trim();
  const placa = row.PLACAVEHICULO.trim();

  return {
    id: `${tipoDocumento}-${numeroDocumento}-${licencia}-${placa}`,
    tipoDocumento,
    numeroDocumento,
    nombres,
    apellidos,
    licencia,
    placa
  };
}

export function parsePhysicalGuideInput(input: string): { serie: string; numero: string } | null {
  const cleanInput = input.trim();
  const parts = cleanInput.split('-');
  if (parts.length === 2) {
    const serie = parts[0]!.trim().padStart(3, '0');
    const numero = parts[1]!.trim().padStart(7, '0');
    return { serie, numero };
  }
  if (/^\d{10}$/.test(cleanInput)) {
    const serie = cleanInput.slice(0, 3);
    const numero = cleanInput.slice(3);
    return { serie, numero };
  }
  return null;
}
