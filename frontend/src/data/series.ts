export const ALLOWED_SERIES = ['T001', 'T999'] as const;
export type GreSerie = typeof ALLOWED_SERIES[number];
export const DEFAULT_SERIE: GreSerie = 'T001';
export const ACTIVE_SERIE = DEFAULT_SERIE;
