import { loadEnv } from '../../src/config/env.js';
import { createBizlinksPool, sql } from '../../src/integrations/bizlinksSql.js';

async function main() {
  const pool = createBizlinksPool(loadEnv());
  await pool.connect();

  try {
    const result = await new sql.Request(pool).query(`
      SELECT
        v.objeto,
        v.permiso,
        HAS_PERMS_BY_NAME(v.objeto, 'OBJECT', v.permiso) AS permitido
      FROM (VALUES
        ('dbo.USP_CabeceraFE', 'EXECUTE'),
        ('dbo.USP_DetalleFE', 'EXECUTE'),
        ('dbo.USP_EnviaDocumentoFE', 'EXECUTE'),
        ('dbo.AAA_GUIAFACTURADA', 'SELECT'),
        ('dbo.AAA_GUIAFACTURADA', 'INSERT'),
        ('dbo.AAA_REGISTRO_CONTABLE', 'SELECT'),
        ('dbo.AAA_REGISTRO_CONTABLE', 'INSERT'),
        ('dbo.EMPAQUE_DETALLE', 'SELECT'),
        ('dbo.EMPAQUE_DETALLE', 'UPDATE'),
        ('dbo.AAA_TIPODOCUMENTO', 'SELECT'),
        ('dbo.AAA_TIPODOCUMENTO', 'UPDATE'),
        ('dbo.SPE_EINVOICEHEADER', 'SELECT'),
        ('dbo.SPE_EINVOICEDETAIL', 'SELECT'),
        ('dbo.SPE_EINVOICEHEADER_ADD', 'SELECT'),
        ('dbo.SPE_EINVOICE_RESPONSE', 'SELECT')
      ) AS v(objeto, permiso)
      ORDER BY v.objeto, v.permiso;
    `);

    const columns = await new sql.Request(pool).query(`
      SELECT
        OBJECT_NAME(major_id) AS objeto,
        COL_NAME(major_id, minor_id) AS columna,
        permission_name,
        state_desc
      FROM sys.database_permissions
      WHERE grantee_principal_id = DATABASE_PRINCIPAL_ID()
        AND class = 1
        AND permission_name = 'UPDATE'
        AND major_id IN (
          OBJECT_ID(N'dbo.AAA_TIPODOCUMENTO'),
          OBJECT_ID(N'dbo.EMPAQUE_DETALLE')
        )
      ORDER BY objeto, columna;
    `);

    console.log(JSON.stringify({
      safety: 'READ_ONLY',
      objectPermissions: result.recordset,
      columnUpdatePermissions: columns.recordset
    }, null, 2));
  } finally {
    await pool.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
