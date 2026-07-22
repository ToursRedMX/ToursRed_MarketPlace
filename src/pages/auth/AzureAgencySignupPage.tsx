import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase, UserRole } from '../../lib/supabase';
import { useAuth } from '../../context/AuthContext';
import { useFieldAvailability } from '../../hooks/useFieldAvailability';
import AgencySignupFormBody, { AgencyFormData, defaultAgencyFormData } from './AgencySignupFormBody';

const isLeakedPasswordError = (message: string) =>
  /leaked|pwned|compromised|common password/i.test(message);

const MicrosoftIcon = (
  <svg viewBox="0 0 23 23" className="w-5 h-5" aria-hidden="true">
    <path fill="#f3f3f3" d="M0 0h23v23H0z"/>
    <path fill="#f35325" d="M1 1h10v10H1z"/>
    <path fill="#81bc06" d="M12 1h10v10H12z"/>
    <path fill="#05a6f0" d="M1 12h10v10H1z"/>
    <path fill="#ffba08" d="M12 12h10v10H12z"/>
  </svg>
);

const AzureAgencySignupPage: React.FC = () => {
  const navigate = useNavigate();
  const { user, completeOnboarding } = useAuth();

  const meta = user?.user_metadata ?? {};
  const azureFullName: string = meta.full_name || meta.name || '';
  const preFirstName = meta.given_name || azureFullName.split(' ')[0] || '';
  const preLastName  = meta.family_name || azureFullName.split(' ').slice(1).join(' ') || '';
  const preEmail     = user?.email || meta.email || '';
  const msAvatarUrl  = meta.ms_avatar_url || '';

  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [activeTermsVersion, setActiveTermsVersion] = useState<{ version_number: number; published_at: string } | null>(null);
  const [formData, setFormData] = useState<AgencyFormData>({
    ...defaultAgencyFormData,
    firstName: preFirstName,
    apellidoPaterno: preLastName,
    email: preEmail,
  });

  useEffect(() => {
    supabase.rpc('get_active_terms', { p_type: 'agency' }).then(({ data }) => {
      if (data && data.length > 0) setActiveTermsVersion(data[0]);
    });
  }, []);

  useEffect(() => {
    if (!user) navigate('/login');
  }, [user, navigate]);

  const curpAvailability = useFieldAvailability(formData.curp, 'check_curp_available', 18, 18, 'agency');

  const handleChange = (field: keyof AgencyFormData, value: string) => {
    setFormData(prev => ({ ...prev, [field]: value }));
  };

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setIsLoading(true);
    setError('');

    const { firstName, apellidoPaterno, sexo, password, confirmPassword,
            agencyName, website, rfc, razonSocial, personaType, representanteLegalNombre } = formData;

    if (!apellidoPaterno.trim()) { setError('El apellido paterno es obligatorio'); setIsLoading(false); return; }
    if (!sexo) { setError('El sexo es obligatorio'); setIsLoading(false); return; }
    if (password !== confirmPassword) { setError('Las contraseñas no coinciden'); setIsLoading(false); return; }
    if (!agencyName.trim()) { setError('El nombre de la agencia es obligatorio'); setIsLoading(false); return; }
    if (!website.trim()) { setError('El sitio web o página de Facebook es obligatorio'); setIsLoading(false); return; }
    if (!rfc.trim()) { setError('El RFC es obligatorio'); setIsLoading(false); return; }
    if (!razonSocial.trim()) { setError('La razón social es obligatoria'); setIsLoading(false); return; }
    if (!personaType) { setError('El tipo de persona es obligatorio'); setIsLoading(false); return; }
    if (!representanteLegalNombre.trim()) { setError('El nombre de quien firma el contrato es obligatorio'); setIsLoading(false); return; }

    try {
      if (!user) throw new Error('Sesión no encontrada');

      // Primero la contraseña: si es débil o filtrada falla antes de escribir en BD.
      const { error: pwError } = await supabase.auth.updateUser({ password });
      if (pwError) {
        if (isLeakedPasswordError(pwError.message)) throw new Error('Esta contraseña ha sido expuesta en brechas de datos. Por favor elige una más segura.');
        throw pwError;
      }

      // Crear perfil de usuario y agencia en una sola transacción Postgres.
      const { error: onboardingError } = await supabase.rpc('complete_agency_onboarding', {
        p_first_name:                  firstName.trim(),
        p_apellido_paterno:            apellidoPaterno.trim(),
        p_apellido_materno:            formData.apellidoMaterno.trim() || null,
        p_date_of_birth:               formData.dateOfBirth || null,
        p_sexo:                        sexo || null,
        p_curp:                        formData.curp.trim() || null,
        p_phone_number:                formData.phoneNumber.trim() || null,
        p_email:                       formData.email,
        p_profile_picture_url:         msAvatarUrl || null,
        p_agency_name:                 agencyName.trim(),
        p_rfc:                         rfc.trim(),
        p_razon_social:                razonSocial.trim(),
        p_persona_type:                personaType,
        p_representante_legal_nombre:  representanteLegalNombre.trim(),
        p_website:                     website.trim(),
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

      await supabase.from('user_auth_providers').upsert(
        { user_id: user.id, provider: 'azure', provider_user_id: user.id },
        { onConflict: 'user_id,provider' }
      );
      await supabase.from('user_auth_providers').upsert(
        { user_id: user.id, provider: 'email' },
        { onConflict: 'user_id,provider' }
      );

      await supabase.auth.updateUser({ data: { onboarding_completed: true, role: UserRole.AGENCY } });

      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (session) {
          await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/record-terms-acceptance`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${session.access_token}` },
            body: JSON.stringify({ terms_type: 'agency' }),
          });
          await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/send-agency-registration-admin`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${session.access_token}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ agencyName: agencyName.trim(), email: formData.email, firstName, lastName: apellidoPaterno, phone: formData.phoneNumber || null }),
          });
          await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/send-agency-welcome`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${session.access_token}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ email: formData.email, firstName, agencyName: agencyName.trim() }),
          });
        }
      } catch { /* best-effort */ }

      await completeOnboarding();
      navigate('/agency/onboarding');
    } catch (err: any) {
      setError(err.message || 'Ocurrió un error al completar el registro');
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
      emailReadOnly
      oauthProviderLabel="Microsoft"
      oauthProviderIcon={MicrosoftIcon}
    />
  );
};

export default AzureAgencySignupPage;
