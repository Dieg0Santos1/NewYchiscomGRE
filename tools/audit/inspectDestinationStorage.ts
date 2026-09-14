import { loadEnv } from '../../src/config/env.js';
import { createBizlinksPool, createGreFcPool, createYchiPool, sql } from '../../src/integrations/bizlinksSql.js';

type QuerySpec = {
  name: string;
  query: string;
};

async function inspect(label: string, poolFactory: (config: ReturnType<typeof loadEnv>) => sql.ConnectionPool, queries: QuerySpec[]) {
  const config = loadEnv();
  const pool = poolFactory(config);
  await pool.connect();

  try {
    const db = await new sql.Request(pool).query(`
      SELECT DB_NAME() AS dbName, SUSER_SNAME() AS loginName, USER_NAME() AS userName
    `);
    console.log(`## ${label}`);
    console.table(db.recordset);

    for (const item of queries) {
      const result = await new sql.Request(pool).query(item.query);
      console.log(`### ${label} / ${item.name}`);
      console.table(result.recordset);
    }
  } finally {
    await pool.close();
  }
}

await inspect('GRE_FC', createGreFcPool, [
  {
    name: 'target_objects',
    query: `
      SELECT name, type_desc
      FROM sys.objects
      WHERE name IN ('GRE_FC_DESTINO_MANUAL', 'GRE_FC_OPERACION', 'GRE_FC_ENVIO', 'GRE_FC_DETALLE', 'GRE_FC_EVENTO')
      ORDER BY name
    `
  },
  {
    name: 'destino_manual_columns',
    query: `
      SELECT c.name, t.name AS type_name, c.max_length, c.is_nullable
      FROM sys.columns c
      INNER JOIN sys.types t
        ON c.user_type_id = t.user_type_id
      WHERE c.object_id = OBJECT_ID(N'dbo.GRE_FC_DESTINO_MANUAL')
      ORDER BY c.column_id
    `
  },
  {
    name: 'current_user_permissions',
    query: `
      SELECT
        HAS_PERMS_BY_NAME('dbo.GRE_FC_DESTINO_MANUAL', 'OBJECT', 'SELECT') AS can_select,
        HAS_PERMS_BY_NAME('dbo.GRE_FC_DESTINO_MANUAL', 'OBJECT', 'INSERT') AS can_insert,
        HAS_PERMS_BY_NAME('dbo.GRE_FC_DESTINO_MANUAL', 'OBJECT', 'UPDATE') AS can_update
    `
  }
]);

await inspect('YCHI', createYchiPool, [
  {
    name: 'address_tables',
    query: `
      SELECT TABLE_SCHEMA, TABLE_NAME
      FROM INFORMATION_SCHEMA.TABLES
      WHERE TABLE_NAME IN ('tbClieProv', 'tbcliedireccion', 'CatalogoUbigeo')
      ORDER BY TABLE_NAME
    `
  },
  {
    name: 'tbClieProv_columns',
    query: `
      SELECT COLUMN_NAME, DATA_TYPE, CHARACTER_MAXIMUM_LENGTH, IS_NULLABLE
      FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = 'dbo'
        AND TABLE_NAME = 'tbClieProv'
        AND COLUMN_NAME IN ('idClieProv', 'RUC', 'Direccion', 'ubigeo', 'idDepartamento', 'IdProvincia', 'IdDistrito')
      ORDER BY ORDINAL_POSITION
    `
  },
  {
    name: 'tbcliedireccion_columns',
    query: `
      SELECT COLUMN_NAME, DATA_TYPE, CHARACTER_MAXIMUM_LENGTH, IS_NULLABLE
      FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = 'dbo'
        AND TABLE_NAME = 'tbcliedireccion'
      ORDER BY ORDINAL_POSITION
    `
  },
  {
    name: 'address_write_permissions',
    query: `
      SELECT
        HAS_PERMS_BY_NAME('dbo.tbcliedireccion', 'OBJECT', 'SELECT') AS can_select_tbcliedireccion,
        HAS_PERMS_BY_NAME('dbo.tbcliedireccion', 'OBJECT', 'INSERT') AS can_insert_tbcliedireccion,
        HAS_PERMS_BY_NAME('dbo.tbcliedireccion', 'OBJECT', 'UPDATE') AS can_update_tbcliedireccion,
        HAS_PERMS_BY_NAME('dbo.tbClieProv', 'OBJECT', 'UPDATE') AS can_update_tbClieProv
    `
  }
]);

await inspect('BIZLINKS', createBizlinksPool, [
  {
    name: 'spe_despatch_destination_columns',
    query: `
      SELECT COLUMN_NAME, DATA_TYPE, CHARACTER_MAXIMUM_LENGTH, IS_NULLABLE
      FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = 'dbo'
        AND TABLE_NAME = 'SPE_DESPATCH'
        AND COLUMN_NAME IN ('numeroDocumentoDestinatario', 'ubigeoPtoLLegada', 'direccionPtoLLegada', 'codigoPtollegada', 'bl_createdAt')
      ORDER BY ORDINAL_POSITION
    `
  }
]);
