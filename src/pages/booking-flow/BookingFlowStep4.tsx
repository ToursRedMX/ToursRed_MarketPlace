import React, { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronLeft, AlertCircle, Tag, Award, Wallet, Crown, Shield, Loader2, CreditCard, Check, Sparkles, ExternalLink, Info } from 'lucide-react';
import { useBookingFlow } from '../../context/BookingFlowContext';
import { useAuth } from '../../context/AuthContext';
import { useStepUp } from '../../context/StepUpContext';

// Pagos MIXTOS (saldo o puntos + otro medio): el servidor exige un codigo TOTP de UN SOLO USO antes
// de crear el cobro. Si la persona cierra el modal, o no tiene MFA, la reserva YA existe (pendiente
// de pago): no es un error de red, y no se debe reintentar creando otra.
const MENSAJE_MFA_PENDIENTE =
  'Tu reserva quedó creada, pero falta confirmar con tu código de verificación en dos pasos para usar tu saldo o tus puntos. Puedes completar el pago desde Mis reservas.';
async function bloqueoDeMfa(resp: Response): Promise<boolean> {
  if (resp.status !== 403) return false;
  const cuerpo = await resp.clone().json().catch(() => null) as { code?: string } | null;
  return cuerpo?.code === 'STEP_UP_REQUIRED' || cuerpo?.code === 'MFA_NOT_CONFIGURED';
}
import { calcularPromocionDeGrupo } from '../../utils/promocionDeGrupo.ts';
import { supabase } from '../../lib/supabase';
import { formatCurrencyMXN } from '../../utils/formatCurrency';
import { puntosGanados } from '../../lib/puntosGanados';
import { totalTravelerCount } from '../../types/booking-flow';
import { getMpDeviceId } from '../../utils/mercadopagoDevice';
import PaymentProviderSelector, {
  PaymentProvider as Provider,
  PaymentContext,
  ConektaMethod,
  OpenpayMethod,
} from '../../components/PaymentProviderSelector';
import { mensajeDeError } from '../../lib/errores';
import { montoDelCobroAhora } from '../../lib/pagoParcial';

const CATEGORIA_LABELS: Record<string, string> = {
  adulto: 'Adulto',
  nino: 'Niño',
  infante: 'Infante',
  adulto_mayor: 'Adulto Mayor',
  mascota: 'Mascota',
};

const CATEGORIA_ORDER = ['adulto', 'nino', 'infante', 'adulto_mayor', 'mascota'];

// 100 pts = $1 MXN — misma conversion que deduct_points_for_booking en la BD.
const POINTS_PER_MXN = 100;
// Monto minimo que aceptan los procesadores; un residuo menor se absorbe como $0.
const MIN_PROCESSOR_AMOUNT = 10;

// Forma del jsonb que devuelve preview_booking_breakdown (supabase/migrations/
// 20261017045539 + 20261017052432). Es el mismo calculo que usa
// create_booking_atomic para cobrar -- este componente deja de reimplementarlo.
interface BookingBreakdown {
  success: boolean;
  error?: string;
  base_tour_price: number;
  extras_subtotal: number;
  extras_sc_base: number;
  extras_sc: number;
  extras_exemption: number;
  base_service_charge: number;
  deposit_sc: number;
  base_exemption: number;
  has_membership: boolean;
  membership_cost: number;
  insurance_cost: number;
  insurance_days: number;
  discount_amount: number;
  service_charge_discount_amount: number;
  insurance_discount_amount: number;
  promo_id: string | null;
  promo_discount: number;
  deposit_pct: number;
  deposit_amount: number;
  points_discount: number;
  max_points_allowed: number;
  wallet_discount: number;
  is_full_wallet: boolean;
  grand_total: number;
  due_now: number;
  amount_to_charge: number;
}

// Subconjunto de p_booking_data que SI lee calculate_booking_breakdown (via
// preview_booking_breakdown o create_booking_atomic). Se arma una sola vez y
// se reutiliza para la vista previa y para la reserva real -- antes cada una
// tenia su propio calculo y podian desalinearse.
function buildPricingBookingData(args: {
  userId: string;
  tourId: string;
  travelersCount: number;
  slotId: string | null;
  selectedDate: string | null;
  paidSpots: number | null;
  discountCodeId: string | null;
  includeInsurance: boolean;
  insuranceDiscountCodeId: string | null;
  insuranceDays: number;
  pointsRequested: number;
  cashRequested: number;
  addMembership: boolean;
  membershipPlan: 'mensual' | 'anual' | null;
  pickupZoneName: string | null;
  selectedLanguage: string | null;
}): Record<string, unknown> {
  return {
    user_id: args.userId,
    tour_id: args.tourId,
    travelers_count: args.travelersCount,
    slot_id: args.slotId,
    selected_date: args.selectedDate,
    // Misma INTENCION que ya mandaba este componente: el servidor recalcula
    // el faltante de verdad contra tour_slots.booked_count.
    pagar_minimo_garantizado: !!(args.paidSpots && args.paidSpots > args.travelersCount),
    es_reserva_preventa: false,
    discount_code_id: args.discountCodeId,
    travel_insurance_included: args.includeInsurance,
    insurance_discount_code_id: args.insuranceDiscountCodeId,
    insurance_days: args.insuranceDays,
    // Se manda el balance COMPLETO cuando la casilla esta marcada; el
    // servidor topa contra el 50% y el saldo real (misma regla que
    // create_booking_atomic / _shared/puntosConTope.ts).
    points_used: args.pointsRequested,
    toursred_cash_used: args.cashRequested,
    membership_purchased: args.addMembership,
    membership_plan: args.addMembership ? args.membershipPlan : null,
    pickup_zone_name: args.pickupZoneName,
    selected_language: args.selectedLanguage,
  };
}

const BookingFlowStep4: React.FC = () => {
  const { flow, updateFlow, goToStep, sessionId, resetFlow } = useBookingFlow();
  const { user } = useAuth();
  const { fetchWithStepUp } = useStepUp();
  const navigate = useNavigate();

  const tour = flow.tour;

  // Mismo criterio que BookingFlowStep1/Step2: hace falta un preventaRatio
  // propio aqui porque el precio fijo por vehiculo y los lugares extra de
  // garantia de salida NO pasan por flow.travelers[].precio_aplicado (que ya
  // trae el ratio aplicado desde Step2) — son montos que este paso calcula
  // aparte.
  const isReceptivo = tour?.tour_type === 'receptivo';
  const isPrivateTransfer = isReceptivo && tour?.activity_type === 'transport' && tour?.receptivo_modality === 'privado';
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const isEnPreventa = !!(
    tour?.preventa_activa &&
    tour.preventa_inicio &&
    tour.preventa_fin &&
    new Date(tour.preventa_inicio + 'T00:00:00') <= today &&
    new Date(tour.preventa_fin + 'T23:59:59') >= today
  );

  const [isLoadingSettings, setIsLoadingSettings] = useState(true);
  const [hasMembership, setHasMembership] = useState(false);
  const [walletBalance, setWalletBalance] = useState(0);
  const [pointsBalance, setPointsBalance] = useState(0);
  // Portado de BookingForm.tsx: el checkbox de puntos se bloqueaba si el
  // wallet no estaba activo Y la membresia tampoco (pointsWalletActive =
  // is_active || membershipStillActive). Aqui no existia ningun chequeo —
  // bastaba con tener saldo > 0 para gastar puntos con membresia vencida.
  const [pointsWalletActive, setPointsWalletActive] = useState(false);
  const [useWallet, setUseWallet] = useState(false);
  const [usePoints, setUsePoints] = useState(false);
  const [discountInput, setDiscountInput] = useState(flow.discountCode);
  const [isApplyingDiscount, setIsApplyingDiscount] = useState(false);
  const [discountError, setDiscountError] = useState('');
  const [discountApplied, setDiscountApplied] = useState(false);
  const [insuranceInput, setInsuranceInput] = useState('');
  const [isApplyingInsurance, setIsApplyingInsurance] = useState(false);
  const [insuranceError, setInsuranceError] = useState('');
  const insuranceApplied = flow.insuranceDiscountMeta !== null;
  const [isCreating, setIsCreating] = useState(false);
  const [createError, setCreateError] = useState('');
  // F-1: si alguna de las lecturas de abajo falla, el checkout seguia con
  // valores por defecto —comision del 10%, sin membresia, saldo en 0— y el
  // viajero pagaba de mas sin enterarse. Ahora se le dice.
  const [loadError, setLoadError] = useState('');
  const [remainingExemption, setRemainingExemption] = useState(0);
  const [monthlyExemptionLimit, setMonthlyExemptionLimit] = useState(500);
  // El servidor topa puntos y wallet; si difiere de lo que calculo el cliente,
  // se lo avisamos al usuario en vez de cambiarle el monto en silencio.
  const [adjustedByServer, setAdjustedByServer] = useState<
    { points: number; cash: number; amount: number } | null
  >(null);

  // El desglose de costos ya no se reimplementa aqui: lo calcula
  // preview_booking_breakdown (mismo camino que usa create_booking_atomic
  // para cobrar). Se conserva el ULTIMO resultado exitoso mientras llega uno
  // nuevo, para no mostrar $0 cada vez que se aplica un codigo o se marca una
  // casilla -- isLoadingBreakdown/breakdownError son lo que gatean el boton.
  const [breakdown, setBreakdown] = useState<BookingBreakdown | null>(null);
  const [isLoadingBreakdown, setIsLoadingBreakdown] = useState(true);
  const [breakdownError, setBreakdownError] = useState('');

  useEffect(() => {
    if (!tour || !user) return;
    const load = async () => {
      try {
        const { data: memData, error: errMem } = await supabase
          .from('memberships')
          .select('status, current_period_end')
          .eq('user_id', user.id)
          .in('status', ['active', 'cancelled'])
          .maybeSingle();
        if (errMem) {
          console.error('[Step4] no se pudo leer la membresia:', errMem);
          setLoadError('No pudimos verificar tu membresia. Si eres socio, tus beneficios podrian no estar aplicados: recarga la pagina.');
        }
        const isActive = !!memData && (
          memData.status === 'active' ||
          (memData.status === 'cancelled' && memData.current_period_end && new Date(memData.current_period_end) > new Date())
        );
        setHasMembership(isActive);

        if (isActive) {
          try {
            const { data: exemptData, error: errorExencion } = await supabase.rpc('get_remaining_service_fee_exemption', {
              p_user_id: user.id,
            });

            // Es el beneficio de membresia sobre el cargo por servicio. Si no
            // se lee, no se aplica en pantalla; el backend recalcula al cobrar.
            if (errorExencion) console.error('BookingFlowStep4: no se pudo leer la exencion restante', errorExencion);
            if (exemptData && typeof exemptData === 'object' && 'remaining' in exemptData) {
              setRemainingExemption(exemptData.remaining || 0);
              setMonthlyExemptionLimit(exemptData.monthly_limit || 500);
            }
          } catch {
            // non-critical
          }
        }

        const { data: walletData, error: errWallet } = await supabase
          .from('toursred_cash_wallets')
          .select('balance')
          .eq('user_id', user.id)
          .eq('is_active', true)
          .maybeSingle();
        if (errWallet) {
          console.error('[Step4] no se pudo leer el monedero:', errWallet);
          setLoadError('No pudimos leer tu saldo. Si tienes dinero en el monedero, ahora aparece en cero: recarga la pagina antes de pagar.');
        }
        setWalletBalance(walletData?.balance || 0);

        const { data: pointsData, error: errPoints } = await supabase
          .from('toursred_points_wallets')
          .select('balance, is_active')
          .eq('user_id', user.id)
          .maybeSingle();
        if (errPoints) {
          console.error('[Step4] no se pudieron leer los puntos:', errPoints);
          setLoadError('No pudimos leer tus puntos. Si tienes saldo, ahora aparece en cero: recarga la pagina antes de pagar.');
        }
        setPointsBalance(pointsData?.balance || 0);
        setPointsWalletActive(pointsData?.is_active || false);
      } catch (e) {
        // Antes este catch estaba vacio con un "// non-critical". No lo era:
        // se traga el fallo de las cinco lecturas de arriba, incluida la del
        // precio.
        console.error('[Step4] fallo la carga de datos del checkout:', e);
        setLoadError('No pudimos cargar todos tus datos. El total y tus saldos pueden no ser correctos: recarga la pagina antes de pagar.');
      } finally {
        setIsLoadingSettings(false);
      }
    };
    load();
  }, [tour, user]);

  // Price calculations
  const totalTravelers = totalTravelerCount(flow.travelerCounts);

  const preventaRatio = tour && isEnPreventa && hasMembership && tour.preventa_precio_especial && tour.preventa_descuento_valor
    ? (tour.preventa_tipo_descuento === 'porcentaje'
        ? Math.max(0, 1 - tour.preventa_descuento_valor / 100)
        : (tour.price > 0 ? Math.max(0, tour.price - tour.preventa_descuento_valor) / tour.price : 1))
    : 1;

  const adultBasePrice = tour ? (tour.precio_adulto ?? tour.price ?? 0) : 0;
  const esPerVehicle = !!(isPrivateTransfer && tour?.transfer_pricing_mode === 'per_vehicle');
  // Estimado de Step1; el servidor vuelve a calcular el faltante de verdad
  // contra tour_slots.booked_count al crear la reserva.
  const extraSpots = !esPerVehicle && flow.paidSpots ? Math.max(0, flow.paidSpots - totalTravelers) : 0;

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

  const insuranceDays = useMemo(() => {
    if (!tour || !flow.includeInsurance) return 0;
    if (tour.tour_type === 'receptivo' && tour.receptivo_modality === 'privado') return 1;
    const start = tour.start_date ? new Date(tour.start_date + 'T12:00:00') : null;
    const end = tour.end_date ? new Date(tour.end_date + 'T12:00:00') : null;
    if (!start || !end) return 1;
    const days = Math.ceil((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)) + 1;
    return Math.max(1, days);
  }, [tour, flow.includeInsurance]);

  // Vista previa del cobro real: mismo camino que create_booking_atomic
  // (calculate_booking_breakdown), sin reservar nada. Se reconsulta cuando
  // cambia algo que afecta el monto -- codigos, casillas de puntos/saldo.
  // El resultado anterior se conserva mientras llega uno nuevo (no se limpia
  // a null en cada refetch) para no mostrar $0 por un instante.
  useEffect(() => {
    if (!tour || !user) return;
    let vivo = true;
    void (async () => {
      setIsLoadingBreakdown(true);
      setBreakdownError('');
      const pricingData = buildPricingBookingData({
        userId: user.id,
        tourId: tour.id,
        travelersCount: totalTravelers,
        slotId: flow.selectedSlot?.id || null,
        selectedDate: flow.selectedDate || null,
        paidSpots: flow.paidSpots,
        discountCodeId: flow.discountCodeId || null,
        includeInsurance: flow.includeInsurance,
        insuranceDiscountCodeId: flow.insuranceDiscountCodeId || null,
        insuranceDays,
        pointsRequested: usePoints ? pointsBalance : 0,
        cashRequested: useWallet ? walletBalance : 0,
        addMembership: flow.addMembership,
        membershipPlan: flow.membershipPlan,
        pickupZoneName: flow.pickupZoneName,
        selectedLanguage: flow.selectedLanguage,
      });
      const travelersJson = flow.travelers.map((t) => ({ categoria_viajero: t.categoria_viajero }));
      const optionalServicesJson = flow.optionalServices.map((s) => ({
        tour_optional_service_id: s.tour_optional_service_id,
        service_kind: s.service_kind,
        quantity: s.quantity,
      }));
      const { data, error } = await supabase.rpc('preview_booking_breakdown', {
        p_booking_data: pricingData,
        p_travelers: travelersJson,
        p_optional_services: optionalServicesJson,
      });
      if (!vivo) return;
      const result = data as BookingBreakdown | null;
      if (error || !result?.success) {
        console.error('[Step4] fallo preview_booking_breakdown', error || result?.error);
        setBreakdownError('No pudimos calcular el total a cobrar. Recarga la página antes de pagar.');
        setIsLoadingBreakdown(false);
        return;
      }
      setBreakdown(result);
      setIsLoadingBreakdown(false);
    })();
    return () => { vivo = false; };
  }, [
    tour, user, totalTravelers, flow.travelers, flow.optionalServices,
    flow.selectedSlot?.id, flow.selectedDate, flow.paidSpots,
    flow.discountCodeId, flow.includeInsurance, flow.insuranceDiscountCodeId, insuranceDays,
    usePoints, useWallet, pointsBalance, walletBalance,
    flow.addMembership, flow.membershipPlan, flow.pickupZoneName, flow.selectedLanguage,
  ]);

  // La promocion de grupo vigente del tour. La RPC ya filtra por `is_active`,
  // fechas y usos agotados, y devuelve como mucho una.
  useEffect(() => {
    if (!tour?.id) return;
    let vivo = true;
    void (async () => {
      const { data, error } = await supabase.rpc('get_active_promotion_for_tour', { p_tour_id: tour.id });
      if (!vivo) return;
      if (error) {
        // Sin promocion se cobra precio normal: no se tumba la reserva por esto,
        // pero tampoco se calla, porque el viajero veria un precio mas alto sin
        // que nadie sepa por que.
        console.error('[BookingFlowStep4] no se pudo leer la promocion del tour', error);
        return;
      }
      // Devuelve una TABLA, asi que PostgREST entrega un arreglo.
      updateFlow({ promocion: Array.isArray(data) && data.length > 0 ? data[0] : null });
    })();
    return () => { vivo = false; };
    // `updateFlow` es `useCallback(..., [])` en el contexto, asi que es estable
    // y no reinicia el efecto. Comprobado antes de incluirlo: si no lo fuera,
    // este efecto —que llama a updateFlow— seria un bucle infinito.
  }, [tour?.id, updateFlow]);

  // A partir de aqui, todo numero de dinero sale de `breakdown` (o es 0
  // mientras no ha llegado el primero). Nada de esto se vuelve a calcular en
  // el cliente: evita exactamente el hueco que corrigio la migracion
  // 20261017052432 (codigos service_fee_*/insurance_* que se veian aplicados
  // en pantalla pero nunca bajaban lo que de verdad se cobraba).
  const baseTourPrice = breakdown?.base_tour_price ?? 0;
  const extrasSubtotal = breakdown?.extras_subtotal ?? 0;
  const extrasServiceChargeBase = breakdown?.extras_sc_base ?? 0;
  const extrasExemptionUsed = breakdown?.extras_exemption ?? 0;
  const extrasServiceCharge = breakdown?.extras_sc ?? 0;

  const insuranceDiscountAmount = breakdown?.insurance_discount_amount ?? 0;
  const effectiveInsuranceCost = breakdown?.insurance_cost ?? 0;
  const insuranceCost = effectiveInsuranceCost + insuranceDiscountAmount;

  // base_service_charge que devuelve el servidor ya viene NETO del codigo de
  // descuento (seccion 4.5 de calculate_booking_breakdown); se le vuelve a
  // sumar aqui solo para mostrar la linea "bruto" del desglose.
  const serviceChargeDiscount = breakdown?.service_charge_discount_amount ?? 0;
  const baseServiceCharge = (breakdown?.base_service_charge ?? 0) + serviceChargeDiscount;
  const shouldWaiveServiceCharge = hasMembership || flow.addMembership;
  const exemptionUsed = breakdown?.base_exemption ?? 0;
  const depositServiceCharge = breakdown?.deposit_sc ?? 0;

  const hasReachedExemptionLimit = hasMembership && remainingExemption < (baseServiceCharge + extrasServiceChargeBase);

  const membershipCost = breakdown?.membership_cost ?? 0;

  // La ETIQUETA de la promocion (texto + "casi lo logras") se sigue generando
  // aqui -- es solo UI, no un monto -- pero el descuento real que se cobra
  // viene de breakdown.promo_discount (mismo query que corre el servidor).
  const promo = useMemo(() => {
    const viajeros = { adultos: 0, ninos: 0, infantes: 0, adultos_mayores: 0, mascotas: 0 };
    const precios = { adulto: 0, nino: 0, infante: 0, adulto_mayor: 0 };
    for (const t of flow.travelers) {
      const cat = t.categoria_viajero || 'adulto';
      const precio = t.precio_aplicado || 0;
      if (cat === 'adulto')            { viajeros.adultos += 1;         precios.adulto = precio; }
      else if (cat === 'nino')         { viajeros.ninos += 1;           precios.nino = precio; }
      else if (cat === 'infante')      { viajeros.infantes += 1;        precios.infante = precio; }
      else if (cat === 'adulto_mayor') { viajeros.adultos_mayores += 1; precios.adulto_mayor = precio; }
      else if (cat === 'mascota')      { viajeros.mascotas += 1; }
    }
    return calcularPromocionDeGrupo(flow.promocion, viajeros, precios);
  }, [flow.promocion, flow.travelers]);

  const promoDiscountAmount = breakdown?.promo_discount ?? 0;
  const discountAmount = breakdown?.discount_amount ?? 0;
  const effectiveDepositPct = breakdown?.deposit_pct ?? 0;
  const depositAmount = breakdown?.deposit_amount ?? 0;

  const maxPointsAllowed = breakdown?.max_points_allowed ?? 0;
  // pointsWalletActive || hasMembership: portado de BookingForm.tsx. Gatea si
  // se muestra la casilla; el tope real de cuanto se aplica lo decide el
  // servidor (v_points_wallet_active/v_membership_still_valid, mas frescos
  // que estos dos flags locales).
  const canUsePoints = pointsWalletActive || hasMembership;
  const pointsDiscount = breakdown?.points_discount ?? 0;
  const pointsApplied = Math.round(pointsDiscount * POINTS_PER_MXN);

  const walletDiscount = breakdown?.wallet_discount ?? 0;
  const isFullWalletPayment = breakdown?.is_full_wallet ?? false;

  const dueNow = breakdown?.due_now ?? 0;
  const grandTotal = breakdown?.grand_total ?? 0;

  // El pago parcial NO existe en el servidor (solo en la confirmacion real) --
  // sigue siendo una decision del cliente, acotada por lo que YA bajo del
  // exigible por puntos/saldo.
  const dueAfterPointsWallet = Math.max(0, dueNow - pointsDiscount - walletDiscount);
  // !flow.isHighRisk tambien aqui: un payNowMode='partial' que haya quedado
  // de una sesion anterior (antes de que Step3 confirmara el riesgo) no debe
  // dejar cobrar menos del 100% aunque el checkbox ya este oculto en pantalla.
  const rawAmountToPay = flow.payNowMode === 'partial' && !isFullWalletPayment && !flow.isHighRisk && !flow.addMembership
    ? Math.min(flow.partialPaymentAmount, dueAfterPointsWallet)
    : dueAfterPointsWallet;

  // Residuo por debajo del minimo del procesador -> $0.
  const amountToPay = rawAmountToPay > 0 && rawAmountToPay < MIN_PROCESSOR_AMOUNT
    ? 0
    : Math.round(rawAmountToPay * 100) / 100;

  // Unica fuente de verdad para el gating del selector de procesador.
  const isWalletOnlyPayment = amountToPay === 0 && (walletDiscount > 0 || pointsDiscount > 0);

  // Beneficio ToursRed Cash: el saldo alcanza para cubrir todo el exigible.
  // netBeforeCharges es pura suma de campos que YA devolvio el servidor (no
  // reaplica descuentos/exenciones) -- se arma aqui solo para esta comparacion.
  const netBeforeCharges = depositAmount + extrasSubtotal + effectiveInsuranceCost + membershipCost;
  const tentativeCashNeeded = Math.max(0, netBeforeCharges - pointsDiscount);
  const wouldQualifyForWalletBenefit = !useWallet
    && walletBalance > 0
    && totalTravelers > 0
    && !flow.addMembership
    && walletBalance >= tentativeCashNeeded;

  // Puntos que gana este pago: el MISMO calculo del servidor (award_points_for_booking). Solo con ToursRed Plus activo, y al doble
  // solo si NO interviene ninguna pasarela (100% Cash, o Cash + puntos). Antes bastaba `useWallet && hasMembership`: con una parte
  // por Stripe prometia el doble y puntos de mas.
  const { puntos: pointsToEarn, esDoble: isDoublePoints } = puntosGanados({
    tieneMembresiaActiva: hasMembership,
    pesosPasarela: amountToPay,
    pesosCash: walletDiscount,
    pesosConPuntos: pointsDiscount,
  });

  if (!tour) return null;

  const handleApplyDiscount = async () => {
    if (!discountInput.trim() || !user) return;
    setIsApplyingDiscount(true);
    setDiscountError('');
    try {
      // `validate_tour_discount_code`, no `validate_discount_code`. Hasta el
      // 12-sep-2026 se llamaba a la segunda pasandole `p_tour_id` y `p_amount`,
      // **que no son parametros suyos**: PostgREST resuelve las RPC por NOMBRE
      // de argumento, asi que respondia PGRST202 y la llamada no llegaba nunca
      // a la funcion. El viajero tecleaba un codigo bueno y leia «Error al
      // validar el codigo».
      //
      // La de tour es ademas la correcta: comprueba que el codigo sea de la
      // agencia del tour y que no este restringido a otro tour.
      const { data, error } = await supabase.rpc('validate_tour_discount_code', {
        p_code: discountInput.trim().toUpperCase(),
        p_user_id: user.id,
        p_tour_id: tour.id,
      });
      if (error) throw error;

      // Devuelve un OBJETO jsonb, no un arreglo. El codigo anterior hacia
      // `data[0].valid` y reventaba aunque los parametros hubieran sido buenos.
      if (!data?.valid) {
        setDiscountError(data?.error || 'Codigo de descuento invalido o expirado.');
        setDiscountApplied(false);
        return;
      }

      updateFlow({
        discountCode: discountInput.trim().toUpperCase(),
        discountCodeId: data.code_id,
        // Se guarda el CODIGO, no su importe: el monto se deriva mas abajo
        // sobre el precio vigente.
        discountCodeMeta: {
          code_id: data.code_id,
          code: data.code,
          discount_type: data.discount_type,
          discount_value: Number(data.discount_value),
          discount_applies_to: data.discount_applies_to ?? 'total_price',
          max_discount_amount: data.max_discount_amount ?? null,
          applicable_to: data.applicable_to ?? 'tours',
        },
      });
      setDiscountApplied(true);
    } catch (e) {
      // No se traga el motivo: un error de contrato con la base se veia igual
      // que un codigo caducado, y fue justamente lo que escondio este bug.
      console.error('[BookingFlowStep4] fallo al validar el codigo de descuento', e);
      setDiscountError('Error al validar el codigo.');
    } finally {
      setIsApplyingDiscount(false);
    }
  };

  const handleApplyInsuranceDiscount = async () => {
    if (!insuranceInput.trim() || !user) return;
    setIsApplyingInsurance(true);
    setInsuranceError('');
    try {
      // Codigo de SEGURO: RPC distinta y columnas distintas a las del tour.
      // Aplicarle un codigo de tour al seguro da una cifra creible y mal.
      const { data, error } = await supabase.rpc('validate_insurance_discount_code', {
        p_code: insuranceInput.trim().toUpperCase(),
        p_user_id: user.id,
      });
      if (error) throw error;
      // Objeto jsonb, no arreglo.
      if (!data?.valid) {
        setInsuranceError(data?.error || 'Codigo de seguro invalido o expirado.');
        return;
      }
      updateFlow({
        insuranceDiscountCodeId: data.code_id,
        insuranceDiscountMeta: {
          code_id: data.code_id,
          code: data.code,
          discount_type: data.discount_type,
          discount_value: Number(data.discount_value),
          max_discount_amount: data.max_discount_amount ?? null,
          applicable_to: 'insurance',
        },
      });
      setInsuranceInput('');
    } catch (e) {
      console.error('[BookingFlowStep4] fallo al validar el codigo de seguro', e);
      setInsuranceError('Error al validar el codigo.');
    } finally {
      setIsApplyingInsurance(false);
    }
  };

  const handleRemoveInsuranceDiscount = () => {
    updateFlow({ insuranceDiscountCodeId: null, insuranceDiscountMeta: null });
    setInsuranceError('');
  };

  const handleRemoveDiscount = () => {
    updateFlow({ discountCode: '', discountCodeId: null, discountCodeMeta: null });
    setDiscountInput('');
    setDiscountApplied(false);
  };

  const handlePayment = async () => {
    if (!user) {
      navigate('/login');
      return;
    }

    // Defensa en profundidad: el boton ya se deshabilita sin un breakdown
    // valido, pero esto evita cobrar con numeros locales si de todos modos
    // se llega aqui (por ejemplo, una carrera con el efecto de arriba).
    if (!breakdown) {
      setCreateError('No pudimos confirmar el total a cobrar. Recarga la página antes de pagar.');
      return;
    }

    if (!flow.isHighRisk && !flow.addMembership && flow.payNowMode === 'partial' && (flow.partialPaymentAmount <= 0 || flow.partialPaymentAmount >= depositAmount - 10)) {
      setCreateError('El monto del pago parcial debe ser menor al depósito total (dejando al menos $10 MXN de saldo).');
      return;
    }
    if (!flow.isHighRisk && !flow.addMembership && flow.payNowMode === 'partial' && flow.partialPaymentAmount < MIN_PROCESSOR_AMOUNT) {
      setCreateError(`El pago parcial mínimo es de ${formatCurrencyMXN(MIN_PROCESSOR_AMOUNT)}.`);
      return;
    }

    setCreateError('');
    setIsCreating(true);

    try {
      const bookingDate = flow.selectedSlot?.slot_date || flow.selectedDate || new Date().toISOString().split('T')[0];
      // Tours "a demanda" (booking_approval_type='manual', tipicamente receptivo):
      // la reserva entra pendiente de que la agencia la apruebe, y el cobro se
      // dispara despues (desde approve-booking si se cubre con wallet/puntos, o
      // por el viajero desde TravelerBookings al aprobarse). Ver create_booking_atomic,
      // que ya acepta approval_status en el payload y por default usa 'approved'.
      const isManualApproval = tour.booking_approval_type === 'manual';

      // Mismo subconjunto que ya se le mando a preview_booking_breakdown --
      // create_booking_atomic recalcula todo de nuevo con esto, no confia en
      // los montos de dinero que se agregan abajo.
      const pricingInput = buildPricingBookingData({
        userId: user.id,
        tourId: tour.id,
        travelersCount: totalTravelers,
        slotId: flow.selectedSlot?.id || null,
        selectedDate: flow.selectedDate || null,
        paidSpots: flow.paidSpots,
        discountCodeId: flow.discountCodeId || null,
        includeInsurance: flow.includeInsurance,
        insuranceDiscountCodeId: flow.insuranceDiscountCodeId || null,
        insuranceDays,
        pointsRequested: usePoints ? pointsBalance : 0,
        cashRequested: useWallet ? walletBalance : 0,
        addMembership: flow.addMembership,
        membershipPlan: flow.membershipPlan,
        pickupZoneName: flow.pickupZoneName,
        selectedLanguage: flow.selectedLanguage,
      });

      const bookingData: Record<string, unknown> = {
        ...pricingInput,
        agency_id: tour.agency_id || tour.agencies?.id,
        total_price: grandTotal,
        deposit_amount: depositAmount,
        // La comision NO se manda: la calcula `create_booking_atomic`, que es a
        // donde delega `create_booking_atomic_with_preventa`. Comprobado el
        // 11-sep-2026: esa funcion no lee `commission_amount` del payload —cero
        // coincidencias de `p_booking_data->>'commission_amount'`— y lo resuelve
        // con `get_effective_commission_rates(agency_id, tour_id)`.
        //
        // Lo que habia aqui era decorativo Y estaba mal de dos formas: leia
        // `tour.commission_rate`, que NO existe en la tabla (la columna es
        // `commission_rate_override`), y dividia la tasa entre 100 cuando
        // `agencies.commission_rate` ya es una fraccion (0.10, no 10). El
        // backend hace `precio * tasa` sin dividir, que es lo correcto: medido,
        // las comisiones reales son del 10% exacto. Si alguien hubiera hecho que
        // este valor se usara, habria cobrado el 0.1%.
        service_charge: depositServiceCharge,
        user_payment: amountToPay,
        platform_revenue: depositServiceCharge + extrasServiceCharge,
        booking_date: bookingDate,
        selected_time: flow.selectedTime || null,
        status: 'pending',
        payment_status: 'pending',
        approval_status: isManualApproval ? 'pending' : 'approved',
        count_adultos: flow.travelerCounts.adultos,
        count_ninos: flow.travelerCounts.ninos,
        count_infantes: flow.travelerCounts.infantes,
        count_adultos_mayores: flow.travelerCounts.adultos_mayores,
        count_mascotas: flow.travelerCounts.mascotas,
        discount_amount: discountAmount,
        service_charge_discount: serviceChargeDiscount,
        payment_provider: flow.paymentProvider,
        conekta_method: flow.paymentProvider === 'conekta' ? flow.conektaMethod : null,
        openpay_method: flow.paymentProvider === 'openpay' ? flow.openpayMethod : null,
        pickup_type: flow.pickupType,
        pickup_zone_extra_cost: flow.optionalServices.filter(e => e.service_kind === 'pickup').reduce((s, e) => s + e.subtotal, 0),
        language_extra_cost: flow.optionalServices.filter(e => e.service_kind === 'language').reduce((s, e) => s + e.subtotal, 0),
        restrictions_accepted: flow.restrictionsAccepted,
        travel_insurance_cost: effectiveInsuranceCost,
        insurance_discount_amount: insuranceDiscountAmount,
        // El id de promocion lo resuelve el propio servidor (breakdown.promo_id),
        // no la lectura independiente de flow.promocion que solo alimenta la
        // etiqueta de texto.
        promotion_id: breakdown.promo_id,
        promo_discount_amount: promoDiscountAmount,
        selected_payment_mode: 'standard',
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

      const { data: bookingResult, error: bookingError } = await supabase.rpc('create_booking_atomic_with_preventa', {
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

      // El servidor recalcula todos los montos y topa puntos (50% y saldo) y wallet
      // en silencio. A partir de aqui manda lo que devolvio el RPC, no lo que
      // calculo el cliente: si difieren, el cliente estaba equivocado.
      const srvPointsApplied = Number(bookingResult.points_applied ?? pointsApplied);
      const srvCashApplied = Number(bookingResult.toursred_cash_applied ?? walletDiscount);
      const srvAmountToCharge = Number(bookingResult.amount_to_charge ?? amountToPay);
      const srvIsFullWallet = Boolean(bookingResult.is_full_wallet ?? isFullWalletPayment);
      // `amount_to_charge` es el exigible COMPLETO; con «pagar con más de un
      // método» a la pasarela solo va lo que el viajero eligió pagar ahora. El
      // resto queda como saldo pendiente de la reserva (ver lib/pagoParcial.ts).
      const srvAmountNow = flow.payNowMode === 'partial' && !flow.isHighRisk && !flow.addMembership
        ? montoDelCobroAhora(srvAmountToCharge, flow.partialPaymentAmount)
        : srvAmountToCharge;

      if (srvPointsApplied !== pointsApplied || srvCashApplied !== walletDiscount) {
        setAdjustedByServer({
          points: srvPointsApplied,
          cash: srvCashApplied,
          amount: srvAmountToCharge,
        });
        updateFlow({ pointsUsed: srvPointsApplied, toursredCashUsed: srvCashApplied });
      }

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
              body: JSON.stringify({ booking_id: bookingId }),
            }
          );
        }
      } catch {
        // non-critical
      }

      // Aprobacion manual: no se dispara ningun cobro aqui, ni siquiera si
      // wallet/puntos cubririan el 100% (eso lo resuelve approve-booking cuando
      // la agencia aprueba). El viajero espera en booking-pending y, si se
      // aprueba, completa el pago desde TravelerBookings sin rehacer el flujo.
      if (isManualApproval) {
        resetFlow();
        navigate(`/booking-pending/${bookingId}`);
        return;
      }

      const isWalletOnly = srvIsFullWallet || srvAmountToCharge === 0;

      if (isWalletOnly) {
        const idempotencyKey = `${bookingId}-${Date.now()}`;
        const { data: { session: walletSession } } = await supabase.auth.getSession();
        const walletRes = await fetchWithStepUp(
          `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/confirm-booking-wallet-payment`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${walletSession?.access_token}`,
              'Apikey': import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
            },
            body: JSON.stringify({
              p_booking_id: bookingId,
              p_points_to_use: srvPointsApplied,
              p_cash_to_use: srvCashApplied,
              p_idempotency_key: idempotencyKey,
            }),
          }
        );
        const walletData = await walletRes.json();
        if (!walletRes.ok || walletData.error) {
          if (walletData.code === 'MFA_NOT_CONFIGURED' || walletData.code === 'STEP_UP_REQUIRED') {
            // El usuario cancelo el paso de verificacion o activacion de MFA en el modal.
            // La reserva ya existe (pendiente de pago); la puede completar despues desde sus reservas.
            return;
          }
          throw new Error('La reserva se creo pero el pago con billetera fallo. Ve a tus reservas para completar el pago.');
        }
        resetFlow();
        navigate(`/booking-success?booking_id=${bookingId}`);
        return;
      }

      if (flow.paymentProvider === 'stripe') {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session) throw new Error('No hay sesion activa');
        const resp = await fetchWithStepUp(
          `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/create-checkout-session`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${session.access_token}` },
            // create-checkout-session reconstruye sus propias lineas de Stripe
            // desde deposit_amount/service_charge de la reserva y les resta
            // pointsUsed/toursRedCashUsed como descuento (buildDesgloseLineItems),
            // y rechaza el pago si esa suma no cuadra con `amount` (ver
            // validarMontoDelCliente). Faltaba pointsUsed aqui: solo el cash
            // viajaba. Con puntos aplicados y un resto por pagar con Stripe, el
            // servidor sumaba el deposito COMPLETO (sin descontar los puntos)
            // contra un `amount` que si los traia descontados — nunca cuadraban,
            // y el pago se rechazaba con "El monto a cobrar no coincide con el
            // desglose de la reserva". Bug preexistente, no de este PR: se
            // destapo el 24-sep-2026 probando 1 viajero + puntos + Stripe.
            body: JSON.stringify({ bookingId, customerEmail: user.email, amount: srvAmountNow, description: `Deposito para ${tour.name}`, addMembership: flow.addMembership, membershipPlan: flow.membershipPlan, toursRedCashUsed: srvCashApplied, pointsUsed: srvPointsApplied }),
          }
        );
        if (await bloqueoDeMfa(resp)) { setCreateError(MENSAJE_MFA_PENDIENTE); return; }
        if (!resp.ok) { const err = await resp.json().catch(() => ({})); throw new Error(err.error || 'Error al crear la sesion de pago'); }
        const { url } = await resp.json();
        window.location.href = url;
        return;
      }

      if (flow.paymentProvider === 'mercadopago') {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session) throw new Error('No hay sesion activa');
        const resp = await fetchWithStepUp(
          `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/create-mercadopago-preference`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${session.access_token}` },
            body: JSON.stringify({ bookingId, amount: srvAmountNow, description: `Deposito para ${tour.name}`, deviceId: await getMpDeviceId() }),
          }
        );
        if (await bloqueoDeMfa(resp)) { setCreateError(MENSAJE_MFA_PENDIENTE); return; }
        const mpResult = await resp.json();
        if (!resp.ok || !mpResult.success) throw new Error(mpResult.error || 'Error al crear la preferencia de pago');
        if (!mpResult.url) throw new Error('No se recibió la URL de pago de MercadoPago');
        window.location.href = mpResult.url;
        return;
      }

      if (flow.paymentProvider === 'paypal') {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session) throw new Error('No hay sesion activa');
        const resp = await fetchWithStepUp(
          `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/create-paypal-order`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${session.access_token}` },
            body: JSON.stringify({ bookingId, amount: srvAmountNow, description: `Deposito para ${tour.name}` }),
          }
        );
        if (await bloqueoDeMfa(resp)) { setCreateError(MENSAJE_MFA_PENDIENTE); return; }
        if (!resp.ok) throw new Error('Error al crear la orden de PayPal');
        const { url } = await resp.json();
        if (!url) throw new Error('PayPal no devolvió la URL de aprobación');
        window.location.href = url;
        return;
      }

      if (flow.paymentProvider === 'conekta') {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session) throw new Error('No hay sesion activa');
        const resp = await fetchWithStepUp(
          `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/create-conekta-order`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${session.access_token}` },
            body: JSON.stringify({
              booking_id: bookingId,
              amount: srvAmountNow,
              description: `Deposito para ${tour.name}`,
              payment_method_type: flow.conektaMethod,
              context: 'booking_deposit',
              ...(flow.conektaMethod === 'bnpl' ? { bnpl_product_type: flow.bnplProductType } : {}),
            }),
          }
        );
        if (await bloqueoDeMfa(resp)) { setCreateError(MENSAJE_MFA_PENDIENTE); return; }
        if (!resp.ok) {
          const err = await resp.json().catch(() => ({}));
          throw new Error(err.error || 'Error al crear la orden de Conekta');
        }
        const data = await resp.json();
        if (data.checkout_url) window.location.href = data.checkout_url;
        else throw new Error('No se recibió la URL de pago de Conekta');
        return;
      }

      if (flow.paymentProvider === 'openpay') {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session) throw new Error('No hay sesion activa');
        const resp = await fetchWithStepUp(
          `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/create-openpay-checkout`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${session.access_token}` },
            body: JSON.stringify({ bookingId, amount: srvAmountNow, description: `Deposito para ${tour.name}`, context: 'booking', method: flow.openpayMethod }),
          }
        );
        if (await bloqueoDeMfa(resp)) { setCreateError(MENSAJE_MFA_PENDIENTE); return; }
        if (!resp.ok) throw new Error('Error al crear el cargo de Openpay');
        const data = await resp.json();
        if (data.url) {
          window.location.href = data.url;
          return;
        }
        if (data.payment_method) {
          resetFlow();
          navigate(`/payment-pending/${bookingId}`);
          return;
        }
        throw new Error('Respuesta inesperada de Openpay');
      }

      resetFlow();
      navigate(`/booking-pending/${bookingId}`);
    } catch (err) {
      setCreateError(mensajeDeError(err) || 'Error al procesar la reserva. Intenta de nuevo.');
    } finally {
      setIsCreating(false);
    }
  };

  const handleBack = () => {
    goToStep(3);
    navigate(`/reservar/${flow.tourSlug}/paso-3`);
  };

  const paymentContext: PaymentContext = flow.addMembership ? 'booking_with_membership' : 'booking';

  return (
    <div className="bg-white rounded-2xl shadow-xs border border-gray-100 overflow-hidden">
      <div className="p-6">
        <h1 className="text-2xl font-bold text-gray-900 mb-1">Resumen y pago</h1>
        <p className="text-sm text-gray-500 mb-6">Paso 4 de 4 — Revisa y paga tu reserva</p>

        {createError && (
          <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm flex items-start gap-2">
            <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
            {createError}
          </div>
        )}

        {loadError && (
          <div className="mb-4 p-3 bg-amber-50 border border-amber-300 rounded-lg text-amber-900 text-sm flex items-start gap-2">
            <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
            {loadError}
          </div>
        )}

        {breakdownError && (
          <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm flex items-start gap-2">
            <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
            {breakdownError}
          </div>
        )}

        {adjustedByServer && (
          <div className="mb-4 p-3 bg-amber-50 border border-amber-300 rounded-lg text-amber-900 text-sm flex items-start gap-2">
            <Info className="w-4 h-4 flex-shrink-0 mt-0.5 text-amber-600" />
            <div>
              <p className="font-semibold">Ajustamos el uso de tu saldo</p>
              <p className="text-xs mt-0.5">
                Se aplicaron {adjustedByServer.points.toLocaleString()} puntos
                {' '}({formatCurrencyMXN(adjustedByServer.points / POINTS_PER_MXN)}) y
                {' '}{formatCurrencyMXN(adjustedByServer.cash)} de ToursRed Cash.
                {' '}Los puntos cubren como máximo el 50% del total.
                {' '}Monto a pagar: <strong>{formatCurrencyMXN(adjustedByServer.amount)}</strong>.
              </p>
            </div>
          </div>
        )}

        {/* Cost breakdown */}
        {!breakdown ? (
          <div className="mb-6 p-4 bg-gray-50 rounded-xl flex items-center justify-center gap-2 text-gray-500 text-sm">
            <Loader2 className="w-4 h-4 animate-spin" /> Calculando el total...
          </div>
        ) : (
        <div className="mb-6 p-4 bg-gray-50 rounded-xl flex flex-col gap-y-2">

          {/* Traveler category breakdown — no aplica con precio fijo por
              vehiculo: el precio no escala por categoria/persona. */}
          {!esPerVehicle && travelerCategoryBreakdown.length > 0 && (
            <div className="flex flex-col gap-y-1 pb-1">
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

          {/* Lugares extra para completar el minimo garantizado — no son
              viajeros, se muestran aparte. */}
          {extraSpots > 0 && (
            <div className="flex justify-between text-sm text-gray-500">
              <span>
                {extraSpots} lugar{extraSpots !== 1 ? 'es' : ''} adicional{extraSpots !== 1 ? 'es' : ''} (mínimo garantizado) × {formatCurrencyMXN(adultBasePrice * preventaRatio)}
              </span>
              <span>{formatCurrencyMXN(extraSpots * adultBasePrice * preventaRatio)}</span>
            </div>
          )}

          {/* Tour total */}
          <div className="flex justify-between text-sm border-t border-gray-200 pt-2">
            <span className="font-medium text-gray-700">
              {esPerVehicle
                ? 'Tour (precio fijo por vehículo)'
                : `Tour (${totalTravelers} viajero${totalTravelers !== 1 ? 's' : ''}${extraSpots > 0 ? ` + ${extraSpots} lugar${extraSpots !== 1 ? 'es' : ''}` : ''})`}
            </span>
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
                <span className={`font-medium ${isFullWalletPayment ? 'line-through text-gray-400' : 'text-gray-800'}`}>
                  {formatCurrencyMXN(extrasServiceChargeBase)}
                </span>
              </div>
              {!isFullWalletPayment && shouldWaiveServiceCharge && extrasExemptionUsed > 0 && (
                <div className="flex justify-between text-sm text-green-600">
                  <span className="flex items-center gap-1">
                    <Check className="w-3 h-3" /> Descuento por membresía (extras)
                  </span>
                  <span className="font-medium">-{formatCurrencyMXN(extrasExemptionUsed)}</span>
                </div>
              )}
              {!isFullWalletPayment && shouldWaiveServiceCharge && extrasExemptionUsed > 0 && (
                <div className="flex justify-between text-sm text-gray-500">
                  <span className="pl-4">Cargo por servicio (extras, con descuento)</span>
                  <span className="font-medium text-gray-700">{formatCurrencyMXN(extrasServiceCharge)}</span>
                </div>
              )}
            </>
          )}

          {/* Insurance */}
          {insuranceDiscountAmount > 0 && (
            <div className="flex justify-between text-sm">
              <span className="text-emerald-700 flex items-center gap-1">
                <Tag className="w-3 h-3" /> Descuento de seguro
              </span>
              <span className="font-medium text-emerald-700">
                -{formatCurrencyMXN(insuranceDiscountAmount)}
              </span>
            </div>
          )}
          {promoDiscountAmount > 0 && (
            <div className="flex justify-between text-sm">
              <span className="text-rose-700 flex items-center gap-1">
                <Tag className="w-3 h-3" /> {promo.etiqueta}
              </span>
              <span className="font-medium text-rose-700">
                -{formatCurrencyMXN(promoDiscountAmount)}
              </span>
            </div>
          )}
          {insuranceCost > 0 && (
            <div className="flex justify-between text-sm">
              <span className="text-gray-600 flex items-center gap-1">
                <Shield className="w-3 h-3" /> Seguro de viaje ({insuranceDays} días)
              </span>
              <span className="font-medium text-gray-800">{formatCurrencyMXN(insuranceCost)}</span>
            </div>
          )}

          {/* Deposit service charge: bruto → descuento de codigo → descuento de membresia → neto */}
          <div className="flex justify-between text-sm">
            <span className="text-gray-600">Cargo por servicio</span>
            <span className={`font-medium ${isFullWalletPayment ? 'line-through text-gray-400' : 'text-gray-800'}`}>
              {formatCurrencyMXN(baseServiceCharge)}
            </span>
          </div>
          {!isFullWalletPayment && serviceChargeDiscount > 0 && (
            <div className="flex justify-between text-sm text-emerald-700">
              <span className="flex items-center gap-1">
                <Tag className="w-3 h-3" /> Descuento de cargo por servicio ({flow.discountCode})
              </span>
              <span className="font-medium">-{formatCurrencyMXN(serviceChargeDiscount)}</span>
            </div>
          )}
          {isFullWalletPayment && (baseServiceCharge > 0 || extrasServiceChargeBase > 0) && (
            <>
              <div className="flex justify-between text-sm text-teal-700">
                <span className="flex items-center gap-1">
                  <Wallet className="w-3 h-3" /> Beneficio ToursRed Cash (100% con saldo)
                </span>
                <span className="font-medium">
                  -{formatCurrencyMXN(baseServiceCharge + extrasServiceChargeBase)}
                </span>
              </div>
              <div className="flex justify-between text-sm text-green-600">
                <span className="pl-4">Cargo por servicio (a pagar)</span>
                <span className="font-medium">{formatCurrencyMXN(0)}</span>
              </div>
            </>
          )}
          {!isFullWalletPayment && shouldWaiveServiceCharge && exemptionUsed > 0 && (
            <div className="flex justify-between text-sm text-green-600">
              <span className="flex items-center gap-1">
                <Check className="w-3 h-3" /> {flow.addMembership ? 'Exento por nueva membresía' : 'Descuento por membresía'}
              </span>
              <span className="font-medium">-{formatCurrencyMXN(exemptionUsed)}</span>
            </div>
          )}
          {!isFullWalletPayment && shouldWaiveServiceCharge && exemptionUsed > 0 && (
            <div className="flex justify-between text-sm text-gray-500">
              <span className="pl-4">Cargo por servicio (con descuento)</span>
              <span className="font-medium text-gray-700">{formatCurrencyMXN(depositServiceCharge)}</span>
            </div>
          )}
          {!isFullWalletPayment && serviceChargeDiscount > 0 && !(shouldWaiveServiceCharge && exemptionUsed > 0) && (
            <div className="flex justify-between text-sm text-gray-500">
              <span className="pl-4">Cargo por servicio (con descuento)</span>
              <span className="font-medium text-gray-700">{formatCurrencyMXN(depositServiceCharge)}</span>
            </div>
          )}
          {!isFullWalletPayment && hasReachedExemptionLimit && depositServiceCharge > 0 && (
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
              <span className="font-medium">-{formatCurrencyMXN(pointsDiscount)} ({pointsApplied.toLocaleString()} pts)</span>
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
          <div className="border-t border-gray-200 pt-2 flex justify-between">
            <span className="font-bold text-gray-900">Total de la reserva</span>
            <span className="font-bold text-primary-600 text-lg">{formatCurrencyMXN(grandTotal)}</span>
          </div>

          {/* Exigible ahora y resto. amountToPay es el mismo valor que cobra el boton
              y que create_booking_atomic guarda en amount_due_now: anticipo + cargo por
              servicio + extras + seguro + membresia, menos puntos y ToursRed Cash.
              El porcentaje sale de effectiveDepositPct (que puede venir del plan de
              pagos), no de tour.deposit_percentage, para que cuadre con el monto. */}
          {amountToPay < grandTotal && (
            <>
              <div className="flex justify-between text-sm bg-primary-50 -mx-4 px-4 py-2">
                <span className="font-medium text-primary-700">
                  A pagar ahora (anticipo {effectiveDepositPct}% + cargos)
                </span>
                <span className="font-bold text-primary-700">{formatCurrencyMXN(amountToPay)}</span>
              </div>
              <div className="flex justify-between text-xs bg-gray-50 -mx-4 -mb-4 px-4 py-2 rounded-b-xl">
                <span className="text-gray-600">Resto por pagar antes de la salida</span>
                <span className="font-medium text-gray-700">
                  {formatCurrencyMXN(Math.max(0, grandTotal - amountToPay))}
                </span>
              </div>
            </>
          )}
        </div>
        )}

        {/* ToursRed Points earned banner: solo si el servidor va a otorgar puntos (membresia activa) */}
        {pointsToEarn > 0 && (
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
                  ¡Doble de puntos por pagar solo con ToursRed Cash y tener ToursRed Plus activo!
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

        {/* Codigo de descuento del SEGURO. Solo si contrato seguro: sin seguro
            no hay nada que descontar y el campo confundiria. */}
        {flow.includeInsurance && insuranceCost > 0 && (
          <div className="mb-4">
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Codigo de descuento del seguro
            </label>
            {insuranceApplied ? (
              <div className="flex items-center gap-2 p-3 bg-green-50 border border-green-200 rounded-lg">
                <Check className="w-4 h-4 text-green-600" />
                <span className="text-sm text-green-800 font-medium">
                  {flow.insuranceDiscountMeta?.code} aplicado
                </span>
                <button
                  onClick={handleRemoveInsuranceDiscount}
                  className="ml-auto text-sm text-red-600 hover:underline"
                >
                  Quitar
                </button>
              </div>
            ) : (
              <div className="flex gap-2">
                <input
                  type="text"
                  value={insuranceInput}
                  onChange={(e) => setInsuranceInput(e.target.value)}
                  placeholder="Codigo del seguro"
                  className="input text-sm flex-1"
                />
                <button
                  onClick={handleApplyInsuranceDiscount}
                  disabled={isApplyingInsurance || !insuranceInput.trim()}
                  className="px-4 py-2 bg-gray-800 text-white text-sm font-medium rounded-lg hover:bg-gray-700 disabled:bg-gray-300"
                >
                  {isApplyingInsurance ? 'Validando...' : 'Aplicar'}
                </button>
              </div>
            )}
            {insuranceError && <p className="text-xs text-red-600 mt-1">{insuranceError}</p>}
          </div>
        )}

        {/* Points toggle */}
        {pointsBalance > 0 && canUsePoints && (
          <div className="mb-4">
            <label className={`flex items-center gap-3 p-3 rounded-lg border-2 cursor-pointer transition-all ${usePoints ? 'border-amber-400 bg-amber-50' : 'border-gray-200'}`}>
              <input
                type="checkbox"
                checked={usePoints}
                onChange={(e) => {
                  // El monto que de verdad se cobra es pointsApplied (arriba,
                  // linea ~347), que se recalcula en cada render mientras
                  // usePoints este activo. flow.pointsUsed de aqui ya NO topa
                  // ese calculo — es solo un registro informativo — porque
                  // congelarlo en el click era el bug: si netBeforeCharges subia
                  // despues (mas viajeros, extras, seguro) con la casilla ya
                  // marcada, el tope se quedaba en el valor viejo.
                  setUsePoints(e.target.checked);
                  updateFlow({ pointsUsed: e.target.checked ? Math.min(pointsBalance, maxPointsAllowed) : 0 });
                }}
                className="h-4 w-4 text-amber-600"
              />
              <Award className="w-4 h-4 text-amber-600" />
              <div className="flex-1">
                <span className="text-sm font-medium text-gray-800">Usar {pointsBalance.toLocaleString()} puntos ToursRed</span>
                <p className="text-xs text-gray-500">
                  100 puntos = $1 MXN · máximo 50% del total ({maxPointsAllowed.toLocaleString()} pts)
                </p>
              </div>
            </label>
          </div>
        )}

        {/* Puntos con saldo pero wallet inactivo y sin membresia vigente:
            portado de BookingForm.tsx (pointsWalletActive). El wallet se
            desactiva cuando la membresia vence (trigger
            sync_membership_with_points_wallet) — sin este aviso el saldo
            simplemente desaparecia sin explicacion. */}
        {pointsBalance > 0 && !canUsePoints && (
          <div className="mb-4 rounded-lg border border-gray-200 bg-gray-50 p-3">
            <p className="text-xs text-gray-500">
              Tienes {pointsBalance.toLocaleString()} puntos ToursRed, pero no puedes usarlos: tu membresía no está vigente. Renuévala para volver a gastarlos.
            </p>
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
                  // Mismo motivo que en puntos: walletDiscount (linea ~372) ya se
                  // recalcula en cada render mientras useWallet este activo.
                  // flow.toursredCashUsed de aqui es solo informativo.
                  setUseWallet(e.target.checked);
                  updateFlow({ toursredCashUsed: e.target.checked ? Math.min(walletBalance, Math.max(0, netBeforeCharges - pointsDiscount)) : 0 });
                }}
                className="h-4 w-4 text-teal-600"
              />
              <Wallet className="w-4 h-4 text-teal-600" />
              <div className="flex-1">
                <span className="text-sm font-medium text-gray-800">Usar ToursRed Cash (Saldo: {formatCurrencyMXN(walletBalance)})</span>
                <p className="text-xs text-gray-500">
                  {useWallet
                    ? `Se descuentan ${formatCurrencyMXN(walletDiscount)} de tu saldo del pago de hoy (${formatCurrencyMXN(netBeforeCharges)} más cargos).${amountToPay > 0 ? ' Lo que falta de hoy lo pagas con el método de pago.' : ''} El resto del tour se paga antes de la salida.`
                    : `Úsalo para pagar hoy: ${formatCurrencyMXN(netBeforeCharges)} más cargos. Tu saldo se descuenta de ese pago, y el resto del tour se paga antes de la salida.`}
                </p>
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

        {/* Payment provider selector — se oculta cuando no hay nada que cobrar a un procesador */}
        {!isWalletOnlyPayment ? (
          <div className="mb-6">
            <PaymentProviderSelector
              context={paymentContext}
              value={flow.paymentProvider as Provider}
              onChange={(p) => updateFlow({ paymentProvider: p })}
              amount={amountToPay}
              conektaMethod={flow.conektaMethod as ConektaMethod}
              onConektaMethodChange={(m) => updateFlow({ conektaMethod: m })}
              openpayMethod={flow.openpayMethod as OpenpayMethod}
              onOpenpayMethodChange={(m) => updateFlow({ openpayMethod: m })}
            />
          </div>
        ) : (
          <div className="mb-6 flex items-start gap-2 rounded-xl border-2 border-teal-400 bg-teal-50 p-4">
            <Wallet className="w-5 h-5 text-teal-600 flex-shrink-0 mt-0.5" />
            <p className="text-sm text-teal-900">
              Tu saldo cubre el <strong>100%</strong> de esta reserva. No necesitas un método de
              pago externo y el cargo por servicio queda exento.
            </p>
          </div>
        )}

        {/* Viajero de alto riesgo (>3 no-shows): debe cubrir el 100% hoy, sin
            dividir el pago entre metodos ni dejar saldo para despues — eso
            es exactamente lo que permitiria sortear el 100% que ya fuerza
            effectiveDepositPct arriba. Portado de BookingForm.tsx. */}
        {flow.isHighRisk && (
          <div className="mb-6 flex items-start gap-2 rounded-xl border-2 border-amber-400 bg-amber-50 p-4">
            <AlertCircle className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" />
            <p className="text-sm text-amber-900">
              Por tu historial de inasistencias, esta reserva requiere el pago del{' '}
              <strong>100% hoy</strong>, sin opcion de abonar o dividir el pago.
            </p>
          </div>
        )}

        {/* Partial payment option */}
        {dueNow > 500 && !isWalletOnlyPayment && !flow.isHighRisk && !flow.addMembership && (
          <div className="mb-6 bg-gray-50 border border-gray-200 rounded-xl p-4">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={flow.payNowMode === 'partial'}
                onChange={(e) => updateFlow({
                  payNowMode: e.target.checked ? 'partial' : 'full',
                  partialPaymentAmount: e.target.checked ? Math.min(500, depositAmount - 10) : 0,
                })}
                className="h-4 w-4 text-primary-600 focus:ring-primary-500 border-gray-300 rounded"
              />
              <span className="text-sm font-medium text-gray-700">Quiero pagar con más de un método de pago</span>
            </label>

            {flow.payNowMode === 'partial' && (
              <div className="mt-3 pl-6">
                <label className="block text-xs font-medium text-gray-600 mb-1">
                  ¿Cuánto quieres pagar ahora?
                </label>
                <input
                  type="number"
                  min={flow.conektaMethod === 'bnpl' ? 1200 : 500}
                  max={flow.conektaMethod === 'bnpl' ? Math.min(16000, depositAmount - 10) : depositAmount - 10}
                  value={flow.partialPaymentAmount || ''}
                  onChange={(e) => {
                    const val = parseFloat(e.target.value) || 0;
                    const isBnpl = flow.conektaMethod === 'bnpl';
                    const maxVal = isBnpl ? Math.min(16000, depositAmount - 10) : depositAmount - 10;
                    updateFlow({ partialPaymentAmount: Math.min(Math.max(val, 0), maxVal) });
                  }}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-primary-500 focus:border-primary-500 text-sm"
                />
                <p className="mt-2 text-xs text-gray-500">
                  Quedará un saldo de {formatCurrencyMXN(Math.max(0, dueNow - pointsDiscount - walletDiscount - amountToPay))} por pagar. Podrás completarlo después desde 'Mis Reservas' con cualquier método de pago.
                </p>
              </div>
            )}
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
            disabled={isCreating || isLoadingSettings || isLoadingBreakdown || !breakdown || !!breakdownError}
            className="flex-1 flex items-center justify-center gap-2 py-3.5 bg-primary-600 text-white font-semibold rounded-xl hover:bg-primary-700 disabled:bg-gray-300 transition-colors"
          >
            {isCreating ? (
              <>
                <Loader2 className="w-5 h-5 animate-spin" />
                Procesando...
              </>
            ) : (
              <>
                {isWalletOnlyPayment ? <Wallet className="w-5 h-5" /> : <CreditCard className="w-5 h-5" />}
                {isWalletOnlyPayment
                  ? 'Confirmar reserva con ToursRed Cash'
                  : `Pagar ${formatCurrencyMXN(amountToPay)}`}
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
};

export default BookingFlowStep4;
