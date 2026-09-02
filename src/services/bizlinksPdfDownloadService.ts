import type { ConnectionPool } from 'mssql';
import type { AppConfig } from '../config/env.js';
import { sql } from '../integrations/bizlinksSql.js';

export type PdfDelivery =
  | { kind: 'buffer'; data: Buffer }
  | { kind: 'url'; url: string };

export async function getDownloadedPdf(
  pool: ConnectionPool,
  config: AppConfig,
  tipoDocumento: '01' | '09',
  serieNumero: string
): Promise<Buffer | null> {
  const request = new sql.Request(pool);
  request.input('tipoDocumentoEmisor', sql.VarChar(1), config.remitente.tipoDocumento);
  request.input('numeroDocumentoEmisor', sql.VarChar(20), config.remitente.numeroDocumento);
  request.input('tipoDocumento', sql.VarChar(2), tipoDocumento);
  request.input('serieNumero', sql.VarChar(17), serieNumero);

  const result = await request.query<{ bl_pdf: Buffer | null }>(`
    SELECT TOP (1)
      bl_pdf
    FROM dbo.SPE_JOB_DOWNLOAD
    WHERE tipoDocumentoEmisor = @tipoDocumentoEmisor
      AND numeroDocumentoEmisor = @numeroDocumentoEmisor
      AND tipoDocumento = @tipoDocumento
      AND serieNumero = @serieNumero
  `);
  const pdf = result.recordset[0]?.bl_pdf;

  return pdf && isPdf(pdf) ? pdf : null;
}

function isPdf(value: Buffer) {
  return value.length >= 5 && value.subarray(0, 5).toString('ascii') === '%PDF-';
}
