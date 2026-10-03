-- Asientos para viajeros de ventas externas.
--
-- Un asiento asignado a un viajero externo es una fila de slot_seat_status con
-- status 'reservado_online', booking_id NULL y external_sale_traveler_id lleno.
-- No hace falta tocar nada mas para que el resto del sistema lo respete:
--   * reserve_seats rechaza cualquier asiento cuya fila no sea 'disponible'.
--   * toggle_agency_seat_block no bloquea ni desbloquea un 'reservado_online'.
--   * release_seats y la cancelacion de reservas borran por booking_id, que aqui es NULL.
--   * toursred_ops.inventory NO cuenta los 'reservado_online' aparte: la capacidad
--     de los externos ya se descuenta por external_sales.travelers_count, asi que
--     asignar asiento no duplica ocupacion.
-- Lo unico que hay que anadir es quien escribe esas filas y quien las libera.
begin;

alter table public.slot_seat_status
 add column external_sale_traveler_id uuid references public.external_sale_travelers(id);
-- Un viajero externo, un asiento.
create unique index slot_seat_status_one_seat_per_external_traveler
 on public.slot_seat_status(external_sale_traveler_id) where external_sale_traveler_id is not null;

-- Liberacion automatica: sin esto, cancelar una venta externa dejaria asientos
-- ocupados para siempre. Triggers en vez de parchear save_external_sale y
-- cancel_external_sale, que ya son funciones largas.
create function toursred_ops.release_external_seat_on_traveler()
returns trigger language plpgsql security definer set search_path=public as $$
begin
 if NEW.is_cancelled and not OLD.is_cancelled then
 delete from public.slot_seat_status where external_sale_traveler_id=NEW.id;
 end if;
 return NEW;
end; $$;
create trigger aa_release_external_seat after update of is_cancelled on public.external_sale_travelers
 for each row execute function toursred_ops.release_external_seat_on_traveler();

-- Los asientos son de UNA salida: si la venta se cancela o cambia de salida/tour, se sueltan.
create function toursred_ops.release_external_seats_on_sale()
returns trigger language plpgsql security definer set search_path=public as $$
begin
 if (NEW.status='cancelled' and OLD.status<>'cancelled') or NEW.slot_id is distinct from OLD.slot_id or NEW.tour_id<>OLD.tour_id then
 delete from public.slot_seat_status where external_sale_traveler_id in
 (select t.id from public.external_sale_travelers t where t.external_sale_id=NEW.id);
 end if;
 return NEW;
end; $$;
create trigger aa_release_external_seats after update of status,slot_id,tour_id on public.external_sales
 for each row execute function toursred_ops.release_external_seats_on_sale();

-- p_assignments: [{"traveler_id": "...", "seat_number": 7}, {"traveler_id": "...", "seat_number": null}]
-- seat_number null = quitar el asiento a ese viajero. Todo o nada: si un asiento falla, nada cambia.
create function public.assign_external_seats(p_sale_id uuid, p_assignments jsonb)
returns void language plpgsql security definer set search_path=public as $$
declare s public.external_sales%rowtype; t public.tours%rowtype; a jsonb; tid uuid; seat integer;
 tids uuid[]:='{}'; seats integer[]:='{}';
begin
 select * into s from public.external_sales where id=p_sale_id;
 if not found or not public.external_sale_access(s.agency_id,'manage') then raise exception 'No autorizado' using errcode='42501'; end if;
 -- Misma frontera de serializacion que las reservas de ToursRed.
 perform toursred_ops.lock_inventory(s.tour_id);
 select * into s from public.external_sales where id=p_sale_id for update;
 if s.status<>'active' then raise exception 'La venta esta cancelada'; end if;
 if s.departure_date<(now() at time zone 'America/Mexico_City')::date then raise exception 'La salida ya paso'; end if;
 select * into t from public.tours where id=s.tour_id;
 if t.vehicle_map_type is null then raise exception 'El tour no tiene mapa de asientos'; end if;
 if jsonb_typeof(p_assignments) is distinct from 'array' then raise exception 'Asignaciones invalidas'; end if;

 -- Fase 1: validar. Nada se escribe todavia.
 for a in select value from jsonb_array_elements(p_assignments) loop
 tid:=(a->>'traveler_id')::uuid; seat:=nullif(a->>'seat_number','')::integer;
 if tid=any(tids) then raise exception 'Viajero repetido'; end if;
 tids:=array_append(tids,tid);
 if not exists(select 1 from public.external_sale_travelers x where x.id=tid and x.external_sale_id=s.id and not x.is_cancelled) then
 raise exception 'Viajero invalido'; end if;
 if seat is not null then
 if seat=any(seats) then raise exception 'Asiento repetido'; end if;
 seats:=array_append(seats,seat);
 -- El asiento tiene que existir en el mapa del tour y no ser conductor ni bano.
 if not exists(select 1 from public.vehicle_seat_layouts l, jsonb_array_elements(l.seats) e
 where l.type=t.vehicle_map_type and (e->>'number')::integer=seat and coalesce(e->>'type','normal') not in ('driver','wc')) then
 raise exception 'El asiento % no existe en el mapa de este tour',seat; end if;
 end if;
 end loop;

 -- Fase 2: soltar lo que estos viajeros tenian y asignar. Soltar primero permite
 -- intercambiar asientos entre dos viajeros de la misma venta en una sola llamada.
 delete from public.slot_seat_status where external_sale_traveler_id=any(tids);
 for a in select value from jsonb_array_elements(p_assignments) loop
 seat:=nullif(a->>'seat_number','')::integer;
 continue when seat is null;
 -- Ocupado, bloqueado por la agencia (tambien bloqueos globales) o fila huerfana.
 if exists(select 1 from public.slot_seat_status ss where ss.tour_id=s.tour_id and ss.seat_number=seat and ss.status<>'disponible'
 and (ss.slot_id is not distinct from s.slot_id or (s.slot_id is not null and ss.slot_id is null and ss.status='bloqueado_agencia'))) then
 raise exception 'El asiento % ya no esta disponible',seat; end if;
 -- Un viajero lo esta pagando ahora mismo.
 if exists(select 1 from public.seat_holds h where h.tour_id=s.tour_id and h.slot_id is not distinct from s.slot_id and h.seat_number=seat and h.expires_at>now()) then
 raise exception 'El asiento % esta apartado temporalmente por un viajero',seat; end if;
 -- Una fila 'disponible' sobrante se reemplaza (con slot_id NULL el UNIQUE no la detecta).
 delete from public.slot_seat_status ss where ss.tour_id=s.tour_id and ss.slot_id is not distinct from s.slot_id and ss.seat_number=seat and ss.status='disponible';
 begin
 insert into public.slot_seat_status(tour_id,slot_id,agency_id,seat_number,status,external_sale_traveler_id)
 values(s.tour_id,s.slot_id,s.agency_id,seat,'reservado_online',(a->>'traveler_id')::uuid);
 exception when unique_violation then
 raise exception 'El asiento % ya no esta disponible',seat;
 end;
 end loop;
 insert into public.external_sale_events(external_sale_id,actor_id,event_type,changed_fields) values(s.id,auth.uid(),'seats_assigned',array['seats']);
end; $$;

-- get_departure_seats ahora dice a QUE viajero externo pertenece cada asiento.
-- Cambia el tipo de retorno, por eso drop + create (la funcion es de la migracion anterior).
drop function public.get_departure_seats(uuid,uuid);
create function public.get_departure_seats(p_tour_id uuid, p_slot_id uuid default null)
returns table(seat_number integer, status text, booking_id uuid, block_note text, external_traveler_id uuid)
language plpgsql stable security definer set search_path=public as $$
declare aid uuid;
begin
 select t.agency_id into aid from public.tours t where t.id=p_tour_id;
 if aid is null or not public.external_sale_access(aid,'view') then raise exception 'No autorizado' using errcode='42501'; end if;
 return query
 select x.seat_number::integer, x.status::text, x.booking_id, x.block_note::text, x.external_sale_traveler_id
 from (
 select distinct on (ss.seat_number) ss.seat_number, ss.status, ss.booking_id, ss.block_note, ss.external_sale_traveler_id
 from public.slot_seat_status ss
 where ss.tour_id=p_tour_id and ss.status<>'disponible'
 and (ss.slot_id is not distinct from p_slot_id or (p_slot_id is not null and ss.slot_id is null and ss.status='bloqueado_agencia'))
 order by ss.seat_number, (ss.slot_id is not null) desc
 ) x
 order by x.seat_number;
end;
$$;

revoke all on function toursred_ops.release_external_seat_on_traveler(), toursred_ops.release_external_seats_on_sale() from public,anon,authenticated;
revoke all on function public.assign_external_seats(uuid,jsonb), public.get_departure_seats(uuid,uuid) from public,anon;
grant execute on function public.assign_external_seats(uuid,jsonb), public.get_departure_seats(uuid,uuid) to authenticated;
commit;
