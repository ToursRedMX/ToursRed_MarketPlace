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

1. **Nunca apliques migraciones de base de datos directamente en Supabase sin autorización explícita de Axel en el momento.** Los cambios de esquema deben pasar por el repo (commit) para quedar en el historial. Leer y diagnosticar la BD libremente sí está permitido en cualquier momento. **Commitear el SQL no basta: hay que aplicarlo con la versión del archivo.** Si se aplica desde el Dashboard o por API, la base asigna su propio timestamp y el ledger queda apuntando a una versión que no existe en el repo — pasó con las dos migraciones del 02-sep-2026 pese a que ambas estaban commiteadas y revisadas en PR. Ver `scripts/check-migration-drift.mjs` y la entrada 3 de la bitácora.
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

**Después de desplegar Edge Functions, manda un `OPTIONS` a cada una.** `Deployed Functions` del CLI no significa que arranque: `generate-signed-contract` llevaba semanas rota y el CLI la dio por buena. El preflight ejercita el arranque sin disparar lógica de negocio.

**Antes de desplegar, cruza `verify_jwt` contra la API.** El CLI pone `true` a lo que no esté declarado en `config.toml`, y `stripe-webhook` y `openpay-webhook` viven de tenerlo en `false`.

## Contexto de negocio útil
- Política de cancelación (Cláusula 16): 15+ días → 100% en ToursRed Cash; 7–14 días → 50% en ToursRed Cash; <7 días o No Show → sin reembolso; cargo por servicio (5%) no reembolsable salvo causa no imputable al viajero.
- Seguro de viaje: $79 MXN/día al viajero, costo real $59, comisión aseguradora 25%, config en `platform_settings`.
- **Lanzamiento objetivo: 23 de noviembre de 2026.** Antes quedan las UAT y el DRP.
- **PCI: el SAQ es A**, determinado el 10-sep-2026 — los cinco procesadores usan checkout alojado, ningún dato de tarjeta pasa por el sitio. Los 5 AOC están y la documentación también. **SAQ A NO libra de los escaneos ASV:** PCI DSS v4 añadió el Requisito 11.3.2 a esa modalidad, **cada 90 días**, con reescaneo aprobatorio; no existe modalidad semestral. El ASV va en la lista de actividades PREVIAS a producción, no ahora. **Las pruebas de intrusión (11.4) sí están exentas en SAQ A**, así que el pentest interno es buena práctica y no cumplimiento — no lo presentes como si cerrara 11.4, el QSA lo va a notar.

## Lo que está abierto hoy (11-sep-2026)

- **La llave.** Nada impide todavía que un cambio de esquema se aplique directo en Supabase sin pasar por un commit — la causa raíz de las 151 migraciones huérfanas. Hay alarma (`migration-drift.yml`, diaria y en cada PR) pero no cerradura. Las dos salidas son técnica (event trigger + GUC, añade ceremonia a cada `db push`) u organizativa (restringir quién puede correr SQL en el Dashboard). **Bloqueado en una respuesta de Axel: cuánta gente tiene acceso al Dashboard.**
- **DRP.** Iniciado; falta pulirlo, documentarlo y probarlo.
- **Borrar `src/components/BookingForm.tsx`** (166 KB de código muerto: la reserva en una sola pantalla, anterior al flujo de 4 pasos). El PR #236 portó lo que faltaba —códigos de descuento, promociones de grupo, descuento de seguro—, así que **solo falta que Axel confirme en el preview que el flujo de 4 pasos cubre todo** antes de borrarlo. Se conserva mientras tanto por si hay algo que rescatar. **Lleva dentro un bug documentado:** el tope de ToursRed Points (`maxPointsAllowed = userPayment * 50`) se calcula sobre una base que excluye opcionales y seguro, mientras la pantalla ofrece «hasta el 50% del total». No hace daño porque es código muerto — pero si alguien rescata esa función, el bug se va con ella.
- **`audit_errors` tiene renglones sin revisar.** Nadie los ha leído nunca. Conviene hacerlo antes de las UAT: es mirar qué se registró, no escribir código.
- **`snapshot_booking_tax` se sigue tragando sus errores.** El `EXCEPTION WHEN OTHERS` pone los seis campos fiscales en NULL y deja pasar la reserva; el CFDI sale gravado al 16% sin que nada falle. Deja rastro en `audit_errors` y el cron `check_missing_tax_snapshots` avisa después. **No se toca a propósito:** hacerlo fallar duro bloquearía reservas ante cualquier error transitorio, y eso es decisión de negocio. Cero fallos registrados hasta hoy.
- **Centralizar el desglose de costos de reserva** (~4–6 días). Hoy duplicado en ~4 lugares.
- **Tipos del front: 102 errores en 78 firmas**, congelados por firma en `scripts/front-check/baseline.txt`. La mayoría son símbolos sin usar que piden juicio. Los de `BookingSuccessPage` están rojos **a propósito**: señalan que esa pantalla se escribió contra columnas que no existen, y declararlas callaría a `tsc` dejando el bug.

### Decidido, no pendiente (no lo resucites)

Axel cerró estos puntos el 11-sep-2026. Si aparecen en un documento viejo como «pendientes», el documento está desactualizado:

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
