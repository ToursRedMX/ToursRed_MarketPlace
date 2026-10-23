-- El viajero puede apelar (pedir revision a soporte de) una calificacion que le dio una agencia.
--
-- Reusa el service desk: la apelacion ES un ticket (con folio, correos y bandeja de
-- soporte) en una subcategoria nueva; traveler_reviews solo guarda el vinculo y el
-- resultado. Una apelacion por calificacion. La calificacion sigue visible mientras se
-- revisa; solo un admin la oculta (resolver_apelacion_calificacion).
begin;

alter table public.traveler_reviews
 add column apelada_en timestamptz,
 add column apelacion_ticket_id uuid references public.support_tickets(id) on delete set null,
 add column apelacion_resultado text check (apelacion_resultado in ('mantenida','ocultada')),
 add column apelacion_resuelta_en timestamptz;

create index idx_traveler_reviews_apelacion_ticket on public.traveler_reviews(apelacion_ticket_id);

insert into public.support_categories(nombre, descripcion, slug, aplica_a)
select 'Calificaciones', 'Revision de calificaciones entre viajeros y agencias', 'calificaciones', array['traveler']
where not exists(select 1 from public.support_categories where slug='calificaciones');

insert into public.support_subcategories(category_id, nombre, descripcion, nomenclatura, prioridad_default, sla_horas, aplica_a, permite_adjuntos)
select c.id, 'Apelar calificacion de viajero', 'El viajero pide revisar una calificacion que le dio una agencia', 'CAL', 'media', 48, array['traveler'], true
from public.support_categories c
where c.slug='calificaciones'
 and not exists(select 1 from public.support_subcategories s where s.category_id=c.id and s.nomenclatura='CAL');

-- El viajero liga su ticket a la calificacion. El ticket lo crea support-create-ticket
-- (folio, correos); aqui se comprueba que sea suyo y que hable de ESTA calificacion.
create function public.apelar_calificacion_viajero(p_review_id uuid, p_ticket_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
 r public.traveler_reviews%rowtype;
begin
 if auth.uid() is null then raise exception 'No autorizado' using errcode='42501'; end if;

 select * into r from public.traveler_reviews where id=p_review_id for update;
 if not found or r.traveler_id<>auth.uid() or r.is_visible is false then
 raise exception 'No autorizado' using errcode='42501';
 end if;
 if r.apelada_en is not null then
 return jsonb_build_object('success',false,'error','Esta calificacion ya fue apelada');
 end if;

 if not exists(select 1 from public.support_tickets t
   where t.id=p_ticket_id and t.user_id=auth.uid()
     and t.extra_data->>'motivo'='apelacion_calificacion'
     and t.extra_data->>'review_id'=p_review_id::text) then
 return jsonb_build_object('success',false,'error','El ticket no corresponde a esta calificacion');
 end if;

 update public.traveler_reviews set apelada_en=now(), apelacion_ticket_id=p_ticket_id where id=p_review_id;
 return jsonb_build_object('success',true);
end $$;
revoke all on function public.apelar_calificacion_viajero(uuid,uuid) from public, anon;
grant execute on function public.apelar_calificacion_viajero(uuid,uuid) to authenticated;

-- Un admin resuelve: mantiene la calificacion o la oculta. Deja constancia en el ticket.
create function public.resolver_apelacion_calificacion(p_review_id uuid, p_ocultar boolean, p_nota text default '')
returns jsonb language plpgsql security definer set search_path=public as $$
declare
 r public.traveler_reviews%rowtype;
 v_admin public.users%rowtype;
begin
 if auth.uid() is null then raise exception 'No autorizado' using errcode='42501'; end if;
 select * into v_admin from public.users where id=auth.uid() and role='admin';
 if not found then raise exception 'No autorizado' using errcode='42501'; end if;

 select * into r from public.traveler_reviews where id=p_review_id for update;
 if not found then return jsonb_build_object('success',false,'error','Calificacion no encontrada'); end if;
 if r.apelada_en is null then return jsonb_build_object('success',false,'error','Esta calificacion no tiene una apelacion'); end if;
 if r.apelacion_resuelta_en is not null then return jsonb_build_object('success',false,'error','La apelacion ya fue resuelta'); end if;

 update public.traveler_reviews
 set apelacion_resultado=case when p_ocultar then 'ocultada' else 'mantenida' end,
     apelacion_resuelta_en=now(),
     is_visible=case when p_ocultar then false else is_visible end
 where id=p_review_id;

 if r.apelacion_ticket_id is not null then
 insert into public.support_ticket_history(ticket_id, tipo_evento, descripcion, actor_id, actor_name)
 values(r.apelacion_ticket_id, 'comentario_interno',
  case when p_ocultar then 'Apelacion resuelta: la calificacion se ocultó.' else 'Apelacion resuelta: la calificacion se mantuvo.' end
   || coalesce(' Nota: '||nullif(btrim(p_nota),''), ''),
  auth.uid(), btrim(coalesce(v_admin.first_name,'')||' '||coalesce(v_admin.last_name,'')));
 end if;
 return jsonb_build_object('success',true);
end $$;
revoke all on function public.resolver_apelacion_calificacion(uuid,boolean,text) from public, anon;
grant execute on function public.resolver_apelacion_calificacion(uuid,boolean,text) to authenticated;

commit;
