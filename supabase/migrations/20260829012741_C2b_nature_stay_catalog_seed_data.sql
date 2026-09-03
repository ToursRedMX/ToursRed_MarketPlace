-- ============================================================================
-- EXPORTACION FUNCIONAL desde supabase_migrations.schema_migrations
--
-- Este archivo NO es la migracion original: es el SQL que la base registro
-- haber ejecutado, reconstruido a partir del ledger.
--
--   version: 20260829012741
--   name:    C2b_nature_stay_catalog_seed_data.sql
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

-- ============================================================================
-- Migration: C2b — nature_stay catalog seed data
-- Purpose: Insert initial seed data for property_types, unit_types, amenities
-- All inserts are idempotent: ON CONFLICT (code) DO NOTHING.
-- ============================================================================

-- 1. Property types seed
INSERT INTO nature_stay.property_types (code, name, description, icon, sort_order) VALUES
  ('cabin',         'Cabana',           'Cabana de madera en entorno natural',          'trees',         1),
  ('glamping',      'Glamping',         'Camping de lujo con comodidades',              'tent',          2),
  ('camping',       'Camping',          'Sitio de camping',                              'campfire',      3),
  ('eco_lodge',     'Eco Lodge',        'Alojamiento ecologico sostenible',             'leaf',          4),
  ('beach_hotel',   'Hotel de Playa',   'Hotel frente al mar',                          'waves',         5),
  ('treehouse',     'Casa del Arbol',   'Alojamiento elevado entre arboles',            'tree-pine',     6),
  ('dome',          'Domo',             'Alojamiento tipo domo geodesico',              'home',          7),
  ('tiny_house',    'Tiny House',       'Casa pequena sustentable',                     'home',          8),
  ('rural_house',   'Casa Rural',       'Casa en entorno rural',                        'house',         9),
  ('hacienda',      'Hacienda',         'Hacienda tradicional',                         'building',     10),
  ('boutique_hotel','Hotel Boutique',   'Hotel boutique con encanto',                   'building',     11),
  ('hostel',        'Hostal',           'Hostal con habitaciones compartidas',          'bed',          12),
  ('other',         'Otro',             'Otro tipo de alojamiento',                     'help-circle',  99)
ON CONFLICT (code) DO NOTHING
;



-- 2. Unit types seed
INSERT INTO nature_stay.unit_types (code, name, description, icon, sort_order) VALUES
  ('entire_place', 'Lugar completo',  'Alojamiento completo',            'home',         1),
  ('room',         'Habitacion',      'Habitacion privada',              'door-closed',  2),
  ('cabin',        'Cabana',          'Cabana individual',               'trees',        3),
  ('tent',         'Tent',            'Tent de camping/glamping',        'tent',         4),
  ('dome',         'Domo',            'Domo geodesico',                  'home',         5),
  ('campsite',     'Sitio de camping','Sitio para acampar',              'campfire',     6),
  ('bed',          'Cama',            'Cama individual compartida',      'bed',          7),
  ('suite',        'Suite',           'Suite con comodidades extra',     'door-open',    8),
  ('bungalow',     'Bungalow',        'Bungalow',                        'house',        9),
  ('villa',        'Villa',           'Villa de lujo',                   'palace',      10)
ON CONFLICT (code) DO NOTHING
;



-- 3. Amenities seed
INSERT INTO nature_stay.amenities (code, name, category, icon, sort_order) VALUES
  ('wifi',                    'WiFi',                    'connectivity',   'wifi',              1),
  ('parking',                 'Estacionamiento',         'services',       'car',               2),
  ('pool',                    'Alberca',                 'outdoor',        'waves',             3),
  ('restaurant',              'Restaurante',             'services',       'utensils',          4),
  ('reception',               'Recepcion 24h',           'services',       'concierge-bell',    5),
  ('hiking_trail',            'Sendero para caminar',    'nature',         'footprints',        6),
  ('private_bathroom',        'Bano privado',            'bathroom',       'shower-head',       7),
  ('air_conditioning',        'Aire acondicionado',      'general',        'wind',              8),
  ('fireplace',               'Chimenea',                'general',        'flame',             9),
  ('king_bed',                'Cama King',               'bedroom',        'bed-double',       10),
  ('kitchen',                 'Cocina',                  'kitchen',        'chef-hat',         11),
  ('hot_water',               'Agua caliente',           'bathroom',       'droplets',         12),
  ('breakfast',               'Desayuno incluido',       'services',       'coffee',           13),
  ('laundry',                 'Lavanderia',              'services',       'washing-machine',  14),
  ('pet_friendly',            'Pet friendly',            'pets',           'paw-print',        15),
  ('garden',                  'Jardin',                  'outdoor',        'flower-2',         16),
  ('terrace',                 'Terraza',                 'outdoor',        'layout-grid',      17),
  ('bbq',                     'Asador / BBQ',            'outdoor',        'flame',            18),
  ('security',                'Seguridad 24h',           'safety',         'shield',           19),
  ('first_aid',               'Botiquin',                'safety',         'briefcase-medical',20),
  ('wheelchair_accessible',   'Accesible silla ruedas',  'accessibility',  'accessibility',    21),
  ('crib',                    'Cuna disponible',         'family',         'baby',             22),
  ('high_chair',              'Trona',                   'family',         'baby',             23),
  ('wifi_outdoor',            'WiFi exterior',           'connectivity',   'wifi',             24),
  ('bonfire_area',            'Zona de fogata',          'outdoor',        'flame',            25),
  ('hammock',                 'Hamaca',                  'outdoor',        'wind',             26),
  ('mountain_view',           'Vista a la montana',      'nature',         'mountain',         27),
  ('lake_view',               'Vista al lago',           'nature',         'waves',            28),
  ('beach_access',            'Acceso a playa',          'nature',         'waves',            29)
ON CONFLICT (code) DO NOTHING
;
