-- Mensajeria: dos huecos de RLS encontrados el 21-oct-2026 al revisar por que no habia
-- ni una conversacion en la base (la verificacion de telefono es obligatoria y solo un
-- usuario la tenia; al leer las politicas salieron estos dos).
--
-- 1. messages no tenia politica DELETE. MessageThread.deleteMessage hace
--    .from('messages').delete(): con RLS y sin politica, Postgres borra 0 filas SIN error,
--    asi que la pantalla quitaba el mensaje de la lista y volvia a aparecer al recargar.
--    Se permite borrar solo los mensajes propios (la UI solo ofrece el boton en los propios).
--
-- 2. message_participants permitia INSERT con `user_id = auth.uid()` sin mirar de que
--    conversacion se trataba: quien conociera el UUID de una conversacion ajena podia
--    agregarse como participante y leer todos sus mensajes (la politica de SELECT de
--    messages mira message_participants). Ahora solo agrega participantes quien YA es
--    participante de esa conversacion (o un admin). Crear una conversacion no depende de
--    esta politica: create_conversation_with_participants es SECURITY DEFINER y ya inserta
--    al creador y a los invitados por su cuenta; el front no inserta aqui directo (comprobado:
--    ningun archivo de src/ escribe en message_participants).
--
-- Sin cambio de datos. Para revertir, recrear las politicas anteriores.

DROP POLICY IF EXISTS "Users can add participants to their conversations" ON public.message_participants;
CREATE POLICY "Users can add participants to their conversations"
  ON public.message_participants
  FOR INSERT
  TO authenticated
  WITH CHECK (
    public.is_conversation_participant(conversation_id)
    OR public.is_admin_user()
  );

DROP POLICY IF EXISTS "Users can delete their own messages" ON public.messages;
CREATE POLICY "Users can delete their own messages"
  ON public.messages
  FOR DELETE
  TO authenticated
  USING (sender_id = (SELECT auth.uid()));
