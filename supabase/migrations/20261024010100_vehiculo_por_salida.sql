-- Vehiculo (mapa de asientos) por salida, en tours receptivos.
--
-- Hasta hoy el mapa vivia solo en tours.vehicle_map_type y valia para TODAS las salidas.
-- Ahora una salida puede traer su propio mapa (tour_slots.vehicle_map_type): si es NULL
-- hereda el del tour, igual que antes. El precio NO cambia (decision de Axel, 24-oct-2026):
-- si la agencia necesita otro precio u otra operacion, publica otro tour.
--
-- La capacidad la decide la agencia: puede ser menor a la del vehiculo (un bus de 60 donde
-- el lugar solo admite 40). El cupo se sigue controlando por conteo (tour_slots.capacity).
--
-- Al CAMBIAR el vehiculo efectivo de una salida:
--   * Los numeros de asiento ya no significan lo mismo, asi que se sueltan TODOS los de esa
--     salida (reservas, bloqueos de la agencia y asientos de ventas externas).
--   * Las reservas con asientos quedan con needs_seat_reselection = true (mismo mecanismo que
--     el reagendado de horario), previous_selected_seats con lo que tenian y la razon
--     'vehicle_change' para que el viajero vea el motivo correcto.
--   * Cada viajero afectado recibe una notificacion en la app (el correo lo manda la Edge
--     Function notify-slot-vehicle-change).
--   * Se niega si hay viajeros pagando ahora mismo (seat_holds vigentes) en esa salida.
--
-- LIMITE CONOCIDO: un bloqueo "global" de la agencia (slot_id NULL, hecho antes de que
-- existieran salidas) sigue aplicando por NUMERO de asiento a todas las salidas, tambien a las
-- que tengan otro vehiculo. Lo leen create_booking_atomic, get_departure_seats y otras; aqui no
-- se tocaron. El resultado de la funcion trae global_blocks para que la pantalla lo avise.
begin;

alter table public.tour_slots
  add column if not exists vehicle_map_type text references public.vehicle_seat_layouts(type);
comment on column public.tour_slots.vehicle_map_type is
  'Mapa de asientos propio de esta salida. NULL = el del tour (tours.vehicle_map_type).';

alter table public.bookings
  add column if not exists seat_reselection_reason text;
comment on column public.bookings.seat_reselection_reason is
  'Por que needs_seat_reselection: vehicle_change (la agencia cambio el vehiculo) o NULL (reagendado de horario).';

-- La misma regla para SQL y front: el mapa de una salida es el suyo o, si no tiene, el del tour.
create function public.effective_vehicle_map_type(p_tour_id uuid, p_slot_id uuid default null)
returns text language sql stable security definer set search_path=public as $$
 select coalesce(
   (select s.vehicle_map_type from public.tour_slots s where s.id=p_slot_id and s.tour_id=p_tour_id),
   (select t.vehicle_map_type from public.tours t where t.id=p_tour_id));
$$;
revoke all on function public.effective_vehicle_map_type(uuid,uuid) from public, anon;
grant execute on function public.effective_vehicle_map_type(uuid,uuid) to authenticated, service_role;

-- Nucleo sin chequeo de persona: lo llaman change_slots_vehicle (con la agencia ya validada) y
-- process-slot-reschedule-request (service role). Nadie mas debe poder ejecutarlo.
-- p_vehicle_map_type NULL = volver al mapa del tour. p_capacity NULL = la del vehiculo.
create function public.slot_vehicle_change_core(p_tour_id uuid, p_slot_ids uuid[], p_vehicle_map_type text, p_capacity integer)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
 t public.tours%rowtype;
 l public.vehicle_seat_layouts%rowtype;
 s public.tour_slots%rowtype;
 v_ids uuid[];
 v_new text;
 v_old text;
 v_cap integer;
 v_used integer;
 v_changed boolean;
 v_slots_changed integer:=0;
 v_bookings integer:=0;
 v_blocks integer:=0;
 v_external integer:=0;
 v_global integer;
 v_n integer;
 b record;
begin
 select * into t from public.tours where id=p_tour_id;
 if not found then raise exception 'Tour no encontrado'; end if;
 if t.vehicle_map_type is null then raise exception 'El tour no tiene mapa de asientos'; end if;

 select coalesce(array_agg(distinct x),'{}') into v_ids from unnest(coalesce(p_slot_ids,'{}')) x;
 if coalesce(array_length(v_ids,1),0)=0 then raise exception 'Elige al menos una salida'; end if;

 v_new:=coalesce(p_vehicle_map_type,t.vehicle_map_type);
 select * into l from public.vehicle_seat_layouts where type=v_new and is_active;
 if not found then raise exception 'El mapa de vehiculo % no existe o esta inactivo',v_new; end if;

 v_cap:=coalesce(p_capacity,l.capacity);
 if v_cap<1 or v_cap>l.capacity then
  raise exception 'La capacidad debe estar entre 1 y % (lugares del vehiculo)',l.capacity;
 end if;

 -- Misma frontera de serializacion que las reservas y los cambios de asiento.
 perform toursred_ops.lock_inventory(p_tour_id);

 select count(*) into v_n from public.tour_slots where id=any(v_ids) and tour_id=p_tour_id;
 if v_n<>array_length(v_ids,1) then raise exception 'Alguna salida no pertenece a este tour'; end if;

 -- Fase 1: validar todas. Todo o nada.
 for s in select * from public.tour_slots where id=any(v_ids) order by slot_date, departure_time for update loop
  if s.status::text='cancelado' then raise exception 'La salida del % esta cancelada',s.slot_date; end if;
  if (s.slot_date+s.departure_time)<=(now() at time zone 'America/Mexico_City') then
   raise exception 'La salida del % ya paso',s.slot_date;
  end if;
  v_old:=coalesce(s.vehicle_map_type,t.vehicle_map_type);
  if v_old is distinct from v_new and exists(select 1 from public.seat_holds h
     where h.tour_id=p_tour_id and h.slot_id=s.id and h.expires_at>now()) then
   raise exception 'La salida del % tiene viajeros pagando en este momento; intenta de nuevo en unos minutos',s.slot_date;
  end if;
  select i.marketplace+i.external into v_used from toursred_ops.inventory(p_tour_id,s.id) i;
  if v_cap<coalesce(v_used,0) then
   raise exception 'La salida del % ya tiene % lugares vendidos; la capacidad no puede ser menor',s.slot_date,v_used;
  end if;
 end loop;

 -- Fase 2: aplicar.
 for s in select * from public.tour_slots where id=any(v_ids) order by slot_date, departure_time loop
  v_old:=coalesce(s.vehicle_map_type,t.vehicle_map_type);
  v_changed:=v_old is distinct from v_new;

  update public.tour_slots
     set vehicle_map_type=case when v_new=t.vehicle_map_type then null else v_new end,
         capacity=v_cap, updated_at=now()
   where id=s.id;
  v_slots_changed:=v_slots_changed+1;

  if v_changed then
   select count(*) into v_n from public.slot_seat_status where tour_id=p_tour_id and slot_id=s.id and status='bloqueado_agencia';
   v_blocks:=v_blocks+v_n;
   select count(*) into v_n from public.slot_seat_status where tour_id=p_tour_id and slot_id=s.id and external_sale_traveler_id is not null;
   v_external:=v_external+v_n;

   -- Los numeros viejos no existen o significan otro asiento: se sueltan todos.
   delete from public.slot_seat_status where tour_id=p_tour_id and slot_id=s.id;

   for b in
    select bk.id, bk.user_id from public.bookings bk
     where bk.slot_id=s.id and bk.status in ('confirmed','pending')
       and (cardinality(coalesce(bk.selected_seats,'{}'))>0 or bk.needs_seat_reselection)
   loop
    update public.bookings set
       previous_selected_seats=case when cardinality(coalesce(selected_seats,'{}'))>0 then selected_seats else previous_selected_seats end,
       selected_seats=null,
       needs_seat_reselection=true,
       seat_reselection_reason='vehicle_change',
       updated_at=now()
     where id=b.id;
    v_bookings:=v_bookings+1;

    perform public.create_user_notification(
      b.user_id,
      'slot_vehicle_changed'::public.notification_type,
      'Cambio de transporte en tu salida',
      format('Por temas de logistica, la agencia cambio el transporte de tu salida del %s. Elige de nuevo tus asientos en el nuevo vehiculo.',
             to_char(s.slot_date,'DD/MM/YYYY')),
      jsonb_build_object('booking_id',b.id,'slot_id',s.id,'tour_id',p_tour_id,'new_vehicle_map_type',v_new,'needs_seat_reselection',true));
   end loop;
  end if;
 end loop;

 select count(*) into v_global from public.slot_seat_status where tour_id=p_tour_id and slot_id is null and status='bloqueado_agencia';

 return jsonb_build_object('success',true,'slots_updated',v_slots_changed,'bookings_to_reselect',v_bookings,
   'blocks_released',v_blocks,'external_seats_released',v_external,'global_blocks',v_global,
   'vehicle_map_type',v_new,'capacity',v_cap);
end; $$;
revoke all on function public.slot_vehicle_change_core(uuid,uuid[],text,integer) from public, anon, authenticated;
grant execute on function public.slot_vehicle_change_core(uuid,uuid[],text,integer) to service_role;

-- Puerta de la agencia: dueña del tour o personal con permiso de gestionar tours.
create function public.change_slots_vehicle(p_tour_id uuid, p_slot_ids uuid[], p_vehicle_map_type text, p_capacity integer default null)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_agency uuid;
begin
 if auth.uid() is null then raise exception 'No autorizado' using errcode='42501'; end if;
 select agency_id into v_agency from public.tours where id=p_tour_id;
 if v_agency is null or not public.external_sale_access(v_agency,'manage') then
  raise exception 'No autorizado' using errcode='42501';
 end if;
 return public.slot_vehicle_change_core(p_tour_id,p_slot_ids,p_vehicle_map_type,p_capacity);
end; $$;
revoke all on function public.change_slots_vehicle(uuid,uuid[],text,integer) from public, anon;
grant execute on function public.change_slots_vehicle(uuid,uuid[],text,integer) to authenticated;

-- change_booking_seats: el asiento tiene que existir en el mapa EFECTIVO de la salida.
-- Es la misma funcion de 20261023181237 con dos cambios: el mapa sale de la salida y, si la
-- reserva ya hizo su cambio, se limpia la razon de reseleccion.
create or replace function public.change_booking_seats(p_booking_id uuid, p_new_seats integer[])
returns jsonb language plpgsql security definer set search_path=public as $$
declare
 b public.bookings%rowtype;
 t public.tours%rowtype;
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

 perform toursred_ops.lock_inventory(b.tour_id);
 select * into b from public.bookings where id=p_booking_id for update;

 if b.status not in ('confirmed','pending') then
 return jsonb_build_object('success',false,'error','Esta reserva ya no permite cambiar de asiento');
 end if;
 if b.status='pending' and b.approval_status::text<>'approved' then
 return jsonb_build_object('success',false,'error','Tu reserva aun no esta aprobada');
 end if;

 select * into t from public.tours where id=b.tour_id;
 v_map:=public.effective_vehicle_map_type(b.tour_id,b.slot_id);
 if v_map is null then
 return jsonb_build_object('success',false,'error','Este tour no tiene mapa de asientos');
 end if;

 v_old:=coalesce(b.selected_seats,'{}');
 if array_length(v_old,1) is null then
 return jsonb_build_object('success',false,'error','Esta reserva no tiene asientos asignados');
 end if;

 if b.slot_id is not null then
 select (ts.slot_date + ts.departure_time) into v_departure from public.tour_slots ts where ts.id=b.slot_id;
 else
 v_departure:=(b.selected_date + coalesce(b.selected_time,time '00:00'));
 end if;
 if v_departure is not null and v_departure<=(now() at time zone 'America/Mexico_City') then
 return jsonb_build_object('success',false,'error','La salida ya paso, no se pueden cambiar los asientos');
 end if;

 if p_new_seats is null or coalesce(array_length(p_new_seats,1),0)<>array_length(v_old,1) then
 return jsonb_build_object('success',false,'error',format('Debes elegir exactamente %s asiento(s)',array_length(v_old,1)));
 end if;
 select count(*)-count(distinct s) into v_dups from unnest(p_new_seats) s;
 if v_dups>0 then
 return jsonb_build_object('success',false,'error','Hay asientos repetidos en la seleccion');
 end if;

 foreach v_seat in array p_new_seats loop
 if not exists(select 1 from public.vehicle_seat_layouts l, jsonb_array_elements(l.seats) e
 where l.type=v_map and (e->>'number')::integer=v_seat and coalesce(e->>'type','normal') not in ('driver','wc')) then
 return jsonb_build_object('success',false,'error',format('El asiento %s no existe en el mapa de este tour',v_seat));
 end if;
 end loop;

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

 delete from public.slot_seat_status where booking_id=b.id and seat_number<>all(p_new_seats);
 foreach v_seat in array p_new_seats loop
 continue when v_seat=any(v_old) and exists(select 1 from public.slot_seat_status ss where ss.booking_id=b.id and ss.seat_number=v_seat);
 delete from public.slot_seat_status ss where ss.tour_id=b.tour_id and ss.slot_id is not distinct from b.slot_id and ss.seat_number=v_seat and ss.status='disponible';
 begin
 insert into public.slot_seat_status(tour_id,slot_id,agency_id,seat_number,status,booking_id)
 values(b.tour_id,b.slot_id,b.agency_id,v_seat,'reservado_online',b.id);
 exception when unique_violation then
 raise exception 'El asiento % ya no esta disponible',v_seat using errcode='unique_violation';
 end;
 end loop;

 update public.bookings set selected_seats=p_new_seats, needs_seat_reselection=false, seat_reselection_reason=null, updated_at=now() where id=b.id;

 return jsonb_build_object('success',true,'previous_seats',to_jsonb(v_old),'selected_seats',to_jsonb(p_new_seats));
end; $$;

-- Reseleccion de asientos tras un cambio de vehiculo. El viajero no tiene asientos (se soltaron),
-- asi que change_booking_seats no aplica. A diferencia de reserve_seats (que confia en el cliente
-- y no valida el mapa), esta valida: dueño, reserva marcada, cantidad, existencia en el mapa
-- efectivo, disponibilidad, bloqueos y apartados. Todo o nada.
create function public.reselect_booking_seats(p_booking_id uuid, p_seats integer[])
returns jsonb language plpgsql security definer set search_path=public as $$
declare
 b public.bookings%rowtype;
 v_map text;
 v_seat integer;
 v_departure timestamp;
 v_conflicts integer[]:='{}';
 v_dups integer;
 v_need integer;
begin
 if auth.uid() is null then raise exception 'No autorizado' using errcode='42501'; end if;
 select * into b from public.bookings where id=p_booking_id;
 if not found or b.user_id<>auth.uid() then raise exception 'No autorizado' using errcode='42501'; end if;

 perform toursred_ops.lock_inventory(b.tour_id);
 select * into b from public.bookings where id=p_booking_id for update;

 if b.status not in ('confirmed','pending') or not coalesce(b.needs_seat_reselection,false) then
  return jsonb_build_object('success',false,'error','Esta reserva no necesita elegir asientos');
 end if;

 v_map:=public.effective_vehicle_map_type(b.tour_id,b.slot_id);
 if v_map is null then return jsonb_build_object('success',false,'error','Este tour no tiene mapa de asientos'); end if;

 if b.slot_id is not null then
  select (ts.slot_date+ts.departure_time) into v_departure from public.tour_slots ts where ts.id=b.slot_id;
 else
  v_departure:=(b.selected_date+coalesce(b.selected_time,time '00:00'));
 end if;
 if v_departure is not null and v_departure<=(now() at time zone 'America/Mexico_City') then
  return jsonb_build_object('success',false,'error','La salida ya paso, no se pueden elegir asientos');
 end if;

 v_need:=coalesce(b.travelers_count,1);
 if p_seats is null or coalesce(array_length(p_seats,1),0)<>v_need then
  return jsonb_build_object('success',false,'error',format('Debes elegir exactamente %s asiento(s)',v_need));
 end if;
 select count(*)-count(distinct x) into v_dups from unnest(p_seats) x;
 if v_dups>0 then return jsonb_build_object('success',false,'error','Hay asientos repetidos en la seleccion'); end if;

 foreach v_seat in array p_seats loop
  if not exists(select 1 from public.vehicle_seat_layouts l, jsonb_array_elements(l.seats) e
     where l.type=v_map and (e->>'number')::integer=v_seat and coalesce(e->>'type','normal') not in ('driver','wc')) then
   return jsonb_build_object('success',false,'error',format('El asiento %s no existe en el mapa de este tour',v_seat));
  end if;
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

 delete from public.slot_seat_status where booking_id=b.id;
 foreach v_seat in array p_seats loop
  delete from public.slot_seat_status ss where ss.tour_id=b.tour_id and ss.slot_id is not distinct from b.slot_id and ss.seat_number=v_seat and ss.status='disponible';
  begin
   insert into public.slot_seat_status(tour_id,slot_id,agency_id,seat_number,status,booking_id)
   values(b.tour_id,b.slot_id,b.agency_id,v_seat,'reservado_online',b.id);
  exception when unique_violation then
   raise exception 'El asiento % ya no esta disponible',v_seat using errcode='unique_violation';
  end;
 end loop;

 update public.bookings set selected_seats=p_seats, needs_seat_reselection=false, seat_reselection_reason=null, updated_at=now() where id=b.id;
 return jsonb_build_object('success',true,'selected_seats',to_jsonb(p_seats));
end; $$;
revoke all on function public.reselect_booking_seats(uuid,integer[]) from public, anon;
grant execute on function public.reselect_booking_seats(uuid,integer[]) to authenticated;

commit;
