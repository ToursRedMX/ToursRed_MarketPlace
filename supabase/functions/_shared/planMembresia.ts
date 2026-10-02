// El plan de la membresia viaja con DOS vocabularios y nadie lo traducia:
//
//   - el flujo de reserva de 4 pasos y create_booking_atomic: 'mensual' | 'anual'
//     (la RPC cotiza con `= 'anual'` y guarda el valor tal cual en
//     bookings.membership_plan);
//   - Stripe, el webhook y memberships.plan_type: 'monthly' | 'annual'.
//
// Hasta el 02-oct-2026 create-checkout-session elegia el precio con
// `membershipPlan === 'monthly'`, asi que 'mensual' caia en el ANUAL: el
// viajero veia $89 y Stripe le habria cobrado $890. Y los lectores de
// bookings.membership_plan comparaban unos contra 'monthly' y otros contra
// 'annual', de modo que cada uno se equivocaba con un plan distinto.
//
// Se lee SIEMPRE por aqui. Devuelve null ante cualquier otra cosa, para que el
// que llama decida (rechazar el cobro), en vez de adivinar un plan.
//
// Copia en src/lib/planMembresia.ts: el front no importa de supabase/functions.
export type PlanMembresia = "monthly" | "annual";

export function normalizarPlanMembresia(valor: unknown): PlanMembresia | null {
  switch (String(valor ?? "").trim().toLowerCase()) {
    case "monthly":
    case "mensual":
      return "monthly";
    case "annual":
    case "anual":
      return "annual";
    default:
      return null;
  }
}

export function etiquetaPlanMembresia(valor: unknown): "Mensual" | "Anual" | null {
  const plan = normalizarPlanMembresia(valor);
  return plan === "annual" ? "Anual" : plan === "monthly" ? "Mensual" : null;
}
