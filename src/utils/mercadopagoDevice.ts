import { supabase } from '../lib/supabase';

/**
 * Device ID de MercadoPago para Checkout Pro.
 *
 * MercadoPago usa una huella del dispositivo para afinar su evaluacion
 * antifraude y rechazar menos pagos legitimos. El valor viaja al backend, que
 * lo reenvia a MercadoPago en el header `X-meli-session-id` al crear la
 * preferencia.
 *
 * Se cargan dos cosas, y el orden importa:
 *
 * 1. `sdk.mercadopago.com/js/v2` (MercadoPago.js V2), instanciado sin renderizar
 *    nada. Su checklist de calidad lo pide explicitamente (`web_front_end_sdk`),
 *    y es requisito de la homologacion que habilita credenciales de produccion.
 *    Su documentacion afirma que teniendo el SDK el Device ID "se obtiene por
 *    defecto", pero NO documenta en que variable queda: en las paginas del SDK
 *    no aparece `MP_DEVICE_SESSION_ID` ni equivalente (verificado 03-sep-2026).
 *
 * 2. `security.js` como red de respaldo, solo si el SDK no publico el valor.
 *    Ese script si documenta que lo deja en `window.MP_DEVICE_SESSION_ID`.
 *
 * Ninguno de los dos renderiza campos de tarjeta. Es deliberado: el Brick se
 * elimino porque un formulario de tarjeta originado en nuestras paginas
 * comprometia la elegibilidad SAQ A. Cargar el SDK sin montar un Brick no
 * reintroduce ese problema — no hay donde escribir un numero de tarjeta.
 */

const SDK_SRC = 'https://sdk.mercadopago.com/js/v2';
const SECURITY_SRC = 'https://www.mercadopago.com/v2/security.js';
const POLL_INTERVAL_MS = 100;
const SDK_BUDGET_MS = 1500;

declare global {
  interface Window {
    MP_DEVICE_SESSION_ID?: string;
    MercadoPago?: new (publicKey: string, options?: { locale?: string }) => unknown;
  }
}

let sdkLoad: Promise<void> | null = null;
let sdkInit: Promise<void> | null = null;

/** Inyecta un script una sola vez. Nunca rechaza: un fallo de red no debe tumbar un cobro. */
function injectOnce(src: string, attrs: Record<string, string> = {}): Promise<void> {
  return new Promise((resolve) => {
    if (typeof document === 'undefined') {
      resolve();
      return;
    }
    if (document.querySelector(`script[src="${src}"]`)) {
      resolve();
      return;
    }

    const script = document.createElement('script');
    script.src = src;
    script.async = true;
    for (const [key, value] of Object.entries(attrs)) script.setAttribute(key, value);
    script.onload = () => resolve();
    script.onerror = () => resolve();
    document.body.appendChild(script);
  });
}

/** Carga MercadoPago.js V2 y lo instancia con la public key de la plataforma. */
function initSdk(): Promise<void> {
  if (sdkInit) return sdkInit;

  sdkInit = (async () => {
    if (!sdkLoad) sdkLoad = injectOnce(SDK_SRC);
    await sdkLoad;

    if (typeof window === 'undefined' || !window.MercadoPago) return;

    const { data } = await supabase
      .from('platform_settings')
      .select('mercadopago_public_key')
      .maybeSingle();

    const publicKey = data?.mercadopago_public_key;
    if (!publicKey) return;

    try {
      // Instanciar basta: no se renderiza ningun Brick ni formulario.
      new window.MercadoPago(publicKey, { locale: 'es-MX' });
    } catch {
      // Sin Device ID se cobra igual; no vale la pena romper el flujo.
    }
  })();

  return sdkInit;
}

function pollDeviceId(deadline: number): Promise<string | null> {
  return new Promise((resolve) => {
    const tick = () => {
      const deviceId = window.MP_DEVICE_SESSION_ID;
      if (deviceId) {
        resolve(deviceId);
        return;
      }
      if (Date.now() >= deadline) {
        resolve(null);
        return;
      }
      setTimeout(tick, POLL_INTERVAL_MS);
    };
    tick();
  });
}

/**
 * Adelanta la carga del SDK. Llamarlo al montar una pagina de pago hace que el
 * Device ID ya este listo cuando el usuario apriete el boton.
 */
export function preloadMpDeviceId(): void {
  if (typeof window === 'undefined') return;
  void initSdk();
}

/**
 * Devuelve el Device ID, o null si no se pudo obtener.
 *
 * Nunca lanza ni bloquea el cobro: si los scripts no cargan, tardan de mas o el
 * navegador los bloquea, devuelve null y el pago sigue sin el header. Perder el
 * Device ID cuesta tasa de aprobacion, no la venta.
 */
export async function getMpDeviceId(timeoutMs = 3000): Promise<string | null> {
  if (typeof window === 'undefined') return null;

  const deadline = Date.now() + timeoutMs;

  await initSdk();
  const fromSdk = await pollDeviceId(Math.min(deadline, Date.now() + SDK_BUDGET_MS));
  if (fromSdk) return fromSdk;

  // El SDK no lo publico: caemos al script que si lo documenta.
  await injectOnce(SECURITY_SRC, { view: 'checkout' });
  return pollDeviceId(deadline);
}
