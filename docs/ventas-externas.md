# Ventas externas y Agenda operativa — PR #316

Estado: migración 20261003035425 aplicada al Supabase compartido el 03-oct-2026 con autorización de Axel. Edge send-external-sale-qr desplegada; OPTIONS 200, ledger, seis tablas con RLS y cuatro políticas verificados. No se modifica la rama ni el worktree de Claude.

## Arquitectura inspeccionada

React 19 + Vite + React Router + TanStack Query, Supabase/PostgreSQL 17 y Edge Functions Deno. Se cotejaron las migraciones con el catálogo remoto (tablas, columnas, funciones, triggers y políticas) y se exportó el esquema completo de public/corporate/auth/extensions, SIN datos de viajeros, para pruebas locales. Las migraciones históricas son la referencia del repositorio; la exportación permite ejecutar los triggers reales sin una fixture simplificada.

| Área | Modelo y rutas existentes | Decisión |
| --- | --- | --- |
| Agencias/permisos | agencies.user_id; users.is_active; agency_staff + agency_staff_permissions; AuthContext, useAgencyId, ProtectedRoute | Reutilizar agencia activa en frontend y autorización verificable en PostgreSQL. Propietario; staff por permisos. No acceso automático para administradores a datos externos. |
| Tours/salidas | tours; tour_slots; tour_schedules; tour_slot_blackouts; departure_points; tour_departure_points | Reutilizar salidas concretas. Un horario recurrente es una plantilla; la unidad operativa es tour_slots. Tours de fecha fija sin slots usan su start_date y el inventario sin slot. |
| Reservas/viajeros | bookings; booking_travelers; acompañantes del usuario | Mantener contratos actuales. Viajeros externos normalizados independientes, sin users, auth, acompañantes frecuentes ni alta de cuentas. |
| Inventario | create_booking_atomic y wrapper create_booking_atomic_with_preventa; get_tour_availability/v2; get_tour_slots_by_range; hold_seats; seat_holds; slot_seat_status; update_slot_booked_count | Un cálculo interno y un bloqueo compartido. No reutilizar booked_count para almacenar externos. |
| Pagos | payment_transactions/charges, planes de pago, cinco procesadores y sus webhooks; approve-booking; confirm-booking-wallet-payment | No se invocan desde ventas externas. El guard de bookings protege cupo incluso en escrituras desde Edge Functions. |
| Finanzas | commission_records; agency_payouts/payout_batches; financial_transactions; accounting_entries; cfdi_invoices; wallets/puntos | Ninguna relación de venta externa con una transacción financiera del marketplace. Solo importes administrativos en external_sale_financials. |
| Reportes | AgencyBookings; getTourBookingReport; reportExports; AgencyFinancials; dashboards corporativos | Añadir manifiesto operativo unificado al reporte existente y mantener el detalle financiero ToursRed separado. Exportación Excel/PDF sin importes en manifiesto. |
| Check-in | booking_checkin_tokens; generate-booking-qr-token; get-booking-checkin-details; confirm-booking-checkin; BookingCheckinPage; cobro con wallet en check-in | Reutilizar infraestructura de QR, autorización y visualización, con un token/RPC externo separado: el check-in existente incluye rutas de cobro que nunca deben aplicarse a externos. |
| Comunicaciones | email_settings + SMTP2GO; send-booking-confirmation y send-checkin-confirmation-email; notifications/user_notifications; newsletters | Reutilizar proveedor y configuración. Plantilla operativa con marca de agencia, sin montos, promociones, suscripción ni alta automática. |

Los triggers existentes de bookings crean comisiones, movimientos financieros, snapshots fiscales, puntos, bonos y avisos. Por esa razón NO se agregó un origen a bookings ni se insertan reservas externas en esa tabla.

## Migración y tablas

`supabase/migrations/20261003035425_external_sales_unified_operations.sql`, creada con Supabase CLI.

Nuevas tablas:

- `public.external_sales`: identidad, tour/salida, contacto, cantidad, origen, consentimiento operativo, versión, cancelación y metadatos QR.
- `public.external_sale_travelers`: una fila por viajero, categoría, principal, cancelación lógica, fecha y actor de check-in.
- `public.external_sale_financials`: total, pagado, pendiente generado como total menos pagado, moneda y método de pago.
- `public.external_sale_events`: actor, acción y nombres de campos modificados; sin copias de PII, importes o tokens.
- `toursred_ops.inventory_locks`: una fila de serialización por tour.
- `toursred_ops.external_qr_tokens`: hash SHA-256 y vencimiento. Esquema no expuesto por Data API.

No se borran tablas, columnas ni datos. Se añaden triggers de control a bookings, seat_holds, slot_seat_status, tours y tour_slots. No se altera la comisión estándar ni se crean cargos o paywalls.

RLS habilitado en las seis tablas. Cuatro políticas SELECT públicas: `external_sales_agency_read`, `external_financials_agency_read`, `external_travelers_agency_read`, `external_events_agency_read`. Las tablas privadas no tienen políticas para clientes. No se conceden INSERT/UPDATE/DELETE a authenticated: toda mutación pasa por RPC con autorización explícita, transacción y auditoría.

Permisos: propietario de agencia; staff activo con can_view_bookings, can_view_reports o can_scan_checkin para operación; can_view_financials para importes; can_manage_tours + can_view_financials para altas/cambios/cancelaciones; can_scan_checkin para escanear. Se exige users.is_active. Los roles admin/super_admin no reciben una excepción de acceso a las ventas externas. Un viajero puede ser staff expresamente vinculado; ser viajero por sí solo no da acceso.

## Disponibilidad y concurrencia

`toursred_ops.inventory` es la fuente lógica:

capacidad − viajeros ToursRed que ocupan cupo − externos activos − asientos bloqueados − apartados vigentes.

Se conservan las reglas existentes de ocupación: con slot, pending/confirmed/completed; sin slot, confirmed y pending aprobado. Los pagos mínimos garantizados (paid_spots) NO se cuentan como personas físicas. La ocupación sin slot NO suma otras fechas que ya tienen su propio slot.

Los RPC públicos delegan en ese cálculo. Los selectores y TourDetailPage consumen disponibilidad calculada; la agenda presenta por separado marketplace, external, blocked, held y available. booked_count del contrato público conserva su significado ToursRed para no alterar estimaciones de precio mínimo.

Ambos orígenes adquieren la misma fila de `inventory_locks` mediante INSERT ON CONFLICT DO UPDATE dentro de la transacción. La actualización obliga a resolver conflictos también con aislamiento repetible; no es un chequeo anterior al INSERT. Los triggers de bookings y apartados cubren escrituras directas, aprobación y confirmación. En el RPC de compra se sustituye solo el bloque de disponibilidad, conservando el resto de precios, pagos, impuestos y promociones; el parche falla si no reconoce la definición.

La granularidad es por tour: salidas distintas del mismo tour se serializan brevemente. Es una elección conservadora para proteger también reservas antiguas sin slot y movimientos. Un interbloqueo se aborta sin sobreventa y la operación puede reintentarse; nunca se trata un error como confirmación.

Cambios externos de cantidad/salida se validan excluyendo su propia ocupación y se actualizan atómicamente. La versión evita sobrescribir cambios de otro operador. Cancelar conserva el registro y libera cupo. Se conserva el historial de acompañantes retirados. Los QR se invalidan al editar o cancelar. No se permite editar/cancelar una venta que ya tiene check-in. Reducir capacidad por debajo de ocupados/apartados se rechaza; cambiar fecha/cancelar una salida con externos obliga primero a resolver esas ventas.

## RPC y Edge Functions

RPC nuevos: external_sale_access, save_external_sale, cancel_external_sale, generate_external_sale_qr, checkin_external_sale, get_agency_operations, get_operational_manifest, prepare_external_sale_email, finish_external_sale_email, get_tour_inventory_summary.

RPC modificados: create_booking_atomic (solo bloque de cupo), hold_seats (lock y límite), get_tour_availability, get_tour_availability_v2, get_tour_slots_by_range. El wrapper de preventa existente continúa funcionando.

Internos: inventory, lock_inventory, guard_booking_inventory, guard_hold_inventory, guard_block_inventory, guard_capacity_change, en toursred_ops. EXECUTE público revocado y search_path explícito. Las lecturas públicas retornan solo agregados de cupo.

Edge nueva: `send-external-sale-qr`. Usa requireUser y un cliente con JWT del usuario para preparar el correo; la autorización de agencia vive en PostgreSQL. Solo después accede a la configuración SMTP con service_role. finish_external_sale_email solo admite service_role. verify_jwt=false es deliberado por el formato de claves actual: requireUser valida la identidad y el RPC aplica la autorización.

Los tokens son 32 bytes aleatorios, solo se almacena su hash y vencen al terminar el día operativo (America/Mexico_City). Identifican el grupo y se validan junto a agencia, tour y slot seleccionados. Check-in es solo el día de salida, atómico e idempotente, registrando actor en cada viajero. El token viaja en el fragmento del enlace QR para no enviarlo como parámetro al servidor web.

Correo: logo/nombre de agencia; tour, fecha, horario, viajeros, puntos de encuentro e instrucciones. QR PNG embebido mediante CID (no se envía el token a un generador externo). Footer con logo pequeño y Powered by ToursRed. No importes ni marketing. Consentimiento operativo requerido y límite de un intento por minuto/venta. Un timeout se informa como resultado incierto; no se promete envío exactamente una vez. No se enviaron correos reales durante las pruebas.

## Frontend

Nuevas páginas: AgencyExternalSales (/agency/external-sales), AgencyAgenda (/agency/agenda).

Nuevos módulos: ExternalSaleForm, tipos externalSales y servicio lib/externalSales. Reutiliza TanStack Query, useAgencyId, AuthContext, date-fns, qrcode.react, downloadExcel, jsPDF/autoTable.

Agenda mensual/semanal/lista, una tarjeta por salida, capacidad/orígenes/disponibilidad y apertura de manifiesto/check-in. Ventas externas: filtro por periodo/tour/canal/estado/cobro, indicadores privados por moneda, edición, cancelación y generar/enviar QR. Navegación en NavBar y acceso al manifiesto dentro del reporte existente de AgencyBookings. El detalle financiero existente sigue identificado como ToursRed.

## Pruebas y reproducción

`node scripts/test-external-sales-db.mjs` usa únicamente el contenedor **toursred-external-tests**, base **external_sales_test** (o **external_sales_replay_test** con EXTERNAL_SALES_TEST_DB), sin aceptar URL remota. Requiere PostgreSQL Supabase 17 con un dump **solo esquema** de public/corporate/auth/extensions y la migración del PR aplicada. Mantiene todos los triggers originales; no usa un esquema mínimo inventado ni deshabilita los triggers financieros. Inserta usuarios/agencias/tours sintéticos con IDs nuevos. No ejecutar contra una base compartida. El contenedor usado en desarrollo no tiene red saliente.

Preparación ejecutada: exportación con `supabase db dump --project-ref <ref> --schema public,corporate,auth,extensions --file <temporal>`; imagen public.ecr.aws/supabase/postgres:17.11.0.002; base vacía desde template0; extensiones pgcrypto, pg_trgm, unaccent, uuid-ossp, pg_net y supabase_vault; restauración como supabase_admin y aplicación transaccional de la migración con ON_ERROR_STOP. No se versiona el dump ni se copia información de viajeros.

27 escenarios de integración pasaron: disponibilidad 20−8−5, finanzas inalteradas al crear $10,000 y al editar importes, RLS de otras agencias/viajero/admin/staff, DML directo denegado, validaciones, manifiesto combinado, cancelación, cantidad, movimientos atómicos, versiones, pertenencia de salida, apartados, reducción de capacidad, QR correcto/ajeno/repetido/rotado/cancelado, tour sin slot, auditoría, consentimiento y límite de correo. Incluye carrera directa y carreras con **create_booking_atomic_with_preventa real**, iniciando primero cada uno de los dos orígenes.

`node scripts/test-external-sale-email.mjs`: plantilla y escape de contenido; marca de agencia, QR embebido, sin importes/marketing. No envía correo.

Resultados finales: 27/27 escenarios de base de datos, repetidos sobre una segunda restauración completa; 52 scripts JavaScript existentes/de correo pasaron (dos requirieron corregir compatibilidad CRLF del test e índice de migraciones). La prueba adicional test-external-qr-privacy verifica retirar el token de la URL antes de iniciar Sentry, conservarlo solo en memoria y rechazar formato inválido; las áreas QR quedan excluidas de replay. Ambas pruebas unitarias nuevas están en CI.

Typecheck frontend, Edge types (0 errores), guards, dependencies, comprobación de errores Supabase y build pasan. Lint completo: 1831 errores y 87 advertencias históricos; el umbral estricto de CI pasa. Comparación contra HEAD en los diez archivos de código existentes modificados: 177 errores antes y después, sin incremento de advertencias. Archivos nuevos: 0 errores y advertencias. Build conserva advertencia de chunks grandes. No se hizo validación visual ni envío SMTP real en un entorno desplegado.

## Despliegue y límites

1. Revisar el PR y los resultados; aplicar la migración **por su versión de archivo** al entorno autorizado. Revisar el ledger/dry-run antes, sin aplicar migraciones ajenas de Claude.
2. Desplegar send-external-sale-qr con config.toml y verificar OPTIONS.
3. Publicar frontend después del esquema y probar en preview con dos agencias, staff y una reserva ToursRed. Enviar un correo operativo a una dirección de prueba autorizada.
4. Migración y Edge desplegadas el 03-oct-2026. La validación visual y un correo real autorizado permanecen como comprobaciones operativas posteriores.

El módulo utiliza salidas ya definidas. Un tour recurrente sin slots o sin fecha fija necesita configurar primero sus salidas en la herramienta existente. No inventa capacidad por fecha para tours que actualmente no la tienen. No asigna un asiento numerado a la venta externa: consume cupo; los asientos físicos específicos siguen siendo la función existente. El check-in externo es por grupo. No hay reembolsos ni cobros externos automáticos. La edición tras check-in está bloqueada para preservar evidencia.

Referencias: [RLS de Supabase](https://supabase.com/docs/guides/database/postgres/row-level-security), [bloqueos de PostgreSQL](https://www.postgresql.org/docs/current/explicit-locking.html), [API SMTP2GO](https://developers.smtp2go.com/reference/send-standard-email).
