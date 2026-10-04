-- send-payment-plan-reminder inserta notificaciones con
-- notification_type = 'payment_plan_final_deadline_warning' (el aviso de
-- ultima oportunidad, 16 dias antes del tour, disparado por
-- process-payment-plan-tour-deadline) pero ese valor nunca existio en el
-- enum. El insert fallaba en silencio -- el codigo no revisa el `.error` de
-- ese insert -- y la notificacion in-app nunca se guardaba, aunque el correo
-- si salia por una via aparte. Encontrado el 03-oct-2026 al tipar
-- send-payment-plan-reminder (PR #330) y confirmar contra el catalogo real
-- del enum.
ALTER TYPE public.notification_type
  ADD VALUE IF NOT EXISTS 'payment_plan_final_deadline_warning';
