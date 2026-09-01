import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ChevronRight, ChevronLeft, Bus, Car, Globe, Users, AlertTriangle, AlertCircle,
  Clock, Shield, Crown, Minus, Plus, Info, Timer,
} from 'lucide-react';
import { useBookingFlow } from '../../context/BookingFlowContext';
import { useAuth } from '../../context/AuthContext';
import { useMembershipPrices } from '../../hooks/useMembershipPrices';
import { supabase } from '../../lib/supabase';
import { formatCurrencyMXN } from '../../utils/formatCurrency';
import { totalTravelerCount } from '../../types/booking-flow';
import type { Tour, TourOptionalService } from '../../types';
import SeatMapPicker from '../../components/seats/SeatMapPicker';

interface OptionalServiceCapacity {
  serviceId: string;
  remaining: number | null;
}

const BookingFlowStep3: React.FC = () => {
  const { flow, updateFlow, goToStep, sessionId, releaseHolds } = useBookingFlow();
  const { user } = useAuth();
  const navigate = useNavigate();
  const { prices: membershipPrices } = useMembershipPrices();

  const tour = flow.tour;
  const isReceptivo = tour?.tour_type === 'receptivo';
  const isPrivateTransfer = isReceptivo && tour?.activity_type === 'transport' && tour?.receptivo_modality === 'privado';
  // `tour?.` y no `(tour as any).`: sin el optional chaining esta linea tiraba
  // TypeError con tour null, 232 lineas ANTES del `if (!tour) return null` que
  // se supone cubre ese caso — o sea que ese return null era codigo muerto para
  // el escenario que deberia proteger. Ahora es consistente con las lineas
  // 28/32/33, que siempre lo tuvieron.
  const hasSeatMap = !!tour?.vehicle_map_type && !isPrivateTransfer;
  const hasRestrictions = isReceptivo && (tour.restriction_pregnant || tour.restriction_disability || tour.restriction_physical);
  const tourLanguages: any[] = Array.isArray(tour?.tour_languages) ? tour.tour_languages : [];
  const pickupZones: any[] = Array.isArray(tour?.pickup_zones) ? tour.pickup_zones : [];

  const [optionalServices, setOptionalServices] = useState<TourOptionalService[]>([]);
  const [optionalServiceQuantities, setOptionalServiceQuantities] = useState<Record<string, number>>({});
  const [serviceCapacities, setServiceCapacities] = useState<OptionalServiceCapacity[]>([]);
  const [isLoadingOptionalServices, setIsLoadingOptionalServices] = useState(true);

  const [hasMembership, setHasMembership] = useState(false);
  const [isLoadingMembership, setIsLoadingMembership] = useState(true);
  const [walletBalance, setWalletBalance] = useState(0);
  const [pointsBalance, setPointsBalance] = useState(0);
  const [pointsWalletActive, setPointsWalletActive] = useState(false);
  const [isForeignTraveler, setIsForeignTraveler] = useState(false);
  const [noShowCount, setNoShowCount] = useState(0);
  const [isHighRisk, setIsHighRisk] = useState(false);

  const [insuranceEnabled, setInsuranceEnabled] = useState(true);
  const [insurancePricePerDay, setInsurancePricePerDay] = useState(79);
  const [serviceChargePct, setServiceChargePct] = useState(10);
  const [optionalServiceCommissionPct, setOptionalServiceCommissionPct] = useState(15);

  const [holdTimer, setHoldTimer] = useState<number | null>(null);
  const [holdError, setHoldError] = useState('');
  const [isHoldingSeats, setIsHoldingSeats] = useState(false);
  const holdIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const totalTravelers = totalTravelerCount(flow.travelerCounts);
  const isInsuranceApplicable = insuranceEnabled && !['experience', 'transport', 'ticket'].includes((tour as any).activity_type as string) && !isForeignTraveler && !(tour as any).includes_insurance;

  const slotId = flow.selectedSlot?.id || null;

  // Load platform settings
  useEffect(() => {
    if (!tour) return;
    const loadSettings = async () => {
      try {
        const { data } = await supabase
          .from('platform_settings')
          .select('service_charge_percentage, optional_service_commission_percentage, travel_insurance_price_per_day_per_traveler, travel_insurance_enabled')
          .maybeSingle();
        if (data) {
          setServiceChargePct(data.service_charge_percentage || 10);
          setOptionalServiceCommissionPct(data.optional_service_commission_percentage || 15);
          setInsuranceEnabled(data.travel_insurance_enabled !== false);
          if (data.travel_insurance_price_per_day_per_traveler != null) {
            setInsurancePricePerDay(data.travel_insurance_price_per_day_per_traveler);
          }
        }
      } catch {
        // non-critical
      }
    };
    loadSettings();
  }, [tour]);

  // Load membership, wallet, points, no-show
  useEffect(() => {
    if (!user || !tour) return;
    const loadUserState = async () => {
      try {
        const { data: memData } = await supabase
          .from('memberships')
          .select('status, current_period_end')
          .eq('user_id', user.id)
          .in('status', ['active', 'cancelled'])
          .maybeSingle();
        const isActive = !!memData && (
          memData.status === 'active' ||
          (memData.status === 'cancelled' && memData.current_period_end && new Date(memData.current_period_end) > new Date())
        );
        setHasMembership(isActive);

        const { data: walletData } = await supabase
          .from('toursred_cash_wallets')
          .select('balance')
          .eq('user_id', user.id)
          .eq('is_active', true)
          .maybeSingle();
        setWalletBalance(walletData?.balance || 0);

        const { data: pointsData } = await supabase
          .from('toursred_points_wallets')
          .select('balance, is_active')
          .eq('user_id', user.id)
          .maybeSingle();
        setPointsBalance(pointsData?.balance || 0);
        const memStillActive = isActive;
        setPointsWalletActive((pointsData?.is_active || false) || memStillActive);

        const { data: userData } = await supabase
          .from('users')
          .select('no_show_count, is_foreign_traveler')
          .eq('id', user.id)
          .maybeSingle();
        setNoShowCount(userData?.no_show_count || 0);
        setIsHighRisk((userData?.no_show_count || 0) > 3);
        setIsForeignTraveler(userData?.is_foreign_traveler ?? false);
      } catch {
        // non-critical
      } finally {
        setIsLoadingMembership(false);
      }
    };
    loadUserState();
  }, [user, tour]);

  // Load optional services
  useEffect(() => {
    if (!tour) return;
    const loadServices = async () => {
      try {
        const { data, error } = await supabase
          .from('tour_optional_services')
          .select('*')
          .eq('tour_id', tour.id)
          .eq('is_active', true)
          .order('display_order');
        if (error || !data) {
          setOptionalServices([]);
          return;
        }
        setOptionalServices(data);

        const idsWithCap = data.filter(s => s.max_capacity !== null).map(s => s.id);
        if (idsWithCap.length > 0) {
          const { data: capData } = await supabase
            .rpc('get_optional_services_capacity', { p_service_ids: idsWithCap });
          if (capData) {
            setServiceCapacities(capData.map((c: any) => ({
              serviceId: c.service_id,
              remaining: c.remaining_capacity,
            })));
          }
        }
      } catch {
        // non-critical
      } finally {
        setIsLoadingOptionalServices(false);
      }
    };
    loadServices();
  }, [tour]);

  // Hold seats when entering this screen or when seat selection changes
  const performSeatHold = useCallback(async (seats: number[]) => {
    if (!tour || seats.length === 0) return;
    setHoldError('');
    setIsHoldingSeats(true);
    try {
      const { data, error } = await supabase.rpc('hold_seats', {
        p_tour_id: tour.id,
        p_slot_id: slotId,
        p_session_id: sessionId,
        p_seat_numbers: seats,
        p_user_id: user?.id || null,
      });
      if (error) throw error;
      if (data?.failed && data.failed.length > 0) {
        setHoldError(`Algunos asientos ya no estan disponibles: ${data.failed.join(', ')}`);
        const held = data.held || [];
        updateFlow({ selectedSeats: held, seatsHeld: held.length > 0 });
      } else {
        updateFlow({ selectedSeats: seats, seatsHeld: true });
      }
    } catch (err: any) {
      setHoldError('No se pudieron apartar los asientos. Intenta de nuevo.');
    } finally {
      setIsHoldingSeats(false);
    }
  }, [tour, slotId, sessionId, user, updateFlow]);

  // Generic capacity hold for tours without seat maps
  const performGenericHold = useCallback(async () => {
    if (!tour || totalTravelers === 0) return;
    setHoldError('');
    setIsHoldingSeats(true);
    try {
      const { error } = await supabase.rpc('hold_seats', {
        p_tour_id: tour.id,
        p_slot_id: slotId,
        p_session_id: sessionId,
        p_held_count: totalTravelers,
        p_user_id: user?.id || null,
      });
      if (error) throw error;
      updateFlow({ seatsHeld: true });
    } catch {
      setHoldError('No se pudieron apartar los lugares. Intenta de nuevo.');
    } finally {
      setIsHoldingSeats(false);
    }
  }, [tour, slotId, sessionId, totalTravelers, user, updateFlow]);

  // Auto-hold on mount: generic for non-seat-map tours
  useEffect(() => {
    if (!tour || flow.seatsHeld || totalTravelers === 0) return;
    if (!hasSeatMap) {
      performGenericHold();
    }
  }, [tour, flow.seatsHeld, totalTravelers, hasSeatMap, performGenericHold]);

  // Hold timer countdown
  useEffect(() => {
    if (!flow.holdExpiresAt) return;
    const expires = new Date(flow.holdExpiresAt).getTime();
    if (holdIntervalRef.current) clearInterval(holdIntervalRef.current);
    holdIntervalRef.current = setInterval(() => {
      const remaining = Math.max(0, Math.floor((expires - Date.now()) / 1000));
      setHoldTimer(remaining);
      if (remaining <= 0) {
        if (holdIntervalRef.current) clearInterval(holdIntervalRef.current);
        updateFlow({ seatsHeld: false, holdExpiresAt: null });
      }
    }, 1000);
    return () => {
      if (holdIntervalRef.current) clearInterval(holdIntervalRef.current);
    };
  }, [flow.holdExpiresAt, updateFlow]);

  // Refresh holds periodically (re-extend on interaction)
  const refreshHold = useCallback(async () => {
    if (!tour || !flow.seatsHeld) return;
    if (hasSeatMap && flow.selectedSeats.length > 0) {
      await performSeatHold(flow.selectedSeats);
    } else if (!hasSeatMap && totalTravelers > 0) {
      await performGenericHold();
    }
  }, [tour, flow.seatsHeld, flow.selectedSeats, hasSeatMap, totalTravelers, performSeatHold, performGenericHold]);

  // Trigger seat hold when the selection in context is complete — doing this
  // in a useEffect (rather than inside handleSeatSelect) ensures the context
  // state is already committed before we attempt the hold, avoiding stale
  // values and the "setState during render" React warning.
  //
  // Va ARRIBA del `if (!tour) return null` de abajo a proposito: estaba despues
  // y eso lo hacia un hook condicional (react-hooks/rules-of-hooks). En los
  // renders con `tour` null se llamaban menos hooks que en el resto, y eso es
  // `Rendered fewer hooks than expected` — pantalla blanca, no un warning.
  // El guardia de adentro (`hasSeatMap && ...`) ya cubre el caso sin tour.
  useEffect(() => {
    if (hasSeatMap && flow.selectedSeats.length > 0 && flow.selectedSeats.length === totalTravelers) {
      performSeatHold(flow.selectedSeats);
    }
  }, [hasSeatMap, flow.selectedSeats, totalTravelers, performSeatHold]);

  if (!tour) return null;

  const handleOptionalServiceChange = (serviceId: string, delta: number) => {
    const svc = optionalServices.find(s => s.id === serviceId);
    if (!svc) return;
    const capInfo = serviceCapacities.find(c => c.serviceId === serviceId);
    const maxAllowed = capInfo?.remaining !== null ? (capInfo?.remaining ?? 99) : 99;
    setOptionalServiceQuantities(prev => {
      const current = prev[serviceId] || 0;
      return { ...prev, [serviceId]: Math.max(0, Math.min(maxAllowed, current + delta)) };
    });
  };

  const handleSeatSelect = (seats: number[]) => {
    updateFlow({ selectedSeats: seats });
  };

  const handleContinue = () => {
    if (hasSeatMap && flow.selectedSeats.length < totalTravelers) {
      setHoldError(`Debes seleccionar ${totalTravelers} asiento${totalTravelers !== 1 ? 's' : ''} antes de continuar.`);
      return;
    }
    if (hasRestrictions && !flow.restrictionsAccepted) {
      setHoldError('Debes aceptar las restricciones del tour para continuar.');
      return;
    }
    if (isReceptivo && tour.pickup_available && flow.pickupType === 'pickup' && !flow.pickupHotelAddress?.trim()) {
      setHoldError('Debes ingresar tu direccion o nombre de hotel para la recogida.');
      return;
    }

    // Build optional services array for the flow state
    const extrasServiceChargeRate = serviceChargePct / 100;
    const extrasAgencyCommissionRate = optionalServiceCommissionPct / 100;
    const allExtras: any[] = [];

    for (const svc of optionalServices) {
      const qty = optionalServiceQuantities[svc.id] || 0;
      if (qty <= 0) continue;
      const subtotal = qty * svc.price_per_person;
      const svcServiceCharge = Math.round(subtotal * extrasServiceChargeRate * 100) / 100;
      const svcAgencyCommission = Math.round(subtotal * extrasAgencyCommissionRate * 100) / 100;
      allExtras.push({
        tour_optional_service_id: svc.id,
        service_kind: 'optional_service' as const,
        description: svc.name || 'Servicio opcional',
        quantity: qty,
        unit_price: svc.price_per_person,
        subtotal,
        service_charge: svcServiceCharge,
        agency_commission: svcAgencyCommission,
        total_paid: subtotal + svcServiceCharge,
      });
    }

    const selectedZoneData = flow.pickupType === 'pickup' && flow.pickupZoneName && flow.pickupZoneName !== 'free'
      ? pickupZones.find((z: any) => z.name === flow.pickupZoneName)
      : null;

    if (isReceptivo && flow.pickupType === 'pickup' && selectedZoneData) {
      const pickupExtraCost = selectedZoneData.cost_type === 'por_persona'
        ? (selectedZoneData.extra_cost || 0) * totalTravelers
        : (selectedZoneData.extra_cost || 0);
      if (pickupExtraCost > 0) {
        const svcServiceCharge = Math.round(pickupExtraCost * extrasServiceChargeRate * 100) / 100;
        const svcAgencyCommission = Math.round(pickupExtraCost * extrasAgencyCommissionRate * 100) / 100;
        allExtras.push({
          tour_optional_service_id: null,
          service_kind: 'pickup' as const,
          description: `Pick Up — ${selectedZoneData.name}`,
          quantity: selectedZoneData.cost_type === 'por_persona' ? totalTravelers : 1,
          unit_price: selectedZoneData.extra_cost || 0,
          subtotal: pickupExtraCost,
          service_charge: svcServiceCharge,
          agency_commission: svcAgencyCommission,
          total_paid: pickupExtraCost + svcServiceCharge,
        });
      }
    }

    const selectedLanguageData = tourLanguages.find((l: any) => l.language === flow.selectedLanguage);
    if (isReceptivo && flow.selectedLanguage && selectedLanguageData && (selectedLanguageData.extra_cost || 0) > 0) {
      const langExtraCost = selectedLanguageData.cost_type === 'por_persona'
        ? (selectedLanguageData.extra_cost || 0) * totalTravelers
        : (selectedLanguageData.extra_cost || 0);
      const svcServiceCharge = Math.round(langExtraCost * extrasServiceChargeRate * 100) / 100;
      const svcAgencyCommission = Math.round(langExtraCost * extrasAgencyCommissionRate * 100) / 100;
      allExtras.push({
        tour_optional_service_id: null,
        service_kind: 'language' as const,
        description: `Idioma — ${flow.selectedLanguage}`,
        quantity: selectedLanguageData.cost_type === 'por_persona' ? totalTravelers : 1,
        unit_price: selectedLanguageData.extra_cost || 0,
        subtotal: langExtraCost,
        service_charge: svcServiceCharge,
        agency_commission: svcAgencyCommission,
        total_paid: langExtraCost + svcServiceCharge,
      });
    }

    const membershipCost = flow.addMembership && !hasMembership && membershipPrices
      ? (flow.membershipPlan === 'anual' ? membershipPrices.annualPrice : membershipPrices.monthlyPrice)
      : 0;

    updateFlow({
      optionalServices: allExtras,
      membershipCost,
      pickupExtraCost: allExtras.filter(e => e.service_kind === 'pickup').reduce((sum, e) => sum + e.subtotal, 0),
      languageExtraCost: allExtras.filter(e => e.service_kind === 'language').reduce((sum, e) => sum + e.subtotal, 0),
    });

    goToStep(4);
    navigate(`/reservar/${flow.tourSlug}/paso-4`);
  };

  const handleBack = () => {
    updateFlow({ travelers: flow.travelers });
    goToStep(2);
    navigate(`/reservar/${flow.tourSlug}/paso-2`);
  };

  const formatHoldTime = (seconds: number): string => {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}:${s.toString().padStart(2, '0')}`;
  };

  return (
    <div className="bg-white rounded-2xl shadow-xs border border-gray-100 overflow-hidden">
      <div className="p-6">
        <h1 className="text-2xl font-bold text-gray-900 mb-1">Asientos, extras y membresia</h1>
        <p className="text-sm text-gray-500 mb-6">Paso 3 de 4 — Personaliza tu reserva</p>

        {/* Hold timer */}
        {flow.seatsHeld && holdTimer !== null && holdTimer > 0 && (
          <div className="mb-4 p-3 bg-blue-50 border border-blue-200 rounded-xl flex items-center gap-2">
            <Timer className="w-5 h-5 text-blue-600 flex-shrink-0" />
            <span className="text-sm text-blue-800 font-medium">
              Tus {hasSeatMap ? 'asientos' : 'lugares'} estan apartados por {formatHoldTime(holdTimer)} minutos
            </span>
            <button onClick={refreshHold} className="ml-auto text-xs text-blue-600 hover:underline font-medium">
              Renovar
            </button>
          </div>
        )}

        {flow.seatsHeld && holdTimer !== null && holdTimer <= 0 && (
          <div className="mb-4 p-3 bg-amber-50 border border-amber-200 rounded-xl flex items-center gap-2">
            <AlertCircle className="w-5 h-5 text-amber-600 flex-shrink-0" />
            <span className="text-sm text-amber-800">
              Tu tiempo de apartado ha expirado. Vuelve a seleccionar tus {hasSeatMap ? 'asientos' : 'lugares'}.
            </span>
          </div>
        )}

        {holdError && (
          <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm flex items-start gap-2">
            <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
            {holdError}
          </div>
        )}

        {/* Seat Selection — Mode A: specific seats */}
        {hasSeatMap && (
          <div className="mb-6 space-y-3">
            <div className="flex items-center gap-2">
              <Bus className="w-4 h-4 text-blue-600" />
              <span className="text-sm font-semibold text-gray-700">Selecciona tus asientos</span>
            </div>
            {isHoldingSeats && (
              <div className="flex items-center gap-2 text-sm text-blue-600">
                <div className="animate-spin rounded-full h-4 w-4 border-t-2 border-b-2 border-blue-600"></div>
                Apartando asientos...
              </div>
            )}
            <div className="border border-blue-200 rounded-xl p-4 bg-white">
              <SeatMapPicker
                tourId={tour.id}
                slotId={slotId}
                requiredSeats={totalTravelers}
                selectedSeats={flow.selectedSeats}
                onSeatsSelected={handleSeatSelect}
              />
            </div>
          </div>
        )}

        {/* Seat Selection — Mode B: generic capacity (no seat map) */}
        {!hasSeatMap && (
          <div className="mb-6">
            <div className="p-4 bg-teal-50 border border-teal-200 rounded-xl">
              <div className="flex items-center gap-2 mb-1">
                <Users className="w-4 h-4 text-teal-600" />
                <span className="text-sm font-semibold text-teal-800">
                  {isPrivateTransfer ? 'Capacidad del vehiculo' : 'Lugares disponibles'}
                </span>
              </div>
              <p className="text-sm text-teal-700">
                {isPrivateTransfer
                  ? `Reservando para ${totalTravelers} pasajero${totalTravelers !== 1 ? 's' : ''} en vehiculo privado.`
                  : `Reservando ${totalTravelers} lugar${totalTravelers !== 1 ? 'es' : ''} para este tour.`}
              </p>
              {isPrivateTransfer && (tour as any).private_vehicle_capacity && (
                <p className="text-xs text-teal-600 mt-1">
                  Capacidad maxima: {(tour as any).private_vehicle_capacity} pasajeros
                </p>
              )}
            </div>
          </div>
        )}

        {/* Pickup selector */}
        {isReceptivo && tour.pickup_available && (
          <div className="mb-6 space-y-3">
            <div className="flex items-center gap-2">
              <Car className="w-4 h-4 text-teal-600" />
              <span className="text-sm font-semibold text-gray-700">Tipo de traslado</span>
            </div>
            <div className="space-y-2">
              <label className={`flex items-start gap-3 p-3 rounded-lg border-2 cursor-pointer transition-all ${flow.pickupType === 'meeting_point' ? 'border-teal-500 bg-teal-50' : 'border-gray-200'}`}>
                <input type="radio" name="pickup_type" checked={flow.pickupType === 'meeting_point'} onChange={() => updateFlow({ pickupType: 'meeting_point' })} className="mt-0.5 text-teal-600" />
                <div>
                  <span className="text-sm font-medium text-gray-800">Me presento en el punto de encuentro</span>
                  <p className="text-xs text-gray-500 mt-0.5">Llego por mi cuenta al punto indicado</p>
                </div>
              </label>
              <label className={`flex items-start gap-3 p-3 rounded-lg border-2 cursor-pointer transition-all ${flow.pickupType === 'pickup' ? 'border-teal-500 bg-teal-50' : 'border-gray-200'}`}>
                <input type="radio" name="pickup_type" checked={flow.pickupType === 'pickup'} onChange={() => updateFlow({ pickupType: 'pickup' })} className="mt-0.5 text-teal-600" />
                <div>
                  <span className="text-sm font-medium text-gray-800">Solicitar recogida en mi hotel</span>
                  <p className="text-xs text-gray-500 mt-0.5">La agencia pasara por ti</p>
                </div>
              </label>
            </div>

            {flow.pickupType === 'pickup' && (
              <div className="pl-4 space-y-3">
                {tour.pickup_free_zone && (
                  <div className="text-xs text-teal-700 bg-teal-50 border border-teal-200 rounded-lg px-3 py-2">
                    <span className="font-semibold">Zona sin costo:</span> {tour.pickup_free_zone}
                  </div>
                )}
                <div>
                  <label className="block text-xs font-semibold text-gray-600 mb-1">
                    Nombre de tu hotel o direccion <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="text"
                    value={flow.pickupHotelAddress || ''}
                    onChange={(e) => updateFlow({ pickupHotelAddress: e.target.value })}
                    className="input text-sm"
                    placeholder="Ej: Hotel Barcelo, Zona Hotelera"
                  />
                </div>
                {pickupZones.length > 0 && (
                  <div>
                    <label className="block text-xs font-semibold text-gray-600 mb-1">Zona de recogida</label>
                    <select
                      value={flow.pickupZoneName || 'free'}
                      onChange={(e) => updateFlow({ pickupZoneName: e.target.value })}
                      className="input text-sm"
                    >
                      <option value="free">{tour.pickup_free_zone ? `Sin costo (${tour.pickup_free_zone})` : 'Sin costo adicional'}</option>
                      {pickupZones.map((zone: any, idx: number) => (
                        <option key={idx} value={zone.name}>
                          {zone.name} — +{formatCurrencyMXN(zone.extra_cost ?? 0)} MXN {zone.cost_type === 'por_persona' ? '/ persona' : '/ reserva'}
                        </option>
                      ))}
                    </select>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* Language selector */}
        {isReceptivo && tourLanguages.length > 0 && (
          <div className="mb-6 space-y-2">
            <div className="flex items-center gap-2">
              <Globe className="w-4 h-4 text-blue-600" />
              <span className="text-sm font-semibold text-gray-700">Idioma del tour</span>
            </div>
            <select
              value={flow.selectedLanguage || ''}
              onChange={(e) => updateFlow({ selectedLanguage: e.target.value || null })}
              className="input text-sm"
            >
              <option value="">Idioma por defecto (sin costo extra)</option>
              {tourLanguages.map((lang: any, idx: number) => (
                <option key={idx} value={lang.language}>
                  {lang.language}{lang.extra_cost > 0 ? ` — +${formatCurrencyMXN(lang.extra_cost ?? 0)} MXN ${lang.cost_type === 'por_persona' ? '/ persona' : 'fijo'}` : ' (sin costo extra)'}
                </option>
              ))}
            </select>
          </div>
        )}

        {/* Optional services */}
        {!isLoadingOptionalServices && optionalServices.length > 0 && (
          <div className="mb-6">
            <div className="text-sm font-semibold text-gray-700 mb-3">Servicios opcionales</div>
            <div className="flex flex-col gap-y-3">
              {optionalServices.map((svc) => {
                const qty = optionalServiceQuantities[svc.id] || 0;
                const capInfo = serviceCapacities.find(c => c.serviceId === svc.id);
                const maxAllowed = capInfo?.remaining !== null ? (capInfo?.remaining ?? 99) : 99;
                return (
                  <div key={svc.id} className="flex items-center justify-between p-3 border border-gray-200 rounded-lg">
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium text-gray-900">{svc.name}</div>
                      <div className="text-xs text-gray-500">
                        {formatCurrencyMXN(svc.price_per_person)}/persona
                        {capInfo?.remaining !== null && capInfo?.remaining !== undefined && (
                          <span className="ml-2 text-amber-600">{capInfo.remaining} disponibles</span>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-x-3 flex-shrink-0">
                      <button
                        type="button"
                        onClick={() => handleOptionalServiceChange(svc.id, -1)}
                        disabled={qty === 0}
                        className="w-8 h-8 rounded-full border-2 border-gray-300 flex items-center justify-center disabled:opacity-30 disabled:cursor-not-allowed"
                      >
                        <Minus className="w-4 h-4" />
                      </button>
                      <span className="w-8 text-center font-medium text-sm">{qty}</span>
                      <button
                        type="button"
                        onClick={() => handleOptionalServiceChange(svc.id, 1)}
                        disabled={qty >= maxAllowed}
                        className="w-8 h-8 rounded-full border-2 border-primary-600 bg-primary-600 text-white flex items-center justify-center disabled:opacity-30 disabled:cursor-not-allowed"
                      >
                        <Plus className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Travel insurance */}
        {isInsuranceApplicable && (
          <div className="mb-6">
            <label className={`flex items-start gap-3 p-4 rounded-xl border-2 cursor-pointer transition-all ${flow.includeInsurance ? 'border-green-400 bg-green-50' : 'border-gray-200'}`}>
              <input
                type="checkbox"
                checked={flow.includeInsurance}
                onChange={(e) => updateFlow({ includeInsurance: e.target.checked })}
                className="mt-0.5 h-4 w-4 text-green-600"
              />
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <Shield className="w-4 h-4 text-green-600" />
                  <span className="text-sm font-semibold text-gray-800">Seguro de viaje</span>
                </div>
                <p className="text-xs text-gray-600 mt-1">
                  Cobertura medica por {formatCurrencyMXN(insurancePricePerDay)}/dia/persona
                </p>
              </div>
            </label>
          </div>
        )}

        {/* Membership offer */}
        {!isLoadingMembership && !hasMembership && !isHighRisk && (
          <div className="mb-6">
            <label className={`flex items-start gap-3 p-4 rounded-xl border-2 cursor-pointer transition-all ${flow.addMembership ? 'border-amber-400 bg-amber-50' : 'border-gray-200'}`}>
              <input
                type="checkbox"
                checked={flow.addMembership}
                onChange={(e) => updateFlow({ addMembership: e.target.checked, membershipPlan: e.target.checked ? 'mensual' : null })}
                className="mt-0.5 h-4 w-4 text-amber-600"
              />
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <Crown className="w-4 h-4 text-amber-600" />
                  <span className="text-sm font-semibold text-gray-800">Agregar membresia ToursRed Plus</span>
                </div>
                <p className="text-xs text-gray-600 mt-1">
                  Sin cargo por servicio en esta y futuras reservas, puntos ToursRed y mas beneficios.
                </p>
              </div>
            </label>

            {flow.addMembership && membershipPrices && (
              <div className="mt-3 ml-7 space-y-2">
                <label className="flex items-start cursor-pointer">
                  <input
                    type="radio"
                    name="membership-plan"
                    checked={flow.membershipPlan === 'mensual'}
                    onChange={() => updateFlow({ membershipPlan: 'mensual' })}
                    className="mt-1 h-4 w-4 text-primary-600 border-gray-300"
                  />
                  <div className="ml-3 flex-1">
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium text-gray-900">Plan Mensual</span>
                      <span className="text-sm font-bold text-primary-600">{membershipPrices.monthlyPriceFormatted}/mes</span>
                    </div>
                    <p className="text-xs text-gray-600">Cancela cuando quieras</p>
                  </div>
                </label>
                <label className="flex items-start cursor-pointer">
                  <input
                    type="radio"
                    name="membership-plan"
                    checked={flow.membershipPlan === 'anual'}
                    onChange={() => updateFlow({ membershipPlan: 'anual' })}
                    className="mt-1 h-4 w-4 text-primary-600 border-gray-300"
                  />
                  <div className="ml-3 flex-1">
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium text-gray-900">Plan Anual</span>
                      <span className="text-sm font-bold text-primary-600">{membershipPrices.annualPriceFormatted}/ano</span>
                    </div>
                    <p className="text-xs text-gray-600">
                      Ahorra {membershipPrices.annualSavingsFormatted} al ano ({membershipPrices.savingsPercentage}%)
                    </p>
                  </div>
                </label>
              </div>
            )}
          </div>
        )}

        {/* Restrictions */}
        {hasRestrictions && (
          <div className="mb-6">
            <div className="bg-amber-50 border-2 border-amber-300 rounded-xl p-4 space-y-3">
              <div className="flex items-center gap-2">
                <AlertTriangle className="w-5 h-5 text-amber-600 flex-shrink-0" />
                <span className="text-sm font-semibold text-amber-800">Restricciones del Tour</span>
              </div>
              <div className="flex flex-col gap-y-1.5">
                {tour.restriction_pregnant && <p className="text-xs text-amber-800">- No apto para mujeres embarazadas</p>}
                {tour.restriction_disability && <p className="text-xs text-amber-800">- No apto para personas con discapacidad motriz</p>}
                {tour.restriction_physical && <p className="text-xs text-amber-800">- Requiere condicion fisica adecuada</p>}
              </div>
              <label className={`flex items-start gap-3 cursor-pointer p-3 rounded-lg border-2 transition-all ${flow.restrictionsAccepted ? 'border-green-400 bg-green-50' : 'border-amber-300 bg-white'}`}>
                <input
                  type="checkbox"
                  checked={flow.restrictionsAccepted}
                  onChange={(e) => updateFlow({ restrictionsAccepted: e.target.checked })}
                  className="mt-0.5 h-4 w-4 text-green-600"
                />
                <span className="text-sm text-gray-700">
                  Acepto las restricciones del tour y confirmo que cumplo con los requisitos.
                </span>
              </label>
            </div>
          </div>
        )}

        {/* Navigation */}
        <div className="flex gap-3 pt-4">
          <button
            onClick={handleBack}
            className="flex items-center gap-1.5 px-5 py-3 border border-gray-300 text-gray-700 font-medium rounded-xl hover:bg-gray-50 transition-colors"
          >
            <ChevronLeft className="w-5 h-5" />
            Atras
          </button>
          <button
            onClick={handleContinue}
            disabled={isHoldingSeats}
            className="flex-1 flex items-center justify-center gap-2 py-3.5 bg-primary-600 text-white font-semibold rounded-xl hover:bg-primary-700 disabled:bg-gray-300 transition-colors"
          >
            Continuar al Paso 4
            <ChevronRight className="w-5 h-5" />
          </button>
        </div>
      </div>
    </div>
  );
};

export default BookingFlowStep3;
