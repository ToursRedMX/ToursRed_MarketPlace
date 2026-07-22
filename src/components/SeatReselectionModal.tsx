import React, { useState } from 'react';
import { X, AlertTriangle, CheckCircle, Loader2, MapPin } from 'lucide-react';
import { supabase } from '../lib/supabase';
import SeatMapPicker from './seats/SeatMapPicker';

interface SeatReselectionModalProps {
  bookingId: string;
  tourId: string;
  slotId: string;
  travelersCount: number;
  previousSeats: number[];
  tourName: string;
  newDate: string;
  newTime: string;
  onSuccess: () => void;
  onClose: () => void;
}

const SeatReselectionModal: React.FC<SeatReselectionModalProps> = ({
  bookingId,
  tourId,
  slotId,
  travelersCount,
  previousSeats,
  tourName,
  newDate,
  newTime,
  onSuccess,
  onClose,
}) => {
  const [selectedSeats, setSelectedSeats] = useState<number[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);

  const handleConfirm = async () => {
    if (selectedSeats.length !== travelersCount) {
      setError(`Debes seleccionar exactamente ${travelersCount} asiento${travelersCount !== 1 ? 's' : ''}.`);
      return;
    }

    setIsSubmitting(true);
    setError('');

    try {
      const seatRecords = selectedSeats.map((seatNum) => ({
        tour_id: tourId,
        slot_id: slotId,
        seat_number: seatNum,
        status: 'reservado_online',
        booking_id: bookingId,
      }));

      const { error: upsertError } = await supabase
        .from('slot_seat_status')
        .upsert(seatRecords, { onConflict: 'tour_id,slot_id,seat_number' });

      if (upsertError) throw upsertError;

      const { error: bookingError } = await supabase
        .from('bookings')
        .update({
          selected_seats: selectedSeats,
          needs_seat_reselection: false,
        })
        .eq('id', bookingId);

      if (bookingError) throw bookingError;

      setSuccess(true);
      setTimeout(() => {
        onSuccess();
      }, 2000);
    } catch (err: any) {
      setError(err.message || 'Error al guardar los asientos. Intenta de nuevo.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const formattedDate = newDate
    ? new Date(newDate + 'T12:00:00').toLocaleDateString('es-MX', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
    : newDate;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-60 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between p-6 border-b border-gray-100">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-amber-100 flex items-center justify-center">
              <MapPin className="w-5 h-5 text-amber-600" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-gray-900">Selecciona nuevos asientos</h2>
              <p className="text-sm text-gray-500">{tourName}</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
          >
            <X className="w-5 h-5 text-gray-500" />
          </button>
        </div>

        <div className="p-6 space-y-5">
          <div className="bg-amber-50 border border-amber-200 rounded-xl p-4">
            <div className="flex items-start gap-3">
              <AlertTriangle className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-semibold text-amber-900">Tus asientos anteriores ya no estan disponibles</p>
                <p className="text-sm text-amber-800 mt-1">
                  Los asientos {previousSeats.sort((a, b) => a - b).join(', ')} que tenias reservados ya fueron tomados por otros viajeros en el nuevo horario.
                  Por favor selecciona {travelersCount} asiento{travelersCount !== 1 ? 's' : ''} disponible{travelersCount !== 1 ? 's' : ''}.
                </p>
              </div>
            </div>
          </div>

          <div className="bg-gray-50 rounded-xl p-4 flex items-center gap-4">
            <div className="flex-1">
              <p className="text-xs text-gray-500 mb-0.5">Nuevo horario confirmado</p>
              <p className="font-semibold text-gray-900 capitalize">{formattedDate}</p>
            </div>
            <div className="text-right">
              <p className="text-xs text-gray-500 mb-0.5">Hora de salida</p>
              <p className="font-semibold text-gray-900">{newTime?.slice(0, 5)}</p>
            </div>
          </div>

          {success ? (
            <div className="flex flex-col items-center justify-center py-10 gap-4">
              <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center">
                <CheckCircle className="w-9 h-9 text-green-600" />
              </div>
              <div className="text-center">
                <p className="font-bold text-gray-900 text-lg">Asientos confirmados</p>
                <p className="text-gray-600 text-sm mt-1">
                  Asientos {selectedSeats.sort((a, b) => a - b).join(', ')} asignados correctamente.
                </p>
              </div>
            </div>
          ) : (
            <>
              <SeatMapPicker
                tourId={tourId}
                slotId={slotId}
                requiredSeats={travelersCount}
                onSeatsSelected={setSelectedSeats}
                selectedSeats={selectedSeats}
                disabled={isSubmitting}
              />

              {error && (
                <div className="flex items-center gap-2 p-3 bg-red-50 border border-red-200 rounded-xl text-red-700 text-sm">
                  <AlertTriangle className="w-4 h-4 flex-shrink-0" />
                  {error}
                </div>
              )}

              <div className="flex gap-3 pt-2">
                <button
                  onClick={onClose}
                  disabled={isSubmitting}
                  className="flex-1 px-4 py-3 border border-gray-300 text-gray-700 rounded-xl font-medium hover:bg-gray-50 transition-colors disabled:opacity-50"
                >
                  Cancelar
                </button>
                <button
                  onClick={handleConfirm}
                  disabled={isSubmitting || selectedSeats.length !== travelersCount}
                  className="flex-1 px-4 py-3 bg-blue-600 hover:bg-blue-700 text-white rounded-xl font-semibold flex items-center justify-center gap-2 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {isSubmitting ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Guardando...
                    </>
                  ) : (
                    <>
                      <CheckCircle className="w-4 h-4" />
                      Confirmar asientos
                    </>
                  )}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
};

export default SeatReselectionModal;
