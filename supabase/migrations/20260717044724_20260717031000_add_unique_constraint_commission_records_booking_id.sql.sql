-- Add unique constraint on booking_id for commission_records UPSERT
-- First, clean up any duplicate commission_records keeping the oldest
DELETE FROM public.commission_records
WHERE id NOT IN (
  SELECT (array_agg(id ORDER BY created_at ASC))[1]
  FROM public.commission_records GROUP BY booking_id
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_commission_records_booking_id
  ON public.commission_records (booking_id);
