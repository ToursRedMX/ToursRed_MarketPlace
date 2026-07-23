import React, { useState, useEffect } from 'react';
import { useAuth } from '../../context/AuthContext';
import { useAgencyId } from '../../hooks/useAgencyId';
import { createTour, searchDestinations, supabase, updateTour, deleteTour, getAllDestinations, createDestination, getTourCategories, getFeaturedPlans, getAgencyFeaturedSlots, joinFeaturedWaitlist, checkSlugAvailable, updateTourSlug } from '../../lib/supabase';
import { Plus, Search, X, CreditCard, Trash2, Eye, Calendar, MapPin, Users, DollarSign, Save, Minus, Upload, Copy, CalendarX, AlertCircle, XCircle, FileText, Image, CheckSquare, Tag, PawPrint, Clock, Settings, List, Ban, ShoppingBag, Info, Percent, Route, RefreshCw, Layers, Car, Globe, AlertTriangle, Bus, Pencil, Sparkles, Star, TrendingUp, CheckCircle, Loader2, Lock, ChevronDown, Shield } from 'lucide-react';
import { VehicleMapType } from '../../types/seats';
import TourPromotionsManager from '../../components/TourPromotionsManager';
import AgencyScheduleManager from '../../components/receptivo/AgencyScheduleManager';
import AgencyBlackoutManager from '../../components/receptivo/AgencyBlackoutManager';
import AgencySlotCalendar from '../../components/receptivo/AgencySlotCalendar';
import SeatMapManager from '../../components/seats/SeatMapManager';
import { TourType, ReceptivoModality, CancellationPolicy, ActivityType } from '../../types';

interface OptionalService {
  id?: string;
  name: string;
  description: string;
  price_per_person: string;
  max_capacity: string;
  is_refundable: boolean;
  is_active: boolean;
}

interface TourSupplement {
  id?: string;
  name: string;
  description: string;
  price: string;
  max_capacity: string;
  requires_approval: boolean;
  is_cancellable: boolean;
  is_active: boolean;
}

interface ScheduleDraft {
  id?: string;
  departure_time: string;
  label: string;
  slot_capacity: string;
  days_of_week: number[];
  is_active: boolean;
}

interface PickupZone {
  name: string;
  extra_cost: string;
  cost_type: 'por_persona' | 'por_reserva';
}

interface TourLanguage {
  language: string;
  extra_cost: string;
  cost_type: 'por_persona' | 'fijo';
}
import { Tour, Destination, DeparturePoint, PaymentOption, PaymentPlanMode, InstallmentDefinition } from '../../types';
import { format } from 'date-fns';
import ImageUploader from '../../components/ImageUploader';
import DeparturePointSelector from '../../components/DeparturePointSelector';
import DeparturePointForm from '../../components/DeparturePointForm';

interface TourCategory {
  id: string;
  name: string;
  slug: string;
  description?: string;
}

interface SelectedDeparturePoint extends DeparturePoint {
  display_order: number;
  departure_time?: string;
  special_instructions?: string;
}

const AgencyTours: React.FC = () => {
  const { user, isAgencyStaff, staffInfo } = useAuth();
  const { agencyId: resolvedAgencyId } = useAgencyId();
  const canCreate = !isAgencyStaff || (staffInfo?.permissions.canManageTours ?? false);
  const canEdit = !isAgencyStaff || (staffInfo?.permissions.canEditTours ?? false) || (staffInfo?.permissions.canManageTours ?? false);
  const canDelete = !isAgencyStaff || (staffInfo?.permissions.canManageTours ?? false);
  const [tours, setTours] = useState<Tour[]>([]);
  const [categories, setCategories] = useState<TourCategory[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isCreating, setIsCreating] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<any[]>([]);
  const [selectedDestinations, setSelectedDestinations] = useState<{id: string, name: string}[]>([]);
  const [allAvailableDestinations, setAllAvailableDestinations] = useState<Destination[]>([]);
  const [showSearchResults, setShowSearchResults] = useState(false);
  const [editingTour, setEditingTour] = useState<Tour | null>(null);
  const [duplicatingTour, setDuplicatingTour] = useState<Tour | null>(null);
  const [isAgencyApproved, setIsAgencyApproved] = useState(true);
  const [duplicateFormData, setDuplicateFormData] = useState({
    name: '',
    start_date: '',
    end_date: '',
    booking_deadline: '',
  });

  const [rescheduleModal, setRescheduleModal] = useState<{
    open: boolean;
    tour: Tour | null;
    activeBookingsCount: number;
    isLoading: boolean;
    isSubmitting: boolean;
    error: string;
    success: boolean;
  }>({
    open: false,
    tour: null,
    activeBookingsCount: 0,
    isLoading: false,
    isSubmitting: false,
    error: '',
    success: false,
  });

  const [rescheduleFormData, setRescheduleFormData] = useState({
    new_start_date: '',
    new_end_date: '',
    reschedule_reason: '',
  });

  const [editingTourHasActiveBookings, setEditingTourHasActiveBookings] = useState(false);
  const [editingSlug, setEditingSlug] = useState('');
  const [originalSlug, setOriginalSlug] = useState('');
  const [slugAvailable, setSlugAvailable] = useState<boolean | null>(null);
  const [slugConfirm, setSlugConfirm] = useState(false);
  const [slugSaving, setSlugSaving] = useState(false);

  const [cancelModal, setCancelModal] = useState<{
    open: boolean;
    tour: Tour | null;
    activeBookingsCount: number;
    isLoading: boolean;
    isSubmitting: boolean;
    error: string;
    success: boolean;
  }>({
    open: false,
    tour: null,
    activeBookingsCount: 0,
    isLoading: false,
    isSubmitting: false,
    error: '',
    success: false,
  });

  const [cancelFormData, setCancelFormData] = useState({
    cancellation_reason: '',
  });

  const [seatMapModal, setSeatMapModal] = useState<{
    open: boolean;
    tour: Tour | null;
  }>({ open: false, tour: null });

  const [featuredModal, setFeaturedModal] = useState<{
    open: boolean;
    tour: Tour | null;
    plans: any[];
    activeSlot: any | null;
    isLoading: boolean;
    isSubmitting: boolean;
    selectedPlanId: string;
    error: string;
    success: string;
    // payment flow
    step: 'plan' | 'payment' | 'done';
    couponExpanded: boolean;
    pendingSlotId: string;
    selectedProvider: 'stripe' | 'mercadopago' | 'paypal';
    couponCode: string;
    couponError: string;
    couponDiscount: number;
    couponType: string;
    couponApplied: boolean;
    couponIsValidating: boolean;
  }>({
    open: false,
    tour: null,
    plans: [],
    activeSlot: null,
    isLoading: false,
    isSubmitting: false,
    selectedPlanId: '',
    error: '',
    success: '',
    step: 'plan',
    couponExpanded: false,
    pendingSlotId: '',
    selectedProvider: 'stripe',
    couponCode: '',
    couponError: '',
    couponDiscount: 0,
    couponType: '',
    couponApplied: false,
    couponIsValidating: false,
  });

  const [receptivoActionsModal, setReceptivoActionsModal] = useState<{
    open: boolean;
    tour: Tour | null;
    action: 'slot-cancel' | 'slot-reschedule' | 'full-cancel' | null;
    slots: any[];
    selectedSlot: any | null;
    isLoadingSlots: boolean;
    isSubmitting: boolean;
    error: string;
    success: boolean;
    reason: string;
    newSlotDate: string;
    newSlotTime: string;
    bookingsInSlot: number;
    bookingsCountInSlot: number;
  }>({
    open: false,
    tour: null,
    action: null,
    slots: [],
    selectedSlot: null,
    isLoadingSlots: false,
    isSubmitting: false,
    error: '',
    success: false,
    reason: '',
    newSlotDate: '',
    newSlotTime: '',
    bookingsInSlot: 0,
    bookingsCountInSlot: 0,
  });

  const [capacityConflictModal, setCapacityConflictModal] = useState<{
    open: boolean;
    targetSlot: { id: string; slot_date: string; departure_time: string; capacity: number; booked_count: number; available_spots: number } | null;
    affectedTravelers: number;
    spotsNeeded: number;
    originalSlotId: string;
    tourId: string;
    reason: string;
    resolution: 'new_slot' | 'expand_capacity' | 'refund' | null;
    newSlotTime: string;
    isSubmitting: boolean;
    error: string;
    success: boolean;
  }>({
    open: false,
    targetSlot: null,
    affectedTravelers: 0,
    spotsNeeded: 0,
    originalSlotId: '',
    tourId: '',
    reason: '',
    resolution: null,
    newSlotTime: '',
    isSubmitting: false,
    error: '',
    success: false,
  });

  const [tourListTab, setTourListTab] = useState<'activos' | 'finalizados'>('activos');
  const [finishedTours, setFinishedTours] = useState<Tour[]>([]);
  const [isLoadingFinished, setIsLoadingFinished] = useState(false);
  const [finishedLoaded, setFinishedLoaded] = useState(false);

  const [tourType, setTourType] = useState<TourType>('excursion');
  const [receptivoModality, setReceptivoModality] = useState<ReceptivoModality>('compartido');
  const [activityType, setActivityType] = useState<'guided_tour' | 'experience' | 'transport' | 'ticket'>('guided_tour');
  const [transferType, setTransferType] = useState<string>('');
  const [transferCustomTime, setTransferCustomTime] = useState(false);
  const [transferPricingMode, setTransferPricingMode] = useState<'per_person' | 'per_vehicle'>('per_person');
  const [privateVehicleCapacity, setPrivateVehicleCapacity] = useState('');
  const [transportOriginPoints, setTransportOriginPoints] = useState<SelectedDeparturePoint[]>([]);
  const [transportDestinationPoints, setTransportDestinationPoints] = useState<SelectedDeparturePoint[]>([]);
  const [transportServiceInfo, setTransportServiceInfo] = useState('');
  const [estimatedMinutes, setEstimatedMinutes] = useState('');
  const [experienceEnvironment, setExperienceEnvironment] = useState<string[]>([]);
  const [participationLevel, setParticipationLevel] = useState('');
  const [localHost, setLocalHost] = useState(false);
  const [uniqueExperience, setUniqueExperience] = useState('');
  const [specialRequirements, setSpecialRequirements] = useState('');
  const [ticketType, setTicketType] = useState('');
  const [ticketValidityType, setTicketValidityType] = useState<'open' | 'fixed_date' | 'date_range'>('open');
  const [ticketValidFrom, setTicketValidFrom] = useState('');
  const [ticketValidTo, setTicketValidTo] = useState('');
  const [ticketRedemptionMethod, setTicketRedemptionMethod] = useState('');
  const [ticketDeliveryMethod, setTicketDeliveryMethod] = useState('');
  const [ticketAccessInstructions, setTicketAccessInstructions] = useState('');
  const [ticketServiceInfo, setTicketServiceInfo] = useState('');
  const [receptivoTab, setReceptivoTab] = useState<'info' | 'horarios' | 'bloqueos' | 'calendario' | 'asientos'>('info');
  const [receptivoData, setReceptivoData] = useState({
    operating_days: [] as number[],
    operating_months: [] as number[],
    min_advance_booking_hours: '24',
    max_advance_booking_days: '90',
    slot_duration_days: '1',
    default_slot_capacity: '',
    cancellation_policy: 'moderada' as CancellationPolicy,
    cancellation_hours_limit: '48',
    cancellation_refund_percentage: '80',
    flexible_hours: '48',
    flexible_refund_percentage: '100',
    moderate_hours: '24',
    moderate_refund_percentage: '50',
    min_travelers_required: '1',
    min_travelers_confirmation_hours: '24',
  });

  const [formData, setFormData] = useState({
    name: '',
    category: ['adventure'] as string[],
    description: '',
    itinerary: '',
    price: '',
    deposit_percentage: '',
    image_url: '',
    start_date: '',
    end_date: '',
    max_travelers: '',
    available_spots: '',
    booking_deadline: '',
    booking_approval_type: 'automatic',
    cancellation_not_allowed: false,
    name_changes_not_allowed: false,
    includes_insurance: false,
    pet_friendly: false,
    precio_adulto: '',
    precio_nino: '',
    precio_infante: '',
    precio_adulto_mayor: '',
    precio_mascota: '',
    admite_infantes: true,
    admite_ninos: true,
    admite_adultos: true,
    admite_adultos_mayores: true,
    vehicle_map_type: null as VehicleMapType | null,
    preventa_activa: false,
    preventa_inicio: '',
    preventa_fin: '',
    preventa_precio_especial: false,
    preventa_tipo_descuento: 'porcentaje' as 'monto' | 'porcentaje',
    preventa_descuento_valor: '',
    payment_option: 'standard' as PaymentOption,
    full_payment_days_before_departure: '15',
    payment_plan_mode: 'installments' as PaymentPlanMode,
    late_payment_grace_days: '5',
    late_payment_penalty_pct: '0',
    late_payment_penalty_fixed: '0',
  });

  const VEHICLE_OPTIONS: { type: VehicleMapType; label: string; capacity: number; description: string }[] = [
    { type: 'sprinter_20', label: 'Sprinter / Van', capacity: 20, description: '20 pasajeros' },
    { type: 'bus_50', label: 'Autobus', capacity: 50, description: '50 pasajeros' },
  ];

  const [includes, setIncludes] = useState<string[]>(['']);
  const [excludes, setExcludes] = useState<string[]>(['']);
  const [departurePoints, setDeparturePoints] = useState<string[]>(['']);
  const [selectedDeparturePoints, setSelectedDeparturePoints] = useState<SelectedDeparturePoint[]>([]);
  const [showCreateDepartureForm, setShowCreateDepartureForm] = useState(false);
  const [hasDraft, setHasDraft] = useState(false);
  const [optionalServices, setOptionalServices] = useState<OptionalService[]>([]);
  const [supplements, setSupplements] = useState<TourSupplement[]>([]);
  type VencimientoMode = 'dias_reserva' | 'dias_salida' | 'fecha_especifica';
  interface InstallmentDefDraft {
    label: string;
    pct_of_total: string;
    days_after_booking: string;
    days_before_departure: string;
    specific_date: string;
    _vencimiento_mode: VencimientoMode;
  }
  const [installmentDefs, setInstallmentDefs] = useState<InstallmentDefDraft[]>([]);
  const [paymentOptionsEnabled, setPaymentOptionsEnabled] = useState(false);

  const [schedulesDraft, setSchedulesDraft] = useState<ScheduleDraft[]>([]);
  const [scheduleForm, setScheduleForm] = useState<ScheduleDraft>({
    departure_time: '', label: '', slot_capacity: '', days_of_week: [], is_active: true,
  });
  const [showScheduleForm, setShowScheduleForm] = useState(false);
  const [editingScheduleIdx, setEditingScheduleIdx] = useState<number | null>(null);

  const [pickupAvailable, setPickupAvailable] = useState(false);
  const [pickupFreeZone, setPickupFreeZone] = useState('');
  const [pickupZones, setPickupZones] = useState<PickupZone[]>([]);

  const [tourLanguages, setTourLanguages] = useState<TourLanguage[]>([]);

  const [restrictionPregnant, setRestrictionPregnant] = useState(false);
  const [restrictionDisability, setRestrictionDisability] = useState(false);
  const [restrictionPhysical, setRestrictionPhysical] = useState(false);

  const DRAFT_KEY = `tour_draft_${user?.id}`;

  useEffect(() => {
    fetchAgencyTours();
    fetchAllDestinations();
    fetchCategories();
  }, [user?.id, resolvedAgencyId]);

  // Restaurar borrador al cargar
  useEffect(() => {
    if (!user) return;

    const savedDraft = localStorage.getItem(DRAFT_KEY);
    if (savedDraft && !editingTour && !isCreating) {
      try {
        const draft = JSON.parse(savedDraft);
        const draftAge = Date.now() - draft.timestamp;
        const maxAge = 7 * 24 * 60 * 60 * 1000; // 7 días

        if (draftAge < maxAge) {
          setHasDraft(true);
        } else {
          localStorage.removeItem(DRAFT_KEY);
        }
      } catch (error) {
        console.error('Error loading draft:', error);
        localStorage.removeItem(DRAFT_KEY);
      }
    }
  }, [user, DRAFT_KEY, editingTour, isCreating]);

  // Autoguardar borrador
  useEffect(() => {
    if (!isCreating || !user) return;

    const hasContent = formData.name ||
                      formData.description ||
                      formData.itinerary ||
                      selectedDestinations.length > 0 ||
                      selectedDeparturePoints.length > 0;

    if (!hasContent) return;

    const draft = {
      formData,
      includes,
      excludes,
      selectedDestinations,
      selectedDeparturePoints,
      timestamp: Date.now(),
    };

    const timer = setTimeout(() => {
      localStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
    }, 1000);

    return () => clearTimeout(timer);
  }, [isCreating, formData, includes, excludes, selectedDestinations, selectedDeparturePoints, user, DRAFT_KEY]);

  // Prevenir pérdida de datos al salir de la página
  useEffect(() => {
    if (!isCreating) return;

    const hasContent = formData.name ||
                      formData.description ||
                      formData.itinerary ||
                      selectedDestinations.length > 0 ||
                      selectedDeparturePoints.length > 0;

    if (!hasContent) return;

    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };

    window.addEventListener('beforeunload', handleBeforeUnload);

    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
    };
  }, [isCreating, formData, selectedDestinations, selectedDeparturePoints]);

  useEffect(() => {
    const searchDestinationsDebounced = setTimeout(async () => {
      if (searchQuery.length >= 2) {
        const { data, error } = await searchDestinations(searchQuery);
        if (!error && data) {
          setSearchResults(data);
          setShowSearchResults(true);
        }
      } else {
        setSearchResults([]);
        setShowSearchResults(false);
      }
    }, 300);

    return () => clearTimeout(searchDestinationsDebounced);
  }, [searchQuery]);

  const fetchAllDestinations = async () => {
    try {
      const { data, error } = await getAllDestinations();
      if (error) throw error;
      setAllAvailableDestinations(data || []);
    } catch (err: any) {
      console.error('❌ Error cargando destinos:', err);
    }
  };

  const fetchCategories = async () => {
    try {
      const { data, error } = await getTourCategories();
      if (error) throw error;
      setCategories(data || []);

      // Si hay categorías y el formData aún tiene el valor por defecto, actualizar
      if (data && data.length > 0 && formData.category[0] === 'adventure') {
        setFormData(prev => ({
          ...prev,
          category: [data[0].slug]
        }));
      }
    } catch (err: any) {
      console.error('❌ Error cargando categorías:', err);
    }
  };

  const fetchAgencyTours = async () => {
    if (!user?.id || !resolvedAgencyId) return;

    try {
      setIsLoading(true);
      setError('');

      // Verificar si la agencia está aprobada
      const { data: userData, error: userError } = await supabase
        .from('users')
        .select('is_approved')
        .eq('id', user.id)
        .maybeSingle();

      if (!userError && userData) {
        setIsAgencyApproved(userData.is_approved !== false);
      }

      // Obtener tours de la agencia usando el ID resuelto
      const today = new Date().toISOString().split('T')[0];
      const { data: toursData, error: toursError } = await supabase
        .from('tours')
        .select(`
          *,
          agencies(id, name, rating, commission_rate)
        `)
        .eq('agency_id', resolvedAgencyId)
        .or(`tour_type.eq.receptivo,end_date.gte.${today}`)
        .order('created_at', { ascending: false });

      if (toursError) {
        throw new Error(toursError.message);
      }

      console.log('✅ Tours cargados:', toursData);
      setTours(toursData || []);

    } catch (err: any) {
      console.error('❌ Error cargando tours de agencia:', err);
      setError(err.message || 'Error al cargar los tours');
    } finally {
      setIsLoading(false);
    }
  };

  const fetchFinishedTours = async () => {
    if (!resolvedAgencyId || finishedLoaded || isLoadingFinished) return;
    setIsLoadingFinished(true);
    try {
      const today = new Date().toISOString().split('T')[0];
      const { data } = await supabase
        .from('tours')
        .select(`*, agencies(id, name, rating, commission_rate)`)
        .eq('agency_id', resolvedAgencyId)
        .eq('tour_type', 'excursion')
        .lt('end_date', today)
        .order('end_date', { ascending: false })
        .limit(100);
      setFinishedTours((data as Tour[]) || []);
      setFinishedLoaded(true);
    } catch {
      // silent
    } finally {
      setIsLoadingFinished(false);
    }
  };

  const resetForm = () => {
    setTourType('excursion');
    setReceptivoModality('compartido');
    setActivityType('guided_tour');
    setTransferType('');
    setTransferCustomTime(false);
    setTransferPricingMode('per_person');
    setPrivateVehicleCapacity('');
    setTransportOriginPoints([]);
    setTransportDestinationPoints([]);
    setTransportServiceInfo('');
    setEstimatedMinutes('');
    setExperienceEnvironment([]);
    setParticipationLevel('');
    setLocalHost(false);
    setUniqueExperience('');
    setSpecialRequirements('');
    setTicketType('');
    setTicketValidityType('open');
    setTicketValidFrom('');
    setTicketValidTo('');
    setTicketRedemptionMethod('');
    setTicketDeliveryMethod('');
    setTicketAccessInstructions('');
    setTicketServiceInfo('');
    setReceptivoTab('info');
    setReceptivoData({
      operating_days: [],
      operating_months: [],
      min_advance_booking_hours: '24',
      max_advance_booking_days: '90',
      slot_duration_days: '1',
      default_slot_capacity: '',
      cancellation_policy: 'moderada',
      cancellation_hours_limit: '48',
      cancellation_refund_percentage: '80',
      min_travelers_required: '1',
      min_travelers_confirmation_hours: '24',
    });
    setFormData({
      name: '',
      category: categories.length > 0 ? [categories[0].slug] : [],
      description: '',
      itinerary: '',
      price: '',
      deposit_percentage: '',
      image_url: '',
      start_date: '',
      end_date: '',
      max_travelers: '',
      available_spots: '',
      booking_deadline: '',
      booking_approval_type: 'automatic',
      pet_friendly: false,
      includes_insurance: false,
      precio_adulto: '',
      precio_nino: '',
      precio_infante: '',
      precio_adulto_mayor: '',
      precio_mascota: '',
      admite_infantes: true,
      admite_ninos: true,
      admite_adultos: true,
      admite_adultos_mayores: true,
      preventa_activa: false,
      preventa_inicio: '',
      preventa_fin: '',
      preventa_precio_especial: false,
      preventa_tipo_descuento: 'porcentaje' as 'monto' | 'porcentaje',
      preventa_descuento_valor: '',
      payment_option: 'standard' as PaymentOption,
      full_payment_days_before_departure: '15',
      payment_plan_mode: 'installments' as PaymentPlanMode,
      late_payment_grace_days: '5',
      late_payment_penalty_pct: '0',
      late_payment_penalty_fixed: '0',
    });
    setInstallmentDefs([]);
    setPaymentOptionsEnabled(false);
    setSelectedDestinations([]);
    setSearchQuery('');
    setSearchResults([]);
    setShowSearchResults(false);
    setIncludes(['']);
    setExcludes(['']);
    setDeparturePoints(['']);
    setSelectedDeparturePoints([]);

    setOptionalServices([]);
    setSupplements([]);
    setSchedulesDraft([]);
    setScheduleForm({ departure_time: '', label: '', slot_capacity: '', days_of_week: [], is_active: true });
    setShowScheduleForm(false);
    setEditingScheduleIdx(null);
    setPickupAvailable(false);
    setPickupFreeZone('');
    setPickupZones([]);
    setTourLanguages([]);
    setRestrictionPregnant(false);
    setRestrictionDisability(false);
    setRestrictionPhysical(false);

    // Limpiar borrador guardado
    if (user) {
      localStorage.removeItem(DRAFT_KEY);
      setHasDraft(false);
    }
  };

  const loadDraft = () => {
    const savedDraft = localStorage.getItem(DRAFT_KEY);
    if (savedDraft) {
      try {
        const draft = JSON.parse(savedDraft);
        setFormData(draft.formData);
        setIncludes(draft.includes || ['']);
        setExcludes(draft.excludes || ['']);
        setSelectedDestinations(draft.selectedDestinations || []);
        setSelectedDeparturePoints(draft.selectedDeparturePoints || []);
        setHasDraft(false);
        setIsCreating(true);
      } catch (error) {
        console.error('Error loading draft:', error);
        localStorage.removeItem(DRAFT_KEY);
        setHasDraft(false);
      }
    }
  };

  const discardDraft = () => {
    if (confirm('¿Estás seguro de que deseas descartar el borrador guardado?')) {
      localStorage.removeItem(DRAFT_KEY);
      setHasDraft(false);
    }
  };

  const handleCreate = () => {
    if (!isAgencyApproved) {
      alert('Su cuenta se encuentra en proceso de validación. Para mayor información o agilizar el proceso, contáctenos a contacto@toursred.com');
      return;
    }
    resetForm();
    setIsCreating(true);
    setEditingTour(null);
  };

  const handleEdit = async (tour: Tour) => {
    // Calcular fecha límite por defecto (14 días antes del inicio)
    const defaultDeadline = new Date(tour.start_date);
    defaultDeadline.setDate(defaultDeadline.getDate() - 14);

    // Buscar el destino en la lista de destinos disponibles
    const destinationObj = allAvailableDestinations.find(d => d.name === tour.destination);
    const selectedDest = destinationObj ? [{ id: destinationObj.id, name: destinationObj.name }] : [];

    // Asegurar que category sea un array
    const categoryArray = Array.isArray(tour.category) ? tour.category : [tour.category];

    setTourType(tour.tour_type || 'excursion');
    setReceptivoModality(tour.receptivo_modality || 'compartido');
    setActivityType((tour.activity_type as ActivityType) || 'guided_tour');
    setTransferType((tour as any).transfer_type || '');
    setTransferCustomTime((tour as any).transfer_custom_time || false);
    setTransferPricingMode(((tour as any).transfer_pricing_mode as 'per_person' | 'per_vehicle') || 'per_person');
    setPrivateVehicleCapacity((tour as any).private_vehicle_capacity?.toString() || '');
    setTransportServiceInfo((tour as any).transport_service_info || '');
    setEstimatedMinutes((tour as any).estimated_minutes?.toString() || '');
    setExperienceEnvironment((tour as any).experience_environment || []);
    setParticipationLevel((tour as any).participation_level || '');
    setLocalHost((tour as any).local_host || false);
    setUniqueExperience((tour as any).unique_experience || '');
    setSpecialRequirements((tour as any).special_requirements || '');
    setTicketType((tour as any).ticket_type || '');
    setTicketValidityType(((tour as any).ticket_validity_type as 'open' | 'fixed_date' | 'date_range') || 'open');
    setTicketValidFrom((tour as any).ticket_valid_from || '');
    setTicketValidTo((tour as any).ticket_valid_to || '');
    setTicketRedemptionMethod((tour as any).ticket_redemption_method || '');
    setTicketDeliveryMethod((tour as any).ticket_delivery_method || '');
    setTicketAccessInstructions((tour as any).ticket_access_instructions || '');
    setTicketServiceInfo((tour as any).ticket_service_info || '');
    setReceptivoTab('info');
    if (tour.tour_type === 'receptivo') {
      setReceptivoData({
        operating_days: tour.operating_days || [],
        operating_months: tour.operating_months || [],
        min_advance_booking_hours: tour.min_advance_booking_hours?.toString() || '24',
        max_advance_booking_days: tour.max_advance_booking_days?.toString() || '90',
        slot_duration_days: tour.slot_duration_days?.toString() || '1',
        default_slot_capacity: tour.default_slot_capacity?.toString() || '',
        cancellation_policy: tour.cancellation_policy || 'moderada',
        cancellation_hours_limit: tour.cancellation_hours_limit?.toString() || '48',
        cancellation_refund_percentage: tour.cancellation_refund_percentage?.toString() || '80',
        flexible_hours: tour.flexible_hours?.toString() || '48',
        flexible_refund_percentage: tour.flexible_refund_percentage?.toString() || '100',
        moderate_hours: tour.moderate_hours?.toString() || '24',
        moderate_refund_percentage: tour.moderate_refund_percentage?.toString() || '50',
        min_travelers_required: tour.min_travelers_required?.toString() || '1',
        min_travelers_confirmation_hours: tour.min_travelers_confirmation_hours?.toString() || '24',
      });
    }
    setFormData({
      name: tour.name,
      category: categoryArray,
      description: tour.description,
      itinerary: tour.itinerary || '',
      price: tour.price.toString(),
      deposit_percentage: tour.deposit_percentage.toString(),
      image_url: tour.image_url,
      start_date: tour.start_date,
      end_date: tour.end_date,
      max_travelers: tour.max_travelers?.toString() || '',
      available_spots: tour.available_spots?.toString() || '',
      booking_deadline: tour.booking_deadline || defaultDeadline.toISOString().split('T')[0],
      booking_approval_type: tour.booking_approval_type || 'automatic',
      cancellation_not_allowed: tour.cancellation_not_allowed || false,
      name_changes_not_allowed: tour.name_changes_not_allowed || false,
      includes_insurance: tour.includes_insurance || false,
      pet_friendly: tour.pet_friendly || false,
      precio_adulto: tour.precio_adulto?.toString() || '',
      precio_nino: tour.precio_nino?.toString() || '',
      precio_infante: tour.precio_infante?.toString() || '',
      precio_adulto_mayor: tour.precio_adulto_mayor?.toString() || '',
      precio_mascota: tour.precio_mascota?.toString() || '',
      admite_infantes: tour.admite_infantes !== undefined ? tour.admite_infantes : true,
      admite_ninos: tour.admite_ninos !== undefined ? tour.admite_ninos : true,
      admite_adultos: tour.admite_adultos !== undefined ? tour.admite_adultos : true,
      admite_adultos_mayores: tour.admite_adultos_mayores !== undefined ? tour.admite_adultos_mayores : true,
      vehicle_map_type: (tour as any).vehicle_map_type || null,
      preventa_activa: (tour as any).preventa_activa || false,
      preventa_inicio: (tour as any).preventa_inicio || '',
      preventa_fin: (tour as any).preventa_fin || '',
      preventa_precio_especial: (tour as any).preventa_precio_especial || false,
      preventa_tipo_descuento: ((tour as any).preventa_tipo_descuento || 'porcentaje') as 'monto' | 'porcentaje',
      preventa_descuento_valor: (tour as any).preventa_descuento_valor?.toString() || '',
      payment_option: ((tour as any).payment_option || 'standard') as PaymentOption,
      full_payment_days_before_departure: String((tour as any).full_payment_days_before_departure ?? 15),
      payment_plan_mode: ((tour as any).payment_plan_mode || 'installments') as PaymentPlanMode,
      late_payment_grace_days: String((tour as any).late_payment_grace_days ?? 5),
      late_payment_penalty_pct: String((tour as any).late_payment_penalty_pct ?? 0),
      late_payment_penalty_fixed: String((tour as any).late_payment_penalty_fixed ?? 0),
    });
    setInstallmentDefs(((tour as any).installment_definitions || []).filter((_: any, i: number) => i > 0).map((d: any): InstallmentDefDraft => {
      const mode: VencimientoMode = d.specific_date ? 'fecha_especifica' : d.days_before_departure !== undefined ? 'dias_salida' : 'dias_reserva';
      return {
        label: d.label || '',
        pct_of_total: String(d.pct_of_total ?? ''),
        days_after_booking: String(d.days_after_booking ?? ''),
        days_before_departure: String(d.days_before_departure ?? ''),
        specific_date: d.specific_date || '',
        _vencimiento_mode: mode,
      };
    }));
    setPaymentOptionsEnabled(((tour as any).payment_option || 'standard') !== 'standard');
    setSelectedDestinations(selectedDest);
    setIncludes(tour.includes && tour.includes.length > 0 ? tour.includes : ['']);
    setExcludes(tour.excludes && tour.excludes.length > 0 ? tour.excludes : ['']);
    setDeparturePoints(tour.departure_points && tour.departure_points.length > 0 ? tour.departure_points : ['']);

    // Load departure points from database
    try {
      const { data: tourDeparturePoints, error } = await supabase
        .from('tour_departure_points')
        .select(`
          id,
          display_order,
          departure_time,
          special_instructions,
          departure_points (
            id,
            name,
            city,
            municipality,
            google_maps_url,
            is_active,
            usage_count,
            created_at,
            updated_at
          )
        `)
        .eq('tour_id', tour.id)
        .order('display_order');

      if (!error && tourDeparturePoints) {
        const selectedPoints: SelectedDeparturePoint[] = tourDeparturePoints
          .filter(tdp => tdp.departure_points)
          .map(tdp => ({
            ...(tdp.departure_points as DeparturePoint),
            display_order: tdp.display_order,
            departure_time: tdp.departure_time || undefined,
            special_instructions: tdp.special_instructions || undefined,
          }));
        setSelectedDeparturePoints(selectedPoints);
      }
    } catch (err) {
      console.error('Error loading departure points:', err);
    }



    // Load pickup and language data
    setPickupAvailable(tour.pickup_available || false);
    setPickupFreeZone(tour.pickup_free_zone || '');
    setPickupZones(
      Array.isArray(tour.pickup_zones)
        ? tour.pickup_zones.map((z: any) => ({
            name: z.name || '',
            extra_cost: z.extra_cost?.toString() || '',
            cost_type: z.cost_type || 'por_persona',
          }))
        : []
    );
    setTourLanguages(
      Array.isArray(tour.tour_languages)
        ? tour.tour_languages.map((l: any) => ({
            language: l.language || '',
            extra_cost: l.extra_cost?.toString() || '',
            cost_type: l.cost_type || 'por_persona',
          }))
        : []
    );
    setRestrictionPregnant(tour.restriction_pregnant || false);
    setRestrictionDisability(tour.restriction_disability || false);
    setRestrictionPhysical(tour.restriction_physical || false);

    // Load optional services for this tour
    try {
      const { data: servicesData } = await supabase
        .from('tour_optional_services')
        .select('*')
        .eq('tour_id', tour.id)
        .order('display_order');

      if (servicesData) {
        setOptionalServices(servicesData.map(s => ({
          id: s.id,
          name: s.name,
          description: s.description || '',
          price_per_person: s.price_per_person.toString(),
          max_capacity: s.max_capacity ? s.max_capacity.toString() : '',
          is_refundable: s.is_refundable,
          is_active: s.is_active,
        })));
      } else {
        setOptionalServices([]);
      }
    } catch (err) {
      console.error('Error loading optional services:', err);
      setOptionalServices([]);
    }

    // Load supplements for this tour
    try {
      const { data: supplementsData } = await supabase
        .from('tour_supplements')
        .select('*')
        .eq('tour_id', tour.id)
        .order('display_order');

      if (supplementsData) {
        setSupplements(supplementsData.map((s: any) => ({
          id: s.id,
          name: s.name,
          description: s.description || '',
          price: s.price.toString(),
          max_capacity: s.max_capacity ? s.max_capacity.toString() : '',
          requires_approval: s.requires_approval,
          is_cancellable: s.is_cancellable,
          is_active: s.is_active,
        })));
      } else {
        setSupplements([]);
      }
    } catch (err) {
      console.error('Error loading supplements:', err);
      setSupplements([]);
    }

    // Load schedules for receptivo tours
    if (tour.tour_type === 'receptivo') {
      try {
        const { data: schedulesData } = await supabase
          .from('tour_schedules')
          .select('*')
          .eq('tour_id', tour.id)
          .order('display_order', { ascending: true })
          .order('departure_time', { ascending: true });

        if (schedulesData) {
          setSchedulesDraft(schedulesData.map(s => ({
            id: s.id,
            departure_time: s.departure_time,
            label: s.label || '',
            slot_capacity: s.slot_capacity?.toString() || '',
            days_of_week: s.days_of_week || [],
            is_active: s.is_active,
          })));
        } else {
          setSchedulesDraft([]);
        }
      } catch (err) {
        console.error('Error loading schedules:', err);
        setSchedulesDraft([]);
      }
    } else {
      setSchedulesDraft([]);
    }

    if (tour.tour_type === 'excursion') {
      const { count } = await supabase
        .from('bookings')
        .select('*', { count: 'exact', head: true })
        .eq('tour_id', tour.id)
        .in('status', ['confirmed', 'pending']);
      setEditingTourHasActiveBookings((count || 0) > 0);
    } else {
      setEditingTourHasActiveBookings(false);
    }

    setEditingTour(tour);
    setEditingSlug(tour.slug);
    setOriginalSlug(tour.slug);
    setSlugAvailable(true);
    setSlugConfirm(false);
    setIsCreating(false);
  };

  const handleCancel = () => {
    setIsCreating(false);
    setEditingTour(null);
    resetForm();
    setError('');
    setEditingTourHasActiveBookings(false);
    setEditingSlug('');
    setOriginalSlug('');
    setSlugAvailable(null);
    setSlugConfirm(false);
  };

  const handleOpenFeatured = async (tour: Tour) => {
    if (!resolvedAgencyId) return;
    setFeaturedModal({ open: true, tour, plans: [], activeSlot: null, isLoading: true, isSubmitting: false, selectedPlanId: '', error: '', success: '', step: 'plan', couponExpanded: false, pendingSlotId: '', selectedProvider: 'stripe', couponCode: '', couponError: '', couponDiscount: 0, couponType: '', couponApplied: false, couponIsValidating: false });
    const [plansRes, slotsRes] = await Promise.all([
      getFeaturedPlans(),
      getAgencyFeaturedSlots(resolvedAgencyId),
    ]);
    const now = new Date();
    const activeSlot = (slotsRes.data || []).find((s: any) =>
      s.tour_id === tour.id &&
      s.status === 'active' &&
      new Date(s.expires_at) > now
    ) ?? null;
    setFeaturedModal(prev => ({
      ...prev,
      plans: plansRes.data || [],
      activeSlot,
      isLoading: false,
      selectedPlanId: plansRes.data?.[0]?.id ?? '',
    }));
  };

  const handleActivateFeatured = async () => {
    if (!featuredModal.tour || !featuredModal.selectedPlanId || !resolvedAgencyId) return;
    setFeaturedModal(prev => ({ ...prev, isSubmitting: true, error: '' }));
    const { data: slotId, error } = await supabase.rpc('activate_featured_slot', {
      p_tour_id: featuredModal.tour.id,
      p_agency_id: resolvedAgencyId,
      p_plan_id: featuredModal.selectedPlanId,
    });
    if (error) {
      setFeaturedModal(prev => ({ ...prev, isSubmitting: false, error: error.message }));
    } else {
      setFeaturedModal(prev => ({ ...prev, isSubmitting: false, step: 'payment', pendingSlotId: slotId as string }));
    }
  };

  const handlePayFeaturedSlot = async () => {
    if (!featuredModal.pendingSlotId) return;
    setFeaturedModal(prev => ({ ...prev, isSubmitting: true, error: '' }));
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const origin = window.location.origin;
      const res = await supabase.functions.invoke('create-featured-slot-checkout', {
        body: {
          slot_id: featuredModal.pendingSlotId,
          provider: featuredModal.selectedProvider,
          success_url: `${origin}/agency/featured-slot-success?slot_id=${featuredModal.pendingSlotId}`,
          cancel_url: `${origin}/agency/tours`,
          ...(featuredModal.couponApplied && featuredModal.couponCode ? { discount_code: featuredModal.couponCode } : {}),
        },
      });
      if (res.error) throw new Error(res.error.message);
      const url = res.data?.url;
      if (url) {
        window.location.href = url;
      } else {
        throw new Error('No se recibio URL de pago');
      }
    } catch (err: any) {
      setFeaturedModal(prev => ({ ...prev, isSubmitting: false, error: err.message || 'Error al iniciar el pago' }));
    }
  };

  const handleJoinWaitlist = async () => {
    if (!featuredModal.tour || !featuredModal.selectedPlanId || !resolvedAgencyId) return;
    setFeaturedModal(prev => ({ ...prev, isSubmitting: true, error: '' }));
    const { error } = await joinFeaturedWaitlist(featuredModal.tour.id, featuredModal.selectedPlanId, resolvedAgencyId);
    if (error) {
      setFeaturedModal(prev => ({ ...prev, isSubmitting: false, error: error.message }));
    } else {
      setFeaturedModal(prev => ({ ...prev, isSubmitting: false, success: 'Te has unido a la lista de espera. Te notificaremos cuando haya un lugar disponible.' }));
    }
  };

  const handleValidateCoupon = async () => {
    const code = featuredModal.couponCode.trim();
    if (!code) return;
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    setFeaturedModal(prev => ({ ...prev, couponIsValidating: true, couponError: '', couponApplied: false, couponDiscount: 0, couponType: '' }));
    const { data, error } = await supabase.rpc('validate_featured_slot_discount', {
      p_code: code,
      p_user_id: user.id,
    });
    if (error || !data?.valid) {
      setFeaturedModal(prev => ({ ...prev, couponIsValidating: false, couponError: data?.error ?? 'Código inválido' }));
      return;
    }
    const plan = featuredModal.plans.find((p: any) => p.id === featuredModal.selectedPlanId);
    const base = plan?.price ?? 0;
    let discount = 0;
    if (data.discount_type === 'featured_percentage') {
      discount = Math.min(base, (base * Number(data.discount_value)) / 100);
    } else if (data.discount_type === 'featured_fixed') {
      discount = Math.min(base, Number(data.discount_value));
    }
    setFeaturedModal(prev => ({ ...prev, couponIsValidating: false, couponApplied: true, couponDiscount: discount, couponType: data.discount_type }));
  };

  const handleDelete = async (tourId: string, tourName: string) => {
    if (!confirm(`¿Estás seguro de que quieres eliminar el tour "${tourName}"? Esta acción no se puede deshacer.`)) {
      return;
    }

    try {
      setIsSubmitting(true);

      const { error } = await deleteTour(tourId);
      if (error) throw error;

      await fetchAgencyTours();
      console.log('✅ Tour eliminado correctamente');
    } catch (err: any) {
      setError(err.message || 'Error al eliminar el tour');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDuplicate = (tour: Tour) => {
    setDuplicatingTour(tour);
    setDuplicateFormData({
      name: `${tour.name} (Copia)`,
      start_date: tour.start_date,
      end_date: tour.end_date,
      booking_deadline: tour.booking_deadline || '',
    });
  };

  const handleDuplicateCancel = () => {
    setDuplicatingTour(null);
    setDuplicateFormData({
      name: '',
      start_date: '',
      end_date: '',
      booking_deadline: '',
    });
  };

  const handleDuplicateSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!duplicatingTour || !user?.id) return;

    try {
      setIsSubmitting(true);
      setError('');

      // Calcular fecha límite por defecto si no se especifica
      let bookingDeadline = duplicateFormData.booking_deadline;
      if (!bookingDeadline && duplicateFormData.start_date) {
        const deadline = new Date(duplicateFormData.start_date);
        deadline.setDate(deadline.getDate() - 14);
        bookingDeadline = deadline.toISOString().split('T')[0];
      }

      const tourData = {
        name: duplicateFormData.name,
        category: duplicatingTour.category,
        description: duplicatingTour.description,
        itinerary: duplicatingTour.itinerary,
        price: duplicatingTour.price,
        deposit_percentage: duplicatingTour.deposit_percentage,
        image_url: duplicatingTour.image_url,
        start_date: duplicateFormData.start_date,
        end_date: duplicateFormData.end_date,
        max_travelers: duplicatingTour.max_travelers,
        destination: duplicatingTour.destination,
        includes: duplicatingTour.includes,
        excludes: duplicatingTour.excludes,
        booking_deadline: bookingDeadline,
        booking_approval_type: duplicatingTour.booking_approval_type,
        cancellation_not_allowed: duplicatingTour.cancellation_not_allowed || false,
        name_changes_not_allowed: duplicatingTour.name_changes_not_allowed || false,
        includes_insurance: duplicatingTour.includes_insurance || false,
        pet_friendly: duplicatingTour.pet_friendly || false,
        precio_adulto: duplicatingTour.precio_adulto || null,
        precio_nino: duplicatingTour.precio_nino || null,
        precio_infante: duplicatingTour.precio_infante || null,
        precio_adulto_mayor: duplicatingTour.precio_adulto_mayor || null,
        precio_mascota: duplicatingTour.precio_mascota || null,
        admite_infantes: duplicatingTour.admite_infantes !== undefined ? duplicatingTour.admite_infantes : true,
        admite_ninos: duplicatingTour.admite_ninos !== undefined ? duplicatingTour.admite_ninos : true,
        admite_adultos: duplicatingTour.admite_adultos !== undefined ? duplicatingTour.admite_adultos : true,
        admite_adultos_mayores: duplicatingTour.admite_adultos_mayores !== undefined ? duplicatingTour.admite_adultos_mayores : true,
      };

      // Obtener los destinos del tour original para copiarlos
      const { data: originalDestinations } = await supabase
        .from('tour_destinations')
        .select('destination_id')
        .eq('tour_id', duplicatingTour.id);
      const destinationIds = (originalDestinations || []).map((d: any) => d.destination_id);

      // Crear el nuevo tour
      const { error } = await createTour(tourData, destinationIds, user.id);
      if (error) throw error;

      await fetchAgencyTours();
      handleDuplicateCancel();
      console.log('✅ Tour duplicado correctamente');
    } catch (err: any) {
      setError(err.message || 'Error al duplicar el tour');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleOpenReschedule = async (tour: Tour) => {
    const todayUTC = new Date();
    todayUTC.setUTCHours(0, 0, 0, 0);

    const [ty, tm, td] = tour.start_date.split('-').map(Number);
    const startDate = new Date(Date.UTC(ty, tm - 1, td));

    if (startDate < todayUTC) {
      alert('No puedes reagendar un tour que ya ha iniciado o finalizado.');
      return;
    }

    const daysUntilStart = Math.floor((startDate.getTime() - todayUTC.getTime()) / (1000 * 60 * 60 * 24));
    if (daysUntilStart < 2) {
      alert('No puedes reagendar un tour con menos de 48 horas (2 días) de anticipación.');
      return;
    }

    setRescheduleModal({
      open: true,
      tour,
      activeBookingsCount: 0,
      isLoading: true,
      isSubmitting: false,
      error: '',
      success: false,
    });

    const minNewDate = new Date();
    minNewDate.setDate(minNewDate.getDate() + 4);

    setRescheduleFormData({
      new_start_date: minNewDate.toLocaleDateString('en-CA'),
      new_end_date: '',
      reschedule_reason: '',
    });

    try {
      const { count, error } = await supabase
        .from('bookings')
        .select('*', { count: 'exact', head: true })
        .eq('tour_id', tour.id)
        .in('status', ['confirmed', 'pending']);

      if (error) throw error;

      setRescheduleModal(prev => ({
        ...prev,
        activeBookingsCount: count || 0,
        isLoading: false,
      }));
    } catch (err: any) {
      console.error('Error loading bookings count:', err);
      setRescheduleModal(prev => ({
        ...prev,
        error: 'Error al cargar el número de reservas',
        isLoading: false,
      }));
    }
  };

  const handleCloseReschedule = () => {
    setRescheduleModal({
      open: false,
      tour: null,
      activeBookingsCount: 0,
      isLoading: false,
      isSubmitting: false,
      error: '',
      success: false,
    });
    setRescheduleFormData({
      new_start_date: '',
      new_end_date: '',
      reschedule_reason: '',
    });
  };

  const handleSubmitReschedule = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!rescheduleModal.tour || !user) return;

    const todayUTC = new Date();
    todayUTC.setUTCHours(0, 0, 0, 0);
    const [sy, sm, sd] = rescheduleFormData.new_start_date.split('-').map(Number);
    const newStartDate = new Date(Date.UTC(sy, sm - 1, sd));
    const daysUntilNewStart = (newStartDate.getTime() - todayUTC.getTime()) / (1000 * 60 * 60 * 24);

    if (daysUntilNewStart < 4) {
      setRescheduleModal(prev => ({
        ...prev,
        error: 'La nueva fecha debe ser al menos 4 días en el futuro',
      }));
      return;
    }

    if (rescheduleFormData.reschedule_reason.trim().length < 20) {
      setRescheduleModal(prev => ({
        ...prev,
        error: 'El motivo del reagendamiento debe tener al menos 20 caracteres y ser descriptivo',
      }));
      return;
    }

    if (!rescheduleFormData.new_end_date) {
      setRescheduleModal(prev => ({
        ...prev,
        error: 'Debe especificar la fecha de finalización',
      }));
      return;
    }

    setRescheduleModal(prev => ({
      ...prev,
      isSubmitting: true,
      error: '',
    }));

    try {
      const { data, error } = await supabase.functions.invoke('process-tour-reschedule', {
        body: {
          tour_id: rescheduleModal.tour.id,
          new_start_date: rescheduleFormData.new_start_date,
          new_end_date: rescheduleFormData.new_end_date,
          reason: rescheduleFormData.reschedule_reason.trim(),
        },
      });

      if (error) {
        console.error('Edge function error:', error);
        throw error;
      }

      if (data && !data.success) {
        console.error('Function returned error:', data);
        throw new Error(data.error || 'Error al procesar el reagendamiento');
      }

      setRescheduleModal(prev => ({
        ...prev,
        isSubmitting: false,
        success: true,
      }));

      setTimeout(() => {
        handleCloseReschedule();
        fetchAgencyTours();
      }, 2000);
    } catch (err: any) {
      console.error('Error rescheduling tour:', err);
      const errorMessage = err.message || err.error || 'Error al procesar el reagendamiento';
      setRescheduleModal(prev => ({
        ...prev,
        isSubmitting: false,
        error: errorMessage,
      }));
    }
  };

  const handleOpenReceptivoActions = async (tour: Tour, action: 'slot-cancel' | 'slot-reschedule' | 'full-cancel') => {
    if (tour.cancelled_by_agency) {
      alert('Este tour ya fue cancelado.');
      return;
    }

    setReceptivoActionsModal({
      open: true,
      tour,
      action,
      slots: [],
      selectedSlot: null,
      isLoadingSlots: action !== 'full-cancel',
      isSubmitting: false,
      error: '',
      success: false,
      reason: '',
      newSlotDate: '',
      newSlotTime: '',
      bookingsInSlot: 0,
    });

    if (action !== 'full-cancel') {
      try {
        const today = new Date().toISOString().split('T')[0];
        const { data: slotsData, error: slotsError } = await supabase
          .from('tour_slots')
          .select('*')
          .eq('tour_id', tour.id)
          .in('status', ['activo', 'lleno'])
          .gte('slot_date', today)
          .order('slot_date', { ascending: true })
          .order('departure_time', { ascending: true });

        if (slotsError) throw slotsError;

        setReceptivoActionsModal(prev => ({
          ...prev,
          slots: slotsData || [],
          isLoadingSlots: false,
        }));
      } catch (err: any) {
        setReceptivoActionsModal(prev => ({
          ...prev,
          error: 'Error al cargar los slots disponibles',
          isLoadingSlots: false,
        }));
      }
    }
  };

  const handleSelectSlot = async (slot: any) => {
    setReceptivoActionsModal(prev => ({ ...prev, selectedSlot: slot, bookingsInSlot: 0, bookingsCountInSlot: 0 }));

    const { data: bookingsData } = await supabase
      .from('bookings')
      .select('travelers_count')
      .eq('tour_id', receptivoActionsModal.tour?.id || '')
      .eq('selected_date', slot.slot_date)
      .eq('selected_time', slot.departure_time)
      .in('status', ['confirmed', 'pending'])
      .is('cancelled_at', null);

    const totalTravelers = (bookingsData || []).reduce((sum, b) => sum + (b.travelers_count || 0), 0);
    setReceptivoActionsModal(prev => ({
      ...prev,
      bookingsInSlot: totalTravelers,
      bookingsCountInSlot: (bookingsData || []).length,
    }));
  };

  const handleCloseReceptivoActions = () => {
    setReceptivoActionsModal({
      open: false,
      tour: null,
      action: null,
      slots: [],
      selectedSlot: null,
      isLoadingSlots: false,
      isSubmitting: false,
      error: '',
      success: false,
      reason: '',
      newSlotDate: '',
      newSlotTime: '',
      bookingsInSlot: 0,
    });
  };

  const handleSubmitReceptivoSlotAction = async () => {
    const { tour, action, selectedSlot, reason, newSlotDate, newSlotTime } = receptivoActionsModal;
    if (!tour || !selectedSlot) return;

    if (reason.trim().length < 20) {
      setReceptivoActionsModal(prev => ({ ...prev, error: 'El motivo debe tener al menos 20 caracteres.' }));
      return;
    }

    if (action === 'slot-reschedule') {
      if (!newSlotDate || !newSlotTime) {
        setReceptivoActionsModal(prev => ({ ...prev, error: 'Debes seleccionar la nueva fecha y hora.' }));
        return;
      }
      const isSameDate = newSlotDate === selectedSlot.slot_date;
      const isEarlierDate = newSlotDate < selectedSlot.slot_date;
      const isSameTime = newSlotTime === selectedSlot.departure_time?.slice(0, 5);

      if (isEarlierDate) {
        setReceptivoActionsModal(prev => ({ ...prev, error: 'La nueva fecha no puede ser anterior a la fecha actual del slot.' }));
        return;
      }
      if (isSameDate && isSameTime) {
        setReceptivoActionsModal(prev => ({ ...prev, error: 'Si reagendas al mismo dia, debes seleccionar un horario diferente.' }));
        return;
      }
    }

    setReceptivoActionsModal(prev => ({ ...prev, isSubmitting: true, error: '' }));

    try {
      if (action === 'slot-cancel') {
        const { data, error } = await supabase.functions.invoke('process-receptivo-slot-cancellation', {
          body: {
            slot_id: selectedSlot.id,
            tour_id: tour.id,
            cancellation_reason: reason.trim(),
          },
        });
        if (error) throw error;
        if (data && !data.success) throw new Error(data.error || 'Error al cancelar el slot');
      } else if (action === 'slot-reschedule') {
        const { data, error } = await supabase.functions.invoke('process-receptivo-slot-cancellation', {
          body: {
            slot_id: selectedSlot.id,
            tour_id: tour.id,
            cancellation_reason: reason.trim(),
            reschedule_to_date: newSlotDate,
            reschedule_to_time: newSlotTime,
            check_capacity_only: true,
          },
        });
        if (error) throw error;

        if (data?.conflict) {
          setReceptivoActionsModal(prev => ({ ...prev, isSubmitting: false }));
          setCapacityConflictModal({
            open: true,
            targetSlot: data.target_slot,
            affectedTravelers: data.affected_travelers,
            spotsNeeded: data.spots_needed,
            originalSlotId: selectedSlot.id,
            tourId: tour.id,
            reason: reason.trim(),
            resolution: null,
            newSlotTime: '',
            isSubmitting: false,
            error: '',
            success: false,
          });
          return;
        }

        const { data: rescheduleData, error: rescheduleError } = await supabase.functions.invoke('process-receptivo-slot-cancellation', {
          body: {
            slot_id: selectedSlot.id,
            tour_id: tour.id,
            cancellation_reason: reason.trim(),
            reschedule_to_date: newSlotDate,
            reschedule_to_time: newSlotTime,
          },
        });
        if (rescheduleError) throw rescheduleError;
        if (rescheduleData && !rescheduleData.success) throw new Error(rescheduleData.error || 'Error al reagendar el slot');
      }

      setReceptivoActionsModal(prev => ({
        ...prev,
        isSubmitting: false,
        success: true,
      }));
      setTimeout(() => {
        handleCloseReceptivoActions();
        fetchAgencyTours();
      }, 2500);
    } catch (err: any) {
      setReceptivoActionsModal(prev => ({
        ...prev,
        isSubmitting: false,
        error: err.message || 'Error al procesar la accion',
      }));
    }
  };

  const handleSubmitCapacityConflictResolution = async () => {
    const { targetSlot, originalSlotId, tourId, reason, resolution, newSlotTime, affectedTravelers } = capacityConflictModal;
    if (!resolution) {
      setCapacityConflictModal(prev => ({ ...prev, error: 'Debes seleccionar una opcion.' }));
      return;
    }

    if (resolution === 'new_slot' && !newSlotTime) {
      setCapacityConflictModal(prev => ({ ...prev, error: 'Debes ingresar la hora del nuevo horario.' }));
      return;
    }

    setCapacityConflictModal(prev => ({ ...prev, isSubmitting: true, error: '' }));

    try {
      if (resolution === 'refund') {
        const { data, error } = await supabase.functions.invoke('process-receptivo-slot-cancellation', {
          body: {
            slot_id: originalSlotId,
            tour_id: tourId,
            cancellation_reason: reason,
          },
        });
        if (error) throw error;
        if (data && !data.success) throw new Error(data.error || 'Error al procesar reembolsos');
      } else {
        const body: any = {
          slot_id: originalSlotId,
          tour_id: tourId,
          reason: reason,
          resolution_type: resolution,
        };

        if (resolution === 'expand_capacity') {
          body.target_slot_id = targetSlot!.id;
        } else if (resolution === 'new_slot') {
          body.new_slot_date = targetSlot!.slot_date;
          body.new_slot_time = newSlotTime;
        }

        const { data, error } = await supabase.functions.invoke('process-slot-reschedule-request', { body });
        if (error) throw error;
        if (data && !data.success) throw new Error(data.error || 'Error al procesar el reagendado');
      }

      setCapacityConflictModal(prev => ({ ...prev, isSubmitting: false, success: true }));
      setTimeout(() => {
        setCapacityConflictModal(prev => ({ ...prev, open: false }));
        handleCloseReceptivoActions();
        fetchAgencyTours();
      }, 2500);
    } catch (err: any) {
      setCapacityConflictModal(prev => ({
        ...prev,
        isSubmitting: false,
        error: err.message || 'Error al procesar la resolucion',
      }));
    }
  };

  const handleSubmitReceptivoFullCancel = async () => {
    const { tour, reason } = receptivoActionsModal;
    if (!tour) return;

    if (reason.trim().length < 50) {
      setReceptivoActionsModal(prev => ({ ...prev, error: 'El motivo debe tener al menos 50 caracteres.' }));
      return;
    }

    setReceptivoActionsModal(prev => ({ ...prev, isSubmitting: true, error: '' }));

    try {
      const { data, error } = await supabase.functions.invoke('process-tour-cancellation', {
        body: {
          tour_id: tour.id,
          cancellation_reason: reason.trim(),
          is_receptivo_full_cancel: true,
        },
      });
      if (error) throw error;
      if (data && !data.success) throw new Error(data.error || 'Error al cancelar el tour');

      setReceptivoActionsModal(prev => ({ ...prev, isSubmitting: false, success: true }));
      setTimeout(() => {
        handleCloseReceptivoActions();
        fetchAgencyTours();
      }, 2500);
    } catch (err: any) {
      setReceptivoActionsModal(prev => ({
        ...prev,
        isSubmitting: false,
        error: err.message || 'Error al cancelar el tour',
      }));
    }
  };

  const handleOpenCancel = async (tour: Tour) => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const startDate = new Date(tour.start_date + 'T00:00:00');
    startDate.setHours(0, 0, 0, 0);

    if (startDate <= today) {
      alert('No puedes cancelar un tour que ya ha iniciado o finalizado.');
      return;
    }

    if (tour.cancelled_by_agency) {
      alert('Este tour ya fue cancelado por la agencia.');
      return;
    }

    setCancelModal({
      open: true,
      tour,
      activeBookingsCount: 0,
      isLoading: true,
      isSubmitting: false,
      error: '',
      success: false,
    });

    setCancelFormData({
      cancellation_reason: '',
    });

    try {
      const { count, error } = await supabase
        .from('bookings')
        .select('*', { count: 'exact', head: true })
        .eq('tour_id', tour.id)
        .in('status', ['confirmed', 'pending'])
        .eq('payment_status', 'succeeded')
        .is('cancelled_at', null);

      if (error) throw error;

      if (count === 0) {
        setCancelModal(prev => ({
          ...prev,
          error: 'No hay reservas activas para cancelar en este tour',
          isLoading: false,
        }));
        return;
      }

      setCancelModal(prev => ({
        ...prev,
        activeBookingsCount: count || 0,
        isLoading: false,
      }));
    } catch (err: any) {
      console.error('Error loading bookings count:', err);
      setCancelModal(prev => ({
        ...prev,
        error: 'Error al cargar el número de reservas',
        isLoading: false,
      }));
    }
  };

  const handleCloseCancel = () => {
    setCancelModal({
      open: false,
      tour: null,
      activeBookingsCount: 0,
      isLoading: false,
      isSubmitting: false,
      error: '',
      success: false,
    });
    setCancelFormData({
      cancellation_reason: '',
    });
  };

  const handleSubmitCancel = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!cancelModal.tour || !user) return;

    if (cancelFormData.cancellation_reason.trim().length < 50) {
      setCancelModal(prev => ({
        ...prev,
        error: 'El motivo de cancelación debe tener al menos 50 caracteres y ser descriptivo',
      }));
      return;
    }

    setCancelModal(prev => ({
      ...prev,
      isSubmitting: true,
      error: '',
    }));

    try {
      const { data, error } = await supabase.functions.invoke('process-tour-cancellation', {
        body: {
          tour_id: cancelModal.tour.id,
          cancellation_reason: cancelFormData.cancellation_reason.trim(),
        },
      });

      if (error) {
        console.error('Edge function error:', error);
        throw error;
      }

      if (data && !data.success) {
        console.error('Function returned error:', data);
        throw new Error(data.error || 'Error al procesar la cancelación');
      }

      setCancelModal(prev => ({
        ...prev,
        isSubmitting: false,
        success: true,
      }));

      setTimeout(() => {
        handleCloseCancel();
        fetchAgencyTours();
      }, 2500);
    } catch (err: any) {
      console.error('Error cancelling tour:', err);
      const errorMessage = err.message || err.error || 'Error al procesar la cancelación del tour';
      setCancelModal(prev => ({
        ...prev,
        isSubmitting: false,
        error: errorMessage,
      }));
    }
  };

  const handleCategoryToggle = (category: string) => {
    const currentCategories = formData.category;
    if (currentCategories.includes(category)) {
      // Remover la categoría si ya está seleccionada (pero mantener al menos una)
      if (currentCategories.length > 1) {
        setFormData({
          ...formData,
          category: currentCategories.filter(c => c !== category)
        });
      }
    } else {
      // Agregar la categoría
      setFormData({
        ...formData,
        category: [...currentCategories, category]
      });
    }
  };

  const handleIncludeChange = (index: number, value: string) => {
    const newIncludes = [...includes];
    newIncludes[index] = value;
    setIncludes(newIncludes);
  };

  const addInclude = () => {
    setIncludes([...includes, '']);
  };

  const removeInclude = (index: number) => {
    if (includes.length > 1) {
      setIncludes(includes.filter((_, i) => i !== index));
    }
  };

  const handleExcludeChange = (index: number, value: string) => {
    const newExcludes = [...excludes];
    newExcludes[index] = value;
    setExcludes(newExcludes);
  };

  const addExclude = () => {
    setExcludes([...excludes, '']);
  };

  const removeExclude = (index: number) => {
    if (excludes.length > 1) {
      setExcludes(excludes.filter((_, i) => i !== index));
    }
  };

  const addOptionalService = () => {
    setOptionalServices([...optionalServices, {
      name: '',
      description: '',
      price_per_person: '',
      max_capacity: '',
      is_refundable: true,
      is_active: true,
    }]);
  };

  const removeOptionalService = (index: number) => {
    setOptionalServices(optionalServices.filter((_, i) => i !== index));
  };

  const updateOptionalService = (index: number, field: keyof OptionalService, value: any) => {
    const updated = [...optionalServices];
    updated[index] = { ...updated[index], [field]: value };
    setOptionalServices(updated);
  };

  const addSupplement = () => {
    setSupplements([...supplements, {
      name: '',
      description: '',
      price: '',
      max_capacity: '',
      requires_approval: false,
      is_cancellable: true,
      is_active: true,
    }]);
  };

  const removeSupplement = (index: number) => {
    setSupplements(supplements.filter((_, i) => i !== index));
  };

  const updateSupplement = (index: number, field: keyof TourSupplement, value: any) => {
    const updated = [...supplements];
    updated[index] = { ...updated[index], [field]: value };
    setSupplements(updated);
  };

  const handleDeparturePointChange = (index: number, value: string) => {
    const newDeparturePoints = [...departurePoints];
    newDeparturePoints[index] = value;
    setDeparturePoints(newDeparturePoints);
  };

  const addDeparturePoint = () => {
    setDeparturePoints([...departurePoints, '']);
  };

  const removeDeparturePoint = (index: number) => {
    if (departurePoints.length > 1) {
      setDeparturePoints(departurePoints.filter((_, i) => i !== index));
    }
  };


  const handleImageSelect = (publicUrl: string, _type: string, _size: number) => {
    setFormData({ ...formData, image_url: publicUrl });
  };

  const handleSubmit = async () => {
    setIsSubmitting(true);
    setError('');

    try {
      if (!user?.id) {
        throw new Error('User not authenticated');
      }

      if (selectedDestinations.length === 0) {
        throw new Error('Debe seleccionar al menos un destino para el tour');
      }

      // Validar que haya una imagen
      if (!formData.image_url) {
        throw new Error('Debe proporcionar una imagen para el tour');
      }

      // Validar porcentaje de depósito
      const depositPercentage = parseInt(formData.deposit_percentage);
      if (depositPercentage < 30) {
        throw new Error('El porcentaje de anticipo no puede ser menor al 30%');
      }
      if (depositPercentage > 100) {
        throw new Error('El porcentaje de anticipo no puede ser mayor al 100%');
      }

      // Crear destinos nuevos si es necesario
      const processedDestinations = [];
      
      for (const destination of selectedDestinations) {
        if (destination.id.startsWith('temp_')) {
          // Es un destino nuevo, crearlo primero
          console.log('🌍 Creando nuevo destino:', destination.name);
          
          const { data: newDestination, error: destinationError } = await createDestination({
            name: destination.name,
            is_active: true,
            last_updated_by: user.id
          });
          
          if (destinationError) {
            throw new Error(`Error creando destino "${destination.name}": ${destinationError.message}`);
          }
          
          processedDestinations.push(newDestination.id);
          console.log('✅ Destino creado:', newDestination);
        } else {
          // Es un destino existente
          processedDestinations.push(destination.id);
        }
      }

      // Filtrar includes, excludes y departure_points vacíos
      const filteredIncludes = includes.filter(item => item.trim() !== '');
      const filteredExcludes = excludes.filter(item => item.trim() !== '');
      const filteredDeparturePoints = departurePoints.filter(item => item.trim() !== '');

      // Validar departure points (nuevo sistema)
      if (selectedDeparturePoints.length === 0) {
        throw new Error('Debe seleccionar al menos 1 punto de salida para el tour');
      }

      if (selectedDeparturePoints.length > 4) {
        throw new Error('No puedes seleccionar más de 4 puntos de salida para el tour');
      }

      if (tourType === 'excursion' && !formData.start_date) {
        throw new Error('La fecha de inicio es requerida para excursiones');
      }
      if (tourType === 'excursion' && !formData.end_date) {
        throw new Error('La fecha de fin es requerida para excursiones');
      }

      let bookingDeadline = formData.booking_deadline;
      if (!bookingDeadline && formData.start_date && tourType === 'excursion') {
        const deadline = new Date(formData.start_date);
        deadline.setDate(deadline.getDate() - 14);
        bookingDeadline = deadline.toISOString().split('T')[0];
      }

      const isReceptivo = tourType === 'receptivo';
      const isTransport = isReceptivo && activityType === 'transport';
      const isExperience = isReceptivo && activityType === 'experience';
      const isTicket = isReceptivo && activityType === 'ticket';

      const tourData = {
        name: formData.name,
        category: formData.category,
        description: formData.description,
        itinerary: formData.itinerary,
        price: parseFloat(formData.price),
        deposit_percentage: parseInt(formData.deposit_percentage),
        image_url: formData.image_url,
        start_date: isReceptivo ? null : (editingTour && editingTourHasActiveBookings ? editingTour.start_date : formData.start_date),
        end_date: isReceptivo ? null : (editingTour && editingTourHasActiveBookings ? editingTour.end_date : formData.end_date),
        max_travelers: formData.max_travelers ? parseInt(formData.max_travelers) : null,
        available_spots: isReceptivo ? null : (formData.available_spots ? parseInt(formData.available_spots) : null),
        destination: selectedDestinations.length > 0 ? selectedDestinations[0].name : '',
        includes: filteredIncludes.length > 0 ? filteredIncludes : null,
        excludes: filteredExcludes.length > 0 ? filteredExcludes : null,
        departure_points: filteredDeparturePoints,
        booking_deadline: isReceptivo ? null : bookingDeadline,
        booking_approval_type: formData.booking_approval_type,
        cancellation_not_allowed: formData.cancellation_not_allowed,
        name_changes_not_allowed: formData.name_changes_not_allowed,
        includes_insurance: formData.includes_insurance,
        pet_friendly: formData.pet_friendly,
        precio_adulto: formData.precio_adulto ? parseFloat(formData.precio_adulto) : null,
        precio_nino: formData.precio_nino ? parseFloat(formData.precio_nino) : null,
        precio_infante: formData.precio_infante ? parseFloat(formData.precio_infante) : null,
        precio_adulto_mayor: formData.precio_adulto_mayor ? parseFloat(formData.precio_adulto_mayor) : null,
        precio_mascota: formData.precio_mascota ? parseFloat(formData.precio_mascota) : null,
        admite_infantes: formData.admite_infantes,
        admite_ninos: formData.admite_ninos,
        admite_adultos: formData.admite_adultos,
        admite_adultos_mayores: formData.admite_adultos_mayores,
        tour_type: tourType,
        receptivo_modality: isReceptivo ? receptivoModality : null,
        operating_days: isReceptivo && receptivoData.operating_days.length > 0 ? receptivoData.operating_days : null,
        operating_months: isReceptivo && receptivoData.operating_months.length > 0 ? receptivoData.operating_months : null,
        min_advance_booking_hours: isReceptivo ? parseInt(receptivoData.min_advance_booking_hours) : null,
        max_advance_booking_days: isReceptivo ? parseInt(receptivoData.max_advance_booking_days) : null,
        slot_duration_days: isReceptivo ? parseInt(receptivoData.slot_duration_days) : null,
        default_slot_capacity: isReceptivo && receptivoData.default_slot_capacity ? parseInt(receptivoData.default_slot_capacity) : null,
        cancellation_policy: isReceptivo ? receptivoData.cancellation_policy : null,
        cancellation_hours_limit: isReceptivo ? parseInt(receptivoData.cancellation_hours_limit) : null,
        cancellation_refund_percentage: isReceptivo ? parseInt(receptivoData.cancellation_refund_percentage) : null,
        flexible_hours: isReceptivo ? parseInt(receptivoData.flexible_hours) : null,
        flexible_refund_percentage: isReceptivo ? parseInt(receptivoData.flexible_refund_percentage) : null,
        moderate_hours: isReceptivo ? parseInt(receptivoData.moderate_hours) : null,
        moderate_refund_percentage: isReceptivo ? parseInt(receptivoData.moderate_refund_percentage) : null,
        min_travelers_required: isReceptivo ? parseInt(receptivoData.min_travelers_required) : null,
        min_travelers_confirmation_hours: isReceptivo ? parseInt(receptivoData.min_travelers_confirmation_hours) : null,
        pickup_available: isReceptivo ? pickupAvailable : false,
        pickup_free_zone: isReceptivo && pickupAvailable ? pickupFreeZone || null : null,
        pickup_zones: isReceptivo && pickupAvailable && pickupZones.length > 0
          ? pickupZones
              .filter(z => z.name.trim())
              .map(z => ({
                name: z.name,
                extra_cost: z.extra_cost ? parseFloat(z.extra_cost) : 0,
                cost_type: z.cost_type,
              }))
          : [],
        tour_languages: isReceptivo && tourLanguages.length > 0
          ? tourLanguages
              .filter(l => l.language.trim())
              .map(l => ({
                language: l.language,
                extra_cost: l.extra_cost ? parseFloat(l.extra_cost) : 0,
                cost_type: l.cost_type,
              }))
          : [],
        restriction_pregnant: isReceptivo ? restrictionPregnant : false,
        restriction_disability: isReceptivo ? restrictionDisability : false,
        restriction_physical: isReceptivo ? restrictionPhysical : false,
        preventa_activa: formData.preventa_activa,
        preventa_inicio: formData.preventa_activa && formData.preventa_inicio ? formData.preventa_inicio : null,
        preventa_fin: formData.preventa_activa && formData.preventa_fin ? formData.preventa_fin : null,
        preventa_precio_especial: formData.preventa_activa ? formData.preventa_precio_especial : false,
        preventa_tipo_descuento: (formData.preventa_activa && formData.preventa_precio_especial) ? formData.preventa_tipo_descuento : null,
        preventa_descuento_valor: (formData.preventa_activa && formData.preventa_precio_especial && formData.preventa_descuento_valor)
          ? parseFloat(formData.preventa_descuento_valor) : null,
        payment_option: formData.payment_option,
        full_payment_days_before_departure: (formData.payment_option === 'full_upfront' || formData.payment_option === 'both')
          ? Math.max(15, parseInt(formData.full_payment_days_before_departure) || 15)
          : null,
        payment_plan_mode: (formData.payment_option === 'payment_plan' || formData.payment_option === 'both') ? formData.payment_plan_mode : null,
        installment_definitions: ((formData.payment_option === 'payment_plan' || formData.payment_option === 'both') && formData.payment_plan_mode === 'installments')
          ? [
              { label: 'Anticipo', pct_of_total: parseFloat(formData.deposit_percentage) || 0, days_after_booking: 0 },
              ...installmentDefs.map(d => {
                const base = { label: d.label, pct_of_total: parseFloat(d.pct_of_total) || 0 };
                if (d._vencimiento_mode === 'fecha_especifica') return { ...base, specific_date: d.specific_date || undefined };
                if (d._vencimiento_mode === 'dias_salida') return { ...base, days_before_departure: parseInt(d.days_before_departure) || 0 };
                return { ...base, days_after_booking: parseInt(d.days_after_booking) || 0 };
              }),
            ]
          : null,
        late_payment_grace_days: (formData.payment_option === 'payment_plan' || formData.payment_option === 'both') ? Math.max(0, parseInt(formData.late_payment_grace_days) || 5) : 5,
        late_payment_penalty_pct: (formData.payment_option === 'payment_plan' || formData.payment_option === 'both') ? parseFloat(formData.late_payment_penalty_pct) || 0 : 0,
        late_payment_penalty_fixed: (formData.payment_option === 'payment_plan' || formData.payment_option === 'both') ? parseFloat(formData.late_payment_penalty_fixed) || 0 : 0,
        activity_type: isReceptivo ? activityType : 'guided_tour',
        transfer_type: isTransport ? transferType || null : null,
        transfer_custom_time: isTransport && receptivoModality === 'privado' ? transferCustomTime : false,
        transfer_pricing_mode: isTransport && receptivoModality === 'privado' ? transferPricingMode : 'per_person',
        private_vehicle_capacity: isTransport && receptivoModality === 'privado' && privateVehicleCapacity ? parseInt(privateVehicleCapacity) : null,
        vehicle_map_type: isTransport && receptivoModality === 'privado' ? null : formData.vehicle_map_type ?? null,
        transport_service_info: isTransport ? transportServiceInfo || null : null,
        estimated_minutes: isTransport && estimatedMinutes ? parseInt(estimatedMinutes) : null,
        experience_environment: isExperience && experienceEnvironment.length > 0 ? experienceEnvironment : null,
        participation_level: isExperience ? participationLevel || null : null,
        local_host: isExperience ? localHost : false,
        unique_experience: isExperience ? uniqueExperience || null : null,
        special_requirements: isExperience ? specialRequirements || null : null,
        ticket_type: isTicket ? ticketType || null : null,
        ticket_validity_type: isTicket ? ticketValidityType : null,
        ticket_valid_from: isTicket && ticketValidFrom ? ticketValidFrom : null,
        ticket_valid_to: isTicket && ticketValidTo ? ticketValidTo : null,
        ticket_redemption_method: isTicket ? ticketRedemptionMethod || null : null,
        ticket_delivery_method: isTicket ? ticketDeliveryMethod || null : null,
        ticket_access_instructions: isTicket ? ticketAccessInstructions || null : null,
        ticket_service_info: isTicket ? ticketServiceInfo || null : null,
      };

      let tourId: string;
      let createdTour: any = null;

      if (editingTour) {
        // Actualizar tour existente
        const { error } = await updateTour(editingTour.id, tourData);
        if (error) throw error;
        tourId = editingTour.id;
        console.log('✅ Tour actualizado correctamente');
      } else {
        // Crear nuevo tour
        const { data: newTour, error } = await createTour(tourData, processedDestinations, user.id);
        if (error) throw error;
        tourId = newTour.id;
        createdTour = newTour;
        console.log('✅ Tour creado correctamente');
      }

      // Guardar departure points
      console.log('📍 Guardando puntos de salida...');

      // Validar que no haya duplicados en selectedDeparturePoints
      const uniquePoints = selectedDeparturePoints.filter((point, index, self) =>
        index === self.findIndex((p) => p.id === point.id)
      );

      if (uniquePoints.length !== selectedDeparturePoints.length) {
        console.warn('⚠️ Se encontraron puntos duplicados, removiendo...');
      }

      if (editingTour) {
        // Para tours existentes: actualizar de forma inteligente
        // 1. Obtener puntos existentes
        const { data: existingPoints } = await supabase
          .from('tour_departure_points')
          .select('departure_point_id, display_order')
          .eq('tour_id', tourId);

        const existingPointIds = new Set(existingPoints?.map(p => p.departure_point_id) || []);
        const newPointIds = new Set(uniquePoints.map(p => p.id));

        // 2. Identificar puntos a insertar (nuevos)
        const pointsToInsert = uniquePoints
          .filter(point => !existingPointIds.has(point.id))
          .map((point, index) => ({
            tour_id: tourId,
            departure_point_id: point.id,
            display_order: uniquePoints.findIndex(p => p.id === point.id) + 1,
            departure_time: point.departure_time || null,
            special_instructions: point.special_instructions || null,
          }));

        // 3. Identificar puntos a eliminar (ya no seleccionados)
        const pointIdsToDelete = Array.from(existingPointIds)
          .filter(id => !newPointIds.has(id));

        // 4. Insertar nuevos puntos primero
        if (pointsToInsert.length > 0) {
          console.log('📍 Insertando nuevos puntos:', pointsToInsert);
          const { error: insertError } = await supabase
            .from('tour_departure_points')
            .insert(pointsToInsert);

          if (insertError) {
            console.error('❌ Error insertando nuevos puntos:', insertError);
            throw new Error(`Error guardando puntos de salida: ${insertError.message}`);
          }
        }

        // 5. Eliminar puntos obsoletos (si hay)
        if (pointIdsToDelete.length > 0) {
          console.log('🗑️ Eliminando puntos obsoletos:', pointIdsToDelete);
          const { error: deleteError } = await supabase
            .from('tour_departure_points')
            .delete()
            .eq('tour_id', tourId)
            .in('departure_point_id', pointIdsToDelete);

          if (deleteError) {
            console.error('❌ Error eliminando puntos obsoletos:', deleteError);
            throw new Error(`Error eliminando puntos de salida: ${deleteError.message}`);
          }
        }

        // 6. Actualizar display_order, departure_time y special_instructions de todos los puntos
        for (let i = 0; i < uniquePoints.length; i++) {
          const point = uniquePoints[i];
          const { error: updateError } = await supabase
            .from('tour_departure_points')
            .update({
              display_order: i + 1,
              departure_time: point.departure_time || null,
              special_instructions: point.special_instructions || null
            })
            .eq('tour_id', tourId)
            .eq('departure_point_id', point.id);

          if (updateError) {
            console.error('❌ Error actualizando punto de salida:', updateError);
          }
        }

        console.log(`✅ Puntos de salida actualizados correctamente`);
      } else {
        // Para tours nuevos: insertar directamente
        const departurePointsToInsert = uniquePoints.map((point, index) => ({
          tour_id: tourId,
          departure_point_id: point.id,
          display_order: index + 1,
          departure_time: point.departure_time || null,
          special_instructions: point.special_instructions || null,
        }));

        console.log('📍 Insertando puntos:', departurePointsToInsert);

        const { error: insertError } = await supabase
          .from('tour_departure_points')
          .insert(departurePointsToInsert);

        if (insertError) {
          console.error('❌ Error guardando puntos de salida:', insertError);
          throw new Error(`Error guardando puntos de salida: ${insertError.message}`);
        }

        console.log(`✅ ${departurePointsToInsert.length} puntos de salida guardados correctamente`);
      }

      // Save optional services
      const validServices = optionalServices.filter(s => s.name.trim() && s.price_per_person);
      if (editingTour) {
        const { data: existingServices } = await supabase
          .from('tour_optional_services')
          .select('id')
          .eq('tour_id', tourId);

        const existingIds = new Set(existingServices?.map(s => s.id) || []);
        const incomingIds = new Set(validServices.filter(s => s.id).map(s => s.id!));

        const toDelete = Array.from(existingIds).filter(id => !incomingIds.has(id));
        if (toDelete.length > 0) {
          await supabase.from('tour_optional_services').delete().in('id', toDelete);
        }

        for (let i = 0; i < validServices.length; i++) {
          const svc = validServices[i];
          const payload = {
            tour_id: tourId,
            name: svc.name.trim(),
            description: svc.description.trim() || null,
            price_per_person: parseFloat(svc.price_per_person),
            max_capacity: svc.max_capacity ? parseInt(svc.max_capacity) : null,
            is_refundable: svc.is_refundable,
            is_active: svc.is_active,
            display_order: i + 1,
            updated_at: new Date().toISOString(),
          };
          if (svc.id) {
            await supabase.from('tour_optional_services').update(payload).eq('id', svc.id);
          } else {
            await supabase.from('tour_optional_services').insert(payload);
          }
        }
      } else if (validServices.length > 0) {
        const toInsert = validServices.map((svc, i) => ({
          tour_id: tourId,
          name: svc.name.trim(),
          description: svc.description.trim() || null,
          price_per_person: parseFloat(svc.price_per_person),
          max_capacity: svc.max_capacity ? parseInt(svc.max_capacity) : null,
          is_refundable: svc.is_refundable,
          is_active: svc.is_active,
          display_order: i + 1,
        }));
        await supabase.from('tour_optional_services').insert(toInsert);
      }

      // Save supplements
      const validSupplements = supplements.filter(s => s.name.trim() && s.price);
      if (editingTour) {
        const { data: existingSupplements } = await supabase
          .from('tour_supplements')
          .select('id')
          .eq('tour_id', tourId);

        const existingSupIds = new Set(existingSupplements?.map((s: any) => s.id) || []);
        const incomingSupIds = new Set(validSupplements.filter(s => s.id).map(s => s.id!));

        const toDeleteSup = Array.from(existingSupIds).filter(id => !incomingSupIds.has(id));
        if (toDeleteSup.length > 0) {
          await supabase.from('tour_supplements').delete().in('id', toDeleteSup);
        }

        for (let i = 0; i < validSupplements.length; i++) {
          const sup = validSupplements[i];
          const payload = {
            tour_id: tourId,
            name: sup.name.trim(),
            description: sup.description.trim() || null,
            price: parseFloat(sup.price),
            max_capacity: sup.max_capacity ? parseInt(sup.max_capacity) : null,
            requires_approval: sup.requires_approval,
            is_cancellable: sup.is_cancellable,
            is_active: sup.is_active,
            display_order: i + 1,
            updated_at: new Date().toISOString(),
          };
          if (sup.id) {
            await supabase.from('tour_supplements').update(payload).eq('id', sup.id);
          } else {
            await supabase.from('tour_supplements').insert(payload);
          }
        }
      } else if (validSupplements.length > 0) {
        const toInsertSup = validSupplements.map((sup, i) => ({
          tour_id: tourId,
          name: sup.name.trim(),
          description: sup.description.trim() || null,
          price: parseFloat(sup.price),
          max_capacity: sup.max_capacity ? parseInt(sup.max_capacity) : null,
          requires_approval: sup.requires_approval,
          is_cancellable: sup.is_cancellable,
          is_active: sup.is_active,
          display_order: i + 1,
        }));
        await supabase.from('tour_supplements').insert(toInsertSup);
      }

      // Save schedules for receptivo tours (only when schedules were modified)
      if (tourType === 'receptivo' && schedulesDraft.length > 0) {
        const agencyIdForSchedules = editingTour ? editingTour.agency_id : createdTour?.agency_id;

        if (agencyIdForSchedules) {
          if (editingTour) {
            // Sync completo: actualizar existentes, insertar nuevos, eliminar los que ya no estan en el draft
            const draftIds = schedulesDraft.filter(s => s.id).map(s => s.id as string);

            const { data: currentSchedules } = await supabase
              .from('tour_schedules')
              .select('id')
              .eq('tour_id', tourId);

            const toDelete = (currentSchedules || [])
              .map((r: any) => r.id)
              .filter((id: string) => !draftIds.includes(id));

            if (toDelete.length > 0) {
              await supabase.from('tour_schedules').delete().in('id', toDelete);
            }

            for (const s of schedulesDraft) {
              if (s.id) {
                await supabase.from('tour_schedules').update({
                  departure_time: s.departure_time,
                  label: s.label || null,
                  slot_capacity: s.slot_capacity ? parseInt(s.slot_capacity) : null,
                  days_of_week: s.days_of_week.length > 0 ? s.days_of_week : null,
                  is_active: s.is_active,
                  updated_at: new Date().toISOString(),
                }).eq('id', s.id);
              } else {
                await supabase.from('tour_schedules').insert({
                  tour_id: tourId,
                  agency_id: agencyIdForSchedules,
                  departure_time: s.departure_time,
                  label: s.label || null,
                  slot_capacity: s.slot_capacity ? parseInt(s.slot_capacity) : null,
                  days_of_week: s.days_of_week.length > 0 ? s.days_of_week : null,
                  is_active: s.is_active,
                  valid_from: new Date().toISOString().split('T')[0],
                  display_order: schedulesDraft.indexOf(s),
                });
              }
            }
          } else {
            // New tour: bulk insert all draft schedules
            const schedulesToInsert = schedulesDraft.map((s, i) => ({
              tour_id: tourId,
              agency_id: agencyIdForSchedules,
              departure_time: s.departure_time,
              label: s.label || null,
              slot_capacity: s.slot_capacity ? parseInt(s.slot_capacity) : null,
              days_of_week: s.days_of_week.length > 0 ? s.days_of_week : null,
              is_active: s.is_active,
              valid_from: new Date().toISOString().split('T')[0],
              display_order: i + 1,
            }));
            await supabase.from('tour_schedules').insert(schedulesToInsert);
          }
        }
      }

      // Auto-generate slots for receptivo tours unconditionally (schedules may already exist)
      if (tourType === 'receptivo') {
        const slotStart = new Date().toISOString().split('T')[0];
        const slotEnd = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
        try {
          await supabase.rpc('auto_generate_slots_for_range', {
            p_tour_id: tourId,
            p_start_date: slotStart,
            p_end_date: slotEnd,
          });
        } catch (slotErr) {
          console.warn('Could not auto-generate slots:', slotErr);
        }
      }

      if (tourId && editingTour) {
        try {
          await supabase.rpc('sync_tour_slots_capacity_for_tour', { p_tour_id: tourId });
        } catch (syncErr) {
          console.warn('Could not sync slot capacities:', syncErr);
        }
      }

      // Recargar destinos disponibles después de crear nuevos
      await fetchAllDestinations();

      // Recargar tours después de crear/actualizar
      await fetchAgencyTours();

      // Slug update: if editing and slug changed, call update_tour_slug
      if (editingTour && editingSlug && editingSlug !== originalSlug) {
        if (editingTour.is_published && !slugConfirm) {
          setError('Confirmación requerida para cambiar la URL de un tour publicado');
          setIsSubmitting(false);
          return;
        }
        setSlugSaving(true);
        try {
          const result = await updateTourSlug(editingTour.id, editingSlug, slugConfirm);
          if (!result.success) {
            setError(`Error al actualizar la URL: ${result.message}`);
            setSlugSaving(false);
            setIsSubmitting(false);
            return;
          }
          await fetchAgencyTours();
        } catch (slugErr: any) {
          setError(`Error al actualizar la URL: ${slugErr.message}`);
          setSlugSaving(false);
          setIsSubmitting(false);
          return;
        }
        setSlugSaving(false);
      }

      if (createdTour) {
        // Después de crear, pasar a modo edición para configurar promociones grupales
        localStorage.removeItem(DRAFT_KEY);
        setIsCreating(false);
        const { data: freshTour } = await supabase.from('tours').select('*').eq('id', createdTour.id).single();
        setEditingTour(freshTour || createdTour);
        if (tourType === 'receptivo') {
          setReceptivoTab('horarios');
        }
      } else {
        handleCancel();
      }

    } catch (err: any) {
      setError(err.message);
    } finally {
      setIsSubmitting(false);
    }
  };

  const addDestination = (destinationName: string) => {
    // Buscar el destino en la lista de destinos disponibles
    const destinationObj = allAvailableDestinations.find(d => d.name === destinationName);
    if (destinationObj && !selectedDestinations.find(d => d.id === destinationObj.id)) {
      setSelectedDestinations([...selectedDestinations, { id: destinationObj.id, name: destinationObj.name }]);
    }
    setSearchQuery('');
    setSearchResults([]);
    setShowSearchResults(false);
  };

  const addDestinationFromInput = () => {
    if (searchQuery.trim()) {
      const destinationName = searchQuery.trim();
      
      // Verificar si ya está seleccionado
      if (selectedDestinations.find(d => d.name.toLowerCase() === destinationName.toLowerCase())) {
        setError(`El destino "${destinationName}" ya está seleccionado.`);
        return;
      }
      
      // Buscar si existe en la lista de destinos disponibles
      const existingDestination = allAvailableDestinations.find(d => 
        d.name.toLowerCase() === destinationName.toLowerCase()
      );
      
      if (existingDestination) {
        // Si existe, agregarlo con su ID real
        setSelectedDestinations([...selectedDestinations, { 
          id: existingDestination.id, 
          name: existingDestination.name 
        }]);
      } else {
        // Si no existe, agregarlo como nuevo destino (se creará al guardar el tour)
        const tempId = `temp_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        setSelectedDestinations([...selectedDestinations, { 
          id: tempId, 
          name: destinationName 
        }]);
      }
      
      setSearchQuery('');
      setSearchResults([]);
      setShowSearchResults(false);
    }
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      addDestinationFromInput();
    }
  };

  const removeDestination = (destinationId: string) => {
    setSelectedDestinations(selectedDestinations.filter(d => d.id !== destinationId));
  };

  const formatDate = (dateString: string | null | undefined) => {
    if (!dateString) return 'N/A';
    try {
      if (dateString.includes(' ') || dateString.includes('T')) {
        const date = new Date(dateString);
        if (isNaN(date.getTime())) throw new Error('Invalid date');
        const monthName = date.toLocaleString('en-US', { month: 'short' });
        const dayNum = date.toLocaleString('en-US', { day: 'numeric' });
        const yearNum = date.toLocaleString('en-US', { year: 'numeric' });
        return `${monthName} ${dayNum}, ${yearNum}`;
      } else {
        const [year, month, day] = dateString.split('-').map(Number);
        const date = new Date(Date.UTC(year, month - 1, day));
        const monthName = date.toLocaleString('en-US', { month: 'short', timeZone: 'UTC' });
        const dayNum = date.toLocaleString('en-US', { day: 'numeric', timeZone: 'UTC' });
        const yearNum = date.toLocaleString('en-US', { year: 'numeric', timeZone: 'UTC' });
        return `${monthName} ${dayNum}, ${yearNum}`;
      }
    } catch (error) {
      console.error('Error formatting date:', dateString, error);
      return dateString;
    }
  };

  const getCategoryName = (categorySlug: string) => {
    const category = categories.find(c => c.slug === categorySlug);
    return category ? category.name : categorySlug;
  };

  const getCategoryNames = (categories: string | string[]) => {
    const categoryArray = Array.isArray(categories) ? categories : [categories];
    return categoryArray.map(cat => getCategoryName(cat)).join(', ');
  };

  const getStatusBadge = (tour: Tour) => {
    if (tour.tour_type === 'receptivo') {
      return <span className="px-2 py-1 text-xs font-medium bg-teal-100 text-teal-800 rounded-full">Receptivo</span>;
    }

    const today = new Date();
    const startDate = new Date(tour.start_date);
    const endDate = new Date(tour.end_date);

    if (endDate < today) {
      return <span className="px-2 py-1 text-xs font-medium bg-gray-100 text-gray-800 rounded-full">Finalizado</span>;
    } else if (startDate <= today && endDate >= today) {
      return <span className="px-2 py-1 text-xs font-medium bg-success-100 text-success-800 rounded-full">En Curso</span>;
    } else {
      return <span className="px-2 py-1 text-xs font-medium bg-primary-100 text-primary-800 rounded-full">Próximo</span>;
    }
  };

  const isReceptivoForm = tourType === 'receptivo';
  const isTicket = isReceptivoForm && activityType === 'ticket';

  if (isLoading) {
    return (
      <div className="container mx-auto px-4 py-8">
        <div className="flex justify-center py-12">
          <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-primary-600"></div>
        </div>
      </div>
    );
  }

  return (
    <div className="container mx-auto px-4 py-8">
      <div className="flex justify-between items-center mb-6">
        <div>
          <h1 className="text-3xl font-bold">Gestionar Tours</h1>
          <p className="text-gray-600 mt-1">
            {tours.length === 0
              ? 'No tienes tours activos aún'
              : `${tours.length} ${tours.length === 1 ? 'tour activo' : 'tours activos'}`
            }
          </p>
        </div>
        {canCreate && (
          <button
            onClick={isCreating ? handleCancel : handleCreate}
            className={isCreating ? "btn btn-outline" : "btn btn-primary"}
            disabled={editingTour}
          >
            {isCreating ? (
              <>
                <X className="h-5 w-5 mr-2" />
                Cancelar
              </>
            ) : (
              <>
                <Plus className="h-5 w-5 mr-2" />
                Crear Nuevo Tour
              </>
            )}
          </button>
        )}
      </div>

      {error && (
        <div className="mb-6 bg-error-50 text-error-600 p-4 rounded-md">
          {error}
        </div>
      )}

      {/* Tabs: Activos / Finalizados */}
      {!isCreating && !editingTour && (
        <div className="flex gap-1 mb-6 bg-gray-100 p-1 rounded-lg w-fit">
          <button
            onClick={() => setTourListTab('activos')}
            className={`px-4 py-2 rounded-md text-sm font-medium transition-colors flex items-center gap-2 ${
              tourListTab === 'activos'
                ? 'bg-white text-gray-900 shadow-sm'
                : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            Tours Activos
            {tours.length > 0 && (
              <span className={`text-xs px-1.5 py-0.5 rounded-full font-semibold ${tourListTab === 'activos' ? 'bg-primary-100 text-primary-700' : 'bg-gray-200 text-gray-600'}`}>
                {tours.length}
              </span>
            )}
          </button>
          <button
            onClick={() => {
              setTourListTab('finalizados');
              fetchFinishedTours();
            }}
            className={`px-4 py-2 rounded-md text-sm font-medium transition-colors flex items-center gap-2 ${
              tourListTab === 'finalizados'
                ? 'bg-white text-gray-900 shadow-sm'
                : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            Historial
            {finishedLoaded && finishedTours.length > 0 && (
              <span className={`text-xs px-1.5 py-0.5 rounded-full font-semibold ${tourListTab === 'finalizados' ? 'bg-gray-200 text-gray-700' : 'bg-gray-200 text-gray-600'}`}>
                {finishedTours.length}
              </span>
            )}
          </button>
        </div>
      )}

      {/* Mensaje de Borrador Guardado */}
      {hasDraft && !isCreating && !editingTour && (
        <div className="mb-6 bg-blue-50 border border-blue-200 rounded-lg p-4">
          <div className="flex items-start gap-3">
            <Save className="w-5 h-5 text-blue-600 flex-shrink-0 mt-0.5" />
            <div className="flex-1">
              <h3 className="font-medium text-blue-900 mb-1">
                Borrador guardado
              </h3>
              <p className="text-sm text-blue-800 mb-3">
                Tienes un borrador de tour sin terminar. ¿Deseas continuar editándolo o descartarlo?
              </p>
              <div className="flex gap-3">
                <button
                  onClick={loadDraft}
                  className="btn btn-primary btn-sm"
                >
                  Continuar editando
                </button>
                <button
                  onClick={discardDraft}
                  className="btn btn-outline btn-sm"
                >
                  Descartar borrador
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Formulario de Crear/Editar */}
      {(isCreating || editingTour) && (
        <div className="mb-6 space-y-5">
          {/* Header del formulario */}
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-5">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-xl font-bold text-gray-900">
                  {editingTour ? `Editando: ${editingTour.name}` : 'Crear Nuevo Tour'}
                </h2>
                <p className="text-sm text-gray-500 mt-0.5">Completa cada sección para publicar tu tour</p>
              </div>
              {isCreating && (
                <div className="flex items-center gap-2 text-sm text-emerald-600 bg-emerald-50 px-3 py-1.5 rounded-full">
                  <Save className="w-4 h-4" />
                  <span>Borrador guardado automáticamente</span>
                </div>
              )}
            </div>
            <div className="flex items-center gap-4 mt-4 pt-4 border-t border-gray-100">
              <span className="text-xs text-gray-500 font-medium">Leyenda:</span>
              <span className="flex items-center gap-1 text-xs text-gray-600">
                <span className="text-red-500 font-bold">*</span>
                Campo obligatorio
              </span>
              <span className="flex items-center gap-1 text-xs text-gray-600">
                <span className="bg-gray-100 text-gray-500 text-[10px] font-medium px-1.5 py-0.5 rounded">Opcional</span>
                Campo no requerido para guardar
              </span>
            </div>
          </div>

          <div className="space-y-5">

            {/* SELECTOR TIPO DE TOUR */}
            <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-5">
              <h3 className="text-sm font-semibold text-gray-700 mb-3">Tipo de Tour</h3>
              <div className="grid grid-cols-2 gap-3">
                <button
                  type="button"
                  onClick={() => setTourType('excursion')}
                  className={`flex items-start gap-3 p-4 rounded-xl border-2 transition-all text-left ${
                    tourType === 'excursion'
                      ? 'border-red-500 bg-red-50'
                      : 'border-gray-200 hover:border-gray-300'
                  }`}
                >
                  <div className={`w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0 mt-0.5 ${
                    tourType === 'excursion' ? 'bg-red-600 text-white' : 'bg-gray-100 text-gray-500'
                  }`}>
                    <Calendar className="w-4 h-4" />
                  </div>
                  <div>
                    <p className={`font-semibold text-sm ${tourType === 'excursion' ? 'text-red-700' : 'text-gray-800'}`}>
                      Excursión
                    </p>
                    <p className="text-xs text-gray-500 mt-0.5">
                      Fecha fija de inicio y fin. Una sola salida programada.
                    </p>
                  </div>
                </button>
                <button
                  type="button"
                  onClick={() => setTourType('receptivo')}
                  className={`flex items-start gap-3 p-4 rounded-xl border-2 transition-all text-left ${
                    tourType === 'receptivo'
                      ? 'border-teal-500 bg-teal-50'
                      : 'border-gray-200 hover:border-gray-300'
                  }`}
                >
                  <div className={`w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0 mt-0.5 ${
                    tourType === 'receptivo' ? 'bg-teal-600 text-white' : 'bg-gray-100 text-gray-500'
                  }`}>
                    <RefreshCw className="w-4 h-4" />
                  </div>
                  <div>
                    <p className={`font-semibold text-sm ${tourType === 'receptivo' ? 'text-teal-700' : 'text-gray-800'}`}>
                      Receptivo
                    </p>
                    <p className="text-xs text-gray-500 mt-0.5">
                      Opera con horarios recurrentes. Disponibilidad por calendario.
                    </p>
                  </div>
                </button>
              </div>
              {tourType === 'receptivo' && (
                <div className="mt-4 pt-4 border-t border-gray-100">
                  <p className="text-xs font-medium text-gray-600 mb-2">Tipo de Actividad</p>
                  <div className="grid grid-cols-2 gap-2">
                    {([
                      { value: 'guided_tour', label: 'Tour Guiado', desc: 'Guía en destino, itinerario y visitas.', color: 'teal' },
                      { value: 'experience', label: 'Experiencia', desc: 'Actividad única o vivencial.', color: 'violet' },
                      { value: 'transport', label: 'Traslado', desc: 'Servicio de transporte punto a punto.', color: 'blue' },
                      { value: 'ticket', label: 'Entrada', desc: 'Acceso a atracción o evento.', color: 'orange' },
                    ] as const).map(opt => (
                      <button
                        key={opt.value}
                        type="button"
                        onClick={() => setActivityType(opt.value)}
                        className={`flex items-start gap-2 p-3 rounded-xl border-2 transition-all text-left ${
                          activityType === opt.value
                            ? opt.color === 'teal' ? 'border-teal-500 bg-teal-50'
                            : opt.color === 'violet' ? 'border-violet-500 bg-violet-50'
                            : opt.color === 'blue' ? 'border-blue-500 bg-blue-50'
                            : 'border-orange-500 bg-orange-50'
                            : 'border-gray-200 hover:border-gray-300 bg-white'
                        }`}
                      >
                        <div>
                          <p className={`font-semibold text-xs ${
                            activityType === opt.value
                              ? opt.color === 'teal' ? 'text-teal-700'
                              : opt.color === 'violet' ? 'text-violet-700'
                              : opt.color === 'blue' ? 'text-blue-700'
                              : 'text-orange-700'
                              : 'text-gray-800'
                          }`}>{opt.label}</p>
                          <p className="text-xs text-gray-400 mt-0.5">{opt.desc}</p>
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
              )}
              {tourType === 'receptivo' && activityType !== 'ticket' && (
                <div className="mt-4 pt-4 border-t border-gray-100">
                  <p className="text-xs font-medium text-gray-600 mb-2">Modalidad del tour receptivo</p>
                  <div className="flex gap-3">
                    <button
                      type="button"
                      onClick={() => setReceptivoModality('compartido')}
                      className={`flex items-center gap-2 px-4 py-2 rounded-lg border-2 text-sm font-medium transition-all ${
                        receptivoModality === 'compartido'
                          ? 'border-teal-500 bg-teal-50 text-teal-700'
                          : 'border-gray-200 text-gray-600 hover:border-gray-300'
                      }`}
                    >
                      <Users className="w-3.5 h-3.5" />
                      Compartido
                    </button>
                    <button
                      type="button"
                      onClick={() => setReceptivoModality('privado')}
                      className={`flex items-center gap-2 px-4 py-2 rounded-lg border-2 text-sm font-medium transition-all ${
                        receptivoModality === 'privado'
                          ? 'border-teal-500 bg-teal-50 text-teal-700'
                          : 'border-gray-200 text-gray-600 hover:border-gray-300'
                      }`}
                    >
                      <Settings className="w-3.5 h-3.5" />
                      Privado
                    </button>
                  </div>
                  <p className="text-xs text-gray-400 mt-2">
                    {receptivoModality === 'compartido'
                      ? 'Los viajeros comparten la salida con otros grupos. Informativo para el viajero.'
                      : 'El tour es exclusivo para un grupo. Informativo para el viajero.'}
                  </p>
                </div>
              )}
            </div>

            {/* SECCIÓN 1 — Información General */}
            <div className="bg-white rounded-xl shadow-sm border border-blue-100 overflow-hidden">
              <div className="bg-blue-600 px-5 py-3 flex items-center gap-2">
                <div className="bg-white/20 rounded-lg p-1.5">
                  <FileText className="w-4 h-4 text-white" />
                </div>
                <div>
                  <h3 className="text-white font-semibold text-sm">Paso 1 — Información General</h3>
                  <p className="text-blue-100 text-xs">{isTicket ? 'Nombre, categoría y descripción del evento' : 'Nombre, categoría y descripción del tour'}</p>
                </div>
                <span className="ml-auto bg-white/20 text-white text-xs px-2 py-0.5 rounded-full">Requerido</span>
              </div>
              <div className="p-5 space-y-5">
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-1.5">
                    {isTicket ? 'Nombre del Evento' : 'Nombre del Tour'} <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="text"
                    value={formData.name}
                    onChange={(e) => setFormData({...formData, name: e.target.value})}
                    className="input"
                    placeholder={isTicket ? 'Ej: Entrada a Xcaret, Concierto de Jazz en Tulum' : 'Ej: Tour Mágico por Oaxaca 3 días'}
                    required
                  />
                  <p className="text-xs text-gray-500 mt-1">{isTicket ? 'Sé descriptivo y atractivo. Incluye el nombre del lugar o evento y el tipo de acceso.' : 'Sé descriptivo y atractivo. Incluye el destino y la duración cuando aplique. Ej: '}<em>{isTicket ? '' : '"Snorkel en Cenotes — Tulum"'}</em>{isTicket ? '' : ', '}<em>{isTicket ? '' : '"Traslado Aeropuerto-Hotel Cancún"'}</em>{isTicket ? '' : '.'}</p>
                </div>

                {editingTour && (
                  <div>
                    <label className="block text-sm font-semibold text-gray-700 mb-1.5">
                      URL del tour (slug)
                    </label>
                    <div className="flex items-center gap-2">
                      <span className="text-sm text-gray-500 whitespace-nowrap">/tours/</span>
                      <input
                        type="text"
                        value={editingSlug}
                        onChange={(e) => {
                          const val = e.target.value
                            .toLowerCase()
                            .trim()
                            .replace(/[^a-z0-9-]/g, '')
                            .replace(/-+/g, '-')
                            .replace(/^-|-$/g, '');
                          setEditingSlug(val);
                          setSlugConfirm(false);
                          if (val && val !== originalSlug) {
                            const timer = setTimeout(async () => {
                              const available = await checkSlugAvailable(val, editingTour.id);
                              setSlugAvailable(available);
                            }, 400);
                            return () => clearTimeout(timer);
                          } else if (val === originalSlug) {
                            setSlugAvailable(true);
                          } else {
                            setSlugAvailable(null);
                          }
                        }}
                        className="input flex-1"
                        placeholder="mi-tour-agencia"
                      />
                    </div>
                    {editingSlug !== originalSlug && editingSlug && (
                      <div className="mt-2">
                        {slugAvailable === false && (
                          <p className="text-sm text-red-600 flex items-center gap-1">
                            <AlertCircle className="w-4 h-4" />
                            Este slug ya está en uso por otro tour o fue usado históricamente
                          </p>
                        )}
                        {slugAvailable === true && (
                          <>
                            {editingTour.is_published && (
                              <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 mt-2">
                                <p className="text-sm font-semibold text-amber-800 mb-1.5">
                                  Advertencia: cambio de URL en tour publicado
                                </p>
                                <p className="text-xs text-amber-700 mb-2">
                                  Google tendrá que reindexar la nueva URL. La URL vieja se redireccionará automáticamente (301) a la nueva, pero puede tomar días. Asegúrate de que el nuevo slug sea el definitivo.
                                </p>
                                <label className="flex items-start gap-2 cursor-pointer">
                                  <input
                                    type="checkbox"
                                    checked={slugConfirm}
                                    onChange={(e) => setSlugConfirm(e.target.checked)}
                                    className="mt-0.5"
                                  />
                                  <span className="text-xs text-amber-800 font-medium">
                                    Entiendo que cambiar la URL afecta el SEO y confirmo que quiero proceder
                                  </span>
                                </label>
                              </div>
                            )}
                            {!editingTour.is_published && (
                              <p className="text-sm text-green-600 flex items-center gap-1">
                                <CheckCircle className="w-4 h-4" />
                                Slug disponible
                              </p>
                            )}
                          </>
                        )}
                      </div>
                    )}
                    {editingSlug === originalSlug && (
                      <p className="text-xs text-gray-500 mt-1">
                        URL actual: <span className="font-mono text-gray-700">/tours/{originalSlug}</span>
                      </p>
                    )}
                  </div>
                )}

                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-2">
                    Categorías <span className="text-red-500">*</span>
                    <span className="ml-2 text-xs font-normal text-gray-500">Selecciona al menos una</span>
                  </label>
                  {categories.length === 0 ? (
                    <p className="text-sm text-gray-500 italic">Cargando categorías...</p>
                  ) : (
                    <div className="flex flex-wrap gap-2">
                      {categories.map((cat) => {
                        const isSelected = formData.category.includes(cat.slug);
                        return (
                          <button
                            key={cat.slug}
                            type="button"
                            onClick={() => handleCategoryToggle(cat.slug)}
                            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-medium border-2 transition-all ${
                              isSelected
                                ? 'bg-blue-600 border-blue-600 text-white shadow-sm'
                                : 'bg-white border-gray-200 text-gray-600 hover:border-blue-300 hover:text-blue-600'
                            }`}
                          >
                            <Tag className="w-3 h-3" />
                            {cat.name}
                          </button>
                        );
                      })}
                    </div>
                  )}
                  {formData.category.length === 0 && (
                    <p className="text-sm text-red-500 mt-2 flex items-center gap-1">
                      <AlertCircle className="w-4 h-4" />
                      Debes seleccionar al menos una categoría
                    </p>
                  )}
                </div>

                {/* Tipo de traslado — solo para activityType=transport */}
                {tourType === 'receptivo' && activityType === 'transport' && (
                  <div>
                    <label className="block text-sm font-semibold text-gray-700 mb-1">
                      Tipo de Traslado <span className="text-red-500">*</span>
                    </label>
                    <p className="text-xs text-gray-500 mb-2">Selecciona la ruta principal de este servicio de transporte.</p>
                    <div className="grid grid-cols-2 gap-2">
                      {[
                        { value: 'aeropuerto_hotel', label: 'Aeropuerto → Hotel' },
                        { value: 'hotel_aeropuerto', label: 'Hotel → Aeropuerto' },
                        { value: 'hotel_hotel', label: 'Hotel → Hotel' },
                        { value: 'punto_punto', label: 'Punto → Punto' },
                        { value: 'excursion_retorno', label: 'Excursión con Retorno' },
                        { value: 'otro', label: 'Otro' },
                      ].map(opt => (
                        <button
                          key={opt.value}
                          type="button"
                          onClick={() => setTransferType(opt.value)}
                          className={`px-3 py-2 rounded-lg border-2 text-sm font-medium transition-all text-left ${
                            transferType === opt.value
                              ? 'border-blue-500 bg-blue-50 text-blue-700'
                              : 'border-gray-200 text-gray-600 hover:border-gray-300'
                          }`}
                        >
                          {opt.label}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {/* Tipo de entrada — solo para activityType=ticket */}
                {tourType === 'receptivo' && activityType === 'ticket' && (
                  <div>
                    <label className="block text-sm font-semibold text-gray-700 mb-1">
                      Tipo de Entrada <span className="text-red-500">*</span>
                    </label>
                    <p className="text-xs text-gray-500 mb-2">Categoriza el tipo de acceso o atracción que ofrece esta entrada.</p>
                    <div className="grid grid-cols-2 gap-2">
                      {[
                        { value: 'parque_tematico', label: 'Parque Temático' },
                        { value: 'museo', label: 'Museo / Galería' },
                        { value: 'zona_arqueologica', label: 'Zona Arqueológica' },
                        { value: 'show_evento', label: 'Show / Evento' },
                        { value: 'atraccion_natural', label: 'Atracción Natural' },
                        { value: 'otro', label: 'Otro' },
                      ].map(opt => (
                        <button
                          key={opt.value}
                          type="button"
                          onClick={() => setTicketType(opt.value)}
                          className={`px-3 py-2 rounded-lg border-2 text-sm font-medium transition-all text-left ${
                            ticketType === opt.value
                              ? 'border-orange-500 bg-orange-50 text-orange-700'
                              : 'border-gray-200 text-gray-600 hover:border-gray-300'
                          }`}
                        >
                          {opt.label}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-1.5">
                    Descripción <span className="text-red-500">*</span>
                  </label>
                  <textarea
                    value={formData.description}
                    onChange={(e) => setFormData({...formData, description: e.target.value})}
                    className="input"
                    rows={3}
                    placeholder="Describe brevemente qué hace especial a este tour..."
                    required
                  />
                  <p className="text-xs text-gray-500 mt-1">Resumen que verán los viajeros en la tarjeta del tour. 2–4 oraciones que destaquen lo más atractivo. El itinerario detallado va en el Paso 3.</p>
                </div>
              </div>
            </div>

            {/* SECCIÓN 2 — Fechas y Destinos */}
            <div className="bg-white rounded-xl shadow-sm border border-teal-100 overflow-hidden">
              <div className="bg-teal-600 px-5 py-3 flex items-center gap-2">
                <div className="bg-white/20 rounded-lg p-1.5">
                  <Calendar className="w-4 h-4 text-white" />
                </div>
                <div>
                  <h3 className="text-white font-semibold text-sm">
                    Paso 2 — {tourType === 'receptivo' ? 'Destinos y Operación' : 'Fechas y Destinos'}
                  </h3>
                  <p className="text-teal-100 text-xs">
                    {tourType === 'receptivo' ? '¿A dónde va y cómo opera el tour?' : '¿Cuándo sale y a dónde va el tour?'}
                  </p>
                </div>
                <span className="ml-auto bg-white/20 text-white text-xs px-2 py-0.5 rounded-full">Requerido</span>
              </div>
              <div className="p-5 space-y-5">
                {tourType === 'excursion' && (
                  <div className="space-y-3">
                    {editingTour && editingTourHasActiveBookings ? (
                      <div className="rounded-xl border border-amber-200 bg-amber-50 p-4">
                        <div className="flex items-start gap-3">
                          <div className="flex-shrink-0 mt-0.5">
                            <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5 text-amber-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-semibold text-amber-800">Fechas bloqueadas</p>
                            <p className="text-xs text-amber-700 mt-0.5">
                              Este tour tiene reservas activas. Para cambiar las fechas debes usar la opcion de reagendar, la cual notifica automaticamente a los viajeros.
                            </p>
                            <div className="mt-3 grid grid-cols-2 gap-3">
                              <div>
                                <p className="text-xs font-medium text-amber-700 mb-1">Fecha de Inicio</p>
                                <div className="input bg-amber-100/60 text-amber-900 cursor-not-allowed select-none">
                                  {formData.start_date || '—'}
                                </div>
                              </div>
                              <div>
                                <p className="text-xs font-medium text-amber-700 mb-1">Fecha de Fin</p>
                                <div className="input bg-amber-100/60 text-amber-900 cursor-not-allowed select-none">
                                  {formData.end_date || '—'}
                                </div>
                              </div>
                            </div>
                            <button
                              type="button"
                              onClick={() => {
                                handleCancel();
                                if (editingTour) handleOpenReschedule(editingTour);
                              }}
                              className="mt-3 inline-flex items-center gap-1.5 text-xs font-semibold text-white bg-amber-500 hover:bg-amber-600 transition-colors px-3 py-1.5 rounded-lg"
                            >
                              <svg xmlns="http://www.w3.org/2000/svg" className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M21 2v6h-6"/><path d="M3 12a9 9 0 0 1 15-6.7L21 8"/><path d="M3 22v-6h6"/><path d="M21 12a9 9 0 0 1-15 6.7L3 16"/></svg>
                              Reagendar tour
                            </button>
                          </div>
                        </div>
                      </div>
                    ) : (
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div>
                          <label className="block text-sm font-semibold text-gray-700 mb-1.5">
                            Fecha de Inicio <span className="text-red-500">*</span>
                          </label>
                          <input
                            type="date"
                            value={formData.start_date}
                            onChange={(e) => setFormData({...formData, start_date: e.target.value})}
                            className="input"
                            required={tourType === 'excursion'}
                          />
                        </div>
                        <div>
                          <label className="block text-sm font-semibold text-gray-700 mb-1.5">
                            Fecha de Fin <span className="text-red-500">*</span>
                          </label>
                          <input
                            type="date"
                            value={formData.end_date}
                            onChange={(e) => setFormData({...formData, end_date: e.target.value})}
                            className="input"
                            min={formData.start_date}
                            required={tourType === 'excursion'}
                          />
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {tourType === 'receptivo' && (
                  <div className="space-y-4">
                    <div className="bg-teal-50 border border-teal-100 rounded-xl p-4">
                      <p className="text-teal-700 text-xs font-medium">
                        Los tours receptivos no tienen fechas fijas. Configura los horarios de salida abajo y se generarán slots de disponibilidad automáticamente al guardar.
                      </p>
                    </div>

                    <div>
                      <label className="block text-sm font-semibold text-gray-700 mb-2">
                        Días de operación
                        <span className="ml-2 text-xs font-normal text-gray-400">Vacío = todos los días</span>
                      </label>
                      <p className="text-xs text-gray-500 mb-2">Selecciona los días en que este tour opera. Si lo dejas vacío, estará disponible todos los días de la semana.</p>
                      <div className="flex gap-1.5">
                        {['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'].map((d, i) => (
                          <button
                            key={i}
                            type="button"
                            onClick={() => setReceptivoData(prev => ({
                              ...prev,
                              operating_days: prev.operating_days.includes(i)
                                ? prev.operating_days.filter(x => x !== i)
                                : [...prev.operating_days, i].sort()
                            }))}
                            className={`w-10 h-10 rounded-lg text-xs font-medium transition-colors ${
                              receptivoData.operating_days.includes(i)
                                ? 'bg-teal-600 text-white'
                                : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                            }`}
                          >
                            {d}
                          </button>
                        ))}
                      </div>
                    </div>

                    <div>
                      <label className="block text-sm font-semibold text-gray-700 mb-2">
                        Meses de operación
                        <span className="ml-2 text-xs font-normal text-gray-400">Vacío = todo el año</span>
                      </label>
                      <p className="text-xs text-gray-500 mb-2">Útil para tours de temporada. Si lo dejas vacío, opera los 12 meses.</p>
                      <div className="flex flex-wrap gap-1.5">
                        {['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'].map((m, i) => (
                          <button
                            key={i}
                            type="button"
                            onClick={() => {
                              const month = i + 1;
                              setReceptivoData(prev => ({
                                ...prev,
                                operating_months: prev.operating_months.includes(month)
                                  ? prev.operating_months.filter(x => x !== month)
                                  : [...prev.operating_months, month].sort((a, b) => a - b)
                              }));
                            }}
                            className={`px-2.5 h-8 rounded-lg text-xs font-medium transition-colors ${
                              receptivoData.operating_months.includes(i + 1)
                                ? 'bg-teal-600 text-white'
                                : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                            }`}
                          >
                            {m}
                          </button>
                        ))}
                      </div>
                    </div>

                    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                      <div>
                        <label className="block text-xs font-semibold text-gray-600 mb-1">Duración por salida (días) <span className="text-red-500">*</span></label>
                        <input type="number" min="1" value={receptivoData.slot_duration_days}
                          onChange={e => setReceptivoData(prev => ({ ...prev, slot_duration_days: e.target.value }))}
                          className="input" />
                        <p className="text-[11px] text-gray-400 mt-1">¿Cuántos días dura cada salida? Ej: <em>1</em> para tours de un día</p>
                      </div>
                      <div>
                        <label className="block text-xs font-semibold text-gray-600 mb-1">Cupos por horario</label>
                        <input type="number" min="1" value={receptivoData.default_slot_capacity}
                          placeholder="= máx. viajeros"
                          onChange={e => setReceptivoData(prev => ({ ...prev, default_slot_capacity: e.target.value }))}
                          className="input" />
                        <p className="text-[11px] text-gray-400 mt-1">Máx. de personas por horario. Vacío = usa el límite general del tour</p>
                      </div>
                      <div>
                        <label className="block text-xs font-semibold text-gray-600 mb-1">Anticipación mínima (horas) <span className="text-red-500">*</span></label>
                        <input type="number" min="1" value={receptivoData.min_advance_booking_hours}
                          onChange={e => setReceptivoData(prev => ({ ...prev, min_advance_booking_hours: e.target.value }))}
                          className="input" />
                        <p className="text-[11px] text-gray-400 mt-1">Ej: <em>24</em> = se debe reservar al menos 1 día antes</p>
                      </div>
                      <div>
                        <label className="block text-xs font-semibold text-gray-600 mb-1">Reserva anticipada máxima (días) <span className="text-red-500">*</span></label>
                        <input type="number" min="1" value={receptivoData.max_advance_booking_days}
                          onChange={e => setReceptivoData(prev => ({ ...prev, max_advance_booking_days: e.target.value }))}
                          className="input" />
                        <p className="text-[11px] text-gray-400 mt-1">Ej: <em>90</em> = se puede reservar con hasta 3 meses de anticipación</p>
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="block text-xs font-semibold text-gray-600 mb-1">Mín. viajeros para confirmar</label>
                        <input type="number" min="1" value={receptivoData.min_travelers_required}
                          onChange={e => setReceptivoData(prev => ({ ...prev, min_travelers_required: e.target.value }))}
                          className="input" />
                        <p className="text-[11px] text-gray-400 mt-1">Ej: <em>4</em> = el tour no se confirma si hay menos de 4 reservas</p>
                      </div>
                      <div>
                        <label className="block text-xs font-semibold text-gray-600 mb-1">Horas para confirmar mín.</label>
                        <input type="number" min="1" value={receptivoData.min_travelers_confirmation_hours}
                          onChange={e => setReceptivoData(prev => ({ ...prev, min_travelers_confirmation_hours: e.target.value }))}
                          className="input" />
                        <p className="text-[11px] text-gray-400 mt-1">Ej: <em>24</em> = se evalúa el mínimo 1 día antes del tour</p>
                      </div>
                    </div>

                    {/* Pick Up — hidden for transport and ticket */}
                    {activityType !== 'transport' && activityType !== 'ticket' && (
                    <div className="border border-gray-200 rounded-xl overflow-hidden">
                      <div className="bg-gray-50 px-4 py-3 flex items-center gap-2 border-b border-gray-200">
                        <Car className="w-4 h-4 text-gray-500" />
                        <span className="text-sm font-semibold text-gray-700">Recogida en Hotel (Pick Up)</span>
                        <span className="ml-2 text-xs text-gray-400 font-normal">Opcional</span>
                      </div>
                      <div className="p-4 space-y-4">
                        <label className="flex items-center gap-3 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={pickupAvailable}
                            onChange={e => setPickupAvailable(e.target.checked)}
                            className="w-4 h-4 text-teal-600 border-gray-300 rounded focus:ring-teal-500"
                          />
                          <div>
                            <span className="text-sm font-medium text-gray-700">Ofrecer recogida en hotel a los viajeros</span>
                            <p className="text-xs text-gray-500 mt-0.5">Activa esto si puedes recoger a los viajeros en sus hoteles. Podrás definir zonas con o sin costo adicional.</p>
                          </div>
                        </label>

                        {pickupAvailable && (
                          <div className="space-y-4 pl-7">
                            <div>
                              <label className="block text-xs font-semibold text-gray-600 mb-1">
                                Zona de cobertura sin costo adicional
                              </label>
                              <input
                                type="text"
                                value={pickupFreeZone}
                                onChange={e => setPickupFreeZone(e.target.value)}
                                className="input text-sm"
                                placeholder="Ej: Zona Hotelera, Centro Histórico, Hotel Barceló"
                              />
                              <p className="text-xs text-gray-400 mt-1">Describe la zona o los hoteles donde el pick up no tiene costo extra</p>
                            </div>

                            <div>
                              <div className="flex items-center justify-between mb-2">
                                <label className="text-xs font-semibold text-gray-600">Zonas con costo adicional</label>
                                <button
                                  type="button"
                                  onClick={() => setPickupZones(prev => [...prev, { name: '', extra_cost: '', cost_type: 'por_persona' }])}
                                  className="flex items-center gap-1 text-xs text-teal-600 hover:text-teal-800 font-medium"
                                >
                                  <Plus className="w-3.5 h-3.5" />
                                  Agregar zona con costo
                                </button>
                              </div>
                              {pickupZones.length === 0 && (
                                <p className="text-xs text-gray-400 italic">Sin zonas con costo adicional configuradas</p>
                              )}
                              <div className="space-y-2">
                                {pickupZones.map((zone, idx) => (
                                  <div key={idx} className="flex items-center gap-2 bg-gray-50 rounded-lg p-2">
                                    <input
                                      type="text"
                                      value={zone.name}
                                      onChange={e => {
                                        const updated = [...pickupZones];
                                        updated[idx] = { ...updated[idx], name: e.target.value };
                                        setPickupZones(updated);
                                      }}
                                      className="input text-xs flex-1"
                                      placeholder="Nombre de la zona"
                                    />
                                    <div className="relative w-28 flex-shrink-0">
                                      <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400 text-xs font-medium">$</span>
                                      <input
                                        type="number"
                                        value={zone.extra_cost}
                                        onChange={e => {
                                          const updated = [...pickupZones];
                                          updated[idx] = { ...updated[idx], extra_cost: e.target.value };
                                          setPickupZones(updated);
                                        }}
                                        className="input text-xs pl-6 w-full"
                                        placeholder="0.00"
                                        min="0"
                                        step="0.01"
                                      />
                                    </div>
                                    <select
                                      value={zone.cost_type}
                                      onChange={e => {
                                        const updated = [...pickupZones];
                                        updated[idx] = { ...updated[idx], cost_type: e.target.value as 'por_persona' | 'por_reserva' };
                                        setPickupZones(updated);
                                      }}
                                      className="input text-xs w-36 flex-shrink-0"
                                    >
                                      <option value="por_persona">Por persona</option>
                                      <option value="por_reserva">Por reserva (fijo)</option>
                                    </select>
                                    <button
                                      type="button"
                                      onClick={() => setPickupZones(prev => prev.filter((_, i) => i !== idx))}
                                      className="text-red-400 hover:text-red-600 flex-shrink-0"
                                    >
                                      <X className="w-4 h-4" />
                                    </button>
                                  </div>
                                ))}
                              </div>
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                    )}

                    {/* Dirección del Evento — solo para entradas */}
                    {activityType === 'ticket' && (
                    <div className="border border-gray-200 rounded-xl overflow-hidden">
                      <div className="bg-gray-50 px-4 py-3 flex items-center gap-2 border-b border-gray-200">
                        <MapPin className="w-4 h-4 text-gray-500" />
                        <span className="text-sm font-semibold text-gray-700">Dirección del Evento</span>
                        <span className="ml-2 text-xs text-gray-400 font-normal">Opcional</span>
                      </div>
                      <div className="p-4">
                        <input
                          type="text"
                          value={pickupFreeZone}
                          onChange={e => setPickupFreeZone(e.target.value)}
                          className="input"
                          placeholder="Ej: Av. Tulum km 4, Cancún, Q. Roo"
                        />
                        <p className="text-xs text-gray-400 mt-1">Dirección o ubicación donde se lleva a cabo el evento o atracción.</p>
                      </div>
                    </div>
                    )}

                    {/* Horarios de Salida / Inicio */}
                    <div className="border border-gray-200 rounded-xl overflow-hidden">
                      <div className="bg-gray-50 px-4 py-3 flex items-center gap-2 border-b border-gray-200">
                        <Clock className="w-4 h-4 text-gray-500" />
                        <div>
                          <span className="text-sm font-semibold text-gray-700">
                            {activityType === 'ticket' ? 'Horario del Evento / Apertura del Recinto' : activityType === 'experience' ? 'Horarios de Inicio' : 'Horarios de Salida'}
                          </span>
                          <p className="text-xs text-gray-400 mt-0.5">
                            {activityType === 'ticket'
                              ? 'Define los horarios de apertura o los turnos disponibles del evento.'
                              : activityType === 'experience'
                              ? 'Define las horas en que inicia cada sesión de la experiencia. Agrega un horario por turno (mañana, tarde, etc.).'
                              : 'Define las horas en que sale este tour cada día. Agrega un horario por turno (mañana, tarde, etc.).'}
                          </p>
                        </div>
                      </div>
                      <div className="p-4 space-y-3">
                        {/* Checkbox: traveler defines transfer time (only for private transport) */}
                        {activityType === 'transport' && receptivoModality === 'privado' && (
                          <label className={`flex items-start gap-3 cursor-pointer p-3 rounded-lg border-2 transition-all ${transferCustomTime ? 'border-teal-400 bg-teal-50' : 'border-gray-200 bg-white hover:border-gray-300'}`}>
                            <input
                              type="checkbox"
                              checked={transferCustomTime}
                              onChange={e => setTransferCustomTime(e.target.checked)}
                              className="w-4 h-4 mt-0.5 text-teal-600 border-gray-300 rounded focus:ring-teal-500 flex-shrink-0"
                            />
                            <div>
                              <span className="text-sm font-medium text-gray-800">Permitir que el viajero defina la hora del traslado al reservar</span>
                              <p className="text-xs text-gray-500 mt-0.5">Al activar esto, el viajero indicará a qué hora necesita el traslado durante el proceso de reserva. Aún puedes agregar horarios fijos si también los ofreces.</p>
                            </div>
                          </label>
                        )}
                        {schedulesDraft.length === 0 && !showScheduleForm && !transferCustomTime && (
                          <div className="flex items-start gap-2 bg-amber-50 border border-amber-200 rounded-lg p-3">
                            <AlertCircle className="w-4 h-4 text-amber-500 flex-shrink-0 mt-0.5" />
                            <p className="text-xs text-amber-700">
                              <strong>{activityType === 'experience' ? 'Sin horarios de inicio configurados.' : 'Sin horarios configurados.'}</strong>{' '}
                              Debes agregar al menos uno para que los viajeros puedan ver y reservar este tour.
                            </p>
                          </div>
                        )}
                        {activityType === 'transport' && receptivoModality === 'privado' && transferCustomTime && schedulesDraft.length === 0 && !showScheduleForm && (
                          <div className="flex items-start gap-2 bg-teal-50 border border-teal-200 rounded-lg p-3">
                            <Clock className="w-4 h-4 text-teal-500 flex-shrink-0 mt-0.5" />
                            <p className="text-xs text-teal-700">
                              <strong>El viajero definirá la hora al reservar.</strong>{' '}
                              No es necesario agregar horarios fijos, aunque puedes hacerlo si también ofreces salidas en horarios específicos.
                            </p>
                          </div>
                        )}

                        {schedulesDraft.length > 0 && (
                          <div className="space-y-2">
                            {schedulesDraft.map((s, idx) => (
                              <div key={idx} className={`flex items-center justify-between px-3 py-2.5 rounded-lg border ${s.is_active ? 'bg-white border-gray-200' : 'bg-gray-50 border-gray-100'}`}>
                                <div className="flex items-center gap-2.5">
                                  <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${s.is_active ? 'bg-teal-50 text-teal-600' : 'bg-gray-100 text-gray-400'}`}>
                                    <Clock className="w-4 h-4" />
                                  </div>
                                  <div>
                                    <div className="flex items-center gap-2">
                                      <span className="font-semibold text-sm text-gray-800">
                                        {(() => { const [h, m] = s.departure_time.split(':'); const hr = parseInt(h); return `${hr % 12 || 12}:${m} ${hr >= 12 ? 'PM' : 'AM'}`; })()}
                                      </span>
                                      {s.label && <span className="text-xs text-gray-500">— {s.label}</span>}
                                      {!s.is_active && <span className="text-xs text-gray-400 bg-gray-100 px-2 py-0.5 rounded-full">Inactivo</span>}
                                    </div>
                                    {(s.slot_capacity || s.days_of_week.length > 0) && (
                                      <div className="flex items-center gap-2 mt-0.5">
                                        {s.slot_capacity && <span className="text-xs text-gray-500">{s.slot_capacity} cupos</span>}
                                        {s.days_of_week.length > 0 && <span className="text-xs text-gray-500">{s.days_of_week.map(d => ['Dom','Lun','Mar','Mié','Jue','Vie','Sáb'][d]).join(', ')}</span>}
                                      </div>
                                    )}
                                  </div>
                                </div>
                                <div className="flex items-center gap-1">
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setScheduleForm({ ...s });
                                      setEditingScheduleIdx(idx);
                                      setShowScheduleForm(true);
                                    }}
                                    className="p-1.5 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
                                  >
                                    <Pencil className="w-3.5 h-3.5" />
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => {
                                      if (!s.id || confirm('¿Eliminar este horario?')) {
                                        if (s.id) {
                                          supabase.from('tour_schedules').delete().eq('id', s.id);
                                        }
                                        setSchedulesDraft(prev => prev.filter((_, i) => i !== idx));
                                      }
                                    }}
                                    className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                                  >
                                    <Trash2 className="w-3.5 h-3.5" />
                                  </button>
                                </div>
                              </div>
                            ))}
                          </div>
                        )}

                        {showScheduleForm && (
                          <div className="bg-gray-50 border border-gray-200 rounded-xl p-4 space-y-3">
                            <div className="flex items-center justify-between">
                              <h4 className="text-sm font-semibold text-gray-700">
                                {editingScheduleIdx !== null ? 'Editar Horario' : 'Nuevo Horario'}
                              </h4>
                              <button type="button" onClick={() => { setShowScheduleForm(false); setEditingScheduleIdx(null); setScheduleForm({ departure_time: '', label: '', slot_capacity: '', days_of_week: [], is_active: true }); }}
                                className="p-1 text-gray-400 hover:text-gray-600">
                                <X className="w-4 h-4" />
                              </button>
                            </div>
                            <div className="grid grid-cols-2 gap-3">
                              <div>
                                <label className="block text-xs font-medium text-gray-600 mb-1">
                                  {activityType === 'experience' ? 'Hora de inicio de la experiencia' : 'Hora de salida'}{' '}
                                  <span className="text-red-500">*</span>
                                </label>
                                <input
                                  type="time"
                                  value={scheduleForm.departure_time}
                                  onChange={e => setScheduleForm(prev => ({ ...prev, departure_time: e.target.value }))}
                                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500"
                                />
                              </div>
                              <div>
                                <label className="block text-xs font-medium text-gray-600 mb-1">Etiqueta <span className="text-gray-400 font-normal">(opcional)</span></label>
                                <input
                                  type="text"
                                  value={scheduleForm.label}
                                  placeholder={activityType === 'experience' ? 'Ej: Sesión matutina, Turno tarde' : 'Ej: Salida matutina, Turno tarde'}
                                  onChange={e => setScheduleForm(prev => ({ ...prev, label: e.target.value }))}
                                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500"
                                />
                              </div>
                            </div>
                            <div>
                              <label className="block text-xs font-medium text-gray-600 mb-1">Cupos propios <span className="text-gray-400 font-normal">(opcional)</span></label>
                              <input
                                type="number"
                                min="1"
                                value={scheduleForm.slot_capacity}
                                placeholder="Deja vacío para usar los cupos por defecto del tour"
                                onChange={e => setScheduleForm(prev => ({ ...prev, slot_capacity: e.target.value }))}
                                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500"
                              />
                              <p className="text-[11px] text-gray-400 mt-1">Útil si este horario tiene menos capacidad que el resto. Ej: el turno nocturno solo admite 10 personas.</p>
                            </div>
                            <div>
                              <label className="block text-xs font-medium text-gray-600 mb-1">Días específicos <span className="text-gray-400 font-normal">(opcional — vacío = todos los días de operación)</span></label>
                              <div className="flex gap-1.5">
                                {['Dom','Lun','Mar','Mié','Jue','Vie','Sáb'].map((d, i) => (
                                  <button
                                    key={i}
                                    type="button"
                                    onClick={() => setScheduleForm(prev => ({
                                      ...prev,
                                      days_of_week: prev.days_of_week.includes(i)
                                        ? prev.days_of_week.filter(x => x !== i)
                                        : [...prev.days_of_week, i].sort(),
                                    }))}
                                    className={`w-9 h-9 rounded-lg text-xs font-medium transition-colors ${
                                      scheduleForm.days_of_week.includes(i)
                                        ? 'bg-teal-600 text-white'
                                        : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                                    }`}
                                  >
                                    {d}
                                  </button>
                                ))}
                              </div>
                            </div>
                            <div className="flex items-center gap-2">
                              <input type="checkbox" id="sdraft-active" checked={scheduleForm.is_active}
                                onChange={e => setScheduleForm(prev => ({ ...prev, is_active: e.target.checked }))}
                                className="w-4 h-4 text-teal-600 rounded" />
                              <label htmlFor="sdraft-active" className="text-xs text-gray-700">Horario activo</label>
                            </div>
                            <div className="flex gap-2 pt-1">
                              <button
                                type="button"
                                disabled={!scheduleForm.departure_time}
                                onClick={async () => {
                                  if (!scheduleForm.departure_time) return;
                                  if (editingScheduleIdx !== null) {
                                    const existing = schedulesDraft[editingScheduleIdx];
                                    if (existing.id && editingTour) {
                                      await supabase.from('tour_schedules').update({
                                        departure_time: scheduleForm.departure_time,
                                        label: scheduleForm.label || null,
                                        slot_capacity: scheduleForm.slot_capacity ? parseInt(scheduleForm.slot_capacity) : null,
                                        days_of_week: scheduleForm.days_of_week.length > 0 ? scheduleForm.days_of_week : null,
                                        is_active: scheduleForm.is_active,
                                        updated_at: new Date().toISOString(),
                                      }).eq('id', existing.id);
                                      try {
                                        await supabase.rpc('sync_tour_slots_capacity_for_tour', { p_tour_id: editingTour.id });
                                      } catch (syncErr) {
                                        console.warn('Could not sync slot capacities:', syncErr);
                                      }
                                    }
                                    setSchedulesDraft(prev => prev.map((s, i) => i === editingScheduleIdx ? { ...scheduleForm } : s));
                                  } else {
                                    setSchedulesDraft(prev => [...prev, { ...scheduleForm }]);
                                  }
                                  setShowScheduleForm(false);
                                  setEditingScheduleIdx(null);
                                  setScheduleForm({ departure_time: '', label: '', slot_capacity: '', days_of_week: [], is_active: true });
                                }}
                                className="flex items-center gap-1.5 px-4 py-2 bg-teal-600 text-white text-sm rounded-lg hover:bg-teal-700 transition-colors disabled:opacity-40"
                              >
                                <Save className="w-3.5 h-3.5" />
                                Guardar
                              </button>
                              <button type="button" onClick={() => { setShowScheduleForm(false); setEditingScheduleIdx(null); setScheduleForm({ departure_time: '', label: '', slot_capacity: '', days_of_week: [], is_active: true }); }}
                                className="px-4 py-2 border border-gray-300 text-gray-600 text-sm rounded-lg hover:bg-gray-50 transition-colors">
                                Cancelar
                              </button>
                            </div>
                          </div>
                        )}

                        {!showScheduleForm && (
                          <button
                            type="button"
                            onClick={() => { setScheduleForm({ departure_time: '', label: '', slot_capacity: '', days_of_week: [], is_active: true }); setEditingScheduleIdx(null); setShowScheduleForm(true); }}
                            className="flex items-center gap-1.5 text-sm text-teal-600 hover:text-teal-800 font-medium"
                          >
                            <Plus className="w-4 h-4" />
                            Agregar horario de salida
                          </button>
                        )}
                      </div>
                    </div>

                  </div>
                )}

                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-1.5">
                    {isTicket ? 'Ciudad o Lugar del Evento' : 'Destinos'} <span className="text-red-500">*</span>
                    <span className="ml-2 text-xs font-normal text-gray-500">Escribe y presiona Enter para agregar</span>
                  </label>
                  <p className="text-xs text-gray-500 mb-2">
                    {isTicket
                      ? <>Ciudad o municipio donde se lleva a cabo el evento. Ej: <em>Cancún, Tulum, Ciudad de México</em>.</>
                      : tourType === 'receptivo' && activityType === 'experience'
                      ? <>Ciudad o municipio donde se lleva a cabo la experiencia. Ej: <em>Oaxaca Centro, Tulum, Ciudad de México</em>.</>
                      : <>Ciudad o región donde se realiza el tour. Ej: <em>Cancún, Tulum, Oaxaca Centro</em>. Puedes agregar varios si el tour recorre múltiples destinos.</>
                    }
                  </p>
                  <div className="mb-2 flex flex-wrap gap-2">
                    {selectedDestinations.map((destination) => (
                      <span
                        key={destination.id}
                        className="inline-flex items-center bg-teal-100 text-teal-800 px-3 py-1 rounded-full text-sm font-medium"
                      >
                        <MapPin className="w-3 h-3 mr-1" />
                        {destination.name}
                        <button
                          type="button"
                          onClick={() => removeDestination(destination.id)}
                          className="ml-2 text-teal-600 hover:text-teal-900 transition-colors"
                        >
                          <X className="h-3.5 w-3.5" />
                        </button>
                      </span>
                    ))}
                  </div>
                  <div className="relative">
                    <div className="flex gap-2">
                      <input
                        type="text"
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        onKeyPress={handleKeyPress}
                        className="input flex-1"
                        placeholder={isTicket ? 'Ej: Cancún, Tulum, Ciudad de México...' : 'Ej: Cancún, Oaxaca, Los Cabos...'}
                      />
                      <button
                        type="button"
                        onClick={addDestinationFromInput}
                        className="px-4 py-2 bg-teal-600 text-white rounded-lg hover:bg-teal-700 flex items-center gap-1.5 font-medium text-sm transition-colors"
                        disabled={!searchQuery.trim()}
                      >
                        <Plus className="h-4 w-4" />
                        Agregar
                      </button>
                    </div>
                    {showSearchResults && searchResults.length > 0 && (
                      <div className="absolute z-10 w-full mt-1 bg-white rounded-lg shadow-lg border border-gray-200">
                        <div className="py-1">
                          <div className="px-3 py-2 text-xs text-gray-500 border-b bg-gray-50 rounded-t-lg">
                            Destinos existentes
                          </div>
                          {searchResults.map((result) => (
                            <button
                              key={result.id}
                              type="button"
                              className="w-full text-left px-3 py-2 hover:bg-teal-50 text-sm flex items-center gap-2"
                              onClick={() => addDestination(result.name)}
                            >
                              <MapPin className="w-3.5 h-3.5 text-teal-500" />
                              {result.name}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                  {selectedDestinations.length === 0 && (
                    <p className="text-sm text-red-500 mt-1.5 flex items-center gap-1">
                      <AlertCircle className="w-4 h-4" />
                      Debe seleccionar al menos un destino
                    </p>
                  )}
                  <p className="text-xs text-gray-500 mt-1.5">
                    Si el destino no existe en el sistema, se creará automáticamente al guardar el tour.
                  </p>
                </div>

                <div>
                  <DeparturePointSelector
                    selectedPoints={selectedDeparturePoints}
                    onPointsChange={setSelectedDeparturePoints}
                    onCreateNew={() => setShowCreateDepartureForm(true)}
                    maxPoints={4}
                    minPoints={1}
                    label={
                      tourType === 'receptivo' && activityType === 'transport'
                        ? 'Puntos de Origen (Recogida)'
                        : tourType === 'receptivo' && activityType === 'experience'
                        ? 'Lugar de la Experiencia'
                        : tourType === 'receptivo'
                        ? 'Puntos de Encuentro'
                        : 'Puntos de Salida'
                    }
                  />
                  {tourType === 'receptivo' && activityType === 'experience' && (
                    <p className="text-xs text-gray-500 mt-2">
                      Agrega la dirección del recinto o sede donde se realiza la experiencia. Ej: <em>Escuela de Cocina Don Pedro, Av. Juárez 45, Oaxaca</em>. Si tiene varios espacios o hay punto de reunión previo, puedes agregar hasta 4 ubicaciones.
                    </p>
                  )}
                </div>

                {/* Puntos de destino — solo para traslados */}
                {tourType === 'receptivo' && activityType === 'transport' && (
                  <div>
                    <DeparturePointSelector
                      selectedPoints={transportDestinationPoints}
                      onPointsChange={setTransportDestinationPoints}
                      onCreateNew={() => setShowCreateDepartureForm(true)}
                      maxPoints={4}
                      minPoints={0}
                      label="Puntos de Destino (Entrega)"
                    />
                    <div className="grid grid-cols-2 gap-4 mt-4">
                      <div>
                        <label className="block text-sm font-semibold text-gray-700 mb-1.5">
                          Tiempo estimado de traslado (minutos) <span className="text-gray-400 text-xs font-normal">Opcional</span>
                        </label>
                        <input
                          type="number"
                          min="1"
                          value={estimatedMinutes}
                          onChange={e => setEstimatedMinutes(e.target.value)}
                          className="input"
                          placeholder="Ej: 45"
                        />
                        <p className="text-xs text-gray-500 mt-1">Duración aproximada del recorrido. Ej: <em>45</em> = 45 minutos en camino.</p>
                      </div>
                    </div>
                    <div className="mt-4">
                      <label className="block text-sm font-semibold text-gray-700 mb-1.5">
                        Información del servicio de transporte <span className="text-gray-400 text-xs font-normal">Opcional</span>
                      </label>
                      <textarea
                        value={transportServiceInfo}
                        onChange={e => setTransportServiceInfo(e.target.value)}
                        className="input"
                        rows={3}
                        placeholder="Describe el vehículo, el servicio, instrucciones de abordaje, etc."
                      />
                      <p className="text-xs text-gray-500 mt-1">Ej: <em>"Unidad climatizada con capacidad para 8 personas, WiFi a bordo. El conductor estará en la terminal a 30 min antes del vuelo."</em></p>
                    </div>
                  </div>
                )}

                {/* Campos específicos de Experiencia */}
                {tourType === 'receptivo' && activityType === 'experience' && (
                  <div className="space-y-4 border border-violet-200 rounded-xl p-4 bg-violet-50/40">
                    <h4 className="text-sm font-semibold text-violet-800 flex items-center gap-2">
                      <Sparkles className="w-4 h-4" />
                      Detalles de la Experiencia
                      <span className="ml-auto text-xs font-normal text-violet-500">Todos los campos son opcionales</span>
                    </h4>
                    <div>
                      <label className="block text-sm font-semibold text-gray-700 mb-1.5">
                        ¿Qué hace única esta experiencia?
                      </label>
                      <textarea
                        value={uniqueExperience}
                        onChange={e => setUniqueExperience(e.target.value)}
                        className="input"
                        rows={2}
                        placeholder="Describe lo que diferencia esta experiencia de otras similares..."
                      />
                      <p className="text-xs text-gray-500 mt-1">Ej: <em>"Preparación del mole con una familia oaxaqueña de 3 generaciones en su cocina tradicional"</em>.</p>
                    </div>
                    <div>
                      <label className="block text-sm font-semibold text-gray-700 mb-2">
                        Ambiente de la experiencia
                      </label>
                      <div className="flex flex-wrap gap-2">
                        {[
                          'Al aire libre', 'En interiores', 'Acuático', 'Nocturno',
                          'Gastronómico', 'Cultural', 'Aventura', 'Relajación',
                        ].map(env => (
                          <button
                            key={env}
                            type="button"
                            onClick={() => setExperienceEnvironment(prev =>
                              prev.includes(env) ? prev.filter(e => e !== env) : [...prev, env]
                            )}
                            className={`px-3 py-1.5 rounded-full text-xs font-medium border-2 transition-all ${
                              experienceEnvironment.includes(env)
                                ? 'border-violet-500 bg-violet-600 text-white'
                                : 'border-gray-200 text-gray-600 hover:border-violet-300'
                            }`}
                          >
                            {env}
                          </button>
                        ))}
                      </div>
                    </div>
                    <div>
                      <label className="block text-sm font-semibold text-gray-700 mb-2">
                        Nivel de participación
                      </label>
                      <div className="flex gap-2">
                        {[
                          { value: 'pasivo', label: 'Pasivo', desc: 'Solo observar' },
                          { value: 'activo', label: 'Activo', desc: 'Participación física' },
                          { value: 'interactivo', label: 'Interactivo', desc: 'Aprende haciendo' },
                        ].map(opt => (
                          <button
                            key={opt.value}
                            type="button"
                            onClick={() => setParticipationLevel(opt.value)}
                            className={`flex-1 px-3 py-2 rounded-lg border-2 text-center text-sm transition-all ${
                              participationLevel === opt.value
                                ? 'border-violet-500 bg-violet-50 text-violet-700'
                                : 'border-gray-200 text-gray-600 hover:border-gray-300'
                            }`}
                          >
                            <p className="font-semibold text-xs">{opt.label}</p>
                            <p className="text-xs text-gray-400 mt-0.5">{opt.desc}</p>
                          </button>
                        ))}
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      <input
                        type="checkbox"
                        id="local-host"
                        checked={localHost}
                        onChange={e => setLocalHost(e.target.checked)}
                        className="w-4 h-4 text-violet-600 border-gray-300 rounded focus:ring-violet-500"
                      />
                      <label htmlFor="local-host" className="text-sm font-medium text-gray-700">
                        Dirigida por anfitrión local
                      </label>
                    </div>
                    <div>
                      <label className="block text-sm font-semibold text-gray-700 mb-1.5">
                        Requisitos especiales del participante
                      </label>
                      <textarea
                        value={specialRequirements}
                        onChange={e => setSpecialRequirements(e.target.value)}
                        className="input"
                        rows={4}
                        placeholder="Ej: Edad mínima 12 años. Llevar delantal y sus ingredientes: 500g de chile mulato, 200g de chocolate oscuro... Saber nadar, llevar ropa cómoda."
                      />
                      <p className="text-xs text-gray-500 mt-1">Lo que el viajero debe saber, llevar o tener para participar. Se mostrará en la página del tour.</p>
                    </div>
                  </div>
                )}

                {/* Campos específicos de Entrada */}
                {tourType === 'receptivo' && activityType === 'ticket' && (
                  <div className="space-y-4 border border-orange-200 rounded-xl p-4 bg-orange-50/40">
                    <h4 className="text-sm font-semibold text-orange-800 flex items-center gap-2">
                      <Tag className="w-4 h-4" />
                      Detalles de la Entrada
                      <span className="ml-auto text-xs font-normal text-orange-500">Todos los campos son opcionales</span>
                    </h4>
                    <div>
                      <label className="block text-sm font-semibold text-gray-700 mb-1">
                        Vigencia de la entrada
                      </label>
                      <p className="text-xs text-gray-500 mb-2">¿Esta entrada tiene una fecha fija de uso o es flexible? Ej: una entrada para el 20 de julio vs. una que puede usarse cualquier día del mes.</p>
                      <div className="flex gap-2">
                        {[
                          { value: 'open', label: 'Abierta', desc: 'Sin fecha fija' },
                          { value: 'fixed_date', label: 'Fecha fija', desc: 'Un día específico' },
                          { value: 'date_range', label: 'Rango', desc: 'Entre dos fechas' },
                        ].map(opt => (
                          <button
                            key={opt.value}
                            type="button"
                            onClick={() => setTicketValidityType(opt.value as 'open' | 'fixed_date' | 'date_range')}
                            className={`flex-1 px-3 py-2 rounded-lg border-2 text-center text-sm transition-all ${
                              ticketValidityType === opt.value
                                ? 'border-orange-500 bg-orange-50 text-orange-700'
                                : 'border-gray-200 text-gray-600 hover:border-gray-300'
                            }`}
                          >
                            <p className="font-semibold text-xs">{opt.label}</p>
                            <p className="text-xs text-gray-400 mt-0.5">{opt.desc}</p>
                          </button>
                        ))}
                      </div>
                    </div>
                    {ticketValidityType === 'fixed_date' && (
                      <div>
                        <label className="block text-sm font-semibold text-gray-700 mb-1.5">Fecha de validez</label>
                        <input type="date" value={ticketValidFrom} onChange={e => setTicketValidFrom(e.target.value)} className="input" />
                      </div>
                    )}
                    {ticketValidityType === 'date_range' && (
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <label className="block text-sm font-semibold text-gray-700 mb-1.5">Válida desde</label>
                          <input type="date" value={ticketValidFrom} onChange={e => setTicketValidFrom(e.target.value)} className="input" />
                        </div>
                        <div>
                          <label className="block text-sm font-semibold text-gray-700 mb-1.5">Válida hasta</label>
                          <input type="date" value={ticketValidTo} onChange={e => setTicketValidTo(e.target.value)} className="input" />
                        </div>
                      </div>
                    )}
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="block text-sm font-semibold text-gray-700 mb-1.5">Método de canje</label>
                        <select value={ticketRedemptionMethod} onChange={e => setTicketRedemptionMethod(e.target.value)} className="input">
                          <option value="">Seleccionar...</option>
                          <option value="qr_codigo">Código QR</option>
                          <option value="voucher_impreso">Voucher impreso</option>
                          <option value="nombre_lista">Nombre en lista</option>
                          <option value="fisico">Boleto físico</option>
                        </select>
                        <p className="text-xs text-gray-500 mt-1">¿Cómo se usa la entrada en la puerta o taquilla?</p>
                      </div>
                      <div>
                        <label className="block text-sm font-semibold text-gray-700 mb-1.5">Método de entrega</label>
                        <select value={ticketDeliveryMethod} onChange={e => setTicketDeliveryMethod(e.target.value)} className="input">
                          <option value="">Seleccionar...</option>
                          <option value="email">Por correo electrónico</option>
                          <option value="whatsapp">Por WhatsApp</option>
                          <option value="punto_recogida">Punto de recogida</option>
                          <option value="en_taquilla">En taquilla</option>
                        </select>
                        <p className="text-xs text-gray-500 mt-1">¿Cómo llega la entrada al viajero?</p>
                      </div>
                    </div>
                    <div>
                      <label className="block text-sm font-semibold text-gray-700 mb-1.5">
                        Instrucciones de acceso
                      </label>
                      <textarea
                        value={ticketAccessInstructions}
                        onChange={e => setTicketAccessInstructions(e.target.value)}
                        className="input"
                        rows={2}
                        placeholder="Ej: Presentar QR en la entrada principal. Acceso válido solo una vez."
                      />
                      <p className="text-xs text-gray-500 mt-1">Instrucciones que el viajero verá al recibir su entrada. Ej: qué puerta usar, si necesita imprimir, si es de un solo uso.</p>
                    </div>
                    <div>
                      <label className="block text-sm font-semibold text-gray-700 mb-1.5">
                        Información adicional del servicio
                      </label>
                      <textarea
                        value={ticketServiceInfo}
                        onChange={e => setTicketServiceInfo(e.target.value)}
                        className="input"
                        rows={2}
                        placeholder="Información relevante sobre horarios de atención, restricciones de acceso, etc."
                      />
                      <p className="text-xs text-gray-500 mt-1">Ej: <em>"El parque abre de 9am a 5pm. No se permiten mascotas. Casilleros disponibles con depósito reembolsable."</em></p>
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* SECCIÓN 3 — Itinerario e Imagen */}
            <div className="bg-white rounded-xl shadow-sm border border-amber-100 overflow-hidden">
              <div className="bg-amber-500 px-5 py-3 flex items-center gap-2">
                <div className="bg-white/20 rounded-lg p-1.5">
                  <Image className="w-4 h-4 text-white" />
                </div>
                <div>
                  <h3 className="text-white font-semibold text-sm">{isTicket ? 'Paso 3 — Descripción e Imagen' : 'Paso 3 — Itinerario e Imagen'}</h3>
                  <p className="text-amber-100 text-xs">{isTicket ? 'Describe el evento y agrega una foto atractiva' : 'Detalla el recorrido y agrega una foto atractiva'}</p>
                </div>
                <span className="ml-auto bg-white/20 text-white text-xs px-2 py-0.5 rounded-full">Requerido</span>
              </div>
              <div className="p-5 space-y-5">
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-1.5">
                    {isTicket ? 'Descripción del Evento' : 'Itinerario Detallado'} <span className="text-red-500">*</span>
                  </label>
                  <textarea
                    value={formData.itinerary}
                    onChange={(e) => setFormData({...formData, itinerary: e.target.value})}
                    className="input"
                    rows={6}
                    placeholder={isTicket
                      ? 'Describe el evento: qué se verá, qué incluye la entrada, recomendaciones para el visitante...'
                      : 'Día 1: Llegada al destino, traslado al hotel...\nDía 2: Visita a sitios turísticos...\nDía 3: Actividades y regreso...'}
                    required
                  />
                  <p className="text-xs text-gray-500 mt-1">{isTicket ? 'Describe qué encontrará el visitante, qué está incluido en la entrada y cualquier recomendación útil.' : 'Describe el recorrido hora por hora o día por día. Cuanto más detallado, más confianza genera en el viajero. Ej: '}<em>{isTicket ? '' : '"9:00 am — Salida desde el punto de encuentro. 10:30 am — Llegada a Cenote X. Nado libre 1hr…"'}</em></p>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                  <div>
                    <label className="block text-sm font-semibold text-gray-700 mb-1">
                      Qué Incluye <span className="text-gray-400 text-xs font-normal">Opcional</span>
                    </label>
                    <p className="text-xs text-gray-500 mb-2">Lista todo lo que está cubierto en el precio. Ej: <em>Transporte, guía, entrada al sitio, comida</em>.</p>
                    <div className="space-y-2">
                      {includes.map((include, index) => (
                        <div key={index} className="flex items-center gap-2">
                          <div className="w-5 h-5 rounded-full bg-green-100 flex items-center justify-center flex-shrink-0">
                            <span className="text-green-600 text-xs font-bold">+</span>
                          </div>
                          <input
                            type="text"
                            value={include}
                            onChange={(e) => handleIncludeChange(index, e.target.value)}
                            className="input flex-1 text-sm"
                            placeholder="Ej: Alojamiento por 3 noches"
                          />
                          {includes.length > 1 && (
                            <button
                              type="button"
                              onClick={() => removeInclude(index)}
                              className="p-1.5 text-gray-400 hover:text-red-500 transition-colors"
                            >
                              <X className="h-4 w-4" />
                            </button>
                          )}
                        </div>
                      ))}
                      <button
                        type="button"
                        onClick={addInclude}
                        className="text-green-600 hover:text-green-700 text-sm font-medium flex items-center gap-1 mt-1"
                      >
                        <Plus className="w-4 h-4" /> Agregar elemento
                      </button>
                    </div>
                  </div>

                  <div>
                    <label className="block text-sm font-semibold text-gray-700 mb-1">
                      Qué NO Incluye <span className="text-gray-400 text-xs font-normal">Opcional</span>
                    </label>
                    <p className="text-xs text-gray-500 mb-2">Aclara qué queda fuera del precio para evitar malentendidos. Ej: <em>Vuelos, propinas, gastos personales</em>.</p>
                    <div className="space-y-2">
                      {excludes.map((exclude, index) => (
                        <div key={index} className="flex items-center gap-2">
                          <div className="w-5 h-5 rounded-full bg-red-100 flex items-center justify-center flex-shrink-0">
                            <span className="text-red-500 text-xs font-bold">−</span>
                          </div>
                          <input
                            type="text"
                            value={exclude}
                            onChange={(e) => handleExcludeChange(index, e.target.value)}
                            className="input flex-1 text-sm"
                            placeholder="Ej: Vuelos de llegada y salida"
                          />
                          {excludes.length > 1 && (
                            <button
                              type="button"
                              onClick={() => removeExclude(index)}
                              className="p-1.5 text-gray-400 hover:text-red-500 transition-colors"
                            >
                              <X className="h-4 w-4" />
                            </button>
                          )}
                        </div>
                      ))}
                      <button
                        type="button"
                        onClick={addExclude}
                        className="text-red-500 hover:text-red-600 text-sm font-medium flex items-center gap-1 mt-1"
                      >
                        <Plus className="w-4 h-4" /> Agregar elemento
                      </button>
                    </div>
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-1">
                    Imagen Principal del Tour <span className="text-red-500">*</span>
                  </label>
                  <p className="text-xs text-gray-500 mb-2">Una foto atractiva aumenta drásticamente las reservas. Recomendado: horizontal, mínimo 1200×800 px. Sube un archivo o pega una URL.</p>
                  <ImageUploader
                    onImageSelect={handleImageSelect}
                    currentImage={formData.image_url}
                    maxSizeMB={5}
                    placeholder="Subir imagen del tour"
                    storageFolder="tours"
                  />
                  <div className="mt-3">
                    <label className="block text-xs font-medium text-gray-500 mb-1">O pega una URL de imagen</label>
                    <input
                      type="url"
                      value={formData.image_url}
                      onChange={(e) => {
                        setFormData({...formData, image_url: e.target.value});
                      }}
                      className="input text-sm"
                      placeholder="https://ejemplo.com/imagen.jpg"
                    />
                  </div>
                </div>
              </div>
            </div>

            {/* SECCIÓN 4 — Precios */}
            <div className="bg-white rounded-xl shadow-sm border border-green-100 overflow-hidden">
              <div className="bg-green-600 px-5 py-3 flex items-center gap-2">
                <div className="bg-white/20 rounded-lg p-1.5">
                  <DollarSign className="w-4 h-4 text-white" />
                </div>
                <div>
                  <h3 className="text-white font-semibold text-sm">Paso 4 — Precios</h3>
                  <p className="text-green-100 text-xs">Precio base, depósito y tarifas por tipo de viajero</p>
                </div>
                <span className="ml-auto bg-white/20 text-white text-xs px-2 py-0.5 rounded-full">Requerido</span>
              </div>
              <div className="p-5 space-y-5">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-semibold text-gray-700 mb-1.5">
                      Precio Base del Tour (MXN) <span className="text-red-500">*</span>
                    </label>
                    <div className="relative">
                      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 font-medium">$</span>
                      <input
                        type="number"
                        value={formData.price}
                        onChange={(e) => setFormData({...formData, price: e.target.value})}
                        className="input pl-7"
                        min="0"
                        step="0.01"
                        placeholder="0.00"
                        required
                      />
                    </div>
                    <p className="text-xs text-gray-500 mt-1">Precio de referencia por persona. Si defines tarifas por categoría (adulto, niño…) abajo, esas tarifas tendrán prioridad.</p>
                  </div>
                  <div>
                    <label className="block text-sm font-semibold text-gray-700 mb-1.5">
                      Porcentaje de Anticipo <span className="text-red-500">*</span>
                    </label>
                    <div className="relative">
                      <input
                        type="number"
                        value={formData.deposit_percentage}
                        onChange={(e) => setFormData({...formData, deposit_percentage: e.target.value})}
                        className="input pr-8"
                        min="30"
                        max="100"
                        placeholder="30"
                        required
                      />
                      <span className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 font-medium">%</span>
                    </div>
                    <p className="text-xs text-gray-500 mt-1">Mínimo 30% — Máximo 100%. Ej: <em>50</em> = el viajero paga la mitad al reservar y el resto antes de la salida.</p>
                  </div>
                </div>

                <div>
                  <h4 className="text-sm font-semibold text-gray-700 mb-3 flex items-center gap-2">
                    <Users className="w-4 h-4 text-green-600" />
                    Tarifas por Categoría de Viajero
                  </h4>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    {[
                      { key: 'admite_adultos', priceKey: 'precio_adulto', label: 'Adultos', age: '13-59 años', color: 'blue' },
                      { key: 'admite_ninos', priceKey: 'precio_nino', label: 'Niños', age: '3-12 años', color: 'yellow' },
                      { key: 'admite_infantes', priceKey: 'precio_infante', label: 'Infantes', age: '0-2 años', color: 'pink' },
                      { key: 'admite_adultos_mayores', priceKey: 'precio_adulto_mayor', label: 'Adultos Mayores', age: '60+ con INAPAM', color: 'orange' },
                    ].map(({ key, priceKey, label, age, color }) => {
                      const isAdmitted = formData[key as keyof typeof formData] as boolean;
                      const colorMap: Record<string, string> = {
                        blue: 'border-blue-200 bg-blue-50',
                        yellow: 'border-yellow-200 bg-yellow-50',
                        pink: 'border-pink-200 bg-pink-50',
                        orange: 'border-orange-200 bg-orange-50',
                      };
                      const checkMap: Record<string, string> = {
                        blue: 'text-blue-600',
                        yellow: 'text-yellow-600',
                        pink: 'text-pink-600',
                        orange: 'text-orange-600',
                      };
                      return (
                        <div key={key} className={`rounded-lg border-2 p-3 transition-all ${isAdmitted ? colorMap[color] : 'border-gray-200 bg-gray-50'}`}>
                          <label className="flex items-center gap-2 cursor-pointer mb-2">
                            <input
                              type="checkbox"
                              checked={isAdmitted}
                              onChange={(e) => setFormData({...formData, [key]: e.target.checked})}
                              className={`w-4 h-4 border-gray-300 rounded focus:ring-2 ${checkMap[color]}`}
                            />
                            <div>
                              <span className={`text-sm font-semibold ${isAdmitted ? 'text-gray-800' : 'text-gray-500'}`}>{label}</span>
                              <span className="ml-1.5 text-xs text-gray-400">({age})</span>
                            </div>
                          </label>
                          {isAdmitted && (
                            <div className="relative">
                              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm">$</span>
                              <input
                                type="number"
                                value={formData[priceKey as keyof typeof formData] as string}
                                onChange={(e) => setFormData({...formData, [priceKey]: e.target.value})}
                                className="input pl-7 text-sm py-2"
                                min="0"
                                step="0.01"
                                placeholder="Precio por persona"
                              />
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                  <p className="text-xs text-gray-500 mt-2">
                    Si no especificas un precio, se usará el precio base como referencia.
                  </p>
                </div>

                {/* Pet Friendly dentro de precios */}
                <div className={`rounded-xl border-2 p-4 transition-all ${formData.pet_friendly ? 'border-emerald-300 bg-emerald-50' : 'border-gray-200 bg-gray-50'}`}>
                  <label className="flex items-center gap-3 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={formData.pet_friendly}
                      onChange={(e) => setFormData({...formData, pet_friendly: e.target.checked})}
                      className="w-5 h-5 text-emerald-600 border-gray-300 rounded focus:ring-emerald-500"
                    />
                    <div className="flex items-center gap-2">
                      <PawPrint className={`w-5 h-5 ${formData.pet_friendly ? 'text-emerald-600' : 'text-gray-400'}`} />
                      <div>
                        <span className={`text-sm font-semibold ${formData.pet_friendly ? 'text-emerald-800' : 'text-gray-600'}`}>
                          Este tour es Pet Friendly (admite mascotas)
                        </span>
                        <p className="text-xs text-gray-500">Activa esta opción si el tour permite llevar mascotas</p>
                      </div>
                    </div>
                  </label>
                  {formData.pet_friendly && (
                    <div className="mt-3 ml-8">
                      <label className="block text-xs font-semibold text-emerald-700 mb-1.5">Costo adicional por mascota (MXN)</label>
                      <div className="relative max-w-xs">
                        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm">$</span>
                        <input
                          type="number"
                          value={formData.precio_mascota}
                          onChange={(e) => setFormData({...formData, precio_mascota: e.target.value})}
                          className="input pl-7 text-sm"
                          min="0"
                          step="0.01"
                          placeholder="0.00 — gratis si se deja vacío"
                        />
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* SECCIÓN 5 — Capacidad y Reservas */}
            <div className="bg-white rounded-xl shadow-sm border border-rose-100 overflow-hidden">
              <div className="bg-rose-600 px-5 py-3 flex items-center gap-2">
                <div className="bg-white/20 rounded-lg p-1.5">
                  <Settings className="w-4 h-4 text-white" />
                </div>
                <div>
                  <h3 className="text-white font-semibold text-sm">Paso 5 — Capacidad y Reservas</h3>
                  <p className="text-rose-100 text-xs">Cuántas personas y cómo se gestionan las reservas</p>
                </div>
              </div>
              <div className="p-5 space-y-5">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-semibold text-gray-700 mb-1.5">
                      Tamaño Máximo del Grupo <span className="text-gray-400 text-xs font-normal">Opcional</span>
                    </label>
                    <div className="relative">
                      <Users className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                      <input
                        type="number"
                        value={formData.max_travelers}
                        onChange={(e) => setFormData({...formData, max_travelers: e.target.value})}
                        className="input pl-9"
                        min="1"
                        placeholder="Ej: 20"
                      />
                    </div>
                    <p className="text-xs text-gray-500 mt-1">Límite total de personas en el tour. Vacío = sin límite definido.</p>
                  </div>
                  {tourType === 'excursion' && (
                    <div>
                      <label className="block text-sm font-semibold text-gray-700 mb-1.5">
                        Lugares Disponibles para Reserva
                      </label>
                      <div className="relative">
                        <Users className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                        <input
                          type="number"
                          value={formData.available_spots}
                          onChange={(e) => setFormData({...formData, available_spots: e.target.value})}
                          className="input pl-9"
                          min="0"
                          max={formData.max_travelers || undefined}
                          placeholder="Deja vacío para usar el máximo"
                        />
                      </div>
                      <p className="text-xs text-gray-500 mt-1">Útil si ya tienes reservas previas o cupos comprometidos</p>
                    </div>
                  )}
                  {tourType === 'excursion' && (
                    <div>
                      <label className="block text-sm font-semibold text-gray-700 mb-1.5">
                        Fecha Límite de Reserva
                      </label>
                      <input
                        type="date"
                        value={formData.booking_deadline}
                        onChange={(e) => setFormData({...formData, booking_deadline: e.target.value})}
                        className="input"
                      />
                      <p className="text-xs text-gray-500 mt-1">Por defecto: 14 días antes del inicio</p>
                    </div>
                  )}
                  <div>
                    <label className="block text-sm font-semibold text-gray-700 mb-1.5">
                      Tipo de Reserva <span className="text-red-500">*</span>
                    </label>
                    <select
                      value={formData.booking_approval_type}
                      onChange={(e) => setFormData({...formData, booking_approval_type: e.target.value as 'automatic' | 'manual'})}
                      className="input"
                      required
                    >
                      <option value="automatic">Automática — el viajero paga al instante</option>
                      <option value="manual">Con aprobación manual — tú apruebas primero</option>
                    </select>
                    <p className="text-xs text-gray-500 mt-1">
                      {formData.booking_approval_type === 'automatic'
                        ? 'La reserva se confirma inmediatamente y el viajero paga el anticipo en ese momento. Ideal para tours de alta demanda.'
                        : 'El viajero solicita la reserva y tú la apruebas o rechazas antes de que se realice el cobro. Útil para tours personalizados o con cupos muy limitados.'
                      }
                    </p>
                  </div>
                </div>

                <div className="space-y-3">
                  <h4 className="text-sm font-semibold text-gray-700 flex items-center gap-2">
                    <Ban className="w-4 h-4 text-rose-500" />
                    Restricciones del Tour
                  </h4>
                  <p className="text-xs text-gray-500">Estas restricciones se mostrarán al viajero antes de confirmar su reserva.</p>

                  <div className={`rounded-xl border-2 p-4 transition-all ${formData.cancellation_not_allowed ? 'border-red-300 bg-red-50' : 'border-gray-200 bg-gray-50'}`}>
                    <label className="flex items-start gap-3 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={formData.cancellation_not_allowed}
                        onChange={(e) => setFormData({...formData, cancellation_not_allowed: e.target.checked})}
                        className="w-5 h-5 mt-0.5 text-red-600 border-gray-300 rounded focus:ring-red-500 flex-shrink-0"
                      />
                      <div>
                        <span className={`text-sm font-semibold ${formData.cancellation_not_allowed ? 'text-red-800' : 'text-gray-700'}`}>
                          Este tour NO permite cancelaciones con reembolso
                        </span>
                        <p className="text-xs text-gray-500 mt-1">
                          Los viajeros solo podrán cancelar para evitar la penalización de No Show. Esta restricción será visible en la página del tour.
                        </p>
                      </div>
                    </label>
                  </div>

                  {tourType === 'receptivo' && !formData.cancellation_not_allowed && (
                    <div className="space-y-3">
                      <p className="text-xs text-gray-500">Define cuántas horas antes del tour puede cancelar el viajero y qué porcentaje se le reembolsa. Tienes tres zonas: <strong>flexible</strong> (reembolso total), <strong>moderada</strong> (reembolso parcial) y <strong>sin reembolso</strong> (automática).</p>
                      <div className="bg-green-50 border border-green-200 rounded-xl p-3">
                        <p className="text-xs font-semibold text-green-700 mb-2">Zona flexible — reembolso total</p>
                        <div className="grid grid-cols-2 gap-3">
                          <div>
                            <label className="block text-xs text-gray-600 mb-1">Horas mínimas antes del tour</label>
                            <input
                              type="number" min="1" value={receptivoData.flexible_hours}
                              onChange={e => setReceptivoData(prev => ({ ...prev, flexible_hours: e.target.value }))}
                              className="input" />
                          </div>
                          <div>
                            <label className="block text-xs text-gray-600 mb-1">% de reembolso</label>
                            <input
                              type="number" min="0" max="100" value={receptivoData.flexible_refund_percentage}
                              onChange={e => setReceptivoData(prev => ({ ...prev, flexible_refund_percentage: e.target.value }))}
                              className="input" />
                          </div>
                        </div>
                      </div>

                      <div className="bg-yellow-50 border border-yellow-200 rounded-xl p-3">
                        <p className="text-xs font-semibold text-yellow-700 mb-2">Zona moderada — reembolso parcial</p>
                        <div className="grid grid-cols-2 gap-3">
                          <div>
                            <label className="block text-xs text-gray-600 mb-1">Horas mínimas antes del tour</label>
                            <input
                              type="number" min="1" value={receptivoData.moderate_hours}
                              onChange={e => setReceptivoData(prev => ({ ...prev, moderate_hours: e.target.value }))}
                              className="input" />
                            {parseInt(receptivoData.moderate_hours) >= parseInt(receptivoData.flexible_hours) && (
                              <p className="text-[10px] text-red-500 mt-1">Debe ser menor que las horas flexibles ({receptivoData.flexible_hours} hrs)</p>
                            )}
                          </div>
                          <div>
                            <label className="block text-xs text-gray-600 mb-1">% de reembolso</label>
                            <input
                              type="number" min="0" max="100" value={receptivoData.moderate_refund_percentage}
                              onChange={e => setReceptivoData(prev => ({ ...prev, moderate_refund_percentage: e.target.value }))}
                              className="input" />
                          </div>
                        </div>
                      </div>

                      <div className="bg-red-50 border border-red-200 rounded-xl p-3">
                        <p className="text-xs font-semibold text-red-700 mb-1">Zona sin reembolso — calculada automáticamente</p>
                        <p className="text-xs text-red-600">Menos de {receptivoData.moderate_hours || '—'} horas antes del tour: 0% de reembolso</p>
                      </div>

                      <div className="bg-gray-50 border border-gray-200 rounded-xl p-3">
                        <p className="text-xs font-semibold text-gray-600 mb-2">Resumen de política</p>
                        <div className="space-y-1">
                          <div className="flex items-center gap-2 text-xs text-gray-700">
                            <span className="w-2 h-2 rounded-full bg-green-500 flex-shrink-0" />
                            <span>{receptivoData.flexible_hours}+ horas antes: reembolso del {receptivoData.flexible_refund_percentage}%</span>
                          </div>
                          <div className="flex items-center gap-2 text-xs text-gray-700">
                            <span className="w-2 h-2 rounded-full bg-yellow-500 flex-shrink-0" />
                            <span>{receptivoData.moderate_hours} a {receptivoData.flexible_hours} horas antes: reembolso del {receptivoData.moderate_refund_percentage}%</span>
                          </div>
                          <div className="flex items-center gap-2 text-xs text-gray-700">
                            <span className="w-2 h-2 rounded-full bg-red-500 flex-shrink-0" />
                            <span>Menos de {receptivoData.moderate_hours} horas antes: sin reembolso (0%)</span>
                          </div>
                        </div>
                      </div>
                    </div>
                  )}
                  <div className={`rounded-xl border-2 p-4 transition-all ${formData.name_changes_not_allowed ? 'border-orange-300 bg-orange-50' : 'border-gray-200 bg-gray-50'}`}>
                    <label className="flex items-start gap-3 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={formData.name_changes_not_allowed}
                        onChange={(e) => setFormData({...formData, name_changes_not_allowed: e.target.checked})}
                        className="w-5 h-5 mt-0.5 text-orange-600 border-gray-300 rounded focus:ring-orange-500 flex-shrink-0"
                      />
                      <div>
                        <span className={`text-sm font-semibold ${formData.name_changes_not_allowed ? 'text-orange-800' : 'text-gray-700'}`}>
                          Este tour NO permite cambios de nombre una vez pagada la reserva
                        </span>
                        <p className="text-xs text-gray-500 mt-1">
                          Ideal para tours aéreos o con boletos nominales. El viajero verá una advertencia al capturar los nombres de los acompañantes.
                        </p>
                      </div>
                    </label>
                  </div>
                  <div className={`rounded-xl border-2 p-4 transition-all ${formData.includes_insurance ? 'border-blue-300 bg-blue-50' : 'border-gray-200 bg-gray-50'}`}>
                    <label className="flex items-start gap-3 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={formData.includes_insurance}
                        onChange={(e) => setFormData({...formData, includes_insurance: e.target.checked})}
                        className="w-5 h-5 mt-0.5 text-blue-600 border-gray-300 rounded focus:ring-blue-500 flex-shrink-0"
                      />
                      <div className="flex items-start gap-2">
                        <Shield className={`w-5 h-5 mt-0.5 ${formData.includes_insurance ? 'text-blue-600' : 'text-gray-400'}`} />
                        <div>
                          <span className={`text-sm font-semibold ${formData.includes_insurance ? 'text-blue-800' : 'text-gray-700'}`}>
                            Mi tour ya incluye seguro de viaje
                          </span>
                          <p className="text-xs text-gray-500 mt-1">
                            Activa esta opcion si el costo del tour ya incluye un seguro contratado por tu agencia. No se le ofrecera al viajero la compra del seguro de la plataforma.
                          </p>
                        </div>
                      </div>
                    </label>
                  </div>
                </div>
                {activityType === 'transport' && receptivoModality === 'privado' && (
                  <div className="space-y-4 border border-teal-200 rounded-xl p-4 bg-teal-50/40">
                    <h4 className="text-sm font-semibold text-teal-800 flex items-center gap-2">
                      <Bus className="w-4 h-4" />
                      Configuración del Vehículo Privado
                    </h4>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div>
                        <label className="block text-sm font-semibold text-gray-700 mb-1.5">
                          Capacidad máxima del vehículo <span className="text-red-500">*</span>
                        </label>
                        <input
                          type="number"
                          min="1"
                          max="50"
                          value={privateVehicleCapacity}
                          onChange={e => setPrivateVehicleCapacity(e.target.value)}
                          className="input"
                          placeholder="Ej: 4"
                        />
                        <p className="text-xs text-gray-500 mt-1">Pasajeros máximos que caben en el vehículo. Ej: 4 para sedán, 7 para minivan, 15 para sprinter.</p>
                      </div>
                      <div>
                        <label className="block text-sm font-semibold text-gray-700 mb-1.5">
                          Precio por <span className="text-red-500">*</span>
                        </label>
                        <div className="grid grid-cols-2 gap-2">
                          <button
                            type="button"
                            onClick={() => setTransferPricingMode('per_person')}
                            className={`p-3 rounded-lg border-2 text-left transition-all ${transferPricingMode === 'per_person' ? 'border-teal-500 bg-teal-50' : 'border-gray-200 bg-white hover:border-gray-300'}`}
                          >
                            <p className={`text-sm font-semibold ${transferPricingMode === 'per_person' ? 'text-teal-800' : 'text-gray-700'}`}>Por persona</p>
                            <p className="text-xs text-gray-500 mt-0.5">El precio se multiplica por número de viajeros</p>
                          </button>
                          <button
                            type="button"
                            onClick={() => setTransferPricingMode('per_vehicle')}
                            className={`p-3 rounded-lg border-2 text-left transition-all ${transferPricingMode === 'per_vehicle' ? 'border-teal-500 bg-teal-50' : 'border-gray-200 bg-white hover:border-gray-300'}`}
                          >
                            <p className={`text-sm font-semibold ${transferPricingMode === 'per_vehicle' ? 'text-teal-800' : 'text-gray-700'}`}>Por vehículo</p>
                            <p className="text-xs text-gray-500 mt-0.5">Precio fijo sin importar cuántos viajeros van</p>
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                {/* Mapa de Asientos — solo para traslados compartidos y demás tours */}
                {!(activityType === 'transport' && receptivoModality === 'privado') && (
                  <div className="space-y-3">
                    <h4 className="text-sm font-semibold text-gray-700 flex items-center gap-2">
                      <Bus className="w-4 h-4 text-blue-600" />
                      Mapa de Asientos Interactivo
                      <span className="text-xs font-normal text-gray-400">Opcional</span>
                    </h4>
                    <p className="text-xs text-gray-500">Permite que los viajeros elijan su asiento al reservar. Solo disponible para tours en autobús o sprinter.</p>
                    <div className={`rounded-xl border-2 p-4 transition-all ${formData.vehicle_map_type ? 'border-blue-300 bg-blue-50' : 'border-gray-200 bg-gray-50'}`}>
                      <label className="flex items-center gap-3 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={!!formData.vehicle_map_type}
                          onChange={(e) => setFormData({ ...formData, vehicle_map_type: e.target.checked ? 'sprinter_20' : null })}
                          className="w-5 h-5 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
                        />
                        <div>
                          <span className={`text-sm font-semibold ${formData.vehicle_map_type ? 'text-blue-800' : 'text-gray-600'}`}>
                            Activar mapa de asientos para este tour
                          </span>
                          <p className="text-xs text-gray-500">Los viajeros podran elegir su asiento al reservar. Aplica para excursiones y tours compartidos.</p>
                        </div>
                      </label>
                      {formData.vehicle_map_type && (
                        <div className="mt-4 ml-8 space-y-3">
                          <p className="text-xs font-semibold text-blue-700">Selecciona el tipo de vehiculo:</p>
                          <div className="grid grid-cols-2 gap-3">
                            {VEHICLE_OPTIONS.map(opt => {
                              const capacidad = parseInt(formData.max_travelers || '0');
                              const mismatch = capacidad > 0 && capacidad !== opt.capacity;
                              return (
                                <button
                                  key={opt.type}
                                  type="button"
                                  onClick={() => setFormData({ ...formData, vehicle_map_type: opt.type })}
                                  className={`relative p-4 rounded-xl border-2 text-left transition-all ${
                                    formData.vehicle_map_type === opt.type
                                      ? 'border-blue-600 bg-blue-100'
                                      : 'border-gray-200 bg-white hover:border-blue-300'
                                  }`}
                                >
                                  <div className="flex items-center gap-2 mb-1">
                                    <Bus className={`w-5 h-5 ${formData.vehicle_map_type === opt.type ? 'text-blue-700' : 'text-gray-500'}`} />
                                    <span className={`text-sm font-semibold ${formData.vehicle_map_type === opt.type ? 'text-blue-800' : 'text-gray-700'}`}>{opt.label}</span>
                                  </div>
                                  <p className={`text-xs ${formData.vehicle_map_type === opt.type ? 'text-blue-600' : 'text-gray-500'}`}>{opt.description}</p>
                                  {formData.vehicle_map_type === opt.type && mismatch && (
                                    <div className="mt-2 flex items-start gap-1 text-amber-700 bg-amber-50 rounded-lg p-2">
                                      <AlertTriangle className="w-3 h-3 mt-0.5 flex-shrink-0" />
                                      <p className="text-xs">La capacidad configurada ({capacidad}) no coincide con la del vehiculo ({opt.capacity}). Se recomienda actualizarla.</p>
                                    </div>
                                  )}
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {/* Idiomas disponibles — solo receptivo (no traslados ni entradas) */}
                {tourType === 'receptivo' && activityType !== 'transport' && activityType !== 'ticket' && (
                  <div className="space-y-3">
                    <h4 className="text-sm font-semibold text-gray-700 flex items-center gap-2">
                      <Globe className="w-4 h-4 text-teal-600" />
                      Idiomas Disponibles
                      <span className="text-xs font-normal text-gray-400">Opcional</span>
                    </h4>
                    <p className="text-xs text-gray-500">Si ofreces el tour en más de un idioma, agrégalos aquí. Puedes indicar si hay un costo adicional por guía en otro idioma. Si no agregas nada, se asume que el tour es solo en español.</p>
                    <div className="border border-gray-200 rounded-xl p-4 space-y-3">
                      {tourLanguages.length === 0 && (
                        <p className="text-xs text-gray-400 italic">No hay idiomas configurados. El tour se realiza solo en el idioma local.</p>
                      )}
                      {tourLanguages.map((lang, idx) => (
                        <div key={idx} className="flex items-center gap-2 bg-gray-50 rounded-lg p-2">
                          <select
                            value={lang.language}
                            onChange={e => {
                              const updated = [...tourLanguages];
                              updated[idx] = { ...updated[idx], language: e.target.value };
                              setTourLanguages(updated);
                            }}
                            className="input text-sm flex-1"
                          >
                            <option value="">Seleccionar idioma...</option>
                            <option value="Español">Español</option>
                            <option value="Inglés">Inglés</option>
                            <option value="Francés">Francés</option>
                            <option value="Alemán">Alemán</option>
                            <option value="Portugués">Portugués</option>
                            <option value="Italiano">Italiano</option>
                            <option value="Chino Mandarín">Chino Mandarín</option>
                            <option value="Japonés">Japonés</option>
                            <option value="Coreano">Coreano</option>
                            <option value="Árabe">Árabe</option>
                            <option value="Ruso">Ruso</option>
                          </select>
                          <div className="flex items-center gap-1 flex-shrink-0">
                            <span className="text-gray-400 text-xs font-medium">+$</span>
                            <input
                              type="number"
                              value={lang.extra_cost}
                              onChange={e => {
                                const updated = [...tourLanguages];
                                updated[idx] = { ...updated[idx], extra_cost: e.target.value };
                                setTourLanguages(updated);
                              }}
                              className="input text-xs w-24"
                              placeholder="0 = gratis"
                              min="0"
                              step="0.01"
                            />
                          </div>
                          <select
                            value={lang.cost_type}
                            onChange={e => {
                              const updated = [...tourLanguages];
                              updated[idx] = { ...updated[idx], cost_type: e.target.value as 'por_persona' | 'fijo' };
                              setTourLanguages(updated);
                            }}
                            className="input text-xs w-32 flex-shrink-0"
                          >
                            <option value="por_persona">Por persona</option>
                            <option value="fijo">Fijo por reserva</option>
                          </select>
                          <button
                            type="button"
                            onClick={() => setTourLanguages(prev => prev.filter((_, i) => i !== idx))}
                            className="text-red-400 hover:text-red-600 flex-shrink-0"
                          >
                            <X className="w-4 h-4" />
                          </button>
                        </div>
                      ))}
                      <button
                        type="button"
                        onClick={() => setTourLanguages(prev => [...prev, { language: '', extra_cost: '', cost_type: 'por_persona' }])}
                        className="flex items-center gap-1.5 text-sm text-teal-600 hover:text-teal-800 font-medium"
                      >
                        <Plus className="w-4 h-4" />
                        Agregar idioma
                      </button>
                    </div>
                  </div>
                )}

                {/* Restricciones físicas — solo receptivo con actividad guiada o experiencia */}
                {tourType === 'receptivo' && activityType !== 'transport' && activityType !== 'ticket' && (
                  <div className="space-y-3">
                    <h4 className="text-sm font-semibold text-gray-700 flex items-center gap-2">
                      <AlertTriangle className="w-4 h-4 text-amber-500" />
                      Restricciones de Aptitud Física
                      <span className="text-xs font-normal text-gray-400">Opcional</span>
                    </h4>
                    <p className="text-xs text-gray-500">Activa las restricciones que apliquen. El viajero deberá aceptarlas antes de completar su reserva, y se mostrarán en la página del tour.</p>
                    <div className="border border-gray-200 rounded-xl p-4 space-y-3">
                      <div className={`rounded-lg border p-3 transition-all ${restrictionPregnant ? 'border-amber-300 bg-amber-50' : 'border-gray-200 bg-gray-50'}`}>
                        <label className="flex items-center gap-3 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={restrictionPregnant}
                            onChange={e => setRestrictionPregnant(e.target.checked)}
                            className="w-4 h-4 text-amber-600 border-gray-300 rounded focus:ring-amber-500"
                          />
                          <span className={`text-sm font-medium ${restrictionPregnant ? 'text-amber-800' : 'text-gray-700'}`}>
                            No apto para mujeres embarazadas
                          </span>
                        </label>
                      </div>
                      <div className={`rounded-lg border p-3 transition-all ${restrictionDisability ? 'border-amber-300 bg-amber-50' : 'border-gray-200 bg-gray-50'}`}>
                        <label className="flex items-center gap-3 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={restrictionDisability}
                            onChange={e => setRestrictionDisability(e.target.checked)}
                            className="w-4 h-4 text-amber-600 border-gray-300 rounded focus:ring-amber-500"
                          />
                          <span className={`text-sm font-medium ${restrictionDisability ? 'text-amber-800' : 'text-gray-700'}`}>
                            No apto para personas con alguna discapacidad
                          </span>
                        </label>
                      </div>
                      <div className={`rounded-lg border p-3 transition-all ${restrictionPhysical ? 'border-amber-300 bg-amber-50' : 'border-gray-200 bg-gray-50'}`}>
                        <label className="flex items-center gap-3 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={restrictionPhysical}
                            onChange={e => setRestrictionPhysical(e.target.checked)}
                            className="w-4 h-4 text-amber-600 border-gray-300 rounded focus:ring-amber-500"
                          />
                          <span className={`text-sm font-medium ${restrictionPhysical ? 'text-amber-800' : 'text-gray-700'}`}>
                            No apto para personas con mala condición física
                          </span>
                        </label>
                      </div>
                      {(restrictionPregnant || restrictionDisability || restrictionPhysical) && (
                        <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 flex gap-2">
                          <AlertTriangle className="w-4 h-4 text-amber-600 flex-shrink-0 mt-0.5" />
                          <p className="text-xs text-amber-700">
                            Las restricciones activas serán visibles en la página del tour y el viajero deberá aceptarlas antes de poder reservar.
                          </p>
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* SECCIÓN 6 — Servicios Opcionales */}
            <div className="bg-white rounded-xl shadow-sm border border-amber-100 overflow-hidden">
              <div className="bg-amber-600 px-5 py-3 flex items-center gap-2">
                <div className="bg-white/20 rounded-lg p-1.5">
                  <ShoppingBag className="w-4 h-4 text-white" />
                </div>
                <div>
                  <h3 className="text-white font-semibold text-sm">Paso 6 — Servicios Opcionales</h3>
                  <p className="text-amber-100 text-xs">Extras que el viajero puede agregar al reservar (boletos, snorkel, cenas, etc.)</p>
                </div>
                <span className="ml-auto bg-white/20 text-white text-xs px-2 py-0.5 rounded-full">Opcional</span>
              </div>
              <div className="p-5 space-y-4">
                <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 flex gap-2 text-sm text-amber-800">
                  <Info className="w-4 h-4 flex-shrink-0 mt-0.5" />
                  <p>
                    Agrega servicios extras con precio y cupo propio. Si el <strong>viajero</strong> cancela, los servicios marcados como <em>no reembolsables</em> no se devuelven. Si <strong>tú</strong> cancelas la reserva, todos los opcionales se reembolsan al viajero sin excepción.
                  </p>
                </div>

                {optionalServices.length === 0 && (
                  <p className="text-sm text-gray-500 text-center py-2">No hay servicios opcionales. Haz clic en "Agregar servicio" para crear uno.</p>
                )}

                {optionalServices.map((svc, index) => (
                  <div key={index} className="border border-gray-200 rounded-lg p-4 space-y-3 bg-gray-50">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Servicio {index + 1}</span>
                      <button
                        type="button"
                        onClick={() => removeOptionalService(index)}
                        className="text-red-500 hover:text-red-700 transition-colors"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      <div>
                        <label className="block text-xs font-semibold text-gray-700 mb-1">
                          Nombre <span className="text-red-500">*</span>
                        </label>
                        <input
                          type="text"
                          value={svc.name}
                          onChange={(e) => updateOptionalService(index, 'name', e.target.value)}
                          className="input text-sm"
                          placeholder="Ej: Snorkel, Entrada Museo, Cena Romántica"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-semibold text-gray-700 mb-1">
                          Descripción breve
                        </label>
                        <input
                          type="text"
                          value={svc.description}
                          onChange={(e) => updateOptionalService(index, 'description', e.target.value)}
                          className="input text-sm"
                          placeholder="Información visible al viajero"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-semibold text-gray-700 mb-1">
                          Precio por persona (MXN) <span className="text-red-500">*</span>
                        </label>
                        <div className="relative">
                          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 font-medium text-sm">$</span>
                          <input
                            type="number"
                            value={svc.price_per_person}
                            onChange={(e) => updateOptionalService(index, 'price_per_person', e.target.value)}
                            className="input pl-7 text-sm"
                            min="0"
                            step="0.01"
                            placeholder="0.00"
                          />
                        </div>
                      </div>
                      <div>
                        <label className="block text-xs font-semibold text-gray-700 mb-1">
                          Cupo máximo
                        </label>
                        <input
                          type="number"
                          value={svc.max_capacity}
                          onChange={(e) => updateOptionalService(index, 'max_capacity', e.target.value)}
                          className="input text-sm"
                          min="1"
                          placeholder="Sin límite (dejar vacío)"
                        />
                        <p className="text-xs text-gray-400 mt-0.5">Vacío = sin límite de cupo</p>
                      </div>
                    </div>

                    <div className="flex flex-wrap gap-4 pt-1">
                      <label className="flex items-start gap-2 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={!svc.is_refundable}
                          onChange={(e) => updateOptionalService(index, 'is_refundable', !e.target.checked)}
                          className="mt-0.5 w-4 h-4 text-amber-600 rounded border-gray-300 focus:ring-amber-500"
                        />
                        <span className="text-sm text-gray-700">
                          <span className="font-medium">No reembolsable si el viajero cancela</span>
                          <span className="block text-xs text-gray-500">Si tú cancelas, siempre se reembolsa al viajero</span>
                        </span>
                      </label>
                      <label className="flex items-center gap-2 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={svc.is_active}
                          onChange={(e) => updateOptionalService(index, 'is_active', e.target.checked)}
                          className="w-4 h-4 text-green-600 rounded border-gray-300 focus:ring-green-500"
                        />
                        <span className="text-sm text-gray-700 font-medium">Activo (visible al viajero)</span>
                      </label>
                    </div>
                  </div>
                ))}

                <button
                  type="button"
                  onClick={addOptionalService}
                  className="btn btn-outline btn-sm w-full text-amber-700 border-amber-300 hover:bg-amber-50"
                >
                  <Plus className="w-4 h-4 mr-2" />
                  Agregar servicio opcional
                </button>
              </div>
            </div>

            {/* SECCIÓN 7 — Suplementos Adicionales */}
            <div className="bg-white rounded-xl shadow-sm border border-teal-100 overflow-hidden">
              <div className="bg-teal-600 px-5 py-3 flex items-center gap-2">
                <div className="bg-white/20 rounded-lg p-1.5">
                  <Tag className="w-4 h-4 text-white" />
                </div>
                <div>
                  <h3 className="text-white font-semibold text-sm">Paso 7 — Suplementos Adicionales</h3>
                  <p className="text-teal-100 text-xs">Extras que el viajero puede solicitar <strong>después</strong> de reservar (asientos preferentes, equipaje, habitación superior, etc.)</p>
                </div>
                <span className="ml-auto bg-white/20 text-white text-xs px-2 py-0.5 rounded-full">Opcional</span>
              </div>
              <div className="p-5 space-y-4">
                <div className="bg-teal-50 border border-teal-200 rounded-lg p-3 flex gap-2 text-sm text-teal-800">
                  <Info className="w-4 h-4 flex-shrink-0 mt-0.5" />
                  <p>
                    A diferencia de los servicios opcionales (que se agregan <em>al reservar</em>), los suplementos son extras que el viajero puede solicitar <em>después</em> de tener una reserva confirmada. Puedes requerir tu aprobación antes de que paguen, o permitir el pago directo. Si cancelas el tour, todos los suplementos pagados se reembolsan en ToursRed Cash al 100%.
                  </p>
                </div>

                {supplements.length === 0 && (
                  <p className="text-sm text-gray-500 text-center py-2">No hay suplementos definidos. Haz clic en "Agregar suplemento" para crear uno.</p>
                )}

                {supplements.map((sup, index) => (
                  <div key={index} className="border border-gray-200 rounded-lg p-4 space-y-3 bg-gray-50">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Suplemento {index + 1}</span>
                      <button
                        type="button"
                        onClick={() => removeSupplement(index)}
                        className="text-red-500 hover:text-red-700 transition-colors"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      <div>
                        <label className="block text-xs font-semibold text-gray-700 mb-1">
                          Nombre <span className="text-red-500">*</span>
                        </label>
                        <input
                          type="text"
                          value={sup.name}
                          onChange={(e) => updateSupplement(index, 'name', e.target.value)}
                          className="input text-sm"
                          placeholder="Ej: Asiento preferente, Equipaje extra, Habitación doble"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-semibold text-gray-700 mb-1">
                          Descripción breve
                        </label>
                        <input
                          type="text"
                          value={sup.description}
                          onChange={(e) => updateSupplement(index, 'description', e.target.value)}
                          className="input text-sm"
                          placeholder="Información visible al viajero"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-semibold text-gray-700 mb-1">
                          Precio por unidad (MXN) <span className="text-red-500">*</span>
                        </label>
                        <div className="relative">
                          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 font-medium text-sm">$</span>
                          <input
                            type="number"
                            value={sup.price}
                            onChange={(e) => updateSupplement(index, 'price', e.target.value)}
                            className="input pl-7 text-sm"
                            min="0"
                            step="0.01"
                            placeholder="0.00"
                          />
                        </div>
                      </div>
                      <div>
                        <label className="block text-xs font-semibold text-gray-700 mb-1">
                          Cupo máximo
                        </label>
                        <input
                          type="number"
                          value={sup.max_capacity}
                          onChange={(e) => updateSupplement(index, 'max_capacity', e.target.value)}
                          className="input text-sm"
                          min="1"
                          placeholder="Sin límite (dejar vacío)"
                        />
                        <p className="text-xs text-gray-400 mt-0.5">Vacío = sin límite de cupo</p>
                      </div>
                    </div>

                    <div className="flex flex-col gap-3 pt-1">
                      <label className="flex items-start gap-2 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={sup.requires_approval}
                          onChange={(e) => updateSupplement(index, 'requires_approval', e.target.checked)}
                          className="mt-0.5 w-4 h-4 text-teal-600 rounded border-gray-300 focus:ring-teal-500"
                        />
                        <span className="text-sm text-gray-700">
                          <span className="font-medium">Requiere tu aprobacion antes del pago</span>
                          <span className="block text-xs text-gray-500">El viajero solicita el suplemento y debe esperar tu aprobacion para poder pagar. Tienes 48 horas para aprobar o rechazar; si no respondes, la solicitud caduca automaticamente.</span>
                        </span>
                      </label>

                      <label className="flex items-start gap-2 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={!sup.is_cancellable}
                          onChange={(e) => updateSupplement(index, 'is_cancellable', !e.target.checked)}
                          className="mt-0.5 w-4 h-4 text-red-600 rounded border-gray-300 focus:ring-red-500"
                        />
                        <span className="text-sm text-gray-700">
                          <span className="font-medium">No cancelable (sin reembolso si el viajero cancela)</span>
                          <span className="block text-xs text-gray-500">Apropiado para asientos de aerolinea, equipaje adicional u otros con costo fijo irrecuperable. Si <em>tu</em> cancelas el tour, se reembolsa siempre al 100% en ToursRed Cash.</span>
                        </span>
                      </label>

                      {!sup.is_cancellable && (
                        <div className="ml-6 bg-red-50 border border-red-200 rounded-lg p-2 flex gap-2">
                          <AlertTriangle className="w-4 h-4 text-red-600 flex-shrink-0 mt-0.5" />
                          <p className="text-xs text-red-700">
                            Este suplemento <strong>no se reembolsa</strong> si el viajero cancela su reserva. Asegurate de que el nombre y descripcion sean claros para el viajero.
                          </p>
                        </div>
                      )}

                      <div className="flex flex-wrap gap-4">
                        <label className="flex items-center gap-2 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={sup.is_active}
                            onChange={(e) => updateSupplement(index, 'is_active', e.target.checked)}
                            className="w-4 h-4 text-green-600 rounded border-gray-300 focus:ring-green-500"
                          />
                          <span className="text-sm text-gray-700 font-medium">Activo (visible al viajero)</span>
                        </label>
                      </div>
                    </div>
                  </div>
                ))}

                <button
                  type="button"
                  onClick={addSupplement}
                  className="btn btn-outline btn-sm w-full text-teal-700 border-teal-300 hover:bg-teal-50"
                >
                  <Plus className="w-4 h-4 mr-2" />
                  Agregar suplemento adicional
                </button>
              </div>
            </div>

            {/* SECCIÓN 8 — Promociones Grupales */}
            <div className="bg-white rounded-xl shadow-sm border border-rose-100 overflow-hidden">
              <div className="bg-rose-600 px-5 py-3 flex items-center gap-2">
                <div className="bg-white/20 rounded-lg p-1.5">
                  <Percent className="w-4 h-4 text-white" />
                </div>
                <div>
                  <h3 className="text-white font-semibold text-sm">Paso 8 — Promociones Grupales</h3>
                  <p className="text-rose-100 text-xs">Configura 2x1, 3x2 o precio especial para grupos</p>
                </div>
                <span className="ml-auto bg-white/20 text-white text-xs px-2 py-0.5 rounded-full">Opcional</span>
              </div>
              <div className="p-5">
                {editingTour ? (
                  <TourPromotionsManager
                    tourId={editingTour.id}
                    agencyId={editingTour.agency_id}
                    tourPrice={parseFloat(formData.price) || editingTour.price}
                  />
                ) : (
                  <div className="flex items-start gap-3 bg-rose-50 border border-rose-200 rounded-xl p-4 text-sm text-rose-700">
                    <Percent className="w-4 h-4 mt-0.5 flex-shrink-0 text-rose-500" />
                    <p>
                      Las promociones grupales se configuran después de crear el tour. Al hacer clic en <strong>"Crear Tour"</strong>, el formulario cambiará automáticamente a modo edición donde podrás agregar promociones de inmediato.
                    </p>
                  </div>
                )}
              </div>
            </div>

            {tourType === 'receptivo' && editingTour && (
              <div className="bg-white rounded-xl shadow-sm border border-teal-100 overflow-hidden">
                <div className="bg-teal-600 px-5 py-3 flex items-center gap-2">
                  <div className="bg-white/20 rounded-lg p-1.5">
                    <Layers className="w-4 h-4 text-white" />
                  </div>
                  <div>
                    <h3 className="text-white font-semibold text-sm">Disponibilidad — Horarios y Calendario</h3>
                    <p className="text-teal-100 text-xs">Configura horarios recurrentes, bloqueos y genera slots</p>
                  </div>
                  <span className="ml-auto bg-white/20 text-white text-xs px-2 py-0.5 rounded-full">Receptivo</span>
                </div>
                <div>
                  <div className="flex border-b border-gray-100">
                    {(([
                      'info', 'horarios', 'bloqueos', 'calendario',
                      ...((editingTour as any)?.vehicle_map_type ? ['asientos'] : [])
                    ]) as ('info' | 'horarios' | 'bloqueos' | 'calendario' | 'asientos')[]).map(tab => {
                      const labels: Record<string, string> = {
                        info: 'Resumen',
                        horarios: 'Horarios',
                        bloqueos: 'Bloqueos',
                        calendario: 'Calendario',
                        asientos: 'Asientos',
                      };
                      return (
                        <button
                          key={tab}
                          type="button"
                          onClick={() => setReceptivoTab(tab)}
                          className={`flex-1 py-3 text-xs font-medium transition-colors ${
                            receptivoTab === tab
                              ? 'text-teal-700 border-b-2 border-teal-600 bg-teal-50'
                              : 'text-gray-500 hover:text-gray-700'
                          }`}
                        >
                          {labels[tab]}
                        </button>
                      );
                    })}
                  </div>
                  <div className="p-5">
                    {receptivoTab === 'info' && (
                      <div className="space-y-3 text-sm text-gray-600">
                        <p>Para que los viajeros puedan reservar este tour, asegúrate de:</p>
                        <ol className="list-decimal list-inside space-y-2 text-gray-700">
                          <li>Tener al menos un <strong>Horario</strong> activo (puedes agregar o editar en la pestaña Horarios).</li>
                          <li>Opcionalmente bloquear fechas no disponibles en <strong>Bloqueos</strong>.</li>
                          <li>En <strong>Calendario</strong>, usar <em>Generar Slots</em> para crear o actualizar las salidas disponibles.</li>
                        </ol>
                        <p className="text-xs text-gray-400 mt-2">
                          Los viajeros podrán reservar seleccionando una fecha y horario disponible.
                        </p>
                      </div>
                    )}
                    {receptivoTab === 'horarios' && (
                      <AgencyScheduleManager
                        tourId={editingTour.id}
                        agencyId={editingTour.agency_id}
                      />
                    )}
                    {receptivoTab === 'bloqueos' && (
                      <AgencyBlackoutManager
                        tourId={editingTour.id}
                        agencyId={editingTour.agency_id}
                        userId={editingTour.agency_id}
                      />
                    )}
                    {receptivoTab === 'calendario' && (
                      <AgencySlotCalendar
                        tourId={editingTour.id}
                        agencyId={editingTour.agency_id}
                        onGenerateSlots={async (start, end) => {
                          const { data, error } = await supabase.rpc('auto_generate_slots_for_range', {
                            p_tour_id: editingTour.id,
                            p_start_date: start,
                            p_end_date: end,
                          });
                          if (error) throw error;
                          alert(`Se generaron ${data} slots correctamente.`);
                        }}
                      />
                    )}
                    {receptivoTab === 'asientos' && (editingTour as any)?.vehicle_map_type && (
                      <div className="space-y-3">
                        <p className="text-xs text-gray-500">Gestiona los asientos de este tour receptivo. Selecciona una fecha/slot especifico en el Calendario para ver la disponibilidad por salida, o ve el estado general aqui.</p>
                        <SeatMapManager
                          tourId={editingTour.id}
                          agencyId={editingTour.agency_id}
                          slotId={null}
                          isReceptivo={true}
                          transferCustomTime={transferCustomTime}
                        />
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}

            {tourType === 'excursion' && editingTour && (editingTour as any)?.vehicle_map_type && (
              <div className="bg-white rounded-xl shadow-sm border border-blue-100 overflow-hidden">
                <div className="bg-blue-600 px-5 py-3 flex items-center gap-2">
                  <div className="bg-white/20 rounded-lg p-1.5">
                    <Bus className="w-4 h-4 text-white" />
                  </div>
                  <div>
                    <h3 className="text-white font-semibold text-sm">Mapa de Asientos</h3>
                    <p className="text-blue-100 text-xs">Gestiona y bloquea asientos para este tour</p>
                  </div>
                </div>
                <div className="p-5">
                  <SeatMapManager
                    tourId={editingTour.id}
                    agencyId={editingTour.agency_id}
                    slotId={null}
                    isReceptivo={tourType === 'receptivo'}
                  />
                </div>
              </div>
            )}

            {/* SECCIÓN PLAN DE PAGOS Y LIQUIDACIÓN */}
            <div className={`bg-white rounded-xl shadow-sm border-2 overflow-hidden transition-all ${
              paymentOptionsEnabled ? 'border-sky-400' : 'border-gray-200'
            }`}>
              <div className={`px-5 py-4 flex items-center justify-between ${
                paymentOptionsEnabled ? 'bg-sky-50' : 'bg-gray-50'
              }`}>
                <div className="flex items-center gap-3">
                  <div className={`w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0 ${
                    paymentOptionsEnabled ? 'bg-sky-600 text-white' : 'bg-gray-200 text-gray-500'
                  }`}>
                    <CreditCard className="w-4 h-4" />
                  </div>
                  <div>
                    <h3 className={`font-semibold text-sm ${paymentOptionsEnabled ? 'text-sky-900' : 'text-gray-700'}`}>
                      Plan de Pagos y Liquidación Avanzada
                    </h3>
                    <p className={`text-xs ${paymentOptionsEnabled ? 'text-sky-700' : 'text-gray-500'}`}>
                      {paymentOptionsEnabled
                        ? 'Opciones avanzadas activas — configura la modalidad de pago'
                        : 'Por defecto: anticipo al reservar, resto el día del tour a la agencia'}
                    </p>
                  </div>
                </div>
                {/* Toggle switch */}
                <button
                  type="button"
                  onClick={() => {
                    const next = !paymentOptionsEnabled;
                    setPaymentOptionsEnabled(next);
                    if (!next) {
                      setFormData({ ...formData, payment_option: 'standard' as PaymentOption });
                    } else {
                      setFormData({ ...formData, payment_option: 'full_upfront' as PaymentOption });
                    }
                  }}
                  className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors flex-shrink-0 ${
                    paymentOptionsEnabled ? 'bg-sky-500' : 'bg-gray-300'
                  }`}
                >
                  <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${
                    paymentOptionsEnabled ? 'translate-x-6' : 'translate-x-1'
                  }`} />
                </button>
              </div>

              {paymentOptionsEnabled && (
              <div className="px-5 py-4 space-y-4">
                {/* Opción de pago */}
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-2">Modalidad de pago</label>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
                    {[
                      { value: 'full_upfront', label: 'Pago total anticipado', desc: 'El viajero debe pagar el 100% antes de la salida' },
                      { value: 'payment_plan', label: 'Plan de pagos', desc: 'El viajero puede pagar en parcialidades' },
                      { value: 'both', label: 'Ambas opciones', desc: 'El viajero elige entre pago total o plan de pagos' },
                    ].map(opt => (
                      <label key={opt.value} className={`flex flex-col gap-1 p-3 rounded-lg border-2 cursor-pointer transition-all ${
                        formData.payment_option === opt.value
                          ? 'border-sky-500 bg-sky-50'
                          : 'border-gray-200 hover:border-gray-300'
                      }`}>
                        <input
                          type="radio"
                          className="sr-only"
                          checked={formData.payment_option === opt.value}
                          onChange={() => setFormData({ ...formData, payment_option: opt.value as PaymentOption })}
                        />
                        <span className={`text-sm font-semibold ${formData.payment_option === opt.value ? 'text-sky-800' : 'text-gray-700'}`}>{opt.label}</span>
                        <span className="text-xs text-gray-500">{opt.desc}</span>
                      </label>
                    ))}
                  </div>
                </div>

                {/* Días de liquidación anticipada */}
                {(formData.payment_option === 'full_upfront' || formData.payment_option === 'both') && (
                  <div className="max-w-xs">
                    <label className="block text-sm font-semibold text-gray-700 mb-1">
                      Días antes de salida para liquidar
                    </label>
                    <div className="relative">
                      <input
                        type="number"
                        min={15}
                        value={formData.full_payment_days_before_departure}
                        onChange={(e) => setFormData({ ...formData, full_payment_days_before_departure: e.target.value })}
                        className="input pr-14"
                        placeholder="15"
                      />
                      <span className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 text-xs">días</span>
                    </div>
                    <p className="text-xs text-gray-500 mt-1">Mínimo 15 días</p>
                  </div>
                )}

                {/* Modo de plan de pagos */}
                {(formData.payment_option === 'payment_plan' || formData.payment_option === 'both') && (
                  <div className="space-y-4">
                    <div>
                      <label className="block text-sm font-semibold text-gray-700 mb-2">Modo del plan de pagos</label>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                        {[
                          { value: 'installments', label: 'Parcialidades programadas', desc: 'Define fechas y montos exactos de cada pago' },
                          { value: 'free_form', label: 'Abonos libres', desc: 'El viajero abona lo que quiera cuando quiera' },
                        ].map(opt => (
                          <label key={opt.value} className={`flex flex-col gap-1 p-3 rounded-lg border-2 cursor-pointer transition-all ${
                            formData.payment_plan_mode === opt.value
                              ? 'border-sky-500 bg-sky-50'
                              : 'border-gray-200 hover:border-gray-300'
                          }`}>
                            <input
                              type="radio"
                              className="sr-only"
                              checked={formData.payment_plan_mode === opt.value}
                              onChange={() => setFormData({ ...formData, payment_plan_mode: opt.value as PaymentPlanMode })}
                            />
                            <span className={`text-sm font-semibold ${formData.payment_plan_mode === opt.value ? 'text-sky-800' : 'text-gray-700'}`}>{opt.label}</span>
                            <span className="text-xs text-gray-500">{opt.desc}</span>
                          </label>
                        ))}
                      </div>
                    </div>

                    {/* Parcialidades programadas */}
                    {formData.payment_plan_mode === 'installments' && (
                      <div className="space-y-3">
                        <div className="flex items-center justify-between">
                          <h4 className="text-sm font-semibold text-gray-700">Parcialidades</h4>
                          <button
                            type="button"
                            onClick={() => setInstallmentDefs([...installmentDefs, { label: `Parcialidad ${installmentDefs.length + 2}`, pct_of_total: '', days_after_booking: '', days_before_departure: '', specific_date: '', _vencimiento_mode: 'dias_reserva' }])}
                            className="text-xs text-sky-600 hover:text-sky-800 font-medium flex items-center gap-1"
                          >
                            <Plus className="w-3.5 h-3.5" /> Agregar parcialidad
                          </button>
                        </div>

                        {/* Fila fija: Anticipo (al reservar) — derivada del % de anticipo del tour */}
                        {(() => {
                          const depositPct = parseFloat(formData.deposit_percentage) || 0;
                          return (
                            <div className="bg-sky-50 rounded-lg p-3 space-y-1 border border-sky-200">
                              <div className="flex items-center gap-2">
                                <span className="text-xs font-semibold text-sky-600 w-5">1.</span>
                                <span className="text-sm font-medium text-sky-800 flex-1">Anticipo (al reservar)</span>
                                <span className="text-xs text-sky-600 bg-sky-100 rounded px-2 py-0.5">Automático</span>
                              </div>
                              <p className="text-xs text-sky-600 pl-7">
                                {depositPct > 0
                                  ? `${depositPct}% del total · Vence al reservar (día 0)`
                                  : 'Configura el % de anticipo en la sección de precios arriba'}
                              </p>
                            </div>
                          );
                        })()}

                        {installmentDefs.length === 0 && (
                          <p className="text-xs text-gray-400 italic">Sin parcialidades adicionales — agrega pagos para el saldo restante.</p>
                        )}

                        {installmentDefs.map((def, idx) => (
                          <div key={idx} className="bg-gray-50 rounded-lg p-3 space-y-2 border border-gray-200">
                            <div className="flex items-center gap-2">
                              <span className="text-xs font-semibold text-gray-500 w-5">{idx + 2}.</span>
                              <input
                                type="text"
                                value={def.label}
                                onChange={(e) => {
                                  const next = [...installmentDefs];
                                  next[idx] = { ...next[idx], label: e.target.value };
                                  setInstallmentDefs(next);
                                }}
                                placeholder="Etiqueta (ej: Segundo pago)"
                                className="input input-sm flex-1 text-xs"
                              />
                              <button type="button" onClick={() => setInstallmentDefs(installmentDefs.filter((_, i) => i !== idx))} className="text-red-400 hover:text-red-600 flex-shrink-0">
                                <Minus className="w-4 h-4" />
                              </button>
                            </div>
                            <div className="grid grid-cols-2 gap-2">
                              <div>
                                <label className="text-xs text-gray-500 mb-0.5 block">% del total</label>
                                <input
                                  type="number"
                                  min={1}
                                  max={100}
                                  value={def.pct_of_total}
                                  onChange={(e) => {
                                    const next = [...installmentDefs];
                                    next[idx] = { ...next[idx], pct_of_total: e.target.value };
                                    setInstallmentDefs(next);
                                  }}
                                  className="input input-sm text-xs w-full"
                                  placeholder="0"
                                />
                              </div>
                              <div>
                                <label className="text-xs text-gray-500 mb-1 block">Vencimiento</label>
                                <div className="flex rounded-lg overflow-hidden border border-gray-200 text-xs">
                                  {(['dias_reserva', 'dias_salida', 'fecha_especifica'] as const).map((mode) => (
                                    <button
                                      key={mode}
                                      type="button"
                                      onClick={() => {
                                        const next = [...installmentDefs];
                                        next[idx] = { ...next[idx], _vencimiento_mode: mode };
                                        setInstallmentDefs(next);
                                      }}
                                      className={`flex-1 py-1 px-1.5 transition-colors ${def._vencimiento_mode === mode ? 'bg-sky-500 text-white font-semibold' : 'bg-white text-gray-500 hover:bg-gray-100'}`}
                                    >
                                      {mode === 'dias_reserva' ? 'Días reserva' : mode === 'dias_salida' ? 'Días salida' : 'Fecha'}
                                    </button>
                                  ))}
                                </div>
                              </div>
                            </div>
                            <div>
                              {def._vencimiento_mode === 'dias_reserva' && (
                                <div>
                                  <label className="text-xs text-gray-500 mb-0.5 block">Días tras la reserva</label>
                                  <input
                                    type="number"
                                    min={1}
                                    value={def.days_after_booking}
                                    onChange={(e) => {
                                      const next = [...installmentDefs];
                                      next[idx] = { ...next[idx], days_after_booking: e.target.value };
                                      setInstallmentDefs(next);
                                    }}
                                    className="input input-sm text-xs w-full"
                                    placeholder="Ej: 30"
                                  />
                                </div>
                              )}
                              {def._vencimiento_mode === 'dias_salida' && (
                                <div>
                                  <label className="text-xs text-gray-500 mb-0.5 block">Días antes de la salida</label>
                                  <input
                                    type="number"
                                    min={1}
                                    value={def.days_before_departure}
                                    onChange={(e) => {
                                      const next = [...installmentDefs];
                                      next[idx] = { ...next[idx], days_before_departure: e.target.value };
                                      setInstallmentDefs(next);
                                    }}
                                    className="input input-sm text-xs w-full"
                                    placeholder="Ej: 15"
                                  />
                                </div>
                              )}
                              {def._vencimiento_mode === 'fecha_especifica' && (
                                <div>
                                  <label className="text-xs text-gray-500 mb-0.5 block">Fecha de vencimiento</label>
                                  <input
                                    type="date"
                                    value={def.specific_date}
                                    onChange={(e) => {
                                      const next = [...installmentDefs];
                                      next[idx] = { ...next[idx], specific_date: e.target.value };
                                      setInstallmentDefs(next);
                                    }}
                                    className="input input-sm text-xs w-full"
                                  />
                                </div>
                              )}
                            </div>
                            <p className="text-xs text-gray-400">
                              {def._vencimiento_mode === 'fecha_especifica'
                                ? def.specific_date ? `Vence el ${def.specific_date}` : 'Sin fecha definida'
                                : def._vencimiento_mode === 'dias_salida'
                                ? `Vence ${def.days_before_departure || '?'} día(s) antes de la salida`
                                : `Vence ${def.days_after_booking || '?'} día(s) después de la reserva`}
                              {' · '}{def.pct_of_total || 0}% del total
                            </p>
                          </div>
                        ))}

                        {(() => {
                          const depositPct = parseFloat(formData.deposit_percentage) || 0;
                          const remaining = Math.round((100 - depositPct) * 100) / 100;
                          const assigned = installmentDefs.reduce((s, d) => s + (parseFloat(d.pct_of_total) || 0), 0);
                          const total = depositPct + assigned;
                          const isValid = Math.abs(total - 100) < 0.01;
                          return (
                            <div className={`text-xs font-medium p-2 rounded-lg ${isValid ? 'text-green-700 bg-green-50' : 'text-orange-600 bg-orange-50'}`}>
                              <span>Anticipo: {depositPct}%</span>
                              {installmentDefs.length > 0 && <span> + Parcialidades: {assigned}%</span>}
                              <span> = {total}% {isValid ? '✓' : `(debe sumar 100% — faltan ${Math.round((remaining - assigned) * 100) / 100}%)`}</span>
                            </div>
                          );
                        })()}
                      </div>
                    )}
                  </div>
                )}

                {/* Penalización por pago tardío */}
                {(formData.payment_option === 'payment_plan' || formData.payment_option === 'both') && (
                  <div className="border-t border-gray-100 pt-4 space-y-3">
                    <h4 className="text-sm font-semibold text-gray-700 flex items-center gap-2">
                      <AlertCircle className="w-4 h-4 text-orange-500" />
                      Configuración de pagos tardíos
                    </h4>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                      <div>
                        <label className="block text-xs font-medium text-gray-600 mb-1">Días de gracia</label>
                        <input
                          type="number"
                          min={0}
                          value={formData.late_payment_grace_days}
                          onChange={(e) => setFormData({ ...formData, late_payment_grace_days: e.target.value })}
                          className="input input-sm w-full"
                          placeholder="5"
                        />
                        <p className="text-xs text-gray-400 mt-0.5">Días tras vencimiento sin penalización</p>
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-gray-600 mb-1">Penalización (%)</label>
                        <input
                          type="number"
                          min={0}
                          max={100}
                          step={0.5}
                          value={formData.late_payment_penalty_pct}
                          onChange={(e) => setFormData({ ...formData, late_payment_penalty_pct: e.target.value })}
                          className="input input-sm w-full"
                          placeholder="0"
                        />
                        <p className="text-xs text-gray-400 mt-0.5">% del monto de la parcialidad</p>
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-gray-600 mb-1">Penalización fija ($)</label>
                        <input
                          type="number"
                          min={0}
                          step={1}
                          value={formData.late_payment_penalty_fixed}
                          onChange={(e) => setFormData({ ...formData, late_payment_penalty_fixed: e.target.value })}
                          className="input input-sm w-full"
                          placeholder="0"
                        />
                        <p className="text-xs text-gray-400 mt-0.5">Monto fijo en MXN (si % = 0)</p>
                      </div>
                    </div>
                  </div>
                )}
              </div>
              )}
            </div>

            {/* SECCIÓN PREVENTA EXCLUSIVA */}
            <div className={`bg-white rounded-xl shadow-sm border-2 overflow-hidden transition-all ${
              formData.preventa_activa ? 'border-amber-400' : 'border-gray-200'
            }`}>
              <div className={`px-5 py-4 flex items-center justify-between ${
                formData.preventa_activa ? 'bg-amber-50' : 'bg-gray-50'
              }`}>
                <div className="flex items-center gap-3">
                  <div className={`w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0 ${
                    formData.preventa_activa ? 'bg-amber-500 text-white' : 'bg-gray-200 text-gray-500'
                  }`}>
                    <Tag className="w-4 h-4" />
                  </div>
                  <div>
                    <h3 className={`font-semibold text-sm ${formData.preventa_activa ? 'text-amber-900' : 'text-gray-700'}`}>
                      Preventa Exclusiva ToursRed Plus
                    </h3>
                    <p className={`text-xs ${formData.preventa_activa ? 'text-amber-700' : 'text-gray-500'}`}>
                      Ofrece acceso anticipado a socios con membresía activa
                    </p>
                  </div>
                </div>
                <label className="relative inline-flex items-center cursor-pointer">
                  <input
                    type="checkbox"
                    checked={formData.preventa_activa}
                    onChange={(e) => setFormData({ ...formData, preventa_activa: e.target.checked })}
                    className="sr-only peer"
                  />
                  <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-2 peer-focus:ring-amber-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-amber-500"></div>
                </label>
              </div>

              {formData.preventa_activa && (
                <div className="p-5 space-y-5">
                  {/* Beneficio para la agencia */}
                  <div className="bg-amber-50 border border-amber-200 rounded-lg p-4">
                    <div className="flex items-start gap-2">
                      <Info className="w-4 h-4 text-amber-600 flex-shrink-0 mt-0.5" />
                      <div className="text-sm text-amber-800">
                        <p className="font-semibold mb-1">Beneficio exclusivo para tu agencia</p>
                        <p>En las primeras <strong>10 reservas realizadas durante la preventa</strong>, ToursRed aplicará un <strong>10% de descuento sobre el monto de comisión</strong> de cada reserva. Este beneficio aplica únicamente durante el periodo de preventa y para las primeras 10 reservas de preventa.</p>
                      </div>
                    </div>
                  </div>

                  {/* Fechas de preventa */}
                  <div>
                    <p className="text-sm font-semibold text-gray-700 mb-3">Periodo de preventa</p>
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <label className="block text-xs font-medium text-gray-600 mb-1">Inicio de preventa *</label>
                        <input
                          type="date"
                          value={formData.preventa_inicio}
                          onChange={(e) => setFormData({ ...formData, preventa_inicio: e.target.value })}
                          className="input text-sm"
                          max={formData.preventa_fin || undefined}
                        />
                        <p className="text-xs text-gray-400 mt-1">Desde cuándo pueden reservar los socios</p>
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-gray-600 mb-1">Fin de preventa *</label>
                        <input
                          type="date"
                          value={formData.preventa_fin}
                          onChange={(e) => setFormData({ ...formData, preventa_fin: e.target.value })}
                          className="input text-sm"
                          min={formData.preventa_inicio || undefined}
                          max={formData.start_date || undefined}
                        />
                        <p className="text-xs text-gray-400 mt-1">Al terminar, abre al público general</p>
                      </div>
                    </div>
                  </div>

                  {/* Precio especial */}
                  <div className="border-t border-gray-100 pt-4">
                    <div className="flex items-center justify-between mb-3">
                      <div>
                        <p className="text-sm font-semibold text-gray-700">Precio especial de preventa</p>
                        <p className="text-xs text-gray-500">Ofrece un descuento exclusivo durante la preventa</p>
                      </div>
                      <label className="relative inline-flex items-center cursor-pointer">
                        <input
                          type="checkbox"
                          checked={formData.preventa_precio_especial}
                          onChange={(e) => setFormData({ ...formData, preventa_precio_especial: e.target.checked })}
                          className="sr-only peer"
                        />
                        <div className="w-10 h-5 bg-gray-200 peer-focus:outline-none peer-focus:ring-2 peer-focus:ring-amber-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-amber-500"></div>
                      </label>
                    </div>

                    {formData.preventa_precio_especial && (
                      <div className="bg-gray-50 rounded-lg p-4 space-y-3">
                        <div className="flex gap-3">
                          <button
                            type="button"
                            onClick={() => setFormData({ ...formData, preventa_tipo_descuento: 'porcentaje' })}
                            className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-lg border-2 text-sm font-medium transition-all ${
                              formData.preventa_tipo_descuento === 'porcentaje'
                                ? 'border-amber-500 bg-amber-50 text-amber-700'
                                : 'border-gray-200 text-gray-600 hover:border-gray-300'
                            }`}
                          >
                            <Percent className="w-3.5 h-3.5" />
                            Porcentaje
                          </button>
                          <button
                            type="button"
                            onClick={() => setFormData({ ...formData, preventa_tipo_descuento: 'monto' })}
                            className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-lg border-2 text-sm font-medium transition-all ${
                              formData.preventa_tipo_descuento === 'monto'
                                ? 'border-amber-500 bg-amber-50 text-amber-700'
                                : 'border-gray-200 text-gray-600 hover:border-gray-300'
                            }`}
                          >
                            <DollarSign className="w-3.5 h-3.5" />
                            Monto fijo
                          </button>
                        </div>
                        <div>
                          <label className="block text-xs font-medium text-gray-600 mb-1">
                            {formData.preventa_tipo_descuento === 'porcentaje' ? 'Porcentaje de descuento (%)' : 'Monto de descuento ($)'}
                          </label>
                          <div className="relative">
                            <input
                              type="number"
                              value={formData.preventa_descuento_valor}
                              onChange={(e) => setFormData({ ...formData, preventa_descuento_valor: e.target.value })}
                              className="input text-sm pr-12"
                              placeholder={formData.preventa_tipo_descuento === 'porcentaje' ? 'Ej: 10' : 'Ej: 200'}
                              min="0"
                              max={formData.preventa_tipo_descuento === 'porcentaje' ? '100' : undefined}
                              step="0.01"
                            />
                            <span className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm font-medium">
                              {formData.preventa_tipo_descuento === 'porcentaje' ? '%' : 'MXN'}
                            </span>
                          </div>
                          {formData.preventa_descuento_valor && formData.price && (
                            <p className="text-xs text-amber-700 mt-1 font-medium">
                              Precio de preventa:{' '}
                              {formData.preventa_tipo_descuento === 'porcentaje'
                                ? `$${(parseFloat(formData.price) * (1 - parseFloat(formData.preventa_descuento_valor) / 100)).toFixed(2)}`
                                : `$${Math.max(0, parseFloat(formData.price) - parseFloat(formData.preventa_descuento_valor)).toFixed(2)}`
                              }{' '}
                              <span className="text-gray-400 line-through">${parseFloat(formData.price).toFixed(2)}</span>
                            </p>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>

            {error && (
              <div className="mb-4 bg-red-50 border border-red-200 text-red-700 p-4 rounded-lg flex items-start gap-3 text-sm">
                <AlertCircle className="h-4 w-4 flex-shrink-0 mt-0.5" />
                <span>{error}</span>
              </div>
            )}

            <div className="flex justify-end space-x-4">
              <button
                type="button"
                onClick={handleCancel}
                className="btn btn-outline"
                disabled={isSubmitting}
              >
                <X className="h-4 w-4 mr-2" />
                Cancelar
              </button>
              <button
                type="button"
                onClick={handleSubmit}
                disabled={isSubmitting || selectedDestinations.length === 0}
                className={`btn btn-primary ${
                  selectedDestinations.length === 0
                    ? 'opacity-50 cursor-not-allowed'
                    : ''
                }`}
              >
                <Save className="h-4 w-4 mr-2" />
                {isSubmitting
                  ? (editingTour ? 'Actualizando...' : 'Creando...')
                  : (editingTour ? 'Actualizar Tour' : 'Crear Tour')
                }
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal de Crear Punto de Salida */}
      {showCreateDepartureForm && (
        <DeparturePointForm
          onClose={() => setShowCreateDepartureForm(false)}
          onSuccess={(newPoint) => {
            const newSelected: SelectedDeparturePoint = {
              ...newPoint,
              display_order: selectedDeparturePoints.length + 1,
            };
            setSelectedDeparturePoints([...selectedDeparturePoints, newSelected]);
            setShowCreateDepartureForm(false);
          }}
        />
      )}

      {/* Modal de Duplicar Tour */}
      {duplicatingTour && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg shadow-lg p-6 max-w-md w-full">
            <h2 className="text-xl font-semibold mb-4">Duplicar Tour</h2>

            <form onSubmit={handleDuplicateSubmit} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Nombre del Tour *
                </label>
                <input
                  type="text"
                  value={duplicateFormData.name}
                  onChange={(e) => setDuplicateFormData({ ...duplicateFormData, name: e.target.value })}
                  className="input"
                  required
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Fecha de Inicio *
                </label>
                <input
                  type="date"
                  value={duplicateFormData.start_date}
                  onChange={(e) => setDuplicateFormData({ ...duplicateFormData, start_date: e.target.value })}
                  className="input"
                  required
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Fecha de Fin *
                </label>
                <input
                  type="date"
                  value={duplicateFormData.end_date}
                  onChange={(e) => setDuplicateFormData({ ...duplicateFormData, end_date: e.target.value })}
                  className="input"
                  min={duplicateFormData.start_date}
                  required
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Fecha Límite de Reserva
                </label>
                <input
                  type="date"
                  value={duplicateFormData.booking_deadline}
                  onChange={(e) => setDuplicateFormData({ ...duplicateFormData, booking_deadline: e.target.value })}
                  className="input"
                />
                <p className="text-xs text-gray-500 mt-1">
                  Si no se especifica, será 14 días antes del inicio
                </p>
              </div>

              <div className="flex justify-end space-x-3 pt-4">
                <button
                  type="button"
                  onClick={handleDuplicateCancel}
                  className="btn btn-outline"
                  disabled={isSubmitting}
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="btn btn-primary"
                >
                  {isSubmitting ? 'Duplicando...' : 'Duplicar Tour'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal de Reagendar Tour */}
      {rescheduleModal.open && rescheduleModal.tour && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg shadow-lg p-6 max-w-2xl w-full max-h-[90vh] overflow-y-auto">
            <div className="flex items-center mb-4">
              <div className="w-10 h-10 bg-amber-100 rounded-full flex items-center justify-center mr-3">
                <CalendarX className="h-6 w-6 text-amber-600" />
              </div>
              <h2 className="text-xl font-semibold">Reagendar Tour</h2>
            </div>

            {rescheduleModal.success ? (
              <div className="text-center py-8">
                <div className="w-16 h-16 bg-success-100 rounded-full flex items-center justify-center mx-auto mb-4">
                  <svg className="w-8 h-8 text-success-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                </div>
                <h3 className="text-lg font-semibold text-gray-900 mb-2">
                  Reagendamiento Procesado
                </h3>
                <p className="text-gray-600">
                  Se ha notificado a todos los viajeros sobre el cambio de fechas.
                </p>
              </div>
            ) : (
              <>
                <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-6">
                  <h3 className="font-semibold text-blue-900 mb-2">{rescheduleModal.tour.name}</h3>
                  <div className="text-sm text-blue-800 space-y-1">
                    <p>
                      <span className="font-medium">Fechas actuales:</span> {formatDate(rescheduleModal.tour.start_date)} - {formatDate(rescheduleModal.tour.end_date)}
                    </p>
                    <p>
                      <span className="font-medium">Destino:</span> {rescheduleModal.tour.destination}
                    </p>
                  </div>
                </div>

                {rescheduleModal.isLoading ? (
                  <div className="flex justify-center py-8">
                    <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-primary-600"></div>
                  </div>
                ) : (
                  <>
                    {rescheduleModal.activeBookingsCount > 0 && (
                      <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 mb-6">
                        <div className="flex items-start">
                          <AlertCircle className="h-5 w-5 text-amber-600 mr-2 mt-0.5" />
                          <div>
                            <p className="text-sm font-medium text-amber-900">
                              {rescheduleModal.activeBookingsCount} {rescheduleModal.activeBookingsCount === 1 ? 'viajero será notificado' : 'viajeros serán notificados'}
                            </p>
                            <p className="text-xs text-amber-800 mt-1">
                              Los viajeros podrán aceptar las nuevas fechas o solicitar un reembolso completo (100%).
                            </p>
                          </div>
                        </div>
                      </div>
                    )}

                    {rescheduleModal.error && (
                      <div className="bg-error-50 border border-error-200 rounded-lg p-4 mb-6">
                        <p className="text-sm text-error-800">{rescheduleModal.error}</p>
                      </div>
                    )}

                    <form onSubmit={handleSubmitReschedule} className="space-y-6">
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-1">
                            Nueva Fecha de Inicio *
                          </label>
                          <input
                            type="date"
                            value={rescheduleFormData.new_start_date}
                            onChange={(e) => setRescheduleFormData({ ...rescheduleFormData, new_start_date: e.target.value })}
                            className="input"
                            min={(() => { const d = new Date(); d.setDate(d.getDate() + 4); return d.toLocaleDateString('en-CA'); })()}
                            required
                          />
                          <p className="text-xs text-gray-500 mt-1">
                            Debe ser al menos 4 días en el futuro
                          </p>
                        </div>

                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-1">
                            Nueva Fecha de Fin *
                          </label>
                          <input
                            type="date"
                            value={rescheduleFormData.new_end_date}
                            onChange={(e) => setRescheduleFormData({ ...rescheduleFormData, new_end_date: e.target.value })}
                            className="input"
                            min={rescheduleFormData.new_start_date}
                            required
                          />
                        </div>
                      </div>

                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                          Motivo del Reagendamiento *
                        </label>
                        <textarea
                          value={rescheduleFormData.reschedule_reason}
                          onChange={(e) => setRescheduleFormData({ ...rescheduleFormData, reschedule_reason: e.target.value })}
                          className="input"
                          rows={4}
                          placeholder="Por ejemplo: Debido a condiciones climáticas adversas, hemos decidido reprogramar el tour para garantizar la seguridad y comodidad de todos los participantes..."
                          minLength={20}
                          required
                        />
                        <p className="text-xs text-gray-500 mt-1">
                          Mínimo 20 caracteres. Este mensaje será visible para los viajeros.
                        </p>
                      </div>

                      <div className="bg-gray-50 border border-gray-200 rounded-lg p-4">
                        <h4 className="font-medium text-gray-900 mb-2">Política de Reagendamiento</h4>
                        <ul className="text-sm text-gray-600 space-y-1">
                          <li>• Los viajeros tendrán 4 días para responder</li>
                          <li>• Pueden aceptar las nuevas fechas sin costo adicional</li>
                          <li>• O solicitar un reembolso completo (100%)</li>
                          <li>• Se enviará una notificación por correo electrónico a cada viajero</li>
                        </ul>
                      </div>

                      <div className="flex justify-end space-x-3 pt-4 border-t">
                        <button
                          type="button"
                          onClick={handleCloseReschedule}
                          className="btn btn-outline"
                          disabled={rescheduleModal.isSubmitting}
                        >
                          Cancelar
                        </button>
                        <button
                          type="submit"
                          disabled={rescheduleModal.isSubmitting}
                          className="btn bg-amber-600 hover:bg-amber-700 text-white"
                        >
                          {rescheduleModal.isSubmitting ? (
                            <>
                              <div className="animate-spin rounded-full h-4 w-4 border-2 border-white border-t-transparent mr-2"></div>
                              Procesando...
                            </>
                          ) : (
                            <>
                              <CalendarX className="h-4 w-4 mr-2" />
                              Confirmar Reagendamiento
                            </>
                          )}
                        </button>
                      </div>
                    </form>
                  </>
                )}
              </>
            )}
          </div>
        </div>
      )}

      {/* Modal de Acciones para Tours Receptivos (por slot) */}
      {receptivoActionsModal.open && receptivoActionsModal.tour && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg shadow-lg p-6 max-w-2xl w-full max-h-[90vh] overflow-y-auto">
            {(() => {
              const { action, tour, slots, selectedSlot, isLoadingSlots, isSubmitting, error, success, reason, newSlotDate, newSlotTime, bookingsInSlot, bookingsCountInSlot } = receptivoActionsModal;

              const actionConfig = {
                'slot-cancel': {
                  title: 'Cancelar un Slot Especifico',
                  icon: <XCircle className="h-6 w-6 text-orange-600" />,
                  iconBg: 'bg-orange-100',
                  successMsg: 'Slot cancelado. Los viajeros afectados seran notificados y reembolsados.',
                },
                'slot-reschedule': {
                  title: 'Reagendar un Slot Especifico',
                  icon: <CalendarX className="h-6 w-6 text-amber-600" />,
                  iconBg: 'bg-amber-100',
                  successMsg: 'Solicitud enviada. Los viajeros afectados tienen 12 horas para aceptar o rechazar el nuevo horario. Recibiran un email con los detalles.',
                },
                'full-cancel': {
                  title: 'Cancelar Tour Completo',
                  icon: <Ban className="h-6 w-6 text-red-700" />,
                  iconBg: 'bg-red-100',
                  successMsg: 'Tour cancelado completamente. Todos los viajeros seran notificados y reembolsados.',
                },
              }[action!] || { title: '', icon: null, iconBg: '', successMsg: '' };

              return (
                <>
                  <div className="flex items-center mb-5">
                    <div className={`w-10 h-10 ${actionConfig.iconBg} rounded-full flex items-center justify-center mr-3`}>
                      {actionConfig.icon}
                    </div>
                    <div>
                      <h2 className="text-xl font-semibold text-gray-900">{actionConfig.title}</h2>
                      <p className="text-sm text-gray-500">{tour.name}</p>
                    </div>
                  </div>

                  {success ? (
                    <div className="text-center py-10">
                      <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
                        <svg className="w-8 h-8 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                        </svg>
                      </div>
                      <p className="text-gray-700 font-medium">{actionConfig.successMsg}</p>
                    </div>
                  ) : (
                    <div className="space-y-5">
                      {action === 'full-cancel' && (
                        <div className="bg-red-50 border border-red-200 rounded-lg p-4">
                          <div className="flex items-start gap-2">
                            <AlertTriangle className="h-5 w-5 text-red-600 flex-shrink-0 mt-0.5" />
                            <div>
                              <p className="text-sm font-semibold text-red-900 mb-1">Esta accion detendra el tour de forma permanente</p>
                              <p className="text-sm text-red-800">Todos los slots futuros seran cancelados. Los viajeros con reservas activas recibiran un reembolso del 100%. Usa esta opcion solo si ya no vas a operar este tour.</p>
                            </div>
                          </div>
                        </div>
                      )}

                      {action !== 'full-cancel' && (
                        <>
                          <div>
                            <label className="block text-sm font-medium text-gray-700 mb-2">
                              Selecciona el slot a {action === 'slot-cancel' ? 'cancelar' : 'reagendar'}
                            </label>
                            {isLoadingSlots ? (
                              <div className="flex items-center justify-center py-8">
                                <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-primary-600"></div>
                              </div>
                            ) : slots.length === 0 ? (
                              <div className="bg-gray-50 border border-gray-200 rounded-lg p-4 text-center text-gray-500 text-sm">
                                No hay slots futuros disponibles para este tour.
                              </div>
                            ) : (
                              <div className="max-h-52 overflow-y-auto border border-gray-200 rounded-lg divide-y divide-gray-100">
                                {slots.map((slot) => (
                                  <button
                                    key={slot.id}
                                    type="button"
                                    onClick={() => handleSelectSlot(slot)}
                                    className={`w-full text-left px-4 py-3 hover:bg-gray-50 transition-colors flex items-center justify-between ${selectedSlot?.id === slot.id ? 'bg-blue-50 border-l-4 border-blue-500' : ''}`}
                                  >
                                    <div>
                                      <p className="text-sm font-medium text-gray-900">
                                        {format(new Date(slot.slot_date + 'T00:00:00'), 'EEEE dd/MM/yyyy').replace(/^\w/, c => c.toUpperCase())}
                                      </p>
                                      <p className="text-xs text-gray-500">
                                        Salida: {slot.departure_time?.slice(0, 5)} &bull; Capacidad: {slot.booked_count}/{slot.capacity}
                                      </p>
                                    </div>
                                    {selectedSlot?.id === slot.id && (
                                      <span className="text-xs bg-blue-100 text-blue-700 px-2 py-1 rounded-full font-medium">Seleccionado</span>
                                    )}
                                  </button>
                                ))}
                              </div>
                            )}
                          </div>

                          {selectedSlot && bookingsInSlot > 0 && (
                            <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-3 flex items-start gap-2">
                              <AlertCircle className="h-4 w-4 text-yellow-600 flex-shrink-0 mt-0.5" />
                              <p className="text-sm text-yellow-800">
                                <span className="font-medium">{bookingsInSlot} {bookingsInSlot === 1 ? 'viajero sera afectado' : 'viajeros seran afectados'} en {bookingsCountInSlot} {bookingsCountInSlot === 1 ? 'reserva' : 'reservas'}.</span>
                                {action === 'slot-cancel' && ' Se emitira un reembolso del 100% del anticipo en ToursRed Cash.'}
                                {action === 'slot-reschedule' && ' Se les notificara la nueva fecha y podran aceptar o rechazar el cambio.'}
                              </p>
                            </div>
                          )}

                          {action === 'slot-reschedule' && selectedSlot && (
                            <div className="grid grid-cols-2 gap-4">
                              <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">Nueva Fecha</label>
                                <input
                                  type="date"
                                  value={newSlotDate}
                                  min={new Date().toISOString().split('T')[0]}
                                  onChange={(e) => setReceptivoActionsModal(prev => ({ ...prev, newSlotDate: e.target.value }))}
                                  className="input w-full"
                                />
                              </div>
                              <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">Nueva Hora de Salida</label>
                                <input
                                  type="time"
                                  value={newSlotTime}
                                  onChange={(e) => setReceptivoActionsModal(prev => ({ ...prev, newSlotTime: e.target.value }))}
                                  className="input w-full"
                                />
                              </div>
                            </div>
                          )}
                        </>
                      )}

                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                          Motivo {action === 'full-cancel' ? '(min. 50 caracteres)' : '(min. 20 caracteres)'} *
                        </label>
                        <textarea
                          value={reason}
                          onChange={(e) => setReceptivoActionsModal(prev => ({ ...prev, reason: e.target.value }))}
                          className="input w-full"
                          rows={4}
                          placeholder={
                            action === 'full-cancel'
                              ? 'Explica el motivo por el que se cancela definitivamente este tour (zona cerrada, falta de quorum, etc.)...'
                              : action === 'slot-cancel'
                              ? 'Explica el motivo de la cancelacion de esta fecha (clima, aforo minimo no alcanzado, etc.)...'
                              : 'Explica el motivo del cambio de fecha y hora...'
                          }
                        />
                        <p className="text-xs text-gray-400 mt-1">{reason.length} caracteres</p>
                      </div>

                      {error && (
                        <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-800 flex items-center gap-2">
                          <AlertCircle className="h-4 w-4 flex-shrink-0" />{error}
                        </div>
                      )}

                      <div className="flex justify-end gap-3 pt-3 border-t">
                        <button
                          type="button"
                          onClick={handleCloseReceptivoActions}
                          disabled={isSubmitting}
                          className="btn btn-outline"
                        >
                          Volver
                        </button>
                        <button
                          type="button"
                          onClick={action === 'full-cancel' ? handleSubmitReceptivoFullCancel : handleSubmitReceptivoSlotAction}
                          disabled={
                            isSubmitting ||
                            (action !== 'full-cancel' && !selectedSlot) ||
                            (action === 'full-cancel' && reason.trim().length < 50) ||
                            (action !== 'full-cancel' && reason.trim().length < 20)
                          }
                          className={`btn text-white disabled:opacity-50 disabled:cursor-not-allowed ${
                            action === 'full-cancel' ? 'bg-red-700 hover:bg-red-800' :
                            action === 'slot-cancel' ? 'bg-orange-600 hover:bg-orange-700' :
                            'bg-amber-600 hover:bg-amber-700'
                          }`}
                        >
                          {isSubmitting ? (
                            <><div className="animate-spin rounded-full h-4 w-4 border-2 border-white border-t-transparent mr-2"></div>Procesando...</>
                          ) : action === 'full-cancel' ? (
                            <><Ban className="h-4 w-4 mr-2" />Cancelar Tour Definitivamente</>
                          ) : action === 'slot-cancel' ? (
                            <><XCircle className="h-4 w-4 mr-2" />Cancelar este Slot</>
                          ) : (
                            <><CalendarX className="h-4 w-4 mr-2" />Reagendar este Slot</>
                          )}
                        </button>
                      </div>
                    </div>
                  )}
                </>
              );
            })()}
          </div>
        </div>
      )}

      {/* Modal de Conflicto de Cupo */}
      {capacityConflictModal.open && (
        <div className="fixed inset-0 bg-black bg-opacity-60 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-xl p-6 max-w-lg w-full max-h-[90vh] overflow-y-auto">
            {capacityConflictModal.success ? (
              <div className="text-center py-8">
                <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
                  <svg className="w-8 h-8 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                </div>
                <h3 className="text-lg font-semibold text-gray-900 mb-2">Solicitud procesada</h3>
                <p className="text-sm text-gray-600">
                  {capacityConflictModal.resolution === 'refund'
                    ? 'Se han procesado los reembolsos a los viajeros afectados.'
                    : 'Los viajeros tienen 12 horas para aceptar o rechazar el nuevo horario.'}
                </p>
              </div>
            ) : (
              <>
                <div className="flex items-start gap-3 mb-5">
                  <div className="w-10 h-10 bg-orange-100 rounded-full flex items-center justify-center flex-shrink-0">
                    <AlertTriangle className="h-5 w-5 text-orange-600" />
                  </div>
                  <div>
                    <h2 className="text-lg font-semibold text-gray-900">Conflicto de cupo detectado</h2>
                    <p className="text-sm text-gray-500 mt-0.5">La fecha destino no tiene suficiente espacio para todos los viajeros afectados.</p>
                  </div>
                </div>

                <div className="bg-orange-50 border border-orange-200 rounded-lg p-4 mb-5 grid grid-cols-3 gap-3 text-center">
                  <div>
                    <p className="text-xs text-orange-700 font-medium mb-1">Cupo disponible</p>
                    <p className="text-2xl font-bold text-orange-800">{capacityConflictModal.targetSlot?.available_spots ?? 0}</p>
                    <p className="text-xs text-orange-600">de {capacityConflictModal.targetSlot?.capacity}</p>
                  </div>
                  <div className="border-x border-orange-200">
                    <p className="text-xs text-orange-700 font-medium mb-1">Viajeros afectados</p>
                    <p className="text-2xl font-bold text-orange-800">{capacityConflictModal.affectedTravelers}</p>
                    <p className="text-xs text-orange-600">a mover</p>
                  </div>
                  <div>
                    <p className="text-xs text-red-700 font-medium mb-1">Espacios faltantes</p>
                    <p className="text-2xl font-bold text-red-700">{capacityConflictModal.spotsNeeded}</p>
                    <p className="text-xs text-red-600">sin cupo</p>
                  </div>
                </div>

                <p className="text-sm font-semibold text-gray-700 mb-3">Elige como resolver el conflicto:</p>

                <div className="space-y-3 mb-5">
                  <button
                    type="button"
                    onClick={() => setCapacityConflictModal(prev => ({ ...prev, resolution: 'new_slot', error: '' }))}
                    className={`w-full text-left p-4 rounded-lg border-2 transition-all ${
                      capacityConflictModal.resolution === 'new_slot'
                        ? 'border-blue-500 bg-blue-50'
                        : 'border-gray-200 hover:border-gray-300 bg-white'
                    }`}
                  >
                    <div className="flex items-start gap-3">
                      <div className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5 ${capacityConflictModal.resolution === 'new_slot' ? 'bg-blue-100' : 'bg-gray-100'}`}>
                        <Clock className={`h-4 w-4 ${capacityConflictModal.resolution === 'new_slot' ? 'text-blue-600' : 'text-gray-500'}`} />
                      </div>
                      <div>
                        <p className="text-sm font-semibold text-gray-900">Abrir nuevo horario</p>
                        <p className="text-xs text-gray-500 mt-0.5">Crear un horario adicional el {capacityConflictModal.targetSlot?.slot_date} con hora distinta. Los viajeros tendran 12 horas para aceptar o rechazar.</p>
                      </div>
                    </div>
                    {capacityConflictModal.resolution === 'new_slot' && (
                      <div className="mt-3 ml-11">
                        <label className="block text-xs font-medium text-gray-700 mb-1">Hora del nuevo horario</label>
                        <input
                          type="time"
                          value={capacityConflictModal.newSlotTime}
                          onChange={(e) => setCapacityConflictModal(prev => ({ ...prev, newSlotTime: e.target.value }))}
                          className="input text-sm py-1.5"
                          onClick={(e) => e.stopPropagation()}
                        />
                      </div>
                    )}
                  </button>

                  <button
                    type="button"
                    onClick={() => setCapacityConflictModal(prev => ({ ...prev, resolution: 'expand_capacity', error: '' }))}
                    className={`w-full text-left p-4 rounded-lg border-2 transition-all ${
                      capacityConflictModal.resolution === 'expand_capacity'
                        ? 'border-green-500 bg-green-50'
                        : 'border-gray-200 hover:border-gray-300 bg-white'
                    }`}
                  >
                    <div className="flex items-start gap-3">
                      <div className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5 ${capacityConflictModal.resolution === 'expand_capacity' ? 'bg-green-100' : 'bg-gray-100'}`}>
                        <Users className={`h-4 w-4 ${capacityConflictModal.resolution === 'expand_capacity' ? 'text-green-600' : 'text-gray-500'}`} />
                      </div>
                      <div>
                        <p className="text-sm font-semibold text-gray-900">Ampliar capacidad del horario existente</p>
                        <p className="text-xs text-gray-500 mt-0.5">
                          Aumentar el cupo del {capacityConflictModal.targetSlot?.slot_date} a las {capacityConflictModal.targetSlot?.departure_time?.slice(0, 5)} de {capacityConflictModal.targetSlot?.capacity} a {(capacityConflictModal.targetSlot?.booked_count ?? 0) + capacityConflictModal.affectedTravelers} lugares. Los viajeros tendran 12 horas para confirmar.
                        </p>
                      </div>
                    </div>
                  </button>

                  <button
                    type="button"
                    onClick={() => setCapacityConflictModal(prev => ({ ...prev, resolution: 'refund', error: '' }))}
                    className={`w-full text-left p-4 rounded-lg border-2 transition-all ${
                      capacityConflictModal.resolution === 'refund'
                        ? 'border-red-400 bg-red-50'
                        : 'border-gray-200 hover:border-gray-300 bg-white'
                    }`}
                  >
                    <div className="flex items-start gap-3">
                      <div className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5 ${capacityConflictModal.resolution === 'refund' ? 'bg-red-100' : 'bg-gray-100'}`}>
                        <XCircle className={`h-4 w-4 ${capacityConflictModal.resolution === 'refund' ? 'text-red-600' : 'text-gray-500'}`} />
                      </div>
                      <div>
                        <p className="text-sm font-semibold text-gray-900">Reembolsar a los viajeros afectados</p>
                        <p className="text-xs text-gray-500 mt-0.5">Cancelar las {capacityConflictModal.affectedTravelers} reserva(s) del slot origen y emitir reembolso del 100% en ToursRed Cash de forma inmediata.</p>
                      </div>
                    </div>
                  </button>
                </div>

                {capacityConflictModal.error && (
                  <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-800 flex items-center gap-2 mb-4">
                    <AlertCircle className="h-4 w-4 flex-shrink-0" />{capacityConflictModal.error}
                  </div>
                )}

                <div className="flex justify-end gap-3 pt-3 border-t">
                  <button
                    type="button"
                    onClick={() => setCapacityConflictModal(prev => ({ ...prev, open: false }))}
                    disabled={capacityConflictModal.isSubmitting}
                    className="btn btn-outline"
                  >
                    Cancelar
                  </button>
                  <button
                    type="button"
                    onClick={handleSubmitCapacityConflictResolution}
                    disabled={
                      capacityConflictModal.isSubmitting ||
                      !capacityConflictModal.resolution ||
                      (capacityConflictModal.resolution === 'new_slot' && !capacityConflictModal.newSlotTime)
                    }
                    className={`btn text-white disabled:opacity-50 disabled:cursor-not-allowed ${
                      capacityConflictModal.resolution === 'refund'
                        ? 'bg-red-600 hover:bg-red-700'
                        : capacityConflictModal.resolution === 'expand_capacity'
                        ? 'bg-green-600 hover:bg-green-700'
                        : 'bg-blue-600 hover:bg-blue-700'
                    }`}
                  >
                    {capacityConflictModal.isSubmitting ? (
                      <><div className="animate-spin rounded-full h-4 w-4 border-2 border-white border-t-transparent mr-2"></div>Procesando...</>
                    ) : capacityConflictModal.resolution === 'refund' ? (
                      <><XCircle className="h-4 w-4 mr-2" />Reembolsar viajeros</>
                    ) : capacityConflictModal.resolution === 'expand_capacity' ? (
                      <><Users className="h-4 w-4 mr-2" />Ampliar y reagendar</>
                    ) : (
                      <><Clock className="h-4 w-4 mr-2" />Crear nuevo horario</>
                    )}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* Modal de Cancelar Tour */}
      {cancelModal.open && cancelModal.tour && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg shadow-lg p-6 max-w-2xl w-full max-h-[90vh] overflow-y-auto">
            <div className="flex items-center mb-4">
              <div className="w-10 h-10 bg-orange-100 rounded-full flex items-center justify-center mr-3">
                <XCircle className="h-6 w-6 text-orange-600" />
              </div>
              <h2 className="text-xl font-semibold">Cancelar Tour Completo</h2>
            </div>

            {cancelModal.success ? (
              <div className="text-center py-8">
                <div className="w-16 h-16 bg-success-100 rounded-full flex items-center justify-center mx-auto mb-4">
                  <svg className="w-8 h-8 text-success-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                </div>
                <h3 className="text-lg font-semibold text-gray-900 mb-2">
                  Tour Cancelado Exitosamente
                </h3>
                <p className="text-gray-600">
                  Se ha notificado a todos los viajeros y se han procesado los reembolsos.
                </p>
              </div>
            ) : (
              <>
                <div className="bg-orange-50 border border-orange-200 rounded-lg p-4 mb-6">
                  <h3 className="font-semibold text-orange-900 mb-2">{cancelModal.tour.name}</h3>
                  <div className="text-sm text-orange-800 space-y-1">
                    <p>
                      <span className="font-medium">Fechas:</span> {formatDate(cancelModal.tour.start_date)} - {formatDate(cancelModal.tour.end_date)}
                    </p>
                    <p>
                      <span className="font-medium">Destino:</span> {cancelModal.tour.destination}
                    </p>
                  </div>
                </div>

                {cancelModal.isLoading ? (
                  <div className="flex justify-center py-8">
                    <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-primary-600"></div>
                  </div>
                ) : (
                  <>
                    {cancelModal.activeBookingsCount > 0 && (
                      <div className="bg-red-50 border border-red-200 rounded-lg p-4 mb-6">
                        <div className="flex items-start">
                          <AlertCircle className="h-5 w-5 text-red-600 mr-2 mt-0.5 flex-shrink-0" />
                          <div>
                            <p className="text-sm font-medium text-red-900">
                              {cancelModal.activeBookingsCount} {cancelModal.activeBookingsCount === 1 ? 'viajero será afectado' : 'viajeros serán afectados'}
                            </p>
                            <p className="text-xs text-red-800 mt-1">
                              Todos los viajeros recibirán un reembolso del 100% del anticipo pagado en su monedero ToursRed Cash. Los cargos por servicio no son reembolsables.
                            </p>
                          </div>
                        </div>
                      </div>
                    )}

                    {cancelModal.error && (
                      <div className="bg-error-50 border border-error-200 rounded-lg p-4 mb-6">
                        <p className="text-sm text-error-800">{cancelModal.error}</p>
                      </div>
                    )}

                    <form onSubmit={handleSubmitCancel} className="space-y-6">
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                          Motivo de la Cancelación *
                        </label>
                        <textarea
                          value={cancelFormData.cancellation_reason}
                          onChange={(e) => setCancelFormData({ cancellation_reason: e.target.value })}
                          className="input"
                          rows={5}
                          placeholder="Por favor, explica detalladamente el motivo de la cancelación del tour. Este mensaje será visible para los viajeros afectados y el administrador de la plataforma..."
                          minLength={50}
                          required
                        />
                        <p className="text-xs text-gray-500 mt-1">
                          Mínimo 50 caracteres. Este mensaje será visible para todos los viajeros afectados.
                        </p>
                        <p className="text-xs text-gray-400 mt-1">
                          Caracteres actuales: {cancelFormData.cancellation_reason.length}
                        </p>
                      </div>

                      <div className="bg-gray-50 border border-gray-200 rounded-lg p-4">
                        <h4 className="font-medium text-gray-900 mb-2">Política de Cancelación por Agencia</h4>
                        <ul className="text-sm text-gray-600 space-y-1">
                          <li>• Todos los viajeros con reservas activas serán notificados por correo electrónico</li>
                          <li>• Cada viajero recibirá un reembolso del 100% del anticipo en ToursRed Cash</li>
                          <li>• Los cargos por servicio NO son reembolsables (ya fueron cobrados por Stripe)</li>
                          <li>• El tour quedará marcado como cancelado y no podrá recibir nuevas reservas</li>
                          <li>• El administrador recibirá un reporte detallado de la cancelación</li>
                        </ul>
                      </div>

                      <div className="bg-amber-50 border border-amber-200 rounded-lg p-4">
                        <div className="flex items-start">
                          <AlertCircle className="h-5 w-5 text-amber-600 mr-2 mt-0.5 flex-shrink-0" />
                          <p className="text-sm text-amber-900">
                            <span className="font-semibold">Importante:</span> Esta acción no se puede deshacer. Una vez procesada la cancelación, todos los viajeros serán notificados y reembolsados automáticamente.
                          </p>
                        </div>
                      </div>

                      <div className="flex justify-end space-x-3 pt-4 border-t">
                        <button
                          type="button"
                          onClick={handleCloseCancel}
                          className="btn btn-outline"
                          disabled={cancelModal.isSubmitting}
                        >
                          Volver
                        </button>
                        <button
                          type="submit"
                          disabled={cancelModal.isSubmitting || cancelFormData.cancellation_reason.trim().length < 50}
                          className="btn bg-orange-600 hover:bg-orange-700 text-white disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          {cancelModal.isSubmitting ? (
                            <>
                              <div className="animate-spin rounded-full h-4 w-4 border-2 border-white border-t-transparent mr-2"></div>
                              Procesando...
                            </>
                          ) : (
                            <>
                              <XCircle className="h-4 w-4 mr-2" />
                              Confirmar Cancelación del Tour
                            </>
                          )}
                        </button>
                      </div>
                    </form>
                  </>
                )}
              </>
            )}
          </div>
        </div>
      )}

      {/* Lista de Tours */}
      {tourListTab === 'finalizados' ? (
        /* ---- Pestaña Historial ---- */
        isLoadingFinished ? (
          <div className="flex justify-center py-12">
            <div className="animate-spin rounded-full h-10 w-10 border-t-2 border-b-2 border-primary-600" />
          </div>
        ) : finishedTours.length === 0 && finishedLoaded ? (
          <div className="bg-white rounded-lg shadow-md p-8 text-center">
            <div className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-4">
              <MapPin className="h-8 w-8 text-gray-400" />
            </div>
            <h3 className="text-xl font-semibold mb-2">Sin tours finalizados</h3>
            <p className="text-gray-600">Aqui aparecerán los tours cuya fecha de fin ya pasó.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-6">
            {finishedTours.map((tour) => (
              <div key={tour.id} className="bg-white rounded-lg shadow-md overflow-hidden opacity-75">
                <div className="relative h-48">
                  <img
                    src={tour.image_url}
                    alt={tour.name}
                    className="w-full h-full object-cover grayscale-[30%]"
                    onError={(e) => { e.currentTarget.src = 'https://images.pexels.com/photos/1271619/pexels-photo-1271619.jpeg'; }}
                  />
                  <div className="absolute top-2 right-2">
                    {getStatusBadge(tour)}
                  </div>
                  <div className="absolute top-2 left-2">
                    <span className="px-2 py-1 text-xs font-medium bg-black/60 text-white rounded">
                      {getCategoryNames(tour.category)}
                    </span>
                  </div>
                </div>
                <div className="p-4">
                  <h3 className="text-lg font-semibold mb-2 line-clamp-1">{tour.name}</h3>
                  <div className="space-y-2 mb-4">
                    <div className="flex items-center text-sm text-gray-600">
                      <MapPin className="h-4 w-4 mr-2" />
                      <span>{tour.destination}</span>
                    </div>
                    <div className="flex items-center text-sm text-gray-600">
                      <Calendar className="h-4 w-4 mr-2" />
                      <span>{formatDate(tour.start_date)} - {formatDate(tour.end_date)}</span>
                    </div>
                    <div className="flex items-center justify-between text-sm">
                      <div className="flex items-center text-gray-600">
                        <Users className="h-4 w-4 mr-2" />
                        <span>Máx {tour.max_travelers}</span>
                      </div>
                      <span className="font-semibold text-primary-600">${tour.price?.toLocaleString()}</span>
                    </div>
                  </div>
                  <p className="text-xs text-gray-400">Creado: {new Date(tour.created_at).toLocaleDateString('es-MX', { month: 'short', day: 'numeric', year: 'numeric' })}</p>
                  {canCreate && (
                    <div className="mt-3 pt-3 border-t border-gray-100 flex justify-end">
                      <button
                        onClick={() => handleDuplicate(tour.id)}
                        title="Duplicar tour"
                        disabled={isSubmitting || duplicatingTour}
                        className="p-1.5 text-gray-400 hover:text-primary-600 hover:bg-primary-50 rounded transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        <Copy className="h-4 w-4" />
                      </button>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )
      ) : tours.length === 0 && !isLoading ? (
        /* ---- Pestaña Activos vacía ---- */
        <div className="bg-white rounded-lg shadow-md p-8 text-center">
          <div className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <MapPin className="h-8 w-8 text-gray-400" />
          </div>
          <h3 className="text-xl font-semibold mb-2">No tienes tours activos</h3>
          <p className="text-gray-600 mb-6">
            Comienza creando tu primer tour para atraer viajeros a tu agencia.
          </p>
          {canCreate && (
            <button onClick={handleCreate} className="btn btn-primary">
              <Plus className="h-5 w-5 mr-2" />
              Crear Mi Primer Tour
            </button>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-6">
          {tours.map((tour) => (
            <div key={tour.id} className="bg-white rounded-lg shadow-md overflow-hidden">
              {/* Imagen del Tour */}
              <div className="relative h-48">
                <img
                  src={tour.image_url}
                  alt={tour.name}
                  className="w-full h-full object-cover"
                  onError={(e) => {
                    // Fallback image if the tour image fails to load
                    e.currentTarget.src = 'https://images.pexels.com/photos/1271619/pexels-photo-1271619.jpeg';
                  }}
                />
                <div className="absolute top-2 right-2">
                  {getStatusBadge(tour)}
                </div>
                <div className="absolute top-2 left-2">
                  <span className="px-2 py-1 text-xs font-medium bg-black/60 text-white rounded">
                    {getCategoryNames(tour.category)}
                  </span>
                </div>
              </div>

              {/* Contenido del Tour */}
              <div className="p-4">
                <h3 className="text-lg font-semibold mb-2 line-clamp-1">{tour.name}</h3>
                
                <div className="space-y-2 mb-4">
                  <div className="flex items-center text-sm text-gray-600">
                    <MapPin className="h-4 w-4 mr-2" />
                    <span>{tour.destination}</span>
                  </div>
                  
                  <div className="flex items-center text-sm text-gray-600">
                    <Calendar className="h-4 w-4 mr-2" />
                    {tour.tour_type === 'receptivo'
                      ? <span>Disponible según calendario</span>
                      : <span>{formatDate(tour.start_date)} - {formatDate(tour.end_date)}</span>
                    }
                  </div>
                  
                  <div className="flex items-center justify-between text-sm text-gray-600">
                    <div className="flex items-center">
                      <Users className="h-4 w-4 mr-2" />
                      <span>Máx {tour.max_travelers || 'Sin límite'}</span>
                    </div>
                    <div className="flex items-center">
                      <DollarSign className="h-4 w-4 mr-1" />
                      <span className="font-semibold text-primary-600">${tour.price}</span>
                    </div>
                  </div>

                  {/* Comisión efectiva */}
                  {(() => {
                    const hasOverride = (tour as any).commission_rate_override != null;
                    const expired = hasOverride && (tour as any).commission_override_expires_at != null
                      ? new Date((tour as any).commission_override_expires_at) <= new Date()
                      : false;
                    const overrideActive = hasOverride && !expired;

                    if (!overrideActive) return null;

                    const rate = ((tour as any).commission_rate_override * 100).toFixed(1);
                    const reason = (tour as any).commission_override_reason;
                    const expiresAt = (tour as any).commission_override_expires_at;

                    return (
                      <div className="mt-2 rounded-lg bg-amber-50 border border-amber-200 px-3 py-2">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-1.5 text-amber-800 text-xs font-medium">
                            <Percent className="h-3.5 w-3.5 shrink-0" />
                            Comisión especial: {rate}%
                          </div>
                          {expiresAt && (
                            <span className="text-xs text-amber-600">
                              Hasta {new Date(expiresAt).toLocaleDateString('es-MX', { day: '2-digit', month: 'short', year: 'numeric' })}
                            </span>
                          )}
                          {!expiresAt && (
                            <span className="text-xs text-amber-600">Sin fecha de fin</span>
                          )}
                        </div>
                        {reason && (
                          <p className="text-xs text-amber-700 mt-1 line-clamp-2">{reason}</p>
                        )}
                      </div>
                    );
                  })()}
                </div>

                <p className="text-sm text-gray-600 mb-4 line-clamp-2">
                  {tour.description}
                </p>

                {/* Acciones — 2 filas */}
                <div className="pt-3 border-t space-y-1.5">
                  {/* Fila 1: ver · editar · asientos · destacar · duplicar */}
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-gray-400">
                      Creado: {formatDate(tour.created_at)}
                    </span>
                    <div className="flex items-center gap-0.5">
                      <button
                        onClick={() => window.open(`/tours/${tour.slug}`, '_blank')}
                        className="p-1.5 text-gray-400 hover:text-primary-600 hover:bg-primary-50 rounded transition-colors"
                        title="Ver tour"
                      >
                        <Eye className="h-4 w-4" />
                      </button>
                      {canEdit && (
                        <button
                          onClick={() => handleEdit(tour)}
                          className="p-1.5 text-gray-400 hover:text-primary-600 hover:bg-primary-50 rounded transition-colors"
                          title="Editar tour"
                          disabled={isSubmitting || isCreating || editingTour || duplicatingTour}
                        >
                          <Pencil className="h-4 w-4" />
                        </button>
                      )}
                      {(tour as any).vehicle_map_type && (
                        <button
                          onClick={() => setSeatMapModal({ open: true, tour })}
                          className="p-1.5 text-blue-400 hover:text-blue-600 hover:bg-blue-50 rounded transition-colors"
                          title="Gestionar asientos"
                          disabled={isSubmitting || isCreating || !!editingTour || !!duplicatingTour}
                        >
                          <Bus className="h-4 w-4" />
                        </button>
                      )}
                      {canCreate && (
                        <button
                          onClick={() => handleOpenFeatured(tour)}
                          className="p-1.5 text-gray-400 hover:text-amber-500 hover:bg-amber-50 rounded transition-colors"
                          title="Destacar tour"
                          disabled={isSubmitting || isCreating || !!editingTour || !!duplicatingTour}
                        >
                          <Sparkles className="h-4 w-4" />
                        </button>
                      )}
                      {canCreate && (
                        <button
                          onClick={() => handleDuplicate(tour)}
                          className="p-1.5 text-gray-400 hover:text-primary-600 hover:bg-primary-50 rounded transition-colors"
                          title="Duplicar tour"
                          disabled={isSubmitting || isCreating || editingTour || duplicatingTour}
                        >
                          <Copy className="h-4 w-4" />
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Fila 2: reagendar · cancelar · eliminar (solo cuando hay permisos) */}
                  {(canEdit || canDelete) && (
                    <div className="flex items-center justify-end gap-0.5">
                      {canEdit && tour.tour_type === 'receptivo' ? (
                        <>
                          <button
                            onClick={() => handleOpenReceptivoActions(tour, 'slot-reschedule')}
                            className="p-1.5 text-gray-400 hover:text-amber-600 hover:bg-amber-50 rounded transition-colors"
                            title="Reagendar un slot especifico"
                            disabled={isSubmitting || isCreating || !!editingTour || !!duplicatingTour || !!tour.cancelled_by_agency}
                          >
                            <CalendarX className="h-4 w-4" />
                          </button>
                          <button
                            onClick={() => handleOpenReceptivoActions(tour, 'slot-cancel')}
                            className="p-1.5 text-gray-400 hover:text-orange-500 hover:bg-orange-50 rounded transition-colors"
                            title="Cancelar un slot especifico"
                            disabled={isSubmitting || isCreating || !!editingTour || !!duplicatingTour || !!tour.cancelled_by_agency}
                          >
                            <XCircle className="h-4 w-4" />
                          </button>
                          <button
                            onClick={() => handleOpenReceptivoActions(tour, 'full-cancel')}
                            className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded transition-colors"
                            title="Cancelar tour completo (dejar de operar)"
                            disabled={isSubmitting || isCreating || !!editingTour || !!duplicatingTour || !!tour.cancelled_by_agency}
                          >
                            <Ban className="h-4 w-4" />
                          </button>
                        </>
                      ) : canEdit ? (
                        <>
                          <button
                            onClick={() => handleOpenReschedule(tour)}
                            className="p-1.5 text-gray-400 hover:text-amber-600 hover:bg-amber-50 rounded transition-colors"
                            title="Reagendar tour"
                            disabled={isSubmitting || isCreating || !!editingTour || !!duplicatingTour || new Date(tour.start_date) < new Date() || !!tour.cancelled_by_agency}
                          >
                            <CalendarX className="h-4 w-4" />
                          </button>
                          <button
                            onClick={() => handleOpenCancel(tour)}
                            className="p-1.5 text-gray-400 hover:text-orange-500 hover:bg-orange-50 rounded transition-colors"
                            title="Cancelar tour completo"
                            disabled={isSubmitting || isCreating || !!editingTour || !!duplicatingTour || new Date(tour.start_date) <= new Date() || !!tour.cancelled_by_agency}
                          >
                            <XCircle className="h-4 w-4" />
                          </button>
                        </>
                      ) : null}
                      {canDelete && (
                        <button
                          onClick={() => handleDelete(tour.id, tour.name)}
                          className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded transition-colors"
                          title="Eliminar tour"
                          disabled={isSubmitting || duplicatingTour}
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Modal de Destacar Tour */}
      {featuredModal.open && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden">
            {/* Header */}
            <div className="bg-gradient-to-r from-amber-400 to-amber-500 p-5">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-white/20 rounded-xl flex items-center justify-center">
                    <Sparkles className="w-5 h-5 text-white" />
                  </div>
                  <div>
                    <h3 className="text-white font-bold text-lg">Destacar Tour</h3>
                    <p className="text-amber-100 text-xs truncate max-w-[220px]">{featuredModal.tour?.name}</p>
                  </div>
                </div>
                <button
                  onClick={() => setFeaturedModal(prev => ({ ...prev, open: false }))}
                  className="text-white/80 hover:text-white transition-colors"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>

            <div className="p-5">
              {featuredModal.isLoading ? (
                <div className="flex items-center justify-center py-10 gap-2 text-gray-400">
                  <Loader2 className="w-5 h-5 animate-spin" />
                  <span className="text-sm">Cargando planes...</span>
                </div>
              ) : featuredModal.step === 'done' ? (
                <div className="text-center py-8">
                  <div className="w-14 h-14 bg-green-50 rounded-2xl flex items-center justify-center mx-auto mb-3">
                    <CheckCircle className="w-7 h-7 text-green-500" />
                  </div>
                  <p className="text-gray-900 font-semibold mb-1">Listo</p>
                  <p className="text-gray-500 text-sm">{featuredModal.success}</p>
                  <button
                    onClick={() => setFeaturedModal(prev => ({ ...prev, open: false }))}
                    className="mt-5 px-5 py-2 bg-primary-600 text-white rounded-xl text-sm font-semibold hover:bg-primary-700 transition-colors"
                  >
                    Cerrar
                  </button>
                </div>
              ) : featuredModal.step === 'payment' ? (
                /* ── Paso 2: Seleccionar proveedor de pago ── */
                <>
                  <div className="mb-5">
                    <div className="flex items-center gap-2 mb-1">
                      <div className="w-6 h-6 rounded-full bg-amber-100 text-amber-600 text-xs font-bold flex items-center justify-center">2</div>
                      <p className="font-semibold text-gray-800 text-sm">Elige como pagar</p>
                    </div>
                    {/* Plan summary */}
                    {(() => {
                      const plan = featuredModal.plans.find((p: any) => p.id === featuredModal.selectedPlanId);
                      const finalPrice = featuredModal.couponApplied && featuredModal.couponDiscount > 0
                        ? plan?.price - featuredModal.couponDiscount
                        : plan?.price;
                      return plan ? (
                        <div className="mt-2 px-3 py-2 bg-amber-50 border border-amber-100 rounded-lg text-sm flex items-center justify-between">
                          <span className="text-amber-800 font-medium">{plan.name} — {plan.duration_days} dias</span>
                          <div className="text-right">
                            {featuredModal.couponApplied && featuredModal.couponDiscount > 0 && (
                              <div className="text-xs text-gray-400 line-through">${plan.price.toLocaleString('es-MX')} MXN</div>
                            )}
                            <span className="font-bold text-amber-700">${finalPrice?.toLocaleString('es-MX')} MXN</span>
                          </div>
                        </div>
                      ) : null;
                    })()}
                  </div>

                  {/* Provider selector */}
                  <div className="space-y-2 mb-5">
                    {([
                      { id: 'stripe', label: 'Tarjeta / OXXO / Transferencia', sub: 'Visa, Mastercard, OXXO, transferencia bancaria' },
                      { id: 'mercadopago', label: 'MercadoPago', sub: 'Tarjeta, efectivo, transferencia SPEI' },
                      { id: 'paypal', label: 'PayPal', sub: 'Cuenta PayPal o tarjeta de credito/debito' },
                    ] as { id: 'stripe' | 'mercadopago' | 'paypal'; label: string; sub: string }[]).map(p => (
                      <label
                        key={p.id}
                        className={`flex items-center gap-3 p-3 rounded-xl border-2 cursor-pointer transition-all ${featuredModal.selectedProvider === p.id ? 'border-primary-400 bg-primary-50' : 'border-gray-100 hover:border-primary-200'}`}
                      >
                        <input
                          type="radio"
                          name="provider"
                          value={p.id}
                          checked={featuredModal.selectedProvider === p.id}
                          onChange={() => setFeaturedModal(prev => ({ ...prev, selectedProvider: p.id }))}
                          className="accent-primary-600"
                        />
                        <div>
                          <div className="font-semibold text-gray-900 text-sm">{p.label}</div>
                          <div className="text-xs text-gray-500">{p.sub}</div>
                        </div>
                      </label>
                    ))}
                  </div>

                  <div className="flex items-center gap-1.5 text-xs text-gray-400 mb-4">
                    <Lock className="w-3.5 h-3.5" /> Pago seguro — no se guardan datos de tarjeta en nuestros servidores
                  </div>

                  {featuredModal.error && (
                    <div className="mb-3 p-3 bg-red-50 border border-red-200 rounded-xl text-sm text-red-700">
                      {featuredModal.error}
                    </div>
                  )}

                  <div className="flex gap-2">
                    <button
                      onClick={handlePayFeaturedSlot}
                      disabled={featuredModal.isSubmitting}
                      className="flex-1 flex items-center justify-center gap-2 py-2.5 bg-gradient-to-r from-amber-400 to-amber-500 hover:from-amber-500 hover:to-amber-600 text-white rounded-xl text-sm font-semibold disabled:opacity-50 transition-all shadow-sm"
                    >
                      {featuredModal.isSubmitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <CreditCard className="w-4 h-4" />}
                      Pagar y destacar tour
                    </button>
                    <button
                      onClick={() => setFeaturedModal(prev => ({ ...prev, step: 'plan', error: '' }))}
                      className="px-4 py-2.5 border border-gray-200 text-gray-600 rounded-xl text-sm font-medium hover:bg-gray-50 transition-colors"
                    >
                      Atras
                    </button>
                  </div>
                </>
              ) : (
                /* ── Paso 1: Elegir plan ── */
                <>
                  {/* Active slot info */}
                  {featuredModal.activeSlot && (
                    <div className="mb-4 p-3 bg-amber-50 border border-amber-200 rounded-xl flex items-start gap-3">
                      <Star className="w-4 h-4 text-amber-500 flex-shrink-0 mt-0.5" />
                      <div className="text-sm">
                        <p className="font-semibold text-amber-800">Este tour ya esta destacado</p>
                        <p className="text-amber-700">
                          Plan: {featuredModal.activeSlot.featured_plans?.name} &middot;
                          Vence: {new Date(featuredModal.activeSlot.expires_at).toLocaleDateString('es-MX', { day: '2-digit', month: 'short', year: 'numeric' })}
                        </p>
                        {featuredModal.activeSlot.featured_tour_stats && (
                          <div className="flex gap-4 mt-1.5 text-xs text-amber-600">
                            <span>{featuredModal.activeSlot.featured_tour_stats.impressions ?? 0} impresiones</span>
                            <span>{featuredModal.activeSlot.featured_tour_stats.clicks ?? 0} clics</span>
                            <span>{featuredModal.activeSlot.featured_tour_stats.bookings_generated ?? 0} reservas</span>
                          </div>
                        )}
                      </div>
                    </div>
                  )}

                  {/* What is featured */}
                  <div className="mb-4 p-3 bg-blue-50 rounded-xl text-xs text-blue-700 space-y-1">
                    <p className="font-semibold text-blue-800 flex items-center gap-1.5"><TrendingUp className="w-3.5 h-3.5" /> Que incluye destacar tu tour</p>
                    <ul className="space-y-0.5 pl-5 list-disc">
                      <li>Aparece primero en la seccion "Tours Destacados" del inicio</li>
                      <li>Se muestra primero en busquedas que coincidan con tu tour</li>
                      <li>Badge dorado visible para todos los viajeros</li>
                    </ul>
                  </div>

                  {/* Plan selector */}
                  {!featuredModal.activeSlot && (
                    <>
                      <div className="flex items-center gap-2 mb-2">
                        <div className="w-6 h-6 rounded-full bg-amber-100 text-amber-600 text-xs font-bold flex items-center justify-center">1</div>
                        <p className="text-sm font-semibold text-gray-700">Elige un plan:</p>
                      </div>
                      <div className="space-y-2 mb-4">
                        {featuredModal.plans.map((plan: any) => (
                          <label
                            key={plan.id}
                            className={`flex items-center gap-3 p-3 rounded-xl border-2 cursor-pointer transition-all ${featuredModal.selectedPlanId === plan.id ? 'border-amber-400 bg-amber-50' : 'border-gray-100 hover:border-amber-200'}`}
                          >
                            <input
                              type="radio"
                              name="plan"
                              value={plan.id}
                              checked={featuredModal.selectedPlanId === plan.id}
                              onChange={() => setFeaturedModal(prev => ({ ...prev, selectedPlanId: plan.id }))}
                              className="accent-amber-500"
                            />
                            <div className="flex-1">
                              <div className="flex items-center justify-between">
                                <span className="font-semibold text-gray-900 text-sm">{plan.name}</span>
                                <span className="font-bold text-amber-600 text-sm">${plan.price.toLocaleString('es-MX')} MXN</span>
                              </div>
                              <p className="text-xs text-gray-500">{plan.duration_days} dias de visibilidad destacada</p>
                            </div>
                          </label>
                        ))}
                      </div>
                    </>
                  )}

                  {featuredModal.error && (
                    <div className="mb-3 p-3 bg-red-50 border border-red-200 rounded-xl text-sm text-red-700">
                      {featuredModal.error.includes('max') || featuredModal.error.includes('50')
                        ? (
                          <>
                            <p className="font-semibold mb-1">No hay lugares disponibles</p>
                            <p>Todos los espacios de tours destacados estan ocupados. Puedes unirte a la lista de espera y te notificaremos cuando se libere un espacio.</p>
                          </>
                        ) : featuredModal.error}
                    </div>
                  )}

                  {/* Cupón de descuento colapsable */}
                  {!featuredModal.activeSlot && featuredModal.selectedPlanId && !(featuredModal.error?.includes('max') || featuredModal.error?.includes('50')) && (
                    <div className="mb-4">
                      <button
                        type="button"
                        onClick={() => setFeaturedModal(prev => ({ ...prev, couponExpanded: !prev.couponExpanded }))}
                        className="flex items-center gap-1.5 text-xs text-gray-500 hover:text-gray-700 transition-colors"
                      >
                        <ChevronDown className={`w-3.5 h-3.5 transition-transform ${featuredModal.couponExpanded ? 'rotate-180' : ''}`} />
                        {featuredModal.couponApplied ? (
                          <span className="text-green-600 font-medium">Codigo aplicado: -{featuredModal.couponCode}</span>
                        ) : (
                          '¿Tienes un codigo de descuento?'
                        )}
                      </button>
                      {featuredModal.couponExpanded && (
                        <div className="mt-2">
                          <div className="flex gap-2">
                            <input
                              type="text"
                              placeholder="Ingresa tu codigo"
                              value={featuredModal.couponCode}
                              onChange={e => setFeaturedModal(prev => ({ ...prev, couponCode: e.target.value.toUpperCase(), couponApplied: false, couponDiscount: 0, couponError: '' }))}
                              onKeyDown={e => { if (e.key === 'Enter') handleValidateCoupon(); }}
                              className="flex-1 px-3 py-2 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-amber-300 uppercase tracking-wider"
                              disabled={featuredModal.couponApplied}
                            />
                            {featuredModal.couponApplied ? (
                              <button
                                onClick={() => setFeaturedModal(prev => ({ ...prev, couponCode: '', couponApplied: false, couponDiscount: 0, couponError: '', couponType: '' }))}
                                className="px-3 py-2 border border-gray-200 text-gray-500 rounded-xl text-sm hover:bg-gray-50 transition-colors"
                              >
                                Quitar
                              </button>
                            ) : (
                              <button
                                onClick={handleValidateCoupon}
                                disabled={!featuredModal.couponCode.trim() || featuredModal.couponIsValidating}
                                className="px-4 py-2 bg-gray-800 text-white rounded-xl text-sm font-semibold disabled:opacity-40 hover:bg-gray-700 transition-colors"
                              >
                                {featuredModal.couponIsValidating ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Aplicar'}
                              </button>
                            )}
                          </div>
                          {featuredModal.couponError && (
                            <p className="mt-2 text-xs text-red-600">{featuredModal.couponError}</p>
                          )}
                          {featuredModal.couponApplied && featuredModal.couponDiscount > 0 && (
                            <div className="mt-2 flex items-center gap-2 text-xs text-green-700 bg-green-50 border border-green-200 rounded-lg px-3 py-2">
                              <CheckCircle className="w-3.5 h-3.5 flex-shrink-0" />
                              <span>Descuento de <strong>${featuredModal.couponDiscount.toLocaleString('es-MX')} MXN</strong> aplicado</span>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  )}

                  {!featuredModal.activeSlot && (
                    <div className="flex gap-2">
                      {featuredModal.error?.includes('max') || featuredModal.error?.includes('50') ? (
                        <button
                          onClick={handleJoinWaitlist}
                          disabled={featuredModal.isSubmitting || !featuredModal.selectedPlanId}
                          className="flex-1 flex items-center justify-center gap-2 py-2.5 bg-primary-600 hover:bg-primary-700 text-white rounded-xl text-sm font-semibold disabled:opacity-50 transition-colors"
                        >
                          {featuredModal.isSubmitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckSquare className="w-4 h-4" />}
                          Unirme a la lista de espera
                        </button>
                      ) : (
                        <button
                          onClick={handleActivateFeatured}
                          disabled={featuredModal.isSubmitting || !featuredModal.selectedPlanId}
                          className="flex-1 flex items-center justify-center gap-2 py-2.5 bg-gradient-to-r from-amber-400 to-amber-500 hover:from-amber-500 hover:to-amber-600 text-white rounded-xl text-sm font-semibold disabled:opacity-50 transition-all shadow-sm"
                        >
                          {featuredModal.isSubmitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
                          Continuar al pago
                        </button>
                      )}
                      <button
                        onClick={() => setFeaturedModal(prev => ({ ...prev, open: false }))}
                        className="px-4 py-2.5 border border-gray-200 text-gray-600 rounded-xl text-sm font-medium hover:bg-gray-50 transition-colors"
                      >
                        Cancelar
                      </button>
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Modal de Gestion de Asientos */}
      {seatMapModal.open && seatMapModal.tour && resolvedAgencyId && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
            <div className="sticky top-0 bg-blue-600 px-6 py-4 rounded-t-2xl flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="bg-white/20 rounded-lg p-2">
                  <Bus className="w-5 h-5 text-white" />
                </div>
                <div>
                  <h2 className="text-white font-bold text-base">{seatMapModal.tour.name}</h2>
                  <p className="text-blue-100 text-xs">Gestion de asientos — haz click en un asiento para bloquearlo o desbloquearlo</p>
                </div>
              </div>
              <button
                onClick={() => setSeatMapModal({ open: false, tour: null })}
                className="text-white/80 hover:text-white transition-colors p-1"
              >
                <X className="w-6 h-6" />
              </button>
            </div>
            <div className="p-6">
              <div className="mb-4 p-3 bg-blue-50 border border-blue-200 rounded-xl text-sm text-blue-800">
                <strong>Como funciona:</strong> Los asientos en blanco estan disponibles para reservas online. Haz click en cualquier asiento disponible para bloquearlo (ventas externas). Haz click en un asiento bloqueado para desbloquearlo.
              </div>
              <SeatMapManager
                tourId={seatMapModal.tour.id}
                agencyId={resolvedAgencyId}
                slotId={null}
                isReceptivo={(seatMapModal.tour as any).tour_type === 'receptivo'}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default AgencyTours;