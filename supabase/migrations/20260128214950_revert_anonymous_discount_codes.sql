
-- Drop the overloaded function that doesn't require user_id
DROP FUNCTION IF EXISTS validate_discount_code(text, text, numeric);

-- Remove the partial unique indexes
DROP INDEX IF EXISTS idx_discount_code_usage_user_unique;
DROP INDEX IF EXISTS idx_discount_code_usage_gift_card_unique;

-- Delete any usage records where user_id is NULL (cleanup)
DELETE FROM public.discount_code_usage WHERE user_id IS NULL;

-- Make user_id NOT NULL again
ALTER TABLE public.discount_code_usage 
ALTER COLUMN user_id SET NOT NULL;

-- Restore the original unique constraint
ALTER TABLE public.discount_code_usage 
ADD CONSTRAINT discount_code_usage_discount_code_id_user_id_key 
UNIQUE (discount_code_id, user_id);
