import React, { useState, useEffect, useRef } from 'react';
import {
  X, Plus, Building2, QrCode, Copy, Check, AlertCircle, Loader2,
  Clock, ArrowLeft, RefreshCw, CheckCircle2, XCircle,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { formatCurrencyMXN } from '../utils/formatCurrency';
import { supabase } from '../lib/supabase';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';

type TopupStep = 'select-method' | 'select-amount' | 'processing' | 'spei-instructions' | 'codi-qr' | 'error' | 'success';
type PaymentMethod = 'spei' | 'codi';

interface OpenPayTopupModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

const SUGGESTED_AMOUNTS = [500, 1000, 2000, 5000];
const MIN_AMOUNT = 500;
const MAX_AMOUNT = 50000;

const OpenPayTopupModal: React.FC<OpenPayTopupModalProps> = ({ isOpen, onClose, onSuccess }) => {
  const { user } = useAuth();
  const [step, setStep] = useState<TopupStep>('select-amount');
  const [method, setMethod] = useState<PaymentMethod>('spei');
  const [amount, setAmount] = useState<number>(1000);
  const [customAmount, setCustomAmount] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  const [topupData, setTopupData] = useState<any>(null);
  const [copiedField, setCopiedField] = useState<string | null>(null);

  const resetState = () => {
    setStep('select-amount');
    setMethod('spei');
    setAmount(1000);
    setCustomAmount('');
    setError(null);
    setTopupData(null);
    setCopiedField(null);
  };

  const handleClose = () => {
    resetState();
    onClose();
  };

  const handleMethodSelect = (m: PaymentMethod) => {
    setMethod(m);
    setStep('select-amount');
  };

  const getEffectiveAmount = (): number | null => {
    if (customAmount) {
      const parsed = parseFloat(customAmount);
      if (isNaN(parsed) || parsed <= 0) return null;
      return parsed;
    }
    return amount;
  };

  const validateAmount = (val: number): string | null => {
    if (val < MIN_AMOUNT) return `El monto minimo es $${MIN_AMOUNT} MXN`;
    if (val > MAX_AMOUNT) return `El monto maximo es $${MAX_AMOUNT.toLocaleString()} MXN`;
    if (val % 100 !== 0) return 'El monto debe ser multiplo de $100 MXN';
    const decimals = (val.toString().split('.')[1] || '').length;
    if (decimals > 2) return 'El monto no puede tener mas de dos decimales';
    return null;
  };

  const handleCreateTopup = async () => {
    const effectiveAmount = getEffectiveAmount();
    if (!effectiveAmount) {
      setError('Ingresa un monto valido');
      setStep('error');
      return;
    }

    const validationError = validateAmount(effectiveAmount);
    if (validationError) {
      setError(validationError);
      setStep('error');
      return;
    }

    setStep('processing');
    setError(null);

    try {
      const session = await supabase.auth.getSession();
      const token = session.data.session?.access_token;

      if (!token) {
        setError('Sesion no valida. Inicia sesion nuevamente.');
        setStep('error');
        return;
      }

      const response = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/create-openpay-topup`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            amount: effectiveAmount,
            payment_method_type: method,
          }),
        }
      );

      const data = await response.json();

      if (!response.ok) {
        setError(data.error || 'Error al crear la recarga');
        setStep('error');
        return;
      }

      setTopupData(data);
      setStep(method === 'spei' ? 'spei-instructions' : 'codi-qr');
    } catch (err: any) {
      setError(err.message || 'Error de conexion. Intenta nuevamente.');
      setStep('error');
    }
  };

  const handleCopy = async (text: string, field: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedField(field);
      setTimeout(() => setCopiedField(null), 2000);
    } catch {
      // Fallback
    }
  };

  const checkStatus = async (silent: boolean) => {
    if (!topupData?.topup_id) return;

    try {
      const session = await supabase.auth.getSession();
      const token = session.data.session?.access_token;

      const response = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/check-openpay-topup-status`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ topup_id: topupData.topup_id }),
        }
      );

      const data = await response.json();

      if (data.status === 'completed') {
        setStep('success');
        setTimeout(() => {
          onSuccess();
          handleClose();
        }, 3000);
      } else if (!silent) {
        setError('Tu pago aun no ha sido confirmado. Intenta nuevamente en unos momentos.');
        setTimeout(() => setError(null), 3000);
      }
    } catch {
      if (!silent) {
        setError('No se pudo verificar el estado. Intenta nuevamente.');
        setTimeout(() => setError(null), 3000);
      }
    }
  };

  const handleCheckStatus = () => checkStatus(false);

  const isWaitingForPayment = step === 'spei-instructions' || step === 'codi-qr';
  const topupIdRef = useRef(topupData?.topup_id);
  topupIdRef.current = topupData?.topup_id;

  useEffect(() => {
    if (!isOpen || !isWaitingForPayment || !topupData?.topup_id) return;

    const interval = setInterval(() => {
      if (topupIdRef.current) checkStatus(true);
    }, 6000);

    return () => clearInterval(interval);
  }, [isOpen, isWaitingForPayment, topupData?.topup_id]);

  const effectiveAmount = getEffectiveAmount();
  const validationError = effectiveAmount ? validateAmount(effectiveAmount) : null;

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50 overflow-y-auto">
      <div className="bg-white rounded-2xl shadow-xl max-w-lg w-full my-8">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-gray-200">
          <h3 className="text-xl font-bold text-gray-900">Agregar Saldo</h3>
          <button
            onClick={handleClose}
            className="text-gray-400 hover:text-gray-600 transition-colors rounded-full p-1 hover:bg-gray-100"
          >
            <X className="h-6 w-6" />
          </button>
        </div>

        <div className="p-6">
          {/* Step: Select Amount */}
          {step === 'select-amount' && (
            <div>
              <div className="flex items-center gap-2 mb-6">
                <Building2 className="h-5 w-5 text-accent-600" />
                <span className="font-semibold text-gray-900">Transferencia SPEI</span>
              </div>

              <p className="text-gray-600 mb-4">Elige o captura el monto a recargar:</p>

              <div className="grid grid-cols-2 gap-3 mb-4">
                {SUGGESTED_AMOUNTS.map((amt) => (
                  <button
                    key={amt}
                    onClick={() => {
                      setAmount(amt);
                      setCustomAmount('');
                    }}
                    className={`p-4 rounded-xl border-2 font-bold text-lg transition-all ${
                      amount === amt && !customAmount
                        ? 'border-accent-500 bg-accent-50 text-accent-700'
                        : 'border-gray-200 text-gray-700 hover:border-gray-300'
                    }`}
                  >
                    ${amt.toLocaleString()}
                  </button>
                ))}
              </div>

              <div className="mb-4">
                <label className="block text-sm font-semibold text-gray-700 mb-2">
                  O captura otro monto (multiplos de $100)
                </label>
                <div className="relative">
                  <span className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-500 font-semibold">$</span>
                  <input
                    type="number"
                    value={customAmount}
                    onChange={(e) => setCustomAmount(e.target.value)}
                    placeholder="0"
                    min={MIN_AMOUNT}
                    max={MAX_AMOUNT}
                    step={100}
                    className="w-full pl-8 pr-4 py-3 text-lg font-semibold border-2 border-gray-300 rounded-xl focus:ring-2 focus:ring-accent-500 focus:border-transparent"
                  />
                </div>
              </div>

              {validationError && (
                <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg flex items-start gap-2">
                  <AlertCircle className="h-5 w-5 text-red-600 flex-shrink-0 mt-0.5" />
                  <p className="text-sm text-red-800">{validationError}</p>
                </div>
              )}

              <div className="p-3 bg-gray-50 rounded-lg mb-4">
                <p className="text-xs text-gray-600">
                  Minimo: ${MIN_AMOUNT} MXN - Maximo: ${MAX_AMOUNT.toLocaleString()} MXN - Multiplos de $100
                </p>
              </div>

              <button
                onClick={handleCreateTopup}
                disabled={!!validationError || !effectiveAmount}
                className="w-full px-6 py-3 bg-accent-600 text-white rounded-xl font-bold hover:bg-accent-700 transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
              >
                <Plus className="h-5 w-5" />
                {effectiveAmount ? `Recargar ${formatCurrencyMXN(effectiveAmount)}` : 'Recargar'}
              </button>
            </div>
          )}

          {/* Step: Processing */}
          {step === 'processing' && (
            <div className="text-center py-12">
              <Loader2 className="h-12 w-12 text-accent-600 mx-auto mb-4 animate-spin" />
              <p className="text-gray-600 font-medium">Generando tu recarga...</p>
              <p className="text-sm text-gray-500 mt-2">Conectando con OpenPay</p>
            </div>
          )}

          {/* Step: SPEI Instructions */}
          {step === 'spei-instructions' && topupData && (
            <div>
              <div className="flex items-center gap-2 mb-4">
                <Building2 className="h-6 w-6 text-accent-600" />
                <h4 className="font-bold text-gray-900 text-lg">Instrucciones de Transferencia</h4>
              </div>

              <div className="p-4 bg-accent-50 border border-accent-200 rounded-xl mb-4">
                <p className="text-sm font-semibold text-accent-900 mb-1">
                  Transfiere exactamente el monto indicado
                </p>
                <p className="text-xs text-accent-700">
                  Tu saldo se acreditará automáticamente cuando OpenPay confirme la transferencia.
                </p>
              </div>

              <div className="flex flex-col gap-y-3 mb-6">
                <SpeiField
                  label="Monto a transferir"
                  value={formatCurrencyMXN(topupData.amount)}
                  onCopy={() => handleCopy(topupData.amount.toString(), 'amount')}
                  copied={copiedField === 'amount'}
                />
                {topupData.payment_method?.clabe && (
                  <SpeiField
                    label="CLABE interbancaria"
                    value={topupData.payment_method.clabe}
                    onCopy={() => handleCopy(topupData.payment_method.clabe, 'clabe')}
                    copied={copiedField === 'clabe'}
                    mono
                  />
                )}
                {topupData.payment_method?.bank && (
                  <SpeiField
                    label="Banco"
                    value={topupData.payment_method.bank}
                    onCopy={() => handleCopy(topupData.payment_method.bank, 'bank')}
                    copied={copiedField === 'bank'}
                  />
                )}
                {topupData.payment_method?.name && (
                  <SpeiField
                    label="Referencia"
                    value={topupData.payment_method.name}
                    onCopy={() => handleCopy(topupData.payment_method.name, 'reference')}
                    copied={copiedField === 'reference'}
                    mono
                  />
                )}
                {topupData.payment_method?.agreement && (
                  <SpeiField
                    label="Convenio"
                    value={topupData.payment_method.agreement}
                    onCopy={() => handleCopy(topupData.payment_method.agreement, 'agreement')}
                    copied={copiedField === 'agreement'}
                    mono
                  />
                )}
              </div>

              {topupData.spei_pdf_url && (
                <a
                  href={topupData.spei_pdf_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="block w-full text-center px-4 py-2 bg-gray-100 text-gray-700 rounded-lg font-medium hover:bg-gray-200 transition-colors mb-3 text-sm"
                >
                  Descargar instrucciones SPEI (PDF)
                </a>
              )}

              {error && (
                <div className="mb-3 p-3 bg-amber-50 border border-amber-200 rounded-lg flex items-start gap-2">
                  <AlertCircle className="h-5 w-5 text-amber-600 flex-shrink-0 mt-0.5" />
                  <p className="text-sm text-amber-800">{error}</p>
                </div>
              )}

              <div className="flex gap-3">
                <button
                  onClick={handleCheckStatus}
                  className="flex-1 px-4 py-3 bg-accent-600 text-white rounded-xl font-semibold hover:bg-accent-700 transition-all flex items-center justify-center gap-2"
                >
                  <RefreshCw className="h-4 w-4" />
                  Verificar estado
                </button>
                <button
                  onClick={handleClose}
                  className="flex-1 px-4 py-3 bg-gray-100 text-gray-700 rounded-xl font-semibold hover:bg-gray-200 transition-colors"
                >
                  Cerrar
                </button>
              </div>
            </div>
          )}

          {/* Step: CODI QR */}
          {step === 'codi-qr' && topupData && (
            <div>
              <div className="flex items-center gap-2 mb-4">
                <QrCode className="h-6 w-6 text-blue-600" />
                <h4 className="font-bold text-gray-900 text-lg">Codigo QR de CoDi</h4>
              </div>

              <div className="p-4 bg-blue-50 border border-blue-200 rounded-xl mb-4">
                <p className="text-sm font-semibold text-blue-900 mb-1">
                  Escanea desde tu app bancaria
                </p>
                <p className="text-xs text-blue-700">
                  Abre la app de tu banco, selecciona CoDi y escanea el codigo. El pago es instantaneo.
                </p>
              </div>

              {/* QR Code display */}
              <div className="flex flex-col items-center mb-6">
                {topupData.payment_method?.qr_url || topupData.payment_method?.qr_image ? (
                  <div className="p-4 bg-white border-2 border-gray-200 rounded-xl">
                    <img
                      src={topupData.payment_method.qr_image || topupData.payment_method.qr_url}
                      alt="Codigo QR CoDi"
                      className="w-56 h-56"
                    />
                  </div>
                ) : (
                  <div className="p-8 bg-gray-50 border-2 border-dashed border-gray-300 rounded-xl text-center">
                    <QrCode className="h-16 w-16 text-gray-400 mx-auto mb-2" />
                    <p className="text-sm text-gray-600">
                      Si tu codigo QR no aparece, contacta a soporte.
                    </p>
                  </div>
                )}
                <p className="text-2xl font-bold text-gray-900 mt-4">
                  {formatCurrencyMXN(topupData.amount)}
                </p>
              </div>

              {error && (
                <div className="mb-3 p-3 bg-amber-50 border border-amber-200 rounded-lg flex items-start gap-2">
                  <AlertCircle className="h-5 w-5 text-amber-600 flex-shrink-0 mt-0.5" />
                  <p className="text-sm text-amber-800">{error}</p>
                </div>
              )}

              <div className="flex gap-3">
                <button
                  onClick={handleCheckStatus}
                  className="flex-1 px-4 py-3 bg-blue-600 text-white rounded-xl font-semibold hover:bg-blue-700 transition-all flex items-center justify-center gap-2"
                >
                  <RefreshCw className="h-4 w-4" />
                  Verificar pago
                </button>
                <button
                  onClick={handleClose}
                  className="flex-1 px-4 py-3 bg-gray-100 text-gray-700 rounded-xl font-semibold hover:bg-gray-200 transition-colors"
                >
                  Cerrar
                </button>
              </div>
            </div>
          )}

          {/* Step: Error */}
          {step === 'error' && (
            <div className="text-center py-8">
              <div className="inline-flex items-center justify-center w-16 h-16 bg-red-100 rounded-full mb-4">
                <XCircle className="h-8 w-8 text-red-600" />
              </div>
              <h4 className="text-xl font-bold text-gray-900 mb-2">Error</h4>
              <p className="text-gray-600 mb-6">{error || 'Ocurrio un error inesperado'}</p>
              <button
                onClick={() => setStep('select-amount')}
                className="px-6 py-3 bg-accent-600 text-white rounded-xl font-semibold hover:bg-accent-700 transition-all"
              >
                Intentar nuevamente
              </button>
            </div>
          )}

          {/* Step: Success */}
          {step === 'success' && (
            <div className="text-center py-8">
              <div className="inline-flex items-center justify-center w-16 h-16 bg-green-100 rounded-full mb-4">
                <CheckCircle2 className="h-8 w-8 text-green-600" />
              </div>
              <h4 className="text-xl font-bold text-gray-900 mb-2">¡Recarga Acreditada!</h4>
              <p className="text-gray-600">Tu saldo se ha agregado a tu monedero ToursRed Cash.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

// ── SPEI field component ───────────────────────────────────────
const SpeiField: React.FC<{
  label: string;
  value: string;
  onCopy: () => void;
  copied: boolean;
  mono?: boolean;
}> = ({ label, value, onCopy, copied, mono }) => (
  <div className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
    <div className="flex-1 min-w-0">
      <p className="text-xs text-gray-500 mb-1">{label}</p>
      <p className={`font-semibold text-gray-900 truncate ${mono ? 'font-mono' : ''}`}>
        {value}
      </p>
    </div>
    <button
      onClick={onCopy}
      className="ml-3 p-2 text-gray-400 hover:text-accent-600 transition-colors rounded-lg hover:bg-white flex-shrink-0"
    >
      {copied ? <Check className="h-4 w-4 text-green-600" /> : <Copy className="h-4 w-4" />}
    </button>
  </div>
);

export default OpenPayTopupModal;
