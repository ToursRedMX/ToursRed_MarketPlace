# ToursRed — Reglas del proyecto para Claude Code

## Qué es esto
ToursRed es una plataforma donde agencias de viaje comercializan sus propios tours (marketplace estilo Civitatis). Axel es fundador/dueño, no organiza los tours directamente.

**Todavía NO estamos en producción. No hay información real: todo lo que hay en la base son pruebas de Axel**, y se va a depurar antes de las UAT. Esto cambia cómo se prioriza: una fila financiera rara casi siempre es un experimento suyo, no un incidente. Antes de alarmar por un dato, pregunta. Lo que sí importa es que el CÓDIGO no vuelva a producirlo cuando el dinero sea real.

## Stack
- **Backend/DB:** Supabase, multi-schema (`public`, `corporate`; a futuro schemas por marca)
- **Pagos:** Stripe (procesador principal, migración "Dahlia" completada), PayPal, MercadoPago, Conekta, OpenPay
- **Contabilidad:** mini-ERP interno (`chart_of_accounts`, `accounting_entries`, etc.) — Zoho Books y Odoo están DEPRECADOS, no usar ni referenciar como sistema activo
- **Hosting front:** Netlify (staging: toursredmx.netlify.app)
- **Ambientes:** dev / staging / producción, migración gradual, metodología ágil tipo Scrum
- **RoutesRed** es otro proyecto, apenas iniciado con Bolt. No es prioridad y no se toca salvo que Axel lo pida.

## Reglas duras — no negociables

1. **Nunca apliques migraciones de base de datos directamente en Supabase sin autorización explícita de Axel en el momento.** Los cambios de esquema deben pasar por el repo (commit) para quedar en el historial. Leer y diagnosticar la BD libremente sí está permitido en cualquier momento. **Commitear el SQL no basta: hay que aplicarlo con la versión del archivo.** Si se aplica desde el Dashboard o por API, la base asigna su propio timestamp y el ledger queda apuntando a una versión que no existe en el repo — pasó con las dos migraciones del 02-sep-2026 pese a que ambas estaban commiteadas y revisadas en PR. Ver `scripts/check-migration-drift.mjs` y la entrada 3 de la bitácora. **Y hay que aplicarlo desde una carpeta que TENGA el archivo**: ver la trampa de `db push` en la sección de comandos.
2. **No hagas push a producción/main sin que Axel lo revise y apruebe explícitamente.** Trabaja en ramas o espera confirmación antes de mergear/pushear cambios sensibles.
3. **No toques integraciones con Zoho Books u Odoo** como si fueran el sistema contable activo — están deprecadas.
4. Antes de dar por "terminada" una tarea, corre `git diff` y muéstrale a Axel qué cambió.
5. **`supabase db push --include-all` se usa solo con un motivo y mirando antes el ledger.** Aplica TODO archivo local que no esté en el ledger, así que su radio de daño es el repo entero y no el cambio que traes.
   **Este archivo lo daba por prohibido sin matices, y eso era impreciso.** El peligro concreto que citaba —reaplicar `users_curp_or_passport_check` (de `tight_manor`) y `users_identification_check` (de `pale_swamp`, retirado a propósito)— **no puede dispararse hoy**: las dos se marcaron como aplicadas con `migration repair` el 02-sep-2026, así que `--include-all` las salta. Comprobado el 11-sep-2026: `copper_grove`, `tight_manor` y `pale_swamp` están las tres en el ledger y ninguna de las dos restricciones existe en la base.
   **El riesgo sigue siendo real si alguna sale del ledger** (un `repair --status reverted`, una base nueva, otro proyecto): `users_curp_or_passport_check` exige CURP o pasaporte según `is_foreign_traveler`, y **6 de los 11 usuarios de hoy lo violarían** — medido, no recordado. Un `ALTER TABLE ... ADD CONSTRAINT` contra filas que lo violan falla y aborta la migración entera.
   Antes de correrlo, mira qué va a aplicar: `supabase db push --dry-run`.

## Estilo de trabajo
- Explica en español los cambios que propones antes de aplicarlos si son de impacto medio/alto (lógica de pagos, cancelaciones, wallet/puntos, esquema de BD).
- Para cambios pequeños de UI/CSS/copys, puedes proceder y luego resumir qué tocaste.
- Sigue el patrón de desglose de costos existente (hoy duplicado en ~4 lugares) hasta que se centralice — no inventes un quinto lugar nuevo sin avisar.
- Sé honesto. Axel prefiere un «no lo verifiqué» a una afirmación segura y equivocada, y este archivo tiene historial de lo segundo.

## Comandos, y las trampas de cada uno

| | |
|---|---|
| Dev local | `npm run dev` |
| Build | `npm run build` |
| Lint | `npm run lint` (= `eslint .`) |
| **Tipos del front** | **`npm run typecheck`** (= `tsc --noEmit -p tsconfig.app.json`) |

**`npx tsc --noEmit` NO comprueba nada en este repo.** El `tsconfig.json` de la raíz es de tipo *solution* (`"files": []`, solo `references`), así que sale con 0 y cero salida siempre. Se descubrió el 11-sep-2026 inyectando un error de tipos a propósito y viendo que no lo cazaba — después de varias sesiones dando por bueno «typecheck limpio». **Usa siempre `npm run typecheck`.**

**`npm install` no resuelve el árbol en el contenedor remoto:** `xlsx` se baja del CDN de SheetJS, que está bloqueado (403). Consecuencias prácticas: (a) faltan tipos de `xlsx`, así que `npm run typecheck` da 4 errores fantasma `Cannot find module 'xlsx'` **que también salen en main** — compáralos siempre contra main antes de atribuírtelos; (b) `vite build` falla por lo mismo, igual que en main; (c) para tocar el lock usa `npm install --package-lock-only`, que lo reescribe sin descargar.

**Checks requeridos de main: léelos de la API, nunca de este archivo.** Esta lista ya se quedó vieja el mismo día en que se escribió, dos veces. Hoy son ocho y `enforce_admins: true`. Al hacer requerido un check nuevo, **primero mergea el PR que trae su workflow y después márcalo requerido** — al revés, todo PR abierto se queda esperando para siempre un check que nunca va a reportar.

**«Remote database is up to date» puede significar «no veo el archivo».** `supabase db push` lee `supabase/migrations/` **del disco**, no del repo remoto: si la rama que tienes sacada no trae la migración, responde que todo está al día y no miente — simplemente no la ve. Pasó el 12-sep-2026 con `20260912010000`: el `db push` salió limpio y no había aplicado nada.

Axel tiene `main` ocupada por un **worktree en `C:\trw`, donde corre los worktrees de Codex**, así que su carpeta de trabajo vive en ramas de feature y `git checkout main` ahí falla con *'main' is already used by worktree*. La salida que lo delata está en el `git pull`: si dice `Already up to date` mientras la línea de arriba muestra `abc..def main -> origin/main`, el remoto avanzó y **tu rama local no**.

Antes de dar por aplicada una migración:

```powershell
git branch --show-current                       # ¿en qué rama estás de verdad?
git checkout -B aplicar-lo-que-sea origin/main  # el nombre NO puede ser `main`, por el worktree
Test-Path supabase\migrations\<archivo>.sql     # tiene que decir True
supabase db push                                # debe listar la migración, no decir «up to date»
```

Y después, **confirma contra la base** —columna, función, y que el ledger registró la versión DEL ARCHIVO—: es el patrón 6, un verde puede ser un paso que no se ejecutó.

**Después de desplegar Edge Functions, manda un `OPTIONS` a cada una.** `Deployed Functions` del CLI no significa que arranque: `generate-signed-contract` llevaba semanas rota y el CLI la dio por buena. El preflight ejercita el arranque sin disparar lógica de negocio.

**Antes de desplegar, cruza `verify_jwt` contra la API.** El CLI pone `true` a lo que no esté declarado en `config.toml`, y `stripe-webhook` y `openpay-webhook` viven de tenerlo en `false`.

## Contexto de negocio útil
- Política de cancelación (Cláusula 16): 15+ días → 100% en ToursRed Cash; 7–14 días → 50% en ToursRed Cash; <7 días o No Show → sin reembolso; cargo por servicio (5%) no reembolsable salvo causa no imputable al viajero.
- Seguro de viaje: $79 MXN/día al viajero, costo real $59, comisión aseguradora 25%, config en `platform_settings`.
- **Lanzamiento objetivo: 23 de noviembre de 2026.** Antes quedan las UAT y el DRP.
- **PCI: el SAQ es A**, determinado el 10-sep-2026 — los cinco procesadores usan checkout alojado, ningún dato de tarjeta pasa por el sitio. Los 5 AOC están y la documentación también. **SAQ A NO libra de los escaneos ASV:** PCI DSS v4 añadió el Requisito 11.3.2 a esa modalidad, **cada 90 días**, con reescaneo aprobatorio; no existe modalidad semestral. El ASV va en la lista de actividades PREVIAS a producción, no ahora. **Las pruebas de intrusión (11.4) sí están exentas en SAQ A**, así que el pentest interno es buena práctica y no cumplimiento — no lo presentes como si cerrara 11.4, el QSA lo va a notar.

## Lo que está abierto hoy (09-oct-2026)

Actualizado tras confirmar dos pendientes del 06-oct y encontrar uno nuevo
cruzando contra la base (no releyendo código): la deuda de `react-hooks/*`
que el 06-oct dominaba la lista **ya se cerró** en algún punto de los días
siguientes (no se investigó en qué PR exacto; falta una entrada de bitácora
para ese tramo del 04 al 09-oct), y el sistema de SMS de confirmación de
reserva + recordatorio de un día antes —que parecía "lo siguiente a
construir"— **ya estaba construido y con su cron activo en producción**
desde la migración `20261008061340`, solo que bloqueado por un hueco de
datos. Lo de antes de hoy que sigue sin tocar: DRP, `audit_errors`,
`snapshot_booking_tax`, centralizar el desglose.

- **DRP del escenario compuesto.** Sigue sin escribirse el plan para un admin que pierde **correo y TOTP a la vez** — hoy la única puerta es el Dashboard de Supabase, fuera de la app, y hay un solo super_admin. (La entrada 44 cerró el autoservicio de códigos de recuperación, que cubre el caso común de dispositivo perdido con sesión viva; este caso compuesto es distinto y no se ha tocado.)
- **Borrar `src/components/BookingForm.tsx` — EN PAUSA por decisión de Axel, no solo pendiente de confirmación.** La comparación función por función del 06-oct (fork dedicado, lectura completa de los 6 archivos del flujo nuevo contra las 3366 líneas del viejo) encontró 2 reglas de negocio reales que faltaban en el flujo de 4 pasos — y que YA se cerraron, en `create_booking_atomic` y en `BookingFlowStep3`/`BookingFlowStep4` (PR #354, migración `20261006202917`, aplicada y verificada contra la base):
  1. Alto riesgo (>3 no-shows) no forzaba el 100% de pago — pagaba el depósito normal o el mínimo del plan de pagos.
  2. Puntos ToursRed con membresía vencida se podían gastar igual — nadie leía `is_active` del wallet.
  Lo único que sigue sin portar (bajo riesgo hoy: 0 tours activos lo usan, pero `AgencyTours.tsx` ya ofrece la opción a las agencias) es dejar elegir entre pago total y plan de pagos cuando `tours.payment_option = 'both'` — `flow.paymentMode` existe en el tipo pero ningún Step lo lee ni lo escribe. **Axel decidió esperar a terminar las UAT antes de borrar el archivo**, precisamente porque la comparación anterior ya falló una vez (se habían rescatado descuentos y preventas de ahí antes de esa ronda). Sigue el bug documentado del tope de puntos (`maxPointsAllowed`) dentro del archivo muerto — inofensivo mientras nadie lo use.
- **`audit_errors` ya se revisó (03-oct-2026, entrada 47).** De 40 filas, dos patrones ya estaban cerrados y uno se autocuró por un cron existente. Queda un residuo real sin acción por decisión de Axel: 3 CFDI `stamped` con `email_sent=false` (reservas de prueba suyas) — nada hoy reintenta ese caso, así que si se repite con dinero real hace falta un camino de reenvío.
- **`snapshot_booking_tax` se sigue tragando sus errores.** El `EXCEPTION WHEN OTHERS` pone los seis campos fiscales en NULL y deja pasar la reserva; el CFDI sale gravado al 16% sin que nada falle. Deja rastro en `audit_errors` y el cron `check_missing_tax_snapshots` avisa después. **No se toca a propósito:** hacerlo fallar duro bloquearía reservas ante cualquier error transitorio, y eso es decisión de negocio.
- **Centralizar el desglose de costos de reserva** (~4–6 días). Hoy duplicado en ~4 lugares.
- **SMS de confirmación de reserva + recordatorio un día antes: YA ESTÁN en producción, no son trabajo pendiente.** Migración `20261008061340` (commit `a6682b4`), cron activo (`sms-outbox`, `sms-scheduler`, `sms-health`, `sms-retention`, verificados `active=true` en `cron.job` el 09-oct-2026). Un trigger encola el SMS de confirmación solo; `queue_booking_sms_batch()` corre cada 15 min para el recordatorio. **Prueba manual de Axel (noche del 08-oct) confirmada contra la base:** OTP por SMS 3/3 entregado; OTP por WhatsApp verificó bien de punta a punta, pero el estado de entrega que reporta Twilio para WhatsApp quedó `resultado_desconocido` sin resolver — no bloquea el login, sí la métrica de salud de ese canal, sin investigar todavía.
  **Hueco real que SÍ bloqueaba el recordatorio para cualquier tour (no solo los de prueba), cerrado el 09-oct-2026 con migración `20261009163001`:** las 7 `destinations` tenían `time_zone` en NULL — `booking_sms_snapshot()` no puede calcular `departure_at` sin zona horaria, para ningún tour, sea de fecha fija (excursión) o con slots (receptivo); la lógica que distingue ambos tipos ya era correcta, el bloqueo era puramente de datos. Backfill a `America/Mexico_City` o `America/Mazatlan` según el municipio real de cada destino, más `NOT NULL`+`DEFAULT` para que un destino nuevo fuera del formulario de `AdminDestinations` no vuelva a quedar sin zona.
  **WhatsApp para confirmación/recordatorio NO existe — sigue limitado a OTP por diseño** (`_shared/mensajeria/enrutador.ts` línea 16). Extenderlo es trabajo nuevo: el enrutador, más un `whatsapp_proveedor_*` para esas categorías en `platform_settings` (hoy solo existe `whatsapp_proveedor_otp`).
- **Deuda de eslint: CERRADA fuera del archivo muerto.** Medido el 09-oct-2026 con `npm run lint` real (no el baseline del CI, que sigue citando 336 de PR #354): **38 problemas totales, y los 38 están en `BookingForm.tsx`** (30 `no-explicit-any` + 8 `react-hooks/*`) — cero en el resto de `src/`. El bloque de `react-hooks/*` que dominaba la lista el 06-oct (298 problemas) se cerró en algún punto antes del 09-oct; no se identificó el PR exacto. **Pendiente real, no de código:** el baseline de `lint.yml` (`BASELINE_TOTAL=336`) tiene ~298 problemas de holgura sin ratchear — no bloquea hoy pero esconde una regresión de ese tamaño si volviera a aparecer.
- **Tipos del front: CERO, y la guardia exige cero.** `scripts/front-check/baseline.txt` sigue vacío, así que cualquier error de tipos nuevo en `src/` bloquea. Cerrado desde el 11-sep (entrada 22); se deja aquí solo para que no se asuma como pendiente.

### Decidido, no pendiente (no lo resucites)

Axel cerró estos puntos el 11-sep-2026. Si aparecen en un documento viejo como «pendientes», el documento está desactualizado:

- **La llave: NO se cierra. Todos conservan acceso al Dashboard. DECISIÓN de Axel, 12-sep-2026.** Con acceso están los cinco agentes (Claude Code, Claude, ChatGPT, Codex y **Bolt**) y Axel. El remedio que estaba anotado —«restringir quién puede correr SQL en el Dashboard»— se escribió imaginando un equipo de personas a quienes quitar acceso; hay **una** persona, así que restringir *es* quitárselo a los agentes, y Axel prefiere que todos lo tengan. **El proceso acordado cuando el ledger se desfase:** bajar el SQL de la base y reconciliar el repo — `node scripts/generar-consulta-huerfanas.mjs`, correr `scripts/export-orphan-migrations.sql` en el Dashboard, descargar el JSON y `node scripts/import-orphan-migrations.mjs <archivo>`. **Ojo:** lo que produce es una exportación funcional de `statements[]`, no el texto original — los comentarios sueltos se pierden y el formato queda normalizado. Sirve para reproducir el esquema, no como registro literal. Y el import **sobrescribe**: revisar `git status` después.
- **El diagnóstico de «la llave» estaba viejo, y conviene no repetirlo.** Medido el 12-sep-2026 sobre el ledger completo: **912 pares local == remoto, 0 desalineados, 0 archivos sin aplicar**. El mecanismo original —la base asignando su propia versión— **ya no ocurre**. Lo que ocurre hoy es otra cosa: el cambio llega a producción **antes** de que el PR se mergee (siete veces solo el 11-sep), se auto-cura al mergear, y mientras tanto pone `guardia-desfase` en rojo en PRs que no tienen nada que ver. Si esa guardia te bloquea un PR, **mira primero si es tu rama la que está desactualizada** antes de dar por hecho que hay una huérfana.
- **Webhook de producción de Stripe.** La cuenta livemode `acct_1Roc3UEakEqayEr8` no tiene ningún endpoint; hoy todo corre sobre la de prueba. **Se crea después de las UAT**, no ahora. Lo que sí queda anotado: es bloqueante antes de cobrar dinero real.
- **Comisiones de PayPal sin conciliar** y **los ~30 cobros históricos con `net_amount = amount`**: son datos de prueba que se depuran antes de las UAT. No se invierte tiempo en limpiarlos.
- **Las reservas de Teotihuacán con IVA al 16%** y los $2,028.28 de diferencia: pruebas de Axel. No hay nada que reemitir ni que preguntarle al contador.
- **`xlsx` desalineado** entre front (0.20.3, CDN) y Edge Functions (0.18.5, npm): SheetJS dejó de publicar en npm en 2022, alinearlos exigiría cambiar de origen y no compensa. Está excluido explícitamente de la regla 3 de `check-edge-deps.mjs`. **Lo único que lo reabre:** el día que alguien acepte un `.xlsx` subido por un usuario, los dos avisos *high* pasan de deuda a urgente — hoy nadie llama a `XLSX.read`, solo se generan hojas.

## Patrones que ya mordieron (leer antes de afirmar nada)

1. **Un número que cuadra puede ser falso.** Cinco veces ya: la membresía marcada como pasivo, el tipo de cambio de relleno en gastos recurrentes, el SPEI que nunca se pagó, la comisión que llegaba después del asiento, y el `pagado_en` que separaba la vista del libro. El invariante `caja = pasivo + ingreso` **es ciego a la clasificación y al tiempo**: una fila puede cuadrar al centavo y estar en la cuenta equivocada o en el mes equivocado. Ninguna suma va a encontrar esos errores — hay que afirmar la clasificación concepto por concepto.
2. **Los hallazgos salen de cruzar contra algo EXTERNO, no de leer código.** Todos los defectos de esta semana salieron de la API de Stripe, del XML del CFDI, del ledger contra los pagos, de los clics de Axel o de los logs del servidor. Ninguno de releer el repo. Un reporte que cuadra consigo mismo no es un reporte verificado.
3. **La línea base de una guardia no es un diagnóstico.** Contar coincidencias de un patrón y llamarlas bugs convirtió 3 huecos reales en «17 caminos rotos». Es la peor forma de tener una guardia, porque enseña a leerla como ruido. Sigue cada camino hasta el final antes de escribir un número.
4. **Una prueba que no se ve fallar no prueba nada.** Muta el código y comprueba que la prueba cae. Y **comprueba que la mutación se aplicó**: dos veces una mutación «sobrevivió» porque el `perl` no había cambiado nada (0 coincidencias).
5. **Una fixture más pobre que producción esconde el bug.** `scripts/fixture-movimientos.sql` construía las tablas sin sus triggers, así que las pruebas pasaban mientras el código violaba una regla de inmutabilidad documentada horas antes. Prueba contra la cadena completa de migraciones, no contra un esquema inventado.
6. **Comprueba que el chequeo de verdad corrió.** `npx tsc --noEmit` no comprueba nada. `Deployed Functions` no significa que arranque. Un `git checkout` dentro de un comando compuesto puede no surtir efecto. Un paso verde puede ser un paso que no se ejecutó.
7. **Una aserción numérica sin `coalesce` o sin un `IS NULL` explícito no afirma nada.** `sum()` sobre cero filas da NULL, y `NULL <> x` es NULL, así que el `IF` no dispara.
8. **Arreglar la mitad de un camino asíncrono puede romper la otra mitad**, y eso solo se ve mirando a qué eventos está suscrito el webhook de verdad. Verificar DESPUÉS de mergear no es paranoia.
9. **Antes de diseñar un arreglo, busca si el repo ya resolvió el mismo problema en otro lado.** Con Turnstile lo había resuelto en tres páginas y el plan original iba a inventar un mecanismo nuevo.
10. **Este archivo se ha equivocado.** Afirmó que `lint` y `smoke` no bloqueaban (sí bloquean), que el bug de disputas seguía abierto una semana después de cerrarlo, y que `snapshot_booking_tax` nunca había disparado (ya había disparado). **Verifica antes de citarlo, y corrígelo cuando lo desmientas.**

## Dónde está el resto

- **`docs/bitacora-tecnica.md`** — las 18 entradas cerradas, completas, con cómo se encontró cada defecto. Salieron de aquí el 11-sep-2026: este archivo había llegado a 70 KB y las reglas quedaban enterradas bajo el historial. Las cifras de ahí son las del día en que se escribió cada una.
- **Los documentos anteriores al 11-sep-2026 citan `claude.md`** (las tres auditorías y `PENDIENTES_25_AGO.md`, 14 referencias). Ese archivo era este más la bitácora; se dividió ese día. No se reescribieron porque son registros fechados y editarlos sería revisar la historia.
- **`docs/pci/`** — inventario de componentes de terceros, escaneos y pruebas de intrusión.
- **`docs/auditorias/`** — las tres auditorías del 05-sep-2026 (frontend, Edge Functions, funciones de Postgres).
