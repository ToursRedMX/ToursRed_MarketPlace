
-- Primero, reinicializar exemption_period_start correctamente para cada membresía
UPDATE memberships
SET exemption_period_start = CASE
  -- Si ya pasó más de un mes desde start_date, calcular el período actual correcto
  WHEN EXTRACT(YEAR FROM age(now(), start_date)) * 12 + 
       EXTRACT(MONTH FROM age(now(), start_date)) >= 1
  THEN 
    -- Calcular cuántos períodos completos han pasado
    start_date + (
      FLOOR(
        EXTRACT(epoch FROM (now() - start_date)) / (30 * 24 * 60 * 60)
      ) * interval '1 month'
    )
  ELSE
    -- Si no ha pasado un mes, mantener start_date
    start_date
END
WHERE status = 'active';

-- Resetear service_fee_exemption_used para membresías que necesitan reset
UPDATE memberships
SET service_fee_exemption_used = 0
WHERE status = 'active'
  AND EXTRACT(YEAR FROM age(now(), exemption_period_start)) * 12 +
      EXTRACT(MONTH FROM age(now(), exemption_period_start)) >= 1;

-- Recrear la función de reset con lógica mejorada
CREATE OR REPLACE FUNCTION reset_monthly_service_fee_exemption()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  membership_record RECORD;
  new_period_start timestamptz;
  months_to_add integer;
BEGIN
  FOR membership_record IN 
    SELECT id, start_date, exemption_period_start, service_fee_exemption_used
    FROM memberships
    WHERE status = 'active'
  LOOP
    -- Calcular cuántos meses han pasado desde el último período
    months_to_add := 0;
    new_period_start := membership_record.exemption_period_start;
    
    -- Mientras el próximo período ya haya pasado, avanzar
    WHILE new_period_start + interval '1 month' <= now() LOOP
      new_period_start := new_period_start + interval '1 month';
      months_to_add := months_to_add + 1;
    END LOOP;
    
    -- Si hay que avanzar al menos un mes, hacer el reset
    IF months_to_add > 0 THEN
      UPDATE memberships
      SET 
        exemption_period_start = new_period_start,
        service_fee_exemption_used = 0
      WHERE id = membership_record.id;
      
      RAISE NOTICE 'Reset exemption for membership % (advanced % months)', 
        membership_record.id, months_to_add;
    END IF;
  END LOOP;
END;
$$;
