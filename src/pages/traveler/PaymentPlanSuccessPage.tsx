import React, { useEffect, useState } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import { CheckCircle, Calendar, CreditCard, Award, ArrowRight, Loader, TrendingDown } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import { formatCurrencyMXN } from '../../utils/formatCurrency';

const MAX_POLL_ATTEMPTS = 12;
const POLL_INTERVAL_MS = 2000;

const PaymentPlanSuccessPage: React.FC = () => {
  const [searchParams] = useSearchParams();
  const [plan, setPlan] = useState<any>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    const planId = searchParams.get('plan_id');
    if (!planId) {
      setError('ID del plan de pago no encontrado');
      setIsLoading(false);
      return;
    }
    pollForUpdatedPlan(planId, 0);
  }, [searchParams]);

  const pollForUpdatedPlan = async (planId: string, attempt: number) => {
    try {
      const { data } = await supabase
        .from('booking_payment_plans')
        .select(`
          id, status, total_plan_amount, total_amount_paid, pending_balance, updated_at,
          bookings!inner(
            id, booking_code, total_price, selected_date,
            tours!inner(name, destination, image_url, agencies(name))
          )
        `)
        .eq('id', planId)
        .maybeSingle();

      if (!data) {
        setError('Plan de pago no encontrado');
        setIsLoading(false);
        return;
      }

      const recentTx = await supabase
        .from('booking_payment_plan_transactions')
        .select('id, amount, service_charge, payment_provider, points_earned, created_at')
        .eq('plan_id', planId)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      const hasRecentPayment = recentTx.data && Date.now() - new Date(recentTx.data.created_at).getTime() < 5 * 60 * 1000;

      if (hasRecentPayment || attempt >= MAX_POLL_ATTEMPTS) {
        setPlan({ ...data, lastTransaction: recentTx.data });
        setIsLoading(false);
        return;
      }

      setTimeout(() => pollForUpdatedPlan(planId, attempt + 1), POLL_INTERVAL_MS);
    } catch {
      setError('Error al cargar los detalles del pago');
      setIsLoading(false);
    }
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gray-50 flex flex-col items-center justify-center gap-4">
        <Loader className="w-10 h-10 text-blue-600 animate-spin" />
        <p className="text-gray-600 font-medium">Confirmando tu pago...</p>
        <p className="text-sm text-gray-400">Esto puede tomar unos segundos.</p>
      </div>
    );
  }

  if (error || !plan) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center py-12 px-4">
        <div className="max-w-md w-full text-center bg-white rounded-xl shadow-md p-8">
          <h2 className="text-xl font-semibold text-red-600 mb-2">Error</h2>
          <p className="text-gray-600 mb-6">{error || 'No se pudieron cargar los detalles'}</p>
          <Link to="/traveler/bookings" className="inline-flex items-center gap-2 bg-blue-600 text-white font-semibold px-6 py-3 rounded-xl hover:bg-blue-700 transition-colors">
            Ver Mis Reservas
          </Link>
        </div>
      </div>
    );
  }

  const tour = (plan.bookings as any)?.tours;
  const agency = tour?.agencies;
  const booking = plan.bookings as any;
  const isComplete = plan.status === 'completed';
  const lastTx = plan.lastTransaction;

  const methodLabel: Record<string, string> = {
    stripe: 'Tarjeta de Crédito/Débito',
    toursred_cash: 'ToursRed Cash',
    points: 'Puntos ToursRed',
    mercadopago: 'MercadoPago',
    paypal: 'PayPal',
  };

  const progressPct = plan.total_plan_amount > 0
    ? Math.min(100, Math.round((Number(plan.total_amount_paid) / Number(plan.total_plan_amount)) * 100))
    : 0;

  return (
    <div className="min-h-screen bg-gray-50 py-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-2xl mx-auto space-y-6">

        {/* Header */}
        <div className="text-center">
          <div className={`mx-auto flex items-center justify-center h-16 w-16 rounded-full mb-4 ${isComplete ? 'bg-green-100' : 'bg-blue-100'}`}>
            <CheckCircle className={`h-8 w-8 ${isComplete ? 'text-green-600' : 'text-blue-600'}`} />
          </div>
          <h1 className="text-3xl font-bold text-gray-900 mb-2">
            {isComplete ? '¡Plan Completado!' : '¡Pago Exitoso!'}
          </h1>
          <p className="text-lg text-gray-600">
            {isComplete
              ? 'Has completado el pago total de tu plan de pagos.'
              : 'Tu abono ha sido procesado correctamente.'}
          </p>
        </div>

        {/* Tour card */}
        {tour && (
          <div className="bg-white rounded-xl shadow-md overflow-hidden">
            {tour.image_url && (
              <div className="relative h-40">
                <img src={tour.image_url} alt={tour.name} className="w-full h-full object-cover" />
                <div className="absolute inset-0 bg-black/40 flex items-end">
                  <div className="p-4 text-white">
                    <p className="font-bold text-lg">{tour.name}</p>
                    <p className="text-sm opacity-90">{tour.destination}</p>
                  </div>
                </div>
              </div>
            )}
            <div className="p-5 flex items-center gap-3 border-t border-gray-100">
              <CreditCard className="w-5 h-5 text-gray-400 shrink-0" />
              <div>
                <p className="text-xs text-gray-500">Código de Reserva</p>
                <p className="font-bold text-blue-600 tracking-wide text-lg">{booking?.booking_code}</p>
              </div>
              {agency?.name && (
                <div className="ml-auto text-right">
                  <p className="text-xs text-gray-500">Agencia</p>
                  <p className="font-medium text-gray-800 text-sm">{agency.name}</p>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Payment details */}
        {lastTx && (
          <div className="bg-white rounded-xl shadow-md p-6 space-y-4">
            <div className="flex items-start gap-3">
              <div className="p-2 bg-blue-100 rounded-lg">
                <TrendingDown className="w-5 h-5 text-blue-600" />
              </div>
              <div className="flex-1">
                <p className="font-bold text-gray-900 text-lg">Detalle del Abono</p>
              </div>
            </div>

            <div className="border-t border-gray-100 pt-4 space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-gray-600">Monto del abono:</span>
                <span className="font-medium">{formatCurrencyMXN(Number(lastTx.amount))}</span>
              </div>
              {Number(lastTx.service_charge) > 0 && (
                <div className="flex justify-between">
                  <span className="text-gray-600">Cargo por servicio:</span>
                  <span className="font-medium">{formatCurrencyMXN(Number(lastTx.service_charge))}</span>
                </div>
              )}
              <div className="flex justify-between border-t border-gray-200 pt-2 text-base font-bold">
                <span className="text-green-600">Total pagado:</span>
                <span className="text-green-600">{formatCurrencyMXN(Number(lastTx.amount) + Number(lastTx.service_charge || 0))}</span>
              </div>
            </div>

            <div className="border-t border-gray-100 pt-4 grid grid-cols-2 gap-4 text-sm">
              <div>
                <p className="text-gray-500 text-xs mb-0.5">Método de Pago</p>
                <p className="font-medium text-gray-800">
                  {methodLabel[lastTx.payment_provider] || lastTx.payment_provider || 'Tarjeta'}
                </p>
              </div>
              <div>
                <p className="text-gray-500 text-xs mb-0.5 flex items-center gap-1">
                  <Calendar className="w-3 h-3" /> Fecha
                </p>
                <p className="font-medium text-gray-800">
                  {format(new Date(lastTx.created_at), "d 'de' MMMM yyyy", { locale: es })}
                </p>
              </div>
            </div>

            {Number(lastTx.points_earned) > 0 && (
              <div className="flex items-center justify-between bg-green-50 border border-green-200 rounded-lg px-4 py-3">
                <span className="text-green-700 font-medium flex items-center gap-1.5">
                  <Award className="w-4 h-4" />
                  Puntos ToursRed Ganados:
                </span>
                <span className="font-bold text-green-600">+{Number(lastTx.points_earned).toLocaleString()} puntos</span>
              </div>
            )}
          </div>
        )}

        {/* Plan progress */}
        <div className="bg-white rounded-xl shadow-md p-6 space-y-4">
          <p className="font-bold text-gray-900 text-lg">Resumen del Plan</p>

          <div className="space-y-3">
            <div className="flex justify-between text-sm">
              <span className="text-gray-600">Total del plan:</span>
              <span className="font-medium">{formatCurrencyMXN(Number(plan.total_plan_amount))}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-gray-600">Pagado acumulado:</span>
              <span className="font-medium text-green-600">{formatCurrencyMXN(Number(plan.total_amount_paid))}</span>
            </div>
            {!isComplete && (
              <div className="flex justify-between text-sm">
                <span className="text-gray-600">Saldo pendiente:</span>
                <span className="font-medium text-red-600">{formatCurrencyMXN(Number(plan.pending_balance))}</span>
              </div>
            )}
          </div>

          <div className="w-full bg-gray-200 rounded-full h-3 overflow-hidden">
            <div
              className={`h-full rounded-full transition-all duration-500 ${isComplete ? 'bg-green-500' : 'bg-blue-500'}`}
              style={{ width: `${progressPct}%` }}
            />
          </div>
          <p className="text-center text-sm font-medium text-gray-500">{progressPct}% completado</p>

          {isComplete && (
            <div className="bg-green-50 border border-green-200 rounded-lg px-4 py-3 text-center">
              <p className="text-green-700 font-medium">
                Tu reserva está completamente pagada.
              </p>
            </div>
          )}
        </div>

        {/* CTA */}
        <div className="flex justify-center gap-4">
          <Link
            to="/traveler/bookings"
            className="inline-flex items-center gap-2 bg-blue-600 text-white font-semibold px-8 py-3 rounded-xl hover:bg-blue-700 transition-colors shadow-sm"
          >
            Ver Mis Reservas
            <ArrowRight className="w-4 h-4" />
          </Link>
        </div>
      </div>
    </div>
  );
};

export default PaymentPlanSuccessPage;
