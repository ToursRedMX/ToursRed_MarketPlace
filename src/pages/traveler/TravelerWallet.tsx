import React, { useState, useEffect } from 'react';
import { Wallet, TrendingUp, TrendingDown, Calendar, DollarSign, Gift, RefreshCw, Award, AlertCircle, ArrowUpCircle, ArrowDownCircle, Check, X, ArrowLeft } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { formatCurrencyMXN } from '../../utils/formatCurrency';
import { Link } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';

interface WalletInfo {
  id: string;
  balance: number;
  currency: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

interface Transaction {
  id: string;
  amount: number;
  balance_after: number;
  type: 'credit' | 'debit' | 'refund' | 'promotion' | 'gift_card' | 'adjustment';
  description: string;
  reference_id: string | null;
  reference_type: string | null;
  created_at: string;
  booking_code?: string;
}

const TravelerWallet: React.FC = () => {
  const { user } = useAuth();
  const [wallet, setWallet] = useState<WalletInfo | null>(null);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [filter, setFilter] = useState<string>('all');
  const [showRedeemModal, setShowRedeemModal] = useState(false);
  const [giftCardCode, setGiftCardCode] = useState('');
  const [isRedeeming, setIsRedeeming] = useState(false);
  const [redeemError, setRedeemError] = useState<string | null>(null);
  const [redeemSuccess, setRedeemSuccess] = useState(false);

  useEffect(() => {
    if (user) {
      loadWalletData();
    }
  }, [user?.id]);

  const loadWalletData = async () => {
    if (!user) return;

    setIsLoading(true);
    try {
      const { data: walletData, error: walletError } = await supabase
        .from('toursred_cash_wallets')
        .select('*')
        .eq('user_id', user.id)
        .maybeSingle();

      if (walletError) throw walletError;
      setWallet(walletData);

      if (walletData) {
        const { data: transactionsData, error: transactionsError } = await supabase
          .from('toursred_cash_transactions')
          .select('*')
          .eq('wallet_id', walletData.id)
          .order('created_at', { ascending: false });

        if (transactionsError) throw transactionsError;

        const transactionsWithBookingCodes = await Promise.all(
          (transactionsData || []).map(async (transaction) => {
            if (transaction.reference_id) {
              if (transaction.reference_type === 'booking') {
                const { data: booking } = await supabase
                  .from('bookings')
                  .select('booking_code')
                  .eq('id', transaction.reference_id)
                  .maybeSingle();

                if (booking?.booking_code) {
                  return {
                    ...transaction,
                    booking_code: booking.booking_code
                  };
                }
              } else if (transaction.reference_type === 'booking_cancellation') {
                const { data: booking } = await supabase
                  .from('bookings')
                  .select('booking_code')
                  .eq('id', transaction.reference_id)
                  .maybeSingle();

                if (booking?.booking_code) {
                  return {
                    ...transaction,
                    booking_code: booking.booking_code
                  };
                }
              } else if (transaction.reference_type === 'tour_cancellation') {
                const { data: bookings } = await supabase
                  .from('bookings')
                  .select('booking_code, cancelled_at')
                  .eq('user_id', transaction.user_id)
                  .eq('agency_cancellation_id', transaction.reference_id)
                  .order('cancelled_at', { ascending: true });

                if (bookings && bookings.length > 0) {
                  const transactionTime = new Date(transaction.created_at).getTime();
                  const closestBooking = bookings.reduce((closest, booking) => {
                    const bookingTime = new Date(booking.cancelled_at).getTime();
                    const currentDiff = Math.abs(transactionTime - bookingTime);
                    const closestTime = new Date(closest.cancelled_at).getTime();
                    const closestDiff = Math.abs(transactionTime - closestTime);
                    return currentDiff < closestDiff ? booking : closest;
                  }, bookings[0]);

                  if (closestBooking?.booking_code) {
                    return {
                      ...transaction,
                      booking_code: closestBooking.booking_code
                    };
                  }
                }
              } else if (transaction.reference_type === 'reschedule_rejection') {
                const { data: booking } = await supabase
                  .from('bookings')
                  .select('booking_code')
                  .eq('id', transaction.reference_id)
                  .maybeSingle();

                if (booking?.booking_code) {
                  return {
                    ...transaction,
                    booking_code: booking.booking_code
                  };
                }
              }
            }
            return transaction;
          })
        );

        setTransactions(transactionsWithBookingCodes);
      }
    } catch (error) {
      console.error('Error loading wallet data:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const formatCodeInput = (value: string) => {
    const cleaned = value.toUpperCase().replace(/[^A-Z0-9]/g, '');
    const chunks = [];
    for (let i = 0; i < cleaned.length && i < 16; i += 4) {
      chunks.push(cleaned.slice(i, i + 4));
    }
    return chunks.join('-');
  };

  const handleCodeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const formatted = formatCodeInput(e.target.value);
    setGiftCardCode(formatted);
    setRedeemError(null);
  };

  const handleRedeemGiftCard = async () => {
    if (!giftCardCode || giftCardCode.replace(/-/g, '').length !== 16) {
      setRedeemError('Por favor ingresa un código válido de 16 caracteres');
      return;
    }

    setRedeemError(null);
    setIsRedeeming(true);

    try {
      const session = await supabase.auth.getSession();
      const token = session.data.session?.access_token;

      const { data, error } = await supabase.functions.invoke('redeem-gift-card', {
        body: {
          code: giftCardCode,
          action: 'redeem',
        },
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (error) throw error;

      if (data?.success) {
        setRedeemSuccess(true);
        setGiftCardCode('');
        setTimeout(() => {
          setRedeemSuccess(false);
          setShowRedeemModal(false);
          loadWalletData();
        }, 3000);
      } else {
        setRedeemError(data?.error || 'Error al canjear la tarjeta');
      }
    } catch (err: any) {
      console.error('Error redeeming gift card:', err);
      setRedeemError(err.message || 'Error al canjear la tarjeta');
    } finally {
      setIsRedeeming(false);
    }
  };

  const getTransactionIcon = (type: Transaction['type']) => {
    switch (type) {
      case 'credit':
        return <ArrowUpCircle className="h-5 w-5 text-green-600" />;
      case 'debit':
        return <ArrowDownCircle className="h-5 w-5 text-red-600" />;
      case 'refund':
        return <RefreshCw className="h-5 w-5 text-blue-600" />;
      case 'promotion':
        return <Award className="h-5 w-5 text-accent-600" />;
      case 'gift_card':
        return <Gift className="h-5 w-5 text-purple-600" />;
      case 'adjustment':
        return <AlertCircle className="h-5 w-5 text-gray-600" />;
      default:
        return <DollarSign className="h-5 w-5 text-gray-600" />;
    }
  };

  const getTransactionTypeLabel = (type: Transaction['type']) => {
    const labels = {
      credit: 'Crédito',
      debit: 'Débito',
      refund: 'Reembolso',
      promotion: 'Bonificación',
      gift_card: 'Tarjeta de Regalo',
      adjustment: 'Ajuste'
    };
    return labels[type] || type;
  };

  const getTransactionColor = (amount: number) => {
    return amount >= 0 ? 'text-green-600' : 'text-red-600';
  };

  const filteredTransactions = transactions.filter(t => {
    if (filter === 'all') return true;
    if (filter === 'credits') return t.amount > 0;
    if (filter === 'debits') return t.amount < 0;
    return true;
  });

  const totalCredits = transactions
    .filter(t => t.amount > 0)
    .reduce((sum, t) => sum + Number(t.amount), 0);

  const totalDebits = transactions
    .filter(t => t.amount < 0)
    .reduce((sum, t) => sum + Math.abs(Number(t.amount)), 0);

  if (isLoading) {
    return (
      <div className="container mx-auto px-4 py-8">
        <div className="flex justify-center items-center min-h-[400px]">
          <div className="text-gray-600">Cargando tu monedero...</div>
        </div>
      </div>
    );
  }

  if (!wallet) {
    return (
      <div className="container mx-auto px-4 py-8">
        <div className="bg-white rounded-lg shadow-md p-8 text-center">
          <Wallet className="h-12 w-12 text-gray-400 mx-auto mb-4" />
          <h3 className="text-xl font-semibold mb-2">Monedero no disponible</h3>
          <p className="text-gray-600">No se pudo cargar tu monedero ToursRed Cash.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="container mx-auto px-4 py-8">
      <div className="max-w-6xl mx-auto">
        <Link
          to="/traveler/dashboard"
          className="inline-flex items-center gap-2 text-primary-600 hover:text-primary-700 mb-6 font-medium transition-colors"
        >
          <ArrowLeft className="h-5 w-5" />
          Regresar al Dashboard
        </Link>

        <h1 className="text-3xl font-bold mb-8 flex items-center gap-3">
          <Wallet className="h-8 w-8 text-accent-600" />
          ToursRed Cash
        </h1>

        {/* Balance Card */}
        <div className="mb-8 bg-gradient-to-br from-accent-500 via-accent-600 to-orange-600 rounded-xl shadow-lg p-8 text-white">
          <div className="flex items-center justify-between mb-6">
            <div>
              <p className="text-accent-100 text-sm mb-2">Saldo Disponible</p>
              <p className="text-5xl font-bold">
                {formatCurrencyMXN(Number(wallet.balance))}
              </p>
              <p className="text-accent-100 mt-2">{wallet.currency}</p>
            </div>
            <div className="bg-white/20 backdrop-blur-sm rounded-full p-4">
              <Wallet className="h-12 w-12" />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4 mt-6">
            <div className="bg-white/10 backdrop-blur-sm rounded-lg p-4">
              <div className="flex items-center gap-2 mb-2">
                <TrendingUp className="h-5 w-5 text-green-300" />
                <p className="text-sm text-accent-100">Total Recibido</p>
              </div>
              <p className="text-2xl font-bold">
                {formatCurrencyMXN(totalCredits)}
              </p>
            </div>
            <div className="bg-white/10 backdrop-blur-sm rounded-lg p-4">
              <div className="flex items-center gap-2 mb-2">
                <TrendingDown className="h-5 w-5 text-red-300" />
                <p className="text-sm text-accent-100">Total Utilizado</p>
              </div>
              <p className="text-2xl font-bold">
                {formatCurrencyMXN(totalDebits)}
              </p>
            </div>
          </div>
        </div>

        {/* Gift Card Redeem Section */}
        <div className="mb-8 bg-gradient-to-br from-purple-50 to-pink-50 rounded-xl shadow-md p-6 border border-purple-100">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <div className="bg-purple-100 rounded-full p-3">
                <Gift className="h-6 w-6 text-purple-600" />
              </div>
              <div>
                <h3 className="text-lg font-semibold text-gray-900">¿Tienes una Tarjeta de Regalo?</h3>
                <p className="text-sm text-gray-600">Canjea tu código y agrega saldo a tu monedero</p>
              </div>
            </div>
            <button
              onClick={() => setShowRedeemModal(true)}
              className="px-6 py-3 bg-gradient-to-r from-purple-600 to-pink-600 text-white rounded-lg font-semibold hover:from-purple-700 hover:to-pink-700 transition-all shadow-md hover:shadow-lg"
            >
              Canjear Código
            </button>
          </div>
        </div>

        {/* Redeem Modal */}
        {showRedeemModal && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
            <div className="bg-white rounded-2xl shadow-xl max-w-md w-full p-6">
              <div className="flex items-center justify-between mb-6">
                <h3 className="text-2xl font-bold text-gray-900">Canjear Tarjeta de Regalo</h3>
                <button
                  onClick={() => {
                    setShowRedeemModal(false);
                    setGiftCardCode('');
                    setRedeemError(null);
                    setRedeemSuccess(false);
                  }}
                  className="text-gray-400 hover:text-gray-600 transition-colors"
                >
                  <X className="h-6 w-6" />
                </button>
              </div>

              {redeemSuccess ? (
                <div className="text-center py-8">
                  <div className="inline-flex items-center justify-center w-16 h-16 bg-green-100 rounded-full mb-4">
                    <Check className="h-8 w-8 text-green-600" />
                  </div>
                  <h4 className="text-xl font-bold text-gray-900 mb-2">¡Canjeada Exitosamente!</h4>
                  <p className="text-gray-600">El saldo se ha agregado a tu monedero</p>
                </div>
              ) : (
                <>
                  {redeemError && (
                    <div className="mb-4 p-4 bg-red-50 border border-red-200 rounded-lg flex items-start gap-3">
                      <AlertCircle className="h-5 w-5 text-red-600 flex-shrink-0 mt-0.5" />
                      <p className="text-sm text-red-800">{redeemError}</p>
                    </div>
                  )}

                  <div className="mb-6">
                    <label className="block text-sm font-semibold text-gray-700 mb-3">
                      Código de Tarjeta de Regalo
                    </label>
                    <input
                      type="text"
                      value={giftCardCode}
                      onChange={handleCodeChange}
                      placeholder="XXXX-XXXX-XXXX-XXXX"
                      maxLength={19}
                      className="w-full px-4 py-3 text-xl font-mono text-center border-2 border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent tracking-widest"
                    />
                    <p className="text-xs text-gray-500 text-center mt-2">
                      Ingresa el código de 16 caracteres de tu tarjeta
                    </p>
                  </div>

                  <div className="flex gap-3">
                    <button
                      onClick={() => {
                        setShowRedeemModal(false);
                        setGiftCardCode('');
                        setRedeemError(null);
                      }}
                      className="flex-1 px-4 py-3 bg-gray-100 text-gray-700 rounded-lg font-semibold hover:bg-gray-200 transition-colors"
                    >
                      Cancelar
                    </button>
                    <button
                      onClick={handleRedeemGiftCard}
                      disabled={isRedeeming || giftCardCode.replace(/-/g, '').length !== 16}
                      className="flex-1 px-4 py-3 bg-gradient-to-r from-purple-600 to-pink-600 text-white rounded-lg font-semibold hover:from-purple-700 hover:to-pink-700 transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                    >
                      {isRedeeming ? (
                        <>
                          <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                          <span>Canjeando...</span>
                        </>
                      ) : (
                        <span>Canjear</span>
                      )}
                    </button>
                  </div>

                  <div className="mt-4 text-center">
                    <Link
                      to="/gift-cards"
                      className="text-sm text-purple-600 hover:text-purple-700 font-medium"
                    >
                      ¿No tienes una tarjeta? Compra aquí
                    </Link>
                  </div>
                </>
              )}
            </div>
          </div>
        )}

        {/* Transaction History */}
        <div className="bg-white rounded-lg shadow-md">
          <div className="border-b border-gray-200 px-6 py-4">
            <div className="flex items-center justify-between">
              <h2 className="text-xl font-semibold flex items-center gap-2">
                <Calendar className="h-5 w-5 text-gray-600" />
                Historial de Movimientos
              </h2>
              <div className="flex gap-2">
                <button
                  onClick={() => setFilter('all')}
                  className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                    filter === 'all'
                      ? 'bg-accent-600 text-white'
                      : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                  }`}
                >
                  Todos
                </button>
                <button
                  onClick={() => setFilter('credits')}
                  className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                    filter === 'credits'
                      ? 'bg-green-600 text-white'
                      : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                  }`}
                >
                  Ingresos
                </button>
                <button
                  onClick={() => setFilter('debits')}
                  className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                    filter === 'debits'
                      ? 'bg-red-600 text-white'
                      : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                  }`}
                >
                  Egresos
                </button>
              </div>
            </div>
          </div>

          <div className="p-6">
            {filteredTransactions.length === 0 ? (
              <div className="text-center py-12">
                <Wallet className="h-16 w-16 text-gray-300 mx-auto mb-4" />
                <p className="text-gray-600 mb-2">No hay movimientos todavía</p>
                <p className="text-sm text-gray-500">
                  {filter === 'all'
                    ? 'Tus transacciones aparecerán aquí'
                    : filter === 'credits'
                    ? 'No hay ingresos registrados'
                    : 'No hay egresos registrados'
                  }
                </p>
              </div>
            ) : (
              <div className="space-y-4">
                {filteredTransactions.map((transaction) => (
                  <div
                    key={transaction.id}
                    className="flex items-center justify-between p-4 bg-gray-50 rounded-lg hover:bg-gray-100 transition-colors"
                  >
                    <div className="flex items-center gap-4 flex-1">
                      <div className="bg-white rounded-full p-2 shadow-sm">
                        {getTransactionIcon(transaction.type)}
                      </div>
                      <div className="flex-1">
                        <p className="font-medium text-gray-900">{transaction.description}</p>
                        {transaction.booking_code && (
                          <p className="text-sm text-primary-600 font-semibold mt-1">
                            Código de Reserva: {transaction.booking_code}
                          </p>
                        )}
                        <div className="flex items-center gap-3 mt-1">
                          <span className="text-xs px-2 py-1 bg-white rounded-full text-gray-600 font-medium">
                            {getTransactionTypeLabel(transaction.type)}
                          </span>
                          <span className="text-xs text-gray-500">
                            {format(new Date(transaction.created_at), "d 'de' MMMM 'de' yyyy, HH:mm", { locale: es })}
                          </span>
                        </div>
                      </div>
                    </div>
                    <div className="text-right">
                      <p className={`text-lg font-bold ${getTransactionColor(transaction.amount)}`}>
                        {transaction.amount >= 0 ? '+' : ''}
                        {formatCurrencyMXN(Math.abs(Number(transaction.amount)))}
                      </p>
                      <p className="text-xs text-gray-500 mt-1">
                        Saldo: {formatCurrencyMXN(Number(transaction.balance_after))}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Info Box */}
        <div className="mt-6 bg-blue-50 border border-blue-200 rounded-lg p-4">
          <div className="flex items-start gap-3">
            <AlertCircle className="h-5 w-5 text-blue-600 flex-shrink-0 mt-0.5" />
            <div className="text-sm text-blue-800">
              <p className="font-semibold mb-1">Sobre ToursRed Cash</p>
              <p>
                Tu monedero ToursRed Cash es donde recibes reembolsos por cancelaciones, bonificaciones promocionales y tarjetas de regalo.
                Puedes usar este saldo para pagar tus futuras reservas en ToursRed.
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default TravelerWallet;
