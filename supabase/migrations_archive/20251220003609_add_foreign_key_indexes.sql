
-- Agencies table
CREATE INDEX IF NOT EXISTS idx_agencies_user_id ON public.agencies(user_id);

-- Bookings table
CREATE INDEX IF NOT EXISTS idx_bookings_agency_id ON public.bookings(agency_id);
CREATE INDEX IF NOT EXISTS idx_bookings_approved_by ON public.bookings(approved_by);
CREATE INDEX IF NOT EXISTS idx_bookings_tour_id ON public.bookings(tour_id);
CREATE INDEX IF NOT EXISTS idx_bookings_user_id ON public.bookings(user_id);

-- Commission records table
CREATE INDEX IF NOT EXISTS idx_commission_records_agency_id ON public.commission_records(agency_id);
CREATE INDEX IF NOT EXISTS idx_commission_records_booking_id ON public.commission_records(booking_id);
CREATE INDEX IF NOT EXISTS idx_commission_records_tour_id ON public.commission_records(tour_id);

-- Destination images table
CREATE INDEX IF NOT EXISTS idx_destination_images_destination_id ON public.destination_images(destination_id);
CREATE INDEX IF NOT EXISTS idx_destination_images_uploaded_by ON public.destination_images(uploaded_by);

-- Destinations table
CREATE INDEX IF NOT EXISTS idx_destinations_last_updated_by ON public.destinations(last_updated_by);

-- Email settings table
CREATE INDEX IF NOT EXISTS idx_email_settings_updated_by ON public.email_settings(updated_by);

-- Payment transactions table
CREATE INDEX IF NOT EXISTS idx_payment_transactions_booking_id ON public.payment_transactions(booking_id);

-- Platform settings table
CREATE INDEX IF NOT EXISTS idx_platform_settings_updated_by ON public.platform_settings(updated_by);

-- Reviews table
CREATE INDEX IF NOT EXISTS idx_reviews_agency_id ON public.reviews(agency_id);
CREATE INDEX IF NOT EXISTS idx_reviews_tour_id ON public.reviews(tour_id);
CREATE INDEX IF NOT EXISTS idx_reviews_user_id ON public.reviews(user_id);

-- Saved tours table
CREATE INDEX IF NOT EXISTS idx_saved_tours_tour_id ON public.saved_tours(tour_id);

-- Tour destinations table
CREATE INDEX IF NOT EXISTS idx_tour_destinations_destination_id ON public.tour_destinations(destination_id);

-- Tours table
CREATE INDEX IF NOT EXISTS idx_tours_agency_id ON public.tours(agency_id);
