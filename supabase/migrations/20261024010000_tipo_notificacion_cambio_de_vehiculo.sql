-- Valor nuevo del enum para avisar a los viajeros que la agencia cambio el vehiculo de su salida.
-- Va en su propio archivo: un valor de enum recien agregado no se puede usar en la misma
-- transaccion, y la migracion siguiente lo escribe desde una funcion.
ALTER TYPE public.notification_type ADD VALUE IF NOT EXISTS 'slot_vehicle_changed';
