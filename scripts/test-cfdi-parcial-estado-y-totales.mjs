// Contratos de dos defectos del flujo de cancelacion PARCIAL que salieron de la prueba en vivo del 31-oct-2026 (reserva TRG-JII15E7VX1A):
//
//   A. El CFDI original se quedaba `stamped` en la base aunque el SAT ya lo habia cancelado (solicitud `accepted`, motivo 01, con sustituto).
//      `substitute-cfdi-for-partial-cancellation` le pasaba a `cancel-cfdi` el id de la cancelacion PARCIAL como `cancellation_id`; esa columna
//      es una llave foranea a las cancelaciones TOTALES, el UPDATE fallaba y el error no se revisaba. Resultado: dos CFDI vigentes por la misma
//      venta en los reportes. Aqui se EJECUTA `marcarCfdi` con un cliente falso.
//   B. El sustituto guardaba subtotal/IVA/total sumando el 16% a TODOS los conceptos, exentos incluidos: un tour con 20% exento guardaba 616.00
//      donde el comprobante es de 600.00. Aqui se EJECUTA `totalesDeConceptos`.
//
// Lo que NO prueba: el efecto contra la base ni contra FacturAPI; eso se mide en vivo.
//
//   node --experimental-strip-types --no-warnings scripts/test-cfdi-parcial-estado-y-totales.mjs   (Node 24: sin las banderas)
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const { marcarCfdi } = await import('../supabase/functions/_shared/marcarCfdi.ts');
const { totalesDeConceptos } = await import('../supabase/functions/_shared/taxBreakdown.ts');

const leer = (ruta) => readFileSync(new URL('../' + ruta, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const sinComentarios = (t) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/([^:])\/\/ .*$/gm, '$1');

let casos = 0;
const prueba = async (nombre, fn) => { try { await fn(); casos++; } catch (e) { console.error(`FALLA: ${nombre}`); throw e; } };

// Cliente falso: cada UPDATE consume el siguiente resultado de `respuestas` (null = sin error).
function clienteFalso(respuestas) {
  const llamadas = [];
  return {
    llamadas,
    from(tabla) {
      return {
        update(valores) {
          llamadas.push({ tabla, valores });
          return { eq: async (col, id) => { llamadas[llamadas.length - 1].donde = [col, id]; const e = respuestas.shift() ?? null; return { error: e ? { message: e } : null }; } };
        },
      };
    },
  };
}
const avisos = () => { const l = []; return { l, fn: async (contexto, detalle, datos) => { l.push({ contexto, detalle, datos }); } }; };

// ── A. El estado del CFDI no se pierde por una liga invalida ────────────────
await prueba('con una cancelacion total valida: estado y liga en un solo UPDATE', async () => {
  const c = clienteFalso([null]); const a = avisos();
  const r = await marcarCfdi(c, 'cfdi-1', 'cancelled', 'canc-1', a.fn);
  assert.deepEqual(r, { ok: true, ligada: true });
  assert.equal(c.llamadas.length, 1);
  assert.deepEqual(c.llamadas[0].valores, { status: 'cancelled', cancellation_id: 'canc-1' });
  assert.equal(a.l.length, 0);
});
await prueba('el id de una PARCIAL rompe la llave foranea: se reintenta SOLO con el estado y el original queda cancelado', async () => {
  const c = clienteFalso(['insert or update on table "cfdi_invoices" violates foreign key constraint "cfdi_invoices_cancellation_id_fkey"', null]);
  const a = avisos();
  const r = await marcarCfdi(c, 'cfdi-1', 'cancelled', 'id-de-una-parcial', a.fn);
  assert.deepEqual(r, { ok: true, ligada: false }, 'el estado se guardo aunque no se pudo ligar');
  assert.equal(c.llamadas.length, 2);
  assert.deepEqual(c.llamadas[1].valores, { status: 'cancelled' }, 'el reintento NO lleva la liga que fallo');
  assert.deepEqual(c.llamadas[1].donde, ['id', 'cfdi-1']);
  assert.equal(a.l.length, 0, 'no es un fallo: el estado quedo bien');
});
await prueba('si tambien falla el estado, NO se calla: queda registrado con el CFDI y el estado', async () => {
  const c = clienteFalso(['fk', 'la base no responde']); const a = avisos();
  const r = await marcarCfdi(c, 'cfdi-1', 'cancelled', 'canc-1', a.fn);
  assert.deepEqual(r, { ok: false, ligada: false });
  assert.equal(a.l.length, 1);
  assert.equal(a.l[0].contexto, 'cancel-cfdi/estado');
  assert.equal(a.l[0].detalle, 'la base no responde');
  assert.deepEqual(a.l[0].datos, { cfdi_invoice_id: 'cfdi-1', estado: 'cancelled' });
});
await prueba('sin cancelacion (cancelacion manual desde el panel): un solo UPDATE solo con el estado', async () => {
  const c = clienteFalso([null]); const a = avisos();
  assert.deepEqual(await marcarCfdi(c, 'cfdi-1', 'cancelled', null, a.fn), { ok: true, ligada: false });
  assert.deepEqual(await marcarCfdi(clienteFalso([null]), 'cfdi-1', 'cancelled', undefined, a.fn), { ok: true, ligada: false });
  assert.equal(c.llamadas.length, 1);
  assert.deepEqual(c.llamadas[0].valores, { status: 'cancelled' });
});
await prueba('lo mismo para la cancelacion pendiente de respuesta del SAT', async () => {
  const c = clienteFalso(['fk', null]); const a = avisos();
  const r = await marcarCfdi(c, 'cfdi-1', 'cancellation_pending', 'id-de-una-parcial', a.fn);
  assert.deepEqual(r, { ok: true, ligada: false });
  assert.deepEqual(c.llamadas[1].valores, { status: 'cancellation_pending' });
});

const cancel = sinComentarios(leer('supabase/functions/cancel-cfdi/index.ts'));
await prueba('cancel-cfdi usa marcarCfdi en las dos ramas y ya no hace el UPDATE a ciegas', async () => {
  assert.match(cancel, /import \{ marcarCfdi \} from "\.\.\/_shared\/marcarCfdi\.ts";/);
  assert.match(cancel, /await marcarCfdi\(supabase, cfdi_invoice_id, "cancelled", cancellation_id, registrarFallo\)/);
  assert.match(cancel, /await marcarCfdi\(supabase, cfdi_invoice_id, "cancellation_pending", cancellation_id, registrarFallo\)/);
  assert.doesNotMatch(cancel, /status: "cancelled",\s*\.\.\.\(cancellation_id/);
  assert.doesNotMatch(cancel, /status: "cancellation_pending",\s*\.\.\.\(cancellation_id/);
});
await prueba('el CFDI nuevo de lo retenido solo se pide si el original quedo LIGADO a una cancelacion total', async () => {
  assert.match(cancel, /if \(motivo === "03" && cancellation_id && marca\.ligada && cfdi\.booking_id\) \{/);
});
const sustituto = sinComentarios(leer('supabase/functions/substitute-cfdi-for-partial-cancellation/index.ts'));
await prueba('el sustituto ya NO le pasa a cancel-cfdi el id de la parcial como cancellation_id', async () => {
  const llamada = sustituto.slice(sustituto.indexOf('functions.invoke("cancel-cfdi"'), sustituto.indexOf('functions.invoke("cancel-cfdi"') + 300);
  assert.match(llamada, /motivo: "01"/);
  assert.match(llamada, /uuid_sustitucion: cfdiResult\.uuid_fiscal/);
  assert.doesNotMatch(llamada, /cancellation_id/, 'volvio el id de la parcial en una llave foranea a cancelaciones totales');
});

// ── B. Los totales del sustituto ───────────────────────────────────────────
const concepto = (valor, exento = false) => ({ cantidad: 1, valor_unitario: valor, ...(exento ? { exento: true } : {}) });
await prueba('el caso real (20% exento): 100 exento + 400 gravado + 100 de cargo = 600.00, no 616.00', async () => {
  // Lo que arma el sustituto de TRG-JII15E7VX1A: tour 500 bruto (100 exento + 344.827586 neto gravado) y cargo 86.206897 neto.
  const r = totalesDeConceptos([concepto(344.827586), concepto(100, true), concepto(86.206897)]);
  assert.equal(r.total, 600);
  assert.equal(r.subtotal, 531.03);
  assert.equal(r.iva, 68.97);
  assert.notEqual(r.total, 616, 'es el total que daba sumar el 16% tambien al exento');
});
await prueba('todo gravado: el neto lleva 16% (100 -> 116)', async () => {
  assert.deepEqual(totalesDeConceptos([concepto(100)]), { subtotal: 100, iva: 16, total: 116 });
});
await prueba('todo exento: el total es el importe completo y no hay IVA', async () => {
  assert.deepEqual(totalesDeConceptos([concepto(200, true)]), { subtotal: 200, iva: 0, total: 200 });
});
await prueba('subtotal + IVA siempre dan el total, tambien con montos feos', async () => {
  for (const conceptos of [[concepto(33.333333), concepto(10.1, true)], [concepto(1234.567891), concepto(99.99, true), concepto(0.01)], [concepto(7.07, true)]]) {
    const r = totalesDeConceptos(conceptos);
    assert.equal(Math.round((r.subtotal + r.iva) * 100) / 100, r.total);
  }
});
await prueba('el sustituto usa el helper y no queda la suma del 16% a todos los conceptos', async () => {
  assert.match(sustituto, /const \{ subtotal, iva, total \} = totalesDeConceptos\(conceptos\);/);
  assert.doesNotMatch(sustituto, /valor_unitario \* c\.cantidad \* 1\.16/);
  assert.match(sustituto, /import \{ calculateTaxBreakdown, totalesDeConceptos, type TaxTreatment \} from "\.\.\/_shared\/taxBreakdown\.ts";/);
});

console.log(`OK: ${casos} comprobaciones (estado del CFDI original y totales del sustituto en la cancelacion parcial).`);
