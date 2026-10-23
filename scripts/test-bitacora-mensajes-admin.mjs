// Pruebas de la lógica de la pantalla «Bitácora de mensajes» (src/lib/bitacoraMensajes.ts), de que quede conectada
// (ruta, menú, funciones de la base) y de los CONTRATOS DE SEGURIDAD de lo que guarda: el código de un OTP nunca se
// guarda y solo un administrador con permiso de configuración puede leer. Corre con Node 22+ (importa el .ts directamente).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  contarFiltrosActivos,
  costoEstimadoTexto,
  costoRealTexto,
  estadoDeMensaje,
  etiquetaCategoria,
  etiquetaEvento,
  FILTROS_VACIOS,
  finDelDiaMx,
  inicioDelDiaMx,
  nombreDelDestinatario,
  parametrosDelListado,
  TAMANO_PAGINA,
  textoCorto,
  totalesDelResumen,
} from '../src/lib/bitacoraMensajes.ts';

let casos = 0;
const prueba = (nombre, fn) => { fn(); casos++; };
const leer = (ruta) => readFileSync(new URL('../' + ruta, import.meta.url), 'utf8');

prueba('el estado: leído solo es azul y distinto de entregado; aceptado y enviado NO son entregado', () => {
  assert.deepEqual(estadoDeMensaje('leido'), { clave: 'leido', texto: 'Leído', tono: 'azul' });
  assert.equal(estadoDeMensaje('entregado').tono, 'verde');
  assert.equal(estadoDeMensaje('fallido').tono, 'rojo');
  assert.equal(estadoDeMensaje('resultado_desconocido').tono, 'amarillo');
  for (const s of ['aceptado', 'enviado', 'procesando', 'simulado']) assert.equal(estadoDeMensaje(s).tono, 'gris', s);
  assert.notEqual(estadoDeMensaje('enviado').texto, estadoDeMensaje('entregado').texto);
  assert.equal(estadoDeMensaje('algo_nuevo').texto, 'algo_nuevo', 'un estado desconocido se muestra tal cual');
});

prueba('los días se interpretan en hora de Ciudad de México (UTC-6), no en la del navegador', () => {
  assert.equal(inicioDelDiaMx('2026-10-01'), '2026-10-01T06:00:00.000Z');
  assert.equal(finDelDiaMx('2026-10-01'), '2026-10-02T05:59:59.999Z');
});

prueba('los parámetros del listado: lo vacío viaja como null y la página se vuelve desplazamiento', () => {
  assert.deepEqual(parametrosDelListado(FILTROS_VACIOS, 0), {
    p_desde: null, p_hasta: null, p_canal: null, p_proveedor: null, p_estado: null, p_categoria: null, p_busqueda: null,
    p_limite: TAMANO_PAGINA, p_desplazamiento: 0,
  });
  const p = parametrosDelListado(
    { desde: '2026-10-01', hasta: '2026-10-31', canal: 'whatsapp', proveedor: 'twilio', estado: 'leido', categoria: 'otp', busqueda: '  5512  ' }, 2);
  assert.equal(p.p_desde, '2026-10-01T06:00:00.000Z');
  assert.equal(p.p_hasta, '2026-11-01T05:59:59.999Z');
  assert.equal(p.p_canal, 'whatsapp');
  assert.equal(p.p_busqueda, '5512', 'la búsqueda se recorta');
  assert.equal(p.p_desplazamiento, 2 * TAMANO_PAGINA);
  assert.equal(parametrosDelListado(FILTROS_VACIOS, -3).p_desplazamiento, 0, 'nunca un desplazamiento negativo');
});

prueba('contar filtros activos', () => {
  assert.equal(contarFiltrosActivos(FILTROS_VACIOS), 0);
  assert.equal(contarFiltrosActivos({ ...FILTROS_VACIOS, busqueda: '   ' }), 0, 'solo espacios no cuenta');
  assert.equal(contarFiltrosActivos({ ...FILTROS_VACIOS, canal: 'sms', estado: 'fallido', busqueda: 'x' }), 3);
});

prueba('las tarjetas: entregados incluye a los leídos; sin confirmar son los que esperan entrega', () => {
  const filas = [
    { canal: 'sms', proveedor: 'twilio', estado: 'entregado', total: 10, segmentos: 10 },
    { canal: 'whatsapp', proveedor: 'twilio', estado: 'leido', total: 3, segmentos: 3 },
    { canal: 'sms', proveedor: 'twilio', estado: 'fallido', total: 2, segmentos: 2 },
    { canal: 'sms', proveedor: 'labsmobile', estado: 'enviado', total: 4, segmentos: 4 },
    { canal: 'sms', proveedor: 'twilio', estado: 'aceptado', total: 1, segmentos: 1 },
    { canal: 'sms', proveedor: 'twilio', estado: 'resultado_desconocido', total: 1, segmentos: 1 },
  ];
  assert.deepEqual(totalesDelResumen(filas), { enviados: 21, entregados: 13, leidos: 3, fallidos: 2, sinConfirmar: 6 });
  assert.deepEqual(totalesDelResumen([]), { enviados: 0, entregados: 0, leidos: 0, fallidos: 0, sinConfirmar: 0 });
  assert.equal(totalesDelResumen([{ canal: 'sms', proveedor: 'twilio', estado: 'entregado', total: '7', segmentos: 7 }]).entregados, 7, 'numeric como texto');
});

prueba('texto, destinatario y costos', () => {
  assert.match(textoCorto(null), /No guardado/);
  assert.equal(textoCorto('Hola', 70), 'Hola');
  assert.equal(textoCorto('x'.repeat(100), 10), 'x'.repeat(10) + '…');
  assert.equal(nombreDelDestinatario({ usuario_nombre: ' Ana Pérez ', usuario_email: 'a@b.com' }), 'Ana Pérez');
  assert.equal(nombreDelDestinatario({ usuario_nombre: '', usuario_email: 'a@b.com' }), 'a@b.com');
  assert.equal(nombreDelDestinatario({ usuario_nombre: null, usuario_email: null }), 'Sin usuario asociado');
  assert.equal(costoRealTexto({ costo_real: null, moneda_costo: null }), '—');
  assert.equal(costoRealTexto({ costo_real: 0.0075, moneda_costo: 'USD' }), '0.0075 USD');
  assert.equal(costoEstimadoTexto({ costo_estimado_mxn: null }), '—');
  assert.match(costoEstimadoTexto({ costo_estimado_mxn: 0 }), /0\.00/, 'dentro de lo incluido: $0.00, no vacío');
  assert.match(costoEstimadoTexto({ costo_estimado_mxn: 2.5 }), /2\.50/);
  assert.equal(etiquetaCategoria('otp'), 'Código de verificación');
  assert.equal(etiquetaCategoria('agencia_mensaje'), 'Mensaje nuevo (agencia)');
  assert.equal(etiquetaEvento('leido'), 'Leído por el destinatario');
});

prueba('la pantalla está conectada: ruta, menú y las funciones de la base que usa', () => {
  assert.match(leer('src/App.tsx'), /path="\/admin\/bitacora-mensajes"[\s\S]{0,200}<AdminBitacoraMensajes \/>/);
  assert.match(leer('src/components/NavBar.tsx'), /to: '\/admin\/bitacora-mensajes'/);
  const pantalla = leer('src/pages/admin/AdminBitacoraMensajes.tsx');
  const sql = leer('supabase/migrations/20261022235901_bitacora_de_mensajes_salientes.sql');
  for (const rpc of ['listar_mensajes_salientes', 'resumen_mensajes_salientes']) {
    assert.ok(pantalla.includes(`'${rpc}'`), `la pantalla llama a ${rpc}`);
    assert.match(sql, new RegExp(`FUNCTION public\\.${rpc}\\(`), `la migración define ${rpc}`);
  }
});

prueba('SEGURIDAD: el código de un OTP nunca se guarda, ni en el envío ni en la base', () => {
  const sql = leer('supabase/migrations/20261022235901_bitacora_de_mensajes_salientes.sql');
  // En la base: si la categoría es otp, toda racha de 4 o más dígitos se tacha antes de guardar.
  assert.match(sql, /IF a\.category = 'otp' THEN[\s\S]{0,400}regexp_replace\(v_text, '\[0-9\]\{4,\}'/);
  // En el envío: el texto de un OTP pasa por ocultarCodigoOtp ANTES de la llamada a record_sms_text y antes de hablar con el proveedor.
  const servicio = leer('supabase/functions/_shared/mensajeria/servicio.ts');
  assert.match(servicio, /p_text: category === 'otp' \? ocultarCodigoOtp\(text, otpCode\) : text/);
  assert.ok(servicio.indexOf("'record_sms_text'") > -1 && servicio.indexOf("'record_sms_text'") < servicio.indexOf('adapter.enviar'),
    'el texto se guarda antes de enviar');
  assert.ok(!/p_text:\s*text\s*[,}]/.test(servicio), 'ninguna llamada manda el texto sin pasar por el filtro del OTP');
});

prueba('SEGURIDAD: solo un administrador con permiso de configuración lee; escribir el texto es solo del servicio', () => {
  const sql = leer('supabase/migrations/20261022235901_bitacora_de_mensajes_salientes.sql');
  for (const fn of ['listar_mensajes_salientes', 'resumen_mensajes_salientes']) {
    const cuerpo = sql.slice(sql.indexOf(`FUNCTION public.${fn}(`)).split('$function$;')[0];
    assert.match(cuerpo, /PERFORM messaging_private\.require_settings_admin\(\)/, `${fn} exige permiso de configuración`);
    assert.match(sql, new RegExp(`REVOKE ALL ON FUNCTION public\\.${fn}\\([^)]*\\) FROM PUBLIC, anon, authenticated`), `${fn}: sin acceso por defecto`);
  }
  // El ÚNICO GRANT sobre record_sms_text es a service_role, exactamente: ni a authenticated, ni a anon, ni en una lista con otros.
  const grants = sql.match(/GRANT EXECUTE ON FUNCTION public\.record_sms_text\([^;]*;/g) ?? [];
  assert.deepEqual(grants, ['GRANT EXECUTE ON FUNCTION public.record_sms_text(uuid, text) TO service_role;']);
  assert.match(sql, /REVOKE ALL ON FUNCTION public\.record_sms_text\(uuid, text\) FROM PUBLIC, anon, authenticated/);
});

console.log(`OK: ${casos} casos de la pantalla de bitácora de mensajes.`);
