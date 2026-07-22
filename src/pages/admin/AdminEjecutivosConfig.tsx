import React, { useState, useEffect } from 'react';
import {
  Settings, DollarSign, Percent, Calendar, Plus, Trash2,
  CheckCircle, AlertCircle, X, Save, Award, Target
} from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { formatCurrencyMXN } from '../../utils/formatCurrency';

interface CommissionSettings {
  id: string;
  amount_per_approval: number;
  amount_per_first_booking: number;
  platform_revenue_percentage: number;
  commission_period_months: number;
  is_current: boolean;
  created_at: string;
}

interface BonusRule {
  id: string;
  name: string;
  description: string | null;
  condition_type: string;
  threshold_value: number;
  bonus_amount: number;
  is_recurring: boolean;
  is_active: boolean;
  created_at: string;
}

const CONDITION_LABELS: Record<string, string> = {
  agencies_approved_count: 'Agencias aprobadas',
  revenue_generated: 'Ingreso de plataforma generado',
  bookings_generated: 'Reservas pagadas generadas',
};

export default function AdminEjecutivosConfig() {
  const [settings, setSettings] = useState<CommissionSettings | null>(null);
  const [bonusRules, setBonusRules] = useState<BonusRule[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Form state for commission settings
  const [amountApproval, setAmountApproval] = useState('100');
  const [amountFirstBooking, setAmountFirstBooking] = useState('100');
  const [revenuePct, setRevenuePct] = useState('3.00');
  const [periodMonths, setPeriodMonths] = useState('3');

  // Bonus rule form
  const [showBonusForm, setShowBonusForm] = useState(false);
  const [bonusName, setBonusName] = useState('');
  const [bonusDesc, setBonusDesc] = useState('');
  const [bonusCondition, setBonusCondition] = useState('agencies_approved_count');
  const [bonusThreshold, setBonusThreshold] = useState('');
  const [bonusAmount, setBonusAmount] = useState('');
  const [bonusRecurring, setBonusRecurring] = useState(false);
  const [isSavingBonus, setIsSavingBonus] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const loadData = async () => {
    setIsLoading(true);
    try {
      const [settingsRes, bonusRes] = await Promise.all([
        supabase
          .from('executive_commission_settings')
          .select('*')
          .eq('is_current', true)
          .maybeSingle(),
        supabase
          .from('executive_bonus_rules')
          .select('*')
          .order('created_at', { ascending: false }),
      ]);

      if (settingsRes.data) {
        const s = settingsRes.data;
        setSettings(s);
        setAmountApproval(String(s.amount_per_approval));
        setAmountFirstBooking(String(s.amount_per_first_booking));
        setRevenuePct(String(s.platform_revenue_percentage));
        setPeriodMonths(String(s.commission_period_months));
      }

      setBonusRules(bonusRes.data || []);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => { loadData(); }, []);

  const saveSettings = async () => {
    const pct = parseFloat(revenuePct);
    const months = parseInt(periodMonths);
    if (isNaN(pct) || pct < 0 || pct > 100) {
      setMessage({ type: 'error', text: 'El porcentaje debe ser entre 0 y 100.' });
      return;
    }
    if (isNaN(months) || months < 1) {
      setMessage({ type: 'error', text: 'El periodo mínimo es 1 mes.' });
      return;
    }

    setIsSaving(true);
    try {
      if (settings?.id) {
        const { error } = await supabase
          .from('executive_commission_settings')
          .update({
            amount_per_approval: parseFloat(amountApproval),
            amount_per_first_booking: parseFloat(amountFirstBooking),
            platform_revenue_percentage: pct,
            commission_period_months: months,
          })
          .eq('id', settings.id);
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from('executive_commission_settings')
          .insert({
            amount_per_approval: parseFloat(amountApproval),
            amount_per_first_booking: parseFloat(amountFirstBooking),
            platform_revenue_percentage: pct,
            commission_period_months: months,
            is_current: true,
          });
        if (error) throw error;
      }
      setMessage({ type: 'success', text: 'Configuración de comisiones guardada correctamente.' });
      loadData();
    } catch (e: any) {
      setMessage({ type: 'error', text: e.message || 'Error al guardar.' });
    } finally {
      setIsSaving(false);
    }
  };

  const saveBonus = async () => {
    if (!bonusName.trim() || !bonusThreshold || !bonusAmount) {
      setMessage({ type: 'error', text: 'Completa todos los campos requeridos del bono.' });
      return;
    }
    setIsSavingBonus(true);
    try {
      const { error } = await supabase
        .from('executive_bonus_rules')
        .insert({
          name: bonusName.trim(),
          description: bonusDesc.trim() || null,
          condition_type: bonusCondition,
          threshold_value: parseFloat(bonusThreshold),
          bonus_amount: parseFloat(bonusAmount),
          is_recurring: bonusRecurring,
          is_active: true,
        });
      if (error) throw error;

      setMessage({ type: 'success', text: 'Bono creado exitosamente.' });
      setBonusName(''); setBonusDesc(''); setBonusThreshold(''); setBonusAmount('');
      setBonusCondition('agencies_approved_count'); setBonusRecurring(false);
      setShowBonusForm(false);
      loadData();
    } catch (e: any) {
      setMessage({ type: 'error', text: e.message || 'Error al guardar bono.' });
    } finally {
      setIsSavingBonus(false);
    }
  };

  const toggleBonus = async (rule: BonusRule) => {
    await supabase
      .from('executive_bonus_rules')
      .update({ is_active: !rule.is_active })
      .eq('id', rule.id);
    loadData();
  };

  const deleteBonus = async (id: string) => {
    setDeletingId(id);
    await supabase.from('executive_bonus_rules').delete().eq('id', id);
    setDeletingId(null);
    loadData();
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-96">
        <div className="w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto px-4 py-8 space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Configuracion de Ejecutivos</h1>
        <p className="text-gray-500 mt-1">Parámetros de comisiones y reglas de bonos</p>
      </div>

      {message && (
        <div className={`rounded-lg px-4 py-3 text-sm flex items-center gap-2 ${message.type === 'success' ? 'bg-green-50 text-green-700 border border-green-200' : 'bg-red-50 text-red-700 border border-red-200'}`}>
          {message.type === 'success' ? <CheckCircle className="h-4 w-4 shrink-0" /> : <AlertCircle className="h-4 w-4 shrink-0" />}
          {message.text}
          <button onClick={() => setMessage(null)} className="ml-auto"><X className="h-4 w-4" /></button>
        </div>
      )}

      {/* Commission Settings */}
      <div className="bg-white rounded-xl border border-gray-200">
        <div className="px-6 py-5 border-b border-gray-100 flex items-center gap-3">
          <div className="w-9 h-9 bg-blue-100 rounded-lg flex items-center justify-center">
            <DollarSign className="h-5 w-5 text-blue-600" />
          </div>
          <div>
            <h2 className="font-semibold text-gray-900">Estructura de comisiones</h2>
            <p className="text-sm text-gray-400">Aplica a todas las agencias registradas por ejecutivos</p>
          </div>
        </div>

        <div className="p-6 space-y-6">
          <div className="bg-amber-50 border border-amber-200 rounded-lg px-4 py-3">
            <p className="text-sm text-amber-800">
              Los cambios aquí aplican a las comisiones generadas a partir de este momento.
              Las comisiones ya registradas no se verán afectadas.
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">
                Comisión por aprobación de agencia
              </label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm">$</span>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={amountApproval}
                  onChange={e => setAmountApproval(e.target.value)}
                  className="w-full pl-7 pr-3 py-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 text-xs">MXN</span>
              </div>
              <p className="text-xs text-gray-400 mt-1">Se genera al momento de aprobar la agencia y subir el contrato</p>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">
                Comisión por primer tour + primera reserva
              </label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm">$</span>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={amountFirstBooking}
                  onChange={e => setAmountFirstBooking(e.target.value)}
                  className="w-full pl-7 pr-3 py-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 text-xs">MXN</span>
              </div>
              <p className="text-xs text-gray-400 mt-1">Se genera cuando la agencia publica su primer tour Y genera su primera reserva pagada</p>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">
                Porcentaje sobre ingresos de plataforma
              </label>
              <div className="relative">
                <input
                  type="number"
                  min="0"
                  max="100"
                  step="0.01"
                  value={revenuePct}
                  onChange={e => setRevenuePct(e.target.value)}
                  className="w-full pr-8 pl-3 py-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm">%</span>
              </div>
              <p className="text-xs text-gray-400 mt-1">Porcentaje del ingreso neto de la plataforma durante el periodo de comisión</p>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">
                Duración del periodo de comisión
              </label>
              <div className="relative">
                <input
                  type="number"
                  min="1"
                  max="24"
                  value={periodMonths}
                  onChange={e => setPeriodMonths(e.target.value)}
                  className="w-full pr-16 pl-3 py-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 text-xs">meses</span>
              </div>
              <p className="text-xs text-gray-400 mt-1">Meses desde la aprobación de la agencia durante los que aplica la comisión de periodo</p>
            </div>
          </div>

          <div className="pt-2 flex justify-end">
            <button
              onClick={saveSettings}
              disabled={isSaving}
              className="flex items-center gap-2 px-5 py-2.5 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50 transition-colors"
            >
              <Save className="h-4 w-4" />
              {isSaving ? 'Guardando...' : 'Guardar configuración'}
            </button>
          </div>
        </div>
      </div>

      {/* Bonus Rules */}
      <div className="bg-white rounded-xl border border-gray-200">
        <div className="px-6 py-5 border-b border-gray-100 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 bg-amber-100 rounded-lg flex items-center justify-center">
              <Award className="h-5 w-5 text-amber-600" />
            </div>
            <div>
              <h2 className="font-semibold text-gray-900">Reglas de bonos</h2>
              <p className="text-sm text-gray-400">Incentivos adicionales configurables</p>
            </div>
          </div>
          <button
            onClick={() => setShowBonusForm(true)}
            className="flex items-center gap-1.5 px-4 py-2 bg-amber-600 text-white rounded-lg text-sm font-medium hover:bg-amber-700 transition-colors"
          >
            <Plus className="h-4 w-4" />
            Nuevo bono
          </button>
        </div>

        {bonusRules.length === 0 && !showBonusForm ? (
          <div className="py-12 text-center text-gray-400">
            <Award className="h-10 w-10 mx-auto mb-2 opacity-30" />
            <p className="text-sm">No hay reglas de bonos configuradas</p>
            <button
              onClick={() => setShowBonusForm(true)}
              className="mt-3 text-sm text-amber-600 hover:text-amber-700 font-medium"
            >
              Crear primera regla
            </button>
          </div>
        ) : (
          <div className="divide-y divide-gray-50">
            {bonusRules.map(rule => (
              <div key={rule.id} className="px-6 py-4 flex items-start justify-between gap-4">
                <div className="flex items-start gap-3 flex-1">
                  <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 mt-0.5 ${rule.is_active ? 'bg-amber-100' : 'bg-gray-100'}`}>
                    <Target className={`h-4 w-4 ${rule.is_active ? 'text-amber-600' : 'text-gray-400'}`} />
                  </div>
                  <div className="flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className={`font-medium text-sm ${rule.is_active ? 'text-gray-900' : 'text-gray-400'}`}>{rule.name}</p>
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${rule.is_active ? 'text-green-700 bg-green-100' : 'text-gray-500 bg-gray-100'}`}>
                        {rule.is_active ? 'Activo' : 'Inactivo'}
                      </span>
                      {rule.is_recurring && (
                        <span className="text-xs text-blue-600 bg-blue-50 px-2 py-0.5 rounded-full">Recurrente</span>
                      )}
                    </div>
                    {rule.description && (
                      <p className="text-xs text-gray-400 mt-0.5">{rule.description}</p>
                    )}
                    <div className="flex items-center gap-4 mt-1.5 flex-wrap">
                      <span className="text-xs text-gray-500">
                        Meta: <span className="font-medium text-gray-700">{rule.threshold_value} {CONDITION_LABELS[rule.condition_type] || rule.condition_type}</span>
                      </span>
                      <span className="text-xs text-amber-600 font-bold">{formatCurrencyMXN(rule.bonus_amount)}</span>
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <button
                    onClick={() => toggleBonus(rule)}
                    className={`px-3 py-1 text-xs font-medium rounded-lg transition-colors ${rule.is_active ? 'text-gray-600 hover:bg-gray-100' : 'text-green-600 hover:bg-green-50'}`}
                  >
                    {rule.is_active ? 'Desactivar' : 'Activar'}
                  </button>
                  <button
                    onClick={() => deleteBonus(rule.id)}
                    disabled={deletingId === rule.id}
                    className="p-1.5 text-red-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* New Bonus Form */}
        {showBonusForm && (
          <div className="border-t border-gray-100 p-6 bg-amber-50/50">
            <h3 className="font-medium text-gray-900 mb-4">Nueva regla de bono</h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="sm:col-span-2">
                <label className="block text-xs font-medium text-gray-600 mb-1.5">Nombre del bono *</label>
                <input
                  value={bonusName}
                  onChange={e => setBonusName(e.target.value)}
                  placeholder="Ej: Bono arranque Q1"
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500"
                />
              </div>
              <div className="sm:col-span-2">
                <label className="block text-xs font-medium text-gray-600 mb-1.5">Descripción (opcional)</label>
                <input
                  value={bonusDesc}
                  onChange={e => setBonusDesc(e.target.value)}
                  placeholder="Descripción para el ejecutivo..."
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1.5">Condición *</label>
                <select
                  value={bonusCondition}
                  onChange={e => setBonusCondition(e.target.value)}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500"
                >
                  {Object.entries(CONDITION_LABELS).map(([k, v]) => (
                    <option key={k} value={k}>{v}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1.5">
                  Meta ({bonusCondition === 'revenue_generated' ? 'MXN' : 'cantidad'}) *
                </label>
                <input
                  type="number"
                  min="1"
                  value={bonusThreshold}
                  onChange={e => setBonusThreshold(e.target.value)}
                  placeholder={bonusCondition === 'revenue_generated' ? '50000' : '5'}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1.5">Monto del bono (MXN) *</label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm">$</span>
                  <input
                    type="number"
                    min="1"
                    value={bonusAmount}
                    onChange={e => setBonusAmount(e.target.value)}
                    placeholder="500"
                    className="w-full pl-7 pr-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-amber-500"
                  />
                </div>
              </div>
              <div className="flex items-center gap-2 pt-6">
                <input
                  type="checkbox"
                  id="recurring"
                  checked={bonusRecurring}
                  onChange={e => setBonusRecurring(e.target.checked)}
                  className="h-4 w-4 text-amber-600 border-gray-300 rounded focus:ring-amber-500"
                />
                <label htmlFor="recurring" className="text-sm text-gray-700">Es recurrente (puede ganarse múltiples veces)</label>
              </div>
            </div>
            <div className="flex justify-end gap-3 mt-4">
              <button
                onClick={() => { setShowBonusForm(false); setBonusName(''); setBonusDesc(''); setBonusThreshold(''); setBonusAmount(''); }}
                className="px-4 py-2 text-sm text-gray-600"
              >
                Cancelar
              </button>
              <button
                onClick={saveBonus}
                disabled={isSavingBonus}
                className="flex items-center gap-2 px-5 py-2 bg-amber-600 text-white rounded-lg text-sm font-medium hover:bg-amber-700 disabled:opacity-50 transition-colors"
              >
                <Plus className="h-4 w-4" />
                {isSavingBonus ? 'Creando...' : 'Crear bono'}
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Info section */}
      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <h3 className="font-semibold text-gray-900 mb-4 flex items-center gap-2">
          <Settings className="h-4 w-4 text-gray-500" />
          Resumen de configuración actual
        </h3>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-center">
          <div className="bg-gray-50 rounded-lg p-4">
            <p className="text-2xl font-bold text-gray-900">{formatCurrencyMXN(parseFloat(amountApproval) || 0)}</p>
            <p className="text-xs text-gray-500 mt-1">Por aprobación</p>
          </div>
          <div className="bg-gray-50 rounded-lg p-4">
            <p className="text-2xl font-bold text-gray-900">{formatCurrencyMXN(parseFloat(amountFirstBooking) || 0)}</p>
            <p className="text-xs text-gray-500 mt-1">Por primer tour+reserva</p>
          </div>
          <div className="bg-gray-50 rounded-lg p-4">
            <p className="text-2xl font-bold text-gray-900">{revenuePct}%</p>
            <p className="text-xs text-gray-500 mt-1">Sobre ingresos plataforma</p>
          </div>
          <div className="bg-gray-50 rounded-lg p-4">
            <p className="text-2xl font-bold text-gray-900">{periodMonths}</p>
            <p className="text-xs text-gray-500 mt-1">Meses de periodo</p>
          </div>
        </div>
      </div>
    </div>
  );
}
