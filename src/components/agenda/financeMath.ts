import type { DepartureReservation } from '../../types/externalSales';

const sum = (rows: DepartureReservation[], pick: (r: DepartureReservation) => number | null) => rows.reduce((s, r) => s + (pick(r) ?? 0), 0);

/** El dinero viene NULL si el usuario no tiene permiso financiero: sin ninguna cifra no se pinta nada. */
export const canSeeMoney = (rows: DepartureReservation[]) => rows.some(r => r.total_amount !== null);

export function summarize(rows: DepartureReservation[]) {
  const tr = rows.filter(r => r.origin === 'ToursRed');
  // Una venta externa en otra moneda no se suma a pesos: se avisa en vez de mezclarla.
  const allExt = rows.filter(r => r.origin === 'Externa');
  const ext = allExt.filter(r => (r.currency ?? 'MXN') === 'MXN');
  const foreignCurrency = allExt.length - ext.length;
  const t = {
    total: sum(tr, r => r.total_amount), collected: sum(tr, r => r.collected_amount), pending: sum(tr, r => r.pending_amount),
    releasePending: sum(tr, r => r.release_pending_amount), released: sum(tr, r => r.released_amount),
    hasPlan: tr.some(r => r.has_payment_plan),
  };
  const e = { total: sum(ext, r => r.total_amount), collected: sum(ext, r => r.collected_amount), pending: sum(ext, r => r.pending_amount) };
  return { t, e, foreignCurrency, grandTotal: t.total + e.total, grandCollected: t.collected + e.collected, grandPending: t.pending + e.pending };
}

