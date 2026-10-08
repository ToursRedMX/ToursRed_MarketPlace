# Entrega local SMS/OTP — 8 octubre 2026

Implementación en PRs draft encadenados. Nada aplicado remotamente, desplegado manualmente, activado ni mergeado. Sin SMS reales. La rama paralela de Claude no fue modificada.

| Fase | PR | Migración |
|---|---|---|
| 1: datos/configuración | [359](https://github.com/ToursRedMX/ToursRed_MarketPlace/pull/359) | `20261008045859_sms_otp_foundation.sql` |
| 2: motor/proveedores | [360](https://github.com/ToursRedMX/ToursRed_MarketPlace/pull/360) | `20261008052810_sms_delivery_engine.sql` |
| 3: OTP/permisos/UI | [361](https://github.com/ToursRedMX/ToursRed_MarketPlace/pull/361) | `20261008054539_phone_otp_enforcement.sql` |
| 4: reservas/métricas | Rama `codex/sms-otp-fase-4` | `20261008061340_sms_booking_notifications.sql` |

Cada fase tiene alcance, dependencias, pruebas, riesgos y rollback en [plan técnico](plan-sms-otp-modular.md) y en `sms-fase-N-validacion.md`. Deben revisarse secuencialmente; no activar obligatoriedad hasta validar la integración de las cuatro fases.

## Matriz de aceptación frente al requerimiento

| Casos originales | Evidencia local | Falta antes de activación |
|---|---|---|
| 1–7 y 11: roles, voluntario, contexto múltiple | Política SQL y guard Deno/UI; privilegios administrativos, OTP sin depender del rol, RLS por reserva | Recorrido con cada cuenta y permisos reales de colaboradores |
| 8–10: correo/OAuth/agencias | Guard común después de autenticación; registro de agencia conserva aprobación; LinkedIn incluido | Login real con cada proveedor y navegación completa |
| 12–21: switches/SMS/simulación/reactivación | SQL de settings, MFA, guard de UPDATE, carreras de versión, conservación de pruebas | Propagación entre pestañas en staging |
| 22–29 y 31–32: OTP, recuperación, abuso | SQL con triggers originales, HMAC, hashes, cooldown, intentos acumulados, duplicados y concurrencia; cambio exige reautenticación | IP real del gateway y recuperación interactiva |
| 30: país no soportado | Metadatos libphonenumber, prueba de rechazo sin bypass | Cobertura real y atención de soporte |
| 33–44: proveedores/entrega/fallback | Transporte mock del contrato LabsMobile, test, errores, timeout desconocido, callbacks repetidos/desordenados, cuotas y respaldo | LabsMobile test/real autorizado; segundo proveedor real pertenece a Fase 5 |
| 45–52: notificaciones | 21 pruebas SQL y plantillas GSM/Unicode; fallo inyectado de cola; finanzas sin cambios; DST y reprogramación | Entrega real y datos de zonas/horarios del catálogo |
| 53–58: cohortes | Eliminados por decisión del usuario | No se implementan |
| 59–62: rollback/existentes | Global apagado/encendido, todos los contextos, conservación y vuelta atrás sin borrar datos | Ejercicio administrativo en staging |

Resultado: **82 pruebas SQL, 23 Deno, 7 UI y 62 scripts de regresión existentes pasan localmente**. Typecheck, guardias y build pasan. Lint global conserva deuda heredada; no se ocultó con una nueva baseline. No se presentan simulaciones como prueba de posesión o entrega real.

Las Edge nuevas son `request-phone-otp`, `verify-phone-otp`, `process-notification-outbox`, `sms-webhook-labsmobile`, `queue-booking-reminders`, `monitor-sms-health`. Datos operativos privados viven en `messaging_private`; credenciales exclusivamente en secretos. El SMS de reservas sale de un evento de negocio idempotente, no del éxito del correo ni de cada webhook de pago.

La entrega está preparada para revisión de código y validación de integración. Las capacidades de producción permanecen sin certificar, las restricciones apagadas y las pruebas externas pendientes claramente separadas de los resultados locales.
