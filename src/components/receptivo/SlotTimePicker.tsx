import React, { useState, useEffect } from 'react';
import { Clock, Users, MapPin, Loader2, AlertCircle } from 'lucide-react';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import { supabase } from '../../lib/supabase';
import { TourSlot, TourSchedule } from '../../types';

interface SlotTimePickerProps {
  tourId: string;
  selectedDate: Date;
  selectedSlotId: string | null;
  onSlotSelect: (slot: TourSlot) => void;
}

const SlotTimePicker: React.FC<SlotTimePickerProps> = ({ tourId, selectedDate, selectedSlotId, onSlotSelect }) => {
  const [slots, setSlots] = useState<TourSlot[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    const fetchSlots = async () => {
      setIsLoading(true);
      setError('');
      try {
        const dateStr = format(selectedDate, 'yyyy-MM-dd');
        const { data, error: rpcError } = await supabase.rpc('get_tour_slots_by_range', {
          p_tour_id: tourId,
          p_start_date: dateStr,
          p_end_date: dateStr,
        });
        if (rpcError) throw rpcError;
        setSlots((data as TourSlot[]) || []);
      } catch (err) {
        setError('No se pudieron cargar los horarios disponibles.');
      } finally {
        setIsLoading(false);
      }
    };
    fetchSlots();
  }, [tourId, selectedDate]);

  const formatTime = (time: string) => {
    const [h, m] = time.split(':');
    const hour = parseInt(h);
    const ampm = hour >= 12 ? 'PM' : 'AM';
    const hour12 = hour % 12 || 12;
    return `${hour12}:${m} ${ampm}`;
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-8 gap-2 text-gray-500">
        <Loader2 className="w-5 h-5 animate-spin text-red-500" />
        <span className="text-sm">Cargando horarios...</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center gap-2 p-3 bg-red-50 rounded-lg text-red-600 text-sm">
        <AlertCircle className="w-4 h-4 flex-shrink-0" />
        {error}
      </div>
    );
  }

  if (slots.length === 0) {
    return (
      <div className="text-center py-6 text-gray-500 text-sm">
        No hay horarios disponibles para esta fecha.
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <p className="text-sm font-medium text-gray-600 mb-3">
        Horarios disponibles — {format(selectedDate, "EEEE d 'de' MMMM", { locale: es })}
      </p>
      {slots.map((slot) => {
        const available = Math.max(0, slot.capacity - slot.booked_count);
        const isFull = available === 0;
        const isSelected = selectedSlotId === slot.id;
        const isLowAvailability = available <= 3 && available > 0;

        return (
          <button
            key={slot.id}
            onClick={() => !isFull && onSlotSelect(slot)}
            disabled={isFull}
            className={`w-full text-left p-3.5 rounded-xl border-2 transition-all ${
              isSelected
                ? 'border-red-500 bg-red-50'
                : isFull
                ? 'border-gray-200 bg-gray-50 opacity-60 cursor-not-allowed'
                : 'border-gray-200 hover:border-red-300 hover:bg-red-50 cursor-pointer'
            }`}
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className={`w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0 ${
                  isSelected ? 'bg-red-600 text-white' : 'bg-gray-100 text-gray-600'
                }`}>
                  <Clock className="w-4 h-4" />
                </div>
                <div>
                  <p className={`font-semibold text-base ${isSelected ? 'text-red-700' : 'text-gray-800'}`}>
                    {formatTime(slot.departure_time)}
                  </p>
                  {slot.tour_schedules?.label && (
                    <p className="text-xs text-gray-500">{slot.tour_schedules.label}</p>
                  )}
                </div>
              </div>
              <div className="text-right">
                {isFull ? (
                  <span className="text-xs font-medium text-gray-400 bg-gray-100 px-2.5 py-1 rounded-full">
                    Lleno
                  </span>
                ) : isLowAvailability ? (
                  <span className="text-xs font-medium text-orange-600 bg-orange-50 px-2.5 py-1 rounded-full">
                    Últimos {available} {available === 1 ? 'cupo' : 'cupos'}
                  </span>
                ) : (
                  <span className="text-xs font-medium text-green-600 bg-green-50 px-2.5 py-1 rounded-full">
                    {available} {available === 1 ? 'cupo' : 'cupos'}
                  </span>
                )}
              </div>
            </div>
          </button>
        );
      })}
    </div>
  );
};

export default SlotTimePicker;
