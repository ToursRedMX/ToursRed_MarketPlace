import React, { useState, useEffect, useRef } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { supabase, signOut } from '../../lib/supabase';
import { Mail, ArrowLeft, CheckCircle, XCircle, Clock } from 'lucide-react';

const VerifyEmailPage: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { user, userRole } = useAuth();
  const [code, setCode] = useState(['', '', '', '', '', '']);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);
  const [isResending, setIsResending] = useState(false);
  const [resendMessage, setResendMessage] = useState('');
  const inputRefs = useRef<(HTMLInputElement | null)[]>([]);

  const searchParams = new URLSearchParams(location.search);
  const redirectUrl = searchParams.get('redirect');

  useEffect(() => {
    if (!user) {
      navigate('/login');
      return;
    }

    checkVerificationStatus();
  }, [user, navigate]);

  const checkVerificationStatus = async () => {
    if (!user) return;

    try {
      const { data, error } = await supabase
        .from('users')
        .select('email_verified')
        .eq('id', user.id)
        .maybeSingle();

      if (error) throw error;

      if (data?.email_verified) {
        if (redirectUrl) {
          navigate(redirectUrl);
        } else {
          const role = user.user_metadata?.role;
          if (role === 'admin') {
            navigate('/admin/dashboard');
          } else if (role === 'agency') {
            navigate('/agency/dashboard');
          } else {
            navigate('/traveler/dashboard');
          }
        }
      }
    } catch (err) {
      console.error('Error checking verification status:', err);
    }
  };

  const handleChange = (index: number, value: string) => {
    if (!/^\d*$/.test(value)) return;

    const newCode = [...code];
    newCode[index] = value;
    setCode(newCode);
    setError('');

    if (value && index < 5) {
      inputRefs.current[index + 1]?.focus();
    }
  };

  const handleKeyDown = (index: number, e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Backspace' && !code[index] && index > 0) {
      inputRefs.current[index - 1]?.focus();
    }
  };

  const handlePaste = (e: React.ClipboardEvent) => {
    e.preventDefault();
    const pastedData = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, 6);
    const newCode = [...code];

    for (let i = 0; i < pastedData.length; i++) {
      newCode[i] = pastedData[i];
    }

    setCode(newCode);
    const nextEmptyIndex = newCode.findIndex(c => !c);
    const focusIndex = nextEmptyIndex === -1 ? 5 : nextEmptyIndex;
    inputRefs.current[focusIndex]?.focus();
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    const verificationCode = code.join('');

    if (verificationCode.length !== 6) {
      setError('Por favor ingresa el código completo');
      return;
    }

    setIsSubmitting(true);
    setError('');

    try {
      const { data: { session } } = await supabase.auth.getSession();

      if (!session) {
        setError('Sesión expirada. Por favor inicia sesión nuevamente.');
        setTimeout(() => navigate('/login'), 2000);
        return;
      }

      const response = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/verify-email-code`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${session.access_token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ code: verificationCode }),
        }
      );

      const result = await response.json();

      if (!response.ok || !result.success) {
        throw new Error(result.error || 'Error al verificar el código');
      }

      fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/send-welcome-email`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${session.access_token}`,
            'Content-Type': 'application/json',
          },
        }
      ).catch(() => {});

      // Limpiar cache para que initializeAuth consulte la BD fresca en el reload
      try {
        sessionStorage.removeItem('auth_state');
        if (user?.id) {
          sessionStorage.removeItem(`user_role_${user.id}`);
          localStorage.removeItem(`user_role_${user.id}`);
        }
      } catch { /**/ }

      setSuccess(true);
      setTimeout(() => {
        if (redirectUrl) {
          window.location.href = redirectUrl;
        } else if (userRole === 'admin') {
          window.location.href = '/admin/dashboard';
        } else if (userRole === 'agency') {
          window.location.href = '/agency/dashboard';
        } else {
          window.location.href = '/traveler/dashboard';
        }
      }, 2000);

    } catch (err: any) {
      console.error('Error verifying code:', err);
      setError(err.message || 'Error al verificar el código');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleResendCode = async () => {
    if (!user) return;

    setIsResending(true);
    setResendMessage('');
    setError('');

    try {
      const verificationCode = Math.floor(100000 + Math.random() * 900000).toString();
      const expiresAt = new Date();
      expiresAt.setHours(expiresAt.getHours() + 24);

      const { error: updateError } = await supabase
        .from('users')
        .update({
          verification_code: verificationCode,
          verification_code_expires_at: expiresAt.toISOString(),
          verification_code_attempts: 0,
        })
        .eq('id', user.id);

      if (updateError) throw updateError;

      const { data: { session } } = await supabase.auth.getSession();

      if (!session) {
        throw new Error('Sesión expirada');
      }

      const { data: userData } = await supabase
        .from('users')
        .select('first_name, last_name')
        .eq('id', user.id)
        .single();

      const userName = userData
        ? `${userData.first_name || ''} ${userData.last_name || ''}`.trim()
        : '';

      const response = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/send-verification-email`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${session.access_token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            userId: user.id,
            verificationCode: verificationCode,
            userName: userName,
          }),
        }
      );

      const result = await response.json();

      if (!response.ok || !result.success) {
        throw new Error(result.error || 'Error al enviar el código');
      }

      setResendMessage('Código reenviado exitosamente. Revisa tu correo.');
      setCode(['', '', '', '', '', '']);
      inputRefs.current[0]?.focus();

    } catch (err: any) {
      console.error('Error resending code:', err);
      setError(err.message || 'Error al reenviar el código');
    } finally {
      setIsResending(false);
    }
  };

  if (success) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-green-50 to-emerald-100 flex items-center justify-center p-4">
        <div className="bg-white rounded-2xl shadow-xl p-8 max-w-md w-full text-center">
          <div className="mb-6">
            <CheckCircle className="h-20 w-20 text-green-500 mx-auto" />
          </div>
          <h1 className="text-3xl font-bold text-gray-800 mb-4">
            ¡Correo Verificado!
          </h1>
          <p className="text-gray-600 mb-6">
            Tu correo electrónico ha sido verificado exitosamente.
            Redirigiendo...
          </p>
        </div>
      </div>
    );
  }

  const handleBackToLogin = async () => {
    await signOut();
    navigate('/login');
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-primary-50 to-primary-100 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-xl p-8 max-w-md w-full">
        <button
          onClick={handleBackToLogin}
          className="flex items-center text-primary-600 hover:text-primary-700 mb-6 transition-colors"
        >
          <ArrowLeft className="h-4 w-4 mr-2" />
          Cerrar sesión
        </button>

        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 bg-primary-100 rounded-full mb-4">
            <Mail className="h-8 w-8 text-primary-600" />
          </div>
          <h1 className="text-3xl font-bold text-gray-800 mb-2">
            Verifica tu correo
          </h1>
          <p className="text-gray-600">
            Ingresa el código de 6 dígitos que enviamos a tu correo electrónico
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-6">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-3 text-center">
              Código de Verificación
            </label>
            <div className="flex justify-center gap-2" onPaste={handlePaste}>
              {code.map((digit, index) => (
                <input
                  key={index}
                  ref={(el) => (inputRefs.current[index] = el)}
                  type="text"
                  inputMode="numeric"
                  maxLength={1}
                  value={digit}
                  onChange={(e) => handleChange(index, e.target.value)}
                  onKeyDown={(e) => handleKeyDown(index, e)}
                  className="w-12 h-14 text-center text-2xl font-bold border-2 border-gray-300 rounded-lg focus:border-primary-500 focus:ring-2 focus:ring-primary-200 transition-all"
                  disabled={isSubmitting}
                />
              ))}
            </div>
          </div>

          {error && (
            <div className="flex items-center gap-2 p-3 bg-red-50 border border-red-200 rounded-lg">
              <XCircle className="h-5 w-5 text-red-500 flex-shrink-0" />
              <p className="text-sm text-red-700">{error}</p>
            </div>
          )}

          {resendMessage && (
            <div className="flex items-center gap-2 p-3 bg-green-50 border border-green-200 rounded-lg">
              <CheckCircle className="h-5 w-5 text-green-500 flex-shrink-0" />
              <p className="text-sm text-green-700">{resendMessage}</p>
            </div>
          )}

          <button
            type="submit"
            disabled={isSubmitting || code.some(d => !d)}
            className="btn-primary w-full py-3 text-lg disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isSubmitting ? 'Verificando...' : 'Verificar Código'}
          </button>

          <div className="text-center">
            <button
              type="button"
              onClick={handleResendCode}
              disabled={isResending}
              className="text-sm text-primary-600 hover:text-primary-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {isResending ? 'Reenviando...' : '¿No recibiste el código? Reenviar'}
            </button>
          </div>

          <div className="flex items-start gap-2 p-3 bg-yellow-50 border border-yellow-200 rounded-lg">
            <Clock className="h-5 w-5 text-yellow-600 flex-shrink-0 mt-0.5" />
            <p className="text-xs text-yellow-700">
              El código expira en 24 horas. Tienes hasta 5 intentos para ingresarlo correctamente.
            </p>
          </div>
        </form>
      </div>
    </div>
  );
};

export default VerifyEmailPage;
