import React, { useState, useEffect } from 'react';
import { MapPin, Building2, Calendar, DollarSign, Percent, CreditCard as Edit2, X, Save, RotateCcw, Info, Search, Filter, ChevronDown, CheckCircle, AlertCircle, Clock, Tag } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { formatCurrency } from '../../utils/formatCurrency';
import { format, parseISO } from 'date-fns';
import { es } from 'date-fns/locale';

interface TourRow {
  id: string;
  name: string;
  destination: string;
  tour_type: 'excursion' | 'receptivo';
  price: number;
  start_date: string | null;
  end_date: string | null;
  commission_rate_override: number | null;
  commission_override_expires_at: string | null;
  commission_override_reason: string | null;
  agencies: {
    id: string;
    name: string;
    commission_rate: number | null;
  } | null;
}

interface PlatformSettings {
  agency_commission_percentage: number;
  service_charge_percentage: number;
}

type RateSource = 'tour_override' | 'agency' | 'platform';

function getEffectiveRate(tour: TourRow, platform: PlatformSettings | null): { rate: number; source: RateSource } {
  if (tour.commission_rate_override != null) {
    const expired = tour.commission_override_expires_at
      ? new Date(tour.commission_override_expires_at) <= new Date()
      : false;
    if (!expired) {
      return { rate: tour.commission_rate_override * 100, source: 'tour_override' };
    }
  }
  if (tour.agencies?.commission_rate != null) {
    return { rate: tour.agencies.commission_rate * 100, source: 'agency' };
  }
  return { rate: platform?.agency_commission_percentage ?? 15, source: 'platform' };
}

const sourceLabel: Record<RateSource, string> = {
  tour_override: 'Override de tour',
  agency: 'Tasa de agencia',
  platform: 'Default plataforma',
};

const sourceBadgeClass: Record<RateSource, string> = {
  tour_override: 'bg-amber-100 text-amber-800 border border-amber-200',
  agency: 'bg-blue-100 text-blue-800 border border-blue-200',
  platform: 'bg-slate-100 text-slate-600 border border-slate-200',
};

const AdminTours: React.FC = () => {
  const [tours, setTours] = useState<TourRow[]>([]);
  const [platform, setPlatform] = useState<PlatformSettings | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  // Filtros
  const [search, setSearch] = useState('');
  const [filterType, setFilterType] = useState<'all' | 'excursion' | 'receptivo'>('all');
  const [filterOverride, setFilterOverride] = useState<'all' | 'with_override' | 'no_override'>('all');

  // Modal de edición
  const [editingTour, setEditingTour] = useState<TourRow | null>(null);
  const [overrideEnabled, setOverrideEnabled] = useState(false);
  const [overridePercent, setOverridePercent] = useState('');
  const [overridePercentInput, setOverridePercentInput] = useState('');
  const [overrideExpires, setOverrideExpires] = useState('');
  const [overrideReason, setOverrideReason] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    setIsLoading(true);
    setError('');
    try {
      const [toursRes, settingsRes] = await Promise.all([
        supabase
          .from('tours')
          .select(`
            id, name, destination, tour_type, price, start_date, end_date,
            commission_rate_override, commission_override_expires_at, commission_override_reason,
            agencies(id, name, commission_rate)
          `)
          .or(`end_date.is.null,end_date.gte.${new Date().toISOString().slice(0, 10)}`)
          .order('name'),
        supabase
          .from('platform_settings')
          .select('agency_commission_percentage, service_charge_percentage')
          .maybeSingle(),
      ]);

      if (toursRes.error) throw toursRes.error;
      if (settingsRes.error) throw settingsRes.error;

      setTours((toursRes.data as unknown as TourRow[]) ?? []);
      setPlatform(settingsRes.data);
    } catch (err: any) {
      setError(err.message ?? 'Error al cargar los tours');
    } finally {
      setIsLoading(false);
    }
  };

  const openEdit = (tour: TourRow) => {
    setEditingTour(tour);
    const hasActive =
      tour.commission_rate_override != null &&
      (tour.commission_override_expires_at == null ||
        new Date(tour.commission_override_expires_at) > new Date());
    setOverrideEnabled(hasActive);
    const pct = tour.commission_rate_override != null
      ? String(+(tour.commission_rate_override * 100).toFixed(2))
      : '';
    setOverridePercent(pct);
    setOverridePercentInput(pct);
    setOverrideExpires(
      tour.commission_override_expires_at
        ? tour.commission_override_expires_at.slice(0, 10)
        : ''
    );
    setOverrideReason(tour.commission_override_reason ?? '');
    setError('');
    setSuccess('');
  };

  const closeEdit = () => {
    setEditingTour(null);
    setError('');
  };

  const handleSave = async () => {
    if (!editingTour) return;

    if (overrideEnabled) {
      const pct = parseFloat(overridePercent);
      if (isNaN(pct) || pct < 0 || pct > 50) {
        setError('El porcentaje debe estar entre 0% y 50%.');
        return;
      }
      if (!overrideReason.trim()) {
        setError('El motivo es obligatorio cuando hay un override activo.');
        return;
      }
    }

    setIsSaving(true);
    setError('');

    try {
      const updatePayload: Record<string, unknown> = {};

      if (overrideEnabled) {
        updatePayload.commission_rate_override = parseFloat(overridePercent) / 100;
        updatePayload.commission_override_expires_at = overrideExpires
          ? new Date(overrideExpires + 'T23:59:59').toISOString()
          : null;
        updatePayload.commission_override_reason = overrideReason.trim();
      } else {
        updatePayload.commission_rate_override = null;
        updatePayload.commission_override_expires_at = null;
        updatePayload.commission_override_reason = null;
      }

      const { error: updateError } = await supabase
        .from('tours')
        .update(updatePayload)
        .eq('id', editingTour.id);

      if (updateError) throw updateError;

      setSuccess('Comisión actualizada correctamente.');
      await fetchData();
      closeEdit();
    } catch (err: any) {
      setError(err.message ?? 'Error al guardar');
    } finally {
      setIsSaving(false);
    }
  };

  const filteredTours = tours.filter((t) => {
    if (search && !t.name.toLowerCase().includes(search.toLowerCase()) &&
        !t.agencies?.name.toLowerCase().includes(search.toLowerCase()) &&
        !t.destination.toLowerCase().includes(search.toLowerCase())) {
      return false;
    }
    if (filterType !== 'all' && t.tour_type !== filterType) return false;
    if (filterOverride === 'with_override') {
      if (t.commission_rate_override == null) return false;
      const expired = t.commission_override_expires_at
        ? new Date(t.commission_override_expires_at) <= new Date()
        : false;
      if (expired) return false;
    }
    if (filterOverride === 'no_override') {
      const hasActive =
        t.commission_rate_override != null &&
        (t.commission_override_expires_at == null ||
          new Date(t.commission_override_expires_at) > new Date());
      if (hasActive) return false;
    }
    return true;
  });

  const formatDateShort = (d: string | null) => {
    if (!d) return '—';
    try { return format(parseISO(d), 'dd/MM/yyyy', { locale: es }); }
    catch { return d; }
  };

  const overrideIsExpired = (tour: TourRow) =>
    tour.commission_rate_override != null &&
    tour.commission_override_expires_at != null &&
    new Date(tour.commission_override_expires_at) <= new Date();

  // ——— Stats ———
  const totalWithOverride = tours.filter((t) => {
    if (t.commission_rate_override == null) return false;
    const expired = t.commission_override_expires_at
      ? new Date(t.commission_override_expires_at) <= new Date()
      : false;
    return !expired;
  }).length;

  return (
    <div className="p-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-slate-900">Comisiones por Tour</h1>
        <p className="text-slate-500 mt-1 text-sm">
          Configura tasas de comisión especiales por tour para promociones o negociaciones con agencias.
        </p>
      </div>

      {success && (
        <div className="mb-4 flex items-center gap-2 bg-emerald-50 border border-emerald-200 text-emerald-800 rounded-lg px-4 py-3 text-sm">
          <CheckCircle className="h-4 w-4 shrink-0" />
          {success}
        </div>
      )}

      {/* Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
        <div className="bg-white rounded-xl border border-slate-200 p-4">
          <p className="text-xs text-slate-500 font-medium uppercase tracking-wide">Total de tours</p>
          <p className="text-2xl font-bold text-slate-900 mt-1">{tours.length}</p>
        </div>
        <div className="bg-white rounded-xl border border-slate-200 p-4">
          <p className="text-xs text-slate-500 font-medium uppercase tracking-wide">Con override activo</p>
          <p className="text-2xl font-bold text-amber-600 mt-1">{totalWithOverride}</p>
        </div>
        <div className="bg-white rounded-xl border border-slate-200 p-4">
          <p className="text-xs text-slate-500 font-medium uppercase tracking-wide">Default plataforma</p>
          <p className="text-2xl font-bold text-slate-900 mt-1">
            {platform ? `${platform.agency_commission_percentage}%` : '—'}
          </p>
        </div>
      </div>

      {/* Filtros */}
      <div className="bg-white rounded-xl border border-slate-200 p-4 mb-4 flex flex-wrap gap-3 items-center">
        <div className="relative flex-1 min-w-52">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
          <input
            type="text"
            placeholder="Buscar por tour, agencia o destino..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-9 pr-4 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>

        <div className="relative">
          <Filter className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400 pointer-events-none" />
          <select
            value={filterType}
            onChange={(e) => setFilterType(e.target.value as typeof filterType)}
            className="pl-9 pr-8 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 appearance-none bg-white"
          >
            <option value="all">Todos los tipos</option>
            <option value="excursion">Excursión</option>
            <option value="receptivo">Receptivo</option>
          </select>
          <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400 pointer-events-none" />
        </div>

        <div className="relative">
          <Tag className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400 pointer-events-none" />
          <select
            value={filterOverride}
            onChange={(e) => setFilterOverride(e.target.value as typeof filterOverride)}
            className="pl-9 pr-8 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 appearance-none bg-white"
          >
            <option value="all">Todos los overrides</option>
            <option value="with_override">Con override activo</option>
            <option value="no_override">Sin override</option>
          </select>
          <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400 pointer-events-none" />
        </div>
      </div>

      {/* Tabla */}
      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        {isLoading ? (
          <div className="flex items-center justify-center py-16">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
          </div>
        ) : error ? (
          <div className="flex items-center gap-2 m-6 bg-red-50 border border-red-200 text-red-700 rounded-lg px-4 py-3 text-sm">
            <AlertCircle className="h-4 w-4 shrink-0" />
            {error}
          </div>
        ) : filteredTours.length === 0 ? (
          <div className="text-center py-16 text-slate-400 text-sm">
            No se encontraron tours con los filtros aplicados.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-100 bg-slate-50">
                  <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">Tour</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">Agencia</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">Tipo</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">Fechas</th>
                  <th className="text-right px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">Precio</th>
                  <th className="text-center px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">Comisión efectiva</th>
                  <th className="text-center px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">Acciones</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {filteredTours.map((tour) => {
                  const { rate, source } = getEffectiveRate(tour, platform);
                  const expired = overrideIsExpired(tour);
                  return (
                    <tr key={tour.id} className="hover:bg-slate-50/60 transition-colors">
                      <td className="px-4 py-3">
                        <div className="font-medium text-slate-900 max-w-xs truncate">{tour.name}</div>
                        <div className="flex items-center gap-1 text-xs text-slate-400 mt-0.5">
                          <MapPin className="h-3 w-3 shrink-0" />
                          {tour.destination}
                        </div>
                        {expired && (
                          <span className="inline-flex items-center gap-1 text-xs text-red-500 mt-0.5">
                            <Clock className="h-3 w-3" /> Override expirado
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1.5 text-slate-700">
                          <Building2 className="h-3.5 w-3.5 text-slate-400 shrink-0" />
                          <span className="truncate max-w-[130px]">{tour.agencies?.name ?? '—'}</span>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                          tour.tour_type === 'receptivo'
                            ? 'bg-teal-50 text-teal-700 border border-teal-200'
                            : 'bg-sky-50 text-sky-700 border border-sky-200'
                        }`}>
                          {tour.tour_type === 'receptivo' ? 'Receptivo' : 'Excursión'}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-slate-500 whitespace-nowrap">
                        <div className="flex items-center gap-1 text-xs">
                          <Calendar className="h-3 w-3 shrink-0" />
                          {tour.tour_type === 'receptivo'
                            ? 'Bajo demanda'
                            : `${formatDateShort(tour.start_date)} – ${formatDateShort(tour.end_date)}`}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-right text-slate-700 font-medium whitespace-nowrap">
                        {formatCurrency(tour.price)}
                      </td>
                      <td className="px-4 py-3 text-center">
                        <div className="inline-flex flex-col items-center gap-1">
                          <span className="text-lg font-bold text-slate-900">{rate.toFixed(1)}%</span>
                          <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${sourceBadgeClass[source]}`}>
                            {sourceLabel[source]}
                          </span>
                          {source === 'tour_override' && tour.commission_override_expires_at && (
                            <span className="text-xs text-slate-400 flex items-center gap-1">
                              <Clock className="h-3 w-3" />
                              Hasta {formatDateShort(tour.commission_override_expires_at)}
                            </span>
                          )}
                          {source === 'tour_override' && !tour.commission_override_expires_at && (
                            <span className="text-xs text-slate-400">Sin expiración</span>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-center">
                        <button
                          onClick={() => openEdit(tour)}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-slate-100 hover:bg-blue-50 hover:text-blue-700 text-slate-600 transition-colors"
                        >
                          <Edit2 className="h-3.5 w-3.5" />
                          Editar comisión
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Modal de edición */}
      {editingTour && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm overflow-y-auto">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg flex flex-col max-h-[90vh] my-auto">
            {/* Header */}
            <div className="flex items-start justify-between p-6 border-b border-slate-100 shrink-0">
              <div>
                <h2 className="text-lg font-semibold text-slate-900">Comisión especial de tour</h2>
                <p className="text-sm text-slate-500 mt-0.5 max-w-xs truncate">{editingTour.name}</p>
              </div>
              <button onClick={closeEdit} className="p-2 rounded-lg hover:bg-slate-100 text-slate-400 transition-colors">
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="p-6 space-y-5 overflow-y-auto flex-1">
              {error && (
                <div className="flex items-start gap-2 bg-red-50 border border-red-200 text-red-700 rounded-lg px-4 py-3 text-sm">
                  <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
                  {error}
                </div>
              )}

              {/* Info actual */}
              <div className="bg-slate-50 rounded-xl p-4 text-sm space-y-1.5">
                <p className="font-medium text-slate-700 mb-2">Comisión actual sin override</p>
                <div className="flex justify-between text-slate-600">
                  <span>Tasa de agencia ({editingTour.agencies?.name})</span>
                  <span className="font-medium">
                    {editingTour.agencies?.commission_rate != null
                      ? `${(editingTour.agencies.commission_rate * 100).toFixed(1)}%`
                      : 'No configurada'}
                  </span>
                </div>
                <div className="flex justify-between text-slate-600">
                  <span>Default de plataforma</span>
                  <span className="font-medium">{platform?.agency_commission_percentage ?? 15}%</span>
                </div>
              </div>

              {/* Toggle override */}
              <div className="flex items-center justify-between p-4 rounded-xl border border-slate-200">
                <div>
                  <p className="font-medium text-slate-800 text-sm">Activar comisión especial</p>
                  <p className="text-xs text-slate-500 mt-0.5">Al activar, este tour usará la tasa configurada aquí.</p>
                </div>
                <button
                  type="button"
                  onClick={() => setOverrideEnabled((v) => !v)}
                  className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none ${
                    overrideEnabled ? 'bg-amber-500' : 'bg-slate-200'
                  }`}
                >
                  <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${
                    overrideEnabled ? 'translate-x-6' : 'translate-x-1'
                  }`} />
                </button>
              </div>

              {overrideEnabled && (
                <div className="space-y-4">
                  {/* Porcentaje */}
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1.5">
                      Porcentaje de comisión <span className="text-red-500">*</span>
                    </label>
                    <div className="relative">
                      <input
                        type="text"
                        inputMode="decimal"
                        value={overridePercentInput}
                        placeholder="Ej: 8"
                        onChange={(e) => {
                          const v = e.target.value;
                          if (/^(\d{0,2}(\.\d{0,2})?)?$/.test(v)) {
                            setOverridePercentInput(v);
                          }
                        }}
                        onBlur={() => {
                          const parsed = parseFloat(overridePercentInput);
                          if (!isNaN(parsed)) {
                            const clamped = Math.min(50, Math.max(0, parsed));
                            const display = Number.isInteger(clamped) ? String(clamped) : clamped.toFixed(2).replace(/\.?0+$/, '');
                            setOverridePercentInput(display);
                            setOverridePercent(String(clamped));
                          } else {
                            setOverridePercentInput('');
                            setOverridePercent('');
                          }
                        }}
                        className="w-full pr-10 pl-4 py-2.5 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-500"
                      />
                      <Percent className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
                    </div>
                    <p className="text-xs text-slate-400 mt-1">Rango permitido: 0% – 50%</p>
                  </div>

                  {/* Preview */}
                  {overridePercent && parseFloat(overridePercent) >= 0 && (
                    <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 text-sm">
                      <p className="font-medium text-amber-800 mb-1.5 flex items-center gap-1.5">
                        <DollarSign className="h-4 w-4" /> Vista previa sobre el precio base
                      </p>
                      <div className="space-y-1 text-amber-700">
                        <div className="flex justify-between">
                          <span>Precio base del tour</span>
                          <span className="font-medium">{formatCurrency(editingTour.price)}</span>
                        </div>
                        <div className="flex justify-between">
                          <span>Comisión ({parseFloat(overridePercent).toFixed(1)}%)</span>
                          <span className="font-medium text-red-600">
                            − {formatCurrency(editingTour.price * parseFloat(overridePercent) / 100)}
                          </span>
                        </div>
                        <div className="flex justify-between border-t border-amber-200 pt-1.5 mt-1.5 font-semibold text-amber-900">
                          <span>La agencia recibe</span>
                          <span>{formatCurrency(editingTour.price * (1 - parseFloat(overridePercent) / 100))}</span>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Fecha de expiración */}
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1.5">
                      Fecha de expiración <span className="text-slate-400">(opcional)</span>
                    </label>
                    <div className="relative">
                      <input
                        type="date"
                        value={overrideExpires}
                        min={new Date().toISOString().slice(0, 10)}
                        onChange={(e) => setOverrideExpires(e.target.value)}
                        className="w-full px-4 py-2.5 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-500"
                      />
                    </div>
                    <p className="text-xs text-slate-400 mt-1">
                      Si no se define, la comisión especial aplica por toda la vigencia del tour.
                    </p>
                  </div>

                  {/* Motivo */}
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1.5">
                      Motivo / Razón <span className="text-red-500">*</span>
                    </label>
                    <textarea
                      rows={3}
                      value={overrideReason}
                      onChange={(e) => setOverrideReason(e.target.value)}
                      placeholder="Ej: Negociación especial por tour de larga duración, Promoción para incentivar reservas en temporada baja..."
                      className="w-full px-4 py-2.5 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-500 resize-none"
                    />
                    <p className="text-xs text-slate-400 mt-1">
                      Este motivo será visible para la agencia en su panel de tours.
                    </p>
                  </div>
                </div>
              )}

              {/* Info sobre qué pasará si se desactiva */}
              {!overrideEnabled && editingTour.commission_rate_override != null && (
                <div className="flex items-start gap-2 bg-blue-50 border border-blue-200 text-blue-700 rounded-lg px-4 py-3 text-sm">
                  <Info className="h-4 w-4 shrink-0 mt-0.5" />
                  Al guardar con el override desactivado, se eliminará la comisión especial y se usará la tasa de agencia o plataforma.
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-slate-100 shrink-0">
              <button
                onClick={closeEdit}
                className="px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100 rounded-lg transition-colors"
              >
                Cancelar
              </button>
              <button
                onClick={handleSave}
                disabled={isSaving}
                className="flex items-center gap-2 px-5 py-2 text-sm font-medium bg-amber-500 hover:bg-amber-600 text-white rounded-lg transition-colors disabled:opacity-60"
              >
                {isSaving ? (
                  <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white" />
                ) : (
                  <Save className="h-4 w-4" />
                )}
                Guardar comisión
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default AdminTours;
