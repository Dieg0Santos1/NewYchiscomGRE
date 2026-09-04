export const SUNAT_GRE_OBSERVATION_MAX_LENGTH = 250;
export const SUNAT_GRE_ITEM_DESCRIPTION_MIN_LENGTH = 3;
export const SUNAT_GRE_ITEM_DESCRIPTION_MAX_LENGTH = 500;

export const SUNAT_GRE_TRANSFER_REASONS = [
  { code: '13', description: 'OTROS', label: '13 - OTROS' },
  { code: '01', description: 'VENTA', label: '01 - VENTA' },
  { code: '03', description: 'VENTA CON ENTREGA A TERCEROS', label: '03 - VENTA CON ENTREGA A TERCEROS' },
  { code: '14', description: 'VENTA SUJETA A CONFIRMACION DEL COMPRADOR', label: '14 - VENTA SUJETA A CONFIRMACION' },
  { code: '04', description: 'TRASLADO ENTRE ESTABLECIMIENTOS DE LA MISMA EMPRESA', label: '04 - TRASLADO ENTRE ESTABLECIMIENTOS' },
  { code: '17', description: 'TRASLADO DE BIENES PARA TRANSFORMACION', label: '17 - TRANSFORMACION' },
  { code: '18', description: 'TRASLADO EMISOR ITINERANTE CP', label: '18 - EMISOR ITINERANTE CP' },
  { code: '08', description: 'IMPORTACION', label: '08 - IMPORTACION' },
  { code: '09', description: 'EXPORTACION', label: '09 - EXPORTACION' },
  { code: '19', description: 'TRASLADO DE MERCANCIA EXTRANJERA', label: '19 - TRASLADO DE MERCANCIA EXTRANJERA' }
] as const;
