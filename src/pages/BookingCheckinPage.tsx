import React, { useEffect, useState } from 'react';
import { useSearchParams, useNavigate, Link } from 'react-router-dom';
import {
  CheckCircle, XCircle, Clock, AlertTriangle, Users, MapPin, Calendar,
  DollarSign, QrCode, ChevronRight, Bus, Wallet, KeyRound, RefreshCw,
  ShieldCheck, Info,
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import { formatCurrencyMXN } from '../utils/formatCurrency';

interface Traveler {
  id: string;
  nombre: string;
  email: string;
  categoria_viajero: string;
  precio_aplicado: number;
  is_no_show: boolean;
}

interface CheckinDetails {
  token_info: {
    expires_at: string;
    redeemed_at: string | null;
    is_expired: boolean;
    is_redeemed: boolean;
  };
  booking: {
    id: string;
    booking_code: string;
    status: string;
    total_price: number;
    deposit_amount: number;
    remaining_amount: number;
    wallet_charged_at_checkin: number;
    travelers_count: number;
    count_adultos: number;
    count_ninos: number;
    count_infantes: number;
    count_adultos_mayores: number;
    count_mascotas: number;
    checkin_status: string | null;
    checkin_at: string | null;
    selected_seats: number[];
    tour: { id: string; name: string; destination: string; start_date: string; end_date: string };
    traveler: { id: string; first_name: string; last_name: string; email: string; phone_number?: string };
    agency: { id: string; name: string; contact_email: string; contact_phone?: string };
  };
  travelers: Traveler[];
  viewer_role: 'agency' | 'admin' | 'traveler';
  can_checkin: boolean;
  traveler_wallet_balance: number;
  service_charge_pct: number;
  membership_exemption_available: number;
}

type WalletStep = 'idle' | 'input' | 'otp' | 'success';

interface WalletChargeState {
  step: WalletStep;
  amount: string;
  otpCode: string;
  // From request response
  serviceCharge: number;
  exemptionApplied: number;
  netServiceCharge: number;
  totalToDeduct: number;
  expiresAt: string | null;
  // From confirm response
  newRemainingAmount: number;
  newWalletBalance: number;
  pointsEarned: number;
  loading: boolean;
  error: string | null;
  resendCooldown: number;
}

const categoriaLabel: Record<string, string> = {
  adulto: 'Adulto',
  nino: 'Niño',
  infante: 'Infante',
  adulto_mayor: 'Adulto Mayor',
  mascota: 'Mascota',
};

const formatDate = (dateString: string) =>
  new Date(dateString).toLocaleDateString('es-MX', { year: 'numeric', month: 'long', day: 'numeric' });

const formatDateTime = (dateString: string) =>
  new Date(dateString).toLocaleString('es-MX', {
    year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit',
  });

const formatCurrency = (amount: number) => formatCurrencyMXN(amount);

const INITIAL_WALLET_STATE: WalletChargeState = {
  step: 'idle',
  amount: '',
  otpCode: '',
  serviceCharge: 0,
  exemptionApplied: 0,
  netServiceCharge: 0,
  totalToDeduct: 0,
  expiresAt: null,
  newRemainingAmount: 0,
  newWalletBalance: 0,
  pointsEarned: 0,
  loading: false,
  error: null,
  resendCooldown: 0,
};

export default function BookingCheckinPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { user, isLoading: authLoading, isAgencyStaff, staffInfo } = useAuth();
  const token = searchParams.get('token');

  const [details, setDetails] = useState<CheckinDetails | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [showPartialModal, setShowPartialModal] = useState(false);
  const [selectedNoShow, setSelectedNoShow] = useState<Set<string>>(new Set());
  const [confirming, setConfirming] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [confirmResult, setConfirmResult] = useState<{ type: string; no_show_travelers: string[] } | null>(null);

  const [wallet, setWallet] = useState<WalletChargeState>(INITIAL_WALLET_STATE);

  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
  const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

  // Countdown timer for resend cooldown
  useEffect(() => {
    if (wallet.resendCooldown <= 0) return;
    const timer = setTimeout(() => setWallet(w => ({ ...w, resendCooldown: w.resendCooldown - 1 })), 1000);
    return () => clearTimeout(timer);
  }, [wallet.resendCooldown]);

  const fetchDetails = async () => {
    if (!token || !user) return;
    setLoading(true);
    setError(null);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { setError('No autenticado'); return; }
      const res = await fetch(
        `${supabaseUrl}/functions/v1/get-booking-checkin-details?token=${encodeURIComponent(token)}`,
        {
          headers: {
            Authorization: `Bearer ${session.access_token}`,
            'Content-Type': 'application/json',
            Apikey: supabaseAnonKey,
          },
        }
      );
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'Error al cargar los detalles del check-in');
      } else {
        setDetails(data);
      }
    } catch {
      setError('Error de conexión. Por favor intenta de nuevo.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!authLoading && user) fetchDetails();
  }, [authLoading, user, token]);

  const handleConfirmFull = async () => { await performCheckin('full', []); };

  const handleConfirmPartial = async () => {
    if (selectedNoShow.size === 0) return;
    await performCheckin('partial', Array.from(selectedNoShow));
    setShowPartialModal(false);
  };

  const performCheckin = async (type: 'full' | 'partial', noShowIds: string[]) => {
    setConfirming(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;
      const res = await fetch(`${supabaseUrl}/functions/v1/confirm-booking-checkin`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          'Content-Type': 'application/json',
          Apikey: supabaseAnonKey,
        },
        body: JSON.stringify({
          token,
          checkin_type: type,
          no_show_traveler_ids: noShowIds,
          ...(isAgencyStaff && staffInfo ? { scanned_by_staff_id: staffInfo.staffId } : {}),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'Error al confirmar el check-in');
      } else {
        setConfirmed(true);
        setConfirmResult({ type, no_show_travelers: data.no_show_travelers || [] });
        fetchDetails();
      }
    } catch {
      setError('Error de conexión al confirmar el check-in.');
    } finally {
      setConfirming(false);
    }
  };

  // --- WALLET CHARGE ---

  const walletAmountNum = parseFloat(wallet.amount) || 0;

  // Real-time preview: recalculate based on current details
  const previewServiceCharge = details
    ? parseFloat((walletAmountNum * details.service_charge_pct / 100).toFixed(2))
    : 0;
  const previewExemption = details
    ? Math.min(details.membership_exemption_available, previewServiceCharge)
    : 0;
  const previewNetServiceCharge = parseFloat((previewServiceCharge - previewExemption).toFixed(2));
  const previewTotal = parseFloat((walletAmountNum + previewNetServiceCharge).toFixed(2));
  const walletInsufficient = details
    ? previewTotal > details.traveler_wallet_balance
    : false;
  const amountExceedsRemaining = details
    ? walletAmountNum > details.booking.remaining_amount
    : false;
  const amountValid = walletAmountNum > 0 && !walletInsufficient && !amountExceedsRemaining;

  const handleRequestWalletCharge = async () => {
    if (!details || !amountValid) return;
    setWallet(w => ({ ...w, loading: true, error: null }));
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;
      const res = await fetch(`${supabaseUrl}/functions/v1/request-checkin-wallet-charge`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          'Content-Type': 'application/json',
          Apikey: supabaseAnonKey,
        },
        body: JSON.stringify({
          booking_id: details.booking.id,
          amount: walletAmountNum,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setWallet(w => ({ ...w, loading: false, error: data.error || 'Error al solicitar el cobro' }));
      } else {
        setWallet(w => ({
          ...w,
          loading: false,
          step: 'otp',
          otpCode: '',
          serviceCharge: data.service_charge,
          exemptionApplied: data.exemption_applied,
          netServiceCharge: data.net_service_charge,
          totalToDeduct: data.total_to_deduct,
          expiresAt: data.expires_at,
          resendCooldown: 60,
          error: null,
        }));
      }
    } catch {
      setWallet(w => ({ ...w, loading: false, error: 'Error de conexión.' }));
    }
  };

  const handleConfirmWalletCharge = async () => {
    if (!details || wallet.otpCode.length !== 6) return;
    setWallet(w => ({ ...w, loading: true, error: null }));
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;
      const res = await fetch(`${supabaseUrl}/functions/v1/confirm-checkin-wallet-charge`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          'Content-Type': 'application/json',
          Apikey: supabaseAnonKey,
        },
        body: JSON.stringify({
          booking_id: details.booking.id,
          otp_code: wallet.otpCode,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setWallet(w => ({ ...w, loading: false, error: data.error || 'Código incorrecto o expirado' }));
      } else {
        setWallet(w => ({
          ...w,
          loading: false,
          step: 'success',
          newRemainingAmount: data.new_remaining_amount,
          newWalletBalance: data.new_wallet_balance,
          pointsEarned: data.points_earned ?? 0,
          error: null,
        }));
        fetchDetails();
      }
    } catch {
      setWallet(w => ({ ...w, loading: false, error: 'Error de conexión.' }));
    }
  };

  const handleResendOtp = async () => {
    if (!details || wallet.resendCooldown > 0) return;
    setWallet(w => ({ ...w, loading: true, error: null }));
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;
      const res = await fetch(`${supabaseUrl}/functions/v1/request-checkin-wallet-charge`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          'Content-Type': 'application/json',
          Apikey: supabaseAnonKey,
        },
        body: JSON.stringify({
          booking_id: details.booking.id,
          amount: walletAmountNum,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setWallet(w => ({ ...w, loading: false, error: data.error || 'Error al reenviar código' }));
      } else {
        setWallet(w => ({
          ...w,
          loading: false,
          otpCode: '',
          expiresAt: data.expires_at,
          resendCooldown: 60,
          error: null,
        }));
      }
    } catch {
      setWallet(w => ({ ...w, loading: false, error: 'Error de conexión.' }));
    }
  };

  const resetWallet = () => setWallet(INITIAL_WALLET_STATE);

  // --- RENDER ---

  if (!token) {
    return (
      <div className="flex items-center justify-center px-4 py-20">
        <div className="text-center max-w-md">
          <QrCode className="w-16 h-16 text-gray-300 mx-auto mb-4" />
          <h1 className="text-2xl font-bold text-gray-800 mb-2">Código QR inválido</h1>
          <p className="text-gray-500 mb-6">El enlace de check-in no contiene un token válido.</p>
          <Link to="/" className="btn-primary">Ir al inicio</Link>
        </div>
      </div>
    );
  }

  if (authLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600" />
      </div>
    );
  }

  if (!user) {
    return (
      <div className="flex items-center justify-center px-4 py-16">
        <div className="bg-white rounded-2xl shadow-lg p-8 max-w-md w-full text-center">
          <div className="w-16 h-16 bg-blue-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <QrCode className="w-8 h-8 text-blue-600" />
          </div>
          <h1 className="text-2xl font-bold text-gray-900 mb-2">Check-in de Reserva</h1>
          <p className="text-gray-500 mb-6">
            Escaneo exitoso. Inicia sesión para ver los detalles de tu reserva y confirmar el check-in.
          </p>
          <button
            onClick={() => navigate(`/login?redirect=${encodeURIComponent(window.location.pathname + window.location.search)}`)}
            className="w-full bg-blue-600 text-white py-3 px-6 rounded-xl font-semibold hover:bg-blue-700 transition-colors"
          >
            Iniciar Sesión
          </button>
          <p className="text-sm text-gray-400 mt-4">
            ¿No tienes cuenta?{' '}
            <Link to="/signup" className="text-blue-600 hover:underline">Regístrate aquí</Link>
          </p>
        </div>
      </div>
    );
  }

  const canUseWalletCharge = details &&
    (details.viewer_role === 'agency' || details.viewer_role === 'admin') &&
    details.booking.remaining_amount > 0;

  return (
    <div className="py-10 px-4">
      <div className="max-w-2xl mx-auto">

        {loading && (
          <div className="flex items-center justify-center py-20">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600" />
          </div>
        )}

        {!loading && error && (
          <div className="bg-white rounded-2xl shadow-lg p-8 text-center">
            <XCircle className="w-16 h-16 text-red-400 mx-auto mb-4" />
            <h2 className="text-xl font-bold text-gray-900 mb-2">Error</h2>
            <p className="text-gray-500 mb-6">{error}</p>
            <Link to="/" className="bg-blue-600 text-white py-2 px-6 rounded-xl font-semibold hover:bg-blue-700 transition-colors">
              Ir al inicio
            </Link>
          </div>
        )}

        {!loading && !error && details && (
          <>
            <div className="mb-6">
              <h1 className="text-2xl font-bold text-gray-900">Check-in de Reserva</h1>
              <p className="text-gray-500 mt-1">Código: <span className="font-semibold text-gray-700">{details.booking.booking_code}</span></p>
            </div>

            {details.token_info.is_expired && !details.token_info.is_redeemed && (
              <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 flex gap-3 mb-6">
                <Clock className="w-5 h-5 text-amber-500 flex-shrink-0 mt-0.5" />
                <div>
                  <p className="font-semibold text-amber-800">Código expirado</p>
                  <p className="text-amber-700 text-sm">Este código QR ya no es válido. Venció 24 horas después del inicio del tour ({formatDate(details.booking.tour.start_date)}).</p>
                </div>
              </div>
            )}

            {details.token_info.is_redeemed && !confirmed && (
              <div className="bg-green-50 border border-green-200 rounded-xl p-4 flex gap-3 mb-6">
                <CheckCircle className="w-5 h-5 text-green-500 flex-shrink-0 mt-0.5" />
                <div>
                  <p className="font-semibold text-green-800">Check-in ya registrado</p>
                  <p className="text-green-700 text-sm">
                    El check-in fue confirmado el {formatDateTime(details.token_info.redeemed_at!)}.
                    {details.booking.checkin_status === 'partial' && ' (Check-in parcial)'}
                  </p>
                </div>
              </div>
            )}

            {confirmed && confirmResult && (
              <div className={`rounded-xl p-5 mb-6 border ${confirmResult.type === 'full' ? 'bg-green-50 border-green-200' : 'bg-amber-50 border-amber-200'}`}>
                <div className="flex gap-3 items-start">
                  <CheckCircle className={`w-6 h-6 flex-shrink-0 mt-0.5 ${confirmResult.type === 'full' ? 'text-green-500' : 'text-amber-500'}`} />
                  <div>
                    <p className={`font-semibold text-lg ${confirmResult.type === 'full' ? 'text-green-800' : 'text-amber-800'}`}>
                      {confirmResult.type === 'full' ? 'Check-in Completo Confirmado' : 'Check-in Parcial Confirmado'}
                    </p>
                    <p className={`text-sm mt-1 ${confirmResult.type === 'full' ? 'text-green-700' : 'text-amber-700'}`}>
                      Se ha enviado un correo de confirmación al viajero.
                    </p>
                    {confirmResult.no_show_travelers.length > 0 && (
                      <div className="mt-2">
                        <p className="text-amber-700 text-sm font-medium">Marcados como No Show:</p>
                        <ul className="mt-1 text-sm text-amber-700 list-disc list-inside">
                          {confirmResult.no_show_travelers.map((name, i) => <li key={i}>{name}</li>)}
                        </ul>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* Tour Info */}
            <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden mb-5">
              <div className="bg-gradient-to-r from-blue-600 to-blue-700 px-6 py-4">
                <h2 className="text-white font-semibold text-lg">{details.booking.tour.name}</h2>
                <div className="flex items-center gap-1 text-blue-100 text-sm mt-1">
                  <MapPin className="w-3.5 h-3.5" />
                  <span>{details.booking.tour.destination}</span>
                </div>
              </div>
              <div className="p-5 grid grid-cols-2 gap-4 text-sm">
                <div className="flex items-start gap-2">
                  <Calendar className="w-4 h-4 text-gray-400 mt-0.5" />
                  <div>
                    <p className="text-gray-500">Inicio</p>
                    <p className="font-semibold text-gray-800">{formatDate(details.booking.tour.start_date)}</p>
                  </div>
                </div>
                <div className="flex items-start gap-2">
                  <Calendar className="w-4 h-4 text-gray-400 mt-0.5" />
                  <div>
                    <p className="text-gray-500">Fin</p>
                    <p className="font-semibold text-gray-800">{formatDate(details.booking.tour.end_date)}</p>
                  </div>
                </div>
                <div className="flex items-start gap-2">
                  <Users className="w-4 h-4 text-gray-400 mt-0.5" />
                  <div>
                    <p className="text-gray-500">Viajeros</p>
                    <p className="font-semibold text-gray-800">{details.booking.travelers_count}</p>
                  </div>
                </div>
                <div className="flex items-start gap-2">
                  <DollarSign className="w-4 h-4 text-gray-400 mt-0.5" />
                  <div>
                    <p className="text-gray-500">Saldo pendiente</p>
                    <p className={`font-semibold ${details.booking.remaining_amount > 0 ? 'text-red-600' : 'text-green-600'}`}>
                      {formatCurrency(details.booking.remaining_amount)}
                    </p>
                  </div>
                </div>
              </div>
              {details.booking.wallet_charged_at_checkin > 0 && (
                <div className="px-5 pb-4">
                  <div className="flex items-center gap-2 text-xs text-blue-700 bg-blue-50 rounded-lg px-3 py-2">
                    <Wallet className="w-3.5 h-3.5 flex-shrink-0" />
                    <span>Se han cobrado {formatCurrency(details.booking.wallet_charged_at_checkin)} con ToursRed Cash en este check-in.</span>
                  </div>
                </div>
              )}
            </div>

            {/* Viajero Principal */}
            <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5 mb-5">
              <h3 className="font-semibold text-gray-800 mb-3 flex items-center gap-2">
                <Users className="w-4 h-4 text-blue-600" />
                Viajero Principal
              </h3>
              <p className="text-gray-800 font-medium">{details.booking.traveler.first_name} {details.booking.traveler.last_name}</p>
              <p className="text-gray-500 text-sm">{details.booking.traveler.email}</p>
              {details.booking.traveler.phone_number && (
                <p className="text-gray-500 text-sm">{details.booking.traveler.phone_number}</p>
              )}
            </div>

            {/* Lista de viajeros */}
            {details.travelers.length > 0 && (
              <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5 mb-5">
                <h3 className="font-semibold text-gray-800 mb-3 flex items-center gap-2">
                  <Users className="w-4 h-4 text-blue-600" />
                  Lista de Viajeros ({details.travelers.length})
                </h3>
                <div className="space-y-2">
                  {details.travelers.map((t) => (
                    <div key={t.id} className={`flex items-center justify-between p-3 rounded-lg ${t.is_no_show ? 'bg-red-50 border border-red-100' : 'bg-gray-50'}`}>
                      <div>
                        <p className={`font-medium text-sm ${t.is_no_show ? 'text-red-600 line-through' : 'text-gray-800'}`}>{t.nombre}</p>
                        <p className="text-gray-400 text-xs">{categoriaLabel[t.categoria_viajero] || t.categoria_viajero}</p>
                      </div>
                      {t.is_no_show && (
                        <span className="text-xs bg-red-100 text-red-600 font-semibold px-2 py-0.5 rounded-full">No Show</span>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Asientos */}
            {details.booking.selected_seats && details.booking.selected_seats.length > 0 && (
              <div className="bg-white rounded-2xl shadow-sm border border-blue-100 p-5 mb-5">
                <h3 className="font-semibold text-gray-800 mb-3 flex items-center gap-2">
                  <Bus className="w-4 h-4 text-blue-600" />
                  Asientos Asignados
                </h3>
                <p className="text-xs text-gray-500 mb-3">Verifica que los viajeros ocupen los siguientes lugares en el vehículo.</p>
                <div className="flex flex-wrap gap-2">
                  {[...details.booking.selected_seats].sort((a, b) => a - b).map((seat) => (
                    <div key={seat} className="w-11 h-11 bg-blue-600 text-white font-bold text-base rounded-xl flex items-center justify-center shadow-sm">
                      {seat}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Confirmar check-in */}
            {details.can_checkin && !confirmed && (
              <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5 mb-5">
                <h3 className="font-semibold text-gray-800 mb-1">Confirmar Asistencia</h3>
                <p className="text-gray-500 text-sm mb-4">Selecciona el tipo de check-in para esta reserva.</p>
                <div className="flex flex-col sm:flex-row gap-3">
                  <button
                    onClick={handleConfirmFull}
                    disabled={confirming}
                    className="flex-1 bg-green-600 hover:bg-green-700 text-white font-semibold py-3 px-4 rounded-xl transition-colors flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <CheckCircle className="w-5 h-5" />
                    {confirming ? 'Confirmando...' : 'Confirmar Check-in Completo'}
                  </button>
                  {details.travelers.length > 1 && (
                    <button
                      onClick={() => setShowPartialModal(true)}
                      disabled={confirming}
                      className="flex-1 bg-amber-500 hover:bg-amber-600 text-white font-semibold py-3 px-4 rounded-xl transition-colors flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      <AlertTriangle className="w-5 h-5" />
                      Check-in Parcial
                    </button>
                  )}
                </div>
              </div>
            )}

            {/* Cobro con ToursRed Cash */}
            {canUseWalletCharge && (
              <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden mb-5">
                <div className="bg-gradient-to-r from-gray-800 to-gray-900 px-5 py-4 flex items-center gap-3">
                  <Wallet className="w-5 h-5 text-white" />
                  <div>
                    <h3 className="text-white font-semibold">Cobrar con ToursRed Cash</h3>
                    <p className="text-gray-300 text-xs mt-0.5">Opcional — también puedes cobrar en efectivo, transferencia o terminal propia.</p>
                  </div>
                </div>

                <div className="p-5">
                  {/* Saldo info */}
                  <div className="grid grid-cols-2 gap-3 mb-5">
                    <div className="bg-gray-50 rounded-xl p-3 text-center">
                      <p className="text-xs text-gray-500 mb-1">Saldo pendiente</p>
                      <p className="font-bold text-red-600 text-lg">{formatCurrency(details.booking.remaining_amount)}</p>
                    </div>
                    <div className="bg-blue-50 rounded-xl p-3 text-center">
                      <p className="text-xs text-gray-500 mb-1">Wallet del viajero</p>
                      <p className={`font-bold text-lg ${details.traveler_wallet_balance > 0 ? 'text-blue-700' : 'text-gray-400'}`}>
                        {formatCurrency(details.traveler_wallet_balance)}
                      </p>
                    </div>
                  </div>

                  {wallet.step === 'idle' && (
                    <button
                      onClick={() => setWallet(w => ({ ...w, step: 'input' }))}
                      disabled={details.traveler_wallet_balance <= 0}
                      className="w-full border-2 border-dashed border-gray-300 hover:border-blue-400 hover:bg-blue-50 text-gray-600 hover:text-blue-700 font-medium py-3 rounded-xl transition-colors flex items-center justify-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:border-gray-300 disabled:hover:bg-transparent disabled:hover:text-gray-600"
                    >
                      <Wallet className="w-4 h-4" />
                      {details.traveler_wallet_balance <= 0 ? 'El viajero no tiene saldo disponible' : 'Cobrar con ToursRed Cash'}
                    </button>
                  )}

                  {wallet.step === 'input' && (
                    <div className="space-y-4">
                      {/* Monto a cobrar */}
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1.5">Monto a cobrar (MXN)</label>
                        <div className="flex gap-2">
                          <div className="relative flex-1">
                            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 font-medium">$</span>
                            <input
                              type="number"
                              min="1"
                              max={details.booking.remaining_amount}
                              step="0.01"
                              value={wallet.amount}
                              onChange={e => setWallet(w => ({ ...w, amount: e.target.value, error: null }))}
                              placeholder="0.00"
                              className="w-full pl-7 pr-4 py-2.5 border border-gray-300 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-transparent text-gray-800 text-base"
                            />
                          </div>
                          <button
                            onClick={() => setWallet(w => ({ ...w, amount: details.booking.remaining_amount.toFixed(2) }))}
                            className="px-3 py-2.5 bg-gray-100 hover:bg-gray-200 text-gray-600 text-sm font-medium rounded-xl transition-colors whitespace-nowrap"
                          >
                            Cobrar todo
                          </button>
                        </div>
                        {amountExceedsRemaining && walletAmountNum > 0 && (
                          <p className="text-red-500 text-xs mt-1 flex items-center gap-1">
                            <AlertTriangle className="w-3.5 h-3.5" />
                            El monto excede el saldo pendiente ({formatCurrency(details.booking.remaining_amount)})
                          </p>
                        )}
                      </div>

                      {/* Resumen en tiempo real */}
                      {walletAmountNum > 0 && !amountExceedsRemaining && (
                        <div className="bg-gray-50 rounded-xl p-4 space-y-2 text-sm">
                          <div className="flex justify-between text-gray-700">
                            <span>Monto del tour</span>
                            <span className="font-medium">{formatCurrency(walletAmountNum)}</span>
                          </div>
                          <div className="flex justify-between text-gray-500">
                            <span>Cargo por servicio ({details.service_charge_pct}%)</span>
                            <span>{formatCurrency(previewServiceCharge)}</span>
                          </div>
                          {previewExemption > 0 && (
                            <div className="flex justify-between text-green-600">
                              <span className="flex items-center gap-1">
                                <ShieldCheck className="w-3.5 h-3.5" />
                                Descuento membresía ToursRed+
                              </span>
                              <span>-{formatCurrency(previewExemption)}</span>
                            </div>
                          )}
                          <div className="border-t border-gray-200 pt-2 flex justify-between font-semibold text-gray-900">
                            <span>Total a descontar del wallet</span>
                            <span className={walletInsufficient ? 'text-red-600' : 'text-gray-900'}>
                              {formatCurrency(previewTotal)}
                            </span>
                          </div>
                          {walletInsufficient && (
                            <div className="flex items-start gap-2 bg-red-50 rounded-lg px-3 py-2 text-red-600 text-xs">
                              <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
                              <span>Saldo insuficiente. El viajero tiene {formatCurrency(details.traveler_wallet_balance)} disponibles.</span>
                            </div>
                          )}
                          {!walletInsufficient && details.membership_exemption_available > 0 && previewExemption > 0 && (
                            <div className="flex items-start gap-2 bg-green-50 rounded-lg px-3 py-2 text-green-700 text-xs">
                              <Info className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
                              <span>Se aplicarán {formatCurrency(previewExemption)} del beneficio mensual de membresía ({formatCurrency(details.membership_exemption_available)} disponibles).</span>
                            </div>
                          )}
                        </div>
                      )}

                      {wallet.error && (
                        <div className="flex items-start gap-2 bg-red-50 rounded-xl px-4 py-3 text-red-700 text-sm">
                          <XCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                          <span>{wallet.error}</span>
                        </div>
                      )}

                      <div className="flex gap-3">
                        <button
                          onClick={resetWallet}
                          className="flex-1 border border-gray-200 text-gray-600 font-medium py-2.5 rounded-xl hover:bg-gray-50 transition-colors"
                        >
                          Cancelar
                        </button>
                        <button
                          onClick={handleRequestWalletCharge}
                          disabled={!amountValid || wallet.loading}
                          className="flex-1 bg-gray-800 hover:bg-gray-900 text-white font-semibold py-2.5 rounded-xl transition-colors flex items-center justify-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed"
                        >
                          {wallet.loading ? (
                            <><div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />Enviando...</>
                          ) : (
                            <><KeyRound className="w-4 h-4" />Solicitar código</>
                          )}
                        </button>
                      </div>
                    </div>
                  )}

                  {wallet.step === 'otp' && (
                    <div className="space-y-4">
                      {/* Resumen del cobro */}
                      <div className="bg-gray-50 rounded-xl p-4 space-y-2 text-sm">
                        <div className="flex justify-between text-gray-700">
                          <span>Monto del tour</span>
                          <span className="font-medium">{formatCurrency(walletAmountNum)}</span>
                        </div>
                        <div className="flex justify-between text-gray-500">
                          <span>Cargo por servicio ({details.service_charge_pct}%)</span>
                          <span>{formatCurrency(wallet.serviceCharge)}</span>
                        </div>
                        {wallet.exemptionApplied > 0 && (
                          <div className="flex justify-between text-green-600">
                            <span className="flex items-center gap-1">
                              <ShieldCheck className="w-3.5 h-3.5" />
                              Descuento membresía ToursRed+
                            </span>
                            <span>-{formatCurrency(wallet.exemptionApplied)}</span>
                          </div>
                        )}
                        <div className="border-t border-gray-200 pt-2 flex justify-between font-bold text-gray-900">
                          <span>Total a descontar del wallet</span>
                          <span>{formatCurrency(wallet.totalToDeduct)}</span>
                        </div>
                      </div>

                      {/* OTP input */}
                      <div className="text-center">
                        <div className="w-12 h-12 bg-blue-100 rounded-full flex items-center justify-center mx-auto mb-3">
                          <KeyRound className="w-6 h-6 text-blue-600" />
                        </div>
                        <p className="font-semibold text-gray-800 text-sm mb-1">Código enviado al viajero</p>
                        <p className="text-gray-500 text-xs mb-4">
                          Se envió un código de 6 dígitos al correo <strong>{details.booking.traveler.email}</strong>. Pídelo al viajero para autorizar el cobro.
                        </p>
                        <input
                          type="text"
                          maxLength={6}
                          value={wallet.otpCode}
                          onChange={e => setWallet(w => ({ ...w, otpCode: e.target.value.replace(/\D/g, ''), error: null }))}
                          placeholder="000000"
                          className="w-40 text-center text-3xl font-bold tracking-widest border-2 border-gray-300 focus:border-blue-500 focus:ring-2 focus:ring-blue-200 rounded-xl py-3 px-4 text-gray-800 mx-auto block"
                        />
                      </div>

                      {wallet.error && (
                        <div className="flex items-start gap-2 bg-red-50 rounded-xl px-4 py-3 text-red-700 text-sm">
                          <XCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                          <span>{wallet.error}</span>
                        </div>
                      )}

                      <div className="flex gap-3">
                        <button
                          onClick={resetWallet}
                          className="flex-1 border border-gray-200 text-gray-600 font-medium py-2.5 rounded-xl hover:bg-gray-50 transition-colors"
                        >
                          Cancelar
                        </button>
                        <button
                          onClick={handleConfirmWalletCharge}
                          disabled={wallet.otpCode.length !== 6 || wallet.loading}
                          className="flex-1 bg-gray-800 hover:bg-gray-900 text-white font-semibold py-2.5 rounded-xl transition-colors flex items-center justify-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed"
                        >
                          {wallet.loading ? (
                            <><div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />Verificando...</>
                          ) : (
                            <><CheckCircle className="w-4 h-4" />Confirmar cobro</>
                          )}
                        </button>
                      </div>

                      <div className="text-center">
                        <button
                          onClick={handleResendOtp}
                          disabled={wallet.resendCooldown > 0 || wallet.loading}
                          className="text-sm text-gray-500 hover:text-blue-600 disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1.5 mx-auto transition-colors"
                        >
                          <RefreshCw className="w-3.5 h-3.5" />
                          {wallet.resendCooldown > 0
                            ? `Reenviar código en ${wallet.resendCooldown}s`
                            : 'Reenviar código'}
                        </button>
                      </div>
                    </div>
                  )}

                  {wallet.step === 'success' && (
                    <div className="text-center">
                      <div className="w-14 h-14 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-3">
                        <CheckCircle className="w-8 h-8 text-green-600" />
                      </div>
                      <p className="font-bold text-gray-900 text-lg mb-1">Cobro realizado</p>
                      <p className="text-gray-500 text-sm mb-4">
                        Se descontaron <strong>{formatCurrency(wallet.totalToDeduct)}</strong> del monedero del viajero.
                      </p>
                      <div className="bg-gray-50 rounded-xl p-4 text-sm text-left space-y-2 mb-4">
                        <div className="flex justify-between text-gray-700">
                          <span>Cobrado con ToursRed Cash</span>
                          <span className="font-medium">{formatCurrency(walletAmountNum)}</span>
                        </div>
                        <div className="flex justify-between text-gray-500">
                          <span>Cargo por servicio</span>
                          <span>{formatCurrency(wallet.netServiceCharge)}</span>
                        </div>
                        {wallet.exemptionApplied > 0 && (
                          <div className="flex justify-between text-green-600">
                            <span>Descuento membresía</span>
                            <span>-{formatCurrency(wallet.exemptionApplied)}</span>
                          </div>
                        )}
                        <div className="border-t border-gray-200 pt-2 flex justify-between font-semibold text-gray-700">
                          <span>Saldo pendiente restante</span>
                          <span className={wallet.newRemainingAmount > 0 ? 'text-amber-600' : 'text-green-600'}>
                            {formatCurrency(wallet.newRemainingAmount)}
                          </span>
                        </div>
                      </div>
                      {wallet.pointsEarned > 0 && (
                        <div className="flex items-center gap-2 bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 mb-4">
                          <div className="w-7 h-7 bg-amber-400 rounded-full flex items-center justify-center flex-shrink-0">
                            <span className="text-white font-bold text-xs">P</span>
                          </div>
                          <p className="text-amber-800 text-sm">
                            Se acreditaron <strong>{wallet.pointsEarned.toLocaleString()} puntos ToursRed</strong> al viajero por este pago.
                          </p>
                        </div>
                      )}
                      {details.booking.remaining_amount > 0 && (
                        <button
                          onClick={() => setWallet(w => ({ ...w, step: 'input', amount: '', otpCode: '', error: null }))}
                          className="text-sm text-blue-600 hover:underline"
                        >
                          Cobrar otro monto con wallet
                        </button>
                      )}
                    </div>
                  )}
                </div>
              </div>
            )}

            {details.viewer_role === 'traveler' && !details.token_info.is_redeemed && (
              <div className="bg-blue-50 border border-blue-100 rounded-xl p-4 text-center text-sm text-blue-700">
                Presenta el código QR de tu correo de confirmación a la agencia el día del tour.
              </div>
            )}
          </>
        )}
      </div>

      {/* Modal check-in parcial */}
      {showPartialModal && details && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-xl max-w-md w-full max-h-[90vh] overflow-y-auto">
            <div className="p-6 border-b border-gray-100">
              <h3 className="text-lg font-bold text-gray-900">Check-in Parcial</h3>
              <p className="text-gray-500 text-sm mt-1">Selecciona los viajeros que <strong>NO</strong> se presentaron.</p>
            </div>
            <div className="p-6 space-y-2">
              {details.travelers.map((t) => (
                <label key={t.id} className={`flex items-center gap-3 p-3 rounded-xl cursor-pointer border transition-colors ${selectedNoShow.has(t.id) ? 'bg-red-50 border-red-200' : 'bg-gray-50 border-transparent hover:border-gray-200'}`}>
                  <input
                    type="checkbox"
                    checked={selectedNoShow.has(t.id)}
                    onChange={() => {
                      setSelectedNoShow(prev => {
                        const next = new Set(prev);
                        if (next.has(t.id)) next.delete(t.id);
                        else next.add(t.id);
                        return next;
                      });
                    }}
                    className="w-4 h-4 text-red-500 rounded"
                  />
                  <div>
                    <p className="font-medium text-sm text-gray-800">{t.nombre}</p>
                    <p className="text-xs text-gray-400">{categoriaLabel[t.categoria_viajero] || t.categoria_viajero}</p>
                  </div>
                </label>
              ))}
            </div>
            <div className="p-6 border-t border-gray-100 flex gap-3">
              <button
                onClick={() => { setShowPartialModal(false); setSelectedNoShow(new Set()); }}
                className="flex-1 border border-gray-200 text-gray-700 font-semibold py-2.5 rounded-xl hover:bg-gray-50 transition-colors"
              >
                Cancelar
              </button>
              <button
                onClick={handleConfirmPartial}
                disabled={selectedNoShow.size === 0 || confirming}
                className="flex-1 bg-amber-500 hover:bg-amber-600 text-white font-semibold py-2.5 rounded-xl transition-colors flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <ChevronRight className="w-4 h-4" />
                {confirming ? 'Confirmando...' : `Confirmar (${selectedNoShow.size} No Show)`}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
