/**
 * Prueba de `_shared/coberturaDePago.ts` — segunda mitad de C-1.
 *
 * Los casos NO son inventados: son las reservas reales del proyecto medidas el
 * 09-sep-2026 contra las 26 confirmaciones que no son de PayPal (07-jul a
 * 05-sep). Estan aqui para que el dia que alguien toque las reglas vea de
 * inmediato cuales se romperian.
 *
 * Los dos que importan:
 *
 *   TRG-E5BGCYW29XY  paga 4,706.84 con tarjeta + 562.61 en puntos sobre un
 *                    anticipo de 5,149.50. La regla de `capture-paypal-order`
 *                    —que el doc de la auditoria proponia replicar tal cual—
 *                    la habria dejado SIN CONFIRMAR, porque no suma billetera.
 *
 *   TRG-84KJF6B7FMJ  paga 525 de los 550 que decia `amount_due_now`. Exigir
 *                    `amount_due_now` habria bloqueado una de cada tres
 *                    confirmaciones de Stripe. Aqui solo avisa.
 *
 *   node scripts/test-cobertura-pago.mjs
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

const fuente = readFileSync('supabase/functions/_shared/coberturaDePago.ts', 'utf8');
const compilado = ts.transpileModule(fuente.replace(/^import[^\n]*\n/gm, ''), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText;

const contexto = vm.createContext({ exports: {}, console: { log() {}, warn() {}, error() {} } });
vm.runInContext(compilado, contexto);
const { verificarCoberturaDePago } = contexto.exports;

/** supabase de mentiras: solo responde a las dos lecturas que hace el helper. */
function supabaseFalso({ reserva, errorReserva = null, pagosPrevios = [], errorPagos = null }) {
  return {
    from(tabla) {
      const cadena = {
        select: () => cadena,
        eq: () => cadena,
        maybeSingle: async () => ({ data: reserva, error: errorReserva }),
        then: undefined,
      };
      if (tabla === 'payment_transactions') {
        // la consulta de pagos previos termina en el tercer .eq(), sin maybeSingle
        let eqs = 0;
        const cadenaPagos = {
          select: () => cadenaPagos,
          eq: () => {
            eqs++;
            return eqs >= 3
              ? Promise.resolve({ data: pagosPrevios, error: errorPagos })
              : cadenaPagos;
          },
        };
        return cadenaPagos;
      }
      return cadena;
    },
  };
}

const casos = [
  {
    nombre: 'TRG-PZKEAXWBZIV — confirmada sin una sola transaccion (07-jul)',
    reserva: { deposit_amount: 475, amount_due_now: null, membership_cost: 0, points_used: 0, toursred_cash_used: 0 },
    monto: 0,
    espera: { suficiente: false, sospechosa: false },
  },
  {
    nombre: 'TRG-E5BGCYW29XY — tarjeta + puntos: la regla de PayPal la rompia',
    reserva: { deposit_amount: 5149.50, amount_due_now: 4706.84, membership_cost: 0, points_used: 56261, toursred_cash_used: 0 },
    monto: 4706.84,
    espera: { suficiente: true, sospechosa: false },
  },
  {
    nombre: 'TRG-84KJF6B7FMJ — pago 525 de 550: pasa el piso, pero avisa',
    reserva: { deposit_amount: 500, amount_due_now: 550, membership_cost: 0, points_used: 0, toursred_cash_used: 0 },
    monto: 525,
    espera: { suficiente: true, sospechosa: true },
  },
  {
    nombre: 'TRG-UAH3TAXCECV — puntos + ToursRed Cash + tarjeta',
    reserva: { deposit_amount: 2997.01, amount_due_now: null, membership_cost: 0, points_used: 9103, toursred_cash_used: 1781.51 },
    monto: 1666.47,
    espera: { suficiente: true, sospechosa: false },
  },
  {
    nombre: 'TRG-0DS33SAOP81 — 100% ToursRed Cash, sin amount_due_now',
    reserva: { deposit_amount: 5500, amount_due_now: null, membership_cost: 0, points_used: 0, toursred_cash_used: 5500 },
    monto: 0,
    espera: { suficiente: true, sospechosa: false },
  },
  {
    nombre: 'TRG-IL86G3784RI — mercadopago, exacto',
    reserva: { deposit_amount: 500, amount_due_now: 500, membership_cost: 0, points_used: 0, toursred_cash_used: 0 },
    monto: 500,
    espera: { suficiente: true, sospechosa: false },
  },
  {
    nombre: 'membresia: amount_due_now la incluye pero se cobra por otra via',
    reserva: { deposit_amount: 475, amount_due_now: 564, membership_cost: 89, points_used: 0, toursred_cash_used: 0 },
    monto: 475,
    espera: { suficiente: true, sospechosa: false },
  },
  {
    nombre: 'segundo cobro: se suman los pagos previos, no solo el de este evento',
    reserva: { deposit_amount: 1000, amount_due_now: 1000, membership_cost: 0, points_used: 0, toursred_cash_used: 0 },
    pagosPrevios: [{ amount: 600 }],
    monto: 400,
    espera: { suficiente: true, sospechosa: false },
  },
  {
    nombre: 'cobro de $1 sobre un anticipo de 30,000 — el caso que motivo C-1',
    reserva: { deposit_amount: 30000, amount_due_now: 30000, membership_cost: 0, points_used: 0, toursred_cash_used: 0 },
    monto: 1,
    espera: { suficiente: false, sospechosa: false },
  },
  {
    nombre: 'centavos de redondeo: 0.40 por debajo entra dentro de la tolerancia',
    reserva: { deposit_amount: 500, amount_due_now: 500, membership_cost: 0, points_used: 0, toursred_cash_used: 0 },
    monto: 499.60,
    espera: { suficiente: true, sospechosa: false },
  },
  {
    nombre: 'reintento de Stripe: no se cuenta dos veces el mismo cobro',
    reserva: { deposit_amount: 30000, amount_due_now: 30000, membership_cost: 0, points_used: 0, toursred_cash_used: 0 },
    // La fila que dejo el intento anterior, con el MISMO payment_intent.
    pagosPrevios: [{ amount: 1, stripe_payment_intent_id: 'pi_reintento' }],
    monto: 1,
    paymentIntentId: 'pi_reintento',
    espera: { suficiente: false, sospechosa: false },
  },
  {
    nombre: 'un cobro previo de OTRO procesador (sin payment_intent) si cuenta',
    reserva: { deposit_amount: 1000, amount_due_now: 1000, membership_cost: 0, points_used: 0, toursred_cash_used: 0 },
    pagosPrevios: [{ amount: 700, stripe_payment_intent_id: null }],
    monto: 300,
    paymentIntentId: 'pi_nuevo',
    espera: { suficiente: true, sospechosa: false },
  },
  {
    nombre: 'no se pudo leer la reserva: se confirma igual, pero marcado',
    reserva: null,
    errorReserva: { message: 'timeout' },
    monto: 500,
    espera: { suficiente: true, sospechosa: false, noVerificable: true },
  },
];

let ok = 0;
for (const caso of casos) {
  const resultado = await verificarCoberturaDePago(
    supabaseFalso(caso),
    'booking-de-prueba',
    caso.monto,
    caso.paymentIntentId,
  );

  assert.equal(
    resultado.suficiente, caso.espera.suficiente,
    `${caso.nombre}: suficiente=${resultado.suficiente}, se esperaba ${caso.espera.suficiente} ` +
    `(cubierto ${resultado.cubierto}, piso ${resultado.piso})`,
  );
  assert.equal(
    resultado.sospechosa, caso.espera.sospechosa,
    `${caso.nombre}: sospechosa=${resultado.sospechosa}, se esperaba ${caso.espera.sospechosa} ` +
    `(pagado ${resultado.pagado}, esperado ${resultado.esperado})`,
  );
  if (caso.espera.noVerificable) {
    assert.equal(resultado.detalle.noVerificable, true, `${caso.nombre}: deberia marcarse como no verificable`);
  }
  ok++;
}

console.log(`Cobertura de pago: ${ok}/${casos.length} casos OK`);
