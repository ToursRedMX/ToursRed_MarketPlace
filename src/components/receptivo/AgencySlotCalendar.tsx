import React, { useState, useEffect, useCallback } from 'react';
import { ChevronLeft, ChevronRight, Loader2, Plus, Zap } from 'lucide-react';
import { format, startOfMonth, endOfMonth, eachDayOfInterval, isSameMonth, isToday, addMonths, subMonths } from 'date-fns';
import { es } from 'date-fns/locale';
import { supabase } from '../../lib/supabase';
import { TourSlot } from '../../types';
import SlotDetailPanel from './SlotDetailPanel';

interface AgencySlotCalendarProps {
  tourId: string;
  agencyId: string;
  onGenerateSlots: (start: string, end: string) => Promise<void>;
}

interface DaySlots {
  date: string;
  slots: TourSlot[];
}

const AgencySlotCalendar: React.FC<AgencySlotCalendarProps> = ({ tourId, agencyId, onGenerateSlots }) => {
  const [currentMonth, setCurrentMonth] = useState(new Date());
  const [daySlots, setDaySlots] = useState<Map<string, TourSlot[]>>(new Map());
  const [isLoading, setIsLoading] = useState(false);
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [showGenerateModal, setShowGenerateModal] = useState(false);
  const [genStart, setGenStart] = useState('');
  const [genEnd, setGenEnd] = useState('');

  const fetchSlots = useCallback(async (month: Date) => {
    setIsLoading(true);
    try {
      const start = format(startOfMonth(month), 'yyyy-MM-dd');
      const end = format(endOfMonth(month), 'yyyy-MM-dd');
      const { data, error } = await supabase.rpc('get_tour_slots_by_range', {
        p_tour_id: tourId,
        p_start_date: start,
        p_end_date: end,
      });
      if (error) throw error;
      const map = new Map<string, TourSlot[]>();
      (data as TourSlot[] || []).forEach(slot => {
        const key = slot.slot_date;
        if (!map.has(key)) map.set(key, []);
        map.get(key)!.push(slot);
      });
      setDaySlots(map);
    } catch (err) {
      console.error('Error fetching slots:', err);
    } finally {
      setIsLoading(false);
    }
  }, [tourId]);

  useEffect(() => {
    fetchSlots(currentMonth);
  }, [currentMonth, fetchSlots]);

  const days = eachDayOfInterval({
    start: startOfMonth(currentMonth),
    end: endOfMonth(currentMonth),
  });
  const startDayOffset = startOfMonth(currentMonth).getDay();
  const blanks = Array.from({ length: startDayOffset });

  const getSlotStatusColor = (slot: TourSlot) => {
    const available = slot.capacity - slot.booked_count;
    if (slot.status === 'cancelado') return 'bg-gray-200 text-gray-500';
    if (slot.status === 'bloqueado') return 'bg-orange-100 text-orange-600';
    if (available === 0 || slot.status === 'lleno') return 'bg-red-100 text-red-600';
    if (available <= 3) return 'bg-yellow-100 text-yellow-700';
    return 'bg-green-100 text-green-700';
  };

  const handleGenerateSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!genStart || !genEnd) return;
    setIsGenerating(true);
    try {
      await onGenerateSlots(genStart, genEnd);
      await fetchSlots(currentMonth);
      setShowGenerateModal(false);
    } catch (err: any) {
      alert(`Error al generar slots: ${err.message || 'Error desconocido'}`);
    } finally {
      setIsGenerating(false);
    }
  };

  const selectedSlots = selectedDay ? (daySlots.get(selectedDay) || []) : [];

  const weekDays = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold text-gray-800">Calendario de Slots</h3>
        <button
          onClick={() => {
            setGenStart(format(startOfMonth(currentMonth), 'yyyy-MM-dd'));
            setGenEnd(format(endOfMonth(currentMonth), 'yyyy-MM-dd'));
            setShowGenerateModal(true);
          }}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-amber-500 text-white text-sm rounded-lg hover:bg-amber-600 transition-colors"
        >
          <Zap className="w-3.5 h-3.5" />
          Generar Slots
        </button>
      </div>

      {showGenerateModal && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4">
          <h4 className="font-medium text-amber-800 text-sm mb-3">Generar Slots Automáticamente</h4>
          <form onSubmit={handleGenerateSubmit} className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-amber-700 mb-1">Desde</label>
                <input type="date" value={genStart} onChange={e => setGenStart(e.target.value)}
                  className="w-full border border-amber-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500 bg-white"
                  required />
              </div>
              <div>
                <label className="block text-xs font-medium text-amber-700 mb-1">Hasta</label>
                <input type="date" value={genEnd} min={genStart} onChange={e => setGenEnd(e.target.value)}
                  className="w-full border border-amber-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500 bg-white"
                  required />
              </div>
            </div>
            <p className="text-xs text-amber-700">
              Se crearán slots para cada horario activo según los días de operación del tour, respetando los bloqueos de fechas.
            </p>
            <div className="flex gap-2">
              <button type="submit" disabled={isGenerating}
                className="flex items-center gap-1.5 px-4 py-2 bg-amber-500 text-white text-sm rounded-lg hover:bg-amber-600 transition-colors disabled:opacity-50">
                {isGenerating ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Zap className="w-3.5 h-3.5" />}
                {isGenerating ? 'Generando...' : 'Generar'}
              </button>
              <button type="button" onClick={() => setShowGenerateModal(false)}
                className="px-4 py-2 border border-amber-300 text-amber-700 text-sm rounded-lg hover:bg-amber-100 transition-colors">
                Cancelar
              </button>
            </div>
          </form>
        </div>
      )}

      <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 bg-gray-50 border-b border-gray-200">
          <button onClick={() => setCurrentMonth(prev => subMonths(prev, 1))}
            className="p-1.5 rounded-lg hover:bg-gray-200 transition-colors text-gray-600">
            <ChevronLeft className="w-4 h-4" />
          </button>
          <div className="flex items-center gap-2">
            <span className="font-semibold text-gray-800 capitalize">
              {format(currentMonth, 'MMMM yyyy', { locale: es })}
            </span>
            {isLoading && <Loader2 className="w-3.5 h-3.5 text-red-500 animate-spin" />}
          </div>
          <button onClick={() => setCurrentMonth(prev => addMonths(prev, 1))}
            className="p-1.5 rounded-lg hover:bg-gray-200 transition-colors text-gray-600">
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>

        <div className="p-3">
          <div className="grid grid-cols-7 mb-1">
            {weekDays.map(d => (
              <div key={d} className="text-center text-xs font-medium text-gray-400 py-1.5">{d}</div>
            ))}
          </div>
          <div className="grid grid-cols-7 gap-1">
            {blanks.map((_, i) => <div key={`b-${i}`} />)}
            {days.map(date => {
              const dateKey = format(date, 'yyyy-MM-dd');
              const slots = daySlots.get(dateKey) || [];
              const isSelected = selectedDay === dateKey;
              const today = isToday(date);

              return (
                <div
                  key={dateKey}
                  onClick={() => setSelectedDay(isSelected ? null : dateKey)}
                  className={`min-h-[60px] p-1 rounded-lg border cursor-pointer transition-all ${
                    isSelected
                      ? 'border-red-400 bg-red-50'
                      : today
                      ? 'border-red-200 bg-red-50/50'
                      : 'border-transparent hover:border-gray-200 hover:bg-gray-50'
                  }`}
                >
                  <p className={`text-xs font-medium mb-1 ${
                    today ? 'text-red-600' : 'text-gray-600'
                  }`}>
                    {date.getDate()}
                  </p>
                  <div className="space-y-0.5">
                    {slots.slice(0, 2).map(slot => (
                      <div key={slot.id}
                        className={`text-[9px] leading-tight px-1 py-0.5 rounded font-medium truncate ${getSlotStatusColor(slot)}`}>
                        {slot.departure_time.substring(0, 5)}
                      </div>
                    ))}
                    {slots.length > 2 && (
                      <div className="text-[9px] text-gray-400 pl-1">+{slots.length - 2} más</div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <div className="px-3 pb-3 flex items-center gap-4 text-xs text-gray-400">
          <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm bg-green-200" />Disponible</span>
          <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm bg-yellow-100" />Pocos cupos</span>
          <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm bg-red-100" />Lleno</span>
          <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm bg-orange-100" />Bloqueado</span>
        </div>
      </div>

      {selectedDay && (
        <SlotDetailPanel
          tourId={tourId}
          agencyId={agencyId}
          dateKey={selectedDay}
          slots={selectedSlots}
          onClose={() => setSelectedDay(null)}
          onRefresh={() => fetchSlots(currentMonth)}
        />
      )}
    </div>
  );
};

export default AgencySlotCalendar;
