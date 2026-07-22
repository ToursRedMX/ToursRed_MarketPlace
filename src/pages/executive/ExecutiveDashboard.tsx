import React, { useState, useEffect } from 'react';
import {
  Users, TrendingUp, DollarSign, Clock, Target, CheckCircle,
  AlertCircle, ChevronRight, Building2, Star, Award
} from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../context/AuthContext';
import { formatCurrencyMXN } from '../../utils/formatCurrency';

interface DashboardStats {
  totalLeads: number;
  leadsActivos: number;
  agenciasRegistradas: number;
  agenciasAprobadas: number;
  comisionPendiente: number;
  comisionPagada: number;
  comisionEsteMes: number;
  agenciasEnPeriodo: number;
}

interface RecentAgency {
  id: string;
  name: string;
  is_approved: boolean;
  approval_period_start: string | null;
  first_tour_published_at: string | null;
  first_paid_booking_at: string | null;
  created_at: string;
}

interface CommissionItem {
  id: string;
  commission_type: string;
  amount: number;
  status: string;
  created_at: string;
  agencies: { name: string };
}

const COMMISSION_TYPE_LABELS: Record<string, string> = {
  approval: 'Aprobación de agencia',
  first_tour_and_booking: 'Primer tour y reserva',
  platform_period: 'Comisión periodo',
};

const STATUS_COLORS: Record<string, string> = {
  pending: 'text-amber-600 bg-amber-50',
  invoiced: 'text-blue-600 bg-blue-50',
  approved: 'text-green-600 bg-green-50',
  paid: 'text-gray-600 bg-gray-100',
  rejected: 'text-red-600 bg-red-50',
};

const STATUS_LABELS: Record<string, string> = {
  pending: 'Pendiente',
  invoiced: 'CFDI enviado',
  approved: 'Aprobado',
  paid: 'Pagado',
  rejected: 'Rechazado',
};

export default function ExecutiveDashboard() {
  const { accountExecutiveInfo } = useAuth();
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [recentAgencies, setRecentAgencies] = useState<RecentAgency[]>([]);
  const [recentCommissions, setRecentCommissions] = useState<CommissionItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [bonusRules, setBonusRules] = useState<any[]>([]);

  useEffect(() => {
    if (accountExecutiveInfo?.executiveId) {
      loadDashboard();
    }
  }, [accountExecutiveInfo?.executiveId]);

  const loadDashboard = async () => {
    if (!accountExecutiveInfo?.executiveId) return;
    setIsLoading(true);
    try {
      const execId = accountExecutiveInfo.executiveId;

      const [leadsRes, agenciesRes, commissionsRes, bonusRes] = await Promise.all([
        supabase
          .from('agency_leads')
          .select('status')
          .eq('executive_id', execId),
        supabase
          .from('agencies')
          .select('id, name, is_approved, approval_period_start, first_tour_published_at, first_paid_booking_at, created_at')
          .eq('account_executive_id', execId)
          .eq('registered_by_executive', true)
          .order('created_at', { ascending: false })
          .limit(5),
        supabase
          .from('executive_commissions')
          .select('id, commission_type, amount, status, created_at, agencies(name)')
          .eq('executive_id', execId)
          .order('created_at', { ascending: false })
          .limit(8),
        supabase
          .from('executive_bonus_rules')
          .select('*')
          .eq('is_active', true),
      ]);

      const leads = leadsRes.data || [];
      const agencies = agenciesRes.data || [];
      const commissions = commissionsRes.data || [];

      const now = new Date();
      const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();

      const allCommsRes = await supabase
        .from('executive_commissions')
        .select('amount, status, created_at')
        .eq('executive_id', execId);

      const allComms = allCommsRes.data || [];

      const pending = allComms.filter(c => ['pending', 'invoiced', 'approved'].includes(c.status))
        .reduce((s, c) => s + Number(c.amount), 0);
      const paid = allComms.filter(c => c.status === 'paid')
        .reduce((s, c) => s + Number(c.amount), 0);
      const thisMonth = allComms.filter(c => c.created_at >= startOfMonth)
        .reduce((s, c) => s + Number(c.amount), 0);

      const agenciasEnPeriodo = agencies.filter(a => {
        if (!a.approval_period_start) return false;
        const start = new Date(a.approval_period_start);
        const end = new Date(start);
        end.setMonth(end.getMonth() + 3);
        return now < end;
      }).length;

      setStats({
        totalLeads: leads.length,
        leadsActivos: leads.filter(l => !['registrado', 'aprobado', 'perdido'].includes(l.status)).length,
        agenciasRegistradas: agencies.length,
        agenciasAprobadas: agencies.filter(a => a.is_approved).length,
        comisionPendiente: pending,
        comisionPagada: paid,
        comisionEsteMes: thisMonth,
        agenciasEnPeriodo,
      });

      setRecentAgencies(agencies as RecentAgency[]);
      setRecentCommissions(commissions as any[]);
      setBonusRules(bonusRes.data || []);
    } finally {
      setIsLoading(false);
    }
  };

  const getMonthsRemaining = (approvalDate: string) => {
    const start = new Date(approvalDate);
    const end = new Date(start);
    end.setMonth(end.getMonth() + 3);
    const now = new Date();
    const diffMs = end.getTime() - now.getTime();
    const diffDays = Math.ceil(diffMs / (1000 * 60 * 60 * 24));
    return Math.max(0, diffDays);
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-96">
        <div className="w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto px-4 py-8 space-y-8">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-gray-900">
          Bienvenido, {accountExecutiveInfo?.firstName}
        </h1>
        <p className="text-gray-500 mt-1">Panel de ejecutivo de cuenta</p>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <div className="flex items-center justify-between mb-3">
            <span className="text-sm text-gray-500">Leads activos</span>
            <div className="w-9 h-9 bg-sky-100 rounded-lg flex items-center justify-center">
              <Users className="h-5 w-5 text-sky-600" />
            </div>
          </div>
          <p className="text-3xl font-bold text-gray-900">{stats?.leadsActivos ?? 0}</p>
          <p className="text-xs text-gray-400 mt-1">de {stats?.totalLeads ?? 0} totales</p>
        </div>

        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <div className="flex items-center justify-between mb-3">
            <span className="text-sm text-gray-500">Agencias aprobadas</span>
            <div className="w-9 h-9 bg-green-100 rounded-lg flex items-center justify-center">
              <CheckCircle className="h-5 w-5 text-green-600" />
            </div>
          </div>
          <p className="text-3xl font-bold text-gray-900">{stats?.agenciasAprobadas ?? 0}</p>
          <p className="text-xs text-gray-400 mt-1">{stats?.agenciasEnPeriodo ?? 0} en periodo activo</p>
        </div>

        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <div className="flex items-center justify-between mb-3">
            <span className="text-sm text-gray-500">Comisiones pendientes</span>
            <div className="w-9 h-9 bg-amber-100 rounded-lg flex items-center justify-center">
              <Clock className="h-5 w-5 text-amber-600" />
            </div>
          </div>
          <p className="text-3xl font-bold text-amber-600">{formatCurrencyMXN(stats?.comisionPendiente ?? 0)}</p>
          <p className="text-xs text-gray-400 mt-1">por cobrar</p>
        </div>

        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <div className="flex items-center justify-between mb-3">
            <span className="text-sm text-gray-500">Cobrado histórico</span>
            <div className="w-9 h-9 bg-blue-100 rounded-lg flex items-center justify-center">
              <DollarSign className="h-5 w-5 text-blue-600" />
            </div>
          </div>
          <p className="text-3xl font-bold text-blue-600">{formatCurrencyMXN(stats?.comisionPagada ?? 0)}</p>
          <p className="text-xs text-gray-400 mt-1">este mes: {formatCurrencyMXN(stats?.comisionEsteMes ?? 0)}</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Mis Agencias Recientes */}
        <div className="bg-white rounded-xl border border-gray-200">
          <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
            <h2 className="font-semibold text-gray-900 flex items-center gap-2">
              <Building2 className="h-4 w-4 text-gray-500" />
              Mis agencias recientes
            </h2>
            <a href="/executive/mis-agencias" className="text-sm text-blue-600 hover:text-blue-700 flex items-center gap-1">
              Ver todas <ChevronRight className="h-4 w-4" />
            </a>
          </div>
          <div className="divide-y divide-gray-50">
            {recentAgencies.length === 0 ? (
              <div className="px-6 py-8 text-center text-gray-400 text-sm">
                Aún no tienes agencias registradas
              </div>
            ) : (
              recentAgencies.map(agency => (
                <div key={agency.id} className="px-6 py-4 flex items-center justify-between">
                  <div>
                    <p className="font-medium text-gray-900 text-sm">{agency.name}</p>
                    <div className="flex items-center gap-3 mt-1">
                      {agency.is_approved ? (
                        <span className="text-xs text-green-600 flex items-center gap-0.5">
                          <CheckCircle className="h-3 w-3" /> Aprobada
                        </span>
                      ) : (
                        <span className="text-xs text-amber-600 flex items-center gap-0.5">
                          <Clock className="h-3 w-3" /> Pendiente aprobación
                        </span>
                      )}
                      {agency.first_tour_published_at && (
                        <span className="text-xs text-gray-400">Tour publicado</span>
                      )}
                      {agency.first_paid_booking_at && (
                        <span className="text-xs text-gray-400">1a reserva</span>
                      )}
                    </div>
                  </div>
                  {agency.approval_period_start && (
                    <div className="text-right">
                      <p className="text-xs text-gray-500">Periodo</p>
                      <p className="text-xs font-medium text-blue-600">
                        {getMonthsRemaining(agency.approval_period_start)} días
                      </p>
                    </div>
                  )}
                </div>
              ))
            )}
          </div>
        </div>

        {/* Comisiones Recientes */}
        <div className="bg-white rounded-xl border border-gray-200">
          <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
            <h2 className="font-semibold text-gray-900 flex items-center gap-2">
              <TrendingUp className="h-4 w-4 text-gray-500" />
              Comisiones recientes
            </h2>
            <a href="/executive/comisiones" className="text-sm text-blue-600 hover:text-blue-700 flex items-center gap-1">
              Ver todas <ChevronRight className="h-4 w-4" />
            </a>
          </div>
          <div className="divide-y divide-gray-50">
            {recentCommissions.length === 0 ? (
              <div className="px-6 py-8 text-center text-gray-400 text-sm">
                Aún no tienes comisiones generadas
              </div>
            ) : (
              recentCommissions.map(comm => (
                <div key={comm.id} className="px-6 py-3 flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-gray-900">
                      {COMMISSION_TYPE_LABELS[comm.commission_type] ?? comm.commission_type}
                    </p>
                    <p className="text-xs text-gray-400">{(comm.agencies as any)?.name}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-bold text-gray-900">{formatCurrencyMXN(comm.amount)}</p>
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${STATUS_COLORS[comm.status] || 'text-gray-600 bg-gray-100'}`}>
                      {STATUS_LABELS[comm.status] ?? comm.status}
                    </span>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      {/* Bonos disponibles */}
      {bonusRules.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-200">
          <div className="px-6 py-4 border-b border-gray-100">
            <h2 className="font-semibold text-gray-900 flex items-center gap-2">
              <Award className="h-4 w-4 text-gray-500" />
              Bonos disponibles
            </h2>
          </div>
          <div className="p-6 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {bonusRules.map(rule => (
              <div key={rule.id} className="border border-dashed border-gray-200 rounded-lg p-4 bg-gradient-to-br from-amber-50 to-orange-50">
                <div className="flex items-start gap-3">
                  <div className="w-10 h-10 bg-amber-100 rounded-lg flex items-center justify-center shrink-0">
                    <Star className="h-5 w-5 text-amber-600" />
                  </div>
                  <div>
                    <p className="font-medium text-gray-900 text-sm">{rule.name}</p>
                    {rule.description && (
                      <p className="text-xs text-gray-500 mt-0.5">{rule.description}</p>
                    )}
                    <div className="mt-2 flex items-center gap-2">
                      <Target className="h-3 w-3 text-amber-600" />
                      <span className="text-xs text-amber-700 font-medium">
                        Meta: {rule.threshold_value} {rule.condition_type === 'agencies_approved_count' ? 'agencias' : rule.condition_type === 'revenue_generated' ? 'en ingresos' : 'reservas'}
                      </span>
                    </div>
                    <p className="text-base font-bold text-amber-600 mt-1">
                      {formatCurrencyMXN(rule.bonus_amount)} bono
                    </p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
