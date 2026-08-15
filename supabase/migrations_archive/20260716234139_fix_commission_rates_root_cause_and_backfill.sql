/*
# Corregir tasas de comisión hardcoded en commission_records (causa raíz)

## Problema
El trigger `create_commission_record()` no insertaba las columnas
`agency_commission_rate` ni `service_charge_rate`. Como esas columnas
tenían DEFAULT 0.10/0.03, todos los registros se creaban con 10%/3%.

## Cambios
1. Quitar los DEFAULT 0.10/0.03 de las columnas de tasas.
2. Reescribir el trigger para insertar tasas reales (inline lookup).
3. Backfill de registros existentes con tasas viejas.

## Notas
- No se elimina ningún dato.
- El backfill solo toca registros con tasas exactamente 0.10 o 0.03.
- Se hace lookup inline para evitar ambigüedad de overload de
  get_effective_commission_rates (existe una versión de 2 args con
  DEFAULT NULL que hace la llamada de 1 arg ambigua).
*/

-- ============================================================
-- 1. Quitar DEFAULT hardcoded de las columnas de tasas
-- ============================================================
ALTER TABLE commission_records ALTER COLUMN agency_commission_rate DROP DEFAULT;
ALTER TABLE commission_records ALTER COLUMN service_charge_rate DROP DEFAULT;

-- ============================================================
-- 2. Reescribir el trigger create_commission_record
-- ============================================================
CREATE OR REPLACE FUNCTION public.create_commission_record()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_agency_rate numeric;
  v_service_rate numeric;
  v_agency_commission numeric;
  v_service_charge numeric;
  v_platform_revenue numeric;
  v_agency_net numeric;
BEGIN
  IF NEW.payment_status = 'succeeded' AND (OLD.payment_status IS NULL OR OLD.payment_status != 'succeeded') THEN

    -- Lookup inline: tasa de la agencia, fallback a platform_settings
    SELECT a.commission_rate INTO v_agency_rate
    FROM public.agencies a WHERE a.id = NEW.agency_id;

    SELECT ps.service_charge_percentage / 100.0 INTO v_service_rate
    FROM public.platform_settings ps LIMIT 1;

    v_agency_rate := COALESCE(v_agency_rate, 0.15);
    v_service_rate := COALESCE(v_service_rate, 0.05);

    v_agency_commission := NEW.total_price * v_agency_rate;
    v_service_charge := NEW.total_price * v_service_rate;
    v_platform_revenue := v_agency_commission + v_service_charge;
    v_agency_net := NEW.total_price - v_agency_commission;

    INSERT INTO commission_records (
      booking_id, agency_id, tour_id, total_tour_price,
      agency_commission_rate, agency_commission_amount,
      service_charge_rate, service_charge_amount,
      platform_total_revenue, agency_net_amount,
      travel_insurance_amount, status
    ) VALUES (
      NEW.id, NEW.agency_id, NEW.tour_id, NEW.total_price,
      v_agency_rate, v_agency_commission,
      v_service_rate, v_service_charge,
      v_platform_revenue, v_agency_net,
      COALESCE(NEW.travel_insurance_cost, 0), 'pending'
    );
  END IF;
  RETURN NEW;
END;
$$;

-- ============================================================
-- 3. Backfill: corregir registros con tasas viejas 0.10/0.03
-- ============================================================
DO $$
DECLARE
  v_rec RECORD;
  v_agency_rate numeric;
  v_service_rate numeric;
  v_updated_count integer := 0;
BEGIN
  FOR v_rec IN
    SELECT cr.id, cr.agency_id, cr.total_tour_price
    FROM public.commission_records cr
    WHERE cr.agency_commission_rate = 0.10
       OR cr.service_charge_rate = 0.03
  LOOP
    -- Lookup inline de tasas correctas
    SELECT a.commission_rate INTO v_agency_rate
    FROM public.agencies a WHERE a.id = v_rec.agency_id;

    SELECT ps.service_charge_percentage / 100.0 INTO v_service_rate
    FROM public.platform_settings ps LIMIT 1;

    v_agency_rate := COALESCE(v_agency_rate, 0.15);
    v_service_rate := COALESCE(v_service_rate, 0.05);

    UPDATE public.commission_records
    SET
      agency_commission_rate = v_agency_rate,
      service_charge_rate = v_service_rate,
      agency_commission_amount = v_rec.total_tour_price * v_agency_rate,
      service_charge_amount = v_rec.total_tour_price * v_service_rate,
      platform_total_revenue = v_rec.total_tour_price * (v_agency_rate + v_service_rate),
      agency_net_amount = v_rec.total_tour_price * (1 - v_agency_rate)
    WHERE id = v_rec.id;

    v_updated_count := v_updated_count + 1;
  END LOOP;
  RAISE NOTICE 'Backfill completado: % registros actualizados', v_updated_count;
END $$;
