-- Las tablas del cobro de notificaciones solo las ESCRIBE el servicio. `authenticated` solo debe LEER (con su politica de RLS).
--
-- Encontrado el 23-oct-2026 al verificar la migracion 20261023064502 contra la base: `authenticated` tenia INSERT, UPDATE, DELETE,
-- TRUNCATE, REFERENCES y TRIGGER sobre avisos_cobro_notificaciones y suscripciones_notificaciones, aunque las migraciones solo le
-- concedian SELECT. Son los permisos por defecto de Supabase para las tablas nuevas de `public`: `REVOKE ALL ... FROM PUBLIC, anon`
-- NO los quita, porque `authenticated` es otro rol con su propia concesion.
--
-- Lo que lo contenia hoy era el RLS: ambas tablas tienen solo politicas de LECTURA, asi que por la API nadie podia insertar, modificar
-- ni borrar (un usuario no podia darse una suscripcion a si mismo). Pero TRUNCATE no pasa por el RLS. La API de Supabase no lo expone,
-- asi que no era explotable desde un navegador, pero el permiso no debia estar. Defensa en profundidad: ahora tampoco hay permiso.
--
-- El servicio (service_role) y la lectura propia de cada usuario NO cambian.
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.avisos_cobro_notificaciones FROM authenticated;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.suscripciones_notificaciones FROM authenticated;
