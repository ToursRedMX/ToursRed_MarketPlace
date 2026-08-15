/*
# Revoke EXECUTE on update_wallet_balance and refund_points_for_cancelled_booking FROM PUBLIC

## Problem
Previous migrations revoked EXECUTE from authenticated and anon individually, but
the PUBLIC role still held the grant. In PostgreSQL, PUBLIC privileges apply to
all roles regardless of individual revokes, so the previous revocation had no
real effect — any authenticated user could still execute both functions directly.

## Fix
REVOKE EXECUTE FROM PUBLIC on both functions. This closes the loophole for all
roles. service_role retains its grant explicitly.

## Functions affected
- public.update_wallet_balance(uuid, numeric, toursred_cash_transaction_type, text, uuid, text, text)
- public.refund_points_for_cancelled_booking(uuid)  — signature changed in prior migration to single param
*/

REVOKE EXECUTE ON FUNCTION public.update_wallet_balance(uuid, numeric, toursred_cash_transaction_type, text, uuid, text, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.refund_points_for_cancelled_booking(uuid) FROM PUBLIC;

-- Ensure service_role retains explicit access
GRANT EXECUTE ON FUNCTION public.update_wallet_balance(uuid, numeric, toursred_cash_transaction_type, text, uuid, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.refund_points_for_cancelled_booking(uuid) TO service_role;
