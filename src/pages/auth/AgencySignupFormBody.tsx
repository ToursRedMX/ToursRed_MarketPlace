import React from 'react';
import { Link } from 'react-router-dom';
import { Eye, EyeOff, CheckCircle, XCircle, Loader } from 'lucide-react';

export interface AgencyFormData {
  firstName: string;
  apellidoPaterno: string;
  apellidoMaterno: string;
  dateOfBirth: string;
  sexo: '' | 'masculino' | 'femenino' | 'no_binario';
  curp: string;
  email: string;
  password: string;
  confirmPassword: string;
  agencyName: string;
  phoneNumber: string;
  website: string;
  personaType: '' | 'persona_fisica' | 'persona_moral';
  representanteLegalNombre: string;
  rfc: string;
  razonSocial: string;
  rnt: string;
  regimenFiscal: string;
  banco: string;
  cuentaClabe: string;
  titularCuenta: string;
  street: string;
  exteriorNumber: string;
  interiorNumber: string;
  colony: string;
  city: string;
  state: string;
  postalCode: string;
  country: string;
}

export const defaultAgencyFormData: AgencyFormData = {
  firstName: '',
  apellidoPaterno: '',
  apellidoMaterno: '',
  dateOfBirth: '',
  sexo: '',
  curp: '',
  email: '',
  password: '',
  confirmPassword: '',
  agencyName: '',
  phoneNumber: '',
  website: '',
  personaType: '',
  representanteLegalNombre: '',
  rfc: '',
  razonSocial: '',
  rnt: '',
  regimenFiscal: '',
  banco: '',
  cuentaClabe: '',
  titularCuenta: '',
  street: '',
  exteriorNumber: '',
  interiorNumber: '',
  colony: '',
  city: '',
  state: '',
  postalCode: '',
  country: 'México',
};

interface FieldAvailability {
  isChecking: boolean;
  isAvailable: boolean | null;
}

interface Props {
  formData: AgencyFormData;
  onChange: (field: keyof AgencyFormData, value: string) => void;
  onSubmit: (e: React.FormEvent<HTMLFormElement>) => void;
  isLoading: boolean;
  error: string;
  termsAccepted: boolean;
  setTermsAccepted: (v: boolean) => void;
  activeTermsVersion: { version_number: number; published_at: string } | null;
  showPassword: boolean;
  setShowPassword: (v: boolean) => void;
  showConfirmPassword: boolean;
  setShowConfirmPassword: (v: boolean) => void;
  curpAvailability: FieldAvailability;
  emailAvailability?: FieldAvailability;
  /** Si viene de OAuth, el email es de solo lectura */
  emailReadOnly?: boolean;
  /** Etiqueta del proveedor OAuth (ej: "Google", "Facebook"). null = email/contraseña */
  oauthProviderLabel?: string | null;
  /** Ícono SVG del proveedor OAuth */
  oauthProviderIcon?: React.ReactNode;
  submitLabel?: string;
}

const inputClass =
  'appearance-none block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm placeholder-gray-400 focus:outline-none focus:ring-primary-500 focus:border-primary-500 sm:text-sm';

const AgencySignupFormBody: React.FC<Props> = ({
  formData,
  onChange,
  onSubmit,
  isLoading,
  error,
  termsAccepted,
  setTermsAccepted,
  activeTermsVersion,
  showPassword,
  setShowPassword,
  showConfirmPassword,
  setShowConfirmPassword,
  curpAvailability,
  emailAvailability,
  emailReadOnly = false,
  oauthProviderLabel = null,
  oauthProviderIcon = null,
  submitLabel,
}) => {
  const identifierUnavailable =
    curpAvailability.isAvailable === false ||
    emailAvailability?.isAvailable === false;

  const label = submitLabel ?? (oauthProviderLabel ? 'Crear cuenta de Agencia' : 'Registrar Agencia');

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col justify-center py-12 sm:px-6 lg:px-8">
      {/* Header */}
      <div className="sm:mx-auto sm:w-full sm:max-w-2xl">
        {oauthProviderLabel && oauthProviderIcon && (
          <div className="flex items-center justify-center gap-2 mb-2">
            {oauthProviderIcon}
            <span className="text-sm font-medium text-gray-500">Registro con {oauthProviderLabel}</span>
          </div>
        )}
        <h2 className="mt-2 text-center text-3xl font-extrabold text-gray-900">
          {oauthProviderLabel ? 'Completa tu perfil de Agencia' : 'Registra tu agencia de viajes'}
        </h2>
        <p className="mt-2 text-center text-sm text-gray-600">
          {oauthProviderLabel
            ? 'Una vez completado, tu perfil será revisado para aprobación.'
            : <>O{' '}<Link to="/login" className="font-medium text-primary-600 hover:text-primary-500">inicia sesión en tu cuenta existente</Link></>}
        </p>
      </div>

      {/* Card */}
      <div className="mt-8 sm:mx-auto sm:w-full sm:max-w-2xl">
        <div className="bg-white py-8 px-4 shadow sm:rounded-lg sm:px-10">

          {/* OAuth pre-fill notice */}
          {oauthProviderLabel && (
            <div className="mb-6 flex items-start gap-2 bg-blue-50 border border-blue-200 rounded-lg px-4 py-3">
              <svg className="h-4 w-4 text-blue-500 mt-0.5 flex-shrink-0" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
              </svg>
              <p className="text-xs text-blue-700">
                Tus datos de {oauthProviderLabel} han sido pre-llenados. Puedes editarlos si lo deseas.
              </p>
            </div>
          )}

          {/* Error */}
          {error && (
            <div className={`mb-4 border rounded-md p-3 ${
              error.includes('ya registrado')
                ? 'bg-yellow-50 border-yellow-200 text-yellow-700'
                : 'bg-red-50 border-red-200 text-red-600'
            } text-sm`}>
              {error}
            </div>
          )}

          <form className="space-y-6" onSubmit={onSubmit}>

            {/* ── Información Personal ─────────────────────────────────── */}
            <div className="border-b border-gray-200 pb-6">
              <h3 className="text-lg font-medium text-gray-900 mb-4">Información Personal</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">

                <div className="md:col-span-2">
                  <label className="block text-sm font-medium text-gray-700">Nombre(s) *</label>
                  <input
                    type="text" value={formData.firstName} required
                    onChange={e => onChange('firstName', e.target.value)}
                    placeholder="Ej: Juan"
                    className={`mt-1 ${inputClass}`}
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700">Apellido Paterno *</label>
                  <input
                    type="text" value={formData.apellidoPaterno} required
                    onChange={e => onChange('apellidoPaterno', e.target.value)}
                    placeholder="Ej: Pérez"
                    className={`mt-1 ${inputClass}`}
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700">
                    Apellido Materno <span className="text-gray-400 font-normal">(opcional)</span>
                  </label>
                  <input
                    type="text" value={formData.apellidoMaterno}
                    onChange={e => onChange('apellidoMaterno', e.target.value)}
                    placeholder="Ej: García"
                    className={`mt-1 ${inputClass}`}
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700">
                    Fecha de Nacimiento <span className="text-gray-400 font-normal">(opcional)</span>
                  </label>
                  <input
                    type="date" value={formData.dateOfBirth}
                    onChange={e => onChange('dateOfBirth', e.target.value)}
                    className={`mt-1 ${inputClass}`}
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700">
                    CURP <span className="text-gray-400 font-normal">(opcional)</span>
                  </label>
                  <input
                    type="text" value={formData.curp} maxLength={18}
                    onChange={e => onChange('curp', e.target.value.toUpperCase())}
                    placeholder="ABCD123456HDFRRL09"
                    className={`mt-1 ${inputClass} uppercase`}
                  />
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
                      <XCircle className="h-3 w-3" /> Esta CURP ya tiene una cuenta.{' '}
                      <a href="/login" className="underline">Inicia sesión</a>
                    </p>
                  )}
                </div>

                <div className="md:col-span-2">
                  <label className="block text-sm font-medium text-gray-700 mb-2">Sexo *</label>
                  <div className="grid grid-cols-3 gap-2">
                    {(['masculino', 'femenino', 'no_binario'] as const).map(opcion => (
                      <label key={opcion} className={`flex items-center justify-center px-3 py-2 border rounded-md cursor-pointer text-sm font-medium transition-colors ${
                        formData.sexo === opcion
                          ? 'border-primary-500 bg-primary-50 text-primary-700'
                          : 'border-gray-300 bg-white text-gray-700 hover:bg-gray-50'
                      }`}>
                        <input type="radio" name="sexo" value={opcion} checked={formData.sexo === opcion}
                          onChange={() => onChange('sexo', opcion)} className="sr-only" />
                        {opcion === 'masculino' ? 'Masculino' : opcion === 'femenino' ? 'Femenino' : 'No Binario'}
                      </label>
                    ))}
                  </div>
                </div>
              </div>
            </div>

            {/* ── Información de la Agencia ────────────────────────────── */}
            <div className="border-b border-gray-200 pb-6">
              <h3 className="text-lg font-medium text-gray-900 mb-4">Información de la Agencia</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">

                <div>
                  <label className="block text-sm font-medium text-gray-700">Nombre Comercial de la Agencia *</label>
                  <input
                    type="text" value={formData.agencyName} required
                    onChange={e => onChange('agencyName', e.target.value)}
                    placeholder="Ej: Viajes Aventura México"
                    className={`mt-1 ${inputClass}`}
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700">Correo electrónico *</label>
                  <input
                    type="email" value={formData.email} required
                    readOnly={emailReadOnly}
                    onChange={e => onChange('email', e.target.value)}
                    className={`mt-1 ${inputClass} ${emailReadOnly ? 'bg-gray-50 cursor-not-allowed' : ''}`}
                  />
                  {emailReadOnly && (
                    <p className="mt-1 text-xs text-gray-400">Email verificado por {oauthProviderLabel}</p>
                  )}
                  {!emailReadOnly && emailAvailability?.isChecking && (
                    <p className="mt-1 text-xs text-gray-500 flex items-center gap-1">
                      <Loader className="h-3 w-3 animate-spin" /> Verificando correo...
                    </p>
                  )}
                  {!emailReadOnly && !emailAvailability?.isChecking && emailAvailability?.isAvailable === true && (
                    <p className="mt-1 text-xs text-green-600 flex items-center gap-1">
                      <CheckCircle className="h-3 w-3" /> Correo disponible
                    </p>
                  )}
                  {!emailReadOnly && !emailAvailability?.isChecking && emailAvailability?.isAvailable === false && (
                    <p className="mt-1 text-xs text-red-600 flex items-center gap-1">
                      <XCircle className="h-3 w-3" /> Este correo ya tiene una cuenta.{' '}
                      <a href="/login" className="underline">Inicia sesión</a>
                    </p>
                  )}
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700">Teléfono *</label>
                  <input
                    type="tel" value={formData.phoneNumber} required
                    onChange={e => onChange('phoneNumber', e.target.value)}
                    placeholder="+52 (55) 1234-5678"
                    className={`mt-1 ${inputClass}`}
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700">Sitio Web o Facebook *</label>
                  <input
                    type="text" value={formData.website} required
                    onChange={e => onChange('website', e.target.value)}
                    placeholder="https://www.tuagencia.com o https://facebook.com/tuagencia"
                    className={`mt-1 ${inputClass}`}
                  />
                </div>
              </div>
            </div>

            {/* ── Información Fiscal ───────────────────────────────────── */}
            <div className="border-b border-gray-200 pb-6">
              <h3 className="text-lg font-medium text-gray-900 mb-4">Información Fiscal</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">

                <div className="md:col-span-2">
                  <label className="block text-sm font-medium text-gray-700 mb-2">Tipo de persona *</label>
                  <div className="grid grid-cols-2 gap-3">
                    {([
                      { value: 'persona_fisica', label: 'Persona Física', desc: 'RFC de 13 caracteres' },
                      { value: 'persona_moral',  label: 'Persona Moral',  desc: 'RFC de 12 caracteres' },
                    ] as const).map(({ value, label, desc }) => (
                      <button key={value} type="button"
                        onClick={() => onChange('personaType', value)}
                        className={`p-3 rounded-lg border-2 text-left transition-colors ${
                          formData.personaType === value
                            ? 'border-primary-500 bg-primary-50'
                            : 'border-gray-200 hover:border-gray-300'
                        }`}>
                        <div className="font-medium text-sm text-gray-900">{label}</div>
                        <div className="text-xs text-gray-500 mt-0.5">{desc}</div>
                      </button>
                    ))}
                  </div>
                </div>

                <div className="md:col-span-2">
                  <label className="block text-sm font-medium text-gray-700">
                    Nombre de quien firma este contrato *
                  </label>
                  <input
                    type="text" value={formData.representanteLegalNombre} required
                    onChange={e => onChange('representanteLegalNombre', e.target.value)}
                    placeholder="Ej: Juan Pérez García"
                    className={`mt-1 ${inputClass}`}
                  />
                  <p className="mt-1 text-xs text-gray-500">
                    Para persona física, normalmente eres tú mismo. Para persona moral, quien cuente con facultades legales (representante legal o apoderado).
                  </p>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700">RFC *</label>
                  <input
                    type="text" value={formData.rfc} required maxLength={13}
                    onChange={e => onChange('rfc', e.target.value.toUpperCase())}
                    placeholder="XAXX010101000"
                    className={`mt-1 ${inputClass} uppercase`}
                  />
                  <p className="mt-1 text-xs text-gray-500">Registro Federal de Contribuyentes</p>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700">
                    RNT <span className="text-gray-400 font-normal">(Opcional)</span>
                  </label>
                  <input
                    type="text" value={formData.rnt}
                    onChange={e => onChange('rnt', e.target.value)}
                    placeholder="Ej: 12345678"
                    className={`mt-1 ${inputClass}`}
                  />
                  <p className="mt-1 text-xs text-gray-500">Registro Nacional de Turismo (opcional)</p>
                </div>

                <div className="md:col-span-2">
                  <label className="block text-sm font-medium text-gray-700">Razón Social *</label>
                  <input
                    type="text" value={formData.razonSocial} required
                    onChange={e => onChange('razonSocial', e.target.value)}
                    placeholder="Ej: Viajes Aventura S.A. de C.V."
                    className={`mt-1 ${inputClass}`}
                  />
                  <p className="mt-1 text-xs text-gray-500">Nombre legal tal como aparece en tu RFC</p>
                </div>

                <div className="md:col-span-2">
                  <label className="block text-sm font-medium text-gray-700">
                    Régimen Fiscal <span className="text-gray-400 font-normal">(opcional)</span>
                  </label>
                  <select
                    value={formData.regimenFiscal}
                    onChange={e => onChange('regimenFiscal', e.target.value)}
                    className={`mt-1 ${inputClass} bg-white`}
                  >
                    <option value="">Selecciona tu régimen fiscal</option>
                    <option value="601">601 — General de Ley Personas Morales</option>
                    <option value="612">612 — Personas Físicas con Actividades Empresariales y Profesionales</option>
                    <option value="621">621 — Incorporación Fiscal (RIF)</option>
                    <option value="625">625 — Régimen de las Actividades Empresariales con ingresos a través de Plataformas Tecnológicas</option>
                    <option value="626">626 — Régimen Simplificado de Confianza (RESICO)</option>
                    <option value="608">608 — Demás Ingresos</option>
                  </select>
                </div>
              </div>
            </div>

            {/* ── Información Bancaria ─────────────────────────────────── */}
            <div className="border-b border-gray-200 pb-6">
              <h3 className="text-lg font-medium text-gray-900 mb-1">Información Bancaria</h3>
              <p className="text-sm text-gray-500 mb-4">Opcional, pero recomendable completarla desde el inicio para agilizar pagos.</p>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">

                <div>
                  <label className="block text-sm font-medium text-gray-700">
                    Banco <span className="text-gray-400 font-normal">(opcional)</span>
                  </label>
                  <input
                    type="text" value={formData.banco}
                    onChange={e => onChange('banco', e.target.value)}
                    placeholder="Ej: BBVA, Banorte, Santander..."
                    className={`mt-1 ${inputClass}`}
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700">
                    Titular de la Cuenta <span className="text-gray-400 font-normal">(opcional)</span>
                  </label>
                  <input
                    type="text" value={formData.titularCuenta}
                    onChange={e => onChange('titularCuenta', e.target.value)}
                    placeholder="Nombre del titular tal como aparece en el banco"
                    className={`mt-1 ${inputClass}`}
                  />
                </div>

                <div className="md:col-span-2">
                  <label className="block text-sm font-medium text-gray-700">
                    CLABE Interbancaria <span className="text-gray-400 font-normal">(opcional)</span>
                  </label>
                  <input
                    type="text" value={formData.cuentaClabe} maxLength={18}
                    onChange={e => onChange('cuentaClabe', e.target.value)}
                    placeholder="18 dígitos"
                    className={`mt-1 ${inputClass}`}
                  />
                  <p className="mt-1 text-xs text-gray-500">18 dígitos — necesaria para recibir transferencias</p>
                </div>
              </div>
            </div>

            {/* ── Domicilio de la Agencia ──────────────────────────────── */}
            <div className="border-b border-gray-200 pb-6">
              <h3 className="text-lg font-medium text-gray-900 mb-4">Domicilio de la Agencia</h3>
              <div className="space-y-4">

                <div>
                  <label className="block text-sm font-medium text-gray-700">Calle *</label>
                  <input
                    type="text" value={formData.street} required
                    onChange={e => onChange('street', e.target.value)}
                    placeholder="Ej: Av. Insurgentes Sur"
                    className={`mt-1 ${inputClass}`}
                  />
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700">Número Exterior *</label>
                    <input
                      type="text" value={formData.exteriorNumber} required
                      onChange={e => onChange('exteriorNumber', e.target.value)}
                      placeholder="Ej: 123"
                      className={`mt-1 ${inputClass}`}
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700">
                      Número Interior <span className="text-gray-400 font-normal">(opcional)</span>
                    </label>
                    <input
                      type="text" value={formData.interiorNumber}
                      onChange={e => onChange('interiorNumber', e.target.value)}
                      placeholder="Ej: 4B"
                      className={`mt-1 ${inputClass}`}
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700">Colonia *</label>
                  <input
                    type="text" value={formData.colony} required
                    onChange={e => onChange('colony', e.target.value)}
                    placeholder="Ej: Roma Norte"
                    className={`mt-1 ${inputClass}`}
                  />
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700">Ciudad *</label>
                    <input
                      type="text" value={formData.city} required
                      onChange={e => onChange('city', e.target.value)}
                      placeholder="Ej: Ciudad de México"
                      className={`mt-1 ${inputClass}`}
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700">Estado *</label>
                    <input
                      type="text" value={formData.state} required
                      onChange={e => onChange('state', e.target.value)}
                      placeholder="Ej: CDMX"
                      className={`mt-1 ${inputClass}`}
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700">Código Postal *</label>
                    <input
                      type="text" value={formData.postalCode} required maxLength={5}
                      onChange={e => onChange('postalCode', e.target.value)}
                      placeholder="Ej: 06700"
                      className={`mt-1 ${inputClass}`}
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700">País *</label>
                    <input
                      type="text" value={formData.country} required
                      onChange={e => onChange('country', e.target.value)}
                      placeholder="México"
                      className={`mt-1 ${inputClass}`}
                    />
                  </div>
                </div>
              </div>
            </div>

            {/* ── Contraseña ───────────────────────────────────────────── */}
            <div className="border-b border-gray-200 pb-6">
              <h3 className="text-lg font-medium text-gray-900 mb-4">
                {oauthProviderLabel ? 'Contraseña' : 'Información de Cuenta'}
              </h3>
              {oauthProviderLabel && (
                <p className="text-sm text-gray-500 mb-4">
                  Asigna una contraseña para poder iniciar sesión también con tu correo y contraseña.
                </p>
              )}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700">Contraseña *</label>
                  <div className="mt-1 relative">
                    <input
                      type={showPassword ? 'text' : 'password'} value={formData.password} required
                      autoComplete="new-password" minLength={6}
                      onChange={e => onChange('password', e.target.value)}
                      className={`${inputClass} pr-10`}
                    />
                    <button type="button" onClick={() => setShowPassword(!showPassword)}
                      className="absolute inset-y-0 right-0 pr-3 flex items-center text-gray-400 hover:text-gray-600">
                      {showPassword ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
                    </button>
                  </div>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700">Confirmar Contraseña *</label>
                  <div className="mt-1 relative">
                    <input
                      type={showConfirmPassword ? 'text' : 'password'} value={formData.confirmPassword} required
                      autoComplete="new-password" minLength={6}
                      onChange={e => onChange('confirmPassword', e.target.value)}
                      className={`${inputClass} pr-10`}
                    />
                    <button type="button" onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                      className="absolute inset-y-0 right-0 pr-3 flex items-center text-gray-400 hover:text-gray-600">
                      {showConfirmPassword ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
                    </button>
                  </div>
                </div>
              </div>
            </div>

            {/* ── Nota informativa ─────────────────────────────────────── */}
            <div className="bg-blue-50 border border-blue-200 rounded-md p-4">
              <div className="flex">
                <svg className="h-5 w-5 text-blue-400 flex-shrink-0" viewBox="0 0 20 20" fill="currentColor">
                  <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
                </svg>
                <div className="ml-3 text-sm text-blue-700">
                  <ul className="list-disc list-inside space-y-1">
                    <li><strong>Nombre Comercial:</strong> Es como se conoce tu agencia (ej: "Viajes Aventura")</li>
                    <li><strong>Razón Social:</strong> Es el nombre legal para facturación fiscal</li>
                    <li><strong>RFC:</strong> Necesario para emitir facturas y recibir pagos</li>
                    <li><strong>RNT:</strong> Registro Nacional de Turismo (opcional, pero recomendado)</li>
                  </ul>
                </div>
              </div>
            </div>

            {/* ── Aceptación T&C ───────────────────────────────────────── */}
            <div className="rounded-lg border border-gray-200 bg-gray-50 p-4">
              <label className="flex items-start gap-3 cursor-pointer">
                <input
                  type="checkbox" checked={termsAccepted}
                  onChange={e => setTermsAccepted(e.target.checked)}
                  className="mt-0.5 h-4 w-4 text-primary-600 border-gray-300 rounded focus:ring-primary-500 flex-shrink-0"
                />
                <span className="text-sm text-gray-700 leading-relaxed">
                  He leído y acepto los{' '}
                  <Link to="/terminos-servicio" target="_blank" className="font-medium text-primary-600 hover:text-primary-500 underline">
                    Términos y Condiciones para Agencias
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

            {/* ── Submit ───────────────────────────────────────────────── */}
            <button
              type="submit"
              disabled={isLoading || !termsAccepted || identifierUnavailable}
              className="w-full flex justify-center py-2 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-primary-600 hover:bg-primary-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-500 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isLoading ? 'Procesando...' : label}
            </button>
          </form>

          {/* ── Link viajero (solo email/pwd) ────────────────────────── */}
          {!oauthProviderLabel && (
            <div className="mt-6">
              <div className="relative">
                <div className="absolute inset-0 flex items-center"><div className="w-full border-t border-gray-300" /></div>
                <div className="relative flex justify-center text-sm">
                  <span className="px-2 bg-white text-gray-500">¿Eres un viajero?</span>
                </div>
              </div>
              <div className="mt-6">
                <Link to="/signup"
                  className="w-full flex justify-center py-2 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium text-primary-600 bg-primary-50 hover:bg-primary-100 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-500">
                  Registrarse como viajero
                </Link>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default AgencySignupFormBody;
