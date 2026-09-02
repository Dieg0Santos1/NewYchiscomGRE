import sql from 'mssql';

const dbConfig = {
  server: '192.168.1.140',
  port: 1433,
  database: 'YCHIDB3',
  user: 'gre_app_test',
  password: '72032575Dasa*',
  options: {
    encrypt: false,
    trustServerCertificate: true
  }
};

async function test() {
  const pool = new sql.ConnectionPool(dbConfig);
  await pool.connect();
  console.log("Connected!");
  try {
    // 1. Get ClieProv info for SAN FERNANDO (RUC 20100154308)
    const clientRes = await pool.request().query(`
      SELECT * 
      FROM dbo.tbClieProv 
      WHERE RUC = '20100154308'
    `);
    console.log("Client ClieProv Info:", clientRes.recordset);

    if (clientRes.recordset.length > 0) {
      const idClieProv = clientRes.recordset[0].idClieProv;
      
      // 2. Get all addresses from tbcliedireccion for this client
      const addressesRes = await pool.request().query(`
        SELECT idcliedireccion, idclieprov, direccion 
        FROM dbo.tbcliedireccion 
        WHERE idclieprov = ${idClieProv}
      `);
      console.log(`Addresses in tbcliedireccion for client ${idClieProv}:`);
      addressesRes.recordset.forEach(row => {
        console.log(`- ID: ${row.idcliedireccion} | Address: "${row.direccion}"`);
      });

      // 3. Let's run the exact sub-query used in greFormularioQueryService to resolve ubigeos for this client
      const queryRes = await pool.request().query(`
        SELECT 
          cd.idcliedireccion,
          cd.direccion,
          ubigeoPorDireccion.[CODIGO UBIGEO] AS ubigeo_resolved
        FROM dbo.tbcliedireccion cd
        OUTER APPLY (
          SELECT TOP (1)
            u.[CODIGO UBIGEO]
          FROM dbo.CatalogoUbigeo u
          WHERE LEN(LTRIM(RTRIM(u.DISTRITO))) >= 4
            AND UPPER(CONVERT(nvarchar(250), cd.direccion)) COLLATE DATABASE_DEFAULT
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
        WHERE cd.idclieprov = ${idClieProv}
      `);
      console.log("\nResolved Ubigeos via SQL query:");
      queryRes.recordset.forEach(row => {
        console.log(`- ID: ${row.idcliedireccion} | Ubigeo: ${row.ubigeo_resolved} | Address: "${row.direccion}"`);
      });
    }
  } catch (e) {
    console.error(e);
  } finally {
    await pool.close();
  }
}

test();
