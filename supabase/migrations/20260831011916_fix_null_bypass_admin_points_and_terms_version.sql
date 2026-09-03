-- ============================================================================
-- EXPORTACION FUNCIONAL desde supabase_migrations.schema_migrations
--
-- Este archivo NO es la migracion original: es el SQL que la base registro
-- haber ejecutado, reconstruido a partir del ledger.
--
--   version: 20260831011916
--   name:    fix_null_bypass_admin_points_and_terms_version
--
-- Recuperado : las sentencias ejecutadas, en su orden original.
-- Perdido    : los comentarios sueltos entre sentencias. El ledger guarda solo
--              sentencias ejecutables, asi que la documentacion que tuviera el
--              archivo original no es recuperable desde aqui.
-- Transformado: saltos de linea desescapados y ';' separadores repuestos, que
--              statements[] no conserva. La alineacion puede diferir.
--
-- Se agrega para que el cambio de esquema sea revisable y reproducible desde
-- el repo. Para el detalle de por que existe, ver el bullet del desfase de
-- migraciones en claude.md.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.admin_adjust_points(target_user_id uuid, points_amount integer, adjustment_reason text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
v_wallet_id UUID;
v_current_balance INTEGER;
v_new_balance INTEGER;
v_admin_id UUID;
v_admin_role TEXT;
v_transaction_id UUID;
BEGIN
v_admin_id := auth.uid();

IF v_admin_id IS NULL THEN
RAISE EXCEPTION 'Unauthorized: no autenticado';
END IF;

SELECT role INTO v_admin_role
FROM users
WHERE id = v_admin_id;

IF COALESCE(v_admin_role, '') NOT IN ('admin', 'super_admin') THEN
RAISE EXCEPTION 'Only administrators can manually adjust points';
END IF;

IF NOT EXISTS (
SELECT 1 FROM users 
WHERE id = target_user_id AND role = 'traveler'
) THEN
RAISE EXCEPTION 'Target user not found or is not a traveler';
END IF;

SELECT id, balance INTO v_wallet_id, v_current_balance
FROM toursred_points_wallets
WHERE user_id = target_user_id
FOR UPDATE;

IF v_wallet_id IS NULL THEN
INSERT INTO toursred_points_wallets (user_id, balance, is_active)
VALUES (target_user_id, 0, true)
RETURNING id, balance INTO v_wallet_id, v_current_balance;

SELECT id, balance INTO v_wallet_id, v_current_balance
FROM toursred_points_wallets
WHERE id = v_wallet_id
FOR UPDATE;
END IF;

v_new_balance := v_current_balance + points_amount;

INSERT INTO toursred_points_transactions (
wallet_id, user_id, amount, balance_after, type, description, reference_type, reference_id
) VALUES (
v_wallet_id, target_user_id, points_amount, v_new_balance,
'adjustment', adjustment_reason, 'adjustment', v_admin_id
) RETURNING id INTO v_transaction_id;

IF points_amount > 0 THEN
UPDATE toursred_points_wallets
SET balance = balance + points_amount,
total_earned = total_earned + points_amount,
updated_at = now()
WHERE id = v_wallet_id;
ELSE
UPDATE toursred_points_wallets
SET balance = balance + points_amount,
total_used = total_used + abs(points_amount),
updated_at = now()
WHERE id = v_wallet_id;
END IF;

RETURN jsonb_build_object(
'success', true,
'transaction_id', v_transaction_id,
'previous_balance', v_current_balance,
'adjustment', points_amount,
'new_balance', v_new_balance
);
END;
$function$;

CREATE OR REPLACE FUNCTION public.publish_new_terms_version(p_type text, p_title text, p_content text, p_change_summary text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
v_admin_id uuid;
v_admin_role text;
v_next_version integer;
v_new_id uuid;
BEGIN
v_admin_id := auth.uid();

IF v_admin_id IS NULL THEN
RETURN jsonb_build_object('success', false, 'error', 'Unauthorized');
END IF;

SELECT role INTO v_admin_role FROM users WHERE id = v_admin_id;

IF COALESCE(v_admin_role, '') NOT IN ('admin', 'super_admin') THEN
RETURN jsonb_build_object('success', false, 'error', 'Unauthorized');
END IF;

SELECT COALESCE(MAX(version_number), 0) + 1
INTO v_next_version
FROM terms_versions
WHERE terms_type = p_type;

UPDATE terms_versions
SET is_active = false
WHERE terms_type = p_type AND is_active = true;

INSERT INTO terms_versions (
terms_type,
version_number,
title,
content,
change_summary,
is_active,
published_at,
published_by_user_id
) VALUES (
p_type,
v_next_version,
p_title,
p_content,
p_change_summary,
true,
now(),
v_admin_id
)
RETURNING id INTO v_new_id;

RETURN jsonb_build_object(
'success', true,
'id', v_new_id,
'version_number', v_next_version
);
END;
$function$
;
