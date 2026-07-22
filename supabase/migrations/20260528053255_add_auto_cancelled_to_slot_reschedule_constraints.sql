-- Agregar 'auto_cancelled' al CHECK constraint de slot_reschedule_responses.response
ALTER TABLE slot_reschedule_responses
  DROP CONSTRAINT IF EXISTS slot_reschedule_responses_response_check;

ALTER TABLE slot_reschedule_responses
  ADD CONSTRAINT slot_reschedule_responses_response_check
  CHECK (response IN ('pending', 'accepted', 'rejected', 'auto_accepted', 'auto_cancelled',
                      'accepted_no_availability', 'auto_accepted_no_availability'));

-- Agregar 'slot_reschedule_no_response' al CHECK constraint de bookings.cancellation_type (si existe)
DO $$
BEGIN
  -- Verificar si existe la columna cancellation_type
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'bookings' AND column_name = 'cancellation_type'
  ) THEN
    -- Eliminar constraint existente si hay uno
    ALTER TABLE bookings DROP CONSTRAINT IF EXISTS bookings_cancellation_type_check;
  END IF;
END $$;
