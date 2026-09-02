export function getSingleUuidArg(args = process.argv.slice(2), commandName = 'gre:test:verify') {
  const candidates = args.filter((arg) => arg && arg !== '--' && arg !== '***');
  const operationId = candidates[0];
  const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

  if (!operationId) {
    return {
      ok: false as const,
      message: `No se recibio operationId. Uso: npm run ${commandName} -- <operationId>`
    };
  }

  if (!uuidPattern.test(operationId)) {
    return {
      ok: false as const,
      message: `operationId invalido: ${operationId}. Debe ser un UUID.`
    };
  }

  return { ok: true as const, value: operationId };
}

export function getTwoSerieArgs(args = process.argv.slice(2)) {
  const candidates = args.filter((arg) => arg && arg !== '--' && arg !== '***');
  const [left, right] = candidates;
  const seriePattern = /^T999-\d{8}$/;

  if (!left || !right) {
    return {
      ok: false as const,
      message: 'Faltan series. Uso: npm run gre:test:diff -- T999-00000095 T999-00000096'
    };
  }

  if (!seriePattern.test(left) || !seriePattern.test(right)) {
    return {
      ok: false as const,
      message: `Series invalidas: ${left} ${right}. Deben tener formato T999-00000000.`
    };
  }

  return { ok: true as const, left, right };
}

export function getSingleSerieArg(args = process.argv.slice(2), commandName = 'gre:test:diagnose-e') {
  const candidates = args.filter((arg) => arg && arg !== '--' && arg !== '***');
  const serieNumeroGuia = candidates[0];
  const seriePattern = /^T999-\d{8}$/;

  if (!serieNumeroGuia) {
    return {
      ok: false as const,
      message: `No se recibio serieNumeroGuia. Uso: npm run ${commandName} -- T999-00000096`
    };
  }

  if (!seriePattern.test(serieNumeroGuia)) {
    return {
      ok: false as const,
      message: `serieNumeroGuia invalida: ${serieNumeroGuia}. Debe tener formato T999-00000000.`
    };
  }

  return { ok: true as const, value: serieNumeroGuia };
}
