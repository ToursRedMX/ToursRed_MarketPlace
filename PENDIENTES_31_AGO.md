# PENDIENTES — 31 de agosto de 2026

Sesión dedicada a la **Decisión 1** de [`PENDIENTES_27_AGO.md`](./PENDIENTES_27_AGO.md)
(línea 1124): *el lint con 2,472 errores que ningún workflow ejecuta*.

Queda cerrada, y de paso salieron dos bugs reales que nadie había visto porque
nadie miraba esa salida.

---

## ✅ Decisión 1 — el lint ya corre en CI

`.github/workflows/lint.yml` + `scripts/summarize-lint.mjs` (PR #95). Hermano de
`typecheck.yml`: informativo, nunca bloquea, corre en push a `main`, en cada PR
y por `workflow_dispatch`.

**No falla si el total sube.** Igual que con `typecheck.yml`, eso se decide
después de ver un par de semanas de datos reales.

### Lo que costó descubrir y conviene no repetir

**El resumen lee el JSON de ESLint, no la salida `stylish`.** No es preferencia:
las seis reglas del React Compiler (`set-state-in-effect`, `immutability`,
`refs`, `static-components`, `purity`, `preserve-manual-memoization`) **no
imprimen el `ruleId` en `stylish`**. Contar por "último campo de la línea"
atribuye **274 de los 2,561** problemas a palabras sueltas del mensaje —
`renders` (118), `declared` (80), `render` (66) — y esas seis reglas
**desaparecen del desglose**. Se intentó primero con `grep`, como en
`typecheck.yml`, y por eso se cambió.

**Dos guardias para que el centinela no mienta:**

- ESLint revienta antes de escribir el reporte (config rota, OOM, plugin que no
  carga) → se marca `ESLINT_BROKEN` y el summary lo dice, en vez de reportar un
  cero limpio.
- ESLint escribe `[]` porque no linteó nada (un `ignores` que se comió todo) →
  sin guardia el summary reportaría 0 problemas y un delta de −2560, o sea **una
  mejora inventada**. Se detecta con `report.length`.

### La medición

| | 31-ago inicial | Tras esta sesión |
|---|---|---|
| Problemas | 2,561 en 324 archivos | **2,512** |
| Errores | 2,472 | **2,423** |
| Warnings | 89 | 89 |

Desglose por familia (inicial → final):

| Familia | Inicial | Final |
|---|---|---|
| `no-explicit-any` | 1,672 (65%) | 1,668 |
| `no-unused-vars` | 322 (13%) | 322 |
| `react-hooks/*` | 360 (14%) | **329** |
| Resto | 207 (8%) | 193 |

> ⚠️ **La base de `lint.yml` debe sincronizarse a `2423 / 89 / 2512` cuando los
> PRs #96, #97, #98 y #99 estén todos mergeados.** Sólo #96 la mueve; los otros
> tres la dejan intacta a propósito para no generar conflictos entre ramas
> abiertas. Mientras tanto el summary marca un delta negativo, que no dispara
> ningún aviso.

---

## ✅ Dos bugs reales que salió a la luz al mirar el desglose

Ninguno de los dos lo detectaba `tsc`, y ninguno lo habría encontrado nadie
leyendo código: salieron de abrir el desglose por regla que produce el workflow
nuevo.

### 1. `BookingFlowStep3` — `useEffect` después de un early return (PR #95)

Un `useEffect` en la línea 283 estaba **después** de `if (!tour) return null` de
la 262. Hook condicional: en los renders con `tour` null se llamaban menos hooks
que en el resto, o sea `Rendered fewer hooks than expected` — pantalla blanca,
no un warning.

**No era alcanzable**, y lo que lo protegía **no vive en ese archivo**:
`BookingFlowLayout.tsx:160` (`if (!tour || !resolvedSlug) return null`) no monta
el Provider hasta tener el tour, y `resetFlow()` —lo único que devuelve `tour` a
null— además resetea `step` a 1, así que re-renderiza Step1.

Se arregló igual: mina enterrada, no incendio. El arreglo costó mover diez
líneas.

### 2. `BookingFlowStep3:30` — deref sin guardia (PR #97)

`!!(tour as any).vehicle_map_type` **sin optional chaining**, 232 líneas
**antes** del `return null` de la 262. Con `tour` null tiraba `TypeError` ahí
mismo, así que **ese `return null` era código muerto para el escenario que se
supone que cubre**.

**Por qué `tsc` nunca lo vio, que es lo más útil de todo esto:** el proyecto
tiene `strict: true` y `flow.tour` es `Tour | null`. Las líneas 28/32/33 usan
`tour?.`. Las 31/36 están cubiertas por el *narrowing de condición aliasada* de
TypeScript — como `const isReceptivo = tour?.tour_type === 'receptivo'`, dentro
de `isReceptivo && ...` TS ya sabe que `tour` no es null. **La línea 30 era la
única que casteaba el null con `as any`, y eso desactiva a la vez el narrowing y
el chequeo.** El `as any` era la razón de la ceguera del compilador, no un
detalle de estilo.

Tampoco es alcanzable hoy, pero la protección es **más delgada** que en el caso
anterior:

- `loadFromStorage` (`BookingFlowContext:47`) valida **sólo** `parsed.tourSlug`.
  No valida `parsed.tour`. Un payload restaurado con `tour` null/undefined
  **pisa el `initialTour` no-null**, porque el initializer de `useState`
  devuelve `stored` y ya no mira `initialTour`.
- El step sale de la **URL** (`BookingFlowLayout:20-33` parsea `/paso-N` y
  sincroniza con `goToStep`), y `goToStep` sólo toca `step`, nunca `tour`. Hay
  rutas directas a `/reservar/:slug/paso-3` (`App.tsx:261`). O sea que
  **`{tour: null, step: 3}` es un estado que la app puede expresar.**

> ⚠️ **Si se toca `loadFromStorage` o el gating de `BookingFlowLayout`, esta
> dependencia existe.** La validación de `tourSlug` es lo único que se interpone
> entre un payload viejo de `sessionStorage` y un render con `tour` null.

Arreglo: `VehicleMapType` ya existía en `types/seats.ts`; sólo faltaba declarar
`vehicle_map_type` en la interfaz `Tour`. Con el campo tipado, las tres `as any`
de las líneas 29-30 sobran.

---

## ✅ `react-hooks/static-components` y `purity` — cerrados

| PR | Qué | Efecto |
|---|---|---|
| #96 | `PermissionCheckbox` fuera de `AdminUsers` | −13 |
| #99 | `Th`, `SortIcon` ×2, `SectionMessage` fuera de sus padres | −29 |
| #98 | SLA con reloj compartido en `AdminServiceDesk` y `TravelerSupportTickets` | `purity` 3 → 1 |

`static-components` queda en **0** en todo el repo.

**Decisión de volumen del SLA (PR #98):** un solo timer por pantalla, no uno por
fila. La alternativa —un `<SlaBadge>` con su propio `useEffect`+`setInterval`—
crearía un intervalo **por fila**: con `PAGE_SIZE = 20` serían 20 intervalos y
20 re-renders independientes por minuto, desfasados, para un resultado idéntico
(todas las filas leen el mismo reloj). Refresco cada **60s** y no cada segundo
porque el badge muestra horas o días: un tick por segundo serían 59 re-renders
de más por minuto sin cambiar un píxel.

---

## 🔴 Lo que NO se toca, y por qué

**Esto es una decisión tomada el 31-ago, no un olvido.** El workflow de lint ya
los vigila: si alguno sube, el summary lo marca contra la base.

### D — `react-hooks/refs` (21). No se arregla

14 de los 21 son **la misma línea**: `SignupPage:596`, leyendo
`curpManuallyEdited.current` para elegir el texto de ayuda del CURP. Los otros:
`AdminCfdi:290` (4), `BookingFlowContext:208/210` (2), `OpenPayTopupModal:185` (1).

El fix es convertir el ref en estado. **Pero el ref probablemente se eligió
justamente para no re-renderizar en cada tecla.** Cambiarlo mete churn de render
en el formulario de registro a cambio de arreglar algo que **hoy se autocorrige
solo**: como `formData.curp` cambia en cada tecla, el re-render ocurre igual y
el texto se actualiza. Costo real, beneficio cosmético.

### E — `react-hooks/immutability` (86 en 69 archivos). No se arregla

El mensaje real es *"`fetchReviews` is accessed before it is declared, which
prevents the earlier access from being memoized"*. Son `useEffect` que
referencian funciones declaradas más abajo con `const`. **En runtime funcionan
correctamente** — el effect corre después del render, no hay TDZ real. Lo que
rompen es la memoización del React Compiler.

El fix sería reordenar declaraciones en **69 archivos**. Dos razones para no
hacerlo:

1. El beneficio es **sólo performance**, no corrección.
2. El costo es **reordenar hooks en 69 archivos**, que es exactamente la clase
   de cambio que se acaba de arreglar en `BookingFlowStep3`. Un reordenamiento
   mal hecho cerca de un early return reintroduce el bug de orden de hooks,
   multiplicado por 69.

**Cambiar 69 archivos por performance, con el riesgo de reintroducir el fallo
que se acaba de cerrar, no es buen trato.**

### F — `react-hooks/set-state-in-effect` (118 en 91 archivos). No como limpieza de lint

Es el de **mayor riesgo a plazo** de los tres: es el patrón que produce loops de
render y llamadas duplicadas a la BD. Pero **no hay transformación uniforme**:
cada uno requiere juicio caso por caso, porque hay `setState` en effect que son
legítimos (sincronizar con datos async, el patrón normal de carga) y otros que
son loops. Un arreglo en masa **rompe carga de datos en pantallas que hoy
funcionan**.

Se ataca **cuando una pantalla se sienta lenta o duplique llamadas**, con esa
pantalla como evidencia. Muy disperso: 91 archivos, el peor es
`AccountingPage.tsx` (9), que es el candidato natural para el primer caso.

### Otros que quedan abiertos

- **`react-hooks/purity` (1)** — `NotificationBell:12`, `Math.random()` para el
  id de canal de Realtime. El fix obvio, `useId()`, genera ids con dos puntos
  (`:r0:`) que **pueden no ser válidos como nombre de canal de Supabase**, así
  que necesita probarse contra Realtime, no adivinarse.
- **`react-hooks/exhaustive-deps` (85)** — son los 85 *warnings*, no errores.
- **`no-explicit-any` (1,668)** y **`no-unused-vars` (322)** — el 78% del total.
  Deuda de tipado, sin fecha.
- **`BookingFlowStep3:36`** — `hasRestrictions` depende del narrowing aliasado
  para no explotar. Funciona, pero es la misma clase de fragilidad que la línea
  30: protegido por inferencia, no por un guardia explícito.

---

## Nota de método

Se repitió el patrón del 27-ago: **las cifras que aguantaron salieron de parsear
estructura, no texto.** El desglose por regla con `grep` sobre `stylish` daba
274 problemas mal atribuidos y perdía seis reglas enteras; el mismo desglose
sobre el JSON dio el número correcto y destapó los 360 de `react-hooks/*`, que
es donde estaban los dos bugs reales.

Y otra vez un número heredado no valía: se entró a la sesión buscando confirmar
*"501 total / 32 crash-class del 29-ago"*. Eran del **25-ago**, y los 32 de
clase crash llevaban cerrados desde el 26-ago. La medición real era **460 / 0**,
que es justo lo que decía la base del propio `typecheck.yml`.

*Para retomar: leer este archivo. El detalle de lo anterior está en
[`PENDIENTES_27_AGO.md`](./PENDIENTES_27_AGO.md).*
