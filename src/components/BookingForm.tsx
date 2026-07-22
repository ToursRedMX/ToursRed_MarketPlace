import React, { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { Calendar, CreditCard, Users, AlertCircle, DollarSign, Settings, Minus, Plus, Crown, Sparkles, Wallet, Award, Ticket, X, Check, CheckCircle, Loader2, ShoppingBag, Info, Tag, RefreshCw, Clock, Car, Globe, AlertTriangle, MapPin, Bus, Shield, ShieldOff, ChevronRight } from 'lucide-react';
import { differenceInDays } from 'date-fns';
import SeatMapPicker from './seats/SeatMapPicker';
import PaymentProviderSelector, { PaymentProvider } from './PaymentProviderSelector';
import SlotCalendarPicker from './receptivo/SlotCalendarPicker';
import SlotTimePicker from './receptivo/SlotTimePicker';
import MinTravelersAlert from './receptivo/MinTravelersAlert';
import { TourSlot } from '../types';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';

interface TourOptionalService {
  id: string;
  name: string;
  description: string | null;
  price_per_person: number;
  max_capacity: number | null;
  is_refundable: boolean;
  is_active: boolean;
  display_order: number;
  available_capacity?: number | null;
}
import { Tour } from '../types';
import { useAuth } from '../context/AuthContext';
import { createBooking, formatDateForDB, supabase } from '../lib/supabase';
import { formatCurrency, formatCurrencyMXN } from '../utils/formatCurrency';
import { useMembershipPrices } from '../hooks/useMembershipPrices';
import { isCrawler } from '../utils/isCrawler';

interface BookingFormProps {
  tour: Tour;
}

interface TravelerCounts {
  adultos: number;
  ninos: number;
  infantes: number;
  adultos_mayores: number;
  mascotas: number;
}

const BookingForm: React.FC<BookingFormProps> = ({ tour }) => {
  const { user, isTraveler } = useAuth();
  const navigate = useNavigate();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [serviceChargePercentage, setServiceChargePercentage] = useState(5);
  const [agencyCommissionPercentage, setAgencyCommissionPercentage] = useState(0);
  const [optionalServiceCommissionPercentage, setOptionalServiceCommissionPercentage] = useState(15);
  const [availableSpots, setAvailableSpots] = useState<number | null>(null);
  const [isLoadingAvailability, setIsLoadingAvailability] = useState(true);
  const [showTravelerSelector, setShowTravelerSelector] = useState(false);
  const [hasMembership, setHasMembership] = useState(false);
  const [isLoadingMembership, setIsLoadingMembership] = useState(true);
  const [addMembershipToBooking, setAddMembershipToBooking] = useState(false);
  const [selectedMembershipPlan, setSelectedMembershipPlan] = useState<'monthly' | 'annual'>('monthly');
  const [paymentProvider, setPaymentProvider] = useState<PaymentProvider>('stripe');
  const [walletBalance, setWalletBalance] = useState(0);
  const [isLoadingWallet, setIsLoadingWallet] = useState(true);
  const [useToursRedCash, setUseToursRedCash] = useState(false);
  const [pointsBalance, setPointsBalance] = useState(0);
  const [isLoadingPoints, setIsLoadingPoints] = useState(true);
  const [useToursRedPoints, setUseToursRedPoints] = useState(false);
  const [pointsToUse, setPointsToUse] = useState(0);
  const [pointsWalletActive, setPointsWalletActive] = useState(false);
  const [noShowCount, setNoShowCount] = useState(0);
  const [isLoadingNoShowCount, setIsLoadingNoShowCount] = useState(true);
  const [isHighRisk, setIsHighRisk] = useState(false);
  const [remainingExemption, setRemainingExemption] = useState(500);
  const [isLoadingExemption, setIsLoadingExemption] = useState(true);

  // Travel insurance
  const [isForeignTraveler, setIsForeignTraveler] = useState(false);
  const isInsuranceApplicable = !['experience', 'transport', 'ticket'].includes((tour as any).activity_type as string) && !isForeignTraveler && !(tour as any).includes_insurance;
  const [insurancePricePerDayPerTraveler, setInsurancePricePerDayPerTraveler] = useState(79);
  const [includeInsurance, setIncludeInsurance] = useState(false);
  const [showInsuranceWarning, setShowInsuranceWarning] = useState(false);
  const [showInsuranceCoverage, setShowInsuranceCoverage] = useState(false);
  const [optionalServices, setOptionalServices] = useState<TourOptionalService[]>([]);
  const [optionalServiceQuantities, setOptionalServiceQuantities] = useState<Record<string, number>>({});

  const [activePromotion, setActivePromotion] = useState<{
    id: string;
    promotion_type: string;
    min_travelers: number;
    group_size: number;
    pay_count: number;
    fixed_group_price: number | null;
    group_discount_percentage: number | null;
    valid_until: string;
    max_uses: number | null;
    times_used: number;
  } | null>(null);
  const [isLoadingOptionalServices, setIsLoadingOptionalServices] = useState(true);

  const isReceptivo = tour.tour_type === 'receptivo';
  const isPrivateTransfer = isReceptivo && (tour as any).activity_type === 'transport' && (tour as any).receptivo_modality === 'privado';
  const [selectedSlotDate, setSelectedSlotDate] = useState<Date | null>(null);
  const [selectedSlot, setSelectedSlot] = useState<TourSlot | null>(null);
  const [selectedSeats, setSelectedSeats] = useState<number[]>([]);
  // Seat map only applies to shared transfers and non-private tours
  const hasSeatMap = !!(tour as any).vehicle_map_type && !isPrivateTransfer;

  const [pickupType, setPickupType] = useState<'meeting_point' | 'pickup'>('meeting_point');
  const [pickupHotelAddress, setPickupHotelAddress] = useState('');
  const [selectedPickupZone, setSelectedPickupZone] = useState<string>('free');
  const [selectedLanguage, setSelectedLanguage] = useState<string>('');
  const [restrictionsAccepted, setRestrictionsAccepted] = useState(false);
  const [customTransferTime, setCustomTransferTime] = useState('');

  const isTransferCustomTime = isReceptivo && (tour as any).transfer_custom_time === true;
  const hasRestrictions = isReceptivo && (tour.restriction_pregnant || tour.restriction_disability || tour.restriction_physical);

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const isEnPreventa = !!(
    tour.preventa_activa &&
    tour.preventa_inicio &&
    tour.preventa_fin &&
    new Date(tour.preventa_inicio + 'T00:00:00') <= today &&
    new Date(tour.preventa_fin + 'T23:59:59') >= today
  );

  const preventaPrecioBase = (() => {
    if (!isEnPreventa || !tour.preventa_precio_especial || !tour.preventa_descuento_valor) return tour.price;
    if (tour.preventa_tipo_descuento === 'porcentaje') {
      return tour.price * (1 - tour.preventa_descuento_valor / 100);
    }
    return Math.max(0, tour.price - tour.preventa_descuento_valor);
  })();

  const precioEfectivo = isEnPreventa && hasMembership ? preventaPrecioBase : tour.price;
  const pickupZones: any[] = Array.isArray(tour.pickup_zones) ? tour.pickup_zones : [];
  const tourLanguages: any[] = Array.isArray(tour.tour_languages) ? tour.tour_languages : [];

  const selectedLanguageData = tourLanguages.find((l: any) => l.language === selectedLanguage);
  const selectedZoneData = selectedPickupZone !== 'free' ? pickupZones.find((z: any) => z.name === selectedPickupZone) : null;

  const [discountCodeInput, setDiscountCodeInput] = useState('');
  const [isValidatingCode, setIsValidatingCode] = useState(false);
  const [discountCodeError, setDiscountCodeError] = useState('');
  const [appliedDiscount, setAppliedDiscount] = useState<{
    code_id: string;
    code: string;
    discount_type: string;
    discount_value: number;
    discount_applies_to: 'total_price' | 'payment_amount';
    max_discount_amount: number | null;
    applicable_to: 'tours' | 'service_fees';
  } | null>(null);

  const [insuranceDiscountInput, setInsuranceDiscountInput] = useState('');
  const [isValidatingInsuranceCode, setIsValidatingInsuranceCode] = useState(false);
  const [insuranceDiscountError, setInsuranceDiscountError] = useState('');
  const [appliedInsuranceDiscount, setAppliedInsuranceDiscount] = useState<{
    code_id: string;
    code: string;
    discount_type: 'insurance_percentage' | 'insurance_fixed' | 'insurance_free';
    discount_value: number;
    max_discount_amount: number | null;
  } | null>(null);

  const [travelerCounts, setTravelerCounts] = useState<TravelerCounts>({
    adultos: 1,
    ninos: 0,
    infantes: 0,
    adultos_mayores: 0,
    mascotas: 0,
  });

  const { prices: membershipPrices, loading: loadingPrices } = useMembershipPrices();

  React.useEffect(() => {
    const fetchCommissionRates = async () => {
      try {
        // Leer settings de plataforma
        const { data: platformData } = await supabase
          .from('platform_settings')
          .select('service_charge_percentage, agency_commission_percentage, optional_service_commission_percentage, travel_insurance_price_per_day_per_traveler')
          .maybeSingle();

        if (platformData) {
          setServiceChargePercentage(platformData.service_charge_percentage);
          if (platformData.travel_insurance_price_per_day_per_traveler != null) {
            setInsurancePricePerDayPerTraveler(platformData.travel_insurance_price_per_day_per_traveler);
          }
          // Comenzar con el default de plataforma
          let effectiveCommission = platformData.agency_commission_percentage;

          // Si la agencia tiene tasa propia, usarla
          if (tour.agencies?.commission_rate != null) {
            effectiveCommission = tour.agencies.commission_rate * 100;
          }

          // Si el tour tiene override activo (no expirado), tiene la máxima prioridad
          if (tour.commission_rate_override != null) {
            const expired = tour.commission_override_expires_at
              ? new Date(tour.commission_override_expires_at) <= new Date()
              : false;
            if (!expired) {
              effectiveCommission = tour.commission_rate_override * 100;
            }
          }

          setAgencyCommissionPercentage(effectiveCommission);
          setOptionalServiceCommissionPercentage(platformData.optional_service_commission_percentage ?? 15);
        }
      } catch (err) {
        console.error('Error loading commission rates:', err);
      }
    };

    fetchCommissionRates();
  }, [tour.id, tour.agencies?.commission_rate, tour.commission_rate_override, tour.commission_override_expires_at]);

  React.useEffect(() => {
    const checkMembership = async () => {
      if (!user || !isTraveler) {
        setIsLoadingMembership(false);
        return;
      }

      try {
        const { data, error } = await supabase
          .from('memberships')
          .select('status, current_period_end')
          .eq('user_id', user.id)
          .in('status', ['active', 'cancelled'])
          .maybeSingle();

        if (error) {
          console.error('Error checking membership:', error);
          setHasMembership(false);
        } else {
          const isActive = !!data && (
            data.status === 'active' ||
            (data.status === 'cancelled' && data.current_period_end && new Date(data.current_period_end) > new Date())
          );
          setHasMembership(isActive);
          console.log('✅ Estado de membresía:', isActive ? 'ACTIVA' : 'NO ACTIVA', data?.status, data?.current_period_end);
        }
      } catch (err) {
        console.error('Error loading membership:', err);
        setHasMembership(false);
      } finally {
        setIsLoadingMembership(false);
      }
    };

    checkMembership();
  }, [user, isTraveler]);

  React.useEffect(() => {
    const loadWalletBalance = async () => {
      if (!user || !isTraveler) {
        setIsLoadingWallet(false);
        return;
      }

      try {
        const { data, error } = await supabase
          .from('toursred_cash_wallets')
          .select('balance')
          .eq('user_id', user.id)
          .eq('is_active', true)
          .maybeSingle();

        if (error) {
          console.error('Error loading wallet:', error);
          setWalletBalance(0);
        } else {
          setWalletBalance(data?.balance || 0);
          console.log('✅ Saldo ToursRed Cash:', data?.balance || 0);
        }
      } catch (err) {
        console.error('Error loading wallet:', err);
        setWalletBalance(0);
      } finally {
        setIsLoadingWallet(false);
      }
    };

    loadWalletBalance();
  }, [user, isTraveler]);

  React.useEffect(() => {
    const loadPointsBalance = async () => {
      if (!user || !isTraveler) {
        setIsLoadingPoints(false);
        return;
      }

      try {
        const { data, error } = await supabase
          .from('toursred_points_wallets')
          .select('balance, is_active')
          .eq('user_id', user.id)
          .maybeSingle();

        if (error) {
          console.error('Error loading points wallet:', error);
          setPointsBalance(0);
          setPointsWalletActive(false);
        } else {
          setPointsBalance(data?.balance || 0);
          const { data: memData } = await supabase
            .from('memberships')
            .select('status, current_period_end')
            .eq('user_id', user.id)
            .in('status', ['active', 'cancelled'])
            .maybeSingle();
          const membershipStillActive = !!memData && (
            memData.status === 'active' ||
            (memData.status === 'cancelled' && memData.current_period_end && new Date(memData.current_period_end) > new Date())
          );
          setPointsWalletActive((data?.is_active || false) || membershipStillActive);
          console.log('✅ Saldo ToursRed Points:', data?.balance || 0, '- Wallet activo:', (data?.is_active || false) || membershipStillActive);
        }
      } catch (err) {
        console.error('Error loading points wallet:', err);
        setPointsBalance(0);
        setPointsWalletActive(false);
      } finally {
        setIsLoadingPoints(false);
      }
    };

    loadPointsBalance();
  }, [user, isTraveler]);

  React.useEffect(() => {
    const checkNoShowHistory = async () => {
      if (!user || !isTraveler) {
        setIsLoadingNoShowCount(false);
        return;
      }

      try {
        const { data, error } = await supabase
          .from('users')
          .select('no_show_count, is_foreign_traveler')
          .eq('id', user.id)
          .maybeSingle();

        if (error) {
          console.error('Error checking no show count:', error);
          setNoShowCount(0);
          setIsHighRisk(false);
        } else {
          const count = data?.no_show_count || 0;
          const isForeign = data?.is_foreign_traveler ?? false;
          setIsForeignTraveler(isForeign);
          setNoShowCount(count);
          setIsHighRisk(count > 3);
          const activityType = (tour as any).activity_type as string;
          const tourIncludesInsurance = !!(tour as any).includes_insurance;
          const insuranceOk = !['experience', 'transport', 'ticket'].includes(activityType) && !isForeign && !tourIncludesInsurance;
          setIncludeInsurance(insuranceOk);
          if (count > 3) {
            console.log('⚠️ VIAJERO DE ALTO RIESGO: Tiene', count, 'no shows. Se cobrará el 100% del tour.');
          }
        }
      } catch (err) {
        console.error('Error loading no show count:', err);
        setNoShowCount(0);
        setIsHighRisk(false);
      } finally {
        setIsLoadingNoShowCount(false);
      }
    };

    checkNoShowHistory();
  }, [user, isTraveler]);

  React.useEffect(() => {
    const loadRemainingExemption = async () => {
      if (!user || !isTraveler || !hasMembership) {
        setRemainingExemption(0);
        setIsLoadingExemption(false);
        return;
      }

      try {
        const { data, error } = await supabase.rpc('get_remaining_service_fee_exemption', {
          p_user_id: user.id
        });

        if (error) {
          console.error('Error loading remaining exemption:', error);
          setRemainingExemption(0);
        } else {
          setRemainingExemption(data || 0);
          console.log('✅ Límite de exención restante:', data || 0);
        }
      } catch (err) {
        console.error('Error loading remaining exemption:', err);
        setRemainingExemption(0);
      } finally {
        setIsLoadingExemption(false);
      }
    };

    loadRemainingExemption();
  }, [user, isTraveler, hasMembership]);

  React.useEffect(() => {
    const loadOptionalServices = async () => {
      try {
        setIsLoadingOptionalServices(true);
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

        const serviceIdsWithCap = data.filter(s => s.max_capacity !== null).map(s => s.id);

        let capacityMap: Record<string, number | null> = {};
        if (serviceIdsWithCap.length > 0) {
          const { data: capData } = await supabase
            .rpc('get_optional_services_capacity', { p_service_ids: serviceIdsWithCap });
          if (capData) {
            capData.forEach((row: any) => {
              capacityMap[row.service_id] = row.available_capacity;
            });
          }
        }

        const servicesWithCapacity = data.map(svc => ({
          ...svc,
          available_capacity: svc.max_capacity === null ? null : (capacityMap[svc.id] ?? null),
        }));

        setOptionalServices(servicesWithCapacity);
      } catch (err) {
        console.error('Error loading optional services:', err);
        setOptionalServices([]);
      } finally {
        setIsLoadingOptionalServices(false);
      }
    };

    loadOptionalServices();
  }, [tour.id]);

  React.useEffect(() => {
    const loadActivePromotion = async () => {
      try {
        const { data, error } = await supabase.rpc('get_active_promotion_for_tour', { p_tour_id: tour.id });
        if (!error && data && data.length > 0) {
          setActivePromotion(data[0]);
        } else {
          setActivePromotion(null);
        }
      } catch {
        setActivePromotion(null);
      }
    };
    loadActivePromotion();
  }, [tour.id]);

  React.useEffect(() => {
    const fetchAvailability = async () => {
      if (isReceptivo) {
        if (selectedSlot) {
          const available = Math.max(0, selectedSlot.capacity - selectedSlot.booked_count);
          setAvailableSpots(available);
        } else {
          setAvailableSpots(null);
        }
        setIsLoadingAvailability(false);
        return;
      }

      try {
        setIsLoadingAvailability(true);

        const { data, error } = await supabase
          .rpc('get_tour_availability', { p_tour_id: tour.id });

        if (error) {
          console.error('Error fetching availability from RPC:', error);
          setAvailableSpots(tour.max_travelers || 10);
          return;
        }

        if (data && data.length > 0) {
          const availability = data[0];
          setAvailableSpots(availability.available_spots);
        }

      } catch (err) {
        console.error('Error loading availability:', err);
        setAvailableSpots(tour.max_travelers || 10);
      } finally {
        setIsLoadingAvailability(false);
      }
    };

    fetchAvailability();

    if (isCrawler()) return;

    const channel = supabase
      .channel(`tour_availability:${tour.id}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'bookings',
          filter: `tour_id=eq.${tour.id}`,
        },
        () => {
          fetchAvailability();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [tour.id, isReceptivo, selectedSlot]);

  const formatDate = (dateString: string) => {
    try {
      const [year, month, day] = dateString.split('-').map(Number);
      const date = new Date(Date.UTC(year, month - 1, day));
      const monthName = date.toLocaleString('en-US', { month: 'short', timeZone: 'UTC' });
      const dayNum = date.toLocaleString('en-US', { day: 'numeric', timeZone: 'UTC' });
      const yearNum = date.toLocaleString('en-US', { year: 'numeric', timeZone: 'UTC' });
      return `${monthName} ${dayNum}, ${yearNum}`;
    } catch (error) {
      console.error('Error formatting date:', dateString, error);
      return dateString;
    }
  };

  const isBookingDeadlinePassed = () => {
    if (isReceptivo) return false;
    if (!tour.booking_deadline) return false;

    try {
      const deadline = new Date(tour.booking_deadline);
      const today = new Date();
      today.setHours(0, 0, 0, 0);

      return deadline < today;
    } catch (error) {
      console.error('Error checking booking deadline:', error);
      return false;
    }
  };

  const bookingDeadlinePassed = isBookingDeadlinePassed();

  const handleApplyDiscountCode = async () => {
    if (!discountCodeInput.trim() || !user) return;

    setIsValidatingCode(true);
    setDiscountCodeError('');

    try {
      const { data, error } = await supabase.rpc('validate_tour_discount_code', {
        p_code: discountCodeInput.trim(),
        p_user_id: user.id,
        p_tour_id: tour.id,
      });

      if (error) throw error;

      if (data && data.valid) {
        setAppliedDiscount({
          code_id: data.code_id,
          code: data.code,
          discount_type: data.discount_type,
          discount_value: data.discount_value,
          discount_applies_to: data.discount_applies_to || 'total_price',
          max_discount_amount: data.max_discount_amount || null,
          applicable_to: data.applicable_to || 'tours',
        });
        setDiscountCodeError('');
        setDiscountCodeInput('');
      } else {
        setDiscountCodeError(data?.error || 'Codigo invalido');
      }
    } catch (err: any) {
      setDiscountCodeError(err.message || 'Error al validar el codigo');
    } finally {
      setIsValidatingCode(false);
    }
  };

  const handleRemoveDiscount = () => {
    setAppliedDiscount(null);
    setDiscountCodeError('');
  };

  const handleApplyInsuranceDiscountCode = async () => {
    if (!insuranceDiscountInput.trim() || !user) return;
    setIsValidatingInsuranceCode(true);
    setInsuranceDiscountError('');
    try {
      const { data, error } = await supabase.rpc('validate_insurance_discount_code', {
        p_code: insuranceDiscountInput.trim(),
        p_user_id: user.id,
      });
      if (error) throw error;
      if (data && data.valid) {
        setAppliedInsuranceDiscount({
          code_id: data.code_id,
          code: data.code,
          discount_type: data.discount_type,
          discount_value: data.discount_value,
          max_discount_amount: data.max_discount_amount || null,
        });
        setInsuranceDiscountError('');
        setInsuranceDiscountInput('');
      } else {
        setInsuranceDiscountError(data?.error || 'Codigo invalido');
      }
    } catch (err: any) {
      setInsuranceDiscountError(err.message || 'Error al validar el codigo');
    } finally {
      setIsValidatingInsuranceCode(false);
    }
  };

  const handleRemoveInsuranceDiscount = () => {
    setAppliedInsuranceDiscount(null);
    setInsuranceDiscountError('');
  };
  const totalTravelers = travelerCounts.adultos + travelerCounts.ninos + travelerCounts.infantes + travelerCounts.adultos_mayores;

  // Calcular días del tour para el seguro de viaje
  const tourDays = (() => {
    if (isReceptivo) {
      if (selectedSlot?.end_date) {
        const d = differenceInDays(new Date(selectedSlot.end_date), new Date(selectedSlot.slot_date));
        return Math.max(1, d + 1);
      }
      return Math.max(1, (tour as any).slot_duration_days || 1);
    }
    if (tour.start_date && tour.end_date) {
      const d = differenceInDays(new Date(tour.end_date), new Date(tour.start_date));
      return Math.max(1, d + 1);
    }
    return 1;
  })();
  const insuranceCost = includeInsurance
    ? Math.round(insurancePricePerDayPerTraveler * tourDays * Math.max(1, totalTravelers) * 100) / 100
    : 0;

  const insuranceDiscountAmount = (() => {
    if (!includeInsurance || !appliedInsuranceDiscount || insuranceCost <= 0) return 0;
    if (appliedInsuranceDiscount.discount_type === 'insurance_free') return insuranceCost;
    let d = 0;
    if (appliedInsuranceDiscount.discount_type === 'insurance_percentage') {
      d = insuranceCost * (appliedInsuranceDiscount.discount_value / 100);
    } else {
      d = Math.min(appliedInsuranceDiscount.discount_value, insuranceCost);
    }
    if (appliedInsuranceDiscount.max_discount_amount && d > appliedInsuranceDiscount.max_discount_amount) {
      d = appliedInsuranceDiscount.max_discount_amount;
    }
    return Math.round(d * 100) / 100;
  })();

  const effectiveInsuranceCost = Math.max(0, insuranceCost - insuranceDiscountAmount);

  const preventaRatio = isEnPreventa && hasMembership && tour.preventa_precio_especial && tour.preventa_descuento_valor
    ? (tour.preventa_tipo_descuento === 'porcentaje'
        ? (1 - tour.preventa_descuento_valor / 100)
        : (tour.price > 0 ? Math.max(0, tour.price - tour.preventa_descuento_valor) / tour.price : 1))
    : 1;

  // Función para obtener precio por categoría o usar precio general
  const getPrecioPorCategoria = (categoria: 'adulto' | 'nino' | 'infante' | 'adulto_mayor' | 'mascota'): number => {
    const base = (() => {
      switch (categoria) {
        case 'adulto': return tour.precio_adulto || tour.price;
        case 'nino': return tour.precio_nino || tour.price;
        case 'infante': return tour.precio_infante || tour.price;
        case 'adulto_mayor': return tour.precio_adulto_mayor || tour.price;
        case 'mascota': return tour.precio_mascota || 0;
        default: return tour.price;
      }
    })();
    return categoria === 'mascota' ? base : base * preventaRatio;
  };

  // Cálculos de precios por categoría
  const precioAdultos = getPrecioPorCategoria('adulto') * travelerCounts.adultos;
  const precioNinos = getPrecioPorCategoria('nino') * travelerCounts.ninos;
  const precioInfantes = getPrecioPorCategoria('infante') * travelerCounts.infantes;
  const precioAdultosMayores = getPrecioPorCategoria('adulto_mayor') * travelerCounts.adultos_mayores;
  const precioMascotas = getPrecioPorCategoria('mascota') * travelerCounts.mascotas;

  // Subtotal de servicios opcionales seleccionados
  const optionalServicesSubtotal = optionalServices.reduce((sum, svc) => {
    const qty = optionalServiceQuantities[svc.id] || 0;
    return sum + qty * svc.price_per_person;
  }, 0);

  const pickupExtraCost = (() => {
    if (!isReceptivo || pickupType !== 'pickup' || !selectedZoneData) return 0;
    if (selectedZoneData.cost_type === 'por_persona') return selectedZoneData.extra_cost * totalTravelers;
    return selectedZoneData.extra_cost;
  })();

  const languageExtraCost = (() => {
    if (!isReceptivo || !selectedLanguageData || !selectedLanguageData.extra_cost) return 0;
    if (selectedLanguageData.cost_type === 'por_persona') return selectedLanguageData.extra_cost * totalTravelers;
    return selectedLanguageData.extra_cost;
  })();

  const receptivoExtrasSubtotal = pickupExtraCost + languageExtraCost;

  // Precio total del tour (sin descuento, sin opcionales)
  // Para traslados privados con precio por vehículo, el precio es fijo sin importar viajeros
  const grossTourPrice = (isPrivateTransfer && (tour as any).transfer_pricing_mode === 'per_vehicle')
    ? (tour.precio_adulto || tour.price) * preventaRatio
    : precioAdultos + precioNinos + precioInfantes + precioAdultosMayores + precioMascotas;

  // Calcular descuento por promoción grupal
  const calculatePromoDiscount = (): { discount: number; isActive: boolean; label: string; nearMissMessage: string | null; availabilityNote: string | null } => {
    if (!activePromotion) return { discount: 0, isActive: false, label: '', nearMissMessage: null, availabilityNote: null };

    const { promotion_type, min_travelers, group_size, pay_count, fixed_group_price, group_discount_percentage, max_uses, times_used } = activePromotion;
    const totalHuman = totalTravelers; // no mascotas

    if (promotion_type === 'nxprecio') {
      if (totalHuman < min_travelers) {
        const needed = min_travelers - totalHuman;
        if (needed <= 2) {
          return { discount: 0, isActive: false, label: '', nearMissMessage: `Agrega ${needed} viajero${needed > 1 ? 's' : ''} más para activar el precio especial grupal.`, availabilityNote: null };
        }
        return { discount: 0, isActive: false, label: '', nearMissMessage: null, availabilityNote: null };
      }

      if (fixed_group_price === null) return { discount: 0, isActive: false, label: '', nearMissMessage: null, availabilityNote: null };

      const totalGroups = Math.floor(totalHuman / min_travelers);
      const remainingTravelers = totalHuman % min_travelers;

      const usosRestantes = max_uses !== null ? Math.max(0, max_uses - times_used) : Infinity;
      const gruposConPromo = Math.min(totalGroups, usosRestantes === Infinity ? totalGroups : usosRestantes);
      const gruposSinPromo = totalGroups - gruposConPromo;

      const pricePerPerson = getPrecioPorCategoria('adulto');
      const normalPricePerGroup = min_travelers * pricePerPerson;

      const discountPerGroup = Math.max(0, normalPricePerGroup - fixed_group_price);
      const totalDiscount = gruposConPromo * discountPerGroup;

      if (totalDiscount <= 0) return { discount: 0, isActive: false, label: '', nearMissMessage: null, availabilityNote: null };

      const usosUsadosEnEstaReserva = gruposConPromo;
      const usosDisponibles = max_uses !== null ? Math.max(0, max_uses - times_used - usosUsadosEnEstaReserva) : null;

      let label = `${min_travelers} x $${formatCurrency(fixed_group_price)} — ${gruposConPromo} grupo${gruposConPromo > 1 ? 's' : ''} con precio especial`;
      if (gruposSinPromo > 0) {
        label += ` (${gruposSinPromo * min_travelers} viajero${gruposSinPromo * min_travelers > 1 ? 's' : ''} a precio normal)`;
      }
      if (remainingTravelers > 0) {
        label += ` + ${remainingTravelers} viajero${remainingTravelers > 1 ? 's' : ''} a precio normal`;
      }

      let availabilityNote: string | null = null;
      if (max_uses !== null) {
        availabilityNote = usosDisponibles !== null && usosDisponibles > 0
          ? `Sujeto a disponibilidad — quedan ${usosDisponibles} uso${usosDisponibles > 1 ? 's' : ''} tras esta reserva`
          : `Sujeto a disponibilidad — esta reserva agota los usos disponibles`;
      }

      return { discount: totalDiscount, isActive: true, label, nearMissMessage: null, availabilityNote };
    }

    if (promotion_type === 'grupo_precio_fijo') {
      if (totalHuman >= min_travelers && group_discount_percentage !== null && group_discount_percentage > 0) {
        const pct = group_discount_percentage / 100;
        const discountAdultos = getPrecioPorCategoria('adulto') * travelerCounts.adultos * pct;
        const discountNinos = getPrecioPorCategoria('nino') * travelerCounts.ninos * pct;
        const discountInfantes = getPrecioPorCategoria('infante') * travelerCounts.infantes * pct;
        const discountAdultosMayores = getPrecioPorCategoria('adulto_mayor') * travelerCounts.adultos_mayores * pct;
        const discount = Math.round((discountAdultos + discountNinos + discountInfantes + discountAdultosMayores) * 100) / 100;
        return {
          discount,
          isActive: discount > 0,
          label: `Precio Grupal ${group_discount_percentage}% desc. por persona (${min_travelers}+ viajeros)`,
          nearMissMessage: null,
          availabilityNote: null,
        };
      }
      const needed = min_travelers - totalHuman;
      if (needed > 0 && needed <= 3) {
        return { discount: 0, isActive: false, label: '', nearMissMessage: `Agrega ${needed} viajero${needed > 1 ? 's' : ''} más y activa el descuento grupal de ${group_discount_percentage}%.`, availabilityNote: null };
      }
      return { discount: 0, isActive: false, label: '', nearMissMessage: null, availabilityNote: null };
    }

    if (promotion_type === '2x1' || promotion_type === '3x2') {
      if (totalHuman < min_travelers) {
        const needed = min_travelers - totalHuman;
        if (needed <= 2) {
          return { discount: 0, isActive: false, label: '', nearMissMessage: `Agrega ${needed} viajero${needed > 1 ? 's' : ''} más y activa el ${promotion_type}.`, availabilityNote: null };
        }
        return { discount: 0, isActive: false, label: '', nearMissMessage: null, availabilityNote: null };
      }

      const pricePerAdulto = getPrecioPorCategoria('adulto');
      const freeGroups = Math.floor(totalHuman / group_size);
      const freePerGroup = group_size - pay_count;
      const freeCount = freeGroups * freePerGroup;
      const discount = freeCount * pricePerAdulto;

      return {
        discount,
        isActive: discount > 0,
        label: `Promoción ${promotion_type} — ${freeCount} viajero${freeCount > 1 ? 's' : ''} gratis`,
        nearMissMessage: null,
        availabilityNote: null,
      };
    }

    return { discount: 0, isActive: false, label: '', nearMissMessage: null, availabilityNote: null };
  };

  const promoResult = calculatePromoDiscount();
  const promoDiscountAmount = promoResult.discount;

  // Precio total del tour (sin descuento de código, sin opcionales, sin extras receptivos)
  // Los opcionales y extras se cobran al 100% como cubetas independientes
  const grossTotalPrice = grossTourPrice - promoDiscountAmount;

  // Total de extras (opcionales + pickup + idioma) — cobrados al 100%, fuera del total_price de la reserva
  const extrasTotal = optionalServicesSubtotal + receptivoExtrasSubtotal;

  // Service charge sobre los extras (5% sobre el subtotal de opcionales + pickup + idioma)
  // Se calcula aqui (no en handleSubmit) para que user_payment, cubetas de cash y UI lo reflejen
  const extrasServiceChargeTotal = Math.round(extrasTotal * (serviceChargePercentage / 100) * 100) / 100;
  const extrasTotalWithServiceCharge = extrasTotal + extrasServiceChargeTotal;

  // Si el usuario es de alto riesgo (más de 3 no shows), debe pagar el 100%
  const effectiveDepositPercentage = isHighRisk ? 100 : tour.deposit_percentage;

  // Calculate discount amount
  const calculateDiscountAmount = (baseAmount: number): number => {
    if (!appliedDiscount) return 0;
    let discount = 0;
    if (appliedDiscount.discount_type.includes('percentage')) {
      discount = baseAmount * (appliedDiscount.discount_value / 100);
    } else {
      discount = Math.min(appliedDiscount.discount_value, baseAmount);
    }
    if (appliedDiscount.max_discount_amount && discount > appliedDiscount.max_discount_amount) {
      discount = appliedDiscount.max_discount_amount;
    }
    return Math.round(discount * 100) / 100;
  };

  let totalPrice: number;
  let depositAmount: number;
  let agencyCommission: number;
  let discountAmount = 0;
  const isServiceFeeDiscount = appliedDiscount?.applicable_to === 'service_fees';

  if (appliedDiscount && !isServiceFeeDiscount && appliedDiscount.discount_applies_to === 'total_price') {
    discountAmount = calculateDiscountAmount(grossTotalPrice);
    totalPrice = grossTotalPrice - discountAmount;
    depositAmount = totalPrice * (effectiveDepositPercentage / 100);
    agencyCommission = totalPrice * (agencyCommissionPercentage / 100);
  } else {
    totalPrice = grossTotalPrice;
    depositAmount = totalPrice * (effectiveDepositPercentage / 100);
    agencyCommission = totalPrice * (agencyCommissionPercentage / 100);
  }

  // Plan de pagos: calcular el mínimo requerido al reservar
  const tourPaymentOption = (tour as any).payment_option || 'standard';
  const hasPaymentPlan = tourPaymentOption !== 'standard' && tourPaymentOption !== 'full_upfront';
  const [selectedPaymentMode, setSelectedPaymentMode] = React.useState<'full' | 'plan'>(
    tourPaymentOption === 'payment_plan' ? 'plan' : 'full'
  );
  const payPlanMode = (tour as any).payment_plan_mode || 'installments';
  const installmentDefs: any[] = (tour as any).installment_definitions || [];

  const paymentPlanMinimum = React.useMemo(() => {
    if (!hasPaymentPlan || selectedPaymentMode !== 'plan') return depositAmount;
    if (payPlanMode === 'free_form') return 0;
    const bookingDate = new Date();
    const departureDate = isReceptivo && selectedSlotDate ? selectedSlotDate : (tour.start_date ? new Date(tour.start_date) : null);
    let min = 0;
    for (const def of installmentDefs) {
      let dueDate: Date | null = null;
      if (def.days_after_booking !== undefined) {
        dueDate = new Date(bookingDate);
        dueDate.setDate(dueDate.getDate() + def.days_after_booking);
      } else if (def.days_before_departure !== undefined && departureDate) {
        dueDate = new Date(departureDate);
        dueDate.setDate(dueDate.getDate() - def.days_before_departure);
      }
      if (dueDate && dueDate <= bookingDate) {
        min += Math.round(totalPrice * (def.pct_of_total / 100) * 100) / 100;
      }
    }
    return min;
  }, [hasPaymentPlan, selectedPaymentMode, payPlanMode, installmentDefs, totalPrice, depositAmount, isReceptivo, selectedSlotDate, tour.start_date]);

  const effectiveDepositAmount =
    (tourPaymentOption === 'full_upfront' || (hasPaymentPlan && selectedPaymentMode === 'full'))
      ? totalPrice
      : (hasPaymentPlan && selectedPaymentMode === 'plan'
          ? (isHighRisk ? totalPrice : paymentPlanMinimum)
          : depositAmount);

  const paymentSchedule = React.useMemo(() => {
    if (!hasPaymentPlan || payPlanMode !== 'installments' || installmentDefs.length === 0) return [];
    const bookingDate = new Date();
    const departureDate = isReceptivo && selectedSlotDate ? selectedSlotDate : (tour.start_date ? new Date(tour.start_date) : null);
    return installmentDefs.map((def: any, idx: number) => {
      const amount = Math.round(totalPrice * (def.pct_of_total / 100) * 100) / 100;
      let dueDate: Date | null = null;
      if (def.specific_date) {
        dueDate = new Date(def.specific_date + 'T12:00:00');
      } else if (def.days_after_booking !== undefined) {
        dueDate = new Date(bookingDate);
        dueDate.setDate(dueDate.getDate() + (def.days_after_booking || 0));
      } else if (def.days_before_departure !== undefined && departureDate) {
        dueDate = new Date(departureDate);
        dueDate.setDate(dueDate.getDate() - def.days_before_departure);
      }
      const isToday = dueDate ? dueDate <= bookingDate : false;
      return { idx, label: def.label || `Pago ${idx + 1}`, amount, dueDate, isToday, pct: def.pct_of_total };
    });
  }, [hasPaymentPlan, payPlanMode, installmentDefs, totalPrice, isReceptivo, selectedSlotDate, tour.start_date]);


  const membershipMonthlyPrice = membershipPrices?.monthlyPrice || 49;
  const membershipAnnualPrice = membershipPrices?.annualPrice || 490;

  const fullServiceCharge = totalPrice * (serviceChargePercentage / 100);
  const shouldWaiveServiceCharge = hasMembership || addMembershipToBooking;

  let serviceChargeDiscountAmount = 0;
  if (isServiceFeeDiscount && appliedDiscount) {
    if (appliedDiscount.discount_type === 'service_fee_full') {
      serviceChargeDiscountAmount = fullServiceCharge;
    } else if (appliedDiscount.discount_type === 'service_fee_percentage') {
      serviceChargeDiscountAmount = fullServiceCharge * (appliedDiscount.discount_value / 100);
    } else if (appliedDiscount.discount_type === 'service_fee_fixed') {
      serviceChargeDiscountAmount = Math.min(appliedDiscount.discount_value, fullServiceCharge);
    }
    if (appliedDiscount.max_discount_amount && serviceChargeDiscountAmount > appliedDiscount.max_discount_amount) {
      serviceChargeDiscountAmount = appliedDiscount.max_discount_amount;
    }
    serviceChargeDiscountAmount = Math.round(serviceChargeDiscountAmount * 100) / 100;
  }

  const serviceChargeAfterCodeDiscount = fullServiceCharge - serviceChargeDiscountAmount;

  let serviceCharge = 0;
  let exemptionUsed = 0;
  let hasReachedExemptionLimit = false;

  if (shouldWaiveServiceCharge && hasMembership) {
    exemptionUsed = Math.min(serviceChargeAfterCodeDiscount, remainingExemption);
    serviceCharge = serviceChargeAfterCodeDiscount - exemptionUsed;
    hasReachedExemptionLimit = remainingExemption < serviceChargeAfterCodeDiscount;
  } else if (addMembershipToBooking) {
    serviceCharge = 0;
    exemptionUsed = serviceChargeAfterCodeDiscount;
  } else {
    serviceCharge = serviceChargeAfterCodeDiscount;
  }

  const platformRevenue = agencyCommission + serviceCharge;

  const membershipCost = addMembershipToBooking
    ? (selectedMembershipPlan === 'monthly' ? membershipMonthlyPrice : membershipAnnualPrice)
    : 0;

  let userPayment = effectiveDepositAmount + serviceCharge;

  if (appliedDiscount && !isServiceFeeDiscount && appliedDiscount.discount_applies_to === 'payment_amount') {
    discountAmount = calculateDiscountAmount(userPayment);
    userPayment = userPayment - discountAmount;
  }

  const maxPointsAllowed = Math.floor(userPayment * 50);

  const pointsApplied = useToursRedPoints
    ? Math.min(pointsToUse, pointsBalance, maxPointsAllowed)
    : 0;

  const pointsDiscountAmount = pointsApplied / 100;

  const amountAfterPoints = userPayment - pointsDiscountAmount;

  // ToursRed Cash: bucket allocation — tour first, then extras, then insurance
  // 1. Cash aplicado al depósito del tour (igual que antes)
  // 2. Si sobra, se aplica a los extras (opcionales, pickup, idioma)
  // 3. Si sobra, se aplica al seguro
  // Lo que no alcance se cobra con el otro método de pago
  const tourBucketAfterPoints = amountAfterPoints;
  const cashForTour = useToursRedCash ? Math.min(walletBalance, tourBucketAfterPoints) : 0;
  const walletRemainingAfterTour = useToursRedCash ? Math.max(0, walletBalance - cashForTour) : 0;

  const cashForExtras = useToursRedCash ? Math.min(walletRemainingAfterTour, extrasTotalWithServiceCharge) : 0;
  const walletRemainingAfterExtras = useToursRedCash ? Math.max(0, walletRemainingAfterTour - cashForExtras) : 0;

  const cashForInsurance = useToursRedCash ? Math.min(walletRemainingAfterExtras, effectiveInsuranceCost) : 0;

  const toursRedCashApplied = cashForTour + cashForExtras + cashForInsurance;

  const tourAfterCash = tourBucketAfterPoints - cashForTour;
  const extrasAfterCash = extrasTotalWithServiceCharge - cashForExtras;
  const insuranceAfterCash = effectiveInsuranceCost - cashForInsurance;

  const rawAmountAfterToursRedCash = tourAfterCash + extrasAfterCash + insuranceAfterCash;
  // Si el residuo es menor a $10 (mínimo de los procesadores de pago), absorberlo como $0
  const amountAfterToursRedCash = rawAmountAfterToursRedCash < 10 && rawAmountAfterToursRedCash > 0 ? 0 : rawAmountAfterToursRedCash;

  const totalToPayNow = amountAfterToursRedCash + membershipCost;

  const agencyReceives = depositAmount - agencyCommission;

  const handleOptionalServiceChange = (serviceId: string, delta: number, service: TourOptionalService) => {
    const totalPeople = totalTravelers + travelerCounts.mascotas;
    const maxByPeople = totalTravelers > 0 ? totalTravelers : 1;
    const maxByCapacity = service.available_capacity !== null && service.available_capacity !== undefined
      ? service.available_capacity
      : Infinity;
    const maxAllowed = Math.min(maxByPeople, maxByCapacity);

    setOptionalServiceQuantities(prev => {
      const current = prev[serviceId] || 0;
      const newVal = Math.max(0, Math.min(maxAllowed, current + delta));
      return { ...prev, [serviceId]: newVal };
    });
  };

  const handleCountChange = (categoria: keyof TravelerCounts, delta: number) => {
    setTravelerCounts(prev => {
      const newValue = Math.max(0, prev[categoria] + delta);

      // Validar disponibilidad (sin contar mascotas)
      if (categoria !== 'mascotas') {
        const newTotal = Object.entries({ ...prev, [categoria]: newValue })
          .filter(([key]) => key !== 'mascotas')
          .reduce((sum, [, value]) => sum + value, 0);

        if (availableSpots !== null && newTotal > availableSpots) {
          return prev;
        }
      }

      return { ...prev, [categoria]: newValue };
    });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!user) {
      navigate('/login');
      return;
    }

    if (!isTraveler) {
      setError('Solo los viajeros pueden reservar tours.');
      return;
    }

    if (isReceptivo && !selectedSlot && !isTransferCustomTime) {
      setError('Debes seleccionar una fecha y horario para el tour receptivo.');
      return;
    }

    if (isReceptivo && isTransferCustomTime && !selectedSlotDate) {
      setError('Debes seleccionar la fecha en que necesitas el traslado.');
      return;
    }

    if (isTransferCustomTime && !customTransferTime) {
      setError('Debes indicar a qué hora necesitas el traslado.');
      return;
    }

    if (hasRestrictions && !restrictionsAccepted) {
      setError('Debes aceptar las restricciones del tour para continuar.');
      return;
    }

    if (isReceptivo && tour.pickup_available && pickupType === 'pickup' && !pickupHotelAddress.trim()) {
      setError('Debes ingresar tu dirección o nombre de hotel para la recogida.');
      return;
    }

    if (totalTravelers === 0) {
      setError('Debes seleccionar al menos un viajero.');
      return;
    }

    if (availableSpots !== null && totalTravelers > availableSpots) {
      setError(`Solo hay ${availableSpots} lugar${availableSpots !== 1 ? 'es' : ''} disponible${availableSpots !== 1 ? 's' : ''} para este tour.`);
      return;
    }

    if (isPrivateTransfer && (tour as any).private_vehicle_capacity && totalTravelers > (tour as any).private_vehicle_capacity) {
      setError(`Este vehículo tiene capacidad máxima de ${(tour as any).private_vehicle_capacity} pasajero${(tour as any).private_vehicle_capacity !== 1 ? 's' : ''}.`);
      return;
    }

    if (hasSeatMap && selectedSeats.length < totalTravelers) {
      setError(`Debes seleccionar ${totalTravelers} asiento${totalTravelers !== 1 ? 's' : ''} en el mapa del vehiculo antes de continuar.`);
      return;
    }

    try {
      setIsSubmitting(true);
      setError('');

      const initialStatus = 'draft';
      const initialApprovalStatus = tour.booking_approval_type === 'manual' ? 'pending' : 'approved';
      const initialPaymentStatus = 'pending';

      const bookingData: Record<string, any> = {
        user_id: user.id,
        tour_id: tour.id,
        agency_id: tour.agency_id,
        travelers_count: totalTravelers,
        total_price: totalPrice,
        deposit_amount: effectiveDepositAmount,
        commission_amount: agencyCommission,
        service_charge: serviceCharge,
        user_payment: userPayment + extrasTotalWithServiceCharge + effectiveInsuranceCost + membershipCost,
        platform_revenue: platformRevenue,
        booking_date: isReceptivo && selectedSlot ? selectedSlot.slot_date : (isTransferCustomTime && selectedSlotDate ? selectedSlotDate.toISOString().split('T')[0] : tour.start_date),
        slot_id: isReceptivo && selectedSlot ? selectedSlot.id : null,
        selected_date: isReceptivo && selectedSlot ? selectedSlot.slot_date : (isTransferCustomTime && selectedSlotDate ? selectedSlotDate.toISOString().split('T')[0] : null),
        selected_time: isTransferCustomTime ? (customTransferTime || null) : (isReceptivo && selectedSlot ? selectedSlot.departure_time : null),
        status: initialStatus,
        payment_status: initialPaymentStatus,
        approval_status: initialApprovalStatus,
        count_adultos: travelerCounts.adultos,
        count_ninos: travelerCounts.ninos,
        count_infantes: travelerCounts.infantes,
        count_adultos_mayores: travelerCounts.adultos_mayores,
        count_mascotas: travelerCounts.mascotas,
        points_used: pointsApplied,
        toursred_cash_used: toursRedCashApplied,
        discount_code_id: appliedDiscount?.code_id || null,
        discount_amount: discountAmount,
        service_charge_discount: serviceChargeDiscountAmount,
        payment_provider: addMembershipToBooking ? 'stripe' : paymentProvider,
        promotion_id: promoResult.isActive && activePromotion ? activePromotion.id : null,
        promo_discount_amount: promoResult.isActive ? promoDiscountAmount : 0,
        pickup_type: isReceptivo && tour.pickup_available ? pickupType : null,
        pickup_zone_name: isReceptivo && pickupType === 'pickup' && selectedZoneData ? selectedZoneData.name : (isReceptivo && pickupType === 'pickup' ? (pickupHotelAddress || null) : null),
        pickup_zone_extra_cost: 0,
        pickup_cost_type: null,
        selected_language: isReceptivo && selectedLanguage ? selectedLanguage : null,
        language_extra_cost: 0,
        language_cost_type: null,
        restrictions_accepted: hasRestrictions ? restrictionsAccepted : false,
        selected_seats: hasSeatMap && selectedSeats.length > 0 ? selectedSeats : null,
        es_reserva_preventa: isEnPreventa && hasMembership,
        travel_insurance_included: includeInsurance,
        travel_insurance_cost: effectiveInsuranceCost,
        insurance_days: includeInsurance ? tourDays : null,
        insurance_discount_code_id: appliedInsuranceDiscount?.code_id || null,
        insurance_discount_amount: insuranceDiscountAmount,
        selected_payment_mode: hasPaymentPlan ? selectedPaymentMode : 'standard',
        membership_purchased: addMembershipToBooking,
        membership_plan: addMembershipToBooking ? selectedMembershipPlan : null,
        membership_cost: membershipCost,
      };

      console.log('📝 Creando reserva con datos:', bookingData);

      const { data, error: bookingError } = await createBooking(bookingData);

      if (bookingError) {
        console.error('❌ Error al crear la reserva:', bookingError);
        throw new Error(bookingError.message || 'Error al crear la reserva');
      }

      if (!data || !data.id) {
        throw new Error('No se recibió el ID de la reserva');
      }

      console.log('✅ Reserva creada exitosamente:', data);

      // Build optional services array with financial breakdown per bucket
      const extrasServiceChargeRate = serviceChargePercentage / 100;
      const extrasAgencyCommissionRate = optionalServiceCommissionPercentage / 100;

      const allExtras: Record<string, any>[] = [];

      // Traditional optional services
      for (const svc of optionalServices) {
        const qty = optionalServiceQuantities[svc.id] || 0;
        if (qty <= 0) continue;
        const subtotal = qty * svc.price_per_person;
        const svcServiceCharge = Math.round(subtotal * extrasServiceChargeRate * 100) / 100;
        const svcAgencyCommission = Math.round(subtotal * extrasAgencyCommissionRate * 100) / 100;
        allExtras.push({
          booking_id: data.id,
          tour_optional_service_id: svc.id,
          service_kind: 'optional_service',
          description: svc.name || 'Servicio opcional',
          quantity: qty,
          unit_price: svc.price_per_person,
          subtotal,
          service_charge: svcServiceCharge,
          agency_commission: svcAgencyCommission,
          total_paid: subtotal + svcServiceCharge,
        });
      }

      // Pickup extra (receptivo)
      if (isReceptivo && pickupType === 'pickup' && pickupExtraCost > 0 && selectedZoneData) {
        const svcServiceCharge = Math.round(pickupExtraCost * extrasServiceChargeRate * 100) / 100;
        const svcAgencyCommission = Math.round(pickupExtraCost * extrasAgencyCommissionRate * 100) / 100;
        const pickupDesc = selectedZoneData.name
          ? `Pick Up — ${selectedZoneData.name}${selectedZoneData.cost_type === 'por_persona' ? ' (por persona)' : ' (por reserva)'}`
          : 'Pick Up';
        allExtras.push({
          booking_id: data.id,
          tour_optional_service_id: null,
          service_kind: 'pickup',
          description: pickupDesc,
          quantity: selectedZoneData.cost_type === 'por_persona' ? totalTravelers : 1,
          unit_price: selectedZoneData.extra_cost || 0,
          subtotal: pickupExtraCost,
          service_charge: svcServiceCharge,
          agency_commission: svcAgencyCommission,
          total_paid: pickupExtraCost + svcServiceCharge,
        });
      }

      // Language extra (receptivo)
      if (isReceptivo && languageExtraCost > 0 && selectedLanguageData) {
        const svcServiceCharge = Math.round(languageExtraCost * extrasServiceChargeRate * 100) / 100;
        const svcAgencyCommission = Math.round(languageExtraCost * extrasAgencyCommissionRate * 100) / 100;
        const langDesc = selectedLanguage
          ? `Idioma/Intérprete — ${selectedLanguage}${selectedLanguageData.cost_type === 'por_persona' ? ' (por persona)' : ' (fijo)'}`
          : 'Idioma/Intérprete';
        allExtras.push({
          booking_id: data.id,
          tour_optional_service_id: null,
          service_kind: 'language',
          description: langDesc,
          quantity: selectedLanguageData.cost_type === 'por_persona' ? totalTravelers : 1,
          unit_price: selectedLanguageData.extra_cost || 0,
          subtotal: languageExtraCost,
          service_charge: svcServiceCharge,
          agency_commission: svcAgencyCommission,
          total_paid: languageExtraCost + svcServiceCharge,
        });
      }

      if (allExtras.length > 0) {
        await supabase.from('booking_optional_services').insert(allExtras);
      }

      if (hasSeatMap && selectedSeats.length > 0) {
        const slotIdForSeats = isReceptivo && selectedSlot ? selectedSlot.id : null;
        const seatRecords = selectedSeats.map(seatNum => ({
          tour_id: tour.id,
          slot_id: slotIdForSeats,
          agency_id: tour.agency_id,
          seat_number: seatNum,
          status: 'reservado_online',
          booking_id: data.id,
        }));
        const { error: seatError } = await supabase
          .from('slot_seat_status')
          .upsert(seatRecords, { onConflict: 'tour_id,slot_id,seat_number' });
        if (seatError) {
          console.error('❌ Error al guardar asientos seleccionados:', seatError);
          throw new Error('No se pudieron reservar los asientos seleccionados. Por favor intenta de nuevo.');
        }
      }

      // La notificación de seguro de viaje se envía desde send-booking-confirmation
      // únicamente cuando el pago se confirma, no al crear la reserva en draft

      navigate(`/booking-travelers/${data.id}`);

    } catch (error: any) {
      console.error('❌ Error en el proceso de reserva:', error);
      setError(error.message || 'Hubo un error al procesar tu reserva. Por favor, intenta de nuevo.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const createStripeCheckout = async (bookingId: string, customerEmail: string, amount: number) => {
    try {
      const { data: { session } } = await supabase.auth.getSession();

      if (!session) {
        throw new Error('No hay sesión activa');
      }

      const response = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/create-checkout-session`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${session.access_token}`,
          },
          body: JSON.stringify({
            bookingId,
            customerEmail,
            amount,
            description: `Depósito para ${tour.name}`,
            addMembership: addMembershipToBooking,
            membershipPlan: selectedMembershipPlan,
            toursRedCashUsed: toursRedCashApplied,
          }),
        }
      );

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Error al crear la sesión de checkout');
      }

      const result = await response.json();

      if (!result.success) {
        throw new Error(result.error || 'Error al crear la sesión de checkout');
      }

      return result;
    } catch (error: any) {
      console.error('Error creando sesión de checkout:', error);
      return { success: false, error: error.message };
    }
  };

  // Determinar el label del selector
  const getSelectorLabel = () => {
    if (totalTravelers === 0 && travelerCounts.mascotas === 0) {
      return 'Seleccionar viajeros';
    }

    const parts = [];
    if (travelerCounts.adultos > 0) parts.push(`${travelerCounts.adultos} Adulto${travelerCounts.adultos > 1 ? 's' : ''}`);
    if (travelerCounts.ninos > 0) parts.push(`${travelerCounts.ninos} Niño${travelerCounts.ninos > 1 ? 's' : ''}`);
    if (travelerCounts.infantes > 0) parts.push(`${travelerCounts.infantes} Infante${travelerCounts.infantes > 1 ? 's' : ''}`);
    if (travelerCounts.adultos_mayores > 0) parts.push(`${travelerCounts.adultos_mayores} Adulto${travelerCounts.adultos_mayores > 1 ? 's' : ''} Mayor${travelerCounts.adultos_mayores > 1 ? 'es' : ''}`);
    if (travelerCounts.mascotas > 0) parts.push(`${travelerCounts.mascotas} Mascota${travelerCounts.mascotas > 1 ? 's' : ''}`);

    return parts.join(', ');
  };

  if (isEnPreventa && !isLoadingMembership && !hasMembership) {
    return (
      <div className="bg-white rounded-lg shadow-md overflow-hidden">
        <div className="bg-gradient-to-r from-amber-500 to-amber-600 p-5 text-center">
          <div className="inline-flex items-center justify-center w-12 h-12 bg-white/20 rounded-full mb-3">
            <Crown className="w-6 h-6 text-white" />
          </div>
          <h3 className="text-lg font-bold text-white mb-1">Periodo de Preventa Exclusiva</h3>
          <p className="text-amber-100 text-sm">Disponible del {tour.preventa_inicio} al {tour.preventa_fin}</p>
        </div>
        <div className="p-6">
          <div className="text-center mb-5">
            <p className="text-gray-700 font-medium mb-2">Este tour está en preventa exclusiva para socios</p>
            <p className="text-gray-500 text-sm">
              Solo los viajeros con membresía ToursRed Plus activa pueden reservar durante este periodo.
              Al finalizar la preventa, el tour abrirá al público general.
            </p>
          </div>
          {tour.preventa_precio_especial && tour.preventa_descuento_valor && (
            <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 mb-5 text-center">
              <p className="text-xs font-semibold text-amber-700 uppercase tracking-wide mb-1">Precio especial de preventa</p>
              <div className="flex items-center justify-center gap-3">
                <span className="text-2xl font-bold text-amber-700">{formatCurrencyMXN(preventaPrecioBase)}</span>
                <span className="text-gray-400 line-through text-lg">{formatCurrencyMXN(tour.price)}</span>
              </div>
              <p className="text-xs text-amber-600 mt-1">
                {tour.preventa_tipo_descuento === 'porcentaje'
                  ? `${tour.preventa_descuento_valor}% de descuento para socios`
                  : `Ahorra ${formatCurrencyMXN(tour.preventa_descuento_valor)} siendo socio`
                }
              </p>
            </div>
          )}
          <Link
            to="/traveler/membership"
            className="block w-full text-center bg-amber-500 hover:bg-amber-600 text-white font-semibold py-3 px-4 rounded-lg transition-colors"
          >
            <Crown className="w-4 h-4 inline mr-2" />
            Obtener ToursRed Plus
          </Link>
          <p className="text-xs text-gray-400 text-center mt-3">
            ¿Ya eres socio? <Link to="/login" className="text-amber-600 hover:underline">Inicia sesión</Link> para reservar.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-lg shadow-md p-6">
      <h3 className="text-xl font-semibold mb-4">Reservar Este Tour</h3>

      {isEnPreventa && hasMembership && (
        <div className="mb-4 bg-amber-50 border border-amber-200 rounded-lg p-3 flex items-center gap-2.5">
          <Crown className="w-4 h-4 text-amber-600 flex-shrink-0" />
          <div className="text-sm">
            <span className="font-semibold text-amber-800">Reservando en preventa exclusiva</span>
            {tour.preventa_precio_especial && tour.preventa_descuento_valor && (
              <span className="text-amber-600 ml-1">
                — Precio especial para socios activo
              </span>
            )}
          </div>
        </div>
      )}

      <div className="mb-4">
        <div className="text-sm text-gray-500 mb-1">Precio por persona</div>
        {isEnPreventa && hasMembership && tour.preventa_precio_especial && tour.preventa_descuento_valor ? (
          <div className="flex items-baseline gap-2">
            <div className="text-2xl font-bold text-amber-600">{formatCurrencyMXN(preventaPrecioBase)}</div>
            <div className="text-lg text-gray-400 line-through">{formatCurrencyMXN(tour.price)}</div>
          </div>
        ) : (
          <div className="text-2xl font-bold text-primary-600">{formatCurrencyMXN(tour.price)}</div>
        )}
        <div className="text-sm text-gray-500 mt-1">
          {(tourPaymentOption === 'full_upfront' || (hasPaymentPlan && selectedPaymentMode === 'full'))
            ? `Pago total: ${formatCurrencyMXN(totalPrice)} (100%)`
            : hasPaymentPlan && selectedPaymentMode === 'plan'
              ? payPlanMode === 'free_form'
                ? 'Plan de pagos: abonos libres'
                : `Mínimo al reservar: ${formatCurrencyMXN(paymentPlanMinimum)}`
              : `Depósito: ${formatCurrencyMXN(depositAmount)} (${effectiveDepositPercentage}%)`
          }
        </div>

        {/* Selector de modo de pago */}
        {hasPaymentPlan && !isHighRisk && (
          <div className="mt-3 flex gap-2">
            {(tourPaymentOption === 'both' || tourPaymentOption === 'full_upfront') && (
              <button
                type="button"
                onClick={() => setSelectedPaymentMode('full')}
                className={`flex-1 py-2 px-3 rounded-lg text-sm font-medium border-2 transition-all ${
                  selectedPaymentMode === 'full'
                    ? 'border-primary-500 bg-primary-50 text-primary-800'
                    : 'border-gray-200 text-gray-600 hover:border-gray-300'
                }`}
              >
                Pago total anticipado
              </button>
            )}
            {(tourPaymentOption === 'both' || tourPaymentOption === 'payment_plan') && (
              <button
                type="button"
                onClick={() => setSelectedPaymentMode('plan')}
                className={`flex-1 py-2 px-3 rounded-lg text-sm font-medium border-2 transition-all ${
                  selectedPaymentMode === 'plan'
                    ? 'border-sky-500 bg-sky-50 text-sky-800'
                    : 'border-gray-200 text-gray-600 hover:border-gray-300'
                }`}
              >
                Plan de pagos
              </button>
            )}
          </div>
        )}

        {/* Calendario de pagos — modo plan de pagos, parcialidades programadas */}
        {hasPaymentPlan && selectedPaymentMode === 'plan' && !isHighRisk && payPlanMode === 'installments' && paymentSchedule.length > 0 && (
          <div className="mt-3 rounded-xl border border-sky-200 bg-sky-50 overflow-hidden">
            <div className="px-3 py-2 bg-sky-100 flex items-center gap-1.5 border-b border-sky-200">
              <Calendar className="w-3.5 h-3.5 text-sky-600" />
              <span className="text-xs font-semibold text-sky-800">Calendario de pagos</span>
            </div>
            <div className="divide-y divide-sky-100">
              {paymentSchedule.map((row) => (
                <div key={row.idx} className={`flex items-center justify-between px-3 py-2 ${row.isToday ? 'bg-sky-100' : ''}`}>
                  <div className="flex items-center gap-2 min-w-0">
                    <div className={`w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0 text-xs font-bold ${row.isToday ? 'bg-sky-500 text-white' : 'bg-white border border-sky-300 text-sky-600'}`}>
                      {row.idx + 1}
                    </div>
                    <div className="min-w-0">
                      <p className={`text-xs font-semibold truncate ${row.isToday ? 'text-sky-900' : 'text-gray-700'}`}>{row.label}</p>
                      <p className="text-xs text-gray-400">
                        {row.isToday
                          ? 'Se cobra al reservar'
                          : row.dueDate
                            ? format(row.dueDate, "d 'de' MMMM, yyyy", { locale: es })
                            : 'Fecha por confirmar'}
                      </p>
                    </div>
                  </div>
                  <div className="text-right flex-shrink-0 ml-2">
                    <p className={`text-sm font-bold ${row.isToday ? 'text-sky-700' : 'text-gray-800'}`}>{row.amount.toLocaleString('es-MX', { style: 'currency', currency: 'MXN' })}</p>
                    <p className="text-xs text-gray-400">{row.pct}%</p>
                  </div>
                </div>
              ))}
              <div className="flex items-center justify-between px-3 py-2 bg-white">
                <span className="text-xs font-semibold text-gray-500">Total del tour</span>
                <span className="text-sm font-bold text-gray-800">{totalPrice.toLocaleString('es-MX', { style: 'currency', currency: 'MXN' })}</span>
              </div>
            </div>
          </div>
        )}

        {/* Info abonos libres */}
        {hasPaymentPlan && selectedPaymentMode === 'plan' && !isHighRisk && payPlanMode === 'free_form' && (
          <div className="mt-3 rounded-xl border border-sky-200 bg-sky-50 p-3 flex gap-2">
            <Info className="w-4 h-4 text-sky-500 flex-shrink-0 mt-0.5" />
            <div>
              <p className="text-xs font-semibold text-sky-800">Plan de abonos libres</p>
              <p className="text-xs text-sky-700 mt-0.5">Puedes abonar la cantidad que quieras, cuando quieras, siempre que liquides el total antes de la fecha de salida del tour.</p>
            </div>
          </div>
        )}

        {/* Pago total anticipado — confirmación */}
        {(tourPaymentOption === 'full_upfront' || (hasPaymentPlan && selectedPaymentMode === 'full')) && (
          <div className="mt-3 rounded-xl border border-emerald-200 bg-emerald-50 p-3 flex gap-2">
            <CheckCircle className="w-4 h-4 text-emerald-500 flex-shrink-0 mt-0.5" />
            <div>
              <p className="text-xs font-semibold text-emerald-800">Pago total al reservar</p>
              <p className="text-xs text-emerald-700 mt-0.5">Se cargará el 100% del tour ({totalPrice.toLocaleString('es-MX', { style: 'currency', currency: 'MXN' })}) en este momento. No se requieren pagos adicionales.</p>
            </div>
          </div>
        )}

      </div>

      {isHighRisk && (
        <div className="mb-4 p-4 bg-orange-50 border-l-4 border-orange-500 rounded-md">
          <div className="flex items-start">
            <AlertCircle className="h-5 w-5 text-orange-600 mr-2 flex-shrink-0 mt-0.5" />
            <div>
              <h4 className="text-sm font-semibold text-orange-800 mb-1">
                Pago del 100% Requerido
              </h4>
              <p className="text-sm text-orange-700">
                Debido a que has acumulado más de 3 ausencias (No Shows) en tours anteriores,
                se requiere el pago del 100% del tour por adelantado. Esto protege a nuestras
                agencias de posibles pérdidas.
              </p>
            </div>
          </div>
        </div>
      )}

      {isReceptivo ? (
        <div className="mb-4 space-y-3">
          <div className="flex items-center gap-2 mb-1">
            <RefreshCw className="w-4 h-4 text-teal-600" />
            <span className="text-sm font-semibold text-gray-700">
              {isTransferCustomTime ? 'Selecciona la fecha del traslado' : 'Selecciona fecha y horario'}
            </span>
          </div>
          <SlotCalendarPicker
            tour={tour}
            selectedDate={selectedSlotDate}
            onDateSelect={(date) => {
              setSelectedSlotDate(date);
              setSelectedSlot(null);
            }}
          />
          {isTransferCustomTime ? (
            selectedSlotDate && (
              <div className="space-y-2">
                <label className="block text-xs font-semibold text-gray-600">
                  ¿A qué hora necesitas el traslado? <span className="text-red-500">*</span>
                </label>
                <input
                  type="time"
                  value={customTransferTime}
                  onChange={e => setCustomTransferTime(e.target.value)}
                  className="input text-sm"
                />
                {customTransferTime && (
                  <div className="bg-teal-50 border border-teal-200 rounded-xl p-3 flex items-center gap-2.5">
                    <Clock className="w-4 h-4 text-teal-600 flex-shrink-0" />
                    <div className="text-sm">
                      <span className="font-semibold text-teal-800">
                        {format(selectedSlotDate, "EEEE d 'de' MMMM", { locale: es })}
                      </span>
                      <span className="text-teal-600 ml-2">
                        a las {(() => {
                          const [h, m] = customTransferTime.split(':');
                          const hour = parseInt(h);
                          return `${hour % 12 || 12}:${m} ${hour >= 12 ? 'PM' : 'AM'}`;
                        })()}
                      </span>
                    </div>
                  </div>
                )}
              </div>
            )
          ) : (
            <>
              {selectedSlotDate && (
                <SlotTimePicker
                  tourId={tour.id}
                  selectedDate={selectedSlotDate}
                  selectedSlotId={selectedSlot?.id || null}
                  onSlotSelect={(slot) => setSelectedSlot(slot)}
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
                    <span className="text-teal-600 ml-2">
                      a las {(() => {
                        const [h, m] = selectedSlot.departure_time.split(':');
                        const hour = parseInt(h);
                        return `${hour % 12 || 12}:${m} ${hour >= 12 ? 'PM' : 'AM'}`;
                      })()}
                    </span>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      ) : (
        <div className="mb-4 bg-gray-50 p-3 rounded-md">
          <div className="text-sm font-medium mb-2">Fechas del Tour</div>
          <div className="flex items-center text-gray-700">
            <Calendar className="w-4 h-4 mr-2 text-primary-600" />
            <span>
              {formatDate(tour.start_date)} - {formatDate(tour.end_date)}
            </span>
          </div>
        </div>
      )}

      {/* Número de Viajeros */}
      <div className="mb-4">
        <label className="block text-sm font-medium text-gray-700 mb-1">
          Número de Viajeros
          {isPrivateTransfer && (tour as any).private_vehicle_capacity && (
            <span className="ml-2 text-xs font-normal text-teal-700 bg-teal-50 px-2 py-0.5 rounded-full">
              Máx. {(tour as any).private_vehicle_capacity} pasajeros por vehículo
            </span>
          )}
        </label>
        {isLoadingAvailability ? (
          <div className="flex items-center justify-center py-2 text-gray-500">
            <div className="animate-spin rounded-full h-5 w-5 border-t-2 border-b-2 border-primary-600 mr-2"></div>
            <span className="text-sm">Verificando disponibilidad...</span>
          </div>
        ) : availableSpots === 0 ? (
          <div className="bg-red-50 border border-red-200 rounded-md p-3 text-red-800 text-sm">
            No hay lugares disponibles para este tour en este momento.
          </div>
        ) : (
          <div className="relative">
            <button
              type="button"
              onClick={() => setShowTravelerSelector(!showTravelerSelector)}
              className="w-full flex items-center justify-between px-4 py-3 border border-gray-300 rounded-md bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
            >
              <div className="flex items-center">
                <Users className="h-5 w-5 text-gray-400 mr-2" />
                <span className="text-sm text-gray-700">{getSelectorLabel()}</span>
              </div>
              <svg className={`h-5 w-5 text-gray-400 transition-transform ${showTravelerSelector ? 'transform rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            </button>

            {showTravelerSelector && (
              <div className="absolute z-10 mt-2 w-full bg-white border border-gray-300 rounded-md shadow-lg p-4 space-y-4">
                {tour.admite_adultos !== false && (
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="text-sm font-medium text-gray-900">Adultos</div>
                      <div className="text-xs text-gray-500">13-59 años &middot; {formatCurrencyMXN(getPrecioPorCategoria('adulto'))}/persona</div>
                    </div>
                    <div className="flex items-center space-x-3">
                      <button
                        type="button"
                        onClick={() => handleCountChange('adultos', -1)}
                        disabled={travelerCounts.adultos === 0}
                        className="w-8 h-8 rounded-full border-2 border-gray-300 flex items-center justify-center hover:border-primary-600 disabled:opacity-30 disabled:cursor-not-allowed"
                      >
                        <Minus className="w-4 h-4" />
                      </button>
                      <span className="w-8 text-center font-medium">{travelerCounts.adultos}</span>
                      <button
                        type="button"
                        onClick={() => handleCountChange('adultos', 1)}
                        className="w-8 h-8 rounded-full border-2 border-primary-600 bg-primary-600 text-white flex items-center justify-center hover:bg-primary-700"
                      >
                        <Plus className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                )}

                {tour.admite_ninos !== false && (
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="text-sm font-medium text-gray-900">Niños</div>
                      <div className="text-xs text-gray-500">3-12 años &middot; {formatCurrencyMXN(getPrecioPorCategoria('nino'))}/persona</div>
                    </div>
                    <div className="flex items-center space-x-3">
                      <button
                        type="button"
                        onClick={() => handleCountChange('ninos', -1)}
                        disabled={travelerCounts.ninos === 0}
                        className="w-8 h-8 rounded-full border-2 border-gray-300 flex items-center justify-center hover:border-primary-600 disabled:opacity-30 disabled:cursor-not-allowed"
                      >
                        <Minus className="w-4 h-4" />
                      </button>
                      <span className="w-8 text-center font-medium">{travelerCounts.ninos}</span>
                      <button
                        type="button"
                        onClick={() => handleCountChange('ninos', 1)}
                        className="w-8 h-8 rounded-full border-2 border-primary-600 bg-primary-600 text-white flex items-center justify-center hover:bg-primary-700"
                      >
                        <Plus className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                )}

                {tour.admite_infantes !== false && (
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="text-sm font-medium text-gray-900">Infantes</div>
                      <div className="text-xs text-gray-500">0-2 años &middot; {formatCurrencyMXN(getPrecioPorCategoria('infante'))}/persona</div>
                    </div>
                    <div className="flex items-center space-x-3">
                      <button
                        type="button"
                        onClick={() => handleCountChange('infantes', -1)}
                        disabled={travelerCounts.infantes === 0}
                        className="w-8 h-8 rounded-full border-2 border-gray-300 flex items-center justify-center hover:border-primary-600 disabled:opacity-30 disabled:cursor-not-allowed"
                      >
                        <Minus className="w-4 h-4" />
                      </button>
                      <span className="w-8 text-center font-medium">{travelerCounts.infantes}</span>
                      <button
                        type="button"
                        onClick={() => handleCountChange('infantes', 1)}
                        className="w-8 h-8 rounded-full border-2 border-primary-600 bg-primary-600 text-white flex items-center justify-center hover:bg-primary-700"
                      >
                        <Plus className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                )}

                {tour.admite_adultos_mayores !== false && (
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="text-sm font-medium text-gray-900">Adultos Mayores</div>
                      <div className="text-xs text-gray-500">60+ con INAPAM &middot; {formatCurrencyMXN(getPrecioPorCategoria('adulto_mayor'))}/persona</div>
                    </div>
                    <div className="flex items-center space-x-3">
                      <button
                        type="button"
                        onClick={() => handleCountChange('adultos_mayores', -1)}
                        disabled={travelerCounts.adultos_mayores === 0}
                        className="w-8 h-8 rounded-full border-2 border-gray-300 flex items-center justify-center hover:border-primary-600 disabled:opacity-30 disabled:cursor-not-allowed"
                      >
                        <Minus className="w-4 h-4" />
                      </button>
                      <span className="w-8 text-center font-medium">{travelerCounts.adultos_mayores}</span>
                      <button
                        type="button"
                        onClick={() => handleCountChange('adultos_mayores', 1)}
                        className="w-8 h-8 rounded-full border-2 border-primary-600 bg-primary-600 text-white flex items-center justify-center hover:bg-primary-700"
                      >
                        <Plus className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                )}

                {tour.pet_friendly && (
                  <div className="flex items-center justify-between border-t pt-3">
                    <div>
                      <div className="text-sm font-medium text-gray-900">Mascotas</div>
                      <div className="text-xs text-gray-500">Perro o gato &middot; {getPrecioPorCategoria('mascota') > 0 ? formatCurrencyMXN(getPrecioPorCategoria('mascota')) : 'Gratis'}</div>
                    </div>
                    <div className="flex items-center space-x-3">
                      <button
                        type="button"
                        onClick={() => handleCountChange('mascotas', -1)}
                        disabled={travelerCounts.mascotas === 0}
                        className="w-8 h-8 rounded-full border-2 border-gray-300 flex items-center justify-center hover:border-primary-600 disabled:opacity-30 disabled:cursor-not-allowed"
                      >
                        <Minus className="w-4 h-4" />
                      </button>
                      <span className="w-8 text-center font-medium">{travelerCounts.mascotas}</span>
                      <button
                        type="button"
                        onClick={() => handleCountChange('mascotas', 1)}
                        className="w-8 h-8 rounded-full border-2 border-primary-600 bg-primary-600 text-white flex items-center justify-center hover:bg-primary-700"
                      >
                        <Plus className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                )}

                <div className="border-t pt-3">
                  <button
                    type="button"
                    onClick={() => setShowTravelerSelector(false)}
                    className="w-full py-2 bg-primary-600 text-white rounded-md hover:bg-primary-700 font-medium"
                  >
                    Listo
                  </button>
                </div>
              </div>
            )}

            {availableSpots !== null && (
              <p className="text-xs text-gray-500 mt-1">
                {availableSpots} {availableSpots === 1 ? 'lugar disponible' : 'lugares disponibles'}
              </p>
            )}
          </div>
        )}
      </div>

      {/* Mapa de asientos — cuando el tour tiene vehiculo configurado */}
      {hasSeatMap && (
        <div className="mb-4 space-y-3">
          <div className="flex items-center gap-2 mb-1">
            <Bus className="w-4 h-4 text-blue-600" />
            <span className="text-sm font-semibold text-gray-700">Selecciona tus asientos</span>
          </div>
          {isReceptivo && !selectedSlot ? (
            <div className="p-4 bg-gray-50 border border-gray-200 rounded-xl text-sm text-gray-500 text-center">
              Primero selecciona la fecha y horario del tour para ver el mapa de asientos.
            </div>
          ) : totalTravelers === 0 ? (
            <div className="p-4 bg-gray-50 border border-gray-200 rounded-xl text-sm text-gray-500 text-center">
              Primero selecciona el numero de viajeros para continuar con la seleccion de asientos.
            </div>
          ) : (
            <div className="border border-blue-200 rounded-xl p-4 bg-white">
              <SeatMapPicker
                tourId={tour.id}
                slotId={isReceptivo && selectedSlot ? selectedSlot.id : null}
                requiredSeats={totalTravelers}
                selectedSeats={selectedSeats}
                onSeatsSelected={setSelectedSeats}
              />
            </div>
          )}
        </div>
      )}

      {/* Pickup selector — solo receptivo */}
      {isReceptivo && tour.pickup_available && (
        <div className="mb-4 space-y-3">
          <div className="flex items-center gap-2 mb-1">
            <Car className="w-4 h-4 text-teal-600" />
            <span className="text-sm font-semibold text-gray-700">Tipo de traslado</span>
          </div>
          <div className="space-y-2">
            <label className="flex items-start gap-3 p-3 rounded-lg border-2 cursor-pointer transition-all hover:border-teal-300 hover:bg-teal-50"
              style={{ borderColor: pickupType === 'meeting_point' ? '#0d9488' : '#e5e7eb', background: pickupType === 'meeting_point' ? '#f0fdfa' : undefined }}>
              <input
                type="radio"
                name="pickup_type"
                value="meeting_point"
                checked={pickupType === 'meeting_point'}
                onChange={() => setPickupType('meeting_point')}
                className="mt-0.5 text-teal-600"
              />
              <div>
                <span className="text-sm font-medium text-gray-800">Me presento en el punto de encuentro</span>
                <p className="text-xs text-gray-500 mt-0.5">Llego por mi cuenta al punto indicado</p>
              </div>
            </label>
            <label className="flex items-start gap-3 p-3 rounded-lg border-2 cursor-pointer transition-all hover:border-teal-300 hover:bg-teal-50"
              style={{ borderColor: pickupType === 'pickup' ? '#0d9488' : '#e5e7eb', background: pickupType === 'pickup' ? '#f0fdfa' : undefined }}>
              <input
                type="radio"
                name="pickup_type"
                value="pickup"
                checked={pickupType === 'pickup'}
                onChange={() => setPickupType('pickup')}
                className="mt-0.5 text-teal-600"
              />
              <div className="flex-1">
                <span className="text-sm font-medium text-gray-800">Solicitar recogida en mi hotel</span>
                <p className="text-xs text-gray-500 mt-0.5">La agencia pasará por mí</p>
              </div>
            </label>
          </div>

          {pickupType === 'pickup' && (
            <div className="pl-4 space-y-3">
              {tour.pickup_free_zone && (
                <div className="text-xs text-teal-700 bg-teal-50 border border-teal-200 rounded-lg px-3 py-2">
                  <span className="font-semibold">Zona sin costo:</span> {tour.pickup_free_zone}
                </div>
              )}
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">
                  Nombre de tu hotel o dirección <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={pickupHotelAddress}
                  onChange={e => setPickupHotelAddress(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-teal-500"
                  placeholder="Ej: Hotel Barceló, Zona Hotelera"
                />
              </div>
              {pickupZones.length > 0 && (
                <div>
                  <label className="block text-xs font-semibold text-gray-600 mb-1">
                    Zona de recogida
                  </label>
                  <select
                    value={selectedPickupZone}
                    onChange={e => setSelectedPickupZone(e.target.value)}
                    className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-500"
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

      {/* Selector de idioma — solo receptivo */}
      {isReceptivo && tourLanguages.length > 0 && (
        <div className="mb-4 space-y-2">
          <div className="flex items-center gap-2 mb-1">
            <Globe className="w-4 h-4 text-blue-600" />
            <span className="text-sm font-semibold text-gray-700">Idioma del tour</span>
          </div>
          <select
            value={selectedLanguage}
            onChange={e => setSelectedLanguage(e.target.value)}
            className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
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

      {/* Restricciones del tour — solo receptivo */}
      {hasRestrictions && (
        <div className="mb-4">
          <div className="bg-amber-50 border-2 border-amber-300 rounded-xl p-4 space-y-3">
            <div className="flex items-center gap-2">
              <AlertTriangle className="w-5 h-5 text-amber-600 flex-shrink-0" />
              <span className="text-sm font-semibold text-amber-800">Restricciones del Tour</span>
            </div>
            <div className="space-y-1.5">
              {tour.restriction_pregnant && (
                <div className="flex items-center gap-2">
                  <span className="w-4 h-4 rounded-full bg-amber-400 flex items-center justify-center text-white text-xs font-bold flex-shrink-0">!</span>
                  <span className="text-xs text-amber-800">No apto para mujeres embarazadas</span>
                </div>
              )}
              {tour.restriction_disability && (
                <div className="flex items-center gap-2">
                  <span className="w-4 h-4 rounded-full bg-amber-400 flex items-center justify-center text-white text-xs font-bold flex-shrink-0">!</span>
                  <span className="text-xs text-amber-800">No apto para personas con alguna discapacidad</span>
                </div>
              )}
              {tour.restriction_physical && (
                <div className="flex items-center gap-2">
                  <span className="w-4 h-4 rounded-full bg-amber-400 flex items-center justify-center text-white text-xs font-bold flex-shrink-0">!</span>
                  <span className="text-xs text-amber-800">No apto para personas con mala condición física</span>
                </div>
              )}
            </div>
            <label className={`flex items-start gap-3 cursor-pointer p-3 rounded-lg border-2 transition-all ${restrictionsAccepted ? 'border-green-400 bg-green-50' : 'border-amber-300 bg-white'}`}>
              <input
                type="checkbox"
                checked={restrictionsAccepted}
                onChange={e => setRestrictionsAccepted(e.target.checked)}
                className="w-4 h-4 mt-0.5 text-green-600 border-gray-300 rounded focus:ring-green-500 flex-shrink-0"
              />
              <span className={`text-xs font-medium ${restrictionsAccepted ? 'text-green-800' : 'text-gray-700'}`}>
                He leído y acepto las restricciones. Ni yo ni mis acompañantes pertenecemos a ninguno de estos grupos.
              </span>
            </label>
          </div>
        </div>
      )}

      <form onSubmit={handleSubmit}>

        {/* Promo Activa Aplicada */}
        {activePromotion && promoResult.isActive && totalTravelers > 0 && (
          <div className="mb-4 bg-gradient-to-br from-rose-50 to-pink-50 border-2 border-rose-300 rounded-lg p-4">
            <div className="flex items-center gap-2">
              <Tag className="h-5 w-5 text-rose-600 flex-shrink-0" />
              <div className="flex-1">
                <h4 className="text-sm font-bold text-rose-900">
                  Promoción Aplicada
                </h4>
                <p className="text-xs text-rose-700 mt-0.5">{promoResult.label}</p>
                {promoResult.availabilityNote && (
                  <p className="text-xs text-amber-700 mt-1 flex items-center gap-1">
                    <Info className="h-3 w-3 flex-shrink-0" />
                    {promoResult.availabilityNote}
                  </p>
                )}
              </div>
              <span className="text-sm font-bold text-rose-700 flex-shrink-0">
                -{formatCurrencyMXN(promoDiscountAmount)}
              </span>
            </div>
          </div>
        )}

        {/* Mensaje motivador para activar promo */}
        {activePromotion && !promoResult.isActive && promoResult.nearMissMessage && totalTravelers > 0 && (
          <div className="mb-4 bg-amber-50 border border-amber-200 rounded-lg p-3 flex items-start gap-2">
            <Tag className="h-4 w-4 text-amber-600 flex-shrink-0 mt-0.5" />
            <p className="text-xs text-amber-800">
              <span className="font-semibold">{promoResult.nearMissMessage}</span>
            </p>
          </div>
        )}

        {/* Servicios Opcionales */}
        {!isLoadingOptionalServices && optionalServices.length > 0 && totalTravelers > 0 && (
          <div className="mb-4">
            <div className="flex items-center gap-2 mb-3">
              <ShoppingBag className="h-4 w-4 text-amber-600" />
              <span className="text-sm font-semibold text-gray-800">Servicios Adicionales</span>
            </div>
            <div className="space-y-3">
              {optionalServices.map(svc => {
                const qty = optionalServiceQuantities[svc.id] || 0;
                const isSoldOut = svc.available_capacity !== null && svc.available_capacity !== undefined && svc.available_capacity === 0;
                const maxAllowed = Math.min(
                  totalTravelers,
                  svc.available_capacity !== null && svc.available_capacity !== undefined
                    ? svc.available_capacity
                    : Infinity
                );

                return (
                  <div
                    key={svc.id}
                    className={`border rounded-lg p-3 ${
                      isSoldOut
                        ? 'border-gray-200 bg-gray-50 opacity-60'
                        : qty > 0
                          ? 'border-amber-300 bg-amber-50'
                          : 'border-gray-200 bg-white'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-sm font-semibold text-gray-900">{svc.name}</span>
                          {!svc.is_refundable && (
                            <span className="inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium bg-orange-100 text-orange-700">
                              No reembolsable si cancelas
                            </span>
                          )}
                          {isSoldOut && (
                            <span className="inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium bg-gray-200 text-gray-600">
                              Agotado
                            </span>
                          )}
                          {!isSoldOut && svc.available_capacity !== null && svc.available_capacity !== undefined && (
                            <span className="text-xs text-gray-500">
                              {svc.available_capacity} {svc.available_capacity === 1 ? 'lugar' : 'lugares'} disponibles
                            </span>
                          )}
                        </div>
                        {svc.description && (
                          <p className="text-xs text-gray-500 mt-0.5">{svc.description}</p>
                        )}
                        <p className="text-sm font-medium text-primary-600 mt-1">
                          {formatCurrencyMXN(svc.price_per_person)} / persona
                        </p>
                      </div>

                      {!isSoldOut && (
                        <div className="flex items-center space-x-2 flex-shrink-0">
                          <button
                            type="button"
                            onClick={() => handleOptionalServiceChange(svc.id, -1, svc)}
                            disabled={qty === 0}
                            className="w-7 h-7 rounded-full border-2 border-gray-300 flex items-center justify-center hover:border-amber-500 disabled:opacity-30 disabled:cursor-not-allowed"
                          >
                            <Minus className="w-3 h-3" />
                          </button>
                          <span className="w-6 text-center text-sm font-semibold">{qty}</span>
                          <button
                            type="button"
                            onClick={() => handleOptionalServiceChange(svc.id, 1, svc)}
                            disabled={qty >= maxAllowed}
                            className="w-7 h-7 rounded-full border-2 border-amber-500 bg-amber-500 text-white flex items-center justify-center hover:bg-amber-600 disabled:opacity-30 disabled:cursor-not-allowed"
                          >
                            <Plus className="w-3 h-3" />
                          </button>
                        </div>
                      )}
                    </div>

                    {qty > 0 && (
                      <div className="mt-2 pt-2 border-t border-amber-200 flex justify-between text-xs">
                        <span className="text-gray-600">{qty} × {formatCurrencyMXN(svc.price_per_person)}</span>
                        <span className="font-semibold text-amber-700">+{formatCurrencyMXN(qty * svc.price_per_person)}</span>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* ─── Seguro de Viaje ─────────────────────────────────────────────── */}
        {totalTravelers > 0 && (
          <>
            {/* Modal de advertencia al querer desmarcar el seguro */}
            {showInsuranceWarning && (
              <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
                <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full overflow-hidden">
                  <div className="bg-gradient-to-r from-slate-700 to-slate-900 px-6 py-5 text-white">
                    <div className="flex items-center gap-3 mb-2">
                      <div className="p-2 bg-white/10 rounded-full">
                        <ShieldOff className="h-6 w-6" />
                      </div>
                      <h3 className="text-lg font-bold">Viajarás sin protección</h3>
                    </div>
                    <p className="text-sm text-slate-300">
                      Antes de continuar, considera lo siguiente:
                    </p>
                  </div>

                  <div className="px-6 py-5">
                    <ul className="space-y-3">
                      {[
                        { icon: '🏥', text: 'Gastos de asistencia médica en destino corren por tu cuenta.' },
                        { icon: '🚑', text: 'Sin cobertura de ambulancia o traslado médico de emergencia.' },
                        { icon: '✈️', text: 'En caso de accidente o emergencia médica, los gastos serán cubiertos directamente por el viajero.' },
                        { icon: '💳', text: 'Una emergencia médica durante un viaje, puede generar gastos médicos importantes e imprevistos.' },
                      ].map((item, i) => (
                        <li key={i} className="flex items-start gap-3 text-sm text-gray-700">
                          <span className="text-lg leading-none mt-0.5">{item.icon}</span>
                          <span>{item.text}</span>
                        </li>
                      ))}
                    </ul>

                    <p className="mt-4 text-xs text-gray-500 bg-gray-50 rounded-lg p-3 border border-gray-100">
                      Esperamos que disfrutes tu viaje sin contratiempos. Esta protección existe para brindarte tranquilidad ante cualquier imprevisto.
                    </p>
                  </div>

                  <div className="px-6 pb-6 flex flex-col gap-2">
                    <button
                      type="button"
                      onClick={() => setShowInsuranceWarning(false)}
                      className="w-full py-3 bg-slate-800 hover:bg-slate-900 text-white rounded-xl font-semibold text-sm transition-colors flex items-center justify-center gap-2"
                    >
                      <Shield className="h-4 w-4" />
                      Mantener mi protección
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setIncludeInsurance(false);
                        setShowInsuranceWarning(false);
                      }}
                      className="w-full py-2.5 text-gray-500 hover:text-gray-700 text-sm transition-colors flex items-center justify-center gap-1"
                    >
                      Continuar sin seguro
                      <ChevronRight className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* Modal de cobertura completa */}
            {showInsuranceCoverage && (
              <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm" onClick={() => setShowInsuranceCoverage(false)}>
                <div className="bg-white rounded-2xl shadow-2xl max-w-lg w-full overflow-hidden max-h-[90vh] flex flex-col" onClick={e => e.stopPropagation()}>
                  {/* Header */}
                  <div className="bg-gradient-to-r from-blue-900 to-blue-800 px-6 py-5 text-white flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="p-2 bg-white/20 rounded-full">
                        <Shield className="h-6 w-6" />
                      </div>
                      <div>
                        <h3 className="text-lg font-bold">Cobertura Completa</h3>
                        <p className="text-sm text-blue-200">Plan MX 200K</p>
                      </div>
                    </div>
                    <button type="button" onClick={() => setShowInsuranceCoverage(false)} className="p-2 hover:bg-white/20 rounded-full transition-colors">
                      <X className="h-5 w-5" />
                    </button>
                  </div>
                  {/* Body */}
                  <div className="overflow-y-auto flex-1 px-6 py-4">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-gray-200">
                          <th className="text-left font-semibold text-gray-700 pb-2">Cobertura</th>
                          <th className="text-right font-semibold text-gray-700 pb-2">Monto</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100">
                        {[
                          { concepto: 'Asistencia médica por enfermedad / accidente', monto: 'MXN 200,000' },
                          { concepto: 'Asesoría y compensación por pérdida de equipaje complementaria (Aéreo)', monto: 'MXN 6,900' },
                          { concepto: 'Garantía de gastos de cancelación/interrupción con restricción de causas', monto: 'MXN 69,000' },
                          { concepto: 'Odontología*', monto: 'MXN 20,000' },
                          { concepto: 'Asistencia médica por enfermedad preexistente*', monto: 'MXN 11,500' },
                          { concepto: 'Deducible o Franquicia por enfermedad', monto: 'No aplica' },
                          { concepto: 'Asistencia embarazadas (hasta semana 26)*', monto: 'MXN 92,000' },
                          { concepto: 'Práctica recreativa de deportes*', monto: 'MXN 46,000' },
                          { concepto: 'Traslado sanitario*', monto: 'Incluido' },
                          { concepto: 'Traslado de restos*', monto: 'MXN 115,000' },
                          { concepto: 'Días complementarios por internación*', monto: 'Incluido' },
                          { concepto: 'Gastos de hotel familiar acompañante - total*', monto: 'MXN 5,500' },
                          { concepto: 'Gastos de hotel familiar acompañante - por día*', monto: 'MXN 1,100' },
                          { concepto: 'Traslado de familiar en caso de hospitalización*', monto: 'Incluido' },
                          { concepto: 'Viaje de regreso por enfermedad del Titular*', monto: 'Incluido' },
                          { concepto: 'Acompañamiento de menores*', monto: 'Incluido' },
                          { concepto: 'Medicamentos ambulatorio*', monto: 'MXN 20,000' },
                          { concepto: 'Asistencia legal en caso de accidente', monto: 'MXN 18,400' },
                          { concepto: 'Regreso anticipado por siniestro en domicilio*', monto: 'Incluido' },
                          { concepto: 'Gastos por vuelo demorado (a partir de 6 hrs.)', monto: 'MXN 1,000' },
                          { concepto: 'Teleasistencia', monto: 'Incluido' },
                          { concepto: 'Límite de edad', monto: 'Ilimitado' },
                        ].map((row, i) => (
                          <tr key={i}>
                            <td className="py-2 pr-4 text-gray-700">{row.concepto}</td>
                            <td className="py-2 text-right font-medium text-blue-800 whitespace-nowrap">{row.monto}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    <div className="mt-4 space-y-1 text-xs text-gray-500 border-t border-gray-200 pt-3">
                      <p>* Incluido dentro del límite de asistencia médica</p>
                      <p>** Ámbito nacional: a más de 25 km del lugar de residencia</p>
                    </div>
                  </div>
                  {/* Footer */}
                  <div className="px-6 py-3 bg-blue-900 border-t border-blue-800 flex items-center gap-3">
                    <img src="/universalassistance.jpg" alt="Universal Assistance" className="h-7 object-contain rounded" />
                    <p className="text-sm font-semibold text-blue-100">Cobertura Respaldada por Universal Assistance</p>
                  </div>
                </div>
              </div>
            )}

            {/* Tarjeta del seguro */}
            {isInsuranceApplicable && (
            <div className={`mb-4 rounded-xl border-2 overflow-hidden transition-all ${includeInsurance ? 'border-blue-300 bg-gradient-to-br from-blue-50 to-slate-50' : 'border-gray-200 bg-gray-50'}`}>
              {/* Header */}
              <div className={`px-4 py-3 flex items-center justify-between ${includeInsurance ? 'bg-blue-900' : 'bg-gray-400'}`}>
                <div className="flex items-center gap-2 text-white">
                  <Shield className="h-5 w-5" />
                  <span className="font-bold text-sm">Viaja Protegido</span>
                </div>
                <div className="flex items-center gap-2">
                  {includeInsurance && (
                    <span className="text-xs bg-white/20 text-white px-2 py-0.5 rounded-full font-medium">Recomendado</span>
                  )}
                  <label className="relative inline-flex items-center cursor-pointer">
                    <input
                      type="checkbox"
                      className="sr-only peer"
                      checked={includeInsurance}
                      onChange={(e) => {
                        if (!e.target.checked) {
                          setShowInsuranceWarning(true);
                        } else {
                          setIncludeInsurance(true);
                        }
                      }}
                    />
                    <div className="w-10 h-5 bg-white/30 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-5 after:content-[''] after:absolute after:top-0.5 after:left-[2px] after:bg-white after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-white/50" />
                  </label>
                </div>
              </div>

              {/* Body */}
              <div className="px-4 py-3">
                {includeInsurance ? (
                  <>
                    <div className="grid grid-cols-1 gap-1.5 mb-2">
                      {[
                        { icon: '🛡️', label: 'Cobertura de accidentes' },
                        { icon: '🏥', label: 'Asistencia médica hasta $200,000 MXN' },
                        { icon: '🚑', label: 'Traslado sanitario de emergencia' },
                        { icon: '⚖️', label: 'Asistencia legal por accidentes' },
                        { icon: '📞', label: 'Atención 24/7 durante tu viaje' },
                      ].map((b, i) => (
                        <div key={i} className="flex items-center gap-1.5 text-xs text-blue-900">
                          <span>{b.icon}</span>
                          <span>{b.label}</span>
                        </div>
                      ))}
                    </div>
                    <p className="text-xs text-blue-800 mb-2">
                      y mucho más,{' '}
                      <button
                        type="button"
                        onClick={() => setShowInsuranceCoverage(true)}
                        className="underline font-medium hover:text-blue-950 transition-colors"
                      >
                        ver cobertura completa da clic aquí
                      </button>
                    </p>
                    <div className="flex items-center justify-between border-t border-blue-200 pt-2">
                      <span className="text-xs text-blue-800">
                        {formatCurrencyMXN(insurancePricePerDayPerTraveler)}/día × {tourDays} día{tourDays !== 1 ? 's' : ''} × {Math.max(1, totalTravelers)} viajero{totalTravelers !== 1 ? 's' : ''}
                      </span>
                      {appliedInsuranceDiscount ? (
                        <div className="flex items-center gap-2">
                          <span className="text-xs text-blue-400 line-through">{formatCurrencyMXN(insuranceCost)}</span>
                          <span className="text-sm font-bold text-emerald-700">+{formatCurrencyMXN(effectiveInsuranceCost)}</span>
                        </div>
                      ) : (
                        <span className="text-sm font-bold text-blue-800">+{formatCurrencyMXN(insuranceCost)}</span>
                      )}
                    </div>

                    {/* Input de codigo de descuento para seguro */}
                    {appliedInsuranceDiscount ? (
                      <div className="mt-2 flex items-center justify-between bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2">
                        <div className="flex items-center gap-2">
                          <CheckCircle className="h-4 w-4 text-emerald-600 shrink-0" />
                          <div>
                            <span className="text-xs font-semibold text-emerald-800">{appliedInsuranceDiscount.code}</span>
                            <p className="text-xs text-emerald-700">
                              {appliedInsuranceDiscount.discount_type === 'insurance_free'
                                ? 'Seguro gratis'
                                : appliedInsuranceDiscount.discount_type === 'insurance_percentage'
                                ? `${appliedInsuranceDiscount.discount_value}% de descuento en seguro`
                                : `$${appliedInsuranceDiscount.discount_value} de descuento en seguro`}
                              {' — '}
                              <span className="font-semibold">-{formatCurrencyMXN(insuranceDiscountAmount)}</span>
                            </p>
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={handleRemoveInsuranceDiscount}
                          className="text-emerald-600 hover:text-emerald-800 transition-colors ml-2"
                        >
                          <X className="h-4 w-4" />
                        </button>
                      </div>
                    ) : (
                      <div className="mt-2">
                        <div className="flex gap-2">
                          <input
                            type="text"
                            value={insuranceDiscountInput}
                            onChange={(e) => setInsuranceDiscountInput(e.target.value.toUpperCase())}
                            onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), handleApplyInsuranceDiscountCode())}
                            placeholder="Código descuento seguro"
                            className="flex-1 px-3 py-1.5 text-xs border border-blue-200 rounded-lg focus:ring-2 focus:ring-blue-400 focus:border-transparent bg-white uppercase"
                            disabled={isValidatingInsuranceCode}
                          />
                          <button
                            type="button"
                            onClick={handleApplyInsuranceDiscountCode}
                            disabled={!insuranceDiscountInput.trim() || isValidatingInsuranceCode}
                            className="px-3 py-1.5 text-xs bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors whitespace-nowrap"
                          >
                            {isValidatingInsuranceCode ? 'Validando...' : 'Aplicar'}
                          </button>
                        </div>
                        {insuranceDiscountError && (
                          <p className="mt-1 text-xs text-red-600">{insuranceDiscountError}</p>
                        )}
                      </div>
                    )}
                  </>
                ) : (
                  <div className="flex items-center gap-2 py-1">
                    <ShieldOff className="h-4 w-4 text-gray-400 shrink-0" />
                    <p className="text-xs text-gray-500">
                      Viajas sin asistencia de viaje. En caso de emergencia médica los gastos corren por tu cuenta.{' '}
                      <button
                        type="button"
                        onClick={() => setIncludeInsurance(true)}
                        className="text-emerald-600 hover:text-emerald-700 font-medium underline"
                      >
                        Agregar protección
                      </button>
                    </p>
                  </div>
                )}
              </div>
            </div>
            )}
          </>
        )}

        {!isLoadingMembership && !hasMembership && totalTravelers > 0 && serviceCharge > 0 && (
          <div className="mb-4 bg-gradient-to-br from-amber-50 to-orange-50 border-2 border-amber-200 rounded-lg p-4">
            <div className="flex items-start mb-3">
              <Sparkles className="h-5 w-5 text-amber-600 mr-2 flex-shrink-0 mt-0.5" />
              <div className="flex-1">
                <h4 className="text-sm font-bold text-gray-900 mb-1">
                  ¡Ahorra {formatCurrencyMXN(serviceCharge)} con ToursRed+!
                </h4>
                <p className="text-xs text-gray-700">
                  Los miembros ToursRed+ no pagan cargo por servicio en reservas nacionales. Agrega una membresía a tu compra y comienza a ahorrar hoy.
                </p>
              </div>
            </div>

            <div className="space-y-3">
              <label className="flex items-start cursor-pointer">
                <input
                  type="checkbox"
                  checked={addMembershipToBooking}
                  onChange={(e) => setAddMembershipToBooking(e.target.checked)}
                  className="mt-1 h-4 w-4 text-primary-600 focus:ring-primary-500 border-gray-300 rounded"
                />
                <span className="ml-3 text-sm font-medium text-gray-900">
                  Agregar membresía ToursRed+ a mi reserva
                </span>
              </label>

              {addMembershipToBooking && (
                <div className="ml-7 space-y-2">
                  <label className="flex items-start cursor-pointer">
                    <input
                      type="radio"
                      name="membership-plan"
                      checked={selectedMembershipPlan === 'monthly'}
                      onChange={() => setSelectedMembershipPlan('monthly')}
                      className="mt-1 h-4 w-4 text-primary-600 focus:ring-primary-500 border-gray-300"
                    />
                    <div className="ml-3 flex-1">
                      <div className="flex items-center justify-between">
                        <span className="text-sm font-medium text-gray-900">Plan Mensual</span>
                        <span className="text-sm font-bold text-primary-600">{membershipPrices?.monthlyPriceFormatted || '$49'}/mes</span>
                      </div>
                      <p className="text-xs text-gray-600">Cancela cuando quieras</p>
                    </div>
                  </label>

                  <label className="flex items-start cursor-pointer">
                    <input
                      type="radio"
                      name="membership-plan"
                      checked={selectedMembershipPlan === 'annual'}
                      onChange={() => setSelectedMembershipPlan('annual')}
                      className="mt-1 h-4 w-4 text-primary-600 focus:ring-primary-500 border-gray-300"
                    />
                    <div className="ml-3 flex-1">
                      <div className="flex items-center justify-between">
                        <span className="text-sm font-medium text-gray-900">Plan Anual</span>
                        <span className="text-sm font-bold text-primary-600">{membershipPrices?.annualPriceFormatted || '$490'}/año</span>
                      </div>
                      <p className="text-xs text-gray-600">Ahorra {membershipPrices?.annualSavingsFormatted || '$98'} al año ({membershipPrices?.savingsPercentage || 17}% descuento)</p>
                    </div>
                  </label>
                </div>
              )}
            </div>
          </div>
        )}

        {hasMembership && (
          <>
            {!hasReachedExemptionLimit ? (
              <div className="mb-4 bg-gradient-to-br from-amber-50 to-orange-50 border-2 border-amber-300 rounded-lg p-4">
                <div className="flex items-center">
                  <Crown className="h-6 w-6 text-amber-600 mr-2" />
                  <div className="flex-1">
                    <h4 className="text-sm font-bold text-gray-900">
                      Beneficio ToursRed+ Activo
                    </h4>
                    <p className="text-xs text-gray-700">
                      No se aplicará cargo por servicio en esta reserva
                    </p>
                  </div>
                </div>
              </div>
            ) : (
              <div className="mb-4 bg-gradient-to-br from-orange-50 to-red-50 border-2 border-orange-400 rounded-lg p-4">
                <div className="flex items-start">
                  <AlertCircle className="h-6 w-6 text-orange-600 mr-2 flex-shrink-0 mt-0.5" />
                  <div className="flex-1">
                    <h4 className="text-sm font-bold text-gray-900 mb-1">
                      Límite Mensual de Descuento Alcanzado
                    </h4>
                    <p className="text-xs text-gray-700 mb-2">
                      Has usado {formatCurrencyMXN(500 - remainingExemption)} MXN de tus $500 MXN de descuento este mes. Esta reserva aplicará un cargo por servicio de {formatCurrencyMXN(serviceCharge)} MXN.
                    </p>
                    <div className="bg-white rounded-md p-2 border border-orange-200">
                      <p className="text-xs text-gray-600">
                        <span className="font-semibold text-green-700">Buenas noticias:</span> El cargo por servicio también te genera <span className="font-bold text-green-700">{Math.floor(serviceCharge).toLocaleString()} ToursRed Points</span>
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {totalTravelers > 0 && (
              <div className="mb-4 bg-gradient-to-br from-green-50 to-emerald-50 border-2 border-green-300 rounded-lg p-4">
                <div className="flex items-center">
                  <Sparkles className="h-6 w-6 text-green-600 mr-2" />
                  <div className="flex-1">
                    <h4 className="text-sm font-bold text-gray-900">
                      Vas a acumular ToursRed Points
                    </h4>
                    <p className="text-xs text-gray-700">
                      Ganarás <span className="font-bold text-green-700">{Math.floor(userPayment + extrasTotalWithServiceCharge + effectiveInsuranceCost + membershipCost).toLocaleString()} puntos</span> con esta reserva
                    </p>
                  </div>
                </div>
              </div>
            )}
          </>
        )}

        {!isLoadingPoints && pointsBalance > 0 && totalTravelers > 0 && pointsWalletActive && hasMembership && (
          <div className="mb-4 bg-gradient-to-br from-amber-50 to-yellow-50 border-2 border-amber-300 rounded-lg p-4">
            <div className="flex items-start mb-3">
              <Award className="h-5 w-5 text-amber-600 mr-2 flex-shrink-0 mt-0.5" />
              <div className="flex-1">
                <h4 className="text-sm font-bold text-gray-900 mb-1">
                  ToursRed Points Disponibles
                </h4>
                <p className="text-xs text-gray-700">
                  Tienes {pointsBalance.toLocaleString()} puntos ({formatCurrencyMXN(pointsBalance / 100)} MXN). Usa hasta el 50% del total con puntos.
                </p>
              </div>
            </div>

            <label className="flex items-start cursor-pointer mb-3">
              <input
                type="checkbox"
                checked={useToursRedPoints}
                onChange={(e) => {
                  setUseToursRedPoints(e.target.checked);
                  if (!e.target.checked) {
                    setPointsToUse(0);
                  } else {
                    setPointsToUse(Math.min(pointsBalance, maxPointsAllowed));
                  }
                }}
                className="mt-1 h-4 w-4 text-amber-600 focus:ring-amber-500 border-gray-300 rounded"
              />
              <span className="ml-3 text-sm font-medium text-gray-900">
                Usar mis ToursRed Points
              </span>
            </label>

            {useToursRedPoints && (
              <div className="space-y-3">
                <div>
                  <div className="flex justify-between text-xs text-gray-600 mb-2">
                    <span>Puntos a usar:</span>
                    <span className="font-medium">{pointsApplied.toLocaleString()} puntos</span>
                  </div>
                  <input
                    type="range"
                    min="0"
                    max={Math.min(pointsBalance, maxPointsAllowed)}
                    value={pointsToUse}
                    onChange={(e) => setPointsToUse(parseInt(e.target.value))}
                    className="w-full h-2 bg-amber-200 rounded-lg appearance-none cursor-pointer slider-thumb"
                    style={{
                      background: `linear-gradient(to right, rgb(217, 119, 6) 0%, rgb(217, 119, 6) ${(pointsApplied / Math.min(pointsBalance, maxPointsAllowed)) * 100}%, rgb(253, 230, 138) ${(pointsApplied / Math.min(pointsBalance, maxPointsAllowed)) * 100}%, rgb(253, 230, 138) 100%)`
                    }}
                  />
                  <div className="flex justify-between text-xs text-gray-500 mt-1">
                    <span>0</span>
                    <span>{Math.min(pointsBalance, maxPointsAllowed).toLocaleString()}</span>
                  </div>
                </div>

                <div className="bg-white rounded-md p-3 border border-amber-200 space-y-2">
                  <div className="flex justify-between text-sm">
                    <span className="text-gray-700">Descuento con puntos:</span>
                    <span className="font-bold text-amber-600">
                      -{formatCurrencyMXN(pointsDiscountAmount)} MXN
                    </span>
                  </div>
                  <div className="flex justify-between text-xs text-gray-600">
                    <span>Máximo permitido (50%):</span>
                    <span className="font-medium">
                      {maxPointsAllowed.toLocaleString()} puntos ({formatCurrencyMXN(maxPointsAllowed / 100)})
                    </span>
                  </div>
                  <div className="flex justify-between text-xs text-gray-600">
                    <span>Saldo restante:</span>
                    <span className="font-medium">
                      {(pointsBalance - pointsApplied).toLocaleString()} puntos
                    </span>
                  </div>
                </div>

                {pointsApplied >= maxPointsAllowed && (
                  <div className="bg-amber-100 border border-amber-300 rounded-md p-2">
                    <p className="text-xs text-amber-800 font-medium text-center">
                      ℹ Has alcanzado el límite del 50% con puntos
                    </p>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {!isLoadingPoints && pointsBalance > 0 && !pointsWalletActive && totalTravelers > 0 && (
          <div className="mb-4 bg-orange-50 border-2 border-orange-300 rounded-lg p-4">
            <div className="flex items-start">
              <Award className="h-5 w-5 text-orange-600 mr-2 flex-shrink-0 mt-0.5" />
              <div className="flex-1">
                <h4 className="text-sm font-bold text-orange-900 mb-1">
                  Reactiva tu Membresía para Usar Puntos
                </h4>
                <p className="text-xs text-orange-800">
                  Tienes {pointsBalance.toLocaleString()} puntos disponibles, pero necesitas una membresía ToursRed+ activa para usarlos. {' '}
                  <Link to="/traveler/membership" className="underline font-medium">
                    Reactivar membresía
                  </Link>
                </p>
              </div>
            </div>
          </div>
        )}

        {!isLoadingWallet && walletBalance > 0 && totalTravelers > 0 && (
          <div className="mb-4 bg-gradient-to-br from-amber-50 to-orange-50 border-2 border-amber-200 rounded-lg p-4">
            <div className="flex items-start mb-3">
              <Wallet className="h-5 w-5 text-amber-600 mr-2 flex-shrink-0 mt-0.5" />
              <div className="flex-1">
                <h4 className="text-sm font-bold text-gray-900 mb-1">
                  Saldo ToursRed Cash Disponible
                </h4>
                <p className="text-xs text-gray-700">
                  Tienes {formatCurrencyMXN(walletBalance)} MXN disponibles. Úsalos para reducir el total a pagar.
                </p>
              </div>
            </div>

            <label className="flex items-start cursor-pointer">
              <input
                type="checkbox"
                checked={useToursRedCash}
                onChange={(e) => setUseToursRedCash(e.target.checked)}
                className="mt-1 h-4 w-4 text-amber-600 focus:ring-amber-500 border-gray-300 rounded"
              />
              <span className="ml-3 text-sm font-medium text-gray-900">
                Usar mi saldo de ToursRed Cash
              </span>
            </label>

            {useToursRedCash && (
              <div className="mt-3 bg-white rounded-md p-3 border border-amber-200">
                <div className="flex justify-between text-sm">
                  <span className="text-gray-700">Se aplicarán:</span>
                  <span className="font-bold text-amber-600">
                    -{formatCurrencyMXN(toursRedCashApplied)} MXN
                  </span>
                </div>
                <div className="flex justify-between text-xs text-gray-600 mt-1">
                  <span>Saldo restante después de esta reserva:</span>
                  <span className="font-medium">
                    {formatCurrencyMXN(walletBalance - toursRedCashApplied)} MXN
                  </span>
                </div>
              </div>
            )}
          </div>
        )}

        {totalTravelers > 0 && user && isTraveler && (
          <div className="mb-4">
            {appliedDiscount ? (
              <div className="bg-green-50 border-2 border-green-300 rounded-lg p-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center">
                    <Ticket className="h-5 w-5 text-green-600 mr-2" />
                    <div>
                      <span className="text-sm font-bold text-green-800">{appliedDiscount.code}</span>
                      <span className="text-sm text-green-700 ml-2">
                        {isServiceFeeDiscount
                          ? appliedDiscount.discount_type === 'service_fee_full'
                            ? 'Cargo por Servicio Gratis'
                            : appliedDiscount.discount_type === 'service_fee_percentage'
                              ? `${appliedDiscount.discount_value}% desc. en Cargo por Servicio`
                              : `$${appliedDiscount.discount_value} desc. en Cargo por Servicio`
                          : appliedDiscount.discount_type.includes('percentage')
                            ? `${appliedDiscount.discount_value}% de descuento`
                            : `$${appliedDiscount.discount_value} de descuento`}
                      </span>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={handleRemoveDiscount}
                    className="text-green-600 hover:text-green-800 p-1"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
                {isServiceFeeDiscount && serviceChargeDiscountAmount > 0 && (
                  <p className="text-xs text-green-700 mt-1 ml-7">
                    Ahorro en Cargo por Servicio: -{formatCurrencyMXN(serviceChargeDiscountAmount)} MXN
                  </p>
                )}
                {!isServiceFeeDiscount && discountAmount > 0 && (
                  <p className="text-xs text-green-700 mt-1 ml-7">
                    Ahorro: -{formatCurrencyMXN(discountAmount)} MXN
                    {appliedDiscount.discount_applies_to === 'payment_amount' ? ' (sobre monto a pagar)' : ' (sobre costo total)'}
                  </p>
                )}
              </div>
            ) : (
              <div className="bg-gray-50 border border-gray-200 rounded-lg p-4">
                <div className="flex items-center mb-2">
                  <Ticket className="h-4 w-4 text-gray-500 mr-2" />
                  <span className="text-sm font-medium text-gray-700">Codigo de descuento</span>
                </div>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={discountCodeInput}
                    onChange={(e) => {
                      setDiscountCodeInput(e.target.value.toUpperCase());
                      setDiscountCodeError('');
                    }}
                    placeholder="Ingresa tu codigo"
                    className="flex-1 px-3 py-2 border border-gray-300 rounded-md text-sm uppercase focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        handleApplyDiscountCode();
                      }
                    }}
                  />
                  <button
                    type="button"
                    onClick={handleApplyDiscountCode}
                    disabled={isValidatingCode || !discountCodeInput.trim()}
                    className="px-4 py-2 bg-primary-600 text-white rounded-md text-sm font-medium hover:bg-primary-700 disabled:bg-gray-300 disabled:cursor-not-allowed flex items-center"
                  >
                    {isValidatingCode ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      'Aplicar'
                    )}
                  </button>
                </div>
                {discountCodeError && (
                  <p className="text-xs text-red-600 mt-1">{discountCodeError}</p>
                )}
              </div>
            )}
          </div>
        )}

        {totalTravelers > 0 && (
          <div className="mb-4 bg-gray-50 p-4 rounded-md space-y-2">
            <h4 className="text-sm font-semibold text-gray-900">Desglose de Costos</h4>

            {isPrivateTransfer && (tour as any).transfer_pricing_mode === 'per_vehicle' ? (
              <div className="flex justify-between text-sm">
                <span className="text-gray-600">Precio por vehículo ({totalTravelers} viajero{totalTravelers !== 1 ? 's' : ''}):</span>
                <span className="font-medium">{formatCurrencyMXN(grossTourPrice)}</span>
              </div>
            ) : (
              <>
                {travelerCounts.adultos > 0 && (
                  <div className="flex justify-between text-sm">
                    <span className="text-gray-600">{travelerCounts.adultos} Adulto{travelerCounts.adultos > 1 ? 's' : ''} × {formatCurrencyMXN(getPrecioPorCategoria('adulto'))}:</span>
                    <span className="font-medium">{formatCurrencyMXN(precioAdultos)}</span>
                  </div>
                )}

                {travelerCounts.ninos > 0 && (
                  <div className="flex justify-between text-sm">
                    <span className="text-gray-600">{travelerCounts.ninos} Niño{travelerCounts.ninos > 1 ? 's' : ''} × {formatCurrencyMXN(getPrecioPorCategoria('nino'))}:</span>
                    <span className="font-medium">{formatCurrencyMXN(precioNinos)}</span>
                  </div>
                )}

                {travelerCounts.infantes > 0 && (
                  <div className="flex justify-between text-sm">
                    <span className="text-gray-600">{travelerCounts.infantes} Infante{travelerCounts.infantes > 1 ? 's' : ''} × {formatCurrencyMXN(getPrecioPorCategoria('infante'))}:</span>
                    <span className="font-medium">{formatCurrencyMXN(precioInfantes)}</span>
                  </div>
                )}

                {travelerCounts.adultos_mayores > 0 && (
                  <div className="flex justify-between text-sm">
                    <span className="text-gray-600">{travelerCounts.adultos_mayores} Adulto{travelerCounts.adultos_mayores > 1 ? 's' : ''} Mayor{travelerCounts.adultos_mayores > 1 ? 'es' : ''} × {formatCurrencyMXN(getPrecioPorCategoria('adulto_mayor'))}:</span>
                    <span className="font-medium">{formatCurrencyMXN(precioAdultosMayores)}</span>
                  </div>
                )}

                {travelerCounts.mascotas > 0 && (
                  <div className="flex justify-between text-sm">
                    <span className="text-gray-600">{travelerCounts.mascotas} Mascota{travelerCounts.mascotas > 1 ? 's' : ''} × {formatCurrencyMXN(getPrecioPorCategoria('mascota'))}:</span>
                    <span className="font-medium">{formatCurrencyMXN(precioMascotas)}</span>
                  </div>
                )}
              </>
            )}

            {promoResult.isActive && promoDiscountAmount > 0 && (
              <div className="flex justify-between text-sm text-rose-600 border-t pt-2 mt-1">
                <span className="flex items-center gap-1">
                  <Tag className="h-3 w-3" />
                  {promoResult.label}:
                </span>
                <span className="font-medium">-{formatCurrencyMXN(promoDiscountAmount)}</span>
              </div>
            )}

            {optionalServicesSubtotal > 0 && (
              <div className="border-t pt-2 mt-1 space-y-1">
                <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Servicios Adicionales</div>
                {optionalServices
                  .filter(svc => (optionalServiceQuantities[svc.id] || 0) > 0)
                  .map(svc => {
                    const qty = optionalServiceQuantities[svc.id];
                    return (
                      <div key={svc.id} className="flex justify-between text-sm">
                        <span className="text-gray-600 flex items-center gap-1">
                          {svc.name} × {qty}
                          {!svc.is_refundable && (
                            <span className="text-orange-600 text-xs">(no reemb.)</span>
                          )}
                        </span>
                        <span className="font-medium">{formatCurrencyMXN(qty * svc.price_per_person)}</span>
                      </div>
                    );
                  })
                }
              </div>
            )}

            {receptivoExtrasSubtotal > 0 && (
              <div className="border-t pt-2 mt-1 space-y-1">
                <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Extras Receptivo</div>
                {pickupExtraCost > 0 && selectedZoneData && (
                  <div className="flex justify-between text-sm">
                    <span className="text-gray-600 flex items-center gap-1">
                      <Car className="w-3 h-3" />
                      Pick Up — {selectedZoneData.name} ({selectedZoneData.cost_type === 'por_persona' ? 'por persona' : 'por reserva'}):
                    </span>
                    <span className="font-medium">{formatCurrencyMXN(pickupExtraCost)}</span>
                  </div>
                )}
                {languageExtraCost > 0 && selectedLanguageData && (
                  <div className="flex justify-between text-sm">
                    <span className="text-gray-600 flex items-center gap-1">
                      <Globe className="w-3 h-3" />
                      Idioma — {selectedLanguageData.language} ({selectedLanguageData.cost_type === 'por_persona' ? 'por persona' : 'fijo'}):
                    </span>
                    <span className="font-medium">{formatCurrencyMXN(languageExtraCost)}</span>
                  </div>
                )}
              </div>
            )}

            {extrasServiceChargeTotal > 0 && (
              <div className="border-t pt-2 mt-1">
                <div className="flex justify-between text-sm text-orange-600">
                  <span>Cargo por Servicio extras ({serviceChargePercentage}%):</span>
                  <span className="font-medium">+{formatCurrencyMXN(extrasServiceChargeTotal)}</span>
                </div>
              </div>
            )}

            <div className="border-t pt-2 mt-2">
              <div className="flex justify-between text-sm">
                <span className="text-gray-600">Precio Total del Tour:</span>
                <span className={`font-semibold ${appliedDiscount && appliedDiscount.discount_applies_to === 'total_price' ? 'line-through text-gray-400' : ''}`}>
                  {formatCurrencyMXN(grossTotalPrice)}
                </span>
              </div>
              {appliedDiscount && appliedDiscount.discount_applies_to === 'total_price' && discountAmount > 0 && (
                <>
                  <div className="flex justify-between text-sm text-green-600">
                    <span className="flex items-center">
                      <Ticket className="h-3 w-3 mr-1" />
                      Descuento ({appliedDiscount.code}):
                    </span>
                    <span className="font-medium">-{formatCurrencyMXN(discountAmount)}</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-gray-600">Precio con descuento:</span>
                    <span className="font-semibold">{formatCurrencyMXN(totalPrice)}</span>
                  </div>
                </>
              )}
              <div className="flex justify-between text-sm mt-1">
                <span className="text-gray-600">
                  {hasPaymentPlan && selectedPaymentMode === 'plan'
                    ? payPlanMode === 'free_form' ? 'Abono inicial (libre)' : 'Mínimo al reservar'
                    : (tourPaymentOption === 'full_upfront' || (hasPaymentPlan && selectedPaymentMode === 'full'))
                      ? 'Pago total (100%)'
                      : `Depósito (${effectiveDepositPercentage}%)`}:
                </span>
                <span className="font-medium">{formatCurrencyMXN(effectiveDepositAmount)}</span>
              </div>

              {(() => {
                const showCodeDiscount = isServiceFeeDiscount && serviceChargeDiscountAmount > 0;
                const chargeFullyWaived = shouldWaiveServiceCharge && !hasReachedExemptionLimit && !showCodeDiscount;
                const chargeFullyFreeByCode = showCodeDiscount && serviceChargeAfterCodeDiscount === 0;

                if (chargeFullyFreeByCode) {
                  return (
                    <>
                      <div className="flex justify-between text-sm text-gray-600 mt-1">
                        <span>Cargo por Servicio ({serviceChargePercentage}%):</span>
                        <span className="font-medium line-through text-gray-400">{formatCurrencyMXN(fullServiceCharge)}</span>
                      </div>
                      <div className="flex justify-between text-sm text-green-600">
                        <span className="flex items-center">
                          <Ticket className="h-3 w-3 mr-1" />
                          Descuento ({appliedDiscount!.code}):
                        </span>
                        <span className="font-medium">-{formatCurrencyMXN(serviceChargeDiscountAmount)}</span>
                      </div>
                    </>
                  );
                }

                if (showCodeDiscount) {
                  return (
                    <>
                      <div className="flex justify-between text-sm text-gray-600 mt-1">
                        <span>Cargo por Servicio ({serviceChargePercentage}%):</span>
                        <span className="font-medium">{formatCurrencyMXN(fullServiceCharge)}</span>
                      </div>
                      <div className="flex justify-between text-sm text-green-600">
                        <span className="flex items-center">
                          <Ticket className="h-3 w-3 mr-1" />
                          Descuento ({appliedDiscount!.code}):
                        </span>
                        <span className="font-medium">-{formatCurrencyMXN(serviceChargeDiscountAmount)}</span>
                      </div>
                      {shouldWaiveServiceCharge && exemptionUsed > 0 && (
                        <div className="flex justify-between text-sm text-green-600">
                          <span className="flex items-center">
                            <Crown className="h-3 w-3 mr-1" />
                            Descuento ToursRed+:
                          </span>
                          <span className="font-medium">-{formatCurrencyMXN(exemptionUsed)}</span>
                        </div>
                      )}
                      {serviceCharge > 0 ? (
                        <div className="flex justify-between text-sm text-orange-600">
                          <span>Cargo por Servicio (a pagar):</span>
                          <span className="font-medium">+{formatCurrencyMXN(serviceCharge)}</span>
                        </div>
                      ) : (
                        <div className="flex justify-between text-sm text-green-600">
                          <span>Cargo por Servicio (a pagar):</span>
                          <span className="font-medium">$0</span>
                        </div>
                      )}
                    </>
                  );
                }

                if (chargeFullyWaived) {
                  return (
                    <div className="flex justify-between text-sm text-green-600 mt-1">
                      <span className="flex items-center">
                        <Crown className="h-3 w-3 mr-1" />
                        Cargo por Servicio ({serviceChargePercentage}%):
                      </span>
                      <span className="font-medium line-through text-gray-400">{formatCurrencyMXN(fullServiceCharge)}</span>
                    </div>
                  );
                }

                if (shouldWaiveServiceCharge && hasReachedExemptionLimit) {
                  return (
                    <>
                      <div className="flex justify-between text-sm text-gray-600 mt-1">
                        <span>Cargo por Servicio ({serviceChargePercentage}%):</span>
                        <span className="font-medium">{formatCurrencyMXN(fullServiceCharge)}</span>
                      </div>
                      {exemptionUsed > 0 && (
                        <div className="flex justify-between text-sm text-green-600">
                          <span className="flex items-center">
                            <Crown className="h-3 w-3 mr-1" />
                            Descuento ToursRed+:
                          </span>
                          <span className="font-medium">-{formatCurrencyMXN(exemptionUsed)}</span>
                        </div>
                      )}
                      <div className="flex justify-between text-sm text-orange-600">
                        <span>Cargo por Servicio (a pagar):</span>
                        <span className="font-medium">+{formatCurrencyMXN(serviceCharge)}</span>
                      </div>
                    </>
                  );
                }

                return (
                  <div className="flex justify-between text-sm text-orange-600 mt-1">
                    <span>Cargo por Servicio ({serviceChargePercentage}%):</span>
                    <span className="font-medium">+{formatCurrencyMXN(serviceCharge)}</span>
                  </div>
                );
              })()}

              {appliedDiscount && appliedDiscount.discount_applies_to === 'payment_amount' && discountAmount > 0 && (
                <div className="flex justify-between text-sm text-green-600 mt-1">
                  <span className="flex items-center">
                    <Ticket className="h-3 w-3 mr-1" />
                    Descuento ({appliedDiscount.code}):
                  </span>
                  <span className="font-medium">-{formatCurrencyMXN(discountAmount)}</span>
                </div>
              )}

              {addMembershipToBooking && (
                <div className="flex justify-between text-sm text-amber-600 mt-1">
                  <span className="flex items-center">
                    <Crown className="h-3 w-3 mr-1" />
                    Membresía ToursRed+ ({selectedMembershipPlan === 'monthly' ? 'Mensual' : 'Anual'}):
                  </span>
                  <span className="font-medium">+{formatCurrencyMXN(membershipCost)}</span>
                </div>
              )}

              {useToursRedPoints && pointsApplied > 0 && (
                <div className="flex justify-between text-sm text-amber-600 mt-1">
                  <span className="flex items-center">
                    <Award className="h-3 w-3 mr-1" />
                    ToursRed Points aplicados:
                  </span>
                  <span className="font-medium">-{formatCurrencyMXN(pointsDiscountAmount)} ({pointsApplied.toLocaleString()} pts)</span>
                </div>
              )}

              {useToursRedCash && toursRedCashApplied > 0 && (
                <div className="flex justify-between text-sm text-amber-600 mt-1">
                  <span className="flex items-center">
                    <Wallet className="h-3 w-3 mr-1" />
                    ToursRed Cash aplicado:
                  </span>
                  <span className="font-medium">-{formatCurrencyMXN(toursRedCashApplied)}</span>
                </div>
              )}

              {/* Seguro de viaje en el desglose */}
              {includeInsurance && insuranceCost > 0 && (
                <>
                  <div className="flex justify-between text-sm text-emerald-700 mt-1 border-t border-dashed border-emerald-200 pt-2">
                    <span className="flex items-center gap-1">
                      <Shield className="h-3 w-3" />
                      Seguro de viaje ({tourDays} día{tourDays !== 1 ? 's' : ''} × {Math.max(1, totalTravelers)} viajero{totalTravelers !== 1 ? 's' : ''}):
                    </span>
                    {appliedInsuranceDiscount ? (
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-emerald-400 line-through">+{formatCurrencyMXN(insuranceCost)}</span>
                        <span className="font-medium text-emerald-700">+{formatCurrencyMXN(effectiveInsuranceCost)}</span>
                      </div>
                    ) : (
                      <span className="font-medium">+{formatCurrencyMXN(insuranceCost)}</span>
                    )}
                  </div>
                  {appliedInsuranceDiscount && (
                    <div className="flex justify-between text-xs text-emerald-600">
                      <span className="flex items-center gap-1 pl-4">
                        Descuento seguro ({appliedInsuranceDiscount.code}):
                      </span>
                      <span>-{formatCurrencyMXN(insuranceDiscountAmount)}</span>
                    </div>
                  )}
                </>
              )}
              {!includeInsurance && (
                <div className="flex items-center gap-1 text-xs text-gray-400 mt-1 border-t border-dashed border-gray-100 pt-2">
                  <ShieldOff className="h-3 w-3" />
                  <span>Sin seguro de viaje</span>
                </div>
              )}
            </div>

            <div className="border-t pt-2 flex justify-between">
              <span className="font-bold text-gray-900">Total a Pagar Ahora:</span>
              <span className="font-bold text-primary-600 text-lg">{formatCurrencyMXN(totalToPayNow)}</span>
            </div>

            {shouldWaiveServiceCharge && exemptionUsed > 0 && (
              <div className="bg-green-50 border border-green-200 rounded-md p-2 mt-2">
                <p className="text-xs text-green-800 font-medium text-center">
                  ✓ Ahorraste {formatCurrencyMXN(exemptionUsed)} con ToursRed+
                  {hasReachedExemptionLimit && (
                    <span className="block text-[10px] text-gray-600 mt-0.5">
                      (Límite mensual: {formatCurrency(remainingExemption)} restantes de $500.00)
                    </span>
                  )}
                </p>
              </div>
            )}

            <div className="text-xs text-gray-500 mt-2">
              <div>Saldo Restante: {formatCurrencyMXN(grossTotalPrice - depositAmount - (appliedDiscount?.discount_applies_to === 'total_price' ? discountAmount : 0))}</div>
            </div>
          </div>
        )}

        {totalTravelers > 0 && user && isTraveler && totalToPayNow > 0 && (
          <PaymentProviderSelector
            context={addMembershipToBooking ? 'booking_with_membership' : 'booking'}
            value={paymentProvider}
            onChange={setPaymentProvider}
            disabled={isSubmitting}
          />
        )}

        {bookingDeadlinePassed && (
          <div className="mb-4 bg-yellow-50 border border-yellow-200 rounded-md p-3 flex items-start">
            <AlertCircle className="h-5 w-5 text-yellow-600 mr-2 flex-shrink-0 mt-0.5" />
            <div className="text-sm text-yellow-800">
              <p className="font-medium">Fecha límite de reserva vencida</p>
              <p className="mt-1">Este tour ya no acepta nuevas reservas.</p>
            </div>
          </div>
        )}

        {error && (
          <div className="mb-4 bg-red-50 border border-red-200 rounded-md p-3 flex items-start">
            <AlertCircle className="h-5 w-5 text-red-600 mr-2 flex-shrink-0 mt-0.5" />
            <p className="text-sm text-red-800">{error}</p>
          </div>
        )}

        {tour.booking_approval_type === 'manual' && (
          <div className="mb-4 bg-blue-50 border border-blue-200 rounded-md p-3 flex items-start">
            <AlertCircle className="h-5 w-5 text-blue-600 mr-2 flex-shrink-0 mt-0.5" />
            <div className="text-sm text-blue-800">
              <p className="font-medium">Reserva con aprobación manual</p>
              <p className="mt-1">
                Esta reserva requiere aprobación de la agencia. Se te solicitará el pago una vez que tu reserva sea aprobada.
              </p>
            </div>
          </div>
        )}

        <button
          type="submit"
          disabled={isSubmitting || !isTraveler || bookingDeadlinePassed || availableSpots === 0 || totalTravelers === 0}
          className={`w-full py-3 px-4 rounded-md font-semibold flex items-center justify-center transition-colors ${
            isSubmitting || !isTraveler || bookingDeadlinePassed || availableSpots === 0 || totalTravelers === 0
              ? 'bg-gray-300 text-gray-500 cursor-not-allowed'
              : 'bg-primary-600 text-white hover:bg-primary-700'
          }`}
        >
          {isSubmitting ? (
            <>
              <div className="animate-spin rounded-full h-5 w-5 border-t-2 border-b-2 border-white mr-2"></div>
              Procesando...
            </>
          ) : tour.booking_approval_type === 'manual' ? (
            <>
              <Settings className="w-5 h-5 mr-2" />
              Enviar Solicitud de Reserva
            </>
          ) : totalToPayNow <= 0 ? (
            <>
              <Check className="w-5 h-5 mr-2" />
              Reservar Ahora
            </>
          ) : (
            <>
              <CreditCard className="w-5 h-5 mr-2" />
              Reservar Ahora
            </>
          )}
        </button>

        {!isTraveler && user && (
          <p className="mt-3 text-sm text-red-600 text-center">
            Solo los viajeros pueden realizar reservas
          </p>
        )}
      </form>
    </div>
  );
};

export default BookingForm;
