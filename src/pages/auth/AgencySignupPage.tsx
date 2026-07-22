import React, { useState, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { signUp, supabase } from '../../lib/supabase';
import { UserRole } from '../../lib/supabase';
import { useFieldAvailability } from '../../hooks/useFieldAvailability';
import AgencySignupFormBody, {
  AgencyFormData,
  defaultAgencyFormData,
} from './AgencySignupFormBody';

const isLeakedPasswordError = (message: string) =>
  /leaked|pwned|compromised|common password/i.test(message);

const AgencySignupPage: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [activeTermsVersion, setActiveTermsVersion] = useState<{ version_number: number; published_at: string } | null>(null);
  const [formData, setFormData] = useState<AgencyFormData>(defaultAgencyFormData);

  const searchParams = new URLSearchParams(location.search);
  const redirectUrl = searchParams.get('redirect');

  useEffect(() => {
    supabase.rpc('get_active_terms', { p_type: 'agency' }).then(({ data }) => {
      if (data && data.length > 0) setActiveTermsVersion(data[0]);
    });
  }, []);

  const curpAvailability = useFieldAvailability(formData.curp, 'check_curp_available', 18, 18, 'agency');
  const emailAvailability = useFieldAvailability(formData.email, 'check_email_available', 5);

  const handleChange = (field: keyof AgencyFormData, value: string) => {
    setFormData(prev => ({ ...prev, [field]: value }));
  };

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setIsLoading(true);
    setError('');

    const {
      firstName, apellidoPaterno, sexo, email, password, confirmPassword,
      agencyName, website, rfc, razonSocial, personaType, representanteLegalNombre,
    } = formData;

    if (password.trim() !== confirmPassword.trim()) { setError('Las contraseñas no coinciden'); setIsLoading(false); return; }
    if (!firstName.trim()) { setError('El nombre es obligatorio'); setIsLoading(false); return; }
    if (!apellidoPaterno.trim()) { setError('El apellido paterno es obligatorio'); setIsLoading(false); return; }
    if (!sexo) { setError('El sexo es obligatorio'); setIsLoading(false); return; }
    if (!agencyName.trim()) { setError('El nombre de la agencia es obligatorio'); setIsLoading(false); return; }
    if (!website.trim()) { setError('El sitio web o página de Facebook es obligatorio'); setIsLoading(false); return; }
    if (!rfc.trim()) { setError('El RFC es obligatorio'); setIsLoading(false); return; }
    if (!razonSocial.trim()) { setError('La razón social es obligatoria'); setIsLoading(false); return; }
    if (!personaType) { setError('El tipo de persona es obligatorio'); setIsLoading(false); return; }
    if (!representanteLegalNombre.trim()) { setError('El nombre de quien firma el contrato es obligatorio'); setIsLoading(false); return; }

    // Validar RFC contra el SAT antes de avanzar a la firma del contrato
    if (rfc.trim() && razonSocial.trim() && formData.regimenFiscal) {
      setIsLoading(true);
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session) throw new Error('No hay sesión activa');

        const validateRes = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/validate-agency-rfc`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${session.access_token}`,
          },
          body: JSON.stringify({
            rfc: rfc.trim(),
            razon_social: razonSocial.trim(),
            regimen_fiscal: formData.regimenFiscal,
            postal_code: formData.postalCode || undefined,
          }),
        });

        if (!validateRes.ok) {
          const errData = await validateRes.json().catch(() => ({}));
          throw new Error(errData.error || `Error validando RFC (${validateRes.status})`);
        }

        const validateData = await validateRes.json();
        if (!validateData.valid) {
          const errMsg = validateData.message
            || (Array.isArray(validateData.errors)
              ? validateData.errors.map((e: { message: string }) => e.message).join('; ')
              : 'El RFC no es válido según el SAT');
          setError(errMsg);
          setIsLoading(false);
          return;
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Error validando RFC contra el SAT');
        setIsLoading(false);
        return;
      }
    }

    try {
      const { data, error: signUpError, profileData, isExistingUser } = await signUp(email, password, UserRole.AGENCY);

      if (signUpError) {
        if (isLeakedPasswordError(signUpError.message)) {
          throw new Error('Esta contraseña ha sido expuesta en brechas de datos conocidas y no puede usarse. Por favor elige una contraseña diferente y más segura.');
        }
        throw signUpError;
      }

      if (!data.user) throw new Error('No se pudo crear el usuario');

      // Registrar aceptación de T&C
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (session) {
          await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/record-terms-acceptance`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${session.access_token}` },
            body: JSON.stringify({ terms_type: 'agency' }),
          });
        }
      } catch { /* best-effort */ }

      // Crear perfil de usuario y agencia en una sola transacción Postgres.
      const { error: onboardingError } = await supabase.rpc('complete_agency_onboarding', {
        p_first_name:                  formData.firstName.trim(),
        p_apellido_paterno:            formData.apellidoPaterno.trim(),
        p_apellido_materno:            formData.apellidoMaterno.trim() || null,
        p_date_of_birth:               formData.dateOfBirth || null,
        p_sexo:                        formData.sexo || null,
        p_curp:                        formData.curp.trim() || null,
        p_phone_number:                formData.phoneNumber.trim() || null,
        p_email:                       email,
        p_agency_name:                 formData.agencyName.trim(),
        p_rfc:                         formData.rfc.trim(),
        p_razon_social:                formData.razonSocial.trim(),
        p_persona_type:                formData.personaType,
        p_representante_legal_nombre:  formData.representanteLegalNombre.trim(),
        p_website:                     formData.website.trim(),
        p_contact_phone:               formData.phoneNumber || null,
        p_rnt:                         formData.rnt || null,
        p_regimen_fiscal:              formData.regimenFiscal || null,
        p_banco:                       formData.banco || null,
        p_cuenta_clabe:                formData.cuentaClabe || null,
        p_titular_cuenta:              formData.titularCuenta || null,
        p_street:                      formData.street || null,
        p_exterior_number:             formData.exteriorNumber || null,
        p_interior_number:             formData.interiorNumber || null,
        p_colony:                      formData.colony || null,
        p_city:                        formData.city || null,
        p_state:                       formData.state || null,
        p_postal_code:                 formData.postalCode || null,
        p_country:                     formData.country || 'México',
      });

      if (onboardingError) throw new Error(onboardingError.message);

      // Enviar emails
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (session) {
          await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/send-agency-registration-admin`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${session.access_token}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ agencyName: formData.agencyName.trim(), email, firstName: formData.firstName, lastName: formData.apellidoPaterno, phone: formData.phoneNumber || null }),
          });
          await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/send-agency-welcome`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${session.access_token}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, firstName: formData.firstName, agencyName: formData.agencyName.trim() }),
          });
        }
      } catch { /* best-effort */ }

      if (isExistingUser) {
        setError('Usuario ya registrado. Se ha iniciado sesión automáticamente y se creó el perfil de agencia.');
        setTimeout(() => navigate('/dashboard'), 2000);
      } else {
        // Enviar código de verificación
        const verificationCode = Math.floor(100000 + Math.random() * 900000).toString();
        const expiresAt = new Date();
        expiresAt.setHours(expiresAt.getHours() + 24);

        await supabase.from('users').update({
          verification_code: verificationCode,
          verification_code_expires_at: expiresAt.toISOString(),
          verification_code_attempts: 0,
        }).eq('id', data.user.id);

        try {
          const { data: { session } } = await supabase.auth.getSession();
          if (session) {
            await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/send-verification-email`, {
              method: 'POST',
              headers: { 'Authorization': `Bearer ${session.access_token}`, 'Content-Type': 'application/json' },
              body: JSON.stringify({ userId: data.user.id, verificationCode, userName: formData.agencyName }),
            });
          }
        } catch { /* best-effort */ }

        const postVerifyRedirect = redirectUrl ?? '/agency/onboarding';
        navigate(`/verify-email?redirect=${encodeURIComponent(postVerifyRedirect)}`);
      }
    } catch (err: any) {
      setError(err.message || 'Ocurrió un error durante el registro');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <AgencySignupFormBody
      formData={formData}
      onChange={handleChange}
      onSubmit={handleSubmit}
      isLoading={isLoading}
      error={error}
      termsAccepted={termsAccepted}
      setTermsAccepted={setTermsAccepted}
      activeTermsVersion={activeTermsVersion}
      showPassword={showPassword}
      setShowPassword={setShowPassword}
      showConfirmPassword={showConfirmPassword}
      setShowConfirmPassword={setShowConfirmPassword}
      curpAvailability={curpAvailability}
      emailAvailability={emailAvailability}
      emailReadOnly={false}
      oauthProviderLabel={null}
      submitLabel="Registrar Agencia"
    />
  );
};

export default AgencySignupPage;
