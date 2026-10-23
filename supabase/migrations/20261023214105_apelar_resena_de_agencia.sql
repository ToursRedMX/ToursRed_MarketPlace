-- La agencia puede apelar (no estoy de acuerdo) o reportar (lenguaje inadecuado o
-- irrespetuoso) una resena que un viajero escribio sobre ella.
--
-- Reusa el service desk, como la apelacion del viajero (20261023200512): la solicitud ES
-- un ticket (subcategoria RESA, con folio y correos). Las resenas de agencia son
-- PUBLICAS, asi que el estado de la apelacion NO va en columnas de agency_reviews (las
-- leeria cualquiera, incluso anon): vive en agency_review_appeals, que solo leen la
-- agencia dueña y los admin. Una solicitud por resena; la resena sigue visible mientras
-- se revisa y solo un admin la oculta.
--
-- De paso (regla 13): agency_reviews y reviews daban a anon y authenticated todos los
-- permisos de tabla, TRUNCATE incluido; el RLS los contenia, TRUNCATE no pasa por el RLS.
begin;

revoke all on public.agency_reviews from public, anon, authenticated;
grant select on public.agency_reviews to anon;
grant select, insert, update, delete on public.agency_reviews to authenticated;

revoke all on public.reviews from public, anon, authenticated;
grant select on public.reviews to anon;
grant select, insert, update, delete on public.reviews to authenticated;

create table public.agency_review_appeals(
 id uuid primary key default gen_random_uuid(),
 review_id uuid not null unique references public.agency_reviews(id) on delete cascade,
 agency_id uuid not null references public.agencies(id) on delete cascade,
 ticket_id uuid references public.support_tickets(id) on delete set null,
 tipo text not null check (tipo in ('desacuerdo','lenguaje')),
 resultado text check (resultado in ('mantenida','ocultada')),
 resuelta_en timestamptz,
 created_at timestamptz not null default now()
);
create index idx_agency_review_appeals_agency on public.agency_review_appeals(agency_id);
create index idx_agency_review_appeals_ticket on public.agency_review_appeals(ticket_id);

alter table public.agency_review_appeals enable row level security;
revoke all on public.agency_review_appeals from public, anon, authenticated;
grant select on public.agency_review_appeals to authenticated;
create policy "Agency owner and admins can view review appeals" on public.agency_review_appeals
 for select to authenticated
 using (
  exists(select 1 from public.agencies a where a.id=agency_review_appeals.agency_id and a.user_id=(select auth.uid()))
  or exists(select 1 from public.users u where u.id=(select auth.uid()) and u.role='admin')
 );

-- La categoria de soporte "Calificaciones" tambien es de agencias; subcategoria nueva.
update public.support_categories set aplica_a=array['traveler','agency'] where slug='calificaciones';

insert into public.support_subcategories(category_id, nombre, descripcion, nomenclatura, prioridad_default, sla_horas, aplica_a, permite_adjuntos)
select c.id, 'Apelar o reportar resena de agencia', 'La agencia apela una resena o reporta lenguaje inadecuado', 'RESA', 'media', 48, array['agency'], true
from public.support_categories c
where c.slug='calificaciones'
 and not exists(select 1 from public.support_subcategories s where s.category_id=c.id and s.nomenclatura='RESA');

create function public.apelar_resena_agencia(p_review_id uuid, p_ticket_id uuid, p_tipo text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
 r public.agency_reviews%rowtype;
begin
 if auth.uid() is null then raise exception 'No autorizado' using errcode='42501'; end if;
 if p_tipo is null or p_tipo not in ('desacuerdo','lenguaje') then
 return jsonb_build_object('success',false,'error','Tipo de solicitud no valido');
 end if;

 select * into r from public.agency_reviews where id=p_review_id for update;
 -- Solo el dueño de la agencia resenada; a otro no se le confirma ni que existe.
 if not found or r.is_visible is false
  or not exists(select 1 from public.agencies a where a.id=r.agency_id and a.user_id=auth.uid()) then
 raise exception 'No autorizado' using errcode='42501';
 end if;
 if exists(select 1 from public.agency_review_appeals where review_id=p_review_id) then
 return jsonb_build_object('success',false,'error','Esta resena ya tiene una solicitud de revision');
 end if;

 if not exists(select 1 from public.support_tickets t
   where t.id=p_ticket_id and t.user_id=auth.uid()
     and t.extra_data->>'motivo'='apelacion_resena_agencia'
     and t.extra_data->>'review_id'=p_review_id::text) then
 return jsonb_build_object('success',false,'error','El ticket no corresponde a esta resena');
 end if;

 insert into public.agency_review_appeals(review_id, agency_id, ticket_id, tipo)
 values(p_review_id, r.agency_id, p_ticket_id, p_tipo);
 return jsonb_build_object('success',true);
end $$;
revoke all on function public.apelar_resena_agencia(uuid,uuid,text) from public, anon;
grant execute on function public.apelar_resena_agencia(uuid,uuid,text) to authenticated;

create function public.resolver_apelacion_resena_agencia(p_review_id uuid, p_ocultar boolean, p_nota text default '')
returns jsonb language plpgsql security definer set search_path=public as $$
declare
 ap public.agency_review_appeals%rowtype;
 v_admin public.users%rowtype;
begin
 if auth.uid() is null then raise exception 'No autorizado' using errcode='42501'; end if;
 select * into v_admin from public.users where id=auth.uid() and role='admin';
 if not found then raise exception 'No autorizado' using errcode='42501'; end if;

 select * into ap from public.agency_review_appeals where review_id=p_review_id for update;
 if not found then return jsonb_build_object('success',false,'error','Esta resena no tiene una solicitud de revision'); end if;
 if ap.resuelta_en is not null then return jsonb_build_object('success',false,'error','La solicitud ya fue resuelta'); end if;

 update public.agency_review_appeals
 set resultado=case when p_ocultar then 'ocultada' else 'mantenida' end, resuelta_en=now()
 where id=ap.id;
 if p_ocultar then
 update public.agency_reviews set is_visible=false where id=p_review_id;
 end if;

 if ap.ticket_id is not null then
 insert into public.support_ticket_history(ticket_id, tipo_evento, descripcion, actor_id, actor_name)
 values(ap.ticket_id, 'comentario_interno',
  case when p_ocultar then 'Solicitud resuelta: la resena se ocultó.' else 'Solicitud resuelta: la resena se mantuvo.' end
   || coalesce(' Nota: '||nullif(btrim(p_nota),''), ''),
  auth.uid(), btrim(coalesce(v_admin.first_name,'')||' '||coalesce(v_admin.last_name,'')));
 end if;
 return jsonb_build_object('success',true);
end $$;
revoke all on function public.resolver_apelacion_resena_agencia(uuid,boolean,text) from public, anon;
grant execute on function public.resolver_apelacion_resena_agencia(uuid,boolean,text) to authenticated;

commit;
