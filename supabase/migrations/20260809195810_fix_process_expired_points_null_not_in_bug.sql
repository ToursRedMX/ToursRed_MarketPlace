/*
# Fix NULL NOT IN bug in process_expired_points function

## Problem
The `process_expired_points` function uses a `NOT IN (SELECT reference_id ...)` 
subquery to filter out already-processed expired points. However, if any 
`reference_id` in the subquery is NULL, the entire `NOT IN` evaluates to 
NULL/false for ALL rows — meaning once a single NULL appears, no more points 
are ever processed again. This is a classic SQL NULL-handling bug.

Additionally, the function grouped expired points by wallet and processed 
them in bulk, which meant the `reference_id` column in expiration 
transactions was never populated — making the deduplication mechanism 
itself unreliable.

## Fix
1. Rewrite the function to iterate per-transaction (individual earned 
   points records) instead of grouping by wallet.
2. Populate `reference_id` in the expiration transaction with the 
   original earned transaction's ID, enabling reliable deduplication.
3. Replace `NOT IN (SELECT reference_id ...)` with `NOT EXISTS 
   (SELECT 1 FROM ... WHERE e.reference_id = t.id::text ...)`, which 
   correctly handles NULL values in the comparison column.
4. Subtract the individual transaction amount from the wallet balance 
   per iteration rather than a grouped bulk subtraction.

## Security
- Function remains SECURITY DEFINER with search_path = public
- Grants unchanged: service_role only
- No new tables, columns, or policies
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
        WHERE e.reference_id = t.id::text
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
