-- Mapa de asientos por horario y capacidad como TOPE (31-oct-2026).
--
-- LO QUE SE ENCONTRO (medido contra la base):
--   1. `tour_slots.vehicle_map_type` existe desde hace meses (0 de 143 horarios futuros lo usan) y `effective_vehicle_map_type(tour, slot)`
--      tambien, pero NADIE la usaba: el selector de asientos, el gestor de la agencia y las dos funciones que validan asientos leian
--      `tours.vehicle_map_type`. Un tour con Sprinter por omision y un bus de 60 solo en los horarios de mucha demanda era imposible.
--      Ademas `effective_vehicle_map_type` NO estaba en ninguna migracion del repo: se creo fuera de el. Aqui pasa a ser del repo.
--   2. Nada impedia una capacidad mayor que los asientos del mapa (Tour a Teotihuacan: mapa de 60 y cupos de 20, sin ninguna senal), ni
--      que `hold_seats` apartara el asiento 59 en una Sprinter de 20: solo cuenta lugares, no valida el numero contra el mapa.
--
-- REGLA: la capacidad es un tope de lo que se VENDE y puede ser menor que el mapa (un hotel o un lugar con menos cupo que el autobus), pero
-- nunca mayor. Y un asiento solo existe si esta en el mapa efectivo del horario.
--
-- NO cambia el calculo de disponibilidad (capacidad - reservas - externos - bloqueados - apartados): ver `toursred_ops.inventory`.

-- 1. Mapa efectivo del horario: el del horario si tiene propio, y si no el del tour. (Misma definicion que ya existia en la base.)
CREATE OR REPLACE FUNCTION public.effective_vehicle_map_type(p_tour_id uuid, p_slot_id uuid DEFAULT NULL::uuid)
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select coalesce(
    (select s.vehicle_map_type from public.tour_slots s where s.id=p_slot_id and s.tour_id=p_tour_id),
    (select t.vehicle_map_type from public.tours t where t.id=p_tour_id));
$function$;

-- 2. Asientos del mapa efectivo (null si no hay mapa o no esta activo).
CREATE OR REPLACE FUNCTION public.effective_vehicle_capacity(p_tour_id uuid, p_slot_id uuid DEFAULT NULL::uuid)
 RETURNS integer
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select l.capacity
  from public.vehicle_seat_layouts l
  where l.type = public.effective_vehicle_map_type(p_tour_id, p_slot_id) and l.is_active
  limit 1;
$function$;

-- Solo para usuarios con sesion y el servidor: nada de anon (ver 20261030092218).
REVOKE ALL ON FUNCTION public.effective_vehicle_map_type(uuid, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.effective_vehicle_capacity(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.effective_vehicle_map_type(uuid, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.effective_vehicle_capacity(uuid, uuid) TO authenticated, service_role;

-- 3. La capacidad de un horario no puede pasar de los asientos de su mapa.
CREATE OR REPLACE FUNCTION public.validar_capacidad_de_horario()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_map text;
  v_cap integer;
BEGIN
  v_map := coalesce(NEW.vehicle_map_type, (SELECT t.vehicle_map_type FROM public.tours t WHERE t.id = NEW.tour_id));
  IF v_map IS NULL THEN
    RETURN NEW;
  END IF;
  SELECT l.capacity INTO v_cap FROM public.vehicle_seat_layouts l WHERE l.type = v_map AND l.is_active LIMIT 1;
  IF v_cap IS NOT NULL AND NEW.capacity > v_cap THEN
    RAISE EXCEPTION 'La capacidad del horario (%) no puede ser mayor a los asientos del vehiculo (% en %)', NEW.capacity, v_cap, v_map
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.validar_capacidad_de_horario() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.validar_capacidad_de_horario() TO service_role;

DROP TRIGGER IF EXISTS trg_validar_capacidad_de_horario ON public.tour_slots;
CREATE TRIGGER trg_validar_capacidad_de_horario
  BEFORE INSERT OR UPDATE OF capacity, vehicle_map_type ON public.tour_slots
  FOR EACH ROW EXECUTE FUNCTION public.validar_capacidad_de_horario();

-- 4. Lo mismo en el tour: los cupos por horario no pueden pasar del mapa, y no se puede cambiar a un mapa mas chico que la capacidad de
-- horarios futuros que no tengan mapa propio (esos heredan el del tour).
CREATE OR REPLACE FUNCTION public.validar_capacidad_de_tour()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_cap integer;
BEGIN
  IF NEW.vehicle_map_type IS NULL THEN
    RETURN NEW;
  END IF;
  SELECT l.capacity INTO v_cap FROM public.vehicle_seat_layouts l WHERE l.type = NEW.vehicle_map_type AND l.is_active LIMIT 1;
  IF v_cap IS NULL THEN
    RETURN NEW;
  END IF;
  IF NEW.default_slot_capacity IS NOT NULL AND NEW.default_slot_capacity > v_cap THEN
    RAISE EXCEPTION 'Los cupos por horario (%) no pueden ser mayores a los asientos del vehiculo (% en %)', NEW.default_slot_capacity, v_cap, NEW.vehicle_map_type
      USING ERRCODE = '23514';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.tour_slots s
    WHERE s.tour_id = NEW.id AND s.vehicle_map_type IS NULL AND s.capacity > v_cap
      AND s.slot_date >= current_date AND s.status IN ('activo', 'lleno')
  ) THEN
    RAISE EXCEPTION 'Hay horarios futuros con mas capacidad que los asientos del vehiculo (% en %). Ajusta esos horarios primero.', v_cap, NEW.vehicle_map_type
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.validar_capacidad_de_tour() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.validar_capacidad_de_tour() TO service_role;

DROP TRIGGER IF EXISTS trg_validar_capacidad_de_tour ON public.tours;
CREATE TRIGGER trg_validar_capacidad_de_tour
  BEFORE UPDATE OF vehicle_map_type, default_slot_capacity ON public.tours
  FOR EACH ROW EXECUTE FUNCTION public.validar_capacidad_de_tour();

-- 5. Un asiento tiene que existir en el mapa efectivo del horario. `hold_seats` y `reserve_seats` solo cuentan lugares: sin esto un cliente
-- podia apartar el asiento 59 de una Sprinter de 20. Si el tour no tiene mapa, o el mapa no esta activo, no se valida nada.
CREATE OR REPLACE FUNCTION public.validar_asiento_en_mapa()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_map text;
BEGIN
  IF NEW.seat_number IS NULL THEN
    RETURN NEW;
  END IF;
  v_map := public.effective_vehicle_map_type(NEW.tour_id, NEW.slot_id);
  IF v_map IS NULL OR NOT EXISTS (SELECT 1 FROM public.vehicle_seat_layouts l WHERE l.type = v_map AND l.is_active) THEN
    RETURN NEW;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.vehicle_seat_layouts l, jsonb_array_elements(l.seats) e
    WHERE l.type = v_map AND l.is_active AND (e->>'number')::integer = NEW.seat_number
  ) THEN
    RAISE EXCEPTION 'El asiento % no existe en el mapa de este horario (%)', NEW.seat_number, v_map
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.validar_asiento_en_mapa() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.validar_asiento_en_mapa() TO service_role;

DROP TRIGGER IF EXISTS trg_validar_asiento_en_mapa ON public.seat_holds;
CREATE TRIGGER trg_validar_asiento_en_mapa
  BEFORE INSERT ON public.seat_holds
  FOR EACH ROW EXECUTE FUNCTION public.validar_asiento_en_mapa();

DROP TRIGGER IF EXISTS trg_validar_asiento_en_mapa ON public.slot_seat_status;
CREATE TRIGGER trg_validar_asiento_en_mapa
  BEFORE INSERT ON public.slot_seat_status
  FOR EACH ROW EXECUTE FUNCTION public.validar_asiento_en_mapa();

-- 6. Las dos funciones que ya validaban el asiento contra el mapa lo leian del TOUR. Ahora del horario de la reserva.
CREATE OR REPLACE FUNCTION public.change_booking_seats(p_booking_id uuid, p_new_seats integer[])
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  b public.bookings%rowtype;
  v_map text;
  v_old integer[];
  v_seat integer;
  v_departure timestamp;
  v_conflicts integer[]:='{}';
  v_dups integer;
begin
  if auth.uid() is null then raise exception 'No autorizado' using errcode='42501'; end if;

  select * into b from public.bookings where id=p_booking_id;
  if not found or b.user_id<>auth.uid() then raise exception 'No autorizado' using errcode='42501'; end if;

  -- Serializa contra reservas y otros cambios de asiento del mismo tour, y relee la reserva ya con candado.
  perform toursred_ops.lock_inventory(b.tour_id);
  select * into b from public.bookings where id=p_booking_id for update;

  if b.status not in ('confirmed','pending') then
    return jsonb_build_object('success',false,'error','Esta reserva ya no permite cambiar de asiento');
  end if;
  if b.status='pending' and b.approval_status::text<>'approved' then
    return jsonb_build_object('success',false,'error','Tu reserva aun no esta aprobada');
  end if;

  -- El mapa es el del HORARIO de la reserva, y si no tiene propio, el del tour.
  v_map := public.effective_vehicle_map_type(b.tour_id, b.slot_id);
  if v_map is null then
    return jsonb_build_object('success',false,'error','Este tour no tiene mapa de asientos');
  end if;

  v_old:=coalesce(b.selected_seats,'{}');
  if array_length(v_old,1) is null then
    return jsonb_build_object('success',false,'error','Esta reserva no tiene asientos asignados');
  end if;

  -- La salida no debe haber pasado (hora de Mexico, como el resto de las reglas de salida).
  if b.slot_id is not null then
    select (ts.slot_date + ts.departure_time) into v_departure from public.tour_slots ts where ts.id=b.slot_id;
  else
    v_departure:=(b.selected_date + coalesce(b.selected_time,time '00:00'));
  end if;
  if v_departure is not null and v_departure<=(now() at time zone 'America/Mexico_City') then
    return jsonb_build_object('success',false,'error','La salida ya paso, no se pueden cambiar los asientos');
  end if;

  -- Mismo numero de asientos, sin repetir.
  if p_new_seats is null or coalesce(array_length(p_new_seats,1),0)<>array_length(v_old,1) then
    return jsonb_build_object('success',false,'error',format('Debes elegir exactamente %s asiento(s)',array_length(v_old,1)));
  end if;
  select count(*)-count(distinct s) into v_dups from unnest(p_new_seats) s;
  if v_dups>0 then
    return jsonb_build_object('success',false,'error','Hay asientos repetidos en la seleccion');
  end if;

  -- Cada asiento tiene que existir en el mapa del horario y no ser conductor ni bano.
  foreach v_seat in array p_new_seats loop
    if not exists(select 1 from public.vehicle_seat_layouts l, jsonb_array_elements(l.seats) e
      where l.type=v_map and (e->>'number')::integer=v_seat and coalesce(e->>'type','normal') not in ('driver','wc')) then
      return jsonb_build_object('success',false,'error',format('El asiento %s no existe en el mapa de este horario',v_seat));
    end if;
  end loop;

  -- Disponibilidad: solo cuentan los asientos NUEVOS (los que ya eran mios no chocan conmigo).
  foreach v_seat in array p_new_seats loop
    continue when v_seat=any(v_old);
    if exists(select 1 from public.slot_seat_status ss
      where ss.tour_id=b.tour_id and ss.seat_number=v_seat and ss.status<>'disponible'
      and (ss.slot_id is not distinct from b.slot_id or (b.slot_id is not null and ss.slot_id is null and ss.status='bloqueado_agencia')))
      or exists(select 1 from public.seat_holds h
      where h.tour_id=b.tour_id and h.slot_id is not distinct from b.slot_id and h.seat_number=v_seat and h.expires_at>now()) then
      v_conflicts:=array_append(v_conflicts,v_seat);
    end if;
  end loop;
  if array_length(v_conflicts,1) is not null then
    return jsonb_build_object('success',false,'error','Algunos asientos ya no estan disponibles','conflicting_seats',v_conflicts);
  end if;

  -- Escritura: suelta los viejos que ya no uso y toma los nuevos.
  delete from public.slot_seat_status where booking_id=b.id and seat_number<>all(p_new_seats);
  foreach v_seat in array p_new_seats loop
    continue when v_seat=any(v_old) and exists(select 1 from public.slot_seat_status ss where ss.booking_id=b.id and ss.seat_number=v_seat);
    -- Una fila 'disponible' sobrante se reemplaza (con slot_id NULL el UNIQUE no la detecta).
    delete from public.slot_seat_status ss where ss.tour_id=b.tour_id and ss.slot_id is not distinct from b.slot_id and ss.seat_number=v_seat and ss.status='disponible';
    begin
      insert into public.slot_seat_status(tour_id,slot_id,agency_id,seat_number,status,booking_id)
      values(b.tour_id,b.slot_id,b.agency_id,v_seat,'reservado_online',b.id);
    exception when unique_violation then
      raise exception 'El asiento % ya no esta disponible',v_seat using errcode='unique_violation';
    end;
  end loop;

  update public.bookings set selected_seats=p_new_seats, needs_seat_reselection=false, updated_at=now() where id=b.id;

  return jsonb_build_object('success',true,'previous_seats',to_jsonb(v_old),'selected_seats',to_jsonb(p_new_seats));
end; $function$;

CREATE OR REPLACE FUNCTION public.assign_external_seats(p_sale_id uuid, p_assignments jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare s public.external_sales%rowtype; v_map text; a jsonb; tid uuid; seat integer;
 tids uuid[]:='{}'; seats integer[]:='{}';
BEGIN
  PERFORM messaging_private.enforce_phone_operation('agency');

 select * into s from public.external_sales where id=p_sale_id;
 if not found or not public.external_sale_access(s.agency_id,'manage') then raise exception 'No autorizado' using errcode='42501'; end if;
 perform toursred_ops.lock_inventory(s.tour_id);
 select * into s from public.external_sales where id=p_sale_id for update;
 if s.status<>'active' then raise exception 'La venta esta cancelada'; end if;
 if s.departure_date<(now() at time zone 'America/Mexico_City')::date then raise exception 'La salida ya paso'; end if;
 -- El mapa es el del HORARIO de la venta, y si no tiene propio, el del tour.
 v_map := public.effective_vehicle_map_type(s.tour_id, s.slot_id);
 if v_map is null then raise exception 'El tour no tiene mapa de asientos'; end if;
 if jsonb_typeof(p_assignments) is distinct from 'array' then raise exception 'Asignaciones invalidas'; end if;

 for a in select value from jsonb_array_elements(p_assignments) loop
 tid:=(a->>'traveler_id')::uuid; seat:=nullif(a->>'seat_number','')::integer;
 if tid=any(tids) then raise exception 'Viajero repetido'; end if;
 tids:=array_append(tids,tid);
 if not exists(select 1 from public.external_sale_travelers x where x.id=tid and x.external_sale_id=s.id and not x.is_cancelled) then
 raise exception 'Viajero invalido'; end if;
 if seat is not null then
 if seat=any(seats) then raise exception 'Asiento repetido'; end if;
 seats:=array_append(seats,seat);
 if not exists(select 1 from public.vehicle_seat_layouts l, jsonb_array_elements(l.seats) e
 where l.type=v_map and (e->>'number')::integer=seat and coalesce(e->>'type','normal') not in ('driver','wc')) then
 raise exception 'El asiento % no existe en el mapa de este horario',seat; end if;
 end if;
 end loop;

 delete from public.slot_seat_status where external_sale_traveler_id=any(tids);
 for a in select value from jsonb_array_elements(p_assignments) loop
 seat:=nullif(a->>'seat_number','')::integer;
 continue when seat is null;
 if exists(select 1 from public.slot_seat_status ss where ss.tour_id=s.tour_id and ss.seat_number=seat and ss.status<>'disponible'
 and (ss.slot_id is not distinct from s.slot_id or (s.slot_id is not null and ss.slot_id is null and ss.status='bloqueado_agencia'))) then
 raise exception 'El asiento % ya no esta disponible',seat; end if;
 if exists(select 1 from public.seat_holds h where h.tour_id=s.tour_id and h.slot_id is not distinct from s.slot_id and h.seat_number=seat and h.expires_at>now()) then
 raise exception 'El asiento % esta apartado temporalmente por un viajero',seat; end if;
 delete from public.slot_seat_status ss where ss.tour_id=s.tour_id and ss.slot_id is not distinct from s.slot_id and ss.seat_number=seat and ss.status='disponible';
 begin
 insert into public.slot_seat_status(tour_id,slot_id,agency_id,seat_number,status,external_sale_traveler_id)
 values(s.tour_id,s.slot_id,s.agency_id,seat,'reservado_online',(a->>'traveler_id')::uuid);
 exception when unique_violation then
 raise exception 'El asiento % ya no esta disponible',seat;
 end;
 end loop;
 insert into public.external_sale_events(external_sale_id,actor_id,event_type,changed_fields) values(s.id,auth.uid(),'seats_assigned',array['seats']);
end; $function$;
