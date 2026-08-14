/*
# Create accounting entry function for executive commission payments

1. New Chart of Accounts entry
- `601.05` — "Comisiones a ejecutivos de cuenta" (gasto)
  Recognizes the expense of commissions paid to account executives.

2. New function
- `create_accounting_entry_for_executive_commission(p_commission_id uuid)`
  SECURITY DEFINER, search_path = 'public'.
  Generates an egreso accounting entry when an executive commission is marked as paid.
  - Debit: account 601.05 (gasto por comisión de ejecutivo)
  - Credit: account 102 (bancos — sale el dinero)
  - source_type = 'executive_commission', source_id = commission id
  - Idempotent: if an entry already exists for this source, returns NULL.

3. Security
- SECURITY DEFINER so it can be called by authenticated admins via RPC.
- Follows the same pattern as create_accounting_entry_for_payout.
*/

-- Create the expense account for executive commissions
INSERT INTO chart_of_accounts (code, sat_group_code, name, account_type, parent_code, level, nature, is_system, is_active, description)
VALUES ('601.05', '601', 'Comisiones a ejecutivos de cuenta', 'gasto', '601', 3, 'deudora', false, true,
        'Comisiones pagadas a ejecutivos de cuenta por aprobacion de agencias y reservas')
ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name, description = EXCLUDED.description;

-- Create the function
CREATE OR REPLACE FUNCTION public.create_accounting_entry_for_executive_commission(
  p_commission_id uuid
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_commission record;
  v_entry_id uuid;
  v_entry_number text;
  v_year integer;
  v_month integer;
  v_amount numeric;
  v_exec_name text;
BEGIN
  IF EXISTS (
    SELECT 1 FROM accounting_entries
    WHERE source_type = 'executive_commission' AND source_id = p_commission_id
  ) THEN
    RETURN NULL;
  END IF;

  SELECT ec.*, ae.first_name, ae.last_name
  INTO v_commission
  FROM executive_commissions ec
  LEFT JOIN account_executives ae ON ae.id = ec.executive_id
  WHERE ec.id = p_commission_id AND ec.status = 'paid';

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  v_amount := COALESCE(v_commission.amount, 0);
  IF v_amount = 0 THEN
    RETURN NULL;
  END IF;

  v_exec_name := COALESCE(v_commission.first_name, '') || ' ' || COALESCE(v_commission.last_name, '');
  v_year := EXTRACT(YEAR FROM COALESCE(v_commission.paid_at, CURRENT_DATE))::integer;
  v_month := EXTRACT(MONTH FROM COALESCE(v_commission.paid_at, CURRENT_DATE))::integer;

  v_entry_number := generate_entry_number('egreso', v_year, v_month);

  INSERT INTO accounting_entries (
    entry_number, entry_type, entry_date, period_year, period_month,
    description, source_type, source_id, is_posted
  ) VALUES (
    v_entry_number,
    'egreso',
    COALESCE(v_commission.paid_at, CURRENT_DATE),
    v_year,
    v_month,
    'Comision ejecutivo ' || trim(v_exec_name) || ' - ref: ' || COALESCE(v_commission.payment_reference, ''),
    'executive_commission',
    p_commission_id,
    true
  )
  RETURNING id INTO v_entry_id;

  INSERT INTO accounting_entry_lines (entry_id, line_number, account_code, description, debit, credit)
  VALUES (v_entry_id, 1, '601.05', 'Comision ejecutivo ' || trim(v_exec_name), v_amount, 0);

  INSERT INTO accounting_entry_lines (entry_id, line_number, account_code, description, debit, credit)
  VALUES (v_entry_id, 2, '102', 'Pago comision ejecutivo - ' || COALESCE(v_commission.payment_reference, ''), 0, v_amount);

  RETURN v_entry_id;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.create_accounting_entry_for_executive_commission(uuid) TO authenticated;