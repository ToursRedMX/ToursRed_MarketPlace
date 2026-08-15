-- Campos para traslados privados
-- transfer_pricing_mode: cómo se cobra el traslado privado ('per_person' o 'per_vehicle')
-- private_vehicle_capacity: capacidad máxima del vehículo para traslados privados

ALTER TABLE tours
  ADD COLUMN IF NOT EXISTS transfer_pricing_mode text DEFAULT 'per_person'
    CHECK (transfer_pricing_mode IN ('per_person', 'per_vehicle')),
  ADD COLUMN IF NOT EXISTS private_vehicle_capacity integer;
