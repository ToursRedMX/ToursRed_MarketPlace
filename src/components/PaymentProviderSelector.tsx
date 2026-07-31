import React, { useEffect, useState } from 'react';
import { CreditCard, Lock, Info, AlertTriangle, Wallet, Banknote, Landmark } from 'lucide-react';
import { supabase } from '../lib/supabase';

export type PaymentProvider = 'stripe' | 'mercadopago' | 'paypal' | 'conekta' | 'toursred_cash';

export type ConektaMethod = 'bnpl' | 'card' | 'cash' | 'spei';

export type SubCharge = {
  amount: number;
  payment_method_type: 'card' | 'cash' | 'spei';
  token_id?: string;
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

  // If BNPL is selected but amount is out of range, switch to card
  useEffect(() => {
    if (value === 'conekta' && conektaMethod === 'bnpl' && !bnplAvailable && onConektaMethodChange) {
      onConektaMethodChange('card');
    }
  }, [value, conektaMethod, bnplAvailable, onConektaMethodChange]);

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
