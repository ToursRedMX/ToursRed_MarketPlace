# Entrega local SMS/OTP — 8 octubre 2026

## Actualización: aplicación remota autorizada, 8 octubre 2026

Axel autorizó aplicar las cuatro migraciones y mergear los PRs. Las versiones `20261008045859`, `20261008052810`, `20261008054539` y `20261008061340` ya se aplicaron mediante CLI desde sus archivos commiteados, con dry-run previo por fase y comprobación posterior del ledger y objetos remotos. Los PRs #359, #360 y #361 están integrados; este PR #362 completa la secuencia al pasar sus checks requeridos.

Para desbloquear el CLI se recuperaron seis migraciones ya existentes de RoutesRed mediante el procedimiento de reconciliación de CLAUDE.md: sus cuerpos coinciden en MD5 y bytes con el ledger. No se reaplicaron ni se modificó su lógica. La guardia de desfase pasó después de recuperar los archivos.

Verificación remota final: SMS apagado, simulación encendida, obligatoriedad apagada, `processor_ready=false`, `otp_enforcement_ready=false`, cero tareas cron SMS, cero mensajes en cola y cero intentos. Las tablas privadas tienen RLS y carecen de SELECT para anon/authenticated. El control telefónico permite los contextos viajero/agencia con la obligatoriedad apagada.

No se desplegaron Edge Functions, configuraron secretos, activaron tareas ni enviaron SMS. Sigue pendiente el despliegue autorizado de funciones, la configuración del proveedor y las pruebas de integración antes de activar el servicio. Twilio sigue en Fase 5. El registro de entrega local siguiente conserva la evidencia y limitaciones de la implementación anterior a esta autorización.

## Registro de la entrega local previa

Implementación en PRs draft encadenados. Nada aplicado remotamente, desplegado manualmente, activado ni mergeado. Sin SMS reales. La rama paralela de Claude no fue modificada.

| Fase | PR | Migración |
|---|---|---|
| 1: datos/configuración | [359](https://github.com/ToursRedMX/ToursRed_MarketPlace/pull/359) | `20261008045859_sms_otp_foundation.sql` |
| 2: motor/proveedores | [360](https://github.com/ToursRedMX/ToursRed_MarketPlace/pull/360) | `20261008052810_sms_delivery_engine.sql` |
| 3: OTP/permisos/UI | [361](https://github.com/ToursRedMX/ToursRed_MarketPlace/pull/361) | `20261008054539_phone_otp_enforcement.sql` |
| 4: reservas/métricas | [362](https://github.com/ToursRedMX/ToursRed_MarketPlace/pull/362) | `20261008061340_sms_booking_notifications.sql` |

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

El lint global final midió **131 errores y 44 avisos**, igual que el corte local previo de esta tarea. Los checks CI de lint/typecheck/fiscal/search_path pasan. La guardia remota de desfase de #359 detecta seis versiones aplicadas de **RoutesRed**, ausentes de este `main`: `20261008022319`, `20261008022519`, `20261008055332`, `20261008060342`, `20261008060845`, `20261008061116`. Se verificaron sus nombres en el ledger mediante SELECT; no se modificó ese trabajo ajeno. La migración SMS de Fase 1 aparece pendiente, como exige la autorización vigente. Las previews/smoke de PRs encadenados siguen dependiendo de que Netlify publique una preview; no se desactivaron checks ni se desplegó para obtener un verde.

Las Edge nuevas son `request-phone-otp`, `verify-phone-otp`, `process-notification-outbox`, `sms-webhook-labsmobile`, `queue-booking-reminders`, `monitor-sms-health`. Datos operativos privados viven en `messaging_private`; credenciales exclusivamente en secretos. El SMS de reservas sale de un evento de negocio idempotente, no del éxito del correo ni de cada webhook de pago.

La entrega está preparada para revisión de código y validación de integración. Las capacidades de producción permanecen sin certificar, las restricciones apagadas y las pruebas externas pendientes claramente separadas de los resultados locales.
