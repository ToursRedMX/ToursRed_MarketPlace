# Fase 4 — confirmaciones, recordatorios y observabilidad

Depende de Fase 3. Migración `20261008061340_sms_booking_notifications.sql`, sin aplicación remota, cron instalado ni envíos reales.

## Arquitectura implementada

- El trigger `booking_sms_event` observa reserva confirmada y pago exitoso. Encola por `reserva_confirmada:{booking_id}` sin leer ni reclamar el candado del correo. Un fallo de cola se aísla en una subtransacción y deja alerta; no revierte pago/reserva. El reconciliador recupera confirmaciones recientes posteriores a la activación SMS.
- La agenda de recordatorios sigue `bookings.slot_id → tour_slots → tour_schedules → departure_points` y `tours → tour_destinations → destinations.time_zone`. Sin slot usa fecha seleccionada/inicio de tour y hora seleccionada o único punto de salida. Varias zonas, hora desconocida o hotel no definido no se inventan. Los recordatorios requieren zona/hora válidas. La zona NULL observada en datos actuales necesita configuración administrativa antes de que esos tours reciban recordatorios.
- Ventana central: día anterior a las 18:00 locales configurables, recuperación máxima de dos horas, límite de 21:00. El cron propuesto cada 15 minutos también cubre zonas con medias horas. Idempotencia incluye salida UTC; reprogramar invalida el mensaje anterior. Snapshot y reserva del intento vuelven a verificar estado, cancelación, salida, teléfono y preferencia antes de transporte.
- El procesador reclama cinco mensajes por lote con lease. No recupera automáticamente un trabajo ambiguo ni usa otro proveedor ante timeout. El callback es la reconciliación disponible para LabsMobile; no existe aquí una API inventada de consulta de entrega.
- La normalización internacional determina el país antes de cada transporte. `ZZ` en cola significa país todavía no determinado, nunca autorización de envío.
- Métricas privadas requieren permiso de configuración y MFA vigente cuando corresponde. Muestran mensajes, intentos/estados, simulación, OTP, país, categoría, respaldo, reintentos, cuota diaria/mensual y saldo en créditos. Precio desconocido permanece NULL. No escribe tablas de finanzas ni GMV.
- Preferencias de confirmación/recordatorio SMS por usuario; nunca marketing. Apagarlas no permite eludir OTP obligatorio.
- Se completa el contexto de RLS de reservas: propietario viajero versus operador de agencia. Un colaborador con rol técnico traveler usa la política agencia al operar reservas ajenas. Las políticas previas de propiedad/permisos siguen decidiendo si tiene acceso; no se concede un acceso nuevo a colaboradores.

## Archivos y contratos

Nuevos: `queue-booking-reminders`, `monitor-sms-health`, `SmsMetricsSection`, `SmsPreferences`, pruebas SQL de reservas y UI del guard. Se extienden procesador, servicio común, plantillas y pantallas de configuración/verificación. `verify_jwt=false` explícito, con service-role obligatorio para tareas; OPTIONS no ejecuta negocio.

Tablas nuevas: `messaging_private.notification_alerts`, `provider_health`, ambas RLS sin políticas para navegador. Extensiones a outbox (snapshot de salida), intentos (categoría/país), capabilities (inicio de activación). Intentos OTP sobreviven a la purga del hash sin conservar referencia al desafío. No se modifica un monto ni regla de pagos.

RPC de servicio: `queue_booking_sms`, `queue_booking_sms_batch`, `prepare_sms_notification`, `record_sms_country`, `record_sms_health`, `certify_sms_runtime`, `configure_sms_jobs`. De usuario: `get_my_sms_preferences`, `set_my_sms_preferences`. Administrativa: `get_sms_metrics`. Las RPC de servicio niegan EXECUTE a anon/authenticated. `phone_booking_operation_allowed` solo devuelve la política de contexto, no datos de reserva ni autorización de propiedad.

## Validación local

Las cuatro migraciones se aplicaron a una copia de esquema real, con sus triggers, dentro de PostgreSQL Docker sin red. 32 pruebas de fundamento + 10 del motor + 19 de OTP + 21 de reservas = **82 pruebas SQL**. Otros **23 casos Deno y 7 de UI**; los **62 scripts** del workflow existente pasaron. El SQL de health se corrigió tras detectar una referencia ambigua mediante ejecución real y se volvió a probar.

Los casos de reservas comprueban confirmación independiente del correo, pago repetido, concurrencia, snapshot, cancelación, reprogramación, opt-out, cambio de número, datos incompletos, expiración, DST, medias horas, silencio nocturno, métricas privadas, RLS por contexto, límites de ejecución y retención. La comparación antes/después incluye bookings, comisiones, transacciones, payouts, CFDI, asientos, balances y wallets.

Se inyectó una excepción real en la función de cola: el pago/reserva conservó estado exitoso, apareció alerta y el reconciliador encoló luego el mensaje. Se restauró la función en `finally`. Se mantienen además las pruebas de mutación de fases anteriores.

Typecheck frontend, Deno del árbol Edge, guardias de autorización/dependencias y build: pasan. Lint completo conserva deuda previa; dos marcas BOM desplazadas por imports se corrigieron. Componentes/funciones nuevos pasan lint dirigido. La consulta generada de migraciones debe actualizarse en cada PR (`generar-consulta-huerfanas.mjs`); no equivale a ejecutar esa consulta remotamente.

## Preparación y rollback, todavía no ejecutados

1. Revisar/mergear los PR en orden únicamente con autorización; aplicar migraciones desde archivos presentes y verificar ledger.
2. Configurar secretos de LabsMobile, `PHONE_OTP_PEPPER` y `SMS_WEBHOOK_SECRET` aleatorios de al menos 32 caracteres. No copiarlos a settings/logs. LabsMobile se habilita técnicamente después de una consulta autenticada de saldo; mock solo simula. Twilio sigue no disponible.
3. Desplegar las seis funciones nuevas y las funciones existentes afectadas, y frontend. Validar OPTIONS y matriz de cuentas. Nunca desplegar el guard compartido sin su migración.
4. Tras validar staging, establecer certificaciones de despliegue `SMS_PROCESSOR_CERTIFIED=true` y, solo después de la matriz de autorización, `PHONE_OTP_ENFORCEMENT_CERTIFIED=true`. Los envíos reales requieren además `SMS_ALLOW_REAL_SENDS=true`; no se ha configurado ninguno de estos secretos en esta entrega.
5. Invocar `configure_sms_jobs(base_url,true)` solo tras despliegue autorizado. Usa pg_cron/pg_net/vault existentes: procesador cada minuto, programación cada 15 minutos, health cada hora y purga diaria. No instala infraestructura nueva ni almacena credenciales en tablas administrativas. La migración no invoca esta función.
6. El usuario decide los interruptores del panel. No hay cohortes ni porcentajes; al activar, se aplica a todos los usuarios de los contextos requeridos. La certificación técnica no activa el interruptor global.

Rollback: apagar global desde panel mantiene verificaciones. Apagar global y SMS en la misma actualización detiene nuevas reclamaciones. Desinstalar programación con `configure_sms_jobs(base_url,false)` cuando se autorice. Conservar tablas e idempotencia; no reencolar desconocidos. Una petición ya aceptada por proveedor no puede retirarse mediante un interruptor local.

Pendientes reales: credenciales/cobertura/entrega LabsMobile y callback en staging; validar IP confiable que proporciona el gateway; navegación/OAuth y colaboradores con cuentas reales; completar zonas IANA; política de privacidad de comunicaciones; recuperación simultánea de correo y MFA sigue el DRP existente. Smoke de GitHub puede esperar una preview de Netlify inexistente: no se despliega para sortear ese bloqueo. No se certifica producción ni se presenta Twilio/WhatsApp como integrados.
