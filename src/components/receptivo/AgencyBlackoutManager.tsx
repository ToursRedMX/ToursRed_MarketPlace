import React, { useState, useEffect } from 'react';
import { Plus, Trash2, Save, X, Loader2, AlertCircle, CalendarX } from 'lucide-react';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import { supabase } from '../../lib/supabase';
import { TourSlotBlackout } from '../../types';

interface AgencyBlackoutManagerProps {
  tourId: string;
  agencyId: string;
  userId: string;
}

const emptyForm = {
  blackout_start: '',
  blackout_end: '',
  reason: '',
  is_partial_day: false,
};

const AgencyBlackoutManager: React.FC<AgencyBlackoutManagerProps> = ({ tourId, agencyId, userId }) => {
  const [blackouts, setBlackouts] = useState<TourSlotBlackout[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(emptyForm);

  const fetchBlackouts = async () => {
    setIsLoading(true);
    try {
      const { data, error: err } = await supabase
        .from('tour_slot_blackouts')
        .select('*')
        .eq('tour_id', tourId)
        .order('blackout_start', { ascending: true });
      if (err) throw err;
      setBlackouts(data || []);
    } catch {
      setError('No se pudieron cargar los bloqueos.');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => { fetchBlackouts(); }, [tourId]);

  const handleSubmit = async () => {
    if (!form.blackout_start || !form.blackout_end) {
      setError('Las fechas de inicio y fin son requeridas.');
      return;
    }
    if (form.blackout_end < form.blackout_start) {
      setError('La fecha de fin no puede ser anterior a la de inicio.');
      return;
    }
    setIsSubmitting(true);
    setError('');
    try {
      const { error: err } = await supabase.from('tour_slot_blackouts').insert({
        tour_id: tourId,
        agency_id: agencyId,
        blackout_start: form.blackout_start,
        blackout_end: form.blackout_end,
        reason: form.reason || null,
        is_partial_day: form.is_partial_day,
      });
      if (err) throw err;
      await fetchBlackouts();
      setShowForm(false);
      setForm(emptyForm);
    } catch (err: any) {
      setError(err.message || 'Error al guardar el bloqueo.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('¿Eliminar este bloqueo de fechas?')) return;
    try {
      const { error: err } = await supabase.from('tour_slot_blackouts').delete().eq('id', id);
      if (err) throw err;
      await fetchBlackouts();
    } catch {
      setError('No se pudo eliminar el bloqueo.');
    }
  };

  const formatDateRange = (start: string, end: string) => {
    if (start === end) return format(new Date(start + 'T12:00:00'), "d 'de' MMMM yyyy", { locale: es });
    return `${format(new Date(start + 'T12:00:00'), "d MMM", { locale: es })} — ${format(new Date(end + 'T12:00:00'), "d MMM yyyy", { locale: es })}`;
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h3 className="font-semibold text-gray-800">Fechas Bloqueadas</h3>
        <button
          onClick={() => { setShowForm(true); setForm(emptyForm); }}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-red-600 text-white text-sm rounded-lg hover:bg-red-700 transition-colors"
        >
          <Plus className="w-3.5 h-3.5" />
          Bloquear Fechas
        </button>
      </div>

      {error && (
        <div className="flex items-center gap-2 p-3 bg-red-50 border border-red-200 rounded-lg text-red-600 text-sm mb-4">
          <AlertCircle className="w-4 h-4 flex-shrink-0" />
          {error}
        </div>
      )}

      {showForm && (
        <div className="bg-gray-50 border border-gray-200 rounded-xl p-4 mb-4 space-y-4">
          <div className="flex items-center justify-between">
            <h4 className="font-medium text-gray-800 text-sm">Nuevo Bloqueo</h4>
            <button type="button" onClick={() => setShowForm(false)} className="p-1 text-gray-400 hover:text-gray-600">
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Fecha inicio *</label>
              <input type="date" value={form.blackout_start}
                onChange={e => setForm(prev => ({ ...prev, blackout_start: e.target.value }))}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-500"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Fecha fin *</label>
              <input type="date" value={form.blackout_end} min={form.blackout_start}
                onChange={e => setForm(prev => ({ ...prev, blackout_end: e.target.value }))}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-500"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Motivo (opcional)</label>
            <input type="text" value={form.reason} placeholder="Feriado, mantenimiento, temporada baja..."
              onChange={e => setForm(prev => ({ ...prev, reason: e.target.value }))}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-500" />
          </div>

          <div className="flex gap-2 pt-2">
            <button type="button" onClick={handleSubmit} disabled={isSubmitting}
              className="flex items-center gap-1.5 px-4 py-2 bg-red-600 text-white text-sm rounded-lg hover:bg-red-700 transition-colors disabled:opacity-50">
              {isSubmitting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
              {isSubmitting ? 'Guardando...' : 'Guardar Bloqueo'}
            </button>
            <button type="button" onClick={() => setShowForm(false)}
              className="px-4 py-2 border border-gray-300 text-gray-600 text-sm rounded-lg hover:bg-gray-50 transition-colors">
              Cancelar
            </button>
          </div>
        </div>
      )}

      {isLoading ? (
        <div className="flex items-center justify-center py-8">
          <Loader2 className="w-5 h-5 animate-spin text-gray-400" />
        </div>
      ) : blackouts.length === 0 ? (
        <p className="text-center text-gray-400 text-sm py-8">No hay fechas bloqueadas.</p>
      ) : (
        <div className="space-y-2">
          {blackouts.map(b => (
            <div key={b.id} className="flex items-center justify-between p-3 bg-white border border-gray-200 rounded-xl">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-lg bg-orange-50 flex items-center justify-center">
                  <CalendarX className="w-4 h-4 text-orange-500" />
                </div>
                <div>
                  <p className="font-medium text-sm text-gray-800">
                    {formatDateRange(b.blackout_start, b.blackout_end)}
                  </p>
                  {b.reason && <p className="text-xs text-gray-500">{b.reason}</p>}
                </div>
              </div>
              <button onClick={() => handleDelete(b.id)}
                className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors">
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default AgencyBlackoutManager;
