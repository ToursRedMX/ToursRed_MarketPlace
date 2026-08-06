/*
# Revoke direct EXECUTE on update_wallet_balance from authenticated and anon

## Problem
update_wallet_balance is a SECURITY DEFINER function that modifies wallet
balances. It was granted to authenticated, allowing any logged-in user to
call it directly from the browser with arbitrary amounts.

## Fix
Revoke EXECUTE from authenticated and anon. Only service_role (edge functions
running with the service role key) can call this function. The auth guard
inside the function (auth.uid() check) remains as defense-in-depth.

## Security
- EXECUTE revoked from authenticated and anon
- EXECUTE retained on service_role only
- Function's internal auth guard remains unchanged
*/

REVOKE EXECUTE ON FUNCTION public.update_wallet_balance(uuid, numeric, toursred_cash_transaction_type, text, uuid, text, text) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.update_wallet_balance(uuid, numeric, toursred_cash_transaction_type, text, uuid, text, text) FROM anon;
