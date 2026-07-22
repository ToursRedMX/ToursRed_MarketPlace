import { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Crown, Check, X, Zap, Shield, Sparkles, AlertCircle, ArrowLeft, Calendar, MapPin, DollarSign } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { supabase } from '../../lib/supabase';
import { useMembershipPrices } from '../../hooks/useMembershipPrices';
import { formatCurrencyMXN, formatCurrency } from '../../utils/formatCurrency';

interface Membership {
  id: string;
  plan_type: 'monthly' | 'annual';
  status: string;
  start_date: string;
  current_period_end: string;
  cancel_at_period_end: boolean;
  cancelled_at: string | null;
  service_fee_exemption_used: number;
  exemption_period_start: string;
  service_fee_exemption_reset_date: string;
}

interface BookingWithBenefit {
  id: string;
  booking_code: string;
  created_at: string;
  paid_at: string | null;
  membership_service_fee_saved: number;
  used_membership_benefit: boolean;
  tour: {
    name: string;
    destination: string;
  };
}

export default function TravelerMembership() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [membership, setMembership] = useState<Membership | null>(null);
  const [bookingsWithBenefit, setBookingsWithBenefit] = useState<BookingWithBenefit[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const { prices, loading: pricesLoading } = useMembershipPrices();

  useEffect(() => {
    if (searchParams.get('success') === 'true') {
      setSuccessMessage('¡Suscripción exitosa! Tu membresía ToursRed+ está siendo activada.');
    }
    fetchMembership();
  }, [searchParams]);

  const fetchMembership = async () => {
    if (!user) return;

    try {
      await supabase.rpc('reset_monthly_service_fee_exemption');

      const { data, error } = await supabase
        .from('memberships')
        .select('*')
        .eq('user_id', user.id)
        .eq('status', 'active')
        .maybeSingle();

      if (error) throw error;
      setMembership(data);

      if (data) {
        await fetchBookingsWithBenefit(data.service_fee_exemption_reset_date);
      }
    } catch (err) {
      console.error('Error fetching membership:', err);
    } finally {
      setLoading(false);
    }
  };

  const fetchBookingsWithBenefit = async (resetDate: string) => {
    if (!user) return;

    try {
      // Derive the start of the current exemption period: 1st of current month
      // resetDate is set to the 1st of NEXT month, so subtract 1 month
      const reset = new Date(resetDate);
      const periodStart = new Date(reset);
      periodStart.setMonth(periodStart.getMonth() - 1);
      periodStart.setDate(1);
      periodStart.setHours(0, 0, 0, 0);

      const { data, error } = await supabase
        .from('bookings')
        .select(`
          id,
          booking_code,
          created_at,
          paid_at,
          membership_service_fee_saved,
          used_membership_benefit,
          tour:tours(name, destination)
        `)
        .eq('user_id', user.id)
        .eq('used_membership_benefit', true)
        .gte('paid_at', periodStart.toISOString())
        .order('paid_at', { ascending: false });

      if (error) throw error;
      setBookingsWithBenefit(data || []);
    } catch (err) {
      console.error('Error fetching bookings with benefit:', err);
    }
  };

  const handleSubscribe = (planType: 'monthly' | 'annual') => {
    navigate(`/traveler/membership/checkout?plan=${planType}`);
  };

  const handleManageSubscription = async (action: 'cancel' | 'reactivate' | 'upgrade') => {
    setActionLoading(true);
    setError(null);
    setSuccessMessage(null);

    try {
      const response = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/manage-membership-subscription`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${(await supabase.auth.getSession()).data.session?.access_token}`,
          },
          body: JSON.stringify({ action }),
        }
      );

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Error al gestionar la suscripción');
      }

      setSuccessMessage(data.message);
      await fetchMembership();
    } catch (err: any) {
      setError(err.message || 'Error al procesar la solicitud');
    } finally {
      setActionLoading(false);
    }
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('es-MX', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
  };

  const remainingExemption = membership
    ? Math.max(0, 500 - (membership.service_fee_exemption_used || 0))
    : 0;

  if (loading || pricesLoading || !prices) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-blue-50 to-white py-12">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="mb-6">
          <button
            onClick={() => navigate('/traveler/dashboard')}
            className="flex items-center gap-2 text-blue-600 hover:text-blue-700 font-medium transition-colors"
          >
            <ArrowLeft className="h-5 w-5" />
            Regresar al Dashboard
          </button>
        </div>

        <div className="text-center mb-12">
          <div className="inline-flex items-center justify-center mb-4">
            <Crown className="h-16 w-16 text-yellow-500" />
          </div>
          <h1 className="text-4xl font-bold text-gray-900 mb-4">
            ToursRed<span className="text-yellow-500">+</span>
          </h1>
          <p className="text-xl text-gray-600">
            Viaja más, ahorra más con beneficios exclusivos
          </p>
        </div>

        {successMessage && (
          <div className="max-w-2xl mx-auto mb-8 bg-green-50 border border-green-200 rounded-lg p-4 flex items-start gap-3">
            <Check className="h-5 w-5 text-green-600 flex-shrink-0 mt-0.5" />
            <p className="text-green-800">{successMessage}</p>
          </div>
        )}

        {error && (
          <div className="max-w-2xl mx-auto mb-8 bg-red-50 border border-red-200 rounded-lg p-4 flex items-start gap-3">
            <AlertCircle className="h-5 w-5 text-red-600 flex-shrink-0 mt-0.5" />
            <p className="text-red-800">{error}</p>
          </div>
        )}

        {membership && membership.status === 'active' ? (
          <div className="max-w-3xl mx-auto">
            <div className="bg-gradient-to-br from-yellow-400 via-yellow-500 to-yellow-600 rounded-2xl shadow-2xl p-8 text-white mb-8">
              <div className="flex items-center justify-between mb-6">
                <div className="flex items-center gap-3">
                  <Crown className="h-10 w-10" />
                  <div>
                    <h2 className="text-2xl font-bold">Membresía Activa</h2>
                    <p className="text-yellow-100">
                      Plan {membership.plan_type === 'monthly' ? 'Mensual' : 'Anual'}
                    </p>
                  </div>
                </div>
                <Sparkles className="h-12 w-12 opacity-50" />
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="bg-white/10 backdrop-blur-sm rounded-lg p-4">
                  <p className="text-yellow-100 text-sm mb-1">Inicio de membresía</p>
                  <p className="text-xl font-semibold">{formatDate(membership.start_date)}</p>
                </div>
                <div className="bg-white/10 backdrop-blur-sm rounded-lg p-4">
                  <p className="text-yellow-100 text-sm mb-1">
                    {membership.cancel_at_period_end ? 'Expira el' : 'Próxima renovación'}
                  </p>
                  <p className="text-xl font-semibold">{formatDate(membership.current_period_end)}</p>
                </div>
              </div>

              <div className="mt-6 bg-white/10 backdrop-blur-sm rounded-lg p-4">
                <div className="flex items-center justify-between mb-2">
                  <p className="text-yellow-100 text-sm">Exención de cargo por servicio disponible este mes</p>
                  <p className="text-2xl font-bold">{formatCurrencyMXN(remainingExemption)} MXN</p>
                </div>
                <div className="w-full bg-white/20 rounded-full h-2">
                  <div
                    className="bg-white rounded-full h-2 transition-all duration-300"
                    style={{ width: `${(remainingExemption / 500) * 100}%` }}
                  ></div>
                </div>
                <p className="text-yellow-100 text-xs mt-2">
                  De $500 MXN totales ({((remainingExemption / 500) * 100).toFixed(0)}% disponible)
                </p>
                <p className="text-yellow-100 text-xs mt-1">
                  Se resetea el: {formatDate(membership.service_fee_exemption_reset_date)}
                </p>
              </div>
            </div>

            <div className="bg-white rounded-xl shadow-md p-6 mb-6">
              <h3 className="text-lg font-semibold text-gray-900 mb-4">Tus Beneficios Activos</h3>
              <div className="space-y-3">
                <div className="flex items-start gap-3">
                  <Check className="h-5 w-5 text-green-600 flex-shrink-0 mt-0.5" />
                  <div>
                    <p className="font-medium text-gray-900">Sin cargo por servicio hasta $500 MXN/mes</p>
                    <p className="text-sm text-gray-600">Ahorra el 5% en tus reservas nacionales</p>
                  </div>
                </div>
                <div className="flex items-start gap-3">
                  <Zap className="h-5 w-5 text-yellow-600 flex-shrink-0 mt-0.5" />
                  <div>
                    <p className="font-medium text-gray-900">Soporte prioritario</p>
                    <p className="text-sm text-gray-600">Atención preferente en todas tus consultas</p>
                  </div>
                </div>
                <div className="flex items-start gap-3">
                  <Sparkles className="h-5 w-5 text-blue-600 flex-shrink-0 mt-0.5" />
                  <div>
                    <p className="font-medium text-gray-900">Ofertas exclusivas</p>
                    <p className="text-sm text-gray-600">Acceso a tours y descuentos especiales para miembros</p>
                  </div>
                </div>
              </div>
            </div>

            <div className="bg-white rounded-xl shadow-md p-6 mb-6">
              <h3 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
                <DollarSign className="h-5 w-5 text-green-600" />
                Reservas con Beneficio Aplicado Este Mes
              </h3>

              {bookingsWithBenefit.length > 0 ? (
                <>
                  <p className="text-sm text-gray-600 mb-4">
                    Has ahorrado el cargo por servicio en las siguientes reservas durante tu período de facturación actual:
                  </p>
                  <div className="space-y-3">
                    {bookingsWithBenefit.map((booking) => (
                      <div
                        key={booking.id}
                        className="border border-gray-200 rounded-lg p-4 hover:border-blue-300 transition-colors"
                      >
                        <div className="flex items-start justify-between">
                          <div className="flex-1">
                            <div className="flex items-center gap-2 mb-2">
                              <span className="text-xs font-mono bg-gray-100 text-gray-700 px-2 py-1 rounded">
                                {booking.booking_code}
                              </span>
                              <span className="text-xs text-gray-500">
                                {new Date(booking.paid_at || booking.created_at).toLocaleDateString('es-MX', {
                                  year: 'numeric',
                                  month: 'short',
                                  day: 'numeric',
                                })}
                              </span>
                            </div>
                            <h4 className="font-medium text-gray-900 mb-1">{booking.tour.name}</h4>
                            <p className="text-sm text-gray-600 flex items-center gap-1">
                              <MapPin className="h-4 w-4" />
                              {booking.tour.destination}
                            </p>
                          </div>
                          <div className="text-right ml-4">
                            <p className="text-xs text-gray-500 mb-1">Ahorro en cargo por servicio</p>
                            <p className="text-lg font-bold text-green-600">
                              {formatCurrencyMXN(booking.membership_service_fee_saved || 0)}
                            </p>
                            <p className="text-xs text-gray-500">¡Beneficio aplicado!</p>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                  <div className="mt-4 bg-green-50 border border-green-200 rounded-lg p-3">
                    <p className="text-sm text-green-800 font-medium">
                      Total ahorrado este mes: {formatCurrencyMXN(membership?.service_fee_exemption_used || 0)} MXN
                    </p>
                  </div>
                </>
              ) : (
                <div className="text-center py-8">
                  <div className="inline-flex items-center justify-center w-16 h-16 bg-gray-100 rounded-full mb-4">
                    <DollarSign className="h-8 w-8 text-gray-400" />
                  </div>
                  <p className="text-gray-600 mb-2">Aún no has usado tu beneficio este mes</p>
                  <p className="text-sm text-gray-500">
                    Tienes {formatCurrencyMXN(remainingExemption)} MXN disponibles para ahorrar en cargos por servicio
                  </p>
                </div>
              )}
            </div>

            <div className="bg-white rounded-xl shadow-md p-6">
              <h3 className="text-lg font-semibold text-gray-900 mb-4">Gestionar Suscripción</h3>

              {membership.plan_type === 'monthly' && !membership.cancel_at_period_end && (
                <div className="bg-gradient-to-r from-yellow-50 to-yellow-100 border border-yellow-300 rounded-lg p-4 mb-4">
                  <div className="flex items-start gap-3 mb-3">
                    <Crown className="h-6 w-6 text-yellow-600 flex-shrink-0" />
                    <div>
                      <p className="font-semibold text-gray-900 mb-1">Actualiza a Plan Anual y ahorra {prices.annualSavingsFormatted} MXN</p>
                      <p className="text-sm text-gray-700">
                        Al actualizar, se te cobrará de inmediato la diferencia prorrateada (el precio anual menos lo que ya pagaste este mes), y tu membresía se renovará cada 12 meses desde hoy. Precio anual: {prices.annualPriceFormatted} MXN (equivale a {prices.annualMonthlyEquivalentFormatted}/mes).
                      </p>
                    </div>
                  </div>
                  <button
                    onClick={() => handleManageSubscription('upgrade')}
                    disabled={actionLoading}
                    className="w-full bg-gradient-to-r from-yellow-500 to-yellow-600 text-white px-6 py-3 rounded-lg font-semibold hover:from-yellow-600 hover:to-yellow-700 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {actionLoading ? 'Procesando...' : 'Actualizar a Plan Anual'}
                  </button>
                </div>
              )}

              {membership.cancel_at_period_end ? (
                <div>
                  <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4 mb-4">
                    <p className="text-yellow-800 text-sm">
                      Tu suscripción se cancelará al final del período actual ({formatDate(membership.current_period_end)}).
                      Podrás seguir disfrutando de los beneficios hasta esa fecha.
                    </p>
                  </div>
                  <button
                    onClick={() => handleManageSubscription('reactivate')}
                    disabled={actionLoading}
                    className="w-full bg-green-600 text-white px-6 py-3 rounded-lg font-semibold hover:bg-green-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {actionLoading ? 'Procesando...' : 'Reactivar Renovación Automática'}
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => handleManageSubscription('cancel')}
                  disabled={actionLoading}
                  className="w-full bg-red-600 text-white px-6 py-3 rounded-lg font-semibold hover:bg-red-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {actionLoading ? 'Procesando...' : 'Cancelar Renovación Automática'}
                </button>
              )}
              <p className="text-xs text-gray-500 text-center mt-2">
                Al cancelar, mantendrás tu membresía hasta el final del período de facturación actual
              </p>
            </div>
          </div>
        ) : (
          <div className="grid md:grid-cols-2 gap-8 max-w-5xl mx-auto">
            <div className="bg-white rounded-2xl shadow-xl p-8 border-2 border-gray-200 hover:border-blue-500 transition-all duration-300">
              <div className="text-center mb-6">
                <h3 className="text-2xl font-bold text-gray-900 mb-2">Plan Mensual</h3>
                <div className="flex items-baseline justify-center gap-2">
                  <span className="text-5xl font-bold text-blue-600">{prices.monthlyPriceFormatted}</span>
                  <span className="text-gray-600">MXN/mes</span>
                </div>
              </div>

              <ul className="space-y-4 mb-8">
                <li className="flex items-start gap-3">
                  <Check className="h-5 w-5 text-green-600 flex-shrink-0 mt-0.5" />
                  <span className="text-gray-700">Sin cargo por servicio hasta $500 MXN/mes en reservas nacionales</span>
                </li>
                <li className="flex items-start gap-3">
                  <Check className="h-5 w-5 text-green-600 flex-shrink-0 mt-0.5" />
                  <span className="text-gray-700">Acumula 1 punto por cada peso gastado en tours</span>
                </li>
                <li className="flex items-start gap-3">
                  <Check className="h-5 w-5 text-green-600 flex-shrink-0 mt-0.5" />
                  <span className="text-gray-700">Usa tus puntos para pagar hasta el 50% de tu reserva</span>
                </li>
                <li className="flex items-start gap-3">
                  <Check className="h-5 w-5 text-green-600 flex-shrink-0 mt-0.5" />
                  <span className="text-gray-700">Soporte prioritario</span>
                </li>
                <li className="flex items-start gap-3">
                  <Check className="h-5 w-5 text-green-600 flex-shrink-0 mt-0.5" />
                  <span className="text-gray-700">Ofertas exclusivas</span>
                </li>
                <li className="flex items-start gap-3">
                  <Check className="h-5 w-5 text-green-600 flex-shrink-0 mt-0.5" />
                  <span className="text-gray-700">Cancela cuando quieras</span>
                </li>
              </ul>

              <button
                onClick={() => handleSubscribe('monthly')}
                className="w-full bg-blue-600 text-white px-6 py-3 rounded-lg font-semibold hover:bg-blue-700 transition-colors"
              >
                Suscribirme Mensualmente
              </button>
            </div>

            <div className="bg-gradient-to-br from-yellow-400 via-yellow-500 to-yellow-600 rounded-2xl shadow-2xl p-8 text-white relative overflow-hidden transform hover:scale-105 transition-transform duration-300">
              <div className="absolute top-4 right-4 bg-red-500 text-white px-4 py-1 rounded-full text-sm font-semibold">
                Ahorra {prices.annualSavingsFormatted}
              </div>

              <div className="text-center mb-6">
                <h3 className="text-2xl font-bold mb-2">Plan Anual</h3>
                <div className="flex items-baseline justify-center gap-2">
                  <span className="text-5xl font-bold">{prices.annualPriceFormatted}</span>
                  <span className="text-yellow-100">MXN/año</span>
                </div>
                <p className="text-yellow-100 text-sm mt-2">Solo {prices.annualMonthlyEquivalentFormatted} MXN/mes</p>
              </div>

              <ul className="space-y-4 mb-8">
                <li className="flex items-start gap-3">
                  <Check className="h-5 w-5 text-white flex-shrink-0 mt-0.5" />
                  <span>Sin cargo por servicio hasta $500 MXN/mes en reservas nacionales</span>
                </li>
                <li className="flex items-start gap-3">
                  <Check className="h-5 w-5 text-white flex-shrink-0 mt-0.5" />
                  <span>Acumula 1 punto por cada peso gastado en tours</span>
                </li>
                <li className="flex items-start gap-3">
                  <Check className="h-5 w-5 text-white flex-shrink-0 mt-0.5" />
                  <span>Usa tus puntos para pagar hasta el 50% de tu reserva</span>
                </li>
                <li className="flex items-start gap-3">
                  <Check className="h-5 w-5 text-white flex-shrink-0 mt-0.5" />
                  <span>Soporte prioritario</span>
                </li>
                <li className="flex items-start gap-3">
                  <Check className="h-5 w-5 text-white flex-shrink-0 mt-0.5" />
                  <span>Ofertas exclusivas</span>
                </li>
                <li className="flex items-start gap-3">
                  <Crown className="h-5 w-5 text-white flex-shrink-0 mt-0.5" />
                  <span className="font-semibold">2 meses GRATIS ({prices.annualSavingsFormatted} de ahorro)</span>
                </li>
              </ul>

              <button
                onClick={() => handleSubscribe('annual')}
                className="w-full bg-white text-yellow-600 px-6 py-3 rounded-lg font-semibold hover:bg-yellow-50 transition-colors"
              >
                Suscribirme Anualmente
              </button>
            </div>
          </div>
        )}

        <div className="max-w-4xl mx-auto mt-12 bg-blue-50 border border-blue-200 rounded-xl p-8">
          <div className="flex items-start gap-4">
            <Shield className="h-8 w-8 text-blue-600 flex-shrink-0" />
            <div>
              <h3 className="text-lg font-semibold text-gray-900 mb-2">¿Cómo funciona la exención de cargo por servicio?</h3>
              <p className="text-gray-700 mb-4">
                Como miembro de ToursRed+, no pagas el cargo por servicio del 5% en tus reservas nacionales hasta un monto acumulado de $500 MXN por mes.
                El contador se resetea automáticamente cada 30 días desde que iniciaste tu membresía o desde el último reset.
              </p>
              <p className="text-gray-700 text-sm mb-3">
                <strong>Ejemplo:</strong> Si reservas un tour nacional de $1,000 MXN, normalmente pagarías $50 MXN de cargo por servicio.
                Con ToursRed+, ¡ese cargo es $0! Y aún te quedarían $450 MXN de exención disponible para el mes.
              </p>
              <p className="text-gray-700 text-sm">
                <strong>Nota:</strong> Los $500 mensuales son independientes del tipo de plan (mensual o anual).
                Todos los miembros de ToursRed+ obtienen $500 de exención cada mes.
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
