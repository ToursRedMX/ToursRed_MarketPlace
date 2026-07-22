import React, { useState, useEffect } from 'react';
import { User, Mail, Calendar, Save, CreditCard as Edit, X, MapPin, CreditCard, Globe, Phone, Wallet, FileText, Shield, Monitor, Smartphone, Tablet, CheckCircle, XCircle, ChevronDown } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { formatCurrency, formatCurrencyMXN } from '../../utils/formatCurrency';
import { supabase } from '../../lib/supabase';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import TravelerReviewsDisplay from '../../components/TravelerReviewsDisplay';
import ProfilePictureUploader from '../../components/ProfilePictureUploader';
import ChangePasswordSection from '../../components/ChangePasswordSection';
import LinkedAccountsSection from '../../components/LinkedAccountsSection';

interface TravelerProfile {
  id: string;
  first_name?: string;
  last_name?: string;
  apellido_paterno?: string;
  apellido_materno?: string;
  sexo?: string;
  email: string;
  role: string;
  created_at: string;
  updated_at: string;
  curp?: string;
  passport_number?: string;
  is_foreign_traveler?: boolean;
  phone_number?: string;
  date_of_birth?: string;
  street?: string;
  exterior_number?: string;
  interior_number?: string;
  colony?: string;
  city?: string;
  state?: string;
  postal_code?: string;
  country?: string;
  rfc?: string;
  razon_social?: string;
  regimen_fiscal?: string;
  uso_cfdi?: string;
  codigo_postal_fiscal?: string;
  num_reg_id_trib?: string;
  residencia_fiscal?: string;
  emergency_contact_name?: string;
  emergency_contact_phone?: string;
  booking_count?: number;
  total_spent?: number;
  wallet_balance?: number;
  profile_picture_url?: string;
}

interface SessionRow {
  id: string;
  login_at: string;
  logout_at: string | null;
  ip_masked: string | null;
  country: string | null;
  city: string | null;
  browser: string | null;
  browser_version: string | null;
  os: string | null;
  device_type: string | null;
  login_method: string;
  success: boolean;
  failure_reason: string | null;
  is_proxy: boolean | null;
  is_hosting: boolean | null;
}

function DeviceIcon({ type }: { type: string | null }) {
  if (type === 'mobile') return <Smartphone className="w-4 h-4 text-gray-500" />;
  if (type === 'tablet') return <Tablet className="w-4 h-4 text-gray-500" />;
  return <Monitor className="w-4 h-4 text-gray-500" />;
}

const SecuritySection: React.FC<{ userId?: string }> = ({ userId }) => {
  const [sessions, setSessions] = useState<SessionRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAll, setShowAll] = useState(false);

  useEffect(() => {
    if (!userId) return;
    supabase
      .from('user_sessions_view')
      .select('id, login_at, logout_at, ip_masked, country, city, browser, browser_version, os, device_type, login_method, success, failure_reason, is_proxy, is_hosting')
      .eq('user_id', userId)
      .order('login_at', { ascending: false })
      .limit(50)
      .then(({ data }) => {
        setSessions((data as SessionRow[]) || []);
        setLoading(false);
      });
  }, [userId]);

  const visible = showAll ? sessions : sessions.slice(0, 5);

  return (
    <div className="mt-6 bg-white rounded-lg shadow-md p-6">
      <div className="flex items-center gap-3 mb-4">
        <Shield className="w-5 h-5 text-slate-700" />
        <h2 className="text-lg font-semibold text-gray-900">Historial de Acceso</h2>
      </div>

      {loading ? (
        <div className="flex justify-center py-6">
          <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary-600" />
        </div>
      ) : sessions.length === 0 ? (
        <p className="text-sm text-gray-500 py-4 text-center">No hay registros de acceso aún.</p>
      ) : (
        <>
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200">
                  <th className="text-left py-2 pr-4 text-xs font-semibold text-gray-500 uppercase">Fecha</th>
                  <th className="text-left py-2 pr-4 text-xs font-semibold text-gray-500 uppercase">Ubicación</th>
                  <th className="text-left py-2 pr-4 text-xs font-semibold text-gray-500 uppercase">Dispositivo</th>
                  <th className="text-left py-2 pr-4 text-xs font-semibold text-gray-500 uppercase">IP</th>
                  <th className="text-left py-2 text-xs font-semibold text-gray-500 uppercase">Estado</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {visible.map(s => (
                  <tr key={s.id} className={`${!s.success || s.is_proxy ? 'bg-amber-50' : ''}`}>
                    <td className="py-2.5 pr-4 text-xs text-gray-700 whitespace-nowrap">
                      {format(new Date(s.login_at), 'dd MMM yyyy HH:mm', { locale: es })}
                    </td>
                    <td className="py-2.5 pr-4 text-xs text-gray-700">
                      {s.city && s.country ? `${s.city}, ${s.country}` : s.country ?? '—'}
                    </td>
                    <td className="py-2.5 pr-4">
                      <div className="flex items-center gap-1.5">
                        <DeviceIcon type={s.device_type} />
                        <span className="text-xs text-gray-700">
                          {s.browser ? `${s.browser}${s.browser_version ? ` ${s.browser_version}` : ''}` : '—'}
                          {s.os && <span className="text-gray-400"> · {s.os}</span>}
                        </span>
                      </div>
                    </td>
                    <td className="py-2.5 pr-4 text-xs font-mono text-gray-600">
                      {s.ip_masked ?? '—'}
                      {s.is_proxy && <span className="ml-1 text-amber-600 font-sans font-medium">(proxy)</span>}
                    </td>
                    <td className="py-2.5">
                      {s.success
                        ? <span className="flex items-center gap-1 text-xs text-emerald-700"><CheckCircle className="w-3.5 h-3.5" /> Exitoso</span>
                        : <span className="flex items-center gap-1 text-xs text-red-700"><XCircle className="w-3.5 h-3.5" /> Fallido</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {sessions.length > 5 && (
            <button
              onClick={() => setShowAll(!showAll)}
              className="mt-3 flex items-center gap-1 text-xs text-primary-600 hover:underline"
            >
              <ChevronDown className={`w-3.5 h-3.5 transition-transform ${showAll ? 'rotate-180' : ''}`} />
              {showAll ? 'Mostrar menos' : `Ver ${sessions.length - 5} más`}
            </button>
          )}
          <p className="mt-3 text-xs text-gray-400">
            Si detectas accesos no reconocidos, cambia tu contraseña de inmediato.
          </p>
        </>
      )}
    </div>
  );
};

const TravelerProfile: React.FC = () => {
  const { user } = useAuth();
  const [profile, setProfile] = useState<TravelerProfile | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isEditing, setIsEditing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const [editForm, setEditForm] = useState({
    first_name: '',
    apellido_paterno: '',
    apellido_materno: '',
    sexo: '' as '' | 'masculino' | 'femenino' | 'no_binario',
    phone_number: '',
    date_of_birth: '',
    street: '',
    exterior_number: '',
    interior_number: '',
    colony: '',
    city: '',
    state: '',
    postal_code: '',
    country: 'México',
    curp: '',
    passport_number: '',
    rfc: '',
    razon_social: '',
    regimen_fiscal: '',
    uso_cfdi: '',
    codigo_postal_fiscal: '',
    num_reg_id_trib: '',
    residencia_fiscal: '',
    emergency_contact_name: '',
    emergency_contact_phone: ''
  });

  useEffect(() => {
    if (user?.id) {
      fetchProfile();
    }
  }, [user?.id]);

  const fetchProfile = async () => {
    if (!user?.id) return;

    try {
      setIsLoading(true);
      setError('');

      console.log('👤 Cargando perfil de viajero para usuario:', user.id);

      // Obtener perfil del usuario
      const { data: profileData, error: profileError } = await supabase
        .from('users')
        .select('*')
        .eq('id', user.id)
        .single();

      if (profileError) {
        throw new Error(profileError.message);
      }

      console.log('✅ Perfil de viajero cargado:', profileData);

      // Obtener estadísticas del viajero
      const [bookingsResult, spentResult, walletResult] = await Promise.all([
        // Contar reservas
        supabase
          .from('bookings')
          .select('*', { count: 'exact', head: true })
          .eq('user_id', user.id)
          .neq('status', 'draft'),

        // Calcular total gastado (suma de user_payment de reservas exitosas)
        supabase
          .from('bookings')
          .select('user_payment')
          .eq('user_id', user.id)
          .eq('payment_status', 'succeeded'),

        // Obtener saldo del monedero
        supabase
          .from('toursred_cash_wallets')
          .select('balance')
          .eq('user_id', user.id)
          .maybeSingle()
      ]);

      const totalSpent = spentResult.data?.reduce((sum, booking) =>
        sum + (booking.user_payment || 0), 0) || 0;

      const profileWithStats = {
        ...profileData,
        booking_count: bookingsResult.count || 0,
        total_spent: totalSpent,
        wallet_balance: walletResult.data?.balance ? Number(walletResult.data.balance) : 0
      };

      setProfile(profileWithStats);

      // Inicializar formulario de edición
      setEditForm({
        first_name: profileData.first_name || '',
        apellido_paterno: profileData.apellido_paterno || profileData.last_name || '',
        apellido_materno: profileData.apellido_materno || '',
        sexo: (profileData.sexo || '') as '' | 'masculino' | 'femenino' | 'no_binario',
        phone_number: profileData.phone_number || '',
        date_of_birth: profileData.date_of_birth || '',
        street: profileData.street || '',
        exterior_number: profileData.exterior_number || '',
        interior_number: profileData.interior_number || '',
        colony: profileData.colony || '',
        city: profileData.city || '',
        state: profileData.state || '',
        postal_code: profileData.postal_code || '',
        country: profileData.country || 'México',
        curp: profileData.curp || '',
        passport_number: profileData.passport_number || '',
        rfc: profileData.rfc || '',
        razon_social: profileData.razon_social || '',
        regimen_fiscal: profileData.regimen_fiscal || '',
        uso_cfdi: profileData.uso_cfdi || '',
        codigo_postal_fiscal: profileData.codigo_postal_fiscal || '',
        num_reg_id_trib: profileData.num_reg_id_trib || '',
        residencia_fiscal: profileData.residencia_fiscal || '',
        emergency_contact_name: profileData.emergency_contact_name || '',
        emergency_contact_phone: profileData.emergency_contact_phone || ''
      });

    } catch (err: any) {
      console.error('❌ Error cargando perfil de viajero:', err);
      setError(err.message || 'Error al cargar el perfil');
    } finally {
      setIsLoading(false);
    }
  };

  const handleSave = async () => {
    if (!user?.id) return;

    try {
      setIsSaving(true);
      setError('');
      setSuccess('');

      // Validar RFC unico antes de guardar
      const rfcToSave = editForm.rfc?.trim().toUpperCase() || null;
      if (rfcToSave && rfcToSave !== profile?.rfc?.toUpperCase()) {
        const { data: rfcExists } = await supabase
          .from('users')
          .select('id, first_name, last_name')
          .eq('role', 'traveler')
          .eq('rfc', rfcToSave)
          .neq('id', user.id)
          .maybeSingle();

        if (rfcExists) {
          const ownerName = [rfcExists.first_name, rfcExists.last_name].filter(Boolean).join(' ') || 'otro viajero';
          throw new Error(`El RFC ${rfcToSave} ya está registrado por ${ownerName}. Verifica que el RFC sea correcto.`);
        }
      }

      const updateData: any = {
        first_name: editForm.first_name?.trim() || null,
        last_name: editForm.apellido_paterno?.trim() || null,
        apellido_paterno: editForm.apellido_paterno?.trim() || null,
        apellido_materno: editForm.apellido_materno?.trim() || null,
        sexo: editForm.sexo || null,
        phone_number: editForm.phone_number?.trim() || null,
        date_of_birth: editForm.date_of_birth || null,
        street: editForm.street?.trim() || null,
        exterior_number: editForm.exterior_number?.trim() || null,
        interior_number: editForm.interior_number?.trim() || null,
        colony: editForm.colony?.trim() || null,
        city: editForm.city?.trim() || null,
        state: editForm.state?.trim() || null,
        postal_code: editForm.postal_code?.trim() || null,
        country: editForm.country?.trim() || 'México',
        curp: profile?.is_foreign_traveler ? null : (editForm.curp?.trim() || null),
        passport_number: profile?.is_foreign_traveler ? (editForm.passport_number?.trim() || null) : null,
        rfc: editForm.rfc?.trim().toUpperCase() || null,
        razon_social: editForm.razon_social?.trim() || null,
        regimen_fiscal: editForm.regimen_fiscal || null,
        uso_cfdi: editForm.uso_cfdi || null,
        codigo_postal_fiscal: editForm.codigo_postal_fiscal?.trim() || null,
        num_reg_id_trib: profile?.is_foreign_traveler ? (editForm.num_reg_id_trib?.trim() || null) : null,
        residencia_fiscal: profile?.is_foreign_traveler ? (editForm.residencia_fiscal?.trim() || null) : null,
        emergency_contact_name: editForm.emergency_contact_name?.trim() || null,
        emergency_contact_phone: editForm.emergency_contact_phone?.trim() || null,
        updated_at: new Date().toISOString()
      };

      const { error } = await supabase
        .from('users')
        .update(updateData)
        .eq('id', user.id);

      if (error) {
        throw new Error(error.message);
      }

      console.log('✅ Perfil actualizado correctamente');
      setSuccess('Perfil actualizado correctamente');
      setIsEditing(false);

      // Recargar datos
      await fetchProfile();

    } catch (err: any) {
      console.error('❌ Error guardando perfil:', err);
      setError(err.message || 'Error al guardar los cambios');
    } finally {
      setIsSaving(false);
    }
  };

  const handleCancel = () => {
    if (!profile) return;

    setEditForm({
      first_name: profile.first_name || '',
      apellido_paterno: profile.apellido_paterno || profile.last_name || '',
      apellido_materno: profile.apellido_materno || '',
      sexo: (profile.sexo || '') as '' | 'masculino' | 'femenino' | 'no_binario',
      phone_number: profile.phone_number || '',
      date_of_birth: profile.date_of_birth || '',
      street: profile.street || '',
      exterior_number: profile.exterior_number || '',
      interior_number: profile.interior_number || '',
      colony: profile.colony || '',
      city: profile.city || '',
      state: profile.state || '',
      postal_code: profile.postal_code || '',
      country: profile.country || 'México',
      curp: profile.curp || '',
      passport_number: profile.passport_number || '',
      rfc: profile.rfc || '',
      razon_social: profile.razon_social || '',
      regimen_fiscal: profile.regimen_fiscal || '',
      uso_cfdi: profile.uso_cfdi || '',
      codigo_postal_fiscal: profile.codigo_postal_fiscal || '',
      num_reg_id_trib: profile.num_reg_id_trib || '',
      residencia_fiscal: profile.residencia_fiscal || '',
      emergency_contact_name: profile.emergency_contact_name || '',
      emergency_contact_phone: profile.emergency_contact_phone || ''
    });
    setIsEditing(false);
    setError('');
    setSuccess('');
  };

  const handleProfilePictureChange = async (url: string) => {
    if (!user?.id) return;

    try {
      const { error } = await supabase
        .from('users')
        .update({
          profile_picture_url: url,
          updated_at: new Date().toISOString()
        })
        .eq('id', user.id);

      if (error) throw error;

      setProfile(prev => prev ? { ...prev, profile_picture_url: url } : null);
      setSuccess('Foto de perfil actualizada correctamente');
    } catch (err: any) {
      console.error('Error updating profile picture:', err);
      setError('Error al actualizar la foto de perfil');
    }
  };

  if (isLoading) {
    return (
      <div className="container mx-auto px-4 py-8">
        <div className="flex justify-center py-12">
          <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-primary-600"></div>
        </div>
      </div>
    );
  }

  if (error && !profile) {
    return (
      <div className="container mx-auto px-4 py-8">
        <div className="bg-white rounded-lg shadow-md p-8 text-center">
          <User className="h-12 w-12 text-gray-400 mx-auto mb-4" />
          <h3 className="text-xl font-semibold mb-2">Error al Cargar Perfil</h3>
          <p className="text-gray-600 mb-6">{error}</p>
          <button 
            onClick={fetchProfile}
            className="btn btn-primary"
          >
            Reintentar
          </button>
        </div>
      </div>
    );
  }

  if (!profile) {
    return (
      <div className="container mx-auto px-4 py-8">
        <div className="bg-white rounded-lg shadow-md p-8 text-center">
          <User className="h-12 w-12 text-gray-400 mx-auto mb-4" />
          <h3 className="text-xl font-semibold mb-2">Cargando perfil...</h3>
        </div>
      </div>
    );
  }

  return (
    <div className="container mx-auto px-4 py-8">
      <div className="max-w-4xl mx-auto">
        {/* Header */}
        <div className="bg-white rounded-lg shadow-md overflow-hidden mb-6">
          <div className="bg-gradient-to-r from-primary-600 to-primary-700 px-6 py-8">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-4">
                <div className="relative group">
                  <div className="h-20 w-20 rounded-full bg-white/20 flex items-center justify-center overflow-hidden">
                    {profile.profile_picture_url ? (
                      <img
                        src={profile.profile_picture_url}
                        alt={`${profile.first_name} ${profile.last_name}`}
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <User className="h-10 w-10 text-white" />
                    )}
                  </div>
                  <div className="absolute inset-0 bg-black/50 rounded-full opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                    <ProfilePictureUploader
                      currentImage={profile.profile_picture_url}
                      onImageChange={handleProfilePictureChange}
                      userId={user.id}
                    />
                  </div>
                </div>
                <div className="ml-6">
                  <h1 className="text-2xl font-bold text-white">
                    {profile.first_name || profile.apellido_paterno || profile.last_name
                      ? [profile.first_name, profile.apellido_paterno || profile.last_name, profile.apellido_materno].filter(Boolean).join(' ')
                      : 'Viajero'
                    }
                  </h1>
                  <p className="text-primary-100">
                    Viajero
                  </p>
                  <div className="flex items-center mt-2">
                    <span className="px-2 py-1 rounded-full text-xs font-medium bg-success-100 text-success-800">
                      Cuenta Activa
                    </span>
                  </div>
                </div>
              </div>
              {!isEditing && (
                <button
                  onClick={() => setIsEditing(true)}
                  className="btn bg-white/20 text-white border-white/30 hover:bg-white/30"
                >
                  <Edit className="h-4 w-4 mr-2" />
                  Editar Perfil
                </button>
              )}
            </div>
          </div>

          {/* Estadísticas */}
          <div className="bg-gray-50 px-6 py-4">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
              <div className="text-center">
                <div className="text-2xl font-bold text-primary-600">{profile.booking_count || 0}</div>
                <div className="text-sm text-gray-500">Reservas Realizadas</div>
              </div>
              <div className="text-center">
                <div className="text-2xl font-bold text-success-600">{formatCurrencyMXN(profile.total_spent || 0)}</div>
                <div className="text-sm text-gray-500">Total Invertido en Viajes</div>
              </div>
              <div className="text-center bg-gradient-to-br from-accent-50 to-accent-100 rounded-lg py-3 border-2 border-accent-200">
                <div className="flex items-center justify-center gap-2 mb-1">
                  <Wallet className="h-5 w-5 text-accent-600" />
                  <div className="text-2xl font-bold text-accent-600">
                    {formatCurrencyMXN(profile.wallet_balance || 0)}
                  </div>
                </div>
                <div className="text-xs font-semibold text-accent-700">ToursRed Cash</div>
                <div className="text-xs text-accent-600 mt-0.5">Saldo disponible</div>
              </div>
              <div className="text-center">
                <div className="text-2xl font-bold text-gray-700">
                  {new Date(profile.created_at).getFullYear()}
                </div>
                <div className="text-sm text-gray-500">Miembro desde</div>
              </div>
            </div>
          </div>
        </div>

        {/* Mensajes */}
        {error && (
          <div className="mb-6 bg-error-50 text-error-600 p-4 rounded-md">
            {error}
          </div>
        )}

        {success && (
          <div className="mb-6 bg-success-50 text-success-600 p-4 rounded-md">
            {success}
          </div>
        )}

        {/* Contenido Principal */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Información Personal */}
          <div className="lg:col-span-2">
            <div className="bg-white rounded-lg shadow-md p-6">
              <div className="flex justify-between items-center mb-4">
                <h2 className="text-lg font-semibold text-gray-900">Información Personal</h2>
                {!isEditing && (
                  <button
                    onClick={() => setIsEditing(true)}
                    className="btn btn-outline"
                  >
                    <Edit className="h-4 w-4 mr-2" />
                    Editar
                  </button>
                )}
              </div>

              {isEditing ? (
                <div className="space-y-6">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="md:col-span-2">
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        Nombre(s)
                      </label>
                      <input
                        type="text"
                        value={editForm.first_name}
                        onChange={(e) => setEditForm({...editForm, first_name: e.target.value})}
                        className="input"
                        placeholder="Tu nombre"
                      />
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        Apellido Paterno
                      </label>
                      <input
                        type="text"
                        value={editForm.apellido_paterno}
                        onChange={(e) => setEditForm({...editForm, apellido_paterno: e.target.value})}
                        className="input"
                        placeholder="Apellido paterno"
                      />
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        Apellido Materno
                        <span className="text-gray-400 font-normal ml-1">(opcional)</span>
                      </label>
                      <input
                        type="text"
                        value={editForm.apellido_materno}
                        onChange={(e) => setEditForm({...editForm, apellido_materno: e.target.value})}
                        className="input"
                        placeholder="Apellido materno"
                      />
                    </div>

                    <div className="md:col-span-2">
                      <label className="block text-sm font-medium text-gray-700 mb-1">Sexo</label>
                      <div className="grid grid-cols-3 gap-2">
                        {(['masculino', 'femenino', 'no_binario'] as const).map((opcion) => (
                          <label
                            key={opcion}
                            className={`flex items-center justify-center px-3 py-2 border rounded-md cursor-pointer text-sm font-medium transition-colors ${
                              editForm.sexo === opcion
                                ? 'border-primary-500 bg-primary-50 text-primary-700'
                                : 'border-gray-300 bg-white text-gray-700 hover:bg-gray-50'
                            }`}
                          >
                            <input
                              type="radio"
                              name="sexo_edit"
                              value={opcion}
                              checked={editForm.sexo === opcion}
                              onChange={() => setEditForm({...editForm, sexo: opcion})}
                              className="sr-only"
                            />
                            {opcion === 'masculino' ? 'Masculino' : opcion === 'femenino' ? 'Femenino' : 'No Binario'}
                          </label>
                        ))}
                      </div>
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        Número de Celular
                      </label>
                      <input
                        type="tel"
                        value={editForm.phone_number}
                        onChange={(e) => setEditForm({...editForm, phone_number: e.target.value})}
                        className="input"
                        placeholder="+52 55 1234 5678"
                      />
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        Fecha de Nacimiento
                      </label>
                      <input
                        type="date"
                        value={editForm.date_of_birth}
                        onChange={(e) => setEditForm({...editForm, date_of_birth: e.target.value})}
                        className="input"
                      />
                    </div>

                    {profile?.is_foreign_traveler ? (
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                          Número de Pasaporte
                        </label>
                        <input
                          type="text"
                          value={editForm.passport_number}
                          onChange={(e) => setEditForm({...editForm, passport_number: e.target.value.toUpperCase()})}
                          className="input uppercase"
                          placeholder="A12345678"
                        />
                      </div>
                    ) : (
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                          CURP
                        </label>
                        <input
                          type="text"
                          value={editForm.curp}
                          onChange={(e) => setEditForm({...editForm, curp: e.target.value.toUpperCase()})}
                          className="input uppercase"
                          placeholder="ABCD123456HDFRRL09"
                          maxLength={18}
                        />
                      </div>
                    )}
                  </div>

                  <div className="space-y-3 border-t pt-3">
                    <h4 className="text-sm font-semibold text-gray-900">Contacto de Emergencia</h4>
                    <p className="text-xs text-gray-500">Persona a contactar en caso de emergencia durante el viaje. Este contacto se cargará automáticamente en tus reservas. Es opcional.</p>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                          Nombre del contacto
                        </label>
                        <input
                          type="text"
                          value={editForm.emergency_contact_name}
                          onChange={(e) => setEditForm({...editForm, emergency_contact_name: e.target.value})}
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
                          value={editForm.emergency_contact_phone}
                          onChange={(e) => setEditForm({...editForm, emergency_contact_phone: e.target.value})}
                          className="input"
                          placeholder="+52 55 1234 5678"
                        />
                      </div>
                    </div>
                  </div>

                  <div className="space-y-3 border-t pt-3">
                    <h4 className="text-sm font-semibold text-gray-900">Domicilio</h4>

                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        Calle
                      </label>
                      <input
                        type="text"
                        value={editForm.street}
                        onChange={(e) => setEditForm({...editForm, street: e.target.value})}
                        className="input"
                        placeholder="Ej: Av. Insurgentes Sur"
                      />
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                          Número Exterior
                        </label>
                        <input
                          type="text"
                          value={editForm.exterior_number}
                          onChange={(e) => setEditForm({...editForm, exterior_number: e.target.value})}
                          className="input"
                          placeholder="Ej: 123"
                        />
                      </div>

                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                          Número Interior
                          <span className="text-gray-400 font-normal ml-1">(opcional)</span>
                        </label>
                        <input
                          type="text"
                          value={editForm.interior_number}
                          onChange={(e) => setEditForm({...editForm, interior_number: e.target.value})}
                          className="input"
                          placeholder="Ej: 4B"
                        />
                      </div>
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        Colonia
                      </label>
                      <input
                        type="text"
                        value={editForm.colony}
                        onChange={(e) => setEditForm({...editForm, colony: e.target.value})}
                        className="input"
                        placeholder="Ej: Roma Norte"
                      />
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                          Ciudad
                        </label>
                        <input
                          type="text"
                          value={editForm.city}
                          onChange={(e) => setEditForm({...editForm, city: e.target.value})}
                          className="input"
                          placeholder="Ej: Ciudad de México"
                        />
                      </div>

                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                          Estado
                        </label>
                        <input
                          type="text"
                          value={editForm.state}
                          onChange={(e) => setEditForm({...editForm, state: e.target.value})}
                          className="input"
                          placeholder="Ej: CDMX"
                        />
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                          Código Postal
                        </label>
                        <input
                          type="text"
                          value={editForm.postal_code}
                          onChange={(e) => setEditForm({...editForm, postal_code: e.target.value})}
                          className="input"
                          placeholder="Ej: 06700"
                          maxLength={5}
                        />
                      </div>

                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                          País
                        </label>
                        <input
                          type="text"
                          value={editForm.country}
                          onChange={(e) => setEditForm({...editForm, country: e.target.value})}
                          className="input"
                          placeholder="México"
                        />
                      </div>
                    </div>
                  </div>

                  <div className="space-y-3 border-t pt-3">
                    <h4 className="text-sm font-semibold text-gray-900 flex items-center gap-2">
                      <FileText className="h-4 w-4 text-primary-600" />
                      Datos Fiscales (para CFDI)
                    </h4>
                    <p className="text-xs text-gray-500">
                      {profile?.is_foreign_traveler
                        ? 'Para viajeros extranjeros se usará RFC XEXX010101000. Si proporcionas tu número de registro fiscal y país de residencia, podrás deducir el gasto en tu país.'
                        : 'Opcional. Si los proporcionas, tus comprobantes fiscales se generarán con estos datos. De lo contrario se usará RFC genérico (XAXX010101000) con tu nombre real.'}
                    </p>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      {!profile?.is_foreign_traveler && (
                        <>
                          <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">RFC</label>
                            <input
                              type="text"
                              value={editForm.rfc}
                              onChange={(e) => setEditForm({...editForm, rfc: e.target.value.toUpperCase()})}
                              className="input uppercase"
                              placeholder="Ej: ABCD123456EFG"
                              maxLength={13}
                            />
                          </div>
                          <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">Razón Social / Nombre Fiscal</label>
                            <input
                              type="text"
                              value={editForm.razon_social}
                              onChange={(e) => setEditForm({...editForm, razon_social: e.target.value})}
                              className="input"
                              placeholder="Como aparece en el SAT"
                            />
                          </div>
                          <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">Régimen Fiscal</label>
                            <select
                              value={editForm.regimen_fiscal}
                              onChange={(e) => setEditForm({...editForm, regimen_fiscal: e.target.value})}
                              className="input"
                            >
                              <option value="">Seleccionar régimen</option>
                              <option value="605">605 - Sueldos y Salarios</option>
                              <option value="606">606 - Arrendamiento</option>
                              <option value="608">608 - Demás ingresos</option>
                              <option value="611">611 - Ingresos por Dividendos</option>
                              <option value="612">612 - Personas Físicas con Actividades Empresariales</option>
                              <option value="614">614 - Ingresos por intereses</option>
                              <option value="616">616 - Sin obligaciones fiscales</option>
                              <option value="621">621 - Incorporación Fiscal</option>
                              <option value="625">625 - Régimen Simplificado de Confianza</option>
                            </select>
                          </div>
                          <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">Uso CFDI</label>
                            <select
                              value={editForm.uso_cfdi}
                              onChange={(e) => setEditForm({...editForm, uso_cfdi: e.target.value})}
                              className="input"
                            >
                              <option value="">Seleccionar uso</option>
                              <option value="S01">S01 - Sin efectos fiscales</option>
                              <option value="G01">G01 - Adquisición de mercancias</option>
                              <option value="G03">G03 - Gastos en general</option>
                              <option value="D01">D01 - Honorarios médicos, dentales y gastos hospitalarios</option>
                              <option value="D10">D10 - Pagos por servicios educativos</option>
                            </select>
                          </div>
                          <div className="md:col-span-2">
                            <label className="block text-sm font-medium text-gray-700 mb-1">Código Postal Fiscal</label>
                            <input
                              type="text"
                              value={editForm.codigo_postal_fiscal}
                              onChange={(e) => setEditForm({...editForm, codigo_postal_fiscal: e.target.value})}
                              className="input"
                              placeholder="Ej: 06700"
                              maxLength={5}
                            />
                          </div>
                        </>
                      )}

                      {profile?.is_foreign_traveler && (
                        <>
                          <div className="md:col-span-2 p-3 bg-blue-50 rounded-md border border-blue-100">
                            <p className="text-xs text-blue-700 font-medium">RFC aplicado automaticamente: XEXX010101000</p>
                            <p className="text-xs text-blue-600 mt-1">Uso CFDI: S01 - Sin efectos fiscales | Regimen: 616 - Sin obligaciones fiscales</p>
                          </div>
                          <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">
                              Num. Registro Fiscal (pais de origen)
                              <span className="text-gray-400 font-normal ml-1">(opcional)</span>
                            </label>
                            <input
                              type="text"
                              value={editForm.num_reg_id_trib}
                              onChange={(e) => setEditForm({...editForm, num_reg_id_trib: e.target.value.toUpperCase()})}
                              className="input uppercase"
                              placeholder="Ej: 123-45-6789"
                            />
                            <p className="text-xs text-gray-400 mt-1">Tu numero de identificacion fiscal en tu pais</p>
                          </div>
                          <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">
                              Pais de Residencia Fiscal
                              <span className="text-gray-400 font-normal ml-1">(opcional)</span>
                            </label>
                            <select
                              value={editForm.residencia_fiscal}
                              onChange={(e) => setEditForm({...editForm, residencia_fiscal: e.target.value})}
                              className="input"
                            >
                              <option value="">Seleccionar pais</option>
                              <option value="USA">Estados Unidos (USA)</option>
                              <option value="CAN">Canada (CAN)</option>
                              <option value="ESP">Espana (ESP)</option>
                              <option value="FRA">Francia (FRA)</option>
                              <option value="DEU">Alemania (DEU)</option>
                              <option value="GBR">Reino Unido (GBR)</option>
                              <option value="ITA">Italia (ITA)</option>
                              <option value="BRA">Brasil (BRA)</option>
                              <option value="ARG">Argentina (ARG)</option>
                              <option value="COL">Colombia (COL)</option>
                              <option value="CHL">Chile (CHL)</option>
                              <option value="PER">Peru (PER)</option>
                              <option value="JPN">Japon (JPN)</option>
                              <option value="CHN">China (CHN)</option>
                              <option value="AUS">Australia (AUS)</option>
                              <option value="NLD">Paises Bajos (NLD)</option>
                              <option value="BEL">Belgica (BEL)</option>
                              <option value="CHE">Suiza (CHE)</option>
                              <option value="SWE">Suecia (SWE)</option>
                              <option value="NOR">Noruega (NOR)</option>
                            </select>
                          </div>
                          <p className="md:col-span-2 text-xs text-gray-500">
                            Al proporcionar estos datos, el CFDI incluira tu informacion fiscal extranjera para que puedas deducirlo en tu pais de residencia.
                          </p>
                        </>
                      )}
                    </div>
                  </div>

                  <div className="flex justify-end space-x-4 pt-4">
                    <button
                      onClick={handleCancel}
                      className="btn btn-outline"
                      disabled={isSaving}
                    >
                      <X className="h-4 w-4 mr-2" />
                      Cancelar
                    </button>
                    <button
                      onClick={handleSave}
                      className="btn btn-primary"
                      disabled={isSaving}
                    >
                      <Save className="h-4 w-4 mr-2" />
                      {isSaving ? 'Guardando...' : 'Guardar Cambios'}
                    </button>
                  </div>
                </div>
              ) : (
                <div className="space-y-4">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-500 mb-1">
                        Nombre(s)
                      </label>
                      <div className="flex items-center p-3 bg-gray-50 rounded-md">
                        <User className="h-4 w-4 text-gray-400 mr-2" />
                        <span>{profile.first_name || 'No especificado'}</span>
                      </div>
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-gray-500 mb-1">
                        Apellido Paterno
                      </label>
                      <div className="flex items-center p-3 bg-gray-50 rounded-md">
                        <User className="h-4 w-4 text-gray-400 mr-2" />
                        <span>{profile.apellido_paterno || profile.last_name || 'No especificado'}</span>
                      </div>
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-gray-500 mb-1">
                        Apellido Materno
                      </label>
                      <div className="flex items-center p-3 bg-gray-50 rounded-md">
                        <User className="h-4 w-4 text-gray-400 mr-2" />
                        <span>{profile.apellido_materno || 'No especificado'}</span>
                      </div>
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-gray-500 mb-1">
                        Sexo
                      </label>
                      <div className="flex items-center p-3 bg-gray-50 rounded-md">
                        <User className="h-4 w-4 text-gray-400 mr-2" />
                        <span>
                          {profile.sexo === 'masculino' ? 'Masculino'
                            : profile.sexo === 'femenino' ? 'Femenino'
                            : profile.sexo === 'no_binario' ? 'No Binario'
                            : 'No especificado'}
                        </span>
                      </div>
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-gray-500 mb-1">
                        Correo Electrónico
                      </label>
                      <div className="flex items-center p-3 bg-gray-50 rounded-md">
                        <Mail className="h-4 w-4 text-gray-400 mr-2" />
                        <span>{profile.email}</span>
                      </div>
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-gray-500 mb-1">
                        Número de Celular
                      </label>
                      <div className="flex items-center p-3 bg-gray-50 rounded-md">
                        <Phone className="h-4 w-4 text-gray-400 mr-2" />
                        <span>{profile.phone_number || 'No especificado'}</span>
                      </div>
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-gray-500 mb-1">
                        Fecha de Nacimiento
                      </label>
                      <div className="flex items-center p-3 bg-gray-50 rounded-md">
                        <Calendar className="h-4 w-4 text-gray-400 mr-2" />
                        <span>
                          {profile.date_of_birth
                            ? (() => {
                                const [year, month, day] = profile.date_of_birth.split('-');
                                const date = new Date(parseInt(year), parseInt(month) - 1, parseInt(day));
                                return date.toLocaleDateString('es-ES', {
                                  year: 'numeric',
                                  month: 'long',
                                  day: 'numeric'
                                });
                              })()
                            : 'No especificado'
                          }
                        </span>
                      </div>
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-gray-500 mb-1">
                        {profile.is_foreign_traveler ? 'Número de Pasaporte' : 'CURP'}
                      </label>
                      <div className="flex items-center p-3 bg-gray-50 rounded-md">
                        {profile.is_foreign_traveler ? (
                          <Globe className="h-4 w-4 text-gray-400 mr-2" />
                        ) : (
                          <CreditCard className="h-4 w-4 text-gray-400 mr-2" />
                        )}
                        <span className="uppercase">
                          {profile.is_foreign_traveler
                            ? (profile.passport_number || 'No especificado')
                            : (profile.curp || 'No especificado')
                          }
                        </span>
                      </div>
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-gray-500 mb-1">
                        Tipo de Viajero
                      </label>
                      <div className="flex items-center p-3 bg-gray-50 rounded-md">
                        <Globe className="h-4 w-4 text-gray-400 mr-2" />
                        <span>
                          {profile.is_foreign_traveler ? 'Extranjero' : 'Nacional'}
                        </span>
                      </div>
                    </div>

                    <div className="md:col-span-2">
                      <label className="block text-sm font-medium text-gray-500 mb-1">
                        Contacto de Emergencia
                      </label>
                      {(profile.emergency_contact_name || profile.emergency_contact_phone) ? (
                        <div className="flex items-center p-3 bg-amber-50 rounded-md border border-amber-200">
                          <Phone className="h-4 w-4 text-amber-500 mr-2 flex-shrink-0" />
                          <div>
                            <span className="font-medium text-gray-900">{profile.emergency_contact_name || 'No especificado'}</span>
                            {profile.emergency_contact_phone && (
                              <span className="text-gray-600 ml-2">— {profile.emergency_contact_phone}</span>
                            )}
                          </div>
                        </div>
                      ) : (
                        <div className="flex items-center justify-between p-3 bg-gray-50 rounded-md border border-dashed border-gray-300">
                          <div className="flex items-center gap-2 text-gray-500">
                            <Phone className="h-4 w-4 flex-shrink-0" />
                            <span className="text-sm">Sin contacto de emergencia registrado</span>
                          </div>
                          <button
                            onClick={() => setIsEditing(true)}
                            className="text-xs font-medium text-blue-600 hover:text-blue-800 transition-colors"
                          >
                            Agregar
                          </button>
                        </div>
                      )}
                    </div>

                    <div className="md:col-span-2">
                      <label className="block text-sm font-medium text-gray-500 mb-1">
                        Domicilio
                      </label>
                      <div className="flex items-start p-3 bg-gray-50 rounded-md">
                        <MapPin className="h-4 w-4 text-gray-400 mr-2 mt-0.5" />
                        <div className="flex-1">
                          {profile.street || profile.city || profile.state ? (
                            <div className="space-y-1">
                              {profile.street && (
                                <div>
                                  <span className="font-medium">{profile.street}</span>
                                  {profile.exterior_number && <span> #{profile.exterior_number}</span>}
                                  {profile.interior_number && <span> Int. {profile.interior_number}</span>}
                                </div>
                              )}
                              {profile.colony && <div>{profile.colony}</div>}
                              <div>
                                {profile.city && <span>{profile.city}</span>}
                                {profile.city && profile.state && <span>, </span>}
                                {profile.state && <span>{profile.state}</span>}
                                {profile.postal_code && <span> {profile.postal_code}</span>}
                              </div>
                              {profile.country && <div className="text-gray-600">{profile.country}</div>}
                            </div>
                          ) : (
                            <span className="text-gray-500">No especificado</span>
                          )}
                        </div>
                      </div>
                    </div>

                    <div className="md:col-span-2 border-t pt-4">
                      <h4 className="text-sm font-semibold text-gray-900 mb-3 flex items-center gap-2">
                        <FileText className="h-4 w-4 text-primary-600" />
                        Datos Fiscales
                      </h4>
                      {profile.is_foreign_traveler ? (
                        <div className="space-y-3">
                          <div className="p-3 bg-blue-50 rounded-md border border-blue-100">
                            <p className="text-xs text-blue-700 font-medium">RFC automatico para extranjeros: XEXX010101000</p>
                            <p className="text-xs text-blue-600 mt-1">Uso CFDI: S01 - Sin efectos fiscales | Regimen: 616 - Sin obligaciones fiscales</p>
                          </div>
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                            <div>
                              <label className="block text-sm font-medium text-gray-500 mb-1">Num. Registro Fiscal</label>
                              <div className="flex items-center p-3 bg-gray-50 rounded-md">
                                <FileText className="h-4 w-4 text-gray-400 mr-2" />
                                <span className="uppercase">{profile.num_reg_id_trib || 'No especificado'}</span>
                              </div>
                            </div>
                            <div>
                              <label className="block text-sm font-medium text-gray-500 mb-1">Pais de Residencia Fiscal</label>
                              <div className="flex items-center p-3 bg-gray-50 rounded-md">
                                <Globe className="h-4 w-4 text-gray-400 mr-2" />
                                <span>{profile.residencia_fiscal || 'No especificado'}</span>
                              </div>
                            </div>
                          </div>
                        </div>
                      ) : (
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                          <div>
                            <label className="block text-sm font-medium text-gray-500 mb-1">RFC</label>
                            <div className="flex items-center p-3 bg-gray-50 rounded-md">
                              <FileText className="h-4 w-4 text-gray-400 mr-2" />
                              <span className="uppercase">{profile.rfc || 'No especificado (se usara XAXX010101000)'}</span>
                            </div>
                          </div>
                          <div>
                            <label className="block text-sm font-medium text-gray-500 mb-1">Razon Social</label>
                            <div className="flex items-center p-3 bg-gray-50 rounded-md">
                              <User className="h-4 w-4 text-gray-400 mr-2" />
                              <span>{profile.razon_social || 'No especificado'}</span>
                            </div>
                          </div>
                          <div>
                            <label className="block text-sm font-medium text-gray-500 mb-1">Regimen Fiscal</label>
                            <div className="flex items-center p-3 bg-gray-50 rounded-md">
                              <span>{profile.regimen_fiscal || '616 - Sin obligaciones fiscales'}</span>
                            </div>
                          </div>
                          <div>
                            <label className="block text-sm font-medium text-gray-500 mb-1">Uso CFDI por defecto</label>
                            <div className="flex items-center p-3 bg-gray-50 rounded-md">
                              <span>{profile.uso_cfdi || 'S01 - Sin efectos fiscales'}</span>
                            </div>
                          </div>
                        </div>
                      )}
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-gray-500 mb-1">
                        Miembro desde
                      </label>
                      <div className="flex items-center p-3 bg-gray-50 rounded-md">
                        <Calendar className="h-4 w-4 text-gray-400 mr-2" />
                        <span>
                          {new Date(profile.created_at).toLocaleDateString('es-ES', {
                            year: 'numeric',
                            month: 'long',
                            day: 'numeric'
                          })}
                        </span>
                      </div>
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-gray-500 mb-1">
                        Última Actualización
                      </label>
                      <div className="flex items-center p-3 bg-gray-50 rounded-md">
                        <Calendar className="h-4 w-4 text-gray-400 mr-2" />
                        <span>
                          {new Date(profile.updated_at).toLocaleDateString('es-ES', {
                            year: 'numeric',
                            month: 'long',
                            day: 'numeric'
                          })}
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Información de Cuenta y Estadísticas */}
          <div className="space-y-6">
            {/* Estadísticas de Viaje */}
            <div className="bg-white rounded-lg shadow-md p-6">
              <h2 className="text-lg font-semibold text-gray-900 mb-4">
                Estadísticas de Viaje
              </h2>
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center">
                    <MapPin className="h-5 w-5 text-primary-600 mr-3" />
                    <div>
                      <div className="text-sm font-medium text-gray-900">Reservas Realizadas</div>
                      <div className="text-xs text-gray-500">Total de tours reservados</div>
                    </div>
                  </div>
                  <div className="text-2xl font-bold text-primary-600">
                    {profile.booking_count || 0}
                  </div>
                </div>

                <div className="flex items-center justify-between">
                  <div className="flex items-center">
                    <CreditCard className="h-5 w-5 text-success-600 mr-3" />
                    <div>
                      <div className="text-sm font-medium text-gray-900">Total Invertido</div>
                      <div className="text-xs text-gray-500">En experiencias de viaje</div>
                    </div>
                  </div>
                  <div className="text-2xl font-bold text-success-600">
                    {formatCurrencyMXN(profile.total_spent || 0)}
                  </div>
                </div>
              </div>
            </div>

            {/* Información de Seguridad */}
            <div className="bg-white rounded-lg shadow-md p-6">
              <h2 className="text-lg font-semibold text-gray-900 mb-4">
                Información de Cuenta
              </h2>
              <div className="space-y-3">
                <div className="flex items-center">
                  <Mail className="h-4 w-4 text-gray-400 mr-3" />
                  <div>
                    <div className="text-sm font-medium text-gray-900">Email de Cuenta</div>
                    <div className="text-sm text-gray-600">{profile.email}</div>
                  </div>
                </div>

                <div className="flex items-center">
                  <User className="h-4 w-4 text-gray-400 mr-3" />
                  <div>
                    <div className="text-sm font-medium text-gray-900">Tipo de Cuenta</div>
                    <div className="text-sm text-gray-600">Viajero</div>
                  </div>
                </div>

                <div className="flex items-center">
                  <Calendar className="h-4 w-4 text-gray-400 mr-3" />
                  <div>
                    <div className="text-sm font-medium text-gray-900">ID de Usuario</div>
                    <div className="text-xs text-gray-500 font-mono break-all">
                      {profile.id}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Calificaciones del Viajero */}
        <div className="mt-6">
          <TravelerReviewsDisplay travelerId={profile.id} />
        </div>

        {/* Seguridad - Cambiar Contraseña */}
        <div className="mt-6">
          <ChangePasswordSection />
        </div>

        {/* Cuentas vinculadas */}
        <div className="mt-6">
          <LinkedAccountsSection />
        </div>

        {/* Seguridad - Historial de acceso */}
        <SecuritySection userId={user?.id} />

        {/* Información Adicional */}
        <div className="mt-6 bg-white rounded-lg shadow-md p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">
            Información del Sistema
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 text-sm">
            <div>
              <h3 className="font-medium text-gray-700 mb-2">Privacidad y Seguridad</h3>
              <ul className="space-y-1 text-gray-600">
                <li>• Tus datos están protegidos con encriptación SSL</li>
                <li>• Solo tú y las agencias con las que reserves pueden ver tu información</li>
                <li>• Puedes actualizar tu información en cualquier momento</li>
              </ul>
            </div>
            <div>
              <h3 className="font-medium text-gray-700 mb-2">Beneficios de Completar tu Perfil</h3>
              <ul className="space-y-1 text-gray-600">
                <li>• Proceso de reserva más rápido</li>
                <li>• Recomendaciones personalizadas</li>
                <li>• Comunicación directa con agencias</li>
                <li>• Historial completo de viajes</li>
              </ul>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default TravelerProfile;