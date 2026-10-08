# Fase 1 — base SMS/OTP

Implementado en `codex/sms-otp-fase-1`, partiendo de `1ac2e6d`.

- Migración: `20261008045859_sms_otp_foundation.sql`.
- Esquema privado y ocho tablas con RLS y sin permisos de usuarios finales.
- Campos protegidos en users y configuración tipada en platform_settings; auditoría administrativa existente conservada.
- RPC de configuración autorizada por permiso y MFA, control de versión concurrente, política por contexto, estado propio, encolado/claim, límites y retención.
- Panel `SmsSettingsSection` integrado en AdminSettings, con guardado independiente.
- No se modifican las funciones de pago, reservas, correo ni MFA.

## Validación local

Se exportó solo el esquema vigente de Supabase a un archivo temporal fuera del repo y se restauró en PostgreSQL 17 (`toursred-external-tests`, base desechable `sms_phase1_full`). El contenedor está sin red y conserva los triggers originales. No se exportaron datos de usuarios.

Reproducción:

```powershell
node scripts/setup-sms-test-db.mjs C:/ruta/absoluta/esquema-actual.sql
node scripts/test-sms-foundation-db.mjs
```

El setup reconstruye exclusivamente esa base local desechable; no admite una URL remota. Requiere la imagen Supabase PostgreSQL con pgcrypto, pg_trgm, unaccent, uuid-ossp, pg_net, Vault y PostGIS. El dump debe contener todos los esquemas de negocio y auth.

Resultados de la ronda final: 32 pruebas SQL aprobadas; typecheck y build aprobados; guardias Edge de autorización y dependencias aprobadas. Lint del componente nuevo aprobado. Lint completo reporta 175 problemas (131 errores, 44 avisos) en archivos existentes; no se ocultó ni se elevó ninguna baseline.

Prueba de mutación: se deshabilitó solo el trigger local `guard_phone_verification_fields`, se verificó `tgenabled=D` y el mismo test falló en «unverified users cannot self-verify through UPDATE» con «Missing expected exception». Se restauró el trigger (`tgenabled=O`). No se cambió el SQL de la migración para pasar la prueba.

## Límites de esta fase

- No hay adaptador, emisión/verificación OTP ni guards de negocio conectados todavía. Las capacidades de activación permanecen falsas.
- `normalizar_telefono` no demuestra propiedad ni valida cobertura internacional; esa validación corresponde a Fase 2.
- La rutina de retención conserva registros mínimos de idempotencia y elimina contacto/referencias de mensajes terminales tras 30 días. No se ha programado cron.
- Ninguna migración aplicada en Supabase remoto, ninguna función desplegada y ningún SMS enviado.
- El dump restaurado es evidencia del esquema vigente con triggers; no demuestra que toda la historia de migraciones antiguas pueda reproducirse sobre una base vacía. El repo mantiene deuda histórica de replay fuera de este cambio.
