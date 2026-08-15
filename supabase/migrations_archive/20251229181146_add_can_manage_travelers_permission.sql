-- Create admin_permissions table if it doesn't exist
CREATE TABLE IF NOT EXISTS public.admin_permissions (
  user_id uuid PRIMARY KEY REFERENCES public.users(id) ON DELETE CASCADE,
  can_manage_agencies boolean DEFAULT false,
  can_manage_users boolean DEFAULT false,
  can_manage_destinations boolean DEFAULT false,
  can_manage_reviews boolean DEFAULT false,
  can_manage_messages boolean DEFAULT false,
  can_manage_settings boolean DEFAULT false,
  can_manage_memberships boolean DEFAULT false,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Add can_manage_travelers if it doesn't exist
ALTER TABLE public.admin_permissions 
ADD COLUMN IF NOT EXISTS can_manage_travelers boolean DEFAULT false;
