import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Users, Minus, Plus, Calendar, Clock, AlertCircle, ChevronRight, Crown, Lock } from 'lucide-react';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import { useBookingFlow } from '../../context/BookingFlowContext';
import { useAuth } from '../../context/AuthContext';
import { supabase } from '../../lib/supabase';
import { formatCurrencyMXN } from '../../utils/formatCurrency';
import { getDepositAmount, getEffectiveDepositPct } from '../../utils/depositCalculation';
import { totalTravelerCount, TravelerCounts } from '../../types/booking-flow';
import type { Tour, TourSlot } from '../../types';
import SlotCalendarPicker from '../../components/receptivo/SlotCalendarPicker';
import SlotTimePicker from '../../components/receptivo/SlotTimePicker';
import MinTravelersAlert from '../../components/receptivo/MinTravelersAlert';

const getPrecioPorCategoria = (tour: Tour, categoria: string): number => {
  switch (categoria) {
    case 'adulto':
      return tour.precio_adulto ?? tour.price;
    case 'nino':
      return tour.precio_nino ?? 0;
    case 'infante':
      return tour.precio_infante ?? 0;
    case 'adulto_mayor':
      return tour.precio_adulto_mayor ?? tour.precio_adulto ?? tour.price;
    case 'mascota':
      return tour.precio_mascota ?? 0;
    default:
      return tour.price;
  }
};

const formatDate = (dateStr: string): string => {
  try {
    const date = new Date(dateStr + 'T12:00:00');
    return format(date, "d 'de' MMMM, yyyy", { locale: es });
  } catch {
    return dateStr;
  }
};

const BookingFlowStep1: React.FC = () => {
  const { flow, setTour, updateFlow, goToStep } = useBookingFlow();
  const { user } = useAuth();
  const navigate = useNavigate();

  const tour = flow.tour;
  const isReceptivo = tour?.tour_type === 'receptivo';
  const isPrivateTransfer = isReceptivo && (tour as any).activity_type === 'transport' && (tour as any).receptivo_modality === 'privado';
  const isTransferCustomTime = isReceptivo && (tour as any).transfer_custom_time === true;
  const hasRestrictions = isReceptivo && (tour?.restriction_pregnant || tour?.restriction_disability || tour?.restriction_physical);

  const [selectedDate, setSelectedDate] = useState<Date | null>(
    flow.selectedDate ? new Date(flow.selectedDate + 'T12:00:00') : null
  );
  const [selectedSlot, setSelectedSlot] = useState<TourSlot | null>(flow.selectedSlot);
  const [customTime, setCustomTime] = useState<string>(flow.selectedTime || '');
  const [availableSpots, setAvailableSpots] = useState<number | null>(null);
  const [isLoadingAvailability, setIsLoadingAvailability] = useState(false);
  const [isValidatingAdvance, setIsValidatingAdvance] = useState(false);
  const [error, setError] = useState('');
  const [hasActiveMembership, setHasActiveMembership] = useState(false);
  const [checkingMembership, setCheckingMembership] = useState(true);
  useEffect(() => {
    if (tour) setTour(tour);
  }, [tour, setTour]);

  useEffect(() => {
    if (!user) {
      setCheckingMembership(false);
      return;
    }
    supabase
      .rpc('has_active_membership')
      .then(({ data }) => {
        setHasActiveMembership(!!data);
        setCheckingMembership(false);
      })
      .catch(() => setCheckingMembership(false));
  }, [user]);

  const fetchAvailability = async (slotId: string | null) => {
    if (!tour) return;
    setIsLoadingAvailability(true);
    try {
      const { data, error: rpcError } = await supabase
        .rpc('get_tour_availability_v2', { p_tour_id: tour.id, p_slot_id: slotId });
      if (!rpcError && data && data.length > 0) {
        setAvailableSpots(data[0].available_spots);
      } else if (rpcError) {
        setAvailableSpots(null);
      }
    } catch {
      setAvailableSpots(null);
    } finally {
      setIsLoadingAvailability(false);
    }
  };

  useEffect(() => {
    if (!tour) return;
    if (isReceptivo) {
      if (selectedSlot) {
        fetchAvailability(selectedSlot.id);
      } else if (isTransferCustomTime && selectedDate) {
        fetchAvailability(null);
      } else {
        setAvailableSpots(null);
      }
    } else {
      fetchAvailability(null);
    }
  }, [tour, selectedSlot, selectedDate, isReceptivo, isTransferCustomTime]);

  if (!tour) {
    return null;
  }

  const travelerCounts = flow.travelerCounts;
  const totalTravelers = totalTravelerCount(travelerCounts);

  const handleCountChange = (categoria: keyof TravelerCounts, delta: number) => {
    updateFlow({
      travelerCounts: {
        ...travelerCounts,
        [categoria]: Math.max(0, travelerCounts[categoria] + delta),
      },
    });
  };

  const getSelectorLabel = () => {
    if (totalTravelers === 0 && travelerCounts.mascotas === 0) return 'Seleccionar viajeros';
    const parts: string[] = [];
    if (travelerCounts.adultos > 0) parts.push(`${travelerCounts.adultos} Adulto${travelerCounts.adultos > 1 ? 's' : ''}`);
    if (travelerCounts.ninos > 0) parts.push(`${travelerCounts.ninos} Nino${travelerCounts.ninos > 1 ? 's' : ''}`);
    if (travelerCounts.infantes > 0) parts.push(`${travelerCounts.infantes} Infante${travelerCounts.infantes > 1 ? 's' : ''}`);
    if (travelerCounts.adultos_mayores > 0) parts.push(`${travelerCounts.adultos_mayores} Adulto${travelerCounts.adultos_mayores > 1 ? 's' : ''} Mayor${travelerCounts.adultos_mayores > 1 ? 'es' : ''}`);
    if (travelerCounts.mascotas > 0) parts.push(`${travelerCounts.mascotas} Mascota${travelerCounts.mascotas > 1 ? 's' : ''}`);
    return parts.join(', ');
  };

  const canProceed = () => {
    if (totalTravelers === 0) return false;
    if (isReceptivo && !isTransferCustomTime && !selectedSlot) return false;
    if (isReceptivo && isTransferCustomTime && !selectedDate) return false;
    if (isTransferCustomTime && !customTime) return false;
    if (availableSpots !== null && totalTravelers > availableSpots) return false;
    if (isPrivateTransfer && (tour as any).private_vehicle_capacity && totalTravelers > (tour as any).private_vehicle_capacity) return false;
    if (isValidatingAdvance) return false;
    return true;
  };

  const handleContinue = async () => {
    setError('');

    if (!user) {
      navigate('/login');
      return;
    }

    if (totalTravelers === 0) {
      setError('Debes seleccionar al menos un viajero.');
      return;
    }

    if (isReceptivo && !isTransferCustomTime && !selectedSlot) {
      setError('Debes seleccionar una fecha y horario para el tour.');
      return;
    }

    if (isReceptivo && isTransferCustomTime && !selectedDate) {
      setError('Debes seleccionar la fecha del traslado.');
      return;
    }

    if (isTransferCustomTime && !customTime) {
      setError('Debes indicar a que hora necesitas el traslado.');
      return;
    }

    if (isPrivateTransfer && (tour as any).private_vehicle_capacity && totalTravelers > (tour as any).private_vehicle_capacity) {
      setError(`Este vehiculo tiene capacidad maxima de ${(tour as any).private_vehicle_capacity} pasajeros.`);
      return;
    }

    const slotIdForValidation = selectedSlot?.id || null;
    setIsValidatingAdvance(true);
    try {
      const { data: freshData, error: rpcError } = await supabase
        .rpc('get_tour_availability_v2', { p_tour_id: tour.id, p_slot_id: slotIdForValidation });
      if (rpcError || !freshData || freshData.length === 0) {
        setError('No pudimos verificar la disponibilidad. Intenta de nuevo.');
        setIsValidatingAdvance(false);
        return;
      }
      const freshAvailable = freshData[0].available_spots;
      setAvailableSpots(freshAvailable);
      if (totalTravelers > freshAvailable) {
        setError(`Solo hay ${freshAvailable} lugar${freshAvailable !== 1 ? 'es' : ''} disponible${freshAvailable !== 1 ? 's' : ''} en este momento.`);
        setIsValidatingAdvance(false);
        return;
      }
    } catch {
      setError('No pudimos verificar la disponibilidad. Intenta de nuevo.');
      setIsValidatingAdvance(false);
      return;
    }

    const bookingDate = isReceptivo && selectedSlot
      ? selectedSlot.slot_date
      : isTransferCustomTime && selectedDate
        ? selectedDate.toISOString().split('T')[0]
        : tour.start_date;

    updateFlow({
      selectedSlot,
      selectedDate: selectedDate ? selectedDate.toISOString().split('T')[0] : null,
      selectedTime: isTransferCustomTime ? customTime : (selectedSlot?.departure_time || null),
      restrictionsAccepted: false,
    });

    goToStep(2);
    navigate(`/reservar/${flow.tourSlug}/paso-2`);
  };

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const isEnPreventa = !!(
    tour.preventa_activa &&
    tour.preventa_inicio &&
    tour.preventa_fin &&
    new Date(tour.preventa_inicio + 'T00:00:00') <= today &&
    new Date(tour.preventa_fin + 'T23:59:59') >= today
  );

  return (
    <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
      <div className="p-6">
        <h1 className="text-2xl font-bold text-gray-900 mb-1">{tour.name}</h1>
        <p className="text-sm text-gray-500 mb-6">Paso 1 de 4 — Datos del tour</p>

        {isEnPreventa && !hasActiveMembership && !checkingMembership ? (
          <div className="mb-6">
            <div className="p-6 bg-gradient-to-br from-amber-50 to-yellow-50 border-2 border-amber-300 rounded-2xl text-center">
              <div className="inline-flex items-center justify-center w-16 h-16 bg-amber-100 rounded-full mb-4">
                <Lock className="w-8 h-8 text-amber-600" />
              </div>
              <h2 className="text-xl font-bold text-gray-900 mb-2">Preventa Exclusiva ToursRed Plus</h2>
              <p className="text-sm text-gray-600 mb-4 max-w-md mx-auto">
                Este tour esta en periodo de preventa exclusiva para socios ToursRed Plus.
                Adquiere tu membresía para acceder anticipadamente y disfrutar precios especiales.
              </p>
              {tour.preventa_precio_especial && (
                <div className="mb-4 p-3 bg-white rounded-xl inline-block">
                  <span className="text-xs text-gray-500">Precio especial de preventa</span>
                  <div className="text-2xl font-bold text-amber-600">{formatCurrencyMXN(tour.preventa_precio_especial)}</div>
                </div>
              )}
              <div>
                <a
                  href="/traveler/membership"
                  className="inline-flex items-center gap-2 px-6 py-3 bg-amber-500 text-white font-semibold rounded-xl hover:bg-amber-600 transition-colors"
                >
                  <Crown className="w-5 h-5" />
                  Adquirir Membresía ToursRed Plus
                </a>
              </div>
              <p className="text-xs text-gray-400 mt-4">
                La preventa general abre despues del periodo exclusivo.
              </p>
            </div>
          </div>
        ) : (
        <>
        {/* Price */}
        <div className="mb-6 p-4 bg-gray-50 rounded-xl">
          <div className="text-sm text-gray-500 mb-1">Precio por persona</div>
          <div className="text-2xl font-bold text-primary-600">{formatCurrencyMXN(tour.price)}</div>
          <div className="text-sm text-gray-500 mt-1">
            Deposito: {formatCurrencyMXN(getDepositAmount(tour.price, tour, flow.selectedDate))} ({getEffectiveDepositPct(tour, flow.selectedDate)}%)
          </div>
        </div>

        {/* Date / Slot Selection */}
        {isReceptivo ? (
          <div className="mb-6 space-y-3">
            <div className="flex items-center gap-2 mb-1">
              <Calendar className="w-4 h-4 text-teal-600" />
              <span className="text-sm font-semibold text-gray-700">
                {isTransferCustomTime ? 'Selecciona la fecha del traslado' : 'Selecciona fecha y horario'}
              </span>
            </div>
            <SlotCalendarPicker
              tour={tour}
              selectedDate={selectedDate}
              onDateSelect={(date) => {
                setSelectedDate(date);
                setSelectedSlot(null);
              }}
            />
            {isTransferCustomTime ? (
              selectedDate && (
                <div className="space-y-2">
                  <label className="block text-xs font-semibold text-gray-600">
                    A que hora necesitas el traslado? <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="time"
                    value={customTime}
                    onChange={(e) => setCustomTime(e.target.value)}
                    className="input text-sm"
                  />
                </div>
              )
            ) : (
              <>
                {selectedDate && (
                  <SlotTimePicker
                    tourId={tour.id}
                    selectedDate={selectedDate}
                    selectedSlotId={selectedSlot?.id || null}
                    onSlotSelect={(slot) => setSelectedSlot(slot as TourSlot)}
                  />
                )}
                {selectedSlot && tour.min_travelers_required && tour.min_travelers_required > 1 && (
                  <MinTravelersAlert
                    minTravelersRequired={tour.min_travelers_required}
                    confirmationHours={tour.min_travelers_confirmation_hours || 24}
                    currentSlotBooked={selectedSlot.booked_count}
                  />
                )}
                {selectedSlot && (
                  <div className="bg-teal-50 border border-teal-200 rounded-xl p-3 flex items-center gap-2.5">
                    <Clock className="w-4 h-4 text-teal-600 flex-shrink-0" />
                    <div className="text-sm">
                      <span className="font-semibold text-teal-800">
                        {format(new Date(selectedSlot.slot_date + 'T12:00:00'), "EEEE d 'de' MMMM", { locale: es })}
                      </span>
                      {selectedSlot.departure_time && (
                        <span className="text-teal-600 ml-2">
                          a las {(() => {
                            const [h, m] = selectedSlot.departure_time.split(':');
                            const hour = parseInt(h);
                            return `${hour % 12 || 12}:${m} ${hour >= 12 ? 'PM' : 'AM'}`;
                          })()}
                        </span>
                      )}
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        ) : (
          <div className="mb-6 bg-gray-50 p-4 rounded-xl">
            <div className="text-sm font-medium mb-2">Fechas del Tour</div>
            <div className="flex items-center text-gray-700">
              <Calendar className="w-4 h-4 mr-2 text-primary-600" />
              <span>{formatDate(tour.start_date)} - {formatDate(tour.end_date)}</span>
            </div>
          </div>
        )}

        {/* Traveler Count */}
        <div className="mb-6">
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Numero de Viajeros
            {isPrivateTransfer && (tour as any).private_vehicle_capacity && (
              <span className="ml-2 text-xs font-normal text-teal-700 bg-teal-50 px-2 py-0.5 rounded-full">
                Max. {(tour as any).private_vehicle_capacity} pasajeros por vehiculo
              </span>
            )}
          </label>

          {isLoadingAvailability ? (
            <div className="flex items-center justify-center py-3 text-gray-500">
              <div className="animate-spin rounded-full h-5 w-5 border-t-2 border-b-2 border-primary-600 mr-2"></div>
              <span className="text-sm">Verificando disponibilidad...</span>
            </div>
          ) : availableSpots === 0 ? (
            <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-red-800 text-sm">
              No hay lugares disponibles para este tour en este momento.
            </div>
          ) : (
            <>
              {availableSpots !== null && availableSpots > 0 && (
                <div className="mb-2 text-xs text-gray-500">
                  {availableSpots} lugar{availableSpots !== 1 ? 'es' : ''} disponible{availableSpots !== 1 ? 's' : ''}
                </div>
              )}
              <div className="border border-gray-200 rounded-lg overflow-hidden">
                <div className="flex items-center gap-2 px-4 py-3 bg-gray-50">
                  <Users className="h-4 w-4 text-gray-400" />
                  <span className="text-sm font-medium text-gray-700">
                    {totalTravelers === 0 && travelerCounts.mascotas === 0
                      ? 'Selecciona los viajeros'
                      : getSelectorLabel()}
                  </span>
                </div>
                <div className="p-4 space-y-4">
                    {tour.admite_adultos !== false && (
                      <div className="flex items-center justify-between">
                        <div>
                          <div className="text-sm font-medium text-gray-900">Adultos</div>
                          <div className="text-xs text-gray-500">13-59 anos &middot; {formatCurrencyMXN(getPrecioPorCategoria(tour, 'adulto'))}/persona</div>
                        </div>
                        <div className="flex items-center space-x-3">
                          <button type="button" onClick={() => handleCountChange('adultos', -1)} disabled={travelerCounts.adultos === 0} className="w-8 h-8 rounded-full border-2 border-gray-300 flex items-center justify-center hover:border-primary-600 disabled:opacity-30 disabled:cursor-not-allowed">
                            <Minus className="w-4 h-4" />
                          </button>
                          <span className="w-8 text-center font-medium">{travelerCounts.adultos}</span>
                          <button type="button" onClick={() => handleCountChange('adultos', 1)} disabled={availableSpots !== null && totalTravelers >= availableSpots} className="w-8 h-8 rounded-full border-2 border-primary-600 bg-primary-600 text-white flex items-center justify-center hover:bg-primary-700 disabled:opacity-30 disabled:cursor-not-allowed">
                            <Plus className="w-4 h-4" />
                          </button>
                        </div>
                      </div>
                    )}
                    {tour.admite_ninos !== false && (
                      <div className="flex items-center justify-between">
                        <div>
                          <div className="text-sm font-medium text-gray-900">Ninos</div>
                          <div className="text-xs text-gray-500">3-12 anos &middot; {formatCurrencyMXN(getPrecioPorCategoria(tour, 'nino'))}/persona</div>
                        </div>
                        <div className="flex items-center space-x-3">
                          <button type="button" onClick={() => handleCountChange('ninos', -1)} disabled={travelerCounts.ninos === 0} className="w-8 h-8 rounded-full border-2 border-gray-300 flex items-center justify-center hover:border-primary-600 disabled:opacity-30 disabled:cursor-not-allowed">
                            <Minus className="w-4 h-4" />
                          </button>
                          <span className="w-8 text-center font-medium">{travelerCounts.ninos}</span>
                          <button type="button" onClick={() => handleCountChange('ninos', 1)} disabled={availableSpots !== null && totalTravelers >= availableSpots} className="w-8 h-8 rounded-full border-2 border-primary-600 bg-primary-600 text-white flex items-center justify-center hover:bg-primary-700 disabled:opacity-30 disabled:cursor-not-allowed">
                            <Plus className="w-4 h-4" />
                          </button>
                        </div>
                      </div>
                    )}
                    {tour.admite_infantes !== false && (
                      <div className="flex items-center justify-between">
                        <div>
                          <div className="text-sm font-medium text-gray-900">Infantes</div>
                          <div className="text-xs text-gray-500">0-2 anos &middot; {formatCurrencyMXN(getPrecioPorCategoria(tour, 'infante'))}/persona</div>
                        </div>
                        <div className="flex items-center space-x-3">
                          <button type="button" onClick={() => handleCountChange('infantes', -1)} disabled={travelerCounts.infantes === 0} className="w-8 h-8 rounded-full border-2 border-gray-300 flex items-center justify-center hover:border-primary-600 disabled:opacity-30 disabled:cursor-not-allowed">
                            <Minus className="w-4 h-4" />
                          </button>
                          <span className="w-8 text-center font-medium">{travelerCounts.infantes}</span>
                          <button type="button" onClick={() => handleCountChange('infantes', 1)} className="w-8 h-8 rounded-full border-2 border-primary-600 bg-primary-600 text-white flex items-center justify-center hover:bg-primary-700">
                            <Plus className="w-4 h-4" />
                          </button>
                        </div>
                      </div>
                    )}
                    {tour.admite_adultos_mayores !== false && (
                      <div className="flex items-center justify-between">
                        <div>
                          <div className="text-sm font-medium text-gray-900">Adultos Mayores</div>
                          <div className="text-xs text-gray-500">60+ anos &middot; {formatCurrencyMXN(getPrecioPorCategoria(tour, 'adulto_mayor'))}/persona</div>
                        </div>
                        <div className="flex items-center space-x-3">
                          <button type="button" onClick={() => handleCountChange('adultos_mayores', -1)} disabled={travelerCounts.adultos_mayores === 0} className="w-8 h-8 rounded-full border-2 border-gray-300 flex items-center justify-center hover:border-primary-600 disabled:opacity-30 disabled:cursor-not-allowed">
                            <Minus className="w-4 h-4" />
                          </button>
                          <span className="w-8 text-center font-medium">{travelerCounts.adultos_mayores}</span>
                          <button type="button" onClick={() => handleCountChange('adultos_mayores', 1)} disabled={availableSpots !== null && totalTravelers >= availableSpots} className="w-8 h-8 rounded-full border-2 border-primary-600 bg-primary-600 text-white flex items-center justify-center hover:bg-primary-700 disabled:opacity-30 disabled:cursor-not-allowed">
                            <Plus className="w-4 h-4" />
                          </button>
                        </div>
                      </div>
                    )}
                    {tour.pet_friendly && (
                      <div className="flex items-center justify-between pt-2 border-t border-gray-100">
                        <div>
                          <div className="text-sm font-medium text-gray-900">Mascotas</div>
                          <div className="text-xs text-gray-500">{formatCurrencyMXN(getPrecioPorCategoria(tour, 'mascota'))}/mascota</div>
                        </div>
                        <div className="flex items-center space-x-3">
                          <button type="button" onClick={() => handleCountChange('mascotas', -1)} disabled={travelerCounts.mascotas === 0} className="w-8 h-8 rounded-full border-2 border-gray-300 flex items-center justify-center hover:border-primary-600 disabled:opacity-30 disabled:cursor-not-allowed">
                            <Minus className="w-4 h-4" />
                          </button>
                          <span className="w-8 text-center font-medium">{travelerCounts.mascotas}</span>
                          <button type="button" onClick={() => handleCountChange('mascotas', 1)} className="w-8 h-8 rounded-full border-2 border-primary-600 bg-primary-600 text-white flex items-center justify-center hover:bg-primary-700">
                            <Plus className="w-4 h-4" />
                          </button>
                        </div>
                      </div>
                    )}
                </div>
              </div>
            </>
          )}
        </div>

        {hasRestrictions && (
          <div className="mb-6 p-4 bg-amber-50 border border-amber-200 rounded-xl">
            <div className="flex items-start gap-2">
              <AlertCircle className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-semibold text-amber-800">Este tour tiene restricciones</p>
                <ul className="text-sm text-amber-700 mt-1 space-y-0.5">
                  {tour.restriction_pregnant && <li>- No apto para personas embarazadas</li>}
                  {tour.restriction_disability && <li>- No apto para personas con discapacidad motriz</li>}
                  {tour.restriction_physical && <li>- Requiere condicion fisica adecuada</li>}
                </ul>
                <p className="text-xs text-amber-600 mt-2">Deberas aceptar estas restricciones en el paso 3.</p>
              </div>
            </div>
          </div>
        )}

        {isEnPreventa && hasActiveMembership && (
          <div className="mb-6 p-3 bg-amber-50 border border-amber-200 rounded-xl text-sm text-amber-800">
            <Crown className="w-4 h-4 inline mr-1" />
            Estas disfrutando de la preventa exclusiva ToursRed Plus con precios especiales.
          </div>
        )}

        {error && (
          <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
            {error}
          </div>
        )}

        {/* Continue Button */}
        <button
          onClick={handleContinue}
          disabled={!canProceed()}
          className="w-full py-3.5 bg-primary-600 text-white font-semibold rounded-xl hover:bg-primary-700 disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors flex items-center justify-center gap-2"
        >
          {isValidatingAdvance ? 'Verificando disponibilidad...' : 'Continuar al Paso 2'}
          {!isValidatingAdvance && <ChevronRight className="w-5 h-5" />}
        </button>
        </>
        )}
      </div>
    </div>
  );
};

export default BookingFlowStep1;
