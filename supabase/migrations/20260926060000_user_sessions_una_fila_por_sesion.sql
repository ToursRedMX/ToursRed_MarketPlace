-- ============================================================================
-- user_sessions: una fila por sesion de GoTrue.
--
-- QUE ESTABA PASANDO
--
-- El 25-sep-2026, la primera vez que un login con Google llego a registrarse
-- (PR #278), dejo DOS filas de la misma sesion (d31f1d29...) a 38 ms una de
-- otra, y dos LOGIN en la bitacora. La causa mas probable es una carrera entre
-- pestanas: supabase-js comparte la sesion por localStorage y cada pestana
-- abierta recibe su propio SIGNED_IN; la deduplicacion del front (tambien en
-- localStorage) no puede ganarle a eso. No se confirmo cual fue la causa
-- exacta; el arreglo no depende de ella.
--
-- QUE HACE
--
-- 1. Deja la fila mas antigua de cada session_id repetido (a la fecha, solo
--    ese par; session_id estaba siempre en NULL hasta el PR #278).
-- 2. Cambia el indice parcial no unico de session_id por uno UNICO. Los NULL
--    no chocan entre si, asi que las filas viejas sin session_id no estorban.
--
-- record-session-event hace upsert con ON CONFLICT (session_id) DO NOTHING y,
-- si la sesion ya existia, no escribe un segundo LOGIN en la bitacora.
-- ============================================================================

DELETE FROM public.user_sessions a
USING public.user_sessions b
WHERE a.session_id IS NOT NULL
  AND a.session_id = b.session_id
  AND (a.created_at, a.id) > (b.created_at, b.id);

DROP INDEX IF EXISTS public.idx_user_sessions_session_id;

CREATE UNIQUE INDEX IF NOT EXISTS user_sessions_session_id_key
  ON public.user_sessions (session_id);

COMMENT ON INDEX public.user_sessions_session_id_key IS
  'Una fila por sesion de GoTrue: record-session-event hace upsert ON CONFLICT (session_id) DO NOTHING.';

DO $$
BEGIN
  ASSERT (SELECT count(*) FROM (
    SELECT session_id FROM public.user_sessions
    WHERE session_id IS NOT NULL GROUP BY session_id HAVING count(*) > 1) d) = 0,
    'quedaron session_id repetidos';
END;
$$;
