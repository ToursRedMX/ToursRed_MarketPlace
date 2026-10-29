// Contratos de los tres arreglos de seguridad del pre-UAT (29-oct-2026, casos SEG-08, SEG-02 y SEG-11 de la matriz UAT).
//   1. hold_seats: la ULTIMA definicion exige sesion, acota los minutos, guarda a nombre de auth.uid() y no es ejecutable por anon.
//   2. TRUNCATE: existe la migracion que se lo quita a anon y authenticated, tambien en los permisos por defecto, y ninguna
//      migracion POSTERIOR se lo vuelve a conceder.
//   3. netlify.toml: las cabeceras de seguridad estan, y la CSP va en Report-Only (una CSP estricta sin observar puede romper el pago).
// Lo que NO prueba: que la base ya tenga aplicadas las migraciones. Eso se mide contra la base despues de aplicarlas.
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';

const leer = (ruta) => readFileSync(new URL('../' + ruta, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const sinComentarios = (t) => t.split('\n').filter((l) => !l.trim().startsWith('--')).join('\n');
const migraciones = readdirSync(new URL('../supabase/migrations/', import.meta.url)).filter((f) => f.endsWith('.sql')).sort();

let casos = 0;
const prueba = (nombre, fn) => { try { fn(); casos++; } catch (e) { console.error(`FALLA: ${nombre}`); throw e; } };

// ── 1. hold_seats ──────────────────────────────────────────────────────────
const definiciones = migraciones.filter((f) => /CREATE OR REPLACE FUNCTION public\.hold_seats\(/i.test(leer('supabase/migrations/' + f)));
const ultimaHold = definiciones.at(-1);
const hold = sinComentarios(leer('supabase/migrations/' + ultimaHold));

prueba('la ultima definicion de hold_seats es la que exige sesion', () => {
  assert.equal(ultimaHold, '20261029054500_hold_seats_exige_sesion_y_acota_minutos.sql', `la ultima definicion es ${ultimaHold}`);
});
prueba('hold_seats rechaza a anon con 42501 y deja pasar la llamada sin claims', () => {
  assert.match(hold, /v_uid uuid := auth\.uid\(\);/);
  assert.match(hold, /IF v_uid IS NULL AND COALESCE\(auth\.role\(\), 'service_role'\) <> 'service_role' THEN\s+RAISE EXCEPTION 'Acceso no autorizado' USING ERRCODE = '42501';/);
});
prueba('los minutos del apartado se acotan a 1..15 y ya no se usa el valor crudo', () => {
  assert.match(hold, /LEAST\(GREATEST\(COALESCE\(p_hold_minutes, 10\), 1\), 15\)/);
  assert.doesNotMatch(hold, /now\(\) \+ \(p_hold_minutes \|\|/, 'el vencimiento no puede usar p_hold_minutes sin acotar');
});
prueba('los dos INSERT guardan el apartado a nombre de auth.uid()', () => {
  const inserts = hold.match(/INSERT INTO seat_holds[\s\S]*?;/g) || [];
  assert.equal(inserts.length, 2, 'hold_seats inserta en dos lugares (asientos y capacidad generica)');
  for (const i of inserts) assert.match(i, /COALESCE\(v_uid, p_user_id\)/, 'el apartado no puede quedar a nombre de un p_user_id ajeno');
});
prueba('EXECUTE: fuera PUBLIC y anon, dentro authenticated y service_role, y la migracion lo verifica', () => {
  const firma = 'public\\.hold_seats\\(uuid, uuid, text, integer\\[\\], integer, uuid, integer\\)';
  assert.match(hold, new RegExp(`REVOKE EXECUTE ON FUNCTION ${firma} FROM PUBLIC, anon;`));
  assert.match(hold, new RegExp(`GRANT EXECUTE ON FUNCTION ${firma} TO authenticated, service_role;`));
  assert.match(hold, /has_function_privilege\('anon'/);
});
prueba('ninguna migracion posterior le vuelve a dar EXECUTE a anon o PUBLIC', () => {
  const idx = migraciones.indexOf(ultimaHold);
  for (const f of migraciones.slice(idx + 1)) {
    const t = sinComentarios(leer('supabase/migrations/' + f));
    assert.doesNotMatch(t, /GRANT EXECUTE ON FUNCTION public\.hold_seats[\s\S]*?TO[^;]*\b(anon|PUBLIC)\b/i, `${f} reabre hold_seats`);
  }
});
prueba('el flujo de reserva sigue siendo el unico que llama a hold_seats y exige sesion', () => {
  const step3 = leer('src/pages/booking-flow/BookingFlowStep3.tsx');
  assert.equal((step3.match(/rpc\('hold_seats'/g) || []).length, 2, 'el flujo llama a hold_seats en dos lugares');
  assert.doesNotMatch(step3, /p_hold_minutes/, 'el front no manda minutos: usa el valor por omision');
  const layout = leer('src/pages/booking-flow/BookingFlowLayout.tsx');
  assert.match(layout, /if \(!user\) \{/, 'el flujo de reserva redirige sin sesion');
});

// ── 2. TRUNCATE ────────────────────────────────────────────────────────────
const NOMBRE_TRUNCATE = '20261029054600_revocar_truncate_de_anon_y_authenticated.sql';
const trunc = sinComentarios(leer('supabase/migrations/' + NOMBRE_TRUNCATE));
prueba('la migracion revoca TRUNCATE en todas las tablas de public y en los permisos por defecto', () => {
  assert.match(trunc, /REVOKE TRUNCATE ON ALL TABLES IN SCHEMA public FROM anon, authenticated;/);
  assert.match(trunc, /ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE TRUNCATE ON TABLES FROM anon, authenticated;/);
});
prueba('la migracion falla si quedo alguna tabla con TRUNCATE y no toca SELECT ni al service_role', () => {
  assert.match(trunc, /has_table_privilege\('anon', c\.oid, 'TRUNCATE'\)/);
  assert.match(trunc, /RAISE EXCEPTION 'Siguen con TRUNCATE/);
  assert.doesNotMatch(trunc, /REVOKE (SELECT|INSERT|UPDATE|DELETE|ALL)/i, 'solo se revoca TRUNCATE: el RLS sigue siendo el control del resto');
  assert.doesNotMatch(trunc, /service_role/i);
});
prueba('ninguna migracion posterior le concede TRUNCATE a anon o authenticated', () => {
  const idx = migraciones.indexOf(NOMBRE_TRUNCATE);
  assert.ok(idx >= 0);
  for (const f of migraciones.slice(idx + 1)) {
    const t = sinComentarios(leer('supabase/migrations/' + f));
    for (const g of t.match(/GRANT[^;]*;/gi) || []) {
      if (/\bTRUNCATE\b/i.test(g) || /\bGRANT\s+ALL\b/i.test(g)) {
        assert.ok(!/\b(anon|authenticated)\b/i.test(g), `${f}: ${g.slice(0, 90)} reabre TRUNCATE`);
      }
    }
  }
});

// ── 3. Cabeceras de netlify.toml ───────────────────────────────────────────
const toml = leer('netlify.toml');
const bloque = (toml.match(/\[\[headers\]\][\s\S]*?(?=\n\[\[|\n\[(?!headers)|$)/) || [''])[0];
prueba('netlify.toml define las cuatro cabeceras de seguridad para todas las rutas', () => {
  assert.match(bloque, /for = "\/\*"/);
  assert.match(bloque, /X-Content-Type-Options = "nosniff"/);
  assert.match(bloque, /X-Frame-Options = "SAMEORIGIN"/);
  assert.match(bloque, /Referrer-Policy = "strict-origin-when-cross-origin"/);
  assert.match(bloque, /Permissions-Policy = "geolocation=\(\), payment=\(\)"/);
  // Ni camera ni microphone, con ningun valor: la barra de Netlify de los previews los sondea y el smoke tumba el PR (#484, probado con
  // () y con (self)).
  assert.doesNotMatch(bloque, /Permissions-Policy = "[^"]*\b(camera|microphone)\b/, 'camera/microphone en la Permissions-Policy tumban el smoke de los previews');
});
prueba('la CSP va en Report-Only y deja pasar lo que el sitio carga hoy', () => {
  assert.match(bloque, /Content-Security-Policy-Report-Only = "/);
  assert.doesNotMatch(bloque, /(^|\n)\s*Content-Security-Policy = /, 'una CSP que bloquea sin haber observado puede romper pagos y login');
  const csp = bloque.match(/Content-Security-Policy-Report-Only = "([^"]+)"/)[1];
  for (const host of ['challenges.cloudflare.com', 'www.googletagmanager.com', 'sdk.mercadopago.com', 'fonts.googleapis.com', 'fonts.gstatic.com', 'huzsedewwzjywcpbkjkm.supabase.co']) {
    assert.ok(csp.includes(host), `la CSP no contempla ${host}`);
  }
  assert.match(csp, /object-src 'none'/);
  // Observado en el preview del PR #484: el sitio crea workers desde blob: y, sin worker-src, caen en script-src.
  assert.match(csp, /worker-src 'self' blob:/);
});
prueba('el sitio no usa geolocalizacion (si algun dia la usa, la Permissions-Policy la bloquearia)', () => {
  const fuentes = [];
  const recorre = (dir) => {
    for (const e of readdirSync(new URL('../' + dir, import.meta.url), { withFileTypes: true })) {
      const ruta = `${dir}/${e.name}`;
      if (e.isDirectory()) recorre(ruta);
      else if (/\.(tsx?|jsx?)$/.test(e.name)) fuentes.push(ruta);
    }
  };
  recorre('src');
  const usan = fuentes.filter((f) => /navigator\.geolocation/.test(leer(f)));
  assert.deepEqual(usan, [], `estos archivos usan geolocalizacion: ${usan.join(', ')}`);
});

console.log(`OK: ${casos} comprobaciones de los arreglos de seguridad del pre-UAT.`);
