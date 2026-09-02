export const GRE_FC_ALLOWED_SERIES = ['T001', 'T999'] as const;
export type GreFcSerie = typeof GRE_FC_ALLOWED_SERIES[number];

export const GRE_FC_DEFAULT_SERIE: GreFcSerie = 'T001';
export const GRE_FC_ACTIVE_SERIE = GRE_FC_DEFAULT_SERIE;
export const GRE_FC_SERIE_PATTERN = /^(?:T001|T999)-\d{8}$/;
export const GRE_FC_SERIE_FORMAT_MESSAGE = 'La serie debe tener formato T001-00000000 o T999-00000000';

export function isGreFcAllowedSerie(value: string): value is GreFcSerie {
  return (GRE_FC_ALLOWED_SERIES as readonly string[]).includes(value);
}

export function extractGreFcSerie(serieNumeroGuia: string): GreFcSerie | null {
  const [serie] = serieNumeroGuia.split('-');

  return serie && isGreFcAllowedSerie(serie) ? serie : null;
}
