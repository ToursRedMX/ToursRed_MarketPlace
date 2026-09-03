/**
 * Device ID de MercadoPago para Checkout Pro.
 *
 * MercadoPago usa una huella del dispositivo para afinar su evaluacion
 * antifraude y rechazar menos pagos legitimos. El script `security.js` publica
 * el valor en `window.MP_DEVICE_SESSION_ID`, y de ahi viaja al backend, que lo
 * reenvia a MercadoPago en el header `X-meli-session-id` al crear la
 * preferencia.
 *
 * Ojo con lo que este script NO es: no renderiza ningun campo de tarjeta. Es
 * deliberado. El SDK completo (`sdk.mercadopago.com/js/v2`) se retiro del sitio
 * al eliminar el Brick, porque un formulario de tarjeta originado en nuestras
 * paginas comprometia la elegibilidad SAQ A. `security.js` solo recolecta datos
 * del dispositivo, asi que no reintroduce ese problema.
 */

const SECURITY_SCRIPT_SRC = 'https://www.mercadopago.com/v2/security.js';
const POLL_INTERVAL_MS = 100;

declare global {
  interface Window {
    MP_DEVICE_SESSION_ID?: string;
  }
}

/**
 * Inyecta el script una sola vez. Es idempotente: se puede llamar en cada
 * montaje sin duplicar la etiqueta.
 */
export function preloadMpDeviceId(): void {
  if (typeof document === 'undefined') return;
  if (document.querySelector(`script[src="${SECURITY_SCRIPT_SRC}"]`)) return;

  const script = document.createElement('script');
  script.src = SECURITY_SCRIPT_SRC;
  script.setAttribute('view', 'checkout');
  script.async = true;
  document.body.appendChild(script);
}

/**
 * Devuelve el Device ID, esperando a que el script lo publique.
 *
 * Nunca lanza ni bloquea el cobro: si el script no cargo, tarda de mas o el
 * navegador lo bloquea, devuelve null y el pago sigue su curso sin el header.
 * Perder el Device ID cuesta tasa de aprobacion, no la venta.
 */
export async function getMpDeviceId(timeoutMs = 2500): Promise<string | null> {
  if (typeof window === 'undefined') return null;

  preloadMpDeviceId();

  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const deviceId = window.MP_DEVICE_SESSION_ID;
    if (deviceId) return deviceId;
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }

  return null;
}
