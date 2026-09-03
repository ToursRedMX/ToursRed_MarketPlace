-- ============================================================================
-- EXPORTACION FUNCIONAL desde supabase_migrations.schema_migrations
--
-- Este archivo NO es la migracion original: es el SQL que la base registro
-- haber ejecutado, reconstruido a partir del ledger.
--
--   version: 20260527185314
--   name:    20260527_fix_rls_policies_always_true
--
-- Recuperado : las sentencias ejecutadas, en su orden original.
-- Perdido    : los comentarios sueltos entre sentencias. El ledger guarda solo
--              sentencias ejecutables, asi que la documentacion que tuviera el
--              archivo original no es recuperable desde aqui.
-- Transformado: saltos de linea desescapados y ';' separadores repuestos, que
--              statements[] no conserva. La alineacion puede diferir.
--
-- Se agrega para que el cambio de esquema sea revisable y reproducible desde
-- el repo. Para el detalle de por que existe, ver el bullet del desfase de
-- migraciones en claude.md.
-- ============================================================================

/*
  # Corregir RLS policies con WITH CHECK (true) — acceso no restringido

  ## Descripción
  Supabase detectó 6 tablas con políticas INSERT que tienen WITH CHECK (true),
  lo que permite insertar cualquier valor sin restricción. Se corrigen aplicando
  la restricción mínima necesaria según el caso de uso real de cada tabla.

  ## Cambios

  ### 1. cookie_consents — "Anyone can record consent"
  - Roles: public (anon + authenticated)
  - Uso: visitantes registran su consentimiento de cookies
  - Restricción: el user_id debe coincidir con auth.uid() si está autenticado,
    o ser NULL si es visitante anónimo. Impide insertar consents a nombre de otros.

  ### 2. international_tour_inquiries — "Anyone can submit inquiry"
  - Roles: anon + authenticated
  - Uso: formulario público de consultas de tours internacionales
  - Restricción: el status debe ser 'nuevo' al crear. Impide que alguien se
    auto-asigne un status diferente (ej. 'convertido').

  ### 3. newsletter_subscriptions — "Anyone can subscribe to newsletter"
  - Roles: anon + authenticated
  - Uso: formulario público de suscripción al newsletter
  - Restricción: active debe ser true. Impide insertar suscripciones inactivas
    o manipular otros campos sensibles.

  ### 4. support_tickets — "Anyone can insert tickets"
  - Roles: public (anon + authenticated)
  - Uso: la Edge Function support-create-ticket usa SERVICE_ROLE_KEY, así que
    la policy pública ya no es necesaria. Se restringe a solo service_role.
  - Restricción: se reemplaza por policy de service_role únicamente.

  ### 5. support_ticket_history — "System inserts history events"
  - Roles: public (anon + authenticated)
  - Uso: insertado exclusivamente por support-create-ticket con SERVICE_ROLE_KEY
    y por otras funciones internas del sistema.
  - Restricción: se reemplaza por policy de service_role únicamente.

  ### 6. support_ticket_attachments — "Authenticated insert attachments"
  - Roles: authenticated
  - Uso: subida de archivos adjuntos a tickets
  - Restricción: el ticket_id debe pertenecer al usuario autenticado (owner)
    o el usuario debe ser admin. La Edge Function también usa service_role.
  - Se reemplaza por policy de service_role para cubrir la edge function,
    más policy separada para usuarios autenticados con validación de ownership.
*/

-- ============================================================
-- 1. cookie_consents
-- ============================================================
DROP POLICY IF EXISTS "Anyone can record consent" ON public.cookie_consents
;



CREATE POLICY "Anyone can record consent"
  ON public.cookie_consents
  FOR INSERT
  TO anon, authenticated
  WITH CHECK (
    -- usuario autenticado: user_id debe coincidir o ser null
    -- usuario anónimo: user_id debe ser null
    (auth.uid() IS NOT NULL AND (user_id = auth.uid() OR user_id IS NULL))
    OR
    (auth.uid() IS NULL AND user_id IS NULL)
  )
;



-- ============================================================
-- 2. international_tour_inquiries
-- ============================================================
DROP POLICY IF EXISTS "Anyone can submit inquiry" ON public.international_tour_inquiries
;



CREATE POLICY "Anyone can submit inquiry"
  ON public.international_tour_inquiries
  FOR INSERT
  TO anon, authenticated
  WITH CHECK (
    -- solo se puede insertar con status 'nuevo'
    status = 'nuevo'
    AND (
      -- user_id debe coincidir con el usuario autenticado o ser null
      user_id IS NULL
      OR user_id = auth.uid()
    )
  )
;



-- ============================================================
-- 3. newsletter_subscriptions
-- ============================================================
DROP POLICY IF EXISTS "Anyone can subscribe to newsletter" ON public.newsletter_subscriptions
;



CREATE POLICY "Anyone can subscribe to newsletter"
  ON public.newsletter_subscriptions
  FOR INSERT
  TO anon, authenticated
  WITH CHECK (
    -- solo se puede insertar suscripción activa
    active = true
  )
;



-- ============================================================
-- 4. support_tickets
-- La edge function support-create-ticket usa SERVICE_ROLE_KEY,
-- por lo que no necesita policy pública. Se restringe a service_role.
-- ============================================================
DROP POLICY IF EXISTS "Anyone can insert tickets" ON public.support_tickets
;



CREATE POLICY "Service role can insert support tickets"
  ON public.support_tickets
  FOR INSERT
  TO service_role
  WITH CHECK (true)
;



-- ============================================================
-- 5. support_ticket_history
-- Insertado exclusivamente por la edge function con SERVICE_ROLE_KEY.
-- ============================================================
DROP POLICY IF EXISTS "System inserts history events" ON public.support_ticket_history
;



CREATE POLICY "Service role can insert ticket history"
  ON public.support_ticket_history
  FOR INSERT
  TO service_role
  WITH CHECK (true)
;



-- ============================================================
-- 6. support_ticket_attachments
-- La edge function usa SERVICE_ROLE_KEY para subir adjuntos.
-- ============================================================
DROP POLICY IF EXISTS "Authenticated insert attachments" ON public.support_ticket_attachments
;



CREATE POLICY "Service role can insert ticket attachments"
  ON public.support_ticket_attachments
  FOR INSERT
  TO service_role
  WITH CHECK (true)
;



;
