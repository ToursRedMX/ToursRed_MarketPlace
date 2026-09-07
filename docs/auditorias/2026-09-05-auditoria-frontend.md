# Auditoría del frontend — 05 de septiembre de 2026

**Alcance:** `src/` — 262 archivos TypeScript/React, **123,840 líneas**.
**Tipo de trabajo:** solo revisión y documentación. **No se modificó código de la
aplicación.**
**Enfoque:** a diferencia de las dos auditorías anteriores, esta busca **errores de
código además de huecos de seguridad**, por pedido explícito.

**Continuación de:** `2026-09-05-auditoria-edge-functions.md` y
`2026-09-05-auditoria-funciones-postgres.md` (PR #132).

---

## Método: esta vez sí corrí las herramientas

En las dos auditorías anteriores todo fue lectura estática. Aquí instalé las
dependencias y **ejecuté ESLint sobre el árbol real**, lo que da evidencia
reproducible en vez de impresiones.

Con un tropiezo que vale la pena contar porque **es en sí mismo un hallazgo**:
`npm install` falla en este entorno con `403 Forbidden` sobre
`https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz`. Instalé quitando `xlsx`
temporalmente y **restauré `package.json` y `package-lock.json` al terminar**
(verificado: `git status` limpio). Ver **F-5**.

**Resultado de ESLint:** 2,485 problemas (2,397 errores, 88 warnings). La línea base
comprometida en `.github/workflows/lint.yml` es 2,423 errores / 89 warnings / 2,512
total, medida sobre `main` el 31-ago. Mis números quedan levemente por debajo; la
diferencia probablemente venga de la resolución de versiones de mi instalación, y no la
perseguí porque no cambia ninguna conclusión.

---

## Resumen ejecutivo

El frontend es la capa **más grande y menos protegida** de las tres auditadas, pero por
razones distintas a las de las Edge Functions: aquí no encontré agujeros de seguridad
graves —el modelo de amenazas de un SPA pone la defensa en el servidor, y eso ya se
auditó—. Lo que encontré es **deuda de correctitud**: código que no se ejecuta, consultas
cuyo resultado se tira, y errores que se pierden en silencio.

**1 hallazgo alto, 5 medios.** El alto no es una vulnerabilidad: es que **la mitad de las
consultas a la base ignoran el error** y renderizan vacío como si todo hubiera salido
bien.

Y una observación de proceso que enmarca todo lo demás: **el check de `lint` no puede
salir rojo por diseño** (`exit 0` explícito), con una base tolerada de 2,423 errores. Eso
es una decisión razonable y bien documentada para no bloquear con ruido histórico, pero
tiene un costo concreto que este documento demuestra: **encontré código de pago muerto
que ESLint ya había detectado**, indistinguible de otras 317 variables sin usar.

---

# ALTO

## F-1. La mitad de las consultas a Supabase ignoran el error y renderizan vacío

**Medición sobre `src/`:**

| | Sitios |
|---|---|
| `const { data ... } = await supabase...` | 499 |
| ...que además desestructuran `error` | 251 |
| **...que NO piden `error` en absoluto** | **248 (50%)** |

En esos 248 sitios, si la consulta falla —RLS que rechaza, red caída, columna renombrada,
token expirado— `data` llega `null`, el componente pinta la lista vacía o el estado
inicial, y **el usuario ve una pantalla que parece correcta y está mal**. No hay error en
consola, no hay reintento, no hay mensaje.

En muchos casos es inofensivo: `MaintenanceBanner.tsx:17` falla y simplemente no se ve el
banner. Pero la lista incluye caminos donde el fallo silencioso **bloquea la venta sin
explicar por qué**:

| Archivo | Qué se pierde en silencio |
|---|---|
| `src/components/seats/SeatMapPicker.tsx:245` | El mapa de asientos queda vacío → el viajero no puede seleccionar asiento ni completar la reserva |
| `src/components/seats/SeatMapManager.tsx:68,220` | La agencia no ve los asientos que administra |
| `src/components/TravelerCfdiList.tsx:61` | El viajero no ve sus facturas y no sabe si es que no existen o que falló la consulta |
| `src/components/AgencyContractSection.tsx:67,80` | Documentos de contrato no listados |
| `src/components/TourCard.tsx:92` | Estado de "guardado" del tour |

**Por qué lo pongo en alto.** No es una vulnerabilidad, pero es el defecto que más
probablemente vas a ver en producción después del lanzamiento, y el más difícil de
diagnosticar: el reporte del usuario será "no me aparecen los asientos", sin nada en los
logs. Es la misma categoría que los `EXCEPTION WHEN OTHERS` que marqué en SQL y en las
Edge Functions —**el error existe, se descarta, y el sistema sigue como si nada**—, pero
aquí está en 248 lugares.

**Nota de alcance honesta:** no revisé los 248 uno por uno. Verifiqué la medición y leí
una muestra. Es perfectamente posible que una parte sean intencionales (widgets
opcionales donde fallar en silencio es lo correcto). El trabajo de triage —cuáles
importan— es el primer paso del arreglo, no algo que esta auditoría resuelva.

---

# MEDIOS

## F-2. Hay 60 líneas de código de cobro con Stripe que nunca se ejecutan

**Archivo:** `src/components/BookingForm.tsx:1382`

```ts
const createStripeCheckout = async (bookingId: string, customerEmail: string, amount: number) => {
  ...
  const response = await fetch(
    `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/create-checkout-session`, ...
```

**Verificado: `createStripeCheckout` no se invoca en ningún lugar del proyecto.**
`grep -rn 'createStripeCheckout' src/` devuelve exactamente una línea: su propia
definición.

Y como esa función contiene **la única** referencia a `functions/v1/...` de todo
`BookingForm.tsx`, la consecuencia es que **el componente de reserva principal no cobra
nada**: crea la reserva y el cobro ocurre en otra página. Eso está bien; el problema es
que el archivo no lo dice.

**Por qué importa más de lo que parece.** No tiene efecto en runtime —es código muerto—,
pero es una trampa de mantenimiento en el camino del dinero. Yo mismo caí en ella: pasé
un rato razonando sobre si el `amount` que manda `BookingForm` incluía o no el costo de
membresía, hasta comprobar que `BookingForm` no manda nada. Quien mantenga esto en seis
meses hará lo mismo, y si alguien "arregla" esa función creyéndola viva, el arreglo no
tendrá efecto.

**El dato incómodo:** ESLint **ya lo había detectado** —
`@typescript-eslint/no-unused-vars` en la línea 1382, literalmente
`'createStripeCheckout' is assigned a value but never used`. Está ahí desde siempre,
entre otras 317 variables sin usar, en un check que no puede fallar. Ver **F-4**.

**Dato relacionado, para cuando se toque C-1 de la auditoría de Edge Functions:** los
sitios que **sí** llaman a `create-checkout-session` son tres, no cuatro
(`BookingFlowStep4.tsx:543`, `TravelerBookings.tsx:1592`, `TravelersInfoPage.tsx:843`), y
cada uno calcula su monto en una variable propia (`srvAmountToCharge`, `amountToCharge`, y
una IIFE que resta `membershipCost`). La Edge Function tiene un comentario que dice
*"In this branch, `amount` already has membershipCost subtracted (TravelersInfoPage)"* —
**un endpoint cuyo contrato depende de qué archivo del front lo llamó**. Eso es
exactamente la duplicación del desglose que `claude.md` ya tiene en el backlog, y es el
motivo por el que centralizarla vale los 4-6 días que estimaste.

## F-3. Consultas que se ejecutan y cuyo resultado se descarta

Dos casos donde se pide dato a la base, se guarda en estado, y **nunca se lee**:

**`src/pages/booking-flow/BookingFlowStep3.tsx:47-49`**

```ts
const [walletBalance, setWalletBalance] = useState(0);
const [pointsBalance, setPointsBalance] = useState(0);
const [pointsWalletActive, setPointsWalletActive] = useState(false);
```

Se llenan en las líneas 116-125 con consultas reales a las wallets… y no se usan en
ninguna otra parte del archivo. O sea: el paso 3 del flujo de reserva **paga el costo de
las consultas y tira el resultado**.

**`src/pages/agency/AgencyFinancials.tsx:25`** — `commissionRecords` se llena en la línea
81 (`setCommissionRecords(records || [])`) y nunca se lee.

**Las dos lecturas posibles, y no puedo distinguirlas desde el código:**

1. **Sobra** — quedó de una refactorización y hay que borrarlo. Costo: consultas de más
   por cada reserva.
2. **Falta** — la UI *debería* mostrar "tienes $X en ToursRed Cash" en ese paso, o el
   detalle de comisiones en el panel financiero de la agencia, y **silenciosamente no lo
   hace**. Costo: una funcionalidad que crees que existe y no existe.

La segunda es la que preocupa, y es una pregunta de producto que solo tú puedes contestar:
**¿se supone que el paso 3 muestra el saldo de wallet y puntos?** Si la respuesta es sí,
esto es un bug de funcionalidad faltante, no código sobrante.

## F-4. El check de `lint` no puede salir rojo, y eso ya escondió un hallazgo real

**Archivo:** `.github/workflows/lint.yml`

El workflow se llama "Lint (informative)" y es deliberado y honesto — el propio archivo lo
explica:

```yaml
# Modo informativo a proposito: reporta y nunca bloquea.
...
set +e
npx eslint . -f json -o eslint-report.json > eslint-stderr.log 2>&1
CODE=$?
set -e
...
exit 0
```

Con base declarada `BASELINE_ERRORS: 2423`, `BASELINE_WARNINGS: 89`.

**La decisión es correcta y no propongo revertirla.** Bloquear con 2,423 errores heredados
haría imposible mergear nada, y el archivo documenta bien por qué se lee el JSON y no la
salida `stylish` (las reglas del React Compiler no imprimen `ruleId` en `stylish`).

**El problema es lo que falta.** `tipos-edge` resolvió este mismo dilema mejor: usa una
**línea base que no puede crecer** y por eso es check requerido —un error nuevo bloquea el
merge—. `lint` tiene la línea base pero **no la exige**: el step siempre sale `exit 0`, así
que un PR que agregue 50 errores nuevos pasa igual de verde.

La consecuencia no es teórica: **F-2 estuvo detectado por ESLint todo este tiempo.** Una
función de cobro muerta y un import sin usar se ven exactamente igual en un reporte de
2,485 líneas que nadie puede accionar.

**Lo que lo cerraría** es lo que ya funciona en `tipos-edge`: hacer que el step falle si el
conteo **sube** respecto de la base. El repo ya tiene `scripts/summarize-lint.mjs`, que
calcula el resumen; le falta el `exit 1` condicionado y volverlo requerido.

**Corrección a algo que te dije antes:** cuando reporté que el PR #132 tenía "lint en
verde", eso era cierto como hecho pero engañoso como señal. **`lint` sale verde siempre**,
haga lo que haga el código. No lo tomes como evidencia de calidad en ningún PR.

## F-5. `xlsx` se instala desde un tarball de CDN, no desde npm

**Archivo:** `package.json`

```json
"xlsx": "https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz"
```

Es una URL directa a un tarball, no un paquete del registro. Tres consecuencias concretas:

1. **El build depende de que ese CDN responda.** No es hipotético: **este entorno lo
   bloquea y `npm install` falla entero con `403`**. Cualquier red corporativa, proxy o
   caída de `cdn.sheetjs.com` rompe la instalación completa, no solo esa dependencia.
2. **Queda fuera de `npm audit` y de Dependabot.** El repo tiene `.github/dependabot.yml`,
   pero una dependencia por URL no se actualiza ni se audita por ahí — justo la librería
   que procesa archivos subidos por usuarios.
3. **La versión está clavada en la URL.** Una actualización de seguridad exige editar el
   `package.json` a mano; nada avisa de que salió.

**Contexto justo:** SheetJS movió su distribución fuera de npm en 2023 y esta es la forma
que ellos recomiendan, así que **no es un error del equipo**. Pero conviene que sea una
decisión consciente y no una herencia: si `xlsx` solo se usa para exportar, hay
alternativas en el registro; si se queda, vale documentar en el README que el build
requiere acceso a ese dominio.

## F-6. HTML sin sanitizar de contenido administrable, renderizado a usuarios finales

**6 archivos, 9 usos de `dangerouslySetInnerHTML`:**

| Archivo | Quién lo ve |
|---|---|
| `src/pages/TermsOfServicePage.tsx:74` | **Cualquier visitante** |
| `src/components/TermsAcceptanceGate.tsx:133` | **Todo usuario que acepta términos** |
| `src/pages/agency/onboarding/OnboardingTermsStep.tsx:70` | **Toda agencia que se da de alta** |
| `src/pages/admin/TermsManagementPage.tsx:197,399` | Admin |
| `src/pages/admin/AdminBroadcastMessages.tsx:317,380` | Admin |
| `src/pages/admin/AdminNewsletter.tsx:388,453` | Admin |

El contenido sale de la base (`terms.content`, `message_body`) y lo escriben admins, así
que **no es un XSS explotable por un usuario cualquiera** — por eso es medio y no alto.

El riesgo real es de **amplificación**: una cuenta de admin comprometida deja de ser "un
admin malicioso" y pasa a ser **ejecución de JavaScript en el navegador de todos los
viajeros y agencias** que abran los términos, con robo de sesión incluido. Los tres
primeros archivos de la tabla son los que convierten el problema en masivo.

Sanitizar en el render (DOMPurify o equivalente) corta esa amplificación sin quitarle nada
al editor de contenido, y es una defensa que no depende de que ninguna cuenta se mantenga
íntegra.

---

# Lo que revisé y NO resultó ser un problema

Lo documento con el mismo detalle que los hallazgos, porque en las tres auditorías el
patrón se repite: **los barridos automáticos producen más falsos positivos que hallazgos.**

| Sospecha | Qué resultó al leer el código |
|---|---|
| **Comparación de float a cero en decisiones de pago** (`totalToPayNow === 0`, `BookingForm:1079`) | **Falso.** La línea 1074 absorbe cualquier residuo `< 10` como `0`, y todos los `Math.min` garantizan que los restos nunca sean negativos. La aritmética está bien protegida. |
| **`TravelersInfoPage` sin protección contra doble clic en el pago** | **Falso.** Sí la tiene (`isSaving`, línea 1513). Mi grep buscaba `isSubmitting`/`isLoading` y no ese nombre. |
| **`PaymentPlanCalendar` muta una variable de módulo** (3 errores de `react-hooks/immutability`) | **Falso positivo de la regla.** Las tres líneas son `window.location.href = ...`, o sea navegación legítima. |
| **`AgencyBookings`: `statusText`/`statusClass` asignados y sin usar** (7 avisos) | **Falso.** Sí se usan, en el JSX de retorno. La regla marca la inicialización `= ''` como redundante porque todas las ramas del `switch` la sobrescriben. Es estilo, no bug. |
| **`AdminSupportCategories:66` expresión sin usar** | **Falso.** Es `next.has(id) ? next.delete(id) : next.add(id)` — un ternario como sentencia. Funciona; es estilo. |
| **84 `exhaustive-deps` = 84 bugs de closure obsoleta** | **Mayoritariamente falso.** Casi todos son el patrón `useEffect(() => { fetchX() }, [])` para cargar al montar, que es intencional. Los revisé en los archivos de dinero y ninguno resultó ser un bug con impacto. |
| **`ProtectedRoute` no es una barrera de seguridad real** | **Cierto pero esperado.** En cualquier SPA el enrutado es UI; la defensa vive en el servidor. Lo anoto solo para enlazarlo con el hallazgo A-1 de la auditoría de Edge Functions: **ahí sí** faltaba la barrera del lado del servidor, y es donde importa. |
| **Secretos filtrados en el bundle** | **Falso.** Las cinco variables `VITE_` son `APP_URL`, `GA_MEASUREMENT_ID`, `SENTRY_DSN`, `SUPABASE_URL` y `SUPABASE_PUBLISHABLE_KEY`. Todas son públicas por diseño. Ningún secreto. |

---

# Priorización sugerida

| # | Hallazgo | Severidad | Esfuerzo |
|---|---|---|---|
| 1 | **F-3** — decidir si el saldo de wallet/puntos *debe* mostrarse en el paso 3 | Medio | **una respuesta tuya**, luego trivial |
| 2 | **F-2** — borrar `createStripeCheckout` | Medio | trivial |
| 3 | **F-4** — hacer que `lint` falle si el conteo sube (patrón de `tipos-edge`) | Medio | bajo, y protege todo lo demás |
| 4 | **F-6** — sanitizar el HTML de términos (los 3 archivos de cara al usuario) | Medio | bajo |
| 5 | **F-1** — triage de los 248 sitios: empezar por los de reserva y pago | Alto | medio-alto (el triage es el trabajo) |
| 6 | **F-5** — decidir conscientemente si `xlsx` se queda por URL | Medio | una decisión |

**F-1 es el de mayor impacto pero va quinto a propósito:** los cuatro anteriores se cierran
en un día entre todos, y el #3 evita que el problema siga creciendo mientras se hace el
triage largo.

---

# La conclusión, ya con las tres capas auditadas

| Capa | Tamaño | Naturaleza del problema |
|---|---|---|
| Edge Functions | 171 fn / ~69,600 líneas | **Seguridad.** ~81 endpoints alcanzables sin cuenta; monto de Stripe controlado por el cliente |
| Postgres / SQL | 345 fn / 869 migraciones | **Bastante sólida.** 1 posible rotura funcional por un endurecimiento aplicado a ciegas |
| Frontend | 262 archivos / 123,840 líneas | **Correctitud.** Errores que se descartan, código muerto, consultas tiradas |

Las tres comparten **el mismo hilo, y es el hallazgo más útil de todo el ejercicio: el
error existe, alguien lo detecta, y se descarta.**

- Edge Functions: `console.warn` de firma de Stripe faltante que nadie lee.
- SQL: `RAISE WARNING` en las tres `snapshot_*_tax` y en `snapshot_booking_tax`.
- Frontend: 248 consultas que ni siquiera piden el `error`, y 2,485 avisos de ESLint en un
  check que no puede fallar.

Y en las tres capas **la solución correcta ya está escrita en el repo**: `paypal-webhook`
falla cerrado; `insert_audit_log` deja rastro en `audit_errors`; `tipos-edge` bloquea con
línea base. **El problema nunca fue no saber cómo hacerlo. Fue que la versión buena no se
propagó al caso gemelo.**

Por eso, si tuviera que recomendar una sola cosa antes del 21 de septiembre, no sería
arreglar ninguno de los 22 hallazgos: sería **extender el patrón de `tipos-edge` —línea
base que no puede crecer, como check requerido— a lint, y aplicar el mismo criterio a los
guards de las Edge Functions.** Eso convierte "lo arreglamos" en "no puede volver a
entrar", que es la diferencia entre las tres auditorías siendo útiles una vez o siendo
útiles siempre.

---

## Verificación y límites

**Verificado ejecutando:** ESLint corrió sobre el árbol real (2,485 problemas). Los
conteos de este documento —499/251/248 consultas, 9 usos de `dangerouslySetInnerHTML`, 5
variables `VITE_`— salen de barridos reproducibles sobre `src/`.

**Verificado leyendo:** los hallazgos F-2 y F-3 y los ocho falsos positivos se
confirmaron abriendo cada archivo.

**Lo que NO hice, y por lo tanto no afirmo:**

- **No ejecuté la aplicación.** Ni un clic, ni una captura. Los fallos de F-1 y F-3 están
  razonados desde el código, no observados en un navegador. F-3 en particular necesita que
  alguien abra el paso 3 del flujo y diga si falta ese bloque de UI o no.
- **No revisé los 248 sitios de F-1 uno por uno.** Verifiqué la medición y leí una muestra.
- **No audité accesibilidad, rendimiento, ni el bundle final.** Quedan fuera de esta pasada.
- **`npm install` no completa en este entorno** por el bloqueo de `cdn.sheetjs.com`, así que
  ESLint corrió sin la dependencia `xlsx` instalada. Eso no afecta el análisis estático,
  pero significa que no pude correr un build real.
- **Restauré `package.json` y `package-lock.json`**; `git status` quedó limpio.
