import React, { useEffect, useState, useMemo } from 'react';
import { CreditCard, Lock, Info, AlertTriangle, Wallet, Banknote, Landmark, SplitSquareHorizontal, CheckCircle2, XCircle } from 'lucide-react';
import { supabase } from '../lib/supabase';

export type PaymentProvider = 'stripe' | 'mercadopago' | 'paypal' | 'conekta' | 'toursred_cash';

export type ConektaMethod = 'bnpl' | 'card' | 'cash' | 'spei';

export type SubCharge = {
  amount: number;
  payment_method_type: 'card' | 'cash' | 'spei';
};

export type PaymentContext =
  | 'booking'
  | 'booking_with_membership'
  | 'gift_card'
  | 'membership'
  | 'payment_plan';

interface ProviderConfig {
  mercadopago_enabled: boolean;
  paypal_enabled: boolean;
  conekta_enabled: boolean;
  mercadopago_public_key: string;
  paypal_client_id: string;
  stripe_bookings_enabled: boolean;
  stripe_gift_cards_enabled: boolean;
  stripe_memberships_enabled: boolean;
}

interface PaymentProviderSelectorProps {
  context: PaymentContext;
  value: PaymentProvider;
  onChange: (provider: PaymentProvider) => void;
  disabled?: boolean;
  amount?: number;
  conektaMethod?: ConektaMethod;
  onConektaMethodChange?: (method: ConektaMethod) => void;
  useSplitPayment?: boolean;
  onUseSplitPaymentChange?: (useSplit: boolean) => void;
  splitCharges?: SubCharge[];
  onSplitChargesChange?: (charges: SubCharge[] | null) => void;
}

const PROVIDER_LABELS: Record<PaymentProvider, string> = {
  stripe: 'Tarjeta / OXXO / Transferencia',
  mercadopago: 'MercadoPago',
  paypal: 'PayPal',
  conekta: 'Conekta (Tarjeta / Efectivo / SPEI / Compra ahora, paga después)',
  toursred_cash: 'ToursRed Cash (Billetera interna)',
};

const PROVIDER_DESCRIPTIONS: Record<PaymentProvider, string> = {
  stripe: 'Visa, Mastercard, OXXO, transferencia bancaria',
  mercadopago: 'Tarjeta, efectivo, transferencia SPEI',
  paypal: 'Cuenta PayPal o tarjeta de crédito/débito',
  conekta: 'Tarjeta, efectivo, SPEI, o financia tu compra sin tarjeta',
  toursred_cash: 'Usa tu saldo de ToursRed Cash para abonar al plan',
};


const CONEKTA_METHOD_LABELS: Record<ConektaMethod, string> = {
  bnpl: 'Compra ahora, paga después (BNPL)',
  card: 'Tarjeta de crédito/débito',
  cash: 'Efectivo (referencia de pago)',
  spei: 'Transferencia SPEI',
};

export const BNPL_MIN_AMOUNT = 1200;
export const BNPL_MAX_AMOUNT = 16000;

const SPLIT_METHODS: { value: 'card' | 'cash' | 'spei'; label: string; icon: React.ReactNode }[] = [
  { value: 'card', label: 'Tarjeta', icon: <CreditCard className="h-4 w-4" /> },
  { value: 'cash', label: 'Efectivo', icon: <Banknote className="h-4 w-4" /> },
  { value: 'spei', label: 'SPEI', icon: <Landmark className="h-4 w-4" /> },
];

function formatMXN(value: number): string {
  return new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN', minimumFractionDigits: 2 }).format(value || 0);
}

function isStripeAvailableForContext(context: PaymentContext, config: ProviderConfig): boolean {
  if (context === 'booking' || context === 'booking_with_membership') {
    return config.stripe_bookings_enabled;
  }
  if (context === 'gift_card') {
    return config.stripe_gift_cards_enabled;
  }
  if (context === 'membership') {
    return config.stripe_memberships_enabled;
  }
  return true;
}

export default function PaymentProviderSelector({
  context,
  value,
  onChange,
  disabled = false,
  amount = 0,
  conektaMethod = 'card',
  onConektaMethodChange,
  useSplitPayment = false,
  onUseSplitPaymentChange,
  splitCharges,
  onSplitChargesChange,
}: PaymentProviderSelectorProps) {
  const [config, setConfig] = useState<ProviderConfig | null>(null);

  useEffect(() => {
    supabase
      .from('platform_settings')
      .select(
        'mercadopago_enabled, paypal_enabled, conekta_enabled, mercadopago_public_key, paypal_client_id, stripe_bookings_enabled, stripe_gift_cards_enabled, stripe_memberships_enabled'
      )
      .maybeSingle()
      .then(({ data }) => {
        if (data) setConfig(data as ProviderConfig);
      });
  }, []);

  const isMembershipContext =
    context === 'booking_with_membership' || context === 'membership';
  const isPaymentPlanContext = context === 'payment_plan';

  const stripeAvailable = config ? isStripeAvailableForContext(context, config) : true;

  const availableProviders: PaymentProvider[] = [];

  if (stripeAvailable) {
    availableProviders.push('stripe');
  }

  // ToursRed Cash is only available in payment plan context (internal wallet)
  if (isPaymentPlanContext) {
    availableProviders.push('toursred_cash' as PaymentProvider);
  }

  if (!isMembershipContext) {
    if (config?.mercadopago_enabled && config.mercadopago_public_key) {
      availableProviders.push('mercadopago');
    }
    if (config?.paypal_enabled && config.paypal_client_id) {
      availableProviders.push('paypal');
    }
    if (config?.conekta_enabled) {
      availableProviders.push('conekta');
    }
  }

  // If current selection is no longer available, switch to first available
  useEffect(() => {
    if (!config) return;
    if (isMembershipContext && value !== 'stripe') {
      onChange('stripe');
      return;
    }
    if (availableProviders.length > 0 && !availableProviders.includes(value)) {
      onChange(availableProviders[0]);
    }
  }, [config, isMembershipContext, value]);

  const bnplAvailable = amount >= BNPL_MIN_AMOUNT && amount <= BNPL_MAX_AMOUNT;
  const splitEligible = conektaMethod !== 'bnpl';

  // If BNPL is selected but amount is out of range, switch to card
  useEffect(() => {
    if (value === 'conekta' && conektaMethod === 'bnpl' && !bnplAvailable && onConektaMethodChange) {
      onConektaMethodChange('card');
    }
  }, [value, conektaMethod, bnplAvailable, onConektaMethodChange]);

  // Reset split when switching to BNPL or leaving Conekta
  useEffect(() => {
    if (useSplitPayment && (!splitEligible || value !== 'conekta') && onUseSplitPaymentChange) {
      onUseSplitPaymentChange(false);
    }
  }, [value, splitEligible, useSplitPayment, onUseSplitPaymentChange]);

  const splitAmount1 = splitCharges?.[0]?.amount ?? 0;
  const splitAmount2 = splitCharges?.[1]?.amount ?? 0;
  const splitMethod1 = splitCharges?.[0]?.payment_method_type ?? 'card';
  const splitMethod2 = splitCharges?.[1]?.payment_method_type ?? 'cash';
  const splitSum = Math.round((splitAmount1 + splitAmount2) * 100) / 100;
  const splitTotalMatch = Math.abs(splitSum - amount) < 0.01;

  const updateSplitCharges = (index: number, field: 'amount' | 'payment_method_type', val: string | number) => {
    if (!onSplitChargesChange) return;
    const current = splitCharges ? [...splitCharges] : [
      { amount: 0, payment_method_type: 'card' as const },
      { amount: 0, payment_method_type: 'cash' as const },
    ];
    if (field === 'amount') {
      current[index] = { ...current[index], amount: typeof val === 'number' ? val : parseFloat(val as string) || 0 };
    } else {
      current[index] = { ...current[index], payment_method_type: val as 'card' | 'cash' | 'spei' };
    }
    onSplitChargesChange(current as SubCharge[]);
  };

  const handleSplitToggle = (checked: boolean) => {
    if (!onUseSplitPaymentChange) return;
    onUseSplitPaymentChange(checked);
    if (checked && onSplitChargesChange) {
      const half = Math.round(amount / 2 * 100) / 100;
      const otherHalf = Math.round((amount - half) * 100) / 100;
      onSplitChargesChange([
        { amount: half, payment_method_type: conektaMethod === 'card' || conektaMethod === 'cash' || conektaMethod === 'spei' ? conektaMethod : 'card' },
        { amount: otherHalf, payment_method_type: conektaMethod === 'card' ? 'cash' : 'card' },
      ]);
    } else if (!checked && onSplitChargesChange) {
      onSplitChargesChange(null);
    }
  };

  // No providers available at all
  if (config && availableProviders.length === 0) {
    return (
      <div className="mb-4 bg-amber-50 border border-amber-200 rounded-lg p-3 flex items-start gap-2">
        <AlertTriangle className="h-4 w-4 text-amber-600 flex-shrink-0 mt-0.5" />
        <p className="text-xs text-amber-800">
          No hay métodos de pago disponibles en este momento. Por favor intenta más tarde.
        </p>
      </div>
    );
  }

  // Only one provider and it's not membership/payment_plan context — hide selector (no choice to make)
  if (availableProviders.length === 1 && !isMembershipContext && !isPaymentPlanContext) {
    return null;
  }

  return (
    <div className="mb-4">
      <div className="flex items-center gap-2 mb-3">
        <CreditCard className="h-4 w-4 text-gray-500" />
        <span className="text-sm font-medium text-gray-900">Método de Pago</span>
      </div>

      {isMembershipContext && (
        <div className="flex items-start gap-2 bg-blue-50 border border-blue-200 rounded-lg p-3 mb-3">
          <Info className="h-4 w-4 text-blue-600 flex-shrink-0 mt-0.5" />
          <p className="text-xs text-blue-800">
            Las membresías requieren pago con tarjeta vía Stripe para habilitar el cobro
            recurrente automático. Este es el único método disponible para suscripciones.
          </p>
        </div>
      )}

      <div className="grid gap-2">
        {availableProviders.map((provider) => {
          const isSelected = value === provider;
          const isLocked = isMembershipContext && provider === 'stripe';

          return (
            <label
              key={provider}
              className={`flex items-center gap-3 p-3 rounded-xl border-2 cursor-pointer transition-all ${
                disabled || (isMembershipContext && provider !== 'stripe')
                  ? 'opacity-50 cursor-not-allowed'
                  : 'hover:border-primary-400'
              } ${
                isSelected
                  ? 'border-primary-500 bg-primary-50'
                  : 'border-gray-200 bg-white'
              }`}
            >
              <input
                type="radio"
                name="payment-provider"
                value={provider}
                checked={isSelected}
                disabled={disabled || (isMembershipContext && provider !== 'stripe')}
                onChange={() => onChange(provider)}
                className="h-4 w-4 text-primary-600 focus:ring-primary-500 border-gray-300"
              />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-semibold text-gray-900">
                    {PROVIDER_LABELS[provider]}
                  </span>
                  {isLocked && (
                    <span className="inline-flex items-center gap-1 text-xs text-blue-700 bg-blue-100 px-2 py-0.5 rounded-full">
                      <Lock className="h-3 w-3" />
                      Requerido para membresía
                    </span>
                  )}
                </div>
                <p className="text-xs text-gray-500 mt-0.5">
                  {PROVIDER_DESCRIPTIONS[provider]}
                </p>
              </div>
            </label>
          );
        })}
      </div>

      {/* Conekta method sub-selector */}
      {value === 'conekta' && !isMembershipContext && (
        <div className="mt-3 ml-1 pl-4 border-l-2 border-primary-200 space-y-2">
          <div className="flex items-center gap-2 mb-2">
            <span className="text-xs font-medium text-gray-700">Elige tu método de pago con Conekta:</span>
          </div>

          {(['card', 'cash', 'spei', 'bnpl'] as ConektaMethod[]).map((method) => {
            const isMethodSelected = conektaMethod === method;
            const isBnplDisabled = method === 'bnpl' && !bnplAvailable;

            const methodIcon = method === 'card' ? <CreditCard className="h-4 w-4" />
              : method === 'cash' ? <Banknote className="h-4 w-4" />
              : method === 'spei' ? <Landmark className="h-4 w-4" />
              : <Wallet className="h-4 w-4" />;

            return (
              <label
                key={method}
                className={`flex items-center gap-3 p-2.5 rounded-lg border cursor-pointer transition-all ${
                  isBnplDisabled ? 'opacity-50 cursor-not-allowed' : 'hover:border-primary-300'
                } ${
                  isMethodSelected
                    ? 'border-primary-400 bg-primary-50'
                    : 'border-gray-200 bg-white'
                }`}
              >
                <input
                  type="radio"
                  name="conekta-method"
                  value={method}
                  checked={isMethodSelected}
                  disabled={isBnplDisabled || disabled}
                  onChange={() => onConektaMethodChange?.(method)}
                  className="h-3.5 w-3.5 text-primary-600 focus:ring-primary-500 border-gray-300"
                />
                <div className="flex items-center gap-2 flex-1">
                  <span className="text-gray-500">{methodIcon}</span>
                  <div>
                    <span className="text-sm font-medium text-gray-900">
                      {CONEKTA_METHOD_LABELS[method]}
                    </span>
                    {isBnplDisabled && (
                      <span className="block text-xs text-gray-400">
                        Disponible para montos entre $1,200 y $16,000 MXN
                      </span>
                    )}
                  </div>
                </div>
              </label>
            );
          })}

          {/* Split payment option (only for non-BNPL methods) */}
          {conektaMethod !== 'bnpl' && !isMembershipContext && (
            <div className="mt-2">
              <label className="flex items-center gap-2 cursor-pointer p-2 rounded-lg hover:bg-gray-50 transition-colors">
                <input
                  type="checkbox"
                  checked={useSplitPayment}
                  onChange={(e) => handleSplitToggle(e.target.checked)}
                  disabled={disabled}
                  className="rounded border-gray-300 text-primary-600 focus:ring-primary-500"
                />
                <span className="text-xs font-medium text-gray-700 flex items-center gap-1.5">
                  <SplitSquareHorizontal className="h-3.5 w-3.5" />
                  Dividir mi pago entre dos métodos
                </span>
              </label>

              {useSplitPayment && (
                <div className="mt-2 space-y-3 bg-gray-50 rounded-lg p-3 border border-gray-200">
                  {[0, 1].map((idx) => {
                    const methodVal = idx === 0 ? splitMethod1 : splitMethod2;
                    const amountVal = idx === 0 ? splitAmount1 : splitAmount2;
                    return (
                      <div key={idx} className="space-y-1.5">
                        <div className="flex items-center gap-1.5">
                          <span className="text-xs font-medium text-gray-600">Pago {idx + 1}:</span>
                          <select
                            value={methodVal}
                            onChange={(e) => updateSplitCharges(idx, 'payment_method_type', e.target.value)}
                            disabled={disabled}
                            className="text-xs border border-gray-300 rounded-md px-2 py-1 bg-white focus:ring-1 focus:ring-primary-400"
                          >
                            {SPLIT_METHODS.map((m) => (
                              <option key={m.value} value={m.value}>{m.label}</option>
                            ))}
                          </select>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="text-xs text-gray-400">$</span>
                          <input
                            type="number"
                            min={0}
                            max={amount}
                            step={0.01}
                            value={amountVal || ''}
                            onChange={(e) => updateSplitCharges(idx, 'amount', e.target.value)}
                            disabled={disabled}
                            placeholder="0.00"
                            className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded-md focus:ring-1 focus:ring-primary-400 focus:border-primary-400"
                          />
                        </div>
                      </div>
                    );
                  })}

                  <div className={`flex items-center justify-between text-xs font-medium rounded-md px-3 py-2 ${
                    splitTotalMatch
                      ? 'bg-green-50 text-green-700 border border-green-200'
                      : 'bg-red-50 text-red-700 border border-red-200'
                  }`}>
                    <span className="flex items-center gap-1.5">
                      {splitTotalMatch
                        ? <CheckCircle2 className="h-3.5 w-3.5" />
                        : <XCircle className="h-3.5 w-3.5" />}
                      Total: {formatMXN(splitSum)}
                    </span>
                    <span>Esperado: {formatMXN(amount)}</span>
                  </div>
                  {!splitTotalMatch && (
                    <p className="text-xs text-red-600">
                      La suma de ambos pagos debe ser exactamente {formatMXN(amount)}.
                    </p>
                  )}
                </div>
              )}
            </div>
          )}

          {/* BNPL disclosure */}
          {conektaMethod === 'bnpl' && bnplAvailable && (
            <div className="mt-2 bg-amber-50 border border-amber-200 rounded-lg p-2.5 flex items-start gap-2">
              <AlertTriangle className="h-3.5 w-3.5 text-amber-600 flex-shrink-0 mt-0.5" />
              <p className="text-xs text-amber-800 leading-relaxed">
                Al cancelar tu reserva pagada con este método, tu compromiso de pago con
                la financiera continúa vigente. ToursRed te reembolsará en ToursRed Cash
                conforme a nuestra política de cancelación.
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
