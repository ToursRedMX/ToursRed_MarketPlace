-- Tres mapas de asientos nuevos: Hiace 14, Urvan 13 y autobús de dos pisos (60).
-- Agregar un layout es insertar una fila (ver 20260326224935). Los dos pisos del autobús
-- van apilados en una sola rejilla; vehicle_shape.features dibuja encabezados de piso,
-- escaleras, baños y equipaje (no son asientos y no cuentan en la capacidad).

INSERT INTO vehicle_seat_layouts (type, name, capacity, display_order, seats, vehicle_shape)
VALUES (
  'hiace_14',
  'Toyota Hiace (14 pasajeros)',
  14,
  3,
  '[
    {"number": 1, "row": 0, "col": 3, "side": "right", "type": "normal"},
    {"number": 2, "row": 1, "col": 0, "side": "left", "type": "normal"},
    {"number": 3, "row": 1, "col": 1, "side": "left", "type": "normal"},
    {"number": 4, "row": 1, "col": 2, "side": "right", "type": "normal"},
    {"number": 5, "row": 2, "col": 0, "side": "left", "type": "normal"},
    {"number": 6, "row": 2, "col": 1, "side": "left", "type": "normal"},
    {"number": 7, "row": 2, "col": 3, "side": "right", "type": "normal"},
    {"number": 8, "row": 3, "col": 0, "side": "left", "type": "normal"},
    {"number": 9, "row": 3, "col": 1, "side": "left", "type": "normal"},
    {"number": 10, "row": 3, "col": 3, "side": "right", "type": "normal"},
    {"number": 11, "row": 4, "col": 0, "side": "left", "type": "normal"},
    {"number": 12, "row": 4, "col": 1, "side": "left", "type": "normal"},
    {"number": 13, "row": 4, "col": 2, "side": "right", "type": "normal"},
    {"number": 14, "row": 4, "col": 3, "side": "right", "type": "normal"}
  ]'::jsonb,
  '{
    "totalRows": 5,
    "totalCols": 4,
    "aisleAfterCol": 2,
    "driverRow": 0,
    "driverCol": 0,
    "hasDriver": true,
    "hasBathroom": false,
    "aspectRatio": "tall"
  }'::jsonb
)
ON CONFLICT (type) DO NOTHING;

INSERT INTO vehicle_seat_layouts (type, name, capacity, display_order, seats, vehicle_shape)
VALUES (
  'urvan_13',
  'Nissan Urvan (13 pasajeros)',
  13,
  4,
  '[
    {"number": 1, "row": 0, "col": 3, "side": "right", "type": "normal"},
    {"number": 2, "row": 1, "col": 0, "side": "left", "type": "normal"},
    {"number": 3, "row": 1, "col": 1, "side": "left", "type": "normal"},
    {"number": 4, "row": 2, "col": 0, "side": "left", "type": "normal"},
    {"number": 5, "row": 2, "col": 1, "side": "left", "type": "normal"},
    {"number": 6, "row": 2, "col": 3, "side": "right", "type": "normal"},
    {"number": 7, "row": 3, "col": 0, "side": "left", "type": "normal"},
    {"number": 8, "row": 3, "col": 1, "side": "left", "type": "normal"},
    {"number": 9, "row": 3, "col": 3, "side": "right", "type": "normal"},
    {"number": 10, "row": 4, "col": 0, "side": "left", "type": "normal"},
    {"number": 11, "row": 4, "col": 1, "side": "left", "type": "normal"},
    {"number": 12, "row": 4, "col": 2, "side": "right", "type": "normal"},
    {"number": 13, "row": 4, "col": 3, "side": "right", "type": "normal"}
  ]'::jsonb,
  '{
    "totalRows": 5,
    "totalCols": 4,
    "aisleAfterCol": 2,
    "driverRow": 0,
    "driverCol": 0,
    "hasDriver": true,
    "hasBathroom": false,
    "aspectRatio": "tall"
  }'::jsonb
)
ON CONFLICT (type) DO NOTHING;

INSERT INTO vehicle_seat_layouts (type, name, capacity, display_order, seats, vehicle_shape)
VALUES (
  'bus_60_2pisos',
  'Autobús 2 pisos (60 pasajeros)',
  60,
  5,
  '[
    {"number": 1, "row": 1, "col": 0, "side": "left", "type": "normal"},
    {"number": 2, "row": 1, "col": 1, "side": "left", "type": "normal"},
    {"number": 4, "row": 1, "col": 2, "side": "right", "type": "normal"},
    {"number": 3, "row": 1, "col": 3, "side": "right", "type": "normal"},
    {"number": 5, "row": 2, "col": 0, "side": "left", "type": "normal"},
    {"number": 6, "row": 2, "col": 1, "side": "left", "type": "normal"},
    {"number": 7, "row": 3, "col": 0, "side": "left", "type": "normal"},
    {"number": 8, "row": 3, "col": 1, "side": "left", "type": "normal"},
    {"number": 9, "row": 4, "col": 0, "side": "left", "type": "normal"},
    {"number": 10, "row": 4, "col": 1, "side": "left", "type": "normal"},
    {"number": 12, "row": 4, "col": 2, "side": "right", "type": "normal"},
    {"number": 11, "row": 4, "col": 3, "side": "right", "type": "normal"},
    {"number": 13, "row": 5, "col": 0, "side": "left", "type": "normal"},
    {"number": 14, "row": 5, "col": 1, "side": "left", "type": "normal"},
    {"number": 16, "row": 5, "col": 2, "side": "right", "type": "normal"},
    {"number": 15, "row": 5, "col": 3, "side": "right", "type": "normal"},
    {"number": 17, "row": 6, "col": 0, "side": "left", "type": "normal"},
    {"number": 18, "row": 6, "col": 1, "side": "left", "type": "normal"},
    {"number": 20, "row": 6, "col": 2, "side": "right", "type": "normal"},
    {"number": 19, "row": 6, "col": 3, "side": "right", "type": "normal"},
    {"number": 21, "row": 7, "col": 0, "side": "left", "type": "normal"},
    {"number": 22, "row": 7, "col": 1, "side": "left", "type": "normal"},
    {"number": 24, "row": 7, "col": 2, "side": "right", "type": "normal"},
    {"number": 23, "row": 7, "col": 3, "side": "right", "type": "normal"},
    {"number": 25, "row": 8, "col": 0, "side": "left", "type": "normal"},
    {"number": 26, "row": 8, "col": 1, "side": "left", "type": "normal"},
    {"number": 28, "row": 8, "col": 2, "side": "right", "type": "normal"},
    {"number": 27, "row": 8, "col": 3, "side": "right", "type": "normal"},
    {"number": 29, "row": 9, "col": 0, "side": "left", "type": "normal"},
    {"number": 30, "row": 9, "col": 1, "side": "left", "type": "normal"},
    {"number": 32, "row": 9, "col": 2, "side": "right", "type": "normal"},
    {"number": 31, "row": 9, "col": 3, "side": "right", "type": "normal"},
    {"number": 33, "row": 10, "col": 0, "side": "left", "type": "normal"},
    {"number": 34, "row": 10, "col": 1, "side": "left", "type": "normal"},
    {"number": 36, "row": 10, "col": 2, "side": "right", "type": "normal"},
    {"number": 35, "row": 10, "col": 3, "side": "right", "type": "normal"},
    {"number": 37, "row": 11, "col": 0, "side": "left", "type": "normal"},
    {"number": 38, "row": 11, "col": 1, "side": "left", "type": "normal"},
    {"number": 40, "row": 11, "col": 2, "side": "right", "type": "normal"},
    {"number": 39, "row": 11, "col": 3, "side": "right", "type": "normal"},
    {"number": 41, "row": 12, "col": 0, "side": "left", "type": "normal"},
    {"number": 42, "row": 12, "col": 1, "side": "left", "type": "normal"},
    {"number": 44, "row": 12, "col": 2, "side": "right", "type": "normal"},
    {"number": 43, "row": 12, "col": 3, "side": "right", "type": "normal"},
    {"number": 45, "row": 15, "col": 0, "side": "left", "type": "normal"},
    {"number": 46, "row": 15, "col": 1, "side": "left", "type": "normal"},
    {"number": 48, "row": 15, "col": 2, "side": "right", "type": "normal"},
    {"number": 47, "row": 15, "col": 3, "side": "right", "type": "normal"},
    {"number": 49, "row": 16, "col": 0, "side": "left", "type": "normal"},
    {"number": 50, "row": 16, "col": 1, "side": "left", "type": "normal"},
    {"number": 52, "row": 16, "col": 2, "side": "right", "type": "normal"},
    {"number": 51, "row": 16, "col": 3, "side": "right", "type": "normal"},
    {"number": 53, "row": 17, "col": 0, "side": "left", "type": "normal"},
    {"number": 54, "row": 17, "col": 1, "side": "left", "type": "normal"},
    {"number": 56, "row": 17, "col": 2, "side": "right", "type": "normal"},
    {"number": 55, "row": 17, "col": 3, "side": "right", "type": "normal"},
    {"number": 57, "row": 18, "col": 0, "side": "left", "type": "normal"},
    {"number": 58, "row": 18, "col": 1, "side": "left", "type": "normal"},
    {"number": 60, "row": 18, "col": 2, "side": "right", "type": "normal"},
    {"number": 59, "row": 18, "col": 3, "side": "right", "type": "normal"}
  ]'::jsonb,
  '{
    "totalRows": 21,
    "totalCols": 4,
    "aisleAfterCol": 1,
    "driverRow": -1,
    "driverCol": -1,
    "hasDriver": false,
    "hasBathroom": false,
    "aspectRatio": "tall",
    "features": [
      {"kind": "floor",  "label": "2.º piso", "row": 0,  "col": 0, "colSpan": 4},
      {"kind": "stairs", "label": "Gradas",   "row": 2,  "col": 2, "colSpan": 2, "rowSpan": 2},
      {"kind": "floor",  "label": "1.er piso","row": 13, "col": 0, "colSpan": 4},
      {"kind": "wc",     "label": "Baños",    "row": 14, "col": 0, "colSpan": 2},
      {"kind": "stairs", "label": "Gradas",   "row": 14, "col": 2, "colSpan": 2},
      {"kind": "luggage","label": "Equipaje", "row": 19, "col": 0, "colSpan": 4, "rowSpan": 2}
    ]
  }'::jsonb
)
ON CONFLICT (type) DO NOTHING;
