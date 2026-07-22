import React, { useEffect, useState } from 'react';
import { CreditCard, Lock, Info, AlertTriangle } from 'lucide-react';
import { supabase } from '../lib/supabase';

export type PaymentProvider = 'stripe' | 'mercadopago' | 'paypal';

export type PaymentContext =
  | 'booking'
  | 'booking_with_membership'
  | 'gift_card'
  | 'membership';

interface ProviderConfig {
  mercadopago_enabled: boolean;
  paypal_enabled: boolean;
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
}

const PROVIDER_LABELS: Record<PaymentProvider, string> = {
  stripe: 'Tarjeta / OXXO / Transferencia',
  mercadopago: 'MercadoPago',
  paypal: 'PayPal',
};

const PROVIDER_DESCRIPTIONS: Record<PaymentProvider, string> = {
  stripe: 'Visa, Mastercard, OXXO, transferencia bancaria',
  mercadopago: 'Tarjeta, efectivo, transferencia SPEI',
  paypal: 'Cuenta PayPal o tarjeta de crédito/débito',
};

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
}: PaymentProviderSelectorProps) {
  const [config, setConfig] = useState<ProviderConfig | null>(null);

  useEffect(() => {
    supabase
      .from('platform_settings')
      .select(
        'mercadopago_enabled, paypal_enabled, mercadopago_public_key, paypal_client_id, stripe_bookings_enabled, stripe_gift_cards_enabled, stripe_memberships_enabled'
      )
      .maybeSingle()
      .then(({ data }) => {
        if (data) setConfig(data as ProviderConfig);
      });
  }, []);

  const isMembershipContext =
    context === 'booking_with_membership' || context === 'membership';

  const stripeAvailable = config ? isStripeAvailableForContext(context, config) : true;

  const availableProviders: PaymentProvider[] = [];

  if (stripeAvailable) {
    availableProviders.push('stripe');
  }

  if (!isMembershipContext) {
    if (config?.mercadopago_enabled && config.mercadopago_public_key) {
      availableProviders.push('mercadopago');
    }
    if (config?.paypal_enabled && config.paypal_client_id) {
      availableProviders.push('paypal');
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

  // Only one provider and it's not membership context — hide selector (no choice to make)
  if (availableProviders.length === 1 && !isMembershipContext) {
    return null;
  }

  return (
    <div className="mb-4">
      <div className="flex items-center gap-2 mb-3">
        <CreditCard className="h-4 w-4 text-gray-500" />
        <span className="text-sm font-medium text-gray-900">Metodo de Pago</span>
      </div>

      {isMembershipContext && (
        <div className="flex items-start gap-2 bg-blue-50 border border-blue-200 rounded-lg p-3 mb-3">
          <Info className="h-4 w-4 text-blue-600 flex-shrink-0 mt-0.5" />
          <p className="text-xs text-blue-800">
            Las membresias requieren pago con tarjeta via Stripe para habilitar el cobro
            recurrente automatico. Este es el unico metodo disponible para suscripciones.
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
                      Requerido para membresia
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
    </div>
  );
}
