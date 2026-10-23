// Contratos de la FASE 2 del cobro de notificaciones (migracion 20261023011842 + Edge Functions + pantallas): Stripe.
// Lo que se afirma aqui es lo que NO puede romperse sin que alguien pague de mas, no pague o se lleve una membresia Plus:
//   1. la suscripcion de notificaciones NUNCA usa la llave `user_id` del metadata (es la de Plus: la convertiria en membresia);
//   2. stripe-webhook le pregunta a este modulo ANTES del switch que atiende membresias, reservas y pagos;
//   3. se captura el Price (price_...), no el Product, y solo el dueno de una agencia contrata;
//   4. con el cobro apagado las pantallas no pintan nada y los textos de "gratis" siguen;
//   5. el OTP no se menciona en codigo: nunca entra al cobro.
// Lee los fuentes como texto (patron del repo: los contratos de CI viven en scripts/test-*.mjs).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const leer = (ruta) => readFileSync(new URL('../' + ruta, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const sinComentarios = (t) => t.split('\n').filter((l) => !l.trim().startsWith('//') && !l.trim().startsWith('--') && !l.trim().startsWith('*')).join('\n');

const MIG = 'supabase/migrations/20261023011842_cobro_notificaciones_fase2_precios_y_cobertura.sql';
const sql = leer(MIG);
const compartido = leer('supabase/functions/_shared/suscripcionNotificaciones.ts');
const crear = leer('supabase/functions/create-notification-subscription/index.ts');
const administrar = leer('supabase/functions/manage-notification-subscription/index.ts');
const webhook = leer('supabase/functions/stripe-webhook/index.ts');
const tarjeta = leer('src/components/SuscripcionNotificaciones.tsx');

let casos = 0;
const prueba = (nombre, fn) => { fn(); casos++; };

prueba('se capturan Price IDs (price_...), nunca un Product, y el CHECK lo impide', () => {
  assert.match(sql, /stripe_price_notificaciones_viajero\s+text/);
  assert.match(sql, /stripe_price_notificaciones_agencia\s+text/);
  assert.equal((sql.match(/~ '\^price_\[A-Za-z0-9\]\+\$'/g) ?? []).length, 2, 'un CHECK por columna');
  assert.match(tarjeta + leer('src/components/CobroNotificacionesSection.tsx'), /\^price_\[A-Za-z0-9\]\+\$/, 'el admin valida igual antes de guardar');
});

prueba('la marca de notificaciones jamas usa la llave user_id de Plus', () => {
  // La fila de la tabla SI tiene columna user_id; lo que no debe existir es esa llave en el METADATA de Stripe.
  const bloque = crear.slice(crear.indexOf('const metadata: Record<string, string> = {'), crear.indexOf('const origen'));
  assert.ok(bloque.length > 50, 'se encontro el bloque de metadata');
  assert.ok(!/(^|[^_])user_id\s*:/.test(bloque), 'el metadata de crear no lleva user_id');
  assert.ok(!/metadata\??\.user_id/.test(sinComentarios(compartido)), 'el modulo nunca lee metadata.user_id (la llave de Plus)');
  assert.match(crear, /tipo_suscripcion: MARCA_SUSCRIPCION/);
  assert.match(crear, /notif_user_id: userId/);
  assert.match(crear, /notif_agency_id: agencyId/);
  // La marca viaja en la sesion Y en la suscripcion (los eventos de suscripcion no traen el metadata de la sesion).
  assert.match(crear, /\n\s+metadata,\n\s+subscription_data: \{ metadata \}/);
});

prueba('stripe-webhook atiende las suscripciones de notificaciones ANTES del switch de membresias y pagos', () => {
  const importa = webhook.indexOf('procesarEventoNotificaciones } from "../_shared/suscripcionNotificaciones.ts"');
  const llama = webhook.indexOf('if (await procesarEventoNotificaciones(supabase, stripe, event, {');
  const cambio = webhook.indexOf('switch (event.type) {');
  const bitacora = webhook.indexOf("from('webhook_logs').insert");
  assert.ok(importa > -1 && llama > -1 && cambio > -1 && bitacora > -1);
  assert.ok(bitacora < llama && llama < cambio, 'queda registrado el evento, luego se atiende, luego el switch');
  // Y solo hay UN switch de eventos: no se atiende dos veces.
  assert.equal((webhook.match(/switch \(event\.type\) \{/g) ?? []).length, 1);
});

prueba('solo el dueno contrata; el service role no paga; el cobro debe estar activo; Plus no paga aparte', () => {
  for (const [nombre, f] of [['crear', crear], ['administrar', administrar]]) {
    assert.match(f, /requireUser\(req/, `${nombre}: exige una persona autenticada`);
    assert.match(f, /if \(!userId\) return responder\(\{ error: "No autorizado" \}, 401\)/, `${nombre}: el service role no paga por nadie`);
    assert.match(f, /rpc\("mi_cobertura_notificaciones"/, `${nombre}: la autorizacion viene del servidor, no del cuerpo`);
    assert.match(f, /if \(!estado\.es_dueno\) throw/, `${nombre}: solo el dueno`);
  }
  assert.match(crear, /if \(!estado\.activo\) throw/);
  assert.match(crear, /estado\.cobertura === "plus"/);
  assert.match(crear, /\["active", "trialing", "past_due"\]\.includes\(sub\.status\)/, 'no se duplica una suscripcion viva');
  assert.match(crear, /clienteStripeVigente\(stripe, customerId\)/, 'un cliente de otra cuenta de Stripe no tumba el checkout');
});

prueba('la gracia no se concede en el primer cobro ni se estira con reintentos', () => {
  assert.match(compartido, /billing_reason === "subscription_create"\) return true;/);
  assert.match(compartido, /\.is\("en_gracia_hasta", null\)/);
});

prueba('mi_cobertura_notificaciones: definer con search_path fijo, sin acceso anonimo, valida la agencia', () => {
  const f = sql.slice(sql.indexOf('CREATE OR REPLACE FUNCTION public.mi_cobertura_notificaciones'), sql.indexOf('$function$;', sql.indexOf('AS $function$')));
  assert.match(f, /SECURITY DEFINER SET search_path TO ''/);
  assert.match(f, /IF v_uid IS NULL THEN RAISE EXCEPTION 'No autenticado'/);
  assert.match(f, /RAISE EXCEPTION 'Sin acceso a la agencia'/);
  assert.match(sql, /REVOKE ALL ON FUNCTION public\.mi_cobertura_notificaciones\(uuid\) FROM PUBLIC, anon;/);
  assert.match(sql, /GRANT EXECUTE ON FUNCTION public\.mi_cobertura_notificaciones\(uuid\) TO authenticated, service_role;/);
});

prueba('el margen de un dia se aplica a las dos ramas (viajero y agencia) y falla si el fragmento cambia', () => {
  assert.match(sql, /viejo text := 'x\.current_period_end > now\(\)'/);
  assert.match(sql, /nuevo text := 'x\.current_period_end \+ interval ''1 day'' > now\(\)'/);
  assert.match(sql, /IF veces <> 2 THEN/);
});

prueba('con el cobro apagado las pantallas no pintan nada y no se cobra', () => {
  assert.match(tarjeta, /if \(cobro\.isPending \|\| cobro\.isError \|\| !estado \|\| !estado\.activo\) return null;/);
  assert.match(sql, /No cambia lo que hoy sale|sigue gobernado por/i, 'la migracion lo declara');
});

prueba('el OTP no aparece en el codigo de la suscripcion: nunca entra al cobro', () => {
  for (const f of [sql, compartido, crear, administrar]) {
    assert.ok(!/\botp\b/i.test(sinComentarios(f)), 'sin OTP en codigo');
  }
});

prueba('APAGAR el cobro desde el admin es inmediato; ENCENDER sigue exigiendo su boton y su confirmacion; y se avisa de lo que no esta guardado', () => {
  // 23-oct-2026: Axel apago el interruptor, pulso el «Guardar» de la PAGINA (que no guarda esta seccion) y el cobro siguio encendido:
  // la tarjeta de suscripcion siguio saliendo a los usuarios. Apagar es la accion segura y no puede depender de un segundo boton.
  const seccion = sinComentarios(leer('src/components/CobroNotificacionesSection.tsx'));
  assert.match(seccion, /const apagar = useMutation\(/);
  assert.match(seccion, /\.update\(\{ cobro_notificaciones_activo: false \}\)/, 'apagar toca SOLO el interruptor, no el resto del formulario');
  assert.match(seccion, /if \(!e\.target\.checked && ajustes\.data\?\.cobro_notificaciones_activo\) apagar\.mutate\(\);/);
  assert.match(seccion, /onError: \(\) => setActivo\(true\)/, 'si no se pudo apagar, el interruptor no miente');
  // Encender NO es inmediato: sigue por el boton de guardar, con su confirmacion.
  const alCambiar = seccion.slice(seccion.indexOf('onChange={(e) => {'), seccion.indexOf('className="h-5 w-5"'));
  assert.ok(alCambiar.includes('setActivo(e.target.checked)') && alCambiar.length < 400, 'se encontro el manejador del interruptor');
  assert.ok(!/guardar\.mutate/.test(alCambiar), 'el interruptor jamas guarda ni enciende por si solo');
  assert.equal((alCambiar.match(/\.mutate\(/g) ?? []).length, 1, 'lo unico que dispara es apagar');
  assert.match(seccion, /const cambiaAEncendido = activo && !ajustes\.data\?\.cobro_notificaciones_activo;/);
  assert.match(seccion, /Vas a encender el cobro de notificaciones/);
  // Aviso de cambios sin guardar.
  assert.match(seccion, /const hayCambios = Boolean\(ajustes\.data\) && \(/);
  assert.match(seccion, /activo !== ajustes\.data!\.cobro_notificaciones_activo/);
  assert.match(seccion, /el botón de guardar de la página NO los guarda/);
});

console.log(`OK: ${casos} casos del cobro de notificaciones, fase 2.`);
