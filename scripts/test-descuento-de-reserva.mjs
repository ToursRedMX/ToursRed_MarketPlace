#!/usr/bin/env node
/**
 * Pruebas del calculo de descuento de una reserva.
 *
 * ============================================================================
 * POR QUE EXISTE
 * ============================================================================
 *
 * La RPC devuelve el CODIGO, no el monto. Quien calcula es el front, y el
 * 12-sep-2026 se descubrio que llevaba tiempo calculando MAL:
 * `BookingFlowStep4` leia `result.discount_amount`, un campo que la RPC **no
 * devuelve**, asi que el descuento era siempre 0.
 *
 * Las trampas que se prueban aqui son las que producen una cifra CREIBLE y
 * equivocada, que es la peor clase:
 *
 *   TRAMPA 1 -- confundir los tres destinos. Un codigo de `service_fees`
 *   aplicado al precio del tour le quita dinero a la AGENCIA; uno de
 *   `total_price` aplicado al pago inicial regala saldo que nadie descontara
 *   despues. Los tres importes existen y los tres se ven razonables.
 *
 *   TRAMPA 2 -- adivinar el tipo por subcadena. `BookingForm` decidia con
 *   `discount_type.includes('percentage')`, y el CHECK de la base admite
 *   DIECISIETE tipos: cuatro familias que no son de tour caerian en la rama de
 *   porcentaje y descontarian de una reserva un codigo de membresia.
 *
 *   TRAMPA 3 -- un porcentaje mayor que 100. El CHECK solo exige
 *   `discount_value > 0`, asi que un codigo del 150% da un precio NEGATIVO.
 *
 *   node scripts/test-descuento-de-reserva.mjs
 */
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';

const AQUI = path.dirname(fileURLToPath(import.meta.url));

if (!process.execArgv.some((a) => a.includes('strip-types'))) {
  const r = spawnSync(
    process.execPath,
    ['--experimental-strip-types', '--no-warnings', fileURLToPath(import.meta.url), ...process.argv.slice(2)],
    { stdio: 'inherit' },
  );
  process.exit(r.status ?? 1);
}

const { dondeAplica, montoDeDescuento, descuentoDeCargoPorServicio } = await import(
  pathToFileURL(path.join(AQUI, '..', 'src', 'utils', 'descuentoDeReserva.ts')).href
);

let casos = 0;
const caso = (nombre, fn) => { fn(); casos += 1; console.log(`  ok  ${nombre}`); };

const codigo = (extra = {}) => ({
  code_id: 'c1', code: 'PRUEBA',
  discount_type: 'tour_percentage', discount_value: 10,
  discount_applies_to: 'total_price', max_discount_amount: null,
  applicable_to: 'tours',
  ...extra,
});

// Los 17 tipos del CHECK real, leidos de la base el 12-sep-2026.
const TIPOS_DEL_CHECK = [
  'tour_percentage', 'tour_fixed', 'agency_tour_percentage', 'agency_tour_fixed',
  'membership_free_month', 'membership_percentage', 'membership_fixed',
  'gift_card_percentage', 'gift_card_fixed',
  'service_fee_percentage', 'service_fee_fixed', 'service_fee_full',
  'insurance_percentage', 'insurance_fixed', 'insurance_free',
  'featured_percentage', 'featured_fixed',
];

caso('1. porcentaje y fijo sobre el precio del tour', () => {
  assert.equal(montoDeDescuento(codigo({ discount_value: 10 }), 1000), 100);
  assert.equal(montoDeDescuento(codigo({ discount_type: 'tour_fixed', discount_value: 250 }), 1000), 250);
  // Los de agencia se comportan igual.
  assert.equal(montoDeDescuento(codigo({ discount_type: 'agency_tour_percentage', discount_value: 25 }), 400), 100);
  assert.equal(montoDeDescuento(codigo({ discount_type: 'agency_tour_fixed', discount_value: 50 }), 400), 50);
});

caso('2. el tope max_discount_amount manda sobre el porcentaje', () => {
  assert.equal(montoDeDescuento(codigo({ discount_value: 50, max_discount_amount: 120 }), 1000), 120);
  // Si el tope es mayor que lo calculado, no estorba.
  assert.equal(montoDeDescuento(codigo({ discount_value: 10, max_discount_amount: 500 }), 1000), 100);
});

caso('3. un porcentaje mayor que 100 NO produce un total negativo', () => {
  // El CHECK solo exige discount_value > 0. BookingForm no topaba esto.
  assert.equal(montoDeDescuento(codigo({ discount_value: 150 }), 1000), 1000);
  assert.equal(montoDeDescuento(codigo({ discount_type: 'tour_fixed', discount_value: 5000 }), 1000), 1000);
});

caso('4. LOS TRES DESTINOS no se confunden', () => {
  assert.equal(dondeAplica(codigo()), 'precio_total');
  assert.equal(dondeAplica(codigo({ discount_applies_to: 'payment_amount' })), 'monto_a_pagar');
  assert.equal(
    dondeAplica(codigo({ applicable_to: 'service_fees', discount_type: 'service_fee_full' })),
    'cargo_por_servicio',
  );
});

caso('5. `service_fees` manda aunque discount_applies_to diga otra cosa', () => {
  // Un codigo incoherente no puede acabar rebajando el precio del tour: eso le
  // quitaria dinero a la agencia por un descuento que paga la plataforma.
  const incoherente = codigo({
    applicable_to: 'service_fees',
    discount_type: 'service_fee_percentage',
    discount_applies_to: 'total_price',
  });
  assert.equal(dondeAplica(incoherente), 'cargo_por_servicio');
  assert.equal(montoDeDescuento(incoherente, 1000), 0, 'un codigo de cargo por servicio rebajo el tour');
});

caso('6. los tipos que NO son de tour no descuentan del tour', () => {
  // La trampa de `.includes("percentage")`: cuatro familias ajenas caerian ahi.
  for (const tipo of ['membership_percentage', 'gift_card_percentage',
                      'insurance_percentage', 'featured_percentage']) {
    const ajeno = codigo({ discount_type: tipo, applicable_to: 'tours' });
    assert.equal(montoDeDescuento(ajeno, 1000), 0, `${tipo} descontó de una reserva de tour`);
    assert.equal(dondeAplica(ajeno), 'ninguno');
  }
});

caso('7. un codigo de OTRO ambito no aplica, aunque su tipo sea de tour', () => {
  for (const ambito of ['memberships', 'gift_cards', 'insurance', 'featured_slots']) {
    const c = codigo({ applicable_to: ambito });
    assert.equal(dondeAplica(c), 'ninguno', `un codigo de ${ambito} aplicó a la reserva`);
    assert.equal(montoDeDescuento(c, 1000), 0);
  }
});

caso('8. los TRES tipos de cargo por servicio, cada uno a su manera', () => {
  const cf = (t, v) => codigo({ applicable_to: 'service_fees', discount_type: t, discount_value: v });
  // `full` exonera el cargo entero e IGNORA discount_value.
  assert.equal(descuentoDeCargoPorServicio(cf('service_fee_full', 1), 87.5), 87.5);
  assert.equal(descuentoDeCargoPorServicio(cf('service_fee_percentage', 50), 87.5), 43.75);
  assert.equal(descuentoDeCargoPorServicio(cf('service_fee_fixed', 30), 87.5), 30);
  // Nunca mas que el cargo.
  assert.equal(descuentoDeCargoPorServicio(cf('service_fee_fixed', 500), 87.5), 87.5);
});

caso('9. un codigo de tour NO baja el cargo por servicio, y viceversa', () => {
  assert.equal(descuentoDeCargoPorServicio(codigo(), 87.5), 0, 'un codigo de tour rebajó el cargo');
  const deCargo = codigo({ applicable_to: 'service_fees', discount_type: 'service_fee_full' });
  assert.equal(montoDeDescuento(deCargo, 1000), 0);
});

caso('10. nada revienta con datos ausentes o absurdos', () => {
  assert.equal(montoDeDescuento(null, 1000), 0);
  assert.equal(montoDeDescuento(undefined, 1000), 0);
  assert.equal(dondeAplica(null), 'ninguno');
  assert.equal(montoDeDescuento(codigo(), 0), 0);
  assert.equal(montoDeDescuento(codigo(), -50), 0);
  assert.equal(descuentoDeCargoPorServicio(null, 87.5), 0);
  // `discount_applies_to` ausente cae al comportamiento por defecto: precio.
  assert.equal(dondeAplica(codigo({ discount_applies_to: null })), 'precio_total');
});

caso('11. TODOS los tipos del CHECK estan clasificados, ninguno se cuela', () => {
  // Si mañana el CHECK gana un tipo nuevo, este caso lo obliga a decidir en vez
  // de dejarlo caer en una rama por accidente.
  const deTour = ['tour_percentage', 'tour_fixed', 'agency_tour_percentage', 'agency_tour_fixed'];
  const deCargo = ['service_fee_percentage', 'service_fee_fixed', 'service_fee_full'];

  for (const tipo of TIPOS_DEL_CHECK) {
    const comoTour  = dondeAplica(codigo({ discount_type: tipo, applicable_to: 'tours' }));
    const comoCargo = dondeAplica(codigo({ discount_type: tipo, applicable_to: 'service_fees' }));

    if (deTour.includes(tipo)) {
      assert.equal(comoTour, 'precio_total', `${tipo} deberia aplicar al tour`);
    } else {
      assert.equal(comoTour, 'ninguno', `${tipo} NO deberia aplicar al tour`);
    }
    if (deCargo.includes(tipo)) {
      assert.ok(descuentoDeCargoPorServicio(
        codigo({ discount_type: tipo, applicable_to: 'service_fees', discount_value: 10 }), 100) > 0,
        `${tipo} deberia descontar del cargo`);
    } else {
      assert.equal(comoCargo, 'cargo_por_servicio', `${tipo} con ambito service_fees deberia ir al cargo`);
      assert.equal(descuentoDeCargoPorServicio(
        codigo({ discount_type: tipo, applicable_to: 'service_fees', discount_value: 10 }), 100), 0,
        `${tipo} no es de cargo y aun asi descontó`);
    }
  }
});

caso('12. el redondeo es a dos decimales, como el dinero', () => {
  // 33.333...% de 100 no puede quedar en 33.333333333333336
  assert.equal(montoDeDescuento(codigo({ discount_value: 33.333 }), 100), 33.33);
  assert.equal(descuentoDeCargoPorServicio(
    codigo({ applicable_to: 'service_fees', discount_type: 'service_fee_percentage', discount_value: 33.333 }),
    100), 33.33);
});

console.log(`\nDescuento de reserva: ${casos}/12 casos OK`);
if (casos !== 12) { console.error('faltaron casos'); process.exit(1); }
