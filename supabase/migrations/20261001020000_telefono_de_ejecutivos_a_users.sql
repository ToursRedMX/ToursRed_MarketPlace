-- El perfil del ejecutivo guardaba el telefono solo en account_executives.phone,
-- y todo lo que busca el telefono de una cuenta mira users.phone_number. Desde
-- el 01-oct-2026 ExecutivePerfil escribe los dos; esto copia los que ya estaban.
--
-- Solo donde users.phone_number esta vacio: si alguien ya tiene uno ahi, no se
-- pisa. Se normaliza a E.164 igual que src/lib/telefono.ts (10 digitos -> +52).
-- Al 01-oct-2026 es una sola fila.

UPDATE public.users u
   SET phone_number = CASE
         WHEN length(regexp_replace(ae.phone, '\D', '', 'g')) = 10
           THEN '+52' || regexp_replace(ae.phone, '\D', '', 'g')
         ELSE trim(ae.phone)
       END
  FROM public.account_executives ae
 WHERE ae.user_id = u.id
   AND nullif(trim(ae.phone), '') IS NOT NULL
   AND nullif(trim(u.phone_number), '') IS NULL;
