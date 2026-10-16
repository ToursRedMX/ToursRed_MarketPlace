// Un `cus_...` guardado en la base solo vale en la cuenta de Stripe donde se
// creo. `create-checkout-session` y `create-membership-subscription` lo
// reutilizaban sin preguntar, y el 16-oct-2026 el pago mixto (puntos + Stripe)
// de una reserva de prueba murio con «No such customer: 'cus_Uq6pStHfPsq9w7'»:
// ese cliente se habia creado en acct_1Roc3vEs5wtTyCYm y la llave del servidor
// ya apuntaba a acct_1Roc3UEakEqayEr8. Lo mismo le va a pasar a TODO usuario con
// un cliente de prueba guardado el dia que la llave pase a livemode.
//
// Aqui solo se decide si el guardado sigue sirviendo; crear el nuevo y
// guardarlo le toca a cada funcion, porque cada una lo guarda en su tabla.

type StripeConClientes = {
  customers: {
    retrieve(id: string): Promise<{ deleted?: unknown }>;
  };
};

/**
 * true si el cliente existe en la cuenta de la llave actual y no esta borrado.
 * false si Stripe dice que no existe (otra cuenta, otro modo, o borrado).
 * Cualquier otro error se relanza: una caida de red no es motivo para crear
 * un cliente duplicado.
 */
export async function clienteStripeVigente(
  stripe: StripeConClientes,
  customerId: string,
): Promise<boolean> {
  try {
    const cliente = await stripe.customers.retrieve(customerId);
    return !cliente.deleted;
  } catch (error) {
    const codigo = (error as { code?: string; raw?: { code?: string } } | null);
    if (codigo?.code === "resource_missing" || codigo?.raw?.code === "resource_missing") {
      return false;
    }
    throw error;
  }
}
