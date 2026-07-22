-- Agregar campo para rastrear el inicio del período mensual
DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'memberships' AND column_name = 'exemption_period_start'
  ) THEN
    ALTER TABLE memberships ADD COLUMN exemption_period_start timestamptz DEFAULT now();
    
    -- Inicializar con la fecha de inicio para membresías existentes
    UPDATE memberships 
    SET exemption_period_start = start_date 
    WHERE exemption_period_start IS NULL;
  END IF;
END $$;

-- Función para resetear el contador mensual si ha pasado un mes
CREATE OR REPLACE FUNCTION reset_monthly_service_fee_exemption()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  membership_record RECORD;
  months_passed integer;
BEGIN
  -- Procesar todas las membresías activas
  FOR membership_record IN 
    SELECT id, exemption_period_start, service_fee_exemption_used
    FROM memberships
    WHERE status = 'active'
  LOOP
    -- Calcular cuántos meses han pasado desde el último reset
    months_passed := EXTRACT(YEAR FROM age(now(), membership_record.exemption_period_start)) * 12 +
                     EXTRACT(MONTH FROM age(now(), membership_record.exemption_period_start));
    
    -- Si ha pasado al menos un mes, resetear
    IF months_passed >= 1 THEN
      -- Avanzar el período de inicio por el número de meses que han pasado
      UPDATE memberships
      SET 
        exemption_period_start = exemption_period_start + (months_passed || ' months')::interval,
        service_fee_exemption_used = 0
      WHERE id = membership_record.id;
      
      RAISE NOTICE 'Reset exemption for membership % (% months passed)', membership_record.id, months_passed;
    END IF;
  END LOOP;
END;
$$;

-- Ejecutar el reset inmediatamente para membresías que lo necesiten
SELECT reset_monthly_service_fee_exemption();
