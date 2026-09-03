
-- Desactivar el cron job de expiración de puntos
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM cron.job WHERE jobname = 'expire-toursred-points'
  ) THEN
    PERFORM cron.unschedule('expire-toursred-points');
  END IF;
END $$;

-- Actualizar el trigger para NO asignar expires_at a nuevos puntos
CREATE OR REPLACE FUNCTION public.award_points_on_payment()
RETURNS TRIGGER
SECURITY DEFINER
SET search_path = public
LANGUAGE plpgsql
AS $$
DECLARE
  v_membership_record RECORD;
  v_points_to_award INTEGER;
  v_wallet_id UUID;
BEGIN
  -- Solo procesar si el pago fue exitoso y los puntos aún no se otorgaron
  IF NEW.payment_status = 'succeeded' 
     AND (OLD.payment_status IS NULL OR OLD.payment_status != 'succeeded')
     AND (NEW.points_earned IS NULL OR NEW.points_earned = 0) THEN
    
    -- Verificar que el usuario tenga membresía activa
    SELECT m.* INTO v_membership_record
    FROM public.toursred_plus_memberships m
    WHERE m.user_id = NEW.user_id
      AND m.status = 'active'
    ORDER BY m.created_at DESC
    LIMIT 1;

    IF v_membership_record.id IS NOT NULL THEN
      -- Calcular puntos: 1 punto por cada peso gastado (total_price en centavos, convertir a pesos)
      v_points_to_award := FLOOR(NEW.total_price / 100)::INTEGER;

      IF v_points_to_award > 0 THEN
        -- Obtener wallet_id
        SELECT id INTO v_wallet_id
        FROM public.toursred_points_wallets
        WHERE user_id = NEW.user_id;

        IF v_wallet_id IS NOT NULL THEN
          -- Registrar transacción de puntos ganados (SIN expires_at)
          INSERT INTO public.toursred_points_transactions (
            wallet_id,
            user_id,
            amount,
            type,
            description,
            reference_type,
            reference_id,
            expires_at
          ) VALUES (
            v_wallet_id,
            NEW.user_id,
            v_points_to_award,
            'earned',
            'Puntos ganados por reserva completada',
            'booking',
            NEW.id,
            NULL
          );

          -- Actualizar el booking con los puntos ganados
          NEW.points_earned := v_points_to_award;
        END IF;
      END IF;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;
