# Facturacion Formularios Continuos - Analisis

Fecha: 2026-08-12  
Alcance: auditoria de solo lectura para disenar el modulo de facturacion electronica de formularios continuos.

## Objetivo

Crear un modulo de facturas para formularios continuos que permita seleccionar una o varias GRE electronicas emitidas por este sistema, cargar sus items y generar la factura electronica correspondiente.

El flujo GRE ya validado con Bizlinks/SUNAT no debe modificarse.

## Reglas De Seguridad

- No se ejecutaron `INSERT`, `UPDATE`, `DELETE` ni `ALTER` durante esta auditoria.
- No se modifico el flujo GRE.
- No se tocaron `EMPAQUE` ni `EMPAQUE_DETALLE`.
- No se debe reutilizar el contrato de GRE para facturas.
- No se debe afectar el sistema de flexografia ni sus series.

## Hallazgo Principal

La GRE de formularios continuos usa serie `T001`, pero la factura electronica observada en YCHIDB3 usa serie `F01`.

Por tanto:

- `T001-...` debe tratarse como guia referenciada.
- `F01-...` debe tratarse como factura electronica.
- La factura debe enlazarse a una o varias GRE aceptadas.

## YCHIDB3

### Encabezado De Documento

Tabla principal:

- `dbo.tbDocumentos`

Columnas relevantes:

- `idDocumento`
- `idTipoDocu`
- `idClieProv`
- `SeriDocu`
- `NumeDocu`
- `DescClieProv`
- `formaPago`
- `Encargado`
- `Moneda`
- `Neto`
- `Igv`
- `Total`
- `Observaciones`
- `FechaEmision`
- `FechaVencimiento`
- `CORREO`
- `cuenta`
- `nguia`

Patrones observados:

- Factura electronica: `idTipoDocu = 1`, `SeriDocu = 'F01'`.
- Guia fisica/remision antigua: `idTipoDocu = 8`, `SeriDocu = '001'`.
- `tbDocumentos.nguia` guarda la GRE referenciada, por ejemplo `T001-00000020`.

### Detalle De Factura

Tabla:

- `dbo.tbDetFact`

Columnas:

- `idDetFact`
- `idDocumento`
- `idProducto`
- `idDetOrdenVenta`
- `idRecepcionOt`
- `idUnidad`
- `Descripcion`
- `Cantidad`
- `Precio`
- `Igv`
- `Neto`
- `Total`
- `numorden`

Ejemplo observado para `F01-0017092`:

- `Cantidad = 10`
- `Precio = 75`
- `Igv = 13.5`
- `Descripcion = REPRESENTACION IMPRESA ELECTRONICO...`

Pendiente: confirmar si `Neto` y `Total` en detalle se guardan en cero por convencion del sistema o si dependen de otro flujo.

### Relacion Documento-Guia

Tabla:

- `dbo.tbdocumento_guia`

Columnas:

- `id_docuguia`
- `id_documento`
- `id_clieprov`
- `nombre`
- `id_recepcion`
- `direccion_entrega`
- `forma_pago`
- `iddistrito`
- `observacion2`
- `observacion3`

Esta tabla parece guardar informacion de guia fisica/documento logistico dentro de Ychiscom.

### Relacion Factura-Guia

Tabla identificada:

- `dbo.tbGuiasFactura`

Columnas por metadatos:

- `idGuiaFactura`
- `iddocumento`
- `iddocAfectado`
- `Concepto`

Pendiente: falta permiso `SELECT` directo para auditar filas reales. Es necesario confirmar si `iddocumento` es factura y `iddocAfectado` es guia, o viceversa.

### Formas De Pago

Tabla:

- `dbo.tbPropiedades`

Para formas de pago:

- `tipo = 'FPAG'`

### Correlativos

Funciones encontradas:

- `F_NumFactVenta`
- `F_NumFactElectronica`
- `F_NumFactElectronica_FC01`
- `F_NumFactElectronica_FC03`
- `F_NumFactElectronica_FF03`

Estas funciones consultan `TBTIPODOCU` para obtener numeracion. Antes de producir facturas se debe auditar como Ychiscom reserva el correlativo y aplicar bloqueo transaccional para evitar duplicados.

## BIZLINKS_PROD21

### Tablas De Facturacion Electronica

Objetos identificados:

- `dbo.SPE_EINVOICEHEADER`
- `dbo.SPE_EINVOICEDETAIL`
- `dbo.SPE_EINVOICE_REFERENCE`
- `dbo.SPE_EINVOICE_RESPONSE`
- `dbo.SPE_EINVOICEHEADER_ADD`
- `dbo.AAA_GUIAFACTURADA`

`AAA_GUIAFACTURADA` tiene:

- `ID`
- `RUC_EMISOR`
- `NRO_GUIA`
- `NRO_FACTURA`
- `FECHA_EMISION`
- `USUARIO`
- `ESTADO`
- `NOTACRE`

Hallazgo importante: `USP_EnviaDocumentoFE` usa `AAA_GUIAFACTURADA` para llevar la GRE referenciada hacia `SPE_EINVOICEHEADER.numeroDocumentoReferencia_1` y `tipoReferencia_1 = '09'`.

### Procedimientos Oficiales

Procedimientos identificados para factura:

- `dbo.USP_CabeceraFE`
- `dbo.USP_DetalleFE`
- `dbo.USP_EnviaDocumentoFE`

Tambien existen:

- `dbo.SPI_FACTURA_ELECTRONICA`
- `dbo.SPI_DETALLE_FACTURA_ELECTRONICA`

Pendiente: definir si el sistema nuevo debe usar los `USP_*` como se hizo con GRE o los `SPI_*`. La preferencia inicial es seguir el patron exitoso de GRE: procedimientos oficiales de cabecera, detalle y envio.

### Activacion Bizlinks

Para facturas, `USP_EnviaDocumentoFE` recibe:

- `numeroDocumentoEmisor`
- `serieNumero`
- `tipoDocumento`

Para factura electronica:

- `tipoDocumento = '01'`

Debe ejecutarse solo despues de crear cabecera, detalles y relacion de guia cuando corresponda.

## Flujo Propuesto

1. Usuario entra a `Facturas`.
2. Selecciona cliente.
3. Selecciona tipo documento: Factura.
4. El sistema muestra serie/correlativo `F01`.
5. Selecciona forma de pago.
6. Selecciona cuenta contable.
7. Confirma o edita OC.
8. El sistema lista GRE `T001` aceptadas y no facturadas del cliente.
9. Usuario selecciona una o varias GRE.
10. El sistema carga items de las GRE seleccionadas.
11. Usuario confirma precios, cantidades, cuenta contable y forma de pago.
12. El sistema calcula gravada, IGV y total.
13. Vista previa de factura.
14. Declaracion controlada usando contrato oficial Bizlinks de factura.
15. Consulta de estado y PDF.

## Fuente De Guias Para Facturar

Debe salir de trazabilidad propia y Bizlinks:

- `GRE_FC_OPERACION`
- `GRE_FC_DETALLE`
- `GRE_FC_ENVIO`
- `SPE_DESPATCH`
- `SPE_DESPATCH_RESPONSE`

Criterio inicial:

- Guia `T001`.
- Guia aceptada por Bizlinks/SUNAT.
- Mismo cliente.
- No facturada previamente.

La marca "no facturada" debe validarse contra:

- `AAA_GUIAFACTURADA.NRO_GUIA`
- `tbDocumentos.nguia`
- posiblemente `tbGuiasFactura`, cuando se confirme la relacion exacta.

## Tablas Propias Recomendadas

Crear trazabilidad propia, separada de GRE:

- `FC_FACT_OPERACION`
- `FC_FACT_GUIA`
- `FC_FACT_DETALLE`
- `FC_FACT_ENVIO`
- `FC_FACT_EVENTO`

Estas tablas deben guardar idempotencia, guias asociadas, snapshot de items, totales, serie de factura y eventos.

## Endpoints Futuros

Propuesta:

- `GET /api/fc-facturas/clientes/search?q=...`
- `GET /api/fc-facturas/guias-pendientes?cliente=...`
- `POST /api/fc-facturas/preview`
- `POST /api/fc-facturas/declarar-test`
- `GET /api/fc-facturas/:operationId/status`
- `GET /api/fc-facturas`
- `GET /api/fc-facturas/:serieNumero/pdf`

## Permisos Pendientes

Para terminar la auditoria real antes de implementar declaracion:

```sql
USE YCHIDB3;
GO
GRANT SELECT ON dbo.tbGuiasFactura TO gre_app_test;
GO

USE BIZLINKS_PROD21;
GO
GRANT SELECT ON dbo.SPE_EINVOICEHEADER TO gre_app_test;
GRANT SELECT ON dbo.SPE_EINVOICEDETAIL TO gre_app_test;
GRANT SELECT ON dbo.SPE_EINVOICE_REFERENCE TO gre_app_test;
GRANT SELECT ON dbo.SPE_EINVOICE_RESPONSE TO gre_app_test;
GRANT SELECT ON dbo.SPE_EINVOICEHEADER_ADD TO gre_app_test;
GRANT SELECT ON dbo.AAA_GUIAFACTURADA TO gre_app_test;
GO
```

Para una fase posterior de prueba controlada, no ahora:

```sql
USE BIZLINKS_PROD21;
GO
GRANT EXECUTE ON dbo.USP_CabeceraFE TO gre_app_test;
GRANT EXECUTE ON dbo.USP_DetalleFE TO gre_app_test;
GRANT EXECUTE ON dbo.USP_EnviaDocumentoFE TO gre_app_test;
GO
```

No otorgar permisos sobre `EMPAQUE` ni `EMPAQUE_DETALLE`.

## Riesgos

- Confundir la serie de guia `T001` con la serie de factura `F01`.
- Facturar una GRE ya facturada.
- Crear factura sin relacion en `AAA_GUIAFACTURADA`, dejando Bizlinks sin referencia a guia.
- Calcular mal IGV, gravada o total.
- Usar una cuenta contable incorrecta.
- No tener precio unitario en la GRE; puede requerirse tomarlo de YCHIDB3 o permitir ingreso controlado.
- Duplicar correlativos si no se reserva `F01` con bloqueo.
- Activar ramas de nota de credito/debito que si referencian `EMPAQUE`; esta fase debe limitarse a factura `01`.

## Decision Inicial Recomendada

La siguiente fase no debe declarar facturas todavia. Primero debe construir:

1. Wireframe de `Facturas`.
2. Busqueda de cliente.
3. Listado de GRE `T001` aceptadas y pendientes de facturar.
4. Seleccion multiple de guias.
5. Carga de items.
6. Calculo de totales en preview.
7. Validacion de no duplicidad.

Despues de validar la UI y los datos, se implementa declaracion con SP oficiales de factura.

## Auditoria 2026-08-14

Se audito por metadatos el contrato Bizlinks de factura electronica.

Procedimientos confirmados:

- `dbo.USP_CabeceraFE`: 119 parametros.
- `dbo.USP_DetalleFE`: 36 parametros.
- `dbo.USP_EnviaDocumentoFE`: 3 parametros (`NUMERODOCUMENTOEMISOR`, `SERIENUMERO`, `TIPODOCUMENTO`).

Para factura electronica FC:

- `SERIENUMERO`: `FF01-00000001`.
- `TIPODOCUMENTO`: `01`.
- Guia T001 referenciada en encabezado como `GUIAREMISION`/`TIPOGUIAREMISION`.
- `SPE_EINVOICE_RESPONSE` contiene `bl_url_pdf`, `bl_pdf`, `bl_url_cdr`, `bl_url_ubl`, `bl_estadoProceso`, `bl_mensajeSunat` y estados de adjuntos.

Permisos observados como faltantes para completar prueba real:

- `EXECUTE` en `USP_CabeceraFE`, `USP_DetalleFE`, `USP_EnviaDocumentoFE`.
- `SELECT` en `SPE_EINVOICEDETAIL`.
- `SELECT` en `SPE_EINVOICE_RESPONSE`.
- `INSERT` en `AAA_GUIAFACTURADA`, si el SP no crea la relacion por si mismo.
- `SELECT` en `YCHIDB3.dbo.tbGuiasFactura`.
- `SELECT` en `YCHIDB3.dbo.TBTIPODOCU`.

Se agrego:

- Migracion `migrations/GRE_FORMULARIOS_TEST/004_create_fc_facturacion_tables.sql` para trazabilidad propia `FC_FACT_*`.
- Script manual `sql/manual/2026-08-14_fc_facturacion_permissions.sql` para permisos por etapas.
- Mapper `src/mappers/fcFacturaProcedureMapper.ts` para preparar parametros de `USP_CabeceraFE`, `USP_DetalleFE` y `USP_EnviaDocumentoFE` desde el preview.

Nota tecnica: esta instancia SQL no reconoce `TRY_CONVERT`; evitarlo en nuevas consultas.
