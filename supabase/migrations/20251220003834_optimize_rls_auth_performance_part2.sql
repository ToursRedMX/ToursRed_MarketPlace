
DROP POLICY IF EXISTS "Users can create reviews for booked tours" ON public.reviews;
CREATE POLICY "Users can create reviews for booked tours"
  ON public.reviews
  FOR INSERT
  TO authenticated
  WITH CHECK (
    (select auth.uid()) = user_id
    AND EXISTS (
      SELECT 1 FROM public.bookings
      WHERE user_id = (select auth.uid())
      AND tour_id = reviews.tour_id
      AND status = 'completed'
    )
  );

DROP POLICY IF EXISTS "Users can update own reviews" ON public.reviews;
CREATE POLICY "Users can update own reviews"
  ON public.reviews
  FOR UPDATE
  TO authenticated
  USING ((select auth.uid()) = user_id)
  WITH CHECK ((select auth.uid()) = user_id);

DROP POLICY IF EXISTS "Admins can view all reviews" ON public.reviews;
CREATE POLICY "Admins can view all reviews"
  ON public.reviews
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.users
      WHERE id = (select auth.uid())
      AND role = 'admin'
    )
  );

DROP POLICY IF EXISTS "Admins can update any review" ON public.reviews;
CREATE POLICY "Admins can update any review"
  ON public.reviews
  FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.users
      WHERE id = (select auth.uid())
      AND role = 'admin'
    )
  );

DROP POLICY IF EXISTS "Admins can delete any review" ON public.reviews;
CREATE POLICY "Admins can delete any review"
  ON public.reviews
  FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.users
      WHERE id = (select auth.uid())
      AND role = 'admin'
    )
  );


DROP POLICY IF EXISTS "Travelers can create their own agency reviews" ON public.agency_reviews;
CREATE POLICY "Travelers can create their own agency reviews"
  ON public.agency_reviews
  FOR INSERT
  TO authenticated
  WITH CHECK (traveler_id = (select auth.uid()));

DROP POLICY IF EXISTS "Travelers can update their own agency reviews" ON public.agency_reviews;
CREATE POLICY "Travelers can update their own agency reviews"
  ON public.agency_reviews
  FOR UPDATE
  TO authenticated
  USING (traveler_id = (select auth.uid()))
  WITH CHECK (traveler_id = (select auth.uid()));

DROP POLICY IF EXISTS "Travelers can delete their own agency reviews" ON public.agency_reviews;
CREATE POLICY "Travelers can delete their own agency reviews"
  ON public.agency_reviews
  FOR DELETE
  TO authenticated
  USING (traveler_id = (select auth.uid()));

DROP POLICY IF EXISTS "Admins can view all agency reviews" ON public.agency_reviews;
CREATE POLICY "Admins can view all agency reviews"
  ON public.agency_reviews
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.users
      WHERE id = (select auth.uid())
      AND role = 'admin'
    )
  );

DROP POLICY IF EXISTS "Admins can update any agency review" ON public.agency_reviews;
CREATE POLICY "Admins can update any agency review"
  ON public.agency_reviews
  FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.users
      WHERE id = (select auth.uid())
      AND role = 'admin'
    )
  );

DROP POLICY IF EXISTS "Admins can delete any agency review" ON public.agency_reviews;
CREATE POLICY "Admins can delete any agency review"
  ON public.agency_reviews
  FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.users
      WHERE id = (select auth.uid())
      AND role = 'admin'
    )
  );


DROP POLICY IF EXISTS "Travelers can view their own reviews" ON public.traveler_reviews;
CREATE POLICY "Travelers can view their own reviews"
  ON public.traveler_reviews
  FOR SELECT
  TO authenticated
  USING (traveler_id = (select auth.uid()));

DROP POLICY IF EXISTS "Agencies can view reviews of their customers" ON public.traveler_reviews;
CREATE POLICY "Agencies can view reviews of their customers"
  ON public.traveler_reviews
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.agencies
      WHERE id = traveler_reviews.agency_id
      AND user_id = (select auth.uid())
    )
  );

DROP POLICY IF EXISTS "Agencies can create traveler reviews" ON public.traveler_reviews;
CREATE POLICY "Agencies can create traveler reviews"
  ON public.traveler_reviews
  FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.agencies
      WHERE id = traveler_reviews.agency_id
      AND user_id = (select auth.uid())
    )
  );

DROP POLICY IF EXISTS "Agencies can update their own traveler reviews" ON public.traveler_reviews;
CREATE POLICY "Agencies can update their own traveler reviews"
  ON public.traveler_reviews
  FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.agencies
      WHERE id = traveler_reviews.agency_id
      AND user_id = (select auth.uid())
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.agencies
      WHERE id = traveler_reviews.agency_id
      AND user_id = (select auth.uid())
    )
  );

DROP POLICY IF EXISTS "Agencies can delete their own traveler reviews" ON public.traveler_reviews;
CREATE POLICY "Agencies can delete their own traveler reviews"
  ON public.traveler_reviews
  FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.agencies
      WHERE id = traveler_reviews.agency_id
      AND user_id = (select auth.uid())
    )
  );

DROP POLICY IF EXISTS "Admins can view all traveler reviews" ON public.traveler_reviews;
CREATE POLICY "Admins can view all traveler reviews"
  ON public.traveler_reviews
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.users
      WHERE id = (select auth.uid())
      AND role = 'admin'
    )
  );

DROP POLICY IF EXISTS "Admins can update any traveler review" ON public.traveler_reviews;
CREATE POLICY "Admins can update any traveler review"
  ON public.traveler_reviews
  FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.users
      WHERE id = (select auth.uid())
      AND role = 'admin'
    )
  );

DROP POLICY IF EXISTS "Admins can delete any traveler review" ON public.traveler_reviews;
CREATE POLICY "Admins can delete any traveler review"
  ON public.traveler_reviews
  FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.users
      WHERE id = (select auth.uid())
      AND role = 'admin'
    )
  );


DROP POLICY IF EXISTS "Users can view conversations they participate in" ON public.conversations;
CREATE POLICY "Users can view conversations they participate in"
  ON public.conversations
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.message_participants
      WHERE conversation_id = conversations.id
      AND user_id = (select auth.uid())
    )
  );

DROP POLICY IF EXISTS "Users can create conversations" ON public.conversations;
CREATE POLICY "Users can create conversations"
  ON public.conversations
  FOR INSERT
  TO authenticated
  WITH CHECK (created_by = (select auth.uid()));

DROP POLICY IF EXISTS "Participants can update conversation status" ON public.conversations;
CREATE POLICY "Participants can update conversation status"
  ON public.conversations
  FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.message_participants
      WHERE conversation_id = conversations.id
      AND user_id = (select auth.uid())
    )
  );

DROP POLICY IF EXISTS "Admins can view all conversations" ON public.conversations;
CREATE POLICY "Admins can view all conversations"
  ON public.conversations
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.users
      WHERE id = (select auth.uid())
      AND role = 'admin'
    )
  );


DROP POLICY IF EXISTS "Users can view messages in their conversations" ON public.messages;
CREATE POLICY "Users can view messages in their conversations"
  ON public.messages
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.message_participants
      WHERE conversation_id = messages.conversation_id
      AND user_id = (select auth.uid())
    )
  );

DROP POLICY IF EXISTS "Users can send messages in their conversations" ON public.messages;
CREATE POLICY "Users can send messages in their conversations"
  ON public.messages
  FOR INSERT
  TO authenticated
  WITH CHECK (
    sender_id = (select auth.uid())
    AND EXISTS (
      SELECT 1 FROM public.message_participants
      WHERE conversation_id = messages.conversation_id
      AND user_id = (select auth.uid())
    )
  );

DROP POLICY IF EXISTS "Users can edit their own messages" ON public.messages;
CREATE POLICY "Users can edit their own messages"
  ON public.messages
  FOR UPDATE
  TO authenticated
  USING (sender_id = (select auth.uid()))
  WITH CHECK (sender_id = (select auth.uid()));

DROP POLICY IF EXISTS "Admins can view all messages" ON public.messages;
CREATE POLICY "Admins can view all messages"
  ON public.messages
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.users
      WHERE id = (select auth.uid())
      AND role = 'admin'
    )
  );


DROP POLICY IF EXISTS "Users can view their own participation" ON public.message_participants;
CREATE POLICY "Users can view their own participation"
  ON public.message_participants
  FOR SELECT
  TO authenticated
  USING (user_id = (select auth.uid()));

DROP POLICY IF EXISTS "Users can join conversations they create or are invited to" ON public.message_participants;
CREATE POLICY "Users can join conversations they create or are invited to"
  ON public.message_participants
  FOR INSERT
  TO authenticated
  WITH CHECK (user_id = (select auth.uid()));

DROP POLICY IF EXISTS "Users can update their own participation" ON public.message_participants;
CREATE POLICY "Users can update their own participation"
  ON public.message_participants
  FOR UPDATE
  TO authenticated
  USING (user_id = (select auth.uid()))
  WITH CHECK (user_id = (select auth.uid()));

DROP POLICY IF EXISTS "Admins can view all participants" ON public.message_participants;
CREATE POLICY "Admins can view all participants"
  ON public.message_participants
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.users
      WHERE id = (select auth.uid())
      AND role = 'admin'
    )
  );
