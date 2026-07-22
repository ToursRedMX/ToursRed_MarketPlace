-- ============================================================
-- TIPOS ENUM NUEVOS
-- ============================================================

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'tour_type_enum') THEN
    CREATE TYPE tour_type_enum AS ENUM ('excursion', 'receptivo');
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'receptivo_modality_enum') THEN
    CREATE TYPE receptivo_modality_enum AS ENUM ('compartido', 'privado');
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'cancellation_policy_enum') THEN
    CREATE TYPE cancellation_policy_enum AS ENUM ('flexible', 'moderada', 'estricta', 'no_reembolsable');
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'slot_status_enum') THEN
    CREATE TYPE slot_status_enum AS ENUM ('activo', 'lleno', 'bloqueado', 'cancelado', 'completado');
  END IF;
END $$;

-- ============================================================
-- COLUMNAS NUEVAS EN TABLA tours
-- ============================================================

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'tours' AND column_name = 'tour_type'
  ) THEN
    ALTER TABLE public.tours ADD COLUMN tour_type tour_type_enum NOT NULL DEFAULT 'excursion';
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'tours' AND column_name = 'receptivo_modality'
  ) THEN
    ALTER TABLE public.tours ADD COLUMN receptivo_modality receptivo_modality_enum;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'tours' AND column_name = 'operating_days'
  ) THEN
    ALTER TABLE public.tours ADD COLUMN operating_days integer[];
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'tours' AND column_name = 'operating_months'
  ) THEN
    ALTER TABLE public.tours ADD COLUMN operating_months integer[];
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'tours' AND column_name = 'min_advance_booking_hours'
  ) THEN
    ALTER TABLE public.tours ADD COLUMN min_advance_booking_hours integer DEFAULT 24;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'tours' AND column_name = 'max_advance_booking_days'
  ) THEN
    ALTER TABLE public.tours ADD COLUMN max_advance_booking_days integer DEFAULT 90;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'tours' AND column_name = 'slot_duration_days'
  ) THEN
    ALTER TABLE public.tours ADD COLUMN slot_duration_days integer DEFAULT 1;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'tours' AND column_name = 'max_daily_slots'
  ) THEN
    ALTER TABLE public.tours ADD COLUMN max_daily_slots integer DEFAULT 1;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'tours' AND column_name = 'default_slot_capacity'
  ) THEN
    ALTER TABLE public.tours ADD COLUMN default_slot_capacity integer;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'tours' AND column_name = 'cancellation_policy'
  ) THEN
    ALTER TABLE public.tours ADD COLUMN cancellation_policy cancellation_policy_enum DEFAULT 'moderada';
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'tours' AND column_name = 'cancellation_hours_limit'
  ) THEN
    ALTER TABLE public.tours ADD COLUMN cancellation_hours_limit integer DEFAULT 48;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'tours' AND column_name = 'cancellation_refund_percentage'
  ) THEN
    ALTER TABLE public.tours ADD COLUMN cancellation_refund_percentage integer DEFAULT 80 CHECK (cancellation_refund_percentage >= 0 AND cancellation_refund_percentage <= 100);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'tours' AND column_name = 'min_travelers_required'
  ) THEN
    ALTER TABLE public.tours ADD COLUMN min_travelers_required integer DEFAULT 1;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'tours' AND column_name = 'min_travelers_confirmation_hours'
  ) THEN
    ALTER TABLE public.tours ADD COLUMN min_travelers_confirmation_hours integer DEFAULT 24;
  END IF;
END $$;

-- ============================================================
-- TABLA tour_schedules
-- ============================================================

CREATE TABLE IF NOT EXISTS public.tour_schedules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tour_id uuid NOT NULL REFERENCES public.tours(id) ON DELETE CASCADE,
  agency_id uuid NOT NULL REFERENCES public.agencies(id) ON DELETE CASCADE,
  departure_point_id uuid REFERENCES public.departure_points(id) ON DELETE SET NULL,
  departure_time time NOT NULL,
  label varchar(100),
  slot_capacity integer,
  valid_from date NOT NULL DEFAULT CURRENT_DATE,
  valid_until date,
  days_of_week integer[],
  is_active boolean NOT NULL DEFAULT true,
  display_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_tour_schedules_tour_id ON public.tour_schedules(tour_id);
CREATE INDEX IF NOT EXISTS idx_tour_schedules_agency_id ON public.tour_schedules(agency_id);
CREATE INDEX IF NOT EXISTS idx_tour_schedules_active ON public.tour_schedules(tour_id, is_active) WHERE is_active = true;

ALTER TABLE public.tour_schedules ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Agency can view own tour schedules"
  ON public.tour_schedules FOR SELECT
  TO authenticated
  USING (agency_id IN (
    SELECT id FROM public.agencies WHERE user_id = (SELECT auth.uid())
  ));

CREATE POLICY "Agency can insert own tour schedules"
  ON public.tour_schedules FOR INSERT
  TO authenticated
  WITH CHECK (agency_id IN (
    SELECT id FROM public.agencies WHERE user_id = (SELECT auth.uid())
  ));

CREATE POLICY "Agency can update own tour schedules"
  ON public.tour_schedules FOR UPDATE
  TO authenticated
  USING (agency_id IN (
    SELECT id FROM public.agencies WHERE user_id = (SELECT auth.uid())
  ))
  WITH CHECK (agency_id IN (
    SELECT id FROM public.agencies WHERE user_id = (SELECT auth.uid())
  ));

CREATE POLICY "Agency can delete own tour schedules"
  ON public.tour_schedules FOR DELETE
  TO authenticated
  USING (agency_id IN (
    SELECT id FROM public.agencies WHERE user_id = (SELECT auth.uid())
  ));

CREATE POLICY "Travelers can view active schedules"
  ON public.tour_schedules FOR SELECT
  TO authenticated
  USING (is_active = true);

CREATE POLICY "Public can view active schedules"
  ON public.tour_schedules FOR SELECT
  TO anon
  USING (is_active = true);

CREATE POLICY "Admins can view all schedules"
  ON public.tour_schedules FOR SELECT
  TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.users u
    WHERE u.id = (SELECT auth.uid()) AND u.role IN ('admin', 'super_admin')
  ));

-- ============================================================
-- TABLA tour_slots
-- ============================================================

CREATE TABLE IF NOT EXISTS public.tour_slots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tour_id uuid NOT NULL REFERENCES public.tours(id) ON DELETE CASCADE,
  agency_id uuid NOT NULL REFERENCES public.agencies(id) ON DELETE CASCADE,
  schedule_id uuid REFERENCES public.tour_schedules(id) ON DELETE SET NULL,
  slot_date date NOT NULL,
  departure_time time NOT NULL,
  end_date date,
  capacity integer NOT NULL DEFAULT 1,
  booked_count integer NOT NULL DEFAULT 0,
  status slot_status_enum NOT NULL DEFAULT 'activo',
  is_auto_generated boolean NOT NULL DEFAULT false,
  min_travelers_reached boolean NOT NULL DEFAULT false,
  confirmed_at timestamptz,
  cancellation_reason text,
  cancelled_at timestamptz,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT tour_slots_capacity_check CHECK (capacity > 0),
  CONSTRAINT tour_slots_booked_count_check CHECK (booked_count >= 0)
);

CREATE INDEX IF NOT EXISTS idx_tour_slots_tour_date_status ON public.tour_slots(tour_id, slot_date, status);
CREATE INDEX IF NOT EXISTS idx_tour_slots_agency_date ON public.tour_slots(agency_id, slot_date);
CREATE INDEX IF NOT EXISTS idx_tour_slots_schedule_id ON public.tour_slots(schedule_id);
CREATE INDEX IF NOT EXISTS idx_tour_slots_status ON public.tour_slots(status);

ALTER TABLE public.tour_slots ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Agency can view own tour slots"
  ON public.tour_slots FOR SELECT
  TO authenticated
  USING (agency_id IN (
    SELECT id FROM public.agencies WHERE user_id = (SELECT auth.uid())
  ));

CREATE POLICY "Agency can insert own tour slots"
  ON public.tour_slots FOR INSERT
  TO authenticated
  WITH CHECK (agency_id IN (
    SELECT id FROM public.agencies WHERE user_id = (SELECT auth.uid())
  ));

CREATE POLICY "Agency can update own tour slots"
  ON public.tour_slots FOR UPDATE
  TO authenticated
  USING (agency_id IN (
    SELECT id FROM public.agencies WHERE user_id = (SELECT auth.uid())
  ))
  WITH CHECK (agency_id IN (
    SELECT id FROM public.agencies WHERE user_id = (SELECT auth.uid())
  ));

CREATE POLICY "Agency can delete own tour slots"
  ON public.tour_slots FOR DELETE
  TO authenticated
  USING (agency_id IN (
    SELECT id FROM public.agencies WHERE user_id = (SELECT auth.uid())
  ));

CREATE POLICY "Travelers can view active tour slots"
  ON public.tour_slots FOR SELECT
  TO authenticated
  USING (status = 'activo');

CREATE POLICY "Public can view active tour slots"
  ON public.tour_slots FOR SELECT
  TO anon
  USING (status = 'activo');

CREATE POLICY "Admins can view all tour slots"
  ON public.tour_slots FOR SELECT
  TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.users u
    WHERE u.id = (SELECT auth.uid()) AND u.role IN ('admin', 'super_admin')
  ));

-- ============================================================
-- TABLA tour_slot_blackouts
-- ============================================================

CREATE TABLE IF NOT EXISTS public.tour_slot_blackouts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tour_id uuid NOT NULL REFERENCES public.tours(id) ON DELETE CASCADE,
  agency_id uuid NOT NULL REFERENCES public.agencies(id) ON DELETE CASCADE,
  blackout_start date NOT NULL,
  blackout_end date NOT NULL,
  reason varchar(255),
  is_partial_day boolean NOT NULL DEFAULT false,
  blocked_schedule_ids uuid[],
  created_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT blackout_date_order CHECK (blackout_end >= blackout_start)
);

CREATE INDEX IF NOT EXISTS idx_tour_slot_blackouts_tour_id ON public.tour_slot_blackouts(tour_id);
CREATE INDEX IF NOT EXISTS idx_tour_slot_blackouts_agency_id ON public.tour_slot_blackouts(agency_id);
CREATE INDEX IF NOT EXISTS idx_tour_slot_blackouts_dates ON public.tour_slot_blackouts(tour_id, blackout_start, blackout_end);

ALTER TABLE public.tour_slot_blackouts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Agency can view own blackouts"
  ON public.tour_slot_blackouts FOR SELECT
  TO authenticated
  USING (agency_id IN (
    SELECT id FROM public.agencies WHERE user_id = (SELECT auth.uid())
  ));

CREATE POLICY "Agency can insert own blackouts"
  ON public.tour_slot_blackouts FOR INSERT
  TO authenticated
  WITH CHECK (agency_id IN (
    SELECT id FROM public.agencies WHERE user_id = (SELECT auth.uid())
  ));

CREATE POLICY "Agency can update own blackouts"
  ON public.tour_slot_blackouts FOR UPDATE
  TO authenticated
  USING (agency_id IN (
    SELECT id FROM public.agencies WHERE user_id = (SELECT auth.uid())
  ))
  WITH CHECK (agency_id IN (
    SELECT id FROM public.agencies WHERE user_id = (SELECT auth.uid())
  ));

CREATE POLICY "Agency can delete own blackouts"
  ON public.tour_slot_blackouts FOR DELETE
  TO authenticated
  USING (agency_id IN (
    SELECT id FROM public.agencies WHERE user_id = (SELECT auth.uid())
  ));

CREATE POLICY "Admins can view all blackouts"
  ON public.tour_slot_blackouts FOR SELECT
  TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.users u
    WHERE u.id = (SELECT auth.uid()) AND u.role IN ('admin', 'super_admin')
  ));
