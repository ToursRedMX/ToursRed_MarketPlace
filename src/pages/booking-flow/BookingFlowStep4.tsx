import React, { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ChevronLeft, AlertCircle, Tag, Award, Wallet, Crown, Shield,
  Loader2, CreditCard, Check, X, Sparkles, ExternalLink, Landmark, Banknote,
} from 'lucide-react';
import { useBookingFlow } from '../../context/BookingFlowContext';
import { useAuth } from '../../context/AuthContext';
import { useMembershipPrices } from '../../hooks/useMembershipPrices';
import { supabase } from '../../lib/supabase';
import { formatCurrencyMXN } from '../../utils/formatCurrency';
import { totalTravelerCount } from '../../types/booking-flow';
import type { Tour } from '../../types';
import PaymentProviderSelector, {
  PaymentProvider as Provider,
  ConektaMethod,
  OpenpayMethod,
} from '../../components/PaymentProviderSelector';

const CATEGORIA_LABELS: Record<string, string> = {
  adulto: 'Adulto',
  nino: 'Niño',
  infante: 'Infante',
  adulto_mayor: 'Adulto Mayor',
  mascota: 'Mascota',
};

const CATEGORIA_ORDER = ['adulto', 'nino', 'infante', 'adulto_mayor', 'mascota'];

const BookingFlowStep4: React.FC = () => {
  const { flow, updateFlow, goToStep, sessionId, resetFlow } = useBookingFlow();
  const { user } = useAuth();
  const navigate = useNavigate();
  const { prices: membershipPrices } = useMembershipPrices();

  const tour = flow.tour;
  const [isLoadingSettings, setIsLoadingSettings] = useState(true);
  const [serviceChargePct, setServiceChargePct] = useState(10);
  const [insurancePricePerDay, setInsurancePricePerDay] = useState(79);
  const [hasMembership, setHasMembership] = useState(false);
  const [walletBalance, setWalletBalance] = useState(0);
  const [pointsBalance, setPointsBalance] = useState(0);
  const [useWallet, setUseWallet] = useState(false);
  const [usePoints, setUsePoints] = useState(false);
  const [discountInput, setDiscountInput] = useState(flow.discountCode);
  const [isApplyingDiscount, setIsApplyingDiscount] = useState(false);
  const [discountError, setDiscountError] = useState('');
  const [discountApplied, setDiscountApplied] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [createError, setCreateError] = useState('');
  const [openpayInstructions, setOpenpayInstructions] = useState<any>(null);
  const [remainingExemption, setRemainingExemption] = useState(0);
  const [monthlyExemptionLimit, setMonthlyExemptionLimit] = useState(500);

  useEffect(() => {
    if (!tour || !user) return;
    const load = async () => {
      try {
        const { data: settings } = await supabase
          .from('platform_settings')
          .select('service_charge_percentage, travel_insurance_price_per_day_per_traveler')
          .maybeSingle();
        if (settings) {
          setServiceChargePct(settings.service_charge_percentage || 10);
          if (settings.travel_insurance_price_per_day_per_traveler != null) {
            setInsurancePricePerDay(settings.travel_insurance_price_per_day_per_traveler);
          }
        }

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

        if (isActive) {
          try {
            const { data: exemptData } = await supabase.rpc('get_remaining_service_fee_exemption', {
              p_user_id: user.id,
            });
            if (exemptData && typeof exemptData === 'object' && 'remaining' in exemptData) {
              setRemainingExemption(exemptData.remaining || 0);
              setMonthlyExemptionLimit(exemptData.monthly_limit || 500);
            }
          } catch {
            // non-critical
          }
        }

        const { data: walletData } = await supabase
          .from('toursred_cash_wallets')
          .select('balance')
          .eq('user_id', user.id)
          .eq('is_active', true)
          .maybeSingle();
        setWalletBalance(walletData?.balance || 0);

        const { data: pointsData } = await supabase
          .from('toursred_points_wallets')
          .select('balance')
          .eq('user_id', user.id)
          .maybeSingle();
        setPointsBalance(pointsData?.balance || 0);
      } catch {
        // non-critical
      } finally {
        setIsLoadingSettings(false);
      }
    };
    load();
  }, [tour, user]);

  // Price calculations
  const totalTravelers = totalTravelerCount(flow.travelerCounts);

  const baseTourPrice = useMemo(() => {
    if (!tour) return 0;
    return flow.travelers.reduce((sum, t) => sum + (t.precio_aplicado || 0), 0);
  }, [tour, flow.travelers]);

  // Traveler category breakdown
  const travelerCategoryBreakdown = useMemo(() => {
    const groups: Record<string, { count: number; unitPrice: number; subtotal: number }> = {};
    for (const t of flow.travelers) {
      const cat = t.categoria_viajero || 'adulto';
      if (!groups[cat]) {
        groups[cat] = { count: 0, unitPrice: t.precio_aplicado || 0, subtotal: 0 };
      }
      groups[cat].count += 1;
      groups[cat].subtotal += t.precio_aplicado || 0;
      // keep unitPrice as the first traveler's price for the label (all same category same price)
    }
    return CATEGORIA_ORDER
      .filter((cat) => groups[cat] && groups[cat].count > 0)
      .map((cat) => ({ cat, ...groups[cat] }));
  }, [flow.travelers]);

  const extrasSubtotal = useMemo(() => {
    return flow.optionalServices.reduce((sum, s) => sum + (s.subtotal || 0), 0);
  }, [flow.optionalServices]);

  const extrasServiceChargeBase = useMemo(() => {
    return flow.optionalServices.reduce((sum, s) => sum + (s.service_charge || 0), 0);
  }, [flow.optionalServices]);

  const insuranceDays = useMemo(() => {
    if (!tour || !flow.includeInsurance) return 0;
    if (tour.tour_type === 'receptivo' && (tour as any).receptivo_modality === 'privado') return 1;
    const start = tour.start_date ? new Date(tour.start_date + 'T12:00:00') : null;
    const end = tour.end_date ? new Date(tour.end_date + 'T12:00:00') : null;
    if (!start || !end) return 1;
    const days = Math.ceil((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)) + 1;
    return Math.max(1, days);
  }, [tour, flow.includeInsurance]);

  const insuranceCost = useMemo(() => {
    if (!flow.includeInsurance) return 0;
    return insurancePricePerDay * insuranceDays * totalTravelers;
  }, [flow.includeInsurance, insurancePricePerDay, insuranceDays, totalTravelers]);

  const baseServiceCharge = useMemo(() => {
    return Math.round(baseTourPrice * (serviceChargePct / 100) * 100) / 100;
  }, [baseTourPrice, serviceChargePct]);

  const shouldWaiveServiceCharge = hasMembership || flow.addMembership;

  const exemptionUsed = useMemo(() => {
    if (shouldWaiveServiceCharge && hasMembership) {
      return Math.min(baseServiceCharge, remainingExemption);
    }
    if (flow.addMembership) return baseServiceCharge;
    return 0;
  }, [baseServiceCharge, shouldWaiveServiceCharge, hasMembership, flow.addMembership, remainingExemption]);

  const depositServiceCharge = useMemo(() => {
    if (shouldWaiveServiceCharge && hasMembership) {
      return Math.round((baseServiceCharge - exemptionUsed) * 100) / 100;
    }
    if (flow.addMembership) return 0;
    return baseServiceCharge;
  }, [baseServiceCharge, shouldWaiveServiceCharge, hasMembership, flow.addMembership, exemptionUsed]);

  const extrasExemptionUsed = useMemo(() => {
    const remainingAfterDeposit = Math.max(0, remainingExemption - exemptionUsed);
    if (shouldWaiveServiceCharge && hasMembership) {
      return Math.min(extrasServiceChargeBase, remainingAfterDeposit);
    }
    if (flow.addMembership) return extrasServiceChargeBase;
    return 0;
  }, [extrasServiceChargeBase, shouldWaiveServiceCharge, hasMembership, flow.addMembership, remainingExemption, exemptionUsed]);

  const extrasServiceCharge = useMemo(() => {
    if (shouldWaiveServiceCharge && hasMembership) {
      return Math.round((extrasServiceChargeBase - extrasExemptionUsed) * 100) / 100;
    }
    if (flow.addMembership) return 0;
    return extrasServiceChargeBase;
  }, [extrasServiceChargeBase, shouldWaiveServiceCharge, hasMembership, flow.addMembership, extrasExemptionUsed]);

  const hasReachedExemptionLimit = hasMembership && remainingExemption < (baseServiceCharge + extrasServiceChargeBase);

  const membershipCost = useMemo(() => {
    if (!flow.addMembership || hasMembership || !membershipPrices) return 0;
    return flow.membershipPlan === 'anual' ? membershipPrices.annualPrice : membershipPrices.monthlyPrice;
  }, [flow.addMembership, flow.membershipPlan, hasMembership, membershipPrices]);

  const subtotalBeforeDiscount = baseTourPrice + extrasSubtotal + extrasServiceCharge + insuranceCost + depositServiceCharge + membershipCost;

  const discountAmount = flow.discountAmount || 0;
  const pointsDiscount = usePoints ? Math.min(flow.pointsUsed, pointsBalance, subtotalBeforeDiscount - discountAmount) : 0;
  const walletDiscount = useWallet ? Math.min(flow.toursredCashUsed, walletBalance, subtotalBeforeDiscount - discountAmount - pointsDiscount) : 0;

  const grandTotal = Math.max(0, subtotalBeforeDiscount - discountAmount - pointsDiscount - walletDiscount);

  const depositAmount = useMemo(() => {
    if (!tour) return grandTotal;
    const pct = tour.deposit_percentage || 50;
    return Math.round(grandTotal * (pct / 100) * 100) / 100;
  }, [tour, grandTotal]);

  const amountToPay = depositAmount;

  // ToursRed Cash benefit: wallet covers 100% of the total
  const wouldQualifyForWalletBenefit = !useWallet
    && walletBalance > 0
    && totalTravelers > 0
    && !flow.addMembership
    && walletBalance >= grandTotal;

  // Points to earn on this payment
  const isDoublePoints = useWallet && hasMembership;
  const pointsToEarn = isDoublePoints
    ? Math.floor(amountToPay) * 2
    : Math.floor(amountToPay);

  if (!tour) return null;

  const handleApplyDiscount = async () => {
    if (!discountInput.trim() || !user) return;
    setIsApplyingDiscount(true);
    setDiscountError('');
    try {
      const { data, error } = await supabase.rpc('validate_discount_code', {
        p_code: discountInput.trim().toUpperCase(),
        p_user_id: user.id,
        p_tour_id: tour.id,
        p_amount: subtotalBeforeDiscount,
      });
      if (error) throw error;
      if (!data || data.length === 0 || !data[0].valid) {
        setDiscountError('Codigo de descuento invalido o expirado.');
        setDiscountApplied(false);
        return;
      }
      const result = data[0];
      updateFlow({
        discountCode: discountInput.trim().toUpperCase(),
        discountCodeId: result.discount_code_id,
        discountAmount: Number(result.discount_amount) || 0,
      });
      setDiscountApplied(true);
    } catch {
      setDiscountError('Error al validar el codigo.');
    } finally {
      setIsApplyingDiscount(false);
    }
  };

  const handleRemoveDiscount = () => {
    updateFlow({ discountCode: '', discountCodeId: null, discountAmount: 0 });
    setDiscountInput('');
    setDiscountApplied(false);
  };

  const handlePayment = async () => {
    if (!user) {
      navigate('/login');
      return;
    }

    setCreateError('');
    setIsCreating(true);

    try {
      const bookingDate = flow.selectedSlot?.slot_date || flow.selectedDate || new Date().toISOString().split('T')[0];

      const bookingData: Record<string, any> = {
        user_id: user.id,
        tour_id: tour.id,
        agency_id: tour.agency_id || tour.agencies?.id,
        travelers_count: totalTravelers,
        total_price: grandTotal,
        deposit_amount: depositAmount,
        commission_amount: Math.round(baseTourPrice * ((tour.commission_rate || tour.agencies?.commission_rate || 10) / 100) * 100) / 100,
        service_charge: depositServiceCharge,
        user_payment: amountToPay,
        platform_revenue: depositServiceCharge + extrasServiceCharge,
        booking_date: bookingDate,
        slot_id: flow.selectedSlot?.id || null,
        selected_date: flow.selectedDate || null,
        selected_time: flow.selectedTime || null,
        status: 'pending',
        payment_status: 'pending',
        approval_status: 'approved',
        count_adultos: flow.travelerCounts.adultos,
        count_ninos: flow.travelerCounts.ninos,
        count_infantes: flow.travelerCounts.infantes,
        count_adultos_mayores: flow.travelerCounts.adultos_mayores,
        count_mascotas: flow.travelerCounts.mascotas,
        points_used: usePoints ? flow.pointsUsed : 0,
        toursred_cash_used: walletDiscount,
        discount_code_id: flow.discountCodeId || null,
        discount_amount: discountAmount,
        service_charge_discount: 0,
        payment_provider: flow.paymentProvider,
        conekta_method: flow.paymentProvider === 'conekta' ? flow.conektaMethod : null,
        openpay_method: flow.paymentProvider === 'openpay' ? flow.openpayMethod : null,
        pickup_type: flow.pickupType,
        pickup_zone_name: flow.pickupZoneName,
        pickup_zone_extra_cost: flow.optionalServices.filter(e => e.service_kind === 'pickup').reduce((s, e) => s + e.subtotal, 0),
        selected_language: flow.selectedLanguage,
        language_extra_cost: flow.optionalServices.filter(e => e.service_kind === 'language').reduce((s, e) => s + e.subtotal, 0),
        restrictions_accepted: flow.restrictionsAccepted,
        es_reserva_preventa: false,
        travel_insurance_included: flow.includeInsurance,
        travel_insurance_cost: insuranceCost,
        insurance_days: insuranceDays,
        selected_payment_mode: 'standard',
        membership_purchased: flow.addMembership,
        membership_plan: flow.addMembership ? flow.membershipPlan : null,
        membership_cost: membershipCost,
        initial_payment_amount: amountToPay,
      };

      const travelersJson = flow.travelers.map((t) => ({
        nombre: t.nombre,
        apellido: t.apellido,
        email: t.email,
        telefono: t.telefono,
        fecha_nacimiento: t.fecha_nacimiento || null,
        tipo_documento: t.tipo_documento || null,
        numero_documento: t.numero_documento || null,
        curp: t.curp || null,
        pasaporte: t.pasaporte || null,
        categoria_viajero: t.categoria_viajero,
        contacto_emergencia_nombre: t.contacto_emergencia_nombre || null,
        contacto_emergencia_telefono: t.contacto_emergencia_telefono || null,
        sexo: t.sexo || null,
      }));

      const optionalServicesJson = flow.optionalServices.map((s) => ({
        tour_optional_service_id: s.tour_optional_service_id,
        service_kind: s.service_kind,
        description: s.description,
        quantity: s.quantity,
        unit_price: s.unit_price,
        subtotal: s.subtotal,
        service_charge: s.service_charge,
        agency_commission: s.agency_commission,
        total_paid: s.total_paid,
      }));

      const { data: bookingResult, error: bookingError } = await supabase.rpc('create_booking_atomic', {
        p_booking_data: bookingData,
        p_travelers: travelersJson,
        p_optional_services: optionalServicesJson,
        p_session_id: sessionId,
        p_seat_numbers: flow.selectedSeats.length > 0 ? flow.selectedSeats : null,
      });

      if (bookingError) throw bookingError;
      if (!bookingResult || !bookingResult.success) {
        throw new Error(bookingResult?.error || 'Error al crear la reserva');
      }

      const bookingId = bookingResult.booking_id;

      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (session) {
          await fetch(
            `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/send-booking-request-notification`,
            {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${session.access_token}`,
              },
              body: JSON.stringify({ bookingId }),
            }
          );
        }
      } catch {
        // non-critical
      }

      const isWalletOnly = flow.paymentProvider === 'toursred_cash' && amountToPay <= walletDiscount;

      if (isWalletOnly) {
        const idempotencyKey = `${bookingId}-${Date.now()}`;
        const { error: walletError } = await supabase.rpc('confirm_booking_paid_with_wallet', {
          p_booking_id: bookingId,
          p_points_to_use: usePoints ? flow.pointsUsed : 0,
          p_cash_to_use: walletDiscount,
          p_idempotency_key: idempotencyKey,
        });
        if (walletError) {
          throw new Error('La reserva se creo pero el pago con billetera fallo. Ve a tus reservas para completar el pago.');
        }
        resetFlow();
        navigate(`/booking-success?booking_id=${bookingId}`);
        return;
      }

      if (flow.paymentProvider === 'stripe') {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session) throw new Error('No hay sesion activa');
        const resp = await fetch(
          `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/create-checkout-session`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${session.access_token}` },
            body: JSON.stringify({ bookingId, customerEmail: user.email, amount: amountToPay, description: `Deposito para ${tour.name}`, addMembership: flow.addMembership, membershipPlan: flow.membershipPlan, toursRedCashUsed: walletDiscount }),
          }
        );
        if (!resp.ok) { const err = await resp.json().catch(() => ({})); throw new Error(err.error || 'Error al crear la sesion de pago'); }
        const { url } = await resp.json();
        window.location.href = url;
        return;
      }

      if (flow.paymentProvider === 'mercadopago') {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session) throw new Error('No hay sesion activa');
        const resp = await fetch(
          `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/create-mercadopago-preference`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${session.access_token}` },
            body: JSON.stringify({ bookingId, amount: amountToPay, description: `Deposito para ${tour.name}` }),
          }
        );
        if (!resp.ok) throw new Error('Error al crear la preferencia de pago');
        const { init_point } = await resp.json();
        window.location.href = init_point;
        return;
      }

      if (flow.paymentProvider === 'paypal') {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session) throw new Error('No hay sesion activa');
        const resp = await fetch(
          `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/create-paypal-order`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${session.access_token}` },
            body: JSON.stringify({ bookingId, amount: amountToPay, description: `Deposito para ${tour.name}` }),
          }
        );
        if (!resp.ok) throw new Error('Error al crear la orden de PayPal');
        const { approvalUrl } = await resp.json();
        window.location.href = approvalUrl;
        return;
      }

      if (flow.paymentProvider === 'conekta') {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session) throw new Error('No hay sesion activa');
        const resp = await fetch(
          `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/create-conekta-order`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${session.access_token}` },
            body: JSON.stringify({ bookingId, amount: amountToPay, description: `Deposito para ${tour.name}`, method: flow.conektaMethod }),
          }
        );
        if (!resp.ok) throw new Error('Error al crear la orden de Conekta');
        const data = await resp.json();
        if (data.checkoutUrl) window.location.href = data.checkoutUrl;
        return;
      }

      if (flow.paymentProvider === 'openpay') {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session) throw new Error('No hay sesion activa');
        const resp = await fetch(
          `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/create-openpay-checkout`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${session.access_token}` },
            body: JSON.stringify({ bookingId, amount: amountToPay, description: `Deposito para ${tour.name}`, context: 'booking', method: flow.openpayMethod }),
          }
        );
        if (!resp.ok) throw new Error('Error al crear el cargo de Openpay');
        const data = await resp.json();
        if (data.url) {
          window.location.href = data.url;
          return;
        }
        if (data.payment_method) {
          setOpenpayInstructions(data);
          setIsCreating(false);
          return;
        }
        throw new Error('Respuesta inesperada de Openpay');
      }

      resetFlow();
      navigate(`/booking-pending?booking_id=${bookingId}`);
    } catch (err: any) {
      setCreateError(err.message || 'Error al procesar la reserva. Intenta de nuevo.');
    } finally {
      setIsCreating(false);
    }
  };

  const handleBack = () => {
    goToStep(3);
    navigate(`/reservar/${flow.tourSlug}/paso-3`);
  };

  const paymentContext = flow.addMembership ? 'booking_with_membership' : 'booking';

  return (
    <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
      <div className="p-6">
        <h1 className="text-2xl font-bold text-gray-900 mb-1">Resumen y pago</h1>
        <p className="text-sm text-gray-500 mb-6">Paso 4 de 4 — Revisa y paga tu reserva</p>

        {createError && (
          <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm flex items-start gap-2">
            <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
            {createError}
          </div>
        )}

        {/* Cost breakdown */}
        <div className="mb-6 p-4 bg-gray-50 rounded-xl space-y-2">

          {/* Traveler category breakdown */}
          {travelerCategoryBreakdown.length > 0 && (
            <div className="space-y-1 pb-1">
              {travelerCategoryBreakdown.map(({ cat, count, unitPrice, subtotal }) => (
                <div key={cat} className="flex justify-between text-sm text-gray-500">
                  <span>
                    {count} {CATEGORIA_LABELS[cat] || cat}{count !== 1 ? (cat === 'adulto_mayor' ? 'es' : cat === 'infante' ? 's' : 's') : ''} × {formatCurrencyMXN(unitPrice)}
                  </span>
                  <span>{formatCurrencyMXN(subtotal)}</span>
                </div>
              ))}
            </div>
          )}

          {/* Tour total */}
          <div className="flex justify-between text-sm border-t border-gray-200 pt-2">
            <span className="font-medium text-gray-700">Tour ({totalTravelers} viajero{totalTravelers !== 1 ? 's' : ''})</span>
            <span className="font-semibold text-gray-800">{formatCurrencyMXN(baseTourPrice)}</span>
          </div>

          {/* Optional services */}
          {extrasSubtotal > 0 && (
            <div className="flex justify-between text-sm">
              <span className="text-gray-600">Servicios opcionales</span>
              <span className="font-medium text-gray-800">{formatCurrencyMXN(extrasSubtotal)}</span>
            </div>
          )}

          {/* Extras service charge: bruto → descuento → neto */}
          {extrasServiceChargeBase > 0 && (
            <>
              <div className="flex justify-between text-sm">
                <span className="text-gray-600">Cargo por servicio (extras)</span>
                <span className="font-medium text-gray-800">{formatCurrencyMXN(extrasServiceChargeBase)}</span>
              </div>
              {shouldWaiveServiceCharge && extrasExemptionUsed > 0 && (
                <div className="flex justify-between text-sm text-green-600">
                  <span className="flex items-center gap-1">
                    <Check className="w-3 h-3" /> Descuento por membresía (extras)
                  </span>
                  <span className="font-medium">-{formatCurrencyMXN(extrasExemptionUsed)}</span>
                </div>
              )}
              {shouldWaiveServiceCharge && extrasExemptionUsed > 0 && (
                <div className="flex justify-between text-sm text-gray-500">
                  <span className="pl-4">Cargo por servicio (extras, con descuento)</span>
                  <span className="font-medium text-gray-700">{formatCurrencyMXN(extrasServiceCharge)}</span>
                </div>
              )}
            </>
          )}

          {/* Insurance */}
          {insuranceCost > 0 && (
            <div className="flex justify-between text-sm">
              <span className="text-gray-600 flex items-center gap-1">
                <Shield className="w-3 h-3" /> Seguro de viaje ({insuranceDays} días)
              </span>
              <span className="font-medium text-gray-800">{formatCurrencyMXN(insuranceCost)}</span>
            </div>
          )}

          {/* Deposit service charge: bruto → descuento → neto */}
          <div className="flex justify-between text-sm">
            <span className="text-gray-600">Cargo por servicio</span>
            <span className="font-medium text-gray-800">{formatCurrencyMXN(baseServiceCharge)}</span>
          </div>
          {shouldWaiveServiceCharge && exemptionUsed > 0 && (
            <div className="flex justify-between text-sm text-green-600">
              <span className="flex items-center gap-1">
                <Check className="w-3 h-3" /> {flow.addMembership ? 'Exento por nueva membresía' : 'Descuento por membresía'}
              </span>
              <span className="font-medium">-{formatCurrencyMXN(exemptionUsed)}</span>
            </div>
          )}
          {shouldWaiveServiceCharge && exemptionUsed > 0 && (
            <div className="flex justify-between text-sm text-gray-500">
              <span className="pl-4">Cargo por servicio (con descuento)</span>
              <span className="font-medium text-gray-700">{formatCurrencyMXN(depositServiceCharge)}</span>
            </div>
          )}
          {hasReachedExemptionLimit && depositServiceCharge > 0 && (
            <div className="mt-1 p-2 bg-orange-50 border border-orange-200 rounded-md">
              <p className="text-xs text-gray-700">
                Has usado {formatCurrencyMXN(monthlyExemptionLimit - remainingExemption)} MXN de tus {formatCurrencyMXN(monthlyExemptionLimit)} MXN de descuento este mes. Esta reserva aplicará un cargo por servicio de {formatCurrencyMXN(depositServiceCharge)} MXN.
              </p>
            </div>
          )}

          {/* Membership add-on */}
          {membershipCost > 0 && (
            <div className="flex justify-between text-sm text-amber-600">
              <span className="flex items-center gap-1">
                <Crown className="w-3 h-3" /> Membresía ToursRed+ ({flow.membershipPlan === 'anual' ? 'Anual' : 'Mensual'})
              </span>
              <span className="font-medium">+{formatCurrencyMXN(membershipCost)}</span>
            </div>
          )}

          {/* Discount code */}
          {discountAmount > 0 && (
            <div className="flex justify-between text-sm text-green-600">
              <span className="flex items-center gap-1">
                <Tag className="w-3 h-3" /> Descuento ({flow.discountCode})
              </span>
              <span className="font-medium">-{formatCurrencyMXN(discountAmount)}</span>
            </div>
          )}

          {/* Points discount */}
          {pointsDiscount > 0 && (
            <div className="flex justify-between text-sm text-amber-600">
              <span className="flex items-center gap-1">
                <Award className="w-3 h-3" /> Puntos ToursRed
              </span>
              <span className="font-medium">-{formatCurrencyMXN(pointsDiscount)} ({flow.pointsUsed.toLocaleString()} pts)</span>
            </div>
          )}

          {/* Wallet discount */}
          {walletDiscount > 0 && (
            <div className="flex justify-between text-sm text-teal-600">
              <span className="flex items-center gap-1">
                <Wallet className="w-3 h-3" /> ToursRed Cash
              </span>
              <span className="font-medium">-{formatCurrencyMXN(walletDiscount)}</span>
            </div>
          )}

          {/* Grand total */}
          <div className="border-t pt-2 flex justify-between">
            <span className="font-bold text-gray-900">Total</span>
            <span className="font-bold text-primary-600 text-lg">{formatCurrencyMXN(grandTotal)}</span>
          </div>

          {depositAmount < grandTotal && (
            <div className="flex justify-between text-sm bg-primary-50 -mx-4 -mb-4 px-4 py-2 rounded-b-xl">
              <span className="font-medium text-primary-700">Depósito a pagar ahora ({tour.deposit_percentage}%)</span>
              <span className="font-bold text-primary-700">{formatCurrencyMXN(depositAmount)}</span>
            </div>
          )}
        </div>

        {/* ToursRed Points earned banner */}
        {amountToPay > 0 && (
          <div className="mb-6 p-4 bg-gradient-to-r from-green-50 to-emerald-50 border border-green-200 rounded-xl flex items-start gap-3">
            <div className="w-8 h-8 bg-green-100 rounded-full flex items-center justify-center flex-shrink-0">
              <Sparkles className="w-4 h-4 text-green-600" />
            </div>
            <div>
              <p className="text-sm font-semibold text-green-800">
                Vas a acumular ToursRed Points
              </p>
              <p className="text-sm text-green-700 mt-0.5">
                Ganarás{' '}
                <span className="font-bold text-green-800">{pointsToEarn.toLocaleString()} puntos</span>
                {' '}con este pago
                {isDoublePoints && (
                  <span className="ml-1 inline-flex items-center gap-0.5 text-xs font-semibold text-emerald-700 bg-emerald-100 px-1.5 py-0.5 rounded-full">
                    ×2 puntos
                  </span>
                )}
                .
              </p>
              {isDoublePoints && (
                <p className="text-xs text-green-600 mt-1">
                  ¡Estás ganando el doble por pagar con ToursRed Cash y tener membresía activa!
                </p>
              )}
            </div>
          </div>
        )}

        {/* ToursRed Cash benefit banner (shown when wallet could cover 100%) */}
        {wouldQualifyForWalletBenefit && (
          <div className="mb-4 p-4 bg-gradient-to-r from-teal-50 to-emerald-50 border border-teal-300 rounded-xl">
            <div className="flex items-start gap-3">
              <div className="w-8 h-8 bg-teal-100 rounded-full flex items-center justify-center flex-shrink-0">
                <Wallet className="w-4 h-4 text-teal-600" />
              </div>
              <div className="flex-1">
                <p className="text-base font-semibold text-teal-900">
                  Beneficio exclusivo con ToursRed Cash
                </p>
                <p className="text-sm text-teal-800 mt-1 leading-relaxed">
                  Paga el 100% de tu reserva con ToursRed Cash y no pagues el cargo por servicio.
                  Adicionalmente, gana el doble de puntos.
                </p>
                {hasMembership && (
                  <p className="text-sm font-medium text-teal-700 mt-2">
                    Ganarías{' '}
                    <span className="font-bold">{(Math.floor(amountToPay) * 2).toLocaleString()} ToursRed Points</span>
                    {' '}con este pago.
                  </p>
                )}
              </div>
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => window.open('/traveler/wallet', '_blank')}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-teal-700 bg-white border border-teal-300 rounded-lg hover:bg-teal-50 transition-colors"
              >
                <ExternalLink className="w-3.5 h-3.5" />
                Recargar mi monedero
              </button>
            </div>
          </div>
        )}

        {/* Discount code */}
        <div className="mb-6">
          <label className="block text-sm font-medium text-gray-700 mb-2">Código de descuento</label>
          {discountApplied ? (
            <div className="flex items-center gap-2 p-3 bg-green-50 border border-green-200 rounded-lg">
              <Check className="w-4 h-4 text-green-600" />
              <span className="text-sm text-green-800 font-medium">{flow.discountCode} aplicado</span>
              <button onClick={handleRemoveDiscount} className="ml-auto text-sm text-red-600 hover:underline">
                Quitar
              </button>
            </div>
          ) : (
            <div className="flex gap-2">
              <input
                type="text"
                value={discountInput}
                onChange={(e) => setDiscountInput(e.target.value)}
                placeholder="Ingresa tu código"
                className="input text-sm flex-1"
              />
              <button
                onClick={handleApplyDiscount}
                disabled={isApplyingDiscount || !discountInput.trim()}
                className="px-4 py-2 bg-gray-800 text-white text-sm font-medium rounded-lg hover:bg-gray-700 disabled:bg-gray-300"
              >
                {isApplyingDiscount ? 'Validando...' : 'Aplicar'}
              </button>
            </div>
          )}
          {discountError && (
            <p className="text-xs text-red-600 mt-1">{discountError}</p>
          )}
        </div>

        {/* Points toggle */}
        {pointsBalance > 0 && (
          <div className="mb-4">
            <label className={`flex items-center gap-3 p-3 rounded-lg border-2 cursor-pointer transition-all ${usePoints ? 'border-amber-400 bg-amber-50' : 'border-gray-200'}`}>
              <input
                type="checkbox"
                checked={usePoints}
                onChange={(e) => {
                  setUsePoints(e.target.checked);
                  if (e.target.checked) {
                    const maxPoints = Math.min(pointsBalance, Math.floor(subtotalBeforeDiscount - discountAmount));
                    updateFlow({ pointsUsed: maxPoints });
                  } else {
                    updateFlow({ pointsUsed: 0 });
                  }
                }}
                className="h-4 w-4 text-amber-600"
              />
              <Award className="w-4 h-4 text-amber-600" />
              <div className="flex-1">
                <span className="text-sm font-medium text-gray-800">Usar {pointsBalance.toLocaleString()} puntos ToursRed</span>
                <p className="text-xs text-gray-500">1 punto = $1 MXN de descuento</p>
              </div>
            </label>
          </div>
        )}

        {/* Wallet toggle */}
        {walletBalance > 0 && (
          <div className="mb-4">
            <label className={`flex items-center gap-3 p-3 rounded-lg border-2 cursor-pointer transition-all ${useWallet ? 'border-teal-400 bg-teal-50' : 'border-gray-200'}`}>
              <input
                type="checkbox"
                checked={useWallet}
                onChange={(e) => {
                  setUseWallet(e.target.checked);
                  if (e.target.checked) {
                    const maxWallet = Math.min(walletBalance, subtotalBeforeDiscount - discountAmount - pointsDiscount);
                    updateFlow({ toursredCashUsed: maxWallet });
                  } else {
                    updateFlow({ toursredCashUsed: 0 });
                  }
                }}
                className="h-4 w-4 text-teal-600"
              />
              <Wallet className="w-4 h-4 text-teal-600" />
              <div className="flex-1">
                <span className="text-sm font-medium text-gray-800">Usar ToursRed Cash (Saldo: {formatCurrencyMXN(walletBalance)})</span>
                <p className="text-xs text-gray-500">Saldo disponible en tu billetera</p>
              </div>
            </label>
            {/* Recargar button: always visible when wallet exists, as a secondary option */}
            <div className="mt-2 flex justify-end">
              <button
                type="button"
                onClick={() => window.open('/traveler/wallet', '_blank')}
                className="inline-flex items-center gap-1.5 text-xs text-teal-600 hover:text-teal-800 hover:underline transition-colors"
              >
                <ExternalLink className="w-3 h-3" />
                Recargar mi monedero
              </button>
            </div>
          </div>
        )}

        {/* Payment provider selector */}
        <div className="mb-6">
          <PaymentProviderSelector
            context={paymentContext as any}
            value={flow.paymentProvider as Provider}
            onChange={(p) => updateFlow({ paymentProvider: p })}
            amount={amountToPay}
            conektaMethod={flow.conektaMethod as ConektaMethod}
            onConektaMethodChange={(m) => updateFlow({ conektaMethod: m })}
            openpayMethod={flow.openpayMethod as OpenpayMethod}
            onOpenpayMethodChange={(m) => updateFlow({ openpayMethod: m })}
          />
        </div>

        {openpayInstructions && (
          <div className="mb-6 p-4 bg-blue-50 border border-blue-200 rounded-xl space-y-3">
            <div className="flex items-center gap-2">
              {openpayInstructions.method === 'spei' ? (
                <Landmark className="w-5 h-5 text-blue-600" />
              ) : (
                <Banknote className="w-5 h-5 text-blue-600" />
              )}
              <h4 className="font-bold text-gray-900">
                {openpayInstructions.method === 'spei' ? 'Instrucciones de Transferencia SPEI' : 'Instrucciones de Pago en Efectivo'}
              </h4>
            </div>
            <p className="text-sm text-gray-700">
              Tu reserva fue creada con exito. Completa el pago para confirmarla.
            </p>
            {openpayInstructions.method === 'spei' && openpayInstructions.payment_method?.clabe && (
              <div className="space-y-2">
                <div className="flex justify-between items-center p-2 bg-white rounded-lg border border-gray-200">
                  <span className="text-sm text-gray-600">CLABE interbancaria</span>
                  <span className="font-mono font-semibold text-gray-900">{openpayInstructions.payment_method.clabe}</span>
                </div>
                {openpayInstructions.payment_method?.bank && (
                  <div className="flex justify-between items-center p-2 bg-white rounded-lg border border-gray-200">
                    <span className="text-sm text-gray-600">Banco</span>
                    <span className="font-semibold text-gray-900">{openpayInstructions.payment_method.bank}</span>
                  </div>
                )}
                {openpayInstructions.payment_method?.name && (
                  <div className="flex justify-between items-center p-2 bg-white rounded-lg border border-gray-200">
                    <span className="text-sm text-gray-600">Referencia</span>
                    <span className="font-mono font-semibold text-gray-900">{openpayInstructions.payment_method.name}</span>
                  </div>
                )}
                {openpayInstructions.spei_pdf_url && (
                  <a href={openpayInstructions.spei_pdf_url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 text-sm text-blue-600 hover:text-blue-800 hover:underline">
                    <ExternalLink className="w-3.5 h-3.5" />
                    Descargar instrucciones PDF
                  </a>
                )}
              </div>
            )}
            {openpayInstructions.method === 'cash' && openpayInstructions.payment_method && (
              <div className="space-y-2">
                {openpayInstructions.payment_method?.reference && (
                  <div className="flex justify-between items-center p-2 bg-white rounded-lg border border-gray-200">
                    <span className="text-sm text-gray-600">Referencia de pago</span>
                    <span className="font-mono font-semibold text-gray-900">{openpayInstructions.payment_method.reference}</span>
                  </div>
                )}
                {openpayInstructions.payment_method?.store && (
                  <div className="flex justify-between items-center p-2 bg-white rounded-lg border border-gray-200">
                    <span className="text-sm text-gray-600">Establecimiento</span>
                    <span className="font-semibold text-gray-900">{openpayInstructions.payment_method.store}</span>
                  </div>
                )}
                {openpayInstructions.payment_method?.expiry_date && (
                  <div className="flex justify-between items-center p-2 bg-white rounded-lg border border-gray-200">
                    <span className="text-sm text-gray-600">Vence el</span>
                    <span className="font-semibold text-gray-900">{openpayInstructions.payment_method.expiry_date}</span>
                  </div>
                )}
              </div>
            )}
            <div className="flex gap-3 pt-2">
              <button
                onClick={() => navigate('/traveler/reservas')}
                className="flex-1 px-4 py-2.5 bg-blue-600 text-white text-sm font-semibold rounded-lg hover:bg-blue-700 transition-colors"
              >
                Ver mis reservas
              </button>
              <button
                onClick={() => setOpenpayInstructions(null)}
                className="px-4 py-2.5 border border-gray-300 text-gray-700 text-sm font-medium rounded-lg hover:bg-gray-50 transition-colors"
              >
                Cerrar
              </button>
            </div>
          </div>
        )}

        {/* Navigation */}
        <div className="flex gap-3 pt-4">
          <button
            onClick={handleBack}
            disabled={isCreating}
            className="flex items-center gap-1.5 px-5 py-3 border border-gray-300 text-gray-700 font-medium rounded-xl hover:bg-gray-50 disabled:opacity-50 transition-colors"
          >
            <ChevronLeft className="w-5 h-5" />
            Atrás
          </button>
          <button
            onClick={handlePayment}
            disabled={isCreating || isLoadingSettings}
            className="flex-1 flex items-center justify-center gap-2 py-3.5 bg-primary-600 text-white font-semibold rounded-xl hover:bg-primary-700 disabled:bg-gray-300 transition-colors"
          >
            {isCreating ? (
              <>
                <Loader2 className="w-5 h-5 animate-spin" />
                Procesando...
              </>
            ) : (
              <>
                <CreditCard className="w-5 h-5" />
                Pagar {formatCurrencyMXN(amountToPay)}
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
};

export default BookingFlowStep4;
