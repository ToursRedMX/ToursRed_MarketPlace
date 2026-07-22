import React, { useState, useEffect } from 'react';
import { Calendar, MapPin, Heart, Clock, CheckCircle, Crown, Sparkles, Wallet, Award, Gift, Copy, ExternalLink } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { formatCurrency, formatCurrencyMXN } from '../../utils/formatCurrency';
import { supabase } from '../../lib/supabase';
import { Link } from 'react-router-dom';

interface Booking {
  id: string;
  tour_id: string;
  slot_id: string | null;
  booking_date: string;
  status: string;
  total_price: number;
  tours: {
    id: string;
    name: string;
    destination: string;
    start_date: string | null;
    end_date: string | null;
    image_url: string;
    tour_type: string;
    agencies: {
      name: string;
    };
  };
  tour_slots?: {
    slot_date: string;
    departure_time: string | null;
  } | null;
}

interface SavedTour {
  id: string;
  tour_id: string;
  created_at: string;
  tours: {
    id: string;
    name: string;
    destination: string;
    start_date: string;
    end_date: string;
    price: number;
    image_url: string;
    agencies: {
      name: string;
    };
  };
}

interface Membership {
  id: string;
  plan_type: 'monthly' | 'annual';
  status: string;
  current_period_end: string;
  service_fee_exemption_used: number;
  cancel_at_period_end: boolean;
}

const TravelerDashboard: React.FC = () => {
  const { user } = useAuth();
  const [upcomingBookings, setUpcomingBookings] = useState<Booking[]>([]);
  const [savedTours, setSavedTours] = useState<SavedTour[]>([]);
  const [membership, setMembership] = useState<Membership | null>(null);
  const [walletBalance, setWalletBalance] = useState<number>(0);
  const [pointsBalance, setPointsBalance] = useState<number>(0);
  const [pointsWalletActive, setPointsWalletActive] = useState<boolean>(false);
  const [isLoading, setIsLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [showCancelModal, setShowCancelModal] = useState(false);
  const [showUpgradeModal, setShowUpgradeModal] = useState(false);
  const [referralCode, setReferralCode] = useState<string>('');
  const [referralStats, setReferralStats] = useState<{completed: number; max: number; points: number}>({completed: 0, max: 10, points: 0});
  const [copySuccess, setCopySuccess] = useState(false);

  useEffect(() => {
    if (user) {
      loadDashboardData();
    }
  }, [user?.id]);

  const loadDashboardData = async () => {
    if (!user) return;

    setIsLoading(true);
    try {
      const today = new Date().toISOString().split('T')[0];
      const todayDate = new Date(today);

      const [
        bookingsResult,
        savedResult,
        membershipResult,
        walletResult,
        pointsWalletResult,
        referralResult,
      ] = await Promise.all([
        supabase
          .from('bookings')
          .select(`
            *,
            tours!inner (
              id,
              name,
              destination,
              start_date,
              end_date,
              image_url,
              tour_type,
              agencies (name)
            ),
            tour_slots!bookings_slot_id_fkey (
              slot_date,
              departure_time
            )
          `)
          .eq('user_id', user.id)
          .eq('status', 'confirmed'),
        supabase
          .from('saved_tours')
          .select(`
            *,
            tours (
              id,
              name,
              destination,
              start_date,
              end_date,
              price,
              image_url,
              agencies (name)
            )
          `)
          .eq('user_id', user.id)
          .order('created_at', { ascending: false })
          .limit(6),
        supabase
          .from('memberships')
          .select('*')
          .eq('user_id', user.id)
          .eq('status', 'active')
          .maybeSingle(),
        supabase
          .from('toursred_cash_wallets')
          .select('balance')
          .eq('user_id', user.id)
          .maybeSingle(),
        supabase
          .from('toursred_points_wallets')
          .select('balance, is_active')
          .eq('user_id', user.id)
          .maybeSingle(),
        supabase
          .from('referral_codes')
          .select('code, successful_referrals_count, max_referrals_allowed')
          .eq('user_id', user.id)
          .maybeSingle(),
      ]);

      if (bookingsResult.error) throw bookingsResult.error;

      const filteredBookings = (bookingsResult.data || [])
        .filter(booking => {
          const isReceptivo = booking.tours.tour_type === 'receptivo';
          if (isReceptivo) {
            const slotDate = booking.tour_slots?.slot_date;
            if (!slotDate) return false;
            return new Date(slotDate) >= todayDate;
          } else {
            const startDate = booking.tours.start_date;
            if (!startDate) return false;
            return new Date(startDate) >= todayDate;
          }
        })
        .sort((a, b) => {
          const isReceptivoA = a.tours.tour_type === 'receptivo';
          const isReceptivoB = b.tours.tour_type === 'receptivo';
          const dateA = new Date(isReceptivoA ? (a.tour_slots?.slot_date || a.tours.start_date || '') : (a.tours.start_date || ''));
          const dateB = new Date(isReceptivoB ? (b.tour_slots?.slot_date || b.tours.start_date || '') : (b.tours.start_date || ''));
          return dateA.getTime() - dateB.getTime();
        })
        .slice(0, 5);

      setUpcomingBookings(filteredBookings);

      if (savedResult.error) throw savedResult.error;
      const todayStr = new Date().toISOString().split('T')[0];
      const futureSaved = (savedResult.data || []).filter(s => {
        const d = s.tours?.start_date;
        return d && d >= todayStr;
      });
      setSavedTours(futureSaved);

      if (membershipResult.error) {
        console.error('Error fetching membership:', membershipResult.error);
      } else {
        setMembership(membershipResult.data);
      }

      if (walletResult.error) {
        console.error('Error fetching wallet:', walletResult.error);
      } else {
        setWalletBalance(walletResult.data?.balance ? Number(walletResult.data.balance) : 0);
      }

      if (pointsWalletResult.error) {
        console.error('Error fetching points wallet:', pointsWalletResult.error);
      } else if (pointsWalletResult.data) {
        setPointsBalance(pointsWalletResult.data.balance || 0);
      }

      setPointsWalletActive(membershipResult.data?.status === 'active' || false);

      const referralData = referralResult.data;
      if (referralData) {
        setReferralCode(referralData.code);

        const { data: bonusData } = await supabase
          .from('referral_bonuses')
          .select('points_amount')
          .eq('user_id', user.id)
          .eq('status', 'awarded');

        const totalPointsFromReferrals = bonusData?.reduce((sum, b) => sum + b.points_amount, 0) || 0;

        setReferralStats({
          completed: referralData.successful_referrals_count,
          max: referralData.max_referrals_allowed,
          points: totalPointsFromReferrals
        });
      }
    } catch (error) {
      console.error('Error loading dashboard data:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleDateString('es-ES', {
      year: 'numeric',
      month: 'short',
      day: 'numeric'
    });
  };

  const handleCopyReferralCode = () => {
    if (referralCode) {
      navigator.clipboard.writeText(referralCode);
      setCopySuccess(true);
      setTimeout(() => setCopySuccess(false), 2000);
    }
  };

  const removeSavedTour = async (tourId: string) => {
    if (!user) return;

    try {
      const { error } = await supabase
        .from('saved_tours')
        .delete()
        .eq('user_id', user.id)
        .eq('tour_id', tourId);

      if (error) throw error;
      setSavedTours(savedTours.filter(st => st.tour_id !== tourId));
    } catch (error) {
      console.error('Error removing saved tour:', error);
      alert('Error al quitar el tour guardado');
    }
  };

  const handleCancelSubscription = async () => {
    if (!user) return;
    setActionLoading(true);

    try {
      const response = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/manage-membership-subscription`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${(await supabase.auth.getSession()).data.session?.access_token}`,
          },
          body: JSON.stringify({ action: 'cancel' }),
        }
      );

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Error al cancelar la suscripción');
      }

      alert('Tu suscripción se cancelará al final del período actual. Seguirás teniendo acceso a los beneficios hasta esa fecha.');
      setShowCancelModal(false);
      await loadDashboardData();
    } catch (error: any) {
      console.error('Error cancelling subscription:', error);
      alert(error.message || 'Error al cancelar la suscripción');
    } finally {
      setActionLoading(false);
    }
  };

  const handleUpgradeSubscription = async () => {
    if (!user) return;
    setActionLoading(true);

    try {
      const response = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/manage-membership-subscription`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${(await supabase.auth.getSession()).data.session?.access_token}`,
          },
          body: JSON.stringify({ action: 'upgrade' }),
        }
      );

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Error al actualizar la suscripción');
      }

      alert('¡Tu plan se actualizó a Anual! Se cobró la diferencia prorrateada por los días restantes de tu mes actual. Tu membresía anual es válida por 12 meses desde hoy.');
      setShowUpgradeModal(false);
      await loadDashboardData();
    } catch (error: any) {
      console.error('Error upgrading subscription:', error);
      alert(error.message || 'Error al actualizar la suscripción');
    } finally {
      setActionLoading(false);
    }
  };

  const handleReactivateSubscription = async () => {
    if (!user) return;
    setActionLoading(true);

    try {
      const response = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/manage-membership-subscription`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${(await supabase.auth.getSession()).data.session?.access_token}`,
          },
          body: JSON.stringify({ action: 'reactivate' }),
        }
      );

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Error al reactivar la suscripción');
      }

      alert('¡Tu suscripción ha sido reactivada! Seguirás disfrutando de los beneficios ToursRed+.');
      await loadDashboardData();
    } catch (error: any) {
      console.error('Error reactivating subscription:', error);
      alert(error.message || 'Error al reactivar la suscripción');
    } finally {
      setActionLoading(false);
    }
  };

  if (isLoading) {
    return (
      <div className="container mx-auto px-4 py-8">
        <div className="flex justify-center items-center min-h-[400px]">
          <div className="text-gray-600">Cargando...</div>
        </div>
      </div>
    );
  }

  return (
    <div className="container mx-auto px-4 py-8">
      <h1 className="text-3xl font-bold mb-8">Panel del Viajero</h1>

      {membership ? (
        <div className="mb-8 bg-gradient-to-r from-yellow-400 via-yellow-500 to-yellow-600 rounded-xl shadow-lg p-6 text-white">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <Crown className="h-12 w-12" />
              <div>
                <h3 className="text-2xl font-bold flex items-center gap-2">
                  ToursRed+ Activo
                  <Sparkles className="h-5 w-5" />
                </h3>
                <p className="text-yellow-100">
                  Plan {membership.plan_type === 'monthly' ? 'Mensual' : 'Anual'}
                  {membership.cancel_at_period_end && (
                    <span className="ml-2 text-xs bg-white/20 px-2 py-1 rounded">
                      Se cancela el {formatDate(membership.current_period_end)}
                    </span>
                  )}
                </p>
              </div>
            </div>
            <div className="text-right">
              <p className="text-yellow-100 text-sm mb-1">Exención disponible</p>
              <p className="text-3xl font-bold">
                ${Math.max(0, 500 - (membership.service_fee_exemption_used || 0)).toFixed(0)} MXN
              </p>
              <p className="text-yellow-100 text-xs">de $500 este mes</p>
            </div>
          </div>
          <div className="mt-4">
            <div className="flex-1 mb-4">
              <div className="w-full bg-white/20 rounded-full h-2">
                <div
                  className="bg-white rounded-full h-2 transition-all duration-300"
                  style={{ width: `${((500 - (membership.service_fee_exemption_used || 0)) / 500) * 100}%` }}
                ></div>
              </div>
            </div>
            {membership.cancel_at_period_end && (
              <div className="mb-4 bg-white/20 border border-white/40 rounded-lg p-3">
                <p className="text-sm text-white">
                  <strong>Renovación automática desactivada.</strong> Puedes seguir disfrutando de los beneficios hasta el {formatDate(membership.current_period_end)}.
                </p>
              </div>
            )}
            <div className="flex gap-2 flex-wrap">
              <Link
                to="/traveler/membership"
                className="bg-white text-yellow-600 px-4 py-2 rounded-lg font-semibold hover:bg-yellow-50 transition-colors text-sm"
              >
                Ver Detalles
              </Link>
              {membership.plan_type === 'monthly' && (
                <button
                  onClick={() => setShowUpgradeModal(true)}
                  className="bg-white/90 text-yellow-700 px-4 py-2 rounded-lg font-semibold hover:bg-white transition-colors text-sm"
                >
                  Actualizar a Anual (Ahorra $98)
                </button>
              )}
              {!membership.cancel_at_period_end ? (
                <button
                  onClick={() => setShowCancelModal(true)}
                  className="bg-white/20 text-white px-4 py-2 rounded-lg font-semibold hover:bg-white/30 transition-colors text-sm border border-white/40"
                >
                  Cancelar Membresía
                </button>
              ) : (
                <button
                  onClick={handleReactivateSubscription}
                  disabled={actionLoading}
                  className="bg-green-500 text-white px-4 py-2 rounded-lg font-semibold hover:bg-green-600 transition-colors text-sm disabled:opacity-50"
                >
                  {actionLoading ? 'Procesando...' : 'Reactivar Membresía'}
                </button>
              )}
            </div>
          </div>
        </div>
      ) : (
        <div className="mb-8 bg-gradient-to-r from-blue-600 to-blue-700 rounded-xl shadow-lg p-6 text-white">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <Crown className="h-12 w-12" />
              <div>
                <h3 className="text-2xl font-bold">Descubre ToursRed+</h3>
                <p className="text-blue-100">
                  Viaja más y ahorra en cada reserva con beneficios exclusivos
                </p>
              </div>
            </div>
            <Link
              to="/traveler/membership"
              className="bg-white text-blue-600 px-6 py-3 rounded-lg font-semibold hover:bg-blue-50 transition-colors shadow-md"
            >
              Ver Planes
            </Link>
          </div>
          <div className="mt-4 grid grid-cols-3 gap-4">
            <div className="bg-white/10 backdrop-blur-sm rounded-lg p-3">
              <p className="text-sm text-blue-100 mb-1">Sin cargo por servicio</p>
              <p className="font-semibold">Hasta $500/mes</p>
            </div>
            <div className="bg-white/10 backdrop-blur-sm rounded-lg p-3">
              <p className="text-sm text-blue-100 mb-1">Soporte</p>
              <p className="font-semibold">Prioritario</p>
            </div>
            <div className="bg-white/10 backdrop-blur-sm rounded-lg p-3">
              <p className="text-sm text-blue-100 mb-1">Ofertas</p>
              <p className="font-semibold">Exclusivas</p>
            </div>
          </div>
        </div>
      )}

      {/* ToursRed Cash Wallet */}
      <div className="mb-8 bg-gradient-to-br from-accent-500 via-accent-600 to-orange-600 rounded-xl shadow-lg p-6 text-white">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className="bg-white/20 backdrop-blur-sm rounded-full p-3">
              <Wallet className="h-8 w-8" />
            </div>
            <div>
              <h3 className="text-xl font-bold">ToursRed Cash</h3>
              <p className="text-accent-100 text-sm">Saldo disponible en tu monedero</p>
            </div>
          </div>
          <div className="text-right">
            <p className="text-4xl font-bold">
              {formatCurrencyMXN(walletBalance)}
            </p>
            <p className="text-accent-100 text-sm mt-1">MXN</p>
          </div>
        </div>
        <div className="mt-4">
          <Link
            to="/traveler/wallet"
            className="block bg-white text-accent-600 px-4 py-2.5 rounded-lg font-semibold hover:bg-accent-50 transition-colors text-center text-sm"
          >
            Ver Movimientos
          </Link>
        </div>
        <div className="mt-3 bg-white/10 backdrop-blur-sm rounded-lg p-3 text-xs text-accent-100">
          <p>Usa tu saldo ToursRed Cash para pagar tus próximas reservas o recibe reembolsos y bonificaciones directamente aquí.</p>
        </div>
      </div>

      {/* ToursRed Points Card */}
      {membership && (
        <div className={`mb-8 rounded-xl shadow-lg p-6 text-white ${
          pointsWalletActive
            ? 'bg-gradient-to-br from-amber-500 via-amber-600 to-yellow-600'
            : 'bg-gradient-to-br from-gray-400 via-gray-500 to-gray-600'
        }`}>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <div className="bg-white/20 backdrop-blur-sm rounded-full p-3">
                <Award className="h-8 w-8" />
              </div>
              <div>
                <h3 className="text-xl font-bold">ToursRed Points</h3>
                <p className="text-amber-100 text-sm">
                  {pointsWalletActive ? 'Programa de lealtad activo' : 'Requiere membresía activa'}
                </p>
              </div>
            </div>
            <div className="text-right">
              <p className="text-4xl font-bold">
                {pointsBalance.toLocaleString()}
              </p>
              <p className="text-amber-100 text-sm mt-1">
                ${formatCurrency(pointsBalance / 100)} MXN
              </p>
            </div>
          </div>

          {!pointsWalletActive && (
            <div className="mt-4 bg-white/20 border border-white/40 rounded-lg p-3">
              <p className="text-sm text-white">
                Tus puntos están guardados. Reactiva tu membresía ToursRed+ para volver a usarlos.
              </p>
            </div>
          )}

          {pointsWalletActive && (
            <div className="mt-4 bg-white/20 border border-white/40 rounded-lg p-3">
              <p className="text-sm text-white font-medium mb-1">
                ✨ Beneficio ToursRed+
              </p>
              <p className="text-xs text-amber-100">
                ¡Tus puntos nunca expiran! Acumula sin límite mientras mantengas tu membresía activa.
              </p>
            </div>
          )}

          <div className="mt-4">
            <Link
              to="/traveler/points"
              className="block bg-white text-amber-600 px-4 py-2.5 rounded-lg font-semibold hover:bg-amber-50 transition-colors text-center text-sm"
            >
              Ver Historial de Puntos
            </Link>
          </div>
          <div className="mt-3 bg-white/10 backdrop-blur-sm rounded-lg p-3 text-xs text-amber-100">
            <p>Gana 1 punto por cada peso gastado. Usa hasta el 50% del total de tu reserva con puntos. Tus puntos nunca expiran.</p>
          </div>
        </div>
      )}

      {referralCode && (
        <div className="mb-8 bg-gradient-to-br from-blue-600 via-blue-700 to-indigo-700 rounded-xl shadow-lg p-6 text-white">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <div className="bg-white/20 backdrop-blur-sm rounded-full p-3">
                <Gift className="h-8 w-8" />
              </div>
              <div>
                <h3 className="text-xl font-bold">Programa de Referidos</h3>
                <p className="text-blue-100 text-sm">Invita amigos y gana puntos</p>
              </div>
            </div>
            <Link
              to="/traveler/referrals"
              className="bg-white text-blue-600 px-4 py-2 rounded-lg font-semibold hover:bg-blue-50 transition-colors text-sm flex items-center gap-2"
            >
              Ver Detalles
              <ExternalLink className="w-4 h-4" />
            </Link>
          </div>

          <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="bg-white/10 backdrop-blur-sm rounded-lg p-4">
              <p className="text-blue-100 text-sm mb-2">Tu código de referido</p>
              <div className="flex items-center gap-2">
                <span className="text-2xl font-bold font-mono tracking-wider flex-1">{referralCode}</span>
                <button
                  onClick={handleCopyReferralCode}
                  className="bg-white/20 hover:bg-white/30 p-2 rounded-lg transition-colors"
                  title="Copiar código"
                >
                  {copySuccess ? (
                    <CheckCircle className="w-5 h-5" />
                  ) : (
                    <Copy className="w-5 h-5" />
                  )}
                </button>
              </div>
            </div>

            <div className="bg-white/10 backdrop-blur-sm rounded-lg p-4">
              <p className="text-blue-100 text-sm mb-2">Tu progreso</p>
              <div className="flex items-center justify-between mb-2">
                <span className="text-2xl font-bold">{referralStats.completed}/{referralStats.max}</span>
                <span className="text-sm text-blue-100">Referidos completados</span>
              </div>
              <div className="w-full bg-white/20 rounded-full h-2">
                <div
                  className="bg-white rounded-full h-2 transition-all duration-300"
                  style={{ width: `${(referralStats.completed / referralStats.max) * 100}%` }}
                ></div>
              </div>
            </div>
          </div>

          {referralStats.points > 0 && (
            <div className="mt-4 bg-green-500/20 border border-green-400/30 rounded-lg p-3">
              <p className="text-sm text-green-100">
                Has ganado <strong className="font-bold">{referralStats.points.toLocaleString()} puntos</strong> por tus referidos completados
                {!membership && ' (activa tu membresía para usarlos)'}
              </p>
            </div>
          )}

          {referralStats.completed >= referralStats.max && (
            <div className="mt-4 bg-amber-500/20 border border-amber-300/30 rounded-lg p-3">
              <p className="text-sm text-amber-100">
                Has alcanzado tu límite de referidos. Contacta al administrador para aumentarlo.
              </p>
            </div>
          )}
        </div>
      )}

      <div className="mb-12">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-2xl font-semibold flex items-center">
            <Calendar className="w-6 h-6 mr-2 text-blue-600" />
            Próximas Reservas
          </h2>
          <Link to="/traveler/bookings" className="text-blue-600 hover:text-blue-700 text-sm font-medium">
            Ver todas
          </Link>
        </div>

        {upcomingBookings.length === 0 ? (
          <div className="bg-white rounded-lg shadow p-8 text-center">
            <Clock className="w-12 h-12 mx-auto mb-4 text-gray-400" />
            <p className="text-gray-600 mb-4">No tienes reservas próximas</p>
            <Link to="/tours" className="text-blue-600 hover:text-blue-700 font-medium">
              Explora tours disponibles
            </Link>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {upcomingBookings.map((booking) => (
              <div key={booking.id} className="bg-white rounded-lg shadow-md overflow-hidden hover:shadow-lg transition-shadow">
                <div className="flex">
                  <div className="w-1/3 relative">
                    <img
                      src={booking.tours.image_url || 'https://images.pexels.com/photos/2245436/pexels-photo-2245436.png'}
                      alt={booking.tours.name}
                      className="w-full h-full object-cover"
                    />
                  </div>
                  <div className="w-2/3 p-4">
                    <div className="flex items-start justify-between mb-2">
                      <h3 className="font-semibold text-lg line-clamp-1">{booking.tours.name}</h3>
                      <CheckCircle className="w-5 h-5 text-green-500 flex-shrink-0" />
                    </div>
                    <div className="flex items-center text-gray-600 text-sm mb-2">
                      <MapPin className="w-4 h-4 mr-1" />
                      <span>{booking.tours.destination}</span>
                    </div>
                    <div className="flex items-center text-gray-600 text-sm mb-2">
                      <Calendar className="w-4 h-4 mr-1" />
                      {booking.tours.tour_type === 'receptivo' && booking.tour_slots?.slot_date ? (
                        <span>{formatDate(booking.tour_slots.slot_date)}{booking.tour_slots.departure_time ? ` a las ${booking.tour_slots.departure_time.substring(0, 5)}` : ''}</span>
                      ) : (
                        <span>{booking.tours.start_date ? formatDate(booking.tours.start_date) : ''}{booking.tours.end_date ? ` - ${formatDate(booking.tours.end_date)}` : ''}</span>
                      )}
                    </div>
                    <p className="text-sm text-gray-500 mb-3">
                      {booking.tours.agencies?.name}
                    </p>
                    <div className="flex items-center justify-between">
                      <span className="font-bold text-blue-600">${booking.total_price}</span>
                      <Link
                        to={`/traveler/bookings?booking=${booking.id}`}
                        className="text-sm text-blue-600 hover:text-blue-700 font-medium"
                      >
                        Ver detalles
                      </Link>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div>
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-2xl font-semibold flex items-center">
            <Heart className="w-6 h-6 mr-2 text-red-500" />
            Tours Guardados
          </h2>
        </div>

        {savedTours.length === 0 ? (
          <div className="bg-white rounded-lg shadow p-8 text-center">
            <Heart className="w-12 h-12 mx-auto mb-4 text-gray-400" />
            <p className="text-gray-600 mb-4">No has guardado ningún tour todavía</p>
            <Link to="/tours" className="text-blue-600 hover:text-blue-700 font-medium">
              Explora tours y guarda tus favoritos
            </Link>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {savedTours.map((savedTour) => (
              <div key={savedTour.id} className="bg-white rounded-lg shadow-md overflow-hidden hover:shadow-lg transition-shadow">
                <div className="relative">
                  <img
                    src={savedTour.tours.image_url || 'https://images.pexels.com/photos/2245436/pexels-photo-2245436.png'}
                    alt={savedTour.tours.name}
                    className="w-full h-48 object-cover"
                  />
                  <button
                    onClick={() => removeSavedTour(savedTour.tour_id)}
                    className="absolute top-2 right-2 p-2 bg-white rounded-full shadow-md hover:shadow-lg transition-all"
                    title="Quitar de guardados"
                  >
                    <Heart className="w-5 h-5 fill-red-500 text-red-500" />
                  </button>
                </div>
                <div className="p-4">
                  <h3 className="font-semibold text-lg mb-2 line-clamp-1">{savedTour.tours.name}</h3>
                  <div className="flex items-center text-gray-600 text-sm mb-2">
                    <MapPin className="w-4 h-4 mr-1" />
                    <span>{savedTour.tours.destination}</span>
                  </div>
                  <div className="flex items-center text-gray-600 text-sm mb-3">
                    <Calendar className="w-4 h-4 mr-1" />
                    <span className="text-xs">{formatDate(savedTour.tours.start_date)}</span>
                  </div>
                  <p className="text-sm text-gray-500 mb-3 line-clamp-1">
                    {savedTour.tours.agencies?.name}
                  </p>
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-blue-600">${savedTour.tours.price}</span>
                    <Link
                      to={`/tours/${savedTour.tours?.slug || savedTour.tour_id}`}
                      className="text-sm text-blue-600 hover:text-blue-700 font-medium"
                    >
                      Ver detalles
                    </Link>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {showCancelModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg max-w-md w-full p-6">
            <h3 className="text-xl font-bold text-gray-900 mb-4">Cancelar Membresía</h3>
            <p className="text-gray-700 mb-6">
              ¿Estás seguro que deseas cancelar tu membresía ToursRed+? Podrás seguir disfrutando de los beneficios hasta el final de tu período actual, pero no se renovará automáticamente.
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => setShowCancelModal(false)}
                disabled={actionLoading}
                className="flex-1 px-4 py-2 border border-gray-300 rounded-lg font-medium text-gray-700 hover:bg-gray-50 transition-colors disabled:opacity-50"
              >
                No, Mantener
              </button>
              <button
                onClick={handleCancelSubscription}
                disabled={actionLoading}
                className="flex-1 px-4 py-2 bg-red-600 text-white rounded-lg font-medium hover:bg-red-700 transition-colors disabled:opacity-50"
              >
                {actionLoading ? 'Procesando...' : 'Sí, Cancelar'}
              </button>
            </div>
          </div>
        </div>
      )}

      {showUpgradeModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg max-w-md w-full p-6">
            <div className="flex items-center gap-3 mb-4">
              <Crown className="h-8 w-8 text-yellow-500" />
              <h3 className="text-xl font-bold text-gray-900">Actualizar a Plan Anual</h3>
            </div>
            <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4 mb-4">
              <p className="font-semibold text-yellow-900 mb-2">Ahorra $98 MXN al año</p>
              <ul className="text-sm text-yellow-800 space-y-1">
                <li>✓ Paga $490 en lugar de $588</li>
                <li>✓ Equivale a solo $40.83/mes</li>
                <li>✓ Todos los beneficios ToursRed+</li>
                <li>✓ Sin cargos adicionales hasta tu próxima renovación anual</li>
              </ul>
            </div>
            <p className="text-gray-700 text-sm mb-6">
              Al actualizar, se te cobrará de inmediato la diferencia prorrateada (el precio anual menos lo que ya pagaste este mes), y tu membresía se renovará cada 12 meses desde hoy.
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => setShowUpgradeModal(false)}
                disabled={actionLoading}
                className="flex-1 px-4 py-2 border border-gray-300 rounded-lg font-medium text-gray-700 hover:bg-gray-50 transition-colors disabled:opacity-50"
              >
                Cancelar
              </button>
              <button
                onClick={handleUpgradeSubscription}
                disabled={actionLoading}
                className="flex-1 px-4 py-2 bg-yellow-500 text-white rounded-lg font-medium hover:bg-yellow-600 transition-colors disabled:opacity-50"
              >
                {actionLoading ? 'Procesando...' : 'Actualizar Ahora'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default TravelerDashboard;