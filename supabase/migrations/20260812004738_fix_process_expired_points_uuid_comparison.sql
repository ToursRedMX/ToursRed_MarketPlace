/*
# Fix process_expired_points: uuid = text type mismatch

## Problem
The `process_expired_points()` function's NOT EXISTS subquery compared
`e.reference_id = t.id::text`, where `e.reference_id` is a uuid column and
`t.id::text` produces a text value. Postgres cannot compare uuid = text,
raising "operator does not exist: uuid = text". The function has never
successfully run, so there are zero rows with type='expired' in production.

## Fix
Change the comparison from `e.reference_id = t.id::text` to
`e.reference_id = t.id` — both columns are uuid, so the comparison is
uuid = uuid with no cast needed on either side.

The INSERT that writes `reference_id` with `v_expired_record.id::text` is
left unchanged: Postgres coerces the text representation back to uuid on
insert because the column type is uuid.

## Security
- Function remains SECURITY DEFINER, search_path = public.
- Grants unchanged: service_role only.
- No schema changes, no RLS changes.
*/

CREATE OR REPLACE FUNCTION public.process_expired_points()
RETURNS integer
SECURITY DEFINER
SET search_path = public
LANGUAGE plpgsql
AS $$
DECLARE
  v_expired_record RECORD;
  v_total_processed integer := 0;
  v_new_balance integer;
BEGIN
  -- Find each individual earned points transaction that has expired
  -- but hasn't been processed yet.
  -- Using NOT EXISTS instead of NOT IN to correctly handle NULL values
  -- in the reference_id column (NULL poisons NOT IN for all rows).
  -- Fixed: compare uuid = uuid directly (both columns are uuid type).
  FOR v_expired_record IN
    SELECT 
      t.id,
      t.wallet_id,
      t.user_id,
      t.amount
    FROM toursred_points_transactions t
    WHERE t.type = 'earned'
      AND t.expires_at < now()
      AND NOT EXISTS (
        SELECT 1 
        FROM toursred_points_transactions e
        WHERE e.reference_id = t.id
          AND e.type = 'expired'
          AND e.reference_type = 'expiration'
      )
    ORDER BY t.expires_at ASC
  LOOP
    -- Update wallet: subtract expired points from balance, add to total_expired
    UPDATE toursred_points_wallets
    SET balance = GREATEST(0, balance - v_expired_record.amount),
        total_expired = total_expired + v_expired_record.amount,
        updated_at = now()
    WHERE id = v_expired_record.wallet_id
    RETURNING balance INTO v_new_balance;

    -- Create expiration transaction with reference_id pointing to the
    -- original earned transaction, enabling reliable deduplication
    INSERT INTO toursred_points_transactions (
      wallet_id,
      user_id,
      amount,
      balance_after,
      type,
      description,
      reference_type,
      reference_id
    ) VALUES (
      v_expired_record.wallet_id,
      v_expired_record.user_id,
      -v_expired_record.amount,
      v_new_balance,
      'expired',
      format('Expiración de %s puntos (12 meses)', v_expired_record.amount),
      'expiration',
      v_expired_record.id::text
    );

    v_total_processed := v_total_processed + 1;
  END LOOP;

  RETURN v_total_processed;
END;
$$;

-- Re-grant execute permissions (function signature unchanged)
GRANT EXECUTE ON FUNCTION public.process_expired_points() TO service_role;
