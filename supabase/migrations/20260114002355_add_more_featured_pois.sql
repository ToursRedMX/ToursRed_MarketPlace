
-- Insert additional popular POIs
INSERT INTO featured_pois (name, description, category, address, city, state, latitude, longitude, keywords) VALUES
-- Metro Stations
('Metro Deportivo 18 de Marzo', 'Estación del Metro Línea 3', 'metro_station', 'Av. Oceanía, Iztacalco, 08510 Ciudad de México', 'Ciudad de México', 'Ciudad de México', 19.4277, -99.0907, ARRAY['metro', 'deportivo 18 de marzo', '18 de marzo', 'linea 3', 'estacion']),

('Metro Buenavista', 'Estación del Metro Línea B', 'metro_station', 'Eje 1 Norte Mosqueta, Buenavista, Cuauhtémoc, 06350 Ciudad de México', 'Ciudad de México', 'Ciudad de México', 19.4475, -99.1527, ARRAY['metro', 'buenavista', 'linea b', 'estacion', 'tren suburbano']),

('Metro Deportivo Oceanía', 'Estación del Metro Líneas 5 y B', 'metro_station', 'Av. Oceanía, Venustiano Carranza, 15960 Ciudad de México', 'Ciudad de México', 'Ciudad de México', 19.4458, -99.1127, ARRAY['metro', 'oceania', 'deportivo oceania', 'linea 5', 'linea b', 'transferencia']),

('Metro Bosque de Aragón', 'Estación del Metro Línea B', 'metro_station', 'Av. 506, Bosques de Aragón, Gustavo A. Madero, 07580 Ciudad de México', 'Ciudad de México', 'Ciudad de México', 19.5244, -99.0861, ARRAY['metro', 'bosque de aragon', 'bosques', 'linea b']),

('Metro Villa de Cortés', 'Estación del Metro Línea 2', 'metro_station', 'Calz. de Tlalpan, Benito Juárez, 03100 Ciudad de México', 'Ciudad de México', 'Ciudad de México', 19.3574, -99.1578, ARRAY['metro', 'villa de cortes', 'linea 2']),

('Metro Etiopía', 'Estación del Metro Línea 3', 'metro_station', 'Eje 3 Oriente, Benito Juárez, 08010 Ciudad de México', 'Ciudad de México', 'Ciudad de México', 19.3875, -99.1555, ARRAY['metro', 'etiopia', 'linea 3']),

('Metro División del Norte', 'Estación del Metro Línea 3', 'metro_station', 'Eje 3 Oriente, Benito Juárez, 03100 Ciudad de México', 'Ciudad de México', 'Ciudad de México', 19.3632, -99.1595, ARRAY['metro', 'division del norte', 'linea 3']),

('Metro Chabacano', 'Estación del Metro Líneas 2, 8 y 9', 'metro_station', 'Calz. de Tlalpan, Cuauhtémoc, 06090 Ciudad de México', 'Ciudad de México', 'Ciudad de México', 19.4097, -99.1354, ARRAY['metro', 'chabacano', 'linea 2', 'linea 8', 'linea 9', 'transferencia']),

('Metro General Anaya', 'Estación del Metro Línea 2', 'metro_station', 'Calz. de Tlalpan, Benito Juárez, 03340 Ciudad de México', 'Ciudad de México', 'Ciudad de México', 19.3913, -99.1456, ARRAY['metro', 'general anaya', 'linea 2']),

('Metro Santa Martha', 'Estación del Metro Línea A', 'metro_station', 'Av. Guelatao, Iztapalapa, 09510 Ciudad de México', 'Ciudad de México', 'Ciudad de México', 19.3601, -98.9950, ARRAY['metro', 'santa martha', 'linea a', 'terminal']),

('Metro Centro Médico', 'Estación del Metro Líneas 3 y 9', 'metro_station', 'Av. Cuauhtémoc, Benito Juárez, 03020 Ciudad de México', 'Ciudad de México', 'Ciudad de México', 19.4067, -99.1554, ARRAY['metro', 'centro medico', 'linea 3', 'linea 9', 'transferencia']),

-- Bus Terminals and Other Points
('Central de Autobuses de Tepotzotlán', 'Terminal de autobuses', 'bus_terminal', 'Av. del Trabajo, Tepotzotlán, 54600 Estado de México', 'Tepotzotlán', 'Estado de México', 19.7178, -99.2236, ARRAY['central', 'autobuses', 'tepotzotlan', 'terminal']),

('Caseta Chalco', 'Caseta de cobro en autopista', 'toll_booth', 'Autopista México-Puebla, Chalco, 56600 Estado de México', 'Chalco', 'Estado de México', 19.2631, -98.8973, ARRAY['caseta', 'chalco', 'autopista', 'peaje', 'mexico puebla'])

ON CONFLICT DO NOTHING;
