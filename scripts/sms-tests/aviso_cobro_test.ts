import assert from 'node:assert/strict';
import { construirAviso, fechaLarga, pesos, REMITENTE_AVISO } from '../../supabase/functions/_shared/avisoCobroNotificaciones.ts';

// El correo que avisa, antes de que empiece el cobro, que los SMS pasan a ser una suscripcion.
const DESDE = new Date('2026-11-16T06:00:00Z'); // medianoche del 16-nov en Mexico
const base = { desde: DESDE, montoMxn: 29, urlBase: 'https://toursred.com' };

Deno.test('la fecha es la de MEXICO, no la de UTC: a las 21:00 del 15 en Mexico ya es 16 en UTC y el correo dice 15', () => {
  assert.equal(fechaLarga(new Date('2026-11-16T06:00:00Z')), '16 de noviembre de 2026');
  assert.equal(fechaLarga(new Date('2026-11-16T03:00:00Z')), '15 de noviembre de 2026');
});

Deno.test('viajero: dice la fecha, el precio, que Plus lo incluye, que se apagan y como volver, y que los codigos de verificacion siguen gratis', () => {
  const a = construirAviso({ tipo: 'viajero', nombre: 'Axel', ...base });
  assert.match(a.asunto, /16 de noviembre de 2026/);
  for (const t of [a.html, a.texto]) {
    assert.match(t, /Hola Axel/);
    assert.match(t, /confirmación, cancelación y recordatorio/);
    assert.match(t, /\$29\.00 MXN al mes/);
    assert.match(t, /Con ToursRed Plus siguen incluidos/);
    assert.match(t, /se apagan los avisos por SMS que tienes activos/);
    assert.match(t, /códigos para verificar tu teléfono, que siguen siendo gratis/);
    assert.match(t, /https:\/\/toursred\.com\/traveler\/profile/);
  }
});

Deno.test('agencia: una sola suscripcion cubre al dueno y al personal, y el enlace lleva al perfil de la agencia', () => {
  const a = construirAviso({ tipo: 'agencia', nombre: 'Laura', agencia: 'Aventuras MX', ...base, montoMxn: 149 });
  for (const t of [a.html, a.texto]) {
    assert.match(t, /Aventuras MX/);
    assert.match(t, /\$149\.00 MXN al mes/);
    assert.match(t, /cubre al dueño y a todo el personal/);
    assert.match(t, /https:\/\/toursred\.com\/agency\/profile/);
    assert.ok(!/Con ToursRed Plus/.test(t), 'a la agencia no le aplica Plus');
  }
});

Deno.test('SIEMPRE lleva version en texto plano (un correo solo-HTML sube el puntaje de spam) y un remitente con nombre visible', () => {
  const a = construirAviso({ tipo: 'viajero', nombre: 'Axel', ...base });
  assert.ok(a.texto.length > 200 && !/<[a-z]/i.test(a.texto), 'texto plano de verdad, sin etiquetas');
  assert.match(REMITENTE_AVISO, /^ToursRed <contacto@toursred\.com>$/);
});

Deno.test('sin vocabulario que dispare filtros: nada de signos de exclamacion, mayusculas gritadas ni dinero devuelto', () => {
  const a = construirAviso({ tipo: 'viajero', nombre: 'Axel', ...base });
  for (const t of [a.asunto, a.texto]) {
    assert.ok(!/!/.test(t), 'sin !');
    assert.ok(!/reembols|gratis!|oferta|urgente|ganaste/i.test(t.replace(/siguen siendo gratis/, '')), 'sin vocabulario de promocion o dinero devuelto');
  }
  assert.equal(a.asunto, a.asunto.trim());
  assert.ok(!/[A-ZÁÉÍÓÚ]{6,}/.test(a.asunto));
});

Deno.test('un nombre con HTML no inyecta nada en el correo', () => {
  const a = construirAviso({ tipo: 'viajero', nombre: '<script>alert(1)</script>', ...base });
  assert.ok(!a.html.includes('<script>'));
  assert.match(a.html, /&lt;script&gt;/);
});

Deno.test('si no se pudo leer el precio de Stripe el correo no inventa una cifra: manda al perfil', () => {
  const a = construirAviso({ tipo: 'viajero', nombre: 'Axel', ...base, montoMxn: null });
  assert.match(a.texto, /el monto está en tu perfil/);
  assert.ok(!/\$\d/.test(a.texto));
  assert.equal(pesos(29), '$29.00');
});

Deno.test('el enlace solo puede ser https de la plataforma: una base insegura no produce un correo', () => {
  assert.throws(() => construirAviso({ tipo: 'viajero', ...base, urlBase: 'http://toursred.com' }), /url_plataforma_invalida/);
  assert.throws(() => construirAviso({ tipo: 'viajero', ...base, urlBase: 'https://user:pass@toursred.com' }), /url_plataforma_invalida/);
});
