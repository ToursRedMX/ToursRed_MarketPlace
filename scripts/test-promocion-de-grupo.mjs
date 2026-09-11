#!/usr/bin/env node
/**
 * Pruebas de las promociones de grupo.
 *
 * ============================================================================
 * LAS TRAMPAS
 * ============================================================================
 *
 *   TRAMPA 1 -- `max_uses` dentro de UNA MISMA reserva. La RPC ya descarta la
 *   promocion si los usos estan agotados, pero en `nxprecio` una sola reserva
 *   puede consumir VARIOS: 12 viajeros con min_travelers=4 son tres grupos. Si
 *   solo quedan dos usos, el tercer grupo paga completo. Sin ese tope una
 *   reserva grande se lleva mas descuento del autorizado, y el importe se ve
 *   perfectamente razonable.
 *
 *   TRAMPA 2 -- las MASCOTAS. Cuentan como viajeros en la reserva pero NO para
 *   formar grupo: 3 adultos y 2 perros no son un grupo de 5 para un 3x2.
 *
 *   TRAMPA 3 -- los nombres enganan. `grupo_precio_fijo` aplica un PORCENTAJE
 *   y `nxprecio` aplica un precio FIJO. Quien programe de memoria los cruza.
 *
 *   TRAMPA 4 -- en 2x1/3x2 el viajero gratis se descuenta al precio de ADULTO,
 *   aunque el que sobre sea un nino. Es la regla del negocio, no un descuido:
 *   si se descontara al precio del nino, el descuento cambiaria segun el orden
 *   en que se capturan los viajeros.
 *
 *   node scripts/test-promocion-de-grupo.mjs
 */
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';

const AQUI = path.dirname(fileURLToPath(import.meta.url));
if (!process.execArgv.some((a) => a.includes('strip-types'))) {
  const r = spawnSync(process.execPath,
    ['--experimental-strip-types', '--no-warnings', fileURLToPath(import.meta.url), ...process.argv.slice(2)],
    { stdio: 'inherit' });
  process.exit(r.status ?? 1);
}

const { calcularPromocionDeGrupo, humanos } = await import(
  pathToFileURL(path.join(AQUI, '..', 'src', 'utils', 'promocionDeGrupo.ts')).href
);

let casos = 0;
const caso = (n, fn) => { fn(); casos += 1; console.log(`  ok  ${n}`); };

const promo = (extra = {}) => ({
  id: 'p1', promotion_type: '3x2', min_travelers: 3, group_size: 3, pay_count: 2,
  fixed_group_price: null, group_discount_percentage: null,
  max_uses: null, times_used: 0, ...extra,
});
const gente = (extra = {}) => ({
  adultos: 0, ninos: 0, infantes: 0, adultos_mayores: 0, mascotas: 0, ...extra,
});
const PRECIOS = { adulto: 1000, nino: 600, infante: 0, adulto_mayor: 800 };

caso('1. 3x2: de cada tres, uno gratis al precio de adulto', () => {
  const r = calcularPromocionDeGrupo(promo(), gente({ adultos: 3 }), PRECIOS);
  assert.equal(r.activa, true);
  assert.equal(r.descuento, 1000);
  assert.match(r.etiqueta, /3x2/);

  // Seis viajeros = dos grupos = dos gratis.
  assert.equal(calcularPromocionDeGrupo(promo(), gente({ adultos: 6 }), PRECIOS).descuento, 2000);
  // Cinco = un grupo completo y sobra uno.
  assert.equal(calcularPromocionDeGrupo(promo(), gente({ adultos: 5 }), PRECIOS).descuento, 1000);
});

caso('2. 2x1: de cada dos, uno gratis', () => {
  const p = promo({ promotion_type: '2x1', min_travelers: 2, group_size: 2, pay_count: 1 });
  assert.equal(calcularPromocionDeGrupo(p, gente({ adultos: 2 }), PRECIOS).descuento, 1000);
  assert.equal(calcularPromocionDeGrupo(p, gente({ adultos: 4 }), PRECIOS).descuento, 2000);
});

caso('3. LAS MASCOTAS NO FORMAN GRUPO', () => {
  // 2 adultos + 2 perros NO son un grupo de 3 para un 3x2.
  const r = calcularPromocionDeGrupo(promo(), gente({ adultos: 2, mascotas: 2 }), PRECIOS);
  assert.equal(r.activa, false, 'las mascotas activaron la promocion');
  assert.equal(r.descuento, 0);
  assert.equal(humanos(gente({ adultos: 2, mascotas: 2 })), 2);
});

caso('4. el viajero gratis se descuenta al precio de ADULTO', () => {
  // 2 adultos + 1 nino: el gratis vale 1000 (adulto), no 600 (nino).
  const r = calcularPromocionDeGrupo(promo(), gente({ adultos: 2, ninos: 1 }), PRECIOS);
  assert.equal(r.descuento, 1000, 'se descontó al precio del nino');
});

caso('5. nxprecio: el descuento es lo que el grupo costaria menos el fijo', () => {
  // 4 viajeros, precio normal 4x1000 = 4000, precio de grupo 3000 -> 1000.
  const p = promo({ promotion_type: 'nxprecio', min_travelers: 4, fixed_group_price: 3000 });
  const r = calcularPromocionDeGrupo(p, gente({ adultos: 4 }), PRECIOS);
  assert.equal(r.activa, true);
  assert.equal(r.descuento, 1000);
  assert.match(r.etiqueta, /4 x \$3,000\.00/);
});

caso('6. LA TRAMPA DE max_uses: topa los grupos DENTRO de la reserva', () => {
  const p = promo({
    promotion_type: 'nxprecio', min_travelers: 4, fixed_group_price: 3000,
    max_uses: 2, times_used: 0,
  });
  // 12 viajeros = 3 grupos, pero solo quedan 2 usos -> 2 grupos con promo.
  const r = calcularPromocionDeGrupo(p, gente({ adultos: 12 }), PRECIOS);
  assert.equal(r.descuento, 2000, 'se aplicaron mas grupos de los que autoriza max_uses');
  assert.match(r.etiqueta, /4 viajeros a precio normal/);
  assert.match(r.notaDeDisponibilidad, /agota los usos/);

  // Con usos de sobra, los tres grupos entran.
  const sinTope = promo({ promotion_type: 'nxprecio', min_travelers: 4, fixed_group_price: 3000 });
  assert.equal(calcularPromocionDeGrupo(sinTope, gente({ adultos: 12 }), PRECIOS).descuento, 3000);
});

caso('7. nxprecio avisa cuantos usos quedan', () => {
  const p = promo({
    promotion_type: 'nxprecio', min_travelers: 4, fixed_group_price: 3000,
    max_uses: 5, times_used: 1,
  });
  const r = calcularPromocionDeGrupo(p, gente({ adultos: 4 }), PRECIOS);
  // 5 - 1 usado - 1 de esta reserva = 3
  assert.match(r.notaDeDisponibilidad, /quedan 3 usos/);
});

caso('8. grupo_precio_fijo es un PORCENTAJE, por categoria', () => {
  const p = promo({ promotion_type: 'grupo_precio_fijo', min_travelers: 4, group_discount_percentage: 10 });
  // 2 adultos (1000) + 1 nino (600) + 1 adulto mayor (800) = 3400, 10% = 340
  const r = calcularPromocionDeGrupo(p, gente({ adultos: 2, ninos: 1, adultos_mayores: 1 }), PRECIOS);
  assert.equal(r.activa, true);
  assert.equal(r.descuento, 340, 'no uso el precio de cada categoria');
  assert.match(r.etiqueta, /10% desc/);
});

caso('9. los mensajes de «te falta poco» y cuando NO salen', () => {
  // 3x2 con min 3: con 2 viajeros falta 1 -> mensaje.
  const r1 = calcularPromocionDeGrupo(promo(), gente({ adultos: 2 }), PRECIOS);
  assert.match(r1.mensajeCasiLoLogras, /Agrega 1 viajero mas/);
  assert.equal(r1.activa, false);

  // Con min 10 y 1 viajero faltan 9: demasiado lejos, no se le insiste.
  const lejos = promo({ min_travelers: 10, group_size: 10, pay_count: 9 });
  assert.equal(calcularPromocionDeGrupo(lejos, gente({ adultos: 1 }), PRECIOS).mensajeCasiLoLogras, null);

  // grupo_precio_fijo tolera hasta 3 de distancia, no 2.
  const gp = promo({ promotion_type: 'grupo_precio_fijo', min_travelers: 5, group_discount_percentage: 10 });
  assert.match(
    calcularPromocionDeGrupo(gp, gente({ adultos: 2 }), PRECIOS).mensajeCasiLoLogras,
    /Agrega 3 viajeros mas/,
  );
});

caso('10. LOS NOMBRES NO SE CRUZAN', () => {
  // `grupo_precio_fijo` SIN porcentaje no descuenta, aunque tenga precio fijo.
  const cruzado1 = promo({ promotion_type: 'grupo_precio_fijo', min_travelers: 2, fixed_group_price: 500, group_discount_percentage: null });
  assert.equal(calcularPromocionDeGrupo(cruzado1, gente({ adultos: 4 }), PRECIOS).descuento, 0,
    'grupo_precio_fijo uso fixed_group_price');

  // `nxprecio` SIN precio fijo no descuenta, aunque tenga porcentaje.
  const cruzado2 = promo({ promotion_type: 'nxprecio', min_travelers: 2, fixed_group_price: null, group_discount_percentage: 50 });
  assert.equal(calcularPromocionDeGrupo(cruzado2, gente({ adultos: 4 }), PRECIOS).descuento, 0,
    'nxprecio uso group_discount_percentage');
});

caso('11. un precio de grupo MAS CARO que el normal no cobra de mas', () => {
  const p = promo({ promotion_type: 'nxprecio', min_travelers: 2, fixed_group_price: 9999 });
  const r = calcularPromocionDeGrupo(p, gente({ adultos: 2 }), PRECIOS);
  assert.equal(r.descuento, 0, 'un precio de grupo peor que el normal produjo descuento negativo');
  assert.equal(r.activa, false);
});

caso('12. nada revienta sin promocion o con un tipo desconocido', () => {
  assert.equal(calcularPromocionDeGrupo(null, gente({ adultos: 5 }), PRECIOS).descuento, 0);
  assert.equal(calcularPromocionDeGrupo(undefined, gente({ adultos: 5 }), PRECIOS).descuento, 0);
  const raro = promo({ promotion_type: 'promocion_que_no_existe' });
  assert.equal(calcularPromocionDeGrupo(raro, gente({ adultos: 9 }), PRECIOS).descuento, 0);
  // Sin viajeros tampoco.
  assert.equal(calcularPromocionDeGrupo(promo(), gente(), PRECIOS).descuento, 0);
});

caso('13. pay_count >= group_size no regala a nadie', () => {
  // Dato incoherente: nadie sale gratis. No se inventa un descuento.
  const p = promo({ promotion_type: '3x2', min_travelers: 3, group_size: 3, pay_count: 3 });
  assert.equal(calcularPromocionDeGrupo(p, gente({ adultos: 6 }), PRECIOS).descuento, 0);
});

console.log(`\nPromociones de grupo: ${casos}/13 casos OK`);
if (casos !== 13) { console.error('faltaron casos'); process.exit(1); }
