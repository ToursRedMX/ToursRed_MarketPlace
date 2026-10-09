# OTP por SMS o WhatsApp

El registro social de viajeros y agencias y `/verificar-telefono` comparten el selector de canal. Muestra únicamente los canales habilitados; con uno disponible, lo usa automáticamente. El servidor vuelve a comprobar el canal al crear el desafío y al reservar cada envío.

SMS conserva `sms_proveedor_otp`, `sms_proveedor_respaldo` y `sms_fallback_habilitado`, tanto LabsMobile → Twilio como Twilio → LabsMobile. WhatsApp usa configuración independiente: `whatsapp_habilitado`, `whatsapp_proveedor_otp`, `whatsapp_proveedor_respaldo`, `whatsapp_fallback_habilitado`. Actualmente solo Twilio tiene adaptador de WhatsApp. No hay respaldo entre canales; cualquier respaldo se permite únicamente ante rechazo confirmado, nunca ante un resultado ambiguo.

Con ambos canales y `phone_verification_required` apagados se permite continuar con el teléfono sin verificar. No se acredita como verificado. El panel rechaza apagar el último canal manteniendo una obligación activa. Se puede exigir la validación con solo WhatsApp habilitado.

## Configuración para enviar por WhatsApp

1. Aplicar la migración `20261009052107_phone_otp_whatsapp_channels.sql`. WhatsApp queda apagado por defecto.
2. Configurar los secretos `TWILIO_WHATSAPP_FROM` (`whatsapp:+<número E.164>`) y `TWILIO_WHATSAPP_OTP_CONTENT_SID` (`HX…`). Se usan las credenciales existentes `TWILIO_ACCOUNT_SID` y `TWILIO_AUTH_TOKEN`.
3. El número debe ser un remitente de WhatsApp ONLINE de esa cuenta. La plantilla debe estar aprobada en categoría AUTHENTICATION, tipo `whatsapp/authentication`, con botón para copiar el código, variable `1` para el OTP y vencimiento de diez minutos. Ver [autenticación de WhatsApp en Twilio](https://www.twilio.com/docs/content/whatsappauthentication).
4. Desplegar `request-phone-otp`, `sms-webhook-twilio` y `monitor-sms-health`; las funciones que importan el servicio/adaptador compartido deben desplegarse también para conservar una versión consistente. Ejecutar el monitor para comprobar remitente/plantilla y renovar la disponibilidad independiente de WhatsApp. La certificación OTP, el permiso de envíos reales y el modo simulación existentes aplican a ambos canales.
5. En el panel, activar WhatsApp y guardar. Los teléfonos ya verificados permanecen verificados.

La simulación de WhatsApp es local y no llama al proveedor. El OTP y el cuerpo del mensaje no se guardan en los intentos. El desafío y el intento registran `channel`; los callbacks conservan el prefijo `whatsapp:` y la base lo exige para evitar confundir entregas SMS con WhatsApp. Se mantienen CAPTCHA, reautenticación para cambiar número, caducidad, HMAC y límites compartidos por usuario/teléfono/IP. Los presupuestos diarios/mensuales existentes se comparten entre canales; WhatsApp consume una unidad por OTP.

## Añadir un proveedor

Implementar su adaptador y registrar su capacidad en `messaging_private.whatsapp_providers`, además del registro de proveedores general. Añadirlo al registro de adaptadores de WhatsApp del enrutador y al tipo de proveedor. Integrar su comprobación de disponibilidad y callbacks. El panel y las funciones SQL ya separan proveedor principal y respaldo de WhatsApp; no ofrecen LabsMobile ni proveedores sin implementar.

## Validación local

- `deno test --config scripts/edge-check/deno.json scripts/sms-tests`: pruebas de SMS y WhatsApp con transportes simulados.
- `scripts/test-whatsapp-otp.sql`: ejecutar con `psql` en `sms_phase1_full` del contenedor aislado `toursred-external-tests`, sin red. Usa el esquema real y revierte todos los cambios de pruebas.
- `npm run typecheck`, `node scripts/check-edge-types.mjs`, lint de archivos modificados y `npm run build`.

No se ha enviado un OTP real de WhatsApp ni desplegado esta implementación en producción durante su validación local.
