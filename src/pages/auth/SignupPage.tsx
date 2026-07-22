import React, { useState, useEffect, useRef } from 'react';
import { useNavigate, Link, useLocation } from 'react-router-dom';
import { Eye, EyeOff, CheckCircle, XCircle, Loader } from 'lucide-react';
import { signUp, supabase, UserRole } from '../../lib/supabase';
import { calcularPrefijoCurp } from '../../utils/curpUtils';
import { useFieldAvailability } from '../../hooks/useFieldAvailability';

const isLeakedPasswordError = (message: string) =>
  /leaked|pwned|compromised|common password/i.test(message);

const SignupPage: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [isForeignTraveler, setIsForeignTraveler] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [referralCode, setReferralCode] = useState('');
  const [isValidatingReferral, setIsValidatingReferral] = useState(false);
  const [referralValidation, setReferralValidation] = useState<{
    valid: boolean;
    message: string;
    referrer_name?: string;
    referrer_id?: string;
  } | null>(null);
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [activeTermsVersion, setActiveTermsVersion] = useState<{ version_number: number; published_at: string } | null>(null);

  const searchParams = new URLSearchParams(location.search);
  const redirectUrl = searchParams.get('redirect');
  const refCode = searchParams.get('ref');
  const invitationToken = searchParams.get('invitation_token');
  const invitationEmail = searchParams.get('email');

  const [formData, setFormData] = useState({
    firstName: '',
    apellidoPaterno: '',
    apellidoMaterno: '',
    sexo: '' as '' | 'masculino' | 'femenino' | 'no_binario',
    email: invitationEmail || '',
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
    country: 'México'
  });

  // Track if the user has manually edited the CURP field
  const curpManuallyEdited = useRef(false);
  const lastAutofillPrefix = useRef('');

  useEffect(() => {
    if (refCode) {
      setReferralCode(refCode.toUpperCase());
    }
  }, [refCode]);

  useEffect(() => {
    supabase.rpc('get_active_terms', { p_type: 'traveler' }).then(({ data }) => {
      if (data && data.length > 0) setActiveTermsVersion(data[0]);
    });
  }, []);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
    const { name, value } = e.target;
    if (name === 'curp') {
      curpManuallyEdited.current = true;
    }
    setFormData(prev => ({
      ...prev,
      [name]: name === 'curp' || name === 'passportNumber' ? value.toUpperCase() : value
    }));
  };

  // Auto-fill CURP prefix when enough data is available (only for national travelers)
  useEffect(() => {
    if (isForeignTraveler) return;
    if (curpManuallyEdited.current) return;
    const { firstName, apellidoPaterno, apellidoMaterno, dateOfBirth, sexo } = formData;
    if (!firstName || !apellidoPaterno || !dateOfBirth || !sexo) return;
    const prefix = calcularPrefijoCurp(firstName, apellidoPaterno, apellidoMaterno, dateOfBirth, sexo);
    if (prefix && prefix !== lastAutofillPrefix.current) {
      lastAutofillPrefix.current = prefix;
      setFormData(prev => ({
        ...prev,
        curp: prefix
      }));
    }
  }, [formData.firstName, formData.apellidoPaterno, formData.apellidoMaterno, formData.dateOfBirth, formData.sexo, isForeignTraveler]);

  const validateReferralCode = async (code: string) => {
    if (!code || code.trim().length === 0) {
      setReferralValidation(null);
      return;
    }

    setIsValidatingReferral(true);
    try {
      const response = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/validate-referral-code`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`,
          },
          body: JSON.stringify({ code: code.trim().toLowerCase() }),
        }
      );

      const data = await response.json();
      setReferralValidation(data);
    } catch (err) {
      console.error('Error validating referral code:', err);
      setReferralValidation({
        valid: false,
        message: 'Error al validar código'
      });
    } finally {
      setIsValidatingReferral(false);
    }
  };

  useEffect(() => {
    const timeoutId = setTimeout(() => {
      if (referralCode && referralCode.trim().length >= 4) {
        validateReferralCode(referralCode);
      } else {
        setReferralValidation(null);
      }
    }, 500);

    return () => clearTimeout(timeoutId);
  }, [referralCode]);

  const curpAvailability = useFieldAvailability(
    !isForeignTraveler ? formData.curp : '',
    'check_curp_available',
    18,
    18,
    'traveler'
  );
  const passportAvailability = useFieldAvailability(
    isForeignTraveler ? formData.passportNumber : '',
    'check_passport_available',
    6
  );
  const emailAvailability = useFieldAvailability(
    formData.email,
    'check_email_available',
    5
  );

  const identifierUnavailable =
    (!isForeignTraveler && curpAvailability.isAvailable === false) ||
    (isForeignTraveler && passportAvailability.isAvailable === false) ||
    emailAvailability.isAvailable === false;

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setIsLoading(true);
    setError('');

    const { email, password, confirmPassword, firstName, apellidoPaterno, apellidoMaterno, sexo, phoneNumber, curp, passportNumber, dateOfBirth, street, exteriorNumber, interiorNumber, colony, city, state, postalCode, country } = formData;
    const lastName = apellidoPaterno;

    if (password !== confirmPassword) {
      setError('Las contraseñas no coinciden');
      setIsLoading(false);
      return;
    }

    if (!phoneNumber.trim()) {
      setError('El número de celular es requerido');
      setIsLoading(false);
      return;
    }

    if (isForeignTraveler && !passportNumber.trim()) {
      setError('El número de pasaporte es requerido para viajeros extranjeros');
      setIsLoading(false);
      return;
    }

    if (!isForeignTraveler && !curp.trim()) {
      setError('La CURP es requerida para viajeros nacionales');
      setIsLoading(false);
      return;
    }

    if (!isForeignTraveler && curp.length !== 18) {
      setError('La CURP debe tener 18 caracteres');
      setIsLoading(false);
      return;
    }

    try {
      console.log('🚀 Iniciando registro de viajero...');

      const { data, error, profileData, isExistingUser } = await signUp(
        email,
        password,
        UserRole.TRAVELER,
        {
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
          country: country || 'México'
        }
      );

      if (error) {
        if (error.message === 'CURP_DUPLICADO') {
          throw new Error('Este CURP ya se encuentra asociado a otra cuenta. Si ya tienes una cuenta, por favor inicia sesión.');
        }
        if (error.message === 'PASAPORTE_DUPLICADO') {
          throw new Error('Este número de pasaporte ya se encuentra asociado a otra cuenta. Si ya tienes una cuenta, por favor inicia sesión.');
        }
        if (isLeakedPasswordError(error.message)) {
          throw new Error('Esta contraseña ha sido expuesta en brechas de datos conocidas y no puede usarse. Por favor elige una contraseña diferente y más segura.');
        }
        throw error;
      }

      if (!data.user) {
        throw new Error('No se pudo crear el usuario');
      }

      console.log('✅ Registro exitoso:', { user: data.user, profile: profileData, isExistingUser });

      // Registrar aceptación de T&C con IP real capturada en el servidor
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (session) {
          await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/record-terms-acceptance`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${session.access_token}`,
            },
            body: JSON.stringify({ terms_type: 'traveler' }),
          });
        }
      } catch (termsErr) {
        console.error('Error registrando aceptación de T&C:', termsErr);
      }

      // Aceptar invitacion de coordinador si existe un token en la URL
      if (invitationToken && !isExistingUser) {
        try {
          const { error: invErr } = await supabase.rpc('accept_staff_invitation', {
            p_token: invitationToken,
          });
          if (invErr) {
            console.error('Error aceptando invitacion de coordinador:', invErr);
          }
        } catch (invitationErr) {
          console.error('Error procesando invitacion de coordinador:', invitationErr);
        }
      }

      if (referralValidation?.valid && referralValidation.referrer_id && !isExistingUser) {
        try {
          const { error: referrerUpdateError } = await supabase
            .from('users')
            .update({
              referred_by_user_id: referralValidation.referrer_id,
              referral_code_used: referralCode.trim().toLowerCase()
            })
            .eq('id', data.user.id);

          if (referrerUpdateError) {
            console.error('Error updating referrer info:', referrerUpdateError);
          }

          const { error: relationshipError } = await supabase
            .from('referral_relationships')
            .insert({
              referrer_user_id: referralValidation.referrer_id,
              referred_user_id: data.user.id,
              referral_code_used: referralCode.trim().toLowerCase(),
              status: 'pending'
            });

          if (relationshipError) {
            console.error('Error creating referral relationship:', relationshipError);
          } else {
            await supabase.from('notifications').insert({
              user_id: referralValidation.referrer_id,
              type: 'referral_signup',
              title: '¡Nuevo referido!',
              message: `${firstName} ${lastName} se ha registrado usando tu código de referido`,
              data: {}
            });

            try {
              const { data: referrerData } = await supabase
                .from('users')
                .select('email, first_name, last_name')
                .eq('id', referralValidation.referrer_id)
                .single();

              if (referrerData) {
                const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/send-referral-signup-notification`, {
                  method: 'POST',
                  headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`
                  },
                  body: JSON.stringify({
                    referrerEmail: referrerData.email,
                    referrerName: referrerData.first_name && referrerData.last_name
                      ? `${referrerData.first_name} ${referrerData.last_name}`
                      : referrerData.email,
                    referredName: `${firstName} ${lastName}`,
                    referralCode: referralCode.trim().toLowerCase()
                  })
                });

                if (!response.ok) {
                  console.error('Error sending referral signup email:', await response.text());
                }
              }
            } catch (emailError) {
              console.error('Error sending referral signup email:', emailError);
            }
          }
        } catch (refError) {
          console.error('Error processing referral:', refError);
        }
      }

      if (isExistingUser) {
        setError('Usuario ya registrado. Se ha iniciado sesión automáticamente.');
        setTimeout(() => navigate('/dashboard'), 2000);
      } else {
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
          .eq('id', data.user.id);

        if (updateError) {
          console.error('Error actualizando código de verificación:', updateError);
        }

        try {
          const { data: { session } } = await supabase.auth.getSession();

          if (session) {
            await fetch(
              `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/send-verification-email`,
              {
                method: 'POST',
                headers: {
                  'Authorization': `Bearer ${session.access_token}`,
                  'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                  userId: data.user.id,
                  verificationCode: verificationCode,
                  userName: `${firstName} ${lastName}`.trim(),
                }),
              }
            );
          }
        } catch (emailError) {
          console.error('Error enviando correo de verificación:', emailError);
        }

        if (redirectUrl) {
          navigate(`/verify-email?redirect=${encodeURIComponent(redirectUrl)}`);
        } else {
          navigate('/verify-email');
        }
      }
    } catch (err: any) {
      console.error('❌ Error en registro:', err);
      setError(err.message || 'Ocurrió un error durante el registro');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col justify-center py-12 px-4 sm:px-6 lg:px-8">
      <div className="sm:mx-auto sm:w-full sm:max-w-md">
        <h2 className="mt-6 text-center text-3xl font-extrabold text-gray-900">
          Crea tu cuenta
        </h2>
        <p className="mt-2 text-center text-sm text-gray-600">
          O{' '}
          <Link to="/login" className="font-medium text-primary-600 hover:text-primary-500">
            inicia sesión en tu cuenta existente
          </Link>
        </p>
      </div>

      <div className="mt-8 sm:mx-auto sm:w-full sm:max-w-md">
        <div className="bg-white py-8 px-4 shadow sm:rounded-lg sm:px-10">
          {error && (
            <div className={`mb-4 border rounded-md p-3 ${
              error.includes('ya registrado') 
                ? 'bg-yellow-50 border-yellow-200 text-yellow-700' 
                : 'bg-red-50 border-red-200 text-red-600'
            }`}>
              {error}
            </div>
          )}

          <form className="space-y-6" onSubmit={handleSubmit}>
            {/* 1. Nacionalidad */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Tipo de viajero
              </label>
              <div className="flex items-center space-x-4">
                <label className="flex items-center cursor-pointer">
                  <input
                    type="radio"
                    checked={!isForeignTraveler}
                    onChange={() => setIsForeignTraveler(false)}
                    className="h-4 w-4 text-primary-600 focus:ring-primary-500 border-gray-300"
                  />
                  <span className="ml-2 text-sm font-medium text-gray-700">Viajero Nacional</span>
                </label>
                <label className="flex items-center cursor-pointer">
                  <input
                    type="radio"
                    checked={isForeignTraveler}
                    onChange={() => setIsForeignTraveler(true)}
                    className="h-4 w-4 text-primary-600 focus:ring-primary-500 border-gray-300"
                  />
                  <span className="ml-2 text-sm font-medium text-gray-700">Viajero Extranjero</span>
                </label>
              </div>
            </div>

            {/* 2. Nombre(s) */}
            <div>
              <label htmlFor="firstName" className="block text-sm font-medium text-gray-700">
                Nombre(s)
              </label>
              <div className="mt-1">
                <input
                  id="firstName"
                  name="firstName"
                  type="text"
                  value={formData.firstName}
                  onChange={handleInputChange}
                  required
                  className="appearance-none block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm placeholder-gray-400 focus:outline-none focus:ring-primary-500 focus:border-primary-500 sm:text-sm"
                />
              </div>
            </div>

            {/* 3. Apellidos */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label htmlFor="apellidoPaterno" className="block text-sm font-medium text-gray-700">
                  Apellido Paterno
                </label>
                <div className="mt-1">
                  <input
                    id="apellidoPaterno"
                    name="apellidoPaterno"
                    type="text"
                    value={formData.apellidoPaterno}
                    onChange={handleInputChange}
                    required
                    className="appearance-none block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm placeholder-gray-400 focus:outline-none focus:ring-primary-500 focus:border-primary-500 sm:text-sm"
                  />
                </div>
              </div>

              <div>
                <label htmlFor="apellidoMaterno" className="flex items-baseline gap-1 text-sm font-medium text-gray-700">
                  Apellido Materno
                  <span className="text-gray-400 font-normal text-xs">(opcional)</span>
                </label>
                <div className="mt-1">
                  <input
                    id="apellidoMaterno"
                    name="apellidoMaterno"
                    type="text"
                    value={formData.apellidoMaterno}
                    onChange={handleInputChange}
                    className="appearance-none block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm placeholder-gray-400 focus:outline-none focus:ring-primary-500 focus:border-primary-500 sm:text-sm"
                  />
                </div>
              </div>
            </div>

            {/* 4. Fecha de Nacimiento */}
            <div>
              <label htmlFor="dateOfBirth" className="block text-sm font-medium text-gray-700">
                Fecha de Nacimiento
              </label>
              <div className="mt-1">
                <input
                  id="dateOfBirth"
                  name="dateOfBirth"
                  type="date"
                  value={formData.dateOfBirth}
                  onChange={handleInputChange}
                  required
                  className="appearance-none block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm placeholder-gray-400 focus:outline-none focus:ring-primary-500 focus:border-primary-500 sm:text-sm"
                />
              </div>
            </div>

            {/* 5. Sexo */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Sexo
              </label>
              <div className="grid grid-cols-3 gap-2">
                {(['masculino', 'femenino', 'no_binario'] as const).map((opcion) => (
                  <label
                    key={opcion}
                    className={`flex items-center justify-center px-3 py-2 border rounded-md cursor-pointer text-sm font-medium transition-colors ${
                      formData.sexo === opcion
                        ? 'border-primary-500 bg-primary-50 text-primary-700'
                        : 'border-gray-300 bg-white text-gray-700 hover:bg-gray-50'
                    }`}
                  >
                    <input
                      type="radio"
                      name="sexo"
                      value={opcion}
                      checked={formData.sexo === opcion}
                      onChange={handleInputChange}
                      className="sr-only"
                      required
                    />
                    {opcion === 'masculino' ? 'Masculino' : opcion === 'femenino' ? 'Femenino' : 'No Binario'}
                  </label>
                ))}
              </div>
            </div>

            {/* 6. CURP / Pasaporte */}
            {!isForeignTraveler ? (
              <div>
                <label htmlFor="curp" className="block text-sm font-medium text-gray-700">
                  CURP
                </label>
                <div className="mt-1">
                  <input
                    id="curp"
                    name="curp"
                    type="text"
                    value={formData.curp}
                    onChange={handleInputChange}
                    placeholder="Ej: ABCD123456HDFRRL09"
                    maxLength={18}
                    required
                    className="appearance-none block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm placeholder-gray-400 focus:outline-none focus:ring-primary-500 focus:border-primary-500 sm:text-sm uppercase"
                  />
                  {!curpManuallyEdited.current && formData.curp.length > 0 && formData.curp.length < 18 && (
                    <p className="mt-1 text-xs text-blue-600">
                      Prellenado con tus datos. Completa o corrige los caracteres restantes.
                    </p>
                  )}
                  {formData.curp.length < 18 && (curpManuallyEdited.current || formData.curp.length === 0) && (
                    <p className="mt-1 text-xs text-gray-500">18 caracteres alfanuméricos</p>
                  )}
                  {curpAvailability.isChecking && (
                    <p className="mt-1 text-xs text-gray-500 flex items-center gap-1">
                      <Loader className="h-3 w-3 animate-spin" /> Verificando CURP...
                    </p>
                  )}
                  {!curpAvailability.isChecking && curpAvailability.isAvailable === true && (
                    <p className="mt-1 text-xs text-green-600 flex items-center gap-1">
                      <CheckCircle className="h-3 w-3" /> CURP disponible
                    </p>
                  )}
                  {!curpAvailability.isChecking && curpAvailability.isAvailable === false && (
                    <p className="mt-1 text-xs text-red-600 flex items-center gap-1">
                      <XCircle className="h-3 w-3" /> Esta CURP ya tiene una cuenta. <a href="/login" className="underline">Inicia sesión</a>
                    </p>
                  )}
                </div>
              </div>
            ) : (
              <div>
                <label htmlFor="passportNumber" className="block text-sm font-medium text-gray-700">
                  Número de Pasaporte
                </label>
                <div className="mt-1">
                  <input
                    id="passportNumber"
                    name="passportNumber"
                    type="text"
                    value={formData.passportNumber}
                    onChange={handleInputChange}
                    placeholder="Ej: A12345678"
                    required
                    className="appearance-none block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm placeholder-gray-400 focus:outline-none focus:ring-primary-500 focus:border-primary-500 sm:text-sm uppercase"
                  />
                  {passportAvailability.isChecking && (
                    <p className="mt-1 text-xs text-gray-500 flex items-center gap-1">
                      <Loader className="h-3 w-3 animate-spin" /> Verificando pasaporte...
                    </p>
                  )}
                  {!passportAvailability.isChecking && passportAvailability.isAvailable === true && (
                    <p className="mt-1 text-xs text-green-600 flex items-center gap-1">
                      <CheckCircle className="h-3 w-3" /> Pasaporte disponible
                    </p>
                  )}
                  {!passportAvailability.isChecking && passportAvailability.isAvailable === false && (
                    <p className="mt-1 text-xs text-red-600 flex items-center gap-1">
                      <XCircle className="h-3 w-3" /> Este pasaporte ya tiene una cuenta. <a href="/login" className="underline">Inicia sesión</a>
                    </p>
                  )}
                </div>
              </div>
            )}

            {/* 7. Email */}
            <div>
              <label htmlFor="email" className="block text-sm font-medium text-gray-700">
                Correo electrónico
              </label>
              <div className="mt-1">
                <input
                  id="email"
                  name="email"
                  type="email"
                  value={formData.email}
                  onChange={handleInputChange}
                  autoComplete="email"
                  required
                  className="appearance-none block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm placeholder-gray-400 focus:outline-none focus:ring-primary-500 focus:border-primary-500 sm:text-sm"
                />
                {emailAvailability.isChecking && (
                  <p className="mt-1 text-xs text-gray-500 flex items-center gap-1">
                    <Loader className="h-3 w-3 animate-spin" /> Verificando correo...
                  </p>
                )}
                {!emailAvailability.isChecking && emailAvailability.isAvailable === true && (
                  <p className="mt-1 text-xs text-green-600 flex items-center gap-1">
                    <CheckCircle className="h-3 w-3" /> Correo disponible
                  </p>
                )}
                {!emailAvailability.isChecking && emailAvailability.isAvailable === false && (
                  <p className="mt-1 text-xs text-red-600 flex items-center gap-1">
                    <XCircle className="h-3 w-3" /> Este correo ya tiene una cuenta. <a href="/login" className="underline">Inicia sesión</a>
                  </p>
                )}
              </div>
            </div>

            {/* 8. Celular */}
            <div>
              <label htmlFor="phoneNumber" className="block text-sm font-medium text-gray-700">
                Número de celular
              </label>
              <div className="mt-1">
                <input
                  id="phoneNumber"
                  name="phoneNumber"
                  type="tel"
                  value={formData.phoneNumber}
                  onChange={handleInputChange}
                  placeholder="Ej: +52 55 1234 5678"
                  required
                  className="appearance-none block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm placeholder-gray-400 focus:outline-none focus:ring-primary-500 focus:border-primary-500 sm:text-sm"
                />
              </div>
            </div>

            <div className="space-y-4">
              <div className="border-t pt-4">
                <h3 className="text-sm font-medium text-gray-900 mb-3">Domicilio</h3>

                <div className="space-y-3">
                  <div>
                    <label htmlFor="street" className="block text-sm font-medium text-gray-700">
                      Calle
                    </label>
                    <input
                      id="street"
                      name="street"
                      type="text"
                      value={formData.street}
                      onChange={handleInputChange}
                      placeholder="Ej: Av. Insurgentes Sur"
                      required
                      className="mt-1 appearance-none block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm placeholder-gray-400 focus:outline-none focus:ring-primary-500 focus:border-primary-500 sm:text-sm"
                    />
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label htmlFor="exteriorNumber" className="block text-sm font-medium text-gray-700">
                        Número Exterior
                      </label>
                      <input
                        id="exteriorNumber"
                        name="exteriorNumber"
                        type="text"
                        value={formData.exteriorNumber}
                        onChange={handleInputChange}
                        placeholder="Ej: 123"
                        required
                        className="mt-1 appearance-none block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm placeholder-gray-400 focus:outline-none focus:ring-primary-500 focus:border-primary-500 sm:text-sm"
                      />
                    </div>

                    <div>
                      <label htmlFor="interiorNumber" className="block text-sm font-medium text-gray-700">
                        Número Interior
                        <span className="text-gray-400 font-normal ml-1">(opcional)</span>
                      </label>
                      <input
                        id="interiorNumber"
                        name="interiorNumber"
                        type="text"
                        value={formData.interiorNumber}
                        onChange={handleInputChange}
                        placeholder="Ej: 4B"
                        className="mt-1 appearance-none block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm placeholder-gray-400 focus:outline-none focus:ring-primary-500 focus:border-primary-500 sm:text-sm"
                      />
                    </div>
                  </div>

                  <div>
                    <label htmlFor="colony" className="block text-sm font-medium text-gray-700">
                      Colonia
                    </label>
                    <input
                      id="colony"
                      name="colony"
                      type="text"
                      value={formData.colony}
                      onChange={handleInputChange}
                      placeholder="Ej: Roma Norte"
                      required
                      className="mt-1 appearance-none block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm placeholder-gray-400 focus:outline-none focus:ring-primary-500 focus:border-primary-500 sm:text-sm"
                    />
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label htmlFor="city" className="block text-sm font-medium text-gray-700">
                        Ciudad
                      </label>
                      <input
                        id="city"
                        name="city"
                        type="text"
                        value={formData.city}
                        onChange={handleInputChange}
                        placeholder="Ej: Ciudad de México"
                        required
                        className="mt-1 appearance-none block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm placeholder-gray-400 focus:outline-none focus:ring-primary-500 focus:border-primary-500 sm:text-sm"
                      />
                    </div>

                    <div>
                      <label htmlFor="state" className="block text-sm font-medium text-gray-700">
                        Estado
                      </label>
                      <input
                        id="state"
                        name="state"
                        type="text"
                        value={formData.state}
                        onChange={handleInputChange}
                        placeholder="Ej: CDMX"
                        required
                        className="mt-1 appearance-none block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm placeholder-gray-400 focus:outline-none focus:ring-primary-500 focus:border-primary-500 sm:text-sm"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label htmlFor="postalCode" className="block text-sm font-medium text-gray-700">
                        Código Postal
                      </label>
                      <input
                        id="postalCode"
                        name="postalCode"
                        type="text"
                        value={formData.postalCode}
                        onChange={handleInputChange}
                        placeholder="Ej: 06700"
                        required
                        maxLength={5}
                        className="mt-1 appearance-none block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm placeholder-gray-400 focus:outline-none focus:ring-primary-500 focus:border-primary-500 sm:text-sm"
                      />
                    </div>

                    <div>
                      <label htmlFor="country" className="block text-sm font-medium text-gray-700">
                        País
                      </label>
                      <input
                        id="country"
                        name="country"
                        type="text"
                        value={formData.country}
                        onChange={handleInputChange}
                        placeholder="México"
                        required
                        className="mt-1 appearance-none block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm placeholder-gray-400 focus:outline-none focus:ring-primary-500 focus:border-primary-500 sm:text-sm"
                      />
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <div>
              <label htmlFor="referralCode" className="block text-sm font-medium text-gray-700">
                Código de Referido <span className="text-gray-400 font-normal">(Opcional)</span>
              </label>
              <div className="mt-1 relative">
                <input
                  id="referralCode"
                  name="referralCode"
                  type="text"
                  value={referralCode}
                  onChange={(e) => setReferralCode(e.target.value.toLowerCase())}
                  placeholder="Ej: juan_perez"
                  maxLength={20}
                  className="appearance-none block w-full px-3 py-2 pr-10 border border-gray-300 rounded-md shadow-sm placeholder-gray-400 focus:outline-none focus:ring-primary-500 focus:border-primary-500 sm:text-sm lowercase"
                />
                {isValidatingReferral && (
                  <div className="absolute inset-y-0 right-0 pr-3 flex items-center pointer-events-none">
                    <Loader className="h-5 w-5 text-gray-400 animate-spin" />
                  </div>
                )}
                {!isValidatingReferral && referralValidation && (
                  <div className="absolute inset-y-0 right-0 pr-3 flex items-center pointer-events-none">
                    {referralValidation.valid ? (
                      <CheckCircle className="h-5 w-5 text-green-500" />
                    ) : (
                      <XCircle className="h-5 w-5 text-red-500" />
                    )}
                  </div>
                )}
              </div>
              {referralValidation && (
                <p className={`mt-1 text-sm ${referralValidation.valid ? 'text-green-600' : 'text-red-600'}`}>
                  {referralValidation.valid && referralValidation.referrer_name
                    ? `Código válido - Referido por ${referralValidation.referrer_name}`
                    : referralValidation.message}
                </p>
              )}
              {!referralValidation && !isValidatingReferral && (
                <p className="mt-1 text-xs text-gray-500">
                  Gana 5,000 puntos al completar tu primera reserva
                </p>
              )}
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
                  value={formData.password}
                  onChange={handleInputChange}
                  autoComplete="new-password"
                  required
                  className="appearance-none block w-full px-3 py-2 pr-10 border border-gray-300 rounded-md shadow-sm placeholder-gray-400 focus:outline-none focus:ring-primary-500 focus:border-primary-500 sm:text-sm"
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

            <div>
              <label htmlFor="confirmPassword" className="block text-sm font-medium text-gray-700">
                Confirmar Contraseña
              </label>
              <div className="mt-1 relative">
                <input
                  id="confirmPassword"
                  name="confirmPassword"
                  type={showConfirmPassword ? 'text' : 'password'}
                  value={formData.confirmPassword}
                  onChange={handleInputChange}
                  autoComplete="new-password"
                  required
                  className="appearance-none block w-full px-3 py-2 pr-10 border border-gray-300 rounded-md shadow-sm placeholder-gray-400 focus:outline-none focus:ring-primary-500 focus:border-primary-500 sm:text-sm"
                />
                <button
                  type="button"
                  onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                  className="absolute inset-y-0 right-0 pr-3 flex items-center text-gray-400 hover:text-gray-600"
                >
                  {showConfirmPassword ? (
                    <EyeOff className="h-5 w-5" />
                  ) : (
                    <Eye className="h-5 w-5" />
                  )}
                </button>
              </div>
            </div>

            {/* Aceptación explícita de T&C */}
            <div className="rounded-lg border border-gray-200 bg-gray-50 p-4">
              <label className="flex items-start gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={termsAccepted}
                  onChange={e => setTermsAccepted(e.target.checked)}
                  className="mt-0.5 h-4 w-4 text-primary-600 border-gray-300 rounded focus:ring-primary-500 flex-shrink-0"
                />
                <span className="text-sm text-gray-700 leading-relaxed">
                  He leído y acepto los{' '}
                  <Link to="/terminos-servicio" target="_blank" className="font-medium text-primary-600 hover:text-primary-500 underline">
                    Términos y Condiciones
                  </Link>{' '}
                  y el{' '}
                  <Link to="/aviso-privacidad" target="_blank" className="font-medium text-primary-600 hover:text-primary-500 underline">
                    Aviso de Privacidad
                  </Link>{' '}
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

            <div>
              <button
                type="submit"
                disabled={isLoading || !termsAccepted || identifierUnavailable}
                className="w-full flex justify-center py-2 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-primary-600 hover:bg-primary-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-500 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isLoading ? 'Creando cuenta...' : 'Registrarse'}
              </button>
            </div>
          </form>

          <div className="mt-6">
            <div className="relative">
              <div className="absolute inset-0 flex items-center">
                <div className="w-full border-t border-gray-300" />
              </div>
              <div className="relative flex justify-center text-sm">
                <span className="px-2 bg-white text-gray-500">¿Eres una agencia de viajes?</span>
              </div>
            </div>

            <div className="mt-6">
              <Link
                to="/agency-signup"
                className="w-full flex justify-center py-2 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium text-primary-600 bg-primary-50 hover:bg-primary-100 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-500"
              >
                Registrarse como agencia
              </Link>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default SignupPage;