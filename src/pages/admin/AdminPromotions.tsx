import React, { useState, useEffect } from 'react';
import { Tag, Search, Filter, Eye, ToggleLeft, ToggleRight, AlertCircle, Check, Calendar, Users, Building, X, ChevronDown, Loader2 } from 'lucide-react';
import { formatCurrency } from '../../utils/formatCurrency';
import { supabase } from '../../lib/supabase';

interface TourPromotion {
  id: string;
  tour_id: string;
  agency_id: string;
  promotion_type: '2x1' | '3x2' | 'grupo_precio_fijo' | 'nxprecio';
  min_travelers: number;
  group_size: number;
  pay_count: number;
  fixed_group_price: number | null;
  group_discount_percentage: number | null;
  valid_from: string;
  valid_until: string;
  max_uses: number | null;
  times_used: number;
  is_active: boolean;
  deactivation_reason: string | null;
  created_at: string;
  tours?: { name: string; destination: string };
  agencies?: { name: string };
}

type StatusFilter = 'all' | 'active' | 'inactive' | 'expired' | 'scheduled';
type TypeFilter = 'all' | '2x1' | '3x2' | 'grupo_precio_fijo' | 'nxprecio';

const AdminPromotions: React.FC = () => {
  const [promotions, setPromotions] = useState<TourPromotion[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [typeFilter, setTypeFilter] = useState<TypeFilter>('all');
  const [deactivateModal, setDeactivateModal] = useState<{ open: boolean; promotion: TourPromotion | null }>({ open: false, promotion: null });
  const [deactivationReason, setDeactivationReason] = useState('');
  const [isDeactivating, setIsDeactivating] = useState(false);
  const [actionMessage, setActionMessage] = useState('');

  useEffect(() => {
    loadPromotions();
  }, []);

  const loadPromotions = async () => {
    setIsLoading(true);
    const { data, error } = await supabase
      .from('tour_promotions')
      .select(`
        *,
        tours(name, destination),
        agencies(name)
      `)
      .order('created_at', { ascending: false });

    if (!error && data) {
      setPromotions(data);
    }
    setIsLoading(false);
  };

  const getPromotionStatus = (promo: TourPromotion): 'active' | 'inactive' | 'expired' | 'scheduled' => {
    const now = new Date();
    const validFrom = new Date(promo.valid_from);
    const validUntil = new Date(promo.valid_until);

    if (!promo.is_active) return 'inactive';
    if (validUntil < now) return 'expired';
    if (validFrom > now) return 'scheduled';
    return 'active';
  };

  const filtered = promotions.filter(p => {
    const status = getPromotionStatus(p);
    const matchesStatus = statusFilter === 'all' || status === statusFilter;
    const matchesType = typeFilter === 'all' || p.promotion_type === typeFilter;
    const name = p.tours?.name?.toLowerCase() || '';
    const agency = p.agencies?.name?.toLowerCase() || '';
    const query = searchQuery.toLowerCase();
    const matchesSearch = !query || name.includes(query) || agency.includes(query);
    return matchesStatus && matchesType && matchesSearch;
  });

  const stats = {
    total: promotions.length,
    active: promotions.filter(p => getPromotionStatus(p) === 'active').length,
    inactive: promotions.filter(p => getPromotionStatus(p) === 'inactive').length,
    expired: promotions.filter(p => getPromotionStatus(p) === 'expired').length,
  };

  const handleDeactivate = async () => {
    if (!deactivateModal.promotion || !deactivationReason.trim()) return;
    setIsDeactivating(true);

    const { error } = await supabase
      .from('tour_promotions')
      .update({
        is_active: false,
        deactivation_reason: deactivationReason.trim(),
      })
      .eq('id', deactivateModal.promotion.id);

    if (!error) {
      setActionMessage('Promoción desactivada correctamente.');
      await loadPromotions();
    }

    setIsDeactivating(false);
    setDeactivateModal({ open: false, promotion: null });
    setDeactivationReason('');
    setTimeout(() => setActionMessage(''), 4000);
  };

  const handleToggleActive = async (promo: TourPromotion) => {
    if (!promo.is_active) {
      const { error } = await supabase
        .from('tour_promotions')
        .update({ is_active: true, deactivation_reason: null })
        .eq('id', promo.id);

      if (!error) {
        setActionMessage('Promoción reactivada.');
        await loadPromotions();
        setTimeout(() => setActionMessage(''), 3000);
      }
    } else {
      setDeactivationReason('');
      setDeactivateModal({ open: true, promotion: promo });
    }
  };

  const getPromoLabel = (type: string) => {
    if (type === '2x1') return '2x1';
    if (type === '3x2') return '3x2';
    if (type === 'nxprecio') return 'N x Precio';
    return 'Precio Grupal';
  };

  const getTypeBadgeClass = (type: string) => {
    if (type === '2x1') return 'bg-rose-100 text-rose-700 border-rose-200';
    if (type === '3x2') return 'bg-orange-100 text-orange-700 border-orange-200';
    if (type === 'nxprecio') return 'bg-teal-100 text-teal-700 border-teal-200';
    return 'bg-emerald-100 text-emerald-700 border-emerald-200';
  };

  const getStatusBadge = (promo: TourPromotion) => {
    const status = getPromotionStatus(promo);
    const map: Record<string, string> = {
      active: 'bg-green-100 text-green-700',
      inactive: 'bg-gray-100 text-gray-600',
      expired: 'bg-red-100 text-red-600',
      scheduled: 'bg-blue-100 text-blue-700',
    };
    const labels: Record<string, string> = {
      active: 'Activa',
      inactive: 'Inactiva',
      expired: 'Vencida',
      scheduled: 'Programada',
    };
    return (
      <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${map[status]}`}>
        {labels[status]}
      </span>
    );
  };

  const formatDate = (d: string) => new Date(d).toLocaleDateString('es-MX', { day: '2-digit', month: 'short', year: 'numeric' });

  return (
    <div className="max-w-7xl mx-auto px-4 py-8">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
          <Tag className="w-7 h-7 text-rose-600" />
          Promociones Grupales
        </h1>
        <p className="text-gray-500 text-sm mt-1">Supervisa y gestiona las promociones 2x1, 3x2, precio especial y N x precio de todas las agencias.</p>
      </div>

      {actionMessage && (
        <div className="mb-4 flex items-center gap-2 bg-green-50 border border-green-200 rounded-md p-3">
          <Check className="w-4 h-4 text-green-600" />
          <p className="text-sm text-green-700">{actionMessage}</p>
        </div>
      )}

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
        {[
          { label: 'Total', value: stats.total, color: 'bg-gray-50 border-gray-200 text-gray-700' },
          { label: 'Activas', value: stats.active, color: 'bg-green-50 border-green-200 text-green-700' },
          { label: 'Inactivas', value: stats.inactive, color: 'bg-gray-50 border-gray-200 text-gray-500' },
          { label: 'Vencidas', value: stats.expired, color: 'bg-red-50 border-red-200 text-red-600' },
        ].map(stat => (
          <div key={stat.label} className={`border rounded-lg p-4 ${stat.color}`}>
            <div className="text-2xl font-bold">{stat.value}</div>
            <div className="text-xs font-medium mt-0.5">{stat.label}</div>
          </div>
        ))}
      </div>

      <div className="bg-white border border-gray-200 rounded-xl shadow-sm">
        <div className="p-4 border-b border-gray-100 flex flex-col sm:flex-row gap-3">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input
              type="text"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              placeholder="Buscar por tour o agencia..."
              className="w-full pl-9 pr-3 py-2 border border-gray-300 rounded-md text-sm focus:ring-2 focus:ring-rose-500 focus:border-rose-500"
            />
          </div>

          <div className="flex gap-2">
            <select
              value={statusFilter}
              onChange={e => setStatusFilter(e.target.value as StatusFilter)}
              className="border border-gray-300 rounded-md text-sm px-3 py-2 focus:ring-2 focus:ring-rose-500 focus:border-rose-500"
            >
              <option value="all">Todos los estados</option>
              <option value="active">Activas</option>
              <option value="scheduled">Programadas</option>
              <option value="inactive">Inactivas</option>
              <option value="expired">Vencidas</option>
            </select>

            <select
              value={typeFilter}
              onChange={e => setTypeFilter(e.target.value as TypeFilter)}
              className="border border-gray-300 rounded-md text-sm px-3 py-2 focus:ring-2 focus:ring-rose-500 focus:border-rose-500"
            >
              <option value="all">Todos los tipos</option>
              <option value="2x1">2x1</option>
              <option value="3x2">3x2</option>
              <option value="grupo_precio_fijo">Precio Grupal</option>
              <option value="nxprecio">N x Precio</option>
            </select>
          </div>
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-16 text-gray-400">
            <Tag className="w-12 h-12 mx-auto mb-3 text-gray-200" />
            <p className="text-sm">No hay promociones que coincidan con los filtros.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 bg-gray-50">
                  <th className="text-left px-4 py-3 font-semibold text-gray-600">Tour / Agencia</th>
                  <th className="text-left px-4 py-3 font-semibold text-gray-600">Tipo</th>
                  <th className="text-left px-4 py-3 font-semibold text-gray-600">Vigencia</th>
                  <th className="text-left px-4 py-3 font-semibold text-gray-600">Usos</th>
                  <th className="text-left px-4 py-3 font-semibold text-gray-600">Estado</th>
                  <th className="text-left px-4 py-3 font-semibold text-gray-600">Acciones</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {filtered.map(promo => (
                  <tr key={promo.id} className="hover:bg-gray-50 transition-colors">
                    <td className="px-4 py-3">
                      <div className="font-medium text-gray-900 line-clamp-1">{promo.tours?.name || '—'}</div>
                      <div className="text-xs text-gray-500 flex items-center gap-1 mt-0.5">
                        <Building className="w-3 h-3" />
                        {promo.agencies?.name || '—'}
                      </div>
                      {promo.deactivation_reason && (
                        <div className="text-xs text-red-500 mt-0.5 flex items-center gap-1">
                          <AlertCircle className="w-3 h-3" />
                          {promo.deactivation_reason}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded border text-xs font-semibold ${getTypeBadgeClass(promo.promotion_type)}`}>
                        <Tag className="w-3 h-3" />
                        {getPromoLabel(promo.promotion_type)}
                      </span>
                      {promo.promotion_type === 'grupo_precio_fijo' && promo.group_discount_percentage && (
                        <div className="text-xs text-gray-500 mt-0.5">
                          {promo.group_discount_percentage}% desc. / {promo.min_travelers}+ viaj.
                        </div>
                      )}
                      {promo.promotion_type === 'nxprecio' && promo.fixed_group_price && (
                        <div className="text-xs text-gray-500 mt-0.5">
                          {promo.min_travelers} por ${formatCurrency(promo.fixed_group_price)}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <div className="text-xs text-gray-700 flex items-center gap-1">
                        <Calendar className="w-3 h-3 text-gray-400" />
                        {formatDate(promo.valid_from)}
                      </div>
                      <div className="text-xs text-gray-500 ml-4">al {formatDate(promo.valid_until)}</div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1 text-xs text-gray-700">
                        <Users className="w-3 h-3 text-gray-400" />
                        {promo.times_used}{promo.max_uses ? `/${promo.max_uses}` : ' usos'}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      {getStatusBadge(promo)}
                    </td>
                    <td className="px-4 py-3">
                      <button
                        onClick={() => handleToggleActive(promo)}
                        title={promo.is_active ? 'Desactivar por violación de política' : 'Reactivar'}
                        className="p-1.5 rounded hover:bg-gray-100 transition-colors"
                      >
                        {promo.is_active
                          ? <ToggleRight className="w-5 h-5 text-green-600" />
                          : <ToggleLeft className="w-5 h-5 text-gray-400" />
                        }
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {deactivateModal.open && deactivateModal.promotion && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-2xl max-w-md w-full p-6">
            <div className="flex items-start justify-between mb-4">
              <div className="flex items-center gap-2">
                <AlertCircle className="w-5 h-5 text-orange-500" />
                <h3 className="text-base font-bold text-gray-900">Desactivar Promoción</h3>
              </div>
              <button onClick={() => setDeactivateModal({ open: false, promotion: null })} className="text-gray-400 hover:text-gray-600">
                <X className="w-5 h-5" />
              </button>
            </div>

            <p className="text-sm text-gray-600 mb-1">
              Tour: <span className="font-medium">{deactivateModal.promotion.tours?.name}</span>
            </p>
            <p className="text-sm text-gray-600 mb-4">
              Agencia: <span className="font-medium">{deactivateModal.promotion.agencies?.name}</span>
            </p>

            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Motivo de desactivación <span className="text-red-500">*</span>
              </label>
              <textarea
                value={deactivationReason}
                onChange={e => setDeactivationReason(e.target.value)}
                rows={3}
                placeholder="Describe la razón (ej: viola política de precios, contenido inapropiado...)"
                className="w-full border border-gray-300 rounded-md text-sm px-3 py-2 focus:ring-2 focus:ring-rose-500 focus:border-rose-500"
              />
            </div>

            <div className="flex gap-2 justify-end">
              <button
                onClick={() => setDeactivateModal({ open: false, promotion: null })}
                className="px-4 py-2 border border-gray-300 rounded-md text-sm font-medium text-gray-700 hover:bg-gray-50"
              >
                Cancelar
              </button>
              <button
                onClick={handleDeactivate}
                disabled={!deactivationReason.trim() || isDeactivating}
                className="px-4 py-2 bg-rose-600 text-white rounded-md text-sm font-medium hover:bg-rose-700 disabled:bg-gray-300 disabled:cursor-not-allowed flex items-center gap-2"
              >
                {isDeactivating ? <Loader2 className="w-4 h-4 animate-spin" /> : <AlertCircle className="w-4 h-4" />}
                Desactivar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default AdminPromotions;
