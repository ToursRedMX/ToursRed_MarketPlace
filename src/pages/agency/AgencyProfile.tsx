import React, { useState, useEffect, useCallback } from 'react';
import { Building, Mail, Phone, Globe, Star, CreditCard as Edit, Save, X, Upload, User, Calendar, MapPin, FileText, Landmark, Hash, Shield, Link2, Building2, Image, ExternalLink, CheckCircle, AlertCircle, Download, Briefcase } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { supabase } from '../../lib/supabase';
import { useAgencyId } from '../../hooks/useAgencyId';
import ImageUploader from '../../components/ImageUploader';
import ChangePasswordSection from '../../components/ChangePasswordSection';
import LinkedAccountsSection from '../../components/LinkedAccountsSection';

interface AgencyProfile {
  id: string;
  user_id: string;
  name: string;
  description?: string;
  logo?: string;
  cover_image_url?: string;
  custom_slug?: string;
  contact_email: string;
  contact_phone?: string;
  website?: string;
  rating?: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  street?: string;
  exterior_number?: string;
  interior_number?: string;
  colony?: string;
  city?: string;
  state?: string;
  postal_code?: string;
  country?: string;
  domicilio_fiscal?: string;
  users?: {
    first_name?: string;
    last_name?: string;
    email: string;
    profile_picture_url?: string;
  };
  tour_count?: number;
  booking_count?: number;
}

const AgencyProfile: React.FC = () => {
  const { user } = useAuth();
  const { agencyId: resolvedAgencyId } = useAgencyId();
  const [agency, setAgency] = useState<AgencyProfile | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isEditing, setIsEditing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const [editForm, setEditForm] = useState({
    name: '',
    description: '',
    rfc: '',
    razon_social: '',
    regimen_fiscal: '',
    domicilio_fiscal: '',
    street: '',
    exterior_number: '',
    interior_number: '',
    colony: '',
    city: '',
    state: '',
    postal_code: '',
    country: 'México',
    banco: '',
    cuenta_clabe: '',
    titular_cuenta: '',
    rnt: '',
    logo: '',
    cover_image_url: '',
    custom_slug: '',
    contact_email: '',
    contact_phone: '',
    website: '',
    first_name: '',
    last_name: ''
  });

  const [slugStatus, setSlugStatus] = useState<'idle' | 'checking' | 'available' | 'taken' | 'invalid'>('idle');
  const [contractInfo, setContractInfo] = useState<{ folio: string; storagePath: string } | null>(null);
  const [downloadingContract, setDownloadingContract] = useState(false);
  const [executive, setExecutive] = useState<{ first_name: string; last_name: string; email: string; phone?: string } | null>(null);

  useEffect(() => {
    if (resolvedAgencyId) {
      fetchAgencyProfile(resolvedAgencyId);
    }
  }, [resolvedAgencyId]);

  const fetchAgencyProfile = async (currentAgencyId: string) => {
    try {
      setIsLoading(true);
      setError('');

      const { data: agencyData, error: agencyError } = await supabase
        .from('agencies')
        .select(`
          *,
          users!agencies_user_id_fkey(first_name, last_name, email, profile_picture_url)
        `)
        .eq('id', currentAgencyId)
        .maybeSingle();

      if (agencyError) {
        throw new Error(agencyError.message);
      }

      if (!agencyData) {
        setError('No se encontró un perfil de agencia para este usuario.');
        return;
      }

      // Obtener estadísticas
      const [toursResult, bookingsResult] = await Promise.all([
        supabase
          .from('tours')
          .select('*', { count: 'exact', head: true })
          .eq('agency_id', agencyData.id),
        supabase
          .from('bookings')
          .select('*', { count: 'exact', head: true })
          .eq('agency_id', agencyData.id)
          .neq('status', 'draft')
      ]);

      const agencyWithStats = {
        ...agencyData,
        tour_count: toursResult.count || 0,
        booking_count: bookingsResult.count || 0
      };

      setAgency(agencyWithStats);

      // Buscar ejecutivo asignado via RPC (RLS de account_executives bloquea consulta directa)
      const { data: execData } = await supabase
        .rpc('get_my_agency_executive');
      if (execData && execData.length > 0) {
        setExecutive(execData[0]);
      } else {
        setExecutive(null);
      }

      // Buscar contrato firmado (documento más reciente de tipo contrato_agencia)
      const { data: contractDoc } = await supabase
        .from('agency_documents')
        .select('storage_path, file_name')
        .eq('agency_id', agencyData.id)
        .eq('document_type_key', 'contrato_agencia')
        .eq('is_current', true)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (contractDoc?.storage_path) {
        setContractInfo({ folio: contractDoc.file_name?.replace('.pdf', '') || 'firmado', storagePath: contractDoc.storage_path });
      } else {
        setContractInfo(null);
      }

      // Inicializar formulario de edición
      setEditForm({
        name: agencyData.name || '',
        description: agencyData.description || '',
        rnt: agencyData.rnt || '',
        rfc: agencyData.rfc || '',
        razon_social: agencyData.razon_social || '',
        regimen_fiscal: agencyData.regimen_fiscal || '',
        domicilio_fiscal: agencyData.domicilio_fiscal || '',
        street: agencyData.street || '',
        exterior_number: agencyData.exterior_number || '',
        interior_number: agencyData.interior_number || '',
        colony: agencyData.colony || '',
        city: agencyData.city || '',
        state: agencyData.state || '',
        postal_code: agencyData.postal_code || '',
        country: agencyData.country || 'México',
        banco: agencyData.banco || '',
        cuenta_clabe: agencyData.cuenta_clabe || '',
        titular_cuenta: agencyData.titular_cuenta || '',
        logo: agencyData.logo || '',
        cover_image_url: agencyData.cover_image_url || '',
        custom_slug: agencyData.custom_slug || '',
        contact_email: agencyData.contact_email || '',
        contact_phone: agencyData.contact_phone || '',
        website: agencyData.website || '',
        first_name: agencyData.users?.first_name || '',
        last_name: agencyData.users?.last_name || ''
      });

    } catch (err: any) {
      console.error('❌ Error cargando perfil de agencia:', err);
      setError(err.message || 'Error al cargar el perfil de la agencia');
    } finally {
      setIsLoading(false);
    }
  };

  const handleDownloadContract = async () => {
    if (!contractInfo) return;
    setDownloadingContract(true);
    try {
      const { data, error } = await supabase.storage
        .from('agency-documents')
        .createSignedUrl(contractInfo.storagePath, 3600);
      if (error || !data?.signedUrl) throw error;
      const a = document.createElement('a');
      a.href = data.signedUrl;
      a.download = `contrato-${contractInfo.folio}.pdf`;
      a.target = '_blank';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    } catch (e: any) {
      alert('No se pudo descargar el contrato: ' + (e?.message || 'error desconocido'));
    } finally {
      setDownloadingContract(false);
    }
  };

  const handleSave = async () => {
    if (!agency?.id || !user?.id) return;

    try {
      setIsSaving(true);
      setError('');
      setSuccess('');

      // Validar RFC contra el SAT si se está cambiando
      if (editForm.rfc?.trim() && editForm.razon_social?.trim() && editForm.regimen_fiscal) {
        const { data: { session } } = await supabase.auth.getSession();
        if (session) {
          const validateRes = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/validate-agency-rfc`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${session.access_token}`,
            },
            body: JSON.stringify({
              rfc: editForm.rfc.trim(),
              razon_social: editForm.razon_social.trim(),
              regimen_fiscal: editForm.regimen_fiscal,
              postal_code: editForm.postal_code || undefined,
            }),
          });

          if (validateRes.ok) {
            const validateData = await validateRes.json();
            if (!validateData.valid) {
              const errMsg = validateData.message
                || (Array.isArray(validateData.errors)
                  ? validateData.errors.map((e: { message: string }) => e.message).join('; ')
                  : 'El RFC no es válido según el SAT');
              setError(errMsg);
              setIsSaving(false);
              return;
            }
          }
        }
      }

      console.log('💾 Guardando cambios del perfil...');

      // Actualizar datos de la agencia
      const { error: agencyError } = await supabase
        .from('agencies')
        .update({
          name: editForm.name,
          description: editForm.description,
          logo: editForm.logo,
          cover_image_url: editForm.cover_image_url || null,
          custom_slug: editForm.custom_slug ? editForm.custom_slug.trim().toLowerCase() : null,
          rnt: editForm.rnt,
          rfc: editForm.rfc,
          razon_social: editForm.razon_social,
          regimen_fiscal: editForm.regimen_fiscal,
          domicilio_fiscal: editForm.domicilio_fiscal,
          street: editForm.street || null,
          exterior_number: editForm.exterior_number || null,
          interior_number: editForm.interior_number || null,
          colony: editForm.colony || null,
          city: editForm.city || null,
          state: editForm.state || null,
          postal_code: editForm.postal_code || null,
          country: editForm.country || 'México',
          banco: editForm.banco,
          cuenta_clabe: editForm.cuenta_clabe,
          titular_cuenta: editForm.titular_cuenta,
          contact_email: editForm.contact_email,
          contact_phone: editForm.contact_phone,
          website: editForm.website,
          updated_at: new Date().toISOString()
        })
        .eq('id', agency.id);

      if (agencyError) {
        throw new Error(`Error actualizando agencia: ${agencyError.message}`);
      }

      // Actualizar datos del usuario propietario
      const { error: userError } = await supabase
        .from('users')
        .update({
          first_name: editForm.first_name,
          last_name: editForm.last_name,
          updated_at: new Date().toISOString()
        })
        .eq('id', user.id);

      if (userError) {
        console.warn('⚠️ Error actualizando datos del usuario:', userError);
        // No lanzar error aquí, ya que la agencia se actualizó correctamente
      }

      console.log('✅ Perfil actualizado correctamente');
      setSuccess('Perfil actualizado correctamente');
      setIsEditing(false);

      // Recargar datos
      await fetchAgencyProfile(agency.id);

    } catch (err: any) {
      console.error('❌ Error guardando perfil:', err);
      setError(err.message || 'Error al guardar los cambios');
    } finally {
      setIsSaving(false);
    }
  };

  const handleCancel = () => {
    if (!agency) return;

    setEditForm({
      name: agency.name || '',
      description: agency.description || '',
      logo: agency.logo || '',
      cover_image_url: agency.cover_image_url || '',
      custom_slug: agency.custom_slug || '',
      rnt: agency.rnt || '',
      contact_email: agency.contact_email || '',
      contact_phone: agency.contact_phone || '',
      website: agency.website || '',
      first_name: agency.users?.first_name || '',
      last_name: agency.users?.last_name || ''
    });
    setIsEditing(false);
    setError('');
    setSuccess('');
  };

  const handleLogoSelect = (publicUrl: string, _type: string, _size: number) => {
    setEditForm({ ...editForm, logo: publicUrl });
  };

  const SLUG_REGEX = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
  let slugDebounceTimer: ReturnType<typeof setTimeout> | null = null;

  const handleSlugChange = (raw: string) => {
    const value = raw.toLowerCase().replace(/\s/g, '-');
    setEditForm((prev) => ({ ...prev, custom_slug: value }));

    if (!value) {
      setSlugStatus('idle');
      return;
    }

    if (!SLUG_REGEX.test(value)) {
      setSlugStatus('invalid');
      return;
    }

    setSlugStatus('checking');

    if (slugDebounceTimer) clearTimeout(slugDebounceTimer);
    slugDebounceTimer = setTimeout(async () => {
      try {
        const { data } = await supabase
          .from('agencies')
          .select('id')
          .ilike('custom_slug', value)
          .neq('id', agency!.id)
          .maybeSingle();

        setSlugStatus(data ? 'taken' : 'available');
      } catch {
        setSlugStatus('idle');
      }
    }, 500);
  };

  // Helper function to format CLABE with spaces for readability
  const formatClabe = (clabe: string) => {
    if (!clabe) return '';
    // Format as groups of 4 digits
    return clabe.replace(/(.{4})/g, '$1 ').trim();
  };

  // Helper function to get the name of the régimen fiscal
  const getRegimenFiscalName = (regimen: string) => {
    const regimenes: Record<string, string> = {
      '601': 'General de Ley',
      '612': 'Personas Físicas con Actividades Empresariales',
      '621': 'Incorporación Fiscal',
      '625': 'Régimen Simplificado de Confianza',
      '626': 'Régimen Simplificado de Confianza (RESICO)'
    };
    return regimenes[regimen] || regimen;
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

  if (error && !agency) {
    return (
      <div className="container mx-auto px-4 py-8">
        <div className="bg-white rounded-lg shadow-md p-8 text-center">
          <Building className="h-12 w-12 text-gray-400 mx-auto mb-4" />
          <h3 className="text-xl font-semibold mb-2">Perfil de Agencia No Encontrado</h3>
          <p className="text-gray-600 mb-6">{error}</p>
          <a href="/agency-signup" className="btn btn-primary">
            Registrarse como Agencia
          </a>
        </div>
      </div>
    );
  }

  if (!agency) {
    return (
      <div className="container mx-auto px-4 py-8">
        <div className="bg-white rounded-lg shadow-md p-8 text-center">
          <Building className="h-12 w-12 text-gray-400 mx-auto mb-4" />
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
          {/* Cover / portada */}
          <div className="relative h-44 md:h-56">
            {(isEditing ? editForm.cover_image_url : agency.cover_image_url) ? (
              <img
                src={isEditing ? editForm.cover_image_url : agency.cover_image_url}
                alt="Portada"
                className="w-full h-full object-cover"
              />
            ) : (
              <div className="w-full h-full bg-gradient-to-r from-primary-600 to-primary-700" />
            )}
            <div className="absolute inset-0 bg-gradient-to-t from-black/50 via-black/10 to-transparent" />

            {/* Logo superpuesto en el borde inferior izquierdo */}
            <div className="absolute bottom-0 left-6 translate-y-1/2">
              <div className="h-24 w-24 rounded-xl border-4 border-white shadow-xl bg-white overflow-hidden">
                {(isEditing ? editForm.logo : agency.logo) ? (
                  <img
                    src={isEditing ? editForm.logo : agency.logo}
                    alt={agency.name}
                    className="h-full w-full object-cover"
                  />
                ) : agency.users?.profile_picture_url ? (
                  <img
                    src={agency.users.profile_picture_url}
                    alt={agency.name}
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <div className="h-full w-full bg-primary-50 flex items-center justify-center">
                    <Building className="h-10 w-10 text-primary-400" />
                  </div>
                )}
              </div>
            </div>

            {/* Botón Editar con fondo azul sólido */}
            {!isEditing && (
              <button
                onClick={() => setIsEditing(true)}
                className="absolute top-4 right-4 inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium shadow-md transition-colors"
              >
                <Edit className="h-4 w-4" />
                Editar Perfil
              </button>
            )}
          </div>

          {/* Nombre + badges (con espacio para el logo) */}
          <div className="px-6 pb-5 pt-16">
            <div className="flex flex-col sm:flex-row sm:items-center gap-3">
              <div className="flex-1 min-w-0">
                <h1 className="text-2xl font-bold text-gray-900 truncate">
                  {isEditing ? editForm.name : agency.name}
                </h1>
                <div className="flex flex-wrap items-center gap-3 mt-1">
                  <span className="text-sm text-gray-500">Agencia de Viajes</span>
                  {agency.rating ? (
                    <div className="flex items-center text-yellow-500">
                      <Star className="h-4 w-4 fill-current mr-1" />
                      <span className="text-sm font-medium text-gray-700">{agency.rating.toFixed(1)}</span>
                    </div>
                  ) : null}
                  <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                    agency.is_active
                      ? 'bg-green-100 text-green-800'
                      : 'bg-red-100 text-red-800'
                  }`}>
                    {agency.is_active ? 'Activa' : 'Inactiva'}
                  </span>
                </div>
              </div>
            </div>
          </div>

          {/* Estadísticas */}
          <div className="bg-gray-50 px-6 py-4">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="text-center">
                <div className="text-2xl font-bold text-primary-600">{agency.tour_count || 0}</div>
                <div className="text-sm text-gray-500">Tours Publicados</div>
              </div>
              <div className="text-center">
                <div className="text-2xl font-bold text-success-600">{agency.booking_count || 0}</div>
                <div className="text-sm text-gray-500">Reservas Totales</div>
              </div>
              <div className="text-center">
                <div className="text-2xl font-bold text-accent-600">
                  {new Date(agency.created_at).getFullYear()}
                </div>
                <div className="text-sm text-gray-500">Miembro desde</div>
              </div>
            </div>
          </div>
        </div>

        {/* Mensajes */}
        {error && (
          <div className="mt-6 bg-error-50 border border-error-200 text-error-700 p-4 rounded-lg flex items-start gap-3">
            <X className="h-5 w-5 mt-0.5 flex-shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {success && (
          <div className="mt-6 bg-success-50 border border-success-200 text-success-700 p-4 rounded-lg">
            {success}
          </div>
        )}

        {/* Fila 1: Fiscal + Bancaria en columnas iguales */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mt-6">
          {/* Información Fiscal */}
          <div className="bg-white rounded-lg shadow-sm border border-gray-100 p-6">
            <div className="flex items-center gap-2 mb-5">
              <div className="h-8 w-8 rounded-lg bg-blue-50 flex items-center justify-center">
                <FileText className="h-4 w-4 text-blue-600" />
              </div>
              <h2 className="text-base font-semibold text-gray-900">Información Fiscal</h2>
            </div>

            {isEditing ? (
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">RFC *</label>
                  <input
                    type="text"
                    value={editForm.rfc || ''}
                    onChange={(e) => setEditForm({ ...editForm, rfc: e.target.value })}
                    className="input"
                    placeholder="Ej: XAXX010101000"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Razón Social</label>
                  <input
                    type="text"
                    value={editForm.razon_social || ''}
                    onChange={(e) => setEditForm({ ...editForm, razon_social: e.target.value })}
                    className="input"
                    placeholder="Nombre legal de la empresa"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Régimen Fiscal</label>
                  <select
                    value={editForm.regimen_fiscal || ''}
                    onChange={(e) => setEditForm({ ...editForm, regimen_fiscal: e.target.value })}
                    className="input"
                  >
                    <option value="">Seleccionar régimen fiscal</option>
                    <option value="601">601 — General de Ley Personas Morales</option>
                    <option value="608">608 — Demás Ingresos</option>
                    <option value="612">612 — Personas Físicas con Actividades Empresariales</option>
                    <option value="621">621 — Incorporación Fiscal (RIF)</option>
                    <option value="625">625 — Plataformas Tecnológicas</option>
                    <option value="626">626 — RESICO</option>
                  </select>
                </div>

                <div className="pt-1">
                  <label className="block text-sm font-semibold text-gray-800 mb-3">Domicilio de la Agencia</label>
                  <div className="space-y-3">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Calle</label>
                      <input
                        type="text"
                        value={editForm.street || ''}
                        onChange={(e) => setEditForm({ ...editForm, street: e.target.value })}
                        className="input"
                        placeholder="Ej: Av. Insurgentes Sur"
                      />
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">No. Exterior</label>
                        <input
                          type="text"
                          value={editForm.exterior_number || ''}
                          onChange={(e) => setEditForm({ ...editForm, exterior_number: e.target.value })}
                          className="input"
                          placeholder="123"
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                          No. Interior <span className="text-gray-400 font-normal">(opc.)</span>
                        </label>
                        <input
                          type="text"
                          value={editForm.interior_number || ''}
                          onChange={(e) => setEditForm({ ...editForm, interior_number: e.target.value })}
                          className="input"
                          placeholder="4B"
                        />
                      </div>
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Colonia</label>
                      <input
                        type="text"
                        value={editForm.colony || ''}
                        onChange={(e) => setEditForm({ ...editForm, colony: e.target.value })}
                        className="input"
                        placeholder="Ej: Roma Norte"
                      />
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Ciudad</label>
                        <input
                          type="text"
                          value={editForm.city || ''}
                          onChange={(e) => setEditForm({ ...editForm, city: e.target.value })}
                          className="input"
                          placeholder="Ciudad de México"
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Estado</label>
                        <input
                          type="text"
                          value={editForm.state || ''}
                          onChange={(e) => setEditForm({ ...editForm, state: e.target.value })}
                          className="input"
                          placeholder="CDMX"
                        />
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">C.P.</label>
                        <input
                          type="text"
                          value={editForm.postal_code || ''}
                          onChange={(e) => setEditForm({ ...editForm, postal_code: e.target.value })}
                          className="input"
                          placeholder="06700"
                          maxLength={5}
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">País</label>
                        <input
                          type="text"
                          value={editForm.country || ''}
                          onChange={(e) => setEditForm({ ...editForm, country: e.target.value })}
                          className="input"
                          placeholder="México"
                        />
                      </div>
                    </div>
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    RNT <span className="text-gray-400 font-normal">(Registro Nacional de Turismo)</span>
                  </label>
                  <input
                    type="text"
                    value={editForm.rnt || ''}
                    onChange={(e) => setEditForm({ ...editForm, rnt: e.target.value })}
                    className="input"
                    placeholder="Opcional"
                  />
                </div>

                <div className="flex justify-end gap-3 pt-2 border-t border-gray-100">
                  <button onClick={handleCancel} className="btn btn-outline" disabled={isSaving}>
                    <X className="h-4 w-4 mr-2" />Cancelar
                  </button>
                  <button onClick={handleSave} className="btn btn-primary" disabled={isSaving || !editForm.name.trim()}>
                    <Save className="h-4 w-4 mr-2" />
                    {isSaving ? 'Guardando...' : 'Guardar'}
                  </button>
                </div>
              </div>
            ) : (
              <div className="space-y-3">
                <div className="flex items-start gap-3 p-3 rounded-lg bg-gray-50 border-l-4 border-blue-200">
                  <FileText className="h-4 w-4 text-blue-500 mt-0.5 flex-shrink-0" />
                  <div>
                    <div className="text-xs font-medium text-gray-500 uppercase tracking-wide">RFC</div>
                    <div className="text-sm font-medium text-gray-900 mt-0.5">{agency.rfc || <span className="text-gray-400 font-normal">No especificado</span>}</div>
                  </div>
                </div>

                <div className="flex items-start gap-3 p-3 rounded-lg bg-gray-50 border-l-4 border-blue-200">
                  <Building2 className="h-4 w-4 text-blue-500 mt-0.5 flex-shrink-0" />
                  <div>
                    <div className="text-xs font-medium text-gray-500 uppercase tracking-wide">Razón Social</div>
                    <div className="text-sm font-medium text-gray-900 mt-0.5">{agency.razon_social || <span className="text-gray-400 font-normal">No especificado</span>}</div>
                  </div>
                </div>

                <div className="flex items-start gap-3 p-3 rounded-lg bg-gray-50 border-l-4 border-blue-200">
                  <Hash className="h-4 w-4 text-blue-500 mt-0.5 flex-shrink-0" />
                  <div>
                    <div className="text-xs font-medium text-gray-500 uppercase tracking-wide">Régimen Fiscal</div>
                    <div className="text-sm font-medium text-gray-900 mt-0.5">
                      {agency.regimen_fiscal
                        ? `${agency.regimen_fiscal} — ${getRegimenFiscalName(agency.regimen_fiscal)}`
                        : <span className="text-gray-400 font-normal">No especificado</span>}
                    </div>
                  </div>
                </div>

                {(agency.street || agency.city || agency.state) && (
                  <div className="flex items-start gap-3 p-3 rounded-lg bg-gray-50 border-l-4 border-blue-200">
                    <MapPin className="h-4 w-4 text-blue-500 mt-0.5 flex-shrink-0" />
                    <div>
                      <div className="text-xs font-medium text-gray-500 uppercase tracking-wide">Domicilio</div>
                      <div className="text-sm text-gray-900 mt-0.5 space-y-0.5">
                        {agency.street && (
                          <div>{agency.street}{agency.exterior_number && ` #${agency.exterior_number}`}{agency.interior_number && ` Int. ${agency.interior_number}`}</div>
                        )}
                        {agency.colony && <div>{agency.colony}</div>}
                        <div>
                          {agency.city}{agency.city && agency.state && ', '}{agency.state}{agency.postal_code && ` ${agency.postal_code}`}
                        </div>
                        {agency.country && <div>{agency.country}</div>}
                      </div>
                    </div>
                  </div>
                )}

                <div className="flex items-start gap-3 p-3 rounded-lg bg-gray-50 border-l-4 border-blue-200">
                  <Globe className="h-4 w-4 text-blue-500 mt-0.5 flex-shrink-0" />
                  <div>
                    <div className="text-xs font-medium text-gray-500 uppercase tracking-wide">RNT</div>
                    <div className="text-sm font-medium text-gray-900 mt-0.5">{agency.rnt || <span className="text-gray-400 font-normal">No especificado</span>}</div>
                  </div>
                </div>

                {contractInfo && (
                  <div className="flex items-center justify-between gap-3 p-4 rounded-lg bg-red-50 border border-red-200">
                    <div className="flex items-center gap-3">
                      <FileText className="h-5 w-5 text-red-600 flex-shrink-0" />
                      <div>
                        <div className="text-xs font-medium text-red-700 uppercase tracking-wide">Contrato firmado</div>
                        <div className="text-sm font-medium text-gray-900 mt-0.5">Folio: {contractInfo.folio}</div>
                      </div>
                    </div>
                    <button
                      onClick={handleDownloadContract}
                      disabled={downloadingContract}
                      className="inline-flex items-center gap-2 px-4 py-2 bg-red-600 text-white text-sm font-medium rounded-lg hover:bg-red-700 disabled:opacity-50 transition-colors"
                    >
                      <Download className="h-4 w-4" />
                      {downloadingContract ? 'Descargando...' : 'Descargar PDF'}
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Información Bancaria */}
          <div className="bg-white rounded-lg shadow-sm border border-gray-100 p-6">
            <div className="flex items-center gap-2 mb-5">
              <div className="h-8 w-8 rounded-lg bg-emerald-50 flex items-center justify-center">
                <Landmark className="h-4 w-4 text-emerald-600" />
              </div>
              <h2 className="text-base font-semibold text-gray-900">Información Bancaria</h2>
            </div>

            {isEditing ? (
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Banco</label>
                  <input
                    type="text"
                    value={editForm.banco || ''}
                    onChange={(e) => setEditForm({ ...editForm, banco: e.target.value })}
                    className="input"
                    placeholder="Ej: BBVA, Santander, etc."
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Cuenta CLABE</label>
                  <input
                    type="text"
                    value={editForm.cuenta_clabe || ''}
                    onChange={(e) => setEditForm({ ...editForm, cuenta_clabe: e.target.value })}
                    className="input"
                    placeholder="18 dígitos"
                    maxLength={18}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Titular de la Cuenta</label>
                  <input
                    type="text"
                    value={editForm.titular_cuenta || ''}
                    onChange={(e) => setEditForm({ ...editForm, titular_cuenta: e.target.value })}
                    className="input"
                    placeholder="Nombre del titular"
                  />
                </div>
                <div className="flex justify-end gap-3 pt-2 border-t border-gray-100">
                  <button onClick={handleCancel} className="btn btn-outline" disabled={isSaving}>
                    <X className="h-4 w-4 mr-2" />Cancelar
                  </button>
                  <button onClick={handleSave} className="btn btn-primary" disabled={isSaving || !editForm.name.trim()}>
                    <Save className="h-4 w-4 mr-2" />
                    {isSaving ? 'Guardando...' : 'Guardar'}
                  </button>
                </div>
              </div>
            ) : (
              <div className="space-y-3">
                <div className="flex items-start gap-3 p-3 rounded-lg bg-gray-50 border-l-4 border-emerald-200">
                  <Landmark className="h-4 w-4 text-emerald-500 mt-0.5 flex-shrink-0" />
                  <div>
                    <div className="text-xs font-medium text-gray-500 uppercase tracking-wide">Banco</div>
                    <div className="text-sm font-medium text-gray-900 mt-0.5">{agency.banco || <span className="text-gray-400 font-normal">No especificado</span>}</div>
                  </div>
                </div>

                <div className="flex items-start gap-3 p-3 rounded-lg bg-gray-50 border-l-4 border-emerald-200">
                  <Hash className="h-4 w-4 text-emerald-500 mt-0.5 flex-shrink-0" />
                  <div>
                    <div className="text-xs font-medium text-gray-500 uppercase tracking-wide">Cuenta CLABE</div>
                    <div className="text-sm font-medium text-gray-900 mt-0.5 font-mono tracking-wider">
                      {agency.cuenta_clabe ? formatClabe(agency.cuenta_clabe) : <span className="text-gray-400 font-normal font-sans">No especificado</span>}
                    </div>
                  </div>
                </div>

                <div className="flex items-start gap-3 p-3 rounded-lg bg-gray-50 border-l-4 border-emerald-200">
                  <User className="h-4 w-4 text-emerald-500 mt-0.5 flex-shrink-0" />
                  <div>
                    <div className="text-xs font-medium text-gray-500 uppercase tracking-wide">Titular</div>
                    <div className="text-sm font-medium text-gray-900 mt-0.5">{agency.titular_cuenta || <span className="text-gray-400 font-normal">No especificado</span>}</div>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Fila 2: Info Agencia (2/3) + Contacto & Propietario (1/3) */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mt-6">
          {/* Información de la Agencia */}
          <div className="lg:col-span-2">
            <div className="bg-white rounded-lg shadow-sm border border-gray-100 p-6 h-full">
              <div className="flex items-center gap-2 mb-5">
                <div className="h-8 w-8 rounded-lg bg-primary-50 flex items-center justify-center">
                  <Building className="h-4 w-4 text-primary-600" />
                </div>
                <h2 className="text-base font-semibold text-gray-900">Información de la Agencia</h2>
              </div>

              {isEditing ? (
                <div className="space-y-5">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Nombre de la Agencia *</label>
                    <input
                      type="text"
                      value={editForm.name}
                      onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
                      className="input"
                      required
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Descripción</label>
                    <textarea
                      value={editForm.description}
                      onChange={(e) => setEditForm({ ...editForm, description: e.target.value })}
                      className="input"
                      rows={4}
                      placeholder="Describe tu agencia, servicios y experiencia..."
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">Logo de la Agencia</label>
                    <ImageUploader
                      onImageSelect={handleLogoSelect}
                      currentImage={editForm.logo}
                      maxSizeMB={2}
                      placeholder="Subir logo de la agencia"
                      storageFolder="agencies"
                    />
                  </div>

                  {/* Cover image */}
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Imagen de Portada del Perfil Público
                    </label>
                    <p className="text-xs text-gray-500 mb-2">
                      Se muestra como fondo en la parte superior de tu página pública. Recomendado: 1200×400 px.
                    </p>
                    <ImageUploader
                      onImageSelect={(url) => setEditForm({ ...editForm, cover_image_url: url })}
                      currentImage={editForm.cover_image_url}
                      maxSizeMB={5}
                      placeholder="Subir imagen de portada"
                      storageFolder="agencies"
                    />
                  </div>

                  {/* Custom slug */}
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      URL Personalizada de tu Perfil
                    </label>
                    <div className="flex rounded-lg overflow-hidden border border-gray-300 focus-within:ring-2 focus-within:ring-blue-500 focus-within:border-blue-500">
                      <span className="inline-flex items-center px-3 bg-gray-50 text-gray-500 text-sm border-r border-gray-300 whitespace-nowrap">
                        /agencies/
                      </span>
                      <input
                        type="text"
                        value={editForm.custom_slug}
                        onChange={(e) => handleSlugChange(e.target.value)}
                        placeholder="mi-agencia"
                        className="flex-1 px-3 py-2 text-sm outline-none bg-white"
                        maxLength={60}
                      />
                      {slugStatus === 'checking' && (
                        <span className="inline-flex items-center px-3 text-gray-400">
                          <div className="h-4 w-4 border-2 border-gray-300 border-t-blue-500 rounded-full animate-spin" />
                        </span>
                      )}
                      {slugStatus === 'available' && (
                        <span className="inline-flex items-center px-3 text-green-600">
                          <CheckCircle className="h-4 w-4" />
                        </span>
                      )}
                      {slugStatus === 'taken' && (
                        <span className="inline-flex items-center px-3 text-red-500">
                          <AlertCircle className="h-4 w-4" />
                        </span>
                      )}
                      {slugStatus === 'invalid' && (
                        <span className="inline-flex items-center px-3 text-orange-500">
                          <AlertCircle className="h-4 w-4" />
                        </span>
                      )}
                    </div>
                    {slugStatus === 'available' && editForm.custom_slug && (
                      <p className="text-xs text-green-600 mt-1 flex items-center gap-1">
                        <CheckCircle className="h-3 w-3" /> URL disponible
                      </p>
                    )}
                    {slugStatus === 'taken' && (
                      <p className="text-xs text-red-500 mt-1 flex items-center gap-1">
                        <AlertCircle className="h-3 w-3" /> Esta URL ya está en uso por otra agencia
                      </p>
                    )}
                    {slugStatus === 'invalid' && (
                      <p className="text-xs text-orange-500 mt-1 flex items-center gap-1">
                        <AlertCircle className="h-3 w-3" /> Solo letras minúsculas, números y guiones (-)
                      </p>
                    )}
                    {editForm.custom_slug && slugStatus === 'idle' && (
                      <p className="text-xs text-gray-500 mt-1">
                        Tu perfil público estará en: <strong>/agencies/{editForm.custom_slug}</strong>
                      </p>
                    )}
                    {!editForm.custom_slug && (
                      <p className="text-xs text-gray-400 mt-1">
                        Deja vacío para seguir usando la URL con ID único
                      </p>
                    )}
                  </div>

                  <div className="flex justify-end gap-3 pt-2 border-t border-gray-100">
                    <button onClick={handleCancel} className="btn btn-outline" disabled={isSaving}>
                      <X className="h-4 w-4 mr-2" />Cancelar
                    </button>
                    <button onClick={handleSave} className="btn btn-primary" disabled={isSaving || !editForm.name.trim()}>
                      <Save className="h-4 w-4 mr-2" />
                      {isSaving ? 'Guardando...' : 'Guardar Cambios'}
                    </button>
                  </div>
                </div>
              ) : (
                <div className="space-y-4">
                  <div>
                    <h3 className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-2">Descripción</h3>
                    <p className="text-sm text-gray-800 leading-relaxed">
                      {agency.description || <span className="text-gray-400 italic">Sin descripción disponible.</span>}
                    </p>
                  </div>

                  <div className="grid grid-cols-2 gap-4 pt-3 border-t border-gray-100">
                    <div>
                      <h3 className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-1">Fecha de Registro</h3>
                      <div className="flex items-center text-sm text-gray-800">
                        <Calendar className="h-4 w-4 mr-2 text-gray-400" />
                        {new Date(agency.created_at).toLocaleDateString('es-ES', { year: 'numeric', month: 'long', day: 'numeric' })}
                      </div>
                    </div>
                    <div>
                      <h3 className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-1">Última Actualización</h3>
                      <div className="flex items-center text-sm text-gray-800">
                        <Calendar className="h-4 w-4 mr-2 text-gray-400" />
                        {new Date(agency.updated_at).toLocaleDateString('es-ES', { year: 'numeric', month: 'long', day: 'numeric' })}
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Columna derecha: Contacto + Propietario */}
          <div className="space-y-6">
            {/* Información de Contacto */}
            <div className="bg-white rounded-lg shadow-sm border border-gray-100 p-6">
              <div className="flex items-center gap-2 mb-5">
                <div className="h-8 w-8 rounded-lg bg-violet-50 flex items-center justify-center">
                  <Mail className="h-4 w-4 text-violet-600" />
                </div>
                <h2 className="text-base font-semibold text-gray-900">Contacto</h2>
              </div>

              {isEditing ? (
                <div className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Email de Contacto *</label>
                    <input
                      type="email"
                      value={editForm.contact_email}
                      onChange={(e) => setEditForm({ ...editForm, contact_email: e.target.value })}
                      className="input"
                      required
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Teléfono</label>
                    <input
                      type="tel"
                      value={editForm.contact_phone}
                      onChange={(e) => setEditForm({ ...editForm, contact_phone: e.target.value })}
                      className="input"
                      placeholder="+52 (55) 1234-5678"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Sitio Web</label>
                    <input
                      type="url"
                      value={editForm.website}
                      onChange={(e) => setEditForm({ ...editForm, website: e.target.value })}
                      className="input"
                      placeholder="https://www.tuagencia.com"
                    />
                  </div>
                  <div className="flex justify-end gap-3 pt-2 border-t border-gray-100">
                    <button onClick={handleCancel} className="btn btn-outline" disabled={isSaving}>
                      <X className="h-4 w-4 mr-2" />Cancelar
                    </button>
                    <button onClick={handleSave} className="btn btn-primary" disabled={isSaving || !editForm.name.trim()}>
                      <Save className="h-4 w-4 mr-2" />
                      {isSaving ? 'Guardando...' : 'Guardar'}
                    </button>
                  </div>
                </div>
              ) : (
                <div className="space-y-3">
                  <div className="flex items-start gap-3 p-3 rounded-lg bg-gray-50 border-l-4 border-violet-200">
                    <Mail className="h-4 w-4 text-violet-500 mt-0.5 flex-shrink-0" />
                    <div>
                      <div className="text-xs font-medium text-gray-500 uppercase tracking-wide">Email</div>
                      <div className="text-sm font-medium text-gray-900 mt-0.5 break-all">{agency.contact_email}</div>
                    </div>
                  </div>

                  {agency.contact_phone && (
                    <div className="flex items-start gap-3 p-3 rounded-lg bg-gray-50 border-l-4 border-violet-200">
                      <Phone className="h-4 w-4 text-violet-500 mt-0.5 flex-shrink-0" />
                      <div>
                        <div className="text-xs font-medium text-gray-500 uppercase tracking-wide">Teléfono</div>
                        <div className="text-sm font-medium text-gray-900 mt-0.5">{agency.contact_phone}</div>
                      </div>
                    </div>
                  )}

                  {agency.website && (
                    <div className="flex items-start gap-3 p-3 rounded-lg bg-gray-50 border-l-4 border-violet-200">
                      <Globe className="h-4 w-4 text-violet-500 mt-0.5 flex-shrink-0" />
                      <div>
                        <div className="text-xs font-medium text-gray-500 uppercase tracking-wide">Sitio Web</div>
                        <a href={agency.website} target="_blank" rel="noopener noreferrer" className="text-sm font-medium text-primary-600 hover:text-primary-700 mt-0.5 block break-all">
                          {agency.website}
                        </a>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Datos del Propietario */}
            <div className="bg-white rounded-lg shadow-sm border border-gray-100 p-6">
              <div className="flex items-center gap-2 mb-5">
                <div className="h-8 w-8 rounded-lg bg-amber-50 flex items-center justify-center">
                  <User className="h-4 w-4 text-amber-600" />
                </div>
                <h2 className="text-base font-semibold text-gray-900">Propietario</h2>
              </div>

              {isEditing ? (
                <div className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Nombre</label>
                    <input
                      type="text"
                      value={editForm.first_name}
                      onChange={(e) => setEditForm({ ...editForm, first_name: e.target.value })}
                      className="input"
                      placeholder="Nombre"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Apellido</label>
                    <input
                      type="text"
                      value={editForm.last_name}
                      onChange={(e) => setEditForm({ ...editForm, last_name: e.target.value })}
                      className="input"
                      placeholder="Apellido"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Email del Usuario</label>
                    <div className="flex items-center p-3 bg-gray-50 rounded-md border border-gray-200">
                      <Mail className="h-4 w-4 text-gray-400 mr-2 flex-shrink-0" />
                      <span className="text-sm text-gray-600 break-all">{agency.users?.email}</span>
                    </div>
                    <p className="text-xs text-gray-400 mt-1">El email no se puede modificar desde aquí</p>
                  </div>
                  <div className="flex justify-end gap-3 pt-2 border-t border-gray-100">
                    <button onClick={handleCancel} className="btn btn-outline" disabled={isSaving}>
                      <X className="h-4 w-4 mr-2" />Cancelar
                    </button>
                    <button onClick={handleSave} className="btn btn-primary" disabled={isSaving || !editForm.name.trim()}>
                      <Save className="h-4 w-4 mr-2" />
                      {isSaving ? 'Guardando...' : 'Guardar'}
                    </button>
                  </div>
                </div>
              ) : (
                <div className="space-y-3">
                  <div className="flex items-start gap-3 p-3 rounded-lg bg-gray-50 border-l-4 border-amber-200">
                    <User className="h-4 w-4 text-amber-500 mt-0.5 flex-shrink-0" />
                    <div>
                      <div className="text-xs font-medium text-gray-500 uppercase tracking-wide">Nombre Completo</div>
                      <div className="text-sm font-medium text-gray-900 mt-0.5">
                        {editForm.first_name || editForm.last_name
                          ? `${editForm.first_name || ''} ${editForm.last_name || ''}`.trim()
                          : <span className="text-gray-400 font-normal">No especificado</span>}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-start gap-3 p-3 rounded-lg bg-gray-50 border-l-4 border-amber-200">
                    <Mail className="h-4 w-4 text-amber-500 mt-0.5 flex-shrink-0" />
                    <div>
                      <div className="text-xs font-medium text-gray-500 uppercase tracking-wide">Email</div>
                      <div className="text-sm font-medium text-gray-900 mt-0.5 break-all">{agency.users?.email}</div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

        {executive && (
          <div className="bg-white rounded-lg shadow-sm border border-gray-100 overflow-hidden mt-6">
            <div className="flex items-center gap-2 px-6 pt-6 pb-1">
              <div className="h-8 w-8 rounded-lg bg-blue-50 flex items-center justify-center">
                <Briefcase className="h-4 w-4 text-blue-600" />
              </div>
              <h2 className="text-base font-semibold text-gray-900">Ejecutivo de Cuenta</h2>
            </div>
            <div className="px-6 pb-6 pt-2">
              <div className="space-y-3">
                <div className="flex items-start gap-3 p-3 rounded-lg bg-gray-50 border-l-4 border-blue-200">
                  <User className="h-4 w-4 text-blue-500 mt-0.5 flex-shrink-0" />
                  <div>
                    <div className="text-xs font-medium text-gray-500 uppercase tracking-wide">Nombre</div>
                    <div className="text-sm font-medium text-gray-900 mt-0.5">
                      {`${executive.first_name} ${executive.last_name}`.trim()}
                    </div>
                  </div>
                </div>
                <div className="flex items-start gap-3 p-3 rounded-lg bg-gray-50 border-l-4 border-blue-200">
                  <Mail className="h-4 w-4 text-blue-500 mt-0.5 flex-shrink-0" />
                  <div>
                    <div className="text-xs font-medium text-gray-500 uppercase tracking-wide">Email</div>
                    <div className="text-sm font-medium text-gray-900 mt-0.5 break-all">{executive.email}</div>
                  </div>
                </div>
                {executive.phone && (
                  <div className="flex items-start gap-3 p-3 rounded-lg bg-gray-50 border-l-4 border-blue-200">
                    <Phone className="h-4 w-4 text-blue-500 mt-0.5 flex-shrink-0" />
                    <div>
                      <div className="text-xs font-medium text-gray-500 uppercase tracking-wide">Teléfono</div>
                      <div className="text-sm font-medium text-gray-900 mt-0.5">{executive.phone}</div>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Fila 3: Seguridad + Cuentas Vinculadas */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mt-6">
          <div className="bg-white rounded-lg shadow-sm border border-gray-100 overflow-hidden">
            <div className="flex items-center gap-2 px-6 pt-6 pb-1">
              <div className="h-8 w-8 rounded-lg bg-slate-50 flex items-center justify-center">
                <Shield className="h-4 w-4 text-slate-600" />
              </div>
              <h2 className="text-base font-semibold text-gray-900">Seguridad</h2>
            </div>
            <ChangePasswordSection />
          </div>

          <div className="bg-white rounded-lg shadow-sm border border-gray-100 overflow-hidden">
            <div className="flex items-center gap-2 px-6 pt-6 pb-1">
              <div className="h-8 w-8 rounded-lg bg-slate-50 flex items-center justify-center">
                <Link2 className="h-4 w-4 text-slate-600" />
              </div>
              <h2 className="text-base font-semibold text-gray-900">Cuentas Vinculadas</h2>
            </div>
            <LinkedAccountsSection />
          </div>
        </div>
      </div>
    </div>
  );
};

export default AgencyProfile;