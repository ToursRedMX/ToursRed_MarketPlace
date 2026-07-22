
-- Eliminar el constraint existente
ALTER TABLE booking_travelers 
DROP CONSTRAINT IF EXISTS booking_travelers_categoria_viajero_check;

-- Crear nuevo constraint con 'mascota' incluida
ALTER TABLE booking_travelers 
ADD CONSTRAINT booking_travelers_categoria_viajero_check 
CHECK (categoria_viajero = ANY (ARRAY['infante'::text, 'nino'::text, 'adulto'::text, 'adulto_mayor'::text, 'mascota'::text]));
