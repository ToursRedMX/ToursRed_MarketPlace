// Cuando un procesador no manda su comision real (o la manda en 0 -- medido
// en Conekta: 14 de 14 cobros historicos, pendiente 5 de la entrada 33), se
// estima con la tasa configurada en platform_settings. Misma formula que ya
// usa create_accounting_entry_for_booking como respaldo para los cinco
// procesadores (migracion 20260804042551): no es una tasa nueva, es la que
// ya existia para el mismo proposito, aplicada ahora tambien en el webhook
// para que payment_transactions.processor_fee no se quede en 0.
export function estimarComisionProcesador(montoCobrado: number, porcentaje: number, fijo: number): number {
  return Math.round((montoCobrado * porcentaje / 100 + fijo) * 100) / 100;
}

// La primera comision REAL (en centavos, > 0) de una lista de candidatos, en
// orden de preferencia; null si ninguna sirve. Existe porque la orden que
// conekta-webhook vuelve a pedir a la API llego SIN `fee` mientras el evento
// firmado del mismo cobro si la traia (12-oct-2026, orden ord_31u32BWu46zQSZq1x:
// API fee=undefined, evento fee=2320) y se termino estimando 18.95 en lugar de
// los 23.20 reales. `posicion` dice cual candidato gano, para dejarlo anotado.
export function comisionRealCentavos(candidatos: unknown[]): { centavos: number; posicion: number } | null {
  for (let posicion = 0; posicion < candidatos.length; posicion++) {
    const c = candidatos[posicion];
    const valido = typeof c === 'number' || (typeof c === 'string' && /^\d+(\.\d+)?$/.test(c));
    const n = valido ? Number(c) : NaN;
    if (Number.isFinite(n) && n > 0) return { centavos: n, posicion };
  }
  return null;
}
