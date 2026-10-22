// Pruebas de la lógica de la pantalla «Costos de mensajería» (src/lib/costosMensajeria.ts) y de que la pantalla quede
// conectada: ruta, menú y las funciones de la base que usa. Corre con Node 22+ (importa el .ts directamente).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  estadoDeFila,
  etiquetaCanal,
  etiquetaProveedor,
  formatoMxn,
  formatoMxnUnitario,
  mesActualMx,
  mesTerminado,
  periodoDeMes,
  puedeCerrarMes,
  totalesDelResumen,
  unidadDelCanal,
} from '../src/lib/costosMensajeria.ts';

let casos = 0;
const prueba = (nombre, fn) => { fn(); casos++; };

prueba('el mes de hoy se calcula en hora de Ciudad de México, no en UTC', () => {
  // 1-nov 03:00 UTC es todavía 31-oct 21:00 en México (UTC-6): el mes sigue siendo octubre.
  assert.equal(mesActualMx(new Date('2026-11-01T03:00:00Z')), '2026-10');
  assert.equal(mesActualMx(new Date('2026-11-01T06:00:00Z')), '2026-11');
  assert.equal(mesActualMx(new Date('2026-10-22T16:00:00Z')), '2026-10');
});

prueba('periodoDeMes acepta yyyy-mm válido y rechaza lo demás', () => {
  assert.deepEqual(periodoDeMes('2026-10'), { anio: 2026, mes: 10 });
  for (const malo of ['', '2026-13', '2026-00', '2019-12', '2101-01', '26-10', '2026-1', '2026-10-01', 'abc']) {
    assert.equal(periodoDeMes(malo), null, malo);
  }
});

prueba('solo se cierra un mes terminado (igual que exige la base)', () => {
  const hoy = new Date('2026-10-22T16:00:00Z');
  assert.equal(mesTerminado(2026, 9, hoy), true);
  assert.equal(mesTerminado(2025, 12, hoy), true);
  assert.equal(mesTerminado(2026, 10, hoy), false, 'el mes en curso no');
  assert.equal(mesTerminado(2026, 11, hoy), false, 'ni uno futuro');
  // En la noche del 31-oct en México ya es nov en UTC, pero octubre NO terminó todavía.
  assert.equal(mesTerminado(2026, 10, new Date('2026-11-01T03:00:00Z')), false);
  assert.equal(mesTerminado(2026, 10, new Date('2026-11-01T06:00:00Z')), true);
});

const fila = (extra = {}) => ({
  proveedor: 'twilio', canal: 'sms', usados: 1234, incluidos: 1000, excedente: 234,
  costo_unitario_mxn: 0.5, costo_mxn: 117, cerrado: false, gasto_id: null, gasto_estado: null, ...extra,
});

prueba('«Cerrar mes» aparece solo en un mes terminado con algo sin cerrar', () => {
  const hoy = new Date('2026-10-22T16:00:00Z');
  assert.equal(puedeCerrarMes([fila()], 2026, 9, hoy), true);
  assert.equal(puedeCerrarMes([fila({ cerrado: true })], 2026, 9, hoy), false, 'ya cerrado');
  assert.equal(puedeCerrarMes([fila(), fila({ cerrado: true })], 2026, 9, hoy), true, 'queda uno sin cerrar');
  assert.equal(puedeCerrarMes([fila()], 2026, 10, hoy), false, 'mes en curso');
  assert.equal(puedeCerrarMes([], 2026, 9, hoy), false, 'sin filas');
});

prueba('los totales suman usados y costo', () => {
  assert.deepEqual(totalesDelResumen([fila(), fila({ usados: 6, costo_mxn: 0.5 })]), { usados: 1240, costo: 117.5 });
  assert.deepEqual(totalesDelResumen([]), { usados: 0, costo: 0 });
  // La base entrega numeric como texto en algunos casos: se suma como número, no se concatena.
  assert.deepEqual(totalesDelResumen([fila({ usados: '10', costo_mxn: '2.50' })]), { usados: 10, costo: 2.5 });
});

prueba('el estado de la fila dice si es estimado o cerrado y qué pasó con su gasto', () => {
  assert.match(estadoDeFila(fila()), /Estimado/);
  assert.match(estadoDeFila(fila({ cerrado: true, gasto_id: 'g', gasto_estado: 'borrador' })), /borrador/);
  assert.match(estadoDeFila(fila({ cerrado: true, gasto_id: 'g', gasto_estado: 'registrado' })), /registrado/);
  assert.match(estadoDeFila(fila({ cerrado: true, gasto_id: 'g', gasto_estado: 'cancelado' })), /cancelado/);
  assert.match(estadoDeFila(fila({ cerrado: true, gasto_id: null, costo_mxn: 0 })), /sin costo/);
  assert.match(estadoDeFila(fila({ cerrado: true, gasto_id: null, costo_mxn: 50 })), /eliminado/);
});

prueba('etiquetas, unidades y dinero', () => {
  assert.equal(etiquetaProveedor('smtp2go'), 'SMTP2GO');
  assert.equal(etiquetaProveedor('otro'), 'otro');
  assert.equal(etiquetaCanal('whatsapp'), 'WhatsApp');
  assert.equal(unidadDelCanal('sms'), 'segmento');
  assert.equal(unidadDelCanal('email'), 'correo');
  assert.match(formatoMxn(1234.5), /1,234\.50/);
  assert.match(formatoMxnUnitario(0.075), /0\.075/);
  assert.match(formatoMxn(Number.NaN), /0\.00/, 'un valor roto no pinta NaN');
});

const leer = (ruta) => readFileSync(new URL('../' + ruta, import.meta.url), 'utf8');

prueba('la pantalla está conectada: ruta, menú y las funciones de la base que usa', () => {
  assert.match(leer('src/App.tsx'), /path="\/admin\/costos-mensajeria"[\s\S]{0,200}<AdminCostosMensajeria \/>/);
  assert.match(leer('src/components/NavBar.tsx'), /to: '\/admin\/costos-mensajeria'/);
  const pantalla = leer('src/pages/admin/AdminCostosMensajeria.tsx');
  const sql = leer('supabase/migrations/20261022230104_tarifas_y_cierre_de_costos_de_mensajeria.sql');
  for (const rpc of ['get_tarifas_mensajeria', 'guardar_tarifa_mensajeria', 'resumen_costos_mensajeria', 'cerrar_costos_mensajeria']) {
    assert.ok(pantalla.includes(`'${rpc}'`), `la pantalla llama a ${rpc}`);
    assert.match(sql, new RegExp(`FUNCTION public\\.${rpc}\\(`), `la migración define ${rpc}`);
  }
});

prueba('la migración deja el gasto en BORRADOR, en MXN y sin IVA, en la cuenta 607', () => {
  const sql = leer('supabase/migrations/20261022230104_tarifas_y_cierre_de_costos_de_mensajeria.sql');
  const insert = sql.slice(sql.indexOf('INSERT INTO public.gastos_operacion'), sql.indexOf('RETURNING id INTO v_gasto'));
  assert.match(insert, /'607'/);
  assert.match(insert, /'MXN', 1, v_costo, 0, v_costo, v_costo/, 'MXN, tipo de cambio 1, subtotal = costo, IVA 0');
  assert.match(insert, /'borrador'/);
  assert.ok(!/'registrado'/.test(insert), 'el cierre nunca registra por su cuenta');
  assert.match(sql, /IF make_date\(p_anio, p_mes, 1\) >= date_trunc\('month'/, 'solo meses terminados');
  assert.match(sql, /CONSTRAINT cierres_mensajeria_unico UNIQUE \(anio, mes, proveedor, canal\)/, 'cerrar dos veces no duplica');
});

console.log(`OK: ${casos} casos de la pantalla de costos de mensajería.`);
