-- Backfill insurance_days for existing bookings where insurance was included but days were not stored
UPDATE bookings b
SET insurance_days = GREATEST(1, (t.end_date::date - t.start_date::date) + 1)
FROM tours t
WHERE b.tour_id = t.id
  AND b.travel_insurance_included = true
  AND b.insurance_days IS NULL
  AND t.start_date IS NOT NULL
  AND t.end_date IS NOT NULL;

-- For receptivo tours or tours without start/end dates, default to 1 day
UPDATE bookings b
SET insurance_days = 1
WHERE b.travel_insurance_included = true
  AND b.insurance_days IS NULL;