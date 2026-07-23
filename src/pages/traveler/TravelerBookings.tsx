import React, { useState, useEffect } from 'react';
import { Calendar, MapPin, Users, DollarSign, Clock, Eye, AlertCircle, Star, X, CreditCard as Edit, UserCheck, XCircle, CalendarX, Check, Wallet, Lock, UserMinus, Car, Globe, Tag, Plus, AlertTriangle, ShoppingBag, Shield } from 'lucide-react';
import SeatReselectionModal from '../../components/SeatReselectionModal';
import PaymentPlanCalendar from '../../components/PaymentPlanCalendar';
import { useAuth } from '../../context/AuthContext';
import { getUserBookings, getUserPastBookings, getUserCancelledBookings, parseDateFromDB, supabase, calculateCancellationPolicy, calculatePartialCancellationPolicy, processPartialCancellation, PartialCancellationTraveler } from '../../lib/supabase';
import { Booking, PendingReschedule } from '../../types';
import { format } from 'date-fns';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import ReviewForm from '../../components/ReviewForm';
import { useFormPersistence } from '../../hooks/useFormPersistence';
import { usePreventUnload } from '../../hooks/usePreventUnload';
import { formatCurrency, formatCurrencyMXN } from '../../utils/formatCurrency';
import { validateAllTravelers } from '../../utils/birthDateValidation';
import PaymentProviderSelector from '../../components/PaymentProviderSelector';
import MercadoPagoBrick from '../../components/MercadoPagoBrick';

const TravelerBookings: React.FC = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [highlightedBookingId, setHighlightedBookingId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');
  const [bookingOptionalServices, setBookingOptionalServices] = useState<Record<string, any[]>>({});
  const [bookingSupplements, setBookingSupplements] = useState<Record<string, any[]>>({});
  const [tourSupplements, setTourSupplements] = useState<Record<string, any[]>>({});
  const [supplementPaymentModal, setSupplementPaymentModal] = useState<{
    open: boolean;
    supplement: any | null;
    booking: Booking | null;
    quantity: number;
    availableCapacity: number;
    isProcessing: boolean;
    error: string;
    walletBalance: number;
    pointsBalance: number;
    pointsValueMxn: number;
    selectedMethod: 'toursred_cash' | 'points' | 'stripe' | 'mercadopago' | 'paypal';
    cashToUse: number;
  }>({
    open: false,
    supplement: null,
    booking: null,
    quantity: 1,
    availableCapacity: 0,
    isProcessing: false,
    error: '',
    walletBalance: 0,
    pointsBalance: 0,
    pointsValueMxn: 0,
    selectedMethod: 'stripe',
    cashToUse: 0,
  });
  const [supplementsModal, setSupplementsModal] = useState<{
    open: boolean;
    booking: Booking | null;
    activeTab: 'mis_suplementos' | 'disponibles';
  }>({ open: false, booking: null, activeTab: 'mis_suplementos' });
  const [supplementDirectPayModal, setSupplementDirectPayModal] = useState<{
    open: boolean;
    bookingSupplement: any | null;
    booking: Booking | null;
    isProcessing: boolean;
    error: string;
    walletBalance: number;
    pointsBalance: number;
    pointsValueMxn: number;
    selectedMethod: 'toursred_cash' | 'points' | 'stripe' | 'mercadopago' | 'paypal';
  }>({
    open: false,
    bookingSupplement: null,
    booking: null,
    isProcessing: false,
    error: '',
    walletBalance: 0,
    pointsBalance: 0,
    pointsValueMxn: 0,
    selectedMethod: 'stripe',
  });
  const [extrasModal, setExtrasModal] = useState<{
    open: boolean;
    booking: Booking | null;
    activeTab: 'servicios' | 'seguro';
    tourOptionalServices: any[];
    existingBosIds: Set<string>;
    insuranceAlreadyBought: boolean;
    insuranceCost: number;
    insurancePricePerDay: number;
    insuranceDays: number;
    insuranceConditionsAccepted: boolean;
    isLoading: boolean;
  }>({
    open: false,
    booking: null,
    activeTab: 'servicios',
    tourOptionalServices: [],
    existingBosIds: new Set(),
    insuranceAlreadyBought: false,
    insuranceCost: 0,
    insurancePricePerDay: 0,
    insuranceDays: 1,
    insuranceConditionsAccepted: false,
    isLoading: false,
  });
  const [extrasPaymentModal, setExtrasPaymentModal] = useState<{
    open: boolean;
    type: 'optional_service' | 'insurance' | null;
    item: any | null;
    quantity: number;
    booking: Booking | null;
    isProcessing: boolean;
    error: string;
    walletBalance: number;
    pointsBalance: number;
    pointsValueMxn: number;
    selectedMethod: 'toursred_cash' | 'points' | 'stripe' | 'mercadopago' | 'paypal';
  }>({
    open: false,
    type: null,
    item: null,
    quantity: 1,
    booking: null,
    isProcessing: false,
    error: '',
    walletBalance: 0,
    pointsBalance: 0,
    pointsValueMxn: 0,
    selectedMethod: 'stripe',
  });
  const [reviewModal, setReviewModal] = useState<{
    open: boolean;
    booking: Booking | null;
    existingReview: any;
  }>({ open: false, booking: null, existingReview: null });
  const [travelersModal, setTravelersModal] = useState<{
    open: boolean;
    booking: Booking | null;
    travelers: any[];
  }>({ open: false, booking: null, travelers: [] });
  const [cancellationModal, setCancellationModal] = useState<{
    open: boolean;
    booking: Booking | null;
    policy: any;
    isCalculating: boolean;
    isCancelling: boolean;
    cancellationReason: string;
    acceptPolicy: boolean;
    error: string;
    success: boolean;
  }>({
    open: false,
    booking: null,
    policy: null,
    isCalculating: false,
    isCancelling: false,
    cancellationReason: '',
    acceptPolicy: false,
    error: '',
    success: false,
  });
  const [partialCancellationModal, setPartialCancellationModal] = useState<{
    open: boolean;
    booking: Booking | null;
    travelers: PartialCancellationTraveler[];
    selectedIds: Set<string>;
    policy: any;
    isCalculating: boolean;
    isCancelling: boolean;
    cancellationReason: string;
    acceptPolicy: boolean;
    error: string;
    success: boolean;
    refundAmount: number;
  }>({
    open: false,
    booking: null,
    travelers: [],
    selectedIds: new Set(),
    policy: null,
    isCalculating: false,
    isCancelling: false,
    cancellationReason: '',
    acceptPolicy: false,
    error: '',
    success: false,
    refundAmount: 0,
  });

  const [paymentModal, setPaymentModal] = useState<{
    open: boolean;
    booking: Booking | null;
    walletBalance: number;
    toursRedCashToUse: number;
    isProcessing: boolean;
    selectedProvider: 'stripe' | 'mercadopago' | 'paypal';
  }>({
    open: false,
    booking: null,
    walletBalance: 0,
    toursRedCashToUse: 0,
    isProcessing: false,
    selectedProvider: 'stripe',
  });
  const [mpBrickModal, setMpBrickModal] = useState<{
    open: boolean;
    preferenceId: string;
    publicKey: string;
    bookingId: string;
    amount: number;
  } | null>(null);
  const [mpSupplementBrickModal, setMpSupplementBrickModal] = useState<{
    open: boolean;
    preferenceId: string;
    publicKey: string;
    supplementId: string;
    amount: number;
  } | null>(null);
  const [rescheduleModal, setRescheduleModal] = useState<{
    open: boolean;
    booking: Booking | null;
    rescheduleInfo: PendingReschedule | null;
    isLoading: boolean;
    isProcessing: boolean;
    error: string;
    success: boolean;
    action: 'accept' | 'reject' | null;
  }>({
    open: false,
    booking: null,
    rescheduleInfo: null,
    isLoading: false,
    isProcessing: false,
    error: '',
    success: false,
    action: null,
  });
  const [pendingReschedules, setPendingReschedules] = useState<{ [bookingId: string]: PendingReschedule }>({});
  const [pendingSlotReschedules, setPendingSlotReschedules] = useState<{ [bookingId: string]: any }>({});
  const [slotRescheduleModal, setSlotRescheduleModal] = useState<{
    open: boolean;
    booking: Booking | null;
    slotRescheduleInfo: any | null;
    action: 'accept' | 'reject' | null;
    isProcessing: boolean;
    error: string;
    success: boolean;
  }>({
    open: false,
    booking: null,
    slotRescheduleInfo: null,
    action: null,
    isProcessing: false,
    error: '',
    success: false,
  });
  const [paymentValidationError, setPaymentValidationError] = useState<{
    open: boolean;
    bookingId: string;
    message: string;
  }>({ open: false, bookingId: '', message: '' });
  const [seatReselectionModal, setSeatReselectionModal] = useState<{
    open: boolean;
    bookingId: string;
    tourId: string;
    slotId: string;
    travelersCount: number;
    previousSeats: number[];
    tourName: string;
    newDate: string;
    newTime: string;
  } | null>(null);

  const [bookingTab, setBookingTab] = useState<'activas' | 'pasadas' | 'canceladas'>('activas');
  const [pastBookings, setPastBookings] = useState<Booking[]>([]);
  const [cancelledBookings, setCancelledBookings] = useState<Booking[]>([]);
  const [isLoadingPast, setIsLoadingPast] = useState(false);
  const [isLoadingCancelled, setIsLoadingCancelled] = useState(false);
  const [pastLoaded, setPastLoaded] = useState(false);
  const [cancelledLoaded, setCancelledLoaded] = useState(false);
  const [pastOptionalServices, setPastOptionalServices] = useState<Record<string, any[]>>({});
  const [pastSupplements, setPastSupplements] = useState<Record<string, any[]>>({});
  const [isForeignTraveler, setIsForeignTraveler] = useState(false);

  const cancellationFormPersistence = useFormPersistence(
    { cancellationReason: cancellationModal.cancellationReason },
    { key: `cancellation_${cancellationModal.booking?.id || 'temp'}`, expirationHours: 24 }
  );

  usePreventUnload(cancellationModal.open && cancellationModal.cancellationReason.length > 0);

  useEffect(() => {
    if (user?.id) {
      fetchBookings();
      supabase
        .from('users')
        .select('is_foreign_traveler')
        .eq('id', user.id)
        .maybeSingle()
        .then(({ data }) => {
          if (data) setIsForeignTraveler(data.is_foreign_traveler ?? false);
        });
    }
  }, [user?.id]);

  useEffect(() => {
    const action = searchParams.get('action');
    const bookingId = searchParams.get('booking');

    if (action && bookingId && !isLoading && bookings.length > 0) {
      const booking = bookings.find(b => b.id === bookingId);

      if (booking && booking.has_pending_reschedule && pendingReschedules[bookingId]) {
        if (action === 'accept' || action === 'reject') {
          handleOpenRescheduleModal(booking, action);
          setSearchParams({});
        }
      }
    }
  }, [searchParams, bookings, isLoading, pendingReschedules]);

  useEffect(() => {
    const bookingId = searchParams.get('booking');
    const action = searchParams.get('action');
    if (bookingId && !action && !isLoading && bookings.length > 0) {
      setHighlightedBookingId(bookingId);
      setTimeout(() => {
        const el = document.getElementById(`booking-${bookingId}`);
        if (el) {
          el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
      }, 100);
      setTimeout(() => setHighlightedBookingId(null), 3000);
    }
  }, [searchParams, bookings, isLoading]);

  const fetchBookings = async () => {
    if (!user?.id) return;

    try {
      setIsLoading(true);
      setError('');

      const { data, error } = await getUserBookings(user.id);

      if (error) {
        throw new Error(error.message);
      }

      // Client-side split: bookings whose tour date (or selected_date) already passed
      // go to "Pasadas" immediately, without waiting for the lazy-load tab click
      const today = new Date().toISOString().split('T')[0];
      const activeList: Booking[] = [];
      const expiredList: Booking[] = [];
      for (const b of (data || [])) {
        const refDate = (b as any).selected_date || (b as any).tours?.end_date;
        if (refDate && refDate < today) {
          expiredList.push(b);
        } else {
          activeList.push(b);
        }
      }
      setBookings(activeList);
      if (expiredList.length > 0) {
        setPastBookings(prev => {
          const existingIds = new Set(prev.map((x: any) => x.id));
          return [...prev, ...expiredList.filter((x: any) => !existingIds.has(x.id))];
        });
      }

      if (data && data.length > 0 && activeList.length > 0) {
        const ids = activeList.map((b: any) => b.id);
        const bookingsWithReschedule = activeList.filter((b: any) => b.has_pending_reschedule);
        const bookingsWithSlotReschedule = activeList.filter((b: any) => b.has_pending_slot_reschedule);

        const [optSvcsResult, , slotReschedulesResult] = await Promise.all([
          supabase
            .from('booking_optional_services')
            .select('*, tour_optional_services(name, is_refundable)')
            .in('booking_id', ids),
          loadPendingReschedules(bookingsWithReschedule),
          bookingsWithSlotReschedule.length > 0
            ? supabase
                .from('slot_reschedule_responses')
                .select(`
                  booking_id,
                  slot_reschedule_requests!inner(
                    id, resolution_type, reason, response_deadline, status,
                    target_slot_id,
                    tour_slots!slot_reschedule_requests_target_slot_id_fkey(slot_date, departure_time)
                  )
                `)
                .in('booking_id', bookingsWithSlotReschedule.map((b: any) => b.id))
                .eq('response', 'pending')
            : Promise.resolve({ data: [], error: null }),
        ]);

        if (optSvcsResult.data) {
          const grouped: Record<string, any[]> = {};
          for (const bos of optSvcsResult.data) {
            if (!grouped[bos.booking_id]) grouped[bos.booking_id] = [];
            grouped[bos.booking_id].push(bos);
          }
          setBookingOptionalServices(grouped);
        }

        // Load supplements for all bookings
        const { data: suppData } = await supabase
          .from('booking_supplements')
          .select(`*, tour_supplements(name, description, price, is_cancellable, requires_approval)`)
          .in('booking_id', ids)
          .order('requested_at', { ascending: false });

        if (suppData) {
          const groupedSupp: Record<string, any[]> = {};
          for (const bs of suppData) {
            if (!groupedSupp[bs.booking_id]) groupedSupp[bs.booking_id] = [];
            groupedSupp[bs.booking_id].push(bs);
          }
          setBookingSupplements(groupedSupp);
        }

        // Load available tour supplements for active bookings
        const activeTourIds = [...new Set(
          activeList.filter((b: any) => ['confirmed', 'pending'].includes(b.status)).map((b: any) => b.tour_id)
        )];
        if (activeTourIds.length > 0) {
          const { data: tourSupData } = await supabase
            .from('tour_supplements')
            .select('*')
            .in('tour_id', activeTourIds)
            .eq('is_active', true)
            .order('display_order');

          if (tourSupData) {
            const groupedTourSup: Record<string, any[]> = {};
            for (const ts of tourSupData) {
              if (!groupedTourSup[ts.tour_id]) groupedTourSup[ts.tour_id] = [];
              groupedTourSup[ts.tour_id].push(ts);
            }
            setTourSupplements(groupedTourSup);
          }
        }

        if (slotReschedulesResult.data && slotReschedulesResult.data.length > 0) {
          const slotReschedules: { [bookingId: string]: any } = {};
          for (const row of slotReschedulesResult.data) {
            slotReschedules[(row as any).booking_id] = row;
          }
          setPendingSlotReschedules(slotReschedules);
        }
      }

    } catch (err: any) {
      console.error('❌ Error cargando reservas:', err);
      setError(err.message || 'Error al cargar las reservas');
    } finally {
      setIsLoading(false);
    }
  };

  const fetchPastBookings = async () => {
    if (!user?.id || pastLoaded || isLoadingPast) return;
    setIsLoadingPast(true);
    try {
      const { data, error } = await getUserPastBookings(user.id);
      if (error) throw new Error(error.message);
      const completedList = data || [];

      // Merge completed bookings with expired-active ones already pre-loaded
      setPastBookings(prev => {
        const completedIds = new Set(completedList.map((x: any) => x.id));
        const expiredKept = prev.filter((x: any) => !completedIds.has(x.id));
        return [...completedList, ...expiredKept].sort((a: any, b: any) =>
          new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
        );
      });

      // Fetch optional services and supplements for the completed ones
      // (expired-active ones were already handled in the initial fetchBookings)
      if (completedList.length > 0) {
        const ids = completedList.map((b: any) => b.id);
        const [optRes, suppRes] = await Promise.all([
          supabase.from('booking_optional_services').select('*, tour_optional_services(name, is_refundable)').in('booking_id', ids),
          supabase.from('booking_supplements').select('*, tour_supplements(name, description, price, is_cancellable, requires_approval)').in('booking_id', ids).order('requested_at', { ascending: false }),
        ]);
        if (optRes.data) {
          const grouped: Record<string, any[]> = {};
          for (const bos of optRes.data) {
            if (!grouped[bos.booking_id]) grouped[bos.booking_id] = [];
            grouped[bos.booking_id].push(bos);
          }
          setPastOptionalServices(grouped);
        }
        if (suppRes.data) {
          const grouped: Record<string, any[]> = {};
          for (const bs of suppRes.data) {
            if (!grouped[bs.booking_id]) grouped[bs.booking_id] = [];
            grouped[bs.booking_id].push(bs);
          }
          setPastSupplements(grouped);
        }
      }
      setPastLoaded(true);
    } catch (err: any) {
      console.error('Error cargando reservas pasadas:', err);
    } finally {
      setIsLoadingPast(false);
    }
  };

  const fetchCancelledBookings = async () => {
    if (!user?.id || cancelledLoaded || isLoadingCancelled) return;
    setIsLoadingCancelled(true);
    try {
      const { data, error } = await getUserCancelledBookings(user.id);
      if (error) throw new Error(error.message);
      setCancelledBookings(data || []);
      setCancelledLoaded(true);
    } catch (err: any) {
      console.error('Error cargando reservas canceladas:', err);
    } finally {
      setIsLoadingCancelled(false);
    }
  };

  const loadPendingReschedules = async (bookingsWithReschedule: Booking[]) => {
    if (bookingsWithReschedule.length === 0) return;

    const results = await Promise.all(
      bookingsWithReschedule.map(booking =>
        supabase.rpc('get_pending_reschedule_for_booking', { p_booking_id: booking.id })
          .then(({ data, error }) => ({ bookingId: booking.id, data, error }))
          .catch(err => ({ bookingId: booking.id, data: null, error: err }))
      )
    );

    const reschedules: { [bookingId: string]: PendingReschedule } = {};
    for (const result of results) {
      if (!result.error && result.data) {
        reschedules[result.bookingId] = result.data;
      }
    }
    setPendingReschedules(reschedules);
  };

  const handleOpenSlotRescheduleModal = (booking: Booking, action: 'accept' | 'reject') => {
    const slotRescheduleInfo = pendingSlotReschedules[booking.id];
    if (!slotRescheduleInfo) {
      alert('No se encontro informacion del reagendamiento');
      return;
    }
    setSlotRescheduleModal({
      open: true,
      booking,
      slotRescheduleInfo,
      action,
      isProcessing: false,
      error: '',
      success: false,
    });
  };

  const handleRespondToSlotReschedule = async () => {
    if (!slotRescheduleModal.booking || !slotRescheduleModal.action) return;

    setSlotRescheduleModal(prev => ({ ...prev, isProcessing: true, error: '' }));

    try {
      const { data, error } = await supabase.functions.invoke('respond-to-slot-reschedule', {
        body: {
          booking_id: slotRescheduleModal.booking!.id,
          response: slotRescheduleModal.action === 'accept' ? 'accepted' : 'rejected',
        },
      });

      if (error) {
        const context = (error as any).context;
        if (context && typeof context.json === 'function') {
          const body = await context.json().catch(() => null);
          throw new Error(body?.error || error.message);
        }
        throw error;
      }
      if (!data?.success) throw new Error(data?.error || 'Error al procesar la respuesta');

      setSlotRescheduleModal(prev => ({ ...prev, isProcessing: false, success: true }));
      await fetchBookings();

      if (slotRescheduleModal.action === 'accept' && data?.needs_seat_reselection) {
        const booking = slotRescheduleModal.booking as any;
        const targetSlot = slotRescheduleModal.slotRescheduleInfo?.slot_reschedule_requests?.tour_slots;
        setTimeout(() => {
          setSlotRescheduleModal(prev => ({ ...prev, open: false }));
          setSeatReselectionModal({
            open: true,
            bookingId: booking.id,
            tourId: booking.tour_id,
            slotId: slotRescheduleModal.slotRescheduleInfo?.slot_reschedule_requests?.target_slot_id || '',
            travelersCount: booking.travelers_count || 1,
            previousSeats: booking.selected_seats || [],
            tourName: booking.tours?.name || booking.tour_name || '',
            newDate: targetSlot?.slot_date || data.new_date || '',
            newTime: targetSlot?.departure_time || data.new_time || '',
          });
        }, 1500);
      } else {
        setTimeout(() => {
          setSlotRescheduleModal(prev => ({ ...prev, open: false }));
        }, 3000);
      }
    } catch (err: any) {
      setSlotRescheduleModal(prev => ({
        ...prev,
        isProcessing: false,
        error: err.message || 'Error al procesar la respuesta',
      }));
    }
  };

  const handleOpenRescheduleModal = (booking: Booking, action: 'accept' | 'reject') => {
    const rescheduleInfo = pendingReschedules[booking.id];

    if (!rescheduleInfo) {
      alert('No se encontró información del reagendamiento');
      return;
    }

    setRescheduleModal({
      open: true,
      booking,
      rescheduleInfo,
      isLoading: false,
      isProcessing: false,
      error: '',
      success: false,
      action,
    });
  };

  const handleCloseRescheduleModal = () => {
    setRescheduleModal({
      open: false,
      booking: null,
      rescheduleInfo: null,
      isLoading: false,
      isProcessing: false,
      error: '',
      success: false,
      action: null,
    });
  };

  const handleRespondToReschedule = async () => {
    if (!rescheduleModal.booking || !rescheduleModal.action) return;

    setRescheduleModal(prev => ({
      ...prev,
      isProcessing: true,
      error: '',
    }));

    try {
      const session = await supabase.auth.getSession();
      const token = session.data.session?.access_token;

      const { data, error } = await supabase.functions.invoke('respond-to-reschedule', {
        body: {
          booking_id: rescheduleModal.booking.id,
          response: rescheduleModal.action === 'accept' ? 'accepted' : 'rejected'
        },
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (error) throw error;

      if (data?.success) {
        setRescheduleModal(prev => ({
          ...prev,
          isProcessing: false,
          success: true,
        }));

        await fetchBookings();

        setTimeout(() => {
          handleCloseRescheduleModal();
        }, 3000);
      } else {
        throw new Error(data?.error || 'Error al procesar la respuesta');
      }
    } catch (err: any) {
      console.error('Error responding to reschedule:', err);
      setRescheduleModal(prev => ({
        ...prev,
        isProcessing: false,
        error: err.message || 'Error al procesar la respuesta',
      }));
    }
  };

  const handleOpenReviewModal = async (booking: Booking) => {
    try {
      const { data: existingReview } = await supabase
        .from('agency_reviews')
        .select('*')
        .eq('booking_id', booking.id)
        .maybeSingle();

      setReviewModal({
        open: true,
        booking,
        existingReview
      });
    } catch (err) {
      console.error('Error checking for existing review:', err);
      setReviewModal({
        open: true,
        booking,
        existingReview: null
      });
    }
  };

  const handleCloseReviewModal = () => {
    setReviewModal({ open: false, booking: null, existingReview: null });
  };

  const handleReviewSuccess = () => {
    handleCloseReviewModal();
    fetchBookings();
  };

  const handleOpenTravelersModal = async (booking: Booking) => {
    try {
      const { data: travelers, error } = await supabase
        .from('booking_travelers')
        .select('*, is_cancelled, cancelled_at')
        .eq('booking_id', booking.id)
        .order('created_at', { ascending: true });

      if (error) throw error;

      setTravelersModal({
        open: true,
        booking,
        travelers: travelers || []
      });
    } catch (err) {
      console.error('Error loading travelers:', err);
      setTravelersModal({
        open: true,
        booking,
        travelers: []
      });
    }
  };

  const handleCloseTravelersModal = () => {
    setTravelersModal({ open: false, booking: null, travelers: [] });
  };

  const handleOpenCancellationModal = async (booking: Booking) => {
    if ((booking as any).is_no_show) {
      alert('Esta reserva ya está marcada como No Show y no puede ser cancelada.');
      return;
    }

    if ((booking as any).approval_status === 'rejected') {
      alert('Esta reserva fue rechazada por la agencia y no puede ser cancelada.');
      return;
    }

    const savedData = cancellationFormPersistence.loadFromStorage();

    setCancellationModal({
      open: true,
      booking,
      policy: null,
      isCalculating: true,
      isCancelling: false,
      cancellationReason: savedData?.cancellationReason || '',
      acceptPolicy: false,
      error: '',
      success: false,
    });

    cancellationFormPersistence.setIsRestoring(true);
    setTimeout(() => cancellationFormPersistence.setIsRestoring(false), 100);

    try {
      const { data: fullBooking, error } = await supabase
        .from('bookings')
        .select(`
          *,
          tours:tour_id(id, name, start_date, cancellation_not_allowed, tour_type, flexible_hours, flexible_refund_percentage, moderate_hours, moderate_refund_percentage)
        `)
        .eq('id', booking.id)
        .single();

      if (error || !fullBooking) {
        throw new Error('No se pudo cargar la información de la reserva');
      }

      const policy = await calculateCancellationPolicy(fullBooking);

      setCancellationModal(prev => ({
        ...prev,
        policy,
        isCalculating: false,
      }));
    } catch (err: any) {
      setCancellationModal(prev => ({
        ...prev,
        error: err.message || 'Error al calcular la política de cancelación',
        isCalculating: false,
      }));
    }
  };

  const handleCloseCancellationModal = () => {
    cancellationFormPersistence.clearStorage();
    setCancellationModal({
      open: false,
      booking: null,
      policy: null,
      isCalculating: false,
      isCancelling: false,
      cancellationReason: '',
      acceptPolicy: false,
      error: '',
      success: false,
    });
  };

  const handleCancelBooking = async () => {
    if (!cancellationModal.booking || !cancellationModal.policy || !user?.id) return;

    if (!cancellationModal.acceptPolicy) {
      setCancellationModal(prev => ({
        ...prev,
        error: 'Debes aceptar la política de cancelación para continuar',
      }));
      return;
    }

    setCancellationModal(prev => ({
      ...prev,
      isCancelling: true,
      error: '',
    }));

    try {
      const { data: result, error: fnError } = await supabase.functions.invoke(
        'process-traveler-cancellation',
        {
          body: {
            booking_id: cancellationModal.booking.id,
            cancellation_reason: cancellationModal.cancellationReason || undefined,
          },
        }
      );

      if (fnError) throw new Error(fnError.message);
      if (result?.error) throw new Error(result.error);

      cancellationFormPersistence.clearStorage();

      setCancellationModal(prev => ({
        ...prev,
        isCancelling: false,
        success: true,
      }));

      await fetchBookings();

      setTimeout(() => {
        handleCloseCancellationModal();
      }, 3000);
    } catch (err: any) {
      setCancellationModal(prev => ({
        ...prev,
        isCancelling: false,
        error: err.message || 'Error al procesar la cancelación',
      }));
    }
  };

  const getTourEffectiveDate = (booking: Booking): Date => {
    const tour = booking.tours as any;
    // Tours receptivos no tienen start_date; usar booking_date o selected_date
    const dateStr = tour?.start_date ?? (booking as any).selected_date ?? (booking as any).booking_date;
    return parseDateFromDB(dateStr ?? null);
  };

  const canCancelBooking = (booking: Booking) => {
    if (!booking.tours) return false;

    if (booking.status === 'cancelled') return false;
    if ((booking as any).is_no_show) return false;
    if ((booking as any).approval_status === 'rejected') return false;
    if (!['pending', 'confirmed'].includes(booking.status)) return false;

    const tourDate = getTourEffectiveDate(booking);
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    if (tourDate < today) return false;

    return true;
  };

  const canPartialCancelBooking = (booking: Booking) => {
    if (!booking.tours) return false;
    if (booking.status === 'cancelled') return false;
    if ((booking as any).is_no_show) return false;
    if ((booking as any).approval_status === 'rejected') return false;
    if (!['confirmed'].includes(booking.status)) return false;
    if (booking.payment_status !== 'succeeded') return false;

    const activeTravelersCount = (booking as any).active_travelers_count ?? booking.travelers_count;
    if (!activeTravelersCount || activeTravelersCount < 2) return false;

    const tourDate = getTourEffectiveDate(booking);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    if (tourDate < today) return false;

    return true;
  };

  const handleOpenPartialCancellationModal = async (booking: Booking) => {
    setPartialCancellationModal({
      open: true,
      booking,
      travelers: [],
      selectedIds: new Set(),
      policy: null,
      isCalculating: true,
      isCancelling: false,
      cancellationReason: '',
      acceptPolicy: false,
      error: '',
      success: false,
      refundAmount: 0,
    });

    try {
      const { data: travelersData, error } = await supabase
        .from('booking_travelers')
        .select('id, nombre, categoria_viajero, precio_aplicado, promo_discount_per_traveler')
        .eq('booking_id', booking.id)
        .eq('is_cancelled', false)
        .order('created_at', { ascending: true });

      if (error) throw error;

      setPartialCancellationModal(prev => ({
        ...prev,
        travelers: (travelersData || []).map((t: any) => ({
          id: t.id,
          nombre: t.nombre,
          categoria_viajero: t.categoria_viajero,
          precio_aplicado: Number(t.precio_aplicado),
          promo_discount_per_traveler: Number(t.promo_discount_per_traveler) || 0,
        })),
        isCalculating: false,
      }));
    } catch (err: any) {
      setPartialCancellationModal(prev => ({
        ...prev,
        error: err.message || 'Error al cargar los viajeros',
        isCalculating: false,
      }));
    }
  };

  const handleClosePartialCancellationModal = () => {
    setPartialCancellationModal({
      open: false,
      booking: null,
      travelers: [],
      selectedIds: new Set(),
      policy: null,
      isCalculating: false,
      isCancelling: false,
      cancellationReason: '',
      acceptPolicy: false,
      error: '',
      success: false,
      refundAmount: 0,
    });
  };

  const handleTogglePartialTraveler = async (travelerId: string) => {
    const newSelected = new Set(partialCancellationModal.selectedIds);
    if (newSelected.has(travelerId)) {
      newSelected.delete(travelerId);
    } else {
      newSelected.add(travelerId);
    }

    const selectedTravelers = partialCancellationModal.travelers.filter(t => newSelected.has(t.id));

    if (selectedTravelers.length === 0) {
      setPartialCancellationModal(prev => ({
        ...prev,
        selectedIds: newSelected,
        policy: null,
        refundAmount: 0,
      }));
      return;
    }

    setPartialCancellationModal(prev => ({ ...prev, selectedIds: newSelected, isCalculating: true }));

    try {
      const { data: fullBooking } = await supabase
        .from('bookings')
        .select('*, tours:tour_id(id, name, start_date, cancellation_not_allowed)')
        .eq('id', partialCancellationModal.booking!.id)
        .single();

      if (!fullBooking) throw new Error('No se pudo cargar la reserva');

      const policy = await calculatePartialCancellationPolicy(fullBooking, selectedTravelers);

      setPartialCancellationModal(prev => ({
        ...prev,
        policy,
        refundAmount: policy.refundAmountToTraveler,
        isCalculating: false,
      }));
    } catch (err: any) {
      setPartialCancellationModal(prev => ({
        ...prev,
        policy: null,
        refundAmount: 0,
        isCalculating: false,
        error: err.message || 'Error al calcular la política',
      }));
    }
  };

  const handleProcessPartialCancellation = async () => {
    if (!partialCancellationModal.booking || !user?.id) return;
    if (!partialCancellationModal.acceptPolicy) {
      setPartialCancellationModal(prev => ({
        ...prev,
        error: 'Debes aceptar la política de cancelación para continuar',
      }));
      return;
    }

    const selectedTravelers = partialCancellationModal.travelers.filter(
      t => partialCancellationModal.selectedIds.has(t.id)
    );

    if (selectedTravelers.length === 0) {
      setPartialCancellationModal(prev => ({ ...prev, error: 'Selecciona al menos un viajero para cancelar' }));
      return;
    }

    if (selectedTravelers.length >= partialCancellationModal.travelers.length) {
      setPartialCancellationModal(prev => ({
        ...prev,
        error: 'No puedes cancelar todos los viajeros. Usa la cancelación total de la reserva.',
      }));
      return;
    }

    setPartialCancellationModal(prev => ({ ...prev, isCancelling: true, error: '' }));

    try {
      const result = await processPartialCancellation(
        partialCancellationModal.booking.id,
        user.id,
        selectedTravelers,
        partialCancellationModal.cancellationReason || undefined
      );

      if (result.error) throw new Error(result.error);

      setPartialCancellationModal(prev => ({ ...prev, isCancelling: false, success: true }));
      await fetchBookings();

      setTimeout(() => {
        handleClosePartialCancellationModal();
      }, 3000);
    } catch (err: any) {
      setPartialCancellationModal(prev => ({
        ...prev,
        isCancelling: false,
        error: err.message || 'Error al procesar la cancelación parcial',
      }));
    }
  };

  const handleEditTravelers = (bookingId: string) => {
    navigate(`/booking-travelers/${bookingId}`);
  };

  const handleCompletePayment = async (booking: Booking) => {
    try {
      const { data: travelerData, error: travelerError } = await supabase
        .from('booking_travelers')
        .select('categoria_viajero, fecha_nacimiento, nombre')
        .eq('booking_id', booking.id);

      if (!travelerError && travelerData && travelerData.length > 0) {
        const tourStartDate = (booking as any).tours?.start_date || (booking as any).booking_date;
        const { isValid, errors } = validateAllTravelers(travelerData, tourStartDate);
        if (!isValid) {
          const firstErrorIdx = errors.findIndex(e => e !== '');
          const travelerName = travelerData[firstErrorIdx]?.nombre || `Viajero ${firstErrorIdx + 1}`;
          setPaymentValidationError({
            open: true,
            bookingId: booking.id,
            message: `La fecha de nacimiento de "${travelerName}" no corresponde con su categoría de viajero. Debes corregir los datos antes de pagar.`,
          });
          return;
        }
      }

      const { data: walletData } = await supabase
        .from('toursred_cash_wallets')
        .select('balance')
        .eq('user_id', user?.id)
        .maybeSingle();

      const walletBalance = walletData?.balance || 0;

      setPaymentModal({
        open: true,
        booking: booking,
        walletBalance: walletBalance,
        toursRedCashToUse: 0,
        isProcessing: false,
        selectedProvider: 'stripe',
      });
    } catch (err: any) {
      console.error('Error al abrir modal de pago:', err);
      alert(`Error: ${err.message}`);
    }
  };

  const handleProceedWithPayment = async () => {
    const { booking, toursRedCashToUse } = paymentModal;

    if (!booking) return;

    try {
      setPaymentModal(prev => ({ ...prev, isProcessing: true }));

      const { data: { session } } = await supabase.auth.getSession();

      if (!session) {
        throw new Error('No hay sesión activa');
      }

      // Actualizar la reserva con el ToursRed Cash aplicado
      if (toursRedCashToUse > 0) {
        const { error: updateError } = await supabase
          .from('bookings')
          .update({
            toursred_cash_used: toursRedCashToUse,
          })
          .eq('id', booking.id);

        if (updateError) {
          throw new Error(`Error al actualizar la reserva: ${updateError.message}`);
        }
      }

      // Calcular el monto a cobrar después de aplicar puntos ya usados y ToursRed Cash
      const originalAmount = booking.user_payment || booking.deposit_amount || 0;
      const pointsAlreadyUsed = ((booking.points_used || 0) / 100);
      const amountToCharge = originalAmount - pointsAlreadyUsed - toursRedCashToUse;

      // Si el monto es 0 o menor, confirmar directamente
      if (amountToCharge <= 0) {
        const { error: confirmError } = await supabase
          .from('bookings')
          .update({
            payment_status: 'succeeded',
            status: 'confirmed',
            payment_method: 'toursred_cash',
            updated_at: new Date().toISOString(),
          })
          .eq('id', booking.id);

        if (confirmError) {
          throw new Error(`Error al confirmar la reserva: ${confirmError.message}`);
        }

        // Descontar ToursRed Cash del monedero
        if (toursRedCashToUse > 0) {
          const { error: walletError } = await supabase.rpc(
            'update_wallet_balance',
            {
              p_user_id: user?.id,
              p_amount: -toursRedCashToUse,
              p_type: 'debit',
              p_description: `Pago de reserva para ${booking.tours?.name}`,
              p_reference_id: booking.id,
              p_reference_type: 'booking'
            }
          );

          if (walletError) {
            throw new Error(`Error al procesar el pago con ToursRed Cash: ${walletError.message}`);
          }
        }

        // Enviar notificación por email a la agencia
        try {
          await fetch(
            `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/send-booking-request-notification`,
            {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${session.access_token}`,
              },
              body: JSON.stringify({ booking_id: booking.id }),
            }
          );
        } catch (emailError) {
          console.error('Error enviando notificación a la agencia:', emailError);
        }

        // Cerrar modal y recargar reservas
        setPaymentModal({
          open: false,
          booking: null,
          walletBalance: 0,
          toursRedCashToUse: 0,
          isProcessing: false,
          selectedProvider: 'stripe',
        });

        fetchBookings();
        alert('¡Pago completado exitosamente con ToursRed Cash!');
        return;
      }

      const { selectedProvider } = paymentModal;

      if (selectedProvider === 'mercadopago') {
        const mpResponse = await fetch(
          `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/create-mercadopago-preference`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${session.access_token}`,
            },
            body: JSON.stringify({
              bookingId: booking.id,
              customerEmail: user?.email,
              amount: amountToCharge,
              description: `Depósito para ${booking.tours?.name || 'Tour'}`,
              context: 'booking',
            }),
          }
        );

        if (!mpResponse.ok) {
          const errorData = await mpResponse.json();
          throw new Error(errorData.error || 'Error al crear preferencia de MercadoPago');
        }

        const mpResult = await mpResponse.json();
        if (!mpResult.success) throw new Error(mpResult.error || 'Error al crear preferencia de MercadoPago');
        if (mpResult.preference_id && mpResult.public_key) {
          setPaymentModal({ open: false, booking: null, walletBalance: 0, toursRedCashToUse: 0, isProcessing: false, selectedProvider: 'stripe' });
          setMpBrickModal({ open: true, preferenceId: mpResult.preference_id, publicKey: mpResult.public_key, bookingId: booking.id, amount: amountToCharge });
        } else if (mpResult.url) {
          window.location.href = mpResult.url;
        } else {
          throw new Error('No se recibió la información de MercadoPago');
        }
      } else if (selectedProvider === 'paypal') {
        const ppResponse = await fetch(
          `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/create-paypal-order`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${session.access_token}`,
            },
            body: JSON.stringify({
              bookingId: booking.id,
              amount: amountToCharge,
              description: `Depósito para ${booking.tours?.name || 'Tour'}`,
              context: 'booking',
            }),
          }
        );

        if (!ppResponse.ok) {
          const errorData = await ppResponse.json();
          throw new Error(errorData.error || 'Error al crear orden de PayPal');
        }

        const ppResult = await ppResponse.json();
        if (!ppResult.success) throw new Error(ppResult.error || 'Error al crear orden de PayPal');
        if (ppResult.url) {
          window.location.href = ppResult.url;
        } else {
          throw new Error('No se recibió la URL de PayPal');
        }
      } else {
        // Stripe
        const response = await fetch(
          `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/create-checkout-session`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${session.access_token}`,
            },
            body: JSON.stringify({
              bookingId: booking.id,
              amount: amountToCharge,
              currency: 'mxn',
              description: `Pago de reserva - ${booking.tours?.name || 'Tour'}`,
              success_url: `${window.location.origin}/booking-success?booking_id=${booking.id}`,
              cancel_url: `${window.location.origin}/traveler/bookings`,
              toursRedCashUsed: toursRedCashToUse,
            }),
          }
        );

        if (!response.ok) {
          const errorText = await response.text();
          console.error('Error response:', errorText);
          throw new Error(`Error al crear la sesión de pago: ${errorText}`);
        }

        const data = await response.json();

        if (data.url) {
          window.location.href = data.url;
        } else {
          throw new Error('No se recibió URL de checkout');
        }
      }
    } catch (err: any) {
      console.error('Error al proceder al pago:', err);
      alert(`Error al proceder al pago: ${err.message}`);
      setPaymentModal(prev => ({ ...prev, isProcessing: false }));
    }
  };

  const getCategoryLabel = (categoria: string): string => {
    const labels: Record<string, string> = {
      adulto: 'Adulto',
      nino: 'Niño',
      infante: 'Infante',
      adulto_mayor: 'Adulto Mayor',
      mascota: 'Mascota',
    };
    return labels[categoria] || categoria;
  };

  // Helper function to format dates consistently
  const formatDate = (dateString: string) => {
    try {
      // Extract date part if it's a timestamp (contains 'T')
      let datePart = dateString.includes('T')
        ? dateString.split('T')[0]
        : dateString;

      // Parse directly without timezone conversions
      const [year, month, day] = datePart.split('-').map(Number);
      return `${String(day).padStart(2, '0')}/${String(month).padStart(2, '0')}/${year}`;
    } catch (error) {
      console.error('Error formatting date:', dateString, error);
      return dateString;
    }
  };

  const formatFullDate = (dateString: string) => {
    try {
      // Extract date part if it's a timestamp (contains 'T')
      const datePart = dateString.includes('T')
        ? dateString.split('T')[0]
        : dateString;
      const date = parseDateFromDB(datePart);
      return format(date, 'EEEE, d \'de\' MMMM \'de\' yyyy');
    } catch (error) {
      console.error('Error formatting full date:', dateString, error);
      return format(new Date(dateString), 'dd/MM/yyyy');
    }
  };

  const getPaymentMethodLabel = (method: string | null | undefined): string => {
    if (!method) return 'N/A';

    const labels: Record<string, string> = {
      'card': 'Tarjeta',
      'oxxo': 'OXXO',
      'customer_balance': 'Transferencia Bancaria',
      'toursred_cash': 'ToursRed Cash',
    };

    return labels[method] || method;
  };

  const getStatusBadge = (status: string, paymentStatus?: string, approvalStatus?: string, isNoShow?: boolean) => {
    let statusText = '';
    let statusClass = '';

    if (isNoShow) {
      statusText = 'No Show';
      statusClass = 'bg-gray-900 text-white';
    } else if (approvalStatus === 'rejected') {
      statusText = 'Rechazada';
      statusClass = 'bg-red-100 text-red-800';
    } else if (approvalStatus === 'pending') {
      statusText = 'Pendiente de Aprobación';
      statusClass = 'bg-yellow-100 text-yellow-800';
    } else {
      switch (status) {
        case 'pending':
          statusText = paymentStatus === 'succeeded' ? 'Confirmando' : 'Pendiente de Pago';
          statusClass = 'bg-yellow-100 text-yellow-800';
          break;
        case 'confirmed':
          statusText = 'Confirmada';
          statusClass = 'bg-green-100 text-green-800';
          break;
        case 'completed':
          statusText = 'Completada';
          statusClass = 'bg-blue-100 text-blue-800';
          break;
        case 'cancelled':
          statusText = 'Cancelada';
          statusClass = 'bg-red-100 text-red-800';
          break;
        default:
          statusText = status;
          statusClass = 'bg-gray-100 text-gray-800';
      }
    }

    return (
      <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${statusClass}`}>
        {statusText}
      </span>
    );
  };

  const getPaymentStatusBadge = (paymentStatus?: string) => {
    if (!paymentStatus) return null;

    let statusText = '';
    let statusClass = '';

    switch (paymentStatus) {
      case 'succeeded':
        statusText = 'Pagado';
        statusClass = 'bg-green-100 text-green-800';
        break;
      case 'pending':
        statusText = 'Pendiente';
        statusClass = 'bg-yellow-100 text-yellow-800';
        break;
      case 'processing':
        statusText = 'Procesando';
        statusClass = 'bg-blue-100 text-blue-800';
        break;
      case 'failed':
        statusText = 'Falló';
        statusClass = 'bg-red-100 text-red-800';
        break;
      case 'canceled':
        statusText = 'Cancelado';
        statusClass = 'bg-gray-100 text-gray-800';
        break;
      default:
        return null;
    }

    return (
      <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${statusClass} ml-2`}>
        {statusText}
      </span>
    );
  };

  const handleOpenSupplementRequest = async (booking: Booking, supplement: any) => {
    const { data: walletData } = await supabase
      .from('toursred_cash_wallets')
      .select('balance')
      .eq('user_id', user!.id)
      .maybeSingle();

    const { data: pointsData } = await supabase
      .from('toursred_points_wallets')
      .select('balance')
      .eq('user_id', user!.id)
      .maybeSingle();

    const { data: capData } = await supabase
      .rpc('get_supplement_available_capacity', { p_supplement_id: supplement.id });

    setSupplementPaymentModal({
      open: true,
      supplement,
      booking,
      quantity: 1,
      availableCapacity: capData ?? 0,
      isProcessing: false,
      error: '',
      walletBalance: walletData?.balance ?? 0,
      pointsBalance: pointsData?.balance ?? 0,
      pointsValueMxn: Math.floor((pointsData?.balance ?? 0) / 100),
      selectedMethod: 'stripe',
      cashToUse: 0,
    });
  };

  const handlePayExistingSupplement = async (bs: any, booking: Booking) => {
    const { data: walletData } = await supabase
      .from('toursred_cash_wallets')
      .select('balance')
      .eq('user_id', user!.id)
      .maybeSingle();

    const { data: pointsData } = await supabase
      .from('toursred_points_wallets')
      .select('balance')
      .eq('user_id', user!.id)
      .maybeSingle();

    setSupplementsModal(prev => ({ ...prev, open: false }));
    setSupplementDirectPayModal({
      open: true,
      bookingSupplement: bs,
      booking,
      isProcessing: false,
      error: '',
      walletBalance: walletData?.balance ?? 0,
      pointsBalance: pointsData?.balance ?? 0,
      pointsValueMxn: Math.floor((pointsData?.balance ?? 0) / 100),
      selectedMethod: 'stripe',
    });
  };

  const handleProcessDirectSupplementPayment = async () => {
    const { bookingSupplement, booking, selectedMethod } = supplementDirectPayModal;
    if (!bookingSupplement || !booking) return;

    setSupplementDirectPayModal(prev => ({ ...prev, isProcessing: true, error: '' }));
    try {
      const { data: { session } } = await supabase.auth.getSession();

      if (selectedMethod === 'mercadopago') {
        const totalAmount = Number(bookingSupplement.unit_price || 0) * Number(bookingSupplement.quantity || 1);
        const mpRes = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/create-mercadopago-preference`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${session?.access_token}`,
            'Apikey': import.meta.env.VITE_SUPABASE_ANON_KEY,
          },
          body: JSON.stringify({
            bookingId: booking.id,
            supplementId: bookingSupplement.id,
            customerEmail: (await supabase.auth.getUser()).data.user?.email,
            amount: totalAmount,
            description: `Suplemento: ${bookingSupplement.tour_supplements?.name || 'Suplemento'}`,
            context: 'supplement',
          }),
        });
        const mpData = await mpRes.json();
        if (!mpRes.ok || !mpData.success) throw new Error(mpData.error || 'Error al crear preferencia de MercadoPago');
        setSupplementDirectPayModal(prev => ({ ...prev, open: false, isProcessing: false }));
        setMpSupplementBrickModal({ open: true, preferenceId: mpData.preference_id, publicKey: mpData.public_key, supplementId: bookingSupplement.id, amount: totalAmount });
        return;
      }

      if (selectedMethod === 'paypal') {
        const totalAmount = Number(bookingSupplement.unit_price || 0) * Number(bookingSupplement.quantity || 1);
        const ppRes = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/create-paypal-order`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${session?.access_token}`,
            'Apikey': import.meta.env.VITE_SUPABASE_ANON_KEY,
          },
          body: JSON.stringify({
            bookingId: bookingSupplement.id,
            amount: totalAmount,
            description: `Suplemento: ${bookingSupplement.tour_supplements?.name || 'Suplemento'}`,
            context: 'supplement',
          }),
        });
        const ppData = await ppRes.json();
        if (!ppRes.ok || !ppData.success) throw new Error(ppData.error || 'Error al crear orden de PayPal');
        setSupplementDirectPayModal(prev => ({ ...prev, open: false, isProcessing: false }));
        window.location.href = ppData.url;
        return;
      }

      const payRes = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/process-supplement-payment`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session?.access_token}`,
          'Apikey': import.meta.env.VITE_SUPABASE_ANON_KEY,
        },
        body: JSON.stringify({
          booking_supplement_id: bookingSupplement.id,
          payment_method: selectedMethod,
        }),
      });
      const payData = await payRes.json();
      if (!payRes.ok && !payData.url) throw new Error(payData.error || 'Error procesando pago');

      if (payData.url) {
        window.location.href = payData.url;
        return;
      }

      setSupplementDirectPayModal(prev => ({ ...prev, open: false }));
      await fetchBookings();
    } catch (err: any) {
      setSupplementDirectPayModal(prev => ({ ...prev, isProcessing: false, error: err.message }));
    }
  };

  const handleOpenSupplementsModal = (booking: Booking) => {
    const hasRequested = (bookingSupplements[booking.id] || []).length > 0;
    const activeTab = hasRequested ? 'mis_suplementos' : 'disponibles';
    setSupplementsModal({ open: true, booking, activeTab });
  };

  const handleOpenExtrasModal = async (booking: Booking) => {
    setExtrasModal(prev => ({ ...prev, open: true, booking, isLoading: true, activeTab: 'servicios' }));
    try {
      const [optSvcsRes, bosRes] = await Promise.all([
        supabase
          .from('tour_optional_services')
          .select('id, name, description, price_per_person, max_capacity, is_active, display_order')
          .eq('tour_id', booking.tour_id)
          .eq('is_active', true)
          .order('display_order'),
        supabase
          .from('booking_optional_services')
          .select('id, tour_optional_service_id, is_cancelled')
          .eq('booking_id', booking.id),
      ]);

      const existingBosIds = new Set(
        (bosRes.data || [])
          .filter((bos: any) => !bos.is_cancelled)
          .map((bos: any) => bos.tour_optional_service_id)
      );

      const alreadyBought = (booking as any).travel_insurance_included === true;
      let insuranceCost = Number((booking as any).travel_insurance_cost || 0);
      let insurancePricePerDay = 0;

      const activityType = (booking.tours as any)?.activity_type;
      const isStandaloneActivity = ['transport', 'experience', 'ticket'].includes(activityType);

      // Si el booking no tiene costo de seguro guardado, calcularlo desde platform_settings
      if (!alreadyBought && insuranceCost === 0) {
        const { data: settingsRow } = await supabase
          .from('platform_settings')
          .select('travel_insurance_price_per_day_per_traveler')
          .limit(1)
          .maybeSingle();
        const pricePerDay = Number(settingsRow?.travel_insurance_price_per_day_per_traveler || 0);
        insurancePricePerDay = pricePerDay;
        if (pricePerDay > 0) {
          if (isStandaloneActivity) {
            // Para actividades standalone, el costo inicial es por 1 dia (el viajero elige cuantos)
            insuranceCost = Math.round(pricePerDay * 1 * Math.max(1, booking.travelers_count || 1) * 100) / 100;
          } else {
            const startDate = booking.selected_date || booking.tours?.start_date;
            const endDate = booking.tours?.end_date;
            let tourDays = 1;
            if (startDate && endDate) {
              try {
                const start = new Date(startDate.includes('T') ? startDate : startDate + 'T00:00:00');
                const end = new Date(endDate.includes('T') ? endDate : endDate + 'T00:00:00');
                const diff = Math.round((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24));
                tourDays = Math.max(1, diff + 1);
              } catch {
                tourDays = 1;
              }
            }
            insuranceCost = Math.round(pricePerDay * tourDays * Math.max(1, booking.travelers_count || 1) * 100) / 100;
          }
        }
      }

      setExtrasModal(prev => ({
        ...prev,
        isLoading: false,
        tourOptionalServices: optSvcsRes.data || [],
        existingBosIds,
        insuranceAlreadyBought: alreadyBought,
        insuranceCost,
        insurancePricePerDay,
        insuranceDays: 1,
        insuranceConditionsAccepted: false,
        activeTab: (optSvcsRes.data || []).filter(
          (s: any) => !existingBosIds.has(s.id)
        ).length > 0 ? 'servicios' : 'seguro',
      }));
    } catch {
      setExtrasModal(prev => ({ ...prev, isLoading: false }));
    }
  };

  const handleOpenExtrasPayment = async (
    type: 'optional_service' | 'insurance',
    item: any,
    booking: Booking
  ) => {
    const [walletRes, pointsRes] = await Promise.all([
      supabase.from('toursred_cash_wallets').select('balance').eq('user_id', user!.id).maybeSingle(),
      supabase.from('toursred_points_wallets').select('balance').eq('user_id', user!.id).maybeSingle(),
    ]);
    setExtrasModal(prev => ({ ...prev, open: false }));
    setExtrasPaymentModal({
      open: true,
      type,
      item,
      quantity: 1,
      booking,
      isProcessing: false,
      error: '',
      walletBalance: walletRes.data?.balance ?? 0,
      pointsBalance: pointsRes.data?.balance ?? 0,
      pointsValueMxn: Math.floor((pointsRes.data?.balance ?? 0) / 100),
      selectedMethod: 'stripe',
    });
  };

  const handleProcessExtrasPayment = async () => {
    const { type, item, quantity, booking, selectedMethod } = extrasPaymentModal;
    if (!type || !item || !booking) return;

    setExtrasPaymentModal(prev => ({ ...prev, isProcessing: true, error: '' }));
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const headers = {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${session?.access_token}`,
        'Apikey': import.meta.env.VITE_SUPABASE_ANON_KEY,
      };

      const isStandaloneInsurance = type === 'insurance' &&
        ['transport', 'experience', 'ticket'].includes((booking.tours as any)?.activity_type);
      const body = type === 'optional_service'
        ? { booking_id: booking.id, type: 'optional_service', tour_optional_service_id: item.id, quantity, payment_method: selectedMethod }
        : {
            booking_id: booking.id,
            type: 'insurance',
            payment_method: selectedMethod,
            ...(isStandaloneInsurance ? { insurance_days: extrasModal.insuranceDays } : {}),
          };

      if (selectedMethod === 'mercadopago') {
        const amount = type === 'optional_service'
          ? Number(item.price_per_person) * quantity
          : extrasModal.insuranceCost || Number((booking as any).travel_insurance_cost || 0);
        const description = type === 'optional_service' ? `Servicio: ${item.name}` : 'Seguro de viaje';

        const mpRes = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/create-mercadopago-preference`, {
          method: 'POST', headers,
          body: JSON.stringify({
            bookingId: booking.id,
            customerEmail: (await supabase.auth.getUser()).data.user?.email,
            amount,
            description,
            context: 'extras',
            extrasBody: body,
          }),
        });
        const mpData = await mpRes.json();
        if (!mpRes.ok || !mpData.success) throw new Error(mpData.error || 'Error al crear preferencia de MercadoPago');
        setExtrasPaymentModal(prev => ({ ...prev, open: false, isProcessing: false }));
        window.location.href = mpData.url || mpData.init_point;
        return;
      }

      if (selectedMethod === 'paypal') {
        const amount = type === 'optional_service'
          ? Number(item.price_per_person) * quantity
          : extrasModal.insuranceCost || Number((booking as any).travel_insurance_cost || 0);
        const ppRes = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/create-paypal-order`, {
          method: 'POST', headers,
          body: JSON.stringify({ bookingId: booking.id, amount, description: type === 'optional_service' ? `Servicio: ${item.name}` : 'Seguro de viaje', context: 'extras', extrasBody: body }),
        });
        const ppData = await ppRes.json();
        if (!ppRes.ok || !ppData.success) throw new Error(ppData.error || 'Error al crear orden de PayPal');
        setExtrasPaymentModal(prev => ({ ...prev, open: false, isProcessing: false }));
        window.location.href = ppData.url;
        return;
      }

      const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/purchase-post-booking-extras`, {
        method: 'POST', headers, body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Error al procesar el pago');

      if (data.url) {
        window.location.href = data.url;
        return;
      }

      setExtrasPaymentModal(prev => ({ ...prev, open: false }));
      await fetchBookings();
    } catch (err: any) {
      setExtrasPaymentModal(prev => ({ ...prev, isProcessing: false, error: err.message }));
    }
  };

  const handleRequestSupplement = async () => {
    const { supplement, booking, quantity, selectedMethod, cashToUse } = supplementPaymentModal;
    if (!supplement || !booking) return;

    setSupplementPaymentModal(prev => ({ ...prev, isProcessing: true, error: '' }));
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/request-supplement`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session?.access_token}`,
          'Apikey': import.meta.env.VITE_SUPABASE_ANON_KEY,
        },
        body: JSON.stringify({ booking_id: booking.id, tour_supplement_id: supplement.id, quantity }),
      });
      const data = await res.json();

      // 409 means an active request already exists — route to its payment flow
      if (res.status === 409 && data.existing_id &&
          (data.existing_status === 'pending_payment' || data.existing_status === 'approved')) {
        const existingBs = (bookingSupplements[booking.id] || []).find((bs: any) => bs.id === data.existing_id)
          || { id: data.existing_id, status: data.existing_status, quantity, unit_price: supplement.price, tour_supplements: supplement };
        setSupplementPaymentModal(prev => ({ ...prev, open: false }));
        await handlePayExistingSupplement(existingBs, booking);
        return;
      }

      if (!res.ok) throw new Error(data.error || 'Error solicitando suplemento');

      if (data.status === 'pending_payment' || data.status === 'approved') {
        if (selectedMethod === 'mercadopago') {
          const totalAmount = Number(supplement.price || 0) * quantity;
          const mpRes = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/create-mercadopago-preference`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${session?.access_token}`,
              'Apikey': import.meta.env.VITE_SUPABASE_ANON_KEY,
            },
            body: JSON.stringify({
              bookingId: booking.id,
              supplementId: data.booking_supplement_id,
              customerEmail: (await supabase.auth.getUser()).data.user?.email,
              amount: totalAmount,
              description: `Suplemento: ${supplement.name || 'Suplemento'}`,
              context: 'supplement',
            }),
          });
          const mpData = await mpRes.json();
          if (!mpRes.ok || !mpData.success) throw new Error(mpData.error || 'Error al crear preferencia de MercadoPago');
          setSupplementPaymentModal(prev => ({ ...prev, open: false, isProcessing: false }));
          setMpSupplementBrickModal({ open: true, preferenceId: mpData.preference_id, publicKey: mpData.public_key, supplementId: data.booking_supplement_id, amount: totalAmount });
          return;
        }

        if (selectedMethod === 'paypal') {
          const totalAmount = Number(supplement.price || 0) * quantity;
          const ppRes = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/create-paypal-order`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${session?.access_token}`,
              'Apikey': import.meta.env.VITE_SUPABASE_ANON_KEY,
            },
            body: JSON.stringify({
              bookingId: data.booking_supplement_id,
              amount: totalAmount,
              description: `Suplemento: ${supplement.name || 'Suplemento'}`,
              context: 'supplement',
            }),
          });
          const ppData = await ppRes.json();
          if (!ppRes.ok || !ppData.success) throw new Error(ppData.error || 'Error al crear orden de PayPal');
          setSupplementPaymentModal(prev => ({ ...prev, open: false, isProcessing: false }));
          window.location.href = ppData.url;
          return;
        }

        // Proceed to process payment for this supplement
        const payRes = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/process-supplement-payment`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${session?.access_token}`,
            'Apikey': import.meta.env.VITE_SUPABASE_ANON_KEY,
          },
          body: JSON.stringify({
            booking_supplement_id: data.booking_supplement_id,
            payment_method: selectedMethod,
            toursred_cash_amount: selectedMethod === 'toursred_cash' ? cashToUse : 0,
          }),
        });
        const payData = await payRes.json();
        if (!payRes.ok && !payData.url) throw new Error(payData.error || 'Error procesando pago');

        if (payData.url) {
          window.location.href = payData.url;
          return;
        }
      }

      setSupplementPaymentModal(prev => ({ ...prev, open: false }));
      await fetchBookings();
    } catch (err: any) {
      setSupplementPaymentModal(prev => ({ ...prev, isProcessing: false, error: err.message }));
    }
  };

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
          <h1 className="text-3xl font-bold">Mis Reservas</h1>
          <p className="text-gray-600 mt-1">
            {bookingTab === 'activas' && (bookings.length === 0
              ? 'No tienes reservas activas'
              : `${bookings.length} reserva${bookings.length === 1 ? '' : 's'} activa${bookings.length === 1 ? '' : 's'}`)}
            {bookingTab === 'pasadas' && (isLoadingPast ? 'Cargando...' : `${pastBookings.length} reserva${pastBookings.length === 1 ? '' : 's'} pasada${pastBookings.length === 1 ? '' : 's'}`)}
            {bookingTab === 'canceladas' && (isLoadingCancelled ? 'Cargando...' : `${cancelledBookings.length} reserva${cancelledBookings.length === 1 ? '' : 's'} cancelada${cancelledBookings.length === 1 ? '' : 's'}`)}
          </p>
        </div>
      </div>

      {/* Pestanas */}
      <div className="flex border-b border-gray-200 mb-6">
        <button
          onClick={() => setBookingTab('activas')}
          className={`px-5 py-3 text-sm font-medium transition-colors relative ${bookingTab === 'activas' ? 'text-primary-600 border-b-2 border-primary-600' : 'text-gray-500 hover:text-gray-800'}`}
        >
          Activas
          {bookings.length > 0 && (
            <span className="ml-2 inline-flex items-center justify-center px-2 py-0.5 text-xs font-bold rounded-full bg-primary-100 text-primary-700">
              {bookings.length}
            </span>
          )}
        </button>
        <button
          onClick={() => { setBookingTab('pasadas'); fetchPastBookings(); }}
          className={`px-5 py-3 text-sm font-medium transition-colors relative ${bookingTab === 'pasadas' ? 'text-primary-600 border-b-2 border-primary-600' : 'text-gray-500 hover:text-gray-800'}`}
        >
          Pasadas
          {pastBookings.length > 0 && (
            <span className="ml-2 inline-flex items-center justify-center px-2 py-0.5 text-xs font-bold rounded-full bg-gray-100 text-gray-600">
              {pastBookings.length}
            </span>
          )}
        </button>
        <button
          onClick={() => { setBookingTab('canceladas'); fetchCancelledBookings(); }}
          className={`px-5 py-3 text-sm font-medium transition-colors relative ${bookingTab === 'canceladas' ? 'text-primary-600 border-b-2 border-primary-600' : 'text-gray-500 hover:text-gray-800'}`}
        >
          Canceladas
          {cancelledLoaded && cancelledBookings.length > 0 && (
            <span className="ml-2 inline-flex items-center justify-center px-2 py-0.5 text-xs font-bold rounded-full bg-red-100 text-red-600">
              {cancelledBookings.length}
            </span>
          )}
        </button>
      </div>

      {error && (
        <div className="mb-6 bg-error-50 text-error-600 p-4 rounded-md flex items-start">
          <AlertCircle className="h-5 w-5 mr-2 mt-0.5 flex-shrink-0" />
          <div>
            <p className="font-medium">Error al cargar reservas</p>
            <p className="text-sm">{error}</p>
            <button 
              onClick={fetchBookings}
              className="text-sm underline mt-1 hover:no-underline"
            >
              Intentar de nuevo
            </button>
          </div>
        </div>
      )}

      {bookingTab === 'activas' && (
        bookings.length === 0 && !error ? (
          <div className="bg-white rounded-lg shadow-md p-8 text-center">
            <Calendar className="h-12 w-12 text-gray-400 mx-auto mb-4" />
            <h3 className="text-xl font-semibold mb-2">No tienes reservas activas</h3>
            <p className="text-gray-600 mb-6">
              Cuando reserves un tour, aparecerá aquí con todos los detalles.
            </p>
            <Link to="/tours" className="btn btn-primary">
              Explorar Tours
            </Link>
          </div>
        ) : (
          <div className="space-y-6">
            {bookings.map((booking) => (
              <div
                key={booking.id}
                id={`booking-${booking.id}`}
                className={`bg-white rounded-lg shadow-md overflow-hidden transition-all duration-700 ${highlightedBookingId === booking.id ? 'ring-4 ring-blue-400 ring-offset-2' : ''}`}
              >
              <div className="flex flex-col lg:flex-row">
                {/* Tour Image */}
                <div className="lg:w-1/3">
                  <div className="relative h-48 lg:h-full">
                    <img
                      src={booking.tours?.image_url || 'https://images.pexels.com/photos/1271619/pexels-photo-1271619.jpeg'}
                      alt={booking.tours?.name || 'Tour'}
                      className="w-full h-full object-cover"
                    />
                    <div className="absolute top-4 left-4">
                      {getStatusBadge(booking.status, booking.payment_status, (booking as any).approval_status, (booking as any).is_no_show)}
                      {getPaymentStatusBadge(booking.payment_status)}
                    </div>
                  </div>
                </div>

                {/* Booking Details */}
                <div className="lg:w-2/3 p-6">
                  <div className="flex justify-between items-start mb-4">
                    <div>
                      <h3 className="text-xl font-semibold mb-2">
                        {booking.tours?.name || 'Tour sin nombre'}
                      </h3>
                      <div className="flex items-center text-gray-600 mb-2">
                        <MapPin className="h-4 w-4 mr-1" />
                        <span>{booking.tours?.destination || 'Destino no especificado'}</span>
                      </div>
                      <div className="flex items-center text-gray-600">
                        <Calendar className="h-4 w-4 mr-1" />
                        <span>
                          Fecha del Tour: {(booking as any).selected_date ? formatDate((booking as any).selected_date) : formatDate(booking.booking_date)}
                          {(booking as any).selected_time && (
                            <span className="ml-1 font-medium text-gray-800">
                              a las {(booking as any).selected_time.slice(0, 5)}
                            </span>
                          )}
                        </span>
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="text-sm text-gray-500">Código de Reserva</div>
                      <div className="text-lg font-bold text-blue-600 tracking-wide">
                        {booking.booking_code}
                      </div>
                    </div>
                  </div>

                  {(booking as any).has_partial_cancellations && (
                    <div className="mb-3 inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-orange-100 text-orange-800 text-xs font-medium">
                      <UserMinus className="h-3 w-3" />
                      Cancelación parcial aplicada &mdash; {(booking as any).active_travelers_count ?? booking.travelers_count} de {booking.travelers_count} viajeros activos
                    </div>
                  )}

                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-4">
                    <div className="flex items-center">
                      <Users className="h-4 w-4 text-gray-400 mr-2" />
                      <div>
                        <div className="text-sm text-gray-500">Viajeros</div>
                        <div className="font-medium">
                          {(booking as any).has_partial_cancellations
                            ? `${(booking as any).active_travelers_count ?? booking.travelers_count} activos`
                            : booking.travelers_count}
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center">
                      <DollarSign className="h-4 w-4 text-gray-400 mr-2" />
                      <div>
                        <div className="text-sm text-gray-500">Total Pagado</div>
                        <div className="font-medium">{formatCurrencyMXN(booking.user_payment ?? booking.deposit_amount ?? 0)}</div>
                      </div>
                    </div>

                    <div className="flex items-center">
                      <Clock className="h-4 w-4 text-gray-400 mr-2" />
                      <div>
                        <div className="text-sm text-gray-500">Fecha de Reserva</div>
                        <div className="font-medium">{formatDate(booking.created_at)}</div>
                      </div>
                    </div>

                    <div className="flex items-center">
                      <DollarSign className="h-4 w-4 text-gray-400 mr-2" />
                      <div>
                        <div className="text-sm text-gray-500">Método de Pago</div>
                        <div className="font-medium">{getPaymentMethodLabel((booking as any).payment_method)}</div>
                      </div>
                    </div>
                  </div>

                  {/* Pickup & Language Info - Receptivo tours */}
                  {((booking as any).pickup_type || (booking as any).selected_language) && (
                    <div className="bg-teal-50 border border-teal-200 rounded-lg p-4 mb-4">
                      <h4 className="font-medium mb-3 flex items-center gap-2 text-teal-800">
                        <Car className="h-4 w-4" />
                        Traslado e Idioma
                      </h4>
                      <div className="space-y-2">
                        {(booking as any).pickup_type && (
                          <div className="flex items-start gap-2">
                            <MapPin className="h-4 w-4 text-teal-600 mt-0.5 flex-shrink-0" />
                            <div>
                              <span className="text-xs text-teal-700 font-medium">Tipo de traslado: </span>
                              <span className="text-sm text-gray-800">
                                {(booking as any).pickup_type === 'meeting_point'
                                  ? 'Me presento en el punto de encuentro'
                                  : 'Recogida en hotel solicitada'}
                              </span>
                            </div>
                          </div>
                        )}
                        {(booking as any).pickup_type === 'pickup' && (booking as any).pickup_zone_name && (
                          <div className="flex items-start gap-2">
                            <Car className="h-4 w-4 text-teal-600 mt-0.5 flex-shrink-0" />
                            <div>
                              <span className="text-xs text-teal-700 font-medium">Zona / Hotel: </span>
                              <span className="text-sm text-gray-800">{(booking as any).pickup_zone_name}</span>
                              {(bookingOptionalServices[booking.id] || []).filter((bos: any) => bos.service_kind === 'pickup').map((bos: any) => (
                                <span key={bos.id} className="ml-2 text-xs bg-teal-100 text-teal-700 px-1.5 py-0.5 rounded">
                                  +${bos.total_paid || bos.subtotal} {bos.quantity > 1 ? '/persona' : '/reserva'}
                                </span>
                              ))}
                            </div>
                          </div>
                        )}
                        {(booking as any).selected_language && (
                          <div className="flex items-start gap-2">
                            <Globe className="h-4 w-4 text-teal-600 mt-0.5 flex-shrink-0" />
                            <div>
                              <span className="text-xs text-teal-700 font-medium">Idioma del tour: </span>
                              <span className="text-sm text-gray-800 capitalize">{(booking as any).selected_language}</span>
                              {(bookingOptionalServices[booking.id] || []).filter((bos: any) => bos.service_kind === 'language').map((bos: any) => (
                                <span key={bos.id} className="ml-2 text-xs bg-teal-100 text-teal-700 px-1.5 py-0.5 rounded">
                                  +${bos.total_paid || bos.subtotal} {bos.quantity > 1 ? '/persona' : 'fijo'}
                                </span>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  )}

                  {/* Optional Services */}
                  {bookingOptionalServices[booking.id] && bookingOptionalServices[booking.id].length > 0 && (
                    <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 mb-4">
                      <h4 className="font-medium mb-2 flex items-center gap-2 text-amber-800">
                        <span>Servicios Adicionales Contratados</span>
                      </h4>
                      <div className="space-y-2">
                        {bookingOptionalServices[booking.id].map((bos: any) => (
                          <div key={bos.id} className="flex items-center justify-between text-sm">
                            <div className="flex items-center gap-2">
                              <span className={bos.is_cancelled ? 'line-through text-gray-400' : 'text-gray-800'}>
                                {bos.description || bos.tour_optional_services?.name || 'Servicio opcional'} × {bos.quantity}
                              </span>
                              {!bos.is_cancelled && !bos.tour_optional_services?.is_refundable && bos.tour_optional_services && (
                                <span className="text-xs bg-orange-100 text-orange-700 px-1.5 py-0.5 rounded">No reembolsable</span>
                              )}
                              {bos.is_cancelled && (
                                <span className="text-xs bg-gray-100 text-gray-500 px-1.5 py-0.5 rounded">
                                  {bos.cancelled_by_agency ? 'Cancelado por agencia' : 'Cancelado'}
                                </span>
                              )}
                            </div>
                            <div className="text-right">
                              <span className={`font-medium ${bos.is_cancelled ? 'text-gray-400' : 'text-amber-700'}`}>
                                {formatCurrencyMXN(Number(bos.subtotal))}
                              </span>
                              {bos.is_cancelled && bos.refund_amount > 0 && (
                                <span className="block text-xs text-green-600">
                                  Reembolso: {formatCurrencyMXN(Number(bos.refund_amount))}
                                </span>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Selected Seats */}
                  {(booking.tours as any)?.vehicle_map_type && (booking as any).selected_seats && (booking as any).selected_seats.length > 0 && !(booking as any).needs_seat_reselection && (
                    <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-4">
                      <h4 className="font-medium mb-2 flex items-center gap-2 text-blue-800">
                        <Users className="h-4 w-4" />
                        Asientos Asignados
                      </h4>
                      <div className="flex flex-wrap gap-2">
                        {[...(booking as any).selected_seats].sort((a: number, b: number) => a - b).map((seat: number) => (
                          <span
                            key={seat}
                            className="inline-flex items-center justify-center w-9 h-9 rounded-lg bg-blue-600 text-white text-sm font-bold shadow-sm"
                          >
                            {seat}
                          </span>
                        ))}
                      </div>
                      <p className="text-xs text-blue-700 mt-2">
                        {(booking as any).selected_seats.length === 1
                          ? '1 asiento reservado'
                          : `${(booking as any).selected_seats.length} asientos reservados`}
                      </p>
                    </div>
                  )}

                  {/* Payment Summary */}
                  <div className="bg-gray-50 rounded-lg p-4 mb-4">
                    <h4 className="font-medium mb-2">Resumen de Pago</h4>
                    <div className="grid grid-cols-2 gap-4 text-sm">
                      <div>
                        <div className="text-gray-500">Precio Total del Tour:</div>
                        <div className="font-medium">{formatCurrencyMXN(booking.total_price ?? 0)}</div>
                      </div>
                      <div>
                        <div className="text-gray-500">Depósito Pagado:</div>
                        <div className="font-medium">{formatCurrencyMXN(booking.deposit_amount ?? 0)}</div>
                      </div>
                      {Number(booking.service_charge) > 0 && (
                        <div>
                          <div className="text-gray-500">Cargo por Servicio:</div>
                          <div className="font-medium">{formatCurrencyMXN(booking.service_charge)}</div>
                        </div>
                      )}
                      <div>
                        <div className="text-gray-500">Método de Pago:</div>
                        <div className="font-medium">{getPaymentMethodLabel((booking as any).payment_method)}</div>
                      </div>
                      <div>
                        <div className="text-gray-500">Saldo Restante:</div>
                        <div className="font-medium">
                          {formatCurrencyMXN(
                            (booking as any).has_payment_plan
                              ? ((booking as any).payment_plan_total || 0) - ((booking as any).payment_plan_paid || 0)
                              : (booking.total_price || 0) - (booking.deposit_amount || 0)
                          )}
                        </div>
                      </div>
                      {(booking as any).paypal_transaction_id && (
                        <div className="col-span-2">
                          <div className="text-gray-500">ID de Transacción PayPal:</div>
                          <div className="font-medium font-mono text-xs tracking-wide">{(booking as any).paypal_transaction_id}</div>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Actions */}
                  <div className="flex flex-wrap gap-3">
                    <Link
                      to={`/tours/${booking.tours?.slug || booking.tour_id}`}
                      className="btn btn-outline flex items-center justify-center"
                    >
                      <Eye className="h-4 w-4 mr-2" />
                      Ver Tour
                    </Link>

                    <button
                      onClick={() => handleOpenTravelersModal(booking)}
                      className="btn btn-outline flex items-center justify-center"
                    >
                      <UserCheck className="h-4 w-4 mr-2" />
                      Ver Acompañantes
                    </button>

                    {(booking.status === 'confirmed' || booking.status === 'pending') &&
                     ((bookingSupplements[booking.id] || []).length > 0 ||
                      (tourSupplements[booking.tour_id] || []).length > 0) && (() => {
                      const activeCount = (bookingSupplements[booking.id] || []).filter(
                        (bs: any) => ['pending_approval', 'approved', 'pending_payment', 'paid'].includes(bs.status)
                      ).length;
                      const hasPendingPayment = (bookingSupplements[booking.id] || []).some(
                        (bs: any) => bs.status === 'pending_payment' || bs.status === 'approved'
                      );
                      return (
                        <button
                          onClick={() => handleOpenSupplementsModal(booking)}
                          className={`btn flex items-center justify-center gap-2 relative ${hasPendingPayment ? 'bg-amber-500 hover:bg-amber-600 text-white' : 'btn-outline'}`}
                        >
                          <Tag className="h-4 w-4" />
                          Suplementos
                          {activeCount > 0 && (
                            <span className={`inline-flex items-center justify-center w-5 h-5 text-xs font-bold rounded-full ${hasPendingPayment ? 'bg-white text-amber-600' : 'bg-teal-600 text-white'}`}>
                              {activeCount}
                            </span>
                          )}
                        </button>
                      );
                    })()}

                    {(booking.status === 'confirmed' || booking.status === 'pending') && (
                      <button
                        onClick={() => handleOpenExtrasModal(booking)}
                        className="btn btn-outline flex items-center justify-center gap-2"
                      >
                        <ShoppingBag className="h-4 w-4" />
                        Extras
                      </button>
                    )}

                    {booking.status === 'pending' &&
                     booking.payment_status !== 'succeeded' &&
                     (booking as any).approval_status === 'approved' && (
                      <button
                        onClick={() => handleCompletePayment(booking)}
                        className="btn btn-primary flex items-center justify-center"
                      >
                        <DollarSign className="h-4 w-4 mr-2" />
                        Completar Pago
                      </button>
                    )}

                    {(booking.status === 'confirmed' || booking.status === 'completed') && (
                      <button
                        onClick={() => handleOpenReviewModal(booking)}
                        className="btn btn-primary flex items-center justify-center"
                      >
                        <Star className="h-4 w-4 mr-2" />
                        Dejar Reseña
                      </button>
                    )}

                    {canCancelBooking(booking) && (
                      <button
                        onClick={() => handleOpenCancellationModal(booking)}
                        className="btn btn-outline border-red-300 text-red-700 hover:bg-red-50 flex items-center justify-center"
                      >
                        <XCircle className="h-4 w-4 mr-2" />
                        Cancelar Reserva
                      </button>
                    )}

                    {canPartialCancelBooking(booking) && (
                      <button
                        onClick={() => handleOpenPartialCancellationModal(booking)}
                        className="btn btn-outline border-orange-300 text-orange-700 hover:bg-orange-50 flex items-center justify-center"
                      >
                        <UserMinus className="h-4 w-4 mr-2" />
                        Cancelar Viajeros
                      </button>
                    )}

                    {booking.agencies?.name && (
                      <div className="text-sm text-gray-600 flex items-center">
                        <span>Operado por: <strong>{booking.agencies.name}</strong></span>
                      </div>
                    )}
                  </div>

                  {/* Plan de Pagos */}
                  {((booking as any).has_payment_plan || (booking as any).payment_plan_status === 'active') && (
                    <div className="mt-4">
                      <PaymentPlanCalendar bookingId={booking.id} />
                    </div>
                  )}

                  {/* Reschedule Banner */}
                  {booking.has_pending_reschedule && pendingReschedules[booking.id] && (
                    <div className="mt-4 p-4 bg-gradient-to-r from-orange-50 to-amber-50 border-2 border-orange-400 rounded-lg">
                      <div className="flex items-start gap-3">
                        <CalendarX className="h-6 w-6 text-orange-600 flex-shrink-0 mt-1" />
                        <div className="flex-1">
                          <h4 className="font-bold text-orange-900 text-lg mb-2">⚠️ Tour Reagendado - Respuesta Requerida</h4>
                          <p className="text-sm text-orange-800 mb-3">
                            <strong>Motivo:</strong> {pendingReschedules[booking.id].reschedule.reason}
                          </p>

                          <div className="grid grid-cols-2 gap-4 mb-4 bg-white/50 p-3 rounded-md">
                            <div>
                              <div className="text-xs text-gray-600 mb-1">Fecha Original:</div>
                              <div className="font-semibold text-gray-900 line-through">
                                {formatDate(pendingReschedules[booking.id].reschedule.original_start_date)}
                              </div>
                            </div>
                            <div>
                              <div className="text-xs text-gray-600 mb-1">Nueva Fecha:</div>
                              <div className="font-semibold text-green-700">
                                {formatDate(pendingReschedules[booking.id].reschedule.new_start_date)}
                              </div>
                            </div>
                          </div>

                          <div className="bg-yellow-50 border border-yellow-200 rounded-md p-3 mb-4">
                            <p className="text-xs text-yellow-900">
                              <strong>Fecha límite para responder:</strong>{' '}
                              {formatFullDate(pendingReschedules[booking.id].reschedule.response_deadline)}
                            </p>
                            <p className="text-xs text-yellow-800 mt-1">
                              Si no respondes antes de esta fecha, se aceptará automáticamente la nueva fecha.
                            </p>
                          </div>

                          <div className="flex gap-3">
                            <button
                              onClick={() => handleOpenRescheduleModal(booking, 'accept')}
                              className="flex-1 px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg font-semibold flex items-center justify-center gap-2 transition-colors"
                            >
                              <Check className="h-4 w-4" />
                              Acepto Nueva Fecha
                            </button>
                            <button
                              onClick={() => handleOpenRescheduleModal(booking, 'reject')}
                              className="flex-1 px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg font-semibold flex items-center justify-center gap-2 transition-colors"
                            >
                              <X className="h-4 w-4" />
                              No Puedo Asistir
                            </button>
                          </div>

                          <p className="text-xs text-gray-600 mt-3 italic">
                            💰 Si no puedes asistir, recibirás un reembolso del 100% sin penalización en tu monedero ToursRed Cash.
                          </p>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Reschedule Response Status */}
                  {booking.reschedule_response && (
                    <div className={`mt-4 p-3 rounded-md border ${
                      booking.reschedule_response === 'accepted' ? 'bg-green-50 border-green-200' :
                      booking.reschedule_response === 'rejected' ? 'bg-red-50 border-red-200' :
                      'bg-blue-50 border-blue-200'
                    }`}>
                      <p className={`text-sm ${
                        booking.reschedule_response === 'accepted' ? 'text-green-800' :
                        booking.reschedule_response === 'rejected' ? 'text-red-800' :
                        'text-blue-800'
                      }`}>
                        <strong>
                          {booking.reschedule_response === 'accepted' && '✓ Has aceptado la nueva fecha'}
                          {booking.reschedule_response === 'rejected' && '✗ Rechazaste el reagendamiento y recibiste reembolso'}
                          {booking.reschedule_response === 'auto_accepted' && '↻ La nueva fecha fue aceptada automaticamente'}
                          {booking.reschedule_response === 'auto_cancelled' && '✗ Reserva cancelada automaticamente - reembolso procesado en ToursRed Cash'}
                        </strong>
                        {booking.reschedule_responded_at && (
                          <span className="block mt-1 text-xs">
                            Fecha de respuesta: {formatDate(booking.reschedule_responded_at)}
                          </span>
                        )}
                      </p>
                    </div>
                  )}

                  {/* Slot Reschedule Pending Alert */}
                  {(booking as any).has_pending_slot_reschedule && (() => {
                    const slotInfo = pendingSlotReschedules[booking.id];
                    const newSlot = slotInfo?.slot_reschedule_requests?.tour_slots;
                    const reason = slotInfo?.slot_reschedule_requests?.reason;
                    const deadline = slotInfo?.slot_reschedule_requests?.response_deadline;
                    const newDate = newSlot?.slot_date;
                    const newTime = newSlot?.departure_time;
                    return (
                      <div className="mt-4 p-4 bg-gradient-to-r from-blue-50 to-sky-50 border-2 border-blue-400 rounded-lg">
                        <div className="flex items-start gap-3">
                          <Clock className="h-6 w-6 text-blue-600 flex-shrink-0 mt-1" />
                          <div className="flex-1">
                            <h4 className="font-bold text-blue-900 text-base mb-1">Cambio de horario pendiente - Respuesta requerida</h4>
                            {reason && (
                              <p className="text-sm text-blue-800 mb-3">
                                <strong>Motivo:</strong> {reason}
                              </p>
                            )}

                            <div className="grid grid-cols-2 gap-4 mb-3 bg-white/60 p-3 rounded-md">
                              <div>
                                <div className="text-xs text-gray-600 mb-1">Horario anterior:</div>
                                <div className="font-semibold text-gray-900 line-through text-sm">
                                  {(booking as any).selected_date || booking.booking_date}
                                  {(booking as any).selected_time && ` ${(booking as any).selected_time.slice(0, 5)}`}
                                </div>
                              </div>
                              <div>
                                <div className="text-xs text-gray-600 mb-1">Nuevo horario:</div>
                                {newDate ? (
                                  <div className="font-semibold text-green-700 text-sm">
                                    {newDate}{newTime && ` ${newTime.slice(0, 5)}`}
                                  </div>
                                ) : (
                                  <div className="text-sm text-gray-500 italic">Cargando...</div>
                                )}
                              </div>
                            </div>

                            {deadline && (
                              <div className="bg-yellow-50 border border-yellow-200 rounded-md p-3 mb-4">
                                <p className="text-xs text-yellow-900">
                                  <strong>Plazo para responder:</strong>{' '}
                                  {new Date(deadline).toLocaleString('es-MX', { dateStyle: 'medium', timeStyle: 'short' })}
                                </p>
                                <p className="text-xs text-yellow-800 mt-1">
                                  Si no respondes antes de ese plazo, tu reserva sera cancelada automaticamente con reembolso completo en ToursRed Cash.
                                </p>
                              </div>
                            )}

                            <div className="flex gap-3">
                              <button
                                onClick={() => handleOpenSlotRescheduleModal(booking as any, 'accept')}
                                disabled={!slotInfo}
                                className="flex-1 px-4 py-2 bg-green-600 hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-lg font-semibold flex items-center justify-center gap-2 transition-colors text-sm"
                              >
                                <Check className="h-4 w-4" />
                                Acepto el nuevo horario
                              </button>
                              <button
                                onClick={() => handleOpenSlotRescheduleModal(booking as any, 'reject')}
                                disabled={!slotInfo}
                                className="flex-1 px-4 py-2 bg-red-600 hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-lg font-semibold flex items-center justify-center gap-2 transition-colors text-sm"
                              >
                                <X className="h-4 w-4" />
                                No puedo asistir
                              </button>
                            </div>

                            <p className="text-xs text-gray-600 mt-3 italic">
                              Si rechazas, recibiras un reembolso del 100% en tu ToursRed Cash de forma inmediata.
                            </p>
                          </div>
                        </div>
                      </div>
                    );
                  })()}

                  {/* Seat Reselection Required */}
                  {(booking as any).needs_seat_reselection && booking.status !== 'cancelled' && (
                    <div className="mt-4 p-4 bg-amber-50 border-2 border-amber-400 rounded-xl">
                      <div className="flex items-start gap-3">
                        <AlertCircle className="h-5 w-5 text-amber-600 flex-shrink-0 mt-0.5" />
                        <div className="flex-1">
                          <p className="font-semibold text-amber-900 text-sm">Debes seleccionar nuevos asientos</p>
                          <p className="text-xs text-amber-800 mt-1 mb-3">
                            Tus asientos anteriores ({((booking as any).previous_selected_seats || []).sort((a: number, b: number) => a - b).join(', ')}) ya no estan disponibles en el nuevo horario. Por favor elige nuevos asientos.
                          </p>
                          <button
                            onClick={() => {
                              const b = booking as any;
                              setSeatReselectionModal({
                                open: true,
                                bookingId: b.id,
                                tourId: b.tour_id,
                                slotId: b.slot_id || '',
                                travelersCount: b.travelers_count || 1,
                                previousSeats: b.previous_selected_seats || [],
                                tourName: b.tours?.name || b.tour_name || '',
                                newDate: b.selected_date || '',
                                newTime: b.selected_time || '',
                              });
                            }}
                            className="px-4 py-2 bg-amber-600 hover:bg-amber-700 text-white rounded-lg text-sm font-semibold transition-colors flex items-center gap-2"
                          >
                            <MapPin className="h-4 w-4" />
                            Seleccionar asientos
                          </button>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Slot Reschedule Response Status */}
                  {!(booking as any).has_pending_slot_reschedule && (booking as any).slot_reschedule_response && !(booking as any).needs_seat_reselection && (
                    <div className={`mt-4 p-3 rounded-md border ${
                      (booking as any).slot_reschedule_response === 'accepted' ? 'bg-green-50 border-green-200' :
                      (booking as any).slot_reschedule_response === 'rejected' ? 'bg-red-50 border-red-200' :
                      'bg-blue-50 border-blue-200'
                    }`}>
                      <p className={`text-sm ${
                        (booking as any).slot_reschedule_response === 'accepted' ? 'text-green-800' :
                        (booking as any).slot_reschedule_response === 'rejected' ? 'text-red-800' :
                        'text-blue-800'
                      }`}>
                        <strong>
                          {(booking as any).slot_reschedule_response === 'accepted' && '✓ Aceptaste el cambio de horario'}
                          {(booking as any).slot_reschedule_response === 'rejected' && '✗ Rechazaste el cambio de horario y recibiste reembolso'}
                          {(booking as any).slot_reschedule_response === 'auto_accepted' && '↻ El cambio de horario fue aceptado automaticamente'}
                          {(booking as any).slot_reschedule_response === 'auto_cancelled' && '✗ Reserva cancelada automaticamente - reembolso en ToursRed Cash'}
                        </strong>
                      </p>
                    </div>
                  )}

                  {/* Important Notes */}
                  {(booking as any).is_no_show && (
                    <div className="mt-4 p-3 bg-gray-900 border border-gray-800 rounded-md">
                      <p className="text-sm text-white">
                        <strong>⚠️ Marcada como No Show.</strong> Esta reserva fue marcada como No Show porque no te presentaste al tour. Esta acción ha sido registrada en tu historial y puede afectar futuras reservas.
                        {(booking as any).no_show_marked_at && (
                          <span className="block mt-2 text-gray-300">
                            <strong>Fecha:</strong> {formatDate((booking as any).no_show_marked_at)}
                          </span>
                        )}
                      </p>
                    </div>
                  )}

                  {(booking as any).approval_status === 'pending' && (
                    <div className="mt-4 p-3 bg-yellow-50 border border-yellow-200 rounded-md">
                      <p className="text-sm text-yellow-800">
                        <strong>Pendiente de aprobación.</strong> La agencia está revisando tu solicitud. Te notificaremos cuando tomen una decisión.
                      </p>
                    </div>
                  )}

                  {(booking as any).approval_status === 'rejected' && (
                    <div className="mt-4 p-3 bg-red-50 border border-red-200 rounded-md">
                      <p className="text-sm text-red-800">
                        <strong>Reserva rechazada.</strong> La agencia no pudo aprobar tu solicitud.
                        {(booking as any).approval_notes && (
                          <span className="block mt-2">
                            <strong>Motivo:</strong> {(booking as any).approval_notes}
                          </span>
                        )}
                      </p>
                    </div>
                  )}

                  {(booking as any).approval_status === 'approved' && booking.status === 'pending' && booking.payment_status !== 'succeeded' && (
                    <div className="mt-4 p-3 bg-green-50 border border-green-200 rounded-md">
                      <p className="text-sm text-green-800">
                        <strong>¡Solicitud aprobada!</strong> Tu reserva ha sido aprobada por la agencia. Ahora puedes completar el pago.
                      </p>
                    </div>
                  )}

                  {booking.status === 'confirmed' && (
                    <div className="mt-4 p-3 bg-green-50 border border-green-200 rounded-md">
                      <p className="text-sm text-green-800">
                        <strong>¡Reserva confirmada!</strong> La agencia se pondrá en contacto contigo para coordinar los detalles del viaje.
                      </p>
                    </div>
                  )}

                  {booking.status === 'pending' && booking.payment_status === 'succeeded' && (
                    <div className="mt-4 p-3 bg-blue-50 border border-blue-200 rounded-md">
                      <p className="text-sm text-blue-800">
                        <strong>Pago recibido.</strong> Tu reserva está siendo procesada y será confirmada pronto.
                      </p>
                    </div>
                  )}

                  {booking.status === 'cancelled' && (
                    <div className="mt-4 p-3 bg-red-50 border border-red-200 rounded-md">
                      <p className="text-sm text-red-800">
                        <strong>Reserva cancelada.</strong> Si tienes preguntas, contacta a nuestro equipo de soporte.
                      </p>
                    </div>
                  )}
                </div>
              </div>
            </div>
          ))}
          </div>
        )
      )}

      {/* Pestaña: Pasadas */}
      {bookingTab === 'pasadas' && (
        isLoadingPast ? (
          <div className="flex justify-center py-12">
            <div className="animate-spin rounded-full h-10 w-10 border-t-2 border-b-2 border-primary-600"></div>
          </div>
        ) : pastBookings.length === 0 ? (
          <div className="bg-white rounded-lg shadow-md p-8 text-center">
            <Calendar className="h-12 w-12 text-gray-300 mx-auto mb-4" />
            <h3 className="text-xl font-semibold mb-2 text-gray-600">Sin historial de reservas</h3>
            <p className="text-gray-500">Aquí aparecerán los tours que ya hayan concluido.</p>
          </div>
        ) : (
          <div className="space-y-4">
            {pastBookings.map((booking) => (
              <div
                key={booking.id}
                id={`booking-${booking.id}`}
                className={`bg-white rounded-lg shadow-sm border border-gray-100 overflow-hidden opacity-80 transition-all duration-700 ${highlightedBookingId === booking.id ? 'ring-4 ring-blue-400 ring-offset-2' : ''}`}
              >
                <div className="flex flex-col lg:flex-row">
                  <div className="lg:w-1/4">
                    <div className="relative h-36 lg:h-full">
                      <img
                        src={booking.tours?.image_url || 'https://images.pexels.com/photos/1271619/pexels-photo-1271619.jpeg'}
                        alt={booking.tours?.name || 'Tour'}
                        className="w-full h-full object-cover grayscale-[30%]"
                      />
                      <div className="absolute top-3 left-3">
                        {getStatusBadge(booking.status, booking.payment_status, (booking as any).approval_status, (booking as any).is_no_show)}
                      </div>
                    </div>
                  </div>
                  <div className="lg:w-3/4 p-5">
                    <div className="flex justify-between items-start mb-3">
                      <div>
                        <h3 className="text-lg font-semibold text-gray-700">{booking.tours?.name || 'Tour sin nombre'}</h3>
                        <div className="flex items-center text-gray-500 text-sm mt-1 gap-3">
                          <span className="flex items-center gap-1"><MapPin className="h-3.5 w-3.5" />{booking.tours?.destination || 'Destino no especificado'}</span>
                          <span className="flex items-center gap-1"><Calendar className="h-3.5 w-3.5" />{(booking as any).selected_date ? formatDate((booking as any).selected_date) : formatDate(booking.booking_date)}</span>
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="text-xs text-gray-400">Código</div>
                        <div className="text-sm font-bold text-blue-500 tracking-wide">{booking.booking_code}</div>
                      </div>
                    </div>
                    <div className="flex items-center gap-6 text-sm text-gray-600 mb-4">
                      <span className="flex items-center gap-1"><Users className="h-3.5 w-3.5 text-gray-400" />{booking.travelers_count} viajero{booking.travelers_count !== 1 ? 's' : ''}</span>
                      <span className="flex items-center gap-1"><DollarSign className="h-3.5 w-3.5 text-gray-400" />{formatCurrencyMXN(booking.user_payment ?? booking.deposit_amount ?? 0)}</span>
                      {booking.agencies?.name && <span className="text-gray-500">Operado por: <strong>{booking.agencies.name}</strong></span>}
                    </div>
                    {(pastOptionalServices[booking.id] || []).length > 0 && (
                      <div className="flex flex-wrap gap-2 mb-3">
                        {pastOptionalServices[booking.id].map((bos: any) => !bos.is_cancelled && (
                          <span key={bos.id} className="text-xs bg-amber-50 text-amber-700 border border-amber-200 px-2 py-0.5 rounded-full">
                            {bos.tour_optional_services?.name} ×{bos.quantity}
                          </span>
                        ))}
                      </div>
                    )}
                    <div className="flex flex-wrap gap-2">
                      <Link to={`/tours/${booking.tours?.slug || booking.tour_id}`} className="btn btn-outline btn-sm flex items-center gap-1 text-sm py-1.5 px-3">
                        <Eye className="h-3.5 w-3.5" />Ver Tour
                      </Link>
                      <button onClick={() => handleOpenTravelersModal(booking)} className="btn btn-outline btn-sm flex items-center gap-1 text-sm py-1.5 px-3">
                        <UserCheck className="h-3.5 w-3.5" />Ver Acompañantes
                      </button>
                      {(booking.status === 'confirmed' || booking.status === 'completed') && (
                        <button onClick={() => handleOpenReviewModal(booking)} className="btn btn-primary btn-sm flex items-center gap-1 text-sm py-1.5 px-3">
                          <Star className="h-3.5 w-3.5" />Dejar Reseña
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )
      )}

      {/* Pestaña: Canceladas */}
      {bookingTab === 'canceladas' && (
        isLoadingCancelled ? (
          <div className="flex justify-center py-12">
            <div className="animate-spin rounded-full h-10 w-10 border-t-2 border-b-2 border-primary-600"></div>
          </div>
        ) : cancelledBookings.length === 0 ? (
          <div className="bg-white rounded-lg shadow-md p-8 text-center">
            <XCircle className="h-12 w-12 text-gray-300 mx-auto mb-4" />
            <h3 className="text-xl font-semibold mb-2 text-gray-600">Sin reservas canceladas</h3>
            <p className="text-gray-500">Aquí aparecerán las reservas que hayas cancelado.</p>
          </div>
        ) : (
          <div className="space-y-4">
            {cancelledBookings.map((booking) => (
              <div
                key={booking.id}
                id={`booking-${booking.id}`}
                className={`bg-white rounded-lg shadow-sm border border-red-50 overflow-hidden opacity-70 transition-all duration-700 ${highlightedBookingId === booking.id ? 'ring-4 ring-blue-400 ring-offset-2' : ''}`}
              >
                <div className="flex flex-col lg:flex-row">
                  <div className="lg:w-1/4">
                    <div className="relative h-36 lg:h-full">
                      <img
                        src={booking.tours?.image_url || 'https://images.pexels.com/photos/1271619/pexels-photo-1271619.jpeg'}
                        alt={booking.tours?.name || 'Tour'}
                        className="w-full h-full object-cover grayscale"
                      />
                      <div className="absolute top-3 left-3">
                        {getStatusBadge(booking.status, booking.payment_status, (booking as any).approval_status, (booking as any).is_no_show)}
                      </div>
                    </div>
                  </div>
                  <div className="lg:w-3/4 p-5">
                    <div className="flex justify-between items-start mb-3">
                      <div>
                        <h3 className="text-lg font-semibold text-gray-500">{booking.tours?.name || 'Tour sin nombre'}</h3>
                        <div className="flex items-center text-gray-400 text-sm mt-1 gap-3">
                          <span className="flex items-center gap-1"><MapPin className="h-3.5 w-3.5" />{booking.tours?.destination || 'Destino no especificado'}</span>
                          <span className="flex items-center gap-1"><Calendar className="h-3.5 w-3.5" />{(booking as any).selected_date ? formatDate((booking as any).selected_date) : formatDate(booking.booking_date)}</span>
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="text-xs text-gray-400">Código</div>
                        <div className="text-sm font-bold text-gray-400 tracking-wide">{booking.booking_code}</div>
                      </div>
                    </div>
                    <div className="flex items-center gap-6 text-sm text-gray-400 mb-3">
                      <span className="flex items-center gap-1"><Users className="h-3.5 w-3.5" />{booking.travelers_count} viajero{booking.travelers_count !== 1 ? 's' : ''}</span>
                      <span className="flex items-center gap-1"><DollarSign className="h-3.5 w-3.5" />{formatCurrencyMXN(booking.user_payment ?? booking.deposit_amount ?? 0)}</span>
                    </div>
                    <div className="p-3 bg-red-50 border border-red-100 rounded-md text-sm text-red-600">
                      <strong>Reserva cancelada.</strong> Si tienes preguntas, contacta a nuestro equipo de soporte.
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )
      )}

      {/* Travelers Modal */}
      {travelersModal.open && travelersModal.booking && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-lg max-w-4xl w-full max-h-[90vh] overflow-y-auto">
            <div className="p-6">
              <div className="flex justify-between items-start mb-4">
                <div>
                  <h2 className="text-2xl font-bold mb-2">Información de Acompañantes</h2>
                  <p className="text-gray-600">
                    {travelersModal.booking.tours?.name}
                  </p>
                  <p className="text-sm text-gray-500 font-mono">
                    Código de Reserva: {travelersModal.booking.booking_code}
                  </p>
                </div>
                <button
                  onClick={handleCloseTravelersModal}
                  className="text-gray-400 hover:text-gray-600"
                >
                  <X className="h-6 w-6" />
                </button>
              </div>

              {!!(travelersModal.booking as any).tours?.name_changes_not_allowed &&
                (travelersModal.booking.payment_status === 'succeeded' ||
                  travelersModal.booking.status === 'confirmed' ||
                  travelersModal.booking.status === 'completed') && (
                <div className="bg-red-50 border border-red-200 rounded-lg p-3 mb-4">
                  <div className="flex items-center">
                    <Lock className="h-4 w-4 text-red-600 mr-2 flex-shrink-0" />
                    <p className="text-sm text-red-700">
                      Este tour no permite cambios de nombre después del pago. Si necesitas hacer un cambio, contacta directamente a la agencia.
                    </p>
                  </div>
                </div>
              )}

              {travelersModal.travelers.length === 0 ? (
                <div className="text-center py-8">
                  <Users className="h-12 w-12 text-gray-400 mx-auto mb-4" />
                  <p className="text-gray-500">No hay información de acompañantes disponible</p>
                </div>
              ) : (
                <div className="space-y-4">
                  {travelersModal.travelers.map((traveler, index) => (
                    <div key={traveler.id} className={`border rounded-lg p-4 transition-colors ${(traveler as any).is_cancelled ? 'border-red-200 bg-red-50 opacity-75' : 'border-gray-200 hover:border-primary-300'}`}>
                      <div className="flex items-center justify-between mb-3">
                        <div className="flex items-center gap-2">
                          <h3 className={`font-semibold text-lg ${(traveler as any).is_cancelled ? 'line-through text-gray-400' : ''}`}>
                            {getCategoryLabel(traveler.categoria_viajero)} {index + 1}
                          </h3>
                          {(traveler as any).is_cancelled && (
                            <span className="text-xs bg-red-100 text-red-700 px-2 py-0.5 rounded-full font-medium">Cancelado</span>
                          )}
                        </div>
                        <div className="flex items-center gap-2">
                          {Number((traveler as any).promo_discount_per_traveler) > 0 ? (
                            <span className="flex items-center gap-1.5">
                              <span className="text-sm text-gray-400 line-through">
                                {formatCurrencyMXN(Number(traveler.precio_aplicado) + Number((traveler as any).promo_discount_per_traveler))}
                              </span>
                              <span className={`text-sm font-bold ${(traveler as any).is_cancelled ? 'text-gray-400 line-through' : 'text-emerald-600'}`}>
                                {formatCurrencyMXN(Number(traveler.precio_aplicado))}
                              </span>
                            </span>
                          ) : (
                            <span className={`text-sm font-medium ${(traveler as any).is_cancelled ? 'text-gray-400 line-through' : 'text-gray-500'}`}>
                              {formatCurrencyMXN(Number(traveler.precio_aplicado))}
                            </span>
                          )}
                        </div>
                      </div>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
                        <div>
                          <div className="text-gray-500 mb-1">Nombre Completo</div>
                          <div className="font-medium">{traveler.nombre}</div>
                        </div>
                        {traveler.categoria_viajero !== 'mascota' && (
                          <>
                            <div>
                              <div className="text-gray-500 mb-1">Fecha de Nacimiento</div>
                              <div className="font-medium">
                                {traveler.fecha_nacimiento ? formatDate(traveler.fecha_nacimiento) : 'N/A'}
                              </div>
                            </div>
                            <div>
                              <div className="text-gray-500 mb-1">Email</div>
                              <div className="font-medium">
                                <a href={`mailto:${traveler.email}`} className="text-primary-600 hover:text-primary-700">
                                  {traveler.email}
                                </a>
                              </div>
                            </div>
                            <div>
                              <div className="text-gray-500 mb-1">Teléfono</div>
                              <div className="font-medium">{traveler.telefono || 'N/A'}</div>
                            </div>
                          </>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}

              <div className="mt-6 flex justify-end gap-3">
                <button
                  onClick={handleCloseTravelersModal}
                  className="btn btn-outline"
                >
                  Cerrar
                </button>
                {travelersModal.booking && (() => {
                  const isPaid = travelersModal.booking.payment_status === 'succeeded' ||
                    travelersModal.booking.status === 'confirmed' ||
                    travelersModal.booking.status === 'completed';
                  const nameChangesBlocked = !!(travelersModal.booking as any).tours?.name_changes_not_allowed && isPaid;
                  return nameChangesBlocked ? (
                    <div className="flex flex-col items-end gap-1">
                      <button
                        disabled
                        className="btn bg-gray-300 text-gray-500 cursor-not-allowed flex items-center"
                      >
                        <Lock className="h-4 w-4 mr-2" />
                        Editar Acompañantes
                      </button>
                      <span className="text-xs text-red-600">Este tour no permite cambios de nombre</span>
                    </div>
                  ) : (
                    <button
                      onClick={() => {
                        handleEditTravelers(travelersModal.booking!.id);
                        handleCloseTravelersModal();
                      }}
                      className="btn btn-primary flex items-center"
                    >
                      <Edit className="h-4 w-4 mr-2" />
                      Editar Acompañantes
                    </button>
                  );
                })()}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Review Modal */}
      {reviewModal.open && reviewModal.booking && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-lg max-w-2xl w-full max-h-[90vh] overflow-y-auto">
            <div className="p-6">
              <div className="flex justify-between items-start mb-4">
                <div>
                  <h2 className="text-2xl font-bold mb-2">
                    {reviewModal.existingReview ? 'Editar Reseña' : 'Dejar Reseña'}
                  </h2>
                  <p className="text-gray-600">
                    {reviewModal.booking.tours?.name} - {reviewModal.booking.agencies?.name}
                  </p>
                </div>
                <button
                  onClick={handleCloseReviewModal}
                  className="text-gray-400 hover:text-gray-600"
                >
                  <X className="h-6 w-6" />
                </button>
              </div>
              <ReviewForm
                bookingId={reviewModal.booking.id}
                revieweeId={reviewModal.booking.agency_id!}
                reviewType="agency"
                onSuccess={handleReviewSuccess}
                onCancel={handleCloseReviewModal}
                existingReview={reviewModal.existingReview}
              />
            </div>
          </div>
        </div>
      )}

      {/* Cancellation Modal */}
      {cancellationModal.open && cancellationModal.booking && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-lg max-w-3xl w-full max-h-[90vh] overflow-y-auto">
            <div className="p-6">
              {!cancellationModal.success ? (
                <>
                  <div className="flex justify-between items-start mb-4">
                    <div>
                      <h2 className="text-2xl font-bold mb-2 text-red-600">
                        {cancellationModal.policy?.policyType === '100_percent' && 'Cancelación con Reembolso del 100%'}
                        {cancellationModal.policy?.policyType === '50_percent' && `Cancelación con Reembolso del ${cancellationModal.policy.refundPercentage ?? 50}%`}
                        {cancellationModal.policy?.policyType === 'no_refund' && 'Cancelación sin Reembolso'}
                        {cancellationModal.policy?.policyType === 'no_show' && 'Advertencia: Se Marcará como No Show'}
                        {cancellationModal.policy?.policyType === 'pending_approval' && 'Cancelar Reserva Pendiente'}
                        {!cancellationModal.policy && 'Cancelar Reserva'}
                      </h2>
                      <p className="text-gray-600">
                        {cancellationModal.booking.tours?.name}
                      </p>
                    </div>
                    <button
                      onClick={handleCloseCancellationModal}
                      className="text-gray-400 hover:text-gray-600"
                      disabled={cancellationModal.isCancelling}
                    >
                      <X className="h-6 w-6" />
                    </button>
                  </div>

                  {cancellationModal.isCalculating ? (
                    <div className="flex justify-center py-8">
                      <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-primary-600"></div>
                    </div>
                  ) : cancellationModal.policy ? (
                    <>
                      <div className="mb-6">
                        <div className="bg-gray-50 p-4 rounded-lg mb-4">
                          <div className="flex items-center justify-between mb-3">
                            <span className="text-gray-600">Días antes del tour:</span>
                            <span className={`px-3 py-1 rounded-full text-sm font-semibold ${
                              cancellationModal.policy.daysBeforeTour >= 15 ? 'bg-green-100 text-green-800' :
                              cancellationModal.policy.daysBeforeTour >= 7 ? 'bg-yellow-100 text-yellow-800' :
                              cancellationModal.policy.daysBeforeTour >= 1 ? 'bg-orange-100 text-orange-800' :
                              'bg-red-100 text-red-800'
                            }`}>
                              {cancellationModal.policy.daysBeforeTour} día(s)
                            </span>
                          </div>
                          <div className="text-sm text-gray-600">
                            Fecha del tour: {formatFullDate((cancellationModal.booking as any).selected_date ?? (cancellationModal.booking.tours as any).start_date)}
                          </div>
                        </div>

                        {cancellationModal.policy.warningMessage && (
                          <div className="bg-red-50 border-l-4 border-red-500 p-4 mb-4">
                            <div className="flex items-start">
                              <AlertCircle className="h-5 w-5 text-red-500 mt-0.5 mr-2 flex-shrink-0" />
                              <p className="text-sm text-red-800 font-medium">
                                {cancellationModal.policy.warningMessage}
                              </p>
                            </div>
                          </div>
                        )}

                        <div className={`p-4 rounded-lg mb-4 ${
                          cancellationModal.policy.policyType === '100_percent' ? 'bg-green-50 border-2 border-green-200' :
                          cancellationModal.policy.policyType === '50_percent' ? 'bg-yellow-50 border-2 border-yellow-200' :
                          cancellationModal.policy.policyType === 'pending_approval' ? 'bg-gray-50 border-2 border-gray-200' :
                          'bg-red-50 border-2 border-red-200'
                        }`}>
                          <h3 className={`font-semibold mb-2 ${
                            cancellationModal.policy.policyType === '100_percent' ? 'text-green-800' :
                            cancellationModal.policy.policyType === '50_percent' ? 'text-yellow-800' :
                            cancellationModal.policy.policyType === 'pending_approval' ? 'text-gray-800' :
                            'text-red-800'
                          }`}>
                            Política de Reembolso
                          </h3>
                          <p className={`text-sm ${
                            cancellationModal.policy.policyType === '100_percent' ? 'text-green-700' :
                            cancellationModal.policy.policyType === '50_percent' ? 'text-yellow-700' :
                            cancellationModal.policy.policyType === 'pending_approval' ? 'text-gray-700' :
                            'text-red-700'
                          }`}>
                            {cancellationModal.policy.refundMessage}
                          </p>
                        </div>

                        {cancellationModal.policy.originalServiceCharge > 0 && (
                          <div className="bg-orange-50 border-l-4 border-orange-400 p-4 mb-4">
                            <p className="text-sm text-orange-800">
                              <strong>Nota importante:</strong> El cargo por servicio de ${formatCurrencyMXN(cancellationModal.policy.originalServiceCharge)} no es reembolsable. Si utilizaste beneficios de ToursRed+, estos tampoco son recuperables ya que fueron cobrados por Stripe.
                            </p>
                          </div>
                        )}

                        {(cancellationModal.policy as any).optionalServicesNonRefundable > 0 && (
                          <div className="bg-red-50 border-l-4 border-red-500 p-4 mb-4">
                            <p className="text-sm text-red-800 font-semibold mb-1">Servicios opcionales NO reembolsables:</p>
                            <p className="text-sm text-red-700">
                              Tienes ${formatCurrencyMXN((cancellationModal.policy as any).optionalServicesNonRefundable as number)} en servicios adicionales marcados como no reembolsables. Al cancelar, este monto <strong>no se devolverá</strong>, ya que fue contratado con esa condición.
                            </p>
                            {(cancellationModal.policy as any).optionalServicesRefundable > 0 && (
                              <p className="text-sm text-red-600 mt-1">
                                Los servicios reembolsables (${formatCurrencyMXN((cancellationModal.policy as any).optionalServicesRefundable as number)}) sí se devuelven.
                              </p>
                            )}
                          </div>
                        )}

                        <div className="mb-4">
                          <label className="block text-sm font-medium text-gray-700 mb-2">
                            Motivo de cancelación (opcional)
                          </label>
                          <textarea
                            value={cancellationModal.cancellationReason}
                            onChange={(e) => setCancellationModal(prev => ({
                              ...prev,
                              cancellationReason: e.target.value
                            }))}
                            rows={3}
                            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
                            placeholder="¿Por qué deseas cancelar esta reserva?"
                            disabled={cancellationModal.isCancelling}
                          />
                        </div>

                        <div className="mb-4">
                          <label className="flex items-start">
                            <input
                              type="checkbox"
                              checked={cancellationModal.acceptPolicy}
                              onChange={(e) => setCancellationModal(prev => ({
                                ...prev,
                                acceptPolicy: e.target.checked,
                                error: ''
                              }))}
                              className="mt-1 h-4 w-4 text-primary-600 focus:ring-primary-500 border-gray-300 rounded"
                              disabled={cancellationModal.isCancelling}
                            />
                            <span className="ml-2 text-sm text-gray-700">
                              He leído y acepto la política de cancelación aplicable. Entiendo que esta acción no se puede deshacer.
                            </span>
                          </label>
                        </div>

                        {cancellationModal.error && (
                          <div className="mb-4 bg-red-50 border border-red-200 rounded-md p-3">
                            <div className="flex items-start">
                              <AlertCircle className="h-5 w-5 text-red-500 mt-0.5 mr-2 flex-shrink-0" />
                              <p className="text-sm text-red-800">{cancellationModal.error}</p>
                            </div>
                          </div>
                        )}
                      </div>

                      <div className="flex flex-col sm:flex-row gap-3">
                        <button
                          onClick={handleCloseCancellationModal}
                          className="btn btn-outline flex-1"
                          disabled={cancellationModal.isCancelling}
                        >
                          Mantener Mi Reserva
                        </button>
                        <button
                          onClick={handleCancelBooking}
                          className="btn bg-red-600 hover:bg-red-700 text-white flex-1 disabled:opacity-50 disabled:cursor-not-allowed"
                          disabled={!cancellationModal.acceptPolicy || cancellationModal.isCancelling}
                        >
                          {cancellationModal.isCancelling ? (
                            <>
                              <div className="animate-spin rounded-full h-4 w-4 border-2 border-white border-t-transparent mr-2"></div>
                              Procesando...
                            </>
                          ) : (
                            <>
                              <XCircle className="h-4 w-4 mr-2" />
                              Cancelar Reserva
                            </>
                          )}
                        </button>
                      </div>
                    </>
                  ) : (
                    <div className="text-center py-8">
                      <p className="text-red-600">{cancellationModal.error || 'Error al cargar la información'}</p>
                      <button
                        onClick={handleCloseCancellationModal}
                        className="btn btn-outline mt-4"
                      >
                        Cerrar
                      </button>
                    </div>
                  )}
                </>
              ) : (
                <div className="text-center py-8">
                  <div className="mb-4 inline-flex items-center justify-center w-16 h-16 rounded-full bg-green-100">
                    <svg className="w-8 h-8 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7"></path>
                    </svg>
                  </div>
                  <h3 className="text-xl font-bold text-green-600 mb-2">Cancelación Exitosa</h3>
                  <p className="text-gray-600 mb-4">
                    Tu reserva ha sido cancelada exitosamente. Recibirás un correo electrónico con los detalles.
                  </p>
                  {cancellationModal.policy?.refundAmountToTraveler > 0 && (
                    <p className="text-sm text-gray-600">
                      El reembolso de ${formatCurrencyMXN(cancellationModal.policy.refundAmountToTraveler)} ha sido depositado en tu ToursRed Cash.
                    </p>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Partial Cancellation Modal */}
      {partialCancellationModal.open && partialCancellationModal.booking && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-lg max-w-2xl w-full max-h-[90vh] overflow-y-auto">
            <div className="p-6">
              {!partialCancellationModal.success ? (
                <>
                  <div className="flex justify-between items-start mb-4">
                    <div>
                      <h2 className="text-xl font-bold text-orange-700 flex items-center gap-2">
                        <UserMinus className="h-5 w-5" />
                        Cancelar Viajeros
                      </h2>
                      <p className="text-gray-600 text-sm mt-1">{partialCancellationModal.booking.tours?.name}</p>
                    </div>
                    <button
                      onClick={handleClosePartialCancellationModal}
                      className="text-gray-400 hover:text-gray-600"
                      disabled={partialCancellationModal.isCancelling}
                    >
                      <X className="h-6 w-6" />
                    </button>
                  </div>

                  <p className="text-sm text-gray-600 mb-4">
                    Selecciona los viajeros que deseas cancelar. La reserva continuará activa para los viajeros restantes.
                  </p>

                  {partialCancellationModal.isCalculating && partialCancellationModal.travelers.length === 0 ? (
                    <div className="flex justify-center py-8">
                      <div className="animate-spin rounded-full h-10 w-10 border-t-2 border-b-2 border-orange-500"></div>
                    </div>
                  ) : (
                    <>
                      <div className="space-y-2 mb-5">
                        {partialCancellationModal.travelers.map((traveler) => {
                          const isSelected = partialCancellationModal.selectedIds.has(traveler.id);
                          const categoryLabels: Record<string, string> = {
                            adulto: 'Adulto', nino: 'Niño', infante: 'Infante', adulto_mayor: 'Adulto Mayor'
                          };
                          return (
                            <button
                              key={traveler.id}
                              onClick={() => handleTogglePartialTraveler(traveler.id)}
                              disabled={partialCancellationModal.isCancelling || partialCancellationModal.isCalculating}
                              className={`w-full flex items-center justify-between p-3 rounded-lg border-2 transition-all text-left ${
                                isSelected
                                  ? 'border-orange-400 bg-orange-50'
                                  : 'border-gray-200 bg-white hover:border-gray-300'
                              }`}
                            >
                              <div className="flex items-center gap-3">
                                <div className={`w-5 h-5 rounded border-2 flex items-center justify-center flex-shrink-0 transition-colors ${
                                  isSelected ? 'bg-orange-500 border-orange-500' : 'border-gray-300'
                                }`}>
                                  {isSelected && (
                                    <svg className="w-3 h-3 text-white" viewBox="0 0 12 12" fill="none">
                                      <path d="M2 6l3 3 5-5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                                    </svg>
                                  )}
                                </div>
                                <div>
                                  <div className="font-medium text-gray-900 text-sm">{traveler.nombre}</div>
                                  <div className="text-xs text-gray-500">{categoryLabels[traveler.categoria_viajero] || traveler.categoria_viajero}</div>
                                </div>
                              </div>
                              <div className="text-right">
                                {Number((traveler as any).promo_discount_per_traveler) > 0 ? (
                                  <>
                                    <div className="flex items-center gap-1.5 justify-end">
                                      <span className="text-xs text-gray-400 line-through">${formatCurrencyMXN(Number(traveler.precio_aplicado) + Number((traveler as any).promo_discount_per_traveler))}</span>
                                      <span className="font-semibold text-sm text-emerald-600">${formatCurrencyMXN(Number(traveler.precio_aplicado))}</span>
                                    </div>
                                    <div className="text-xs text-gray-500">precio pagado</div>
                                  </>
                                ) : (
                                  <>
                                    <div className="font-semibold text-sm text-gray-800">${formatCurrencyMXN(Number(traveler.precio_aplicado))}</div>
                                    <div className="text-xs text-gray-500">precio pagado</div>
                                  </>
                                )}
                              </div>
                            </button>
                          );
                        })}
                      </div>

                      {partialCancellationModal.selectedIds.size === partialCancellationModal.travelers.length && partialCancellationModal.travelers.length > 0 && (
                        <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-md">
                          <p className="text-sm text-red-800 font-medium">
                            Has seleccionado todos los viajeros. Para cancelar toda la reserva, usa el botón "Cancelar Reserva".
                          </p>
                        </div>
                      )}

                      {partialCancellationModal.isCalculating && partialCancellationModal.selectedIds.size > 0 && (
                        <div className="mb-4 flex items-center gap-2 text-sm text-gray-500">
                          <div className="animate-spin rounded-full h-4 w-4 border-t-2 border-b-2 border-orange-500"></div>
                          Calculando política...
                        </div>
                      )}

                      {partialCancellationModal.policy && partialCancellationModal.selectedIds.size > 0 && !partialCancellationModal.isCalculating && (
                        <div className={`p-4 rounded-lg mb-4 border-2 ${
                          partialCancellationModal.policy.policyType === '100_percent'
                            ? 'bg-green-50 border-green-200'
                            : partialCancellationModal.policy.policyType === '50_percent'
                            ? 'bg-yellow-50 border-yellow-200'
                            : 'bg-red-50 border-red-200'
                        }`}>
                          <div className="flex justify-between items-start mb-2">
                            <h3 className={`font-semibold text-sm ${
                              partialCancellationModal.policy.policyType === '100_percent' ? 'text-green-800' :
                              partialCancellationModal.policy.policyType === '50_percent' ? 'text-yellow-800' : 'text-red-800'
                            }`}>
                              {partialCancellationModal.policy.policyType === '100_percent' && 'Reembolso del 100%'}
                              {partialCancellationModal.policy.policyType === '50_percent' && 'Reembolso del 50%'}
                              {partialCancellationModal.policy.policyType === 'no_refund' && 'Sin Reembolso'}
                            </h3>
                            <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                              partialCancellationModal.policy.daysBeforeTour >= 15 ? 'bg-green-100 text-green-800' :
                              partialCancellationModal.policy.daysBeforeTour >= 7 ? 'bg-yellow-100 text-yellow-800' :
                              'bg-red-100 text-red-800'
                            }`}>
                              {partialCancellationModal.policy.daysBeforeTour} día(s) antes
                            </span>
                          </div>
                          <div className="space-y-1 text-sm mb-2">
                            <div className="flex justify-between">
                              <span className="text-gray-600">Anticipo de viajeros cancelados:</span>
                              <span className="font-medium">${formatCurrencyMXN(Number(partialCancellationModal.policy.originalPartialAmount))}</span>
                            </div>
                            <div className="flex justify-between">
                              <span className="text-gray-600">Reembolso a ToursRed Cash:</span>
                              <span className={`font-bold ${partialCancellationModal.policy.refundAmountToTraveler > 0 ? 'text-green-700' : 'text-red-600'}`}>
                                ${formatCurrencyMXN(Number(partialCancellationModal.policy.refundAmountToTraveler))}
                              </span>
                            </div>
                          </div>
                          <p className={`text-xs mt-1 ${
                            partialCancellationModal.policy.policyType === '100_percent' ? 'text-green-700' :
                            partialCancellationModal.policy.policyType === '50_percent' ? 'text-yellow-700' : 'text-red-700'
                          }`}>
                            {partialCancellationModal.policy.refundMessage}
                          </p>
                        </div>
                      )}

                      {partialCancellationModal.selectedIds.size > 0 && (
                        <>
                          <div className="mb-4">
                            <label className="block text-sm font-medium text-gray-700 mb-1">
                              Motivo de cancelación (opcional)
                            </label>
                            <textarea
                              value={partialCancellationModal.cancellationReason}
                              onChange={(e) => setPartialCancellationModal(prev => ({ ...prev, cancellationReason: e.target.value }))}
                              rows={2}
                              className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:ring-2 focus:ring-orange-400 focus:border-orange-400"
                              placeholder="¿Por qué cancelas estos viajeros?"
                              disabled={partialCancellationModal.isCancelling}
                            />
                          </div>

                          <div className="mb-4">
                            <label className="flex items-start gap-2">
                              <input
                                type="checkbox"
                                checked={partialCancellationModal.acceptPolicy}
                                onChange={(e) => setPartialCancellationModal(prev => ({ ...prev, acceptPolicy: e.target.checked, error: '' }))}
                                className="mt-1 h-4 w-4 text-orange-500 focus:ring-orange-400 border-gray-300 rounded"
                                disabled={partialCancellationModal.isCancelling}
                              />
                              <span className="text-sm text-gray-700">
                                He leído y acepto la política de cancelación. Entiendo que los viajeros seleccionados serán removidos permanentemente de la reserva y el reembolso se acreditará en mi ToursRed Cash.
                              </span>
                            </label>
                          </div>
                        </>
                      )}

                      {partialCancellationModal.error && (
                        <div className="mb-4 bg-red-50 border border-red-200 rounded-md p-3 flex items-start gap-2">
                          <AlertCircle className="h-4 w-4 text-red-500 mt-0.5 flex-shrink-0" />
                          <p className="text-sm text-red-800">{partialCancellationModal.error}</p>
                        </div>
                      )}

                      <div className="flex flex-col sm:flex-row gap-3">
                        <button
                          onClick={handleClosePartialCancellationModal}
                          className="btn btn-outline flex-1"
                          disabled={partialCancellationModal.isCancelling}
                        >
                          Cancelar
                        </button>
                        <button
                          onClick={handleProcessPartialCancellation}
                          disabled={
                            partialCancellationModal.selectedIds.size === 0 ||
                            partialCancellationModal.selectedIds.size === partialCancellationModal.travelers.length ||
                            !partialCancellationModal.acceptPolicy ||
                            partialCancellationModal.isCancelling ||
                            partialCancellationModal.isCalculating ||
                            !partialCancellationModal.policy
                          }
                          className="btn bg-orange-600 hover:bg-orange-700 text-white flex-1 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center"
                        >
                          {partialCancellationModal.isCancelling ? (
                            <>
                              <div className="animate-spin rounded-full h-4 w-4 border-2 border-white border-t-transparent mr-2"></div>
                              Procesando...
                            </>
                          ) : (
                            <>
                              <UserMinus className="h-4 w-4 mr-2" />
                              Cancelar {partialCancellationModal.selectedIds.size > 0 ? `${partialCancellationModal.selectedIds.size} viajero(s)` : 'Viajeros'}
                            </>
                          )}
                        </button>
                      </div>
                    </>
                  )}
                </>
              ) : (
                <div className="text-center py-8">
                  <div className="mb-4 inline-flex items-center justify-center w-16 h-16 rounded-full bg-green-100">
                    <svg className="w-8 h-8 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7"></path>
                    </svg>
                  </div>
                  <h3 className="text-xl font-bold text-green-600 mb-2">Cancelación Parcial Exitosa</h3>
                  <p className="text-gray-600 mb-2">Los viajeros han sido removidos de tu reserva.</p>
                  {partialCancellationModal.policy?.refundAmountToTraveler > 0 && (
                    <p className="text-sm text-gray-600">
                      El reembolso de ${formatCurrencyMXN(Number(partialCancellationModal.policy.refundAmountToTraveler))} ha sido acreditado en tu ToursRed Cash.
                    </p>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Payment Modal with ToursRed Cash */}
      {paymentModal.open && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-lg max-w-2xl w-full max-h-[90vh] overflow-y-auto">
            <div className="p-6">
              <div className="flex justify-between items-start mb-6">
                <h2 className="text-2xl font-bold text-gray-900">Completar Pago</h2>
                <button
                  onClick={() => setPaymentModal({ open: false, booking: null, walletBalance: 0, toursRedCashToUse: 0, isProcessing: false, selectedProvider: 'stripe' })}
                  className="text-gray-400 hover:text-gray-500"
                  disabled={paymentModal.isProcessing}
                >
                  <X className="h-6 w-6" />
                </button>
              </div>

              <div className="space-y-6">
                {/* Booking Details */}
                <div className="bg-gray-50 rounded-lg p-4">
                  <h3 className="font-semibold text-gray-900 mb-2">{paymentModal.booking?.tours?.name}</h3>
                  <div className="text-sm text-gray-600 space-y-1">
                    <p>Fecha del Tour: {paymentModal.booking?.booking_date && formatDate(paymentModal.booking.booking_date)}</p>
                    <p>Viajeros: {paymentModal.booking?.travelers_count}</p>
                  </div>
                </div>

                {/* Payment Provider Selector */}
                {(() => {
                  const originalAmount = paymentModal.booking?.user_payment || paymentModal.booking?.deposit_amount || 0;
                  const pointsAlreadyUsed = ((paymentModal.booking?.points_used || 0) / 100);
                  const finalAmount = originalAmount - pointsAlreadyUsed - paymentModal.toursRedCashToUse;
                  if (finalAmount > 0) {
                    return (
                      <PaymentProviderSelector
                        context="booking"
                        value={paymentModal.selectedProvider}
                        onChange={(provider) => setPaymentModal(prev => ({ ...prev, selectedProvider: provider }))}
                        disabled={paymentModal.isProcessing}
                      />
                    );
                  }
                  return null;
                })()}

                {/* Payment Summary */}
                <div className="space-y-3">
                  {(() => {
                    const discountAmount = paymentModal.booking?.discount_amount || 0;
                    const userPayment = paymentModal.booking?.user_payment || paymentModal.booking?.deposit_amount || 0;
                    const preDiscountAmount = userPayment + discountAmount;
                    const discountCode = (paymentModal.booking as any)?.discount_codes;

                    return (
                      <>
                        <div className="flex justify-between text-sm">
                          <span className="text-gray-600">{discountAmount > 0 ? 'Subtotal:' : 'Monto Original:'}</span>
                          <span className="font-semibold">{formatCurrencyMXN(preDiscountAmount)}</span>
                        </div>

                        {discountAmount > 0 && (
                          <div className="bg-blue-50 border border-blue-200 rounded-md p-3">
                            <div className="flex justify-between text-sm">
                              <span className="text-blue-800">
                                Descuento Aplicado{discountCode?.code ? ` (${discountCode.code})` : ''}:
                              </span>
                              <span className="font-semibold text-blue-800">-{formatCurrencyMXN(discountAmount)}</span>
                            </div>
                          </div>
                        )}

                        {discountAmount > 0 && (
                          <div className="flex justify-between text-sm">
                            <span className="text-gray-600">Monto con Descuento:</span>
                            <span className="font-semibold">{formatCurrencyMXN(userPayment)}</span>
                          </div>
                        )}
                      </>
                    );
                  })()}

                  {(paymentModal.booking?.points_used || 0) > 0 && (
                    <div className="bg-amber-50 border border-amber-200 rounded-md p-3">
                      <div className="flex justify-between text-sm">
                        <span className="text-amber-800">ToursRed Points Aplicados:</span>
                        <span className="font-semibold text-amber-800">-${formatCurrencyMXN((paymentModal.booking?.points_used || 0) / 100)}</span>
                      </div>
                      <p className="text-xs text-amber-700 mt-1">
                        {(paymentModal.booking?.points_used || 0).toLocaleString()} puntos ya descontados
                      </p>
                    </div>
                  )}

                  {/* ToursRed Cash Section */}
                  {paymentModal.walletBalance > 0 && (() => {
                    const originalAmount = paymentModal.booking?.user_payment || paymentModal.booking?.deposit_amount || 0;
                    const pointsAlreadyUsed = ((paymentModal.booking?.points_used || 0) / 100);
                    const remainingAmount = originalAmount - pointsAlreadyUsed;

                    return (
                      <>
                        <div className="border-t pt-3">
                          <div className="flex justify-between items-center mb-2">
                            <span className="text-sm font-medium text-gray-700">Tu Saldo ToursRed Cash:</span>
                            <span className="text-lg font-bold text-green-600">{formatCurrencyMXN(paymentModal.walletBalance)}</span>
                          </div>

                          <div className="mt-4">
                            <label className="block text-sm font-medium text-gray-700 mb-2">
                              Usar ToursRed Cash
                            </label>
                            <div className="flex gap-2">
                              <input
                                type="number"
                                min="0"
                                max={Math.min(paymentModal.walletBalance, remainingAmount)}
                                value={paymentModal.toursRedCashToUse}
                                onChange={(e) => {
                                  const value = parseFloat(e.target.value) || 0;
                                  const maxAmount = Math.min(paymentModal.walletBalance, remainingAmount);
                                  setPaymentModal(prev => ({
                                    ...prev,
                                    toursRedCashToUse: Math.min(Math.max(0, value), maxAmount)
                                  }));
                                }}
                                className="flex-1 px-3 py-2 border border-gray-300 rounded-md focus:ring-primary-500 focus:border-primary-500"
                                disabled={paymentModal.isProcessing}
                              />
                              <button
                                onClick={() => {
                                  const maxAmount = Math.min(paymentModal.walletBalance, remainingAmount);
                                  setPaymentModal(prev => ({
                                    ...prev,
                                    toursRedCashToUse: maxAmount
                                  }));
                                }}
                                className="px-4 py-2 bg-green-600 text-white rounded-md hover:bg-green-700 disabled:opacity-50"
                                disabled={paymentModal.isProcessing}
                              >
                                Usar Todo
                              </button>
                            </div>
                            <p className="mt-1 text-xs text-gray-500">
                              Máximo: {formatCurrencyMXN(Math.min(paymentModal.walletBalance, remainingAmount))}
                            </p>
                          </div>
                        </div>

                        {paymentModal.toursRedCashToUse > 0 && (
                          <div className="bg-green-50 border border-green-200 rounded-md p-3">
                            <div className="flex justify-between text-sm">
                              <span className="text-green-800">ToursRed Cash Aplicado:</span>
                              <span className="font-semibold text-green-800">-{formatCurrencyMXN(paymentModal.toursRedCashToUse)}</span>
                            </div>
                          </div>
                        )}
                      </>
                    );
                  })()}

                  <div className="border-t pt-3">
                    <div className="flex justify-between text-lg font-bold">
                      <span>Total a Pagar{paymentModal.toursRedCashToUse > 0 ? ` con ${paymentModal.selectedProvider === 'mercadopago' ? 'MercadoPago' : paymentModal.selectedProvider === 'paypal' ? 'PayPal' : 'Stripe'}` : ''}:</span>
                      <span className="text-primary-600">
                        {formatCurrencyMXN((() => {
                          const originalAmount = paymentModal.booking?.user_payment || paymentModal.booking?.deposit_amount || 0;
                          const pointsAlreadyUsed = ((paymentModal.booking?.points_used || 0) / 100);
                          const remainingAmount = originalAmount - pointsAlreadyUsed;
                          return Math.max(0, remainingAmount - paymentModal.toursRedCashToUse);
                        })())}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Action Buttons */}
                <div className="flex gap-3 pt-4">
                  <button
                    onClick={() => setPaymentModal({ open: false, booking: null, walletBalance: 0, toursRedCashToUse: 0, isProcessing: false, selectedProvider: 'stripe' })}
                    className="flex-1 px-4 py-3 border border-gray-300 rounded-md text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                    disabled={paymentModal.isProcessing}
                  >
                    Cancelar
                  </button>
                  <button
                    onClick={handleProceedWithPayment}
                    className="flex-1 px-4 py-3 bg-primary-600 text-white rounded-md hover:bg-primary-700 disabled:opacity-50 disabled:cursor-not-allowed"
                    disabled={paymentModal.isProcessing}
                  >
                    {paymentModal.isProcessing ? (
                      <>
                        <div className="inline-block animate-spin rounded-full h-4 w-4 border-2 border-white border-t-transparent mr-2"></div>
                        Procesando...
                      </>
                    ) : (
                      <>
                        {(() => {
                          const originalAmount = paymentModal.booking?.user_payment || paymentModal.booking?.deposit_amount || 0;
                          const pointsAlreadyUsed = ((paymentModal.booking?.points_used || 0) / 100);
                          const remainingAmount = originalAmount - pointsAlreadyUsed;
                          const finalAmount = remainingAmount - paymentModal.toursRedCashToUse;
                          if (finalAmount <= 0) return 'Confirmar Pago';
                          if (paymentModal.selectedProvider === 'mercadopago') return 'Pagar con MercadoPago';
                          if (paymentModal.selectedProvider === 'paypal') return 'Proceder a PayPal';
                          return 'Proceder a Stripe';
                        })()}
                      </>
                    )}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {mpBrickModal?.open && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-lg max-w-xl w-full max-h-[90vh] overflow-y-auto">
            <div className="p-6">
              <div className="flex justify-between items-center mb-4">
                <div>
                  <h2 className="text-xl font-bold text-gray-900">Completa tu pago</h2>
                  <p className="text-sm text-gray-500 mt-1">Pago seguro con MercadoPago</p>
                </div>
                <button
                  onClick={() => setMpBrickModal(null)}
                  className="text-gray-400 hover:text-gray-500"
                >
                  <X className="h-6 w-6" />
                </button>
              </div>
              <MercadoPagoBrick
                preferenceId={mpBrickModal.preferenceId}
                publicKey={mpBrickModal.publicKey}
                amount={mpBrickModal.amount}
                onSuccess={() => {
                  setMpBrickModal(null);
                  fetchBookings();
                  navigate(`/booking-success?booking_id=${mpBrickModal.bookingId}`);
                }}
                onPending={() => {
                  setMpBrickModal(null);
                  fetchBookings();
                  navigate(`/payment-return?provider=mercadopago&booking_id=${mpBrickModal.bookingId}&tr_status=pending`);
                }}
                onError={(err) => {
                  setMpBrickModal(null);
                  alert(`Error en el pago: ${err}`);
                }}
              />
            </div>
          </div>
        </div>
      )}

      {mpSupplementBrickModal?.open && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-lg max-w-xl w-full max-h-[90vh] overflow-y-auto">
            <div className="p-6">
              <div className="flex justify-between items-center mb-4">
                <div>
                  <h2 className="text-xl font-bold text-gray-900">Completa tu pago</h2>
                  <p className="text-sm text-gray-500 mt-1">Pago seguro con MercadoPago</p>
                </div>
                <button
                  onClick={() => setMpSupplementBrickModal(null)}
                  className="text-gray-400 hover:text-gray-500"
                >
                  <X className="h-6 w-6" />
                </button>
              </div>
              <MercadoPagoBrick
                preferenceId={mpSupplementBrickModal.preferenceId}
                publicKey={mpSupplementBrickModal.publicKey}
                amount={mpSupplementBrickModal.amount}
                supplementId={mpSupplementBrickModal.supplementId}
                onSuccess={() => {
                  setMpSupplementBrickModal(null);
                  fetchBookings();
                }}
                onPending={() => {
                  setMpSupplementBrickModal(null);
                  fetchBookings();
                }}
                onError={(err) => {
                  setMpSupplementBrickModal(null);
                  alert(`Error en el pago: ${err}`);
                }}
              />
            </div>
          </div>
        </div>
      )}

      {paymentValidationError.open && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-lg max-w-md w-full p-6">
            <div className="flex items-start mb-4">
              <AlertCircle className="h-6 w-6 text-red-600 mr-3 flex-shrink-0 mt-0.5" />
              <div>
                <h3 className="text-lg font-bold text-gray-900 mb-2">Error de Validacion</h3>
                <p className="text-sm text-gray-700">{paymentValidationError.message}</p>
              </div>
            </div>
            <div className="flex gap-3 mt-6">
              <button
                onClick={() => setPaymentValidationError({ open: false, bookingId: '', message: '' })}
                className="flex-1 px-4 py-2 border border-gray-300 rounded-md text-gray-700 hover:bg-gray-50"
              >
                Cerrar
              </button>
              <button
                onClick={() => {
                  setPaymentValidationError({ open: false, bookingId: '', message: '' });
                  navigate(`/booking-travelers/${paymentValidationError.bookingId}`);
                }}
                className="flex-1 px-4 py-2 bg-primary-600 text-white rounded-md hover:bg-primary-700 flex items-center justify-center"
              >
                <Edit className="h-4 w-4 mr-2" />
                Editar Viajeros
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Reschedule Modal */}
      {rescheduleModal.open && rescheduleModal.booking && rescheduleModal.rescheduleInfo && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-xl shadow-2xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
            <div className="p-6">
              {!rescheduleModal.success ? (
                <>
                  <div className="flex items-start justify-between mb-6">
                    <div className="flex items-start gap-4">
                      <div className={`p-3 rounded-full ${
                        rescheduleModal.action === 'accept' ? 'bg-green-100' : 'bg-red-100'
                      }`}>
                        {rescheduleModal.action === 'accept' ? (
                          <Check className={`h-8 w-8 text-green-600`} />
                        ) : (
                          <X className={`h-8 w-8 text-red-600`} />
                        )}
                      </div>
                      <div>
                        <h2 className={`text-2xl font-bold mb-2 ${
                          rescheduleModal.action === 'accept' ? 'text-green-900' : 'text-red-900'
                        }`}>
                          {rescheduleModal.action === 'accept' ? 'Aceptar Nueva Fecha' : 'Rechazar Reagendamiento'}
                        </h2>
                        <p className="text-gray-600">{rescheduleModal.booking.tours?.name}</p>
                        <p className="text-sm text-gray-500 font-mono">
                          Código: {rescheduleModal.booking.booking_code}
                        </p>
                      </div>
                    </div>
                    <button
                      onClick={handleCloseRescheduleModal}
                      className="text-gray-400 hover:text-gray-600"
                      disabled={rescheduleModal.isProcessing}
                    >
                      <X className="h-6 w-6" />
                    </button>
                  </div>

                  {/* Date Comparison */}
                  <div className="bg-gray-50 rounded-lg p-4 mb-6">
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <div className="text-sm text-gray-600 mb-2">Fecha Original</div>
                        <div className="font-semibold text-gray-900 line-through">
                          {formatFullDate(rescheduleModal.rescheduleInfo.reschedule.original_start_date)}
                        </div>
                      </div>
                      <div>
                        <div className="text-sm text-gray-600 mb-2">Nueva Fecha</div>
                        <div className="font-semibold text-green-700">
                          {formatFullDate(rescheduleModal.rescheduleInfo.reschedule.new_start_date)}
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Reason */}
                  <div className="bg-blue-50 border-l-4 border-blue-400 p-4 mb-6">
                    <h3 className="font-semibold text-blue-900 mb-2">Motivo del cambio:</h3>
                    <p className="text-sm text-blue-800">
                      {rescheduleModal.rescheduleInfo.reschedule.reason}
                    </p>
                  </div>

                  {/* Action-specific information */}
                  {rescheduleModal.action === 'accept' ? (
                    <div className="bg-green-50 border border-green-200 rounded-lg p-4 mb-6">
                      <h3 className="font-semibold text-green-900 mb-3">✓ Al aceptar la nueva fecha:</h3>
                      <ul className="space-y-2 text-sm text-green-800">
                        <li className="flex items-start gap-2">
                          <Check className="h-4 w-4 text-green-600 flex-shrink-0 mt-0.5" />
                          <span>Tu reserva se actualizará automáticamente con la nueva fecha</span>
                        </li>
                        <li className="flex items-start gap-2">
                          <Check className="h-4 w-4 text-green-600 flex-shrink-0 mt-0.5" />
                          <span>No hay cargos adicionales, tu pago sigue siendo válido</span>
                        </li>
                        <li className="flex items-start gap-2">
                          <Check className="h-4 w-4 text-green-600 flex-shrink-0 mt-0.5" />
                          <span>Recibirás un email de confirmación con los nuevos detalles</span>
                        </li>
                        <li className="flex items-start gap-2">
                          <Check className="h-4 w-4 text-green-600 flex-shrink-0 mt-0.5" />
                          <span>No necesitas realizar ninguna acción adicional</span>
                        </li>
                      </ul>
                    </div>
                  ) : (
                    <div className="bg-red-50 border border-red-200 rounded-lg p-4 mb-6">
                      <h3 className="font-semibold text-red-900 mb-3">💰 Al rechazar el reagendamiento:</h3>
                      <ul className="space-y-2 text-sm text-red-800">
                        <li className="flex items-start gap-2">
                          <DollarSign className="h-4 w-4 text-red-600 flex-shrink-0 mt-0.5" />
                          <span>
                            Recibirás un <strong>reembolso del 100%</strong> de tu depósito (
                            {formatCurrencyMXN(rescheduleModal.booking.deposit_amount ?? 0)} MXN)
                          </span>
                        </li>
                        {Number(rescheduleModal.booking.toursred_cash_used || 0) > 0 && (
                          <li className="flex items-start gap-2">
                            <DollarSign className="h-4 w-4 text-red-600 flex-shrink-0 mt-0.5" />
                            <span>
                              También se reembolsará el ToursRed Cash utilizado (
                              {formatCurrencyMXN(Number(rescheduleModal.booking.toursred_cash_used))} MXN)
                            </span>
                          </li>
                        )}
                        <li className="flex items-start gap-2">
                          <AlertCircle className="h-4 w-4 text-red-600 flex-shrink-0 mt-0.5" />
                          <span>
                            <strong>No hay penalización</strong> por rechazar debido al reagendamiento de la agencia
                          </span>
                        </li>
                        <li className="flex items-start gap-2">
                          <Wallet className="h-4 w-4 text-red-600 flex-shrink-0 mt-0.5" />
                          <span>
                            El reembolso se depositará en tu monedero ToursRed Cash y podrás usarlo en futuras reservas
                          </span>
                        </li>
                        <li className="flex items-start gap-2">
                          <XCircle className="h-4 w-4 text-red-600 flex-shrink-0 mt-0.5" />
                          <span>Tu reserva será cancelada automáticamente</span>
                        </li>
                      </ul>
                    </div>
                  )}

                  {rescheduleModal.error && (
                    <div className="mb-4 bg-red-50 border border-red-200 rounded-lg p-4">
                      <div className="flex items-start gap-3">
                        <AlertCircle className="h-5 w-5 text-red-600 flex-shrink-0 mt-0.5" />
                        <p className="text-sm text-red-800">{rescheduleModal.error}</p>
                      </div>
                    </div>
                  )}

                  <div className="flex flex-col sm:flex-row gap-3 pt-4">
                    <button
                      onClick={handleCloseRescheduleModal}
                      className="flex-1 px-6 py-3 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50 font-semibold disabled:opacity-50"
                      disabled={rescheduleModal.isProcessing}
                    >
                      Cancelar
                    </button>
                    <button
                      onClick={handleRespondToReschedule}
                      className={`flex-1 px-6 py-3 rounded-lg text-white font-semibold disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 ${
                        rescheduleModal.action === 'accept'
                          ? 'bg-green-600 hover:bg-green-700'
                          : 'bg-red-600 hover:bg-red-700'
                      }`}
                      disabled={rescheduleModal.isProcessing}
                    >
                      {rescheduleModal.isProcessing ? (
                        <>
                          <div className="animate-spin rounded-full h-5 w-5 border-2 border-white border-t-transparent"></div>
                          <span>Procesando...</span>
                        </>
                      ) : rescheduleModal.action === 'accept' ? (
                        <>
                          <Check className="h-5 w-5" />
                          <span>Confirmar: Acepto Nueva Fecha</span>
                        </>
                      ) : (
                        <>
                          <X className="h-5 w-5" />
                          <span>Confirmar: Solicitar Reembolso</span>
                        </>
                      )}
                    </button>
                  </div>
                </>
              ) : (
                <div className="text-center py-12">
                  <div className={`inline-flex items-center justify-center w-20 h-20 rounded-full mb-6 ${
                    rescheduleModal.action === 'accept' ? 'bg-green-100' : 'bg-blue-100'
                  }`}>
                    {rescheduleModal.action === 'accept' ? (
                      <Check className="h-10 w-10 text-green-600" />
                    ) : (
                      <DollarSign className="h-10 w-10 text-blue-600" />
                    )}
                  </div>

                  <h3 className={`text-2xl font-bold mb-3 ${
                    rescheduleModal.action === 'accept' ? 'text-green-600' : 'text-blue-600'
                  }`}>
                    {rescheduleModal.action === 'accept' ? '¡Nueva Fecha Aceptada!' : '¡Reembolso Procesado!'}
                  </h3>

                  <p className="text-gray-600 mb-6 max-w-md mx-auto">
                    {rescheduleModal.action === 'accept'
                      ? 'Tu reserva ha sido actualizada exitosamente con la nueva fecha. Recibirás un email de confirmación.'
                      : 'Tu reembolso ha sido procesado y depositado en tu monedero ToursRed Cash. Recibirás un email con los detalles.'}
                  </p>

                  <div className="bg-gray-50 rounded-lg p-4 max-w-md mx-auto">
                    <p className="text-sm text-gray-600">
                      {rescheduleModal.action === 'accept'
                        ? `Nueva fecha del tour: ${formatFullDate(rescheduleModal.rescheduleInfo.reschedule.new_start_date)}`
                        : 'Puedes ver tu nuevo saldo en la sección de ToursRed Cash'}
                    </p>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Modal de Cambio de Horario (Slot Reschedule) */}
      {slotRescheduleModal.open && slotRescheduleModal.booking && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-xl max-w-md w-full p-6">
            {slotRescheduleModal.success ? (
              <div className="text-center py-8">
                <div className={`inline-flex items-center justify-center w-16 h-16 rounded-full mb-4 ${slotRescheduleModal.action === 'accept' ? 'bg-green-100' : 'bg-blue-100'}`}>
                  {slotRescheduleModal.action === 'accept'
                    ? <Check className="h-8 w-8 text-green-600" />
                    : <DollarSign className="h-8 w-8 text-blue-600" />
                  }
                </div>
                <h3 className={`text-xl font-bold mb-2 ${slotRescheduleModal.action === 'accept' ? 'text-green-700' : 'text-blue-700'}`}>
                  {slotRescheduleModal.action === 'accept' ? 'Nuevo horario aceptado' : 'Reembolso procesado'}
                </h3>
                <p className="text-sm text-gray-600">
                  {slotRescheduleModal.action === 'accept'
                    ? 'Tu reserva ha sido actualizada con el nuevo horario.'
                    : 'El reembolso del 100% fue depositado en tu ToursRed Cash.'}
                </p>
              </div>
            ) : (
              <>
                <div className="flex items-start gap-3 mb-5">
                  <div className={`w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0 ${slotRescheduleModal.action === 'accept' ? 'bg-green-100' : 'bg-red-100'}`}>
                    {slotRescheduleModal.action === 'accept'
                      ? <Check className="h-5 w-5 text-green-600" />
                      : <X className="h-5 w-5 text-red-600" />
                    }
                  </div>
                  <div>
                    <h2 className="text-lg font-semibold text-gray-900">
                      {slotRescheduleModal.action === 'accept' ? 'Confirmar aceptacion del nuevo horario' : 'Confirmar rechazo y solicitar reembolso'}
                    </h2>
                    <p className="text-sm text-gray-500 mt-0.5">
                      {slotRescheduleModal.action === 'accept'
                        ? 'Tu reserva sera movida al nuevo horario indicado.'
                        : 'Tu reserva sera cancelada y recibiras un reembolso del 100% en ToursRed Cash.'}
                    </p>
                  </div>
                </div>

                {slotRescheduleModal.slotRescheduleInfo && (
                  <div className="bg-gray-50 rounded-lg p-4 mb-4 space-y-2">
                    <div className="flex justify-between text-sm">
                      <span className="text-gray-500">Horario anterior:</span>
                      <span className="font-medium text-gray-700 line-through">
                        {slotRescheduleModal.booking.selected_date} {slotRescheduleModal.booking.selected_time?.slice(0, 5)}
                      </span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-gray-500">Nuevo horario:</span>
                      <span className="font-medium text-green-700">
                        {slotRescheduleModal.slotRescheduleInfo.slot_reschedule_requests?.tour_slots?.slot_date}{' '}
                        {slotRescheduleModal.slotRescheduleInfo.slot_reschedule_requests?.tour_slots?.departure_time?.slice(0, 5)}
                      </span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-gray-500">Motivo:</span>
                      <span className="text-gray-700 text-right max-w-[200px]">
                        {slotRescheduleModal.slotRescheduleInfo.slot_reschedule_requests?.reason}
                      </span>
                    </div>
                  </div>
                )}

                {slotRescheduleModal.error && (
                  <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-800 flex items-center gap-2 mb-4">
                    <AlertCircle className="h-4 w-4 flex-shrink-0" />{slotRescheduleModal.error}
                  </div>
                )}

                <div className="flex gap-3">
                  <button
                    type="button"
                    onClick={() => setSlotRescheduleModal(prev => ({ ...prev, open: false }))}
                    disabled={slotRescheduleModal.isProcessing}
                    className="flex-1 btn btn-outline"
                  >
                    Cancelar
                  </button>
                  <button
                    type="button"
                    onClick={handleRespondToSlotReschedule}
                    disabled={slotRescheduleModal.isProcessing}
                    className={`flex-1 btn text-white disabled:opacity-50 ${slotRescheduleModal.action === 'accept' ? 'bg-green-600 hover:bg-green-700' : 'bg-red-600 hover:bg-red-700'}`}
                  >
                    {slotRescheduleModal.isProcessing ? (
                      <><div className="animate-spin rounded-full h-4 w-4 border-2 border-white border-t-transparent mr-2"></div>Procesando...</>
                    ) : slotRescheduleModal.action === 'accept' ? (
                      <><Check className="h-4 w-4 mr-2" />Aceptar nuevo horario</>
                    ) : (
                      <><X className="h-4 w-4 mr-2" />Rechazar y obtener reembolso</>
                    )}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}


      {seatReselectionModal?.open && (
        <SeatReselectionModal
          bookingId={seatReselectionModal.bookingId}
          tourId={seatReselectionModal.tourId}
          slotId={seatReselectionModal.slotId}
          travelersCount={seatReselectionModal.travelersCount}
          previousSeats={seatReselectionModal.previousSeats}
          tourName={seatReselectionModal.tourName}
          newDate={seatReselectionModal.newDate}
          newTime={seatReselectionModal.newTime}
          onSuccess={() => {
            setSeatReselectionModal(null);
            fetchBookings();
          }}
          onClose={() => setSeatReselectionModal(null)}
        />
      )}

      {/* Supplement Request Modal */}
      {supplementPaymentModal.open && supplementPaymentModal.supplement && supplementPaymentModal.booking && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-xl max-w-md w-full max-h-[90vh] overflow-y-auto">
            <div className="p-6 border-b border-gray-100">
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-bold text-gray-900 flex items-center gap-2">
                  <Tag className="w-5 h-5 text-teal-600" />
                  Solicitar Suplemento
                </h3>
                <button onClick={() => setSupplementPaymentModal(prev => ({ ...prev, open: false }))} className="text-gray-400 hover:text-gray-600">
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>

            <div className="p-6 space-y-4">
              <div className="bg-teal-50 rounded-lg p-3">
                <p className="font-semibold text-gray-900">{supplementPaymentModal.supplement.name}</p>
                {supplementPaymentModal.supplement.description && (
                  <p className="text-sm text-gray-500 mt-0.5">{supplementPaymentModal.supplement.description}</p>
                )}
                <p className="text-sm font-semibold text-teal-700 mt-1">{formatCurrencyMXN(Number(supplementPaymentModal.supplement.price))} / unidad</p>
                <div className="flex flex-wrap gap-2 mt-2">
                  {supplementPaymentModal.supplement.requires_approval && (
                    <span className="text-xs bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full">Requiere aprobacion de la agencia (48h)</span>
                  )}
                  {!supplementPaymentModal.supplement.is_cancellable && (
                    <span className="text-xs bg-orange-100 text-orange-700 px-2 py-0.5 rounded-full flex items-center gap-1">
                      <AlertTriangle className="w-3 h-3" />
                      No cancelable
                    </span>
                  )}
                </div>
              </div>

              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1">Cantidad</label>
                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    onClick={() => setSupplementPaymentModal(prev => ({ ...prev, quantity: Math.max(1, prev.quantity - 1) }))}
                    className="w-8 h-8 rounded-full border border-gray-300 flex items-center justify-center text-gray-600 hover:bg-gray-50"
                  >-</button>
                  <span className="font-semibold text-lg w-8 text-center">{supplementPaymentModal.quantity}</span>
                  <button
                    type="button"
                    onClick={() => setSupplementPaymentModal(prev => ({
                      ...prev,
                      quantity: supplementPaymentModal.availableCapacity > 0
                        ? Math.min(supplementPaymentModal.availableCapacity, prev.quantity + 1)
                        : prev.quantity + 1
                    }))}
                    className="w-8 h-8 rounded-full border border-gray-300 flex items-center justify-center text-gray-600 hover:bg-gray-50"
                  >+</button>
                </div>
                {supplementPaymentModal.availableCapacity > 0 && (
                  <p className="text-xs text-gray-400 mt-1">Disponibles: {supplementPaymentModal.availableCapacity}</p>
                )}
              </div>

              {!supplementPaymentModal.supplement.requires_approval && (
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-2">Metodo de Pago</label>
                  <div className="space-y-2">
                    {[
                      { id: 'stripe', label: 'Tarjeta de credito / debito' },
                      { id: 'toursred_cash', label: `ToursRed Cash (Saldo: ${formatCurrencyMXN(supplementPaymentModal.walletBalance)})` },
                      { id: 'points', label: `Puntos ToursRed (${supplementPaymentModal.pointsBalance} pts = ${formatCurrencyMXN(supplementPaymentModal.pointsValueMxn)})` },
                      { id: 'mercadopago', label: 'MercadoPago' },
                      { id: 'paypal', label: 'PayPal' },
                    ].map(method => (
                      <label key={method.id} className="flex items-center gap-2 cursor-pointer">
                        <input
                          type="radio"
                          name="sup_payment_method"
                          value={method.id}
                          checked={supplementPaymentModal.selectedMethod === method.id}
                          onChange={() => setSupplementPaymentModal(prev => ({ ...prev, selectedMethod: method.id as any }))}
                          className="w-4 h-4 text-teal-600"
                        />
                        <span className="text-sm text-gray-700">{method.label}</span>
                      </label>
                    ))}
                  </div>
                </div>
              )}

              {supplementPaymentModal.error && (
                <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-700">
                  {supplementPaymentModal.error}
                </div>
              )}

              {supplementPaymentModal.supplement.requires_approval && (
                <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-sm text-amber-800">
                  Al confirmar, tu solicitud sera enviada a la agencia para aprobacion. Una vez aprobada, tendras 48 horas para completar el pago. Podras elegir el metodo de pago en ese momento.
                </div>
              )}

              <div className="flex gap-3 pt-2">
                <button
                  onClick={() => setSupplementPaymentModal(prev => ({ ...prev, open: false }))}
                  className="btn btn-outline flex-1"
                  disabled={supplementPaymentModal.isProcessing}
                >
                  Cancelar
                </button>
                <button
                  onClick={handleRequestSupplement}
                  disabled={supplementPaymentModal.isProcessing}
                  className="btn flex-1 bg-teal-600 text-white hover:bg-teal-700"
                >
                  {supplementPaymentModal.isProcessing ? 'Procesando...' : supplementPaymentModal.supplement.requires_approval ? 'Enviar solicitud' : 'Confirmar y pagar'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Supplements Manager Modal */}
      {supplementsModal.open && supplementsModal.booking && (() => {
        const booking = supplementsModal.booking!;
        const mySupplements = bookingSupplements[booking.id] || [];
        const available = tourSupplements[booking.tour_id] || [];
        const SUPP_STATUS: Record<string, { label: string; color: string }> = {
          pending_approval: { label: 'Esperando aprobacion', color: 'bg-amber-100 text-amber-700' },
          approved: { label: 'Aprobado — pendiente de pago', color: 'bg-blue-100 text-blue-700' },
          rejected: { label: 'Rechazado', color: 'bg-red-100 text-red-700' },
          pending_payment: { label: 'Pendiente de pago', color: 'bg-blue-100 text-blue-700' },
          paid: { label: 'Pagado', color: 'bg-green-100 text-green-700' },
          cancelled: { label: 'Cancelado / Expirado', color: 'bg-gray-100 text-gray-500' },
        };
        return (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-2xl shadow-xl max-w-lg w-full max-h-[85vh] flex flex-col">
              {/* Header */}
              <div className="p-5 border-b border-gray-100 flex items-center justify-between flex-shrink-0">
                <h3 className="text-lg font-bold text-gray-900 flex items-center gap-2">
                  <Tag className="w-5 h-5 text-teal-600" />
                  Suplementos
                </h3>
                <button onClick={() => setSupplementsModal(prev => ({ ...prev, open: false }))} className="text-gray-400 hover:text-gray-600">
                  <X className="w-5 h-5" />
                </button>
              </div>

              {/* Tabs */}
              <div className="flex border-b border-gray-200 flex-shrink-0">
                {mySupplements.length > 0 && (
                  <button
                    onClick={() => setSupplementsModal(prev => ({ ...prev, activeTab: 'mis_suplementos' }))}
                    className={`flex-1 py-3 text-sm font-medium transition-colors ${supplementsModal.activeTab === 'mis_suplementos' ? 'border-b-2 border-teal-600 text-teal-700' : 'text-gray-500 hover:text-gray-700'}`}
                  >
                    Mis Suplementos
                    {mySupplements.filter((bs: any) => !['rejected', 'cancelled'].includes(bs.status)).length > 0 && (
                      <span className="ml-1.5 inline-flex items-center justify-center w-5 h-5 text-xs font-bold rounded-full bg-teal-100 text-teal-700">
                        {mySupplements.filter((bs: any) => !['rejected', 'cancelled'].includes(bs.status)).length}
                      </span>
                    )}
                  </button>
                )}
                {available.length > 0 && (
                  <button
                    onClick={() => setSupplementsModal(prev => ({ ...prev, activeTab: 'disponibles' }))}
                    className={`flex-1 py-3 text-sm font-medium transition-colors ${supplementsModal.activeTab === 'disponibles' ? 'border-b-2 border-teal-600 text-teal-700' : 'text-gray-500 hover:text-gray-700'}`}
                  >
                    Disponibles
                    <span className="ml-1.5 inline-flex items-center justify-center w-5 h-5 text-xs font-bold rounded-full bg-gray-100 text-gray-600">
                      {available.length}
                    </span>
                  </button>
                )}
              </div>

              {/* Body */}
              <div className="flex-1 overflow-y-auto p-5">
                {/* Tab: Mis Suplementos */}
                {supplementsModal.activeTab === 'mis_suplementos' && (
                  <div className="space-y-3">
                    {mySupplements.length === 0 ? (
                      <p className="text-sm text-gray-500 text-center py-6">No tienes suplementos solicitados para esta reserva.</p>
                    ) : (
                      mySupplements.map((bs: any) => {
                        const sc = SUPP_STATUS[bs.status] || { label: bs.status, color: 'bg-gray-100 text-gray-500' };
                        const expectedAmount = Number(bs.unit_price || 0) * Number(bs.quantity || 1);
                        const canPay = bs.status === 'pending_payment' || bs.status === 'approved';
                        return (
                          <div key={bs.id} className="bg-gray-50 rounded-xl p-4 border border-gray-200">
                            <div className="flex items-start justify-between gap-3">
                              <div className="flex-1 min-w-0">
                                <p className="font-semibold text-gray-900 text-sm">
                                  {bs.tour_supplements?.name}
                                  <span className="font-normal text-gray-500 ml-1">× {bs.quantity}</span>
                                </p>
                                <span className={`inline-block mt-1 text-xs px-2 py-0.5 rounded-full ${sc.color}`}>{sc.label}</span>
                                {bs.rejection_note && (
                                  <p className="text-xs text-red-600 mt-1">Motivo: {bs.rejection_note}</p>
                                )}
                                {bs.status === 'cancelled' && bs.updated_at && (
                                  <p className="text-xs text-gray-400 mt-1">
                                    {format(new Date(bs.updated_at), 'dd/MM/yyyy HH:mm')}
                                  </p>
                                )}
                              </div>
                              <div className="text-right flex-shrink-0">
                                <p className="text-sm font-bold text-teal-700">
                                  {bs.status === 'paid'
                                    ? formatCurrencyMXN(Number(bs.total_paid))
                                    : bs.status === 'cancelled' || bs.status === 'rejected'
                                      ? null
                                      : formatCurrencyMXN(expectedAmount)}
                                </p>
                                {canPay && (
                                  <button
                                    onClick={() => handlePayExistingSupplement(bs, booking)}
                                    className="mt-2 btn btn-sm bg-teal-600 text-white hover:bg-teal-700 text-xs px-3 py-1.5"
                                  >
                                    Pagar
                                  </button>
                                )}
                              </div>
                            </div>
                          </div>
                        );
                      })
                    )}
                  </div>
                )}

                {/* Tab: Disponibles */}
                {supplementsModal.activeTab === 'disponibles' && (
                  <div className="space-y-3">
                    {available.length === 0 ? (
                      <p className="text-sm text-gray-500 text-center py-6">No hay suplementos disponibles para este tour.</p>
                    ) : (
                      <>
                        <p className="text-xs text-gray-500 mb-1">Extras que puedes agregar a tu reserva actual.</p>
                        {available.map((ts: any) => {
                          const activeCount = mySupplements.filter(
                            (bs: any) => bs.tour_supplement_id === ts.id && !['rejected', 'cancelled'].includes(bs.status)
                          ).length;
                          return (
                            <div key={ts.id} className="bg-gray-50 rounded-xl p-4 border border-gray-200">
                              <div className="flex items-start justify-between gap-3">
                                <div className="flex-1 min-w-0">
                                  <p className="font-semibold text-gray-900 text-sm">{ts.name}</p>
                                  {ts.description && <p className="text-xs text-gray-500 mt-0.5">{ts.description}</p>}
                                  <div className="flex flex-wrap items-center gap-2 mt-1.5">
                                    <span className="text-sm font-bold text-teal-700">{formatCurrencyMXN(Number(ts.price))} / unidad</span>
                                    {ts.requires_approval && (
                                      <span className="text-xs bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded">Requiere aprobacion</span>
                                    )}
                                    {!ts.is_cancellable && (
                                      <span className="text-xs bg-orange-100 text-orange-700 px-1.5 py-0.5 rounded">No cancelable</span>
                                    )}
                                  </div>
                                  {activeCount > 0 && (
                                    <p className="text-xs text-teal-600 mt-1">Ya tienes {activeCount} activo{activeCount > 1 ? 's' : ''}</p>
                                  )}
                                </div>
                                <button
                                  onClick={() => {
                                    setSupplementsModal(prev => ({ ...prev, open: false }));
                                    handleOpenSupplementRequest(booking, ts);
                                  }}
                                  className="btn btn-sm bg-teal-600 text-white hover:bg-teal-700 text-xs px-3 flex items-center gap-1 flex-shrink-0"
                                >
                                  <Plus className="w-3 h-3" />
                                  Solicitar
                                </button>
                              </div>
                            </div>
                          );
                        })}
                      </>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>
        );
      })()}

      {/* Direct Supplement Payment Modal */}
      {supplementDirectPayModal.open && supplementDirectPayModal.bookingSupplement && supplementDirectPayModal.booking && (() => {
        const bs = supplementDirectPayModal.bookingSupplement;
        const totalAmount = Number(bs.unit_price || 0) * Number(bs.quantity || 1);
        return (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-2xl shadow-xl max-w-md w-full max-h-[90vh] overflow-y-auto">
              <div className="p-6 border-b border-gray-100">
                <div className="flex items-center justify-between">
                  <h3 className="text-lg font-bold text-gray-900 flex items-center gap-2">
                    <Tag className="w-5 h-5 text-teal-600" />
                    Pagar Suplemento
                  </h3>
                  <button onClick={() => setSupplementDirectPayModal(prev => ({ ...prev, open: false }))} className="text-gray-400 hover:text-gray-600">
                    <X className="w-5 h-5" />
                  </button>
                </div>
              </div>

              <div className="p-6 space-y-4">
                <div className="bg-teal-50 rounded-xl p-4">
                  <p className="font-semibold text-gray-900">{bs.tour_supplements?.name}</p>
                  <p className="text-sm text-gray-500 mt-0.5">Cantidad: {bs.quantity}</p>
                  <p className="text-lg font-bold text-teal-700 mt-2">{formatCurrencyMXN(totalAmount)}</p>
                </div>

                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-2">Metodo de Pago</label>
                  <div className="space-y-2">
                    {[
                      { id: 'stripe', label: 'Tarjeta de credito / debito' },
                      { id: 'toursred_cash', label: `ToursRed Cash (Saldo: ${formatCurrencyMXN(supplementDirectPayModal.walletBalance)})` },
                      { id: 'points', label: `Puntos ToursRed (${supplementDirectPayModal.pointsBalance} pts = ${formatCurrencyMXN(supplementDirectPayModal.pointsValueMxn)})` },
                      { id: 'mercadopago', label: 'MercadoPago' },
                      { id: 'paypal', label: 'PayPal' },
                    ].map(method => (
                      <label key={method.id} className="flex items-center gap-2 cursor-pointer">
                        <input
                          type="radio"
                          name="direct_sup_payment_method"
                          value={method.id}
                          checked={supplementDirectPayModal.selectedMethod === method.id}
                          onChange={() => setSupplementDirectPayModal(prev => ({ ...prev, selectedMethod: method.id as any }))}
                          className="w-4 h-4 text-teal-600"
                        />
                        <span className="text-sm text-gray-700">{method.label}</span>
                      </label>
                    ))}
                  </div>
                </div>

                {supplementDirectPayModal.error && (
                  <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-700">
                    {supplementDirectPayModal.error}
                  </div>
                )}

                <div className="flex gap-3 pt-2">
                  <button
                    onClick={() => setSupplementDirectPayModal(prev => ({ ...prev, open: false }))}
                    className="btn btn-outline flex-1"
                    disabled={supplementDirectPayModal.isProcessing}
                  >
                    Cancelar
                  </button>
                  <button
                    onClick={handleProcessDirectSupplementPayment}
                    disabled={supplementDirectPayModal.isProcessing}
                    className="btn flex-1 bg-teal-600 text-white hover:bg-teal-700"
                  >
                    {supplementDirectPayModal.isProcessing ? 'Procesando...' : 'Confirmar y pagar'}
                  </button>
                </div>
              </div>
            </div>
          </div>
        );
      })()}

      {/* Extras Browse Modal */}
      {extrasModal.open && extrasModal.booking && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-xl max-w-lg w-full max-h-[90vh] flex flex-col">
            {/* Header */}
            <div className="p-5 border-b border-gray-100 flex items-center justify-between flex-shrink-0">
              <h3 className="text-lg font-bold text-gray-900 flex items-center gap-2">
                <ShoppingBag className="w-5 h-5 text-teal-600" />
                Extras para tu reserva
              </h3>
              <button onClick={() => setExtrasModal(prev => ({ ...prev, open: false }))} className="text-gray-400 hover:text-gray-600">
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Tabs */}
            <div className="flex border-b border-gray-100 flex-shrink-0">
              <button
                onClick={() => setExtrasModal(prev => ({ ...prev, activeTab: 'servicios' }))}
                className={`flex-1 py-3 text-sm font-medium transition-colors ${extrasModal.activeTab === 'servicios' ? 'border-b-2 border-teal-600 text-teal-700' : 'text-gray-500 hover:text-gray-700'}`}
              >
                Servicios Opcionales
              </button>
              {!isForeignTraveler && !(extrasModal.booking?.tours as any)?.includes_insurance && (
                <button
                  onClick={() => setExtrasModal(prev => ({ ...prev, activeTab: 'seguro' }))}
                  className={`flex-1 py-3 text-sm font-medium transition-colors ${extrasModal.activeTab === 'seguro' ? 'border-b-2 border-teal-600 text-teal-700' : 'text-gray-500 hover:text-gray-700'}`}
                >
                  Seguro de Viaje
                </button>
              )}
            </div>

            {/* Body */}
            <div className="flex-1 overflow-y-auto p-5">
              {extrasModal.isLoading ? (
                <div className="flex justify-center py-10">
                  <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-teal-600" />
                </div>
              ) : (
                <>
                  {extrasModal.activeTab === 'servicios' && (
                    <div className="space-y-3">
                      {extrasModal.tourOptionalServices.length === 0 ? (
                        <p className="text-sm text-gray-500 text-center py-8">No hay servicios opcionales disponibles para este tour.</p>
                      ) : (
                        extrasModal.tourOptionalServices.map((svc: any) => {
                          const alreadyAdded = extrasModal.existingBosIds.has(svc.id);
                          return (
                            <div key={svc.id} className={`rounded-xl p-4 border ${alreadyAdded ? 'bg-gray-50 border-gray-200 opacity-60' : 'bg-white border-gray-200 hover:border-teal-300 transition-colors'}`}>
                              <div className="flex items-start justify-between gap-3">
                                <div className="flex-1 min-w-0">
                                  <p className="font-semibold text-gray-900 text-sm">{svc.name}</p>
                                  {svc.description && <p className="text-xs text-gray-500 mt-0.5">{svc.description}</p>}
                                  <p className="text-sm font-bold text-teal-700 mt-1.5">{formatCurrencyMXN(Number(svc.price_per_person))} / persona</p>
                                </div>
                                {alreadyAdded ? (
                                  <span className="text-xs bg-green-100 text-green-700 px-2.5 py-1 rounded-full font-medium flex-shrink-0">Incluido</span>
                                ) : (
                                  <button
                                    onClick={() => handleOpenExtrasPayment('optional_service', svc, extrasModal.booking!)}
                                    className="btn btn-sm bg-teal-600 text-white hover:bg-teal-700 text-xs px-3 flex items-center gap-1 flex-shrink-0"
                                  >
                                    <Plus className="w-3 h-3" />
                                    Agregar
                                  </button>
                                )}
                              </div>
                            </div>
                          );
                        })
                      )}
                    </div>
                  )}

                  {extrasModal.activeTab === 'seguro' && (
                    <div>
                      {extrasModal.insuranceAlreadyBought ? (
                        <div className="flex flex-col items-center py-8 gap-3">
                          <div className="w-14 h-14 rounded-full bg-green-100 flex items-center justify-center">
                            <Shield className="w-7 h-7 text-green-600" />
                          </div>
                          <p className="font-semibold text-gray-900">Seguro de viaje incluido</p>
                          <p className="text-sm text-gray-500 text-center">Ya tienes el seguro de asistencia en viaje para esta reserva.</p>
                        </div>
                      ) : extrasModal.insurancePricePerDay > 0 && ['transport', 'experience', 'ticket'].includes((extrasModal.booking?.tours as any)?.activity_type) ? (
                        /* Standalone insurance for non-guided activities */
                        <div className="space-y-4">
                          <div className="bg-blue-50 rounded-xl p-4 border border-blue-100">
                            <div className="flex items-start gap-3">
                              <Shield className="w-6 h-6 text-blue-600 flex-shrink-0 mt-0.5" />
                              <div className="flex-1">
                                <p className="font-semibold text-gray-900">Seguro de asistencia en viaje</p>
                                <p className="text-sm text-gray-600 mt-1">Protege tu viaje con cobertura de asistencia medica y cancelacion.</p>
                              </div>
                            </div>
                          </div>

                          {/* Days selector */}
                          <div className="bg-gray-50 rounded-xl p-4 border border-gray-200">
                            <label className="block text-sm font-semibold text-gray-700 mb-2">Dias de cobertura</label>
                            <div className="flex items-center gap-3">
                              <button
                                onClick={() => {
                                  const days = Math.max(1, extrasModal.insuranceDays - 1);
                                  const cost = Math.round(extrasModal.insurancePricePerDay * days * Math.max(1, extrasModal.booking?.travelers_count || 1) * 100) / 100;
                                  setExtrasModal(prev => ({ ...prev, insuranceDays: days, insuranceCost: cost }));
                                }}
                                className="w-9 h-9 rounded-lg border border-gray-300 flex items-center justify-center text-gray-600 hover:bg-gray-100 font-bold text-lg"
                              >-</button>
                              <span className="text-2xl font-bold text-gray-900 min-w-[2rem] text-center">{extrasModal.insuranceDays}</span>
                              <button
                                onClick={() => {
                                  const days = Math.min(30, extrasModal.insuranceDays + 1);
                                  const cost = Math.round(extrasModal.insurancePricePerDay * days * Math.max(1, extrasModal.booking?.travelers_count || 1) * 100) / 100;
                                  setExtrasModal(prev => ({ ...prev, insuranceDays: days, insuranceCost: cost }));
                                }}
                                className="w-9 h-9 rounded-lg border border-gray-300 flex items-center justify-center text-gray-600 hover:bg-gray-100 font-bold text-lg"
                              >+</button>
                              <span className="text-sm text-gray-500 ml-1">dia(s) de cobertura</span>
                            </div>
                            <div className="mt-3 flex items-baseline gap-2">
                              <p className="text-xl font-bold text-blue-700">{formatCurrencyMXN(extrasModal.insuranceCost)}</p>
                              <p className="text-xs text-gray-500">({extrasModal.insuranceDays} dia(s) × {extrasModal.booking?.travelers_count || 1} viajero(s))</p>
                            </div>
                          </div>

                          {/* Insurer conditions */}
                          <div className="bg-amber-50 rounded-xl p-4 border border-amber-200">
                            <div className="flex items-start gap-2 mb-3">
                              <svg className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" /></svg>
                              <p className="text-sm font-semibold text-amber-800">Condiciones de la aseguradora</p>
                            </div>
                            <ul className="space-y-2">
                              <li className="flex items-start gap-2 text-sm text-amber-800">
                                <span className="mt-1 w-1.5 h-1.5 rounded-full bg-amber-600 flex-shrink-0" />
                                El seguro cubre a partir de los <strong>100 km</strong> de tu ciudad o lugar de origen donde vives.
                              </li>
                              <li className="flex items-start gap-2 text-sm text-amber-800">
                                <span className="mt-1 w-1.5 h-1.5 rounded-full bg-amber-600 flex-shrink-0" />
                                El seguro debe contratarse <strong>antes de iniciar el viaje</strong>. No aplica si ya te encuentras en traslado.
                              </li>
                              <li className="flex items-start gap-2 text-sm text-amber-800">
                                <span className="mt-1 w-1.5 h-1.5 rounded-full bg-amber-600 flex-shrink-0" />
                                No aplica si la experiencia o evento es <strong>dentro de tu ciudad de origen</strong>.
                              </li>
                            </ul>
                          </div>

                          {/* Acceptance checkbox */}
                          <label className="flex items-start gap-3 cursor-pointer">
                            <input
                              type="checkbox"
                              checked={extrasModal.insuranceConditionsAccepted}
                              onChange={e => setExtrasModal(prev => ({ ...prev, insuranceConditionsAccepted: e.target.checked }))}
                              className="mt-0.5 w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                            />
                            <span className="text-sm text-gray-700">He leido y acepto las condiciones de la aseguradora. Confirmo que este seguro aplica para mi situacion de viaje.</span>
                          </label>

                          <button
                            onClick={() => handleOpenExtrasPayment('insurance', { name: 'Seguro de viaje', price: extrasModal.insuranceCost }, extrasModal.booking!)}
                            disabled={!extrasModal.insuranceConditionsAccepted}
                            className="w-full btn bg-blue-600 text-white hover:bg-blue-700 flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                          >
                            <Shield className="w-4 h-4" />
                            Contratar seguro
                          </button>
                        </div>
                      ) : extrasModal.insuranceCost > 0 ? (
                        <div className="space-y-4">
                          <div className="bg-blue-50 rounded-xl p-4 border border-blue-100">
                            <div className="flex items-start gap-3">
                              <Shield className="w-6 h-6 text-blue-600 flex-shrink-0 mt-0.5" />
                              <div>
                                <p className="font-semibold text-gray-900">Seguro de asistencia en viaje</p>
                                <p className="text-sm text-gray-600 mt-1">Protege tu viaje con cobertura de asistencia medica y cancelacion.</p>
                                <p className="text-xl font-bold text-blue-700 mt-3">{formatCurrencyMXN(extrasModal.insuranceCost)}</p>
                                <p className="text-xs text-gray-500">Total para {(extrasModal.booking as any)?.travelers_count || 1} viajero(s)</p>
                              </div>
                            </div>
                          </div>
                          <button
                            onClick={() => handleOpenExtrasPayment('insurance', { name: 'Seguro de viaje', price: extrasModal.insuranceCost }, extrasModal.booking!)}
                            className="w-full btn bg-blue-600 text-white hover:bg-blue-700 flex items-center justify-center gap-2"
                          >
                            <Shield className="w-4 h-4" />
                            Contratar seguro
                          </button>
                        </div>
                      ) : (
                        <p className="text-sm text-gray-500 text-center py-8">El seguro de viaje no esta disponible para esta reserva.</p>
                      )}
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Extras Payment Modal */}
      {extrasPaymentModal.open && extrasPaymentModal.item && extrasPaymentModal.booking && (() => {
        const isService = extrasPaymentModal.type === 'optional_service';
        const unitPrice = isService ? Number(extrasPaymentModal.item.price_per_person) : Number(extrasPaymentModal.item.price);
        const totalAmount = isService ? unitPrice * extrasPaymentModal.quantity : unitPrice;
        return (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-2xl shadow-xl max-w-md w-full max-h-[90vh] overflow-y-auto">
              <div className="p-6 border-b border-gray-100">
                <div className="flex items-center justify-between">
                  <h3 className="text-lg font-bold text-gray-900 flex items-center gap-2">
                    {isService ? <ShoppingBag className="w-5 h-5 text-teal-600" /> : <Shield className="w-5 h-5 text-blue-600" />}
                    {isService ? 'Agregar servicio' : 'Contratar seguro'}
                  </h3>
                  <button
                    onClick={() => {
                      setExtrasPaymentModal(prev => ({ ...prev, open: false }));
                      setExtrasModal(prev => ({ ...prev, open: true }));
                    }}
                    className="text-gray-400 hover:text-gray-600"
                  >
                    <X className="w-5 h-5" />
                  </button>
                </div>
              </div>

              <div className="p-6 space-y-4">
                <div className={`rounded-xl p-4 ${isService ? 'bg-teal-50' : 'bg-blue-50'}`}>
                  <p className="font-semibold text-gray-900">{extrasPaymentModal.item.name}</p>
                  {isService && (
                    <div className="flex items-center gap-3 mt-2">
                      <label className="text-sm text-gray-600">Cantidad:</label>
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => setExtrasPaymentModal(prev => ({ ...prev, quantity: Math.max(1, prev.quantity - 1) }))}
                          className="w-7 h-7 rounded-full border border-gray-300 flex items-center justify-center text-gray-600 hover:bg-gray-100"
                          disabled={extrasPaymentModal.quantity <= 1}
                        >-</button>
                        <span className="text-sm font-semibold w-6 text-center">{extrasPaymentModal.quantity}</span>
                        <button
                          onClick={() => setExtrasPaymentModal(prev => ({ ...prev, quantity: prev.quantity + 1 }))}
                          className="w-7 h-7 rounded-full border border-gray-300 flex items-center justify-center text-gray-600 hover:bg-gray-100"
                        >+</button>
                      </div>
                    </div>
                  )}
                  <p className={`text-lg font-bold mt-2 ${isService ? 'text-teal-700' : 'text-blue-700'}`}>{formatCurrencyMXN(totalAmount)}</p>
                </div>

                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-2">Metodo de pago</label>
                  <div className="space-y-2">
                    {[
                      { id: 'stripe', label: 'Tarjeta de credito / debito' },
                      { id: 'toursred_cash', label: `ToursRed Cash (Saldo: ${formatCurrencyMXN(extrasPaymentModal.walletBalance)})` },
                      { id: 'points', label: `Puntos ToursRed (${extrasPaymentModal.pointsBalance} pts = ${formatCurrencyMXN(extrasPaymentModal.pointsValueMxn)})` },
                      { id: 'mercadopago', label: 'MercadoPago' },
                      { id: 'paypal', label: 'PayPal' },
                    ].map(method => (
                      <label key={method.id} className="flex items-center gap-2 cursor-pointer">
                        <input
                          type="radio"
                          name="extras_payment_method"
                          value={method.id}
                          checked={extrasPaymentModal.selectedMethod === method.id}
                          onChange={() => setExtrasPaymentModal(prev => ({ ...prev, selectedMethod: method.id as any }))}
                          className="w-4 h-4 text-teal-600"
                        />
                        <span className="text-sm text-gray-700">{method.label}</span>
                      </label>
                    ))}
                  </div>
                </div>

                {extrasPaymentModal.error && (
                  <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-700">
                    {extrasPaymentModal.error}
                  </div>
                )}

                <div className="flex gap-3 pt-2">
                  <button
                    onClick={() => {
                      setExtrasPaymentModal(prev => ({ ...prev, open: false }));
                      setExtrasModal(prev => ({ ...prev, open: true }));
                    }}
                    className="btn btn-outline flex-1"
                    disabled={extrasPaymentModal.isProcessing}
                  >
                    Volver
                  </button>
                  <button
                    onClick={handleProcessExtrasPayment}
                    disabled={extrasPaymentModal.isProcessing}
                    className={`btn flex-1 text-white ${isService ? 'bg-teal-600 hover:bg-teal-700' : 'bg-blue-600 hover:bg-blue-700'}`}
                  >
                    {extrasPaymentModal.isProcessing ? 'Procesando...' : 'Confirmar y pagar'}
                  </button>
                </div>
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
};

export default TravelerBookings;