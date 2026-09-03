-- ============================================================================
-- EXPORTACION FUNCIONAL desde supabase_migrations.schema_migrations
--
-- Este archivo NO es la migracion original: es el SQL que la base registro
-- haber ejecutado, reconstruido a partir del ledger.
--
--   version: 20260527191051
--   name:    20260527_revoke_authenticated_internal_security_definer_functions
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
  # Revocar EXECUTE de `authenticated` en funciones SECURITY DEFINER internas

  ## Objetivo
  Eliminar el acceso directo vía REST/RPC para usuarios autenticados a funciones
  que son exclusivamente internas: generadoras de códigos, contabilidad, puntos,
  comisiones, triggers y operaciones admin-only.

  ## Funciones que CONSERVAN acceso `authenticated` (RPCs llamadas desde el frontend)
  Todas las funciones get_*, is_*, has_*, mark_*, validate_*, calculate_*, search_*,
  send_message, get_user_conversations, activate_draft_booking, apply_discount_code,
  y demás RPCs de negocio que los usuarios logueados invocan directamente.

  ## Notas de seguridad
  - `service_role` siempre conserva EXECUTE (no es afectado por REVOKE)
  - Funciones de trigger son invocadas por Postgres internamente
  - Cron jobs usan service_role
*/

-- ============================================================
-- Generadores de códigos internos
-- ============================================================
REVOKE EXECUTE ON FUNCTION public.generate_random_alphanumeric(integer)
  FROM authenticated
;



REVOKE EXECUTE ON FUNCTION public.generate_unique_booking_code()
  FROM authenticated
;



REVOKE EXECUTE ON FUNCTION public.generate_unique_referral_code()
  FROM authenticated
;



REVOKE EXECUTE ON FUNCTION public.generate_gift_card_code()
  FROM authenticated
;



REVOKE EXECUTE ON FUNCTION public.generate_payout_code()
  FROM authenticated
;



REVOKE EXECUTE ON FUNCTION public.generate_transaction_code()
  FROM authenticated
;



REVOKE EXECUTE ON FUNCTION public.generate_batch_code(date)
  FROM authenticated
;



REVOKE EXECUTE ON FUNCTION public.generate_entry_number(text, integer, integer)
  FROM authenticated
;



REVOKE EXECUTE ON FUNCTION public.generate_ticket_folio(uuid)
  FROM authenticated
;



-- ============================================================
-- Gestión de puntos (solo edge functions con service_role)
-- ============================================================
REVOKE EXECUTE ON FUNCTION public.award_points_for_booking(uuid, uuid, numeric)
  FROM authenticated
;



REVOKE EXECUTE ON FUNCTION public.deduct_points_for_booking(uuid, uuid, integer)
  FROM authenticated
;



REVOKE EXECUTE ON FUNCTION public.deduct_points_for_partial_cancellation(uuid, uuid, uuid, integer)
  FROM authenticated
;



REVOKE EXECUTE ON FUNCTION public.redeem_points_for_booking(uuid, uuid, integer, numeric)
  FROM authenticated
;



REVOKE EXECUTE ON FUNCTION public.refund_points_for_cancellation(uuid, uuid)
  FROM authenticated
;



REVOKE EXECUTE ON FUNCTION public.refund_points_for_cancelled_booking(uuid, uuid, integer)
  FROM authenticated
;



REVOKE EXECUTE ON FUNCTION public.get_or_create_points_wallet(uuid)
  FROM authenticated
;



REVOKE EXECUTE ON FUNCTION public.create_points_wallet_for_traveler(uuid)
  FROM authenticated
;



REVOKE EXECUTE ON FUNCTION public.admin_adjust_points(uuid, integer, text)
  FROM authenticated
;



-- ============================================================
-- Notificaciones internas (triggers y edge functions)
-- ============================================================
REVOKE EXECUTE ON FUNCTION public.create_notification(uuid, notification_type, text, text, jsonb, timestamp with time zone)
  FROM authenticated
;



REVOKE EXECUTE ON FUNCTION public.create_user_notification(uuid, notification_type, text, text, jsonb, timestamp with time zone)
  FROM authenticated
;



-- ============================================================
-- Comisiones y contabilidad (service_role / cron)
-- ============================================================
REVOKE EXECUTE ON FUNCTION public.create_commission_records_for_tour(uuid)
  FROM authenticated
;



REVOKE EXECUTE ON FUNCTION public.create_commission_records_for_receptivo_slot(uuid)
  FROM authenticated
;



REVOKE EXECUTE ON FUNCTION public.create_accounting_entry_for_booking(uuid)
  FROM authenticated
;



REVOKE EXECUTE ON FUNCTION public.create_accounting_entry_for_cancellation(uuid, text)
  FROM authenticated
;



REVOKE EXECUTE ON FUNCTION public.create_accounting_entry_for_payout(uuid)
  FROM authenticated
;



REVOKE EXECUTE ON FUNCTION public.create_accounting_entry_for_penalty_payout(uuid)
  FROM authenticated
;



REVOKE EXECUTE ON FUNCTION public.create_accounting_entry_for_tour_completion(uuid)
  FROM authenticated
;



REVOKE EXECUTE ON FUNCTION public.generate_accounting_entries_batch(date, date)
  FROM authenticated
;



-- ============================================================
-- Operaciones de reservas (edge functions service_role)
-- ============================================================
REVOKE EXECUTE ON FUNCTION public.cancel_booking_optional_services(uuid, boolean)
  FROM authenticated
;



REVOKE EXECUTE ON FUNCTION public.reserve_seats(uuid, uuid, uuid, integer[], uuid)
  FROM authenticated
;



REVOKE EXECUTE ON FUNCTION public.release_seats(uuid)
  FROM authenticated
;



REVOKE EXECUTE ON FUNCTION public.award_referral_bonus(uuid)
  FROM authenticated
;



-- ============================================================
-- Gestión de slots / tours (admin / cron)
-- ============================================================
REVOKE EXECUTE ON FUNCTION public.auto_generate_slots_for_range(uuid, date, date)
  FROM authenticated
;



REVOKE EXECUTE ON FUNCTION public.sync_tour_slots_capacity_for_tour(uuid)
  FROM authenticated
;



-- ============================================================
-- Trigger de rating (invocado por Postgres internamente)
-- ============================================================
REVOKE EXECUTE ON FUNCTION public.update_agency_rating(uuid)
  FROM authenticated
;



-- ============================================================
-- Administración exclusiva (super admin vía service_role)
-- ============================================================
REVOKE EXECUTE ON FUNCTION public.promote_to_admin(text)
  FROM authenticated
;



REVOKE EXECUTE ON FUNCTION public.publish_new_terms_version(text, text, text, text, uuid)
  FROM authenticated
;



REVOKE EXECUTE ON FUNCTION public.delete_destination(uuid)
  FROM authenticated
;



-- ============================================================
-- check_admin_status: no recibe argumentos, helper interno
-- ============================================================
REVOKE EXECUTE ON FUNCTION public.check_admin_status()
  FROM authenticated
;



-- ============================================================
-- Mensajería: ambas sobrecargas de create_conversation_with_participants
-- Son llamadas internamente al crear conversaciones de soporte/booking
-- ============================================================
REVOKE EXECUTE ON FUNCTION public.create_conversation_with_participants(text, uuid[])
  FROM authenticated
;



REVOKE EXECUTE ON FUNCTION public.create_conversation_with_participants(text, text, uuid, uuid, uuid[])
  FROM authenticated
;



;
