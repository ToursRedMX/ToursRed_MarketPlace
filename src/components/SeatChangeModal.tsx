import React, { useState } from 'react';
import { X, AlertTriangle, CheckCircle, Loader2, MapPin } from 'lucide-react';
import { supabase } from '../lib/supabase';
import SeatMapPicker from './seats/SeatMapPicker';
import { mensajeDeError } from '../lib/errores';

interface SeatChangeModalProps {
  bookingId: string;
  tourId: string;
  slotId: string | null;
  currentSeats: number[];
  tourName: string;
  onSuccess: () => void;
  onClose: () => void;
}

const SeatChangeModal: React.FC<SeatChangeModalProps> = ({
  bookingId,
  tourId,
  slotId,
  currentSeats,
  tourName,
  onSuccess,
  onClose,
}) => {
  const required = currentSeats.length;
  const [selectedSeats, setSelectedSeats] = useState<number[]>(currentSeats);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);

  const sameAsCurrent =
    [...selectedSeats].sort((a, b) => a - b).join(',') === [...currentSeats].sort((a, b) => a - b).join(',');

  const handleConfirm = async () => {
    if (selectedSeats.length !== required) {
      setError(`Debes seleccionar exactamente ${required} asiento${required !== 1 ? 's' : ''}.`);
      return;
    }

    setIsSubmitting(true);
    setError('');

    try {
      const { data, error: rpcError } = await supabase.rpc('change_booking_seats', {
        p_booking_id: bookingId,
        p_new_seats: selectedSeats,
      });
      if (rpcError) throw rpcError;

      const result = data as { success: boolean; error?: string; conflicting_seats?: number[] } | null;
      if (!result?.success) {
        const conflicting = result?.conflicting_seats;
        if (conflicting && conflicting.length > 0) {
          setError(`Estos asientos ya no estan disponibles: ${[...conflicting].sort((a, b) => a - b).join(', ')}. Elige otros.`);
        } else {
          setError(result?.error || 'No se pudo cambiar el asiento. Intenta de nuevo.');
        }
        return;
      }

      setSuccess(true);
      setTimeout(onSuccess, 1500);
    } catch (err) {
      setError(mensajeDeError(err) || 'No se pudo cambiar el asiento. Intenta de nuevo.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between p-6 border-b border-gray-100">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-blue-100 flex items-center justify-center">
              <MapPin className="w-5 h-5 text-blue-600" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-gray-900">Cambiar de asiento</h2>
              <p className="text-sm text-gray-500">{tourName}</p>
            </div>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-gray-100 rounded-lg transition-colors" aria-label="Cerrar">
            <X className="w-5 h-5 text-gray-500" />
          </button>
        </div>

        <div className="p-6 space-y-5">
          {success ? (
            <div className="flex flex-col items-center justify-center py-10 gap-4">
              <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center">
                <CheckCircle className="w-9 h-9 text-green-600" />
              </div>
              <div className="text-center">
                <p className="font-bold text-gray-900 text-lg">Asientos actualizados</p>
                <p className="text-gray-600 text-sm mt-1">
                  Tus asientos ahora son: {[...selectedSeats].sort((a, b) => a - b).join(', ')}.
                </p>
              </div>
            </div>
          ) : (
            <>
              <p className="text-sm text-gray-600">
                Tus asientos actuales son <strong>{[...currentSeats].sort((a, b) => a - b).join(', ')}</strong>.
                Toca un asiento libre para cambiarlo; no tiene costo.
              </p>

              <SeatMapPicker
                tourId={tourId}
                slotId={slotId}
                requiredSeats={required}
                onSeatsSelected={setSelectedSeats}
                selectedSeats={currentSeats}
                disabled={isSubmitting}
                ownBookingId={bookingId}
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
                  disabled={isSubmitting || selectedSeats.length !== required || sameAsCurrent}
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
                      Confirmar cambio
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

export default SeatChangeModal;
