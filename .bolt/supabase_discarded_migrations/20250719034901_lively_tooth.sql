```sql
-- Insertar usuarios de prueba
INSERT INTO public.users (id, email, first_name, last_name, role)
VALUES
    ('a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', 'admin@example.com', 'Admin', 'User', 'admin')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.users (id, email, first_name, last_name, role)
VALUES
    ('b0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', 'agency@example.com', 'Agency', 'Owner', 'agency')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.users (id, email, first_name, last_name, role)
VALUES
    ('c0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', 'traveler@example.com', 'Traveler', 'Explorer', 'traveler')
ON CONFLICT (id) DO NOTHING;

-- Insertar agencias de prueba
INSERT INTO public.agencies (id, user_id, name, contact_email, is_active)
VALUES
    ('d0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', 'b0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', 'Aventura Tours', 'agency@example.com', TRUE)
ON CONFLICT (id) DO NOTHING;

-- Insertar destinos de prueba
INSERT INTO public.destinations (id, name, description, country, region, best_time_to_visit, main_image_url)
VALUES
    ('e0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', 'Cancún', 'Famoso por sus playas de arena blanca y vida nocturna.', 'México', 'Quintana Roo', 'Noviembre - Abril', 'https://images.pexels.com/photos/1271619/pexels-photo-1271619.jpeg')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.destinations (id, name, description, country, region, best_time_to_visit, main_image_url)
VALUES
    ('f0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', 'Oaxaca', 'Conocido por su rica cultura, gastronomía y artesanías.', 'México', 'Oaxaca', 'Octubre - Mayo', 'https://images.pexels.com/photos/2245436/pexels-photo-2245436.png')
ON CONFLICT (id) DO NOTHING;

-- Insertar tours de prueba (asociados a la agencia y destinos creados)
INSERT INTO public.tours (id, agency_id, name, destination, description, category, price, deposit_percentage, image_url, start_date, end_date, max_travelers, is_featured)
VALUES
    ('g0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', 'd0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', 'Explora las Ruinas Mayas', 'Cancún', 'Un viaje fascinante a las antiguas ruinas mayas de Chichén Itzá y Tulum.', 'cultural', 1500.00, 30, 'https://images.pexels.com/photos/1271619/pexels-photo-1271619.jpeg', '2025-08-01', '2025-08-05', 20, TRUE)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.tours (id, agency_id, name, destination, description, category, price, deposit_percentage, image_url, start_date, end_date, max_travelers, is_featured)
VALUES
    ('h0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', 'd0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', 'Aventura en la Sierra de Oaxaca', 'Oaxaca', 'Descubre la belleza natural y los pueblos mágicos de la sierra oaxaqueña.', 'nature', 2000.00, 25, 'https://images.pexels.com/photos/2245436/pexels-photo-2245436.png', '2025-09-10', '2025-09-15', 15, FALSE)
ON CONFLICT (id) DO NOTHING;

-- Asociar tours con destinos (tabla tour_destinations)
INSERT INTO public.tour_destinations (tour_id, destination_id)
VALUES
    ('g0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', 'e0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11')
ON CONFLICT (tour_id, destination_id) DO NOTHING;

INSERT INTO public.tour_destinations (tour_id, destination_id)
VALUES
    ('h0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', 'f0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11')
ON CONFLICT (tour_id, destination_id) DO NOTHING;
```