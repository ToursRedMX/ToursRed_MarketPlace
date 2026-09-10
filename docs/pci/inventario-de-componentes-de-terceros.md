# Inventario de componentes de terceros

**Última medición:** 10 de septiembre de 2026, sobre `main` en `f8b03e3`
**Requisito que atiende:** PCI DSS v4 **6.3.2** — mantener un inventario de
software a medida y de componentes de terceros, para poder identificar
vulnerabilidades. También sirve de insumo a **6.3.1** (seguimiento de
vulnerabilidades) y **6.3.3** (parcheo).

> El mapeo a requisitos es una **propuesta**. Aquí nadie es QSA.

---

## Resumen: dos mitades con muy distinta salud

| | Front (navegador) | Edge Functions (Deno) |
|---|---|---|
| ¿Hay archivo que fije versiones? | **Sí** — `package-lock.json` v3 | **No** |
| Componentes directos | 24 | 6 |
| Árbol completo resuelto | **417 paquetes** | no determinable desde el repo |
| ¿Se puede afirmar qué versión corre? | **Sí** | **No, para 3 de los 6** |

El front está resuelto. **El hueco real está en las Edge Functions**, y la
sección 2 lo cuantifica.

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

## 2. Edge Functions: aquí está el hueco

**No existe `deno.json`, ni import map, ni `deno.lock`.** Nada fija las versiones.
Deno resuelve cada especificador **en el momento del despliegue**.

### Componentes importados

| Componente | Especificador | Usos | ¿Fija versión? |
|---|---|---|---|
| `@sentry/deno` | `npm:@sentry/deno@9` | 169 | **No** — mayor flotante |
| `@supabase/supabase-js` | `npm:...@2` | 85 funciones | **No** — mayor flotante |
| `@supabase/supabase-js` | `npm:...@2.39.6` | 68 funciones | Sí |
| `@supabase/supabase-js` | `jsr:...@2` | 13 funciones | **No**, y **otro registro** |
| `@supabase/supabase-js` | `npm:...@2.108.2` | 5 funciones | Sí |
| `stripe` | `npm:stripe@22.3.0` | 8 | Sí |
| `xlsx` | `npm:xlsx@0.18.5` | 2 | Sí |
| `pdfmake` | `npm:pdfmake@0.2.20/...` | 1 | Sí |
| `pdfmake` | `npm:pdfmake@0.2.x/...` | 1 | **No** — rango |

### Los tres problemas, en orden de importancia

**1. La misma librería, cuatro formas distintas.** `@supabase/supabase-js` se
importa con cuatro especificadores diferentes repartidos en las 171 funciones,
desde **dos registros distintos** (npm y jsr) y con **dos versiones fijas
distintas** (2.39.6 y 2.108.2). Entre 2.39.6 y 2.115.0 —la que usa el front— hay
una distancia considerable.

**2. Los mayores flotantes hacen indeterminable lo que corre.** `npm:@sentry/deno@9`
y `npm:@supabase/supabase-js@2` se resuelven al desplegar. Dos funciones
desplegadas con una semana de diferencia pueden estar corriendo versiones
distintas de la misma librería, **y no hay forma de saberlo leyendo el repo**.

Esto choca de frente con 6.3.2: si un aviso de seguridad afecta a
`@supabase/supabase-js` 2.4x pero no a 2.10x, hoy no se puede responder cuáles de
las 171 funciones están expuestas sin inspeccionar cada despliegue.

**3. `xlsx` en dos versiones.** El front usa 0.20.3 (del CDN de SheetJS) y las
Edge Functions 0.18.5 (de npm). Dos versiones distintas de la misma librería, de
dos orígenes distintos.

### Qué haría falta para cerrarlo

En orden de esfuerzo creciente:

1. **Unificar el especificador de `@supabase/supabase-js`** a uno solo, con
   versión fija. Es mecánico y de bajo riesgo, aunque toca muchos archivos.
2. **Fijar `@sentry/deno` y `pdfmake@0.2.x`** a versiones exactas.
3. **Añadir una guardia de CI** que rechace especificadores sin versión exacta en
   `supabase/functions/`. Sería del mismo tipo que `check-search-path.mjs`: nace
   en cero y bloquea de verdad. Es lo que convierte esto de "se arregló una vez"
   a "no puede volver a pasar".

**No se hace en este documento a propósito.** Cambiar 171 funciones es un cambio
de código con su propio riesgo, y merece su PR, su prueba y su revisión, no venir
de contrabando dentro de un documento.

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

# Edge Functions: imports externos y cuántas veces se usa cada uno
grep -rhoE 'from \"(npm:|jsr:|https://)[^\"]+\"' supabase/functions/ --include=*.ts \
  | sed 's/from \"//;s/\"//' | sort | uniq -c | sort -rn
```

**Cuándo regenerarlo:** al cambiar dependencias, antes de cada revisión de
cumplimiento, y en cualquier caso al menos una vez al trimestre. Si se añade la
guardia de CI de la sección 2, el inventario de las Edge Functions deja de poder
quedarse obsoleto en silencio.
