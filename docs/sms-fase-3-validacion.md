# Fase 3 — OTP y autorización por contexto

Depende de los PR de las fases 1 y 2. Migración propuesta `20261008054539_phone_otp_enforcement.sql`; no aplicada remotamente.

El desafío se emite con seis dígitos criptográficos, HMAC ligado a usuario/id/teléfono, diez minutos, cinco intentos acumulados por día y 60 segundos de enfriamiento. No se persiste texto recuperable del OTP. El envío inmediato utiliza los mismos adaptadores, cuotas e intentos del motor. Una respuesta del proveedor o un callback no acredita posesión: solo la validación del desafío real la acredita. Simulación nunca verifica.

El cambio de teléfono invalida la prueba previa y los desafíos incompatibles. Para cambiarlo se requiere inicio de sesión de los últimos diez minutos o verificación sensible vigente. Recuperar un número perdido usa el método de acceso existente, conserva MFA y requiere verificar el nuevo número. País no soportado mantiene el requisito: soporte puede gestionar cobertura o desactivación global; no existe excepción individual silenciosa.

`AuthContext` consulta política independiente de su caché de roles (cada cinco segundos con ventana activa y al recuperar foco). `PhoneVerificationGate` cubre paneles y el flujo de cuatro pasos. La página `/verificar-telefono` permite recuperación y verificación voluntaria. OAuth atraviesa la misma política; se incorpora LinkedIn a la detección existente de onboarding. El servicio remoto aplica la política en cada operación, sin esperar al refresco del navegador.

Backend: guard compartido, contexto explícito de viajero en checkouts/wallet/gift cards y contexto agencia en check-in/gestión; las autorizaciones originales permanecen. Se agregan políticas restrictivas a tablas operativas y guardias a RPC existentes, preservando sus cuerpos y propietarios. Lecturas públicas del catálogo y recuperación siguen disponibles. Administradores, contadores y ejecutivos operan exentos en contexto administrativo; operar como viajero no hereda esa exención. Los colaboradores usan su cuenta personal, nunca el teléfono comercial.

Pruebas locales contra copia del esquema real sin datos, con triggers originales y Docker sin red: emisión, expiración, replay, acumulación de intentos, cooldown, límites, cambio/reautenticación, simulación, permisos, roles, switches y carreras de emisión/propiedad. Se ejecutan RPC reales para comprobar que deniegan antes de crear reservas o ventas externas. La mutación del rechazo de simulación se aplicó realmente y produjo fallo; después se restauró. No se ejecutó autenticación real con Google/Facebook/LinkedIn ni entrega real de SMS.

Comandos reproducibles:

```powershell
node scripts/setup-sms-test-db.mjs <dump-absoluto-de-esquema>
node scripts/test-sms-foundation-db.mjs
node scripts/test-sms-engine-db.mjs
node scripts/test-phone-otp-db.mjs
deno test --no-config --node-modules-dir=none --cached-only scripts/sms-tests
npm run typecheck
deno check --node-modules-dir=none --config scripts/edge-check/deno.json supabase/functions/
node scripts/check-edge-guards.mjs
node scripts/check-edge-deps.mjs
npm run build
```

Riesgos/aceptación remota pendiente: OPTIONS tras despliegue autorizado; pruebas UI/OAuth con cuentas por rol, permisos reales de colaboradores y callbacks; verificar la IP que agrega el proxy antes de certificar protección por IP. Los límites por usuario/teléfono y consumo no dependen de esa cabecera. El país y la capacidad real de entrega requieren validación con proveedor. No se ha certificado ni activado la obligatoriedad; las capacidades iniciales continúan apagadas.

Lint de los componentes nuevos pasa. Archivos existentes mantienen tres errores y un aviso en el lint dirigido (efectos de ProtectedRoute/BookingFlowLayout, catch vacío y export de AuthContext), presentes antes de esta fase. Tipos de frontend y del árbol completo de Edge Functions, guardias y build pasan. No se modifica MFA ni cálculos de pagos.

Rollback operativo: apagar el interruptor global en administración; conserva verificaciones y acceso. Para detener SMS, apagar global y SMS en la misma actualización. No borrar tablas, desafíos históricos o teléfonos verificados. Orden futuro de despliegue: migraciones, funciones, frontend, pruebas de humo, certificación y finalmente activación administrativa autorizada.
