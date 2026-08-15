
-- Drop the existing unique constraint
ALTER TABLE public.discount_code_usage 
DROP CONSTRAINT IF EXISTS discount_code_usage_discount_code_id_user_id_key;

-- Make user_id nullable
ALTER TABLE public.discount_code_usage 
ALTER COLUMN user_id DROP NOT NULL;

-- Add a new partial unique constraint that handles NULLs properly
-- For authenticated users: one use per user per code
CREATE UNIQUE INDEX IF NOT EXISTS idx_discount_code_usage_user_unique 
ON public.discount_code_usage(discount_code_id, user_id) 
WHERE user_id IS NOT NULL;

-- For gift cards: track by gift_card_id to prevent duplicate usage
CREATE UNIQUE INDEX IF NOT EXISTS idx_discount_code_usage_gift_card_unique 
ON public.discount_code_usage(discount_code_id, gift_card_id) 
WHERE gift_card_id IS NOT NULL;
