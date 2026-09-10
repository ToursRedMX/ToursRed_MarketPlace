# Inventario de componentes de terceros

**Última medición:** 10 de septiembre de 2026, sobre `main` en `f8b03e3`
**Actualizado:** 10 de septiembre de 2026 — cerrado el hueco de la sección 2
**Requisito que atiende:** PCI DSS v4 **6.3.2** — mantener un inventario de
software a medida y de componentes de terceros, para poder identificar
vulnerabilidades. También sirve de insumo a **6.3.1** (seguimiento de
vulnerabilidades) y **6.3.3** (parcheo).

> El mapeo a requisitos es una **propuesta**. Aquí nadie es QSA.

---

## Resumen: las dos mitades, ya emparejadas

| | Front (navegador) | Edge Functions (Deno) |
|---|---|---|
| ¿Hay archivo que fije versiones? | **Sí** — `package-lock.json` v3 | **Sí** — `scripts/edge-check/deno.lock` |
| Componentes directos | 24 | 6 |
| Árbol completo resuelto | **417 paquetes** | **15 especificadores** |
| ¿Se puede afirmar qué versión corre? | **Sí** | **Sí, para los 6** |
| ¿Lo vigila una guardia de CI? | No — el lockfile basta | **Sí** — `guardia-dependencias` |

El front ya estaba resuelto. **El hueco estaba en las Edge Functions**: 434 de
526 imports remotos flotaban. La sección 2 cuenta cómo se midió y cómo se cerró,
el 10-sep-2026.

---

## 1. Front: dependencias de producción

Las 24 dependencias declaradas usan rangos `^`, **pero eso no es un problema**:
`package-lock.json` (lockfileVersion 3) fija la versión exacta que se instala, y
es lo que el build de Netlify usa. Un rango con lockfile es una práctica normal
y defendible ante un auditor; lo que no lo sería es un rango **sin** lockfile.

| Componente | Rango declarado | Versión resuelta |
|---|---|---|
| `react` | `^19.2.8` | 19.2.8 |
| `react-dom` | `^19.2.8` | 19.2.8 |
| `react-router-dom` | `^7.18.2` | 7.18.2 |
| `@supabase/supabase-js` | `^2.115.0` | 2.115.0 |
| `@sentry/react` | `^10.73.0` | 10.73.0 |
| `@tanstack/react-query` | `^5.102.8` | 5.102.8 |
| `dompurify` | `^3.4.15` | 3.4.15 |
| `mapbox-gl` | `^3.30.0` | 3.30.0 |
| `@mapbox/search-js-react` | `^1.6.0` | 1.6.0 |
| `@tiptap/*` (5 paquetes) | `^3.31.3` | 3.31.3 |
| `jspdf` | `^4.2.1` | 4.2.1 |
| `jspdf-autotable` | `^5.0.8` | 5.0.8 |
| `qrcode` | `^1.5.4` | 1.5.4 |
| `qrcode.react` | `^4.2.0` | 4.2.0 |
| `uqr` | `^0.1.3` | 0.1.3 |
| `date-fns` | `^4.4.0` | 4.4.0 |
| `lucide-react` | `^1.41.0` | 1.41.0 |
| `@icons-pack/react-simple-icons` | `^13.15.1` | 13.15.1 |
| `@types/qrcode` | `^1.5.6` | 1.5.6 |
| **`xlsx`** | **tarball de `cdn.sheetjs.com`** | **0.20.3** |

Más 18 dependencias de desarrollo, que no llegan al navegador.

### `xlsx` merece un párrafo

Es la única dependencia que **no viene del registro de npm**: se resuelve desde
`https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz`.

No es un error —SheetJS distribuye así desde que salió del registro público— pero
tiene consecuencias que conviene tener escritas antes de que las pregunten:

- **Depende de que ese CDN siga en pie.** Si `cdn.sheetjs.com` cae o cambia la
  URL, el build se rompe. Ya pasó en un entorno con proxy restrictivo el
  10-sep-2026: `npm install` no pudo traerlo y `vite build` falló.
- **No aparece en los avisos de seguridad de npm**, así que las herramientas que
  monitorean vulnerabilidades por el registro no lo cubren. Su seguimiento tiene
  que ser manual, contra los avisos del propio SheetJS.

**Acción sugerida:** dejar constancia de quién revisa los avisos de SheetJS y con
qué periodicidad, o considerar alojar el tarball en un artefacto propio para no
depender de un tercero en tiempo de build.

## Scripts de terceros cargados en el navegador

**Uno solo**, en `index.html`:

| Script | Origen | Para qué |
|---|---|---|
| `api.js` de Turnstile | `challenges.cloudflare.com` | protección contra bots en formularios públicos |

Que la superficie sea de **un solo script** es una posición cómoda de defender
para los requisitos de integridad de scripts (**6.4.3** y **11.6.1**). Conviene
notar además que **las páginas de cobro no son nuestras**: la captura de tarjeta
ocurre en el sitio del procesador, así que sobre esas páginas no cargamos ningún
script.

Hasta el 10-sep-2026 había un segundo script: el SDK de OpenPay, que inyectaba la
página `/test-openpay-3ds`. Esa página se eliminó (PR #195) y el script se fue con
ella.

---

## 2. Edge Functions: el hueco, y cómo se cerró

> **Cerrado el 10-sep-2026.** Los 434 imports flotantes se fijaron y entró la
> guardia `check-edge-deps.mjs`. Esta sección se conserva completa a propósito:
> para una auditoría, cómo se detectó y se cerró un hallazgo vale tanto como el
> hecho de que hoy esté cerrado. Lo que sigue describe el estado **antes**, y al
> final está el después.

### El estado antes

**No existía `deno.json`, ni import map, ni `deno.lock`.** Nada fijaba las
versiones. Deno resolvía cada especificador **en el momento del despliegue**.

**Y la primera medición se quedó corta.** Al ir a cerrarlo con la guardia
apareció que los flotantes no eran tres componentes sino **cuatro**, y que los
dos de mayor alcance no estaban en esta tabla. La causa fue el método: el `grep`
original buscaba `from "..."`, y así se pierden los imports por efecto
secundario (`import "..."`) y los dinámicos (`import(...)`). La guardia escanea
las tres formas, y además **quita comentarios antes de buscar** — sin eso,
`_shared/contractDocDefinition.ts` reportaba un `npm:pdfmake@0.2.x` que solo
existe como ejemplo dentro de un bloque de documentación. Ese `0.2.x` de la
tabla original era ese falso positivo: **los tres imports reales de `pdfmake`
siempre estuvieron fijos en 0.2.20.**

| Componente | Especificador | Usos | ¿Fijaba versión? |
|---|---|---|---|
| `@sentry/deno` | `npm:@sentry/deno@9` | **169** | **No** — mayor flotante |
| `@supabase/functions-js` | `jsr:.../edge-runtime.d.ts` | **163** | **No** — *sin ninguna versión* |
| `@supabase/supabase-js` | `npm:...@2` | **89** | **No** — mayor flotante |
| `@supabase/supabase-js` | `npm:...@2.39.6` | 69 | Sí |
| `@supabase/supabase-js` | `jsr:...@2` | 13 | **No**, y **otro registro** |
| `stripe` | `npm:stripe@22.3.0` | 10 | Sí |
| `@supabase/supabase-js` | `npm:...@2.108.2` | 5 | Sí |
| `pdfmake` | `npm:pdfmake@0.2.20` | 3 | Sí |
| `xlsx` | `npm:xlsx@0.18.5` | 2 | Sí |

**434 de 526 imports remotos flotaban.** El caso peor es el segundo renglón:
`@supabase/functions-js` se importaba **sin un solo dígito de versión**, lo que
Deno trata como `@*` — literalmente "la que sea".

### Los tres problemas, en orden de importancia

**1. La misma librería, cuatro formas distintas.** `@supabase/supabase-js` se
importaba con cuatro especificadores diferentes repartidos en las 172 funciones,
desde **dos registros distintos** (npm y jsr) y con **dos versiones fijas
distintas** (2.39.6 y 2.108.2). Entre 2.39.6 y 2.115.0 —la que usa el front— hay
una distancia considerable.

**2. Los mayores flotantes hacían indeterminable lo que corre.** Se resolvían al
desplegar. Dos funciones desplegadas con una semana de diferencia podían estar
corriendo versiones distintas de la misma librería, **y no había forma de
saberlo leyendo el repo**.

Esto choca de frente con 6.3.2: si un aviso de seguridad afecta a
`@supabase/supabase-js` 2.4x pero no a 2.10x, no se podía responder cuáles de
las 172 funciones estaban expuestas sin inspeccionar cada despliegue.

**3. `xlsx` en dos versiones.** El front usa 0.20.3 (del CDN de SheetJS) y las
Edge Functions 0.18.5 (de npm). Dos versiones distintas de la misma librería, de
dos orígenes distintos. **Este sigue abierto** — no es un flotante, son dos
pines legítimos que nadie ha unificado.

### El estado después

Los 434 se fijaron **a la versión a la que ya resolvían ese día**, tomada del
`deno.lock` que generaba CI. Es la decisión de menor riesgo posible: no cambia
el comportamiento respecto a lo que el registro ya venía eligiendo, solo deja de
depender de que lo elija.

| Antes | Ahora | Usos |
|---|---|---|
| `npm:@sentry/deno@9` | `npm:@sentry/deno@9.47.1` | 169 |
| `jsr:@supabase/functions-js/edge-runtime.d.ts` | `jsr:@supabase/functions-js@2.112.4/...` | 163 |
| `npm:@supabase/supabase-js@2` | `npm:@supabase/supabase-js@2.116.0` | 89 |
| `jsr:@supabase/supabase-js@2` | `jsr:@supabase/supabase-js@2.114.0` | 13 |

Y **se commiteó `scripts/edge-check/deno.lock`**, que hasta ahora se generaba y
se tiraba. Importa por una razón que los pines no cubren: fija también las
dependencias **transitivas**. La única que sigue declarada como rango es
`npm:openai@^4.52.5`, que la pide `@supabase/functions-js` en su propio
manifiesto y no se controla desde nuestro código; el lock la clava en 4.104.0.

**Lo que NO se hizo, a propósito:** unificar las cuatro versiones de
`supabase-js` en una sola, ni mover los 13 de `jsr:` a `npm:`. Las dos son
cambios de comportamiento reales —especialmente subir los 69 que están en
2.39.6, de feb-2024— y no deben venir de contrabando dentro de un PR de
endurecimiento. Quedan como decisión aparte.

### La guardia

`scripts/check-edge-deps.mjs`, workflow `edge-deps.yml`, job
`guardia-dependencias`. Rechaza cualquier import remoto sin versión exacta:
rangos (`@2`, `^1.2.3`, `~1.2.3`), comodines (`@*`, `@latest`, `0.2.x`), y la
ausencia total de versión. Los `node:` built-in se permiten, que no tienen
versión que fijar.

**Nace en cero y por eso puede exigirse.** Es el mismo criterio de
`guardia-fiscal` y `check-search-path.mjs`: una guardia que nace con hallazgos
se aprende a ignorar, y esa es la peor forma de perderla.

Además, el inventario que imprime la guardia (`--lista`) se publica en el resumen
de cada ejecución en Actions. O sea que **la evidencia de 6.3.2 se regenera
sola en cada PR** en vez de depender de que alguien acuerde de actualizar esta
tabla a mano.

---

## 3. Servicios de terceros que procesan datos

No son componentes de software, pero un auditor los va a pedir, y para varios de
ellos hará falta un acuerdo escrito (**12.8**).

| Servicio | Para qué | ¿Toca datos de tarjeta? |
|---|---|---|
| Stripe | cobros y suscripciones | **Sí**, en su propia página |
| PayPal | cobros | **Sí**, en su propio sitio |
| Conekta | cobros (incluye OXXO) | **Sí**, en su propio checkout |
| OpenPay | cobros y 3DS | **Sí**, en su propio sitio |
| MercadoPago | cobros | **Sí**, en su propio checkout |
| Supabase | base de datos, auth, Edge Functions, Storage | No |
| Netlify | alojamiento del front | No |
| Backblaze B2 | destino de los respaldos | No |
| Facturapi | timbrado de CFDI | No |
| Cloudflare | Turnstile | No |
| Sentry | monitoreo de errores | No, pero **puede capturar datos personales** |
| Mapbox | mapas y búsqueda de direcciones | No |
| SheetJS | `xlsx` vía su CDN | No |

**Sobre Sentry:** no maneja datos de tarjeta, pero sí recibe trazas de error que
pueden arrastrar datos personales en su contexto. Vale la pena documentar qué se
le envía y qué se le filtra antes de enviarlo.

---

## 4. Cómo regenerar este inventario

```bash
# Front: declarado vs resuelto en el lockfile
node -e "
const lock=require('./package-lock.json'), pkg=require('./package.json');
const res=n=>(lock.packages['node_modules/'+n]||{}).version||'(no resuelto)';
for(const [k,v] of Object.entries(pkg.dependencies||{}))
  console.log(k.padEnd(34), String(v).slice(0,44).padEnd(46), res(k));
"

# Scripts de terceros en el navegador
grep -oE 'src=\"https://[^\"]+\"' index.html | sort -u

# Edge Functions: inventario completo, y falla si algo no lleva versión exacta
node scripts/check-edge-deps.mjs --lista

# Y el árbol resuelto, transitivas incluidas
sed -n '/"specifiers"/,/^  }/p' scripts/edge-check/deno.lock
```

**El `grep` que había aquí antes se quitó a propósito.** Era
`grep -rhoE 'from "(npm:|jsr:|https://)...'`, y esa fue la causa de que la
primera medición no viera 332 de los 434 imports flotantes: solo encuentra
`from "..."`, no los imports por efecto secundario ni los dinámicos, y cuenta
los que aparecen dentro de comentarios. La guardia hace las tres cosas bien; no
tiene sentido conservar al lado una receta que ya demostró equivocarse.

**Cuándo regenerarlo:** el de las Edge Functions **ya no hay que acordarse de
regenerarlo** — `guardia-dependencias` lo imprime en el resumen de cada PR y
falla si aparece un especificador sin versión. El del front sigue siendo manual:
al cambiar dependencias, antes de cada revisión de cumplimiento, y al menos una
vez al trimestre.
