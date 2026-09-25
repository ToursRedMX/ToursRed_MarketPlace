-- ============================================================================
-- La promocion de grupo se resta del total. Antes solo se guardaba.
--
-- QUE ESTABA PASANDO
--
-- `create_booking_atomic` inserta `promotion_id` y `promo_discount_amount` en
-- `bookings` tomandolos tal cual de `p_booking_data` (lo que manda el
-- cliente), pero jamas los resta de `v_base_tour_price`/`v_deposit_amount`.
-- El descuento por CODIGO si se recalcula server-side (seccion 3, ya
-- existia); el descuento por PROMOCION DE GRUPO nunca tuvo su contraparte:
-- quedaba como dato decorativo en la fila mientras el monto real a cobrar
-- salia sin el.
--
-- Se destapo el 24-sep-2026 probando un pago 100% ToursRed Cash con una
-- promocion de grupo activa en Teotihuacan: el cliente (que SI resta la
-- promocion antes de calcular el anticipo, ver src/utils/promocionDeGrupo.ts
-- y BookingFlowStep4.tsx) penso que $500 cubrian el 100% del exigible; el
-- servidor, ignorando la promocion, calculo un exigible de $1,000 sobre el
-- mismo booking. La diferencia ($500) se colaba a Stripe sin que nadie la
-- pidiera. Dos reservas de prueba lo confirman (b64d9425, 2cf3a369): las dos
-- tienen `promo_discount_amount = 1000.00` pero `total_price = 2000.00` y
-- `deposit_amount = 1000.00` — el descuento nunca bajo del total.
--
-- Esto no es solo el caso del wallet: CUALQUIER reserva con promocion de
-- grupo activa se cobra sobre el monto SIN descuento, sin importar el medio
-- de pago. No hay reservas reales con promocion todavia (son pruebas de
-- Axel), pero el codigo no puede llegar asi a UAT.
--
-- QUE HACE ESTA MIGRACION
--
-- Portea `calcularPromocionDeGrupo` (src/utils/promocionDeGrupo.ts) a
-- PL/pgSQL: resuelve la promocion vigente del tour igual que
-- `get_active_promotion_for_tour`, cuenta viajeros HUMANOS por categoria
-- (las mascotas no cuentan, igual que en el front) y calcula el descuento
-- segun el tipo — `nxprecio`, `grupo_precio_fijo` (que pese al nombre es un
-- porcentaje) o `2x1`/`3x2` — con el mismo tope de usos por reserva que ya
-- documenta el comentario del archivo TS. El resultado se resta ANTES del
-- codigo de descuento (que ahora se aplica sobre el precio YA con promocion,
-- igual que hace el cliente en `precioTrasPromocion`), y pasa a ser la
-- fuente de verdad para `promotion_id`/`promo_discount_amount` en el INSERT
-- — el servidor deja de confiar en lo que mande el cliente para estos dos
-- campos, mismo criterio que ya aplica a puntos y wallet.
--
-- `v_commission_amount` (comision de agencia) NO se toca aqui: ya se
-- calculaba sobre el precio SIN descontar ni siquiera el codigo de
-- descuento, asi que esta migracion no le cambia el comportamiento. Si eso
-- debe cambiar es una decision de negocio aparte, no un efecto colateral de
-- este fix.
--
-- POR QUE SE PARCHEA Y NO SE REESCRIBE LA FUNCION
--
-- Mismo motivo que 20260912010000_sexo_del_viajero.sql: 743 lineas,
-- transcribirlas para tocar unas pocas es la forma mas facil de meter un
-- error invisible. Se leen desde pg_proc, se sustituyen tramos EXACTOS
-- verificados como unicos, y se comprueba el resultado despues.
-- ============================================================================

DO $migracion$
DECLARE
  v_src         text;
  v_nuevo       text;
  v_identidad   text := 'p_booking_data jsonb, p_travelers jsonb, p_optional_services jsonb, p_session_id text, p_seat_numbers integer[]';
  v_firma       text;
  v_veces       int;

  -- 1. Declaraciones nuevas, justo despues de v_discount_rec.
  v_decl_viejo  text := E'v_discount_rec             record;\n';
  v_decl_nuevo  text := E'v_discount_rec             record;\nv_promo_id                 uuid;\nv_promo_type               text;\nv_promo_min_travelers      integer;\nv_promo_group_size         integer;\nv_promo_pay_count          integer;\nv_promo_fixed_group_price  numeric;\nv_promo_discount_pct       numeric;\nv_promo_max_uses           integer;\nv_promo_times_used         integer;\nv_promo_discount           numeric := 0;\nv_cnt_adulto               integer := 0;\nv_cnt_nino                 integer := 0;\nv_cnt_infante              integer := 0;\nv_cnt_adulto_mayor         integer := 0;\nv_humanos                  integer := 0;\nv_promo_grupos             integer := 0;\nv_promo_usos_restantes     integer := 0;\nv_promo_grupos_con         integer := 0;\nv_promo_precio_adulto      numeric := 0;\nv_promo_precio_nino        numeric := 0;\nv_promo_precio_infante     numeric := 0;\nv_promo_precio_adulto_mayor numeric := 0;\n';

  -- 2. Dentro del loop de la seccion 1: cuenta por categoria, y despues del
  --    loop, resuelve la promocion vigente y calcula su descuento. El ancla
  --    incluye la acumulacion de v_base_tour_price y el cierre del loop para
  --    que NO empate con el CASE identico que hay mas abajo (INSERT
  --    TRAVELERS), que no acumula ni cierra el loop igual.
  v_loop_viejo  text := E'v_traveler_price := CASE\nWHEN v_cat = ''adulto''         THEN COALESCE(v_tour.precio_adulto, v_tour.price, 0)\nWHEN v_cat = ''nino''           THEN COALESCE(v_tour.precio_nino, v_tour.price, 0)\nWHEN v_cat = ''infante''        THEN COALESCE(v_tour.precio_infante, 0)\nWHEN v_cat = ''adulto_mayor''   THEN COALESCE(v_tour.precio_adulto_mayor, v_tour.price, 0)\nWHEN v_cat = ''mascota''        THEN COALESCE(v_tour.precio_mascota, 0)\nELSE COALESCE(v_tour.price, 0)\nEND;\nv_base_tour_price := v_base_tour_price + v_traveler_price;\nEND LOOP;\nEND IF;';

  v_loop_nuevo  text := E'v_traveler_price := CASE\nWHEN v_cat = ''adulto''         THEN COALESCE(v_tour.precio_adulto, v_tour.price, 0)\nWHEN v_cat = ''nino''           THEN COALESCE(v_tour.precio_nino, v_tour.price, 0)\nWHEN v_cat = ''infante''        THEN COALESCE(v_tour.precio_infante, 0)\nWHEN v_cat = ''adulto_mayor''   THEN COALESCE(v_tour.precio_adulto_mayor, v_tour.price, 0)\nWHEN v_cat = ''mascota''        THEN COALESCE(v_tour.precio_mascota, 0)\nELSE COALESCE(v_tour.price, 0)\nEND;\nv_base_tour_price := v_base_tour_price + v_traveler_price;\nIF v_cat = ''adulto'' THEN v_cnt_adulto := v_cnt_adulto + 1;\nELSIF v_cat = ''nino'' THEN v_cnt_nino := v_cnt_nino + 1;\nELSIF v_cat = ''infante'' THEN v_cnt_infante := v_cnt_infante + 1;\nELSIF v_cat = ''adulto_mayor'' THEN v_cnt_adulto_mayor := v_cnt_adulto_mayor + 1;\nEND IF;\nEND LOOP;\nEND IF;\n\n-- ---- 1.5 GROUP PROMOTION (portado de src/utils/promocionDeGrupo.ts) ----\n-- Solo viajeros HUMANOS cuentan para el grupo, igual que humanos() en el TS.\nv_humanos := v_cnt_adulto + v_cnt_nino + v_cnt_infante + v_cnt_adulto_mayor;\n\nSELECT tp.id, tp.promotion_type::text, tp.min_travelers, tp.group_size, tp.pay_count,\ntp.fixed_group_price, tp.group_discount_percentage, tp.max_uses, tp.times_used\nINTO v_promo_id, v_promo_type, v_promo_min_travelers, v_promo_group_size, v_promo_pay_count,\nv_promo_fixed_group_price, v_promo_discount_pct, v_promo_max_uses, v_promo_times_used\nFROM tour_promotions tp\nWHERE tp.tour_id = v_tour_id\nAND tp.is_active = true\nAND (tp.valid_from IS NULL OR tp.valid_from::date <= CURRENT_DATE)\nAND (tp.valid_until IS NULL OR tp.valid_until::date >= CURRENT_DATE)\nAND (tp.max_uses IS NULL OR tp.times_used < tp.max_uses)\nORDER BY tp.created_at DESC\nLIMIT 1;\n\nv_promo_precio_adulto := COALESCE(v_tour.precio_adulto, v_tour.price, 0);\nv_promo_precio_nino := COALESCE(v_tour.precio_nino, 0);\nv_promo_precio_infante := COALESCE(v_tour.precio_infante, 0);\nv_promo_precio_adulto_mayor := COALESCE(v_tour.precio_adulto_mayor, v_tour.precio_adulto, v_tour.price, 0);\n\n-- Los IS NOT NULL van PRIMERO en cada condicion a proposito: el resto de la\n-- funcion ya asume evaluacion de izquierda a derecha con corte temprano en\n-- AND (ver v_tour_duration_days mas abajo), asi que se sigue el mismo\n-- criterio en vez de introducir uno distinto aqui.\nIF v_promo_type = ''nxprecio'' AND v_promo_min_travelers IS NOT NULL AND v_promo_min_travelers > 0\nAND v_humanos >= v_promo_min_travelers AND v_promo_fixed_group_price IS NOT NULL THEN\nv_promo_grupos := FLOOR(v_humanos::numeric / v_promo_min_travelers);\nv_promo_usos_restantes := CASE WHEN v_promo_max_uses IS NOT NULL\nTHEN GREATEST(0, v_promo_max_uses - v_promo_times_used)\nELSE v_promo_grupos END;\nv_promo_grupos_con := LEAST(v_promo_grupos, v_promo_usos_restantes);\nv_promo_discount := ROUND(\nv_promo_grupos_con * GREATEST(0, (v_promo_min_travelers * v_promo_precio_adulto) - v_promo_fixed_group_price),\n2\n);\n\nELSIF v_promo_type = ''grupo_precio_fijo'' AND v_promo_min_travelers IS NOT NULL\nAND v_humanos >= v_promo_min_travelers\nAND v_promo_discount_pct IS NOT NULL AND v_promo_discount_pct > 0 THEN\nv_promo_discount := ROUND(\n(v_promo_precio_adulto * v_cnt_adulto\n+ v_promo_precio_nino * v_cnt_nino\n+ v_promo_precio_infante * v_cnt_infante\n+ v_promo_precio_adulto_mayor * v_cnt_adulto_mayor) * (v_promo_discount_pct / 100),\n2\n);\n\nELSIF v_promo_type IN (''2x1'', ''3x2'') AND v_promo_group_size IS NOT NULL AND v_promo_pay_count IS NOT NULL\nAND v_humanos >= v_promo_group_size AND (v_promo_group_size - v_promo_pay_count) > 0 THEN\nv_promo_discount := ROUND(\nFLOOR(v_humanos::numeric / v_promo_group_size) * (v_promo_group_size - v_promo_pay_count) * v_promo_precio_adulto,\n2\n);\nEND IF;\n\nv_promo_discount := GREATEST(0, LEAST(v_promo_discount, v_base_tour_price));';

  -- 3. El codigo de descuento pasa a aplicarse sobre el precio YA con
  --    promocion (igual que precioTrasPromocion en el cliente), y
  --    v_base_tour_price_discounted resta las dos cosas.
  v_desc_viejo  text := E'IF v_discount_rec.discount_type IN (''tour_percentage'', ''agency_tour_percentage'') THEN\nv_discount_amount := v_base_tour_price\n* COALESCE(v_discount_rec.discount_value, 0) / 100;\nIF v_discount_rec.max_discount_amount IS NOT NULL THEN\nv_discount_amount := LEAST(v_discount_amount, v_discount_rec.max_discount_amount);\nEND IF;\nELSIF v_discount_rec.discount_type IN (''tour_fixed'', ''agency_tour_fixed'') THEN\nv_discount_amount := COALESCE(v_discount_rec.discount_value, 0);\nEND IF;\nEND IF;\nEXCEPTION WHEN OTHERS THEN\nv_discount_amount := 0;\nEND;\nEND IF;\n\n-- ---- 4. CALCULATE DISCOUNTED TOUR PRICE AND BASE SERVICE CHARGE ----\nv_base_tour_price_discounted := GREATEST(0, v_base_tour_price - v_discount_amount);';

  v_desc_nuevo  text := E'IF v_discount_rec.discount_type IN (''tour_percentage'', ''agency_tour_percentage'') THEN\nv_discount_amount := GREATEST(0, v_base_tour_price - v_promo_discount)\n* COALESCE(v_discount_rec.discount_value, 0) / 100;\nIF v_discount_rec.max_discount_amount IS NOT NULL THEN\nv_discount_amount := LEAST(v_discount_amount, v_discount_rec.max_discount_amount);\nEND IF;\nELSIF v_discount_rec.discount_type IN (''tour_fixed'', ''agency_tour_fixed'') THEN\nv_discount_amount := COALESCE(v_discount_rec.discount_value, 0);\nEND IF;\nEND IF;\nEXCEPTION WHEN OTHERS THEN\nv_discount_amount := 0;\nEND;\nEND IF;\n\n-- ---- 4. CALCULATE DISCOUNTED TOUR PRICE AND BASE SERVICE CHARGE ----\n-- Resta tambien v_promo_discount (seccion 1.5): antes la promocion de grupo\n-- solo se guardaba, nunca bajaba el total. Ver encabezado de esta migracion.\nv_base_tour_price_discounted := GREATEST(0, v_base_tour_price - v_promo_discount - v_discount_amount);';

  -- 4. El INSERT deja de confiar en lo que mande el cliente para estos dos
  --    campos: usa lo que el servidor acaba de resolver, mismo criterio que
  --    ya aplica a puntos y wallet.
  v_ins_viejo   text := E'NULLIF(p_booking_data->>''promotion_id'', '''')::uuid,\nCOALESCE((p_booking_data->>''promo_discount_amount'')::numeric, 0),';
  v_ins_nuevo   text := E'v_promo_id,\nv_promo_discount,';

  -- 5. Se agrega al jsonb de respuesta para que el cliente pueda, a futuro,
  --    sincronizarse igual que ya hace con puntos y wallet (adjustedByServer).
  v_ret_viejo   text := E'''service_charge'', v_deposit_sc,\n''is_full_wallet'', v_is_full_wallet\n);';
  v_ret_nuevo   text := E'''service_charge'', v_deposit_sc,\n''is_full_wallet'', v_is_full_wallet,\n''promo_discount_amount'', v_promo_discount\n);';
BEGIN
  SELECT p.prosrc, pg_get_function_arguments(p.oid) INTO v_src, v_firma
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public'
     AND p.proname = 'create_booking_atomic'
     AND pg_get_function_identity_arguments(p.oid) = v_identidad;

  IF v_src IS NULL THEN
    RAISE EXCEPTION 'Abortada: no existe create_booking_atomic(%). Revisa la cadena de migraciones.', v_identidad;
  END IF;

  IF position('v_promo_discount' in v_src) > 0 THEN
    RAISE NOTICE 'create_booking_atomic ya resta la promocion de grupo; no se toca.';
  ELSE
    v_veces := (length(v_src) - length(replace(v_src, v_decl_viejo, ''))) / length(v_decl_viejo);
    IF v_veces <> 1 THEN
      RAISE EXCEPTION 'Abortada: el ancla de declaraciones aparece % veces, se esperaba 1.', v_veces;
    END IF;

    v_veces := (length(v_src) - length(replace(v_src, v_loop_viejo, ''))) / length(v_loop_viejo);
    IF v_veces <> 1 THEN
      RAISE EXCEPTION 'Abortada: el ancla del loop de viajeros aparece % veces, se esperaba 1.', v_veces;
    END IF;

    v_veces := (length(v_src) - length(replace(v_src, v_desc_viejo, ''))) / length(v_desc_viejo);
    IF v_veces <> 1 THEN
      RAISE EXCEPTION 'Abortada: el ancla del codigo de descuento aparece % veces, se esperaba 1.', v_veces;
    END IF;

    v_veces := (length(v_src) - length(replace(v_src, v_ins_viejo, ''))) / length(v_ins_viejo);
    IF v_veces <> 1 THEN
      RAISE EXCEPTION 'Abortada: el ancla del INSERT (promotion_id/promo_discount_amount) aparece % veces, se esperaba 1.', v_veces;
    END IF;

    v_veces := (length(v_src) - length(replace(v_src, v_ret_viejo, ''))) / length(v_ret_viejo);
    IF v_veces <> 1 THEN
      RAISE EXCEPTION 'Abortada: el ancla del jsonb de respuesta aparece % veces, se esperaba 1.', v_veces;
    END IF;

    v_nuevo := v_src;
    v_nuevo := replace(v_nuevo, v_decl_viejo, v_decl_nuevo);
    v_nuevo := replace(v_nuevo, v_loop_viejo, v_loop_nuevo);
    v_nuevo := replace(v_nuevo, v_desc_viejo, v_desc_nuevo);
    v_nuevo := replace(v_nuevo, v_ins_viejo, v_ins_nuevo);
    v_nuevo := replace(v_nuevo, v_ret_viejo, v_ret_nuevo);

    IF v_nuevo = v_src THEN
      RAISE EXCEPTION 'Abortada: el reemplazo no cambio nada.';
    END IF;

    -- CREATE OR REPLACE conserva los GRANT. Se repiten los atributos porque
    -- omitir uno los pierde: sin SECURITY DEFINER la funcion dejaria de poder
    -- escribir, y sin `SET search_path` la guardia de CI la marcaria en rojo.
    EXECUTE format(
      'CREATE OR REPLACE FUNCTION public.create_booking_atomic(%s) '
      'RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS %L',
      v_firma, v_nuevo);
  END IF;

  -- --------------------------------------------------------------------------
  -- Se comprueba que quedo como debe.
  -- --------------------------------------------------------------------------
  SELECT p.prosrc INTO v_src
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname='public' AND p.proname='create_booking_atomic'
     AND pg_get_function_identity_arguments(p.oid) = v_identidad;

  IF position('tour_promotions' in v_src) = 0 OR position('v_promo_discount' in v_src) = 0 THEN
    RAISE EXCEPTION 'Abortada: create_booking_atomic sigue sin restar la promocion de grupo.';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
                  WHERE n.nspname='public' AND p.proname='create_booking_atomic'
                    AND p.prosecdef AND p.proconfig @> ARRAY['search_path=public']) THEN
    RAISE EXCEPTION 'Abortada: la funcion perdio SECURITY DEFINER o su search_path.';
  END IF;

  RAISE NOTICE 'Listo: create_booking_atomic ya resta la promocion de grupo del total, no solo la guarda.';
END $migracion$;
