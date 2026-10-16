// Pedidos de PayPal para suplementos, extras y mensualidades (16-oct-2026).
//
// Hasta hoy el pedido de estos cargos lo creaba create-paypal-order, llamado
// desde el front, con su propio calculo del monto (distinto del de la funcion
// que lo confirma) y sin pasar por el codigo MFA del gasto. Ahora lo crean las
// mismas funciones que lo confirman (process-supplement-payment,
// purchase-post-booking-extras, process-payment-plan-installment), con el monto
// que ellas calculan. Este modulo es lo comun: token, crear y capturar.

export interface CredencialesPaypal {
  clientId: string;
  clientSecret: string;
  sandbox: boolean;
}

export function basePaypal(sandbox: boolean): string {
  return sandbox ? "https://api-m.sandbox.paypal.com" : "https://api-m.paypal.com";
}

async function tokenPaypal(c: CredencialesPaypal): Promise<string> {
  const res = await fetch(`${basePaypal(c.sandbox)}/v1/oauth2/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${btoa(`${c.clientId}:${c.clientSecret}`)}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
  });
  if (!res.ok) throw new Error(`PayPal token: ${res.status} ${await res.text()}`);
  const data = await res.json();
  return data.access_token as string;
}

export interface OrdenPaypal {
  monto: number;
  descripcion: string;
  referencia: string;
  returnUrl: string;
  cancelUrl: string;
  /** PayPal-Request-Id: un reintento con el mismo id no crea otro pedido. */
  requestId: string;
}

/** Crea el pedido y devuelve su id y la URL de aprobacion. Lanza si falla. */
export async function crearOrdenPaypal(c: CredencialesPaypal, o: OrdenPaypal): Promise<{ id: string; url: string }> {
  const token = await tokenPaypal(c);
  const res = await fetch(`${basePaypal(c.sandbox)}/v2/checkout/orders`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}`, "PayPal-Request-Id": o.requestId },
    body: JSON.stringify({
      intent: "CAPTURE",
      purchase_units: [{
        reference_id: o.referencia,
        description: o.descripcion,
        amount: { currency_code: "MXN", value: (Math.round(o.monto * 100) / 100).toFixed(2) },
      }],
      application_context: {
        brand_name: "ToursRed",
        locale: "es-MX",
        landing_page: "BILLING",
        shipping_preference: "NO_SHIPPING",
        user_action: "PAY_NOW",
        return_url: o.returnUrl,
        cancel_url: o.cancelUrl,
      },
    }),
  });
  if (!res.ok) throw new Error(`PayPal orden: ${res.status} ${await res.text()}`);
  const orden = await res.json() as { id: string; links?: Array<{ rel: string; href: string }> };
  const url = orden.links?.find((l) => l.rel === "approve")?.href;
  if (!orden.id || !url) throw new Error("PayPal no devolvio la URL de aprobacion");
  return { id: orden.id, url };
}

/** Captura el pedido aprobado. `ok` solo si PayPal lo dio por COMPLETED. */
export async function capturarOrdenPaypal(
  c: CredencialesPaypal,
  ordenId: string,
): Promise<{ ok: boolean; monto: number; capturaId: string }> {
  const token = await tokenPaypal(c);
  const res = await fetch(`${basePaypal(c.sandbox)}/v2/checkout/orders/${ordenId}/capture`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
  });
  const data = await res.json();
  const captura = data.purchase_units?.[0]?.payments?.captures?.[0];
  return {
    ok: res.ok && data.status === "COMPLETED",
    monto: parseFloat(captura?.amount?.value ?? "0"),
    capturaId: captura?.id ?? ordenId,
  };
}
