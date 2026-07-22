import { useState, useEffect } from 'react';
import { useNavigate, useSearchParams, Link } from 'react-router-dom';
import { Gift, Check, AlertCircle, Wallet } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import { formatCurrencyMXN } from '../utils/formatCurrency';

export default function GiftCardRedeemPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const [code, setCode] = useState(searchParams.get('code') || '');
  const [isValidating, setIsValidating] = useState(false);
  const [isRedeeming, setIsRedeeming] = useState(false);
  const [validationResult, setValidationResult] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [redemptionData, setRedemptionData] = useState<any>(null);

  useEffect(() => {
    if (searchParams.get('code')) {
      handleValidate();
    }
  }, []);

  const formatCodeInput = (value: string) => {
    const cleaned = value.toUpperCase().replace(/[^A-Z0-9]/g, '');
    const chunks = [];
    for (let i = 0; i < cleaned.length && i < 16; i += 4) {
      chunks.push(cleaned.slice(i, i + 4));
    }
    return chunks.join('-');
  };

  const handleCodeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const formatted = formatCodeInput(e.target.value);
    setCode(formatted);
    setValidationResult(null);
    setError(null);
  };

  const handleValidate = async () => {
    if (!code || code.replace(/-/g, '').length !== 16) {
      setError('Por favor ingresa un código válido de 16 caracteres');
      return;
    }

    setError(null);
    setIsValidating(true);

    try {
      const { data, error: functionError } = await supabase.functions.invoke('redeem-gift-card', {
        body: {
          code: code,
          action: 'validate',
        },
      });

      if (functionError) throw functionError;

      if (data?.valid) {
        setValidationResult(data);
      } else {
        setError(data?.error || 'Código inválido');
      }
    } catch (err: any) {
      console.error('Error validating gift card:', err);
      setError(err.message || 'Error al validar el código');
    } finally {
      setIsValidating(false);
    }
  };

  const handleRedeem = async () => {
    if (!user) {
      sessionStorage.setItem('giftCardCode', code);
      navigate('/signup');
      return;
    }

    setError(null);
    setIsRedeeming(true);

    try {
      const session = await supabase.auth.getSession();
      const token = session.data.session?.access_token;

      const { data, error: functionError } = await supabase.functions.invoke('redeem-gift-card', {
        body: {
          code: code,
          action: 'redeem',
        },
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (functionError) throw functionError;

      if (data?.success) {
        setSuccess(true);
        setRedemptionData(data);
      } else {
        setError(data?.error || 'Error al canjear la tarjeta');
      }
    } catch (err: any) {
      console.error('Error redeeming gift card:', err);
      setError(err.message || 'Error al canjear la tarjeta');
    } finally {
      setIsRedeeming(false);
    }
  };

  if (success && redemptionData) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-green-50 via-emerald-50 to-teal-50 py-12 px-4">
        <div className="max-w-2xl mx-auto">
          <div className="bg-white rounded-2xl shadow-xl overflow-hidden">
            <div className="bg-gradient-to-r from-green-500 to-emerald-600 px-8 py-12 text-center">
              <div className="inline-flex items-center justify-center w-20 h-20 bg-white rounded-full mb-6">
                <Check className="w-12 h-12 text-green-600" />
              </div>
              <h1 className="text-3xl font-bold text-white mb-2">
                ¡Tarjeta Canjeada Exitosamente!
              </h1>
              <p className="text-green-100 text-lg">
                Tu saldo ha sido actualizado
              </p>
            </div>

            <div className="p-8">
              <div className="bg-gradient-to-br from-amber-50 to-orange-50 rounded-xl p-6 mb-6">
                <div className="flex items-center justify-between mb-4">
                  <span className="text-gray-700 font-medium">Monto Agregado:</span>
                  <span className="text-3xl font-bold text-amber-600">
                    {formatCurrencyMXN(redemptionData.amount)} MXN
                  </span>
                </div>
                <div className="flex items-center justify-between pt-4 border-t border-amber-200">
                  <span className="text-gray-700 font-medium">Nuevo Saldo:</span>
                  <span className="text-2xl font-bold text-gray-900">
                    {formatCurrencyMXN(redemptionData.newBalance)} MXN
                  </span>
                </div>
              </div>

              <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-6">
                <div className="flex items-start space-x-3">
                  <Wallet className="w-5 h-5 text-blue-600 mt-0.5 flex-shrink-0" />
                  <div>
                    <p className="text-sm text-blue-900 font-medium mb-1">
                      ¿Qué puedes hacer ahora?
                    </p>
                    <p className="text-sm text-blue-800">
                      Tu saldo ToursRed Cash está listo para usarse en tu próxima reserva. Se aplicará automáticamente al momento de pagar.
                    </p>
                  </div>
                </div>
              </div>

              <div className="flex flex-col sm:flex-row gap-3">
                <Link
                  to="/tours"
                  className="flex-1 bg-gradient-to-r from-amber-500 to-orange-600 text-white py-3 rounded-lg font-semibold hover:from-amber-600 hover:to-orange-700 transition-all text-center"
                >
                  Explorar Tours
                </Link>
                <Link
                  to="/traveler/wallet"
                  className="flex-1 bg-white text-amber-600 py-3 rounded-lg font-semibold border-2 border-amber-200 hover:bg-amber-50 transition-all text-center"
                >
                  Ver Mi Monedero
                </Link>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-amber-50 via-orange-50 to-yellow-50 py-12 px-4">
      <div className="max-w-2xl mx-auto">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-20 h-20 bg-gradient-to-br from-amber-500 to-orange-600 rounded-full mb-6">
            <Gift className="w-10 h-10 text-white" />
          </div>
          <h1 className="text-4xl font-bold text-gray-900 mb-4">
            Canjear Tarjeta de Regalo
          </h1>
          <p className="text-lg text-gray-600">
            Ingresa tu código de tarjeta de regalo para agregar saldo a tu cuenta
          </p>
        </div>

        <div className="bg-white rounded-2xl shadow-xl overflow-hidden">
          <div className="p-8">
            {error && (
              <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-lg flex items-start space-x-3">
                <AlertCircle className="w-5 h-5 text-red-600 mt-0.5 flex-shrink-0" />
                <p className="text-red-800">{error}</p>
              </div>
            )}

            <div className="mb-6">
              <label className="block text-sm font-semibold text-gray-700 mb-3">
                Código de Tarjeta de Regalo
              </label>
              <input
                type="text"
                value={code}
                onChange={handleCodeChange}
                placeholder="XXXX-XXXX-XXXX-XXXX"
                maxLength={19}
                className="w-full px-4 py-4 text-2xl font-mono text-center border-2 border-gray-300 rounded-lg focus:ring-2 focus:ring-amber-500 focus:border-transparent tracking-widest"
              />
              <p className="text-xs text-gray-500 text-center mt-2">
                Ingresa el código de 16 caracteres de tu tarjeta de regalo
              </p>
            </div>

            {!validationResult && (
              <button
                onClick={handleValidate}
                disabled={isValidating || code.replace(/-/g, '').length !== 16}
                className="w-full bg-gradient-to-r from-amber-500 to-orange-600 text-white py-4 rounded-xl font-bold text-lg hover:from-amber-600 hover:to-orange-700 transition-all shadow-lg hover:shadow-xl disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center space-x-2"
              >
                {isValidating ? (
                  <>
                    <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    <span>Validando...</span>
                  </>
                ) : (
                  <span>Validar Código</span>
                )}
              </button>
            )}

            {validationResult && (
              <div className="space-y-4">
                <div className="bg-green-50 border border-green-200 rounded-lg p-6">
                  <div className="flex items-center space-x-3 mb-4">
                    <Check className="w-6 h-6 text-green-600" />
                    <p className="font-semibold text-green-900">¡Código Válido!</p>
                  </div>
                  <div className="space-y-2">
                    <div className="flex justify-between">
                      <span className="text-gray-700">Monto:</span>
                      <span className="font-bold text-2xl text-green-700">
                        {formatCurrencyMXN(validationResult.amount)} {validationResult.currency}
                      </span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-gray-600">Válida hasta:</span>
                      <span className="text-gray-900">
                        {new Date(validationResult.expiresAt).toLocaleDateString('es-MX', {
                          year: 'numeric',
                          month: 'long',
                          day: 'numeric',
                        })}
                      </span>
                    </div>
                  </div>
                </div>

                {!user && (
                  <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                    <p className="text-sm text-blue-900 mb-3">
                      <strong>Nota:</strong> Necesitas crear una cuenta o iniciar sesión para canjear esta tarjeta de regalo.
                    </p>
                    <p className="text-xs text-blue-800">
                      Tu código quedará guardado y podrás canjearlo automáticamente después de registrarte.
                    </p>
                  </div>
                )}

                <button
                  onClick={handleRedeem}
                  disabled={isRedeeming}
                  className="w-full bg-gradient-to-r from-green-500 to-emerald-600 text-white py-4 rounded-xl font-bold text-lg hover:from-green-600 hover:to-emerald-700 transition-all shadow-lg hover:shadow-xl disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center space-x-2"
                >
                  {isRedeeming ? (
                    <>
                      <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                      <span>Canjeando...</span>
                    </>
                  ) : user ? (
                    <>
                      <Gift className="w-6 h-6" />
                      <span>Canjear Ahora</span>
                    </>
                  ) : (
                    <span>Crear Cuenta y Canjear</span>
                  )}
                </button>

                <button
                  onClick={() => {
                    setValidationResult(null);
                    setCode('');
                  }}
                  className="w-full text-gray-600 hover:text-gray-900 py-2 text-sm font-medium"
                >
                  Ingresar otro código
                </button>
              </div>
            )}
          </div>
        </div>

        <div className="mt-8 text-center">
          <p className="text-sm text-gray-600 mb-2">¿No tienes una tarjeta de regalo?</p>
          <Link
            to="/gift-cards"
            className="text-amber-600 hover:text-amber-700 font-semibold"
          >
            Compra una aquí
          </Link>
        </div>
      </div>
    </div>
  );
}
