-- Agenda operativa: detalle de una salida.
-- Dos funciones de SOLO LECTURA. No cambian tablas, no tocan inventario.
--
--  * get_departure_reservations: una fila por reserva (ToursRed y externa) con
--    contacto, estado y dinero.
--  * get_departure_seats: estado de cada asiento de la salida (mapa de asientos).
--
-- Permisos: igual que el resto de la agenda. 'view' ve la operacion; el DINERO
-- solo lo ve quien tenga 'finance' (duenio de la agencia o staff con
-- can_view_financials). Sin 'finance' las columnas de dinero salen NULL.
--
-- Definiciones de dinero: las MISMAS que ya usa el panel de la agencia, para no
-- abrir otro lugar donde el desglose se calcule distinto:
--   * saldo pendiente        = total_price - deposit_amount     (AgencyBookings)
--   * pendiente de liberar   = commission_records.status = 'pending' con pago
--                              exitoso, suma de agency_net_amount (AgencyFinancials)
--   * liberado               = commission_records 'processed' | 'paid_out'
-- Reservas con plan de pagos: se calculan con la regla estandar y la fila trae
-- has_payment_plan = true para que la pantalla lo avise.
begin;

create function public.get_departure_reservations(p_tour_id uuid, p_slot_id uuid default null)
returns table(
 origin text, reservation_id uuid, reservation_code text,
 holder_name text, holder_email text, holder_phone text,
 people integer, status text, payment_status text, has_payment_plan boolean,
 channel text, external_reference text, notes text, created_at timestamptz,
 total_amount numeric, collected_amount numeric, pending_amount numeric,
 release_pending_amount numeric, released_amount numeric, currency text
)
language plpgsql stable security definer set search_path=public as $$
declare aid uuid; fin boolean;
begin
 select t.agency_id into aid from public.tours t where t.id=p_tour_id;
 if aid is null or not public.external_sale_access(aid,'view') then raise exception 'No autorizado' using errcode='42501'; end if;
 fin := public.external_sale_access(aid,'finance');
 return query
 select 'ToursRed'::text, b.id, b.booking_code::text,
 trim(coalesce(u.first_name,'')||' '||coalesce(u.last_name,''))::text, u.email::text, u.phone_number::text,
 b.travelers_count::integer, b.status::text, b.payment_status::text, coalesce(b.has_payment_plan,false),
 null::text, null::text, null::text, b.created_at,
 case when fin then b.total_price end::numeric,
 case when fin then (case when b.payment_status='succeeded' then coalesce(b.deposit_amount,0) else 0 end) end::numeric,
 case when fin then b.total_price-(case when b.payment_status='succeeded' then coalesce(b.deposit_amount,0) else 0 end) end::numeric,
 case when fin then (case when b.payment_status='succeeded' then coalesce((select sum(cr.agency_net_amount) from public.commission_records cr where cr.booking_id=b.id and cr.status='pending'),0) else 0 end) end::numeric,
 case when fin then coalesce((select sum(cr.agency_net_amount) from public.commission_records cr where cr.booking_id=b.id and cr.status in ('processed','paid_out')),0) end::numeric,
 'MXN'::text
 from public.bookings b join public.users u on u.id=b.user_id
 where b.tour_id=p_tour_id and b.slot_id is not distinct from p_slot_id and b.status in ('pending','confirmed','completed')
 union all
 select 'Externa'::text, s.id, null::text, s.primary_traveler_name::text, s.primary_traveler_email::text, s.primary_traveler_phone::text,
 s.travelers_count::integer, s.status::text, null::text, false,
 s.source::text, s.external_reference::text, s.notes::text, s.created_at,
 case when fin then f.total_sale_amount end::numeric,
 case when fin then f.amount_paid end::numeric,
 case when fin then f.amount_pending end::numeric,
 null::numeric, null::numeric,
 case when fin then f.currency end::text
 from public.external_sales s left join public.external_sale_financials f on f.external_sale_id=s.id
 where s.tour_id=p_tour_id and s.slot_id is not distinct from p_slot_id and s.status='active'
 order by 1,14;
end;
$$;

-- Mismo criterio que el selector de asientos: lo propio de la salida manda y los
-- bloqueos globales (slot_id nulo) completan el resto.
create function public.get_departure_seats(p_tour_id uuid, p_slot_id uuid default null)
returns table(seat_number integer, status text, booking_id uuid, block_note text)
language plpgsql stable security definer set search_path=public as $$
declare aid uuid;
begin
 select t.agency_id into aid from public.tours t where t.id=p_tour_id;
 if aid is null or not public.external_sale_access(aid,'view') then raise exception 'No autorizado' using errcode='42501'; end if;
 return query
 select x.seat_number::integer, x.status::text, x.booking_id, x.block_note::text
 from (
 select distinct on (ss.seat_number) ss.seat_number, ss.status, ss.booking_id, ss.block_note
 from public.slot_seat_status ss
 where ss.tour_id=p_tour_id and ss.status<>'disponible'
 and (ss.slot_id is not distinct from p_slot_id or (p_slot_id is not null and ss.slot_id is null and ss.status='bloqueado_agencia'))
 order by ss.seat_number, (ss.slot_id is not null) desc
 ) x
 order by x.seat_number;
end;
$$;

revoke all on function public.get_departure_reservations(uuid,uuid), public.get_departure_seats(uuid,uuid) from public,anon;
grant execute on function public.get_departure_reservations(uuid,uuid), public.get_departure_seats(uuid,uuid) to authenticated;
commit;
