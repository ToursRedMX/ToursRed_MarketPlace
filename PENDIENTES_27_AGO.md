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
borradas). **I.1 e I.3 quedaron cerradas y mergeadas; I.2 sigue bloqueada.**
La migración de Tailwind 4 está terminada (ver la sección 🟣).

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

### ✅ I.1 — Tailwind 4.3.3 · **CERRADA** el 27-ago (PR #41) · rematada el 28-ago (PR #43)

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
| `space-*` | `gap-*` en 397; los 402 restantes **no requerían migración** (ver 🟣 1) | 799 | ✅ cerrado el 28-ago |
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

Las cinco salieron de ejecutar la migración de Tailwind, pero **ninguna
pertenece a esa pieza** y ninguna se tocó en el PR #41.

**Tres quedaron cerradas el 27-ago en el PR #42** (rama `chore/limpieza-menor`)
y **la primera quedó cerrada el 28-ago en el PR #43**.

**1. ✅ CERRADA el 28-ago — los 402 contenedores `space-y-*`. Eran 25, no 402.**

v4 cambió `space-y` de dos formas a la vez: la especificidad cae de (0,3,0) a
**cero** (`:where()`), y el margen pasa de `margin-top` en los hijos 2…n a
`margin-bottom` en los 1…n-1. El efecto es que **un hijo con margen propio, que
en v3 era invisible, ahora gana**.

#### Los números del 27-ago estaban mal medidos

El **384** contaba el margen en **todo el subárbol**. `space-y` sólo toca
**hijos directos**. Remedido el 28-ago parseando JSX con la API de TypeScript
—no con grep— y comparando además los valores numéricos:

| | 27-ago | Real |
|---|---|---|
| Contenedores restantes | 402 | **402** ✅ |
| Con margen propio en hijo directo | 384 | **48** |
| …de los que **cambian de aspecto** | — | **25** |
| Con contenido suelto | 16 | **0** |
| Sin cambio alguno | — | **376** |

Reproduje la medición vieja (margen en cualquier descendiente) y da **386**,
prácticamente el 384 documentado: ahí estaba el error.

**Los 376 no estaban pendientes: no había nada que hacer con ellos.** v3 pone
`margin-top` en los hijos 2…n y v4 pone `margin-bottom` en los 1…n-1; sin
márgenes propios que compitan, el espacio entre cada par es idéntico y ninguna
de las dos versiones derrama margen fuera del contenedor.

Del **48** con margen propio, sólo **25** cambian de verdad: un hijo con `mb-*`
sólo aprieta si su valor **queda por debajo** del `space-y`, y uno con `mt-*`
sólo abre si lo **supera**. Los otros 23 dan el mismo resultado en ambas
versiones.

#### El arreglo aplicado (PR #43, commit `1b79a64`)

**Borrar el margen del hijo.** Al quitarlo, el `space-y` de v4 vuelve a aplicar
y da exactamente el valor de v3.

Convertir a `flex`+`gap` **no** servía, porque los items de un flex **no
colapsan márgenes**:

```
space-y-3 + hijo mb-1  ->  v3 0.75rem | v4 hoy 0.25rem | flex+gap 1rem | tras borrar 0.75rem
```

- **17 se aprietan** — hijo con `mb-*` menor que el `space-y`. 13 son el mismo
  patrón: `<div class="flex items-center gap-2 mb-1">` como primer hijo.
- **8 se abren** — hijo con `mt-*` mayor que el `space-y`.

27 ediciones en 17 archivos, concentradas en `BookingForm` (4),
`BookingFlowStep3` (3) y `AgencyTours` (3).

**Verificación:** reclasificación **401/402** reproducen v3 (antes 377); CSS
generado **byte-idéntico** a `main` (147,524 B); `typecheck` **460**; `lint`
**2561** (2472+89); build verde. Revisión visual confirmada en el preview.

El CSS byte-idéntico es lo esperado y conviene no malinterpretarlo: las 8 clases
retiradas siguen usadas en cientos de sitios (`mb-1` en 600, `mb-4` en 635), así
que no cambia *qué* CSS existe, sólo *qué elementos lo llevan*. **Aquí el CSS no
sirve de prueba** — la comprobación real es la reclasificación más la revisión
visual.

#### Lo que la investigación de componentes descartó

Se leyeron **uno por uno los 11 componentes** que aparecen como hijo directo de
un `space-y`, para no asumir dónde vive el margen. **10 no tienen margen propio**
y sus contenedores quedaron confirmados como "sin cambio": `SearchBox`,
`EmptyState`, `LoadingSpinner` (2 definiciones), `SeatMapPicker`,
`SlotDetailPanel`, `SectionMessage`, `DaysProgress`, `AgencyContractSection`,
`CfdiViewerModal` (es `fixed inset-0`, fuera de flujo) y `Link`.

`SeatMapPicker` se revisó a fondo por ser el más complejo: **tres raíces, las
tres un `<div>` simple** (cargando / error / principal), ninguna un Fragment
—que habría metido varios hijos al `space-y` del padre—, sin `style` con margen,
sin valores arbitrarios `m-[…]` y sin márgenes negativos. Sus únicos márgenes
son horizontales y en elementos internos (`mx-auto`, `ml-3`), que no intervienen
en `space-y`. **No es ambiguo.**

Afinando el resolvedor para ramas `null` y para un IIFE, los **6 "opacos"
bajaron a 0**: cinco resultaron sin cambio y el sexto destapó el único caso real
que queda (ver pieza 5).

**2. ✅ CERRADA — campos sin indicador de foco (accesibilidad). Eran 8, no 10.**

Al ir a arreglarlos, **dos de los "10" resultaron falsos positivos** de la
auditoría del 27-ago, que sólo miraba el `className` del propio elemento:

- **`AccountCatalogModal.tsx:261` ya tenía foco.** Su `className` es un template
  literal multilínea y sí incluye `focus:border-sky-400 focus:ring-1
  focus:ring-sky-100`; la regex sólo capturó el tramo anterior a la interpolación.
- **`AgencyProfile.tsx:967` lo hereda del padre.** El contenedor lleva
  `focus-within:ring-2 focus-within:ring-blue-500`, así que al enfocar el input
  el grupo entero dibuja el anillo. Ponerle uno propio lo habría duplicado.

Reauditado con un escáner que respeta llaves y template literals: de **274
controles con `outline-hidden`**, 9 sin indicador propio y uno de ellos cubierto
por el padre. **Reales: 8**, los ocho `<select>` de `AccountingPage.tsx`
(selectores de mes/año, `border-none` dentro de un chip `bg-gray-50`).

Arreglados con `rounded focus:ring-2 focus:ring-sky-500` — anillo, no borde,
porque con `border-none` un foco de borde no se vería; y `sky` porque es la
paleta que ya usa ese archivo. El anillo es `box-shadow`, así que no mueve el
layout. Auditoría tras el arreglo: **0 descubiertos**.

**3. ✅ CERRADA — typo en `MaintenancePage.tsx:19`.**

`rounded-x1 shadow-2x1` usaba el **dígito 1** en vez de la letra **l**, así que
esas clases no existían y no aplicaban nada. Corregido a `rounded-xl shadow-2xl`;
el logo gana esquinas redondeadas y sombra. Único caso de este typo en la app.
Se dejó fuera del PR #41 a propósito para no confundirlo con un efecto de
Tailwind 4 durante la revisión visual.

**4. ✅ CERRADA — `.btn-accent` muerta, eliminada de `index.css`.**

Confirmado antes de borrar: aparecía sólo en su propia definición, con 0 usos en
código y sin construcción por concatenación (`btn-${…}`). Sus hermanas siguen
vivas — `btn-primary` (106 usos), `btn-outline` (70), `btn-secondary` (21).

**Verificado de paso:** `BASELINE_TOTAL` del workflow `typecheck.yml` sigue
correcto en **460** (con `BASELINE_CRASH: 0`), como quedó en el PR #40. No hizo
falta tocarlo.

**5. 🟡 ABIERTA — `PaymentProviderSelector`: margen dentro del componente.**

Salió de cerrar la pieza 1. **Es un solo sitio**, y se dejó fuera del PR #43 a
propósito: no es mecánico y no urge.

`src/pages/traveler/TravelerBookings.tsx:3922` tiene `<PaymentProviderSelector>`
como 2º hijo directo de un `space-y-6` (1.5rem). Sus **dos raíces llevan `mb-4`**
(1rem) — el aviso de "sin proveedores" en `PaymentProviderSelector.tsx:185` y la
raíz principal en `:200`. Como 1rem < 1.5rem, ese hueco **se aprieta** respecto
a v3.

**Por qué no se tocó:** el margen vive **dentro** del componente, no en el sitio
de llamada, y el componente se usa en **6 lugares** (`BookingForm.tsx:3324`,
`PaymentPlanCalendar.tsx:393` y `:442`, `BookingFlowStep4.tsx:1042`,
`GiftCardsPage.tsx:776`, `TravelerBookings.tsx:3939`). Quitarle el `mb-4`
arreglaría este sitio y **cambiaría el espaciado de los otros 5**, que hoy
dependen de él.

Salidas posibles, ninguna obvia: envolverlo en el sitio de llamada, aceptar una
prop `className`, o subir el `space-y-6` del contenedor. **Pide criterio, no
regla.** Es el único caso genuinamente ambiguo que quedó de los 402.

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

## 🟠 Decisiones

**La 2 (secrets scanning) quedo resuelta el 28-ago.** Sigue abierta solo la 1.

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

### 2. ✅ RESUELTA el 28-ago — `SECRETS_SCAN_ENABLED`, activo pero **sin efecto real**

`netlify.toml` pasó a `SECRETS_SCAN_ENABLED = "true"` con cinco exclusiones.

> [!WARNING]
> **Está activo y NO protege nada hoy. Verificado con una prueba real, no
> asumido.** No lo cuentes como un control que funciona.

#### La prueba y su resultado

Se creó en Netlify la variable `CANARY_SECRETS_SCAN_TEST` **marcada
explícitamente como secreta** (`is_secret: true`), acotada al contexto
`deploy-preview`. Se commiteó un archivo con ese mismo valor y se empujó a la
rama del PR #49.

| Paso | Resultado esperado | Resultado real |
|---|---|---|
| Build con el escaneo activo | **fallar** antes de publicar | **pasó** |
| El valor en el sitio publicado | no debería existir | **HTTP 200, texto íntegro** |

El valor de una variable marcada como secreta **se publicó en texto plano en un
deploy-preview público** y el build no se inmutó. Canario y variable borrados
tras la prueba.

No se pudo separar si la causa es el **plan `Free`** —la doc dice que *smart
detection* es de planes Personal/Pro/Enterprise— o que el escaneo no corra en
contexto `deploy-preview`. Distinguirlo exigiría probar contra producción.

#### Por qué se dejó activado igual

Las cinco exclusiones son correctas y **no cuestan nada**. Si Netlify llega a
habilitar el escaneo de verdad en este plan, la configuración ya queda lista sin
trabajo adicional:

```toml
SECRETS_SCAN_OMIT_KEYS = "VITE_SUPABASE_URL,VITE_SUPABASE_PUBLISHABLE_KEY,VITE_APP_URL,VITE_SENTRY_DSN,VITE_GA_MEASUREMENT_ID"
```

Las cinco se verificaron **uso por uso en `src/`**, no por convención de nombre:
`VITE_SUPABASE_URL` (76 archivos, endpoint de las functions),
`VITE_SUPABASE_PUBLISHABLE_KEY` (28, header `Apikey` desde el browser),
`VITE_APP_URL` (5, URL canónica de SEO), `VITE_SENTRY_DSN` (1, DSN público de
solo-escritura) y `VITE_GA_MEASUREMENT_ID` (1, measurement id de GA4). Las cinco
acaban en el bundle **por diseño**.

#### Correcciones a lo que decía este archivo

- **El escaneo NO avisa de variables faltantes.** Detecta secretos *presentes* en
  el output. La versión anterior de esta sección decía que habría avisado del
  fallo de los PR #20 y #21; **es falso**, y ese incidente sigue necesitando el
  smoke test de la pieza H.
- **Nunca fue una decisión apagarlo.** `SECRETS_SCAN_ENABLED = "false"` venía del
  commit inicial `02f142f` (volcado de scaffold, 1.034 archivos). Ni commit
  propio, ni mensaje, ni diagnóstico detrás.

#### Lo que sí protege: push protection de GitHub

Demostrado el 28-ago por accidente. Un primer canario con formato `sk_live_…`
**fue rechazado en el push**, señalando archivo y línea:

```
remote: - commit: 86c4e1c  path: public/canary-secrets-scan.txt:4
! [remote rejected] (push declined due to repository rule violations)
```

La API del repo reporta `secret_scanning: disabled`, pero esos campos son de
GitHub Advanced Security (repos privados); **en repos públicos como este,
GitHub activa escaneo y push protection por defecto**. Cubre secretos que entran
al repo. **No cubre** los que sólo aparecen en el output del build — y eso hoy
no lo cubre nadie.

#### Inventario de variables de Netlify (28-ago): 16, una sola marcada

| Variable | ¿Secreta? | Nota |
|---|---|---|
| `SENTRY_AUTH_TOKEN` | **sí** | la única marcada; sólo en producción, **vacía en `deploy-preview`** |
| `NETLIFY_PRERENDER_AUTH_TOKEN` | no | **token de 16 chars sin marcar** — lo creó la extensión de prerender |
| `SUPABASE_ANON_KEY`, `VITE_SUPABASE_ANON_KEY` | no | el JWT `anon` legacy (`role=anon`, expira 2035) |
| `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `VITE_SUPABASE_*`, `VITE_SENTRY_DSN`, `VITE_APP_URL` | no | públicas por diseño |
| `SENTRY_ORG`, `SENTRY_PROJECT`, `NODE_OPTIONS`, `NETLIFY_PRERENDER_*` | no | configuración, no secretos |

Tres cosas que salen del inventario:

1. **No existe ninguna variable de Stripe, FacturAPI ni SMTP2GO en Netlify.**
   Viven en los secrets de las edge functions de Supabase.
2. **`NETLIFY_PRERENDER_AUTH_TOKEN` es un token real sin marcar como secreto.**
   Pendiente menor: marcarlo.
3. **`SENTRY_AUTH_TOKEN` está vacía en `deploy-preview`.** Por eso el primer
   build verde del PR #49 no significaba nada: no había un solo valor que
   escanear en ese contexto.

#### Pendientes menores que dejó esto

- Marcar `NETLIFY_PRERENDER_AUTH_TOKEN` como secreta.
- `VITE_SUPABASE_ANON_KEY` está puesta en producción y **no la usa ningún
  archivo de la app** (0 usos): configuración muerta.
- La clave `anon` sigue **hardcodeada** en dos migraciones archivadas
  (`20260528055744_…` y `20260602040035_…`). Es pública por diseño y el repo es
  público, así que no es una fuga; pero conviene limpiarla en vez de excluir los
  695 archivos del archivo histórico con `SECRETS_SCAN_OMIT_PATHS`.

Nota conceptual que conviene no perder: **la llave publicable no es un secreto**
(lo que protege los datos es la RLS), pero un `SERVICE_ROLE_KEY` sí lo es y
**nunca debe ir en una variable `VITE_*`**, porque todas acaban en el bundle.
Ese es justamente el hueco que el escaneo de Netlify debería cubrir y hoy no
cubre.

> [!NOTE]
> **Cómo comprobar rutas en este sitio:** el catch-all del SPA devuelve **200
> con `index.html`** para cualquier ruta inexistente. El código HTTP por sí solo
> no prueba que un archivo exista — hay que mirar el cuerpo de la respuesta.

---

## ⚪ Datos de prueba por limpiar — **N/A por ahora**

**No se atiende como pieza suelta:** se resuelve con la depuración general del
ambiente antes del UAT, no antes. Queda aquí sólo como inventario.

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
| **#4** | `typescript` 5.9.3 → 7.0.2 | **Bloqueado.** Ver I.2. No mergear |

**Es el único que queda abierto.**

**Cerrados el 27-ago:** #39 (TypeScript 6.0.3, mergeado), #40 (baseline de
typecheck, mergeado), **#41** (Tailwind 4.3.3 + 2 fixes, mergeado tras la
revisión visual), **#42** (limpieza menor, mergeado después del #41) y **#5**
(Tailwind, cerrado por obsoleto — el #41 hizo el trabajo completo y el #5 ni
siquiera compilaba por sí solo).

**Cerrado el 28-ago:** **#43** (espaciado de v3 en los 25 `space-y` con margen
propio, mergeado tras la revisión visual del preview — pieza 🟣 1).

---

## Avisos operativos

- **No correr `supabase db push`** sin revisar antes: el registro quedó alineado
  el 27-ago (PR #19), pero hay **753 versiones aplicadas en la BD sin archivo en
  el repo** (histórico del proyecto + las 9 de `routesred`). El repo nunca tuvo
  el historial completo.
- **`main` está protegida** — estado verificado por API el 28-ago:

  | Ajuste | Estado |
  |---|---|
  | `enforce_admins` | ✅ `true` — **ya no es un pendiente**, se activó entre el 27 y el 28-ago |
  | `required_status_checks` | ✅ `typecheck` y `netlify/toursredmx/deploy-preview`, configurados el 28-ago (`strict: false`) |
  | `allow_force_pushes` / `allow_deletions` | ✅ `false` |
  | `required_approving_review_count` | ⚠️ **0** — un PR lo puede mergear su propio autor |
  | `required_conversation_resolution`, `required_signatures`, `required_linear_history` | `false` |

  **Hasta el 28-ago no había ningún status check obligatorio**: `main` exigía un
  PR, pero ese PR se podía mergear al instante y **con los checks en rojo**. Los
  cinco merges de ese día (#43, #44, #46, #48, #49) esperaron a verde por
  criterio, no porque GitHub lo impusiera. Ahora sí lo impone.

  Queda deliberadamente en 0 el número de aprobaciones: con `enforce_admins` en
  `true` y un equipo de una persona, exigir 1 bloquearía a Axel consigo mismo.
  Es una decisión, no un descuido.

  **Ojo con `strict: false`:** no obliga a que la rama esté al día con `main`
  antes de mergear. Subirlo a `true` da más garantía pero exige actualizar cada
  PR antes del merge.

- **Hay otra fuente escribiendo en el repo.** El 28-ago aparecieron en `main`
  los merges de los PR **#46, #47 y #48**, desde ramas con los mismos nombres
  que las usadas en la sesión (`fix/space-y-margenes-v4`, `docs/pendientes-28-ago`),
  que ya se habían mergeado como #43 y #44. El contenido final se verificó y es
  el correcto, pero conviene saber que algo o alguien —probablemente Bolt con la
  cuenta de Axel— recrea ramas y reabre PRs.
- **RoutesRed** (esquema `routesred`, 14 tablas + `user_platforms`) está en la BD
  de sandbox sin archivos en el repo. Identificado, aislado y sin riesgo para
  ToursRed. Se documenta si se retoma.

---

*Estado al cierre del 28-ago: **I.1 (Tailwind 4) cerrada y mergeada** (PR #41),
igual que **I.3 (TypeScript 6.0.3)** (PR #39); I.2 (TypeScript 7) sigue
bloqueada. De las piezas 🟣, **cuatro de cinco están cerradas**: sólo queda la
5 (`PaymentProviderSelector`, un sitio, pide criterio). **La migración de
Tailwind 4 está terminada.***

*Lo que sigue abierto y con alcance real es **la pieza H**: el check verde de
`deploy-preview` no valida que la app arranque. Es el siguiente hallazgo a
atacar.*

*Para retomar: leer este archivo. El detalle histórico de lo ya cerrado está en
[`PENDIENTES_26_AGO.md`](./PENDIENTES_26_AGO.md), que no se sigue ampliando.*
