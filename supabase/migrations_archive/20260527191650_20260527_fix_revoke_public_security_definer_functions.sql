
DO $$
DECLARE
  r RECORD;
  func_sig TEXT;
  -- Functions that should remain accessible to anon (public catalog browsing)
  anon_whitelist TEXT[] := ARRAY[
    'calculate_preventa_precio',
    'calculate_transaction_breakdown',
    'check_user_code_usage',
    'get_active_promotion_for_tour',
    'get_active_terms',
    'get_agency_reviews_with_users',
    'get_departure_location_suggestions',
    'get_optional_service_available_capacity',
    'get_optional_services_capacity',
    'get_preventa_bookings_count',
    'get_promotions_for_tours',
    'get_seat_map_availability',
    'get_tour_availability',
    'get_tour_availability_v2',
    'get_tours_for_departure_point',
    'get_traveler_reschedule_request_ids',
    'increment_geocoding_cache_usage',
    'search_departure_points',
    'search_featured_pois',
    'validate_agency_discount_code',
    'validate_discount_code',
    'validate_tour_discount_code'
  ];
  -- Functions that need authenticated access (called from frontend by logged-in users)
  authenticated_list TEXT[] := ARRAY[
    '_get_user_conversations_internal',
    'activate_draft_booking',
    'apply_discount_code',
    'calculate_available_points',
    'check_can_use_points',
    'check_entry_balance',
    'claim_booking_email_lock',
    'create_conversation',
    'current_user_is_admin',
    'get_account_balances_full',
    'get_accounting_sync_stats',
    'get_agency_financial_summary',
    'get_agency_owner_id',
    'get_agency_penalty_summary',
    'get_agency_request_ids',
    'get_agency_tours',
    'get_alternative_slots_for_reschedule',
    'get_available_service_fee_exemption',
    'get_balance_sheet',
    'get_booking_payment_details',
    'get_cfdi_stats',
    'get_completed_receptivo_slots_with_commission_status',
    'get_completed_tours_with_commission_status',
    'get_confirmed_spots_in_reschedule',
    'get_conversation_messages',
    'get_current_user_agency_id',
    'get_discount_code_details',
    'get_income_statement',
    'get_next_available_slot',
    'get_or_create_slot',
    'get_pending_reschedule_for_booking',
    'get_points_expiring_soon',
    'get_remaining_service_fee_exemption',
    'get_reschedule_summary_for_tour',
    'get_staff_agency_id',
    'get_staff_with_permissions',
    'get_tour_confirmed_attendees',
    'get_tour_slots_by_range',
    'get_trial_balance',
    'get_unread_notifications_count',
    'get_user_conversations',
    'get_user_notifications',
    'has_active_membership',
    'has_manage_messages_permission',
    'has_manage_travelers_permission',
    'has_permission',
    'is_admin',
    'is_admin_user',
    'is_conversation_participant',
    'is_high_risk_traveler',
    'is_super_admin',
    'is_tour_ready_for_payout',
    'mark_all_notifications_as_read',
    'mark_conversation_read',
    'mark_messages_as_read',
    'mark_notification_as_read',
    'mark_notifications_as_read',
    'send_message',
    'toggle_agency_seat_block',
    'update_booking_payment_status',
    'update_wallet_balance'
  ];
BEGIN
  FOR r IN
    SELECT
      p.oid,
      p.proname,
      pg_get_function_identity_arguments(p.oid) AS identity_args
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.prosecdef = true
      AND (p.proacl IS NULL OR p.proacl::text LIKE '%=X/%')
      AND p.proname != ALL(anon_whitelist)
  LOOP
    func_sig := 'public.' || quote_ident(r.proname) || '(' || r.identity_args || ')';

    -- Step 1: Revoke from PUBLIC (removes =X/postgres entry)
    EXECUTE 'REVOKE EXECUTE ON FUNCTION ' || func_sig || ' FROM PUBLIC';

    -- Step 2: Re-grant to authenticated if needed
    IF r.proname = ANY(authenticated_list) THEN
      EXECUTE 'GRANT EXECUTE ON FUNCTION ' || func_sig || ' TO authenticated';
    END IF;

    -- Always ensure service_role has access
    EXECUTE 'GRANT EXECUTE ON FUNCTION ' || func_sig || ' TO service_role';

  END LOOP;
END $$;
