-- snapshot_booking_tax: alinear el literal de payment_status con el valor que existe
--
-- El guard de salida temprana era:
--
--     IF NEW.paid_at IS NULL AND COALESCE(NEW.payment_status, '') <> 'paid' THEN
--       RETURN NEW;
--     END IF;
--
-- pero 'paid' NO es un valor posible de bookings.payment_status. El CHECK real
-- (bookings_payment_status_check) admite exactamente:
--
--     pending | processing | succeeded | failed | canceled
--
-- Esa mitad de la condicion nunca podia ser verdadera, asi que el snapshot fiscal
-- colgaba ENTERAMENTE de que paid_at quedara escrito. Si un procesador nuevo o un
-- camino de cobro olvidaba paid_at, la reserva se guardaba sin tax_treatment y el
-- CFDI salia gravado al 16% sin que nada fallara: el error se veia hasta el cron
-- check_missing_tax_snapshots, que avisa DESPUES de cobrar, no antes de facturar.
--
-- Se sustituye 'paid' por 'succeeded' (el valor terminal de exito real). No se
-- agrega junto al inventado: 'paid' se va, porque dejarlo solo perpetua la
-- confusion sobre cual es el vocabulario bueno.
--
-- Nota sobre el alcance: el trigger es BEFORE INSERT OR UPDATE y se creo en
-- 20260901064051, posterior a la ultima escritura sobre bookings (2026-08-30).
-- Nunca ha disparado sobre una reserva real, asi que este cambio no altera
-- ninguna fila existente; corrige el comportamiento de aqui en adelante.

-- Aserción: si 'succeeded' deja de ser un valor válido de payment_status, esta
-- migración falla ruidosamente en vez de reintroducir en silencio el mismo bug.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.bookings'::regclass
      AND conname  = 'bookings_payment_status_check'
      AND pg_get_constraintdef(oid) LIKE '%''succeeded''%'
  ) THEN
    RAISE EXCEPTION
      'bookings_payment_status_check ya no admite ''succeeded''; snapshot_booking_tax quedaria con un literal muerto otra vez. Revisa el vocabulario real antes de continuar.';
  END IF;
END
$$;

CREATE OR REPLACE FUNCTION public.snapshot_booking_tax()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_tour   RECORD;
  v_gross  numeric;
  v_calc   RECORD;
BEGIN
  IF NEW.tax_treatment IS NOT NULL THEN
    RETURN NEW;
  END IF;

  -- Dos hilos independientes: paid_at escrito, o payment_status en su valor
  -- terminal de exito. Antes el segundo era 'paid', que no existe.
  IF NEW.paid_at IS NULL AND COALESCE(NEW.payment_status, '') <> 'succeeded' THEN
    RETURN NEW;
  END IF;

  BEGIN
    SELECT t.tax_treatment, t.exempt_ratio INTO v_tour
    FROM public.tours t WHERE t.id = NEW.tour_id;

    IF NOT FOUND THEN
      RETURN NEW;
    END IF;

    v_gross := COALESCE(NEW.deposit_amount, NEW.total_price, 0);
    SELECT * INTO v_calc FROM public.compute_tax_snapshot(v_gross, v_tour.tax_treatment, v_tour.exempt_ratio);

    NEW.tax_treatment := v_tour.tax_treatment;
    NEW.exempt_ratio  := v_tour.exempt_ratio;
    NEW.exempt_amount := v_calc.exempt_amount;
    NEW.taxable_base  := v_calc.taxable_base;
    NEW.vat_amount    := v_calc.vat_amount;
    NEW.tax_rate      := v_calc.tax_rate;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'snapshot_booking_tax fallo para booking %: % (%)', NEW.id, SQLERRM, SQLSTATE;
    NEW.tax_treatment := NULL; NEW.exempt_ratio := NULL; NEW.exempt_amount := NULL;
    NEW.taxable_base  := NULL; NEW.vat_amount   := NULL; NEW.tax_rate      := NULL;
  END;
  RETURN NEW;
END;
$function$;
