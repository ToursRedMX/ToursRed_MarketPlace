import React, { useState, useEffect } from 'react';
import { Calendar, MapPin, Users, DollarSign, Clock, Eye, Mail, Phone, CheckCircle, XCircle, AlertCircle, Search, Filter, Star, X, User, MessageSquare, UserCheck, UserX, FileSpreadsheet, FileText, Download, QrCode, Car, Globe, Send, Tag, AlertTriangle } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { formatCurrency, formatCurrencyMXN } from '../../utils/formatCurrency';
import { getAgencyBookings, getTourBookingReport, supabase, parseDateFromDB } from '../../lib/supabase';
import PaymentPlanCalendar from '../../components/PaymentPlanCalendar';
import { Booking } from '../../types';
import { format } from 'date-fns';
import { Link, useNavigate } from 'react-router-dom';
import ReviewForm from '../../components/ReviewForm';
import { exportTourReportToExcel, exportTourReportToPDF } from '../../utils/reportExports';
import TourMassMessageModal from '../../components/TourMassMessageModal';
import { useAgencyId } from '../../hooks/useAgencyId';

const AgencyBookings: React.FC = () => {
  const { user } = useAuth();
  const { agencyId: resolvedAgencyId, loading: agencyLoading } = useAgencyId();
  const navigate = useNavigate();
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'pending' | 'confirmed' | 'completed' | 'cancelled'>('all');
  const [agencyId, setAgencyId] = useState<string | null>(null);
  const [reviewModal, setReviewModal] = useState<{
    open: boolean;
    booking: Booking | null;
    existingReview: any;
  }>({ open: false, booking: null, existingReview: null });
  const [contactModal, setContactModal] = useState<{
    open: boolean;
    booking: Booking | null;
  }>({ open: false, booking: null });
  const [travelersModal, setTravelersModal] = useState<{
    open: boolean;
    booking: Booking | null;
    travelers: any[];
  }>({ open: false, booking: null, travelers: [] });
  const [cancelBookingModal, setCancelBookingModal] = useState<{
    open: boolean;
    booking: Booking | null;
    isSubmitting: boolean;
    reason: string;
  }>({ open: false, booking: null, isSubmitting: false, reason: '' });
  const [activeTab, setActiveTab] = useState<'bookings' | 'reports' | 'messages'>('bookings');
  const [massMessageModal, setMassMessageModal] = useState<{
    open: boolean;
    preselectedTourId?: string | null;
    preselectedSlotId?: string | null;
  }>({ open: false });
  const [sentMessages, setSentMessages] = useState<any[]>([]);
  const [isLoadingMessages, setIsLoadingMessages] = useState(false);
  const [bookingOptionalServices, setBookingOptionalServices] = useState<Record<string, any[]>>({});
  const [bookingSupplements, setBookingSupplements] = useState<Record<string, any[]>>({});
  const [supplementAction, setSupplementAction] = useState<{
    type: 'approve' | 'reject';
    supplementId: string;
    isSubmitting: boolean;
    rejectionNote: string;
  } | null>(null);
  const [availableTours, setAvailableTours] = useState<any[]>([]);
  const [selectedTourForReport, setSelectedTourForReport] = useState<string>('');
  const [reportData, setReportData] = useState<any>(null);
  const [isLoadingReport, setIsLoadingReport] = useState(false);
  const [agencyName, setAgencyName] = useState<string>('');
  const [bookingTab, setBookingTab] = useState<'activas' | 'pasadas' | 'canceladas'>('activas');
  const [activeBookings, setActiveBookings] = useState<Booking[]>([]);
  const [pastBookings, setPastBookings] = useState<Booking[]>([]);
  const [cancelledBookings, setCancelledBookings] = useState<Booking[]>([]);

  useEffect(() => {
    if (!agencyLoading && resolvedAgencyId) {
      fetchAgencyData(resolvedAgencyId);
    } else if (!agencyLoading && !resolvedAgencyId) {
      setError('No se encontró perfil de agencia para este usuario');
      setIsLoading(false);
    }
  }, [resolvedAgencyId, agencyLoading]);

  const isBookingActive = (booking: any): boolean => {
    if (booking.status === 'cancelled' || booking.status === 'cancellation_processing') return false;
    const dateStr = booking.selected_date || booking.tours?.end_date;
    if (!dateStr) return true;
    try {
      const d = dateStr.includes('T') ? new Date(dateStr) : parseDateFromDB(dateStr);
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      d.setHours(0, 0, 0, 0);
      return d >= today;
    } catch {
      return true;
    }
  };

  const fetchAgencyData = async (currentAgencyId: string) => {
    try {
      setIsLoading(true);
      setError('');

      const { data: agencyMeta } = await supabase
        .from('agencies')
        .select('name')
        .eq('id', currentAgencyId)
        .maybeSingle();

      setAgencyId(currentAgencyId);
      setAgencyName(agencyMeta?.name ?? '');

      const { data: bookingsData, error: bookingsError } = await getAgencyBookings(currentAgencyId);

      if (bookingsError) {
        throw new Error(bookingsError.message);
      }

      const allBookings = bookingsData || [];
      setBookings(allBookings);

      const active = allBookings.filter((b: any) => isBookingActive(b));
      const past = allBookings.filter((b: any) => b.status !== 'cancelled' && b.status !== 'cancellation_processing' && !isBookingActive(b));
      const cancelled = allBookings.filter((b: any) => b.status === 'cancelled' || b.status === 'cancellation_processing');
      setActiveBookings(active);
      setPastBookings(past);
      setCancelledBookings(cancelled);

      if (allBookings.length > 0) {
        const ids = allBookings.map((b: any) => b.id);
        const { data: optSvcs } = await supabase
          .from('booking_optional_services')
          .select(`*, tour_optional_services(name, is_refundable)`)
          .in('booking_id', ids);

        if (optSvcs) {
          const grouped: Record<string, any[]> = {};
          for (const bos of optSvcs) {
            if (!grouped[bos.booking_id]) grouped[bos.booking_id] = [];
            grouped[bos.booking_id].push(bos);
          }
          setBookingOptionalServices(grouped);
        }

        const { data: suppData } = await supabase
          .from('booking_supplements')
          .select(`*, tour_supplements(name, is_cancellable, requires_approval)`)
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
      }

      const { data: toursData, error: toursError } = await supabase
        .from('tours')
        .select('id, name, destination, start_date, end_date, tour_type')
        .eq('agency_id', currentAgencyId)
        .order('start_date', { ascending: false })
        .limit(50);

      if (!toursError && toursData) {
        const toursWithBookings = await Promise.all(
          toursData.map(async (tour) => {
            const { count } = await supabase
              .from('bookings')
              .select('id', { count: 'exact', head: true })
              .eq('tour_id', tour.id)
              .in('status', ['confirmed', 'completed', 'pending'])
              .in('approval_status', ['approved', 'pending']);

            return { ...tour, bookingsCount: count || 0 };
          })
        );

        const toursFiltered = toursWithBookings.filter(t => t.bookingsCount > 0);
        setAvailableTours(toursFiltered);
      }

    } catch (err: any) {
      console.error('❌ Error cargando reservas de agencia:', err);
      setError(err.message || 'Error al cargar las reservas');
    } finally {
      setIsLoading(false);
    }
  };

  // Helper function to format dates consistently
  const formatDate = (dateString: string) => {
    try {
      // Check if it's a full ISO 8601 timestamp (contains 'T')
      const date = dateString.includes('T') 
        ? new Date(dateString) 
        : parseDateFromDB(dateString);
      return format(date, 'dd/MM/yyyy');
    } catch (error) {
      console.error('Error formatting date:', dateString, error);
      return format(new Date(dateString), 'dd/MM/yyyy');
    }
  };

  const formatFullDate = (dateString: string) => {
    try {
      // Check if it's a full ISO 8601 timestamp (contains 'T')
      const date = dateString.includes('T')
        ? new Date(dateString)
        : parseDateFromDB(dateString);
      return format(date, 'EEEE, d \'de\' MMMM \'de\' yyyy');
    } catch (error) {
      console.error('Error formatting full date:', dateString, error);
      return format(new Date(dateString), 'dd/MM/yyyy');
    }
  };

  const canMarkAsNoShow = (booking: Booking) => {
    if (!booking.tours?.start_date) return false;
    if ((booking as any).is_no_show) return false;
    if ((booking as any).cancelled_at) return false;
    if (booking.status !== 'confirmed') return false;

    try {
      const tourStartDate = parseDateFromDB(booking.tours.start_date);
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      tourStartDate.setHours(0, 0, 0, 0);

      return tourStartDate <= today;
    } catch (error) {
      console.error('Error validating No Show eligibility:', error);
      return false;
    }
  };

  const canMarkAsCompleted = (booking: Booking) => {
    if (!booking.tours?.start_date) return false;
    if (booking.status !== 'confirmed') return false;
    if ((booking as any).is_no_show) return false;
    if ((booking as any).cancelled_at) return false;

    try {
      const tourStartDate = parseDateFromDB(booking.tours.start_date);
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      tourStartDate.setHours(0, 0, 0, 0);

      return tourStartDate <= today;
    } catch (error) {
      console.error('Error validating completion eligibility:', error);
      return false;
    }
  };

  const canReviewTraveler = (booking: Booking) => {
    if (booking.status !== 'completed') return false;
    if ((booking as any).is_no_show) return false;
    if ((booking as any).cancelled_at) return false;

    return true;
  };

  const getStatusBadge = (status: string, paymentStatus?: string) => {
    let statusText = '';
    let statusClass = '';
    let icon = null;

    switch (status) {
      case 'pending':
        statusText = paymentStatus === 'succeeded' ? 'Confirmando' : 'Pendiente';
        statusClass = 'bg-yellow-100 text-yellow-800';
        icon = <AlertCircle className="h-3 w-3 mr-1" />;
        break;
      case 'confirmed':
        statusText = 'Confirmada';
        statusClass = 'bg-green-100 text-green-800';
        icon = <CheckCircle className="h-3 w-3 mr-1" />;
        break;
      case 'completed':
        statusText = 'Completada';
        statusClass = 'bg-blue-100 text-blue-800';
        icon = <CheckCircle className="h-3 w-3 mr-1" />;
        break;
      case 'cancelled':
        statusText = 'Cancelada';
        statusClass = 'bg-red-100 text-red-800';
        icon = <XCircle className="h-3 w-3 mr-1" />;
        break;
      default:
        statusText = status;
        statusClass = 'bg-gray-100 text-gray-800';
    }

    return (
      <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${statusClass}`}>
        {icon}
        {statusText}
      </span>
    );
  };

  const getApprovalStatusBadge = (approvalStatus?: string) => {
    if (!approvalStatus) return null;

    let statusText = '';
    let statusClass = '';
    let icon = null;

    switch (approvalStatus) {
      case 'pending':
        statusText = 'Pendiente Aprobación';
        statusClass = 'bg-yellow-100 text-yellow-800';
        icon = <Clock className="h-3 w-3 mr-1" />;
        break;
      case 'approved':
        statusText = 'Aprobada';
        statusClass = 'bg-green-100 text-green-800';
        icon = <CheckCircle className="h-3 w-3 mr-1" />;
        break;
      case 'rejected':
        statusText = 'Rechazada';
        statusClass = 'bg-red-100 text-red-800';
        icon = <XCircle className="h-3 w-3 mr-1" />;
        break;
      default:
        return null;
    }

    return (
      <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${statusClass} ml-2`}>
        {icon}
        {statusText}
      </span>
    );
  };

  const updateBookingInAllArrays = (bookingId: string, updater: (b: Booking) => Booking) => {
    setBookings(prev => prev.map(b => b.id === bookingId ? updater(b) : b));
    setActiveBookings(prev => prev.map(b => b.id === bookingId ? updater(b) : b));
    setPastBookings(prev => prev.map(b => b.id === bookingId ? updater(b) : b));
    setCancelledBookings(prev => prev.map(b => b.id === bookingId ? updater(b) : b));
  };

  const handleApprovalAction = async (bookingId: string, action: 'approve' | 'reject', notes?: string) => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error('No hay sesión activa');

      const response = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/approve-booking`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${session.access_token}`,
          },
          body: JSON.stringify({ booking_id: bookingId, action, notes }),
        }
      );

      const result = await response.json();
      if (!response.ok || !result.success) {
        throw new Error(result.error || `Error al ${action === 'approve' ? 'aprobar' : 'rechazar'} la reserva`);
      }

      const approvalStatus = action === 'approve' ? 'approved' : 'rejected';
      const now = new Date().toISOString();

      // Actualizar el estado local
      updateBookingInAllArrays(bookingId, booking => ({
        ...booking,
        approval_status: approvalStatus as any,
        approval_notes: notes || null,
        approved_at: action === 'approve' ? now : null,
        approved_by: user?.id,
        ...(result.auto_confirmed ? {
          payment_status: 'succeeded',
          status: 'confirmed',
        } : {}),
      }));

      // Enviar email de notificación al viajero
      try {
        await fetch(
          `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/send-booking-approval-notification`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${session.access_token}`,
            },
            body: JSON.stringify({
              booking_id: bookingId,
              approved: action === 'approve',
              rejection_reason: notes,
              auto_confirmed: result.auto_confirmed ?? false,
            }),
          }
        );
      } catch (emailError) {
        console.error('Error enviando notificación al viajero:', emailError);
      }

      // Recargar la lista de tours disponibles para que aparezca el tour recién aprobado
      if (action === 'approve' && resolvedAgencyId) {
        const { data: toursData, error: toursError } = await supabase
          .from('tours')
          .select('id, name, destination, start_date, end_date, tour_type')
          .eq('agency_id', resolvedAgencyId)
          .order('start_date', { ascending: false })
          .limit(50);

        if (!toursError && toursData) {
          const toursWithBookings = await Promise.all(
            toursData.map(async (tour) => {
              const { count } = await supabase
                .from('bookings')
                .select('id', { count: 'exact', head: true })
                .eq('tour_id', tour.id)
                .in('status', ['confirmed', 'completed', 'pending'])
                .in('approval_status', ['approved', 'pending']);
              return { ...tour, bookingsCount: count || 0 };
            })
          );
          setAvailableTours(toursWithBookings.filter(t => t.bookingsCount > 0));
        }
      }

      console.log(`✅ Reserva ${bookingId} ${action === 'approve' ? 'aprobada' : 'rechazada'}${result.auto_confirmed ? ' y confirmada automáticamente' : ''}`);
    } catch (err: any) {
      console.error(`❌ Error ${action === 'approve' ? 'aprobando' : 'rechazando'} reserva:`, err);
      setError(err.message || `Error al ${action === 'approve' ? 'aprobar' : 'rechazar'} la reserva`);
    }
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

  const handleStatusUpdate = async (bookingId: string, newStatus: string) => {
    try {
      if (newStatus === 'completed') {
        const booking = bookings.find(b => b.id === bookingId);
        if (!booking) {
          alert('No se encontró la reserva');
          return;
        }

        if (!canMarkAsCompleted(booking)) {
          alert('Solo puedes marcar como completada el día del viaje o después. El tour aún no ha ocurrido.');
          return;
        }
      }

      const { error } = await supabase
        .from('bookings')
        .update({
          status: newStatus,
          updated_at: new Date().toISOString()
        })
        .eq('id', bookingId);

      if (error) {
        throw new Error(error.message);
      }

      // Actualizar el estado local
      updateBookingInAllArrays(bookingId, booking => ({ ...booking, status: newStatus as any }));

      console.log(`✅ Estado de reserva ${bookingId} actualizado a:`, newStatus);
    } catch (err: any) {
      console.error('❌ Error actualizando estado de reserva:', err);
      setError(err.message || 'Error al actualizar el estado de la reserva');
    }
  };

  const handleMarkNoShow = async (bookingId: string) => {
    const booking = bookings.find(b => b.id === bookingId);
    if (!booking) {
      alert('No se encontró la reserva');
      return;
    }

    if (!canMarkAsNoShow(booking)) {
      alert('Solo puedes marcar como No Show el día del viaje o después. Aún no ha llegado la fecha del tour.');
      return;
    }

    if (!confirm('¿Confirmas que el viajero NO se presentó a este tour?\n\nEsto incrementará el contador de No Show del viajero. Si acumula más de 3 No Shows, se le cobrará el 100% en futuras reservas.')) {
      return;
    }

    try {
      const { error } = await supabase
        .from('bookings')
        .update({
          is_no_show: true,
          no_show_marked_at: new Date().toISOString(),
          no_show_marked_by: user?.id,
          updated_at: new Date().toISOString()
        })
        .eq('id', bookingId);

      if (error) {
        throw new Error(error.message);
      }

      // Actualizar el estado local
      updateBookingInAllArrays(bookingId, booking => ({
        ...booking,
        is_no_show: true,
        no_show_marked_at: new Date().toISOString(),
        no_show_marked_by: user?.id
      }));

      console.log(`✅ Reserva ${bookingId} marcada como No Show`);

      // Enviar email de notificación al viajero
      try {
        const { data: { session } } = await supabase.auth.getSession();

        if (session) {
          const response = await fetch(
            `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/send-no-show-notification`,
            {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${session.access_token}`,
              },
              body: JSON.stringify({
                booking_id: bookingId,
              }),
            }
          );

          const result = await response.json();

          if (result.success) {
            console.log('✅ Email de notificación de No Show enviado al viajero');
          } else {
            console.warn('⚠️ No se pudo enviar el email de notificación:', result);
          }
        }
      } catch (emailError: any) {
        console.error('❌ Error enviando email de notificación:', emailError);
        // No lanzamos error aquí porque el No Show ya fue registrado
      }

      alert('El viajero ha sido marcado como No Show. Su contador ha sido actualizado y se le ha notificado por email.');
    } catch (err: any) {
      console.error('❌ Error marcando No Show:', err);
      setError(err.message || 'Error al marcar como No Show');
    }
  };

  const handleOpenReviewModal = async (booking: Booking) => {
    if (!agencyId) return;

    try {
      const { data: existingReview } = await supabase
        .from('traveler_reviews')
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
    if (resolvedAgencyId) fetchAgencyData(resolvedAgencyId);
  };

  const handleOpenContactModal = (booking: Booking) => {
    setContactModal({ open: true, booking });
  };

  const handleCloseContactModal = () => {
    setContactModal({ open: false, booking: null });
  };

  const handleSendMessage = async (booking: Booking) => {
    if (!booking.users?.id || !agencyId) return;

    const { data: existingConversation } = await supabase
      .from('conversations')
      .select('id')
      .or(`and(user1_id.eq.${agencyId},user2_id.eq.${booking.users.id}),and(user1_id.eq.${booking.users.id},user2_id.eq.${agencyId})`)
      .maybeSingle();

    if (existingConversation) {
      navigate(`/messages?conversation=${existingConversation.id}`);
    } else {
      navigate(`/messages?newConversation=${booking.users.id}`);
    }
    handleCloseContactModal();
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

  const handleOpenCancelBookingModal = (booking: Booking) => {
    if (booking.cancelled_at || booking.status === 'cancelled' || booking.status === 'cancellation_processing') {
      alert('Esta reserva ya fue cancelada o está en proceso de cancelación');
      return;
    }

    if (!['confirmed', 'pending'].includes(booking.status) || booking.payment_status !== 'succeeded') {
      alert('Solo se pueden cancelar reservas confirmadas o pendientes con pago exitoso');
      return;
    }

    const tourStartDate = new Date(booking.tours?.start_date || '');
    const now = new Date();
    tourStartDate.setHours(0, 0, 0, 0);
    now.setHours(0, 0, 0, 0);

    if (tourStartDate <= now) {
      alert('No se puede cancelar una reserva de un tour que ya inició');
      return;
    }

    setCancelBookingModal({ open: true, booking, isSubmitting: false, reason: '' });
  };

  const handleCloseCancelBookingModal = () => {
    setCancelBookingModal({ open: false, booking: null, isSubmitting: false, reason: '' });
  };

  const handleCancelBookingReasonChange = (reason: string) => {
    setCancelBookingModal(prev => ({ ...prev, reason }));
  };

  const handleSubmitCancelBooking = async () => {
    if (!cancelBookingModal.booking) return;

    if (cancelBookingModal.reason.trim().length < 50) {
      alert('El motivo de cancelación debe tener al menos 50 caracteres');
      return;
    }

    if (!confirm('¿Estás seguro de cancelar esta reserva?\n\nEl viajero recibirá un reembolso del 100% en su ToursRed Cash y tú no recibirás comisión por esta reserva.\n\nEsta acción no se puede deshacer.')) {
      return;
    }

    try {
      setCancelBookingModal(prev => ({ ...prev, isSubmitting: true }));

      const { data: { session } } = await supabase.auth.getSession();

      if (!session) {
        throw new Error('No hay sesión activa');
      }

      const response = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/process-agency-booking-cancellation`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${session.access_token}`,
          },
          body: JSON.stringify({
            booking_id: cancelBookingModal.booking.id,
            cancellation_reason: cancelBookingModal.reason.trim()
          }),
        }
      );

      const result = await response.json();

      if (!result.success) {
        throw new Error(result.error || 'Error al cancelar la reserva');
      }

      alert(`Reserva cancelada exitosamente.\n\nEl viajero ha recibido un reembolso de $${formatCurrency(result.refund_amount ?? 0)} en su ToursRed Cash.`);

      handleCloseCancelBookingModal();
      if (resolvedAgencyId) fetchAgencyData(resolvedAgencyId);

    } catch (err: any) {
      console.error('Error cancelando reserva:', err);
      alert(err.message || 'Error al cancelar la reserva');
      setCancelBookingModal(prev => ({ ...prev, isSubmitting: false }));
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

  const handleGenerateReport = async () => {
    if (!selectedTourForReport || !agencyId) {
      alert('Por favor selecciona un tour');
      return;
    }

    try {
      setIsLoadingReport(true);
      const { data, error } = await getTourBookingReport(selectedTourForReport, agencyId);

      if (error || !data) {
        throw new Error(error?.message || 'Error al generar reporte');
      }

      setReportData(data);
    } catch (err: any) {
      console.error('Error generating report:', err);
      alert(err.message || 'Error al generar el reporte');
    } finally {
      setIsLoadingReport(false);
    }
  };

  const handleExportExcel = () => {
    if (!reportData) {
      alert('Primero genera el reporte');
      return;
    }
    exportTourReportToExcel(reportData, agencyName);
  };

  const handleExportPDF = () => {
    if (!reportData) {
      alert('Primero genera el reporte');
      return;
    }
    exportTourReportToPDF(reportData, agencyName);
  };

  const handleApproveSupplementRequest = async (supplementId: string) => {
    setSupplementAction({ type: 'approve', supplementId, isSubmitting: true, rejectionNote: '' });
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/approve-supplement`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session?.access_token}`,
          'Apikey': import.meta.env.VITE_SUPABASE_ANON_KEY,
        },
        body: JSON.stringify({ booking_supplement_id: supplementId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Error aprobando suplemento');

      setBookingSupplements(prev => {
        const updated = { ...prev };
        for (const bookingId in updated) {
          updated[bookingId] = updated[bookingId].map(s =>
            s.id === supplementId ? { ...s, status: 'approved' } : s
          );
        }
        return updated;
      });
    } catch (err: any) {
      alert(`Error: ${err.message}`);
    } finally {
      setSupplementAction(null);
    }
  };

  const handleRejectSupplementRequest = async (supplementId: string, note: string) => {
    setSupplementAction(prev => prev ? { ...prev, isSubmitting: true } : null);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/reject-supplement`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session?.access_token}`,
          'Apikey': import.meta.env.VITE_SUPABASE_ANON_KEY,
        },
        body: JSON.stringify({ booking_supplement_id: supplementId, rejection_note: note }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Error rechazando suplemento');

      setBookingSupplements(prev => {
        const updated = { ...prev };
        for (const bookingId in updated) {
          updated[bookingId] = updated[bookingId].map(s =>
            s.id === supplementId ? { ...s, status: 'rejected', rejection_note: note } : s
          );
        }
        return updated;
      });
    } catch (err: any) {
      alert(`Error: ${err.message}`);
    } finally {
      setSupplementAction(null);
    }
  };

  const fetchSentMessages = async () => {
    if (!agencyId) return;
    setIsLoadingMessages(true);
    try {
      const { data, error } = await supabase
        .from('agency_tour_messages')
        .select(`
          id, subject, message_body, recipients_count, success_count, error_count, status, created_at, slot_id,
          tours(name, destination),
          tour_slots(slot_date, departure_time)
        `)
        .eq('agency_id', agencyId)
        .order('created_at', { ascending: false })
        .limit(50);

      if (!error) setSentMessages(data || []);
    } catch (err) {
      console.error('Error loading sent messages:', err);
    } finally {
      setIsLoadingMessages(false);
    }
  };

  useEffect(() => {
    if (activeTab === 'messages' && agencyId) {
      fetchSentMessages();
    }
  }, [activeTab, agencyId]);

  // Filtrar reservas según sub-tab activo
  const currentTabBookings =
    bookingTab === 'activas' ? activeBookings :
    bookingTab === 'pasadas' ? pastBookings :
    cancelledBookings;

  const filteredBookings = currentTabBookings.filter(booking => {
    const matchesSearch =
      booking.tours?.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      booking.tours?.destination.toLowerCase().includes(searchTerm.toLowerCase()) ||
      booking.users?.first_name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      booking.users?.last_name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      booking.users?.email?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      booking.id.toLowerCase().includes(searchTerm.toLowerCase());

    const matchesStatus = bookingTab === 'canceladas' || statusFilter === 'all' || booking.status === statusFilter;

    return matchesSearch && matchesStatus;
  });

  // Estadísticas
  const stats = {
    total: bookings.length,
    confirmed: bookings.filter(b => b.status === 'confirmed').length,
    pending: bookings.filter(b => b.status === 'pending').length,
    completed: bookings.filter(b => b.status === 'completed').length,
    totalRevenue: bookings
      .filter(b => b.payment_status === 'succeeded')
      .reduce((sum, b) => sum + (b.deposit_amount || 0), 0),
    activas: activeBookings.length,
    pasadas: pastBookings.length,
    canceladas: cancelledBookings.length,
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
          <h1 className="text-3xl font-bold">Gestionar Reservas</h1>
          <p className="text-gray-600 mt-1">
            {bookings.length === 0
              ? 'No tienes reservas aún'
              : `${bookings.length} ${bookings.length === 1 ? 'reserva' : 'reservas'} en total`
            }
          </p>
        </div>
        <button
          onClick={() => setMassMessageModal({ open: true })}
          className="btn btn-primary flex items-center gap-2"
        >
          <Send className="h-4 w-4" />
          Mensaje a Asistentes
        </button>
      </div>

      {/* Tabs */}
      <div className="mb-6 border-b border-gray-200">
        <nav className="-mb-px flex space-x-8">
          <button
            onClick={() => setActiveTab('bookings')}
            className={`py-4 px-1 border-b-2 font-medium text-sm ${
              activeTab === 'bookings'
                ? 'border-primary-500 text-primary-600'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
            }`}
          >
            <Users className="inline-block h-5 w-5 mr-2" />
            Reservas
          </button>
          <button
            onClick={() => setActiveTab('reports')}
            className={`py-4 px-1 border-b-2 font-medium text-sm ${
              activeTab === 'reports'
                ? 'border-primary-500 text-primary-600'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
            }`}
          >
            <FileText className="inline-block h-5 w-5 mr-2" />
            Reportes por Tour
          </button>
          <button
            onClick={() => setActiveTab('messages')}
            className={`py-4 px-1 border-b-2 font-medium text-sm ${
              activeTab === 'messages'
                ? 'border-primary-500 text-primary-600'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
            }`}
          >
            <Send className="inline-block h-5 w-5 mr-2" />
            Mensajes Enviados
          </button>
        </nav>
      </div>

      {error && (
        <div className="mb-6 bg-error-50 text-error-600 p-4 rounded-md flex items-start">
          <AlertCircle className="h-5 w-5 mr-2 mt-0.5 flex-shrink-0" />
          <div>
            <p className="font-medium">Error al cargar reservas</p>
            <p className="text-sm">{error}</p>
            <button
              onClick={() => resolvedAgencyId && fetchAgencyData(resolvedAgencyId)}
              className="text-sm underline mt-1 hover:no-underline"
            >
              Intentar de nuevo
            </button>
          </div>
        </div>
      )}

      {activeTab === 'bookings' && (
        <>
          {/* Estadísticas — fila 1: globales */}
          <div className="grid grid-cols-1 md:grid-cols-5 gap-4 mb-3">
            <div className="bg-white rounded-lg shadow-md p-4">
              <div className="text-2xl font-bold text-primary-600">{stats.total}</div>
              <div className="text-sm text-gray-500">Total Reservas</div>
            </div>
            <div className="bg-white rounded-lg shadow-md p-4">
              <div className="text-2xl font-bold text-green-600">{stats.confirmed}</div>
              <div className="text-sm text-gray-500">Confirmadas</div>
            </div>
            <div className="bg-white rounded-lg shadow-md p-4">
              <div className="text-2xl font-bold text-yellow-600">{stats.pending}</div>
              <div className="text-sm text-gray-500">Pendientes</div>
            </div>
            <div className="bg-white rounded-lg shadow-md p-4">
              <div className="text-2xl font-bold text-blue-600">{stats.completed}</div>
              <div className="text-sm text-gray-500">Completadas</div>
            </div>
            <div className="bg-white rounded-lg shadow-md p-4">
              <div className="text-2xl font-bold text-accent-600">{formatCurrencyMXN(stats.totalRevenue)}</div>
              <div className="text-sm text-gray-500">Ingresos Recibidos</div>
            </div>
          </div>

          {/* Estadísticas — fila 2: por estado temporal */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
            <div
              onClick={() => setBookingTab('activas')}
              className={`rounded-lg shadow-md p-4 cursor-pointer border-2 transition-colors ${bookingTab === 'activas' ? 'border-emerald-500 bg-emerald-50' : 'border-transparent bg-white hover:bg-gray-50'}`}
            >
              <div className="text-2xl font-bold text-emerald-600">{stats.activas}</div>
              <div className="text-sm text-gray-500">Activas</div>
            </div>
            <div
              onClick={() => setBookingTab('pasadas')}
              className={`rounded-lg shadow-md p-4 cursor-pointer border-2 transition-colors ${bookingTab === 'pasadas' ? 'border-slate-500 bg-slate-50' : 'border-transparent bg-white hover:bg-gray-50'}`}
            >
              <div className="text-2xl font-bold text-slate-600">{stats.pasadas}</div>
              <div className="text-sm text-gray-500">Pasadas</div>
            </div>
            <div
              onClick={() => setBookingTab('canceladas')}
              className={`rounded-lg shadow-md p-4 cursor-pointer border-2 transition-colors ${bookingTab === 'canceladas' ? 'border-red-400 bg-red-50' : 'border-transparent bg-white hover:bg-gray-50'}`}
            >
              <div className="text-2xl font-bold text-red-500">{stats.canceladas}</div>
              <div className="text-sm text-gray-500">Canceladas</div>
            </div>
          </div>

          {/* Sub-tabs: Activas / Pasadas / Canceladas */}
          <div className="mb-4 border-b border-gray-200">
            <nav className="-mb-px flex space-x-6">
              <button
                onClick={() => setBookingTab('activas')}
                className={`py-3 px-1 border-b-2 font-medium text-sm whitespace-nowrap ${bookingTab === 'activas' ? 'border-emerald-500 text-emerald-600' : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'}`}
              >
                Activas ({stats.activas})
              </button>
              <button
                onClick={() => setBookingTab('pasadas')}
                className={`py-3 px-1 border-b-2 font-medium text-sm whitespace-nowrap ${bookingTab === 'pasadas' ? 'border-slate-500 text-slate-600' : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'}`}
              >
                Pasadas ({stats.pasadas})
              </button>
              <button
                onClick={() => setBookingTab('canceladas')}
                className={`py-3 px-1 border-b-2 font-medium text-sm whitespace-nowrap ${bookingTab === 'canceladas' ? 'border-red-400 text-red-500' : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'}`}
              >
                Canceladas ({stats.canceladas})
              </button>
            </nav>
          </div>

      {/* Filtros */}
      <div className="bg-white rounded-lg shadow-md p-4 mb-6">
        <div className="flex flex-col md:flex-row gap-4">
          <div className="flex-1">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
              <input
                type="text"
                placeholder="Buscar por tour, destino, cliente o ID..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-10 pr-4 py-2 w-full border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
              />
            </div>
          </div>
          {bookingTab !== 'canceladas' && (
            <div className="flex items-center space-x-2">
              <Filter className="h-4 w-4 text-gray-400" />
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value as any)}
                className="border border-gray-300 rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
              >
                <option value="all">Todos los estados</option>
                <option value="pending">Pendientes</option>
                <option value="confirmed">Confirmadas</option>
                <option value="completed">Completadas</option>
              </select>
            </div>
          )}
        </div>
      </div>

      {/* Lista de Reservas */}
      {filteredBookings.length === 0 ? (
        <div className="bg-white rounded-lg shadow-md p-8 text-center">
          <Calendar className="h-12 w-12 text-gray-400 mx-auto mb-4" />
          <h3 className="text-xl font-semibold mb-2">
            {bookings.length === 0 ? 'No tienes reservas aún' :
             bookingTab === 'activas' ? 'No hay reservas activas' :
             bookingTab === 'pasadas' ? 'No hay reservas pasadas' :
             'No hay reservas canceladas'}
          </h3>
          <p className="text-gray-600 mb-6">
            {bookings.length === 0
              ? 'Las reservas de tus tours aparecerán aquí cuando los viajeros hagan reservas.'
              : searchTerm || statusFilter !== 'all' ? 'Intenta ajustar los filtros de búsqueda.'
              : bookingTab === 'activas' ? 'Las reservas con fecha de tour pendiente aparecerán aquí.'
              : bookingTab === 'pasadas' ? 'Las reservas de tours que ya ocurrieron aparecerán aquí.'
              : 'Las reservas canceladas aparecerán aquí.'
            }
          </p>
          {bookings.length === 0 && (
            <Link to="/agency/tours" className="btn btn-primary">
              Gestionar Tours
            </Link>
          )}
        </div>
      ) : (
        <div className="space-y-4">
          {filteredBookings.map((booking) => (
            <div key={booking.id} className="bg-white rounded-lg shadow-md overflow-hidden">
              <div className="flex flex-col lg:flex-row">
                {/* Tour Image */}
                <div className="lg:w-1/4">
                  <div className="relative h-48 lg:h-full">
                    <img
                      src={booking.tours?.image_url || 'https://images.pexels.com/photos/1271619/pexels-photo-1271619.jpeg'}
                      alt={booking.tours?.name || 'Tour'}
                      className="w-full h-full object-cover"
                    />
                    <div className="absolute top-4 left-4 flex flex-wrap gap-2">
                      {getStatusBadge(booking.status, booking.payment_status)}
                      {getPaymentStatusBadge(booking.payment_status)}
                      {getApprovalStatusBadge(booking.approval_status)}
                      {(booking as any).is_no_show && (
                        <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-orange-100 text-orange-800">
                          <UserX className="h-3 w-3 mr-1" />
                          No Show
                        </span>
                      )}
                      {(booking as any).checkin_status === 'full' && (
                        <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800">
                          <QrCode className="h-3 w-3 mr-1" />
                          Check-in Completo
                        </span>
                      )}
                      {(booking as any).checkin_status === 'partial' && (
                        <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-amber-100 text-amber-800">
                          <QrCode className="h-3 w-3 mr-1" />
                          Check-in Parcial
                        </span>
                      )}
                      {booking.reschedule_response === 'accepted' && (
                        <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800">
                          <CheckCircle className="h-3 w-3 mr-1" />
                          Reagendamiento Aceptado
                        </span>
                      )}
                      {booking.reschedule_response === 'rejected' && (
                        <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-800">
                          <XCircle className="h-3 w-3 mr-1" />
                          Reagendamiento Rechazado
                        </span>
                      )}
                      {booking.has_pending_reschedule && (
                        <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-yellow-100 text-yellow-800">
                          <Clock className="h-3 w-3 mr-1" />
                          Esperando Respuesta
                        </span>
                      )}
                    </div>
                  </div>
                </div>

                {/* Booking Details */}
                <div className="lg:w-3/4 p-6">
                  <div className="flex justify-between items-start mb-4">
                    <div className="flex-1">
                      <h3 className="text-xl font-semibold mb-2">
                        {booking.tours?.name || 'Tour sin nombre'}
                      </h3>
                      <div className="flex items-center text-gray-600 mb-2">
                        <MapPin className="h-4 w-4 mr-1" />
                        <span>{booking.tours?.destination || 'Destino no especificado'}</span>
                      </div>
                      <div className="flex items-center text-gray-600">
                        <Calendar className="h-4 w-4 mr-1" />
                        <span>Fecha seleccionada: {formatDate(booking.booking_date)}</span>
                      </div>
                    </div>
                    <div className="text-right ml-4">
                      <div className="text-sm text-gray-500">Código de Reserva</div>
                      <div className="text-lg font-bold text-blue-600 tracking-wide">
                        {booking.booking_code}
                      </div>
                    </div>
                  </div>

                  {/* Customer Info */}
                  <div className="bg-gray-50 rounded-lg p-4 mb-4">
                    <h4 className="font-medium mb-3">Información del Cliente</h4>
                    <div className="flex items-start gap-4">
                      <div className="flex-shrink-0">
                        <div className="h-16 w-16 rounded-full bg-gray-200 flex items-center justify-center overflow-hidden">
                          {booking.users?.profile_picture_url ? (
                            <img
                              src={booking.users.profile_picture_url}
                              alt={`${booking.users.first_name} ${booking.users.last_name}`}
                              className="w-full h-full object-cover"
                            />
                          ) : (
                            <User className="h-8 w-8 text-gray-400" />
                          )}
                        </div>
                      </div>
                      <div className="flex-1 grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
                        <div>
                          <div className="text-gray-500">Nombre:</div>
                          <div className="font-medium">
                            {booking.users?.first_name} {booking.users?.last_name}
                          </div>
                        </div>
                        {booking.approval_status !== 'pending' && booking.payment_status !== 'pending' && (
                          <div>
                            <div className="text-gray-500">Email:</div>
                            <div className="font-medium">
                              <a
                                href={`mailto:${booking.users?.email}`}
                                className="text-primary-600 hover:text-primary-700"
                              >
                                {booking.users?.email}
                              </a>
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>

                  {(booking as any).has_partial_cancellations && (
                    <div className="mb-3 inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-orange-100 text-orange-800 text-xs font-medium">
                      <UserX className="h-3 w-3" />
                      Cancelación parcial &mdash; {(booking as any).active_travelers_count ?? booking.travelers_count} de {booking.travelers_count} viajeros activos
                    </div>
                  )}

                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4 mb-4">
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

                    <div className="flex items-start">
                      <DollarSign className="h-4 w-4 text-gray-400 mr-2 mt-0.5" />
                      <div>
                        <div className="text-sm text-gray-500">Pago del Viajero</div>
                        <div className="font-medium">{formatCurrencyMXN(booking.deposit_amount || 0)}</div>
                        {(booking.commission_amount || 0) > 0 && (
                          <div className="text-xs text-red-500 mt-0.5">
                            Comisión plataforma: -{formatCurrencyMXN(booking.commission_amount || 0)}
                          </div>
                        )}
                        {(booking.commission_amount || 0) > 0 && (
                          <div className="text-xs font-semibold text-green-700 mt-0.5">
                            Tu ingreso neto: {formatCurrencyMXN((booking.deposit_amount || 0) - (booking.commission_amount || 0))}
                          </div>
                        )}
                      </div>
                    </div>

                    {(booking as any).es_reserva_preventa && (
                      <div className="flex items-center col-span-full bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                        <div className="w-4 h-4 mr-2 text-amber-500 flex-shrink-0">★</div>
                        <div className="flex-1">
                          <div className="text-xs font-semibold text-amber-800">Reserva de Preventa Exclusiva</div>
                          {(booking as any).preventa_comision_descuento > 0 && (
                            <div className="text-xs text-amber-700">
                              Descuento en comisión aplicado: <strong>-${((booking as any).preventa_comision_descuento || 0).toFixed(2)}</strong>
                              {' '}(10% sobre comisión base)
                            </div>
                          )}
                        </div>
                      </div>
                    )}

                    <div className="flex items-center">
                      <DollarSign className="h-4 w-4 text-gray-400 mr-2" />
                      <div>
                        <div className="text-sm text-gray-500">Saldo Pendiente</div>
                        <div className="font-medium">
                          {formatCurrencyMXN((booking.total_price || 0) - (booking.deposit_amount || 0))}
                        </div>
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
                        <div className="font-medium">{(booking as any).payment_method || 'N/A'}</div>
                      </div>
                    </div>
                  </div>

                  {(booking as any).paypal_transaction_id && (
                    <div className="flex items-center bg-blue-50 border border-blue-100 rounded-lg px-4 py-2 mb-4">
                      <div className="flex-1">
                        <div className="text-xs text-blue-600 font-medium">ID de Transacción PayPal</div>
                        <div className="font-mono text-sm tracking-wide text-blue-900">{(booking as any).paypal_transaction_id}</div>
                      </div>
                    </div>
                  )}

                  {/* Pickup & Language Info - Receptivo tours */}
                  {((booking as any).pickup_type || (booking as any).selected_language) && (
                    <div className="bg-teal-50 border border-teal-200 rounded-lg p-4 mb-4">
                      <h4 className="text-sm font-semibold text-teal-800 mb-3 flex items-center gap-2">
                        <Car className="h-4 w-4" />
                        Detalles de Traslado e Idioma
                      </h4>
                      <div className="space-y-2">
                        {(booking as any).pickup_type && (
                          <div className="flex items-start gap-2">
                            <MapPin className="h-4 w-4 text-teal-600 mt-0.5 flex-shrink-0" />
                            <div>
                              <span className="text-xs text-teal-700 font-medium">Tipo de traslado: </span>
                              <span className="text-sm text-gray-800">
                                {(booking as any).pickup_type === 'meeting_point'
                                  ? 'Se presenta en el punto de encuentro'
                                  : 'Solicita recogida en hotel'}
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
                              <span className="text-xs text-teal-700 font-medium">Idioma seleccionado: </span>
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
                      <h4 className="text-sm font-semibold text-amber-800 mb-2">Servicios Adicionales Contratados</h4>
                      <div className="space-y-1.5">
                        {bookingOptionalServices[booking.id].map((bos: any) => (
                          <div key={bos.id} className="flex items-center justify-between text-sm">
                            <div className="flex items-center gap-2">
                              <span className={bos.is_cancelled ? 'line-through text-gray-400' : 'text-gray-800'}>
                                {bos.description || bos.tour_optional_services?.name || 'Servicio opcional'} × {bos.quantity}
                              </span>
                              {!bos.tour_optional_services?.is_refundable && !bos.is_cancelled && bos.tour_optional_services && (
                                <span className="text-xs bg-orange-100 text-orange-700 px-1.5 py-0.5 rounded">No reemb. del viajero</span>
                              )}
                              {bos.is_cancelled && (
                                <span className="text-xs bg-gray-100 text-gray-500 px-1.5 py-0.5 rounded">Cancelado</span>
                              )}
                            </div>
                            <span className={`font-medium ${bos.is_cancelled ? 'text-gray-400' : 'text-amber-700'}`}>
                              {formatCurrencyMXN(Number(bos.subtotal))}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Booking Supplements */}
                  {bookingSupplements[booking.id] && bookingSupplements[booking.id].length > 0 && (
                    <div className="bg-teal-50 border border-teal-200 rounded-lg p-4 mb-4">
                      <h4 className="text-sm font-semibold text-teal-800 mb-3 flex items-center gap-2">
                        <Tag className="w-4 h-4" />
                        Suplementos Adicionales
                      </h4>
                      <div className="space-y-3">
                        {bookingSupplements[booking.id].map((bs: any) => {
                          const statusConfig: Record<string, { label: string; color: string }> = {
                            pending_approval: { label: 'Pendiente aprobacion', color: 'bg-amber-100 text-amber-700' },
                            approved: { label: 'Aprobado — esperando pago', color: 'bg-blue-100 text-blue-700' },
                            rejected: { label: 'Rechazado', color: 'bg-red-100 text-red-700' },
                            pending_payment: { label: 'Pendiente de pago', color: 'bg-blue-100 text-blue-700' },
                            paid: { label: 'Pagado', color: 'bg-green-100 text-green-700' },
                            cancelled: { label: 'Cancelado', color: 'bg-gray-100 text-gray-500' },
                          };
                          const sc = statusConfig[bs.status] || { label: bs.status, color: 'bg-gray-100 text-gray-500' };
                          const isPendingApproval = bs.status === 'pending_approval';

                          return (
                            <div key={bs.id} className="bg-white border border-teal-100 rounded-lg p-3 space-y-2">
                              <div className="flex items-center justify-between">
                                <div className="flex items-center gap-2 flex-wrap">
                                  <span className="text-sm font-medium text-gray-800">
                                    {bs.tour_supplements?.name} × {bs.quantity}
                                  </span>
                                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${sc.color}`}>{sc.label}</span>
                                  {!bs.tour_supplements?.is_cancellable && bs.status === 'paid' && (
                                    <span className="text-xs bg-orange-100 text-orange-700 px-1.5 py-0.5 rounded">No cancelable</span>
                                  )}
                                </div>
                                {bs.total_paid != null && (
                                  <span className="text-sm font-semibold text-teal-700">{formatCurrencyMXN(Number(bs.total_paid))}</span>
                                )}
                              </div>

                              {bs.status === 'rejected' && bs.rejection_note && (
                                <p className="text-xs text-red-600 bg-red-50 rounded px-2 py-1">
                                  Motivo: {bs.rejection_note}
                                </p>
                              )}

                              {isPendingApproval && (
                                <div className="pt-1 space-y-2">
                                  {supplementAction?.supplementId === bs.id && supplementAction.type === 'reject' ? (
                                    <div className="space-y-2">
                                      <textarea
                                        value={supplementAction.rejectionNote}
                                        onChange={(e) => setSupplementAction(prev => prev ? { ...prev, rejectionNote: e.target.value } : null)}
                                        placeholder="Motivo del rechazo (opcional)"
                                        className="w-full text-xs border border-gray-200 rounded px-2 py-1.5 resize-none"
                                        rows={2}
                                      />
                                      <div className="flex gap-2">
                                        <button
                                          onClick={() => handleRejectSupplementRequest(bs.id, supplementAction.rejectionNote)}
                                          disabled={supplementAction.isSubmitting}
                                          className="btn btn-sm bg-red-600 text-white hover:bg-red-700 text-xs px-3"
                                        >
                                          {supplementAction.isSubmitting ? 'Rechazando...' : 'Confirmar rechazo'}
                                        </button>
                                        <button
                                          onClick={() => setSupplementAction(null)}
                                          className="btn btn-sm btn-outline text-xs px-3"
                                        >
                                          Cancelar
                                        </button>
                                      </div>
                                    </div>
                                  ) : (
                                    <div className="flex gap-2">
                                      <button
                                        onClick={() => handleApproveSupplementRequest(bs.id)}
                                        disabled={!!supplementAction}
                                        className="btn btn-sm bg-teal-600 text-white hover:bg-teal-700 text-xs px-3 flex items-center gap-1"
                                      >
                                        <CheckCircle className="w-3 h-3" />
                                        Aprobar (48h para pagar)
                                      </button>
                                      <button
                                        onClick={() => setSupplementAction({ type: 'reject', supplementId: bs.id, isSubmitting: false, rejectionNote: '' })}
                                        disabled={!!supplementAction}
                                        className="btn btn-sm btn-outline text-red-600 border-red-300 hover:bg-red-50 text-xs px-3 flex items-center gap-1"
                                      >
                                        <XCircle className="w-3 h-3" />
                                        Rechazar
                                      </button>
                                    </div>
                                  )}
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {/* Actions */}
                  <div className="flex flex-col sm:flex-row gap-3 pt-4 border-t">
                    <Link
                      to={`/tours/${booking.tour_id}`}
                      className="btn btn-outline flex items-center justify-center"
                    >
                      <Eye className="h-4 w-4 mr-2" />
                      Ver Tour
                    </Link>

                    {booking.approval_status !== 'pending' && booking.payment_status !== 'pending' && (
                      <>
                        <button
                          onClick={() => handleOpenTravelersModal(booking)}
                          className="btn btn-outline flex items-center justify-center"
                        >
                          <UserCheck className="h-4 w-4 mr-2" />
                          Ver Acompañantes
                        </button>

                        <button
                          onClick={() => handleOpenContactModal(booking)}
                          className="btn btn-outline flex items-center justify-center"
                        >
                          <Mail className="h-4 w-4 mr-2" />
                          Contactar Cliente
                        </button>
                      </>
                    )}

                    {booking.approval_status === 'pending' && (
                      <>
                        <button
                          onClick={() => handleApprovalAction(booking.id, 'approve')}
                          className="btn btn-primary flex items-center justify-center"
                        >
                          <CheckCircle className="h-4 w-4 mr-2" />
                          Aprobar Reserva
                        </button>
                        <button
                          onClick={() => {
                            const notes = prompt('Motivo del rechazo (opcional):');
                            if (notes !== null) { // null means user cancelled
                              handleApprovalAction(booking.id, 'reject', notes);
                            }
                          }}
                          className="btn bg-red-600 text-white hover:bg-red-700 flex items-center justify-center"
                        >
                          <XCircle className="h-4 w-4 mr-2" />
                          Rechazar
                        </button>
                      </>
                    )}

                    {booking.status === 'pending' && booking.payment_status === 'succeeded' && (
                      <button
                        onClick={() => handleStatusUpdate(booking.id, 'confirmed')}
                        className="btn btn-primary flex items-center justify-center"
                      >
                        <CheckCircle className="h-4 w-4 mr-2" />
                        Confirmar Reserva
                      </button>
                    )}

                    {booking.status === 'confirmed' && !(booking as any).is_no_show && (
                      <>
                        {canMarkAsCompleted(booking) && (
                          <button
                            onClick={() => handleStatusUpdate(booking.id, 'completed')}
                            className="btn btn-primary flex items-center justify-center"
                          >
                            <CheckCircle className="h-4 w-4 mr-2" />
                            Marcar Completada
                          </button>
                        )}
                        {canMarkAsNoShow(booking) && !(booking as any).checkin_status && (
                          <button
                            onClick={() => handleMarkNoShow(booking.id)}
                            className="btn bg-orange-600 text-white hover:bg-orange-700 flex items-center justify-center"
                            title="No disponible: esta reserva ya fue procesada vía QR de check-in"
                          >
                            <UserX className="h-4 w-4 mr-2" />
                            No Show
                          </button>
                        )}
                        {canMarkAsNoShow(booking) && (booking as any).checkin_status && (
                          <div
                            className="btn bg-gray-200 text-gray-400 cursor-not-allowed flex items-center justify-center"
                            title="Esta reserva ya fue procesada vía QR de check-in"
                          >
                            <UserX className="h-4 w-4 mr-2" />
                            No Show
                          </div>
                        )}
                      </>
                    )}

                    {canReviewTraveler(booking) && (
                      <button
                        onClick={() => handleOpenReviewModal(booking)}
                        className="btn btn-primary flex items-center justify-center"
                      >
                        <Star className="h-4 w-4 mr-2" />
                        Calificar Viajero
                      </button>
                    )}

                    {booking.status !== 'cancelled' && !booking.cancelled_at && ['confirmed', 'pending'].includes(booking.status) && booking.payment_status === 'succeeded' && !(booking as any).is_no_show && (
                      <button
                        onClick={() => handleOpenCancelBookingModal(booking)}
                        className="btn bg-orange-600 text-white hover:bg-orange-700 flex items-center justify-center"
                      >
                        <XCircle className="h-4 w-4 mr-2" />
                        Cancelar Reserva
                      </button>
                    )}
                  </div>

                  {/* Important Notes */}
                  {(booking as any).cancelled_at && (
                    <div className="mt-4 p-3 bg-red-50 border-l-4 border-red-500 rounded-md">
                      <div className="flex items-start gap-2">
                        <XCircle className="h-5 w-5 text-red-600 flex-shrink-0 mt-0.5" />
                        <div className="flex-1">
                          <p className="text-sm text-red-800 font-semibold mb-2">
                            {(booking as any).cancelled_by_agency_at ? 'Reserva Cancelada por tu Agencia' : 'Reserva Cancelada por el Viajero'}
                          </p>
                          <div className="text-xs text-red-700 space-y-1">
                            <p>
                              <strong>Cancelado el:</strong> {formatDate((booking as any).cancelled_at)}
                            </p>
                            {(booking as any).cancelled_by_agency_at && (
                              <p className="text-orange-800 font-semibold mt-2">
                                ℹ️ Esta reserva fue cancelada por tu agencia. El viajero recibió un reembolso del 100% y no se pagará comisión.
                              </p>
                            )}
                            {!(booking as any).cancelled_by_agency_at && (booking as any).cancellation_type && (
                              <p>
                                <strong>Política aplicada:</strong> {
                                  (booking as any).cancellation_type === '100_percent' ? 'Reembolso del 100%' :
                                  (booking as any).cancellation_type === '50_percent' ? 'Reembolso del 50%' :
                                  (booking as any).cancellation_type === 'no_refund' ? 'Sin reembolso' :
                                  (booking as any).cancellation_type === 'no_show' ? 'Cancelación tardía (No Show)' :
                                  (booking as any).cancellation_type === 'pending_approval' ? 'Reserva pendiente' :
                                  (booking as any).cancellation_type === 'agency_cancellation' ? 'Cancelación por agencia' :
                                  'N/A'
                                }
                              </p>
                            )}
                            {(booking as any).cancellation_refund_amount !== null && (booking as any).cancellation_refund_amount !== undefined && (
                              <p>
                                <strong>Reembolsado al viajero:</strong> ${formatCurrencyMXN(Number((booking as any).cancellation_refund_amount))}
                              </p>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>
                  )}

                  {(booking as any).is_no_show && (
                    <div className="mt-4 p-3 bg-orange-50 border border-orange-200 rounded-md">
                      <div className="flex items-start gap-2">
                        <UserX className="h-5 w-5 text-orange-600 flex-shrink-0 mt-0.5" />
                        <div>
                          <p className="text-sm text-orange-800">
                            <strong>No Show:</strong> El viajero no se presentó a este tour. El contador de No Show del viajero ha sido actualizado.
                          </p>
                          {(booking as any).no_show_marked_at && (
                            <p className="text-xs text-orange-700 mt-1">
                              Marcado el {formatDate((booking as any).no_show_marked_at)}
                            </p>
                          )}
                        </div>
                      </div>
                    </div>
                  )}

                  {booking.approval_status === 'pending' && (
                    <div className="mt-4 p-3 bg-yellow-50 border border-yellow-200 rounded-md">
                      <p className="text-sm text-yellow-800">
                        <strong>Acción requerida:</strong> Esta reserva está pendiente de tu aprobación. El cliente no será cobrado hasta que apruebes la solicitud.
                      </p>
                    </div>
                  )}

                  {booking.approval_status === 'approved' && booking.payment_status !== 'succeeded' && (
                    <div className="mt-4 p-3 bg-green-50 border border-green-200 rounded-md">
                      <p className="text-sm text-green-800">
                        <strong>Reserva aprobada:</strong> El cliente ha sido notificado y puede proceder con el pago.
                      </p>
                    </div>
                  )}

                  {booking.approval_status === 'rejected' && (
                    <div className="mt-4 p-3 bg-red-50 border border-red-200 rounded-md">
                      <p className="text-sm text-red-800">
                        <strong>Reserva rechazada:</strong> El cliente ha sido notificado del rechazo.
                        {booking.approval_notes && (
                          <span className="block mt-1">Motivo: {booking.approval_notes}</span>
                        )}
                      </p>
                    </div>
                  )}

                  {booking.status === 'pending' && booking.payment_status === 'succeeded' && (
                    <div className="mt-4 p-3 bg-blue-50 border border-blue-200 rounded-md">
                      <p className="text-sm text-blue-800">
                        <strong>Acción requerida:</strong> El cliente ha pagado el depósito. Confirma la reserva para proceder.
                      </p>
                    </div>
                  )}

                  {booking.has_pending_reschedule && (
                    <div className="mt-4 p-3 bg-yellow-50 border border-yellow-200 rounded-md">
                      <p className="text-sm text-yellow-800">
                        <strong>Reagendamiento pendiente:</strong> Has solicitado un cambio de fecha para este tour. Esperando la respuesta del viajero.
                      </p>
                    </div>
                  )}

                  {/* Plan de Pagos (vista agencia, solo lectura) */}
                  {(booking as any).has_payment_plan && (
                    <div className="mt-4">
                      <PaymentPlanCalendar bookingId={booking.id} agencyView={true} />
                    </div>
                  )}

                  {booking.reschedule_response === 'accepted' && (
                    <div className="mt-4 p-3 bg-green-50 border border-green-200 rounded-md">
                      <p className="text-sm text-green-800">
                        <strong>Reagendamiento aceptado:</strong> El viajero aceptó la nueva fecha propuesta. La reserva continúa vigente con la fecha actualizada.
                        {booking.reschedule_responded_at && (
                          <span className="block mt-1 text-xs">Respondió el: {formatDate(booking.reschedule_responded_at)}</span>
                        )}
                      </p>
                    </div>
                  )}

                  {booking.reschedule_response === 'rejected' && booking.status === 'cancelled' && (
                    <div className="mt-4 p-3 bg-red-50 border border-red-200 rounded-md">
                      <p className="text-sm text-red-800">
                        <strong>Reagendamiento rechazado:</strong> El viajero rechazó la nueva fecha. La reserva fue cancelada automáticamente y se procesó el reembolso completo.
                        {booking.reschedule_responded_at && (
                          <span className="block mt-1 text-xs">Respondió el: {formatDate(booking.reschedule_responded_at)}</span>
                        )}
                      </p>
                    </div>
                  )}

                  {booking.status === 'confirmed' && !(booking as any).is_no_show && (
                    <div className="mt-4 p-3 bg-green-50 border border-green-200 rounded-md">
                      <p className="text-sm text-green-800">
                        <strong>Reserva confirmada:</strong> Coordina con el cliente el pago del saldo restante y los detalles del viaje.
                        {!canMarkAsCompleted(booking) && !canMarkAsNoShow(booking) && (
                          <span className="block mt-1">Los botones de completar/no show estarán disponibles el día del viaje.</span>
                        )}
                        {(canMarkAsCompleted(booking) || canMarkAsNoShow(booking)) && (
                          <span className="block mt-1">Marca como completada una vez que el viajero se haya presentado, o como No Show si no se presentó.</span>
                        )}
                      </p>
                    </div>
                  )}

                  {booking.status === 'completed' && !(booking as any).is_no_show && (
                    <div className="mt-4 p-3 bg-blue-50 border border-blue-200 rounded-md">
                      <p className="text-sm text-blue-800">
                        <strong>Tour completado exitosamente:</strong> Ahora puedes calificar al viajero para ayudar a otras agencias.
                        {(booking as any).checkin_status === 'full' && (
                          <span className="block mt-1 flex items-center gap-1">
                            <QrCode className="h-3.5 w-3.5 inline" /> Check-in confirmado vía código QR.
                          </span>
                        )}
                        {(booking as any).checkin_status === 'partial' && (
                          <span className="block mt-1 flex items-center gap-1 text-amber-700">
                            <QrCode className="h-3.5 w-3.5 inline" /> Check-in parcial vía QR: algunos acompañantes no se presentaron.
                          </span>
                        )}
                      </p>
                    </div>
                  )}

                  {booking.status === 'pending' && booking.payment_status !== 'succeeded' && (
                    <div className="mt-4 p-3 bg-yellow-50 border border-yellow-200 rounded-md">
                      <p className="text-sm text-yellow-800">
                        <strong>Pendiente de pago:</strong> El cliente aún no ha completado el pago del depósito.
                      </p>
                    </div>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
        </>
      )}

      {activeTab === 'messages' && (
        <div className="bg-white rounded-lg shadow-md p-6">
          <div className="flex items-center justify-between mb-6">
            <div>
              <h2 className="text-2xl font-bold">Mensajes Enviados a Asistentes</h2>
              <p className="text-gray-600 mt-1">Historial de todos los mensajes masivos enviados a los asistentes de tus tours.</p>
            </div>
            <button
              onClick={() => setMassMessageModal({ open: true })}
              className="btn btn-primary flex items-center gap-2"
            >
              <Send className="h-4 w-4" />
              Nuevo Mensaje
            </button>
          </div>

          {isLoadingMessages ? (
            <div className="flex justify-center py-12">
              <div className="animate-spin rounded-full h-10 w-10 border-t-2 border-b-2 border-primary-600"></div>
            </div>
          ) : sentMessages.length === 0 ? (
            <div className="text-center py-12 text-gray-500">
              <MessageSquare className="h-12 w-12 mx-auto mb-4 text-gray-300" />
              <p className="text-lg font-medium mb-1">Sin mensajes enviados</p>
              <p className="text-sm">Usa el botón "Mensaje a Asistentes" para comunicarte con los participantes de tus tours.</p>
            </div>
          ) : (
            <div className="space-y-3">
              {sentMessages.map((msg: any) => {
                const statusColors: Record<string, string> = {
                  completed: 'bg-green-100 text-green-700',
                  sending: 'bg-blue-100 text-blue-700',
                  failed: 'bg-red-100 text-red-700',
                  pending: 'bg-yellow-100 text-yellow-700',
                };
                const statusLabels: Record<string, string> = {
                  completed: 'Enviado',
                  sending: 'Enviando',
                  failed: 'Error',
                  pending: 'Pendiente',
                };
                const slotDate = msg.tour_slots?.slot_date
                  ? new Date(msg.tour_slots.slot_date + 'T12:00:00').toLocaleDateString('es-MX', { day: 'numeric', month: 'short', year: 'numeric' })
                  : null;

                return (
                  <div key={msg.id} className="border border-gray-200 rounded-xl p-5 hover:border-gray-300 transition-colors">
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap mb-1">
                          <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${statusColors[msg.status] || 'bg-gray-100 text-gray-700'}`}>
                            {statusLabels[msg.status] || msg.status}
                          </span>
                          <span className="text-xs text-gray-400">
                            {new Date(msg.created_at).toLocaleDateString('es-MX', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
                          </span>
                        </div>
                        <p className="font-semibold text-gray-900 truncate">{msg.subject}</p>
                        <p className="text-sm text-gray-500 mt-0.5">
                          {msg.tours?.name}
                          {slotDate && <span className="ml-1 text-gray-400">· {slotDate}{msg.tour_slots?.departure_time ? ` ${msg.tour_slots.departure_time}` : ''}</span>}
                          {!msg.slot_id && <span className="ml-1 text-gray-400">· Todos los asistentes</span>}
                        </p>
                        <p className="text-sm text-gray-600 mt-2 line-clamp-2">{msg.message_body}</p>
                      </div>
                      <div className="text-right flex-shrink-0">
                        <div className="text-2xl font-bold text-primary-600">{msg.success_count}</div>
                        <div className="text-xs text-gray-500">enviados</div>
                        {msg.error_count > 0 && (
                          <div className="text-xs text-red-500 mt-0.5">{msg.error_count} errores</div>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {activeTab === 'reports' && (
        <div className="bg-white rounded-lg shadow-md p-6">
          <h2 className="text-2xl font-bold mb-4">Reportes de Asistentes por Tour</h2>
          <p className="text-gray-600 mb-6">
            Genera reportes detallados con la lista de asistentes y acompañantes para cada tour.
            Exporta en Excel o PDF para el día del tour.
          </p>

          {/* Tour Selector */}
          <div className="mb-6">
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Selecciona un Tour
            </label>
            <div className="flex gap-4">
              <select
                value={selectedTourForReport}
                onChange={(e) => setSelectedTourForReport(e.target.value)}
                className="flex-1 border border-gray-300 rounded-md px-4 py-2 focus:outline-none focus:ring-2 focus:ring-primary-500"
              >
                <option value="">-- Selecciona un tour --</option>
                {availableTours.map((tour) => (
                  <option key={tour.id} value={tour.id}>
                    {tour.name} - {formatDate(tour.start_date)} ({tour.bookingsCount} reservas confirmadas)
                  </option>
                ))}
              </select>
              <button
                onClick={handleGenerateReport}
                disabled={!selectedTourForReport || isLoadingReport}
                className="btn btn-primary flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isLoadingReport ? (
                  <>
                    <div className="animate-spin rounded-full h-4 w-4 border-t-2 border-b-2 border-white"></div>
                    Generando...
                  </>
                ) : (
                  <>
                    <Download className="h-5 w-5" />
                    Generar Reporte
                  </>
                )}
              </button>
            </div>
          </div>

          {/* Report Preview */}
          {reportData && (
            <div>
              <div className="mb-4 flex justify-between items-center">
                <h3 className="text-xl font-bold">Vista Previa del Reporte</h3>
                <div className="flex gap-2">
                  <button
                    onClick={handleExportExcel}
                    className="btn btn-primary flex items-center gap-2"
                  >
                    <FileSpreadsheet className="h-5 w-5" />
                    Descargar Excel
                  </button>
                  <button
                    onClick={handleExportPDF}
                    className="btn btn-outline flex items-center gap-2"
                  >
                    <FileText className="h-5 w-5" />
                    Descargar PDF
                  </button>
                </div>
              </div>

              {/* Summary Cards */}
              <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
                <div className="bg-primary-50 rounded-lg p-4">
                  <div className="text-2xl font-bold text-primary-600">
                    {reportData.summary.totalBookings}
                  </div>
                  <div className="text-sm text-gray-600">Total Reservas</div>
                </div>
                <div className="bg-green-50 rounded-lg p-4">
                  <div className="text-2xl font-bold text-green-600">
                    {reportData.summary.totalTravelers}
                  </div>
                  <div className="text-sm text-gray-600">Total Viajeros</div>
                </div>
                <div className="bg-blue-50 rounded-lg p-4">
                  <div className="text-2xl font-bold text-blue-600">
                    {formatCurrencyMXN(reportData.summary.totalDeposit)}
                  </div>
                  <div className="text-sm text-gray-600">Anticipo Recibido</div>
                </div>
                <div className="bg-orange-50 rounded-lg p-4">
                  <div className="text-2xl font-bold text-orange-600">
                    {formatCurrencyMXN(reportData.summary.totalRemaining)}
                  </div>
                  <div className="text-sm text-gray-600">Saldo Pendiente</div>
                </div>
              </div>

              {/* Travelers by Category */}
              <div className="bg-gray-50 rounded-lg p-4 mb-6">
                <h4 className="font-semibold mb-3">Viajeros por Categoría</h4>
                <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
                  <div>
                    <div className="text-lg font-bold">{reportData.summary.totalsByCategory.adultos}</div>
                    <div className="text-sm text-gray-600">Adultos</div>
                  </div>
                  <div>
                    <div className="text-lg font-bold">{reportData.summary.totalsByCategory.ninos}</div>
                    <div className="text-sm text-gray-600">Niños</div>
                  </div>
                  <div>
                    <div className="text-lg font-bold">{reportData.summary.totalsByCategory.infantes}</div>
                    <div className="text-sm text-gray-600">Infantes</div>
                  </div>
                  <div>
                    <div className="text-lg font-bold">{reportData.summary.totalsByCategory.adultos_mayores}</div>
                    <div className="text-sm text-gray-600">Adultos Mayores</div>
                  </div>
                  <div>
                    <div className="text-lg font-bold">{reportData.summary.totalsByCategory.mascotas}</div>
                    <div className="text-sm text-gray-600">Mascotas</div>
                  </div>
                </div>
              </div>

              {/* Detailed List */}
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-gray-200">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Cliente</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Viajeros</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Anticipo</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Pendiente</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Método Pago</th>
                    </tr>
                  </thead>
                  <tbody className="bg-white divide-y divide-gray-200">
                    {reportData.bookings.map((booking: any) => (
                      <tr key={booking.id} className="hover:bg-gray-50">
                        <td className="px-4 py-4">
                          <div className="font-medium">{booking.users.first_name} {booking.users.last_name}</div>
                          <div className="text-sm text-gray-500">{booking.users.email}</div>
                          <div className="text-sm text-gray-500">{booking.users.phone_number || 'Sin teléfono'}</div>
                        </td>
                        <td className="px-4 py-4">
                          {booking.travelers.length > 0 ? (
                            <div className="space-y-1">
                              {booking.travelers.map((traveler: any) => (
                                <div key={traveler.id} className="text-sm">
                                  <span className="font-medium">{traveler.nombre}</span>
                                  <span className="text-gray-500 ml-2">({getCategoryLabel(traveler.categoria_viajero)})</span>
                                </div>
                              ))}
                            </div>
                          ) : (
                            <div className="text-sm text-gray-500">Sin acompañantes</div>
                          )}
                        </td>
                        <td className="px-4 py-4">
                          <div className="font-medium">
                            {formatCurrencyMXN(Number(booking.deposit_amount))}
                          </div>
                        </td>
                        <td className="px-4 py-4">
                          <div className="font-medium text-orange-600">
                            {formatCurrencyMXN(Number(booking.total_price) - Number(booking.deposit_amount))}
                          </div>
                        </td>
                        <td className="px-4 py-4">
                          <div className="text-sm">{booking.payment_method || 'N/A'}</div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {!reportData && !isLoadingReport && (
            <div className="text-center py-12 text-gray-500">
              <FileText className="h-16 w-16 mx-auto mb-4 text-gray-300" />
              <p>Selecciona un tour y genera el reporte para ver los detalles</p>
            </div>
          )}
        </div>
      )}

      {/* Contact Modal */}
      {contactModal.open && contactModal.booking && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-lg max-w-md w-full">
            <div className="p-6">
              <div className="flex justify-between items-start mb-4">
                <h2 className="text-2xl font-bold">Contactar Cliente</h2>
                <button
                  onClick={handleCloseContactModal}
                  className="text-gray-400 hover:text-gray-600"
                >
                  <X className="h-6 w-6" />
                </button>
              </div>

              <div className="mb-6">
                <div className="flex items-center gap-4 mb-4">
                  <div className="h-16 w-16 rounded-full bg-gray-200 flex items-center justify-center overflow-hidden flex-shrink-0">
                    {contactModal.booking.users?.profile_picture_url ? (
                      <img
                        src={contactModal.booking.users.profile_picture_url}
                        alt={`${contactModal.booking.users.first_name} ${contactModal.booking.users.last_name}`}
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <User className="h-8 w-8 text-gray-400" />
                    )}
                  </div>
                  <div>
                    <h3 className="font-semibold text-lg">
                      {contactModal.booking.users?.first_name} {contactModal.booking.users?.last_name}
                    </h3>
                    <p className="text-sm text-gray-500">
                      Reserva: {contactModal.booking.tours?.name}
                    </p>
                  </div>
                </div>

                <div className="space-y-3 bg-gray-50 rounded-lg p-4">
                  {contactModal.booking.users?.email && (
                    <div className="flex items-start gap-3">
                      <Mail className="h-5 w-5 text-gray-400 mt-0.5 flex-shrink-0" />
                      <div className="flex-1 min-w-0">
                        <div className="text-sm text-gray-500 mb-1">Email</div>
                        <a
                          href={`mailto:${contactModal.booking.users.email}?subject=Reserva ${contactModal.booking.booking_code} - ${contactModal.booking.tours?.name}`}
                          className="text-primary-600 hover:text-primary-700 break-all"
                        >
                          {contactModal.booking.users.email}
                        </a>
                      </div>
                    </div>
                  )}

                  {contactModal.booking.users?.phone_number && (
                    <div className="flex items-start gap-3">
                      <Phone className="h-5 w-5 text-gray-400 mt-0.5 flex-shrink-0" />
                      <div className="flex-1">
                        <div className="text-sm text-gray-500 mb-1">Teléfono</div>
                        <a
                          href={`tel:${contactModal.booking.users.phone_number}`}
                          className="text-primary-600 hover:text-primary-700"
                        >
                          {contactModal.booking.users.phone_number}
                        </a>
                      </div>
                    </div>
                  )}

                  {!contactModal.booking.users?.phone_number && !contactModal.booking.users?.email && (
                    <div className="text-center text-gray-500 py-2">
                      No hay información de contacto disponible
                    </div>
                  )}
                </div>
              </div>

              <div className="flex gap-3">
                <button
                  onClick={() => handleSendMessage(contactModal.booking!)}
                  className="btn btn-primary flex-1 flex items-center justify-center"
                >
                  <MessageSquare className="h-4 w-4 mr-2" />
                  Enviar Mensaje
                </button>
                <button
                  onClick={handleCloseContactModal}
                  className="btn btn-outline"
                >
                  Cerrar
                </button>
              </div>
            </div>
          </div>
        </div>
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
                            {(traveler.documento_numero) && (
                              <div>
                                <div className="text-gray-500 mb-1">Documento ({traveler.documento_tipo === 'pasaporte' ? 'Pasaporte' : 'CURP'})</div>
                                <div className="font-medium font-mono uppercase">{traveler.documento_numero}</div>
                              </div>
                            )}
                            {(traveler.emergency_contact_name || traveler.emergency_contact_phone) && (
                              <div className="md:col-span-2">
                                <div className="text-gray-500 mb-1">Contacto de emergencia</div>
                                <div className="font-medium">{traveler.emergency_contact_name || '—'} {traveler.emergency_contact_phone ? `— ${traveler.emergency_contact_phone}` : ''}</div>
                              </div>
                            )}
                          </>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}

              <div className="mt-6 flex items-center justify-between gap-3">
                {travelersModal.booking?.travel_insurance_included && (
                  <button
                    onClick={async () => {
                      try {
                        const { data: { session } } = await supabase.auth.getSession();
                        const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/generate-insurance-xlsx`, {
                          method: 'POST',
                          headers: {
                            'Content-Type': 'application/json',
                            'Authorization': `Bearer ${session?.access_token}`,
                          },
                          body: JSON.stringify({ booking_id: travelersModal.booking!.id }),
                        });
                        const json = await res.json();
                        if (!json.base64) throw new Error(json.error || 'Error al generar Excel');
                        const bytes = Uint8Array.from(atob(json.base64), c => c.charCodeAt(0));
                        const blob = new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
                        const url = URL.createObjectURL(blob);
                        const a = document.createElement('a');
                        a.href = url;
                        a.download = json.filename;
                        a.click();
                        URL.revokeObjectURL(url);
                      } catch (e: any) {
                        alert('Error al descargar: ' + e.message);
                      }
                    }}
                    className="inline-flex items-center gap-2 px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-medium rounded-lg transition"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="12" y1="18" x2="12" y2="12"/><line x1="9" y1="15" x2="15" y2="15"/></svg>
                    Descargar Excel para aseguradora
                  </button>
                )}
                <button
                  onClick={handleCloseTravelersModal}
                  className="btn btn-outline ml-auto"
                >
                  Cerrar
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Review Modal */}
      {reviewModal.open && reviewModal.booking && agencyId && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-lg max-w-2xl w-full max-h-[90vh] overflow-y-auto">
            <div className="p-6">
              <div className="flex justify-between items-start mb-4">
                <div>
                  <h2 className="text-2xl font-bold mb-2">
                    {reviewModal.existingReview ? 'Editar Calificación' : 'Calificar Viajero'}
                  </h2>
                  <p className="text-gray-600">
                    {reviewModal.booking.users?.first_name} {reviewModal.booking.users?.last_name}
                  </p>
                  <p className="text-sm text-gray-500">
                    {reviewModal.booking.tours?.name}
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
                revieweeId={reviewModal.booking.user_id!}
                reviewType="traveler"
                onSuccess={handleReviewSuccess}
                onCancel={handleCloseReviewModal}
                existingReview={reviewModal.existingReview}
              />
            </div>
          </div>
        </div>
      )}

      {/* Cancel Booking Modal */}
      {cancelBookingModal.open && cancelBookingModal.booking && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-lg max-w-2xl w-full max-h-[90vh] overflow-y-auto">
            <div className="p-6">
              <div className="flex justify-between items-start mb-4">
                <div className="flex items-center gap-3">
                  <div className="bg-orange-100 rounded-full p-3">
                    <XCircle className="h-6 w-6 text-orange-600" />
                  </div>
                  <div>
                    <h2 className="text-2xl font-bold">Cancelar Reserva</h2>
                    <p className="text-sm text-gray-500">Esta acción no se puede deshacer</p>
                  </div>
                </div>
                <button
                  onClick={handleCloseCancelBookingModal}
                  className="text-gray-400 hover:text-gray-600"
                  disabled={cancelBookingModal.isSubmitting}
                >
                  <X className="h-6 w-6" />
                </button>
              </div>

              <div className="bg-gray-50 rounded-lg p-4 mb-6">
                <h3 className="font-semibold mb-3">Información de la Reserva</h3>
                <div className="space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-gray-600">Código de reserva:</span>
                    <span className="font-semibold">{cancelBookingModal.booking.booking_code}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-600">Tour:</span>
                    <span className="font-semibold">{cancelBookingModal.booking.tours?.name}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-600">Viajero:</span>
                    <span className="font-semibold">
                      {cancelBookingModal.booking.users?.first_name} {cancelBookingModal.booking.users?.last_name}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-600">Anticipo pagado:</span>
                    <span className="font-semibold">${formatCurrencyMXN(cancelBookingModal.booking.deposit_amount || 0)}</span>
                  </div>
                </div>
              </div>

              <div className="bg-yellow-50 border-l-4 border-yellow-500 p-4 mb-6">
                <div className="flex gap-2">
                  <AlertCircle className="h-5 w-5 text-yellow-600 flex-shrink-0 mt-0.5" />
                  <div className="text-sm text-yellow-800">
                    <p className="font-semibold mb-1">Importante: Política de Cancelación por Agencia</p>
                    <ul className="list-disc list-inside space-y-1 ml-2">
                      <li>El viajero recibirá un <strong>reembolso del 100%</strong> en su ToursRed Cash</li>
                      <li>Los cargos por servicio NO son reembolsables (ya cobrados por Stripe)</li>
                      <li>Tu agencia <strong>NO recibirá comisión</strong> por esta reserva</li>
                      <li>Esta acción es <strong>irreversible</strong></li>
                    </ul>
                  </div>
                </div>
              </div>

              {(() => {
                const optSvcs = bookingOptionalServices[cancelBookingModal.booking.id] || [];
                const nonRefundable = optSvcs.filter(b => !b.tour_optional_services?.is_refundable && !b.is_cancelled);
                if (nonRefundable.length === 0) return null;
                const totalNonRefundable = nonRefundable.reduce((s: number, b: any) => s + Number(b.subtotal), 0);
                return (
                  <div className="bg-orange-50 border-l-4 border-orange-500 p-4 mb-6">
                    <div className="flex gap-2">
                      <AlertCircle className="h-5 w-5 text-orange-600 flex-shrink-0 mt-0.5" />
                      <div className="text-sm text-orange-800">
                        <p className="font-semibold mb-1">Servicios adicionales no reembolsables incluidos</p>
                        <p>Esta reserva tiene <strong>${formatCurrencyMXN(totalNonRefundable)}</strong> en servicios marcados como no reembolsables. Como eres tú quien cancela, <strong>todos los servicios se reembolsan al viajero</strong>, incluyendo los no reembolsables. Tu agencia absorbe ese costo.</p>
                      </div>
                    </div>
                  </div>
                );
              })()}

              <div className="mb-6">
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Motivo de la Cancelación *
                  <span className="text-xs text-gray-500 ml-2">(mínimo 50 caracteres)</span>
                </label>
                <textarea
                  value={cancelBookingModal.reason}
                  onChange={(e) => handleCancelBookingReasonChange(e.target.value)}
                  placeholder="Explica el motivo de la cancelación. Por ejemplo: sobrecupo, problema logístico, situación especial con el viajero, etc."
                  className="w-full border border-gray-300 rounded-lg p-3 focus:outline-none focus:ring-2 focus:ring-orange-500 focus:border-orange-500 resize-none"
                  rows={5}
                  disabled={cancelBookingModal.isSubmitting}
                />
                <div className="flex justify-between items-center mt-2">
                  <span className={`text-xs ${cancelBookingModal.reason.length < 50 ? 'text-red-600' : 'text-green-600'}`}>
                    {cancelBookingModal.reason.length} / 50 caracteres
                  </span>
                  {cancelBookingModal.reason.length < 50 && (
                    <span className="text-xs text-red-600">
                      Faltan {50 - cancelBookingModal.reason.length} caracteres
                    </span>
                  )}
                </div>
              </div>

              <div className="flex flex-col sm:flex-row gap-3">
                <button
                  onClick={handleCloseCancelBookingModal}
                  className="btn btn-outline flex-1"
                  disabled={cancelBookingModal.isSubmitting}
                >
                  Cancelar
                </button>
                <button
                  onClick={handleSubmitCancelBooking}
                  disabled={cancelBookingModal.reason.trim().length < 50 || cancelBookingModal.isSubmitting}
                  className="btn bg-orange-600 text-white hover:bg-orange-700 disabled:opacity-50 disabled:cursor-not-allowed flex-1 flex items-center justify-center"
                >
                  {cancelBookingModal.isSubmitting ? (
                    <>
                      <div className="animate-spin rounded-full h-4 w-4 border-t-2 border-b-2 border-white mr-2"></div>
                      Procesando...
                    </>
                  ) : (
                    <>
                      <XCircle className="h-4 w-4 mr-2" />
                      Confirmar Cancelación
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {massMessageModal.open && agencyId && (
        <TourMassMessageModal
          open={massMessageModal.open}
          onClose={() => setMassMessageModal({ open: false })}
          agencyId={agencyId}
          tours={availableTours.map(t => ({
            id: t.id,
            name: t.name,
            destination: t.destination,
            start_date: t.start_date ?? null,
            end_date: t.end_date ?? null,
            tour_type: t.tour_type ?? null,
          }))}
          preselectedTourId={massMessageModal.preselectedTourId}
          preselectedSlotId={massMessageModal.preselectedSlotId}
        />
      )}
    </div>
  );
};

export default AgencyBookings;