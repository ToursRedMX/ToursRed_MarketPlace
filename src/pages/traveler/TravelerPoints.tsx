import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { formatCurrencyMXN } from '../../utils/formatCurrency';
import { Award, TrendingUp, TrendingDown, Clock, ArrowUp, ArrowDown, AlertCircle, HelpCircle, Calendar, Crown } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { supabase } from '../../lib/supabase';

interface PointsWallet {
  balance: number;
  total_earned: number;
  total_used: number;
  total_expired: number;
  is_active: boolean;
}

interface PointsTransaction {
  id: string;
  amount: number;
  balance_after: number;
  type: 'earned' | 'redeemed' | 'expired' | 'refund' | 'adjustment' | 'partial_cancellation';
  description: string;
  expires_at: string | null;
  created_at: string;
  reference_id: string | null;
  reference_type: string | null;
  booking_code?: string | null;
}

const TravelerPointsPage: React.FC = () => {
  const { user } = useAuth();
  const [wallet, setWallet] = useState<PointsWallet | null>(null);
  const [hasMembership, setHasMembership] = useState(false);
  const [transactions, setTransactions] = useState<PointsTransaction[]>([]);
  const [isLoadingWallet, setIsLoadingWallet] = useState(true);
  const [isLoadingTransactions, setIsLoadingTransactions] = useState(true);
  const [filter, setFilter] = useState<'all' | 'earned' | 'redeemed' | 'expired'>('all');

  useEffect(() => {
    const loadWallet = async () => {
      if (!user) return;

      try {
        const { data: membershipData } = await supabase
          .from('memberships')
          .select('status')
          .eq('user_id', user.id)
          .eq('status', 'active')
          .maybeSingle();

        setHasMembership(!!membershipData);

        const { data, error } = await supabase
          .from('toursred_points_wallets')
          .select('*')
          .eq('user_id', user.id)
          .maybeSingle();

        if (error) {
          console.error('Error loading wallet:', error);
        } else if (data) {
          setWallet(data);
        }
      } catch (err) {
        console.error('Error:', err);
      } finally {
        setIsLoadingWallet(false);
      }
    };

    loadWallet();
  }, [user?.id]);

  useEffect(() => {
    const loadTransactions = async () => {
      if (!user) return;

      try {
        const { data: txData, error: txError } = await supabase
          .from('toursred_points_transactions')
          .select('*')
          .eq('user_id', user.id)
          .order('created_at', { ascending: false })
          .limit(100);

        if (txError) {
          console.error('Error loading transactions:', txError);
          return;
        }

        if (!txData) {
          setTransactions([]);
          return;
        }

        const bookingIds = txData
          .filter(tx => tx.reference_type === 'booking' && tx.reference_id)
          .map(tx => tx.reference_id);

        let bookingCodes: Record<string, string> = {};

        if (bookingIds.length > 0) {
          const { data: bookingsData, error: bookingsError } = await supabase
            .from('bookings')
            .select('id, booking_code')
            .in('id', bookingIds);

          if (!bookingsError && bookingsData) {
            bookingCodes = bookingsData.reduce((acc, booking) => {
              acc[booking.id] = booking.booking_code;
              return acc;
            }, {} as Record<string, string>);
          }
        }

        const formattedData = txData.map(tx => ({
          ...tx,
          booking_code: tx.reference_type === 'booking' && tx.reference_id
            ? bookingCodes[tx.reference_id] || null
            : null
        }));

        setTransactions(formattedData);
      } catch (err) {
        console.error('Error:', err);
      } finally {
        setIsLoadingTransactions(false);
      }
    };

    loadTransactions();
  }, [user?.id]);

  const getTransactionIcon = (type: string) => {
    switch (type) {
      case 'earned':
        return <ArrowUp className="h-5 w-5 text-green-600" />;
      case 'redeemed':
        return <ArrowDown className="h-5 w-5 text-blue-600" />;
      case 'expired':
        return <Clock className="h-5 w-5 text-red-600" />;
      case 'refund':
        return <ArrowUp className="h-5 w-5 text-amber-600" />;
      case 'adjustment':
        return <AlertCircle className="h-5 w-5 text-gray-600" />;
      case 'partial_cancellation':
        return <ArrowDown className="h-5 w-5 text-orange-600" />;
      default:
        return <AlertCircle className="h-5 w-5 text-gray-600" />;
    }
  };

  const getTransactionColor = (type: string) => {
    switch (type) {
      case 'earned':
        return 'text-green-600';
      case 'redeemed':
        return 'text-blue-600';
      case 'expired':
        return 'text-red-600';
      case 'refund':
        return 'text-amber-600';
      case 'adjustment':
        return 'text-gray-600';
      case 'partial_cancellation':
        return 'text-orange-600';
      default:
        return 'text-gray-600';
    }
  };

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleDateString('es-MX', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  const getDaysUntilExpiration = (expiresAt: string) => {
    const now = new Date();
    const expiration = new Date(expiresAt);
    const diffTime = expiration.getTime() - now.getTime();
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    return diffDays;
  };

  const filteredTransactions = transactions.filter(t => {
    if (filter === 'all') return true;
    return t.type === filter;
  });

  if (!user) {
    return (
      <div className="min-h-screen bg-gray-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
          <div className="text-center">
            <h2 className="text-2xl font-bold text-gray-900 mb-4">Debes iniciar sesión</h2>
            <Link to="/login" className="text-primary-600 hover:text-primary-700">
              Ir a inicio de sesión
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="mb-6">
          <Link to="/traveler/dashboard" className="text-primary-600 hover:text-primary-700 flex items-center">
            <svg className="h-5 w-5 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
            Volver al Dashboard
          </Link>
        </div>

        <div className="flex items-center mb-8">
          <Award className="h-8 w-8 text-amber-600 mr-3" />
          <h1 className="text-3xl font-bold text-gray-900">ToursRed Points</h1>
        </div>

        {isLoadingWallet ? (
          <div className="flex items-center justify-center py-12">
            <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-primary-600"></div>
          </div>
        ) : !hasMembership && !wallet ? (
          <div className="bg-white rounded-lg shadow-md p-8 text-center">
            <Award className="h-16 w-16 text-gray-400 mx-auto mb-4" />
            <h3 className="text-xl font-semibold text-gray-900 mb-2">No tienes una billetera de puntos</h3>
            <p className="text-gray-600 mb-4">
              Necesitas una membresía ToursRed+ para empezar a acumular puntos.
            </p>
            <Link
              to="/traveler/membership"
              className="inline-flex items-center px-6 py-3 bg-primary-600 text-white rounded-md hover:bg-primary-700 font-semibold"
            >
              <Crown className="h-5 w-5 mr-2" />
              Ver Membresías
            </Link>
          </div>
        ) : (
          <>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 mb-8">
              <div className="bg-gradient-to-br from-amber-500 to-amber-600 rounded-lg shadow-lg p-6 text-white">
                <div className="flex items-center justify-between mb-2">
                  <Award className="h-8 w-8" />
                  <span className="text-sm font-medium">Balance</span>
                </div>
                <div className="text-3xl font-bold mb-1">
                  {(wallet?.balance || 0).toLocaleString('en-US')}
                </div>
                <div className="text-amber-100 text-sm">
                  {formatCurrencyMXN((wallet?.balance || 0) / 100)} MXN de valor
                </div>
              </div>

              <div className="bg-white rounded-lg shadow-md p-6">
                <div className="flex items-center justify-between mb-2">
                  <TrendingUp className="h-6 w-6 text-green-600" />
                  <span className="text-sm font-medium text-gray-600">Ganados</span>
                </div>
                <div className="text-2xl font-bold text-gray-900">
                  {(wallet?.total_earned || 0).toLocaleString('en-US')}
                </div>
                <div className="text-gray-500 text-sm">
                  Total histórico
                </div>
              </div>

              <div className="bg-white rounded-lg shadow-md p-6">
                <div className="flex items-center justify-between mb-2">
                  <TrendingDown className="h-6 w-6 text-blue-600" />
                  <span className="text-sm font-medium text-gray-600">Usados</span>
                </div>
                <div className="text-2xl font-bold text-gray-900">
                  {(wallet?.total_used || 0).toLocaleString('en-US')}
                </div>
                <div className="text-gray-500 text-sm">
                  Total canjeado
                </div>
              </div>
            </div>

            {!hasMembership && wallet && (
              <div className="bg-amber-50 border border-amber-200 rounded-xl p-5 mb-6">
                <div className="flex items-start gap-3">
                  <div className="flex-shrink-0 w-10 h-10 bg-amber-100 rounded-full flex items-center justify-center">
                    <Crown className="h-5 w-5 text-amber-600" />
                  </div>
                  <div className="flex-1">
                    <h4 className="text-sm font-semibold text-amber-900 mb-1">
                      Tus puntos están acumulados pero bloqueados
                    </h4>
                    <p className="text-sm text-amber-800 mb-3">
                      Tienes <strong>{(wallet.balance || 0).toLocaleString('en-US')} puntos</strong> acumulados (equivalente a <strong>{formatCurrencyMXN((wallet.balance || 0) / 100)} MXN</strong>), pero necesitas una membresía ToursRed+ activa para poder usarlos en tus reservas.
                    </p>
                    <Link
                      to="/traveler/membership"
                      className="inline-flex items-center px-4 py-2 bg-amber-600 text-white rounded-lg hover:bg-amber-700 text-sm font-semibold transition-colors"
                    >
                      <Crown className="h-4 w-4 mr-2" />
                      Activar membresía y desbloquear puntos
                    </Link>
                  </div>
                </div>
              </div>
            )}

            {wallet && !wallet.is_active && hasMembership && (
              <div className="bg-orange-50 border-l-4 border-orange-500 p-4 mb-6 rounded-md">
                <div className="flex items-start">
                  <AlertCircle className="h-5 w-5 text-orange-600 mr-2 flex-shrink-0 mt-0.5" />
                  <div>
                    <h4 className="text-sm font-semibold text-orange-900 mb-1">
                      Billetera Inactiva
                    </h4>
                    <p className="text-sm text-orange-800">
                      Tu membresía no está activa. No puedes usar puntos hasta que reactives tu membresía ToursRed+.{' '}
                      <Link to="/traveler/membership" className="underline font-medium">
                        Reactivar ahora
                      </Link>
                    </p>
                  </div>
                </div>
              </div>
            )}

            {wallet && wallet.is_active && hasMembership && (
              <div className="bg-gradient-to-r from-emerald-50 to-green-50 border-l-4 border-emerald-500 p-4 mb-6 rounded-md">
                <div className="flex items-start">
                  <Award className="h-5 w-5 text-emerald-600 mr-2 flex-shrink-0 mt-0.5" />
                  <div>
                    <h4 className="text-sm font-semibold text-emerald-900 mb-1">
                      Beneficio ToursRed+
                    </h4>
                    <p className="text-sm text-emerald-800">
                      ¡Tus puntos nunca expiran! Acumula y canjea cuando quieras, siempre y cuando mantengas tu membresía ToursRed+ activa.
                    </p>
                  </div>
                </div>
              </div>
            )}

            <div className="bg-white rounded-lg shadow-md p-6 mb-8">
              <div className="flex items-center justify-between mb-6">
                <h2 className="text-xl font-semibold text-gray-900">Historial de Transacciones</h2>
                <div className="flex gap-2">
                  <button
                    onClick={() => setFilter('all')}
                    className={`px-3 py-1 rounded-md text-sm font-medium ${
                      filter === 'all'
                        ? 'bg-primary-600 text-white'
                        : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                    }`}
                  >
                    Todos
                  </button>
                  <button
                    onClick={() => setFilter('earned')}
                    className={`px-3 py-1 rounded-md text-sm font-medium ${
                      filter === 'earned'
                        ? 'bg-green-600 text-white'
                        : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                    }`}
                  >
                    Ganados
                  </button>
                  <button
                    onClick={() => setFilter('redeemed')}
                    className={`px-3 py-1 rounded-md text-sm font-medium ${
                      filter === 'redeemed'
                        ? 'bg-blue-600 text-white'
                        : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                    }`}
                  >
                    Usados
                  </button>
                  <button
                    onClick={() => setFilter('expired')}
                    className={`px-3 py-1 rounded-md text-sm font-medium ${
                      filter === 'expired'
                        ? 'bg-red-600 text-white'
                        : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                    }`}
                  >
                    Expirados
                  </button>
                </div>
              </div>

              {isLoadingTransactions ? (
                <div className="flex items-center justify-center py-12">
                  <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-primary-600"></div>
                </div>
              ) : filteredTransactions.length === 0 ? (
                <div className="text-center py-12">
                  <Award className="h-16 w-16 text-gray-300 mx-auto mb-4" />
                  <p className="text-gray-500">No hay transacciones para mostrar</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {filteredTransactions.map((transaction) => (
                    <div
                      key={transaction.id}
                      className="flex items-center justify-between p-4 border border-gray-200 rounded-lg hover:bg-gray-50"
                    >
                      <div className="flex items-center flex-1">
                        <div className="mr-4">
                          {getTransactionIcon(transaction.type)}
                        </div>
                        <div className="flex-1">
                          <div className="font-medium text-gray-900">{transaction.description}</div>
                          <div className="text-sm text-gray-500">
                            {formatDate(transaction.created_at)}
                          </div>
                          {transaction.booking_code && transaction.reference_type === 'booking' && (
                            <div className="text-xs text-primary-600 font-medium mt-1">
                              Código de reserva: {transaction.booking_code}
                            </div>
                          )}
                          {transaction.expires_at && transaction.type === 'earned' && (
                            <div className={`text-xs mt-1 ${
                              getDaysUntilExpiration(transaction.expires_at) <= 30
                                ? 'text-yellow-600 font-medium'
                                : 'text-gray-500'
                            }`}>
                              Expira: {formatDate(transaction.expires_at)}
                              {getDaysUntilExpiration(transaction.expires_at) > 0 && (
                                <span> ({getDaysUntilExpiration(transaction.expires_at)} días)</span>
                              )}
                            </div>
                          )}
                        </div>
                      </div>
                      <div className="text-right ml-4">
                        <div className={`text-lg font-bold ${getTransactionColor(transaction.type)}`}>
                          {transaction.amount >= 0 ? '+' : ''}{transaction.amount.toLocaleString('en-US')}
                        </div>
                        <div className="text-sm text-gray-500">
                          Balance: {transaction.balance_after.toLocaleString('en-US')}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="bg-gradient-to-br from-blue-50 to-indigo-50 rounded-lg shadow-md p-6">
              <div className="flex items-center mb-4">
                <HelpCircle className="h-6 w-6 text-blue-600 mr-2" />
                <h2 className="text-xl font-semibold text-gray-900">Preguntas Frecuentes</h2>
              </div>
              <div className="space-y-4">
                <div>
                  <h3 className="font-semibold text-gray-900 mb-1">¿Cómo gano ToursRed Points?</h3>
                  <p className="text-sm text-gray-700">
                    Ganas 1 punto por cada peso que gastes en tours nacionales, siempre que tengas una membresía ToursRed+ activa.
                  </p>
                </div>
                <div>
                  <h3 className="font-semibold text-gray-900 mb-1">¿Cómo uso mis puntos?</h3>
                  <p className="text-sm text-gray-700">
                    Puedes canjear tus puntos al hacer una reserva. 100 puntos = $1 MXN de descuento. Usa hasta el 50% del total de tu reserva con puntos.
                  </p>
                </div>
                <div>
                  <h3 className="font-semibold text-gray-900 mb-1">¿Mis puntos expiran?</h3>
                  <p className="text-sm text-gray-700">
                    ¡No! Tus ToursRed Points nunca expiran. Puedes acumular sin límite y usarlos cuando quieras, siempre que mantengas tu membresía ToursRed+ activa.
                  </p>
                </div>
                <div>
                  <h3 className="font-semibold text-gray-900 mb-1">¿Qué pasa si cancelo mi membresía?</h3>
                  <p className="text-sm text-gray-700">
                    Tus puntos se mantienen, pero no podrás usarlos ni seguir acumulando hasta que reactives tu membresía ToursRed+.
                  </p>
                </div>
                <div>
                  <h3 className="font-semibold text-gray-900 mb-1">¿Los puntos son transferibles?</h3>
                  <p className="text-sm text-gray-700">
                    No, los ToursRed Points no son transferibles entre usuarios ni convertibles a efectivo.
                  </p>
                </div>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
};

export default TravelerPointsPage;
