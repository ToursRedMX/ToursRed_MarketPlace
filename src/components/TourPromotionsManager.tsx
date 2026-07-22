import React, { useState, useEffect } from 'react';
import { Tag, Plus, CreditCard as Edit2, Trash2, ToggleLeft, ToggleRight, AlertCircle, Check, X, Calendar, Users, Loader2, Info, Percent } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { formatCurrency } from '../utils/formatCurrency';

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
}

interface TourPromotionsManagerProps {
  tourId: string;
  agencyId: string;
  tourPrice: number;
}

const defaultForm = {
  promotion_type: '2x1' as '2x1' | '3x2' | 'grupo_precio_fijo' | 'nxprecio',
  min_travelers: '',
  fixed_group_price: '',
  group_discount_percentage: '',
  valid_from: '',
  valid_until: '',
  max_uses: '',
};

const TourPromotionsManager: React.FC<TourPromotionsManagerProps> = ({ tourId, agencyId, tourPrice }) => {
  const [promotions, setPromotions] = useState<TourPromotion[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingPromotion, setEditingPromotion] = useState<TourPromotion | null>(null);
  const [formData, setFormData] = useState(defaultForm);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const today = new Date().toISOString().split('T')[0];

  useEffect(() => {
    loadPromotions();
  }, [tourId]);

  const loadPromotions = async () => {
    setIsLoading(true);
    const { data, error } = await supabase
      .from('tour_promotions')
      .select('*')
      .eq('tour_id', tourId)
      .order('created_at', { ascending: false });

    if (!error && data) {
      setPromotions(data);
    }
    setIsLoading(false);
  };

  const getGroupConfig = (type: '2x1' | '3x2' | 'grupo_precio_fijo' | 'nxprecio') => {
    if (type === '2x1') return { group_size: 2, pay_count: 1, min_travelers: 2 };
    if (type === '3x2') return { group_size: 3, pay_count: 2, min_travelers: 3 };
    return { group_size: 2, pay_count: 2, min_travelers: 2 };
  };

  const handleOpenCreate = () => {
    setEditingPromotion(null);
    setFormData(defaultForm);
    setError('');
    setSuccess('');
    setShowForm(true);
  };

  const handleOpenEdit = (promo: TourPromotion) => {
    setEditingPromotion(promo);
    setFormData({
      promotion_type: promo.promotion_type,
      min_travelers: promo.min_travelers,
      fixed_group_price: promo.fixed_group_price?.toString() || '',
      group_discount_percentage: promo.group_discount_percentage?.toString() || '',
      valid_from: promo.valid_from.split('T')[0],
      valid_until: promo.valid_until.split('T')[0],
      max_uses: promo.max_uses?.toString() || '',
    });
    setError('');
    setSuccess('');
    setShowForm(true);
  };

  const handleCancel = () => {
    setShowForm(false);
    setEditingPromotion(null);
    setError('');
  };

  const hasActivePromotion = promotions.some(p => p.is_active && new Date(p.valid_until) >= new Date());

  const handleSubmit = async () => {
    setError('');
    setIsSubmitting(true);

    if (!formData.valid_from || !formData.valid_until) {
      setError('Las fechas de vigencia son obligatorias.');
      setIsSubmitting(false);
      return;
    }

    if (new Date(formData.valid_until) <= new Date(formData.valid_from)) {
      setError('La fecha de fin debe ser posterior a la fecha de inicio.');
      setIsSubmitting(false);
      return;
    }

    if (formData.promotion_type === 'grupo_precio_fijo') {
      if (!formData.group_discount_percentage || parseFloat(formData.group_discount_percentage) <= 0 || parseFloat(formData.group_discount_percentage) >= 100) {
        setError('El porcentaje de descuento debe ser entre 1 y 99.');
        setIsSubmitting(false);
        return;
      }
      if (!formData.min_travelers || formData.min_travelers < 4) {
        setError('El mínimo de viajeros para precio grupal debe ser al menos 4.');
        setIsSubmitting(false);
        return;
      }
    }

    if (formData.promotion_type === 'nxprecio') {
      if (!formData.fixed_group_price || parseFloat(formData.fixed_group_price) <= 0) {
        setError('Debes ingresar un precio especial de grupo válido.');
        setIsSubmitting(false);
        return;
      }
      if (!formData.min_travelers || formData.min_travelers < 2) {
        setError('El número de viajeros del grupo debe ser al menos 2.');
        setIsSubmitting(false);
        return;
      }
    }

    if (!editingPromotion && hasActivePromotion) {
      setError('Ya existe una promoción activa vigente para este tour. Desactiva la actual antes de crear una nueva.');
      setIsSubmitting(false);
      return;
    }

    const groupConfig = getGroupConfig(formData.promotion_type);
    const isGrupoType = formData.promotion_type === 'grupo_precio_fijo';
    const isNxPrecioType = formData.promotion_type === 'nxprecio';
    const isCustomType = isGrupoType || isNxPrecioType;
    const minTravelers = isCustomType
      ? parseInt(formData.min_travelers.toString())
      : groupConfig.min_travelers;

    const { data: { user } } = await supabase.auth.getUser();

    const payload = {
      tour_id: tourId,
      agency_id: agencyId,
      promotion_type: formData.promotion_type,
      min_travelers: minTravelers,
      group_size: isCustomType ? minTravelers : groupConfig.group_size,
      pay_count: isCustomType ? minTravelers : groupConfig.pay_count,
      fixed_group_price: isNxPrecioType ? parseFloat(formData.fixed_group_price) : null,
      group_discount_percentage: isGrupoType ? parseFloat(formData.group_discount_percentage) : null,
      valid_from: new Date(formData.valid_from + 'T00:00:00').toISOString(),
      valid_until: new Date(formData.valid_until + 'T23:59:59').toISOString(),
      max_uses: formData.max_uses ? parseInt(formData.max_uses) : null,
      is_active: true,
      created_by: user?.id ?? null,
    };

    try {
      if (editingPromotion) {
        const { error: updateError } = await supabase
          .from('tour_promotions')
          .update(payload)
          .eq('id', editingPromotion.id);

        if (updateError) throw updateError;
        setSuccess('Promoción actualizada correctamente.');
      } else {
        const { data: insertData, error: insertError } = await supabase
          .from('tour_promotions')
          .insert(payload)
          .select();

        if (insertError) throw insertError;
        if (!insertData || insertData.length === 0) {
          throw new Error('No se pudo guardar la promoción. Verifica que tu sesión esté activa.');
        }
        setSuccess('Promoción creada correctamente.');
      }

      await loadPromotions();
      setShowForm(false);
      setEditingPromotion(null);
    } catch (err: any) {
      if (err.code === '23505') {
        setError('Ya existe una promoción activa para este tour. Solo puede haber una activa a la vez.');
      } else {
        setError(err.message || 'Error al guardar la promoción.');
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleToggleActive = async (promo: TourPromotion) => {
    if (!promo.is_active && hasActivePromotion) {
      setError('Desactiva la promoción activa actual antes de activar otra.');
      setTimeout(() => setError(''), 4000);
      return;
    }

    const { error: updateError } = await supabase
      .from('tour_promotions')
      .update({ is_active: !promo.is_active })
      .eq('id', promo.id);

    if (!updateError) {
      await loadPromotions();
    }
  };

  const handleDelete = async (promoId: string) => {
    if (!confirm('¿Estás seguro de que quieres eliminar esta promoción?')) return;

    const { error: deleteError } = await supabase
      .from('tour_promotions')
      .delete()
      .eq('id', promoId);

    if (!deleteError) {
      await loadPromotions();
    }
  };

  const getPromotionLabel = (promo: TourPromotion) => {
    if (promo.promotion_type === '2x1') return '2x1 — Viajan 2, paga 1';
    if (promo.promotion_type === '3x2') return '3x2 — Viajan 3, pagan 2';
    if (promo.promotion_type === 'nxprecio') return `${promo.min_travelers} por $${formatCurrency(promo.fixed_group_price ?? 0)} — Precio especial para grupos de ${promo.min_travelers}`;
    return `Precio grupal — ${promo.group_discount_percentage}% desc. por persona a partir de ${promo.min_travelers} viajeros`;
  };

  const getStatusBadge = (promo: TourPromotion) => {
    const now = new Date();
    const validUntil = new Date(promo.valid_until);
    const validFrom = new Date(promo.valid_from);

    if (!promo.is_active) {
      return <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-gray-100 text-gray-600">Inactiva</span>;
    }
    if (now < validFrom) {
      return <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-blue-100 text-blue-700">Programada</span>;
    }
    if (validUntil < now) {
      return <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-red-100 text-red-600">Vencida</span>;
    }
    if (promo.max_uses && promo.times_used >= promo.max_uses) {
      return <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-orange-100 text-orange-600">Agotada</span>;
    }
    return <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-green-100 text-green-700">Activa</span>;
  };

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleDateString('es-MX', { day: '2-digit', month: 'short', year: 'numeric' });
  };

  const discountPct = parseFloat(formData.group_discount_percentage) || 0;
  const exampleDiscount = discountPct > 0 ? Math.round(tourPrice * discountPct / 100) : 0;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Tag className="w-5 h-5 text-rose-600" />
          <h3 className="text-base font-semibold text-gray-900">Promociones Grupales</h3>
        </div>
        {!showForm && (
          <button
            type="button"
            onClick={handleOpenCreate}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-rose-600 text-white text-sm font-medium rounded-md hover:bg-rose-700 transition-colors"
          >
            <Plus className="w-4 h-4" />
            Nueva Promoción
          </button>
        )}
      </div>

      {error && (
        <div className="flex items-start gap-2 bg-red-50 border border-red-200 rounded-md p-3">
          <AlertCircle className="w-4 h-4 text-red-600 flex-shrink-0 mt-0.5" />
          <p className="text-sm text-red-700">{error}</p>
        </div>
      )}

      {success && (
        <div className="flex items-start gap-2 bg-green-50 border border-green-200 rounded-md p-3">
          <Check className="w-4 h-4 text-green-600 flex-shrink-0 mt-0.5" />
          <p className="text-sm text-green-700">{success}</p>
        </div>
      )}

      {showForm && (
        <div className="bg-rose-50 border border-rose-200 rounded-lg p-4">
          <h4 className="text-sm font-semibold text-gray-900 mb-4">
            {editingPromotion ? 'Editar Promoción' : 'Nueva Promoción Grupal'}
          </h4>
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Tipo de Promoción</label>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {([
                  { value: '2x1', label: '2x1', desc: 'Viajan 2, paga 1' },
                  { value: '3x2', label: '3x2', desc: 'Viajan 3, pagan 2' },
                  { value: 'grupo_precio_fijo', label: 'Precio Grupal', desc: 'Descuento % por persona' },
                  { value: 'nxprecio', label: 'N x Precio', desc: 'Ej: 2 por $3,500' },
                ] as const).map(opt => (
                  <label
                    key={opt.value}
                    className={`flex flex-col items-center justify-center p-3 rounded-lg border-2 cursor-pointer transition-all ${
                      formData.promotion_type === opt.value
                        ? 'border-rose-500 bg-rose-100'
                        : 'border-gray-200 bg-white hover:border-rose-300'
                    }`}
                  >
                    <input
                      type="radio"
                      className="sr-only"
                      value={opt.value}
                      checked={formData.promotion_type === opt.value}
                      onChange={() => setFormData(prev => ({ ...prev, promotion_type: opt.value }))}
                    />
                    <span className="text-lg font-bold text-gray-900">{opt.label}</span>
                    <span className="text-xs text-gray-500 text-center mt-0.5">{opt.desc}</span>
                  </label>
                ))}
              </div>
            </div>

            {(formData.promotion_type === '2x1' || formData.promotion_type === '3x2') && (
              <div className="bg-white border border-rose-200 rounded-md p-3">
                <div className="flex items-start gap-2">
                  <Info className="w-4 h-4 text-rose-500 flex-shrink-0 mt-0.5" />
                  <p className="text-xs text-gray-600">
                    {formData.promotion_type === '2x1'
                      ? 'Por cada 2 viajeros del mismo tipo (adulto, niño, etc.), el de menor precio es gratuito. Ej: 4 adultos → pagan 2.'
                      : 'Por cada 3 viajeros del mismo tipo, 1 es gratuito. Ej: 6 adultos → pagan 4.'
                    }
                  </p>
                </div>
              </div>
            )}

            {formData.promotion_type === 'grupo_precio_fijo' && (
              <div className="space-y-3">
                <div className="bg-white border border-rose-200 rounded-md p-3">
                  <div className="flex items-start gap-2">
                    <Info className="w-4 h-4 text-rose-500 flex-shrink-0 mt-0.5" />
                    <p className="text-xs text-gray-600">
                      El descuento aplica a <strong>cada viajero según su tarifa individual</strong>. Si hay adultos, niños y adultos mayores, cada uno recibe el mismo porcentaje sobre su precio. Las mascotas no entran en el conteo ni reciben descuento.
                    </p>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Min. viajeros para activar
                    </label>
                    <div className="relative">
                      <input
                        type="number"
                        min={4}
                        value={formData.min_travelers}
                        onChange={e => setFormData(prev => ({ ...prev, min_travelers: e.target.value }))}
                        placeholder="Ej: 4"
                        className="w-full px-3 py-2 pr-16 border border-gray-300 rounded-md text-sm focus:ring-2 focus:ring-rose-500 focus:border-rose-500"
                      />
                      <span className="absolute right-2.5 top-2 text-xs text-gray-400 pointer-events-none">viajeros</span>
                    </div>
                    <p className="text-xs text-gray-400 mt-1">Mínimo permitido: 4 viajeros</p>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Descuento por persona (%)
                    </label>
                    <div className="relative">
                      <input
                        type="number"
                        min={1}
                        max={99}
                        step="0.5"
                        value={formData.group_discount_percentage}
                        onChange={e => setFormData(prev => ({ ...prev, group_discount_percentage: e.target.value }))}
                        placeholder="Ej: 10"
                        className="w-full px-3 py-2 pr-8 border border-gray-300 rounded-md text-sm focus:ring-2 focus:ring-rose-500 focus:border-rose-500"
                      />
                      <Percent className="absolute right-2.5 top-2.5 w-3.5 h-3.5 text-gray-400 pointer-events-none" />
                    </div>
                    {exampleDiscount > 0 && (
                      <p className="text-xs text-emerald-600 mt-1 font-medium">
                        Ej: adulto a ${formatCurrency(tourPrice)} → ahorra ${formatCurrency(exampleDiscount)}
                      </p>
                    )}
                  </div>
                </div>
              </div>
            )}

            {formData.promotion_type === 'nxprecio' && (
              <div className="space-y-3">
                <div className="bg-white border border-rose-200 rounded-md p-3">
                  <div className="flex items-start gap-2">
                    <Info className="w-4 h-4 text-rose-500 flex-shrink-0 mt-0.5" />
                    <p className="text-xs text-gray-600">
                      Define cuantas personas forman el grupo y el precio especial total para ese grupo.
                      Ej: 2 personas por $3,500 (en lugar de $4,000 precio normal).
                      Si viajan 4 y quedan usos disponibles, la promo aplica dos veces.
                    </p>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Viajeros por grupo
                    </label>
                    <div className="relative">
                      <input
                        type="number"
                        min={2}
                        value={formData.min_travelers}
                        onChange={e => setFormData(prev => ({ ...prev, min_travelers: e.target.value }))}
                        placeholder="Ej: 4"
                        className="w-full px-3 py-2 pr-16 border border-gray-300 rounded-md text-sm focus:ring-2 focus:ring-rose-500 focus:border-rose-500"
                      />
                      <span className="absolute right-2.5 top-2 text-xs text-gray-400 pointer-events-none">viajeros</span>
                    </div>
                    <p className="text-xs text-gray-400 mt-1">Precio normal: ${formatCurrency(tourPrice * (parseInt(formData.min_travelers) || 2))}</p>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Precio especial por grupo ($)
                    </label>
                    <input
                      type="number"
                      min={0}
                      step="0.01"
                      value={formData.fixed_group_price}
                      onChange={e => setFormData(prev => ({ ...prev, fixed_group_price: e.target.value }))}
                      placeholder={`Ej: ${formatCurrency(Math.round(tourPrice * (formData.min_travelers || 2) * 0.85))}`}
                      className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:ring-2 focus:ring-rose-500 focus:border-rose-500"
                    />
                    {formData.fixed_group_price && parseFloat(formData.fixed_group_price) > 0 && (
                      <p className="text-xs text-emerald-600 mt-1 font-medium">
                        ${formatCurrency(Math.round(parseFloat(formData.fixed_group_price) / (formData.min_travelers || 2)))} por persona
                      </p>
                    )}
                  </div>
                </div>
              </div>
            )}

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Válida desde</label>
                <input
                  type="date"
                  min={today}
                  value={formData.valid_from}
                  onChange={e => setFormData(prev => ({ ...prev, valid_from: e.target.value }))}
                  required
                  className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:ring-2 focus:ring-rose-500 focus:border-rose-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Válida hasta</label>
                <input
                  type="date"
                  min={formData.valid_from || today}
                  value={formData.valid_until}
                  onChange={e => setFormData(prev => ({ ...prev, valid_until: e.target.value }))}
                  required
                  className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:ring-2 focus:ring-rose-500 focus:border-rose-500"
                />
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Máximo de usos <span className="text-gray-400 font-normal">(opcional — deja vacío para usos ilimitados)</span>
              </label>
              <input
                type="number"
                min={1}
                value={formData.max_uses}
                onChange={e => setFormData(prev => ({ ...prev, max_uses: e.target.value }))}
                placeholder="Sin límite"
                className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:ring-2 focus:ring-rose-500 focus:border-rose-500"
              />
            </div>

            <div className="flex gap-2 pt-1">
              <button
                type="button"
                onClick={handleSubmit}
                disabled={isSubmitting}
                className="flex items-center gap-1.5 px-4 py-2 bg-rose-600 text-white text-sm font-medium rounded-md hover:bg-rose-700 disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors"
              >
                {isSubmitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                {editingPromotion ? 'Guardar Cambios' : 'Crear Promoción'}
              </button>
              <button
                type="button"
                onClick={handleCancel}
                className="flex items-center gap-1.5 px-4 py-2 border border-gray-300 text-gray-700 text-sm font-medium rounded-md hover:bg-gray-50 transition-colors"
              >
                <X className="w-4 h-4" />
                Cancelar
              </button>
            </div>
          </div>
        </div>
      )}

      {isLoading ? (
        <div className="flex items-center justify-center py-8">
          <Loader2 className="w-5 h-5 animate-spin text-gray-400" />
        </div>
      ) : promotions.length === 0 ? (
        <div className="text-center py-8 text-gray-500">
          <Tag className="w-10 h-10 mx-auto mb-2 text-gray-300" />
          <p className="text-sm">No hay promociones configuradas para este tour.</p>
          <p className="text-xs text-gray-400 mt-1">Crea una promoción 2x1, 3x2, precio grupal o N x precio.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {promotions.map(promo => (
            <div
              key={promo.id}
              className={`border rounded-lg p-4 transition-all ${
                promo.is_active && new Date(promo.valid_until) >= new Date() && (!promo.max_uses || promo.times_used < promo.max_uses)
                  ? 'border-rose-200 bg-rose-50'
                  : 'border-gray-200 bg-gray-50 opacity-70'
              }`}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap mb-1">
                    <span className="text-sm font-semibold text-gray-900">{getPromotionLabel(promo)}</span>
                    {getStatusBadge(promo)}
                  </div>

                  <div className="flex items-center gap-4 text-xs text-gray-500 flex-wrap">
                    <span className="flex items-center gap-1">
                      <Calendar className="w-3 h-3" />
                      {formatDate(promo.valid_from)} — {formatDate(promo.valid_until)}
                    </span>
                    {promo.max_uses && (
                      <span className="flex items-center gap-1">
                        <Users className="w-3 h-3" />
                        {promo.times_used}/{promo.max_uses} usos
                      </span>
                    )}
                    {!promo.max_uses && (
                      <span className="flex items-center gap-1">
                        <Users className="w-3 h-3" />
                        {promo.times_used} usos — sin límite
                      </span>
                    )}
                  </div>

                  {promo.deactivation_reason && (
                    <p className="text-xs text-red-600 mt-1 flex items-center gap-1">
                      <AlertCircle className="w-3 h-3" />
                      Desactivada: {promo.deactivation_reason}
                    </p>
                  )}
                </div>

                <div className="flex items-center gap-1 flex-shrink-0">
                  <button
                    type="button"
                    onClick={() => handleToggleActive(promo)}
                    title={promo.is_active ? 'Desactivar' : 'Activar'}
                    className="p-1.5 rounded hover:bg-white transition-colors"
                  >
                    {promo.is_active
                      ? <ToggleRight className="w-5 h-5 text-green-600" />
                      : <ToggleLeft className="w-5 h-5 text-gray-400" />
                    }
                  </button>
                  <button
                    type="button"
                    onClick={() => handleOpenEdit(promo)}
                    title="Editar"
                    className="p-1.5 rounded hover:bg-white transition-colors"
                  >
                    <Edit2 className="w-4 h-4 text-gray-500 hover:text-gray-700" />
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDelete(promo.id)}
                    title="Eliminar"
                    className="p-1.5 rounded hover:bg-white transition-colors"
                  >
                    <Trash2 className="w-4 h-4 text-red-400 hover:text-red-600" />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default TourPromotionsManager;
