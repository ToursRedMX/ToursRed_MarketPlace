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

## Comandos del proyecto
- Instalar: `npm install` (o el que uses)
- Dev local: `npm run dev`
- Build: `npm run build`
- Lint: `npm run lint`