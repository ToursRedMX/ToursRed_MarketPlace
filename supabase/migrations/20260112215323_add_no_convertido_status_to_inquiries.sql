
-- Drop the existing CHECK constraint
ALTER TABLE international_tour_inquiries 
  DROP CONSTRAINT IF EXISTS international_tour_inquiries_status_check;

-- Add the new CHECK constraint with the additional status
ALTER TABLE international_tour_inquiries
  ADD CONSTRAINT international_tour_inquiries_status_check
  CHECK (status IN ('pending', 'contacted', 'converted', 'no_convertido'));
