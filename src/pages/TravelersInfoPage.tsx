import React, { useState, useEffect } from 'react';
import { useNavigate, useParams, Link } from 'react-router-dom';
import { Users, ArrowLeft, Save, UserPlus, Check, AlertCircle, AlertTriangle, Lock, Shield, Copy } from 'lucide-react';
import { formatCurrencyMXN, formatCurrency } from '../utils/formatCurrency';
import { supabase } from '../lib/supabase';
import { Booking, BookingTraveler, Tour, FrequentCompanion } from '../types';
import { useAuth } from '../context/AuthContext';
import { validateBirthDateForCategory, validateAllTravelers } from '../utils/birthDateValidation';
import MercadoPagoBrick from '../components/MercadoPagoBrick';

interface TravelerFormData {
  categoria_viajero: 'adulto' | 'nino' | 'infante' | 'adulto_mayor' | 'mascota';
  nombre: string;
  apellido: string;
  email: string;
  telefono: string;
  fecha_nacimiento: string;
  precio_aplicado: number;
  promo_discount_per_traveler: number;
  saveAsFrequentCompanion: boolean;
  selectedCompanionId?: string;
  documento_tipo?: 'curp' | 'pasaporte';
  documento_numero?: string;
  emergency_contact_name?: string;
  emergency_contact_phone?: string;
}

const TravelersInfoPage: React.FC = () => {
  const { bookingId } = useParams<{ bookingId: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  const [booking, setBooking] = useState<Booking | null>(null);
  const [tour, setTour] = useState<Tour | null>(null);
  const [travelers, setTravelers] = useState<TravelerFormData[]>([]);
  const [frequentCompanions, setFrequentCompanions] = useState<FrequentCompanion[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState('');
  const [travelerErrors, setTravelerErrors] = useState<string[]>([]);
  const [showCompanionsSection, setShowCompanionsSection] = useState(true);
  const [mpBrick, setMpBrick] = useState<{ preferenceId: string; publicKey: string; amount: number } | null>(null);
  const [copyEmergencyToAll, setCopyEmergencyToAll] = useState(false);
  const [showSaveEmergencyContactModal, setShowSaveEmergencyContactModal] = useState(false);
  const [userProfile, setUserProfile] = useState<{
    curp?: string;
    passport_number?: string;
    is_foreign_traveler?: boolean;
    emergency_contact_name?: string;
    emergency_contact_phone?: string;
  } | null>(null);

  useEffect(() => {
    if (!bookingId) {
      navigate('/');
      return;
    }
    loadBookingData();
  }, [bookingId]);

  const loadBookingData = async () => {
    try {
      setIsLoading(true);

      const { data: bookingData, error: bookingError } = await supabase
        .from('bookings')
        .select(`
          *,
          tours (*)
        `)
        .eq('id', bookingId)
        .maybeSingle();

      if (bookingError || !bookingData) {
        throw new Error('No se pudo cargar la reserva');
      }

      if (bookingData.user_id !== user?.id) {
        throw new Error('No tienes permiso para ver esta reserva');
      }

      setBooking(bookingData);
      setTour(bookingData.tours);

      await loadFrequentCompanions();

      const existingTravelers = await loadExistingTravelers();

      if (existingTravelers.length > 0) {
        setTravelers(existingTravelers);
      } else {
        await initializeTravelerForms(bookingData);
      }

    } catch (err: any) {
      console.error('Error loading booking:', err);
      setError(err.message || 'Error al cargar la reserva');
    } finally {
      setIsLoading(false);
    }
  };

  const loadFrequentCompanions = async () => {
    const { data, error } = await supabase
      .from('frequent_companions')
      .select('*')
      .eq('user_id', user?.id)
      .order('created_at', { ascending: false });

    if (!error && data) {
      setFrequentCompanions(data);
    }
  };

  const loadExistingTravelers = async (): Promise<TravelerFormData[]> => {
    const { data, error } = await supabase
      .from('booking_travelers')
      .select('*')
      .eq('booking_id', bookingId);

    if (error || !data || data.length === 0) {
      return [];
    }

    return data.map(t => ({
      categoria_viajero: t.categoria_viajero,
      nombre: t.nombre,
      apellido: t.apellido || '',
      email: t.email,
      telefono: t.telefono || '',
      fecha_nacimiento: t.fecha_nacimiento,
      precio_aplicado: t.precio_aplicado,
      promo_discount_per_traveler: Number(t.promo_discount_per_traveler) || 0,
      saveAsFrequentCompanion: false,
      selectedCompanionId: t.frequent_companion_id,
      documento_tipo: t.documento_tipo || undefined,
      documento_numero: t.documento_numero || '',
      emergency_contact_name: t.emergency_contact_name || '',
      emergency_contact_phone: t.emergency_contact_phone || '',
    }));
  };

  const initializeTravelerForms = async (bookingData: Booking) => {
    const travelersList: TravelerFormData[] = [];
    const tourData = bookingData.tours as Tour;

    const countAdultos = bookingData.count_adultos || 0;
    const countNinos = bookingData.count_ninos || 0;
    const countInfantes = bookingData.count_infantes || 0;
    const countAdultosMayores = bookingData.count_adultos_mayores || 0;
    const countMascotas = bookingData.count_mascotas || 0;

    const { data: userData } = await supabase
      .from('users')
      .select('first_name, last_name, email, phone_number, date_of_birth, curp, passport_number, is_foreign_traveler, emergency_contact_name, emergency_contact_phone')
      .eq('id', user?.id)
      .maybeSingle();

    if (userData) {
      setUserProfile({
        curp: userData.curp || undefined,
        passport_number: userData.passport_number || undefined,
        is_foreign_traveler: userData.is_foreign_traveler,
        emergency_contact_name: userData.emergency_contact_name || undefined,
        emergency_contact_phone: userData.emergency_contact_phone || undefined,
      });
    }

    let promoDiscountPct = 0;
    if ((bookingData as any).promotion_id && Number((bookingData as any).promo_discount_amount) > 0) {
      const { data: promoData } = await supabase
        .from('tour_promotions')
        .select('promotion_type, group_discount_percentage')
        .eq('id', (bookingData as any).promotion_id)
        .maybeSingle();
      if (promoData?.promotion_type === 'grupo_precio_fijo' && promoData.group_discount_percentage) {
        promoDiscountPct = Number(promoData.group_discount_percentage) / 100;
      }
    }

    const calcDiscountForCategory = (basePrice: number): number =>
      promoDiscountPct > 0 ? Math.round(basePrice * promoDiscountPct * 100) / 100 : 0;

    const precioAdulto = tourData.precio_adulto || tourData.price;
    const precioNino = tourData.precio_nino || tourData.price;
    const precioInfante = tourData.precio_infante || tourData.price;
    const precioAdultoMayor = tourData.precio_adulto_mayor || tourData.price;
    const precioMascota = tourData.precio_mascota || 0;

    for (let i = 0; i < countAdultos; i++) {
      const discount = calcDiscountForCategory(precioAdulto);
      if (i === 0 && userData) {
        travelersList.push({
          categoria_viajero: 'adulto',
          nombre: userData.first_name || '',
          apellido: userData.last_name || '',
          email: userData.email || user?.email || '',
          telefono: userData.phone_number || '',
          fecha_nacimiento: userData.date_of_birth || '',
          precio_aplicado: precioAdulto - discount,
          promo_discount_per_traveler: discount,
          saveAsFrequentCompanion: false,
          documento_tipo: userData.is_foreign_traveler ? 'pasaporte' : 'curp',
          documento_numero: userData.is_foreign_traveler ? (userData.passport_number || '') : (userData.curp || ''),
          emergency_contact_name: userData.emergency_contact_name || '',
          emergency_contact_phone: userData.emergency_contact_phone || '',
        });
      } else {
        travelersList.push(createEmptyTraveler('adulto', precioAdulto - calcDiscountForCategory(precioAdulto), calcDiscountForCategory(precioAdulto)));
      }
    }

    for (let i = 0; i < countNinos; i++) {
      const discount = calcDiscountForCategory(precioNino);
      travelersList.push(createEmptyTraveler('nino', precioNino - discount, discount));
    }

    for (let i = 0; i < countInfantes; i++) {
      const discount = calcDiscountForCategory(precioInfante);
      travelersList.push(createEmptyTraveler('infante', precioInfante - discount, discount));
    }

    for (let i = 0; i < countAdultosMayores; i++) {
      const discount = calcDiscountForCategory(precioAdultoMayor);
      travelersList.push(createEmptyTraveler('adulto_mayor', precioAdultoMayor - discount, discount));
    }

    for (let i = 0; i < countMascotas; i++) {
      travelersList.push(createEmptyTraveler('mascota', precioMascota, 0));
    }

    setTravelers(travelersList);
  };

  const createEmptyTraveler = (categoria: 'adulto' | 'nino' | 'infante' | 'adulto_mayor' | 'mascota', precio: number, promoDiscount = 0): TravelerFormData => {
    return {
      categoria_viajero: categoria,
      nombre: '',
      apellido: '',
      email: user?.email || '',
      telefono: '',
      fecha_nacimiento: '',
      precio_aplicado: precio,
      promo_discount_per_traveler: promoDiscount,
      saveAsFrequentCompanion: false,
      documento_tipo: undefined,
      documento_numero: '',
      emergency_contact_name: '',
      emergency_contact_phone: '',
    };
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

  const handleTravelerChange = (index: number, field: keyof TravelerFormData, value: string | number | boolean) => {
    const updatedTravelers = [...travelers];
    updatedTravelers[index] = {
      ...updatedTravelers[index],
      [field]: value,
    };
    // Si se cambia el contacto de emergencia del primer viajero y copyEmergencyToAll está activo,
    // propagar solo a los acompañantes que no tienen contacto propio (los que fueron autollenados)
    if (copyEmergencyToAll && index === 0 && (field === 'emergency_contact_name' || field === 'emergency_contact_phone')) {
      for (let i = 1; i < updatedTravelers.length; i++) {
        const hasOwnContact = travelers[i].emergency_contact_name && travelers[i].emergency_contact_name!.trim();
        if (!hasOwnContact) {
          updatedTravelers[i] = { ...updatedTravelers[i], [field]: value };
        }
      }
    }
    setTravelers(updatedTravelers);

    if (field === 'fecha_nacimiento' && typeof value === 'string' && value) {
      const result = validateBirthDateForCategory(
        value,
        updatedTravelers[index].categoria_viajero,
        tour?.start_date
      );
      const newErrors = [...travelerErrors];
      while (newErrors.length <= index) newErrors.push('');
      newErrors[index] = result.isValid ? '' : result.errorMessage;
      setTravelerErrors(newErrors);
    }
  };

  const handleCopyEmergencyToAll = (checked: boolean) => {
    setCopyEmergencyToAll(checked);
    if (checked && travelers.length > 1) {
      const first = travelers[0];
      const updatedTravelers = travelers.map((t, i) => {
        if (i === 0) return t;
        // Solo rellenar si el acompañante no tiene contacto propio registrado
        if (t.emergency_contact_name && t.emergency_contact_name.trim()) return t;
        return {
          ...t,
          emergency_contact_name: first.emergency_contact_name || '',
          emergency_contact_phone: first.emergency_contact_phone || '',
        };
      });
      setTravelers(updatedTravelers);
    }
  };

  const selectFrequentCompanion = (index: number, companion: FrequentCompanion) => {
    const updatedTravelers = [...travelers];
    updatedTravelers[index] = {
      ...updatedTravelers[index],
      nombre: companion.nombre,
      apellido: companion.apellido || '',
      email: companion.email,
      telefono: companion.telefono || '',
      fecha_nacimiento: companion.fecha_nacimiento,
      selectedCompanionId: companion.id,
      documento_tipo: companion.documento_tipo || undefined,
      documento_numero: companion.documento_numero || '',
      emergency_contact_name: companion.emergency_contact_name || '',
      emergency_contact_phone: companion.emergency_contact_phone || '',
    };
    setTravelers(updatedTravelers);

    if (companion.fecha_nacimiento && updatedTravelers[index].categoria_viajero !== 'mascota') {
      const result = validateBirthDateForCategory(
        companion.fecha_nacimiento,
        updatedTravelers[index].categoria_viajero,
        tour?.start_date
      );
      const newErrors = [...travelerErrors];
      while (newErrors.length <= index) newErrors.push('');
      newErrors[index] = result.isValid ? '' : result.errorMessage;
      setTravelerErrors(newErrors);
    }
  };

  const validateForm = (): boolean => {
    const newErrors: string[] = new Array(travelers.length).fill('');

    for (let i = 0; i < travelers.length; i++) {
      const traveler = travelers[i];

      if (!traveler.nombre.trim()) {
        setError(`Por favor ingresa el nombre del viajero ${i + 1}`);
        return false;
      }

      if (traveler.categoria_viajero !== 'mascota') {
        if (!traveler.apellido.trim()) {
          setError(`Por favor ingresa los apellidos del viajero ${i + 1}`);
          return false;
        }

        if (!traveler.email.trim()) {
          setError(`Por favor ingresa el email del viajero ${i + 1}`);
          return false;
        }

        if (!traveler.fecha_nacimiento) {
          setError(`Por favor ingresa la fecha de nacimiento del viajero ${i + 1}`);
          return false;
        }

        const result = validateBirthDateForCategory(
          traveler.fecha_nacimiento,
          traveler.categoria_viajero,
          tour?.start_date
        );
        if (!result.isValid) {
          newErrors[i] = result.errorMessage;
          setTravelerErrors(newErrors);
          setError(`La fecha de nacimiento del viajero ${i + 1} no corresponde con su categoría. Verifica los datos o regresa a modificar la reserva.`);
          return false;
        }

        // Documento siempre obligatorio para viajeros no-mascota
        if (!traveler.documento_tipo) {
          setError(`Por favor selecciona el tipo de documento del viajero ${i + 1}`);
          return false;
        }
        if (!traveler.documento_numero || !traveler.documento_numero.trim()) {
          setError(`Por favor ingresa el ${traveler.documento_tipo === 'pasaporte' ? 'número de pasaporte' : 'CURP'} del viajero ${i + 1}`);
          return false;
        }
      }
    }

    setTravelerErrors(newErrors);
    return true;
  };

  const doSave = async (saveContactToProfile: boolean) => {
    try {
      setIsSaving(true);
      setError('');

      if (saveContactToProfile && travelers.length > 0 && user) {
        const first = travelers[0];
        if (first.emergency_contact_name || first.emergency_contact_phone) {
          await supabase.from('users').update({
            emergency_contact_name: first.emergency_contact_name || null,
            emergency_contact_phone: first.emergency_contact_phone || null,
          }).eq('id', user.id);
        }
      }

      await supabase
        .from('booking_travelers')
        .delete()
        .eq('booking_id', bookingId);

      const travelersToInsert = travelers.map(traveler => ({
        booking_id: bookingId,
        categoria_viajero: traveler.categoria_viajero,
        nombre: traveler.nombre,
        apellido: traveler.apellido || null,
        email: traveler.email,
        telefono: traveler.telefono || null,
        fecha_nacimiento: traveler.fecha_nacimiento || null,
        precio_aplicado: traveler.precio_aplicado,
        promo_discount_per_traveler: traveler.promo_discount_per_traveler || 0,
        frequent_companion_id: traveler.selectedCompanionId || null,
        documento_tipo: traveler.documento_tipo || null,
        documento_numero: traveler.documento_numero || null,
        emergency_contact_name: traveler.emergency_contact_name || null,
        emergency_contact_phone: traveler.emergency_contact_phone || null,
      }));

      console.log('Datos a insertar:', travelersToInsert);

      const { error: insertError } = await supabase
        .from('booking_travelers')
        .insert(travelersToInsert);

      if (insertError) {
        console.error('Error de inserción:', insertError);
        throw new Error(`Error al guardar los datos de viajeros: ${insertError.message}`);
      }

      for (const traveler of travelers) {
        if (traveler.saveAsFrequentCompanion && traveler.categoria_viajero !== 'mascota') {
          const existingCompanion = frequentCompanions.find(
            c => c.email === traveler.email && c.fecha_nacimiento === traveler.fecha_nacimiento
          );

          if (!existingCompanion) {
            await supabase.from('frequent_companions').insert({
              user_id: user?.id,
              nombre: traveler.nombre,
              apellido: traveler.apellido || null,
              email: traveler.email,
              telefono: traveler.telefono || null,
              fecha_nacimiento: traveler.fecha_nacimiento,
              documento_tipo: traveler.documento_tipo || null,
              documento_numero: traveler.documento_numero || null,
              emergency_contact_name: traveler.emergency_contact_name || null,
              emergency_contact_phone: traveler.emergency_contact_phone || null,
            });
          }
        }
      }

      const isEditingExisting = booking?.payment_status === 'succeeded' ||
                                booking?.status === 'confirmed' ||
                                booking?.status === 'completed';

      if (isEditingExisting) {
        navigate('/traveler/bookings');
      } else {
        if (booking?.status === 'draft') {
          const { data: activationResult, error: activationError } = await supabase.rpc(
            'activate_draft_booking',
            { p_booking_id: bookingId }
          );

          if (activationError) {
            throw new Error(`Error al activar la reserva: ${activationError.message}`);
          }

          if (activationResult && !activationResult.success) {
            const availSpots = activationResult.available_spots || 0;
            throw new Error(
              `No hay suficientes lugares disponibles. Solo quedan ${availSpots} lugar${availSpots !== 1 ? 'es' : ''}.`
            );
          }
        }

        if (tour?.booking_approval_type === 'manual') {
          try {
            const { data: { session } } = await supabase.auth.getSession();
            if (session) {
              const response = await fetch(
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

              if (!response.ok) {
                const result = await response.json();
                console.error('Error al enviar notificacion:', result);
              }
            }
          } catch (emailError) {
            console.error('Error enviando notificacion a la agencia:', emailError);
          }
          navigate(`/booking-pending/${bookingId}`);
        } else {
          proceedToPayment();
        }
      }
    } catch (err: any) {
      console.error('Error saving travelers:', err);
      setError(err.message || 'Error al guardar los datos');
    } finally {
      setIsSaving(false);
    }
  };

  const handleSave = async () => {
    if (!validateForm()) {
      return;
    }

    const first = travelers[0];
    const profileName = userProfile?.emergency_contact_name || '';
    const profilePhone = userProfile?.emergency_contact_phone || '';
    const formName = first?.emergency_contact_name || '';
    const formPhone = first?.emergency_contact_phone || '';
    const contactChanged = (formName || formPhone) && (formName !== profileName || formPhone !== profilePhone);

    if (contactChanged) {
      setShowSaveEmergencyContactModal(true);
      return;
    }

    await doSave(false);
  };

  const proceedToPayment = async () => {
    try {
      const { data: savedTravelers, error: travelersFetchError } = await supabase
        .from('booking_travelers')
        .select('categoria_viajero, fecha_nacimiento, nombre')
        .eq('booking_id', bookingId);

      if (!travelersFetchError && savedTravelers && savedTravelers.length > 0) {
        const { isValid, errors } = validateAllTravelers(savedTravelers, tour?.start_date);
        if (!isValid) {
          const firstErrorIdx = errors.findIndex(e => e !== '');
          const travelerName = savedTravelers[firstErrorIdx]?.nombre || `Viajero ${firstErrorIdx + 1}`;
          setError(`No se puede procesar el pago: la fecha de nacimiento de ${travelerName} no corresponde con su categoría de viajero. Por favor corrige los datos.`);
          setTravelerErrors(errors);
          return;
        }
      }

      const { data: { session } } = await supabase.auth.getSession();

      if (!session) {
        throw new Error('No hay sesión activa');
      }

      // Calcular el monto a cobrar después de aplicar puntos y ToursRed Cash
      const pointsUsed = booking?.points_used || 0;
      const pointsDiscountAmount = pointsUsed / 100; // convertir puntos a pesos
      const toursRedCashUsed = booking?.toursred_cash_used || 0;
      const rawAmountToCharge = Math.max(0, Math.round(((booking?.user_payment || 0) - pointsDiscountAmount - toursRedCashUsed) * 100) / 100);
      // Si el residuo es menor a $10 (mínimo de los procesadores de pago), se absorbe como pago completo
      const amountToCharge = rawAmountToCharge < 10 ? 0 : rawAmountToCharge;

      console.log('💵 Cálculo de pago:', {
        user_payment: booking?.user_payment,
        pointsUsed,
        pointsDiscountAmount,
        toursRedCashUsed,
        rawAmountToCharge,
        amountToCharge
      });

      // Si el monto a cobrar es 0 o menor, marcar la reserva como pagada directamente
      if (amountToCharge <= 0) {
        console.log('💰 Procesando pago con puntos y/o ToursRed Cash...');

        // PRIMERO: Descontar ToursRed Cash usando la función que actualiza el saldo
        if (toursRedCashUsed > 0) {
          console.log(`💵 Descontando ${toursRedCashUsed} MXN de ToursRed Cash...`);
          const { data: walletResult, error: walletError } = await supabase.rpc(
            'update_wallet_balance',
            {
              p_user_id: user?.id,
              p_amount: -toursRedCashUsed, // Negativo para restar del saldo
              p_type: 'debit',
              p_description: `Pago de reserva para ${tour?.name}`,
              p_reference_id: bookingId,
              p_reference_type: 'booking'
            }
          );

          if (walletError) {
            console.error('❌ Error descontando ToursRed Cash del monedero:', walletError);
            throw new Error(`Error al procesar el pago con ToursRed Cash: ${walletError.message}`);
          }

          console.log('✅ ToursRed Cash descontado exitosamente:', walletResult);
        }

        // SEGUNDO: Descontar puntos del monedero manualmente
        if (pointsUsed > 0) {
          console.log(`🎯 Descontando ${pointsUsed} puntos del monedero...`);

          try {
            const { data: wallet, error: walletError } = await supabase
              .from('toursred_points_wallets')
              .select('id, balance, total_used')
              .eq('user_id', user?.id)
              .single();

            if (walletError || !wallet) {
              throw new Error('No se encontró la billetera de puntos');
            }

            const newBalance = wallet.balance - pointsUsed;
            const newTotalUsed = wallet.total_used + pointsUsed;

            const { error: updateWalletError } = await supabase
              .from('toursred_points_wallets')
              .update({
                balance: newBalance,
                total_used: newTotalUsed,
                updated_at: new Date().toISOString()
              })
              .eq('id', wallet.id);

            if (updateWalletError) {
              throw new Error(`Error al actualizar wallet: ${updateWalletError.message}`);
            }

            const { error: txError } = await supabase
              .from('toursred_points_transactions')
              .insert({
                wallet_id: wallet.id,
                user_id: user?.id,
                amount: -pointsUsed,
                balance_after: newBalance,
                type: 'redeemed',
                description: 'Puntos canjeados en reserva',
                reference_id: bookingId,
                reference_type: 'booking'
              });

            if (txError) {
              console.error('Error creando transacción de puntos:', txError);
            }

            console.log(`✅ Puntos descontados del monedero`);
          } catch (pointsError) {
            console.error('Error al canjear puntos:', pointsError);
            throw new Error(`Error al canjear puntos: ${pointsError instanceof Error ? pointsError.message : String(pointsError)}`);
          }
        }

        // TERCERO: Calcular beneficio de membresía si aplica (ANTES de actualizar)
        let membershipBenefitData: any = {};
        try {
          const { data: bookingWithDetails } = await supabase
            .from('bookings')
            .select('user_id, total_price, service_charge')
            .eq('id', bookingId)
            .single();

          if (bookingWithDetails) {
            const { data: membership } = await supabase
              .from('memberships')
              .select('id, service_fee_exemption_used')
              .eq('user_id', bookingWithDetails.user_id)
              .eq('status', 'active')
              .maybeSingle();

            if (membership) {
              const { data: settings } = await supabase
                .from('platform_settings')
                .select('service_charge_percentage')
                .maybeSingle();

              const serviceChargeRate = settings?.service_charge_percentage || 5;
              const fullServiceCharge = (bookingWithDetails.total_price * serviceChargeRate) / 100;
              const actualServiceCharge = parseFloat(bookingWithDetails.service_charge || 0);
              const exemptionUsed = fullServiceCharge - actualServiceCharge;

              if (exemptionUsed > 0) {
                await supabase
                  .from('memberships')
                  .update({
                    service_fee_exemption_used: parseFloat(membership.service_fee_exemption_used) + exemptionUsed
                  })
                  .eq('id', membership.id);

                membershipBenefitData = {
                  used_membership_benefit: true,
                  membership_service_fee_saved: exemptionUsed
                };

                console.log(`✅ Beneficio de membresía calculado: ${exemptionUsed} MXN`);
              }
            }
          }
        } catch (membershipError) {
          console.error('Error procesando beneficio de membresía:', membershipError);
        }

        // CUARTO: Determinar el método de pago y actualizar la reserva (UN SOLO UPDATE)
        let paymentMethod = 'toursred_points';
        if (pointsUsed > 0 && toursRedCashUsed > 0) {
          paymentMethod = 'toursred_points_cash';
        } else if (toursRedCashUsed > 0) {
          paymentMethod = 'toursred_cash';
        }

        console.log(`📝 Confirmando reserva con método de pago: ${paymentMethod}`);
        const { error: updateError } = await supabase
          .from('bookings')
          .update({
            payment_status: 'succeeded',
            status: 'confirmed',
            payment_method: paymentMethod,
            paid_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
            points_used: pointsUsed,
            toursred_cash_used: toursRedCashUsed,
            ...membershipBenefitData
          })
          .eq('id', bookingId);

        if (updateError) {
          console.error('❌ Error al confirmar la reserva:', updateError);
          throw new Error(`Error al confirmar la reserva: ${updateError.message}`);
        }

        console.log('✅ Reserva confirmada exitosamente');

        if (booking?.discount_code_id) {
          try {
            await supabase.from('discount_code_usage').insert({
              discount_code_id: booking.discount_code_id,
              user_id: user?.id,
              booking_id: bookingId,
            });
          } catch (discountErr) {
            console.error('Error registrando uso de codigo de descuento:', discountErr);
          }
        }

        // QUINTO: Enviar emails de confirmación a viajero, agencia y admin
        try {
          console.log('📧 Enviando emails de confirmación para reserva pagada con puntos/cash...');
          console.log('📧 URL del endpoint:', `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/send-booking-confirmation`);
          console.log('📧 Booking ID:', bookingId);
          console.log('📧 Session token presente:', !!session.access_token);

          const emailResponse = await fetch(
            `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/send-booking-confirmation`,
            {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${session.access_token}`,
              },
              body: JSON.stringify({ booking_id: bookingId }),
            }
          );

          console.log('📧 Status de respuesta del email:', emailResponse.status);

          if (emailResponse.ok) {
            const emailResult = await emailResponse.json();
            console.log('✅ Emails de confirmación enviados exitosamente:', emailResult);
          } else {
            const errorText = await emailResponse.text();
            console.error('❌ Error HTTP en envío de emails:', {
              status: emailResponse.status,
              statusText: emailResponse.statusText,
              error: errorText
            });
            // No lanzamos error aquí porque los emails no deben bloquear el flujo
          }
        } catch (emailError) {
          console.error('❌ Excepción al enviar emails de confirmación:', {
            error: emailError,
            message: emailError instanceof Error ? emailError.message : String(emailError),
            stack: emailError instanceof Error ? emailError.stack : undefined
          });
          // No lanzamos error aquí porque los emails no deben bloquear el flujo
        }

        console.log('✅ Proceso completado, redirigiendo a página de éxito...');
        // Redirigir a la página de éxito
        navigate(`/booking-success?booking_id=${bookingId}`);
        return;
      }

      const paymentProvider = (booking as any)?.payment_provider || 'stripe';

      if (paymentProvider === 'mercadopago') {
        const mpResponse = await fetch(
          `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/create-mercadopago-preference`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${session.access_token}`,
            },
            body: JSON.stringify({
              bookingId: bookingId,
              customerEmail: user?.email,
              amount: amountToCharge,
              description: `Depósito para ${tour?.name}`,
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
          setMpBrick({ preferenceId: mpResult.preference_id, publicKey: mpResult.public_key, amount: amountToCharge });
        } else if (mpResult.url) {
          window.location.href = mpResult.url;
        } else {
          throw new Error('No se recibió la información de MercadoPago');
        }
      } else if (paymentProvider === 'paypal') {
        const ppResponse = await fetch(
          `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/create-paypal-order`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${session.access_token}`,
            },
            body: JSON.stringify({
              bookingId: bookingId,
              amount: amountToCharge,
              description: `Depósito para ${tour?.name}`,
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
        const response = await fetch(
          `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/create-checkout-session`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${session.access_token}`,
            },
            body: JSON.stringify({
              bookingId: bookingId,
              customerEmail: user?.email,
              amount: (() => {
                const addMembership = (booking as any)?.membership_purchased || false;
                if (!addMembership) return amountToCharge;
                const membershipCost = (booking as any)?.membership_cost || 0;
                return Math.max(0, Math.round((amountToCharge - membershipCost) * 100) / 100);
              })(),
              description: `Depósito para ${tour?.name}`,
              success_url: `${window.location.origin}/booking-success?booking_id=${bookingId}`,
              cancel_url: `${window.location.origin}/booking-cancel?booking_id=${bookingId}`,
              toursRedCashUsed: toursRedCashUsed,
              pointsUsed: pointsUsed,
              addMembership: (booking as any)?.membership_purchased || false,
              membershipPlan: (booking as any)?.membership_plan || 'monthly',
              metadata: {
                points_used: pointsUsed.toString(),
                points_discount: pointsDiscountAmount.toString(),
                discount_code_id: booking?.discount_code_id || '',
                discount_amount: (booking?.discount_amount || 0).toString(),
              }
            }),
          }
        );

        if (!response.ok) {
          const errorData = await response.json();
          throw new Error(errorData.error || 'Error al crear la sesión de pago');
        }

        const result = await response.json();

        if (!result.success) {
          throw new Error(result.error || 'Error al crear la sesión de pago');
        }

        if (result.url) {
          window.location.href = result.url;
        } else {
          throw new Error('No se recibió la URL de pago');
        }
      }

    } catch (error: any) {
      console.error('Error creando sesión de checkout:', error);
      setError(error.message || 'Error al procesar el pago');
    }
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-primary-600 mx-auto"></div>
          <p className="mt-4 text-gray-600">Cargando...</p>
        </div>
      </div>
    );
  }

  if (!booking || !tour) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <p className="text-red-600">No se pudo cargar la información de la reserva</p>
          <button
            onClick={() => navigate('/')}
            className="mt-4 px-4 py-2 bg-primary-600 text-white rounded-md hover:bg-primary-700"
          >
            Volver al inicio
          </button>
        </div>
      </div>
    );
  }

  const isEditingExistingBooking = booking?.payment_status === 'succeeded' ||
    booking?.status === 'confirmed' ||
    booking?.status === 'completed';
  const nameChangesBlocked = !!(tour as any)?.name_changes_not_allowed && isEditingExistingBooking;

  if (mpBrick) {
    return (
      <div className="min-h-screen bg-gray-50 py-8">
        <div className="max-w-xl mx-auto px-4">
          <button
            onClick={() => setMpBrick(null)}
            className="flex items-center text-gray-600 hover:text-gray-900 mb-6"
          >
            <ArrowLeft className="w-5 h-5 mr-2" />
            Volver
          </button>
          <div className="bg-white rounded-lg shadow-md p-6">
            <h2 className="text-xl font-bold mb-2">Completa tu pago</h2>
            <p className="text-sm text-gray-500 mb-6">Pago seguro con MercadoPago</p>
            <MercadoPagoBrick
              preferenceId={mpBrick.preferenceId}
              publicKey={mpBrick.publicKey}
              amount={mpBrick.amount}
              bookingId={bookingId}
              onSuccess={() => navigate(`/booking-success?booking_id=${bookingId}`)}
              onPending={() => navigate(`/payment-return?provider=mercadopago&booking_id=${bookingId}&tr_status=pending`)}
              onError={(err) => {
                setMpBrick(null);
                setError(err);
              }}
            />
          </div>
        </div>
      </div>
    );
  }

  return (
    <>
    <div className="min-h-screen bg-gray-50 py-8">
      <div className="max-w-4xl mx-auto px-4">
        <button
          onClick={() => navigate(-1)}
          className="flex items-center text-gray-600 hover:text-gray-900 mb-6"
        >
          <ArrowLeft className="w-5 h-5 mr-2" />
          Volver
        </button>

        <div className="bg-white rounded-lg shadow-md p-6 mb-6">
          <div className="flex items-center mb-4">
            <Users className="w-6 h-6 text-primary-600 mr-2" />
            <h1 className="text-2xl font-bold">Información de Viajeros</h1>
          </div>

          <div className="bg-blue-50 border border-blue-200 rounded-md p-4 mb-6">
            <p className="text-sm text-blue-800">
              <strong>Tour:</strong> {tour.name}
            </p>
            <p className="text-sm text-blue-800 mt-1">
              Por favor ingresa la información de todos los viajeros que participarán en este tour.
            </p>
          </div>

          {frequentCompanions.length > 0 && (
            <div className="mb-6 border-t border-gray-200 pt-6">
              <button
                onClick={() => setShowCompanionsSection(!showCompanionsSection)}
                className="flex items-center justify-between w-full text-left mb-4"
              >
                <h2 className="text-lg font-semibold flex items-center">
                  <UserPlus className="w-5 h-5 mr-2" />
                  Acompañantes frecuentes
                </h2>
                <span className="text-sm text-gray-500">
                  {showCompanionsSection ? '▼' : '▶'}
                </span>
              </button>

              {showCompanionsSection && (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                  {frequentCompanions.map((companion) => (
                    <div
                      key={companion.id}
                      className="border border-gray-200 rounded-lg p-3 hover:border-primary-500 hover:bg-primary-50 transition-colors cursor-default"
                    >
                      <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center">
                          <div className="w-10 h-10 rounded-full bg-primary-100 flex items-center justify-center mr-2">
                            <Users className="w-5 h-5 text-primary-600" />
                          </div>
                          <div>
                            <p className="font-medium text-sm">{companion.nombre}</p>
                            <p className="text-xs text-gray-500">
                              {new Date(companion.fecha_nacimiento).getFullYear()}
                            </p>
                          </div>
                        </div>
                      </div>
                      <p className="text-xs text-gray-500 mb-2">{companion.email}</p>
                      <p className="text-xs text-gray-400">
                        Haz clic en "Usar datos" para autocompletar
                      </p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {nameChangesBlocked && (
            <div className="bg-red-50 border-2 border-red-300 rounded-lg p-4 mb-6">
              <div className="flex items-start">
                <Lock className="h-5 w-5 text-red-600 mt-0.5 mr-3 flex-shrink-0" />
                <div>
                  <p className="text-sm font-bold text-red-800">
                    Este tour no permite cambios de nombre después del pago
                  </p>
                  <p className="text-sm text-red-700 mt-1">
                    Los nombres de los viajeros no pueden ser modificados porque este tour tiene boletos nominales (aéreos u otros). Si necesitas hacer un cambio, contacta directamente a la agencia.
                  </p>
                </div>
              </div>
            </div>
          )}

          {!nameChangesBlocked && (tour as any)?.name_changes_not_allowed && !isEditingExistingBooking && (
            <div className="bg-red-50 border-2 border-red-300 rounded-lg p-4 mb-6">
              <div className="flex items-start">
                <AlertTriangle className="h-5 w-5 text-red-600 mt-0.5 mr-3 flex-shrink-0" />
                <div>
                  <p className="text-sm font-bold text-red-800">
                    Este tour NO permite cambios de nombre una vez realizado el pago
                  </p>
                  <p className="text-sm text-red-700 mt-1">
                    Verifica cuidadosamente que todos los nombres estén escritos correctamente antes de continuar. Una vez pagada la reserva, no será posible modificar los nombres de los viajeros.
                  </p>
                </div>
              </div>
            </div>
          )}

          {error && (
            <div className="bg-red-50 border border-red-200 rounded-md p-3 mb-6">
              <p className="text-sm text-red-800">{error}</p>
            </div>
          )}

          <div className="space-y-6">
            {travelers.map((traveler, index) => (
              <div key={index} className="border border-gray-200 rounded-lg p-4">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="font-semibold text-lg flex items-center gap-2 flex-wrap">
                    {getCategoryLabel(traveler.categoria_viajero)} {index + 1}
                    {traveler.promo_discount_per_traveler > 0 ? (
                      <span className="flex items-center gap-1.5">
                        <span className="text-sm text-gray-400 line-through">
                          {formatCurrencyMXN(traveler.precio_aplicado + traveler.promo_discount_per_traveler)}
                        </span>
                        <span className="text-sm font-bold text-emerald-600">
                          {formatCurrencyMXN(traveler.precio_aplicado)}
                        </span>
                        <span className="text-xs bg-emerald-100 text-emerald-700 px-1.5 py-0.5 rounded font-medium">
                          -{traveler.promo_discount_per_traveler.toLocaleString()} desc. grupal
                        </span>
                      </span>
                    ) : (
                      <span className="text-sm text-gray-500">
                        ({formatCurrencyMXN(traveler.precio_aplicado)})
                      </span>
                    )}
                  </h3>

                  {frequentCompanions.length > 0 && traveler.categoria_viajero !== 'mascota' && (
                    <div className="relative">
                      <select
                        onChange={(e) => {
                          if (e.target.value) {
                            const companion = frequentCompanions.find(c => c.id === e.target.value);
                            if (companion) selectFrequentCompanion(index, companion);
                          }
                        }}
                        className="text-sm border border-gray-300 rounded-md px-3 py-1 hover:border-primary-500 focus:border-primary-500 focus:outline-none"
                        value=""
                      >
                        <option value="">Usar datos guardados</option>
                        {frequentCompanions.map((companion) => (
                          <option key={companion.id} value={companion.id}>
                            {companion.nombre}
                          </option>
                        ))}
                      </select>
                    </div>
                  )}
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {traveler.categoria_viajero === 'mascota' ? (
                    <div className="md:col-span-2">
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        Nombre de la mascota *
                      </label>
                      <input
                        type="text"
                        value={traveler.nombre}
                        onChange={(e) => handleTravelerChange(index, 'nombre', e.target.value)}
                        className="input"
                        placeholder="Nombre de la mascota"
                        required
                      />
                    </div>
                  ) : (
                    <>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                          Nombre(s) *
                        </label>
                        <input
                          type="text"
                          value={traveler.nombre}
                          onChange={(e) => handleTravelerChange(index, 'nombre', e.target.value)}
                          className={`input ${nameChangesBlocked ? 'bg-gray-100 text-gray-500 cursor-not-allowed' : ''}`}
                          placeholder="Nombre(s)"
                          required
                          readOnly={nameChangesBlocked}
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                          Apellidos *
                        </label>
                        <input
                          type="text"
                          value={traveler.apellido}
                          onChange={(e) => handleTravelerChange(index, 'apellido', e.target.value)}
                          className={`input ${nameChangesBlocked ? 'bg-gray-100 text-gray-500 cursor-not-allowed' : ''}`}
                          placeholder="Apellido paterno y materno"
                          required
                          readOnly={nameChangesBlocked}
                        />
                      </div>
                    </>
                  )}

                  {traveler.categoria_viajero !== 'mascota' && (
                    <>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                          Fecha de Nacimiento *
                        </label>
                        <input
                          type="date"
                          value={traveler.fecha_nacimiento}
                          onChange={(e) => handleTravelerChange(index, 'fecha_nacimiento', e.target.value)}
                          className={`input ${travelerErrors[index] ? 'border-red-500 focus:border-red-500 focus:ring-red-500' : ''} ${nameChangesBlocked ? 'bg-gray-100 text-gray-500 cursor-not-allowed' : ''}`}
                          required
                          readOnly={nameChangesBlocked}
                        />
                        {travelerErrors[index] && (
                          <div className="mt-2 bg-red-50 border border-red-200 rounded-md p-3">
                            <div className="flex items-start">
                              <AlertCircle className="h-4 w-4 text-red-600 mt-0.5 mr-2 flex-shrink-0" />
                              <div className="text-sm text-red-700">
                                <p>{travelerErrors[index]}</p>
                                <p className="mt-2 text-xs">
                                  Verifica la fecha de nacimiento o{' '}
                                  <Link
                                    to={`/tours/${tour?.slug || tour?.id}`}
                                    className="font-semibold text-red-800 underline hover:text-red-900"
                                  >
                                    regresa a actualizar la reserva
                                  </Link>{' '}
                                  y selecciona el tipo de viajero que corresponde.
                                </p>
                              </div>
                            </div>
                          </div>
                        )}
                      </div>

                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                          Email *
                        </label>
                        <input
                          type="email"
                          value={traveler.email}
                          onChange={(e) => handleTravelerChange(index, 'email', e.target.value)}
                          className={`input ${nameChangesBlocked ? 'bg-gray-100 text-gray-500 cursor-not-allowed' : ''}`}
                          placeholder="correo@ejemplo.com"
                          required
                          readOnly={nameChangesBlocked}
                        />
                      </div>

                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                          Teléfono
                        </label>
                        <input
                          type="tel"
                          value={traveler.telefono}
                          onChange={(e) => handleTravelerChange(index, 'telefono', e.target.value)}
                          className={`input ${nameChangesBlocked ? 'bg-gray-100 text-gray-500 cursor-not-allowed' : ''}`}
                          placeholder="+52 123 456 7890"
                          readOnly={nameChangesBlocked}
                        />
                      </div>
                    </>
                  )}
                </div>

                {/* Documento de identificación — siempre obligatorio para viajeros no-mascota */}
                {traveler.categoria_viajero !== 'mascota' && (
                  <div className="mt-4 border border-blue-200 rounded-lg bg-blue-50 p-4">
                    <div className="flex items-center gap-2 mb-3">
                      <Shield className="w-4 h-4 text-blue-600 flex-shrink-0" />
                      <span className="text-sm font-semibold text-blue-800">Identificación *</span>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                          Tipo de documento *
                        </label>
                        <select
                          value={traveler.documento_tipo || ''}
                          onChange={(e) => handleTravelerChange(index, 'documento_tipo', e.target.value as 'curp' | 'pasaporte')}
                          className="input"
                          required
                        >
                          <option value="">Seleccionar...</option>
                          <option value="curp">CURP (nacional)</option>
                          <option value="pasaporte">Pasaporte (extranjero)</option>
                        </select>
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                          {traveler.documento_tipo === 'pasaporte' ? 'Número de Pasaporte *' : 'CURP *'}
                        </label>
                        <input
                          type="text"
                          value={traveler.documento_numero || ''}
                          onChange={(e) => handleTravelerChange(index, 'documento_numero', e.target.value.toUpperCase())}
                          className="input uppercase"
                          placeholder={traveler.documento_tipo === 'pasaporte' ? 'A12345678' : traveler.documento_tipo === 'curp' ? 'ABCD123456HDFRRL09' : '—'}
                          maxLength={traveler.documento_tipo === 'pasaporte' ? 20 : 18}
                          disabled={!traveler.documento_tipo}
                        />
                      </div>
                    </div>
                  </div>
                )}

                {/* Contacto de emergencia — visible siempre para viajeros no-mascota */}
                {traveler.categoria_viajero !== 'mascota' && (
                  <div className="mt-4 border border-gray-200 rounded-lg bg-gray-50 p-4">
                    <div className="flex items-center justify-between mb-3">
                      <div className="flex items-center gap-2">
                        <Shield className="w-4 h-4 text-gray-500 flex-shrink-0" />
                        <span className="text-sm font-semibold text-gray-700">Contacto de Emergencia (opcional)</span>
                      </div>
                      {index === 0 && (userProfile?.emergency_contact_name || userProfile?.emergency_contact_phone) && (
                        <span className="text-xs text-blue-600 font-medium bg-blue-50 border border-blue-200 rounded-full px-2 py-0.5">
                          Cargado desde tu perfil
                        </span>
                      )}
                    </div>
                    {booking?.travel_insurance_included && !traveler.emergency_contact_name && !traveler.emergency_contact_phone && (
                      <div className="mb-3 flex items-start gap-2 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-md px-3 py-2">
                        <AlertTriangle className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
                        <span>Esta reserva incluye seguro de viajero. Se recomienda agregar un contacto de emergencia.</span>
                      </div>
                    )}
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                          Nombre del contacto
                        </label>
                        <input
                          type="text"
                          value={traveler.emergency_contact_name || ''}
                          onChange={(e) => handleTravelerChange(index, 'emergency_contact_name', e.target.value)}
                          className="input"
                          placeholder="Nombre completo"
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                          Teléfono del contacto
                        </label>
                        <input
                          type="tel"
                          value={traveler.emergency_contact_phone || ''}
                          onChange={(e) => handleTravelerChange(index, 'emergency_contact_phone', e.target.value)}
                          className="input"
                          placeholder="+52 55 1234 5678"
                        />
                      </div>
                    </div>
                    {index === 0 && travelers.filter(t => t.categoria_viajero !== 'mascota').length > 1 && (
                      <div className="mt-3 pt-3 border-t border-gray-200">
                        <label className="flex items-center gap-2 cursor-pointer text-sm">
                          <input
                            type="checkbox"
                            checked={copyEmergencyToAll}
                            onChange={(e) => handleCopyEmergencyToAll(e.target.checked)}
                            className="h-4 w-4 text-gray-500 border-gray-300 rounded"
                          />
                          <Copy className="w-3.5 h-3.5 text-gray-500" />
                          <span className="text-gray-700 font-medium">Usar el mismo contacto de emergencia para los acompañantes sin contacto registrado</span>
                        </label>
                      </div>
                    )}
                  </div>
                )}

                {traveler.categoria_viajero !== 'mascota' && index > 0 && (
                  <div className="mt-4">
                    <label className="flex items-center text-sm cursor-pointer">
                      <input
                        type="checkbox"
                        checked={traveler.saveAsFrequentCompanion}
                        onChange={(e) => handleTravelerChange(index, 'saveAsFrequentCompanion', e.target.checked)}
                        className="mr-2 h-4 w-4 text-primary-600 focus:ring-primary-500 border-gray-300 rounded"
                      />
                      <span className="flex items-center">
                        <Check className="w-4 h-4 text-green-600 mr-1" />
                        Guardar como acompañante frecuente
                      </span>
                    </label>
                    <p className="text-xs text-gray-500 ml-6 mt-1">
                      Los datos de este viajero se guardarán en tu cuenta para futuras reservas
                    </p>
                  </div>
                )}
              </div>
            ))}
          </div>

          <div className="mt-8 flex justify-end">
            {nameChangesBlocked ? (
              <button
                disabled
                className="px-6 py-3 rounded-md font-semibold flex items-center bg-gray-300 text-gray-500 cursor-not-allowed"
              >
                <Lock className="w-5 h-5 mr-2" />
                Cambios no permitidos
              </button>
            ) : (
              <button
                onClick={handleSave}
                disabled={isSaving || travelerErrors.some(e => e !== '')}
                className={`px-6 py-3 rounded-md font-semibold flex items-center ${
                  isSaving || travelerErrors.some(e => e !== '')
                    ? 'bg-gray-300 text-gray-500 cursor-not-allowed'
                    : 'bg-primary-600 text-white hover:bg-primary-700'
                }`}
              >
                {isSaving ? (
                  <>
                    <div className="animate-spin rounded-full h-5 w-5 border-t-2 border-b-2 border-white mr-2"></div>
                    Guardando...
                  </>
                ) : (
                  <>
                    <Save className="w-5 h-5 mr-2" />
                    {(booking?.payment_status === 'succeeded' ||
                      booking?.status === 'confirmed' ||
                      booking?.status === 'completed')
                      ? 'Guardar Cambios'
                      : 'Continuar al Pago'}
                  </>
                )}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>

    {/* Modal: guardar contacto de emergencia en perfil */}

    {showSaveEmergencyContactModal && (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4">
        <div className="bg-white rounded-xl shadow-xl max-w-sm w-full p-6">
          <div className="flex items-center gap-3 mb-3">
            <div className="bg-blue-50 rounded-full p-2">
              <Shield className="w-5 h-5 text-blue-600" />
            </div>
            <h3 className="text-base font-semibold text-gray-900">Guardar contacto de emergencia</h3>
          </div>
          <p className="text-sm text-gray-600 mb-5">
            ¿Quieres guardar este contacto de emergencia en tu perfil para que se cargue automáticamente en futuras reservas?
          </p>
          <div className="flex flex-col gap-2">
            <button
              onClick={() => {
                setShowSaveEmergencyContactModal(false);
                doSave(true);
              }}
              className="btn-primary w-full"
            >
              Si, guardar en mi perfil
            </button>
            <button
              onClick={() => {
                setShowSaveEmergencyContactModal(false);
                doSave(false);
              }}
              className="btn-secondary w-full"
            >
              No, solo para esta reserva
            </button>
          </div>
        </div>
      </div>
    )}
    </>
  );
};

export default TravelersInfoPage;
