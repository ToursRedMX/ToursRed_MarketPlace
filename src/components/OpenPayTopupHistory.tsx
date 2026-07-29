import React, { useState, useEffect, useCallback } from 'react';
import {
  Building2, QrCode, Clock, CheckCircle2, XCircle, RefreshCw, AlertCircle,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { formatCurrencyMXN } from '../utils/formatCurrency';
import { supabase } from '../lib/supabase';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';

interface TopupRecord {
  id: string;
  amount: number;
  currency: string;
  payment_method_type: 'spei' | 'codi';
  status: string;
  created_at: string;
  credited_at: string | null;
  error_message: string | null;
}

const STATUS_CONFIG: Record<string, { label: string; color: string; icon: React.ReactNode }> = {
  pending: { label: 'Pendiente', color: 'text-gray-600 bg-gray-100', icon: <Clock className="h-4 w-4" /> },
  awaiting_transfer: { label: 'Pendiente de transferencia', color: 'text-amber-600 bg-amber-100', icon: <Clock className="h-4 w-4" /> },
  completed: { label: 'Acreditada', color: 'text-green-600 bg-green-100', icon: <CheckCircle2 className="h-4 w-4" /> },
  expired: { label: 'Vencida', color: 'text-gray-600 bg-gray-100', icon: <XCircle className="h-4 w-4" /> },
  cancelled: { label: 'Cancelada', color: 'text-red-600 bg-red-100', icon: <XCircle className="h-4 w-4" /> },
  failed: { label: 'Fallida', color: 'text-red-600 bg-red-100', icon: <AlertCircle className="h-4 w-4" /> },
};

const OpenPayTopupHistory: React.FC = () => {
  const { user } = useAuth();
  const [topups, setTopups] = useState<TopupRecord[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [checkingId, setCheckingId] = useState<string | null>(null);

  const loadTopups = useCallback(async () => {
    if (!user) return;
    setIsLoading(true);
    try {
      const { data, error } = await supabase
        .from('openpay_wallet_topups')
        .select('id, amount, currency, payment_method_type, status, created_at, credited_at, error_message')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false })
        .limit(20);

      if (error) throw error;
      setTopups(data || []);
    } catch (err) {
      console.error('Error loading topups:', err);
    } finally {
      setIsLoading(false);
    }
  }, [user]);

  useEffect(() => {
    loadTopups();
  }, [loadTopups]);

  const handleCheckStatus = async (topupId: string) => {
    setCheckingId(topupId);
    try {
      const session = await supabase.auth.getSession();
      const token = session.data.session?.access_token;

      const response = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/check-openpay-topup-status`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ topup_id: topupId }),
        }
      );

      const data = await response.json();
      if (data.status === 'completed') {
        await loadTopups();
      }
    } catch {
      // silent
    } finally {
      setCheckingId(null);
    }
  };

  if (isLoading) {
    return (
      <div className="bg-white rounded-lg shadow-md p-6">
        <h2 className="text-xl font-semibold flex items-center gap-2 mb-4">
          <RefreshCw className="h-5 w-5 text-gray-600" />
          Historial de Recargas
        </h2>
        <div className="text-center py-8 text-gray-500">Cargando...</div>
      </div>
    );
  }

  if (topups.length === 0) {
    return null;
  }

  return (
    <div className="bg-white rounded-lg shadow-md">
      <div className="border-b border-gray-200 px-6 py-4">
        <h2 className="text-xl font-semibold flex items-center gap-2">
          <RefreshCw className="h-5 w-5 text-gray-600" />
          Historial de Recargas
        </h2>
      </div>

      <div className="p-6">
        <div className="space-y-3">
          {topups.map((topup) => {
            const config = STATUS_CONFIG[topup.status] || STATUS_CONFIG.pending;
            return (
              <div
                key={topup.id}
                className="flex items-center justify-between p-4 bg-gray-50 rounded-lg hover:bg-gray-100 transition-colors"
              >
                <div className="flex items-center gap-3 flex-1">
                  <div className="bg-white rounded-full p-2 shadow-sm">
                    {topup.payment_method_type === 'spei' ? (
                      <Building2 className="h-5 w-5 text-accent-600" />
                    ) : (
                      <QrCode className="h-5 w-5 text-blue-600" />
                    )}
                  </div>
                  <div className="flex-1">
                    <p className="font-medium text-gray-900">
                      Recarga via {topup.payment_method_type === 'spei' ? 'SPEI' : 'CoDi'}
                    </p>
                    <div className="flex items-center gap-2 mt-1">
                      <span className={`text-xs px-2 py-1 rounded-full font-medium flex items-center gap-1 ${config.color}`}>
                        {config.icon}
                        {config.label}
                      </span>
                      <span className="text-xs text-gray-500">
                        {format(new Date(topup.created_at), "d 'de' MMMM 'de' yyyy, HH:mm", { locale: es })}
                      </span>
                    </div>
                    {topup.error_message && topup.status === 'failed' && (
                      <p className="text-xs text-red-600 mt-1">{topup.error_message}</p>
                    )}
                  </div>
                </div>

                <div className="flex items-center gap-3">
                  <p className="text-lg font-bold text-gray-900">
                    {formatCurrencyMXN(Number(topup.amount))}
                  </p>
                  {(topup.status === 'awaiting_transfer' || topup.status === 'pending') && (
                    <button
                      onClick={() => handleCheckStatus(topup.id)}
                      disabled={checkingId === topup.id}
                      className="p-2 text-gray-400 hover:text-accent-600 transition-colors rounded-lg hover:bg-white disabled:opacity-50"
                      title="Verificar estado"
                    >
                      {checkingId === topup.id ? (
                        <RefreshCw className="h-4 w-4 animate-spin" />
                      ) : (
                        <RefreshCw className="h-4 w-4" />
                      )}
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};

export default OpenPayTopupHistory;
