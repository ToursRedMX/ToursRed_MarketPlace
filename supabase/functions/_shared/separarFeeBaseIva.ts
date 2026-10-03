// MercadoPago (y Conekta, Stripe, PayPal) mandan la comision como un solo
// monto con IVA ya incluido -- a diferencia de OpenPay, que la manda
// desglosada (`fee: { amount, tax }`). Misma formula que
// create_accounting_entry_for_booking ya usa para separarla cuando solo
// tiene el total (migracion 20260804042551): base = fee / 1.16, redondeado;
// iva = fee - base. Pendiente 6 de la entrada 33: `processor_fee_base` y
// `processor_fee_iva` quedaban NULL para MercadoPago porque nadie los
// escribia, aunque el dato (el fee total) si llegaba.
export function separarFeeBaseIva(feeTotal: number): { base: number; iva: number } {
  if (!feeTotal) return { base: 0, iva: 0 };
  const base = Math.round((feeTotal / 1.16) * 100) / 100;
  const iva = Math.round((feeTotal - base) * 100) / 100;
  return { base, iva };
}
