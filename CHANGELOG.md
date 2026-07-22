# Changelog

## 2026-07-07

### Correccion critica — `stripe-webhook` retornaba HTTP 500 en `checkout.session.completed` por anti-patron `.rpc().catch()`

**Descripcion del problema**

En `supabase/functions/stripe-webhook/index.ts`, el handler de `checkout.session.completed` llamaba
al log de auditoria con el siguiente patron:

```typescript
supabase.rpc('insert_audit_log', { ... }).catch((e) => console.error(...));
```

`supabase.rpc()` retorna un `PostgrestBuilder`, que es un "thenable" pero NO una `Promise` nativa.
Llamar `.catch()` directamente sobre el builder sin `await` no intercepta errores de forma confiable:
si la llamada RPC falla (p.ej. timeout, error de BD), la excepcion no queda capturada y asciende
al `catch` general del handler, que retorna HTTP 500 a Stripe.

**Impacto**

- La reserva YA estaba confirmada en la BD antes de la linea fallida — el cobro no se perdio.
- Sin embargo, Stripe recibia 500 y reintentaba el evento `checkout.session.completed`
  indefinidamente, acumulando reintento tras reintento para webhooks cuyo negocio ya estaba
  completo.

**Correccion aplicada**

Se reemplazo el patron roto por un bloque `try/await/catch` correcto:

```typescript
try {
  await supabase.rpc('insert_audit_log', { ... });
} catch (e) {
  console.error('Audit log failed (non-blocking):', e);
}
```

Se auditaron todas las demas llamadas `.rpc()` del archivo — todas las restantes ya usaban `await`
correctamente. Este era el unico caso afectado. Se redesplego la edge function.

---

### Correccion critica — Trigger de auditoria de `platform_settings` no registraba actor ni redactaba secretos

**Descripcion del problema**

La funcion `audit_platform_settings_change()` (creada en la migracion
`20260617231235_20260617_corr2_smart_business_event_triggers.sql`) tenia tres defectos que la
hacian inoperante en la practica:

1. **Error de columna inexistente**: el codigo comparaba `OLD.commission_rate IS DISTINCT FROM
   NEW.commission_rate`, pero `commission_rate` no es una columna de `platform_settings` (las
   columnas reales son `service_charge_percentage` y `agency_commission_percentage`). Esto causaba
   un error en tiempo de ejecucion que el bloque `EXCEPTION WHEN OTHERS` silenciaba — el trigger
   nunca llegaba a llamar a `insert_audit_log`.

2. **Actor no resuelto**: usaba `p_tenant_type => 'system'` fijo y nunca capturaba quien hizo el
   cambio (`auth.uid()`), por lo que los registros de auditoria no hubieran permitido saber que
   administrador modifico un precio, porcentaje o proveedor de CFDI.

3. **Secretos en texto plano**: escribia `to_jsonb(OLD)` / `to_jsonb(NEW)` directamente, lo que
   habria expuesto columnas como `paypal_client_secret`, `mercadopago_access_token`,
   `pac_api_key_encrypted`, `zoho_client_secret`, `odoo_api_key_encrypted` y `geo_api_key` en
   la tabla `audit_logs`.

**Correccion aplicada** (migracion `fix_audit_platform_settings_resolve_actor_and_redact_secrets`)

- Se reescribio `audit_platform_settings_change()` con:
  - Resolucion de actor: `auth.uid()` → fallback a `NEW.updated_by` → fallback a NULL con
    `actor_role = 'system'` para escrituras via service role.
  - Lookup de email y rol del actor en la tabla `public.users`.
  - Skip completo del log si `to_jsonb(OLD) = to_jsonb(NEW)` (sin cambios reales).
  - Redaccion de las 6 columnas sensibles en ambos snapshots (old_values y new_values),
    reemplazando el valor por el string `'[REDACTED]'`.
  - `p_tenant_type 'admin'` y `p_severity 'warning'` (tabla de configuracion sensible).
  - `EXCEPTION WHEN OTHERS → RAISE WARNING` para nunca bloquear el UPDATE original.
- Se recreo el trigger `trg_audit_platform_settings` de forma idempotente.
- Se revocaron permisos EXECUTE de PUBLIC / anon / authenticated, igualando las demas
  funciones de auditoria del proyecto.

**Ajuste posterior — redaccion con hash corto** (migracion `fix_audit_platform_settings_hash_redaction_v2`)

Se detecto que usar siempre el mismo literal `'[REDACTED]'` hacia imposible distinguir en el diff
de `audit_logs` si un secreto habia cambiado o no (old y new mostraban el mismo string aunque
el valor rotara). Se sustituyo por un fingerprint de 8 hex: `[REDACTED:XXXXXXXX]` donde
`XXXXXXXX` es el prefijo del SHA-256 del valor original calculado via `extensions.digest()`
(pgcrypto). El mismo valor produce el mismo fingerprint (el diff queda limpio); valores distintos
producen fingerprints distintos (el diff si detecta la rotacion). Valores NULL producen
`[REDACTED:empty]`. El valor original nunca se escribe en `audit_logs`.

**Nota de seguridad**

Las columnas `paypal_client_secret`, `mercadopago_access_token`, `pac_api_key_encrypted`,
`zoho_client_secret`, `odoo_api_key_encrypted` y `geo_api_key` se escriben como
`[REDACTED:XXXXXXXX]` en `audit_logs`. El fingerprint permite detectar rotaciones sin exponer
el secreto.

---

### Migracion — Stripe SDK a v22.3.0 y API version 2026-06-24.dahlia

**Alcance**

Se actualizaron los 10 Edge Functions que importan Stripe:

- `stripe-webhook`
- `manage-membership-subscription`
- `stripe-checkout`
- `create-checkout-session`
- `process-payment-plan-installment`
- `purchase-post-booking-extras`
- `process-supplement-payment`
- `purchase-gift-card`
- `create-featured-slot-checkout`
- `create-membership-subscription`

**Cambios aplicados en cada funcion**

1. Importacion actualizada: `npm:stripe@12.18.0` / `npm:stripe@14.10.0` → `npm:stripe@22.3.0`
2. `apiVersion` actualizado: `"2023-10-16"` → `"2026-06-24.dahlia"`

**Correccion critica por breaking change de Basil (2025-03-31)**

La API version Basil elimino `Subscription.current_period_start` y `Subscription.current_period_end`
del objeto raiz. Estos campos ahora viven en `subscription.items.data[0].current_period_start` /
`.current_period_end`.

Se corrigieron 8 lecturas afectadas:

- `stripe-webhook/index.ts` — 6 ocurrencias:
  - Handler `checkout.session.completed` (mixed-cart): upsert de membresía + cuerpo de correo de bienvenida
  - Handler `customer.subscription.updated`: upsert de membresía + cuerpo de correo de bienvenida
  - Handler `invoice.payment_succeeded`: upsert de membresía fallback + cuerpo de correo de bienvenida

- `manage-membership-subscription/index.ts` — 2 ocurrencias:
  - Accion `upgrade`: update en tabla `memberships` + payload JSON de respuesta

**Breaking changes auditados sin impacto**

- **Acacia 2024-09-30**: sin cambios relevantes para este proyecto.
- **Basil 2025-03-31** (`ui_mode`): `hosted`→`hosted_page`, etc. Sin impacto — ningun checkout usa `ui_mode`.
- **Basil 2025-03-31** (coupon singulares eliminados): sin impacto — `create-membership-subscription` ya usa `discounts: [{ coupon: ... }]`.
- **Clover 2025-09-30**: sin cambios relevantes para este proyecto.
- **Dahlia 2026-03-25 / 2026-06-24**: sin cambios relevantes para este proyecto.

**Nota**

La version del endpoint en el Stripe Dashboard (configuracion de webhooks) NO se modifico.
Solo se actualizo la version que el SDK usa en llamadas salientes a la API de Stripe.

---

## 2026-07-06

### Correccion critica — Stripe webhook retornaba HTTP 500 en `checkout.session.completed`

**Descripcion del problema**

El manejador del evento `checkout.session.completed` en `supabase/functions/stripe-webhook/index.ts`
usaba la siguiente sintaxis para insertar un registro en `stripe_orders`:

```typescript
await supabase
  .from('stripe_orders')
  .insert({ ... })
  .on_conflict(['checkout_session_id'])
  .merge();
```

Los metodos `.on_conflict()` y `.merge()` no existen en supabase-js v2. La llamada lanzaba un
`TypeError` que no estaba capturado localmente y burbujeba hasta el `try/catch` global del handler,
causando que la funcion retornara HTTP 500.

**Impacto**

- Stripe reintentaba el webhook de forma indefinida ante cada respuesta 500.
- La tabla `stripe_orders` acumulo **0 filas** desde su creacion (2026-07-02), a pesar de ~124
  entregas registradas por Stripe en ese periodo.
- Los pagos completados SI se registraron en `payment_transactions` (escrita antes del punto de
  fallo), por lo que los cobros procesados no se perdieron.

**Causa raiz**

Uso de la API de PostgREST/supabase-js v1 (`.on_conflict().merge()`) en un entorno que ejecuta
supabase-js v2, donde el patron correcto para upsert es:

```typescript
.upsert(data, { onConflict: 'column_name' })
```

**Correccion aplicada**

Se reemplazo el bloque roto por `.upsert({ ... }, { onConflict: 'checkout_session_id' })` en
`supabase/functions/stripe-webhook/index.ts`. Se redesplego la edge function.

---

## 2026-07-06

### Correccion — `refund_points_for_cancelled_booking` llamada con parametro obsoleto

**Descripcion del problema**

La funcion SQL `refund_points_for_cancelled_booking` fue modificada en la migracion
`20260702000005_fix_refund_points_derive_user_from_booking.sql` para eliminar el parametro
`p_user_id` (el usuario ahora se deriva internamente desde el `booking_id`). Sin embargo, dos
llamadas en `stripe-webhook/index.ts` seguian pasando `p_user_id: booking.user_id`, lo que causaba
un error de "funcion no encontrada" en PostgreSQL.

**Handlers afectados**

- `checkout.session.expired` — puntos usados en una reserva nunca se reembolsaban al expirar el checkout.
- `payment_intent.payment_failed` / `payment_intent.canceled` — mismo problema ante fallo de pago.

**Correccion aplicada**

Se elimino el parametro `p_user_id` de ambas llamadas RPC en `stripe-webhook/index.ts`. Se
redesplego la edge function.
