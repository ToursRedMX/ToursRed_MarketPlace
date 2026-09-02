# ToursRed — Reglas del proyecto para Claude Code

## Qué es esto
ToursRed es una plataforma donde agencias de viaje comercializan sus propios tours (marketplace estilo Civitatis). Axel es fundador/dueño, no organiza los tours directamente.

## Stack
- **Backend/DB:** Supabase, multi-schema (`public`, `corporate`; a futuro schemas por marca)
- **Pagos:** Stripe (procesador principal, migración "Dahlia" completada), PayPal, MercadoPago
- **Contabilidad:** mini-ERP interno (`chart_of_accounts`, `accounting_entries`, etc.) — Zoho Books y Odoo están DEPRECADOS, no usar ni referenciar como sistema activo
- **Hosting front:** Netlify (staging: toursredmx.netlify.app)
- **Ambientes:** dev / staging / producción, migración gradual, metodología ágil tipo Scrum

## Reglas duras — no negociables

1. **Nunca apliques migraciones de base de datos directamente en Supabase sin autorización explícita de Axel en el momento.** Los cambios de esquema deben pasar por el repo (commit) para quedar en el historial. Leer y diagnosticar la BD libremente sí está permitido en cualquier momento.
2. **No hagas push a producción/main sin que Axel lo revise y apruebe explícitamente.** Trabaja en ramas o espera confirmación antes de mergear/pushear cambios sensibles.
3. **No toques integraciones con Zoho Books u Odoo** como si fueran el sistema contable activo — están deprecadas.
4. Antes de dar por "terminada" una tarea, corre `git diff` y muéstrale a Axel qué cambió.

## Estilo de trabajo
- Explica en español los cambios que propones antes de aplicarlos si son de impacto medio/alto (lógica de pagos, cancelaciones, wallet/puntos, esquema de BD).
- Para cambios pequeños de UI/CSS/copys, puedes proceder y luego resumir qué tocaste.
- Sigue el patrón de desglose de costos existente (hoy duplicado en ~4 lugares) hasta que se centralice — no inventes un quinto lugar nuevo sin avisar.

## Contexto de negocio útil
- Política de cancelación (Cláusula 16): 15+ días → 100% en ToursRed Cash; 7–14 días → 50% en ToursRed Cash; <7 días o No Show → sin reembolso; cargo por servicio (5%) no reembolsable salvo causa no imputable al viajero.
- Seguro de viaje: $79 MXN/día al viajero, costo real $59, comisión aseguradora 25%, config en `platform_settings`.
- Lanzamiento objetivo: 21 de septiembre de 2026.

## Backlog técnico conocido (no asumas que ya está resuelto)
- Centralizar lógica de desglose de costos de reserva (~4–6 días de trabajo)
- Handlers en `stripe-webhook` para disputas (`charge.dispute.*`) y payouts (`payout.paid/failed`)
- Bug conocido en `BookingForm.tsx`: el mensaje de ToursRed Points no incluye opcionales ni seguro en el cálculo mostrado al usuario
- **La validación del RFC de agencia contra el SAT es condicional, y en un camino falla abierta.** Estado confirmado el 01-sep-2026, no es pregunta abierta. `validate-agency-rfc` **sí** crea un customer en FacturAPI en el momento del alta (`POST /v2/customers`), que es lo que valida el RFC contra el registro del SAT; el alta **sí** se detiene con el mensaje del SAT a la vista de quien registra (`AgencySignupPage.tsx:88-100`). Los dos huecos: (1) toda la validación cuelga de `if (rfc && razonSocial && formData.regimenFiscal)` (`AgencySignupPage.tsx:66`) y **`regimenFiscal` no está en la lista de campos obligatorios** (`:55-63`), así que dejarlo vacío salta la validación completa y guarda la agencia con RFC sin verificar; (2) en el camino de edición (`AgencyProfile.tsx:250`) la comprobación va dentro de `if (validateRes.ok)`, así que si la Edge Function falla o no responde, **se guarda igual sin validar** — el alta sí lanza excepción en ese caso, la edición no. Red secundaria: `generate-booking-cfdi` devuelve 422 con mensaje claro si a la agencia le falta régimen o CP, así que el caso (1) se detecta al primer CFDI y no queda críptico. Hoy las 5 agencias reales tienen RFC, régimen y CP completos: exposición actual cero. **Ojo con la lista:** el customer valida contra el registro de RFC del SAT, mientras que `RfcACuentaTerceros` se valida contra `l_LCO`, que es otra lista — no está verificado que pasar la primera garantice la segunda. Un RFC de agencia real sí pasó ambas en sandbox (01-sep-2026); uno inventado falló solo en `l_LCO`.
- **`snapshot_booking_tax` cuelga de un solo hilo.** El trigger sale temprano con `IF NEW.paid_at IS NULL AND COALESCE(NEW.payment_status,'') <> 'paid'`, pero **`payment_status` nunca vale `'paid'`**: los valores reales son `succeeded` / `processing` / `canceled` (verificado el 01-sep-2026 sobre las 35 reservas de la base). Esa mitad de la condición es código muerto, así que el snapshot fiscal depende **enteramente de que `paid_at` quede escrito**. Hoy funciona —las 32 reservas cobradas lo tienen— pero si un procesador nuevo o un camino de cobro olvida `paid_at`, el CFDI sale gravado al 16% sin que nada falle: misma categoría de riesgo que los cron jobs silenciosos. La red que queda es el cron `check_missing_tax_snapshots`, que avisa *después* del cobro, no antes de facturar. Al arreglarlo, alinear el literal con el enum real en vez de agregar `'succeeded'` a mano.
- **Ninguna Edge Function pasa por `tsc` en CI.** `npm run typecheck` corre `tsc -p tsconfig.app.json`, y ese tsconfig tiene `"include": ["src"]`: las ~175 funciones de `supabase/functions/` no las type-checkea nada, ni en local ni en CI. Detectado el 01-sep-2026 a raíz del bug de `generate-booking-cfdi`, donde un `booking as {...}` escondía que el `.select()` no pedía `tax_treatment`: el código leía una columna que la consulta nunca traía y ni tsc ni runtime decían nada. `scripts/test-fiscal-selects.mjs` (bloqueante en `fiscal-guard.yml`) tapa ese hueco **concreto**, pero solo ése — cualquier otro error de tipos en cualquier Edge Function sigue sin red. Cerrarlo pide un `deno check` sobre `supabase/functions/` en CI, con su propia línea base, porque el runtime es Deno y no comparte tsconfig con el front.

## Comandos del proyecto
- Instalar: `npm install` (o el que uses)
- Dev local: `npm run dev`
- Build: `npm run build`
- Lint: `npm run lint`