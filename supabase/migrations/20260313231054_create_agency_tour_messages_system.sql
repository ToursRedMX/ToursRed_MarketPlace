-- Create the main messages table
CREATE TABLE IF NOT EXISTS agency_tour_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id uuid NOT NULL REFERENCES agencies(id) ON DELETE CASCADE,
  tour_id uuid NOT NULL REFERENCES tours(id) ON DELETE CASCADE,
  slot_id uuid REFERENCES tour_slots(id) ON DELETE SET NULL,
  subject text NOT NULL,
  message_body text NOT NULL,
  sent_by uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  recipients_count integer NOT NULL DEFAULT 0,
  success_count integer NOT NULL DEFAULT 0,
  error_count integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sending', 'completed', 'failed')),
  created_at timestamptz DEFAULT now()
);

-- Create the recipients detail table
CREATE TABLE IF NOT EXISTS agency_tour_message_recipients (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id uuid NOT NULL REFERENCES agency_tour_messages(id) ON DELETE CASCADE,
  user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  booking_id uuid REFERENCES bookings(id) ON DELETE SET NULL,
  email text NOT NULL,
  delivered boolean NOT NULL DEFAULT false,
  delivered_at timestamptz,
  error_message text,
  created_at timestamptz DEFAULT now()
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_agency_tour_messages_agency_id ON agency_tour_messages(agency_id);
CREATE INDEX IF NOT EXISTS idx_agency_tour_messages_tour_id ON agency_tour_messages(tour_id);
CREATE INDEX IF NOT EXISTS idx_agency_tour_messages_slot_id ON agency_tour_messages(slot_id);
CREATE INDEX IF NOT EXISTS idx_agency_tour_messages_created_at ON agency_tour_messages(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_agency_tour_message_recipients_message_id ON agency_tour_message_recipients(message_id);
CREATE INDEX IF NOT EXISTS idx_agency_tour_message_recipients_user_id ON agency_tour_message_recipients(user_id);

-- Enable RLS
ALTER TABLE agency_tour_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE agency_tour_message_recipients ENABLE ROW LEVEL SECURITY;

-- RLS Policies for agency_tour_messages
CREATE POLICY "Agencies can view their own tour messages"
  ON agency_tour_messages FOR SELECT
  TO authenticated
  USING (
    agency_id IN (
      SELECT id FROM agencies WHERE user_id = (SELECT auth.uid())
    )
  );

CREATE POLICY "Admins can view all tour messages"
  ON agency_tour_messages FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM users
      WHERE id = (SELECT auth.uid())
      AND role = 'admin'
    )
  );

CREATE POLICY "Service role can insert tour messages"
  ON agency_tour_messages FOR INSERT
  TO service_role
  WITH CHECK (true);

CREATE POLICY "Service role can update tour messages"
  ON agency_tour_messages FOR UPDATE
  TO service_role
  USING (true)
  WITH CHECK (true);

-- RLS Policies for agency_tour_message_recipients
CREATE POLICY "Agencies can view recipients of their messages"
  ON agency_tour_message_recipients FOR SELECT
  TO authenticated
  USING (
    message_id IN (
      SELECT atm.id FROM agency_tour_messages atm
      JOIN agencies a ON a.id = atm.agency_id
      WHERE a.user_id = (SELECT auth.uid())
    )
  );

CREATE POLICY "Admins can view all message recipients"
  ON agency_tour_message_recipients FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM users
      WHERE id = (SELECT auth.uid())
      AND role = 'admin'
    )
  );

CREATE POLICY "Service role can insert message recipients"
  ON agency_tour_message_recipients FOR INSERT
  TO service_role
  WITH CHECK (true);

-- Helper RPC function to get confirmed attendees for a tour (or specific slot)
CREATE OR REPLACE FUNCTION get_tour_confirmed_attendees(
  p_tour_id uuid,
  p_slot_id uuid DEFAULT NULL
)
RETURNS TABLE (
  booking_id uuid,
  user_id uuid,
  email text,
  first_name text,
  last_name text,
  travelers_count integer,
  selected_date text,
  selected_time text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT
    b.id AS booking_id,
    b.user_id,
    u.email,
    u.first_name,
    u.last_name,
    b.travelers_count,
    b.selected_date,
    b.selected_time
  FROM bookings b
  JOIN users u ON u.id = b.user_id
  WHERE
    b.tour_id = p_tour_id
    AND b.status = 'confirmed'
    AND (p_slot_id IS NULL OR b.slot_id = p_slot_id);
END;
$$;

-- Grant execute permission
GRANT EXECUTE ON FUNCTION get_tour_confirmed_attendees(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION get_tour_confirmed_attendees(uuid, uuid) TO service_role;
