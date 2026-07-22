import React, { useState, useEffect } from 'react';
import { Calendar, CreditCard, CheckCircle, Clock, AlertCircle, AlertTriangle, ChevronDown, ChevronUp, Loader2, DollarSign, Receipt } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import { formatCurrencyMXN } from '../utils/formatCurrency';
import { format, parseISO } from 'date-fns';
import { es } from 'date-fns/locale';
import type { BookingPaymentPlan, BookingPaymentPlanInstallment, InstallmentStatus } from '../types';

interface PaymentPlanCalendarProps {
  bookingId: string;
  agencyView?: boolean;
  onPaymentSuccess?: () => void;
}

const INSTALLMENT_STATUS_CONFIG: Record<InstallmentStatus, { label: string; color: string; icon: React.ReactNode }> = {
  pending: { label: 'Pendiente', color: 'text-gray-600 bg-gray-100', icon: <Clock className="w-3.5 h-3.5" /> },
  partially_paid: { label: 'Pago parcial', color: 'text-blue-700 bg-blue-100', icon: <DollarSign className="w-3.5 h-3.5" /> },
  paid: { label: 'Pagado', color: 'text-green-700 bg-green-100', icon: <CheckCircle className="w-3.5 h-3.5" /> },
  overdue_grace: { label: 'Vencido (gracia)', color: 'text-amber-700 bg-amber-100', icon: <AlertCircle className="w-3.5 h-3.5" /> },
  overdue: { label: 'Vencido', color: 'text-red-700 bg-red-100', icon: <AlertTriangle className="w-3.5 h-3.5" /> },
  waived: { label: 'Exonerado', color: 'text-purple-700 bg-purple-100', icon: <CheckCircle className="w-3.5 h-3.5" /> },
  cancelled: { label: 'Cancelado', color: 'text-gray-400 bg-gray-100', icon: <AlertCircle className="w-3.5 h-3.5" /> },
};

const PLAN_STATUS_CONFIG: Record<string, { label: string; color: string }> = {
  active: { label: 'Activo', color: 'text-green-700 bg-green-100' },
  completed: { label: 'Completado', color: 'text-blue-700 bg-blue-100' },
  defaulted: { label: 'En mora', color: 'text-red-700 bg-red-100' },
  cancelled: { label: 'Cancelado', color: 'text-gray-500 bg-gray-100' },
};

const PaymentPlanCalendar: React.FC<PaymentPlanCalendarProps> = ({ bookingId, agencyView = false, onPaymentSuccess }) => {
  const { user } = useAuth();
  const [plan, setPlan] = useState<BookingPaymentPlan | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isExpanded, setIsExpanded] = useState(false);
  const [payingInstallmentId, setPayingInstallmentId] = useState<string | null>(null);
  const [payAmount, setPayAmount] = useState('');
  const [paymentProvider, setPaymentProvider] = useState<'stripe' | 'toursred_cash' | 'mercadopago' | 'paypal'>('stripe');
  const [isProcessingPayment, setIsProcessingPayment] = useState(false);
  const [paymentError, setPaymentError] = useState('');
  const [paymentSuccess, setPaymentSuccess] = useState('');

  const fetchPlan = async () => {
    const { data } = await supabase
      .from('booking_payment_plans')
      .select(`
        id, booking_id, mode, total_plan_amount, total_amount_paid, pending_balance, status, paid_100_pct_at_booking,
        booking_payment_plan_installments(
          id, installment_number, label, amount_due, amount_paid, due_date, status, penalty_applied, cfdi_invoice_id, paid_at
        )
      `)
      .eq('booking_id', bookingId)
      .maybeSingle();

    if (data) {
      const sortedInstallments = [...(data.booking_payment_plan_installments || [])].sort(
        (a, b) => new Date(a.due_date).getTime() - new Date(b.due_date).getTime()
      );
      setPlan({ ...data, installments: sortedInstallments } as BookingPaymentPlan);
    }
    setIsLoading(false);
  };

  useEffect(() => {
    fetchPlan();
  }, [bookingId]);

  const handlePay = async (installment: BookingPaymentPlanInstallment) => {
    if (!plan || !user) return;
    setIsProcessingPayment(true);
    setPaymentError('');
    setPaymentSuccess('');

    const amount = parseFloat(payAmount);
    if (!amount || amount <= 0) {
      setPaymentError('Ingresa un monto válido');
      setIsProcessingPayment(false);
      return;
    }

    try {
      const { data: { session } } = await supabase.auth.getSession();

      if (paymentProvider === 'paypal') {
        const ppRes = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/create-paypal-order`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${session?.access_token}`,
          },
          body: JSON.stringify({
            plan_id: plan.id,
            amount,
            effective_amount: amount,
            context: 'payment_plan_installment',
          }),
        });
        const ppResult = await ppRes.json();
        if (!ppRes.ok) {
          setPaymentError(ppResult.error || 'Error al crear orden de PayPal');
        } else if (ppResult.url) {
          window.location.href = ppResult.url;
        }
        return;
      }

      const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/process-payment-plan-installment`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session?.access_token}`,
        },
        body: JSON.stringify({
          plan_id: plan.id,
          amount,
          payment_method: paymentProvider,
        }),
      });

      const result = await res.json();

      if (!res.ok) {
        setPaymentError(result.error || 'Error al procesar el pago');
      } else if (result.url) {
        window.location.href = result.url;
      } else {
        setPaymentSuccess(result.message || 'Pago aplicado exitosamente');
        setPayingInstallmentId(null);
        setPayAmount('');
        await fetchPlan();
        onPaymentSuccess?.();
      }
    } catch (err) {
      setPaymentError(String(err));
    } finally {
      setIsProcessingPayment(false);
    }
  };

  const handlePayFull = async () => {
    if (!plan || !user) return;
    setIsProcessingPayment(true);
    setPaymentError('');

    try {
      const { data: { session } } = await supabase.auth.getSession();

      if (paymentProvider === 'paypal') {
        const ppRes = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/create-paypal-order`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${session?.access_token}`,
        },
        body: JSON.stringify({
          plan_id: plan.id,
          amount: plan.pending_balance,
          effective_amount: plan.pending_balance,
          context: 'payment_plan_installment',
          pay_full_balance: true,
        }),
        });
        const ppResult = await ppRes.json();
        if (!ppRes.ok) {
          setPaymentError(ppResult.error || 'Error al crear orden de PayPal');
        } else if (ppResult.url) {
          window.location.href = ppResult.url;
        }
        return;
      }

      const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/process-payment-plan-installment`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session?.access_token}`,
        },
        body: JSON.stringify({
          plan_id: plan.id,
          amount: plan.pending_balance,
          payment_method: paymentProvider,
          pay_full_balance: true,
        }),
      });

      const result = await res.json();
      if (!res.ok) {
        setPaymentError(result.error || 'Error al procesar el pago');
      } else if (result.url) {
        window.location.href = result.url;
      } else {
        setPaymentSuccess(result.message || 'Pago total completado');
        await fetchPlan();
        onPaymentSuccess?.();
      }
    } catch (err) {
      setPaymentError(String(err));
    } finally {
      setIsProcessingPayment(false);
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 py-3 text-gray-500">
        <Loader2 className="w-4 h-4 animate-spin" />
        <span className="text-sm">Cargando plan de pagos...</span>
      </div>
    );
  }

  if (!plan) return null;

  const progressPct = plan.total_plan_amount > 0
    ? Math.min(100, Math.round((plan.total_amount_paid / plan.total_plan_amount) * 100))
    : 0;

  const planStatusCfg = PLAN_STATUS_CONFIG[plan.status] || PLAN_STATUS_CONFIG.active;
  const hasOverdue = plan.installments?.some(i => ['overdue', 'overdue_grace'].includes(i.status));

  return (
    <div className={`rounded-xl border-2 overflow-hidden transition-all ${
      plan.status === 'completed' ? 'border-green-200' :
      hasOverdue ? 'border-red-200' :
      'border-sky-200'
    }`}>
      {/* Header */}
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className={`w-full flex items-center justify-between px-4 py-3 text-left transition-colors ${
          plan.status === 'completed' ? 'bg-green-50 hover:bg-green-100' :
          hasOverdue ? 'bg-red-50 hover:bg-red-100' :
          'bg-sky-50 hover:bg-sky-100'
        }`}
      >
        <div className="flex items-center gap-3">
          <div className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${
            plan.status === 'completed' ? 'bg-green-500 text-white' :
            hasOverdue ? 'bg-red-500 text-white' :
            'bg-sky-600 text-white'
          }`}>
            <CreditCard className="w-4 h-4" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="text-sm font-semibold text-gray-800">Plan de Pagos</span>
              <span className={`text-xs px-1.5 py-0.5 rounded-full font-medium ${planStatusCfg.color}`}>
                {planStatusCfg.label}
              </span>
            </div>
            <p className="text-xs text-gray-500">
              {formatCurrencyMXN(plan.total_amount_paid)} de {formatCurrencyMXN(plan.total_plan_amount)} pagados
              {plan.pending_balance > 0 && ` · Saldo: ${formatCurrencyMXN(plan.pending_balance)}`}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <div className="hidden sm:flex items-center gap-2">
            <div className="w-24 h-2 bg-gray-200 rounded-full overflow-hidden">
              <div
                className={`h-full rounded-full transition-all ${
                  plan.status === 'completed' ? 'bg-green-500' : hasOverdue ? 'bg-red-400' : 'bg-sky-500'
                }`}
                style={{ width: `${progressPct}%` }}
              />
            </div>
            <span className="text-xs text-gray-500 font-medium">{progressPct}%</span>
          </div>
          {isExpanded ? <ChevronUp className="w-4 h-4 text-gray-500" /> : <ChevronDown className="w-4 h-4 text-gray-500" />}
        </div>
      </button>

      {/* Body */}
      {isExpanded && (
        <div className="px-4 py-4 space-y-4 bg-white">
          {/* Progress bar mobile */}
          <div className="sm:hidden flex items-center gap-2">
            <div className="flex-1 h-2 bg-gray-200 rounded-full overflow-hidden">
              <div className={`h-full rounded-full ${plan.status === 'completed' ? 'bg-green-500' : hasOverdue ? 'bg-red-400' : 'bg-sky-500'}`} style={{ width: `${progressPct}%` }} />
            </div>
            <span className="text-xs text-gray-500 font-medium">{progressPct}%</span>
          </div>

          {/* Status messages */}
          {paymentError && (
            <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700 flex items-start gap-2">
              <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
              {paymentError}
            </div>
          )}
          {paymentSuccess && (
            <div className="p-3 bg-green-50 border border-green-200 rounded-lg text-sm text-green-700 flex items-start gap-2">
              <CheckCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
              {paymentSuccess}
            </div>
          )}

          {/* Installments list */}
          <div className="space-y-2">
            {plan.installments?.map((inst) => {
              const statusCfg = INSTALLMENT_STATUS_CONFIG[inst.status] || INSTALLMENT_STATUS_CONFIG.pending;
              const amountOwed = inst.amount_due + inst.penalty_applied - inst.amount_paid;
              const isPaying = payingInstallmentId === inst.id;
              const canPay = !agencyView && plan.status === 'active' && ['pending', 'overdue', 'overdue_grace', 'partially_paid'].includes(inst.status);

              return (
                <div key={inst.id} className={`rounded-lg border p-3 transition-all ${
                  inst.status === 'paid' ? 'border-green-200 bg-green-50' :
                  inst.status === 'overdue' ? 'border-red-200 bg-red-50' :
                  inst.status === 'overdue_grace' ? 'border-amber-200 bg-amber-50' :
                  'border-gray-200 bg-gray-50'
                }`}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-semibold text-gray-800 truncate">{inst.label}</span>
                        <span className={`inline-flex items-center gap-1 text-xs px-1.5 py-0.5 rounded-full font-medium ${statusCfg.color}`}>
                          {statusCfg.icon}
                          {statusCfg.label}
                        </span>
                      </div>
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 mt-1">
                        <span className="text-xs text-gray-500 flex items-center gap-1">
                          <Calendar className="w-3 h-3" />
                          Vence: {format(parseISO(inst.due_date), 'd MMM yyyy', { locale: es })}
                        </span>
                        <span className="text-xs font-semibold text-gray-700">
                          {formatCurrencyMXN(inst.amount_due)}
                          {inst.penalty_applied > 0 && (
                            <span className="text-red-600 ml-1">+{formatCurrencyMXN(inst.penalty_applied)} penalización</span>
                          )}
                        </span>
                        {inst.amount_paid > 0 && inst.status !== 'paid' && (
                          <span className="text-xs text-blue-600">Pagado: {formatCurrencyMXN(inst.amount_paid)}</span>
                        )}
                      </div>
                      {inst.status === 'paid' && inst.paid_at && (
                        <p className="text-xs text-green-600 mt-0.5">
                          Pagado el {format(parseISO(inst.paid_at), 'd MMM yyyy', { locale: es })}
                        </p>
                      )}
                    </div>

                    <div className="flex items-center gap-2 flex-shrink-0">
                      {inst.cfdi_invoice_id && (
                        <span title="CFDI generado">
                          <Receipt className="w-4 h-4 text-indigo-500" />
                        </span>
                      )}
                      {canPay && !isPaying && (
                        <button
                          onClick={() => {
                            setPayingInstallmentId(inst.id);
                            setPayAmount(amountOwed.toFixed(2));
                            setPaymentError('');
                            setPaymentSuccess('');
                          }}
                          className="text-xs text-sky-600 font-semibold hover:text-sky-800 underline whitespace-nowrap"
                        >
                          Pagar
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Inline payment form */}
                  {isPaying && (
                    <div className="mt-3 pt-3 border-t border-gray-200 space-y-3">
                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <label className="block text-xs text-gray-600 mb-1 font-medium">Monto a pagar</label>
                          <input
                            type="number"
                            min={0.01}
                            step={0.01}
                            max={amountOwed}
                            value={payAmount}
                            onChange={(e) => setPayAmount(e.target.value)}
                            className="input input-sm w-full text-sm"
                          />
                          <p className="text-xs text-gray-400 mt-0.5">Adeudo: {formatCurrencyMXN(amountOwed)}</p>
                        </div>
                        <div>
                          <label className="block text-xs text-gray-600 mb-1 font-medium">Método de pago</label>
                          <select
                            value={paymentProvider}
                            onChange={(e) => setPaymentProvider(e.target.value as any)}
                            className="input input-sm w-full text-sm"
                          >
                            <option value="stripe">Tarjeta (Stripe)</option>
                            <option value="toursred_cash">ToursRed Cash</option>
                            <option value="mercadopago">MercadoPago</option>
                            <option value="paypal">PayPal</option>
                          </select>
                        </div>
                      </div>
                      <div className="flex gap-2">
                        <button
                          type="button"
                          onClick={() => handlePay(inst)}
                          disabled={isProcessingPayment}
                          className="flex-1 btn btn-primary btn-sm text-xs"
                        >
                          {isProcessingPayment ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : 'Confirmar pago'}
                        </button>
                        <button
                          type="button"
                          onClick={() => { setPayingInstallmentId(null); setPaymentError(''); }}
                          className="btn btn-outline btn-sm text-xs"
                        >
                          Cancelar
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* Pay full balance button */}
          {!agencyView && plan.status === 'active' && plan.pending_balance > 0 && (
            <div className="pt-2 border-t border-gray-100">
              <div className="flex items-center justify-between flex-wrap gap-3">
                <div>
                  <p className="text-sm font-semibold text-gray-700">Liquidar saldo total</p>
                  <p className="text-xs text-gray-500">Pagar {formatCurrencyMXN(plan.pending_balance)} restantes de una vez</p>
                </div>
                <div className="flex items-center gap-2">
                  <select
                    value={paymentProvider}
                    onChange={(e) => setPaymentProvider(e.target.value as any)}
                    className="input input-sm text-xs"
                  >
                    <option value="stripe">Tarjeta</option>
                    <option value="toursred_cash">ToursRed Cash</option>
                    <option value="mercadopago">MercadoPago</option>
                    <option value="paypal">PayPal</option>
                  </select>
                  <button
                    type="button"
                    onClick={handlePayFull}
                    disabled={isProcessingPayment}
                    className="btn btn-primary btn-sm text-xs whitespace-nowrap"
                  >
                    {isProcessingPayment ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : `Pagar ${formatCurrencyMXN(plan.pending_balance)}`}
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default PaymentPlanCalendar;
