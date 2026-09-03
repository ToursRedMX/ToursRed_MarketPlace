-- ============================================================================
-- EXPORTACION FUNCIONAL desde supabase_migrations.schema_migrations
--
-- Este archivo NO es la migracion original: es el SQL que la base registro
-- haber ejecutado, reconstruido a partir del ledger.
--
--   version: 20260624014949
--   name:    sync_function_permissions_staging_to_production
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


-- Revocar permisos excesivos de anon y authenticated en funciones SECURITY DEFINER
-- para igualar staging con produccion

-- REVOKE PUBLIC (=X) que staging tiene y produccion no
REVOKE EXECUTE ON FUNCTION public.record_booking_financial_transaction() FROM PUBLIC
;


REVOKE EXECUTE ON FUNCTION public.record_cancellation_financial_transaction() FROM PUBLIC
;



-- REVOKE anon en funciones internas que no deben ser publicas
REVOKE EXECUTE ON FUNCTION public.admin_adjust_points(uuid, integer, text) FROM anon
;


REVOKE EXECUTE ON FUNCTION public.auto_accept_expired_reschedules() FROM anon
;


REVOKE EXECUTE ON FUNCTION public.auto_accept_expired_slot_reschedules() FROM anon
;


REVOKE EXECUTE ON FUNCTION public.auto_award_points_on_booking_completion() FROM anon
;


REVOKE EXECUTE ON FUNCTION public.auto_create_receptivo_slot_commissions() FROM anon
;


REVOKE EXECUTE ON FUNCTION public.auto_create_wallet_on_membership() FROM anon
;


REVOKE EXECUTE ON FUNCTION public.auto_generate_slots_for_range(uuid, date, date) FROM anon
;


REVOKE EXECUTE ON FUNCTION public.auto_refund_points_on_cancellation() FROM anon
;


REVOKE EXECUTE ON FUNCTION public.award_points_for_booking(uuid, uuid, numeric) FROM anon
;


REVOKE EXECUTE ON FUNCTION public.award_points_on_payment() FROM anon
;


REVOKE EXECUTE ON FUNCTION public.award_referral_bonus(uuid) FROM anon
;


REVOKE EXECUTE ON FUNCTION public.cancel_booking_optional_services(uuid, boolean) FROM anon
;


REVOKE EXECUTE ON FUNCTION public.cancel_commissions_on_booking_cancel() FROM anon
;


REVOKE EXECUTE ON FUNCTION public.check_referral_bonus_eligibility() FROM anon
;


REVOKE EXECUTE ON FUNCTION public.cleanup_abandoned_draft_bookings() FROM anon
;


REVOKE EXECUTE ON FUNCTION public.cleanup_expired_notifications() FROM anon
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


REVOKE EXECUTE ON FUNCTION public.create_commission_record() FROM anon
;


REVOKE EXECUTE ON FUNCTION public.create_commission_records_for_receptivo_slot(uuid) FROM anon
;


REVOKE EXECUTE ON FUNCTION public.create_commission_records_for_tour(uuid) FROM anon
;


REVOKE EXECUTE ON FUNCTION public.create_conversation_with_participants(text, text, uuid, uuid, uuid[]) FROM anon
;


REVOKE EXECUTE ON FUNCTION public.create_conversation_with_participants(text, uuid[]) FROM anon
;


REVOKE EXECUTE ON FUNCTION public.create_notification(uuid, notification_type, text, text, jsonb, timestamptz) FROM anon
;


REVOKE EXECUTE ON FUNCTION public.create_points_wallet_for_traveler(uuid) FROM anon
;


REVOKE EXECUTE ON FUNCTION public.create_referral_code_on_signup() FROM anon
;


REVOKE EXECUTE ON FUNCTION public.create_user_notification(uuid, notification_type, text, text, jsonb, timestamptz) FROM anon
;


REVOKE EXECUTE ON FUNCTION public.create_wallet_for_new_user() FROM anon
;


REVOKE EXECUTE ON FUNCTION public.current_user_is_admin() FROM anon
;


REVOKE EXECUTE ON FUNCTION public.deduct_points_for_booking(uuid, uuid, integer) FROM anon
;


REVOKE EXECUTE ON FUNCTION public.deduct_points_for_partial_cancellation(uuid, uuid, uuid, integer) FROM anon
;


REVOKE EXECUTE ON FUNCTION public.delete_destination(uuid) FROM anon
;


REVOKE EXECUTE ON FUNCTION public.expire_old_gift_cards() FROM anon
;


REVOKE EXECUTE ON FUNCTION public.generate_accounting_entries_batch(date, date) FROM anon
;


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


REVOKE EXECUTE ON FUNCTION public.get_current_user_agency_id() FROM anon
;


REVOKE EXECUTE ON FUNCTION public.get_or_create_points_wallet(uuid) FROM anon
;


REVOKE EXECUTE ON FUNCTION public.handle_booking_approval_notification() FROM anon
;


REVOKE EXECUTE ON FUNCTION public.has_manage_travelers_permission() FROM anon
;


REVOKE EXECUTE ON FUNCTION public.increment_discount_code_usage() FROM anon
;


REVOKE EXECUTE ON FUNCTION public.is_admin_user() FROM anon
;


REVOKE EXECUTE ON FUNCTION public.is_conversation_participant(uuid) FROM anon
;


REVOKE EXECUTE ON FUNCTION public.is_super_admin() FROM anon
;


REVOKE EXECUTE ON FUNCTION public.mark_message_edited() FROM anon
;


REVOKE EXECUTE ON FUNCTION public.process_expired_points() FROM anon
;


REVOKE EXECUTE ON FUNCTION public.process_membership_renewal_reminders() FROM anon
;


REVOKE EXECUTE ON FUNCTION public.promote_to_admin(text) FROM anon
;


REVOKE EXECUTE ON FUNCTION public.publish_new_terms_version(text, text, text, text, uuid) FROM anon
;


REVOKE EXECUTE ON FUNCTION public.record_booking_financial_transaction() FROM anon
;


REVOKE EXECUTE ON FUNCTION public.record_cancellation_financial_transaction() FROM anon
;


REVOKE EXECUTE ON FUNCTION public.redeem_points_for_booking(uuid, uuid, integer, numeric) FROM anon
;


REVOKE EXECUTE ON FUNCTION public.refund_points_for_cancellation(uuid, uuid) FROM anon
;


REVOKE EXECUTE ON FUNCTION public.refund_points_for_cancelled_booking(uuid, uuid, integer) FROM anon
;


REVOKE EXECUTE ON FUNCTION public.reset_monthly_service_fee_exemption() FROM anon
;


REVOKE EXECUTE ON FUNCTION public.sync_membership_with_points_wallet() FROM anon
;


REVOKE EXECUTE ON FUNCTION public.sync_tour_slots_capacity_on_schedule_update() FROM anon
;


REVOKE EXECUTE ON FUNCTION public.sync_tour_slots_capacity_on_tour_update() FROM anon
;


REVOKE EXECUTE ON FUNCTION public.sync_user_email() FROM anon
;


REVOKE EXECUTE ON FUNCTION public.trigger_update_agency_rating_on_delete() FROM anon
;


REVOKE EXECUTE ON FUNCTION public.trigger_update_agency_rating_on_insert() FROM anon
;


REVOKE EXECUTE ON FUNCTION public.trigger_update_agency_rating_on_update() FROM anon
;


REVOKE EXECUTE ON FUNCTION public.update_accounting_sync_log_updated_at() FROM anon
;


REVOKE EXECUTE ON FUNCTION public.update_agency_rating(uuid) FROM anon
;


REVOKE EXECUTE ON FUNCTION public.update_booking_cancellations_updated_at() FROM anon
;


REVOKE EXECUTE ON FUNCTION public.update_booking_partial_cancellations_updated_at() FROM anon
;


REVOKE EXECUTE ON FUNCTION public.update_booking_payment_status(uuid, text, text) FROM anon
;


REVOKE EXECUTE ON FUNCTION public.update_cancellation_penalty_records_updated_at() FROM anon
;


REVOKE EXECUTE ON FUNCTION public.update_cfdi_invoice_updated_at() FROM anon
;


REVOKE EXECUTE ON FUNCTION public.update_conversation_last_message() FROM anon
;


REVOKE EXECUTE ON FUNCTION public.update_departure_point_usage() FROM anon
;


REVOKE EXECUTE ON FUNCTION public.update_departure_points_updated_at() FROM anon
;


REVOKE EXECUTE ON FUNCTION public.update_financial_updated_at() FROM anon
;


REVOKE EXECUTE ON FUNCTION public.update_gift_card_updated_at() FROM anon
;


REVOKE EXECUTE ON FUNCTION public.update_international_tour_inquiries_updated_at() FROM anon
;


REVOKE EXECUTE ON FUNCTION public.update_membership_updated_at() FROM anon
;


REVOKE EXECUTE ON FUNCTION public.update_points_wallet_updated_at() FROM anon
;


REVOKE EXECUTE ON FUNCTION public.update_slot_booked_count() FROM anon
;


REVOKE EXECUTE ON FUNCTION public.update_support_ticket_updated_at() FROM anon
;


REVOKE EXECUTE ON FUNCTION public.update_tour_promotions_updated_at() FROM anon
;


REVOKE EXECUTE ON FUNCTION public.update_user_no_show_count() FROM anon
;


REVOKE EXECUTE ON FUNCTION public.update_wallet_balance(uuid, numeric, toursred_cash_transaction_type, text, uuid, text) FROM anon
;


REVOKE EXECUTE ON FUNCTION public.update_wallet_updated_at() FROM anon
;


REVOKE EXECUTE ON FUNCTION public.update_zoho_oauth_tokens_updated_at() FROM anon
;


REVOKE EXECUTE ON FUNCTION public.uppercase_discount_code() FROM anon
;


REVOKE EXECUTE ON FUNCTION public.validate_tour_belongs_to_agency() FROM anon
;


REVOKE EXECUTE ON FUNCTION public.validate_tour_departure_points_count() FROM anon
;



-- REVOKE authenticated en funciones internas que no deben ser accesibles por usuarios autenticados
REVOKE EXECUTE ON FUNCTION public.admin_adjust_points(uuid, integer, text) FROM authenticated
;


REVOKE EXECUTE ON FUNCTION public.auto_accept_expired_reschedules() FROM authenticated
;


REVOKE EXECUTE ON FUNCTION public.auto_accept_expired_slot_reschedules() FROM authenticated
;


REVOKE EXECUTE ON FUNCTION public.auto_award_points_on_booking_completion() FROM authenticated
;


REVOKE EXECUTE ON FUNCTION public.auto_create_receptivo_slot_commissions() FROM authenticated
;


REVOKE EXECUTE ON FUNCTION public.auto_create_wallet_on_membership() FROM authenticated
;


REVOKE EXECUTE ON FUNCTION public.auto_generate_slots_for_range(uuid, date, date) FROM authenticated
;


REVOKE EXECUTE ON FUNCTION public.auto_refund_points_on_cancellation() FROM authenticated
;


REVOKE EXECUTE ON FUNCTION public.award_points_for_booking(uuid, uuid, numeric) FROM authenticated
;


REVOKE EXECUTE ON FUNCTION public.award_points_on_payment() FROM authenticated
;


REVOKE EXECUTE ON FUNCTION public.award_referral_bonus(uuid) FROM authenticated
;


REVOKE EXECUTE ON FUNCTION public.cancel_booking_optional_services(uuid, boolean) FROM authenticated
;


REVOKE EXECUTE ON FUNCTION public.cancel_commissions_on_booking_cancel() FROM authenticated
;


REVOKE EXECUTE ON FUNCTION public.check_referral_bonus_eligibility() FROM authenticated
;


REVOKE EXECUTE ON FUNCTION public.cleanup_abandoned_draft_bookings() FROM authenticated
;


REVOKE EXECUTE ON FUNCTION public.cleanup_expired_notifications() FROM authenticated
;


REVOKE EXECUTE ON FUNCTION public.create_accounting_entry_for_booking(uuid) FROM authenticated
;


REVOKE EXECUTE ON FUNCTION public.create_accounting_entry_for_cancellation(uuid, text) FROM authenticated
;


REVOKE EXECUTE ON FUNCTION public.create_accounting_entry_for_payout(uuid) FROM authenticated
;


REVOKE EXECUTE ON FUNCTION public.create_accounting_entry_for_penalty_payout(uuid) FROM authenticated
;


REVOKE EXECUTE ON FUNCTION public.create_accounting_entry_for_tour_completion(uuid) FROM authenticated
;


REVOKE EXECUTE ON FUNCTION public.create_commission_record() FROM authenticated
;


REVOKE EXECUTE ON FUNCTION public.create_commission_records_for_receptivo_slot(uuid) FROM authenticated
;


REVOKE EXECUTE ON FUNCTION public.create_commission_records_for_tour(uuid) FROM authenticated
;


REVOKE EXECUTE ON FUNCTION public.create_conversation_with_participants(text, text, uuid, uuid, uuid[]) FROM authenticated
;


REVOKE EXECUTE ON FUNCTION public.create_conversation_with_participants(text, uuid[]) FROM authenticated
;


REVOKE EXECUTE ON FUNCTION public.create_notification(uuid, notification_type, text, text, jsonb, timestamptz) FROM authenticated
;


REVOKE EXECUTE ON FUNCTION public.create_points_wallet_for_traveler(uuid) FROM authenticated
;


REVOKE EXECUTE ON FUNCTION public.create_referral_code_on_signup() FROM authenticated
;


REVOKE EXECUTE ON FUNCTION public.create_user_notification(uuid, notification_type, text, text, jsonb, timestamptz) FROM authenticated
;


REVOKE EXECUTE ON FUNCTION public.create_wallet_for_new_user() FROM authenticated
;


REVOKE EXECUTE ON FUNCTION public.current_user_is_admin() FROM authenticated
;


REVOKE EXECUTE ON FUNCTION public.deduct_points_for_booking(uuid, uuid, integer) FROM authenticated
;


REVOKE EXECUTE ON FUNCTION public.deduct_points_for_partial_cancellation(uuid, uuid, uuid, integer) FROM authenticated
;


REVOKE EXECUTE ON FUNCTION public.delete_destination(uuid) FROM authenticated
;


REVOKE EXECUTE ON FUNCTION public.expire_old_gift_cards() FROM authenticated
;


REVOKE EXECUTE ON FUNCTION public.generate_accounting_entries_batch(date, date) FROM authenticated
;


REVOKE EXECUTE ON FUNCTION public.generate_batch_code(date) FROM authenticated
;


REVOKE EXECUTE ON FUNCTION public.generate_entry_number(text, integer, integer) FROM authenticated
;


REVOKE EXECUTE ON FUNCTION public.generate_gift_card_code() FROM authenticated
;


REVOKE EXECUTE ON FUNCTION public.generate_payout_code() FROM authenticated
;


REVOKE EXECUTE ON FUNCTION public.generate_ticket_folio(uuid) FROM authenticated
;


REVOKE EXECUTE ON FUNCTION public.generate_transaction_code() FROM authenticated
;


REVOKE EXECUTE ON FUNCTION public.generate_unique_referral_code() FROM authenticated
;


REVOKE EXECUTE ON FUNCTION public.get_current_user_agency_id() FROM authenticated
;


REVOKE EXECUTE ON FUNCTION public.get_or_create_points_wallet(uuid) FROM authenticated
;


REVOKE EXECUTE ON FUNCTION public.handle_booking_approval_notification() FROM authenticated
;


REVOKE EXECUTE ON FUNCTION public.has_manage_travelers_permission() FROM authenticated
;


REVOKE EXECUTE ON FUNCTION public.increment_discount_code_usage() FROM authenticated
;


REVOKE EXECUTE ON FUNCTION public.is_admin_user() FROM authenticated
;


REVOKE EXECUTE ON FUNCTION public.is_conversation_participant(uuid) FROM authenticated
;


REVOKE EXECUTE ON FUNCTION public.is_super_admin() FROM authenticated
;


REVOKE EXECUTE ON FUNCTION public.mark_message_edited() FROM authenticated
;


REVOKE EXECUTE ON FUNCTION public.process_expired_points() FROM authenticated
;


REVOKE EXECUTE ON FUNCTION public.process_membership_renewal_reminders() FROM authenticated
;


REVOKE EXECUTE ON FUNCTION public.promote_to_admin(text) FROM authenticated
;


REVOKE EXECUTE ON FUNCTION public.publish_new_terms_version(text, text, text, text, uuid) FROM authenticated
;


REVOKE EXECUTE ON FUNCTION public.record_booking_financial_transaction() FROM authenticated
;


REVOKE EXECUTE ON FUNCTION public.record_cancellation_financial_transaction() FROM authenticated
;


REVOKE EXECUTE ON FUNCTION public.redeem_points_for_booking(uuid, uuid, integer, numeric) FROM authenticated
;


REVOKE EXECUTE ON FUNCTION public.refund_points_for_cancellation(uuid, uuid) FROM authenticated
;


REVOKE EXECUTE ON FUNCTION public.refund_points_for_cancelled_booking(uuid, uuid, integer) FROM authenticated
;


REVOKE EXECUTE ON FUNCTION public.reset_monthly_service_fee_exemption() FROM authenticated
;


REVOKE EXECUTE ON FUNCTION public.sync_membership_with_points_wallet() FROM authenticated
;


REVOKE EXECUTE ON FUNCTION public.sync_tour_slots_capacity_on_schedule_update() FROM authenticated
;


REVOKE EXECUTE ON FUNCTION public.sync_tour_slots_capacity_on_tour_update() FROM authenticated
;


REVOKE EXECUTE ON FUNCTION public.sync_user_email() FROM authenticated
;


REVOKE EXECUTE ON FUNCTION public.trigger_update_agency_rating_on_delete() FROM authenticated
;


REVOKE EXECUTE ON FUNCTION public.trigger_update_agency_rating_on_insert() FROM authenticated
;


REVOKE EXECUTE ON FUNCTION public.trigger_update_agency_rating_on_update() FROM authenticated
;


REVOKE EXECUTE ON FUNCTION public.update_accounting_sync_log_updated_at() FROM authenticated
;


REVOKE EXECUTE ON FUNCTION public.update_agency_rating(uuid) FROM authenticated
;


REVOKE EXECUTE ON FUNCTION public.update_booking_cancellations_updated_at() FROM authenticated
;


REVOKE EXECUTE ON FUNCTION public.update_booking_partial_cancellations_updated_at() FROM authenticated
;


REVOKE EXECUTE ON FUNCTION public.update_booking_payment_status(uuid, text, text) FROM authenticated
;


REVOKE EXECUTE ON FUNCTION public.update_cancellation_penalty_records_updated_at() FROM authenticated
;


REVOKE EXECUTE ON FUNCTION public.update_cfdi_invoice_updated_at() FROM authenticated
;


REVOKE EXECUTE ON FUNCTION public.update_conversation_last_message() FROM authenticated
;


REVOKE EXECUTE ON FUNCTION public.update_departure_point_usage() FROM authenticated
;


REVOKE EXECUTE ON FUNCTION public.update_departure_points_updated_at() FROM authenticated
;


REVOKE EXECUTE ON FUNCTION public.update_financial_updated_at() FROM authenticated
;


REVOKE EXECUTE ON FUNCTION public.update_gift_card_updated_at() FROM authenticated
;


REVOKE EXECUTE ON FUNCTION public.update_international_tour_inquiries_updated_at() FROM authenticated
;


REVOKE EXECUTE ON FUNCTION public.update_membership_updated_at() FROM authenticated
;


REVOKE EXECUTE ON FUNCTION public.update_points_wallet_updated_at() FROM authenticated
;


REVOKE EXECUTE ON FUNCTION public.update_slot_booked_count() FROM authenticated
;


REVOKE EXECUTE ON FUNCTION public.update_support_ticket_updated_at() FROM authenticated
;


REVOKE EXECUTE ON FUNCTION public.update_tour_promotions_updated_at() FROM authenticated
;


REVOKE EXECUTE ON FUNCTION public.update_user_no_show_count() FROM authenticated
;


REVOKE EXECUTE ON FUNCTION public.update_wallet_balance(uuid, numeric, toursred_cash_transaction_type, text, uuid, text) FROM authenticated
;


REVOKE EXECUTE ON FUNCTION public.update_wallet_updated_at() FROM authenticated
;


REVOKE EXECUTE ON FUNCTION public.update_zoho_oauth_tokens_updated_at() FROM authenticated
;


REVOKE EXECUTE ON FUNCTION public.uppercase_discount_code() FROM authenticated
;


REVOKE EXECUTE ON FUNCTION public.validate_tour_belongs_to_agency() FROM authenticated
;


REVOKE EXECUTE ON FUNCTION public.validate_tour_departure_points_count() FROM authenticated
;



-- Tambien revocar de funciones que staging tiene con authenticated extra vs produccion
-- Notar: update_admin_permissions_updated_at, update_agency_payouts_updated_at, update_payout_batches_updated_at,
-- update_payout_schedules_updated_at, set_commission_tour_completion_date, release_seats, reserve_seats
-- cleanup_orphaned_identities - verificar en staging si tienen exceso
-- Estas ya no aparecen en el listado de staging (fueron OK o no existen), se omiten.

;
