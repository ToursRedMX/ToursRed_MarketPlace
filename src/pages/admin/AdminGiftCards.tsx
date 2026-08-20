import { useState, useEffect, useCallback } from 'react';
import { Gift, Search, Mail, RefreshCw, Check, Clock, XCircle, Eye, EyeOff, Filter, Download } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { formatCurrencyMXN } from '../../utils/formatCurrency';

interface GiftCard {
  id: string;
  code: string;
  amount: number;
  currency: string;
  status: string;
  payment_status: string;
  purchaser_email: string;
  purchaser_name: string;
  recipient_email: string | null;
  recipient_name: string | null;
  personal_message: string | null;
  purchased_at: string;
  expires_at: string;
  redeemed_by: string | null;
  redeemed_at: string | null;
  email_sent: boolean;
  email_sent_at: string | null;
  payment_provider: string | null;
  discount_amount: number;
  redeemed_by_email?: string | null;
}

type FilterStatus = 'all' | 'active' | 'redeemed' | 'pending_payment';
type FilterPayment = 'all' | 'paid' | 'pending';

export default function AdminGiftCards() {
  const [giftCards, setGiftCards] = useState<GiftCard[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [filterStatus, setFilterStatus] = useState<FilterStatus>('all');
  const [filterPayment, setFilterPayment] = useState<FilterPayment>('all');
  const [resendingId, setResendingId] = useState<string | null>(null);
  const [resendResult, setResendResult] = useState<{ id: string; success: boolean; message: string } | null>(null);
  const [showCodes, setShowCodes] = useState<Record<string, boolean>>({});
  const [stats, setStats] = useState({ total: 0, active: 0, redeemed: 0, totalAmount: 0, pending: 0 });

  const fetchGiftCards = useCallback(async () => {
    setIsLoading(true);
    const query = supabase
      .from('gift_cards')
      .select(`
        id, code, amount, currency, status, payment_status,
        purchaser_email, purchaser_name, recipient_email, recipient_name,
        personal_message, purchased_at, expires_at, redeemed_by, redeemed_at,
        email_sent, email_sent_at, payment_provider, discount_amount
      `)
      .order('created_at', { ascending: false });

    const { data, error } = await query;

    if (error) {
      console.error('Error fetching gift cards:', error);
      setIsLoading(false);
      return;
    }

    let cards: GiftCard[] = data || [];

    // Fetch redeemed_by user emails
    const redeemedIds = cards.filter(c => c.redeemed_by).map(c => c.redeemed_by as string);
    if (redeemedIds.length > 0) {
      const { data: users } = await supabase
        .from('users')
        .select('id, email')
        .in('id', redeemedIds);

      if (users) {
        const userMap = new Map(users.map(u => [u.id, u.email]));
        cards = cards.map(c => ({
          ...c,
          redeemed_by_email: c.redeemed_by ? userMap.get(c.redeemed_by) || null : null,
        }));
      }
    }

    setGiftCards(cards);

    const totalAmount = cards
      .filter(c => c.payment_status === 'paid')
      .reduce((sum, c) => sum + Number(c.amount), 0);

    setStats({
      total: cards.length,
      active: cards.filter(c => c.status === 'active' && c.payment_status === 'paid').length,
      redeemed: cards.filter(c => c.status === 'redeemed').length,
      totalAmount,
      pending: cards.filter(c => c.payment_status !== 'paid').length,
    });

    setIsLoading(false);
  }, []);

  useEffect(() => {
    fetchGiftCards();
  }, [fetchGiftCards]);

  const handleResendEmail = async (giftCardId: string) => {
    setResendingId(giftCardId);
    setResendResult(null);

    try {
      const { data, error } = await supabase.functions.invoke('send-gift-card-email', {
        body: { giftCardId },
      });

      if (error) throw error;

      setResendResult({ id: giftCardId, success: true, message: 'Correo reenviado exitosamente' });
      await fetchGiftCards();
    } catch (err: any) {
      setResendResult({ id: giftCardId, success: false, message: err.message || 'Error al reenviar correo' });
    } finally {
      setResendingId(null);
      setTimeout(() => setResendResult(null), 5000);
    }
  };

  const toggleCodeVisibility = (id: string) => {
    setShowCodes(prev => ({ ...prev, [id]: !prev[id] }));
  };

  const filteredCards = giftCards.filter(card => {
    if (filterStatus !== 'all') {
      if (filterStatus === 'active' && !(card.status === 'active' && card.payment_status === 'paid')) return false;
      if (filterStatus === 'redeemed' && card.status !== 'redeemed') return false;
      if (filterStatus === 'pending_payment' && card.payment_status === 'paid') return false;
    }

    if (filterPayment !== 'all') {
      if (filterPayment === 'paid' && card.payment_status !== 'paid') return false;
      if (filterPayment === 'pending' && card.payment_status === 'paid') return false;
    }

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim();
      return (
        card.code.toLowerCase().includes(q) ||
        card.purchaser_email.toLowerCase().includes(q) ||
        card.purchaser_name?.toLowerCase().includes(q) ||
        card.recipient_email?.toLowerCase().includes(q) ||
        card.recipient_name?.toLowerCase().includes(q)
      );
    }

    return true;
  });

  const getStatusBadge = (card: GiftCard) => {
    if (card.status === 'redeemed') {
      return (
        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800">
          <Check className="w-3 h-3" /> Canjeada
        </span>
      );
    }
    if (card.payment_status !== 'paid') {
      return (
        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium bg-yellow-100 text-yellow-800">
          <Clock className="w-3 h-3" /> Pago pendiente
        </span>
      );
    }
    return (
      <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-800">
        <Gift className="w-3 h-3" /> Activa
      </span>
    );
  };

  const formatDate = (dateString: string | null) => {
    if (!dateString) return 'N/A';
    return new Date(dateString).toLocaleDateString('es-MX', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gray-50 py-8 px-4">
        <div className="max-w-7xl mx-auto">
          <div className="flex items-center justify-center py-20">
            <div className="w-12 h-12 border-4 border-blue-500 border-t-transparent rounded-full animate-spin" />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 py-8 px-4">
      <div className="max-w-7xl mx-auto">
        <div className="mb-8">
          <div className="flex items-center gap-3 mb-2">
            <Gift className="w-8 h-8 text-amber-600" />
            <h1 className="text-3xl font-bold text-gray-900">Tarjetas de Regalo</h1>
          </div>
          <p className="text-gray-600">Administra todas las tarjetas de regalo compradas en la plataforma</p>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
          <div className="bg-white rounded-xl shadow-sm p-5 border border-gray-100">
            <p className="text-sm text-gray-500 mb-1">Total Vendidas</p>
            <p className="text-2xl font-bold text-gray-900">{stats.total}</p>
          </div>
          <div className="bg-white rounded-xl shadow-sm p-5 border border-gray-100">
            <p className="text-sm text-gray-500 mb-1">Activas</p>
            <p className="text-2xl font-bold text-blue-600">{stats.active}</p>
          </div>
          <div className="bg-white rounded-xl shadow-sm p-5 border border-gray-100">
            <p className="text-sm text-gray-500 mb-1">Canjeadas</p>
            <p className="text-2xl font-bold text-green-600">{stats.redeemed}</p>
          </div>
          <div className="bg-white rounded-xl shadow-sm p-5 border border-gray-100">
            <p className="text-sm text-gray-500 mb-1">Monto Total</p>
            <p className="text-2xl font-bold text-amber-600">{formatCurrencyMXN(stats.totalAmount)}</p>
          </div>
        </div>

        {/* Filters */}
        <div className="bg-white rounded-xl shadow-sm p-4 mb-6 border border-gray-100">
          <div className="flex flex-col md:flex-row gap-4">
            <div className="flex-1 relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Buscar por codigo, email o nombre..."
                className="w-full pl-10 pr-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
            </div>

            <div className="flex gap-2">
              <div className="relative">
                <Filter className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
                <select
                  value={filterStatus}
                  onChange={(e) => setFilterStatus(e.target.value as FilterStatus)}
                  className="pl-9 pr-8 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-sm appearance-none bg-white cursor-pointer"
                >
                  <option value="all">Todos los estados</option>
                  <option value="active">Activas</option>
                  <option value="redeemed">Canjeadas</option>
                  <option value="pending_payment">Pago pendiente</option>
                </select>
              </div>

              <div className="relative">
                <Filter className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
                <select
                  value={filterPayment}
                  onChange={(e) => setFilterPayment(e.target.value as FilterPayment)}
                  className="pl-9 pr-8 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-sm appearance-none bg-white cursor-pointer"
                >
                  <option value="all">Todo pago</option>
                  <option value="paid">Pagadas</option>
                  <option value="pending">Pendientes</option>
                </select>
              </div>
            </div>
          </div>
        </div>

        {/* Table */}
        {filteredCards.length === 0 ? (
          <div className="bg-white rounded-xl shadow-sm p-12 border border-gray-100 text-center">
            <Gift className="w-12 h-12 text-gray-300 mx-auto mb-4" />
            <p className="text-gray-500 text-lg">No se encontraron tarjetas de regalo</p>
            <p className="text-gray-400 text-sm mt-1">Ajusta los filtros o intenta otra busqueda</p>
          </div>
        ) : (
          <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Codigo</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Monto</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Comprador</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Receptor</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Fecha Compra</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Estado</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Canjeada por</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Fecha Canje</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Acciones</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200">
                  {filteredCards.map((card) => (
                    <tr key={card.id} className="hover:bg-gray-50 transition-colors">
                      <td className="px-4 py-3 whitespace-nowrap">
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-sm font-semibold text-gray-900">
                            {showCodes[card.id] ? card.code : '••••-••••-••••-••••'}
                          </span>
                          <button
                            onClick={() => toggleCodeVisibility(card.id)}
                            className="text-gray-400 hover:text-gray-600 transition-colors"
                            title={showCodes[card.id] ? 'Ocultar' : 'Mostrar'}
                          >
                            {showCodes[card.id] ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                          </button>
                        </div>
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        <span className="text-sm font-bold text-gray-900">{formatCurrencyMXN(card.amount)}</span>
                        {card.discount_amount > 0 && (
                          <p className="text-xs text-green-600">Desc: -{formatCurrencyMXN(Number(card.discount_amount))}</p>
                        )}
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        <p className="text-sm text-gray-900 font-medium">{card.purchaser_name}</p>
                        <p className="text-xs text-gray-500">{card.purchaser_email}</p>
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        {card.recipient_email ? (
                          <>
                            <p className="text-sm text-gray-900 font-medium">{card.recipient_name || 'N/A'}</p>
                            <p className="text-xs text-gray-500">{card.recipient_email}</p>
                          </>
                        ) : (
                          <span className="text-xs text-gray-400">Mismo comprador</span>
                        )}
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        <span className="text-xs text-gray-600">{formatDate(card.purchased_at)}</span>
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        {getStatusBadge(card)}
                        {card.payment_provider && (
                          <p className="text-xs text-gray-400 mt-0.5 capitalize">{card.payment_provider}</p>
                        )}
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        {card.redeemed_by_email ? (
                          <span className="text-xs text-gray-600">{card.redeemed_by_email}</span>
                        ) : (
                          <span className="text-xs text-gray-400">Sin canjear</span>
                        )}
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        {card.redeemed_at ? (
                          <span className="text-xs text-gray-600">{formatDate(card.redeemed_at)}</span>
                        ) : (
                          <span className="text-xs text-gray-400">N/A</span>
                        )}
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        <div className="flex items-center gap-2">
                          {card.status !== 'redeemed' && card.payment_status === 'paid' && (
                            <button
                              onClick={() => handleResendEmail(card.id)}
                              disabled={resendingId === card.id}
                              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-blue-600 bg-blue-50 rounded-lg hover:bg-blue-100 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                              title="Reenviar correo"
                            >
                              {resendingId === card.id ? (
                                <RefreshCw className="w-3 h-3 animate-spin" />
                              ) : (
                                <Mail className="w-3 h-3" />
                              )}
                              Reenviar
                            </button>
                          )}
                          {card.email_sent && (
                            <span className="inline-flex items-center gap-1 text-xs text-green-600" title="Correo enviado">
                              <Check className="w-3 h-3" />
                            </span>
                          )}
                        </div>
                        {resendResult?.id === card.id && (
                          <p className={`text-xs mt-1 ${resendResult.success ? 'text-green-600' : 'text-red-600'}`}>
                            {resendResult.message}
                          </p>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
