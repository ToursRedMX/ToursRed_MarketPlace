-- ============================================================================
-- EXPORTACION FUNCIONAL desde supabase_migrations.schema_migrations
--
-- Este archivo NO es la migracion original: es el SQL que la base registro
-- haber ejecutado, reconstruido a partir del ledger.
--
--   version: 20260827200013
--   name:    006_notification_type_nature_stay.sql
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

-- ============================================================================
-- Migration: 006_notification_type_nature_stay
-- Purpose: Add Nature Stay-specific notification types
-- Schema: public
-- Backwards-compatible: YES (only adds new enum values)
-- ToursRed impact: NONE (existing values unchanged, no RLS or trigger changes)
-- ============================================================================
--
-- Adds notification types that are semantically unique to Nature Stay and
-- cannot be represented by reusing existing types with data.platform.
--
-- Events NOT added (reusing existing types with data.platform='naturestayred'):
--   - booking_confirmed      (already exists)
--   - booking_cancelled      (already exists)
--   - message_received       (already exists)
--   - system_announcement    (already exists)
--
-- Events added (unique to Nature Stay):
--   nature_stay_booking_request_received   - host receives a booking request
--   nature_stay_booking_request_approved   - guest notified request approved
--   nature_stay_booking_request_rejected   - guest notified request rejected
--   nature_stay_checkin_reminder           - reminder before check-in
--   nature_stay_checkout_reminder          - reminder before check-out
--   nature_stay_payout_processed           - host notified of payout
--
-- NOTE: In modern PostgreSQL (12+), ALTER TYPE ADD VALUE can run inside
-- a transaction block, but the new value cannot be used until the
-- transaction is committed. Since these migrations do not reference the
-- new enum values immediately, the current approach is safe.
-- ============================================================================

ALTER TYPE public.notification_type ADD VALUE IF NOT EXISTS 'nature_stay_booking_request_received'
;



ALTER TYPE public.notification_type ADD VALUE IF NOT EXISTS 'nature_stay_booking_request_approved'
;



ALTER TYPE public.notification_type ADD VALUE IF NOT EXISTS 'nature_stay_booking_request_rejected'
;



ALTER TYPE public.notification_type ADD VALUE IF NOT EXISTS 'nature_stay_checkin_reminder'
;



ALTER TYPE public.notification_type ADD VALUE IF NOT EXISTS 'nature_stay_checkout_reminder'
;



ALTER TYPE public.notification_type ADD VALUE IF NOT EXISTS 'nature_stay_payout_processed'
;



;
