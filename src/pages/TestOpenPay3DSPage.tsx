import { useState, useEffect, useRef, useCallback } from 'react';
import { AlertTriangle, Loader2, CreditCard, ExternalLink, Search, Copy } from 'lucide-react';
import { supabase } from '../lib/supabase';

declare global {
  interface Window {
    OpenPay: any;
  }
}

const SCRIPTS = [
  'https://js.openpay.mx/openpay.v1.min.js',
  'https://js.openpay.mx/openpay-data.v1.min.js',
];

function loadScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`)) {
      resolve();
      return;
    }
    const s = document.createElement('script');
    s.src = src;
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error(`No se pudo cargar ${src}`));
    document.head.appendChild(s);
  });
}

export default function TestOpenPay3DSPage() {
  const [loading, setLoading] = useState(true);
  const [initError, setInitError] = useState<string | null>(null);
  const [merchantId, setMerchantId] = useState<string>('');
  const [publicKey, setPublicKey] = useState<string>('');

  const [holderName, setHolderName] = useState('');
  const [cardNumber, setCardNumber] = useState('');
  const [expMonth, setExpMonth] = useState('');
  const [expYear, setExpYear] = useState('');
  const [cvv, setCvv] = useState('');

  const [tokenizing, setTokenizing] = useState(false);
  const [chargeResult, setChargeResult] = useState<any>(null);
  const [tokenResult, setTokenResult] = useState<any>(null);
  const [errorResult, setErrorResult] = useState<any>(null);
  const [lookupId, setLookupId] = useState('');
  const [lookupResult, setLookupResult] = useState<any>(null);
  const [lookupLoading, setLookupLoading] = useState(false);

  const formRef = useRef<HTMLFormElement>(null);
  const deviceSessionIdRef = useRef<string>('');

  const returnUrl = useCallback(async () => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('result') === 'return') {
      return true;
    }
    return false;
  }, []);

  useEffect(() => {
    (async () => {
      try {
        await Promise.all(SCRIPTS.map(loadScript));

        if (!window.OpenPay) {
          throw new Error('OpenPay SDK no disponible tras cargar los scripts');
        }

        const fnUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/test-openpay-3ds-charge`;
        const fnHeaders = {
          Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`,
          'Content-Type': 'application/json',
        };

        const [merchantRes, settingsRes] = await Promise.all([
          fetch(fnUrl, { method: 'GET', headers: fnHeaders }),
          supabase.from('platform_settings').select('openpay_public_key').maybeSingle(),
        ]);

        if (!merchantRes.ok) {
          const errBody = await merchantRes.json().catch(() => ({}));
          throw new Error(errBody.error || `Error ${merchantRes.status} al obtener merchant_id`);
        }

        const { merchant_id } = await merchantRes.json();
        const pk = settingsRes.data?.openpay_public_key;

        if (!merchant_id) throw new Error('No se recibio merchant_id del servidor');
        if (!pk) throw new Error('No hay OpenPay public key configurada en platform_settings. Configurala en el panel de administracion.');

        setMerchantId(merchant_id);
        setPublicKey(pk);

        window.OpenPay.setId(merchant_id);
        window.OpenPay.setApiKey(pk);
        window.OpenPay.setSandboxMode(true);

        if (formRef.current) {
          const dsid = window.OpenPay.deviceData.setup('openpay-test-form', 'device_session_id');
          deviceSessionIdRef.current = dsid || '';
        }

        const returned = await returnUrl();
        if (returned) {
          // stay on page, user will use the lookup section
        }
      } catch (err: any) {
        setInitError(err.message || 'Error inicializando OpenPay');
      } finally {
        setLoading(false);
      }
    })();
  }, [returnUrl]);

  const handleTokenSuccess = async (response: any) => {
    setTokenResult(response);
    const tokenId = response?.data?.id;
    if (!tokenId) {
      setErrorResult({ error: 'Token creado pero sin id', raw: response });
      setTokenizing(false);
      return;
    }

    const dsid = deviceSessionIdRef.current;

    try {
      const fnUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/test-openpay-3ds-charge`;
      const res = await fetch(fnUrl, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          source_id: tokenId,
          device_session_id: dsid,
          amount: 10,
        }),
      });

      const data = await res.json();
      setChargeResult(data);

      if (!res.ok) {
        setErrorResult(data);
      }
    } catch (err: any) {
      setErrorResult({ error: err.message });
    } finally {
      setTokenizing(false);
    }
  };

  const handleTokenError = (err: any) => {
    setErrorResult(err);
    setTokenizing(false);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setErrorResult(null);
    setChargeResult(null);
    setTokenResult(null);
    setTokenizing(true);

    if (!window.OpenPay || !formRef.current) {
      setErrorResult({ error: 'OpenPay no inicializado' });
      setTokenizing(false);
      return;
    }

    window.OpenPay.token.create({
      card_number: cardNumber.replace(/\s/g, ''),
      holder_name: holderName,
      expiration_year: expYear,
      expiration_month: expMonth,
      cvv2: cvv,
    }, handleTokenSuccess, handleTokenError);
  };

  const handleLookup = async () => {
    if (!lookupId.trim()) return;
    setLookupLoading(true);
    setLookupResult(null);
    try {
      const fnUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/test-openpay-3ds-charge`;
      const res = await fetch(fnUrl, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ charge_id: lookupId.trim() }),
      });
      const data = await res.json();
      setLookupResult(data);
    } catch (err: any) {
      setLookupResult({ error: err.message });
    } finally {
      setLookupLoading(false);
    }
  };

  const threeDSecureUrl = chargeResult?.payment_method?.url;
  const isReturned = new URLSearchParams(window.location.search).get('result') === 'return';

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="w-8 h-8 animate-spin text-orange-500" />
          <p className="text-gray-600 text-sm">Inicializando OpenPay...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 py-8 px-4">
      <div className="max-w-3xl mx-auto">
        {/* Warning banner */}
        <div className="mb-6 rounded-lg border-2 border-red-400 bg-red-50 px-4 py-3 flex items-start gap-3">
          <AlertTriangle className="w-6 h-6 text-red-600 flex-shrink-0 mt-0.5" />
          <div>
            <p className="font-bold text-red-800 text-sm uppercase tracking-wide">
              Pagina temporal de prueba -- No usar en produccion
            </p>
            <p className="text-red-700 text-xs mt-1">
              Esta pagina existe solo para probar la tokenizacion de tarjeta y el flujo 3D Secure de OpenPay.
              No afecta ninguna reserva, pago ni dato real.
            </p>
          </div>
        </div>

        <h1 className="text-2xl font-bold text-gray-900 mb-2">Prueba OpenPay 3D Secure</h1>
        <p className="text-gray-500 text-sm mb-6">
          Inicializa el SDK de OpenPay, tokeniza una tarjeta de prueba y crea un cargo con 3D Secure habilitado.
        </p>

        {initError && (
          <div className="mb-6 rounded-lg bg-red-100 border border-red-300 px-4 py-3">
            <p className="text-red-800 text-sm font-medium">Error de inicializacion</p>
            <p className="text-red-700 text-sm mt-1">{initError}</p>
          </div>
        )}

        {isReturned && (
          <div className="mb-6 rounded-lg bg-blue-100 border border-blue-300 px-4 py-3">
            <p className="text-blue-800 text-sm font-medium">Regresaste de la autenticacion 3DS</p>
            <p className="text-blue-700 text-sm mt-1">
              Si tienes el ID del cargo, usalo abajo para consultar su estado actual.
            </p>
          </div>
        )}

        {/* Config info */}
        <div className="mb-6 rounded-lg bg-white border border-gray-200 px-4 py-3">
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div>
              <span className="text-gray-500">Merchant ID:</span>{' '}
              <code className="text-gray-800 font-mono text-xs">{merchantId || '--'}</code>
            </div>
            <div>
              <span className="text-gray-500">Public Key:</span>{' '}
              <code className="text-gray-800 font-mono text-xs">{publicKey ? `${publicKey.slice(0, 12)}...` : '--'}</code>
            </div>
            <div>
              <span className="text-gray-500">Modo:</span>{' '}
              <span className="text-orange-600 font-medium">Sandbox</span>
            </div>
            <div>
              <span className="text-gray-500">Monto de prueba:</span>{' '}
              <span className="text-gray-800 font-medium">$10.00 MXN</span>
            </div>
          </div>
        </div>

        {/* Card form */}
        <form ref={formRef} id="openpay-test-form" onSubmit={handleSubmit} className="mb-6 rounded-lg bg-white border border-gray-200 p-6 space-y-4">
          <div className="flex items-center gap-2 mb-2">
            <CreditCard className="w-5 h-5 text-orange-500" />
            <h2 className="text-lg font-semibold text-gray-900">Datos de tarjeta de prueba</h2>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Nombre del titular</label>
            <input
              type="text"
              name="holder_name"
              value={holderName}
              onChange={(e) => setHolderName(e.target.value)}
              placeholder="Juan Perez"
              required
              className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:ring-orange-500 focus:border-orange-500"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Numero de tarjeta</label>
            <input
              type="text"
              name="card_number"
              value={cardNumber}
              onChange={(e) => setCardNumber(e.target.value)}
              placeholder="4111111111111111"
              required
              maxLength={19}
              className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:ring-orange-500 focus:border-orange-500 font-mono"
            />
            <p className="text-xs text-gray-400 mt-1">
              Tarjetas de prueba sandbox: 4111111111111111 (Visa), 5555555555554444 (Mastercard)
            </p>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Mes</label>
              <input
                type="text"
                name="expiration_month"
                value={expMonth}
                onChange={(e) => setExpMonth(e.target.value)}
                placeholder="12"
                required
                maxLength={2}
                className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:ring-orange-500 focus:border-orange-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Año</label>
              <input
                type="text"
                name="expiration_year"
                value={expYear}
                onChange={(e) => setExpYear(e.target.value)}
                placeholder="27"
                required
                maxLength={2}
                className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:ring-orange-500 focus:border-orange-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">CVV</label>
              <input
                type="text"
                name="cvv2"
                value={cvv}
                onChange={(e) => setCvv(e.target.value)}
                placeholder="123"
                required
                maxLength={4}
                className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:ring-orange-500 focus:border-orange-500 font-mono"
              />
            </div>
          </div>

          <button
            type="submit"
            disabled={tokenizing || !window.OpenPay}
            className="w-full flex items-center justify-center gap-2 bg-orange-500 hover:bg-orange-600 disabled:bg-gray-300 text-white font-medium py-2.5 px-4 rounded-md transition-colors text-sm"
          >
            {tokenizing ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                Procesando...
              </>
            ) : (
              <>
                <CreditCard className="w-4 h-4" />
                Probar tokenizacion + 3DS
              </>
            )}
          </button>
        </form>

        {/* 3DS redirect button */}
        {threeDSecureUrl && (
          <div className="mb-6 rounded-lg bg-yellow-50 border border-yellow-300 px-4 py-4">
            <p className="text-yellow-800 text-sm font-medium mb-2">Autenticacion 3D Secure requerida</p>
            <p className="text-yellow-700 text-xs mb-3">
              El cargo requiere autenticacion 3D Secure. Haz clic para ir al portal del banco.
              Al terminar, volveras a esta pagina.
            </p>
            <div className="flex items-center gap-2">
              <a
                href={threeDSecureUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 bg-yellow-600 hover:bg-yellow-700 text-white font-medium py-2 px-4 rounded-md text-sm transition-colors"
              >
                <ExternalLink className="w-4 h-4" />
                Ir a autenticacion 3D Secure
              </a>
              <button
                onClick={() => copyToClipboard(threeDSecureUrl)}
                className="inline-flex items-center gap-1 text-yellow-700 hover:text-yellow-900 text-xs"
              >
                <Copy className="w-3 h-3" /> Copiar URL
              </button>
            </div>
            {chargeResult?.id && (
              <p className="text-yellow-700 text-xs mt-2">
                ID del cargo: <code className="font-mono">{chargeResult.id}</code>{' '}
                <button onClick={() => copyToClipboard(chargeResult.id)} className="text-yellow-700 hover:text-yellow-900">
                  <Copy className="w-3 h-3 inline" />
                </button>
              </p>
            )}
          </div>
        )}

        {/* Results */}
        {tokenResult && (
          <div className="mb-4 rounded-lg bg-green-50 border border-green-200 p-4">
            <p className="text-green-800 text-sm font-medium mb-2">Token creado correctamente</p>
            <pre className="text-xs text-green-900 bg-green-100 rounded p-3 overflow-auto max-h-60">
              {JSON.stringify(tokenResult, null, 2)}
            </pre>
          </div>
        )}

        {chargeResult && (
          <div className="mb-4 rounded-lg bg-blue-50 border border-blue-200 p-4">
            <p className="text-blue-800 text-sm font-medium mb-2">Respuesta del cargo</p>
            <pre className="text-xs text-blue-900 bg-blue-100 rounded p-3 overflow-auto max-h-60">
              {JSON.stringify(chargeResult, null, 2)}
            </pre>
          </div>
        )}

        {errorResult && (
          <div className="mb-4 rounded-lg bg-red-50 border border-red-200 p-4">
            <p className="text-red-800 text-sm font-medium mb-2">Error</p>
            <pre className="text-xs text-red-900 bg-red-100 rounded p-3 overflow-auto max-h-60">
              {JSON.stringify(errorResult, null, 2)}
            </pre>
          </div>
        )}

        {/* Charge lookup */}
        <div className="mb-6 rounded-lg bg-white border border-gray-200 p-6">
          <div className="flex items-center gap-2 mb-3">
            <Search className="w-5 h-5 text-gray-500" />
            <h2 className="text-lg font-semibold text-gray-900">Consultar estado de cargo</h2>
          </div>
          <p className="text-xs text-gray-500 mb-3">
            Si regresaste de la autenticacion 3DS, pega el ID del cargo aqui para ver su estado actualizado.
          </p>
          <div className="flex gap-2">
            <input
              type="text"
              value={lookupId}
              onChange={(e) => setLookupId(e.target.value)}
              placeholder="ID del cargo (ej. chg_abc123...)"
              className="flex-1 px-3 py-2 text-sm border border-gray-300 rounded-md focus:ring-orange-500 focus:border-orange-500 font-mono"
            />
            <button
              onClick={handleLookup}
              disabled={lookupLoading || !lookupId.trim()}
              className="flex items-center gap-2 bg-gray-700 hover:bg-gray-800 disabled:bg-gray-300 text-white font-medium py-2 px-4 rounded-md text-sm transition-colors"
            >
              {lookupLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
              Consultar
            </button>
          </div>
          {lookupResult && (
            <pre className="mt-3 text-xs text-gray-800 bg-gray-50 rounded p-3 overflow-auto max-h-60 border border-gray-200">
              {JSON.stringify(lookupResult, null, 2)}
            </pre>
          )}
        </div>
      </div>
    </div>
  );
}