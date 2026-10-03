// Conekta y MercadoPago no guardaban el payload crudo de su webhook en
// ninguna tabla -- a diferencia de Stripe y PayPal (`webhook_logs`) y OpenPay
// (`openpay_webhook_events`). Sin eso, no habia forma de comprobar despues
// que un procesador de verdad no manda un dato (ej. `charge.fee` de Conekta,
// pendiente 5 de la entrada 33) salvo leyendo el resultado ya procesado.
// Pedido explicito de Axel al retomar el pendiente 6: que los cinco
// webhooks dejen rastro, no solo los tres que ya lo hacian.
//
// Esta guardia falla si alguno de los cinco deja de escribir su rastro.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

function escribeRastro(ruta, patron) {
  const fuente = readFileSync(ruta, 'utf8');
  return patron.test(fuente);
}

for (const [nombre, ruta, patron] of [
  ['stripe-webhook', 'supabase/functions/stripe-webhook/index.ts', /\.from\(['"]webhook_logs['"]\)\s*\.insert/],
  ['paypal-webhook', 'supabase/functions/paypal-webhook/index.ts', /\.from\(['"]webhook_logs['"]\)\s*\.insert/],
  ['conekta-webhook', 'supabase/functions/conekta-webhook/index.ts', /\.from\(['"]webhook_logs['"]\)\s*\.insert/],
  ['mercadopago-webhook', 'supabase/functions/mercadopago-webhook/index.ts', /\.from\(['"]webhook_logs['"]\)\s*\.insert/],
  ['openpay-webhook', 'supabase/functions/openpay-webhook/index.ts', /\.from\(['"]openpay_webhook_events['"]\)\s*\.insert/],
]) {
  assert.ok(escribeRastro(ruta, patron), `${nombre} no deja rastro del payload crudo del webhook`);
}

console.log('OK: los cinco webhooks de pago dejan rastro del payload crudo que reciben.');
