-- Valor del enum para avisar a los viajeros que la agencia cambio el vehiculo de su salida.
-- Va en su propio archivo: un valor de enum recien agregado no se puede usar en la misma transaccion, y la migracion siguiente
-- (20261031052359) lo escribe desde una funcion. En produccion el valor ya existe (aplicado a mano desde el PR #472): IF NOT EXISTS lo deja igual.
ALTER TYPE public.notification_type ADD VALUE IF NOT EXISTS 'slot_vehicle_changed';
