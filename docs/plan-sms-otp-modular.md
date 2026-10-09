# Verificación telefónica y mensajería modular

Plan revisado el 7 de octubre de 2026. Sustituye el documento original de Claude basado en `662154b`. Implementación por fases y PR independientes. La Fase 1 parte de `1ac2e6d`; hay trabajo paralelo de Claude en otra rama.

## Decisiones aprobadas

- Sin cohortes, porcentajes de activación, periodos de gracia ni excepciones individuales. Al activar la obligación, aplica a todos los usuarios del contexto seleccionado, incluidos los existentes.
- `phone_verification_required=false` inicialmente. `phone_verification_travelers_required=true` y `phone_verification_agencies_required=true`. El global prevalece.
- `sms_habilitado=false`, `sms_modo_prueba=true`. El modo simulado nunca acredita posesión del teléfono. SMS y obligatoriedad son independientes.
- Administradores, superadministradores, contadores y ejecutivos pueden verificar voluntariamente. Conservan las reglas MFA actuales. Al actuar como viajero o colaborador de agencia se evalúa ese contexto, no una exención general de la cuenta.
- No se aplica ninguna migración remota, despliegue, envío real ni activación sin autorización específica. Las pruebas SQL se ejecutan en Docker sin red sobre el esquema real restaurado, con sus triggers.
- Un número verificado corresponde a una cuenta. Nunca se verifica ni fusiona un teléfono existente por normalización o por migración.
- LabsMobile primero. Twilio solo será seleccionable cuando exista un adaptador probado y configurado. WhatsApp queda como canal futuro, sin bot en este proyecto.

## Auditoría y correcciones al documento original

Hallazgos contrastados con archivos, migraciones y catálogo remoto durante la Fase 0:

| Área | Estado observado | Consecuencia |
|---|---|---|
| Plan original | No existía en el árbol; Axel lo proporcionó en la conversación | Este archivo conserva el diseño revisado, no pretende ser una edición de un archivo histórico |
| Roles | `users.role`: traveler, agency, admin, accountant, account_executive; superadmin es un booleano | No inventar un rol SQL super_admin |
| Agencias | Propietario `agencies.user_id`; colaboradores `agency_staff` y permisos separados | OTP acredita a cada usuario, nunca al teléfono comercial |
| Registro de agencia | `complete_agency_onboarding`; el formulario usa actualmente el mismo teléfono para persona y contacto | Separar identidad de acceso del contacto empresarial al integrar la Fase 3 |
| Configuración | Una fila tipada, SELECT público, dos políticas UPDATE permisivas; auditoría existente | Secretos fuera de la tabla; los campos SMS se escriben exclusivamente mediante RPC autorizada, con control adicional contra UPDATE directo |
| AuthContext | Caché de perfil; guards propios en el flujo de reserva y rutas protegidas | El guard visual no sustituye autorización SQL/Edge; actualizar perfil/política dinámicamente en Fase 3 |
| OAuth | Hay rutas por proveedor; la detección del retorno no incluye todos los casos de LinkedIn | Probar todos los mecanismos reales al conectar la verificación |
| Teléfono | `src/lib/telefono.ts` es un normalizador limitado, no un validador internacional | En Fase 1 SQL solo normaliza representaciones conservadoras; Fase 2 valida país/número con metadatos internacionales compartidos |
| Usuarios | Había números heterogéneos y grupos duplicados; no había verificación telefónica | Columnas nuevas nulas; índice único solo sobre números realmente verificados |
| Confirmación | `claim_booking_email_lock` es específico del correo | SMS no se engancha después de ganar ese candado: tendrá evento/idempotencia independientes |
| Horarios | `tour_slots.departure_time`, destinos con `time_zone`, pero las zonas inspeccionadas estaban vacías | No inventar CDMX como fallback universal; definir zona válida antes de enviar recordatorios |
| Auditoría | `audit_logs`, triggers de usuarios/configuración, `audit_errors` | Reutilizar auditoría administrativa; no guardar códigos, cuerpos ni callbacks crudos en logs nuevos |
| Cron | pg_cron + pg_net y service role desde Vault | Reutilizarlo en fases posteriores; no crear cron de envío ahora |

El documento original contenía contradicciones que quedan eliminadas: eximir agencias; continuar sin verificar por país no soportado; arrancar en modo obligatorio; persistir OTP en el texto de outbox; tratar timeout como error reintentable; usar el candado del correo para SMS; marcar una simulación como enviada o verificada. Tampoco basta responder HTTP 200 para acreditar entrega.

## Arquitectura

Frontend → RPC/Edge autenticada → política de operación → mensajería independiente del proveedor.

`supabase/functions/_shared/mensajeria/` contendrá tipos, normalización internacional, seguridad, plantillas, enrutador y adaptadores LabsMobile/mock/Twilio. Canal (`sms`, futuro `whatsapp`), aplicación, categoría, plantilla y proveedor son conceptos separados. No hay credenciales en tablas ni en el frontend.

Esquema privado `messaging_private`, RLS habilitada y sin acceso de anon/authenticated. RPC públicas con EXECUTE revocado por defecto y grants específicos. Las lecturas de usuario son de su propio estado; las administrativas requieren usuario activo, permiso `can_manage_settings` (o superadmin) y AAL2 cuando la política actual lo exige.

### Modelo de datos de Fase 1

- `users.phone_verified_at`, `users.phone_verified_e164`: pareja consistente, E.164, índice único parcial. Guard INSERT/UPDATE impide autoverificación incluso a administradores por Data API. Cambiar a otro número limpia el estado e invalida desafíos pendientes.
- `platform_settings`: interruptores, proveedores por categoría, países, hora de recordatorio, límites y umbral de saldo expresado en créditos del proveedor, versión de configuración para evitar sobrescritura concurrente.
- `runtime_capabilities`: capacidad técnica del procesador y OTP; inicialmente falsa, no editable desde el panel. Se habilita solo al completar las fases correspondientes.
- `provider_capabilities`: adaptador disponible, configuración validada, capacidades y vigencia de esa validación. Inicialmente ningún proveedor real habilitado. No contiene secretos.
- `phone_verifications`: HMAC hexadecimal, versión de secreto, teléfono, usuario, vigencia, intentos, estado, simulación. Sin código recuperable. Un desafío pendiente por usuario.
- `notification_outbox`: identidad lógica, aplicación/canal/categoría/plantilla, referencias, destino, programación/vencimiento, idempotencia, estado y lease. No columna de texto libre ni OTP: la cola solo admite categorías transaccionales.
- `notification_attempts`: intentos separados, correlación única, proveedor, ID externo, estado, clasificación de fallo y decisión de fallback. Sin texto del mensaje.
- `notification_events`: callbacks normalizados y deduplicados por proveedor/clave; sin cuerpo crudo.
- `notification_preferences`: transaccionales separados de promocionales; marketing apagado por defecto. No se implementan campañas.
- `rate_limit_buckets`: contadores atómicos de ventana fija con claves HMAC; no almacenar IP cruda.

### Política por contexto e interruptores

La función de política recibe un contexto establecido por el backend de la operación, nunca elegido como autorización por el navegador. Devuelve necesidad de teléfono; no concede permisos de negocio. La autorización existente sigue validando identidad, agencia, recurso, correo, aprobación y MFA.

| Global | Viajeros | Agencias | Resultado |
|---|---|---|---|
| false | cualquiera | cualquiera | Nadie obligado; se conservan verificaciones |
| true | true | false | Todas las operaciones protegidas de viajeros requieren teléfono |
| true | false | true | Todas las operaciones protegidas de agencia requieren teléfono de cada cuenta |
| true | true | true | Ambos contextos requieren teléfono, sin excepciones |

Administración solo es un contexto válido para roles administrativos existentes. Un admin que reserva recibe la política de viajero. Un ejecutivo que opera como staff recibe la política de agencia. La función no valida membresía de agencia: eso lo hace el guard de la operación, que debe ejecutar ambas comprobaciones.

No se puede activar obligación con SMS apagado, simulación, proveedor OTP no validado o motor/guards aún incompletos. No se puede apagar SMS manteniendo obligación: primero se desactiva el global en la misma actualización. Una caída no verifica a nadie ni abre automáticamente el acceso: el administrador conserva acceso y puede apagar el global para todos; luego puede reactivarlo sin perder verificaciones. No hay excepciones silenciosas por país no soportado: corregir país/número, ampliar cobertura o desactivar globalmente durante contingencia.

Fase 1 prepara y prueba la política, pero **no conecta aún los guards de negocio ni AuthContext**. Su capacidad de activación permanece false para evitar una falsa sensación de protección.

### OTP (Fase 3)

Sesión de persona real y correo validado según el flujo vigente. Turnstile reutilizado cuando corresponda. E.164 validado y país permitido. Código de seis dígitos con `crypto.getRandomValues` y muestreo sin sesgo. HMAC-SHA256 ligado a desafío, usuario y número, con `PHONE_OTP_PEPPER` versionado. Comparación segura, diez minutos, cinco intentos, 60 segundos entre solicitudes, límites acumulados por usuario/teléfono/IP; reenviar no reinicia presupuesto de fallos.

Emisión atómica de desafío y reservas de consumo. Envío inmediato por interfaz común, sin código en la cola ni en logs. Timeout → resultado desconocido; no reenvío automático. La validación bloquea desafío y usuario en transacción y verifica número actual, expiración, simulación e índice único. Recuperación usa reautenticación y controles existentes; nunca basta conocer últimos dígitos. Recuperar acceso no concede teléfono verificado: se valida el nuevo. Sin acceso a correo/MFA se sigue el procedimiento de recuperación que deberá cerrarse antes de activar.

### Cola, fallback y consumo (Fase 2)

`SKIP LOCKED`, claim atómico, token de lease, límite de lote y vencimiento. Un lease expirado pasa a `resultado_desconocido`, no vuelve ciegamente a pendiente: el envío pudo haber sido aceptado. Fase 2 implementará finalización con token y transiciones, reconciliación cuando exista API y reintentos solo ante rechazo confirmado. No hay garantía de exactamente una entrega en la red; se impide envío simultáneo local y reintento ambiguo.

Fallback únicamente ante rechazo inequívoco del proveedor (autenticación/crédito/indisponibilidad confirmada); nunca ante número/texto inválido, timeout, desconexión posterior al envío ni entrega pendiente. Un mensaje usa un proveedor por intento. Distribución porcentual entre proveedores queda fuera de esta implementación inicial; no se confunde con el rollout de usuarios, que fue descartado.

Límites diarios y mensuales medidos en segmentos, no costos inventados; saldo conocido en créditos. El procesador global debe controlar caudal agregado, no solo cinco peticiones por segundo por worker. Alertas no financieras: saldo, rechazos repetidos, volumen anormal, proveedor sin capacidad validada.

### Notificaciones (Fase 4)

Evento idempotente `reserva_confirmada:{booking_id}`, independiente del correo y reconciliable si falla el encolado. No modificar resultados de pagos ni comisiones. No incluir ventas externas en confirmaciones de marketplace.

Recordatorio por versión/fecha de salida, 18:00 local configurable, zona IANA del destino validada, ventana horaria explícita, cancelación/reprogramación revalidadas antes de enviar. No usar programación propietaria de LabsMobile. Si faltan fecha/hora/zona, omitir con diagnóstico operativo en vez de inventar datos. Plantillas calculan septetos GSM-7 (incluida extensión) y unidades UTF-16/segmentos Unicode; límites 160/153 y 70/67 según transporte. Enlaces a rutas realmente existentes bajo URL base configurada.

Retención final de Fase 4: purgar desafíos terminales tras 24 h de expiración, conservando intentos de OTP sin vínculo al desafío para las métricas mensuales. Cola, intentos y eventos tienen un horizonte operativo de 90 días, incluidos resultados desconocidos: no se reenvían al vencer ese horizonte. Se eliminan teléfonos y relaciones directas; se conserva la identidad mínima de idempotencia. Eventos OTP se purgan a 90 días y límites vencidos a 32 días. La ampliación respecto de los 30 días propuestos evita truncar las métricas de un mes de 31 días. Instalar la programación de purga es un paso de despliegue autorizado, no una acción automática de las migraciones.

## Fases, aceptación y rollback

| Fase | Alcance y archivos | Dependencias / riesgos | Aceptación | Rollback |
|---|---|---|---|---|
| 0 | Auditoría de CLAUDE, AuthContext, guards, registros, pagos, settings, catálogo SQL y docs oficiales | Plan antiguo y políticas acumuladas | Hallazgos distinguen código/catalogo de supuestos | Solo lectura |
| 1 | Este plan, migración aditiva, RPC/política, `SmsSettingsSection`, pruebas SQL | Esquema actual completo; riesgo de autoverificación/UPDATE administrativo permisivo | Defaults seguros, RLS/grants, carreras de cola/límites, controles de administración y cambios de número; checks de repo | Global/SMS apagados; revertir UI si necesario; conservar tablas/datos |
| 2 | `_shared/mensajeria`, adaptadores LabsMobile/mock, procesador, callback, transición/reconciliación, métricas de consumo | Fase 1; secretos fuera del repo; resultados ambiguos | Contratos mock, callbacks autenticados/idempotentes, sin duplicados, GSM/Unicode, no pruebas reales | SMS apagado, drenar/retener cola; no borrar historial |
| 3 | request/verify OTP, VerifyPhonePage, AuthContext/guards y restricciones SQL/Edge, perfiles/recuperación | Fases 1–2, matriz de rutas/RPC real; simulación no prueba posesión | Correo/OAuth/agencias/staff/multicontexto, todos los toggles, OTP/abuso/concurrencia, permisos backend | Global apagado, MFA intacto, conservar verificaciones |
| 4 | Confirmación independiente, recordatorios, scheduler, métricas y alertas | Fases 1–3; zona horaria y reprogramaciones | Webhooks duplicados, fallo email, cancelación, reprogramación, DST y caducidad | Apagar SMS transaccional/procesador; pagos y correo siguen |
| 5 | Twilio real y callback firmado, fallback entre proveedores | Cuenta/secretos y autorización de pruebas | Firma, correlación, clasificación y respaldo seguro; no habilitar hasta validar | Seleccionar LabsMobile y desactivar fallback |

Cada fase entrega PR, diff, pruebas, riesgos y estado real. Ninguna autorización de fase equivale a autorización de migración remota o envío real. Las capacidades técnicas se certifican solo después de integración; el usuario controla la activación final en el panel.

## Matriz de pruebas

- Fase 1: valores iniciales, global/roles, permisos admin/AAL2, UPDATE directo, versión concurrente, provider no disponible, no activación sin motor, RLS/privilegios de tablas y RPC, INSERT/UPDATE autoverificación, normalización conservadora, invalidación, unicidad concurrente, idempotencia, SKIP LOCKED, lease abandonado, vencimiento y límites atómicos. Usar esquema real, no tablas sustitutas; mutación que demuestre que falla una prueba de seguridad.
- Fase 2: éxito LabsMobile/test, rechazo permanente, fallo confirmado, timeout/desconexión desconocidos, fallback permitido/prohibido, cambio de proveedor, callback duplicado/autenticación, aceptado sin entrega, contador distribuido, longitudes/segmentos y privacidad de logs.
- Fase 3: traveler/agency/staff, admin/superadmin/ejecutivo/contador opcionales, contexto múltiple; correo y cada OAuth; global apagado/encendido, solo un rol/ambos, simulación, SMS apagado, conservación y reactivación; válido/incorrecto/vencido/reenvío/fuerza bruta/duplicado/cambio/concurrencia/país/recuperación. APIs deben rechazar las mismas operaciones que la UI.
- Fase 4: una confirmación por reserva pese a webhooks repetidos y fallo del email; cancelación/reprogramación; zona IANA y horario de verano; salida pasada; datos incompletos; URL real y SMS largo; ningún efecto financiero.
- Fase 5: contratos reales Twilio, callback firmado, fallback sin duplicación. Envíos a números reales solo con autorización.
- Se eliminan pruebas de cohortes 5/25/50/100% y permanencia; se sustituyen por todos los usuarios existentes/nuevos, todos los colaboradores y desactivación/reactivación global sin excepciones.
- Por fase: `npm run typecheck`, `node scripts/check-edge-guards.mjs`, `node scripts/check-edge-deps.mjs`, lint y build; registrar deuda previa sin ocultar errores nuevos.

## Referencias oficiales

- [LabsMobile REST JSON](https://www.labsmobile.com/es/api-sms/versiones-api/http-rest-post-json): endpoint `/json/send`, Basic Auth, msisdn sin +, `subid` hasta 20 caracteres, `test:1`, callbacks GET. `code:0` es aceptación, no entrega. Webhook requiere token dedicado y correlación; no se documenta firma criptográfica.
- [Twilio Message](https://www.twilio.com/docs/messaging/api/message-resource) y [seguridad de callbacks](https://www.twilio.com/docs/usage/security).
- [RLS Supabase](https://supabase.com/docs/guides/database/postgres/row-level-security) y [Cron](https://supabase.com/docs/guides/cron).

## Pendientes explícitos

Fase 5 implementada para revisión en `codex/sms-otp-fase-5`: ver [alcance, migración, pruebas y rollout de Twilio](sms-fase-5-validacion.md). El adaptador y la firma están probados localmente; su entrega real y activación siguen pendientes. No se incorpora distribución porcentual.

Credenciales y comportamiento real en México, cobertura internacional validada, proveedor fallback funcional, recuperación sin correo/MFA, privacidad de comunicaciones y zonas IANA de destinos deben resolverse antes de activar su funcionalidad. Los defectos previos de OTP de correo/contrato no se corrigen dentro de la Fase 1. No se presenta Twilio ni WhatsApp como integrados.
