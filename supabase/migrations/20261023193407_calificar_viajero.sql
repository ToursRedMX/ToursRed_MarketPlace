-- La agencia califica al viajero al terminar el tour (estrellas 1 a 5 y comentario).
--
-- Reusa traveler_reviews (patron: el mismo que agency_reviews, en sentido contrario).
-- Lo que tenia mal:
--   * La politica de INSERT solo miraba que la agencia fuera una agencia: no que la
--     reserva fuera suya ni que traveler_id fuera el del viajero de esa reserva.
--   * Las otras agencias no veian nada (la lectura se limitaba a la agencia autora).
--   * anon y authenticated tenian todos los permisos de tabla (regla 13).
-- Ahora: se escribe SOLO por calificar_viajero (security definer); la tabla la leen el
-- viajero calificado, cualquier agencia y los admin; el publico no.
begin;

revoke all on public.traveler_reviews from public, anon, authenticated;
grant select, update, delete on public.traveler_reviews to authenticated;

-- Escribir ya no pasa por INSERT directo.
drop policy if exists "Agencies can create traveler reviews" on public.traveler_reviews;

-- Moderar (ocultar/borrar) es de los admin; la agencia edita por la funcion.
drop policy if exists "Agencies and admins can update traveler reviews" on public.traveler_reviews;
create policy "Admins can update traveler reviews" on public.traveler_reviews
 for update to authenticated
 using (exists(select 1 from public.users u where u.id=(select auth.uid()) and u.role='admin'))
 with check (exists(select 1 from public.users u where u.id=(select auth.uid()) and u.role='admin'));

drop policy if exists "Agencies and admins can delete traveler reviews" on public.traveler_reviews;
create policy "Admins can delete traveler reviews" on public.traveler_reviews
 for delete to authenticated
 using (exists(select 1 from public.users u where u.id=(select auth.uid()) and u.role='admin'));

-- Lectura: el viajero calificado y cualquier agencia (solo lo no oculto); admin todo.
drop policy if exists "Users, agencies and admins can view traveler reviews" on public.traveler_reviews;
create policy "Travelers, agencies and admins can view traveler reviews" on public.traveler_reviews
 for select to authenticated
 using (
  exists(select 1 from public.users u where u.id=(select auth.uid()) and u.role='admin')
  or (
   is_visible is not false
   and (
    traveler_id=(select auth.uid())
    or exists(select 1 from public.agencies a where a.user_id=(select auth.uid()))
   )
  )
 );

create function public.calificar_viajero(p_booking_id uuid, p_rating integer, p_comment text default '')
returns jsonb language plpgsql security definer set search_path=public as $$
declare
 b public.bookings%rowtype;
 v_comment text:=left(btrim(coalesce(p_comment,'')),1000);
begin
 if auth.uid() is null then raise exception 'No autorizado' using errcode='42501'; end if;
 if p_rating is null or p_rating<1 or p_rating>5 then
 return jsonb_build_object('success',false,'error','La calificacion debe ser de 1 a 5 estrellas');
 end if;

 select * into b from public.bookings where id=p_booking_id;
 -- Solo la agencia dueña de la reserva; a cualquier otro no se le confirma ni que existe.
 if not found or not exists(select 1 from public.agencies a where a.id=b.agency_id and a.user_id=auth.uid()) then
 raise exception 'No autorizado' using errcode='42501';
 end if;

 if b.user_id is null then
 return jsonb_build_object('success',false,'error','Esta reserva no tiene un viajero registrado');
 end if;
 if coalesce(b.is_no_show,false) or b.cancelled_at is not null or b.status='cancelled' then
 return jsonb_build_object('success',false,'error','No se puede calificar una reserva cancelada o con No Show');
 end if;
 -- Tour terminado: completado, o confirmado con la fecha ya pasada (hora de Mexico).
 if not (b.status='completed'
  or (b.status='confirmed' and b.selected_date is not null
      and b.selected_date<(now() at time zone 'America/Mexico_City')::date)) then
 return jsonb_build_object('success',false,'error','Solo puedes calificar al viajero cuando el tour ya termino');
 end if;

 -- Una por reserva; editar no revive una calificacion que un admin ocultó (is_visible no se toca).
 insert into public.traveler_reviews(booking_id,traveler_id,agency_id,rating,comment)
 values(b.id,b.user_id,b.agency_id,p_rating,v_comment)
 on conflict(booking_id) do update set rating=excluded.rating, comment=excluded.comment;

 return jsonb_build_object('success',true);
end $$;
revoke all on function public.calificar_viajero(uuid,integer,text) from public, anon;
grant execute on function public.calificar_viajero(uuid,integer,text) to authenticated;

-- Promedio y total por viajero, para la lista de reservas. Una agencia o un admin
-- pueden pedir a cualquiera; un viajero solo a si mismo.
create function public.resumen_calificaciones_viajeros(p_traveler_ids uuid[])
returns table(traveler_id uuid, promedio numeric, total integer)
language plpgsql stable security definer set search_path=public as $$
declare v_ve_todos boolean;
begin
 if auth.uid() is null then raise exception 'No autorizado' using errcode='42501'; end if;
 v_ve_todos:=exists(select 1 from public.agencies a where a.user_id=auth.uid())
  or exists(select 1 from public.users u where u.id=auth.uid() and u.role='admin');
 return query
 select r.traveler_id, round(avg(r.rating)::numeric,1), count(*)::integer
 from public.traveler_reviews r
 where r.traveler_id=any(p_traveler_ids) and r.is_visible is not false
  and (v_ve_todos or r.traveler_id=auth.uid())
 group by r.traveler_id;
end $$;
revoke all on function public.resumen_calificaciones_viajeros(uuid[]) from public, anon;
grant execute on function public.resumen_calificaciones_viajeros(uuid[]) to authenticated;

commit;
