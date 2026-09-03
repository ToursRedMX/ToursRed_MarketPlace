-- ============================================================================
-- EXPORTACION FUNCIONAL desde supabase_migrations.schema_migrations
--
-- Este archivo NO es la migracion original: es el SQL que la base registro
-- haber ejecutado, reconstruido a partir del ledger.
--
--   version: 20260831013031
--   name:    revoke_public_access_deduct_and_redeem_points_functions
--
-- Recuperado : las sentencias ejecutadas, en su orden original.
-- Perdido    : los comentarios sueltos entre sentencias. El ledger guarda solo
--              sentencias ejecutables, asi que la documentacion que tuviera el
--              archivo original no es recuperable desde aqui.
-- Transformado: saltos de linea desescapados y ';' separadores repuestos, que
--              statements[] no conserva. La alineacion puede diferir.
--
-- Se agrega para que el cambio de esquema sea revisable y reproducible desde
-- el repo. Para el detalle de por que existe, ver el bullet del desfase de
-- migraciones en claude.md.
-- ============================================================================

-- deduct_points_for_booking: confirmado que SOLO se llama desde Edge Functions
-- con service_role key (webhooks de pago, cancelacion de extras/suplementos),
-- nunca desde el navegador. El chequeo "auth.uid() IS NOT NULL AND auth.uid()
-- != v_user_id" esta pensado como defensa adicional para el caso de que se
-- llamara con un JWT de usuario suplantando a otro -- pero como esta funcion
-- tambien estaba otorgada a anon/authenticated, cualquiera sin sesion (donde
-- auth.uid() tambien es NULL, igual que en una llamada de service_role) podia
-- invocarla directo y el chequeo NUNCA se activaba. Se revoca el acceso
-- publico; solo debe ejecutarse con service_role.
REVOKE EXECUTE ON FUNCTION public.deduct_points_for_booking(uuid, integer) FROM anon, authenticated;

-- redeem_points_for_booking: confirmado que NO la llama ningun Edge Function
-- ni el frontend actual -- es codigo muerto (el canje de puntos real al
-- momento de pagar una reserva lo hace deduct_points_for_booking, llamado
-- desde los webhooks tras el pago exitoso). Aun asi seguia otorgada a anon,
-- con el mismo bypass. Se revoca el acceso publico ya que nada legitimo
-- depende de que sea publicamente invocable.
REVOKE EXECUTE ON FUNCTION public.redeem_points_for_booking(uuid, integer, numeric) FROM anon, authenticated
;
