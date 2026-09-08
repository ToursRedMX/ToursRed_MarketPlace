#!/usr/bin/env node
/**
 * Guardia de origen — M-5 de la auditoria de Edge Functions (05-sep-2026).
 *
 * QUE VIGILA
 *
 * Que ninguna Edge Function vuelva a leer `Origin` (o `Referer`) crudo del
 * request. Para eso esta `_shared/cors.ts`.
 *
 * POR QUE
 *
 * El header `Origin` lo pone quien llama, no el navegador de forma confiable
 * para un cliente que no sea navegador: `curl -H "Origin: https://falso.com"`
 * vale lo mismo. Ocho funciones de cobro armaban con el la URL de retorno del
 * pago:
 *
 *     success_url: `${req.headers.get("origin")}/booking-success?...`
 *
 * Resultado: se creaba una sesion de Stripe/PayPal/Conekta cuya pantalla de
 * "gracias por tu compra" vivia en el dominio del atacante. El cobro era real
 * y la confirmacion falsa. Redirect abierto dentro del flujo de pago.
 *
 * Los fallbacks a `referer` eran peor todavia: mismo control del atacante, y
 * ademas recortados con `.split("/").slice(0, 3)`, que no valida nada.
 *
 * COMO SE ARREGLA UN HALLAZGO
 *
 *   import { origenParaRedirigir } from "../_shared/cors.ts";
 *   const origin = origenParaRedirigir(req);   // siempre un origen de la lista
 *
 * Y si la URL viene en el cuerpo de la peticion:
 *
 *   import { urlDeRetornoSegura } from "../_shared/cors.ts";
 *   success_url: urlDeRetornoSegura(success_url) ?? `${origenParaRedirigir(req)}/...`
 *
 * ESCAPE
 *
 * Si de verdad hace falta el valor crudo (por ejemplo para registrarlo en un
 * log de auditoria), se marca la linea con el comentario `origen-crudo-ok` y
 * esta guardia la deja pasar. Es explicito a proposito: obliga a que alguien
 * lo escriba y a que se vea en el diff.
 *
 * Nace en 0 hallazgos, medido el 08-sep-2026 sobre las 171 funciones, asi que
 * bloquea de verdad — no es un contador como el de F-1.
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const RAIZ = "supabase/functions";
const PERMISO = "origen-crudo-ok";

// `req.headers.get("origin")` con comillas simples, dobles o backtick.
const PATRON = /headers\s*\.\s*get\s*\(\s*(['"`])(origin|referer)\1\s*\)/i;

function archivosTs(dir) {
  const salida = [];
  for (const entrada of readdirSync(dir)) {
    const ruta = join(dir, entrada);
    if (statSync(ruta).isDirectory()) salida.push(...archivosTs(ruta));
    else if (ruta.endsWith(".ts")) salida.push(ruta);
  }
  return salida;
}

const hallazgos = [];
let revisados = 0;

for (const ruta of archivosTs(RAIZ)) {
  // El propio helper es el unico sitio donde leerlo es correcto.
  if (ruta.endsWith("_shared/cors.ts")) continue;
  revisados++;
  const lineas = readFileSync(ruta, "utf8").split("\n");
  lineas.forEach((linea, i) => {
    if (!PATRON.test(linea)) return;
    if (linea.includes(PERMISO)) return;
    hallazgos.push({ ruta, linea: i + 1, texto: linea.trim() });
  });
}

console.log(`Guardia de origen: ${revisados} archivos revisados en ${RAIZ}/`);

if (hallazgos.length === 0) {
  console.log("Sin hallazgos: nadie lee Origin/Referer crudo.");
  process.exit(0);
}

console.error(`\n${hallazgos.length} lectura(s) cruda(s) de Origin/Referer:\n`);
for (const h of hallazgos) {
  console.error(`  ${h.ruta}:${h.linea}`);
  console.error(`    ${h.texto}\n`);
}
console.error("Usa origenParaRedirigir(req) de ../_shared/cors.ts.");
console.error(`Si el valor crudo es intencional, marca la linea con "${PERMISO}".`);
process.exit(1);
