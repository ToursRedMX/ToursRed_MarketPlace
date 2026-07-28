-- Drop the old 6-parameter version of update_wallet_balance that lacks p_idempotency_key.
-- All callers across the codebase now pass p_idempotency_key (7-parameter version).
-- Removing this overload ensures any future call that omits the key fails explicitly
-- instead of silently falling back to the unprotected version.

DROP FUNCTION IF EXISTS public.update_wallet_balance(uuid, numeric, toursred_cash_transaction_type, text, uuid, text);