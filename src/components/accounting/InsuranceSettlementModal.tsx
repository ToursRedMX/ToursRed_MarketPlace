import React, { useState } from 'react';
import { X, AlertCircle, CheckCircle, Shield } from 'lucide-react';
import { supabase } from '../../lib/supabase';

interface Props {
  onClose: () => void;
  onSaved: () => void;
  suggestedAmount?: number;
}

const InsuranceSettlementModal: React.FC<Props> = ({ onClose, onSaved, suggestedAmount }) => {
  const today = new Date().toISOString().split('T')[0];

  const [form, setForm] = useState({
    provider_name: 'Universal Assistance',
    period_start: '',
    period_end: '',
    amount: suggestedAmount != null ? String(suggestedAmount) : '',
    payment_date: today,
    reference: '',
    notes: '',
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  function set(field: string, value: string) {
    setForm(f => ({ ...f, [field]: value }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    const amount = parseFloat(form.amount);
    if (isNaN(amount) || amount <= 0) {
      setError('El monto debe ser mayor a 0.');
      return;
    }
    if (!form.period_start || !form.period_end) {
      setError('Debes especificar el periodo de la liquidación.');
      return;
    }
    if (form.period_end < form.period_start) {
      setError('La fecha de fin no puede ser anterior a la de inicio.');
      return;
    }

    setSaving(true);
    const { error: dbErr } = await supabase.from('insurance_settlements').insert({
      provider_name: form.provider_name.trim(),
      period_start: form.period_start,
      period_end: form.period_end,
      amount,
      payment_date: form.payment_date || null,
      reference: form.reference.trim() || null,
      notes: form.notes.trim() || null,
      status: 'pending',
    });
    setSaving(false);

    if (dbErr) {
      setError(dbErr.message);
      return;
    }
    setSuccess(true);
    setTimeout(() => {
      onSaved();
      onClose();
    }, 1000);
  }

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-gray-100">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-blue-50 flex items-center justify-center">
              <Shield size={20} className="text-blue-600" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-gray-900">Registrar Liquidación</h2>
              <p className="text-sm text-gray-500">Pago a aseguradora (Flujo B)</p>
            </div>
          </div>
          <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-gray-100 transition-colors">
            <X size={18} className="text-gray-500" />
          </button>
        </div>

        {/* Body */}
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {success && (
            <div className="flex items-center gap-2 p-3 bg-green-50 border border-green-200 rounded-xl text-green-700 text-sm">
              <CheckCircle size={16} />
              Liquidación registrada correctamente.
            </div>
          )}
          {error && (
            <div className="flex items-center gap-2 p-3 bg-red-50 border border-red-200 rounded-xl text-red-700 text-sm">
              <AlertCircle size={16} />
              {error}
            </div>
          )}

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Aseguradora</label>
            <input
              type="text"
              value={form.provider_name}
              onChange={e => set('provider_name', e.target.value)}
              className="w-full px-3 py-2 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              required
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Periodo inicio</label>
              <input
                type="date"
                value={form.period_start}
                onChange={e => set('period_start', e.target.value)}
                className="w-full px-3 py-2 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                required
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Periodo fin</label>
              <input
                type="date"
                value={form.period_end}
                onChange={e => set('period_end', e.target.value)}
                className="w-full px-3 py-2 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                required
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Monto a liquidar (MXN)</label>
              <input
                type="number"
                step="0.01"
                min="0.01"
                value={form.amount}
                onChange={e => set('amount', e.target.value)}
                placeholder="0.00"
                className="w-full px-3 py-2 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                required
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Fecha de pago</label>
              <input
                type="date"
                value={form.payment_date}
                onChange={e => set('payment_date', e.target.value)}
                className="w-full px-3 py-2 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Referencia / Folio</label>
            <input
              type="text"
              value={form.reference}
              onChange={e => set('reference', e.target.value)}
              placeholder="Número de transferencia, folio, etc."
              className="w-full px-3 py-2 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Notas</label>
            <textarea
              value={form.notes}
              onChange={e => set('notes', e.target.value)}
              rows={2}
              placeholder="Observaciones adicionales..."
              className="w-full px-3 py-2 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
            />
          </div>

          <div className="flex gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 px-4 py-2.5 rounded-xl border border-gray-200 text-gray-700 text-sm font-medium hover:bg-gray-50 transition-colors"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={saving || success}
              className="flex-1 px-4 py-2.5 rounded-xl bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {saving ? 'Guardando...' : 'Registrar liquidación'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default InsuranceSettlementModal;
