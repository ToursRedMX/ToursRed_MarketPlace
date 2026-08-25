import React, { useState, useEffect } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { Eye, EyeOff, CheckCircle, XCircle, Loader, Info } from 'lucide-react';
import { supabase, UserRole } from '../../lib/supabase';
import { useAuth } from '../../context/AuthContext';

const isLeakedPasswordError = (message: string) =>
  /leaked|pwned|compromised|common password/i.test(message);

const GoogleTravelerSignupPage: React.FC = () => {
  const navigate = useNavigate();
  const { user, completeOnboarding } = useAuth();

  const meta = user?.user_metadata ?? {};
  const googleFullName: string = meta.full_name || meta.name || '';
  const googleFirstName = meta.given_name || googleFullName.split(' ')[0] || '';
  const googleLastName = meta.family_name || googleFullName.split(' ').slice(1).join(' ') || '';
  const googleEmail: string = user?.email || meta.email || '';
  const googleAvatarUrl: string = meta.avatar_url || meta.picture || '';

  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [isForeignTraveler, setIsForeignTraveler] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [activeTermsVersion, setActiveTermsVersion] = useState<{ version_number: number; published_at: string } | null>(null);
  const [referralCode, setReferralCode] = useState('');
  const [isValidatingReferral, setIsValidatingReferral] = useState(false);
  const [referralValidation, setReferralValidation] = useState<{
    valid: boolean; message: string; referrer_name?: string; referrer_id?: string;
  } | null>(null);

  const [formData, setFormData] = useState({
    firstName: googleFirstName,
    apellidoPaterno: googleLastName,
    apellidoMaterno: '',
    sexo: '' as '' | 'masculino' | 'femenino' | 'no_binario',
    email: googleEmail,
    password: '',
    confirmPassword: '',
    phoneNumber: '',
    curp: '',
    passportNumber: '',
    dateOfBirth: '',
    street: '',
    exteriorNumber: '',
    interiorNumber: '',
    colony: '',
    city: '',
    state: '',
    postalCode: '',
    country: 'México',
  });

  useEffect(() => {
    supabase.rpc('get_active_terms', { p_type: 'traveler' }).then(({ data }) => {
      if (data && data.length > 0) setActiveTermsVersion(data[0]);
    });
  }, []);

  // Redirect if not a pending Google user
  useEffect(() => {
    if (!user) navigate('/login');
  }, [user, navigate]);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setFormData(prev => ({
      ...prev,
      [name]: name === 'curp' || name === 'passportNumber' ? value.toUpperCase() : value,
    }));
  };

  const handleSexoChange = (value: 'masculino' | 'femenino' | 'no_binario') => {
    setFormData(prev => ({ ...prev, sexo: value }));
  };

  const validateReferralCode = async (code: string) => {
    if (!code.trim()) { setReferralValidation(null); return; }
    setIsValidatingReferral(true);
    try {
      const res = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/validate-referral-code`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}` },
          body: JSON.stringify({ code: code.trim().toLowerCase() }),
        }
      );
      setReferralValidation(await res.json());
    } catch {
      setReferralValidation({ valid: false, message: 'Error al validar código' });
    } finally {
      setIsValidatingReferral(false);
    }
  };

  useEffect(() => {
    const t = setTimeout(() => {
      if (referralCode.trim().length >= 4) validateReferralCode(referralCode);
      else setReferralValidation(null);
    }, 500);
    return () => clearTimeout(t);
  }, [referralCode]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setError('');

    const { firstName, apellidoPaterno, apellidoMaterno, sexo, email, password, confirmPassword, phoneNumber, curp, passportNumber, dateOfBirth, street, exteriorNumber, interiorNumber, colony, city, state, postalCode, country } = formData;

    if (password !== confirmPassword) {
      setError('Las contraseñas no coinciden');
      setIsLoading(false);
      return;
    }
    if (!apellidoPaterno.trim()) {
      setError('El apellido paterno es requerido');
      setIsLoading(false);
      return;
    }
    if (!sexo) {
      setError('El sexo es requerido');
      setIsLoading(false);
      return;
    }
    if (!phoneNumber.trim()) {
      setError('El número de celular es requerido');
      setIsLoading(false);
      return;
    }
    if (!isForeignTraveler && (!curp.trim() || curp.length !== 18)) {
      setError('La CURP debe tener 18 caracteres');
      setIsLoading(false);
      return;
    }
    if (isForeignTraveler && !passportNumber.trim()) {
      setError('El número de pasaporte es requerido');
      setIsLoading(false);
      return;
    }

    try {
      if (!user) throw new Error('Sesión no encontrada');

      // 1. Insert profile into users table FIRST so RLS checks pass immediately
      const { error: insertError } = await supabase.from('users').insert({
        id: user.id,
        email: email,
        role: UserRole.TRAVELER,
        first_name: firstName,
        last_name: apellidoPaterno,
        apellido_paterno: apellidoPaterno,
        apellido_materno: apellidoMaterno || null,
        sexo: sexo || null,
        phone_number: phoneNumber,
        curp: isForeignTraveler ? null : curp,
        passport_number: isForeignTraveler ? passportNumber : null,
        is_foreign_traveler: isForeignTraveler,
        date_of_birth: dateOfBirth || null,
        street: street || null,
        exterior_number: exteriorNumber || null,
        interior_number: interiorNumber || null,
        colony: colony || null,
        city: city || null,
        state: state || null,
        postal_code: postalCode || null,
        country: country || 'México',
        email_verified: true,
        onboarding_completed: true,
        profile_picture_url: googleAvatarUrl || null,
      });

      if (insertError) {
        if (insertError.message?.includes('curp')) throw new Error('Este CURP ya está registrado en otra cuenta.');
        if (insertError.message?.includes('passport')) throw new Error('Este número de pasaporte ya está registrado en otra cuenta.');
        throw insertError;
      }

      // 2. Update password via Supabase Auth (after insert so users record exists)
      const { error: pwError } = await supabase.auth.updateUser({ password });
      if (pwError) {
        if (isLeakedPasswordError(pwError.message)) {
          throw new Error('Esta contraseña ha sido expuesta en brechas de datos. Por favor elige una más segura.');
        }
        throw pwError;
      }

      // 3. Register auth providers
      await supabase.from('user_auth_providers').upsert(
        { user_id: user.id, provider: 'google', provider_user_id: user.id },
        { onConflict: 'user_id,provider' }
      );
      await supabase.from('user_auth_providers').upsert(
        { user_id: user.id, provider: 'email' },
        { onConflict: 'user_id,provider' }
      );

      // 4. Update Supabase Auth user_metadata
      await supabase.auth.updateUser({
        data: { onboarding_completed: true, role: UserRole.TRAVELER },
      });

      // 5. Record T&C acceptance
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (session) {
          await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/record-terms-acceptance`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${session.access_token}` },
            body: JSON.stringify({ terms_type: 'traveler' }),
          });
        }
      } catch { /* best-effort */ }

      // 6. Process referral if valid
      if (referralValidation?.valid && referralValidation.referrer_id) {
        try {
          await supabase.from('users').update({
            referred_by_user_id: referralValidation.referrer_id,
            referral_code_used: referralCode.trim().toLowerCase(),
          }).eq('id', user.id);

          await supabase.from('referral_relationships').insert({
            referrer_user_id: referralValidation.referrer_id,
            referred_user_id: user.id,
            referral_code_used: referralCode.trim().toLowerCase(),
            status: 'pending',
          });
        } catch { /* best-effort */ }
      }

      // 7. Refresh auth state so isOnboardingPending is cleared before navigating
      await completeOnboarding();

      navigate('/traveler/dashboard');
    } catch (err: any) {
      setError(err.message || 'Ocurrió un error al completar el registro');
    } finally {
      setIsLoading(false);
    }
  };

  const inputClass = "appearance-none block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm placeholder-gray-400 focus:outline-none focus:ring-primary-500 focus:border-primary-500 sm:text-sm";

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col justify-center py-12 px-4 sm:px-6 lg:px-8">
      <div className="sm:mx-auto sm:w-full sm:max-w-md">
        <div className="flex items-center justify-center gap-2 mb-2">
          <svg viewBox="0 0 24 24" className="w-6 h-6" aria-hidden="true">
            <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
            <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
            <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
            <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
          </svg>
          <span className="text-sm font-medium text-gray-500">Registro con Google</span>
        </div>
        <h2 className="text-center text-2xl font-bold text-gray-900">Completa tu perfil de Viajero</h2>
        <p className="mt-1 text-center text-sm text-gray-500">
          Todos los campos son necesarios para continuar.
        </p>
      </div>

      <div className="mt-6 sm:mx-auto sm:w-full sm:max-w-md">
        <div className="bg-white py-8 px-4 shadow sm:rounded-lg sm:px-10">

          {/* Google pre-fill notice */}
          <div className="mb-6 flex items-start gap-2 bg-blue-50 border border-blue-200 rounded-lg px-4 py-3">
            <Info className="w-4 h-4 text-blue-500 mt-0.5 flex-shrink-0" />
            <p className="text-xs text-blue-700">Tus datos de Google han sido pre-llenados. Puedes editarlos si lo deseas.</p>
          </div>

          {error && (
            <div className="mb-4 bg-red-50 border border-red-200 text-red-600 rounded-md p-3 text-sm">{error}</div>
          )}

          <form className="space-y-5" onSubmit={handleSubmit}>
            {/* Tipo de viajero */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Tipo de viajero</label>
              <div className="flex items-center space-x-4">
                <label className="flex items-center cursor-pointer">
                  <input type="radio" checked={!isForeignTraveler} onChange={() => setIsForeignTraveler(false)} className="h-4 w-4 text-primary-600" />
                  <span className="ml-2 text-sm font-medium text-gray-700">Viajero Nacional</span>
                </label>
                <label className="flex items-center cursor-pointer">
                  <input type="radio" checked={isForeignTraveler} onChange={() => setIsForeignTraveler(true)} className="h-4 w-4 text-primary-600" />
                  <span className="ml-2 text-sm font-medium text-gray-700">Viajero Extranjero</span>
                </label>
              </div>
            </div>

            {/* Nombre */}
            <div>
              <label className="block text-sm font-medium text-gray-700">Nombre(s)</label>
              <input name="firstName" type="text" value={formData.firstName} onChange={handleInputChange} required className={`mt-1 ${inputClass}`} />
            </div>

            {/* Apellidos */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 items-end">
              <div>
                <label className="block text-sm font-medium text-gray-700">Apellido Paterno</label>
                <input name="apellidoPaterno" type="text" value={formData.apellidoPaterno} onChange={handleInputChange} required className={`mt-1 ${inputClass}`} />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700">Apellido Materno <span className="text-gray-400 font-normal">(opcional)</span></label>
                <input name="apellidoMaterno" type="text" value={formData.apellidoMaterno} onChange={handleInputChange} className={`mt-1 ${inputClass}`} />
              </div>
            </div>

            {/* Email (from Google, editable) */}
            <div>
              <label className="block text-sm font-medium text-gray-700">Correo electrónico</label>
              <input name="email" type="email" value={formData.email} onChange={handleInputChange} required className={`mt-1 ${inputClass} bg-gray-50`} readOnly />
              <p className="mt-1 text-xs text-gray-400">Email verificado por Google</p>
            </div>

            {/* Referral */}
            <div>
              <label className="block text-sm font-medium text-gray-700">Código de Referido <span className="text-gray-400 font-normal">(Opcional)</span></label>
              <div className="mt-1 relative">
                <input type="text" value={referralCode} onChange={e => setReferralCode(e.target.value.toLowerCase())} placeholder="Ej: juan_perez" maxLength={20} className={`${inputClass} pr-10 lowercase`} />
                {isValidatingReferral && <div className="absolute inset-y-0 right-0 pr-3 flex items-center"><Loader className="h-5 w-5 text-gray-400 animate-spin" /></div>}
                {!isValidatingReferral && referralValidation && (
                  <div className="absolute inset-y-0 right-0 pr-3 flex items-center">
                    {referralValidation.valid ? <CheckCircle className="h-5 w-5 text-green-500" /> : <XCircle className="h-5 w-5 text-red-500" />}
                  </div>
                )}
              </div>
              {referralValidation && (
                <p className={`mt-1 text-sm ${referralValidation.valid ? 'text-green-600' : 'text-red-600'}`}>
                  {referralValidation.valid && referralValidation.referrer_name ? `Referido por ${referralValidation.referrer_name}` : referralValidation.message}
                </p>
              )}
            </div>

            {/* Fecha de Nacimiento */}
            <div>
              <label className="block text-sm font-medium text-gray-700">Fecha de Nacimiento</label>
              <input name="dateOfBirth" type="date" value={formData.dateOfBirth} onChange={handleInputChange} required className={`mt-1 ${inputClass}`} />
            </div>

            {/* Sexo */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Sexo</label>
              <div className="grid grid-cols-3 gap-2">
                {(['masculino', 'femenino', 'no_binario'] as const).map((opcion) => (
                  <label key={opcion} className={`flex items-center justify-center px-3 py-2 border rounded-md cursor-pointer text-sm font-medium transition-colors ${
                    formData.sexo === opcion
                      ? 'border-primary-500 bg-primary-50 text-primary-700'
                      : 'border-gray-300 bg-white text-gray-700 hover:bg-gray-50'
                  }`}>
                    <input type="radio" name="sexo" value={opcion} checked={formData.sexo === opcion} onChange={() => handleSexoChange(opcion)} className="sr-only" />
                    {opcion === 'masculino' ? 'Masculino' : opcion === 'femenino' ? 'Femenino' : 'No Binario'}
                  </label>
                ))}
              </div>
            </div>

            {/* CURP o Pasaporte */}
            {!isForeignTraveler ? (
              <div>
                <label className="block text-sm font-medium text-gray-700">CURP</label>
                <input name="curp" type="text" value={formData.curp} onChange={handleInputChange} placeholder="ABCD123456HDFRRL09" maxLength={18} required className={`mt-1 ${inputClass} uppercase`} />
                <p className="mt-1 text-xs text-gray-500">18 caracteres</p>
              </div>
            ) : (
              <div>
                <label className="block text-sm font-medium text-gray-700">Número de Pasaporte</label>
                <input name="passportNumber" type="text" value={formData.passportNumber} onChange={handleInputChange} placeholder="A12345678" required className={`mt-1 ${inputClass} uppercase`} />
              </div>
            )}

            {/* Phone */}
            <div>
              <label className="block text-sm font-medium text-gray-700">Número de celular</label>
              <input name="phoneNumber" type="tel" value={formData.phoneNumber} onChange={handleInputChange} placeholder="+52 55 1234 5678" required className={`mt-1 ${inputClass}`} />
            </div>

            {/* Address */}
            <div className="border-t pt-4 space-y-3">
              <h3 className="text-sm font-medium text-gray-900">Domicilio</h3>
              <div>
                <label className="block text-sm font-medium text-gray-700">Calle</label>
                <input name="street" type="text" value={formData.street} onChange={handleInputChange} placeholder="Av. Insurgentes Sur" required className={`mt-1 ${inputClass}`} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700">Núm. Exterior</label>
                  <input name="exteriorNumber" type="text" value={formData.exteriorNumber} onChange={handleInputChange} placeholder="123" required className={`mt-1 ${inputClass}`} />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700">Núm. Interior <span className="text-gray-400 font-normal">(opcional)</span></label>
                  <input name="interiorNumber" type="text" value={formData.interiorNumber} onChange={handleInputChange} placeholder="4B" className={`mt-1 ${inputClass}`} />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700">Colonia</label>
                <input name="colony" type="text" value={formData.colony} onChange={handleInputChange} placeholder="Roma Norte" required className={`mt-1 ${inputClass}`} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700">Ciudad</label>
                  <input name="city" type="text" value={formData.city} onChange={handleInputChange} placeholder="Ciudad de México" required className={`mt-1 ${inputClass}`} />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700">Estado</label>
                  <input name="state" type="text" value={formData.state} onChange={handleInputChange} placeholder="CDMX" required className={`mt-1 ${inputClass}`} />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700">Código Postal</label>
                  <input name="postalCode" type="text" value={formData.postalCode} onChange={handleInputChange} placeholder="06700" required maxLength={5} className={`mt-1 ${inputClass}`} />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700">País</label>
                  <input name="country" type="text" value={formData.country} onChange={handleInputChange} placeholder="México" required className={`mt-1 ${inputClass}`} />
                </div>
              </div>
            </div>

            {/* Password */}
            <div className="border-t pt-4 space-y-4">
              <div>
                <p className="text-sm text-gray-600 mb-3">Asigna una contraseña para poder iniciar sesión también con tu correo y contraseña.</p>
                <label className="block text-sm font-medium text-gray-700">Contraseña</label>
                <div className="mt-1 relative">
                  <input name="password" type={showPassword ? 'text' : 'password'} value={formData.password} onChange={handleInputChange} required autoComplete="new-password" className={`${inputClass} pr-10`} />
                  <button type="button" onClick={() => setShowPassword(!showPassword)} className="absolute inset-y-0 right-0 pr-3 flex items-center text-gray-400">
                    {showPassword ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
                  </button>
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700">Confirmar Contraseña</label>
                <div className="mt-1 relative">
                  <input name="confirmPassword" type={showConfirmPassword ? 'text' : 'password'} value={formData.confirmPassword} onChange={handleInputChange} required autoComplete="new-password" className={`${inputClass} pr-10`} />
                  <button type="button" onClick={() => setShowConfirmPassword(!showConfirmPassword)} className="absolute inset-y-0 right-0 pr-3 flex items-center text-gray-400">
                    {showConfirmPassword ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
                  </button>
                </div>
              </div>
            </div>

            {/* T&C */}
            <div className="rounded-lg border border-gray-200 bg-gray-50 p-4">
              <label className="flex items-start gap-3 cursor-pointer">
                <input type="checkbox" checked={termsAccepted} onChange={e => setTermsAccepted(e.target.checked)} className="mt-0.5 h-4 w-4 text-primary-600 border-gray-300 rounded flex-shrink-0" />
                <span className="text-sm text-gray-700 leading-relaxed">
                  He leído y acepto los{' '}
                  <Link to="/terminos-servicio" target="_blank" className="font-medium text-primary-600 underline">Términos y Condiciones</Link>{' '}
                  y el{' '}
                  <Link to="/aviso-privacidad" target="_blank" className="font-medium text-primary-600 underline">Aviso de Privacidad</Link>{' '}
                  de ToursRed
                  {activeTermsVersion && (
                    <span className="block text-xs text-gray-400 mt-1">
                      Versión {activeTermsVersion.version_number} · vigente desde{' '}
                      {new Date(activeTermsVersion.published_at).toLocaleDateString('es-MX', { day: '2-digit', month: 'long', year: 'numeric' })}
                    </span>
                  )}
                </span>
              </label>
            </div>

            <button
              type="submit"
              disabled={isLoading || !termsAccepted}
              className="w-full flex justify-center py-2.5 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-primary-600 hover:bg-primary-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-500 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isLoading ? 'Completando registro...' : 'Crear cuenta de Viajero'}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
};

export default GoogleTravelerSignupPage;
