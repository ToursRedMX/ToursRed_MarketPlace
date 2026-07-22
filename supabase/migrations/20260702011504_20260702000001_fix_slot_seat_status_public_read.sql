-- La politica SELECT de slot_seat_status estaba restringida a agencias y admins,
-- impidiendo que viajeros vean asientos bloqueados/reservados al seleccionar asientos.
-- Se reemplaza por una politica abierta a todos los usuarios autenticados (sin filtro de propietario)
-- ya que la disponibilidad de asientos no es informacion sensible.

DROP POLICY IF EXISTS "Agencies can view their tour seat status" ON slot_seat_status;

CREATE POLICY "Authenticated users can view seat status for booking"
  ON slot_seat_status
  FOR SELECT
  TO authenticated
  USING (true);
