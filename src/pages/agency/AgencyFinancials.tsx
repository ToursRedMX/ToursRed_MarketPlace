import React, { useState, useEffect } from 'react';
import { useAuth } from '../../context/AuthContext';
import { supabase } from '../../lib/supabase';
import { useAgencyId } from '../../hooks/useAgencyId';
import { DollarSign, TrendingUp, Calendar, Download, FileText, CheckCircle, Clock, Eye, CreditCard, FileSpreadsheet, ShieldAlert } from 'lucide-react';
import AgencyCfdiList from '../../components/AgencyCfdiList';
import { formatCurrencyMXN } from '../../utils/formatCurrency';
import { format } from 'date-fns';
import type { FinancialSummary, TourFinancialSummary, CommissionRecord } from '../../types';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import * as XLSX from 'xlsx';

const AgencyFinancials: React.FC = () => {
  const { user } = useAuth();
  const { agencyId: resolvedAgencyId } = useAgencyId();
  const [agencyId, setAgencyId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [summary, setSummary] = useState<FinancialSummary>({
    pending_balance: 0,
    paid_this_month: 0,
    total_lifetime: 0,
  });
  const [tourSummaries, setTourSummaries] = useState<TourFinancialSummary[]>([]);
  const [commissionRecords, setCommissionRecords] = useState<CommissionRecord[]>([]);
  const [processedPayments, setProcessedPayments] = useState<any[]>([]);
  const [penaltyRecords, setPenaltyRecords] = useState<any[]>([]);
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');

  useEffect(() => {
    if (resolvedAgencyId) {
      setAgencyId(resolvedAgencyId);
    }
  }, [resolvedAgencyId]);

  useEffect(() => {
    if (agencyId) {
      fetchFinancialData();
    }
  }, [agencyId, startDate, endDate, statusFilter]);

  const fetchFinancialData = async () => {
    if (!agencyId) return;

    try {
      setIsLoading(true);

      let query = supabase
        .from('commission_records')
        .select(`
          *,
          bookings!inner(
            tour_id,
            booking_date,
            payment_status,
            status,
            cancelled_at,
            user_payment,
            tours!inner(name, start_date)
          )
        `)
        .eq('agency_id', agencyId)
        .order('created_at', { ascending: false });

      if (startDate) {
        query = query.gte('created_at', startDate);
      }
      if (endDate) {
        query = query.lte('created_at', endDate);
      }
      if (statusFilter !== 'all') {
        query = query.eq('status', statusFilter);
      }

      const { data: records, error } = await query;

      if (error) throw error;

      setCommissionRecords(records || []);

      const { data: penaltiesData } = await supabase
        .from('cancellation_penalty_records')
        .select('*, tours(name, start_date)')
        .eq('agency_id', agencyId)
        .order('created_at', { ascending: false });

      setPenaltyRecords(penaltiesData || []);

      const pending = records?.filter(r => {
        if (r.status === 'voided' || r.status === 'disputed') return false;
        const booking = r.bookings;
        if (!booking) return false;
        if (booking.payment_status !== 'succeeded') return false;
        return r.status === 'pending';
      }).reduce((sum, r) => sum + Number(r.agency_net_amount), 0) || 0;

      const startOfMonth = new Date();
      startOfMonth.setDate(1);
      startOfMonth.setHours(0, 0, 0, 0);

      const paidThisMonth = records?.filter(r => {
        if (r.status === 'voided' || r.status === 'disputed') return false;
        const booking = r.bookings;
        if (!booking) return false;
        if (booking.payment_status !== 'succeeded') return false;
        if (r.status !== 'processed' && r.status !== 'paid_out') return false;
        const processedDate = new Date(r.processed_at || r.created_at);
        return processedDate >= startOfMonth;
      }).reduce((sum, r) => sum + Number(r.agency_net_amount), 0) || 0;

      const totalLifetime = records?.filter(r => {
        if (r.status === 'voided' || r.status === 'disputed') return false;
        const booking = r.bookings;
        if (!booking) return false;
        if (booking.payment_status !== 'succeeded') return false;
        return r.status === 'processed' || r.status === 'paid_out';
      }).reduce((sum, r) => sum + Number(r.agency_net_amount), 0) || 0;

      setSummary({
        pending_balance: pending,
        paid_this_month: paidThisMonth,
        total_lifetime: totalLifetime,
      });

      const tourMap = new Map<string, TourFinancialSummary>();

      records?.forEach(record => {
        if (record.status === 'voided' || record.status === 'disputed') return;

        const booking = record.bookings;
        if (!booking || !booking.tour_id) return;

        const tour = booking.tours;
        if (!tour) return;

        if (booking.payment_status !== 'succeeded') return;

        const tourId = booking.tour_id;

        if (!tourMap.has(tourId)) {
          tourMap.set(tourId, {
            tour_id: tourId,
            tour_name: tour.name,
            tour_date: tour.start_date,
            bookings_count: 0,
            gross_revenue: 0,
            platform_commission: 0,
            net_to_agency: 0,
            payment_status: (record.status === 'processed' || record.status === 'paid_out') ? 'paid' : 'pending',
          });
        }

        const summary = tourMap.get(tourId)!;
        summary.bookings_count++;

        const commissionAmount = Number(record.agency_commission_amount) + Number(record.service_charge_amount);
        const netAmount = Number(record.agency_net_amount);

        summary.gross_revenue += netAmount + commissionAmount;
        summary.platform_commission += commissionAmount;
        summary.net_to_agency += netAmount;
      });

      setTourSummaries(Array.from(tourMap.values()).sort((a, b) =>
        new Date(b.tour_date).getTime() - new Date(a.tour_date).getTime()
      ));

      const processedPaymentsMap = new Map<string, any>();

      records?.filter(r => {
        if (r.status === 'voided' || r.status === 'disputed') return false;
        const booking = r.bookings;
        if (!booking) return false;
        if (booking.payment_status !== 'succeeded') return false;
        return r.status === 'processed' && r.processed_at;
      }).forEach(record => {
        const paymentDate = format(new Date(record.processed_at), 'yyyy-MM-dd');
        const paymentMethod = record.payment_method || 'bank_transfer';

        if (!processedPaymentsMap.has(paymentDate)) {
          processedPaymentsMap.set(paymentDate, {
            payment_date: record.processed_at,
            payment_method: paymentMethod,
            total_amount: 0,
            records_count: 0,
            payment_receipt_url: record.payment_receipt_url,
            payment_notes: record.payment_notes,
          });
        }

        const payment = processedPaymentsMap.get(paymentDate)!;
        payment.total_amount += Number(record.agency_net_amount);
        payment.records_count++;
      });

      setProcessedPayments(Array.from(processedPaymentsMap.values()).sort((a, b) =>
        new Date(b.payment_date).getTime() - new Date(a.payment_date).getTime()
      ));

    } catch (error) {
      console.error('Error fetching financial data:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const formatCurrency = (amount: number) => formatCurrencyMXN(amount);

  const getStatusBadge = (status: string) => {
    const styles = {
      pending: 'bg-yellow-100 text-yellow-800',
      processed: 'bg-blue-100 text-blue-800',
      paid_out: 'bg-green-100 text-green-800',
      paid: 'bg-green-100 text-green-800',
    };

    const labels = {
      pending: 'Pendiente',
      processed: 'Procesado',
      paid_out: 'Pagado',
      paid: 'Pagado',
    };

    return (
      <span className={`px-3 py-1 rounded-full text-sm font-medium ${styles[status as keyof typeof styles] || 'bg-gray-100 text-gray-800'}`}>
        {labels[status as keyof typeof labels] || status}
      </span>
    );
  };

  const getPaymentMethodLabel = (method: string) => {
    const labels: Record<string, string> = {
      bank_transfer: 'Transferencia Bancaria',
      check: 'Cheque',
      paypal: 'PayPal',
      mercadopago: 'Mercado Pago',
      other: 'Otro',
    };
    return labels[method] || method;
  };

  const generatePDFStatement = async () => {
    if (!agencyId) return;

    try {
      const { data: agencyData } = await supabase
        .from('agencies')
        .select('name, email, phone')
        .eq('id', agencyId)
        .single();

      const doc = new jsPDF();

      doc.setFontSize(20);
      doc.text('Estado de Cuenta', 105, 20, { align: 'center' });

      doc.setFontSize(12);
      doc.text(`Agencia: ${agencyData?.name || 'N/A'}`, 20, 35);
      doc.text(`Fecha: ${format(new Date(), 'dd/MM/yyyy')}`, 20, 42);

      if (startDate || endDate) {
        const period = `Período: ${startDate ? format(new Date(startDate), 'dd/MM/yyyy') : 'Inicio'} - ${endDate ? format(new Date(endDate), 'dd/MM/yyyy') : 'Actual'}`;
        doc.text(period, 20, 49);
      }

      doc.setFontSize(14);
      doc.text('Resumen Financiero', 20, 65);

      const summaryData = [
        ['Saldo Pendiente', formatCurrency(summary.pending_balance)],
        ['Cobrado Este Mes', formatCurrency(summary.paid_this_month)],
        ['Total Histórico', formatCurrency(summary.total_lifetime)],
      ];

      autoTable(doc, {
        startY: 70,
        head: [['Concepto', 'Monto']],
        body: summaryData,
        theme: 'grid',
        headStyles: { fillColor: [79, 70, 229] },
      });

      let currentY = (doc as any).lastAutoTable.finalY + 15;

      doc.setFontSize(14);
      doc.text('Detalle por Tour', 20, currentY);

      const tourData = tourSummaries.map(tour => [
        tour.tour_name,
        format(new Date(tour.tour_date), 'dd/MM/yyyy'),
        tour.bookings_count.toString(),
        formatCurrency(tour.gross_revenue),
        formatCurrency(tour.platform_commission),
        formatCurrency(tour.net_to_agency),
        tour.payment_status === 'paid' ? 'Pagado' : 'Pendiente',
      ]);

      autoTable(doc, {
        startY: currentY + 5,
        head: [['Tour', 'Fecha', 'Reservas', 'Ingreso Bruto', 'Comisión', 'Neto', 'Estado']],
        body: tourData,
        theme: 'striped',
        headStyles: { fillColor: [79, 70, 229] },
        styles: { fontSize: 8 },
      });

      currentY = (doc as any).lastAutoTable.finalY + 15;

      if (processedPayments.length > 0) {
        doc.setFontSize(14);
        doc.text('Pagos Recibidos', 20, currentY);

        const paymentsData = processedPayments.map(payment => [
          format(new Date(payment.payment_date), 'dd/MM/yyyy'),
          formatCurrency(payment.total_amount),
          getPaymentMethodLabel(payment.payment_method),
          payment.records_count.toString(),
        ]);

        autoTable(doc, {
          startY: currentY + 5,
          head: [['Fecha', 'Monto', 'Método', 'Comisiones']],
          body: paymentsData,
          theme: 'striped',
          headStyles: { fillColor: [16, 185, 129] },
        });
      }

      doc.save(`estado-cuenta-${format(new Date(), 'yyyy-MM-dd')}.pdf`);
    } catch (error) {
      console.error('Error generating PDF:', error);
      alert('Error al generar el PDF: ' + (error as Error).message);
    }
  };

  const generateExcelStatement = async () => {
    if (!agencyId) return;

    try {
      const { data: agencyData } = await supabase
        .from('agencies')
        .select('name, email, phone')
        .eq('id', agencyId)
        .single();

      let bookingsQuery = supabase
        .from('bookings')
        .select(`
          *,
          tour:tours!inner(name, start_date, agency_id)
        `)
        .eq('tour.agency_id', agencyId)
        .order('booking_date', { ascending: false });

      if (startDate) {
        bookingsQuery = bookingsQuery.gte('booking_date', startDate);
      }
      if (endDate) {
        bookingsQuery = bookingsQuery.lte('booking_date', endDate);
      }

      const { data: bookings, error: bookingsError } = await bookingsQuery;

      if (bookingsError) throw bookingsError;

      const userIds = [...new Set(bookings?.map(b => b.user_id).filter(Boolean))];
      const usersMap = new Map();

      if (userIds.length > 0) {
        const { data: usersData } = await supabase
          .from('users')
          .select('id, first_name, last_name, email')
          .in('id', userIds);

        usersData?.forEach(u => usersMap.set(u.id, u));
      }

      const bookingIds = bookings?.map(b => b.id) || [];
      const travelersMap = new Map<string, any[]>();

      if (bookingIds.length > 0) {
        const { data: travelersData } = await supabase
          .from('booking_travelers')
          .select('*')
          .in('booking_id', bookingIds);

        travelersData?.forEach(traveler => {
          if (!travelersMap.has(traveler.booking_id)) {
            travelersMap.set(traveler.booking_id, []);
          }
          travelersMap.get(traveler.booking_id)!.push(traveler);
        });
      }

      const { data: commissionRecordsData } = await supabase
        .from('commission_records')
        .select('*')
        .eq('agency_id', agencyId);

      const commissionMap = new Map(
        commissionRecordsData?.map(cr => [cr.booking_id, cr]) || []
      );

      const getBookingStatusLabel = (booking: any) => {
        if (booking.cancelled_at || booking.status === 'cancelled') return 'Cancelada';
        if (booking.approval_status === 'rejected') return 'Rechazada';
        if (booking.approval_status === 'pending') return 'Pendiente Aprobación';
        if (booking.status === 'completed') return 'Completada';
        if (booking.status === 'confirmed') return 'Confirmada';
        return booking.status || 'Desconocido';
      };

      const getCommissionStatusLabel = (booking: any, commission: any) => {
        if (booking.cancelled_at || booking.status === 'cancelled') return 'Cancelada';
        if (booking.approval_status === 'rejected') return 'Rechazada';
        if (booking.payment_status !== 'succeeded') return 'Sin Comisión';
        if (!commission) return 'Sin Comisión';
        if (commission.status === 'paid_out') return 'Pagado';
        if (commission.status === 'processed') return 'Procesado';
        return 'Pendiente';
      };

      const wb = XLSX.utils.book_new();

      const summarySheet = [
        ['ESTADO DE CUENTA DETALLADO'],
        ['Agencia:', agencyData?.name || 'N/A'],
        ['Fecha de Generación:', format(new Date(), 'dd/MM/yyyy HH:mm')],
        ['Período:', startDate && endDate ? `${format(new Date(startDate), 'dd/MM/yyyy')} - ${format(new Date(endDate), 'dd/MM/yyyy')}` : 'Completo'],
        [''],
        ['RESUMEN FINANCIERO'],
        ['Concepto', 'Monto (MXN)'],
        ['Saldo Pendiente de Pago', summary.pending_balance],
        ['Cobrado en el Mes Actual', summary.paid_this_month],
        ['Total Histórico Cobrado', summary.total_lifetime],
        [''],
        ['TOTAL DE RESERVAS', bookings?.length || 0],
      ];

      const ws1 = XLSX.utils.aoa_to_sheet(summarySheet);
      ws1['!cols'] = [{ wch: 30 }, { wch: 20 }];
      XLSX.utils.book_append_sheet(wb, ws1, 'Resumen');

      const bookingsSheet = [
        ['DETALLE COMPLETO DE RESERVAS'],
        [''],
        [
          'Código Reserva',
          'Estado Reserva',
          'Fecha Reserva',
          'Tour',
          'Fecha Tour',
          'Cliente',
          'Email Cliente',
          'Total Viajeros',
          'Adultos',
          'Niños',
          'Infantes',
          'Adultos Mayores',
          'Mascotas',
          'Precio Tour Base',
          'Cargo Servicio',
          'Descuento Servicio',
          'ToursRed Cash Usado',
          'Puntos Usados (Valor)',
          'Descuento Código',
          'Total Pagado',
          'Comisión Agencia (%)',
          'Comisión Agencia ($)',
          'Cargo Servicio ($)',
          'Neto para Agencia',
          'Estado Pago Comisión',
          'Método Pago',
          'Fecha Procesado',
        ],
        ...(bookings?.map(booking => {
          const commission = commissionMap.get(booking.id);
          const user = usersMap.get(booking.user_id);

          const isPaid = booking.payment_status === 'succeeded';

          const totalPrice = isPaid ? (Number(booking.total_price) || 0) : 0;
          const serviceCharge = isPaid ? (Number(booking.service_charge) || 0) : 0;
          const serviceChargeDiscount = isPaid ? (Number(booking.service_charge_discount) || 0) : 0;
          const toursredCashUsed = isPaid ? (Number(booking.toursred_cash_used) || 0) : 0;
          const discountAmount = isPaid ? (Number(booking.discount_amount) || 0) : 0;
          const membershipServiceFeeSaved = isPaid ? (Number(booking.membership_service_fee_saved) || 0) : 0;

          const pointsUsed = isPaid ? (booking.points_used || 0) : 0;
          const pointsValue = pointsUsed * 0.1;

          const tourBasePrice = isPaid ? (totalPrice - serviceCharge + serviceChargeDiscount + toursredCashUsed + discountAmount + pointsValue + membershipServiceFeeSaved) : 0;

          return [
            booking.booking_code || booking.id.slice(0, 8),
            getBookingStatusLabel(booking),
            format(new Date(booking.booking_date), 'dd/MM/yyyy HH:mm'),
            booking.tour?.name || 'N/A',
            booking.tour?.start_date ? format(new Date(booking.tour.start_date), 'dd/MM/yyyy') : 'N/A',
            `${user?.first_name || ''} ${user?.last_name || ''}`.trim(),
            user?.email || 'N/A',
            booking.travelers_count || 0,
            booking.count_adultos || 0,
            booking.count_ninos || 0,
            booking.count_infantes || 0,
            booking.count_adultos_mayores || 0,
            booking.count_mascotas || 0,
            tourBasePrice,
            serviceCharge,
            serviceChargeDiscount,
            toursredCashUsed,
            pointsValue,
            discountAmount,
            totalPrice,
            isPaid && commission ? (commission.agency_commission_rate || 0) : 0,
            isPaid && commission ? (Number(commission.agency_commission_amount) || 0) : 0,
            isPaid && commission ? (Number(commission.service_charge_amount) || 0) : 0,
            isPaid && commission ? (Number(commission.agency_net_amount) || 0) : 0,
            getCommissionStatusLabel(booking, commission),
            isPaid && commission?.payment_method ? getPaymentMethodLabel(commission.payment_method) : '-',
            isPaid && commission?.processed_at ? format(new Date(commission.processed_at), 'dd/MM/yyyy') : '-',
          ];
        }) || []),
      ];

      const ws2 = XLSX.utils.aoa_to_sheet(bookingsSheet);
      ws2['!cols'] = [
        { wch: 15 }, { wch: 18 }, { wch: 18 }, { wch: 30 }, { wch: 12 },
        { wch: 25 }, { wch: 30 }, { wch: 12 }, { wch: 10 }, { wch: 10 },
        { wch: 10 }, { wch: 15 }, { wch: 10 }, { wch: 15 }, { wch: 15 },
        { wch: 18 }, { wch: 18 }, { wch: 18 }, { wch: 15 }, { wch: 15 },
        { wch: 18 }, { wch: 18 }, { wch: 18 }, { wch: 18 }, { wch: 20 },
        { wch: 20 }, { wch: 15 },
      ];
      XLSX.utils.book_append_sheet(wb, ws2, 'Detalle Reservas');

      const travelersSheet = [
        ['DETALLE DE VIAJEROS POR RESERVA'],
        [''],
        [
          'Código Reserva',
          'Tour',
          'Viajero',
          'Categoría',
          'Fecha Nacimiento',
          'Teléfono',
          'Email',
          'Precio Aplicado',
        ],
      ];

      bookings?.forEach(booking => {
        const travelers = travelersMap.get(booking.id) || [];
        travelers.forEach((traveler: any) => {
          travelersSheet.push([
            booking.booking_code || booking.id.slice(0, 8),
            booking.tour?.name || 'N/A',
            traveler.nombre || '-',
            traveler.categoria_viajero || 'N/A',
            traveler.fecha_nacimiento ? format(new Date(traveler.fecha_nacimiento), 'dd/MM/yyyy') : '-',
            traveler.telefono || '-',
            traveler.email || '-',
            Number(traveler.precio_aplicado) || 0,
          ]);
        });
      });

      const ws3 = XLSX.utils.aoa_to_sheet(travelersSheet);
      ws3['!cols'] = [
        { wch: 15 }, { wch: 30 }, { wch: 35 }, { wch: 15 }, { wch: 18 },
        { wch: 15 }, { wch: 30 }, { wch: 15 },
      ];
      XLSX.utils.book_append_sheet(wb, ws3, 'Viajeros');

      if (processedPayments.length > 0) {
        const paymentsSheet = [
          ['HISTORIAL DE PAGOS RECIBIDOS'],
          [''],
          ['Fecha Pago', 'Monto Total', 'Método de Pago', 'Comisiones Incluidas', 'Notas'],
          ...processedPayments.map(payment => [
            format(new Date(payment.payment_date), 'dd/MM/yyyy'),
            payment.total_amount,
            getPaymentMethodLabel(payment.payment_method),
            payment.records_count,
            payment.payment_notes || '-',
          ]),
        ];

        const ws4 = XLSX.utils.aoa_to_sheet(paymentsSheet);
        ws4['!cols'] = [{ wch: 15 }, { wch: 15 }, { wch: 25 }, { wch: 20 }, { wch: 50 }];
        XLSX.utils.book_append_sheet(wb, ws4, 'Pagos Recibidos');
      }

      const tourSummarySheet = [
        ['RESUMEN POR TOUR'],
        [''],
        ['Tour', 'Fecha', 'Reservas', 'Ingreso Bruto', 'Comisión Plataforma', 'Neto para Agencia', 'Estado'],
        ...tourSummaries.map(tour => [
          tour.tour_name,
          format(new Date(tour.tour_date), 'dd/MM/yyyy'),
          tour.bookings_count,
          tour.gross_revenue,
          tour.platform_commission,
          tour.net_to_agency,
          tour.payment_status === 'paid' ? 'Pagado' : 'Pendiente',
        ]),
      ];

      const ws5 = XLSX.utils.aoa_to_sheet(tourSummarySheet);
      ws5['!cols'] = [{ wch: 30 }, { wch: 12 }, { wch: 10 }, { wch: 15 }, { wch: 20 }, { wch: 20 }, { wch: 12 }];
      XLSX.utils.book_append_sheet(wb, ws5, 'Resumen Tours');

      XLSX.writeFile(wb, `estado-cuenta-detallado-${format(new Date(), 'yyyy-MM-dd')}.xlsx`);
    } catch (error) {
      console.error('Error generating Excel:', error);
      alert('Error al generar el archivo Excel: ' + (error as Error).message);
    }
  };

  if (isLoading && !agencyId) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-gray-900">Estado Financiero</h1>
        <p className="mt-2 text-gray-600">
          Gestiona y monitorea tus ingresos, comisiones y pagos
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
        <div className="bg-white rounded-lg shadow-md p-6 border-l-4 border-yellow-500">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-600">Saldo Pendiente</p>
              <p className="text-2xl font-bold text-gray-900 mt-2">
                {formatCurrency(summary.pending_balance)}
              </p>
            </div>
            <div className="p-3 bg-yellow-100 rounded-full">
              <Clock className="h-6 w-6 text-yellow-600" />
            </div>
          </div>
          <p className="text-xs text-gray-500 mt-4">Por cobrar de tours completados</p>
        </div>

        <div className="bg-white rounded-lg shadow-md p-6 border-l-4 border-green-500">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-600">Cobrado Este Mes</p>
              <p className="text-2xl font-bold text-gray-900 mt-2">
                {formatCurrency(summary.paid_this_month)}
              </p>
            </div>
            <div className="p-3 bg-green-100 rounded-full">
              <CheckCircle className="h-6 w-6 text-green-600" />
            </div>
          </div>
          <p className="text-xs text-gray-500 mt-4">Pagos recibidos en {format(new Date(), 'MMMM')}</p>
        </div>

        <div className="bg-white rounded-lg shadow-md p-6 border-l-4 border-blue-500">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-600">Total Histórico</p>
              <p className="text-2xl font-bold text-gray-900 mt-2">
                {formatCurrency(summary.total_lifetime)}
              </p>
            </div>
            <div className="p-3 bg-blue-100 rounded-full">
              <TrendingUp className="h-6 w-6 text-blue-600" />
            </div>
          </div>
          <p className="text-xs text-gray-500 mt-4">Ingresos totales acumulados</p>
        </div>

        <div className="bg-white rounded-lg shadow-md p-6 border-l-4 border-orange-500">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-600">Penalizaciones Pendientes</p>
              <p className="text-2xl font-bold text-gray-900 mt-2">
                {formatCurrency(penaltyRecords.filter(r => r.status === 'pending').reduce((s, r) => s + Number(r.agency_net_amount), 0))}
              </p>
            </div>
            <div className="p-3 bg-orange-100 rounded-full">
              <ShieldAlert className="h-6 w-6 text-orange-600" />
            </div>
          </div>
          <p className="text-xs text-gray-500 mt-4">
            {penaltyRecords.filter(r => r.status === 'pending').length} cancelaciones con penalización
          </p>
        </div>
      </div>

      <div className="bg-white rounded-lg shadow-md p-6 mb-8">
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-6">
          <h2 className="text-xl font-bold text-gray-900">Resumen por Tour</h2>
          <div className="flex flex-wrap gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Desde
              </label>
              <input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Hasta
              </label>
              <input
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                className="px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Estado
              </label>
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                className="px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              >
                <option value="all">Todos</option>
                <option value="pending">Pendiente</option>
                <option value="processed">Procesado</option>
                <option value="paid_out">Pagado</option>
              </select>
            </div>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Tour
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Fecha
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Reservas
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Ingreso Bruto
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Comisión Plataforma
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Neto para Agencia
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Estado
                </th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {tourSummaries.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-6 py-8 text-center text-gray-500">
                    No hay registros financieros disponibles
                  </td>
                </tr>
              ) : (
                tourSummaries.map((tour) => (
                  <tr key={tour.tour_id} className="hover:bg-gray-50">
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="text-sm font-medium text-gray-900">{tour.tour_name}</div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="text-sm text-gray-900">
                        {format(new Date(tour.tour_date), 'dd/MM/yyyy')}
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="text-sm text-gray-900">{tour.bookings_count}</div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="text-sm font-medium text-gray-900">
                        {formatCurrency(tour.gross_revenue)}
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="text-sm text-red-600">
                        -{formatCurrency(tour.platform_commission)}
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="text-sm font-bold text-green-600">
                        {formatCurrency(tour.net_to_agency)}
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      {getStatusBadge(tour.payment_status)}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
            {tourSummaries.length > 0 && (
              <tfoot className="bg-gray-50">
                <tr className="font-bold">
                  <td colSpan={2} className="px-6 py-4 text-sm text-gray-900">
                    TOTALES
                  </td>
                  <td className="px-6 py-4 text-sm text-gray-900">
                    {tourSummaries.reduce((sum, t) => sum + t.bookings_count, 0)}
                  </td>
                  <td className="px-6 py-4 text-sm text-gray-900">
                    {formatCurrency(tourSummaries.reduce((sum, t) => sum + t.gross_revenue, 0))}
                  </td>
                  <td className="px-6 py-4 text-sm text-red-600">
                    -{formatCurrency(tourSummaries.reduce((sum, t) => sum + t.platform_commission, 0))}
                  </td>
                  <td className="px-6 py-4 text-sm text-green-600">
                    {formatCurrency(tourSummaries.reduce((sum, t) => sum + t.net_to_agency, 0))}
                  </td>
                  <td></td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>

      <div className="bg-white rounded-lg shadow-md p-6 mb-8">
        <h2 className="text-xl font-bold text-gray-900 mb-6">Pagos Recibidos</h2>

        {processedPayments.length === 0 ? (
          <div className="text-center py-12 bg-gray-50 rounded-lg">
            <CreditCard className="h-12 w-12 text-gray-400 mx-auto mb-3" />
            <p className="text-gray-600 font-medium">No hay pagos recibidos aún</p>
            <p className="text-sm text-gray-500 mt-1">
              Los pagos procesados aparecerán aquí
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            {processedPayments.map((payment, index) => (
              <div
                key={index}
                className="border border-gray-200 rounded-lg p-5 hover:shadow-md transition-shadow"
              >
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                  <div className="flex-1">
                    <div className="flex items-center gap-3 mb-2">
                      <div className="p-2 bg-green-100 rounded-lg">
                        <CreditCard className="h-5 w-5 text-green-600" />
                      </div>
                      <div>
                        <h3 className="text-lg font-semibold text-gray-900">
                          {formatCurrency(payment.total_amount)}
                        </h3>
                        <p className="text-sm text-gray-500">
                          {format(new Date(payment.payment_date), "dd 'de' MMMM, yyyy")}
                        </p>
                      </div>
                    </div>

                    <div className="ml-11 space-y-1">
                      <p className="text-sm text-gray-600">
                        <span className="font-medium">Método:</span> {getPaymentMethodLabel(payment.payment_method)}
                      </p>
                      <p className="text-sm text-gray-600">
                        <span className="font-medium">Comisiones pagadas:</span> {payment.records_count}
                      </p>
                      {payment.payment_notes && (
                        <p className="text-sm text-gray-600">
                          <span className="font-medium">Notas:</span> {payment.payment_notes}
                        </p>
                      )}
                    </div>
                  </div>

                  {payment.payment_receipt_url && (
                    <div>
                      <a
                        href={payment.payment_receipt_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors text-sm font-medium"
                      >
                        <Eye className="h-4 w-4" />
                        Ver Comprobante
                      </a>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {penaltyRecords.length > 0 && (
        <div className="bg-white rounded-lg shadow-md p-6 mb-8">
          <div className="flex items-center gap-3 mb-6">
            <div className="p-2 bg-orange-100 rounded-lg">
              <ShieldAlert className="h-5 w-5 text-orange-600" />
            </div>
            <div>
              <h2 className="text-xl font-bold text-gray-900">Penalizaciones por Cancelación</h2>
              <p className="text-sm text-gray-500">Montos correspondientes a cancelaciones con política de penalización</p>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Fecha</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Tour</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Tipo</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Política</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Monto Bruto</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Te Corresponde</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Estado</th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {penaltyRecords.map((record) => (
                  <tr key={record.id} className="hover:bg-gray-50">
                    <td className="px-6 py-4 text-sm text-gray-900">
                      {format(new Date(record.created_at), 'dd/MM/yyyy')}
                    </td>
                    <td className="px-6 py-4 text-sm font-medium text-gray-900">
                      {record.tours?.name || '-'}
                    </td>
                    <td className="px-6 py-4">
                      <span className={`px-2 py-1 text-xs rounded-full font-medium ${record.cancellation_type === 'full' ? 'bg-red-100 text-red-700' : 'bg-yellow-100 text-yellow-700'}`}>
                        {record.cancellation_type === 'full' ? 'Total' : 'Parcial'}
                      </span>
                    </td>
                    <td className="px-6 py-4">
                      {record.cancellation_policy_type === '50_percent' ? (
                        <span className="px-2 py-1 bg-yellow-100 text-yellow-800 text-xs rounded-full font-medium">50% Penalización</span>
                      ) : (
                        <span className="px-2 py-1 bg-red-100 text-red-800 text-xs rounded-full font-medium">Sin Reembolso</span>
                      )}
                    </td>
                    <td className="px-6 py-4 text-sm text-gray-900 font-medium">
                      {formatCurrency(Number(record.gross_penalty))}
                    </td>
                    <td className="px-6 py-4 text-sm font-bold text-orange-700">
                      {formatCurrency(Number(record.agency_net_amount))}
                    </td>
                    <td className="px-6 py-4">
                      {record.status === 'pending' ? (
                        <span className="px-3 py-1 bg-yellow-100 text-yellow-800 text-sm rounded-full font-medium">Pendiente de pago</span>
                      ) : (
                        <div>
                          <span className="px-3 py-1 bg-green-100 text-green-800 text-sm rounded-full font-medium">Pagado</span>
                          {record.processed_at && (
                            <p className="text-xs text-gray-500 mt-1 ml-1">{format(new Date(record.processed_at), 'dd/MM/yyyy')}</p>
                          )}
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="bg-gray-50">
                <tr className="font-bold">
                  <td colSpan={4} className="px-6 py-4 text-sm text-gray-900">TOTALES</td>
                  <td className="px-6 py-4 text-sm text-gray-900">{formatCurrency(penaltyRecords.reduce((s, r) => s + Number(r.gross_penalty), 0))}</td>
                  <td className="px-6 py-4 text-sm text-orange-700">{formatCurrency(penaltyRecords.reduce((s, r) => s + Number(r.agency_net_amount), 0))}</td>
                  <td></td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      )}

      <div className="bg-blue-50 border border-blue-200 rounded-lg p-6">
        <div className="flex flex-col sm:flex-row items-start gap-4">
          <FileText className="h-6 w-6 text-blue-600 mt-1 flex-shrink-0" />
          <div className="flex-1">
            <h3 className="text-lg font-semibold text-gray-900 mb-2">
              Descargar Estado de Cuenta
            </h3>
            <p className="text-gray-700 mb-4">
              Genera y descarga tu estado de cuenta completo con el desglose de todas tus transacciones, pagos recibidos y saldos pendientes.
            </p>
            <div className="flex flex-wrap gap-3">
              <button
                onClick={generatePDFStatement}
                className="flex items-center gap-2 bg-red-600 text-white px-6 py-2 rounded-lg hover:bg-red-700 transition-colors font-medium"
              >
                <Download className="h-4 w-4" />
                Descargar PDF
              </button>
              <button
                onClick={generateExcelStatement}
                className="flex items-center gap-2 bg-green-600 text-white px-6 py-2 rounded-lg hover:bg-green-700 transition-colors font-medium"
              >
                <FileSpreadsheet className="h-4 w-4" />
                Descargar Excel
              </button>
            </div>
          </div>
        </div>

        {/* CFDI Invoices Section */}
        {agencyId && (
          <div className="mt-8">
            <AgencyCfdiList agencyId={agencyId} />
          </div>
        )}
      </div>
    </div>
  );
};

export default AgencyFinancials;