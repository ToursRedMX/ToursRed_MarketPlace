-- Fix update_platform_secrets: add WHERE clause to UPDATE
-- The UPDATE without WHERE is rejected by Supabase's API layer
CREATE OR REPLACE FUNCTION public.update_platform_secrets(
  p_paypal_client_secret text DEFAULT NULL,
  p_mercadopago_access_token text DEFAULT NULL,
  p_pac_api_key_encrypted text DEFAULT NULL,
  p_odoo_api_key_encrypted text DEFAULT NULL,
  p_zoho_client_secret text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM users
    WHERE users.id = auth.uid() AND users.role = 'admin'
  ) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  -- Ensure a row exists
  INSERT INTO platform_secrets (id)
  SELECT gen_random_uuid()
  WHERE NOT EXISTS (SELECT 1 FROM platform_secrets);

  UPDATE platform_secrets SET
    paypal_client_secret = COALESCE(p_paypal_client_secret, paypal_client_secret),
    mercadopago_access_token = COALESCE(p_mercadopago_access_token, mercadopago_access_token),
    pac_api_key_encrypted = COALESCE(p_pac_api_key_encrypted, pac_api_key_encrypted),
    odoo_api_key_encrypted = COALESCE(p_odoo_api_key_encrypted, odoo_api_key_encrypted),
    zoho_client_secret = COALESCE(p_zoho_client_secret, zoho_client_secret),
    updated_at = now()
  WHERE id = (SELECT id FROM platform_secrets ORDER BY created_at LIMIT 1);
END;
$function$;