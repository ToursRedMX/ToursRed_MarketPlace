-- ============================================================================
-- EXPORTACION FUNCIONAL desde supabase_migrations.schema_migrations
--
-- Este archivo NO es la migracion original: es el SQL que la base registro
-- haber ejecutado, reconstruido a partir del ledger.
--
--   version: 20260620223945
--   name:    20260620_fix_views_auth_uid_wrapper_performance
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

-- Fix performance warnings in views: replace auth.uid() with (SELECT auth.uid()) 

CREATE OR REPLACE VIEW public.stripe_user_orders WITH (security_invoker = on) AS
  SELECT c.customer_id,
    o.id AS order_id,
    o.checkout_session_id,
    o.payment_intent_id,
    o.amount_subtotal,
    o.amount_total,
    o.currency,
    o.payment_status,
    o.status AS order_status,
    o.created_at AS order_date
  FROM (stripe_customers c
    LEFT JOIN stripe_orders o ON ((c.customer_id = o.customer_id)))
  WHERE ((c.user_id = (SELECT auth.uid())) AND (c.deleted_at IS NULL) AND (o.deleted_at IS NULL))
;



CREATE OR REPLACE VIEW public.stripe_user_subscriptions WITH (security_invoker = on) AS
  SELECT c.customer_id,
    s.subscription_id,
    s.status AS subscription_status,
    s.price_id,
    s.current_period_start,
    s.current_period_end,
    s.cancel_at_period_end,
    s.payment_method_brand,
    s.payment_method_last4
  FROM (stripe_customers c
    LEFT JOIN stripe_subscriptions s ON ((c.customer_id = s.customer_id)))
  WHERE ((c.user_id = (SELECT auth.uid())) AND (c.deleted_at IS NULL) AND (s.deleted_at IS NULL))
;



;
