/*
  # Add notifications table and related functionality

  1. New Tables
    - `notifications` - Stores user notifications
      - `id` (uuid, primary key)
      - `user_id` (uuid, references users)
      - `type` (notification_type enum)
      - `title` (text)
      - `message` (text)
      - `data` (jsonb)
      - `is_read` (boolean)
      - `created_at` (timestamptz)
      - `updated_at` (timestamptz)
      - `expires_at` (timestamptz)
  
  2. Security
    - Enable RLS on `notifications` table
    - Add policies for users to view and update their own notifications
    - Add policy for system to create notifications
    - Add policy for admins to view all notifications
  
  3. Functions
    - `get_user_notifications` - Function to get a user's notifications
    - `mark_notification_as_read` - Function to mark a notification as read
    - `create_user_notification` - Function to create a notification for a user
*/

-- Create notifications table if it doesn't exist
CREATE TABLE IF NOT EXISTS notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type notification_type NOT NULL,
  title text NOT NULL,
  message text NOT NULL,
  data jsonb DEFAULT '{}',
  is_read boolean DEFAULT false,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  expires_at timestamptz
);

-- Create indexes for better performance
CREATE INDEX IF NOT EXISTS idx_notifications_user_id ON notifications(user_id);
CREATE INDEX IF NOT EXISTS idx_notifications_created_at ON notifications(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notifications_is_read ON notifications(is_read);
CREATE INDEX IF NOT EXISTS idx_notifications_type ON notifications(type);

-- Enable RLS
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;

-- Create policies
CREATE POLICY "Users can view their own notifications"
  ON notifications
  FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "Users can update their own notifications"
  ON notifications
  FOR UPDATE
  TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "System can create notifications"
  ON notifications
  FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE POLICY "Admins can view all notifications"
  ON notifications
  FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM users 
      WHERE users.id = auth.uid() AND users.role = 'admin'
    )
  );

-- Create function to get user notifications
CREATE OR REPLACE FUNCTION get_user_notifications(
  limit_count integer DEFAULT 20,
  offset_count integer DEFAULT 0,
  include_read boolean DEFAULT false
)
RETURNS SETOF notifications
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN QUERY
  SELECT *
  FROM notifications
  WHERE user_id = auth.uid()
    AND (include_read OR is_read = false)
    AND (expires_at IS NULL OR expires_at > now())
  ORDER BY created_at DESC
  LIMIT limit_count
  OFFSET offset_count;
END;
$$;

-- Create function to mark notification as read
CREATE OR REPLACE FUNCTION mark_notification_as_read(notification_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  success boolean;
BEGIN
  UPDATE notifications
  SET is_read = true, updated_at = now()
  WHERE id = notification_id AND user_id = auth.uid();
  
  GET DIAGNOSTICS success = ROW_COUNT;
  RETURN success > 0;
END;
$$;

-- Create function to mark all notifications as read
CREATE OR REPLACE FUNCTION mark_all_notifications_as_read()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  updated_count integer;
BEGIN
  UPDATE notifications
  SET is_read = true, updated_at = now()
  WHERE user_id = auth.uid() AND is_read = false;
  
  GET DIAGNOSTICS updated_count = ROW_COUNT;
  RETURN updated_count;
END;
$$;

-- Create function to create a notification
CREATE OR REPLACE FUNCTION create_user_notification(
  p_user_id uuid,
  p_type notification_type,
  p_title text,
  p_message text,
  p_data jsonb DEFAULT '{}',
  p_expires_at timestamptz DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  notification_id uuid;
BEGIN
  INSERT INTO notifications (
    user_id,
    type,
    title,
    message,
    data,
    expires_at
  ) VALUES (
    p_user_id,
    p_type,
    p_title,
    p_message,
    p_data,
    p_expires_at
  ) RETURNING id INTO notification_id;
  
  RETURN notification_id;
END;
$$;

-- Create trigger to update updated_at
CREATE TRIGGER notifications_updated_at
  BEFORE UPDATE ON notifications
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at();

-- Create view for user notifications with additional info
CREATE OR REPLACE VIEW user_notifications AS
SELECT 
  n.*,
  CASE 
    WHEN n.expires_at IS NOT NULL AND n.expires_at <= now() THEN true
    ELSE false
  END as is_expired
FROM notifications n
WHERE n.user_id = auth.uid()
  AND (n.expires_at IS NULL OR n.expires_at > now())
ORDER BY n.created_at DESC;

-- Create function to get unread notifications count
CREATE OR REPLACE FUNCTION get_unread_notifications_count()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  unread_count integer;
BEGIN
  SELECT COUNT(*)::integer INTO unread_count
  FROM notifications
  WHERE user_id = auth.uid() 
    AND is_read = false
    AND (expires_at IS NULL OR expires_at > now());
    
  RETURN unread_count;
END;
$$;