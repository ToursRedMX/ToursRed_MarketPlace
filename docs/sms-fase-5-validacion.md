# Fase 5: Twilio para OTP y SMS transaccional

Implementación sobre `c01de4c`, conservando los cambios de OAuth y el rediseño administrativo de #363. Rama `codex/sms-otp-fase-5`. Sin aplicación remota, despliegue, cambios de secretos, activación ni envíos reales.

## Alcance

- Adaptador REST Programmable Messaging: OTP generado por ToursRed, confirmaciones y recordatorios. No utiliza Twilio Verify ni modifica Supabase Auth Phone.
- `TWILIO_MESSAGING_SERVICE_SID` tiene precedencia sobre `TWILIO_FROM_NUMBER`. El diagnóstico exige cuenta activa y número SMS propio, o un Messaging Service con un número SMS en su pool. Los remitentes exclusivamente alfanuméricos quedan fuera de esta primera validación automática.
- Callback dedicado con firma oficial `X-Twilio-Signature`. Se importa únicamente el validador del SDK fijado en `twilio@6.1.2`, compatible con Deno sin habilitar permisos de entorno/red en las pruebas. URL pública construida desde `SUPABASE_URL`, sin confiar en Host reenviado; se firman todos los campos, se rechazan duplicados y se comprueba AccountSid.
- Correlación persistida antes del envío; el callback lleva el identificador del intento en la URL firmada. La RPC vincula un único MessageSid real al intento y compara destinatario. Puede resolver el callback que llegue antes de la respuesta HTTP.
- Fallback inmediato solo ante rechazo confirmado: HTTP 401/código 20003 y HTTP 429/código 20429. Otros 4xx son permanentes; 5xx, timeout o éxito malformado son desconocidos. No se intenta el otro proveedor ante STOP/21610, restricciones geográficas, fraude, contenido o número inválido. Los fallos asíncronos no habilitan fallback.
- Sin distribución porcentual. Se conservan los selectores existentes por OTP, confirmación, recordatorio y respaldo.
- Simulación local cuando no existen credenciales de prueba. Con el par de pruebas separado se utiliza la API de test y su From mágico, sin MessagingServiceSid ni callback; nunca se sustituyen esas credenciales por las reales. El resultado sigue siendo simulado y no acredita posesión.
- Consulta por MessageSid desde el monitor existente: máximo 5 lecturas por ejecución, lease de consulta mediante SKIP LOCKED, separación mínima de 5 minutos y 24 consultas por intento durante 24 horas. También recupera el costo real si Twilio lo informa posteriormente. Sin SID no se busca por teléfono/texto ni se reenvía.
- Saldo Twilio con moneda; créditos LabsMobile separados. Los costos son informativos de mensajería y no generan asientos, comisiones, pagos, ingresos ni payouts. El umbral administrativo en créditos sigue siendo exclusivamente de LabsMobile; no se interpreta como USD ni se inventa un umbral monetario para Twilio.

## Archivos y base de datos

Migración pendiente: `20261009001257_sms_twilio_provider.sql`.

No crea tablas, no cambia usuarios/bookings/pagos y no activa proveedores ni interruptores. Amplía tablas privadas existentes:

- `notification_attempts`: fecha/contador de reconciliación, índices para consultas y unicidad del SID real Twilio.
- `provider_health`: disponibilidad, importe y unidad de saldo; conserva campos anteriores.
- `runtime_capabilities`: heartbeat del worker independiente del proveedor.

RPC nuevas, solo `service_role`: `record_twilio_status`, `claim_twilio_reconciliation`, `record_sms_provider_health`.

RPC reemplazadas conservando permisos/firmas: `refresh_sms_provider_capability`, `finish_sms_attempt`, `record_sms_health`. Se mantienen RLS y revocaciones para anon/authenticated. No se conceden permisos nuevos al navegador.

Edge nueva: `sms-webhook-twilio`, `verify_jwt=false` porque valida firma del proveedor.

Edge afectadas para el despliegue: `monitor-sms-health`, `process-notification-outbox`, `request-phone-otp` y `sms-webhook-twilio`. Las dos últimas consumidoras del servicio de envío reciben el nuevo adaptador; `verify-phone-otp` conserva su lógica.

Frontend: `SmsMetricsSection` muestra disponibilidad y moneda del saldo. El selector existente habilita Twilio únicamente cuando la capacidad haya sido validada por backend.

## Secretos

Requeridos para Twilio real: `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, y `TWILIO_MESSAGING_SERVICE_SID` o `TWILIO_FROM_NUMBER`. El Auth Token también valida callbacks. La configuración en Authentication → Phone no proporciona estas variables a nuestro motor Edge.

Opcionales para pruebas de API: `TWILIO_TEST_ACCOUNT_SID`, `TWILIO_TEST_AUTH_TOKEN`, ambos del apartado Test Credentials de Twilio y diferentes del par real. Sin ellos se puede ejecutar simulación local.

Se reutilizan `PHONE_OTP_PEPPER`, `SMS_WEBHOOK_SECRET` y los interruptores técnicos existentes. No guardar credenciales en tablas, archivos del repositorio, logs ni PRs.

## Pruebas y criterios de aceptación

- 37 pruebas Deno sin permiso de red/entorno: 23 anteriores y 14 Twilio. REST, remitente, modo test, firma, manipulación de URL/cuerpo/cuenta, rechazo/timeout, fallback, diagnóstico, saldo, consulta y costo.
- 19 pruebas SQL nuevas en Docker sin red, sobre esquema real restaurado con triggers: SID y destinatario, carrera callback/HTTP, duplicados, orden, simulación, fallback anterior, cancelación, costos, permisos, cuota de consultas concurrentes y aislamiento financiero.
- Las 82 pruebas SQL anteriores también pasan con la nueva migración.
- Mutación real del validador a `return true`: falla la prueba de firma manipulada; restaurado, toda la suite pasa.
- Typecheck de frontend, Deno check de Edge Functions, guards, dependencias, subrutas y build pasan. También pasan 7 escenarios del guard UI y los 63 scripts Node de la guardia CI de lint. El lint global reporta 34 errores y 4 avisos heredados; cero hallazgos en archivos modificados. Build conserva el aviso previo de chunks grandes.

Pruebas SQL reproducibles: `node scripts/setup-sms-test-db.mjs <ruta-absoluta-al-dump-pre-SMS>` y luego `test-sms-foundation-db.mjs`, `test-sms-engine-db.mjs`, `test-phone-otp-db.mjs`, `test-sms-bookings-db.mjs`, `test-sms-twilio-db.mjs` desde `scripts/`. El setup solo acepta el contenedor local sin red y la base desechable fija `sms_phase1_full`; no acepta URL remota. El dump conserva las extensiones y triggers reales, y se aplican las migraciones SMS y la corrección de onboarding posterior al dump.

## Validación externa y rollout pendientes

1. Aplicar la migración autorizada desde su archivo y verificar versión/objetos.
2. Configurar secretos, desplegar las cuatro funciones afectadas conservando verify_jwt y probar OPTIONS y rechazo sin firma/sesión.
3. Ejecutar monitor autenticado: validar cuenta/remitente, registrar capacidades y saldo. Una cuenta activa no garantiza permisos de envío a todos los destinos: validar cobertura y configuración geográfica en Twilio.
4. Probar simulación con obligatoriedad apagada. Para enviar mediante el worker se necesita la certificación técnica existente del procesador; no se activa por esta migración.
5. Con autorización de envío real y número elegido, probar un OTP, su callback firmado, validación única, confirmación y recordatorio. La prueba real de fallback requiere ambos proveedores configurados y un rechazo inequívoco controlado.
6. Solo después de integración satisfactoria certificar OTP y permitir activar la obligación desde administración. Sin cohortes ni excepciones para viajeros/agencias.

No se acredita entrega real ni posesión con mocks. Quedan pendientes las credenciales reales accesibles al motor, la validación en Supabase del SDK/URL pública y las pruebas de entrega. La reconciliación es acotada: sin SID, con más de 24 horas o al agotar sus consultas, conserva el resultado y requiere revisión operativa. La rotación de cuenta/token mientras hay mensajes pendientes debe planificarse para no perder validación de callbacks antiguos.

Rollback: desactivar la obligación antes de apagar SMS, seleccionar LabsMobile cuando esté validado y desactivar respaldo. Revertir funciones/frontend si hace falta; conservar tablas, eventos, verificaciones e idempotencia. No revertir ni borrar historial financiero.

## Referencias oficiales verificadas

- https://www.twilio.com/docs/messaging/api/message-resource
- https://www.twilio.com/docs/usage/security
- https://www.twilio.com/docs/iam/test-credentials
- https://www.twilio.com/docs/api/errors/20429
- https://www.twilio.com/docs/api/errors/21610
- https://www.twilio.com/docs/messaging/api/phonenumber-resource
- https://help.twilio.com/articles/360025294494-Check-Your-Twilio-Account-Balance
