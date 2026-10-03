-- Ventas externas: solo operacion. Ninguna fila externa entra en bookings.
-- El esquema privado contiene los mecanismos internos y los hashes de QR.
begin;
create schema if not exists toursred_ops;
revoke all on schema toursred_ops from public, anon, authenticated;

create table public.external_sales (
 id uuid primary key default gen_random_uuid(),
 agency_id uuid not null references public.agencies(id),
 tour_id uuid not null references public.tours(id),
 slot_id uuid references public.tour_slots(id),
 departure_date date not null,
 departure_time time,
 source text not null check (source in ('whatsapp','facebook','instagram','website','office','phone','direct','other')),
 external_reference text check (length(external_reference) <= 200),
 primary_traveler_name text not null check (length(trim(primary_traveler_name)) between 1 and 200),
 primary_traveler_email text check (length(primary_traveler_email) <= 254),
 primary_traveler_phone text check (length(primary_traveler_phone) <= 40),
 travelers_count integer not null check (travelers_count between 1 and 1000),
 notes text check (length(notes) <= 4000),
 status text not null default 'active' check (status in ('active','cancelled')),
 created_by uuid not null references auth.users(id),
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 version integer not null default 1,
 cancelled_at timestamptz,
 cancellation_reason text,
 qr_enabled boolean not null default false,
 qr_sent_at timestamptz,
 operational_email_authorized boolean not null default false,
 check ( (status = 'cancelled') = (cancelled_at is not null) )
);
create index external_sales_agency_date on public.external_sales(agency_id, departure_date, id);
create index external_sales_inventory on public.external_sales(tour_id, slot_id) where status = 'active';
create table public.external_sale_financials (
 external_sale_id uuid primary key references public.external_sales(id),
 total_sale_amount numeric(14,2) not null check (total_sale_amount >= 0 and total_sale_amount < 'Infinity'::numeric),
 amount_paid numeric(14,2) not null check (amount_paid >= 0 and amount_paid <= total_sale_amount),
 amount_pending numeric(14,2) generated always as (total_sale_amount - amount_paid) stored,
 currency text not null default 'MXN' check (currency ~ '^[A-Z]{3}$'),
 payment_method text not null default 'other' check (payment_method in ('cash','bank_transfer','card','other'))
);
create table public.external_sale_travelers (
 id uuid primary key default gen_random_uuid(),
 external_sale_id uuid not null references public.external_sales(id),
 first_name text not null check (length(trim(first_name)) between 1 and 150),
 last_name text not null default '' check (length(last_name) <= 150),
 email text check (length(email) <= 254),
 phone text check (length(phone) <= 40),
 traveler_type text not null default 'adulto' check (traveler_type in ('adulto','nino','infante','adulto_mayor','mascota')),
 is_primary boolean not null default false,
 is_cancelled boolean not null default false,
 checked_in_at timestamptz,
 checked_in_by uuid references auth.users(id),
 created_at timestamptz not null default now()
);
create index external_sale_travelers_sale on public.external_sale_travelers(external_sale_id);
create unique index external_sale_one_primary on public.external_sale_travelers(external_sale_id) where is_primary and not is_cancelled;
create table public.external_sale_events (
 id bigint generated always as identity primary key,
 external_sale_id uuid not null references public.external_sales(id),
 actor_id uuid references auth.users(id),
 event_type text not null,
 changed_fields text[] not null default '{}',
 created_at timestamptz not null default now()
);
create index external_sale_events_sale on public.external_sale_events(external_sale_id,created_at);
create table toursred_ops.external_qr_tokens (
 external_sale_id uuid primary key references public.external_sales(id),
 token_hash bytea not null unique,
 expires_at timestamptz not null,
 created_at timestamptz not null default now()
);
alter table toursred_ops.external_qr_tokens enable row level security;

-- Owners retain access. Staff must have the corresponding explicit permission.
-- Administrative roles are intentionally not granted private external-sale access.
create function public.external_sale_access(p_agency_id uuid, p_action text default 'view')
returns boolean language sql stable security definer set search_path = public
as $$
 select auth.uid() is not null and exists (
   select 1 from public.users u where u.id=auth.uid() and u.is_active
 ) and (
 exists (select 1 from public.agencies a where a.id=p_agency_id and a.user_id=auth.uid())
 or exists (
 select 1 from public.agency_staff s join public.agency_staff_permissions p on p.staff_id=s.id
 where s.agency_id=p_agency_id and s.user_id=auth.uid() and s.is_active and
 case p_action when 'view' then p.can_view_bookings or p.can_view_reports or p.can_scan_checkin
 when 'manage' then p.can_manage_tours and p.can_view_financials
 when 'finance' then p.can_view_financials
 when 'checkin' then p.can_scan_checkin
 else false end
 ));
$$;
revoke all on function public.external_sale_access(uuid,text) from public, anon;
grant execute on function public.external_sale_access(uuid,text) to authenticated;
alter table public.external_sales enable row level security;
alter table public.external_sale_financials enable row level security;
alter table public.external_sale_travelers enable row level security;
alter table public.external_sale_events enable row level security;
revoke all on public.external_sales, public.external_sale_financials, public.external_sale_travelers, public.external_sale_events from anon, authenticated;
grant select on public.external_sales, public.external_sale_financials, public.external_sale_travelers, public.external_sale_events to authenticated;
create policy external_sales_agency_read on public.external_sales for select to authenticated
 using (public.external_sale_access(agency_id,'view') or public.external_sale_access(agency_id,'manage'));
create policy external_financials_agency_read on public.external_sale_financials for select to authenticated
 using (exists(select 1 from public.external_sales s where s.id=external_sale_id and public.external_sale_access(s.agency_id,'finance')));
create policy external_travelers_agency_read on public.external_sale_travelers for select to authenticated
 using (exists(select 1 from public.external_sales s where s.id=external_sale_id));
create policy external_events_agency_read on public.external_sale_events for select to authenticated
 using (exists(select 1 from public.external_sales s where s.id=external_sale_id));
-- Writes only through authorized transactional RPCs. No delete API.

create function toursred_ops.inventory(p_tour uuid, p_slot uuid default null, p_exclude_booking uuid default null, p_exclude_sale uuid default null, p_session text default null)
returns table(capacity integer, marketplace integer, external integer, blocked integer, held integer, available integer)
language sql volatile security definer set search_path=public
as $$
 with c as (
 select case when p_slot is null then coalesce(nullif(t.available_spots,0),t.max_travelers,10) else s.capacity end::integer capacity
 from public.tours t left join public.tour_slots s on s.id=p_slot and s.tour_id=t.id
 where t.id=p_tour and (p_slot is null or s.id is not null)
 ), b as (
 select coalesce(sum(b.travelers_count),0)::integer n from public.bookings b
 where b.tour_id=p_tour and b.slot_id is not distinct from p_slot and b.id is distinct from p_exclude_booking
 and case when p_slot is not null then b.status in ('pending','confirmed','completed')
 else b.status='confirmed' or (b.status='pending' and b.approval_status='approved') end
 ), e as (
 select coalesce(sum(s.travelers_count),0)::integer n from public.external_sales s
 where s.tour_id=p_tour and s.slot_id is not distinct from p_slot and s.status='active' and s.id is distinct from p_exclude_sale
 ), blocked as (
 select count(*)::integer n from public.slot_seat_status s where s.tour_id=p_tour and s.slot_id is not distinct from p_slot and s.status='bloqueado_agencia'
 ), h as (
 select coalesce(sum(case when h.seat_number is null then h.held_count else 1 end),0)::integer n
 from public.seat_holds h where h.tour_id=p_tour and h.slot_id is not distinct from p_slot
 and h.expires_at>now() and (p_session is null or h.session_id is distinct from p_session)
 )
 select c.capacity,b.n,e.n,blocked.n,h.n,c.capacity-b.n-e.n-blocked.n-h.n from c,b,e,blocked,h;
$$;

-- Common serialization boundary for BOTH sales origins, including legacy no-slot tours.
-- Row UPDATE also makes repeatable-read conflicts fail safely rather than use stale data.
create table toursred_ops.inventory_locks (tour_id uuid primary key references public.tours(id) on delete cascade, revision bigint not null default 0);
alter table toursred_ops.inventory_locks enable row level security;
create function toursred_ops.lock_inventory(p_tour uuid)
returns void language plpgsql security definer set search_path=public as $$
begin
 insert into toursred_ops.inventory_locks(tour_id,revision) values(p_tour,1)
 on conflict(tour_id) do update set revision=toursred_ops.inventory_locks.revision+1;
end;
$$;

create function toursred_ops.guard_booking_inventory()
returns trigger language plpgsql security definer set search_path=public as $$
declare v record; consumes boolean;
begin
 if TG_OP='UPDATE' then
   perform toursred_ops.lock_inventory(x) from (select distinct unnest(array[OLD.tour_id,NEW.tour_id]) x order by x) ids;
 else perform toursred_ops.lock_inventory(NEW.tour_id); end if;
 if NEW.slot_id is not null and not exists(select 1 from public.tour_slots where id=NEW.slot_id and tour_id=NEW.tour_id) then
   raise exception 'Salida ajena al tour';
 end if;
 consumes := case when NEW.slot_id is not null then NEW.status in ('pending','confirmed','completed')
 else NEW.status='confirmed' or (NEW.status='pending' and NEW.approval_status='approved') end;
 if consumes then
   select * into v from toursred_ops.inventory(NEW.tour_id,NEW.slot_id,NEW.id);
   -- Booking conversion may still own seat holds. Permanent occupancy never exceeds capacity.
   if NEW.travelers_count > v.available+v.held then raise exception 'No hay suficientes lugares disponibles'; end if;
 end if;
 return NEW;
end;
$$;
create trigger aa_unified_booking_inventory before insert or update of tour_id,slot_id,status,approval_status,travelers_count
 on public.bookings for each row execute function toursred_ops.guard_booking_inventory();

-- Patch only the inventory section: preserve every existing price/tax/payment rule.
do $patch$
declare d text; a integer; z integer;
begin
 select pg_get_functiondef('public.create_booking_atomic(jsonb,jsonb,jsonb,text,integer[])'::regprocedure) into d;
 d:=replace(d,chr(13),'');
 a:=strpos(d,E'IF v_slot_id IS NOT NULL THEN\nSELECT ts.capacity, ts.booked_count');
 z:=strpos(d,'IF v_travelers_count > v_available THEN');
 if a=0 or z<=a then raise exception 'create_booking_atomic changed: review inventory patch'; end if;
 d:=substr(d,1,a-1)||$body$
-- ---- CAPACITY VALIDATION ----
PERFORM toursred_ops.lock_inventory(v_tour_id);
IF v_slot_id IS NOT NULL THEN
 SELECT ts.capacity, ts.booked_count INTO v_slot FROM public.tour_slots ts
 WHERE ts.id=v_slot_id AND ts.tour_id=v_tour_id FOR UPDATE;
 IF NOT FOUND THEN RETURN jsonb_build_object('success',false,'error','Salida ajena al tour'); END IF;
END IF;
SELECT i.available INTO v_available FROM toursred_ops.inventory(v_tour_id,v_slot_id,NULL,NULL,p_session_id) i;
$body$||substr(d,z);
 execute d;
end;
$patch$;

-- Holds share the same lock and cannot reserve capacity already consumed externally.
do $patch$
declare d text; a integer;
begin
 select pg_get_functiondef('public.hold_seats(uuid,uuid,text,integer[],integer,uuid,integer)'::regprocedure) into d;
 a:=strpos(d,'BEGIN');
 if a=0 then raise exception 'hold_seats changed'; end if;
 d:=substr(d,1,a+4)||$body$
PERFORM toursred_ops.lock_inventory(p_tour_id);
IF COALESCE(array_length(p_seat_numbers,1),p_held_count,0) >
 COALESCE((SELECT i.available FROM toursred_ops.inventory(p_tour_id,p_slot_id,NULL,NULL,p_session_id) i),0)
THEN RAISE EXCEPTION 'No hay suficientes lugares disponibles'; END IF;
$body$||substr(d,a+5);
 execute d;
end;
$patch$;

create or replace function public.get_tour_availability(p_tour_id uuid)
returns table(available_spots integer,max_capacity integer,total_booked integer)
language sql volatile security definer set search_path=public as $$
 select greatest(0,i.available),i.capacity,i.marketplace from toursred_ops.inventory(p_tour_id) i;
$$;
create or replace function public.get_tour_availability_v2(p_tour_id uuid,p_slot_id uuid default null)
returns table(available_spots integer,total_capacity integer,booked_count integer,slot_date date,departure_time time)
language sql volatile security definer set search_path=public as $$
 select greatest(0,i.available),i.capacity,i.marketplace,coalesce(s.slot_date,t.start_date),s.departure_time
 from toursred_ops.inventory(p_tour_id,p_slot_id) i join public.tours t on t.id=p_tour_id
 left join public.tour_slots s on s.id=p_slot_id;
$$;
create or replace function public.get_tour_slots_by_range(p_tour_id uuid,p_start_date date,p_end_date date)
returns table(id uuid,tour_id uuid,agency_id uuid,schedule_id uuid,slot_date date,departure_time time,end_date date,capacity integer,booked_count integer,available_count integer,status public.slot_status_enum,is_auto_generated boolean,min_travelers_reached boolean,notes text,created_at timestamptz)
language sql volatile security definer set search_path=public as $$
 select s.id,s.tour_id,s.agency_id,s.schedule_id,s.slot_date,s.departure_time,s.end_date,
 i.capacity,i.marketplace,greatest(0,i.available),s.status,s.is_auto_generated,s.min_travelers_reached,s.notes,s.created_at
 from public.tour_slots s cross join lateral toursred_ops.inventory(s.tour_id,s.id) i
 where s.tour_id=p_tour_id and s.slot_date between p_start_date and p_end_date and s.status<>'cancelado'
 and not exists(select 1 from public.tour_slot_blackouts b where b.tour_id=p_tour_id and s.slot_date between b.blackout_start::date and b.blackout_end::date)
 order by s.slot_date,s.departure_time;
$$;

create function public.save_external_sale(p_sale jsonb,p_travelers jsonb,p_id uuid default null,p_version integer default null)
returns uuid language plpgsql security definer set search_path=public as $$
declare t public.tours%rowtype; sl public.tour_slots%rowtype; old_sale public.external_sales%rowtype;
 sid uuid:=p_id; slot uuid:=nullif(p_sale->>'slot_id','')::uuid; n integer; inv record; tr jsonb;
 tid uuid; ids uuid[]:='{}'; fields text[]:='{}'; primary_count integer:=0;
begin
 select * into t from public.tours where id=(p_sale->>'tour_id')::uuid;
 if not found or not public.external_sale_access(t.agency_id,'manage') then raise exception 'No autorizado' using errcode='42501'; end if;
 perform toursred_ops.lock_inventory(t.id);
 if sid is not null then
 select * into old_sale from public.external_sales where id=sid for update;
 if not found or old_sale.agency_id<>t.agency_id or old_sale.tour_id<>t.id then raise exception 'Venta inexistente o ajena'; end if;
 if old_sale.status<>'active' then raise exception 'La venta esta cancelada'; end if;
 if p_version is distinct from old_sale.version then raise exception 'La venta cambio. Recarga antes de guardar.'; end if;
 if exists(select 1 from public.external_sale_travelers where external_sale_id=sid and checked_in_at is not null) then
 raise exception 'No se puede modificar una venta con check-in registrado'; end if;
 end if;
 if slot is not null then
 select * into sl from public.tour_slots where id=slot and tour_id=t.id for update;
 if not found or sl.status not in ('activo','lleno') then raise exception 'Salida no disponible'; end if;
 if exists(select 1 from public.tour_slot_blackouts b where b.tour_id=t.id and sl.slot_date between b.blackout_start::date and b.blackout_end::date) then raise exception 'Fecha bloqueada'; end if;
 else
 if t.start_date is null or exists(select 1 from public.tour_slots where tour_id=t.id) then raise exception 'Selecciona una salida'; end if;
 end if;
 if coalesce(sl.slot_date,t.start_date)<(now() at time zone 'America/Mexico_City')::date then raise exception 'La salida ya paso'; end if;
 if jsonb_typeof(p_travelers) is distinct from 'array' then raise exception 'Viajeros invalidos'; end if;
 n:=jsonb_array_length(p_travelers);
 if n not between 1 and 1000 then raise exception 'Cantidad de viajeros invalida'; end if;
 select * into inv from toursred_ops.inventory(t.id,slot,null,sid);
 if n>inv.available then raise exception 'No hay suficientes lugares disponibles: %',greatest(0,inv.available); end if;
 if sid is null then
 insert into public.external_sales(agency_id,tour_id,slot_id,departure_date,departure_time,source,external_reference,primary_traveler_name,primary_traveler_email,primary_traveler_phone,travelers_count,notes,created_by,operational_email_authorized)
 values(t.agency_id,t.id,slot,coalesce(sl.slot_date,t.start_date),sl.departure_time,p_sale->>'source',p_sale->>'external_reference',p_sale->>'primary_traveler_name',nullif(p_sale->>'primary_traveler_email',''),p_sale->>'primary_traveler_phone',n,p_sale->>'notes',auth.uid(),coalesce((p_sale->>'operational_email_authorized')::boolean,false))
 returning id into sid;
 else
 if n<>old_sale.travelers_count then fields:=array_append(fields,'travelers_count'); end if;
 if slot is distinct from old_sale.slot_id then fields:=array_append(fields,'departure'); end if;
 fields:=array_append(fields,'details');
 update public.external_sales set slot_id=slot,departure_date=coalesce(sl.slot_date,t.start_date),departure_time=sl.departure_time,
 source=p_sale->>'source',external_reference=p_sale->>'external_reference',primary_traveler_name=p_sale->>'primary_traveler_name',
 primary_traveler_email=nullif(p_sale->>'primary_traveler_email',''),primary_traveler_phone=p_sale->>'primary_traveler_phone',
 travelers_count=n,notes=p_sale->>'notes',updated_at=now(),version=version+1,qr_enabled=false,qr_sent_at=null,
 operational_email_authorized=coalesce((p_sale->>'operational_email_authorized')::boolean,false) where id=sid;
 delete from toursred_ops.external_qr_tokens where external_sale_id=sid;
 end if;
 if exists(select 1 from public.external_sale_financials f where f.external_sale_id=sid and
 (f.total_sale_amount is distinct from (p_sale->>'total_sale_amount')::numeric or f.amount_paid is distinct from (p_sale->>'amount_paid')::numeric or f.currency is distinct from p_sale->>'currency')) then fields:=array_append(fields,'amounts'); end if;
 insert into public.external_sale_financials(external_sale_id,total_sale_amount,amount_paid,currency,payment_method)
 values(sid,(p_sale->>'total_sale_amount')::numeric,(p_sale->>'amount_paid')::numeric,p_sale->>'currency',p_sale->>'payment_method')
 on conflict(external_sale_id) do update set total_sale_amount=excluded.total_sale_amount,amount_paid=excluded.amount_paid,currency=excluded.currency,payment_method=excluded.payment_method;
 update public.external_sale_travelers set is_primary=false where external_sale_id=sid;
 for tr in select value from jsonb_array_elements(p_travelers) loop
 tid:=coalesce(nullif(tr->>'id','')::uuid,gen_random_uuid());
 if tid=any(ids) or exists(select 1 from public.external_sale_travelers where id=tid and external_sale_id<>sid) then raise exception 'Viajero invalido'; end if;
 ids:=array_append(ids,tid);
 if coalesce((tr->>'is_primary')::boolean,false) then primary_count:=primary_count+1; end if;
 insert into public.external_sale_travelers(id,external_sale_id,first_name,last_name,email,phone,traveler_type,is_primary)
 values(tid,sid,tr->>'first_name',coalesce(tr->>'last_name',''),tr->>'email',tr->>'phone',coalesce(tr->>'traveler_type','adulto'),coalesce((tr->>'is_primary')::boolean,false))
 on conflict(id) do update set first_name=excluded.first_name,last_name=excluded.last_name,email=excluded.email,phone=excluded.phone,traveler_type=excluded.traveler_type,is_primary=excluded.is_primary,is_cancelled=false;
 end loop;
 if primary_count<>1 then raise exception 'Debe existir un viajero principal'; end if;
 update public.external_sale_travelers set is_cancelled=true where external_sale_id=sid and not(id=any(ids));
 insert into public.external_sale_events(external_sale_id,actor_id,event_type,changed_fields) values(sid,auth.uid(),case when p_id is null then 'created' else 'updated' end,fields);
 return sid;
end;
$$;

create function public.cancel_external_sale(p_id uuid,p_reason text,p_version integer)
returns void language plpgsql security definer set search_path=public as $$
declare s public.external_sales%rowtype;
begin
 select * into s from public.external_sales where id=p_id;
 if not found or not public.external_sale_access(s.agency_id,'manage') then raise exception 'No autorizado' using errcode='42501'; end if;
 perform toursred_ops.lock_inventory(s.tour_id);
 select * into s from public.external_sales where id=p_id for update;
 if s.status='cancelled' then return; end if;
 if s.version is distinct from p_version then raise exception 'La venta cambio. Recarga.'; end if;
 if length(trim(p_reason))<3 or p_reason is null then raise exception 'Indica el motivo'; end if;
 if exists(select 1 from public.external_sale_travelers where external_sale_id=p_id and checked_in_at is not null) then raise exception 'La venta tiene check-in'; end if;
 update public.external_sales set status='cancelled',cancelled_at=now(),cancellation_reason=left(p_reason,2000),updated_at=now(),version=version+1,qr_enabled=false where id=p_id;
 delete from toursred_ops.external_qr_tokens where external_sale_id=p_id;
 insert into public.external_sale_events(external_sale_id,actor_id,event_type) values(p_id,auth.uid(),'cancelled');
end;
$$;

create function public.generate_external_sale_qr(p_id uuid)
returns text language plpgsql security definer set search_path=public,extensions as $$
declare s public.external_sales%rowtype; token text;
begin
 select * into s from public.external_sales where id=p_id for update;
 if not found or not (public.external_sale_access(s.agency_id,'manage') or public.external_sale_access(s.agency_id,'checkin')) then raise exception 'No autorizado' using errcode='42501'; end if;
 if s.status<>'active' or s.departure_date<(now() at time zone 'America/Mexico_City')::date then raise exception 'Venta no disponible'; end if;
 token:=encode(extensions.gen_random_bytes(32),'hex');
 insert into toursred_ops.external_qr_tokens(external_sale_id,token_hash,expires_at)
 values(p_id,extensions.digest(token,'sha256'),((s.departure_date+1)::timestamp at time zone 'America/Mexico_City'))
 on conflict(external_sale_id) do update set token_hash=excluded.token_hash,expires_at=excluded.expires_at,created_at=now();
 update public.external_sales set qr_enabled=true where id=p_id;
 insert into public.external_sale_events(external_sale_id,actor_id,event_type) values(p_id,auth.uid(),'qr_generated');
 return token;
end;
$$;

create function public.checkin_external_sale(p_token text,p_agency_id uuid,p_tour_id uuid,p_slot_id uuid default null)
returns jsonb language plpgsql security definer set search_path=public,extensions as $$
declare s public.external_sales%rowtype; changed integer;
begin
 if not public.external_sale_access(p_agency_id,'checkin') then raise exception 'No autorizado' using errcode='42501'; end if;
 select es.* into s from public.external_sales es join toursred_ops.external_qr_tokens q on q.external_sale_id=es.id
 where q.token_hash=extensions.digest(p_token,'sha256') and q.expires_at>now()
 and es.agency_id=p_agency_id and es.tour_id=p_tour_id and es.slot_id is not distinct from p_slot_id
 and es.status='active' and es.qr_enabled for update of es;
 if not found then raise exception 'QR invalido para esta agencia o salida'; end if;
 if s.departure_date<>(now() at time zone 'America/Mexico_City')::date then raise exception 'El check-in solo esta disponible el dia de la salida'; end if;
 update public.external_sale_travelers set checked_in_at=now(),checked_in_by=auth.uid()
 where external_sale_id=s.id and not is_cancelled and checked_in_at is null;
 get diagnostics changed=row_count;
 if changed=0 then return jsonb_build_object('already_checked_in',true,'checked_in',0); end if;
 insert into public.external_sale_events(external_sale_id,actor_id,event_type) values(s.id,auth.uid(),'checkin');
 return jsonb_build_object('already_checked_in',false,'checked_in',changed);
end;
$$;

-- Operational read APIs expose no monetary columns.
create function public.get_agency_operations(p_agency_id uuid,p_from date,p_to date)
returns table(tour_id uuid,slot_id uuid,tour_name text,departure_date date,departure_time time,capacity integer,marketplace integer,external integer,blocked integer,held integer,available integer,status text)
language plpgsql security definer set search_path=public as $$
begin
 if not public.external_sale_access(p_agency_id,'view') then raise exception 'No autorizado' using errcode='42501'; end if;
 if p_to-p_from>366 or p_to<p_from then raise exception 'Periodo invalido (maximo un año)'; end if;
 return query
 select t.id,s.id,t.name,coalesce(s.slot_date,t.start_date),s.departure_time,i.capacity,i.marketplace,i.external,i.blocked,i.held,greatest(0,i.available),coalesce(s.status::text,'activo')
 from public.tours t left join public.tour_slots s on s.tour_id=t.id
 cross join lateral toursred_ops.inventory(t.id,s.id) i
 where t.agency_id=p_agency_id and coalesce(s.slot_date,t.start_date) between p_from and p_to
 order by coalesce(s.slot_date,t.start_date),s.departure_time,t.name;
end;
$$;
create function public.get_operational_manifest(p_tour_id uuid,p_slot_id uuid default null)
returns table(origin text,reservation_id uuid,traveler_id uuid,traveler_name text,traveler_type text,email text,phone text,people integer,status text,checked_in_at timestamptz)
language plpgsql security definer set search_path=public as $$
declare aid uuid;
begin
 select agency_id into aid from public.tours where id=p_tour_id;
 if not public.external_sale_access(aid,'view') then raise exception 'No autorizado' using errcode='42501'; end if;
 return query
 select 'ToursRed'::text,b.id,bt.id,
 coalesce(nullif(trim(bt.nombre||' '||coalesce(bt.apellido,'')),''),u.first_name||' '||u.last_name),
 coalesce(bt.categoria_viajero,'adulto'),coalesce(bt.email,u.email),coalesce(bt.telefono,u.phone_number),
 case when bt.id is null then b.travelers_count else 1 end,b.status,b.checkin_at
 from public.bookings b join public.users u on u.id=b.user_id
 left join public.booking_travelers bt on bt.booking_id=b.id and not coalesce(bt.is_cancelled,false)
 where b.tour_id=p_tour_id and b.slot_id is not distinct from p_slot_id and b.status in ('pending','confirmed','completed')
 union all
 select 'Externa',s.id,tr.id,trim(tr.first_name||' '||tr.last_name),tr.traveler_type,
 coalesce(tr.email,s.primary_traveler_email),coalesce(tr.phone,s.primary_traveler_phone),1,s.status,tr.checked_in_at
 from public.external_sales s join public.external_sale_travelers tr on tr.external_sale_id=s.id
 where s.tour_id=p_tour_id and s.slot_id is not distinct from p_slot_id and s.status='active' and not tr.is_cancelled
 order by 1,2,3;
end;
$$;

-- No public access to internal helpers; explicitly constrain every new RPC.
revoke all on all functions in schema toursred_ops from public,anon,authenticated;
revoke all on function public.save_external_sale(jsonb,jsonb,uuid,integer),public.cancel_external_sale(uuid,text,integer),
 public.generate_external_sale_qr(uuid),public.checkin_external_sale(text,uuid,uuid,uuid),
 public.get_agency_operations(uuid,date,date),public.get_operational_manifest(uuid,uuid) from public,anon;
grant execute on function public.save_external_sale(jsonb,jsonb,uuid,integer),public.cancel_external_sale(uuid,text,integer),
 public.generate_external_sale_qr(uuid),public.checkin_external_sale(text,uuid,uuid,uuid),
 public.get_agency_operations(uuid,date,date),public.get_operational_manifest(uuid,uuid) to authenticated;

-- Direct table writes (including holds and agency seat blocks) cannot bypass the lock.
create function toursred_ops.guard_hold_inventory()
returns trigger language plpgsql security definer set search_path=public as $$
declare v record; previous integer:=0; requested integer;
begin
 perform toursred_ops.lock_inventory(NEW.tour_id);
 if NEW.slot_id is not null and not exists(select 1 from public.tour_slots where id=NEW.slot_id and tour_id=NEW.tour_id) then raise exception 'Salida ajena al tour'; end if;
 if TG_OP='UPDATE' then
 if NEW.tour_id<>OLD.tour_id or NEW.slot_id is distinct from OLD.slot_id then raise exception 'Libera el apartado antes de cambiar de salida'; end if;
 if OLD.expires_at>now() then previous:=case when OLD.seat_number is null then OLD.held_count else 1 end; end if;
 end if;
 if NEW.expires_at>now() then
 requested:=case when NEW.seat_number is null then NEW.held_count else 1 end;
 if requested is null or requested<1 then raise exception 'Apartado invalido'; end if;
 select * into v from toursred_ops.inventory(NEW.tour_id,NEW.slot_id);
 if requested>v.available+previous then raise exception 'No hay suficientes lugares disponibles'; end if;
 end if;
 return NEW;
end; $$;
create trigger aa_unified_hold_inventory before insert or update on public.seat_holds for each row execute function toursred_ops.guard_hold_inventory();

create function toursred_ops.guard_block_inventory()
returns trigger language plpgsql security definer set search_path=public as $$
declare v record; previous integer:=0;
begin
 if NEW.status<>'bloqueado_agencia' then return NEW; end if;
 perform toursred_ops.lock_inventory(NEW.tour_id);
 if TG_OP='UPDATE' then
 if OLD.tour_id=NEW.tour_id and OLD.slot_id is not distinct from NEW.slot_id and OLD.status='bloqueado_agencia' then previous:=1; end if;
 end if;
 select * into v from toursred_ops.inventory(NEW.tour_id,NEW.slot_id);
 if v.available+previous<1 then raise exception 'No hay suficientes lugares disponibles'; end if;
 return NEW;
end; $$;
create trigger aa_unified_block_inventory before insert or update on public.slot_seat_status for each row execute function toursred_ops.guard_block_inventory();

create function toursred_ops.guard_capacity_change()
returns trigger language plpgsql security definer set search_path=public as $$
declare v record; cap integer;
begin
 if TG_TABLE_NAME='tour_slots' then
 if NEW.capacity=OLD.capacity and NEW.slot_date=OLD.slot_date and NEW.departure_time=OLD.departure_time and NEW.tour_id=OLD.tour_id and NEW.status<>'cancelado' then return NEW; end if;
 perform toursred_ops.lock_inventory(NEW.tour_id);
 select * into v from toursred_ops.inventory(NEW.tour_id,NEW.id);
 cap:=NEW.capacity;
 if v.external>0 and (NEW.slot_date<>OLD.slot_date or NEW.departure_time<>OLD.departure_time or NEW.tour_id<>OLD.tour_id or NEW.status='cancelado') then
 raise exception 'Reprograma o cancela las ventas externas antes de modificar esta salida'; end if;
 else
 if NEW.max_travelers is not distinct from OLD.max_travelers and NEW.available_spots is not distinct from OLD.available_spots and NEW.start_date is not distinct from OLD.start_date then return NEW; end if;
 perform toursred_ops.lock_inventory(NEW.id);
 select * into v from toursred_ops.inventory(NEW.id);
 cap:=coalesce(nullif(NEW.available_spots,0),NEW.max_travelers,10);
 if v.external>0 and NEW.start_date is distinct from OLD.start_date then raise exception 'Reprograma las ventas externas antes de modificar la fecha'; end if;
 end if;
 if cap<v.marketplace+v.external+v.blocked+v.held then raise exception 'La capacidad no puede ser menor a la ocupacion y apartados'; end if;
 return NEW;
end; $$;
create trigger aa_unified_slot_capacity before update on public.tour_slots for each row execute function toursred_ops.guard_capacity_change();
create trigger aa_unified_tour_capacity before update on public.tours for each row execute function toursred_ops.guard_capacity_change();

create function public.prepare_external_sale_email(p_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare s public.external_sales%rowtype; token text; agency jsonb; tour_name text; meeting text;
begin
 select * into s from public.external_sales where id=p_id for update;
 if not found or not public.external_sale_access(s.agency_id,'manage') then raise exception 'No autorizado' using errcode='42501'; end if;
 if not s.operational_email_authorized or coalesce(s.primary_traveler_email,'') !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then raise exception 'Falta correo valido o autorizacion operativa'; end if;
 if exists(select 1 from public.external_sale_events where external_sale_id=p_id and event_type='qr_email_requested' and created_at>now()-interval '1 minute') then raise exception 'Espera un minuto antes de reenviar'; end if;
 token:=public.generate_external_sale_qr(p_id);
 select jsonb_build_object('name',name,'logo',logo,'contact_email',contact_email) into agency from public.agencies where id=s.agency_id;
 select name into tour_name from public.tours where id=s.tour_id;
 select string_agg(dp.name||coalesce(' — '||tdp.special_instructions,''),'; ' order by tdp.display_order) into meeting
 from public.tour_departure_points tdp join public.departure_points dp on dp.id=tdp.departure_point_id where tdp.tour_id=s.tour_id;
 insert into public.external_sale_events(external_sale_id,actor_id,event_type) values(p_id,auth.uid(),'qr_email_requested');
 return jsonb_build_object('id',s.id,'actor_id',auth.uid(),'tour_id',s.tour_id,'slot_id',s.slot_id,'email',s.primary_traveler_email,
 'agency',agency,'tour_name',tour_name,'date',s.departure_date,'time',s.departure_time,'travelers_count',s.travelers_count,'meeting',meeting,'token',token);
end; $$;

create function public.finish_external_sale_email(p_id uuid,p_actor uuid,p_success boolean)
returns void language plpgsql security definer set search_path=public as $$
begin
 if p_success then update public.external_sales set qr_sent_at=now() where id=p_id; end if;
 insert into public.external_sale_events(external_sale_id,actor_id,event_type) values(p_id,p_actor,case when p_success then 'qr_email_sent' else 'qr_email_failed' end);
end; $$;
revoke all on function public.prepare_external_sale_email(uuid),public.finish_external_sale_email(uuid,uuid,boolean) from public,anon,authenticated;
grant execute on function public.prepare_external_sale_email(uuid) to authenticated;
grant execute on function public.finish_external_sale_email(uuid,uuid,boolean) to service_role;
revoke all on all functions in schema toursred_ops from public,anon,authenticated;


-- Public aggregate uses the same inventory calculation; no financial values or PII.
create function public.get_tour_inventory_summary(p_tour_id uuid)
returns table(max_capacity integer,available_spots integer)
language sql volatile security definer set search_path=public as $$
 select coalesce(sum(i.capacity),0)::integer,coalesce(sum(greatest(0,i.available)),0)::integer
 from public.tour_slots s cross join lateral toursred_ops.inventory(s.tour_id,s.id) i
 where s.tour_id=p_tour_id and s.slot_date>=(now() at time zone 'America/Mexico_City')::date and s.status in ('activo','lleno')
 and not exists(select 1 from public.tour_slot_blackouts b where b.tour_id=p_tour_id and s.slot_date between b.blackout_start::date and b.blackout_end::date)
 having exists(select 1 from public.tour_slots where tour_id=p_tour_id)
 union all
 select i.capacity,greatest(0,i.available) from toursred_ops.inventory(p_tour_id) i
 where not exists(select 1 from public.tour_slots where tour_id=p_tour_id);
$$;
revoke all on function public.get_tour_inventory_summary(uuid) from public;
grant execute on function public.get_tour_inventory_summary(uuid) to anon,authenticated;
grant usage on schema toursred_ops to postgres;
grant execute on all functions in schema toursred_ops to postgres;
commit;
