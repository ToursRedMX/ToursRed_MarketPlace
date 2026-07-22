import React, { useState, useEffect, useCallback } from 'react';
import { ChevronLeft, ChevronRight, Loader2 } from 'lucide-react';
import { format, startOfMonth, endOfMonth, eachDayOfInterval, isSameMonth, isSameDay, isToday, isPast, addMonths, subMonths, addDays } from 'date-fns';
import { es } from 'date-fns/locale';
import { supabase } from '../../lib/supabase';
import { Tour, TourSlot } from '../../types';

interface SlotCalendarPickerProps {
  tour: Tour;
  selectedDate: Date | null;
  onDateSelect: (date: Date) => void;
}

interface DateAvailability {
  date: string;
  hasSlots: boolean;
  isFull: boolean;
  availableCount: number;
}

const SlotCalendarPicker: React.FC<SlotCalendarPickerProps> = ({ tour, selectedDate, onDateSelect }) => {
  const [currentMonth, setCurrentMonth] = useState(new Date());
  const [availability, setAvailability] = useState<Map<string, DateAvailability>>(new Map());
  const [isLoading, setIsLoading] = useState(false);

  const fetchAvailability = useCallback(async (month: Date) => {
    setIsLoading(true);
    try {
      const start = format(startOfMonth(month), 'yyyy-MM-dd');
      const end = format(endOfMonth(month), 'yyyy-MM-dd');

      const { data, error } = await supabase.rpc('get_tour_slots_by_range', {
        p_tour_id: tour.id,
        p_start_date: start,
        p_end_date: end,
      });

      if (error) throw error;

      const map = new Map<string, DateAvailability>();
      (data as TourSlot[] || []).forEach((slot) => {
        const dateKey = slot.slot_date;
        const existing = map.get(dateKey);
        const available = Math.max(0, slot.capacity - slot.booked_count);
        if (!existing) {
          map.set(dateKey, {
            date: dateKey,
            hasSlots: true,
            isFull: available === 0,
            availableCount: available,
          });
        } else {
          map.set(dateKey, {
            ...existing,
            isFull: existing.isFull && available === 0,
            availableCount: existing.availableCount + available,
          });
        }
      });

      setAvailability(map);
    } catch (err) {
      console.error('Error fetching slot availability:', err);
    } finally {
      setIsLoading(false);
    }
  }, [tour.id]);

  useEffect(() => {
    fetchAvailability(currentMonth);
  }, [currentMonth, fetchAvailability]);

  const days = eachDayOfInterval({
    start: startOfMonth(currentMonth),
    end: endOfMonth(currentMonth),
  });

  const startDayOffset = startOfMonth(currentMonth).getDay();
  const blanks = Array.from({ length: startDayOffset });

  const minDate = addDays(new Date(), tour.min_advance_booking_hours ? Math.ceil(tour.min_advance_booking_hours / 24) : 1);
  const maxDate = addDays(new Date(), tour.max_advance_booking_days || 90);

  const isDayDisabled = (date: Date) => {
    if (isPast(date) && !isToday(date)) return true;
    if (date < minDate) return true;
    if (date > maxDate) return true;
    const dateKey = format(date, 'yyyy-MM-dd');
    const avail = availability.get(dateKey);
    if (!avail) return true;
    if (avail.isFull) return true;
    return false;
  };

  const getDayClass = (date: Date) => {
    const dateKey = format(date, 'yyyy-MM-dd');
    const avail = availability.get(dateKey);
    const isSelected = selectedDate && isSameDay(date, selectedDate);
    const disabled = isDayDisabled(date);
    const today = isToday(date);

    if (!isSameMonth(date, currentMonth)) return 'invisible';

    if (isSelected) {
      return 'bg-red-600 text-white font-semibold rounded-lg cursor-pointer hover:bg-red-700 transition-colors';
    }

    if (disabled || !avail) {
      return 'text-gray-300 cursor-not-allowed rounded-lg';
    }

    if (avail.isFull) {
      return 'bg-gray-100 text-gray-400 rounded-lg cursor-not-allowed relative';
    }

    if (today) {
      return 'bg-red-50 text-red-700 font-semibold rounded-lg cursor-pointer hover:bg-red-100 transition-colors border border-red-200';
    }

    return 'text-gray-800 rounded-lg cursor-pointer hover:bg-red-50 hover:text-red-700 transition-colors font-medium';
  };

  const weekDays = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];

  return (
    <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3 bg-gray-50 border-b border-gray-200">
        <button
          onClick={() => setCurrentMonth(prev => subMonths(prev, 1))}
          className="p-1.5 rounded-lg hover:bg-gray-200 transition-colors text-gray-600"
        >
          <ChevronLeft className="w-4 h-4" />
        </button>
        <div className="flex items-center gap-2">
          <span className="font-semibold text-gray-800 capitalize">
            {format(currentMonth, 'MMMM yyyy', { locale: es })}
          </span>
          {isLoading && <Loader2 className="w-3.5 h-3.5 text-red-500 animate-spin" />}
        </div>
        <button
          onClick={() => setCurrentMonth(prev => addMonths(prev, 1))}
          className="p-1.5 rounded-lg hover:bg-gray-200 transition-colors text-gray-600"
        >
          <ChevronRight className="w-4 h-4" />
        </button>
      </div>

      <div className="p-3">
        <div className="grid grid-cols-7 mb-1">
          {weekDays.map(d => (
            <div key={d} className="text-center text-xs font-medium text-gray-400 py-1.5">
              {d}
            </div>
          ))}
        </div>

        <div className="grid grid-cols-7 gap-0.5">
          {blanks.map((_, i) => (
            <div key={`blank-${i}`} />
          ))}
          {days.map(date => {
            const dateKey = format(date, 'yyyy-MM-dd');
            const avail = availability.get(dateKey);
            const disabled = isDayDisabled(date);

            return (
              <div
                key={dateKey}
                onClick={() => {
                  if (!disabled && avail && !avail.isFull) {
                    onDateSelect(date);
                  }
                }}
                className={`relative aspect-square flex flex-col items-center justify-center text-sm ${getDayClass(date)}`}
              >
                <span>{date.getDate()}</span>
                {avail && !avail.isFull && !disabled && (
                  <span className="absolute bottom-0.5 left-1/2 -translate-x-1/2 w-1 h-1 rounded-full bg-green-500" />
                )}
                {avail && avail.isFull && (
                  <span className="absolute bottom-0.5 text-[8px] leading-none text-gray-400">Lleno</span>
                )}
              </div>
            );
          })}
        </div>
      </div>

      <div className="px-3 pb-3 flex items-center gap-4 text-xs text-gray-500">
        <span className="flex items-center gap-1.5">
          <span className="w-2 h-2 rounded-full bg-green-500 inline-block" />
          Disponible
        </span>
        <span className="flex items-center gap-1.5">
          <span className="w-2 h-2 rounded-full bg-gray-300 inline-block" />
          Lleno
        </span>
        <span className="flex items-center gap-1.5">
          <span className="w-2 h-2 rounded-full bg-red-500 inline-block" />
          Seleccionado
        </span>
      </div>
    </div>
  );
};

export default SlotCalendarPicker;
