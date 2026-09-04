import { loadEnv } from '../config/env.js';
import { getGreDefaults } from '../config/greDefaults.js';
import { createBizlinksPool, createGreFcPool, createYchiPool, sql } from '../integrations/bizlinksSql.js';
import { mapGreInputToPayload } from '../mappers/grePayloadMapper.js';
import { toSpeDespatchProcedurePlan } from '../mappers/speDespatchProcedureMapper.js';
import type { GreInputDto } from '../schemas/greInputSchema.js';

type Level = 'OK' | 'ADVERTENCIA' | 'ERROR';

type CheckResult = {
  scope: string;
  name: string;
  level: Level;
  detail?: string;
};

const greFcTables = [
  'dbo.GRE_FC_OPERACION',
  'dbo.GRE_FC_DETALLE',
  'dbo.GRE_FC_ENVIO',
  'dbo.GRE_FC_EVENTO'
];

const portalAuthTables = [
  'dbo.GRE_PORTAL_USUARIO',
  'dbo.GRE_PORTAL_USUARIO_MODULO',
  'dbo.GRE_PORTAL_ACCESO_EVENTO'
];

const ychiObjects = [
  'dbo.tbOrdenTrabajo',
  'dbo.VW_BUSCAS_DOCUMENTOS',
  'dbo.VW_DETGUIA_REMISION',
  'dbo.tbDocumentos',
  'dbo.tbClieProv',
  'dbo.tbcliedireccion',
  'dbo.tbRecepcionOT',
  'dbo.CatalogoUbigeo',
  'dbo.tbDistrito',
  'dbo.tbProvincia',
  'dbo.tbDepartamento'
];

const bizlinksTables = [
  'dbo.SPE_DESPATCH',
  'dbo.SPE_DESPATCH_ITEM',
  'dbo.SPE_DESPATCH_RESPONSE',
  'dbo.SPE_DESPATCH_AUXILIAR',
  'dbo.AAA_CHOFER'
];

const bizlinksProcedures = [
  'dbo.USP_CabeceraGuia',
  'dbo.USP_DetalleGuia',
  'dbo.USP_DocRef',
  'dbo.USP_EnvioGuia'
];

const forbiddenBizlinksTables = [
  'dbo.EMPAQUE',
  'dbo.EMPAQUE_DETALLE'
];

async function main() {
  const config = loadEnv();
  const results: CheckResult[] = [];

  if (!config.dryRun) {
    results.push({
      scope: 'SEGURIDAD',
      name: 'DRY_RUN',
      level: 'ADVERTENCIA',
      detail: 'DRY_RUN no esta true. Este chequeo no lo modifica.'
    });
  } else {
    results.push({ scope: 'SEGURIDAD', name: 'DRY_RUN', level: 'OK', detail: 'Permanece true' });
  }

  if (config.directDbInsertEnabled) {
    results.push({
      scope: 'SEGURIDAD',
      name: 'GRE_DIRECT_DB_INSERT_ENABLED',
      level: 'ADVERTENCIA',
      detail: 'Esta true. Este chequeo no lo modifica.'
    });
  } else {
    results.push({
      scope: 'SEGURIDAD',
      name: 'GRE_DIRECT_DB_INSERT_ENABLED',
      level: 'OK',
      detail: 'Permanece false'
    });
  }

  checkConfiguredUser(config.greFcDb.user, 'GRE_FC_SQL_USER', results);
  checkConfiguredUser(config.ychiDb.user, 'YCHI_SQL_USER/YCHIDB3_SQL_USER', results);
  checkConfiguredUser(config.bizlinksDb.user, 'BIZLINKS_SQL_USER', results);

  await withPool('GRE_FORMULARIOS_TEST', () => createGreFcPool(config), results, async (pool) => {
    await assertCurrentDatabase(pool, config.greFcDb.database, results, 'GRE_FORMULARIOS_TEST');
    await checkLoginIsNotSa(pool, results, 'GRE_FORMULARIOS_TEST');
    await checkTablesExist(pool, greFcTables, results, 'GRE_FORMULARIOS_TEST');
    await checkUniqueColumn(pool, 'dbo.GRE_FC_OPERACION', 'idOperacion', results, 'GRE_FORMULARIOS_TEST');
    await checkUniqueColumn(pool, 'dbo.GRE_FC_ENVIO', 'serieNumeroGuia', results, 'GRE_FORMULARIOS_TEST');
    await checkObjectPermissions(
      pool,
      [
        { objectName: 'dbo.GRE_FC_OPERACION', permissions: ['SELECT', 'INSERT', 'UPDATE'] },
        { objectName: 'dbo.GRE_FC_DETALLE', permissions: ['SELECT', 'INSERT'] },
        { objectName: 'dbo.GRE_FC_ENVIO', permissions: ['SELECT', 'INSERT', 'UPDATE'] },
        { objectName: 'dbo.GRE_FC_EVENTO', permissions: ['INSERT'] }
      ],
      results,
      'GRE_FORMULARIOS_TEST'
    );
    if (config.auth.enabled) {
      await checkTablesExist(pool, portalAuthTables, results, 'GRE_FORMULARIOS_TEST/AUTH');
      await checkUniqueColumn(pool, 'dbo.GRE_PORTAL_USUARIO', 'usuario', results, 'GRE_FORMULARIOS_TEST/AUTH');
      await checkObjectPermissions(
        pool,
        [
          { objectName: 'dbo.GRE_PORTAL_USUARIO', permissions: ['SELECT', 'INSERT'] },
          { objectName: 'dbo.GRE_PORTAL_USUARIO_MODULO', permissions: ['SELECT', 'INSERT'] },
          { objectName: 'dbo.GRE_PORTAL_ACCESO_EVENTO', permissions: ['INSERT'] }
        ],
        results,
        'GRE_FORMULARIOS_TEST/AUTH'
      );
      await checkColumnPermissions(
        pool,
        'dbo.GRE_PORTAL_USUARIO',
        ['nombre', 'passwordHash', 'esAdministrador', 'activo', 'modificadoEn', 'modificadoPor'],
        'UPDATE',
        results,
        'GRE_FORMULARIOS_TEST/AUTH'
      );
      await checkForbiddenPermissions(
        pool,
        portalAuthTables,
        ['UPDATE', 'DELETE'],
        results,
        'GRE_FORMULARIOS_TEST/AUTH'
      );
      await checkForbiddenPermissions(
        pool,
        ['dbo.GRE_PORTAL_ACCESO_EVENTO'],
        ['SELECT'],
        results,
        'GRE_FORMULARIOS_TEST/AUTH'
      );
    }
    await checkAppLock(pool, results, 'GRE_FORMULARIOS_TEST');
  });

  await withPool('YCHIDB3', () => createYchiPool(config), results, async (pool) => {
    await assertCurrentDatabase(pool, config.ychiDb.database, results, 'YCHIDB3');
    await checkLoginIsNotSa(pool, results, 'YCHIDB3');
    await checkSelectableObjects(pool, ychiObjects, results, 'YCHIDB3');
    await checkObjectPermissions(
      pool,
      [
        { objectName: 'dbo.tbRecepcionOT', permissions: ['SELECT', 'UPDATE'] }
      ],
      results,
      'YCHIDB3'
    );
  });

  await withPool('BIZLINKS_PROD21', () => createBizlinksPool(config), results, async (pool) => {
    await assertCurrentDatabase(pool, config.bizlinksDb.database, results, 'BIZLINKS_PROD21');
    await checkLoginIsNotSa(pool, results, 'BIZLINKS_PROD21');
    await checkTablesExist(pool, bizlinksTables, results, 'BIZLINKS_PROD21');
    await checkObjectPermissions(
      pool,
      [
        { objectName: 'dbo.SPE_DESPATCH', permissions: ['SELECT', 'INSERT'] },
        { objectName: 'dbo.SPE_DESPATCH_ITEM', permissions: ['SELECT', 'INSERT'] },
        { objectName: 'dbo.SPE_DESPATCH_RESPONSE', permissions: ['SELECT', 'UPDATE'] },
        { objectName: 'dbo.SPE_DESPATCH_AUXILIAR', permissions: ['SELECT'] },
        { objectName: 'dbo.AAA_CHOFER', permissions: ['SELECT'] }
      ],
      results,
      'BIZLINKS_PROD21'
    );
    await checkObjectPermissions(
      pool,
      bizlinksProcedures.map((objectName) => ({ objectName, permissions: ['EXECUTE'] })),
      results,
      'BIZLINKS_PROD21'
    );
    await checkMetadataAccess(pool, bizlinksTables, results, 'BIZLINKS_PROD21');
    await checkProcedureMapperParams(pool, config, results);
    await checkAcceptedGuideReference(pool, results);
    await checkForbiddenPermissions(pool, forbiddenBizlinksTables, ['INSERT', 'UPDATE', 'DELETE'], results, 'BIZLINKS_PROD21');
    await checkAppLock(pool, results, 'BIZLINKS_PROD21');
  });

  printResults(results);

  if (results.some((result) => result.level === 'ERROR')) {
    process.exitCode = 1;
  }
}

function checkConfiguredUser(user: string, variableName: string, results: CheckResult[]) {
  results.push({
    scope: 'SEGURIDAD',
    name: `${variableName}=gre_app_test`,
    level: user.trim().toLowerCase() === 'gre_app_test' ? 'OK' : 'ERROR',
    detail: user ? user : '(vacio)'
  });
}

async function withPool(
  scope: string,
  poolFactory: () => sql.ConnectionPool,
  results: CheckResult[],
  action: (pool: sql.ConnectionPool) => Promise<void>
) {
  let pool: sql.ConnectionPool | undefined;

  try {
    pool = poolFactory();
    await pool.connect();
    results.push({ scope, name: 'Conexion', level: 'OK' });
    await action(pool);
  } catch (error) {
    results.push({
      scope,
      name: 'Conexion o chequeo',
      level: 'ERROR',
      detail: error instanceof Error ? error.message : 'Error desconocido'
    });
  } finally {
    await pool?.close().catch(() => undefined);
  }
}

async function assertCurrentDatabase(pool: sql.ConnectionPool, expectedDatabase: string, results: CheckResult[], scope: string) {
  const result = await pool.query<{ databaseName: string }>('SELECT DB_NAME() AS databaseName');
  const databaseName = result.recordset[0]?.databaseName;
  results.push({
    scope,
    name: 'Base conectada',
    level: databaseName === expectedDatabase ? 'OK' : 'ERROR',
    detail: `${databaseName ?? '(desconocida)'}`
  });
}

async function checkLoginIsNotSa(pool: sql.ConnectionPool, results: CheckResult[], scope: string) {
  const result = await pool.query<{ loginName: string }>('SELECT SUSER_SNAME() AS loginName');
  const loginName = result.recordset[0]?.loginName ?? '';
  results.push({
    scope,
    name: 'Usuario no es sa',
    level: loginName.trim().toLowerCase() === 'sa' ? 'ERROR' : 'OK',
    detail: loginName || '(desconocido)'
  });
}

async function checkTablesExist(pool: sql.ConnectionPool, objects: string[], results: CheckResult[], scope: string) {
  for (const objectName of objects) {
    const exists = await objectExists(pool, objectName);
    results.push({
      scope,
      name: `Existe ${objectName}`,
      level: exists ? 'OK' : 'ERROR'
    });
  }
}

async function checkSelectableObjects(
  pool: sql.ConnectionPool,
  objects: string[],
  results: CheckResult[],
  scope: string,
  deniedLevel: Level = 'ERROR'
) {
  for (const objectName of objects) {
    try {
      await new sql.Request(pool).query(`SELECT TOP (0) * FROM ${objectName}`);
      results.push({ scope, name: `SELECT ${objectName}`, level: 'OK' });
    } catch (error) {
      results.push({
        scope,
        name: `SELECT ${objectName}`,
        level: deniedLevel,
        detail: error instanceof Error ? error.message : 'Error desconocido'
      });
    }
  }
}

async function checkUniqueColumn(
  pool: sql.ConnectionPool,
  objectName: string,
  columnName: string,
  results: CheckResult[],
  scope: string
) {
  const [schemaName, tableName] = splitObjectName(objectName);
  const request = new sql.Request(pool);
  request.input('schemaName', sql.NVarChar(128), schemaName);
  request.input('tableName', sql.NVarChar(128), tableName);
  request.input('columnName', sql.NVarChar(128), columnName);

  const result = await request.query<{ total: number }>(`
    SELECT COUNT(1) AS total
    FROM sys.indexes i
    INNER JOIN sys.index_columns ic
      ON ic.object_id = i.object_id
     AND ic.index_id = i.index_id
    INNER JOIN sys.columns c
      ON c.object_id = ic.object_id
     AND c.column_id = ic.column_id
    INNER JOIN sys.objects o
      ON o.object_id = i.object_id
    INNER JOIN sys.schemas s
      ON s.schema_id = o.schema_id
    WHERE s.name = @schemaName
      AND o.name = @tableName
      AND c.name = @columnName
      AND i.is_unique = 1
  `);

  results.push({
    scope,
    name: `UNIQUE ${objectName}.${columnName}`,
    level: (result.recordset[0]?.total ?? 0) > 0 ? 'OK' : 'ERROR'
  });
}

async function checkObjectPermissions(
  pool: sql.ConnectionPool,
  checks: Array<{ objectName: string; permissions: string[] }>,
  results: CheckResult[],
  scope: string
) {
  for (const { objectName, permissions } of checks) {
    for (const permission of permissions) {
      const hasPermission = await hasObjectPermission(pool, objectName, permission);
      results.push({
        scope,
        name: `${permission} ${objectName}`,
        level: hasPermission ? 'OK' : 'ERROR'
      });
    }
  }
}

async function checkColumnPermissions(
  pool: sql.ConnectionPool,
  objectName: string,
  columnNames: string[],
  permission: string,
  results: CheckResult[],
  scope: string
) {
  for (const columnName of columnNames) {
    const hasPermission = await hasColumnPermission(pool, objectName, columnName, permission);
    results.push({
      scope,
      name: `${permission} ${objectName}.${columnName}`,
      level: hasPermission ? 'OK' : 'ERROR'
    });
  }
}

async function checkMetadataAccess(pool: sql.ConnectionPool, objects: string[], results: CheckResult[], scope: string) {
  for (const objectName of objects) {
    const [schemaName, tableName] = splitObjectName(objectName);
    const request = new sql.Request(pool);
    request.input('schemaName', sql.NVarChar(128), schemaName);
    request.input('tableName', sql.NVarChar(128), tableName);

    const result = await request.query<{ total: number }>(`
      SELECT COUNT(1) AS total
      FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = @schemaName
        AND TABLE_NAME = @tableName
    `);

    results.push({
      scope,
      name: `Metadatos ${objectName}`,
      level: (result.recordset[0]?.total ?? 0) > 0 ? 'OK' : 'ERROR',
      detail: `${result.recordset[0]?.total ?? 0} columnas visibles`
    });
  }
}

async function checkProcedureMapperParams(pool: sql.ConnectionPool, config: ReturnType<typeof loadEnv>, results: CheckResult[]) {
  const payload = mapGreInputToPayload(sampleGreInput, getGreDefaults(config));
  const plan = toSpeDespatchProcedurePlan(payload);

  await checkProcedureParams(pool, 'dbo.USP_CabeceraGuia', plan.USP_CabeceraGuia.map((param) => param.name), results);
  await checkProcedureParams(pool, 'dbo.USP_DetalleGuia', plan.USP_DetalleGuia[0]?.map((param) => param.name) ?? [], results);
  await checkProcedureParams(pool, 'dbo.USP_EnvioGuia', plan.USP_EnvioGuia.map((param) => param.name), results);
  await checkProcedureParams(
    pool,
    'dbo.USP_DocRef',
    [
      'numeroDocumentoRemitente',
      'tipoDocumentoGuia',
      'tipoDocumentoRemitente',
      'serieNumeroGuia',
      'correlativo',
      'tipoDocumentoDocRel',
      'codigoDocumentoDocRel',
      'numeroDocumentoDocRel',
      'numeroDocumentoEmisorDocRel',
      'tipoDocumentoEmisorDocRel'
    ],
    results
  );
}

async function checkProcedureParams(
  pool: sql.ConnectionPool,
  procedureName: string,
  mapperParams: string[],
  results: CheckResult[]
) {
  const [schemaName, objectName] = splitObjectName(procedureName);
  const request = new sql.Request(pool);
  request.input('schemaName', sql.NVarChar(128), schemaName);
  request.input('objectName', sql.NVarChar(128), objectName);

  const result = await request.query<{ parameterName: string }>(`
    SELECT p.name AS parameterName
    FROM sys.parameters p
    INNER JOIN sys.objects o
      ON o.object_id = p.object_id
    INNER JOIN sys.schemas s
      ON s.schema_id = o.schema_id
    WHERE s.name = @schemaName
      AND o.name = @objectName
    ORDER BY p.parameter_id
  `);

  const realParams = result.recordset.map((row) => row.parameterName.replace(/^@/, ''));
  const realParamsLower = new Set(realParams.map((param) => param.toLowerCase()));
  const mapperParamsLower = new Set(mapperParams.map((param) => param.toLowerCase()));
  const missingInSql = mapperParams.filter((param) => !realParamsLower.has(param.toLowerCase()));
  const missingInMapper = realParams.filter((param) => !mapperParamsLower.has(param.toLowerCase()));

  results.push({
    scope: 'BIZLINKS_PROD21',
    name: `Firma ${procedureName}`,
    level: missingInSql.length === 0 && missingInMapper.length === 0 ? 'OK' : 'ERROR',
    detail: missingInSql.length === 0 && missingInMapper.length === 0
      ? `${mapperParams.length} parametro(s) validados`
      : [
          missingInSql.length > 0 ? `No existen en SP: ${missingInSql.join(', ')}` : '',
          missingInMapper.length > 0 ? `No mapeados: ${missingInMapper.join(', ')}` : ''
        ].filter(Boolean).join('; ')
  });
}

async function checkAcceptedGuideReference(pool: sql.ConnectionPool, results: CheckResult[]) {
  const serieNumeroGuia = 'T999-00000095';
  const headerRequest = new sql.Request(pool);
  headerRequest.input('serieNumeroGuia', sql.VarChar(20), serieNumeroGuia);
  const headerResult = await headerRequest.query<Record<string, unknown>>(`
    SELECT TOP (1) *
    FROM dbo.SPE_DESPATCH
    WHERE serieNumeroGuia = @serieNumeroGuia
  `);
  const header = headerResult.recordset[0];

  results.push({
    scope: 'BIZLINKS_PROD21',
    name: `Guia aceptada ${serieNumeroGuia} encabezado`,
    level: header ? 'OK' : 'ERROR'
  });

  if (header) {
    const expectedHeaderValues = {
      tipoDocumentoRemitente: '6',
      numeroDocumentoRemitente: '20259402965',
      serieNumeroGuia,
      tipoDocumentoGuia: '09'
    };
    const differences = Object.entries(expectedHeaderValues)
      .filter(([key, expected]) => header[key] !== expected)
      .map(([key, expected]) => `${key}: ${String(header[key])} != ${expected}`);

    results.push({
      scope: 'BIZLINKS_PROD21',
      name: `Guia aceptada ${serieNumeroGuia} llaves`,
      level: differences.length === 0 ? 'OK' : 'ERROR',
      detail: differences.length === 0 ? 'Llaves de encabezado verificadas' : differences.join('; ')
    });
  }

  const itemRequest = new sql.Request(pool);
  itemRequest.input('serieNumeroGuia', sql.VarChar(20), serieNumeroGuia);
  const itemResult = await itemRequest.query<Record<string, unknown>>(`
    SELECT *
    FROM dbo.SPE_DESPATCH_ITEM
    WHERE serieNumeroGuia = @serieNumeroGuia
    ORDER BY
      CASE
        WHEN ISNUMERIC(numeroOrdenItem) = 1 THEN CONVERT(int, numeroOrdenItem)
        ELSE 2147483647
      END,
      numeroOrdenItem
  `);

  results.push({
    scope: 'BIZLINKS_PROD21',
    name: `Guia aceptada ${serieNumeroGuia} items`,
    level: itemResult.recordset.length > 0 ? 'OK' : 'ERROR',
    detail: `${itemResult.recordset.length} item(s)`
  });

  const badRelations = itemResult.recordset.filter((item) =>
    item.tipoDocumentoRemitente !== '6'
    || item.numeroDocumentoRemitente !== '20259402965'
    || item.serieNumeroGuia !== serieNumeroGuia
    || item.tipoDocumentoGuia !== '09'
  );

  if (itemResult.recordset.length > 0) {
    results.push({
      scope: 'BIZLINKS_PROD21',
      name: `Relacion items ${serieNumeroGuia}`,
      level: badRelations.length === 0 ? 'OK' : 'ERROR',
      detail: badRelations.length === 0
        ? 'Relacion por tipoDocumentoRemitente, numeroDocumentoRemitente, serieNumeroGuia y tipoDocumentoGuia'
        : `${badRelations.length} item(s) con llave distinta`
    });
  }
}

async function checkForbiddenPermissions(
  pool: sql.ConnectionPool,
  objects: string[],
  permissions: string[],
  results: CheckResult[],
  scope: string
) {
  for (const objectName of objects) {
    const exists = await objectExists(pool, objectName);

    for (const permission of permissions) {
      const hasPermission = await hasObjectPermission(pool, objectName, permission);
      results.push({
        scope,
        name: `Sin ${permission} ${objectName}`,
        level: hasPermission ? 'ERROR' : 'OK',
        detail: exists ? undefined : 'Objeto no visible o permiso denegado'
      });
    }
  }
}

async function checkAppLock(pool: sql.ConnectionPool, results: CheckResult[], scope: string) {
  const transaction = new sql.Transaction(pool);

  try {
    await transaction.begin();
    const request = new sql.Request(transaction);
    request.input('resource', sql.NVarChar(255), `db-check-${scope}`);
    const result = await request.query<{ lockResult: number }>(`
      DECLARE @lockResult int;
      EXEC @lockResult = sp_getapplock
        @Resource = @resource,
        @LockMode = 'Exclusive',
        @LockOwner = 'Transaction',
        @LockTimeout = 5000;
      SELECT @lockResult AS lockResult;
    `);

    const lockResult = result.recordset[0]?.lockResult ?? -999;
    results.push({
      scope,
      name: 'sp_getapplock con rollback',
      level: lockResult >= 0 ? 'OK' : 'ERROR',
      detail: `resultado ${lockResult}`
    });
  } catch (error) {
    results.push({
      scope,
      name: 'sp_getapplock con rollback',
      level: 'ERROR',
      detail: error instanceof Error ? error.message : 'Error desconocido'
    });
  } finally {
    await transaction.rollback().catch(() => undefined);
  }
}

async function objectExists(pool: sql.ConnectionPool, objectName: string) {
  const request = new sql.Request(pool);
  request.input('objectName', sql.NVarChar(260), objectName);
  const result = await request.query<{ total: number }>(`
    SELECT COUNT(1) AS total
    FROM sys.objects
    WHERE object_id = OBJECT_ID(@objectName)
  `);

  return (result.recordset[0]?.total ?? 0) > 0;
}

async function hasObjectPermission(pool: sql.ConnectionPool, objectName: string, permission: string) {
  const request = new sql.Request(pool);
  request.input('objectName', sql.NVarChar(260), objectName);
  request.input('permission', sql.NVarChar(30), permission);
  const result = await request.query<{ hasPermission: number | null }>(`
    SELECT HAS_PERMS_BY_NAME(@objectName, 'OBJECT', @permission) AS hasPermission
  `);

  return result.recordset[0]?.hasPermission === 1;
}

async function hasColumnPermission(pool: sql.ConnectionPool, objectName: string, columnName: string, permission: string) {
  const request = new sql.Request(pool);
  request.input('objectName', sql.NVarChar(260), objectName);
  request.input('columnName', sql.NVarChar(128), columnName);
  request.input('permission', sql.NVarChar(30), permission);
  const result = await request.query<{ hasPermission: number | null }>(`
    SELECT COUNT(1) AS hasPermission
    FROM fn_my_permissions(@objectName, 'OBJECT')
    WHERE permission_name = @permission
      AND subentity_name = @columnName
  `);

  return (result.recordset[0]?.hasPermission ?? 0) > 0;
}

function splitObjectName(objectName: string): [string, string] {
  const [schemaName, tableName] = objectName.split('.');
  return [schemaName ?? 'dbo', tableName ?? objectName];
}

function printResults(results: CheckResult[]) {
  const scopes = [...new Set(results.map((result) => result.scope))];

  for (const scope of scopes) {
    console.log(`\n[${scope}]`);

    for (const result of results.filter((item) => item.scope === scope)) {
      const detail = result.detail ? ` - ${result.detail}` : '';
      console.log(`${result.level.padEnd(12)} ${result.name}${detail}`);
    }
  }

  const errors = results.filter((result) => result.level === 'ERROR').length;
  const warnings = results.filter((result) => result.level === 'ADVERTENCIA').length;
  console.log(`\nResumen: ${errors} ERROR, ${warnings} ADVERTENCIA, ${results.length - errors - warnings} OK`);
}

const sampleGreInput: GreInputDto = {
  serieNumeroGuia: 'T999-00000000',
  fechaEmisionGuia: '2026-07-22',
  horaEmisionGuia: '12:00:00',
  fechaInicioTraslado: '2026-07-22',
  fechaEntregaBienes: '2026-07-22',
  observaciones: '',
  correoDestinatario: 'destinatario@example.com',
  destinatario: {
    tipoDocumentoDestinatario: '6',
    numeroDocumentoDestinatario: '20111111111',
    razonSocialDestinatario: 'CLIENTE VALIDACION S.A.C.'
  },
  traslado: {
    motivoTraslado: '01',
    descripcionMotivoTraslado: 'VENTA',
    pesoBrutoTotalBienes: 1,
    unidadMedidaPesoBruto: 'KGM',
    modalidadTraslado: '02',
    numeroBultos: 1,
    ubigeoPtoLlegada: '150101',
    direccionPtoLlegada: 'DIRECCION VALIDACION',
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
      codigoProducto: 'CODIGO_VALIDACION',
      descripcion: 'DESCRIPCION VALIDACION FORMULARIOS CONTINUOS',
      cantidad: 1,
      unidadMedida: 'MIL',
      moneda: '-100',
      importeUnitarioSinImpuesto: 1,
      id: '1'
    }
  ]
};

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : 'Error desconocido';
  console.error(`ERROR db:check - ${message}`);
  process.exitCode = 1;
});
