// Copia de supabase/functions/_shared/planMembresia.ts (el front no importa de
// supabase/functions). Ahi esta la historia: el plan viaja como
// 'mensual'/'anual' desde el flujo de reserva y la RPC, y como
// 'monthly'/'annual' en Stripe y memberships; cada pantalla comparaba contra
// uno solo y se equivocaba con el otro.
export type PlanMembresia = 'monthly' | 'annual';

export function normalizarPlanMembresia(valor: unknown): PlanMembresia | null {
  switch (String(valor ?? '').trim().toLowerCase()) {
    case 'monthly':
    case 'mensual':
      return 'monthly';
    case 'annual':
    case 'anual':
      return 'annual';
    default:
      return null;
  }
}

export function etiquetaPlanMembresia(valor: unknown): 'Mensual' | 'Anual' | null {
  const plan = normalizarPlanMembresia(valor);
  return plan === 'annual' ? 'Anual' : plan === 'monthly' ? 'Mensual' : null;
}
