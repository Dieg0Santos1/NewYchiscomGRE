import type { AppConfig } from '../config/env.js';
import type { GreInputDto } from '../schemas/greInputSchema.js';

export const testConfig: AppConfig = {
  port: 3001,
  nodeEnv: 'test',
  dryRun: true,
  existingGreApiUrl: 'http://192.168.1.140:92',
  existingGreApiToken: 'TEST_TOKEN_PLACEHOLDER',
  requestTimeoutMs: 30000,
  directDbInsertEnabled: false,
  fcLegacyWriteEnabled: false,
  remitente: {
    tipoDocumento: '6',
    numeroDocumento: '20259402965',
    razonSocial: 'YCHIFORMAS S.A.',
    correo: '-'
  },
  puntoPartida: {
    ubigeo: '140109',
    direccion: 'AV. LUNA PIZARRO 1328-1340, LA VICTORIA'
  },
  serveFrontend: false,
  frontendDistPath: 'frontend/dist',
  greFcDb: {
    server: '',
    port: 1433,
    database: 'GRE_FORMULARIOS_TEST',
    user: '',
    password: 'TEST_GRE_FC_PASSWORD_PLACEHOLDER',
    encrypt: false,
    trustServerCertificate: true
  },
  ychiDb: {
    server: '',
    port: 1433,
    database: 'YCHIDB3',
    user: '',
    password: 'TEST_YCHI_PASSWORD_PLACEHOLDER',
    encrypt: false,
    trustServerCertificate: true
  },
  bizlinksDb: {
    server: '',
    port: 1433,
    database: 'BIZLINKS_PROD21',
    user: '',
    password: 'TEST_DB_PASSWORD_PLACEHOLDER',
    encrypt: false,
    trustServerCertificate: true
  }
};

export const validGreInput: GreInputDto = {
  serieNumeroGuia: 'T001-00000093',
  fechaEmisionGuia: '2026-07-17',
  horaEmisionGuia: '15:30:00',
  fechaInicioTraslado: '2026-07-17',
  fechaEntregaBienes: '2026-07-17',
  observaciones: '',
  correoDestinatario: 'destinatario@example.com',
  destinatario: {
    tipoDocumentoDestinatario: '6',
    numeroDocumentoDestinatario: '20111111111',
    razonSocialDestinatario: 'CLIENTE DE PRUEBA S.A.C.'
  },
  traslado: {
    motivoTraslado: '01',
    descripcionMotivoTraslado: 'VENTA',
    pesoBrutoTotalBienes: 10,
    unidadMedidaPesoBruto: 'KGM',
    modalidadTraslado: '02',
    numeroBultos: 10,
    ubigeoPtoLlegada: '150101',
    direccionPtoLlegada: 'DIRECCION LLEGADA SANITIZADA',
    codigoPtoLlegada: '1'
  },
  conductor: {
    tipoDocumentoConductor: '1',
    numeroDocumentoConductor: '12345678',
    nombreConductor: 'NOMBRES',
    apellidoConductor: 'APELLIDOS',
    numeroLicencia: 'LICENCIA123'
  },
  vehiculo: {
    numeroPlacaVehiculoPrin: 'ABC123'
  },
  items: [
    {
      codigoEmpaque: 0,
      codigoProducto: 'PROD001',
      descripcion: 'PRODUCTO DE PRUEBA',
      cantidad: 1,
      unidadMedida: 'MIL',
      moneda: '-100',
      importeUnitarioSinImpuesto: 1,
      id: 'ITEM-1'
    }
  ]
};
