# Fase 2 — motor modular

Depende del PR de Fase 1. No aplicar ni desplegar automáticamente.

Implementa módulos de tipos, seguridad criptográfica, normalización internacional con `libphonenumber-js@1.13.7/max`, plantillas/segmentos, LabsMobile y mock. Twilio no está implementado ni habilitado. Cada intento se persiste antes del envío; el respaldo requiere rechazo confirmado persistido. Timeouts, HTTP 500 y JSON 30 quedan desconocidos. Los callbacks usan HMAC dedicado a cada correlación y verifican el destinatario contra el intento persistido. No almacenan el payload recibido.

`20261008052810_sms_delivery_engine.sql` agrega RPC de runtime, intento, finalización, callback, backoff y capacidad del proveedor. Límites globales en segmentos, ventanas UTC y cinco intentos por segundo por proveedor compartidos entre workers. Un lease abandonado nunca reenvía automáticamente. Máximo cuatro intentos; backoff 1/5/30 minutos solo tras rechazo confirmado o cuota reservada sin envío.

Funciones nuevas, ambas con `verify_jwt=false` explícito y autenticación dentro del handler:

- `sms-webhook-labsmobile`: GET con firma por correlación; no verifica teléfonos.
- `process-notification-outbox`: solo service role, cola transaccional. La preparación de datos de reserva se conecta en Fase 4. Hasta esa fase el procesador no se habilita ni se programa.

Secretos requeridos para operación posterior: `LABSMOBILE_USER`, `LABSMOBILE_TOKEN`, `SMS_WEBHOOK_SECRET` de al menos 32 caracteres, opcional `LABSMOBILE_SENDER`; los envíos reales requieren además `SMS_ALLOW_REAL_SENDS=true`. Ningún secreto fue establecido ni ningún proveedor contactado por las pruebas. El proveedor permanece no disponible hasta una comprobación explícita del backend. El fallback con proveedor real secundario se valida al implementar Twilio, no se simula como integración concluida.

Pruebas: 14 casos Deno sin permisos de red, 10 SQL contra esquema restaurado. Incluyen internacionalización/NANP, GSM/Unicode, REST mock, clasificación de errores, HMAC, simulación, idempotencia, callbacks desordenados, fencing de lease y rollback atómico de cuotas. Se mutó la regla de fallback para autorizar todos los resultados; las pruebas detectaron la violación y después se restauró el módulo.

```powershell
deno test --no-config --node-modules-dir=none --cached-only scripts/sms-tests/messaging_test.ts
node scripts/test-sms-engine-db.mjs
```

Typecheck de los módulos/handlers mediante Deno; lint dirigido sin hallazgos; guardias de autorización y dependencias pasan. La línea base global de lint de Fase 1 sigue siendo deuda previa. Fase 4 aporta observabilidad administrativa, saldo, reconciliación por eventos y programación. LabsMobile REST documenta callbacks pero no una consulta genérica de estado de mensajes enviados: los resultados desconocidos esperan callback o resolución operativa, nunca una consulta inventada.

Rollback: mantener `sms_habilitado=false`, detener invocación del procesador y conservar cola/intentos para diagnóstico. No borrar verificaciones ni tocar finanzas.
