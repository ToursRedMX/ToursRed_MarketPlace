import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Gift, Check, CreditCard, Tag, X } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useFormPersistence } from '../hooks/useFormPersistence';
import { usePreventUnload } from '../hooks/usePreventUnload';
import { useAuth } from '../context/AuthContext';
import { formatCurrencyMXN } from '../utils/formatCurrency';
import Seo from '../components/Seo';
import PaymentProviderSelector, { PaymentProvider } from '../components/PaymentProviderSelector';
import MercadoPagoBrick from '../components/MercadoPagoBrick';

const GIFT_CARD_AMOUNTS = [100, 200, 500, 1000];

export default function GiftCardsPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [selectedAmount, setSelectedAmount] = useState<number>(500);
  const [purchaserName, setPurchaserName] = useState('');
  const [purchaserEmail, setPurchaserEmail] = useState('');
  const [isGift, setIsGift] = useState(false);
  const [recipientName, setRecipientName] = useState('');
  const [recipientEmail, setRecipientEmail] = useState('');
  const [personalMessage, setPersonalMessage] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [paymentProvider, setPaymentProvider] = useState<PaymentProvider>('stripe');

  const [discountCode, setDiscountCode] = useState('');
  const [isValidatingCode, setIsValidatingCode] = useState(false);
  const [appliedDiscount, setAppliedDiscount] = useState<{
    code: string;
    discount_type: string;
    discount_value: number;
    discountAmount: number;
  } | null>(null);
  const [codeError, setCodeError] = useState<string | null>(null);
  const [mpBrick, setMpBrick] = useState<{ preferenceId: string; publicKey: string; giftCardId: string; amount: number } | null>(null);

  const giftCardFormPersistence = useFormPersistence(
    { purchaserName, purchaserEmail, recipientName, recipientEmail, personalMessage, selectedAmount },
    { key: 'gift_card_purchase', expirationHours: 24 }
  );

  usePreventUnload(
    !isProcessing && (
      purchaserName.length > 0 ||
      purchaserEmail.length > 0 ||
      recipientName.length > 0 ||
      recipientEmail.length > 0 ||
      personalMessage.length > 0
    )
  );

  useEffect(() => {
    const loadInitialData = async () => {
      if (user) {
        const { data: userData, error } = await supabase
          .from('users')
          .select('first_name, last_name, email')
          .eq('id', user.id)
          .single();

        if (userData && !error) {
          const fullName = [userData.first_name, userData.last_name].filter(Boolean).join(' ');
          if (fullName) setPurchaserName(fullName);
          if (userData.email) setPurchaserEmail(userData.email);
        }
      }

      const savedData = giftCardFormPersistence.loadFromStorage();
      if (savedData) {
        giftCardFormPersistence.setIsRestoring(true);
        if (savedData.recipientName) setRecipientName(savedData.recipientName);
        if (savedData.recipientEmail) setRecipientEmail(savedData.recipientEmail);
        if (savedData.personalMessage) setPersonalMessage(savedData.personalMessage);
        if (savedData.selectedAmount) setSelectedAmount(savedData.selectedAmount);
        setTimeout(() => giftCardFormPersistence.setIsRestoring(false), 100);
      }
    };

    loadInitialData();
  }, [user]);

  const validateDiscountCode = async () => {
    if (!user) {
      setCodeError('Debes iniciar sesión para usar códigos de descuento');
      return;
    }

    if (!discountCode.trim()) {
      setCodeError('Por favor ingresa un código');
      return;
    }

    setIsValidatingCode(true);
    setCodeError(null);

    try {
      const { data, error } = await supabase.rpc('validate_discount_code', {
        p_code: discountCode.trim().toUpperCase(),
        p_user_id: user.id,
        p_applicable_to: 'gift_cards'
      });

      if (error) throw error;

      if (!data || data.error) {
        setCodeError(data?.error || 'Código inválido');
        setIsValidatingCode(false);
        return;
      }

      let discountAmount = 0;
      if (data.discount_type === 'gift_card_percentage') {
        discountAmount = (selectedAmount * data.discount_value) / 100;
      } else if (data.discount_type === 'gift_card_fixed') {
        discountAmount = Math.min(data.discount_value, selectedAmount);
      }

      setAppliedDiscount({
        code: discountCode.trim().toUpperCase(),
        discount_type: data.discount_type,
        discount_value: data.discount_value,
        discountAmount: Math.round(discountAmount * 100) / 100
      });
      setDiscountCode('');
      setCodeError(null);
    } catch (err: any) {
      console.error('Error validating discount code:', err);
      setCodeError('Error al validar el código');
    } finally {
      setIsValidatingCode(false);
    }
  };

  const removeDiscountCode = () => {
    setAppliedDiscount(null);
    setCodeError(null);
  };

  useEffect(() => {
    if (appliedDiscount) {
      let newDiscountAmount = 0;
      if (appliedDiscount.discount_type === 'gift_card_percentage') {
        newDiscountAmount = (selectedAmount * appliedDiscount.discount_value) / 100;
      } else if (appliedDiscount.discount_type === 'gift_card_fixed') {
        newDiscountAmount = Math.min(appliedDiscount.discount_value, selectedAmount);
      }

      setAppliedDiscount({
        ...appliedDiscount,
        discountAmount: Math.round(newDiscountAmount * 100) / 100
      });
    }
  }, [selectedAmount]);

  const calculateFinalAmount = () => {
    if (!appliedDiscount) return selectedAmount;
    return Math.max(0, selectedAmount - appliedDiscount.discountAmount);
  };

  const handlePurchase = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setIsProcessing(true);

    const timeoutId = setTimeout(() => {
      console.error('Request timeout after 30 seconds');
      setError('La solicitud está tomando demasiado tiempo. Por favor intenta nuevamente.');
      setIsProcessing(false);
    }, 30000);

    try {
      const finalAmount = calculateFinalAmount();

      if (paymentProvider === 'mercadopago' && finalAmount > 0) {
        const { data: gcData, error: gcError } = await supabase.functions.invoke('purchase-gift-card', {
          body: {
            amount: selectedAmount,
            purchaserEmail,
            purchaserName,
            recipientEmail: isGift ? recipientEmail : undefined,
            recipientName: isGift ? recipientName : undefined,
            personalMessage: isGift && personalMessage ? personalMessage : undefined,
            discountCode: appliedDiscount?.code,
            provider: 'mercadopago',
            createOnly: true,
          },
        });

        clearTimeout(timeoutId);
        if (gcError || !gcData) throw new Error(gcError?.message || 'Error al crear tarjeta de regalo');
        if (gcData.error) throw new Error(gcData.error);

        const giftCardId = gcData.giftCardId;
        if (!giftCardId) throw new Error('No se recibio ID de tarjeta de regalo');

        const session = (await supabase.auth.getSession()).data.session;
        const mpResponse = await fetch(
          `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/create-mercadopago-preference`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${session?.access_token || import.meta.env.VITE_SUPABASE_ANON_KEY}`,
            },
            body: JSON.stringify({
              bookingId: giftCardId,
              customerEmail: purchaserEmail,
              amount: finalAmount,
              description: `Tarjeta de Regalo ToursRed $${finalAmount} MXN`,
              context: 'gift_card',
            }),
          }
        );

        const mpResult = await mpResponse.json();
        if (!mpResult.success) throw new Error(mpResult.error || 'Error al crear preferencia de MercadoPago');
        giftCardFormPersistence.clearStorage();
        if (mpResult.preference_id && mpResult.public_key) {
          setMpBrick({ preferenceId: mpResult.preference_id, publicKey: mpResult.public_key, giftCardId, amount: finalAmount });
          setIsProcessing(false);
        } else if (mpResult.url) {
          window.location.href = mpResult.url;
        } else {
          throw new Error('No se recibió la información de MercadoPago');
        }
        return;
      }

      if (paymentProvider === 'paypal' && finalAmount > 0) {
        const { data: gcData, error: gcError } = await supabase.functions.invoke('purchase-gift-card', {
          body: {
            amount: selectedAmount,
            purchaserEmail,
            purchaserName,
            recipientEmail: isGift ? recipientEmail : undefined,
            recipientName: isGift ? recipientName : undefined,
            personalMessage: isGift && personalMessage ? personalMessage : undefined,
            discountCode: appliedDiscount?.code,
            provider: 'paypal',
            createOnly: true,
          },
        });

        clearTimeout(timeoutId);
        if (gcError || !gcData) throw new Error(gcError?.message || 'Error al crear tarjeta de regalo');
        if (gcData.error) throw new Error(gcData.error);

        const giftCardId = gcData.giftCardId;
        if (!giftCardId) throw new Error('No se recibio ID de tarjeta de regalo');

        const session = (await supabase.auth.getSession()).data.session;
        const ppResponse = await fetch(
          `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/create-paypal-order`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${session?.access_token || import.meta.env.VITE_SUPABASE_ANON_KEY}`,
            },
            body: JSON.stringify({
              bookingId: giftCardId,
              amount: finalAmount,
              description: `Tarjeta de Regalo ToursRed $${finalAmount} MXN`,
              context: 'gift_card',
            }),
          }
        );

        const ppResult = await ppResponse.json();
        if (!ppResult.success) throw new Error(ppResult.error || 'Error al crear orden de PayPal');
        giftCardFormPersistence.clearStorage();
        window.location.href = ppResult.url;
        return;
      }

      console.log('Sending purchase request...');
      const { data, error: functionError } = await supabase.functions.invoke('purchase-gift-card', {
        body: {
          amount: selectedAmount,
          purchaserEmail,
          purchaserName,
          recipientEmail: isGift ? recipientEmail : undefined,
          recipientName: isGift ? recipientName : undefined,
          personalMessage: isGift && personalMessage ? personalMessage : undefined,
          discountCode: appliedDiscount?.code,
        },
      });

      clearTimeout(timeoutId);

      if (functionError) {
        throw new Error(functionError.message || 'Error al comunicarse con el servidor');
      }

      if (!data) throw new Error('No se recibió respuesta del servidor');
      if (data.error) throw new Error(data.error);
      if (data.requiresAuth) throw new Error('Para usar un código de descuento debes iniciar sesión');

      if (data?.url) {
        giftCardFormPersistence.clearStorage();
        if (data.isFree && data.giftCardId) {
          navigate(`/gift-card/success?gift_card_id=${data.giftCardId}&free=true`);
        } else {
          window.location.href = data.url;
        }
        return;
      } else {
        throw new Error('No se pudo crear la sesión de pago');
      }
    } catch (err: any) {
      clearTimeout(timeoutId);
      console.error('Error purchasing gift card:', err);
      setError(err.message || 'Error al procesar tu solicitud. Por favor intenta nuevamente.');
      setIsProcessing(false);
    }
  };

  if (mpBrick) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-amber-50 via-orange-50 to-yellow-50 py-12 px-4">
        <div className="max-w-xl mx-auto">
          <button
            onClick={() => setMpBrick(null)}
            className="flex items-center text-gray-600 hover:text-gray-900 mb-6"
          >
            <X className="w-5 h-5 mr-2" />
            Volver
          </button>
          <div className="bg-white rounded-2xl shadow-xl p-8">
            <div className="flex items-center gap-3 mb-2">
              <div className="w-10 h-10 bg-amber-100 rounded-full flex items-center justify-center">
                <Gift className="w-5 h-5 text-amber-600" />
              </div>
              <div>
                <h2 className="text-xl font-bold text-gray-900">Completa tu pago</h2>
                <p className="text-sm text-gray-500">Tarjeta de Regalo ToursRed ${calculateFinalAmount()} MXN</p>
              </div>
            </div>
            <div className="border-t my-6" />
            <MercadoPagoBrick
              preferenceId={mpBrick.preferenceId}
              publicKey={mpBrick.publicKey}
              amount={mpBrick.amount}
              onSuccess={() => navigate(`/gift-card/success?gift_card_id=${mpBrick.giftCardId}&provider=mercadopago`)}
              onPending={() => navigate(`/gift-card/success?gift_card_id=${mpBrick.giftCardId}&provider=mercadopago&pending=true`)}
              onError={(err) => {
                setMpBrick(null);
                setError(err);
              }}
            />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-amber-50 via-orange-50 to-yellow-50 py-12 px-4">
      <Seo
        title="Tarjetas de Regalo | ToursRed"
        description="Regala experiencias inolvidables con tarjetas de regalo ToursRed. Válidas por 1 año para cualquier tour o excursión en México."
        type="website"
      />
      <div className="max-w-4xl mx-auto">
        <div className="text-center mb-12">
          <div className="inline-flex items-center justify-center w-20 h-20 bg-gradient-to-br from-amber-500 to-orange-600 rounded-full mb-6">
            <Gift className="w-10 h-10 text-white" />
          </div>
          <h1 className="text-4xl font-bold text-gray-900 mb-4">
            Tarjetas de Regalo ToursRed
          </h1>
          <p className="text-xl text-gray-600 max-w-2xl mx-auto">
            Regala experiencias inolvidables. La manera perfecta de compartir la aventura con tus seres queridos.
          </p>
        </div>

        <div className="bg-white rounded-2xl shadow-xl overflow-hidden">
          <div className="bg-gradient-to-r from-amber-500 to-orange-600 px-8 py-6">
            <h2 className="text-2xl font-bold text-white">Compra tu Tarjeta de Regalo</h2>
            <p className="text-amber-100 mt-2">Válida por 1 año desde la fecha de compra</p>
          </div>

          <form onSubmit={handlePurchase} className="p-8">
            {error && (
              <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-lg text-red-800">
                {error}
              </div>
            )}

            <div className="mb-8">
              <label className="block text-sm font-semibold text-gray-700 mb-4">
                Selecciona el Monto
              </label>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                {GIFT_CARD_AMOUNTS.map((amount) => (
                  <button
                    key={amount}
                    type="button"
                    onClick={() => setSelectedAmount(amount)}
                    className={`relative p-6 rounded-xl border-2 transition-all ${
                      selectedAmount === amount
                        ? 'border-amber-500 bg-amber-50 shadow-lg scale-105'
                        : 'border-gray-200 hover:border-amber-300 hover:shadow-md'
                    }`}
                  >
                    {selectedAmount === amount && (
                      <div className="absolute top-2 right-2 w-6 h-6 bg-amber-500 rounded-full flex items-center justify-center">
                        <Check className="w-4 h-4 text-white" />
                      </div>
                    )}
                    <div className="text-3xl font-bold text-gray-900">${amount}</div>
                    <div className="text-sm text-gray-500">MXN</div>
                  </button>
                ))}
              </div>
            </div>

            <div className="mb-6">
              <h3 className="text-lg font-semibold text-gray-900 mb-4">Información del Comprador</h3>
              <div className="grid md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Tu Nombre *
                  </label>
                  <input
                    type="text"
                    required
                    value={purchaserName}
                    onChange={(e) => setPurchaserName(e.target.value)}
                    className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-amber-500 focus:border-transparent"
                    placeholder="Juan Pérez"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Tu Email *
                  </label>
                  <input
                    type="email"
                    required
                    value={purchaserEmail}
                    onChange={(e) => setPurchaserEmail(e.target.value)}
                    className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-amber-500 focus:border-transparent"
                    placeholder="tu@email.com"
                  />
                </div>
              </div>
            </div>

            <div className="mb-6">
              <label className="flex items-center space-x-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={isGift}
                  onChange={(e) => setIsGift(e.target.checked)}
                  className="w-5 h-5 text-amber-500 border-gray-300 rounded focus:ring-amber-500"
                />
                <span className="text-sm font-medium text-gray-700">
                  Enviar como regalo a otra persona
                </span>
              </label>
            </div>

            {isGift && (
              <div className="mb-6 p-6 bg-amber-50 rounded-xl border border-amber-200">
                <h3 className="text-lg font-semibold text-gray-900 mb-4">
                  Información del Destinatario
                </h3>
                <div className="grid md:grid-cols-2 gap-4 mb-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Nombre del Destinatario
                    </label>
                    <input
                      type="text"
                      value={recipientName}
                      onChange={(e) => setRecipientName(e.target.value)}
                      className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-amber-500 focus:border-transparent bg-white"
                      placeholder="María García"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Email del Destinatario
                    </label>
                    <input
                      type="email"
                      value={recipientEmail}
                      onChange={(e) => setRecipientEmail(e.target.value)}
                      className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-amber-500 focus:border-transparent bg-white"
                      placeholder="destinatario@email.com"
                    />
                  </div>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Mensaje Personal (Opcional)
                  </label>
                  <textarea
                    value={personalMessage}
                    onChange={(e) => setPersonalMessage(e.target.value)}
                    maxLength={200}
                    rows={3}
                    className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-amber-500 focus:border-transparent bg-white resize-none"
                    placeholder="¡Espero que disfrutes esta experiencia!"
                  />
                  <p className="text-xs text-gray-500 mt-1">
                    {personalMessage.length}/200 caracteres
                  </p>
                </div>
              </div>
            )}

            <div className="bg-gradient-to-br from-amber-50 to-orange-50 rounded-xl p-6 mb-6">
              <h3 className="text-lg font-semibold text-gray-900 mb-3">Resumen de Compra</h3>
              <div className="space-y-2">
                <div className="flex justify-between items-center text-lg">
                  <span className="text-gray-700">Monto de Tarjeta:</span>
                  <span className="text-2xl font-bold text-gray-900">
                    {formatCurrencyMXN(selectedAmount)} MXN
                  </span>
                </div>
                {appliedDiscount && (
                  <div className="flex justify-between items-center text-lg text-green-600">
                    <span>Descuento:</span>
                    <span className="text-xl font-semibold">
                      -{formatCurrencyMXN(appliedDiscount.discountAmount)} MXN
                    </span>
                  </div>
                )}
                <div className="pt-2 border-t border-amber-200">
                  <div className="flex justify-between items-center text-lg">
                    <span className="text-gray-700 font-semibold">Total a Pagar:</span>
                    <span className="text-3xl font-bold text-amber-600">
                      {formatCurrencyMXN(calculateFinalAmount())} MXN
                    </span>
                  </div>
                </div>
              </div>
              {isGift && recipientEmail && (
                <p className="text-sm text-gray-600 mt-3">
                  Se enviará a: <strong>{recipientEmail}</strong>
                </p>
              )}
            </div>

            {user && (
              <div className="bg-white border border-gray-200 rounded-xl p-6 mb-6">
                <div className="flex items-center gap-2 mb-3">
                  <Tag className="w-5 h-5 text-amber-600" />
                  <h4 className="font-semibold text-gray-900">¿Tienes un código de descuento?</h4>
                </div>

                {!appliedDiscount ? (
                  <div>
                    <div className="flex gap-2">
                      <input
                        type="text"
                        value={discountCode}
                        onChange={(e) => {
                          setDiscountCode(e.target.value.toUpperCase());
                          setCodeError(null);
                        }}
                        onKeyPress={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault();
                            validateDiscountCode();
                          }
                        }}
                        placeholder="Ingresa tu código"
                        className="flex-1 px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-amber-500 focus:border-transparent uppercase"
                        disabled={isValidatingCode}
                      />
                      <button
                        type="button"
                        onClick={validateDiscountCode}
                        disabled={isValidatingCode || !discountCode.trim()}
                        className="px-6 py-2 bg-amber-500 text-white rounded-lg hover:bg-amber-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed font-medium"
                      >
                        {isValidatingCode ? (
                          <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                        ) : (
                          'Aplicar'
                        )}
                      </button>
                    </div>
                    {codeError && (
                      <p className="text-sm text-red-600 mt-2">{codeError}</p>
                    )}
                  </div>
                ) : (
                  <div className="flex items-center justify-between bg-green-50 border border-green-200 rounded-lg p-3">
                    <div className="flex items-center gap-2">
                      <Check className="w-5 h-5 text-green-600" />
                      <div>
                        <p className="font-semibold text-green-900">Código aplicado: {appliedDiscount.code}</p>
                        <p className="text-sm text-green-700">
                          Descuento de {formatCurrencyMXN(appliedDiscount.discountAmount)} MXN
                        </p>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={removeDiscountCode}
                      className="text-green-600 hover:text-green-800 transition-colors"
                      title="Quitar código"
                    >
                      <X className="w-5 h-5" />
                    </button>
                  </div>
                )}
              </div>
            )}

            <PaymentProviderSelector
              context="gift_card"
              value={paymentProvider}
              onChange={setPaymentProvider}
              disabled={isProcessing}
            />

            <button
              type="submit"
              disabled={isProcessing}
              className="w-full bg-gradient-to-r from-amber-500 to-orange-600 text-white py-4 rounded-xl font-bold text-lg hover:from-amber-600 hover:to-orange-700 transition-all shadow-lg hover:shadow-xl disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center space-x-2"
            >
              {isProcessing ? (
                <>
                  <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  <span>Procesando...</span>
                </>
              ) : (
                <>
                  <CreditCard className="w-6 h-6" />
                  <span>Proceder al Pago</span>
                </>
              )}
            </button>

            <p className="text-xs text-gray-500 text-center mt-4">
              Al continuar, aceptas nuestros términos y condiciones. Las tarjetas de regalo son válidas por 1 año y pueden ser canjeadas por viajeros registrados en ToursRed.
            </p>
          </form>
        </div>

        <div className="mt-12 grid md:grid-cols-3 gap-6">
          <div className="bg-white rounded-xl p-6 shadow-md">
            <div className="w-12 h-12 bg-amber-100 rounded-full flex items-center justify-center mb-4">
              <Gift className="w-6 h-6 text-amber-600" />
            </div>
            <h3 className="font-semibold text-gray-900 mb-2">Entrega Inmediata</h3>
            <p className="text-sm text-gray-600">
              La tarjeta de regalo se envía por email inmediatamente después de confirmar el pago.
            </p>
          </div>
          <div className="bg-white rounded-xl p-6 shadow-md">
            <div className="w-12 h-12 bg-amber-100 rounded-full flex items-center justify-center mb-4">
              <Check className="w-6 h-6 text-amber-600" />
            </div>
            <h3 className="font-semibold text-gray-900 mb-2">Fácil de Canjear</h3>
            <p className="text-sm text-gray-600">
              Solo ingresa el código único para agregar el saldo a tu ToursRed Cash.
            </p>
          </div>
          <div className="bg-white rounded-xl p-6 shadow-md">
            <div className="w-12 h-12 bg-amber-100 rounded-full flex items-center justify-center mb-4">
              <CreditCard className="w-6 h-6 text-amber-600" />
            </div>
            <h3 className="font-semibold text-gray-900 mb-2">Válida por 1 Año</h3>
            <p className="text-sm text-gray-600">
              El destinatario tiene 1 año completo para canjear y usar su tarjeta de regalo.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
