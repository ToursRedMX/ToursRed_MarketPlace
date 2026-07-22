import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Building2, CheckCircle, Clock, AlertCircle, TrendingUp,
  Calendar, X, Eye, FileText, ExternalLink
} from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../context/AuthContext';
import { formatCurrencyMXN } from '../../utils/formatCurrency';

interface Agency {
  id: string;
  name: string;
  contact_email: string;
  contact_phone: string | null;
  is_approved: boolean;
  is_active: boolean;
  registered_by_executive: boolean;
  account_executive_id: string | null;
  signed_contract_url: string | null;
  approval_period_start: string | null;
  first_tour_published_at: string | null;
  first_paid_booking_at: string | null;
  onboarding_status: string | null;
  created_at: string;
  _tours_count?: number;
  _bookings_count?: number;
  _platform_revenue?: number;
}

const ONBOARDING_LABELS: Record<string, { label: string; color: string }> = {
  pending_documents: { label: 'Pendiente de documentos', color: 'text-gray-600 bg-gray-100 border-gray-200' },
  pending_review:    { label: 'En revisión',              color: 'text-amber-700 bg-amber-100 border-amber-200' },
  pending_signature: { label: 'Pendiente de firma',       color: 'text-blue-700 bg-blue-100 border-blue-200' },
  active:            { label: 'Activa',                   color: 'text-green-700 bg-green-100 border-green-200' },
  rejected:          { label: 'Rechazada',                color: 'text-red-700 bg-red-100 border-red-200' },
};

export default function ExecutiveMisAgencias() {
  const { accountExecutiveInfo } = useAuth();
  const navigate = useNavigate();
  const [agencies, setAgencies] = useState<Agency[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const loadAgencies = useCallback(async () => {
    if (!accountExecutiveInfo?.executiveId) return;
    setIsLoading(true);
    try {
      const { data: agenciesData } = await supabase
        .from('agencies')
        .select(`
          id, name, contact_email, contact_phone, is_approved, is_active,
          registered_by_executive, account_executive_id, signed_contract_url,
          approval_period_start, first_tour_published_at, first_paid_booking_at,
          onboarding_status, created_at
        `)
        .eq('account_executive_id', accountExecutiveInfo.executiveId)
        .order('created_at', { ascending: false });

      if (!agenciesData) { setAgencies([]); return; }

      const agencyIds = agenciesData.map(a => a.id);

      const [toursRes, bookingsRes, commissionsRes] = await Promise.all([
        supabase.from('tours').select('agency_id').in('agency_id', agencyIds),
        supabase.from('bookings').select('agency_id').in('agency_id', agencyIds).eq('payment_status', 'succeeded'),
        supabase.from('commission_records').select('agency_id, platform_total_revenue').in('agency_id', agencyIds),
      ]);

      const tourCounts: Record<string, number> = {};
      const bookingCounts: Record<string, number> = {};
      const revenueMap: Record<string, number> = {};

      (toursRes.data || []).forEach((t: any) => { tourCounts[t.agency_id] = (tourCounts[t.agency_id] || 0) + 1; });
      (bookingsRes.data || []).forEach((b: any) => { bookingCounts[b.agency_id] = (bookingCounts[b.agency_id] || 0) + 1; });
      (commissionsRes.data || []).forEach((c: any) => { revenueMap[c.agency_id] = (revenueMap[c.agency_id] || 0) + Number(c.platform_total_revenue || 0); });

      const enriched = agenciesData.map(a => ({
        ...a,
        _tours_count: tourCounts[a.id] || 0,
        _bookings_count: bookingCounts[a.id] || 0,
        _platform_revenue: revenueMap[a.id] || 0,
      }));

      setAgencies(enriched);
    } finally {
      setIsLoading(false);
    }
  }, [accountExecutiveInfo?.executiveId]);

  useEffect(() => { loadAgencies(); }, [loadAgencies]);

  const getDaysRemainingInPeriod = (approvalDate: string) => {
    const start = new Date(approvalDate);
    const end = new Date(start);
    end.setMonth(end.getMonth() + 3);
    const now = new Date();
    return Math.max(0, Math.ceil((end.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)));
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-96">
        <div className="w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto px-4 py-8 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Mis Agencias</h1>
        <p className="text-gray-500 mt-1">Agencias que has registrado y gestionas</p>
      </div>

      {message && (
        <div className={`rounded-lg px-4 py-3 text-sm flex items-center gap-2 ${message.type === 'success' ? 'bg-green-50 text-green-700 border border-green-200' : 'bg-red-50 text-red-700 border border-red-200'}`}>
          {message.type === 'success' ? <CheckCircle className="h-4 w-4 shrink-0" /> : <AlertCircle className="h-4 w-4 shrink-0" />}
          {message.text}
          <button onClick={() => setMessage(null)} className="ml-auto"><X className="h-4 w-4" /></button>
        </div>
      )}

      {agencies.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-200 py-16 text-center">
          <Building2 className="h-12 w-12 mx-auto text-gray-300 mb-3" />
          <p className="text-gray-500">Aún no tienes agencias registradas</p>
          <p className="text-sm text-gray-400 mt-1">Convierte un lead en agencia desde el pipeline</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {agencies.map(agency => {
            const inPeriod = agency.approval_period_start
              ? getDaysRemainingInPeriod(agency.approval_period_start) > 0
              : false;
            const daysLeft = agency.approval_period_start
              ? getDaysRemainingInPeriod(agency.approval_period_start)
              : 0;
            const onboardingInfo = ONBOARDING_LABELS[agency.onboarding_status || ''] || ONBOARDING_LABELS.pending_documents;

            return (
              <div key={agency.id} className="bg-white rounded-xl border border-gray-200 p-5 space-y-4">
                <div className="flex items-start justify-between">
                  <div>
                    <h3 className="font-semibold text-gray-900">{agency.name}</h3>
                    <p className="text-sm text-gray-400">{agency.contact_email}</p>
                  </div>
                  <div className="flex flex-col items-end gap-1.5">
                    <span className={`inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full border ${onboardingInfo.color}`}>
                      <Clock className="h-3 w-3" /> {onboardingInfo.label}
                    </span>
                    {agency.is_approved && inPeriod && (
                      <span className="text-xs text-blue-600 font-medium">{daysLeft} días de comisión</span>
                    )}
                  </div>
                </div>

                {/* Milestones */}
                <div className="grid grid-cols-3 gap-3 text-center">
                  <div className={`rounded-lg p-2 ${agency.is_approved ? 'bg-green-50' : 'bg-gray-50'}`}>
                    <p className={`text-lg font-bold ${agency.is_approved ? 'text-green-600' : 'text-gray-300'}`}>
                      {agency.is_approved ? '✓' : '○'}
                    </p>
                    <p className="text-xs text-gray-500 mt-0.5">Aprobada</p>
                  </div>
                  <div className={`rounded-lg p-2 ${agency.first_tour_published_at ? 'bg-blue-50' : 'bg-gray-50'}`}>
                    <p className={`text-lg font-bold ${agency.first_tour_published_at ? 'text-blue-600' : 'text-gray-300'}`}>
                      {agency.first_tour_published_at ? '✓' : '○'}
                    </p>
                    <p className="text-xs text-gray-500 mt-0.5">1er tour</p>
                  </div>
                  <div className={`rounded-lg p-2 ${agency.first_paid_booking_at ? 'bg-blue-50' : 'bg-gray-50'}`}>
                    <p className={`text-lg font-bold ${agency.first_paid_booking_at ? 'text-blue-600' : 'text-gray-300'}`}>
                      {agency.first_paid_booking_at ? '✓' : '○'}
                    </p>
                    <p className="text-xs text-gray-500 mt-0.5">1a reserva</p>
                  </div>
                </div>

                {/* Stats */}
                <div className="grid grid-cols-3 gap-3 text-center border-t border-gray-100 pt-3">
                  <div>
                    <p className="text-xl font-bold text-gray-900">{agency._tours_count}</p>
                    <p className="text-xs text-gray-400">Tours</p>
                  </div>
                  <div>
                    <p className="text-xl font-bold text-gray-900">{agency._bookings_count}</p>
                    <p className="text-xs text-gray-400">Reservas</p>
                  </div>
                  <div>
                    <p className="text-sm font-bold text-gray-900">{formatCurrencyMXN(agency._platform_revenue || 0)}</p>
                    <p className="text-xs text-gray-400">Ingreso plataforma</p>
                  </div>
                </div>

                {/* Actions */}
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => navigate(`/executive/agency/${agency.id}`)}
                    className="flex-1 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 transition-colors flex items-center justify-center gap-2"
                  >
                    <Eye className="h-4 w-4" />
                    Ver perfil
                  </button>
                  {agency.signed_contract_url && (
                    <button
                      onClick={async () => {
                        const url = agency.signed_contract_url!;
                        const isFullUrl = url.startsWith('http');
                        const filePath = isFullUrl
                          ? url.split('/signed-contracts/').pop() || url
                          : url;

                        if (isFullUrl && !url.includes('/signed-contracts/')) {
                          window.open(url, '_blank');
                          return;
                        }

                        const { data, error } = await supabase.storage
                          .from('signed-contracts')
                          .createSignedUrl(filePath, 60);
                        if (error || !data?.signedUrl) {
                          setMessage({ type: 'error', text: 'No se pudo generar el enlace del contrato.' });
                          return;
                        }
                        window.open(data.signedUrl, '_blank');
                      }}
                      className="px-3 py-2 border border-gray-200 text-gray-600 rounded-lg text-sm font-medium hover:bg-gray-50 transition-colors flex items-center gap-1"
                    >
                      <FileText className="h-4 w-4" /> Contrato
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
