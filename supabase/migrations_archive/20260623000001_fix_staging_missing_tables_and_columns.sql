-- ============================================================
-- TABLAS FALTANTES EN STAGING
-- ============================================================

-- batch_payouts
CREATE TABLE IF NOT EXISTS public.batch_payouts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id uuid REFERENCES public.payout_batches(id),
  payout_id uuid REFERENCES public.agency_payouts(id),
  created_at timestamptz DEFAULT now()
);
ALTER TABLE public.batch_payouts ENABLE ROW LEVEL SECURITY;

-- integration_configs
CREATE TABLE IF NOT EXISTS public.integration_configs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider text CHECK (provider = ANY (ARRAY['zoho_books','odoo','quickbooks','bank_api','stripe_connect','custom'])),
  agency_id uuid REFERENCES public.agencies(id),
  is_active boolean DEFAULT false,
  credentials text,
  api_endpoint text,
  sync_frequency text DEFAULT 'manual' CHECK (sync_frequency = ANY (ARRAY['manual','daily','weekly','real_time'])),
  last_sync_at timestamptz,
  last_sync_status text CHECK (last_sync_status = ANY (ARRAY['success','failed','pending'])),
  error_log jsonb,
  configuration jsonb,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
ALTER TABLE public.integration_configs ENABLE ROW LEVEL SECURITY;

-- slot_seat_status
CREATE TABLE IF NOT EXISTS public.slot_seat_status (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tour_id uuid REFERENCES public.tours(id),
  slot_id uuid REFERENCES public.tour_slots(id),
  agency_id uuid REFERENCES public.agencies(id),
  seat_number integer,
  status text,
  booking_id uuid REFERENCES public.bookings(id),
  block_note text,
  blocked_by uuid REFERENCES public.users(id),
  blocked_at timestamptz,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
ALTER TABLE public.slot_seat_status ENABLE ROW LEVEL SECURITY;

-- vehicle_seat_layouts
CREATE TABLE IF NOT EXISTS public.vehicle_seat_layouts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  type text UNIQUE,
  name text,
  capacity integer CHECK (capacity > 0),
  seats jsonb DEFAULT '[]'::jsonb,
  vehicle_shape jsonb DEFAULT '{}'::jsonb,
  is_active boolean DEFAULT true,
  display_order integer DEFAULT 0,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
ALTER TABLE public.vehicle_seat_layouts ENABLE ROW LEVEL SECURITY;

-- webhook_logs
CREATE TABLE IF NOT EXISTS public.webhook_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type text,
  event_id text,
  booking_id text,
  payload jsonb,
  created_at timestamptz DEFAULT now()
);
ALTER TABLE public.webhook_logs ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- COLUMNAS FALTANTES EN TABLAS EXISTENTES
-- ============================================================

-- bookings
ALTER TABLE public.bookings ADD COLUMN IF NOT EXISTS selected_seats integer[];
ALTER TABLE public.bookings ADD COLUMN IF NOT EXISTS slot_reschedule_alternative_slot_id uuid REFERENCES public.tour_slots(id);

-- slot_reschedule_requests
ALTER TABLE public.slot_reschedule_requests ADD COLUMN IF NOT EXISTS available_spots_in_target integer;
ALTER TABLE public.slot_reschedule_requests ADD COLUMN IF NOT EXISTS new_capacity integer;
ALTER TABLE public.slot_reschedule_requests ADD COLUMN IF NOT EXISTS new_vehicle_map_type text;
ALTER TABLE public.slot_reschedule_requests ADD COLUMN IF NOT EXISTS no_availability_count integer DEFAULT 0;

-- slot_reschedule_responses
ALTER TABLE public.slot_reschedule_responses ADD COLUMN IF NOT EXISTS alternative_slot_id uuid REFERENCES public.tour_slots(id);
ALTER TABLE public.slot_reschedule_responses ADD COLUMN IF NOT EXISTS booking_created_at timestamptz;
ALTER TABLE public.slot_reschedule_responses ADD COLUMN IF NOT EXISTS confirmed_spot boolean DEFAULT false;

-- tours
ALTER TABLE public.tours ADD COLUMN IF NOT EXISTS vehicle_map_type text;
