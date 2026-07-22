import React, { useState, useEffect } from 'react';
import { Plus, CreditCard as Edit2, Trash2, Clock, Save, X, Loader2, AlertCircle, Check } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { TourSchedule, DeparturePoint } from '../../types';

interface AgencyScheduleManagerProps {
  tourId: string;
  agencyId: string;
}

const DAY_LABELS = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];

const emptyForm = {
  departure_time: '',
  label: '',
  slot_capacity: '',
  valid_from: new Date().toISOString().split('T')[0],
  valid_until: '',
  days_of_week: [] as number[],
  is_active: true,
  display_order: 0,
};

const AgencyScheduleManager: React.FC<AgencyScheduleManagerProps> = ({ tourId, agencyId }) => {
  const [schedules, setSchedules] = useState<TourSchedule[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState(emptyForm);

  const fetchSchedules = async () => {
    setIsLoading(true);
    try {
      const { data, error: err } = await supabase
        .from('tour_schedules')
        .select('*')
        .eq('tour_id', tourId)
        .order('display_order', { ascending: true })
        .order('departure_time', { ascending: true });
      if (err) throw err;
      setSchedules(data || []);
    } catch (err) {
      setError('No se pudieron cargar los horarios.');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => { fetchSchedules(); }, [tourId]);

  const handleSubmit = async () => {
    if (!form.departure_time) {
      setError('La hora de salida es requerida.');
      return;
    }
    setIsSubmitting(true);
    setError('');
    try {
      const payload = {
        tour_id: tourId,
        agency_id: agencyId,
        departure_time: form.departure_time,
        label: form.label || null,
        slot_capacity: form.slot_capacity ? parseInt(form.slot_capacity) : null,
        valid_from: form.valid_from,
        valid_until: form.valid_until || null,
        days_of_week: form.days_of_week.length > 0 ? form.days_of_week : null,
        is_active: form.is_active,
        display_order: form.display_order,
        updated_at: new Date().toISOString(),
      };

      if (editingId) {
        const { error: err } = await supabase
          .from('tour_schedules')
          .update(payload)
          .eq('id', editingId);
        if (err) throw err;
      } else {
        const { error: err } = await supabase
          .from('tour_schedules')
          .insert(payload);
        if (err) throw err;
      }
      await fetchSchedules();
      setShowForm(false);
      setEditingId(null);
      setForm(emptyForm);
    } catch (err: any) {
      setError(err.message || 'Error al guardar el horario.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleEdit = (schedule: TourSchedule) => {
    setEditingId(schedule.id);
    setForm({
      departure_time: schedule.departure_time,
      label: schedule.label || '',
      slot_capacity: schedule.slot_capacity?.toString() || '',
      valid_from: schedule.valid_from,
      valid_until: schedule.valid_until || '',
      days_of_week: schedule.days_of_week || [],
      is_active: schedule.is_active,
      display_order: schedule.display_order,
    });
    setShowForm(true);
  };

  const handleDelete = async (id: string) => {
    if (!confirm('¿Eliminar este horario? Los slots generados no se verán afectados.')) return;
    try {
      const { error: err } = await supabase.from('tour_schedules').delete().eq('id', id);
      if (err) throw err;
      await fetchSchedules();
    } catch (err) {
      setError('No se pudo eliminar el horario.');
    }
  };

  const toggleDay = (day: number) => {
    setForm(prev => ({
      ...prev,
      days_of_week: prev.days_of_week.includes(day)
        ? prev.days_of_week.filter(d => d !== day)
        : [...prev.days_of_week, day].sort(),
    }));
  };

  const formatTime = (time: string) => {
    const [h, m] = time.split(':');
    const hour = parseInt(h);
    const ampm = hour >= 12 ? 'PM' : 'AM';
    return `${hour % 12 || 12}:${m} ${ampm}`;
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h3 className="font-semibold text-gray-800">Horarios de Salida</h3>
        <button
          onClick={() => { setShowForm(true); setEditingId(null); setForm(emptyForm); }}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-red-600 text-white text-sm rounded-lg hover:bg-red-700 transition-colors"
        >
          <Plus className="w-3.5 h-3.5" />
          Agregar Horario
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
            <h4 className="font-medium text-gray-800 text-sm">
              {editingId ? 'Editar Horario' : 'Nuevo Horario'}
            </h4>
            <button type="button" onClick={() => { setShowForm(false); setEditingId(null); }}
              className="p-1 text-gray-400 hover:text-gray-600">
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Hora de salida *</label>
              <input type="time" value={form.departure_time}
                onChange={e => setForm(prev => ({ ...prev, departure_time: e.target.value }))}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-500"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Etiqueta (opcional)</label>
              <input type="text" value={form.label} placeholder="Salida matutina"
                onChange={e => setForm(prev => ({ ...prev, label: e.target.value }))}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-500" />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Cupos (sobreescribe default)</label>
              <input type="number" min="1" value={form.slot_capacity} placeholder="Deja vacío para usar el default"
                onChange={e => setForm(prev => ({ ...prev, slot_capacity: e.target.value }))}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-500" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Orden de visualización</label>
              <input type="number" min="0" value={form.display_order}
                onChange={e => setForm(prev => ({ ...prev, display_order: parseInt(e.target.value) || 0 }))}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-500" />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Válido desde *</label>
              <input type="date" value={form.valid_from}
                onChange={e => setForm(prev => ({ ...prev, valid_from: e.target.value }))}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-500"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Válido hasta (opcional)</label>
              <input type="date" value={form.valid_until}
                onChange={e => setForm(prev => ({ ...prev, valid_until: e.target.value }))}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-500" />
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-600 mb-2">
              Días específicos (vacío = todos los días del tour)
            </label>
            <div className="flex gap-1.5">
              {DAY_LABELS.map((label, idx) => (
                <button
                  key={idx}
                  type="button"
                  onClick={() => toggleDay(idx)}
                  className={`w-9 h-9 rounded-lg text-xs font-medium transition-colors ${
                    form.days_of_week.includes(idx)
                      ? 'bg-red-600 text-white'
                      : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          <div className="flex items-center gap-2">
            <input type="checkbox" id="sched-active" checked={form.is_active}
              onChange={e => setForm(prev => ({ ...prev, is_active: e.target.checked }))}
              className="w-4 h-4 text-red-600 rounded" />
            <label htmlFor="sched-active" className="text-sm text-gray-700">Horario activo</label>
          </div>

          <div className="flex gap-2 pt-2">
            <button type="button" onClick={handleSubmit} disabled={isSubmitting}
              className="flex items-center gap-1.5 px-4 py-2 bg-red-600 text-white text-sm rounded-lg hover:bg-red-700 transition-colors disabled:opacity-50">
              {isSubmitting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
              {isSubmitting ? 'Guardando...' : 'Guardar'}
            </button>
            <button type="button" onClick={() => { setShowForm(false); setEditingId(null); }}
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
      ) : schedules.length === 0 ? (
        <p className="text-center text-gray-400 text-sm py-8">
          No hay horarios configurados. Agrega uno para comenzar.
        </p>
      ) : (
        <div className="space-y-2">
          {schedules.map(schedule => (
            <div key={schedule.id}
              className={`flex items-center justify-between p-3 rounded-xl border ${
                schedule.is_active ? 'bg-white border-gray-200' : 'bg-gray-50 border-gray-100'
              }`}>
              <div className="flex items-center gap-3">
                <div className={`w-9 h-9 rounded-lg flex items-center justify-center ${
                  schedule.is_active ? 'bg-red-50 text-red-600' : 'bg-gray-100 text-gray-400'
                }`}>
                  <Clock className="w-4 h-4" />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <span className={`font-semibold text-sm ${schedule.is_active ? 'text-gray-800' : 'text-gray-400'}`}>
                      {formatTime(schedule.departure_time)}
                    </span>
                    {schedule.label && (
                      <span className="text-xs text-gray-500">— {schedule.label}</span>
                    )}
                    {!schedule.is_active && (
                      <span className="text-xs text-gray-400 bg-gray-100 px-2 py-0.5 rounded-full">Inactivo</span>
                    )}
                  </div>
                  <div className="flex items-center gap-3 mt-0.5">
                    {schedule.slot_capacity && (
                      <span className="text-xs text-gray-500">{schedule.slot_capacity} cupos</span>
                    )}
                    {schedule.days_of_week && schedule.days_of_week.length > 0 && (
                      <span className="text-xs text-gray-500">
                        {schedule.days_of_week.map(d => DAY_LABELS[d]).join(', ')}
                      </span>
                    )}
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-1">
                <button onClick={() => handleEdit(schedule)}
                  className="p-1.5 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-colors">
                  <Edit2 className="w-3.5 h-3.5" />
                </button>
                <button onClick={() => handleDelete(schedule.id)}
                  className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors">
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default AgencyScheduleManager;
