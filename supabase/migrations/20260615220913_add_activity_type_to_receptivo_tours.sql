-- Add activity_type and related columns for receptivo tour modalities

-- activity_type column
ALTER TABLE tours
  ADD COLUMN IF NOT EXISTS activity_type text DEFAULT 'guided_tour'
    CHECK (activity_type IN ('guided_tour', 'experience', 'transport', 'ticket'));

-- ── TRANSPORT fields ──────────────────────────────────────────
ALTER TABLE tours ADD COLUMN IF NOT EXISTS transfer_type text;
ALTER TABLE tours ADD COLUMN IF NOT EXISTS transport_coverage text;
ALTER TABLE tours ADD COLUMN IF NOT EXISTS estimated_minutes integer;
ALTER TABLE tours ADD COLUMN IF NOT EXISTS max_wait_minutes integer;
ALTER TABLE tours ADD COLUMN IF NOT EXISTS flight_tracking boolean DEFAULT false;
ALTER TABLE tours ADD COLUMN IF NOT EXISTS personalized_reception boolean DEFAULT false;
ALTER TABLE tours ADD COLUMN IF NOT EXISTS vehicle_type text;
ALTER TABLE tours ADD COLUMN IF NOT EXISTS luggage_info text;
ALTER TABLE tours ADD COLUMN IF NOT EXISTS transport_service_info text;

-- ── EXPERIENCE fields ──────────────────────────────────────────
ALTER TABLE tours ADD COLUMN IF NOT EXISTS unique_experience text;
ALTER TABLE tours ADD COLUMN IF NOT EXISTS participation_level text;
ALTER TABLE tours ADD COLUMN IF NOT EXISTS local_host boolean DEFAULT false;
ALTER TABLE tours ADD COLUMN IF NOT EXISTS special_requirements text;
ALTER TABLE tours ADD COLUMN IF NOT EXISTS experience_environment text[];

-- ── TICKET (Entrada) fields ────────────────────────────────────
ALTER TABLE tours ADD COLUMN IF NOT EXISTS ticket_type text;
ALTER TABLE tours ADD COLUMN IF NOT EXISTS ticket_validity_type text;
ALTER TABLE tours ADD COLUMN IF NOT EXISTS ticket_valid_from date;
ALTER TABLE tours ADD COLUMN IF NOT EXISTS ticket_valid_to date;
ALTER TABLE tours ADD COLUMN IF NOT EXISTS ticket_requires_reservation boolean DEFAULT false;
ALTER TABLE tours ADD COLUMN IF NOT EXISTS ticket_redemption_method text;
ALTER TABLE tours ADD COLUMN IF NOT EXISTS ticket_delivery_method text;
ALTER TABLE tours ADD COLUMN IF NOT EXISTS ticket_access_instructions text;
ALTER TABLE tours ADD COLUMN IF NOT EXISTS ticket_service_info text;
