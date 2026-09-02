import React, { useState, useRef, useEffect } from 'react';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import { Eye, EyeOff, ShieldAlert, Fingerprint } from 'lucide-react';
import { signIn, supabase } from '../../lib/supabase';
import { useAuth } from '../../context/AuthContext';
import TurnstileWidget from '../../components/TurnstileWidget';
import { useTurnstileEnabled } from '../../hooks/useTurnstileEnabled';

interface OAuthToggles {
  google: boolean;
  azure: boolean;
  x: boolean;
  facebook: boolean;
  linkedin: boolean;
}

function computeDeviceFingerprint(): string {
  try {
    const raw = [
      navigator.userAgent,
      navigator.language,
      Intl.DateTimeFormat().resolvedOptions().timeZone,
      screen.width + 'x' + screen.height,
      navigator.platform,
    ].join('|');
    let hash = 5381;
    for (let i = 0; i < raw.length; i++) {
      hash = ((hash << 5) + hash) ^ raw.charCodeAt(i);
    }
    return (hash >>> 0).toString(16).padStart(8, '0');
  } catch {
    return 'unknown';
  }
}

async function checkLoginRisk(email: string, deviceFingerprint: string) {
  try {
    const res = await fetch(
      `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/check-login-risk`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, device_fingerprint: deviceFingerprint }),
        signal: AbortSignal.timeout(4000),
      }
    );
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null; // never block on risk-check failure
  }
}

const LoginPage: React.FC = () => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isGoogleLoading, setIsGoogleLoading] = useState(false);
  const [isAzureLoading, setIsAzureLoading] = useState(false);
  const [isTwitterLoading, setIsTwitterLoading] = useState(false);
  const [isFacebookLoading, setIsFacebookLoading] = useState(false);
  const [isLinkedinLoading, setIsLinkedinLoading] = useState(false);
  const [ipBlocked, setIpBlocked] = useState(false);
  const [turnstileToken, setTurnstileToken] = useState('');
  const { turnstileEnabled } = useTurnstileEnabled();
  const [oauthToggles, setOauthToggles] = useState<OAuthToggles>({ google: true, azure: true, x: false, facebook: false, linkedin: false });
  const [passkeysEnabled, setPasskeysEnabled] = useState(false);
  const [isPasskeyLoading, setIsPasskeyLoading] = useState(false);
  const deviceFingerprintRef = useRef<string>(computeDeviceFingerprint());
  const navigate = useNavigate();
  const location = useLocation();
  const { signInWithGoogle, signInWithAzure, signInWithTwitter, signInWithFacebook, signInWithLinkedIn } = useAuth();

  const searchParams = new URLSearchParams(location.search);
  const redirectUrl = searchParams.get('redirect');
  const isBlocked = searchParams.get('blocked') === 'true';
  const from = location.state?.from?.pathname || '/';

  const [error, setError] = useState(
    isBlocked
      ? 'Su cuenta ha sido bloqueada. Para mayor información contáctenos.'
      : ''
  );

  useEffect(() => {
    supabase
      .from('platform_settings')
      .select('oauth_google_login_enabled, oauth_azure_login_enabled, oauth_twitter_login_enabled, oauth_facebook_login_enabled, oauth_linkedin_login_enabled, passkeys_enabled')
      .maybeSingle()
      .then(({ data }) => {
        if (data) {
          setOauthToggles({
            google: data.oauth_google_login_enabled ?? true,
            azure: data.oauth_azure_login_enabled ?? true,
            x: data.oauth_twitter_login_enabled ?? false,
            facebook: data.oauth_facebook_login_enabled ?? false,
            linkedin: data.oauth_linkedin_login_enabled ?? false,
          });
          setPasskeysEnabled(data.passkeys_enabled ?? false);
        }
      })
      .catch(() => {});
  }, []);

  const recordFailedLogin = (failureReason: string) => {
    try {
      fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/record-session-event`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            event_type: 'failed_login',
            email,
            device_fingerprint: deviceFingerprintRef.current,
            user_agent: navigator.userAgent,
            failure_reason: failureReason,
          }),
        }
      );
    } catch {
      // best-effort
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    try {
      setIsLoading(true);
      setError('');
      setIpBlocked(false);

      // Pre-login risk check
      const risk = await checkLoginRisk(email, deviceFingerprintRef.current);

      if (risk?.ip_blocked) {
        setIpBlocked(true);
        setError('Demasiados intentos fallidos desde tu red. Por favor intenta más tarde.');
        return;
      }

      // Progressive delay if risk engine requests it
      if (risk?.delay_ms && risk.delay_ms > 0) {
        await new Promise(resolve => setTimeout(resolve, Math.min(risk.delay_ms, 30000)));
      }

      const { data, error } = await signIn(email, password, turnstileToken || undefined);

      if (error) {
        throw error;
      }

      if (data.user) {
        const role = data.user.user_metadata?.role;

        if (redirectUrl) {
          navigate(redirectUrl, { replace: true });
        } else if (role === 'admin') {
          navigate('/admin/dashboard');
        } else if (role === 'agency') {
          navigate('/agency/dashboard');
        } else if (role === 'traveler') {
          navigate('/traveler/dashboard');
        } else {
          navigate(from, { replace: true });
        }
      }
    } catch (err: any) {
      if (err.message === 'USUARIO_BLOQUEADO') {
        setError('Su cuenta ha sido bloqueada. Para mayor información contáctenos.');
      } else {
        // Generic message — anti-enumeration
        setError('Credenciales incorrectas. Por favor verifica tu correo y contraseña.');
        recordFailedLogin(err.message ?? 'unknown');
      }
    } finally {
      setIsLoading(false);
    }
  };

  const handleGoogleSignIn = async () => {
    setIsGoogleLoading(true);
    try {
      await signInWithGoogle();
    } catch {
      setError('No se pudo iniciar sesión con Google. Por favor intenta de nuevo.');
      setIsGoogleLoading(false);
    }
  };

  const handleAzureSignIn = async () => {
    setIsAzureLoading(true);
    try {
      await signInWithAzure();
    } catch {
      setError('No se pudo iniciar sesión con Microsoft. Por favor intenta de nuevo.');
      setIsAzureLoading(false);
    }
  };

  const handleTwitterSignIn = async () => {
    setIsTwitterLoading(true);
    try {
      await signInWithTwitter();
    } catch {
      setError('No se pudo iniciar sesión con X. Por favor intenta de nuevo.');
      setIsTwitterLoading(false);
    }
  };

  const handleFacebookSignIn = async () => {
    setIsFacebookLoading(true);
    try {
      await signInWithFacebook();
    } catch {
      setError('No se pudo iniciar sesión con Facebook. Por favor intenta de nuevo.');
      setIsFacebookLoading(false);
    }
  };

  const handleLinkedInSignIn = async () => {
    setIsLinkedinLoading(true);
    try {
      await signInWithLinkedIn();
    } catch {
      setError('No se pudo iniciar sesión con LinkedIn. Por favor intenta de nuevo.');
      setIsLinkedinLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col justify-center py-12 px-4 sm:px-6 lg:px-8">
      <div className="sm:mx-auto sm:w-full sm:max-w-md">
        <h2 className="mt-6 text-center text-3xl font-bold text-gray-900">
          Inicia sesión en tu cuenta
        </h2>
        <p className="mt-2 text-center text-sm text-gray-600">
          ¿No tienes una cuenta?{' '}
          <Link
            to={redirectUrl ? `/signup?redirect=${encodeURIComponent(redirectUrl)}` : "/signup"}
            className="font-medium text-primary-600 hover:text-primary-500"
          >
            Regístrate aquí
          </Link>
        </p>
      </div>

      <div className="mt-8 sm:mx-auto sm:w-full sm:max-w-md">
        <div className="bg-white py-8 px-4 shadow sm:rounded-lg sm:px-10">
          <form className="space-y-6" onSubmit={handleSubmit}>
            {error && (
              <div className={`flex items-start gap-2 px-4 py-3 rounded border ${ipBlocked ? 'bg-amber-50 border-amber-200 text-amber-800' : 'bg-error-50 border-error-200 text-error-700'}`}>
                {ipBlocked && <ShieldAlert className="h-4 w-4 mt-0.5 flex-shrink-0" />}
                <span>{error}</span>
              </div>
            )}
            
            <div>
              <label htmlFor="email" className="block text-sm font-medium text-gray-700">
                Correo electrónico
              </label>
              <div className="mt-1">
                <input
                  id="email"
                  name="email"
                  type="email"
                  autoComplete="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="appearance-none block w-full px-3 py-2 border border-gray-300 rounded-md shadow-xs placeholder-gray-400 focus:outline-hidden focus:ring-primary-500 focus:border-primary-500 sm:text-sm"
                />
              </div>
            </div>

            <div>
              <label htmlFor="password" className="block text-sm font-medium text-gray-700">
                Contraseña
              </label>
              <div className="mt-1 relative">
                <input
                  id="password"
                  name="password"
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="current-password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="appearance-none block w-full px-3 py-2 pr-10 border border-gray-300 rounded-md shadow-xs placeholder-gray-400 focus:outline-hidden focus:ring-primary-500 focus:border-primary-500 sm:text-sm"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute inset-y-0 right-0 pr-3 flex items-center text-gray-400 hover:text-gray-600"
                >
                  {showPassword ? (
                    <EyeOff className="h-5 w-5" />
                  ) : (
                    <Eye className="h-5 w-5" />
                  )}
                </button>
              </div>
            </div>

            <div className="flex items-center justify-between">
              <div className="flex items-center">
                <input
                  id="remember-me"
                  name="remember-me"
                  type="checkbox"
                  className="h-4 w-4 text-primary-600 focus:ring-primary-500 border-gray-300 rounded"
                />
                <label htmlFor="remember-me" className="ml-2 block text-sm text-gray-900">
                  Recordarme
                </label>
              </div>

              <div className="text-sm">
                <Link to="/forgot-password" className="font-medium text-primary-600 hover:text-primary-500">
                  ¿Olvidaste tu contraseña?
                </Link>
              </div>
            </div>

            {(turnstileEnabled || turnstileToken) && (
              <div className="flex justify-center">
                <TurnstileWidget onToken={setTurnstileToken} />
              </div>
            )}

            <div>
              <button
                type="submit"
                disabled={isLoading || (turnstileEnabled && !turnstileToken)}
                className="w-full flex justify-center py-2 px-4 border border-transparent rounded-md shadow-xs text-sm font-medium text-white bg-primary-600 hover:bg-primary-700 focus:outline-hidden focus:ring-2 focus:ring-offset-2 focus:ring-primary-500 disabled:opacity-50"
              >
                {isLoading ? (
                  <div className="w-5 h-5 border-t-2 border-b-2 border-white rounded-full animate-spin"></div>
                ) : (
                  'Iniciar sesión'
                )}
              </button>
            </div>
          </form>

          {passkeysEnabled && typeof window !== 'undefined' && window.PublicKeyCredential && (
            <div className="mt-4">
              <button
                type="button"
                onClick={async () => {
                  setIsPasskeyLoading(true);
                  setError('');
                  try {
                    const { data: pkData, error: pkError } = await supabase.auth.signInWithPasskey({
                      options: { captchaToken: turnstileToken || undefined },
                    });
                    if (pkError) throw pkError;
                    if (pkData?.user) {
                      const role = pkData.user.user_metadata?.role;
                      if (redirectUrl) {
                        navigate(redirectUrl, { replace: true });
                      } else if (role === 'admin') {
                        navigate('/admin/dashboard');
                      } else if (role === 'agency') {
                        navigate('/agency/dashboard');
                      } else if (role === 'traveler') {
                        navigate('/traveler/dashboard');
                      } else {
                        navigate(from, { replace: true });
                      }
                    }
                  } catch (err: any) {
                    console.error('[passkey] signInWithPasskey failed:', err);
                    setError('No se pudo iniciar sesion con clave de acceso.');
                  } finally {
                    setIsPasskeyLoading(false);
                  }
                }}
                disabled={isPasskeyLoading || (turnstileEnabled && !turnstileToken)}
                className="w-full flex justify-center items-center gap-2 py-2.5 px-4 border border-blue-300 rounded-md shadow-xs bg-blue-50 text-sm font-medium text-blue-700 hover:bg-blue-100 focus:outline-hidden focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50 transition-colors"
              >
                {isPasskeyLoading ? (
                  <div className="w-5 h-5 border-t-2 border-b-2 border-blue-400 rounded-full animate-spin" />
                ) : (
                  <Fingerprint className="w-5 h-5" />
                )}
                Usar clave de acceso
              </button>
            </div>
          )}

          {(oauthToggles.google || oauthToggles.azure || oauthToggles.x || oauthToggles.facebook || oauthToggles.linkedin) && (
          <div className="mt-6">
            <div className="relative">
              <div className="absolute inset-0 flex items-center">
                <div className="w-full border-t border-gray-300" />
              </div>
              <div className="relative flex justify-center text-sm">
                <span className="px-2 bg-white text-gray-500">O continúa con</span>
              </div>
            </div>

            <div className="mt-4 flex flex-col gap-3">
              {oauthToggles.google && (
              <button
                type="button"
                onClick={handleGoogleSignIn}
                disabled={isGoogleLoading || isAzureLoading || isTwitterLoading || isFacebookLoading || isLinkedinLoading}
                className="w-full inline-flex justify-center items-center gap-3 py-2.5 px-4 border border-gray-300 rounded-md shadow-xs bg-white text-sm font-medium text-gray-700 hover:bg-gray-50 focus:outline-hidden focus:ring-2 focus:ring-offset-2 focus:ring-primary-500 disabled:opacity-50 transition-colors"
              >
                {isGoogleLoading ? (
                  <div className="w-5 h-5 border-t-2 border-b-2 border-gray-400 rounded-full animate-spin" />
                ) : (
                  <svg viewBox="0 0 24 24" className="w-5 h-5 flex-shrink-0" aria-hidden="true">
                    <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
                    <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
                    <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
                    <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
                  </svg>
                )}
                Continuar con Google
              </button>
              )}

              {oauthToggles.azure && (
              <button
                type="button"
                onClick={handleAzureSignIn}
                disabled={isAzureLoading || isGoogleLoading || isTwitterLoading || isFacebookLoading || isLinkedinLoading}
                className="w-full inline-flex justify-center items-center gap-3 py-2.5 px-4 border border-gray-300 rounded-md shadow-xs bg-white text-sm font-medium text-gray-700 hover:bg-gray-50 focus:outline-hidden focus:ring-2 focus:ring-offset-2 focus:ring-primary-500 disabled:opacity-50 transition-colors"
              >
                {isAzureLoading ? (
                  <div className="w-5 h-5 border-t-2 border-b-2 border-gray-400 rounded-full animate-spin" />
                ) : (
                  <svg viewBox="0 0 23 23" className="w-5 h-5 flex-shrink-0" aria-hidden="true">
                    <path fill="#f3f3f3" d="M0 0h23v23H0z"/>
                    <path fill="#f35325" d="M1 1h10v10H1z"/>
                    <path fill="#81bc06" d="M12 1h10v10H12z"/>
                    <path fill="#05a6f0" d="M1 12h10v10H1z"/>
                    <path fill="#ffba08" d="M12 12h10v10H12z"/>
                  </svg>
                )}
                Continuar con Microsoft
              </button>
              )}

              {oauthToggles.x && (
              <button
                type="button"
                onClick={handleTwitterSignIn}
                disabled={isTwitterLoading || isGoogleLoading || isAzureLoading || isFacebookLoading || isLinkedinLoading}
                className="w-full inline-flex justify-center items-center gap-3 py-2.5 px-4 border border-gray-300 rounded-md shadow-xs bg-white text-sm font-medium text-gray-700 hover:bg-gray-50 focus:outline-hidden focus:ring-2 focus:ring-offset-2 focus:ring-primary-500 disabled:opacity-50 transition-colors"
              >
                {isTwitterLoading ? (
                  <div className="w-5 h-5 border-t-2 border-b-2 border-gray-400 rounded-full animate-spin" />
                ) : (
                  <svg viewBox="0 0 24 24" className="w-5 h-5 flex-shrink-0" aria-hidden="true" fill="currentColor">
                    <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/>
                  </svg>
                )}
                Continuar con X
              </button>
              )}

              {oauthToggles.facebook && (
              <button
                type="button"
                onClick={handleFacebookSignIn}
                disabled={isFacebookLoading || isGoogleLoading || isAzureLoading || isTwitterLoading || isLinkedinLoading}
                className="w-full inline-flex justify-center items-center gap-3 py-2.5 px-4 border border-gray-300 rounded-md shadow-xs bg-white text-sm font-medium text-gray-700 hover:bg-gray-50 focus:outline-hidden focus:ring-2 focus:ring-offset-2 focus:ring-primary-500 disabled:opacity-50 transition-colors"
              >
                {isFacebookLoading ? (
                  <div className="w-5 h-5 border-t-2 border-b-2 border-gray-400 rounded-full animate-spin" />
                ) : (
                  <svg viewBox="0 0 24 24" className="w-5 h-5 flex-shrink-0" aria-hidden="true">
                    <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z" fill="#1877F2"/>
                  </svg>
                )}
                Continuar con Facebook
              </button>
              )}

              {oauthToggles.linkedin && (
              <button
                type="button"
                onClick={handleLinkedInSignIn}
                disabled={isLinkedinLoading || isGoogleLoading || isAzureLoading || isTwitterLoading || isFacebookLoading}
                className="w-full inline-flex justify-center items-center gap-3 py-2.5 px-4 border border-gray-300 rounded-md shadow-xs bg-white text-sm font-medium text-gray-700 hover:bg-gray-50 focus:outline-hidden focus:ring-2 focus:ring-offset-2 focus:ring-primary-500 disabled:opacity-50 transition-colors"
              >
                {isLinkedinLoading ? (
                  <div className="w-5 h-5 border-t-2 border-b-2 border-gray-400 rounded-full animate-spin" />
                ) : (
                  <svg viewBox="0 0 24 24" className="w-5 h-5 flex-shrink-0" aria-hidden="true">
                    <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433c-1.144 0-2.063-.926-2.063-2.065 0-1.138.92-2.063 2.063-2.063 1.14 0 2.064.925 2.064 2.063 0 1.139-.925 2.065-2.064 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z" fill="#0A66C2"/>
                  </svg>
                )}
                Continuar con LinkedIn
              </button>
              )}
            </div>

          </div>
          )}

          <div className="mt-4 grid grid-cols-2 gap-3">
            <Link
              to={redirectUrl ? `/agency-signup?redirect=${encodeURIComponent(redirectUrl)}` : "/agency-signup"}
              className="w-full inline-flex justify-center py-2 px-4 border border-gray-300 rounded-md shadow-xs bg-white text-sm font-medium text-gray-700 hover:bg-gray-50"
            >
              ¿Eres una agencia?
            </Link>
            <Link
              to={redirectUrl ? `/signup?redirect=${encodeURIComponent(redirectUrl)}` : "/signup"}
              className="w-full inline-flex justify-center py-2 px-4 border border-gray-300 rounded-md shadow-xs bg-white text-sm font-medium text-gray-700 hover:bg-gray-50"
            >
              Registrarse como viajero
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
};

export default LoginPage;