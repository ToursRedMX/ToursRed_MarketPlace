-- ============================================================================
-- EXPORTACION FUNCIONAL desde supabase_migrations.schema_migrations
--
-- Este archivo NO es la migracion original: es el SQL que la base registro
-- haber ejecutado, reconstruido a partir del ledger.
--
--   version: 20260527185535
--   name:    20260527_revoke_anon_execute_security_definer_functions
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
  # Revocar EXECUTE de anon en funciones SECURITY DEFINER

  ## Descripción
  Todas las funciones SECURITY DEFINER en public heredan por defecto EXECUTE
  para todos los roles incluyendo `anon`. Esto significa que un visitante sin
  sesión puede llamarlas vía /rest/v1/rpc/, lo cual no es intencional.

  La corrección es REVOCAR el permiso de `anon` en todas estas funciones.
  Las funciones que necesitan ser llamadas desde el frontend lo hacen con un usuario
  autenticado (rol `authenticated`), no anónimo.

  ## Categorías de funciones

  ### Grupo A: Triggers y funciones de sistema interno
  Solo son invocadas por triggers de Postgres. Se revoca anon Y authenticated.

  ### Grupo B: Funciones de cron / procesos automáticos
  Solo las llama pg_cron con service_role. Se revoca anon y authenticated.

  ### Grupo C: Funciones de admin con validación interna
  Se mantiene authenticated, se revoca anon.

  ### Grupo D: Funciones internas / Edge Functions (service_role)
  Se revoca anon. Se mantiene authenticated donde aplique.

  ## Notas
  - service_role siempre mantiene EXECUTE (no se revoca)
  - Los triggers siguen funcionando independientemente de los permisos de roles
  - Las funciones de catálogo público (tours, promociones, búsqueda) mantienen anon
*/

-- ============================================================
-- GRUPO A: Funciones trigger — revocar anon Y authenticated
-- ============================================================
REVOKE EXECUTE ON FUNCTION public.update_accounting_sync_log_updated_at() FROM anon, authenticated
;


REVOKE EXECUTE ON FUNCTION public.update_admin_permissions_updated_at() FROM anon, authenticated
;


REVOKE EXECUTE ON FUNCTION public.update_agency_payouts_updated_at() FROM anon, authenticated
;


REVOKE EXECUTE ON FUNCTION public.update_booking_cancellations_updated_at() FROM anon, authenticated
;


REVOKE EXECUTE ON FUNCTION public.update_booking_partial_cancellations_updated_at() FROM anon, authenticated
;


REVOKE EXECUTE ON FUNCTION public.update_cancellation_penalty_records_updated_at() FROM anon, authenticated
;


REVOKE EXECUTE ON FUNCTION public.update_cfdi_invoice_updated_at() FROM anon, authenticated
;


REVOKE EXECUTE ON FUNCTION public.update_conversation_last_message() FROM anon, authenticated
;


REVOKE EXECUTE ON FUNCTION public.update_departure_point_usage() FROM anon, authenticated
;


REVOKE EXECUTE ON FUNCTION public.update_departure_points_updated_at() FROM anon, authenticated
;


REVOKE EXECUTE ON FUNCTION public.update_financial_updated_at() FROM anon, authenticated
;


REVOKE EXECUTE ON FUNCTION public.update_gift_card_updated_at() FROM anon, authenticated
;


REVOKE EXECUTE ON FUNCTION public.update_integration_configs_updated_at() FROM anon, authenticated
;


REVOKE EXECUTE ON FUNCTION public.update_international_tour_inquiries_updated_at() FROM anon, authenticated
;


REVOKE EXECUTE ON FUNCTION public.update_membership_updated_at() FROM anon, authenticated
;


REVOKE EXECUTE ON FUNCTION public.update_payout_batches_updated_at() FROM anon, authenticated
;


REVOKE EXECUTE ON FUNCTION public.update_payout_schedules_updated_at() FROM anon, authenticated
;


REVOKE EXECUTE ON FUNCTION public.update_payout_totals() FROM anon, authenticated
;


REVOKE EXECUTE ON FUNCTION public.update_points_wallet_updated_at() FROM anon, authenticated
;


REVOKE EXECUTE ON FUNCTION public.update_slot_booked_count() FROM anon, authenticated
;


REVOKE EXECUTE ON FUNCTION public.update_support_ticket_updated_at() FROM anon, authenticated
;


REVOKE EXECUTE ON FUNCTION public.update_tour_promotions_updated_at() FROM anon, authenticated
;


REVOKE EXECUTE ON FUNCTION public.update_user_no_show_count() FROM anon, authenticated
;


REVOKE EXECUTE ON FUNCTION public.update_wallet_updated_at() FROM anon, authenticated
;


REVOKE EXECUTE ON FUNCTION public.update_zoho_oauth_tokens_updated_at() FROM anon, authenticated
;


REVOKE EXECUTE ON FUNCTION public.trigger_update_agency_rating_on_delete() FROM anon, authenticated
;


REVOKE EXECUTE ON FUNCTION public.trigger_update_agency_rating_on_insert() FROM anon, authenticated
;


REVOKE EXECUTE ON FUNCTION public.trigger_update_agency_rating_on_update() FROM anon, authenticated
;


REVOKE EXECUTE ON FUNCTION public.mark_message_edited() FROM anon, authenticated
;


REVOKE EXECUTE ON FUNCTION public.increment_discount_code_usage() FROM anon, authenticated
;


REVOKE EXECUTE ON FUNCTION public.create_referral_code_on_signup() FROM anon, authenticated
;


REVOKE EXECUTE ON FUNCTION public.create_wallet_for_new_user() FROM anon, authenticated
;


REVOKE EXECUTE ON FUNCTION public.sync_user_email() FROM anon, authenticated
;


REVOKE EXECUTE ON FUNCTION public.sync_membership_with_points_wallet() FROM anon, authenticated
;


REVOKE EXECUTE ON FUNCTION public.sync_tour_slots_capacity_on_schedule_update() FROM anon, authenticated
;


REVOKE EXECUTE ON FUNCTION public.sync_tour_slots_capacity_on_tour_update() FROM anon, authenticated
;


REVOKE EXECUTE ON FUNCTION public.auto_award_points_on_booking_completion() FROM anon, authenticated
;


REVOKE EXECUTE ON FUNCTION public.auto_refund_points_on_cancellation() FROM anon, authenticated
;


REVOKE EXECUTE ON FUNCTION public.award_points_on_payment() FROM anon, authenticated
;


REVOKE EXECUTE ON FUNCTION public.cancel_commissions_on_booking_cancel() FROM anon, authenticated
;


REVOKE EXECUTE ON FUNCTION public.create_commission_record() FROM anon, authenticated
;


REVOKE EXECUTE ON FUNCTION public.set_commission_tour_completion_date() FROM anon, authenticated
;


REVOKE EXECUTE ON FUNCTION public.check_referral_bonus_eligibility() FROM anon, authenticated
;


REVOKE EXECUTE ON FUNCTION public.handle_booking_approval_notification() FROM anon, authenticated
;


REVOKE EXECUTE ON FUNCTION public.handle_booking_cancellation_seats() FROM anon, authenticated
;


REVOKE EXECUTE ON FUNCTION public.record_booking_financial_transaction() FROM anon, authenticated
;


REVOKE EXECUTE ON FUNCTION public.record_cancellation_financial_transaction() FROM anon, authenticated
;


REVOKE EXECUTE ON FUNCTION public.validate_tour_belongs_to_agency() FROM anon, authenticated
;


REVOKE EXECUTE ON FUNCTION public.validate_tour_departure_points_count() FROM anon, authenticated
;


REVOKE EXECUTE ON FUNCTION public.uppercase_discount_code() FROM anon, authenticated
;


REVOKE EXECUTE ON FUNCTION public.auto_create_wallet_on_membership() FROM anon, authenticated
;



-- ============================================================
-- GRUPO B: Funciones de cron / procesos automáticos
-- ============================================================
REVOKE EXECUTE ON FUNCTION public.auto_accept_expired_reschedules() FROM anon, authenticated
;


REVOKE EXECUTE ON FUNCTION public.auto_accept_expired_slot_reschedules() FROM anon, authenticated
;


REVOKE EXECUTE ON FUNCTION public.auto_create_receptivo_slot_commissions() FROM anon, authenticated
;


REVOKE EXECUTE ON FUNCTION public.cleanup_abandoned_draft_bookings() FROM anon, authenticated
;


REVOKE EXECUTE ON FUNCTION public.cleanup_expired_notifications() FROM anon, authenticated
;


REVOKE EXECUTE ON FUNCTION public.expire_old_gift_cards() FROM anon, authenticated
;


REVOKE EXECUTE ON FUNCTION public.process_expired_points() FROM anon, authenticated
;


REVOKE EXECUTE ON FUNCTION public.process_membership_renewal_reminders() FROM anon, authenticated
;


REVOKE EXECUTE ON FUNCTION public.reset_monthly_service_fee_exemption() FROM anon, authenticated
;



-- ============================================================
-- GRUPO C: Funciones de admin — revocar anon, mantener authenticated
-- (validan el rol admin internamente)
-- ============================================================
REVOKE EXECUTE ON FUNCTION public.admin_adjust_points(uuid, integer, text) FROM anon
;


REVOKE EXECUTE ON FUNCTION public.promote_to_admin(text) FROM anon
;


REVOKE EXECUTE ON FUNCTION public.publish_new_terms_version(text, text, text, text, uuid) FROM anon
;


REVOKE EXECUTE ON FUNCTION public.delete_destination(uuid) FROM anon
;


REVOKE EXECUTE ON FUNCTION public.generate_accounting_entries_batch(date, date) FROM anon
;


REVOKE EXECUTE ON FUNCTION public.get_account_balances_full(integer, integer) FROM anon
;


REVOKE EXECUTE ON FUNCTION public.get_accounting_sync_stats() FROM anon
;


REVOKE EXECUTE ON FUNCTION public.get_balance_sheet(integer, integer) FROM anon
;


REVOKE EXECUTE ON FUNCTION public.get_cfdi_stats() FROM anon
;


REVOKE EXECUTE ON FUNCTION public.get_completed_receptivo_slots_with_commission_status() FROM anon
;


REVOKE EXECUTE ON FUNCTION public.get_completed_tours_with_commission_status() FROM anon
;


REVOKE EXECUTE ON FUNCTION public.get_income_statement(integer, integer, integer, integer) FROM anon
;


REVOKE EXECUTE ON FUNCTION public.get_trial_balance(integer, integer) FROM anon
;


REVOKE EXECUTE ON FUNCTION public.is_high_risk_traveler(uuid) FROM anon
;


REVOKE EXECUTE ON FUNCTION public.create_accounting_entry_for_booking(uuid) FROM anon
;


REVOKE EXECUTE ON FUNCTION public.create_accounting_entry_for_cancellation(uuid, text) FROM anon
;


REVOKE EXECUTE ON FUNCTION public.create_accounting_entry_for_payout(uuid) FROM anon
;


REVOKE EXECUTE ON FUNCTION public.create_accounting_entry_for_penalty_payout(uuid) FROM anon
;


REVOKE EXECUTE ON FUNCTION public.create_accounting_entry_for_tour_completion(uuid) FROM anon
;


REVOKE EXECUTE ON FUNCTION public.create_commission_records_for_receptivo_slot(uuid) FROM anon
;


REVOKE EXECUTE ON FUNCTION public.create_commission_records_for_tour(uuid) FROM anon
;



-- ============================================================
-- GRUPO D: Funciones internas — revocar anon
-- ============================================================

-- Helpers de autenticación usados en RLS (mantener authenticated)
REVOKE EXECUTE ON FUNCTION public.is_admin() FROM anon
;


REVOKE EXECUTE ON FUNCTION public.is_admin_user() FROM anon
;


REVOKE EXECUTE ON FUNCTION public.is_super_admin() FROM anon
;


REVOKE EXECUTE ON FUNCTION public.current_user_is_admin() FROM anon
;


REVOKE EXECUTE ON FUNCTION public.has_permission(text) FROM anon
;


REVOKE EXECUTE ON FUNCTION public.has_manage_messages_permission() FROM anon
;


REVOKE EXECUTE ON FUNCTION public.has_manage_travelers_permission() FROM anon
;



-- Funciones de puntos y wallet
REVOKE EXECUTE ON FUNCTION public.award_points_for_booking(uuid, uuid, numeric) FROM anon
;


REVOKE EXECUTE ON FUNCTION public.award_referral_bonus(uuid) FROM anon
;


REVOKE EXECUTE ON FUNCTION public.calculate_available_points(uuid) FROM anon
;


REVOKE EXECUTE ON FUNCTION public.check_can_use_points(uuid) FROM anon
;


REVOKE EXECUTE ON FUNCTION public.deduct_points_for_booking(uuid, uuid, integer) FROM anon
;


REVOKE EXECUTE ON FUNCTION public.deduct_points_for_partial_cancellation(uuid, uuid, uuid, integer) FROM anon
;


REVOKE EXECUTE ON FUNCTION public.get_or_create_points_wallet(uuid) FROM anon
;


REVOKE EXECUTE ON FUNCTION public.get_points_expiring_soon(integer) FROM anon
;


REVOKE EXECUTE ON FUNCTION public.redeem_points_for_booking(uuid, uuid, integer, numeric) FROM anon
;


REVOKE EXECUTE ON FUNCTION public.refund_points_for_cancellation(uuid, uuid) FROM anon
;


REVOKE EXECUTE ON FUNCTION public.refund_points_for_cancelled_booking(uuid, uuid, integer) FROM anon
;


REVOKE EXECUTE ON FUNCTION public.create_points_wallet_for_traveler(uuid) FROM anon
;


REVOKE EXECUTE ON FUNCTION public.update_wallet_balance(uuid, numeric, public.toursred_cash_transaction_type, text, uuid, text) FROM anon
;



-- Funciones de reservas y tours
REVOKE EXECUTE ON FUNCTION public.activate_draft_booking(uuid) FROM anon
;


REVOKE EXECUTE ON FUNCTION public.apply_discount_code(text, uuid, uuid, uuid, uuid) FROM anon
;


REVOKE EXECUTE ON FUNCTION public.cancel_booking_optional_services(uuid, boolean) FROM anon
;


REVOKE EXECUTE ON FUNCTION public.claim_booking_email_lock(uuid) FROM anon
;


REVOKE EXECUTE ON FUNCTION public.get_booking_payment_details(uuid) FROM anon
;


REVOKE EXECUTE ON FUNCTION public.get_or_create_slot(uuid, uuid, date) FROM anon
;


REVOKE EXECUTE ON FUNCTION public.is_tour_ready_for_payout(uuid) FROM anon
;


REVOKE EXECUTE ON FUNCTION public.release_seats(uuid) FROM anon
;


REVOKE EXECUTE ON FUNCTION public.reserve_seats(uuid, uuid, uuid, integer[], uuid) FROM anon
;


REVOKE EXECUTE ON FUNCTION public.toggle_agency_seat_block(uuid, uuid, integer, boolean, text, uuid) FROM anon
;


REVOKE EXECUTE ON FUNCTION public.update_booking_payment_status(uuid, text, text) FROM anon
;


REVOKE EXECUTE ON FUNCTION public.auto_generate_slots_for_range(uuid, date, date) FROM anon
;


REVOKE EXECUTE ON FUNCTION public.sync_tour_slots_capacity_for_tour(uuid) FROM anon
;


REVOKE EXECUTE ON FUNCTION public.get_alternative_slots_for_reschedule(uuid, uuid, integer) FROM anon
;


REVOKE EXECUTE ON FUNCTION public.get_confirmed_spots_in_reschedule(uuid) FROM anon
;


REVOKE EXECUTE ON FUNCTION public.get_next_available_slot(uuid) FROM anon
;


REVOKE EXECUTE ON FUNCTION public.get_pending_reschedule_for_booking(uuid) FROM anon
;


REVOKE EXECUTE ON FUNCTION public.get_reschedule_summary_for_tour(uuid) FROM anon
;


REVOKE EXECUTE ON FUNCTION public.get_tour_confirmed_attendees(uuid, uuid) FROM anon
;


REVOKE EXECUTE ON FUNCTION public.get_tour_slots_by_range(uuid, date, date) FROM anon
;



-- Funciones de mensajería
REVOKE EXECUTE ON FUNCTION public._get_user_conversations_internal(uuid) FROM anon
;


REVOKE EXECUTE ON FUNCTION public.create_conversation(text, text, uuid[], uuid, uuid) FROM anon
;


REVOKE EXECUTE ON FUNCTION public.create_conversation_with_participants(text, uuid[]) FROM anon
;


REVOKE EXECUTE ON FUNCTION public.create_conversation_with_participants(text, text, uuid, uuid, uuid[]) FROM anon
;


REVOKE EXECUTE ON FUNCTION public.get_conversation_messages(uuid) FROM anon
;


REVOKE EXECUTE ON FUNCTION public.get_user_conversations() FROM anon
;


REVOKE EXECUTE ON FUNCTION public.is_conversation_participant(uuid) FROM anon
;


REVOKE EXECUTE ON FUNCTION public.mark_conversation_read(uuid) FROM anon
;


REVOKE EXECUTE ON FUNCTION public.mark_messages_as_read(uuid) FROM anon
;


REVOKE EXECUTE ON FUNCTION public.send_message(uuid, text, text) FROM anon
;



-- Funciones de notificaciones
REVOKE EXECUTE ON FUNCTION public.create_notification(uuid, public.notification_type, text, text, jsonb, timestamptz) FROM anon
;


REVOKE EXECUTE ON FUNCTION public.create_user_notification(uuid, public.notification_type, text, text, jsonb, timestamptz) FROM anon
;


REVOKE EXECUTE ON FUNCTION public.get_unread_notifications_count() FROM anon
;


REVOKE EXECUTE ON FUNCTION public.get_unread_notifications_count(uuid) FROM anon
;


REVOKE EXECUTE ON FUNCTION public.get_user_notifications(integer, integer, boolean) FROM anon
;


REVOKE EXECUTE ON FUNCTION public.mark_all_notifications_as_read() FROM anon
;


REVOKE EXECUTE ON FUNCTION public.mark_notification_as_read(uuid) FROM anon
;


REVOKE EXECUTE ON FUNCTION public.mark_notifications_as_read(uuid[]) FROM anon
;



-- Funciones de agencia / staff
REVOKE EXECUTE ON FUNCTION public.get_agency_financial_summary(uuid) FROM anon
;


REVOKE EXECUTE ON FUNCTION public.get_agency_owner_id(uuid) FROM anon
;


REVOKE EXECUTE ON FUNCTION public.get_agency_penalty_summary(uuid) FROM anon
;


REVOKE EXECUTE ON FUNCTION public.get_agency_request_ids(uuid) FROM anon
;


REVOKE EXECUTE ON FUNCTION public.get_agency_tours(uuid) FROM anon
;


REVOKE EXECUTE ON FUNCTION public.get_current_user_agency_id() FROM anon
;


REVOKE EXECUTE ON FUNCTION public.get_discount_code_details(uuid) FROM anon
;


REVOKE EXECUTE ON FUNCTION public.get_staff_agency_id(uuid) FROM anon
;


REVOKE EXECUTE ON FUNCTION public.get_staff_with_permissions(uuid) FROM anon
;


REVOKE EXECUTE ON FUNCTION public.update_agency_rating(uuid) FROM anon
;



-- Funciones de membresía
REVOKE EXECUTE ON FUNCTION public.get_available_service_fee_exemption(uuid) FROM anon
;


REVOKE EXECUTE ON FUNCTION public.get_remaining_service_fee_exemption(uuid) FROM anon
;


REVOKE EXECUTE ON FUNCTION public.has_active_membership(uuid) FROM anon
;



-- Funciones financieras/contables
REVOKE EXECUTE ON FUNCTION public.generate_batch_code(date) FROM anon
;


REVOKE EXECUTE ON FUNCTION public.generate_entry_number(text, integer, integer) FROM anon
;


REVOKE EXECUTE ON FUNCTION public.generate_gift_card_code() FROM anon
;


REVOKE EXECUTE ON FUNCTION public.generate_payout_code() FROM anon
;


REVOKE EXECUTE ON FUNCTION public.generate_ticket_folio(uuid) FROM anon
;


REVOKE EXECUTE ON FUNCTION public.generate_transaction_code() FROM anon
;


REVOKE EXECUTE ON FUNCTION public.generate_unique_referral_code() FROM anon
;


REVOKE EXECUTE ON FUNCTION public.check_entry_balance(uuid) FROM anon
;



;
