-- Cambio de asiento por el viajero, despues de reservar.
--
-- Hasta hoy un viajero solo podia elegir asientos al reservar o cuando la agencia
-- reprogramaba el horario (SeatReselectionModal -> reserve_seats). Esta funcion
-- deja que el DUEÑO de la reserva cambie sus asientos por otros libres de la misma
-- salida, sin tocar dinero, cupo ni pagos: el numero de asientos no cambia.
--
-- Por que no reusar reserve_seats: no libera los asientos viejos, no valida que el
-- asiento exista en el mapa, ni mira seat_holds, ni la fecha de salida.
--
-- Mismas reglas que assign_external_seats:
--   * lock_inventory(tour): misma frontera de serializacion que las reservas.
--   * Todo o nada: se valida todo antes de escribir; un error revierte la llamada.
--   * Con slot_id NULL el UNIQUE (tour_id, slot_id, seat_number) no detecta
--     duplicados, asi que la disponibilidad se comprueba a mano.
-- Un bloqueo global de la agencia (slot_id NULL) tambien cuenta para una salida con slot.
begin;

create function public.change_booking_seats(p_booking_id uuid, p_new_seats integer[])
returns jsonb language plpgsql security definer set search_path=public as $$
declare
 b public.bookings%rowtype;
 t public.tours%rowtype;
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

 select * into t from public.tours where id=b.tour_id;
 if t.vehicle_map_type is null then
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

 -- Cada asiento tiene que existir en el mapa del tour y no ser conductor ni bano.
 foreach v_seat in array p_new_seats loop
 if not exists(select 1 from public.vehicle_seat_layouts l, jsonb_array_elements(l.seats) e
 where l.type=t.vehicle_map_type and (e->>'number')::integer=v_seat and coalesce(e->>'type','normal') not in ('driver','wc')) then
 return jsonb_build_object('success',false,'error',format('El asiento %s no existe en el mapa de este tour',v_seat));
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
end; $$;

revoke all on function public.change_booking_seats(uuid,integer[]) from public,anon;
grant execute on function public.change_booking_seats(uuid,integer[]) to authenticated;
commit;
