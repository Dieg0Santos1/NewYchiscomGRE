import { z } from 'zod';

export const FLEXO_CREDIT_NOTE_SERIE = 'FC03';
export const FLEXO_CREDIT_NOTE_SERIE_PATTERN = /^FC03-\d{8}$/;
export const FLEXO_CREDIT_NOTE_FACTURA_PATTERN = /^FF03-\d{8}$/;
export const FLEXO_CREDIT_NOTE_MOTIVES = ['anulacion', 'ruc', 'total', 'item'] as const;

export const flexoCreditNotePreviewSchema = z.object({
  facturaAfectada: z.string().trim().regex(FLEXO_CREDIT_NOTE_FACTURA_PATTERN),
  motivo: z.enum(FLEXO_CREDIT_NOTE_MOTIVES),
  cuentaNc: z.string().trim().regex(/^\d+$/).default('7094121'),
  observaciones: z.string().trim().max(250).optional().default('')
});

export type FlexoCreditNotePreviewInput = z.infer<typeof flexoCreditNotePreviewSchema>;
