import type { GreFormState, GreInputDto } from '../types/gre';

export function toGreInputDto(form: GreFormState): GreInputDto {
  return {
    serieNumeroGuia: `${form.serie}-${form.numero || '00000000'}`,
    fechaEmisionGuia: form.fechaEmisionGuia,
    horaEmisionGuia: form.horaEmisionGuia,
    fechaInicioTraslado: form.fechaInicioTraslado,
    fechaEntregaBienes: form.fechaEntregaBienes,
    observaciones: form.observaciones,
    correoDestinatario: form.correoDestinatario.trim() || '-',
    destinatario: {
      tipoDocumentoDestinatario: form.tipoDocumentoDestinatario,
      numeroDocumentoDestinatario: form.numeroDocumentoDestinatario,
      razonSocialDestinatario: form.razonSocialDestinatario
    },
    traslado: {
      motivoTraslado: form.motivoTraslado,
      descripcionMotivoTraslado: form.descripcionMotivoTraslado,
      pesoBrutoTotalBienes: form.pesoBrutoTotalBienes,
      unidadMedidaPesoBruto: form.unidadMedidaPesoBruto,
      modalidadTraslado: form.modalidadTraslado,
      numeroBultos: form.numeroBultos,
      ubigeoPtoLlegada: form.ubigeoPtoLlegada,
      direccionPtoLlegada: form.direccionPtoLlegada,
      codigoPtoLlegada: form.codigoPtoLlegada
    },
    conductor: {
      tipoDocumentoConductor: form.tipoDocumentoConductor,
      numeroDocumentoConductor: form.numeroDocumentoConductor,
      nombreConductor: form.nombreConductor,
      apellidoConductor: form.apellidoConductor,
      numeroLicencia: form.numeroLicencia
    },
    vehiculo: {
      numeroPlacaVehiculoPrin: form.numeroPlacaVehiculoPrin
    },
    items: form.items.filter((item) => item.incluido).map((item) => ({
      ...item,
      cantidadPendiente: Math.max(0, item.cantidadOriginal - item.cantidad),
      codigoEmpaque: 0 as const
    }))
  };
}
