-- create_booking_atomic escribe amount_due_now con v_amount_to_charge, el mismo
-- valor que ya calculaba y solo devolvia en el eco del RPC.
--
-- Un unico hunk sobre el INSERT. Se aplica como transformacion textual sobre la
-- definicion viva para no retipear las 771 lineas de la funcion y arriesgar tocar
-- por accidente algo de las 6 migraciones previas (preventa, precios, pickup,
-- exencion, descuentos, tope de anticipo). Cada reemplazo aborta si su ancla no
-- aparece exactamente una vez.
DO $mig$
DECLARE v_new text; v_prev text;
BEGIN
  v_new := pg_get_functiondef('public.create_booking_atomic(jsonb,jsonb,jsonb,text,integer[])'::regprocedure);

  v_prev := v_new;
  v_new := replace(v_new,
$a$selected_payment_mode, membership_purchased, membership_plan, membership_cost,
initial_payment_amount,
used_membership_benefit, membership_service_fee_saved
)$a$,
$a$selected_payment_mode, membership_purchased, membership_plan, membership_cost,
initial_payment_amount, amount_due_now,
used_membership_benefit, membership_service_fee_saved
)$a$);
  IF v_new = v_prev THEN RAISE EXCEPTION 'ancla 1 (lista de columnas) no encontrada'; END IF;

  v_prev := v_new;
  v_new := replace(v_new,
$a$v_membership_cost,
v_amount_to_charge,
(v_has_membership OR v_membership_purchased),
v_total_exemption
)$a$,
$a$v_membership_cost,
v_amount_to_charge,
v_amount_to_charge,
(v_has_membership OR v_membership_purchased),
v_total_exemption
)$a$);
  IF v_new = v_prev THEN RAISE EXCEPTION 'ancla 2 (lista de valores) no encontrada'; END IF;

  EXECUTE v_new;
END $mig$;
