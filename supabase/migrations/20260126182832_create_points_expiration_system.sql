
-- Enable pg_cron extension if not already enabled
CREATE EXTENSION IF NOT EXISTS pg_cron;

-- Function to process expired points
CREATE OR REPLACE FUNCTION process_expired_points()
RETURNS integer
SECURITY DEFINER
SET search_path = public
LANGUAGE plpgsql
AS $$
DECLARE
  v_expired_record RECORD;
  v_total_processed integer := 0;
  v_wallet_id uuid;
  v_new_balance integer;
BEGIN
  -- Find all earned points that have expired but haven't been processed yet
  FOR v_expired_record IN
    SELECT 
      t.wallet_id,
      t.user_id,
      SUM(t.amount) as total_expired_points
    FROM toursred_points_transactions t
    WHERE t.type = 'earned'
      AND t.expires_at < now()
      AND t.id NOT IN (
        -- Exclude points that have already been marked as expired
        SELECT reference_id 
        FROM toursred_points_transactions 
        WHERE type = 'expired' AND reference_type = 'expiration'
      )
    GROUP BY t.wallet_id, t.user_id
  LOOP
    -- Update wallet: subtract expired points from balance, add to total_expired
    UPDATE toursred_points_wallets
    SET balance = GREATEST(0, balance - v_expired_record.total_expired_points),
        total_expired = total_expired + v_expired_record.total_expired_points,
        updated_at = now()
    WHERE id = v_expired_record.wallet_id
    RETURNING balance INTO v_new_balance;

    -- Create expiration transaction
    INSERT INTO toursred_points_transactions (
      wallet_id,
      user_id,
      amount,
      balance_after,
      type,
      description,
      reference_type
    ) VALUES (
      v_expired_record.wallet_id,
      v_expired_record.user_id,
      -v_expired_record.total_expired_points,
      v_new_balance,
      'expired',
      format('Expiración de %s puntos (12 meses)', v_expired_record.total_expired_points),
      'expiration'
    );

    v_total_processed := v_total_processed + 1;
  END LOOP;

  RETURN v_total_processed;
END;
$$;

-- Function to get points expiring soon (for notifications)
CREATE OR REPLACE FUNCTION get_points_expiring_soon(days_threshold integer DEFAULT 30)
RETURNS TABLE (
  user_id uuid,
  email text,
  nombre text,
  points_expiring integer,
  earliest_expiration timestamptz
)
SECURITY DEFINER
SET search_path = public
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  SELECT 
    u.id as user_id,
    u.email,
    u.nombre,
    SUM(t.amount)::integer as points_expiring,
    MIN(t.expires_at) as earliest_expiration
  FROM toursred_points_transactions t
  JOIN users u ON u.id = t.user_id
  WHERE t.type = 'earned'
    AND t.expires_at IS NOT NULL
    AND t.expires_at > now()
    AND t.expires_at <= now() + make_interval(days => days_threshold)
    AND t.amount > 0
  GROUP BY u.id, u.email, u.nombre
  HAVING SUM(t.amount) > 0
  ORDER BY earliest_expiration ASC;
END;
$$;

-- Schedule cron job to run daily at midnight (00:00 UTC)
-- Note: pg_cron uses UTC timezone
DO $$
BEGIN
  -- Remove existing job if it exists
  PERFORM cron.unschedule('process-expired-toursred-points');
EXCEPTION
  WHEN OTHERS THEN
    NULL; -- Ignore if job doesn't exist
END $$;

-- Schedule the job to run daily at midnight
SELECT cron.schedule(
  'process-expired-toursred-points',
  '0 0 * * *', -- Every day at midnight UTC
  $$SELECT process_expired_points();$$
);

-- Grant execute permissions
GRANT EXECUTE ON FUNCTION process_expired_points TO service_role;
GRANT EXECUTE ON FUNCTION get_points_expiring_soon TO service_role;

-- Create a view for admins to see expiration summary
CREATE OR REPLACE VIEW points_expiration_summary AS
SELECT 
  DATE(t.expires_at) as expiration_date,
  COUNT(DISTINCT t.user_id) as users_affected,
  SUM(t.amount) as total_points_expiring
FROM toursred_points_transactions t
WHERE t.type = 'earned'
  AND t.expires_at IS NOT NULL
  AND t.expires_at > now()
GROUP BY DATE(t.expires_at)
ORDER BY expiration_date;

-- Grant select on view to authenticated users (admins will see via RLS)
GRANT SELECT ON points_expiration_summary TO authenticated;
