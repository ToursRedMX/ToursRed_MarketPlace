import { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Crown, Check, ArrowLeft, Tag, X, Shield, CreditCard, Calendar, Zap, Sparkles, Loader2, AlertTriangle } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { supabase } from '../../lib/supabase';
import { useMembershipPrices } from '../../hooks/useMembershipPrices';
import { formatCurrencyMXN, formatCurrency } from '../../utils/formatCurrency';

interface AppliedDiscount {
  code: string;
  codeId: string;
  discountType: string;
  discountValue: number;
  description: string;
}

export default function MembershipCheckout() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const planType = searchParams.get('plan') as 'monthly' | 'annual' | null;
  const { prices, loading: pricesLoading } = useMembershipPrices();

  const [discountCode, setDiscountCode] = useState('');
  const [appliedDiscount, setAppliedDiscount] = useState<AppliedDiscount | null>(null);
  const [discountError, setDiscountError] = useState<string | null>(null);
  const [validating, setValidating] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasMembership, setHasMembership] = useState(false);
  const [checkingMembership, setCheckingMembership] = useState(true);
  const [stripeMembershipsEnabled, setStripeMembershipsEnabled] = useState<boolean | null>(null);

  useEffect(() => {
    checkExistingMembership();
    checkStripeEnabled();
  }, [user?.id]);

  const checkExistingMembership = async () => {
    if (!user) return;
    try {
      const { data } = await supabase
        .from('memberships')
        .select('id')
        .eq('user_id', user.id)
        .eq('status', 'active')
        .maybeSingle();
      if (data) setHasMembership(true);
    } catch {
      // ignore
    } finally {
      setCheckingMembership(false);
    }
  };

  const checkStripeEnabled = async () => {
    const { data } = await supabase
      .from('platform_settings')
      .select('stripe_memberships_enabled')
      .maybeSingle();
    setStripeMembershipsEnabled(data?.stripe_memberships_enabled ?? true);
  };

  if (!planType || !['monthly', 'annual'].includes(planType)) {
    navigate('/traveler/membership', { replace: true });
    return null;
  }

  if (checkingMembership || pricesLoading || !prices || stripeMembershipsEnabled === null) {
    return (
      <div className="min-h-screen bg-gradient-to-b from-blue-50 to-white flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  if (!stripeMembershipsEnabled) {
    return (
      <div className="min-h-screen bg-gradient-to-b from-blue-50 to-white flex items-center justify-center p-4">
        <div className="bg-white rounded-2xl shadow-lg p-8 max-w-md w-full text-center">
          <div className="h-16 w-16 bg-amber-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <AlertTriangle className="h-8 w-8 text-amber-600" />
          </div>
          <h2 className="text-xl font-bold text-gray-900 mb-2">
            Membresías no disponibles temporalmente
          </h2>
          <p className="text-gray-600 text-sm mb-6">
            El proceso de pago para nuevas membresías está temporalmente deshabilitado por mantenimiento.
            Las suscripciones activas no se ven afectadas. Por favor intenta de nuevo más tarde.
          </p>
          <button
            onClick={() => navigate('/traveler/membership')}
            className="inline-flex items-center gap-2 px-5 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl font-medium transition-colors"
          >
            <ArrowLeft className="h-4 w-4" />
            Volver a Membresías
          </button>
        </div>
      </div>
    );
  }

  if (hasMembership) {
    navigate('/traveler/membership', { replace: true });
    return null;
  }

  const isMonthly = planType === 'monthly';
  const planPrice = isMonthly ? prices.monthlyPrice : prices.annualPrice;
  const planLabel = isMonthly ? 'Plan Mensual' : 'Plan Anual';
  const periodLabel = isMonthly ? '/mes' : '/ano';

  const today = new Date();
  const renewalDate = new Date(today);
  if (isMonthly) {
    renewalDate.setMonth(renewalDate.getMonth() + 1);
  } else {
    renewalDate.setFullYear(renewalDate.getFullYear() + 1);
  }

  const formatDate = (date: Date) =>
    date.toLocaleDateString('es-MX', { year: 'numeric', month: 'long', day: 'numeric' });

  const isFreeMonthApplied = appliedDiscount?.discountType === 'membership_free_month';
  const isPercentageDiscount = appliedDiscount?.discountType === 'membership_percentage';
  const isFixedDiscount = appliedDiscount?.discountType === 'membership_fixed';
  const hasMonetaryDiscount = isPercentageDiscount || isFixedDiscount;

  const discountAmount = isPercentageDiscount
    ? Math.min(planPrice, planPrice * (appliedDiscount.discountValue / 100))
    : isFixedDiscount
      ? Math.min(planPrice, appliedDiscount.discountValue)
      : 0;

  const todayTotal = isFreeMonthApplied ? 0 : (hasMonetaryDiscount ? planPrice - discountAmount : planPrice);

  const firstChargeDate = new Date(today);
  if (isFreeMonthApplied) {
    firstChargeDate.setDate(firstChargeDate.getDate() + 30);
  }

  const getDiscountLabel = () => {
    if (isPercentageDiscount) return `${appliedDiscount.discountValue}% de descuento`;
    if (isFixedDiscount) return `$${discountAmount.toFixed(0)} de descuento`;
    if (isFreeMonthApplied) return 'Primer mes GRATIS';
    return appliedDiscount?.description || '';
  };

  const handleApplyCode = async () => {
    if (!discountCode.trim() || !user) return;

    setValidating(true);
    setDiscountError(null);

    try {
      const { data, error: rpcError } = await supabase.rpc('validate_discount_code', {
        p_code: discountCode.trim(),
        p_user_id: user.id,
        p_applicable_to: 'memberships',
      });

      if (rpcError) throw new Error('Error al validar el codigo');

      if (!data?.valid) {
        setDiscountError(data?.error || 'Codigo invalido');
        return;
      }

      const planTypeRestriction = data.membership_plan_type || 'both';
      if (planTypeRestriction !== 'both') {
        if (planTypeRestriction === 'monthly' && !isMonthly) {
          setDiscountError('Este codigo solo aplica para el plan mensual');
          return;
        }
        if (planTypeRestriction === 'annual' && isMonthly) {
          setDiscountError('Este codigo solo aplica para el plan anual');
          return;
        }
      }

      setAppliedDiscount({
        code: data.code,
        codeId: data.code_id,
        discountType: data.discount_type,
        discountValue: data.discount_value || 0,
        description: data.description || '',
      });
      setDiscountCode('');
    } catch (err: any) {
      setDiscountError(err.message || 'Error al validar el codigo');
    } finally {
      setValidating(false);
    }
  };

  const handleRemoveDiscount = () => {
    setAppliedDiscount(null);
    setDiscountError(null);
  };

  const handleConfirm = async () => {
    setSubmitting(true);
    setError(null);

    try {
      const response = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/create-membership-subscription`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${(await supabase.auth.getSession()).data.session?.access_token}`,
          },
          body: JSON.stringify({
            planType,
            discountCode: appliedDiscount?.code || undefined,
          }),
        }
      );

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Error al crear la suscripcion');
      }

      if (data.url) {
        window.location.href = data.url;
      }
    } catch (err: any) {
      setError(err.message || 'Error al procesar la suscripcion');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-blue-50 via-white to-blue-50/30 py-8 sm:py-12">
      <div className="max-w-2xl mx-auto px-4 sm:px-6">
        <button
          onClick={() => navigate('/traveler/membership')}
          className="flex items-center gap-2 text-gray-600 hover:text-blue-600 font-medium transition-colors mb-8"
        >
          <ArrowLeft className="h-5 w-5" />
          Cambiar de plan
        </button>

        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 bg-gradient-to-br from-yellow-400 to-yellow-600 rounded-2xl shadow-lg mb-4">
            <Crown className="h-8 w-8 text-white" />
          </div>
          <h1 className="text-2xl sm:text-3xl font-bold text-gray-900">
            Confirma tu Membresia
          </h1>
          <p className="text-gray-500 mt-1">Estas a un paso de disfrutar todos los beneficios</p>
        </div>

        <div className="bg-white rounded-2xl shadow-lg border border-gray-100 overflow-hidden">
          <div className={`px-6 py-5 ${isMonthly ? 'bg-gradient-to-r from-blue-600 to-blue-700' : 'bg-gradient-to-r from-yellow-500 to-yellow-600'}`}>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <Crown className="h-6 w-6 text-white" />
                <div>
                  <h2 className="text-lg font-bold text-white">ToursRed+ {planLabel}</h2>
                  {!isMonthly && (
                    <p className="text-white/80 text-sm">Equivalente a {prices.annualMonthlyEquivalentFormatted} MXN/mes</p>
                  )}
                </div>
              </div>
              <div className="text-right">
                <span className="text-2xl sm:text-3xl font-bold text-white">
                  ${planPrice.toFixed(0)}
                </span>
                <span className="text-white/80 text-sm ml-1">{periodLabel}</span>
              </div>
            </div>
          </div>

          <div className="p-6 space-y-6">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="flex items-start gap-3 bg-gray-50 rounded-xl p-4">
                <Calendar className="h-5 w-5 text-blue-600 flex-shrink-0 mt-0.5" />
                <div>
                  <p className="text-xs text-gray-500 font-medium uppercase tracking-wide">Fecha de inicio</p>
                  <p className="text-sm font-semibold text-gray-900 mt-0.5">{formatDate(today)}</p>
                </div>
              </div>
              <div className="flex items-start gap-3 bg-gray-50 rounded-xl p-4">
                <Calendar className="h-5 w-5 text-blue-600 flex-shrink-0 mt-0.5" />
                <div>
                  <p className="text-xs text-gray-500 font-medium uppercase tracking-wide">
                    {isFreeMonthApplied ? 'Primer cobro' : 'Proxima renovacion'}
                  </p>
                  <p className="text-sm font-semibold text-gray-900 mt-0.5">
                    {isFreeMonthApplied ? formatDate(firstChargeDate) : formatDate(renewalDate)}
                  </p>
                </div>
              </div>
            </div>

            <div className="border-t border-gray-100 pt-5">
              <h3 className="text-sm font-semibold text-gray-900 mb-3">Beneficios incluidos</h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {[
                  { icon: Shield, text: 'Sin cargo por servicio hasta $500/mes' },
                  { icon: Zap, text: '1 punto por cada peso en tours' },
                  { icon: Sparkles, text: 'Ofertas y descuentos exclusivos' },
                  { icon: Crown, text: 'Soporte prioritario' },
                ].map((benefit, i) => (
                  <div key={i} className="flex items-center gap-2 text-sm text-gray-700">
                    <benefit.icon className="h-4 w-4 text-yellow-500 flex-shrink-0" />
                    <span>{benefit.text}</span>
                  </div>
                ))}
              </div>
            </div>

            <div className="border-t border-gray-100 pt-5">
              <h3 className="text-sm font-semibold text-gray-900 mb-3 flex items-center gap-2">
                <Tag className="h-4 w-4 text-gray-400" />
                Codigo de descuento
              </h3>

              {appliedDiscount ? (
                <div className="bg-green-50 border border-green-200 rounded-xl p-4">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 bg-green-100 rounded-lg flex items-center justify-center">
                        <Check className="h-5 w-5 text-green-600" />
                      </div>
                      <div>
                        <p className="font-semibold text-green-900 text-sm">{appliedDiscount.code}</p>
                        <p className="text-green-700 text-xs">{getDiscountLabel()}</p>
                      </div>
                    </div>
                    <button
                      onClick={handleRemoveDiscount}
                      className="text-green-600 hover:text-green-800 transition-colors p-1"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                  {isFreeMonthApplied && (
                    <p className="text-green-700 text-xs mt-3 pl-11">
                      Tu primer cobro de ${planPrice.toFixed(0)} MXN sera el {formatDate(firstChargeDate)}
                    </p>
                  )}
                  {hasMonetaryDiscount && (
                    <p className="text-green-700 text-xs mt-3 pl-11">
                      Ahorras ${discountAmount.toFixed(0)} MXN en tu primer pago. Las renovaciones futuras se cobran al precio regular.
                    </p>
                  )}
                </div>
              ) : (
                <div>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={discountCode}
                      onChange={(e) => {
                        setDiscountCode(e.target.value.toUpperCase());
                        setDiscountError(null);
                      }}
                      onKeyDown={(e) => e.key === 'Enter' && handleApplyCode()}
                      placeholder="Ingresa tu codigo"
                      className="flex-1 border border-gray-300 rounded-xl px-4 py-2.5 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all placeholder:text-gray-400"
                    />
                    <button
                      onClick={handleApplyCode}
                      disabled={validating || !discountCode.trim()}
                      className="px-5 py-2.5 bg-gray-900 text-white text-sm font-medium rounded-xl hover:bg-gray-800 transition-colors disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-2"
                    >
                      {validating ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        'Aplicar'
                      )}
                    </button>
                  </div>
                  {discountError && (
                    <p className="text-red-600 text-xs mt-2 ml-1">{discountError}</p>
                  )}
                </div>
              )}
            </div>

            <div className="border-t border-gray-100 pt-5 space-y-3">
              <div className="flex items-center justify-between text-sm">
                <span className="text-gray-600">{planLabel}</span>
                <span className="text-gray-900">{formatCurrencyMXN(planPrice)} MXN</span>
              </div>
              {isFreeMonthApplied && (
                <div className="flex items-center justify-between text-sm">
                  <span className="text-green-600">Primer mes gratis</span>
                  <span className="text-green-600">-{formatCurrencyMXN(planPrice)} MXN</span>
                </div>
              )}
              {hasMonetaryDiscount && (
                <div className="flex items-center justify-between text-sm">
                  <span className="text-green-600">
                    Descuento ({isPercentageDiscount ? `${appliedDiscount.discountValue}%` : 'codigo'})
                  </span>
                  <span className="text-green-600">-{formatCurrencyMXN(discountAmount)} MXN</span>
                </div>
              )}
              <div className="border-t border-gray-200 pt-3 flex items-center justify-between">
                <span className="font-semibold text-gray-900">Total a pagar hoy</span>
                <span className="text-2xl font-bold text-gray-900">{formatCurrencyMXN(todayTotal)} MXN</span>
              </div>
            </div>

            {error && (
              <div className="bg-red-50 border border-red-200 rounded-xl p-3 text-sm text-red-700">
                {error}
              </div>
            )}

            <button
              onClick={handleConfirm}
              disabled={submitting}
              className={`w-full py-4 rounded-xl font-semibold text-lg transition-all flex items-center justify-center gap-2 ${
                isMonthly
                  ? 'bg-gradient-to-r from-blue-600 to-blue-700 hover:from-blue-700 hover:to-blue-800 text-white shadow-lg shadow-blue-600/25'
                  : 'bg-gradient-to-r from-yellow-500 to-yellow-600 hover:from-yellow-600 hover:to-yellow-700 text-white shadow-lg shadow-yellow-500/25'
              } disabled:opacity-50 disabled:cursor-not-allowed disabled:shadow-none`}
            >
              {submitting ? (
                <>
                  <Loader2 className="h-5 w-5 animate-spin" />
                  Procesando...
                </>
              ) : (
                <>
                  <CreditCard className="h-5 w-5" />
                  {isFreeMonthApplied ? 'Comenzar Periodo Gratis' : 'Continuar al Pago'}
                </>
              )}
            </button>

            <div className="text-center space-y-1">
              <p className="text-xs text-gray-400">
                {isFreeMonthApplied
                  ? `Se registrara tu metodo de pago. Tu primer cobro de $${planPrice.toFixed(0)} MXN sera el ${formatDate(firstChargeDate)}.`
                  : hasMonetaryDiscount
                    ? `El descuento aplica solo al primer pago. Las renovaciones se cobran a $${planPrice.toFixed(0)} MXN. Puedes cancelar en cualquier momento.`
                    : `Se renueva automaticamente. Puedes cancelar en cualquier momento.`}
              </p>
              <div className="inline-flex items-center gap-1.5 text-xs text-gray-400 bg-gray-50 px-3 py-1.5 rounded-full border border-gray-100">
                <CreditCard className="h-3 w-3" />
                Cobro recurrente seguro procesado por Stripe. Las membresias requieren tarjeta de credito o debito para habilitar la renovacion automatica.
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
