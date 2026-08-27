# Pendientes al cierre — 27 de agosto 2026

> Este archivo contiene **solo lo que sigue activo**. Las sesiones del 25 y 26 de
> agosto quedaron **completas, verificadas y en producción**: contabilidad,
> payouts a agencias, la familia de CFDI, la pieza F de `executive_commissions`,
> el guard de `support-create-ticket`, la pieza E de typecheck, la pieza G de
> Turnstile, React 19, TipTap 3.30.5 y la realineación del registro de
> migraciones. El detalle histórico de todo eso está en
> [`PENDIENTES_26_AGO.md`](./PENDIENTES_26_AGO.md), que queda cerrado y no se
> sigue ampliando.

---

## 🔵 I — Actualizaciones de dependencias mayores

Diagnosticadas a fondo el 27-ago con spikes reales (ramas aparte, medidas y
borradas). **I.3 quedó cerrada. La siguiente pieza a retomar es I.1 (Tailwind
4), que pide sesión propia.**

### ✅ I.3 — TypeScript 6.0.3 · **CERRADA** el 27-ago

`typescript@5.9.3 → 6.0.3` + `typescript-eslint@8.67.0 → 8.68.0`, en la rama
`chore/typescript-6.0.3`. Tomó menos de una hora, como estaba estimado.

**Se aplicó la alternativa limpia, no `"types": ["node"]`.** Los 3 sitios de
`NodeJS.Timeout` pasaron a `ReturnType<typeof setTimeout>`:

```
src/components/DeparturePointSelector.tsx:44
src/components/ProtectedRoute.tsx:18
src/hooks/useFormPersistence.ts:20
```

La razón de no usar `"types": ["node"]`: **`@types/node` no es dependencia
directa** —sólo llega transitivamente vía `vite` y `@types/qrcode`—, así que esa
vía habría exigido declararlo además en `devDependencies`. Y los 3 sitios son
`useRef` en componentes de navegador, donde `setTimeout` devuelve `number`, no
`NodeJS.Timeout`; cargar los tipos de Node en el tsconfig de la app también
habría hecho aparecer `process`, `Buffer` y `__dirname` como disponibles en
código que corre en el browser. `tsconfig.app.json` no se tocó.

**Verificación completa, toda contra la línea base de `main`:**

| Prueba | Resultado |
|---|---|
| `npm install` | limpio, **0 avisos** `ERESOLVE` |
| `tsc` | **460 / 0 nuevos / 0 desaparecen / 460 idénticos** |
| `npm run lint` | 2561 (2472 errors, 89 warnings) — **desglose por regla idéntico**, sin el rechazo `does not support TS` |
| `npm run build` | verde, 7027 módulos, **hashes de bundle byte-idénticos a `main`** |

Los hashes idénticos (`index-zZvJIaHS.js`, `vendor-D2T7RTfA.js`,
`index-CcSZvpd0.css`) son la prueba más fuerte: el cambio es puramente de tipos
y no alteró una sola línea del runtime.

Confirmado además contra el registro npm el 27-ago: `6.0.3` es la última 6.x
estable (publicada 2026-04-16), `6.1.0` no existe, `typescript-eslint@8.68.1`
sólo tiene alphas, y el peer `>=4.8.4 <6.1.0` admite 6.0.3 sin overrides.

**Ojo con el `tsc` de esta rama:** sigue saliendo con código 2 y el lint con 1.
Es la línea base preexistente de `main`, no una falla nueva.

### ✅ I.1 — Tailwind 4.3.3 · **CÓDIGO COMPLETO** · PR #41 listo para mergear

**El grueso no es código: son 3-4 horas de mirar pantallas.**

**Lo que bloquea el build** (15 min, ya probado):

1. El plugin de PostCSS se mudó: `tailwindcss` → `@tailwindcss/postcss`.
2. `@tailwind base/components/utilities` → `@import "tailwindcss";`.

**El config NO hay que migrarlo.** Con una línea
—`@config "../tailwind.config.js"`— sobrevive todo el tema, verificado
comparando el CSS generado: las 6 paletas custom (60 tonos), la fuente Inter y
las animaciones con sus keyframes. `plugins` está vacío. Migrar a `@theme` es
opcional.

**Lo que cambia de aspecto en silencio** (medido tokenizando los 21,143
atributos `className`):

| Clase v3 | Qué pasa en v4 | Usos |
|---|---|---|
| `space-x-*` / `space-y-*` | selector `:not([hidden])~:not([hidden])` → `:where(>:not(:last-child))` | **799** |
| `outline-none` | ya no dibuja outline transparente; ahora `outline-style:none` | **324** |
| `shadow-sm` | pasa a valer lo que valía `shadow`: sombra más grande | **233** |
| `border` sin color | hereda `currentColor` en vez de `gray-200` | **179** |
| `bg-opacity-*`, `ring-opacity-*` | **eliminadas, dejan de aplicar** | **51** |
| `backdrop-blur-sm` | 4px → 8px | **35** |
| `rounded-sm` | .125rem → .25rem | **6** |

**`outline-none` con 324 usos es el que más cuidado merece: es accesibilidad.**
Puede dejar campos sin indicador de foco visible.

**Lo que NO se rompe**, contra lo que se supone: `flex-shrink-0` (566 usos)
sigue funcionando, `rounded` sigue en `.25rem` (273 usos), y los `!important` de
Tailwind son **0** reales.

**Medición del CSS:** 124,453 → 149,374 bytes (+20%). De 919 clases comparables,
787 difieren en texto **pero casi todas son indirección de variables con el
mismo valor computado** (`gap:1rem` → `gap:calc(var(--spacing)*4)`). Clases que
desaparecen de verdad: **4**.

**Plan:** PostCSS + `@import` + `@config` (15 min) → `npx @tailwindcss/upgrade` y
revisar su diff (1 h) → los 7 patrones de reemplazo (1-2 h) → **revisión visual
pantalla por pantalla (3-4 h)** → ajustes (1-2 h).

No hay `tsc` que avise ni error de consola: una sombra más grande o un `space-x`
desalineado **no rompen nada, solo se ven mal**.



#### ✅ Estado de la ejecución (27-ago)

**Revisión visual completa hecha el 27-ago sobre el preview del PR #41.**
Detectó **una** regresión, ya corregida (ver más abajo). El resto, conforme.

El **PR #5** de Dependabot quedó **cerrado por obsoleto**: sólo subía la versión
y ni siquiera compilaba por sí solo.

El PR #41 trae **tres commits deliberadamente separados**:

| Commit | Qué es |
|---|---|
| `d178b6c` | La migración a Tailwind 4 |
| `073bc83` | `fix(nav)`: la lupa del header apuntaba a `/search`, que no existe (404). **Bug preexistente**, también en producción; la búsqueda vive en `/tours` |
| `194c8eb` | `fix(css)`: fondo por defecto de los controles de texto (la regresión de la revisión visual) |

**Estructural:** `tailwindcss` 4.3.3 + `@tailwindcss/postcss`, `@import
"tailwindcss"` + `@config`, `autoprefixer` quitado (redundante en v4), y
`@source` acotado (ver hallazgo 1). CSS: 124,453 → **147,519 bytes**.

**Los 7 patrones**, todos con equivalencia comprobada en el CSS generado:

| Patrón | Reemplazo | Usos | Estado |
|---|---|---|---|
| `rounded-sm` | `rounded-xs` (.125rem) | 6 | ✅ |
| `backdrop-blur-sm` | `backdrop-blur-xs` (4px) | 35 | ✅ |
| `bg/ring-opacity-*` | sintaxis de barra (`bg-black/50`) | 51 | ✅ |
| `shadow-sm` | `shadow-xs` | 248 | ✅ |
| `border` sin color | `border-gray-200` explícito | 63 | ✅ |
| `space-*` | `gap-*` | **397 de 799** | ⚠️ parcial |
| `outline-none` | `outline-hidden` | 331 | ✅ |

En cada paso: `typecheck` **460** (base intacta), `lint` **2561** (2472+89, sin
cambio), build **verde**.

**Criterio aplicado: preservar la apariencia de v3**, no adoptar los valores
nuevos de v4.

Comprobaciones que evitaron falsos supuestos: `shadow` pelado (79 usos), `md`,
`lg`, `xl` y `2xl` son **idénticos** en v3 y v4 — sólo `shadow-sm` se corrió. Y
el patrón `border` no eran 1,630 casos sino **61**: el resto ya llevaba el color
al lado.

#### 🔴 Hallazgo de la revisión visual — v4 volvió transparentes TODOS los controles de formulario

**La única regresión que encontró la revisión visual.** El input del boletín en
el Footer se veía azul en vez de blanco, con el placeholder casi ilegible.

```css
/* v3 — transparente SÓLO en botones */
button, input:where([type=button]), input:where([type=reset]), input:where([type=submit])
  { background-color: #0000 }

/* v4 — transparente en TODOS */
button, input, select, optgroup, textarea { background-color: #0000; ... }
```

Ese input **nunca tuvo clase de fondo**: se apoyaba en el blanco por defecto del
navegador. El Footer es `bg-blue-900`, de ahí el azul.

Mismo mecanismo que el patrón #5 (`border` sin color): v4 quita un valor por
defecto del que dependía código escrito para v3. **Alcance: 674 controles sin
clase `bg-*` en 108 archivos** — la mayoría sobre fondos claros, donde no se
nota.

Corregido en `194c8eb` con una regla en `@layer base` (las utilidades siguen
ganando, así que un `bg-transparent` intencional se respeta).

**Verificado en Chrome comparando `getComputedStyle` contra el CSS real de v3**,
no razonando sobre el orden de capas. 12 de 13 tipos idénticos. Esa comparación
encontró dos errores propios que el razonamiento no habría detectado:

- Un fallback `background-color: Field` que **Lightning CSS colapsaba**, dejando
  sólo `field`: los navegadores anteriores a 2023 se quedaban sin fondo.
- `range` estaba **mal excluido** — en v3 computaba blanco. Ya entra.

Única diferencia que queda: `type="color"` (v3 daba el gris del navegador, v4 lo
deja transparente). **La app no lo usa** (0 casos).

---


#### 🔴 Hallazgos 1 y 2 — comportamientos de v4 que el diagnóstico no capturó

Dos comportamientos reales de v4 que **el diagnóstico no capturó** y que pesan
igual que los 7 patrones. Ninguno da error: los dos son silenciosos.

**1. v4 ignora `content`: escanea todo el repo por defecto.**

`@config` preserva el tema, **pero no el scope**. El `content` del
`tailwind.config.js` deja de limitar qué archivos se escanean; v4 auto-detecta
fuentes en todo el proyecto. Comprobado con un `.md` temporal que contenía
`p-77` y `bg-fuchsia-950` —clases inexistentes en el código—: **v4 las emitió**.

En la práctica ya nos pasó: `.rounded-sm` seguía apareciendo en el bundle
después de migrarla, porque el string vive en las tablas de
`PENDIENTES_26_AGO.md` y `PENDIENTES_27_AGO.md`. **Nuestra propia documentación
estaba inyectando CSS.**

Corregido acotando las fuentes en `src/index.css`:

```css
@import "tailwindcss" source(none);
@source "../index.html";
@source "../src/**/*.{js,ts,jsx,tsx}";
@config "../tailwind.config.js";
```

Verificado: caen 6 clases y ninguna es real (`.rounded-sm`, `.outline`,
`.ease-out`, `.border-collapse`, `.contents`, `.ease-in-out` — 0 usos sueltos
las seis); no aparece ninguna clase nueva; las 45 tonalidades custom intactas.

**Lo que importa no es el tamaño (605 bytes), es el comportamiento:** cualquier
`.md`, `.json` o `.txt` que entre al repo puede inyectar clases al bundle, y el
`content` del config ya no lo impide.

**2. Los colores *stock* de v4 se mudaron a oklch — 8º punto de revisión visual.**

No es una clase que se reemplace, así que no aparece entre los 7 patrones:

```
v3:  --color-blue-50  ->  rgb(239 246 255)      /* #eff6ff */
v4:  --color-blue-50  ->  oklch(97% .014 254.604)
```

**153 declaraciones oklch en v4, 0 en v3.** Afecta a todo lo que use `gray-*`,
`blue-*`, `red-*`, `orange-*` — incluidos el fondo del `body` (`bg-blue-50`) y
el color del texto (`text-gray-800`).

Las 6 paletas custom **no** se ven afectadas: siguen en hex porque vienen del
config vía `@config`. Ese contraste entre stock y custom es justo lo que hay que
mirar.

En sRGB se ve casi igual; **en pantallas de gamut amplio (P3) oklch renderiza
más saturado**. Dos consecuencias para el plan: la revisión visual debe hacerse
también en una pantalla P3 (un teléfono reciente sirve), y **"el hex es
idéntico" deja de ser comprobación válida** para los colores stock.

**Ajustes menores medidos en la ejecución:**

- Conteos reales de dos patrones: `outline-none` **331** (no 324) y `shadow-sm`
  **248** (no 233). El diagnóstico tokenizó sólo atributos `className`; los
  extras viven en `src/index.css` (el `focus:outline-none` de `.btn` y el
  `shadow-sm` de `.input`) y en clases armadas en template literals. **Hay usos
  que no están en un `className`.**
- El patrón `border` sin color **no es medible por ocurrencia**: el grep crudo
  da 1,630, pero la enorme mayoría son `border border-gray-200`, con el color
  justo después y por tanto sin riesgo. Los ~179 en riesgo son los que no llevan
  color en el mismo `className`; hay que calcularlo por atributo.
- `autoprefixer` quitado de `postcss.config.js`: redundante con v4. Verificado —
  28 → 21 prefijos, y los 7 que se van son los duplicados (`-moz-column-gap` ×5,
  `-o-object-fit` ×2); las propiedades sin prefijo intactas.
- **`.btn-accent` está muerta** (0 usos en el código). v3 la purgaba, v4 la
  emite igual. **No es de esta migración** — anotada como limpieza aparte.

**Criterio acordado para los 7 patrones: preservar la apariencia de v3**, no
adoptar los valores nuevos de v4.
### I.2 — TypeScript 7.0.2 (PR #4) · **bloqueado, no mergear**

```
$ npm run lint
Error: typescript-eslint does not support TS 7.0.
```

No es una advertencia de peer: es un **rechazo explícito en runtime**. Y no hay
salida — instalado (8.67.0), último (8.68.0) y **canary** (8.68.1-alpha.5) tienen
todos el mismo tope `>=4.8.4 <6.1.0`. No existe ninguna 9.x.

Lo demás está listo: `tsc` da 459 (456 con `types: ["node"]`), 390 errores
idénticos y un churn simétrico que es reformateo de diagnósticos, no errores
nuevos.

**Acción:** dejar el #4 abierto, **no mergearlo**, y revisar cada pocas semanas
si sale una `typescript-eslint` que levante el tope. Cuando pase: menos de 2
horas.

## 🟣 Piezas propias que salieron de la migración de Tailwind

Las cuatro salieron de ejecutar la migración de Tailwind, pero **ninguna
pertenece a esa pieza** y ninguna se tocó en el PR #41. Todas necesitan criterio
humano, no medición de CSS.

Las dos primeras son trabajo real; las dos últimas son limpiezas de minutos.

**1. 402 contenedores `space-y-*` sin migrar a `gap`.**

v4 cambió `space-*` de dos formas a la vez: la especificidad cae de (0,3,0) a
**cero** (`:where()`), y el margen pasa de `margin-top` a `margin-bottom`. El
efecto es que **cualquier hijo con margen propio ahora gana**.

De 790 contenedores, **425 cambian de espaciado**: 159 se aprietan, 140 más se
aprietan (v3 ganaba, v4 pierde) y 126 se abren.

Se migraron los seguros: **165** que ya eran `flex`/`grid` (cambio directo a
`gap`) y **232** `block` limpios (a `flex flex-col` + `gap-y`). Quedan:

- **384** con margen propio en algún hijo. Convertirlos a flex **tampoco**
  reproduce v3, porque los items de un flex **no colapsan márgenes**: con
  `space-y-3` + hijo `mb-1`, v3 da 0.75rem, v4 sin tocar da 0.25rem y
  `flex`+`gap` daría 1rem. Para que dé 0.75 hay que **decidir por cada hijo si
  su margen sobra**. No es mecánico.
- **16** con texto o expresión suelta como hijo directo: al volverse flex, cada
  trozo se convierte en item independiente. Revisión manual.

**Mientras no se resuelvan, esos 402 mantienen el comportamiento de v4** (se
aprietan o se abren según el caso). Es lo más visible de la revisión.

**2. 10 campos sin indicador de foco (accesibilidad).**

De 330 usos de `outline-none`, **320 tienen indicador alternativo**
(`focus:ring` 575 tokens, `focus:outline` 284, `focus:border` 107, `peer-focus`
25). **10 no tienen ninguno**:

| Archivo | Casos |
|---|---|
| `src/pages/accounting/AccountingPage.tsx` | 8 (campos editables en línea) |
| `src/components/accounting/AccountCatalogModal.tsx:261` | 1 |
| `src/pages/agency/AgencyProfile.tsx:972` | 1 |

**Ya era así en v3** — no lo introduce esta migración. `outline-hidden` les
devuelve el contorno en modo de contraste forzado, que es la última pista para
quien navega con teclado. **Añadirles un `focus:ring` es una mejora real y
pendiente**, pero es un cambio visible y no pertenece a esta pieza.

**3 y 4. Dos limpiezas menores, de minutos.**

- **`src/pages/MaintenancePage.tsx:19`**: `className="h-16 rounded-x1 shadow-2x1"`
  usa el **dígito 1** en vez de la letra **l**. Esas clases no existen ni en v3
  ni en v4, así que hoy no aplican nada. No se corrigió a propósito: haría que
  esa página gane sombra y redondeo durante la revisión visual y lo leeríamos
  como efecto de Tailwind 4.
- **`.btn-accent` está muerta** (0 usos). v3 la purgaba, v4 la emite igual.
---

---

## 🔴 H — El check verde de `deploy-preview` no valida que la app arranque

**Sigue vivo y sin resolver.** Es el hallazgo con más alcance de la sesión.

El check `netlify/toursredmx/deploy-preview` solo verifica que el **build
compile**. Los previews de los PR #20 y #21 estuvieron **en verde** mientras la
app moría al inicializar con `Uncaught Error: supabaseKey is required` — porque
`VITE_SUPABASE_PUBLISHABLE_KEY` no llegaba a los previews.

Es el mismo patrón que documentó la pieza E: allí era Vite compilando sin
ejecutar `tsc`; aquí es Netlify empaquetando sin abrir la página.

**Lo que faltaría:** un smoke test post-deploy que cargue la home del preview y
falle si la consola tiene errores. Sin eso, "preview en verde" seguirá sin
querer decir "la app funciona".

*(Las otras dos capas de la pieza H —la variable de entorno de Netlify y el
allowlist de hostnames de Turnstile— ya quedaron resueltas. El detalle de cómo
se diagnosticaron está en el histórico.)*

---

## 🟠 Dos decisiones que hay que tomar

### 1. Los 2,472 errores de lint que nadie ejecuta

```
$ npm run lint
✖ 2561 problems (2472 errors, 89 warnings)
```

`npm run lint` reporta 2,472 errores en `main` **y ningún workflow lo ejecuta** —
verificado sobre los 11 de `.github/workflows/`. La regla que más dispara es
`@typescript-eslint/no-explicit-any`, coherente con los 120 `TS2339` que se
arrastran sobre respuestas de Supabase sin tipar.

**Recomendación: meterlo al pipeline en modo informativo, con 2,472 / 89 como
línea base — y no intentar arreglar los 2,472.**

El argumento es el mismo que funcionó con `tsc` en la pieza E: el valor no está
en limpiar el pasado, sino en que **un error nuevo se note contra una base
conocida**. Hoy `eslint.config.js` tiene reglas activas que no protegen nada.

Lo más barato es agregar un step al workflow `typecheck.yml` que ya existe,
reutilizando su patrón: `set +e`, conteo por regla, publicación en
`GITHUB_STEP_SUMMARY` y comparación contra la base. Media hora de trabajo.

La alternativa honesta, si no se quiere el ruido, es **decir explícitamente que
el lint es decorativo** y quitarlo de `package.json`. Lo que no conviene es
dejarlo como está: configurado, activo y sin ejecutar.

### 2. `SECRETS_SCAN_ENABLED = "false"` en `netlify.toml`

Es lo que hizo que el fallo de la variable de entorno pasara **silencioso**: con
el escaneo activo, Netlify habría avisado de que una variable esperada no estaba
disponible en el contexto del build.

**Recomendación: reactivarlo, pero en su propio PR y verificando el preview
antes de mergear.**

El riesgo real de encenderlo es que el escáner marque como filtración las
variables `VITE_*` que **son públicas por diseño** —la llave publicable y la URL
de Supabase viven en el bundle del navegador— y tumbe el build por falsos
positivos. Eso se resuelve declarándolas con `SECRETS_SCAN_OMIT_KEYS`, en vez de
apagar el escaneo entero.

Nota conceptual que conviene no perder: **la llave publicable no es un secreto**
(lo que protege los datos es la RLS), pero un `SERVICE_ROLE_KEY` sí lo es y
**nunca debe ir en una variable `VITE_*`**, porque todas acaban en el bundle.

---

## 🟢 Datos de prueba por limpiar antes del UAT

Cuatro tickets de soporte creados el 27-ago al verificar el guard de
`support-create-ticket`. **Los cuatro llevan "PRUEBA" en la descripción.**

| Folio | Qué es |
|---|---|
| `REG-0000001` | general anónimo, sin `user_id` |
| `RES-0000001` | viajero, enviado desde la pantalla real |
| `RES-0000002` | viajero, enviado vía API |
| `PAAG-0000001` | agencia, enviado desde la pantalla real |

Ya restaurados y sin pendiente: la fila temporal de `executive_commissions` con
`cfdi_source='manual'` fue borrada, las URLs de la fila `80ce9e54` quedaron
restauradas, y el `email_verified` de `axelalvarez@outlook.com` volvió a `true`
(verificado: 0 usuarios sin verificar).

En el histórico hay más datos de prueba de las sesiones del 25 y 26 de agosto,
también para limpiar antes del UAT.

---

## Estado de los PRs abiertos

| PR | Qué | Acción |
|---|---|---|
| **#41** | Tailwind 4.3.3 (pieza I.1) + 2 fixes | **Abierto, listo para mergear.** Revisión visual hecha, checks en verde |
| **#4** | `typescript` 5.9.3 → 7.0.2 | **Bloqueado.** Ver I.2. No mergear |

**Cerrados el 27-ago:** #39 (TypeScript 6.0.3, mergeado), #40 (baseline de
typecheck, mergeado) y **#5** (Tailwind, cerrado por obsoleto — el #41 hace el
trabajo completo y el #5 ni siquiera compilaba por sí solo).

---

## Avisos operativos

- **No correr `supabase db push`** sin revisar antes: el registro quedó alineado
  el 27-ago (PR #19), pero hay **753 versiones aplicadas en la BD sin archivo en
  el repo** (histórico del proyecto + las 9 de `routesred`). El repo nunca tuvo
  el historial completo.
- **`main` está protegida**: requiere PR. Falta marcar *"Do not allow bypassing
  the above settings"* — hoy `enforce_admins` está en `false`, así que un admin
  (o Bolt actuando con esa cuenta) todavía puede saltarse la regla.
- **RoutesRed** (esquema `routesred`, 14 tablas + `user_platforms`) está en la BD
  de sandbox sin archivos en el repo. Identificado, aislado y sin riesgo para
  ToursRed. Se documenta si se retoma.

---

*Estado al cierre del 27-ago: **I.3 (TypeScript 6.0.3) cerrada y mergeada**;
**I.1 (Tailwind 4) con el código completo en el PR #41, listo para mergear**;
I.2 (TypeScript 7) sigue bloqueada. Lo que queda de Tailwind son las cuatro
piezas propias de la sección 🟣.*

*Para retomar: leer este archivo. El detalle histórico de lo ya cerrado está en
[`PENDIENTES_26_AGO.md`](./PENDIENTES_26_AGO.md), que no se sigue ampliando.*
