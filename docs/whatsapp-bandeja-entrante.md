# Bandeja "Mensajes Entrantes de WhatsApp"

Panel admin (`/admin/whatsapp-entrantes`, menú Comunicaciones, **solo super_admin**) para ver y responder los WhatsApp que los clientes mandan al número de ToursRed (`+1 555 475 9009`, sender Online en Twilio).

## Piezas

| Pieza | Qué hace |
|---|---|
| `supabase/migrations/20261012230000_whatsapp_bandeja_entrante.sql` | Tablas `whatsapp_contactos`, `whatsapp_mensajes`, `whatsapp_adjuntos`, `whatsapp_plantillas`; bucket privado `whatsapp-media`; RLS solo super_admin; RPC; Realtime |
| `supabase/functions/whatsapp-webhook-entrante` | Recibe los mensajes entrantes **y** los callbacks de estado (`?evento=estado`). `verify_jwt = false`, valida la firma de Twilio |
| `supabase/functions/whatsapp-enviar-respuesta` | Responde desde el panel. Requiere sesión de super_admin (`verify_jwt` por defecto) |
| `src/pages/admin/AdminWhatsAppEntrantes.tsx` | La pantalla |
| `scripts/test-whatsapp-bandeja.mjs` / `.sql` | Pruebas de la lógica pura y de la migración |

## Reglas que ya quedan implementadas

- **Bloqueo:** un número bloqueado no se guarda (el webhook solo suma `descartados_bloqueado`) y no se le puede responder. El historial previo se conserva.
- **Ventana de 24 h:** la decide la base (`whatsapp_preparar_envio`). Fuera de ella solo se aceptan plantillas.
- **Plantillas:** ya soportadas de punta a punta (tabla, envío por `ContentSid`, selector en la pantalla). Se dan de alta con un `INSERT` en `whatsapp_plantillas` con el `ContentSid` aprobado en Twilio; no hay pantalla para administrarlas todavía.
- **Móviles de México:** Twilio manda `+521…` y el usuario registró `+52…`; la llave del contacto quita ese `1` y se guarda aparte el número tal cual para responder.
- **Adjuntos:** se descargan de Twilio (solo de la API de **nuestra** cuenta) al bucket privado, máx. 16 MB y lista cerrada de tipos (sin SVG/HTML).

## Puesta en marcha (en este orden)

1. **Aplicar la migración con la versión del archivo**, desde una rama que lo tenga (CLAUDE.md, regla 1 y trampa de `db push`): `Test-Path supabase\migrations\20261012230000_whatsapp_bandeja_entrante.sql` → `supabase db push` debe **listarla**, no decir «up to date». Confirmar después contra la base (tablas, bucket y que el ledger registró esa versión).
2. **Desplegar las dos funciones.** Antes, cruzar `verify_jwt` contra la API: `whatsapp-webhook-entrante` = `false`, `whatsapp-enviar-respuesta` = `true`. Después, mandar un `OPTIONS` a cada una.
3. **Twilio:** apuntar "When a message comes in" a `https://<proyecto>.supabase.co/functions/v1/whatsapp-webhook-entrante`. Los inbound de la consola traían un Messaging Service (`MG…`): **revisar primero ahí (Messaging → Services → Integration → Incoming Messages)** y en el sender (Edit Sender → Endpoint configuration); si el servicio tiene su propio webhook, manda sobre el del sender.
4. Variables de entorno: usa las que ya existen (`TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_WHATSAPP_FROM`). `TWILIO_WHATSAPP_FROM` debe ser exactamente el `To` que Twilio manda en los entrantes (`whatsapp:+15554759009`); si no coincide, el webhook los rechaza con 400.
5. Prueba: escribir al número desde un teléfono, verlo aparecer en el panel, responder, y confirmar en la base que el saliente quedó con `twilio_sid` y llegó a `entregado`/`leido`.

## Límites y pendientes conocidos

- **No se ha ejecutado contra Twilio ni contra Supabase.** La migración se probó en un Postgres desechable con un esquema mínimo (ver el encabezado de `test-whatsapp-bandeja.sql`); las funciones y la pantalla pasaron lint y tipos, pero no se han visto funcionar de punta a punta.
- `scripts/check-edge-subpaths.mjs` y los tipos de las Edge Functions necesitan `deno`, que no está en el contenedor: no corrieron aquí.
- **Retención:** los mensajes y adjuntos son datos personales sin política de borrado. Falta decidir cuánto tiempo se guardan antes de producción.
- **Webhook de estado de salientes:** un callback que llegue antes de que se guarde el `twilio_sid` se ignora; los siguientes (`delivered`, `read`) lo alcanzan.
- **El arreglo `SM|MM` del OTP sigue pendiente y es independiente de esto:** esta bandeja valida su propio SID (`whatsappBandeja.ts`) y no toca `proveedores/twilio.ts`.
- Los adjuntos pendientes que fallen no se reintentan solos (queda `url_origen` en la fila para un reintento futuro).
