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
