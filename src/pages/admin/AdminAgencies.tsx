import React, { useState, useEffect } from 'react';
import { Building, Users, Eye, EyeOff, Mail, Phone, Globe, Calendar, Search, Filter, MoreVertical, CheckCircle, XCircle, CreditCard as Edit, Save, X, Percent, DollarSign, AlertTriangle, User, MapPin, ArrowUpDown, ArrowUp, ArrowDown, FileText, RefreshCw } from 'lucide-react';
import { getAllAgencies, updateAgencyStatus, supabase } from '../../lib/supabase';
import { formatCurrency, formatCurrencyMXN } from '../../utils/formatCurrency';
import AgencyContractSection from '../../components/AgencyContractSection';

interface Agency {
  id: string;
  user_id: string;
  name: string;
  description?: string;
  logo?: string;
  contact_email: string;
  contact_phone?: string;
  website?: string;
  rating?: number;
  is_active: boolean;
  is_approved?: boolean;
  onboarding_status?: string;
  signed_contract_url?: string | null;
  persona_type?: string;
  representante_legal_nombre?: string | null;
  rejection_category?: string | null;
  rejection_reason?: string | null;
  created_at: string;
  updated_at: string;
  commission_rate?: number;
  commission_percentage?: number | null;
  pending_amendment_id?: string | null;
  rfc?: string;
  razon_social?: string;
  regimen_fiscal?: string;
  domicilio_fiscal?: string;
  street?: string;
  exterior_number?: string;
  interior_number?: string;
  colony?: string;
  city?: string;
  state?: string;
  postal_code?: string;
  country?: string;
  banco?: string;
  cuenta_clabe?: string;
  titular_cuenta?: string;
  users?: {
    first_name?: string;
    last_name?: string;
    email: string;
  };
  tour_count?: number;
  booking_count?: number;
  total_revenue?: number;
  platform_commission?: number;
}

const AdminAgencies: React.FC = () => {
  const [agencies, setAgencies] = useState<Agency[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  const [filterStatus, setFilterStatus] = useState<'all' | 'active' | 'inactive'>('all');
  const [selectedAgency, setSelectedAgency] = useState<Agency | null>(null);
  const [isUpdating, setIsUpdating] = useState<string | null>(null);
  const [isEditingAgency, setIsEditingAgency] = useState(false);
  const [sortColumn, setSortColumn] = useState<string | null>(null);
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc');
  const [editForm, setEditForm] = useState({
    name: '',
    description: '',
    contact_email: '',
    contact_phone: '',
    website: '',
    commission_rate: 0.10,
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
    country: '',
    banco: '',
    cuenta_clabe: '',
    titular_cuenta: '',
    first_name: '',
    last_name: '',
    persona_type: '' as '' | 'persona_fisica' | 'persona_moral',
    representante_legal_nombre: '',
  });
  const [commissionInput, setCommissionInput] = useState('10');
  // commission_percentage override (null = use platform default)
  const [commissionPctInput, setCommissionPctInput] = useState<string>('');
  const [useSpecialCommission, setUseSpecialCommission] = useState(false);
  const [resignModal, setResignModal] = useState<{
    show: boolean;
    agencyId: string;
    agencyName: string;
    newPct: number;
    hasSignedContract: boolean;
  } | null>(null);
  const [isResigning, setIsResigning] = useState(false);
  const [platformDefaultCommission, setPlatformDefaultCommission] = useState<number>(15);

  useEffect(() => {
    fetchAgencies();
    supabase.from('platform_settings').select('agency_commission_percentage').limit(1).maybeSingle()
      .then(({ data }) => { if (data?.agency_commission_percentage) setPlatformDefaultCommission(data.agency_commission_percentage); });
  }, []);

  const fetchAgencies = async () => {
    try {
      setIsLoading(true);
      setError('');
      
      console.log('🏢 Cargando agencias desde la BD...');
      
      // OPTIMIZED: Select only needed columns + pagination (limit 100 agencies)
      const { data: agenciesData, error: agenciesError } = await supabase
        .from('agencies')
        .select(`
          id,
          name,
          is_active,
          created_at,
          contact_phone,
          contact_email,
          website,
          rating,
          commission_rate,
          commission_percentage,
          pending_amendment_id,
          description,
          rfc,
          razon_social,
          regimen_fiscal,
          domicilio_fiscal,
          street,
          exterior_number,
          interior_number,
          colony,
          city,
          state,
          postal_code,
          country,
          user_id,
          account_executive_id,
          onboarding_status,
          signed_contract_url,
          persona_type,
          representante_legal_nombre,
          banco,
          cuenta_clabe,
          titular_cuenta,
          rejection_category,
          rejection_reason,
          users!agencies_user_id_fkey(first_name, last_name, email, is_approved)
        `)
        .order('created_at', { ascending: false })
        .limit(100);

      if (agenciesError) {
        throw new Error(agenciesError.message);
      }

      console.log('✅ Agencias cargadas:', agenciesData);

      // Obtener estadísticas de tours, reservas y ingresos para cada agencia
      const agenciesWithStats = await Promise.all(
        (agenciesData || []).map(async (agency) => {
          try {
            // OPTIMIZED: Count only IDs instead of all columns
            const { count: tourCount } = await supabase
              .from('tours')
              .select('id', { count: 'exact', head: true })
              .eq('agency_id', agency.id);

            // OPTIMIZED: Count only IDs instead of all columns
            const { count: bookingCount } = await supabase
              .from('bookings')
              .select('id', { count: 'exact', head: true })
              .eq('agency_id', agency.id)
              .neq('status', 'draft');

            // Calcular ingresos totales (suma de agency_net_amount de commission_records)
            const { data: commissionData, error: commissionError } = await supabase
              .from('commission_records')
              .select('agency_net_amount, agency_commission_amount')
              .eq('agency_id', agency.id)
              .in('status', ['processed', 'pending']);

            if (commissionError) {
              console.error(`❌ Error obteniendo comisiones para ${agency.name}:`, commissionError);
            }

            console.log(`📊 Comisiones para ${agency.name}:`, commissionData);

            const totalRevenue = commissionData?.reduce((sum, record) =>
              sum + (parseFloat(record.agency_net_amount) || 0), 0) || 0;

            const platformCommission = commissionData?.reduce((sum, record) =>
              sum + (parseFloat(record.agency_commission_amount) || 0), 0) || 0;

            console.log(`💰 ${agency.name} - Revenue: ${totalRevenue}, Commission: ${platformCommission}`);

            return {
              ...agency,
              is_approved: agency.users?.is_approved,
              tour_count: tourCount || 0,
              booking_count: bookingCount || 0,
              total_revenue: totalRevenue,
              platform_commission: platformCommission
            };
          } catch (err) {
            console.error('Error obteniendo estadísticas para agencia:', agency.id, err);
            return {
              ...agency,
              tour_count: 0,
              booking_count: 0,
              total_revenue: 0,
              platform_commission: 0
            };
          }
        })
      );

      // Fetch executive names for assigned agencies
      const execIds = [...new Set(agenciesWithStats.map((a: any) => a.account_executive_id).filter(Boolean))];
      const execNameMap: Record<string, string> = {};
      if (execIds.length > 0) {
        const { data: execs } = await supabase
          .from('account_executives')
          .select('id, first_name, last_name')
          .in('id', execIds);
        (execs || []).forEach((e: any) => { execNameMap[e.id] = `${e.first_name} ${e.last_name}`; });
      }

      const agenciesWithExec = agenciesWithStats.map((a: any) => ({
        ...a,
        _executive_name: a.account_executive_id ? (execNameMap[a.account_executive_id] || 'Ejecutivo') : null,
      }));

      setAgencies(agenciesWithExec);
    } catch (err: any) {
      console.error('❌ Error cargando agencias:', err);
      setError(err.message || 'Error al cargar las agencias');
    } finally {
      setIsLoading(false);
    }
  };

  const handleApprovalToggle = async (userId: string, currentApproval: boolean) => {
    try {
      setIsUpdating(userId);

      const newApprovalStatus = !currentApproval;

      const { error } = await supabase
        .from('users')
        .update({ is_approved: newApprovalStatus })
        .eq('id', userId);

      if (error) throw new Error(error.message);

      // Actualizar estado local
      setAgencies(agencies.map(agency =>
        agency.user_id === userId
          ? { ...agency, is_approved: newApprovalStatus }
          : agency
      ));

      if (newApprovalStatus && !currentApproval) {
        const agency = agencies.find(a => a.user_id === userId);
        if (agency) {
          // Resolver datos del ejecutivo si la agencia tiene uno asignado
          let executiveName = 'ToursRed';
          let executiveEmail = 'agencias@toursred.com.mx';
          if ((agency as any).account_executive_id && (agency as any)._executive_name) {
            executiveName = (agency as any)._executive_name;
            // Buscar email del ejecutivo
            try {
              const { data: execData } = await supabase
                .from('account_executives')
                .select('email')
                .eq('id', (agency as any).account_executive_id)
                .maybeSingle();
              if (execData?.email) executiveEmail = execData.email;
            } catch { /* ignorar */ }
          }

          // Enviar email de aprobación (fire-and-forget)
          fetch(
            `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/send-agency-approval`,
            {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                agencyName: agency.name,
                contactEmail: agency.contact_email,
                contactFirstName: agency.users?.first_name || agency.name,
                contactLastName: agency.users?.last_name || '',
                executiveName,
                executiveEmail,
              }),
            }
          ).catch(err => console.error('Error sending approval email:', err));

          // Sync to accounting (fire-and-forget)
          supabase.functions.invoke('sync-contact-to-accounting', {
            body: { contact_type: 'agency', contact_id: agency.id },
          }).catch(err => console.error('Error syncing agency to accounting:', err));
        }
      }

      setError('');
    } catch (err: any) {
      setError(err.message || 'Error al cambiar estado de aprobación');
    } finally {
      setIsUpdating(null);
    }
  };

  const handleStatusToggle = async (agencyId: string, currentStatus: boolean) => {
    try {
      setIsUpdating(agencyId);

      const { error } = await updateAgencyStatus(agencyId, !currentStatus);

      if (error) {
        throw new Error(error.message);
      }

      // Actualizar el estado local
      setAgencies(agencies.map(agency =>
        agency.id === agencyId
          ? { ...agency, is_active: !currentStatus }
          : agency
      ));

      console.log(`✅ Estado de agencia ${agencyId} actualizado a:`, !currentStatus);
    } catch (err: any) {
      console.error('❌ Error actualizando estado de agencia:', err);
      setError(err.message || 'Error al actualizar el estado de la agencia');
    } finally {
      setIsUpdating(null);
    }
  };

  const handleUpdateAgency = async () => {
    if (!selectedAgency) return;

    try {
      setIsUpdating(selectedAgency.id);
      setError('');

      const commissionChanged = editForm.commission_rate !== selectedAgency.commission_rate;

      // Actualizar datos de la agencia
      const { data: updateData, error: agencyError } = await supabase
        .from('agencies')
        .update({
          name: editForm.name,
          description: editForm.description || null,
          contact_email: editForm.contact_email,
          contact_phone: editForm.contact_phone || null,
          website: editForm.website || null,
          commission_rate: editForm.commission_rate,
          rfc: editForm.rfc || null,
          razon_social: editForm.razon_social || null,
          regimen_fiscal: editForm.regimen_fiscal || null,
          domicilio_fiscal: editForm.domicilio_fiscal || null,
          street: editForm.street || null,
          exterior_number: editForm.exterior_number || null,
          interior_number: editForm.interior_number || null,
          colony: editForm.colony || null,
          city: editForm.city || null,
          state: editForm.state || null,
          postal_code: editForm.postal_code || null,
          country: editForm.country || null,
          banco: editForm.banco || null,
          cuenta_clabe: editForm.cuenta_clabe || null,
          titular_cuenta: editForm.titular_cuenta || null,
          persona_type: editForm.persona_type || null,
          representante_legal_nombre: editForm.representante_legal_nombre || null,
          updated_at: new Date().toISOString()
        })
        .eq('id', selectedAgency.id)
        .select();

      if (agencyError) {
        throw new Error(`Error actualizando agencia: ${agencyError.message}`);
      }

      // Actualizar datos del usuario propietario
      const { error: userError } = await supabase
        .from('users')
        .update({
          first_name: editForm.first_name || null,
          last_name: editForm.last_name || null,
          updated_at: new Date().toISOString()
        })
        .eq('id', selectedAgency.user_id);

      if (userError) {
        console.warn('⚠️ Error actualizando datos del usuario:', userError);
      }

      // Audit log explícito cuando cambia la comisión base (commission_rate)
      if (commissionChanged) {
        const { data: { user: adminUser } } = await supabase.auth.getUser();
        await supabase.rpc('insert_audit_log', {
          p_tenant_type: 'admin',
          p_actor_id: adminUser?.id ?? null,
          p_actor_email: adminUser?.email ?? null,
          p_actor_role: 'admin',
          p_target_table: 'agencies',
          p_target_id: selectedAgency.id,
          p_action: 'UPDATE_COMMISSION',
          p_old_values: { commission_rate: selectedAgency.commission_rate },
          p_new_values: { commission_rate: editForm.commission_rate },
          p_metadata: {
            changed_field: 'commission_rate',
            agency_name: selectedAgency.name,
            old_percentage: (selectedAgency.commission_rate ?? 0) * 100,
            new_percentage: editForm.commission_rate * 100
          }
        });
      }

      // Handle negotiated commission_percentage change
      const newCommissionPct = useSpecialCommission && commissionPctInput.trim() !== ''
        ? parseFloat(commissionPctInput)
        : null;
      const oldCommissionPct = selectedAgency.commission_percentage ?? null;
      const commissionPctChanged = newCommissionPct !== oldCommissionPct;

      if (commissionPctChanged) {
        // Check if agency already has a signed contract
        const { data: signedContract } = await supabase
          .from('contract_acceptances')
          .select('id')
          .eq('agency_id', selectedAgency.id)
          .eq('status', 'signed')
          .maybeSingle();

        if (signedContract && newCommissionPct !== null) {
          // Must go through resign flow — show modal, do NOT save silently
          setResignModal({
            show:            true,
            agencyId:        selectedAgency.id,
            agencyName:      selectedAgency.name,
            newPct:          newCommissionPct,
            hasSignedContract: true,
          });
          setIsUpdating(null);
          return; // exit without refreshing so the modal is shown
        }

        // No signed contract — save directly
        const { data: { user: adminUser } } = await supabase.auth.getUser();
        await supabase.from('agencies')
          .update({ commission_percentage: newCommissionPct })
          .eq('id', selectedAgency.id);

        await supabase.rpc('insert_audit_log', {
          p_tenant_type: 'admin',
          p_actor_id:    adminUser?.id ?? null,
          p_actor_email: adminUser?.email ?? null,
          p_actor_role:  'admin',
          p_target_table: 'agencies',
          p_target_id:   selectedAgency.id,
          p_action:      'UPDATE_COMMISSION_PERCENTAGE',
          p_old_values:  { commission_percentage: oldCommissionPct },
          p_new_values:  { commission_percentage: newCommissionPct },
          p_metadata:    { agency_name: selectedAgency.name },
          p_severity:    'info',
        });
      }

      await fetchAgencies();
      setIsEditingAgency(false);
      setSelectedAgency(null);
    } catch (err: any) {
      console.error('❌ Error actualizando agencia:', err);
      setError(err.message || 'Error al actualizar la agencia');
    } finally {
      setIsUpdating(null);
    }
  };

  const openEditModal = (agency: Agency) => {
    setEditForm({
      name: agency.name,
      description: agency.description || '',
      contact_email: agency.contact_email,
      contact_phone: agency.contact_phone || '',
      website: agency.website || '',
      commission_rate: agency.commission_rate || 0.10,
      rfc: agency.rfc || '',
      razon_social: agency.razon_social || '',
      regimen_fiscal: agency.regimen_fiscal || '',
      domicilio_fiscal: agency.domicilio_fiscal || '',
      street: agency.street || '',
      exterior_number: agency.exterior_number || '',
      interior_number: agency.interior_number || '',
      colony: agency.colony || '',
      city: agency.city || '',
      state: agency.state || '',
      postal_code: agency.postal_code || '',
      country: agency.country || '',
      banco: agency.banco || '',
      cuenta_clabe: agency.cuenta_clabe || '',
      titular_cuenta: agency.titular_cuenta || '',
      first_name: agency.users?.first_name || '',
      last_name: agency.users?.last_name || '',
      persona_type: (agency.persona_type as '' | 'persona_fisica' | 'persona_moral') || '',
      representante_legal_nombre: agency.representante_legal_nombre || '',
    });
    const rate = agency.commission_rate || 0.10;
    const pct = rate * 100;
    setCommissionInput(Number.isInteger(pct) ? String(pct) : pct.toFixed(1));
    // Initialize negotiated commission fields
    if (agency.commission_percentage != null) {
      setUseSpecialCommission(true);
      setCommissionPctInput(String(agency.commission_percentage));
    } else {
      setUseSpecialCommission(false);
      setCommissionPctInput('');
    }
    setSelectedAgency(agency);
    setIsEditingAgency(true);
  };

  const closeModals = () => {
    setSelectedAgency(null);
    setIsEditingAgency(false);
    setError('');
  };

  const handleResign = async () => {
    if (!resignModal) return;
    setIsResigning(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/approve-agency-documents`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session?.access_token}`,
        },
        body: JSON.stringify({
          agency_id: resignModal.agencyId,
          action: 'resign',
          new_commission_percentage: resignModal.newPct,
        }),
      });
      const result = await res.json();
      if (!res.ok) {
        alert(`Error al iniciar enmienda: ${result.error || 'Error desconocido'}`);
        return;
      }
      setResignModal(null);
      setIsEditingAgency(false);
      await fetchAgencies();
      alert(`Enmienda iniciada exitosamente (folio: ${result.folio}). La agencia recibirá una notificación para firmar.`);
    } catch (err) {
      console.error('Resign error:', err);
      alert('Error al iniciar la enmienda. Intenta de nuevo.');
    } finally {
      setIsResigning(false);
    }
  };

  const handleSort = (column: string) => {
    if (sortColumn === column) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      setSortColumn(column);
      setSortDirection('asc');
    }
  };

  const getSortIcon = (column: string) => {
    if (sortColumn !== column) {
      return <ArrowUpDown className="h-4 w-4" />;
    }
    return sortDirection === 'asc' ? (
      <ArrowUp className="h-4 w-4" />
    ) : (
      <ArrowDown className="h-4 w-4" />
    );
  };

  const filteredAgencies = agencies
    .filter(agency => {
      const matchesSearch =
        agency.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
        agency.contact_email.toLowerCase().includes(searchTerm.toLowerCase()) ||
        (agency.users?.email || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
        (agency.users?.first_name || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
        (agency.users?.last_name || '').toLowerCase().includes(searchTerm.toLowerCase());

      const matchesFilter =
        filterStatus === 'all' ||
        (filterStatus === 'active' && agency.is_active) ||
        (filterStatus === 'inactive' && !agency.is_active);

      return matchesSearch && matchesFilter;
    })
    .sort((a, b) => {
      if (!sortColumn) return 0;

      let aValue: any;
      let bValue: any;

      switch (sortColumn) {
        case 'name':
          aValue = a.name.toLowerCase();
          bValue = b.name.toLowerCase();
          break;
        case 'owner':
          aValue = `${a.users?.first_name || ''} ${a.users?.last_name || ''}`.toLowerCase();
          bValue = `${b.users?.first_name || ''} ${b.users?.last_name || ''}`.toLowerCase();
          break;
        case 'tours':
          aValue = a.tour_count || 0;
          bValue = b.tour_count || 0;
          break;
        case 'bookings':
          aValue = a.booking_count || 0;
          bValue = b.booking_count || 0;
          break;
        case 'revenue':
          aValue = a.total_revenue || 0;
          bValue = b.total_revenue || 0;
          break;
        case 'commission':
          aValue = a.commission_rate || 0;
          bValue = b.commission_rate || 0;
          break;
        case 'platform_commission':
          aValue = a.platform_commission || 0;
          bValue = b.platform_commission || 0;
          break;
        case 'status':
          aValue = a.is_active ? 1 : 0;
          bValue = b.is_active ? 1 : 0;
          break;
        default:
          return 0;
      }

      if (aValue < bValue) return sortDirection === 'asc' ? -1 : 1;
      if (aValue > bValue) return sortDirection === 'asc' ? 1 : -1;
      return 0;
    });

  const getStatusBadge = (isActive: boolean) => {
    if (isActive) {
      return (
        <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-success-100 text-success-800">
          <CheckCircle className="h-3 w-3 mr-1" />
          Activa
        </span>
      );
    } else {
      return (
        <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-error-100 text-error-800">
          <XCircle className="h-3 w-3 mr-1" />
          Inactiva
        </span>
      );
    }
  };

  const getApprovalBadge = (isApproved: boolean | undefined) => {
    if (isApproved !== false) {
      return (
        <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800">
          <CheckCircle className="h-3 w-3 mr-1" />
          Aprobada
        </span>
      );
    } else {
      return (
        <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-yellow-100 text-yellow-800">
          <AlertTriangle className="h-3 w-3 mr-1" />
          Pendiente
        </span>
      );
    }
  };

  const getUserDisplayName = (agency: Agency) => {
    if (agency.users?.first_name || agency.users?.last_name) {
      return `${agency.users.first_name || ''} ${agency.users.last_name || ''}`.trim();
    }
    return agency.users?.email || 'Sin nombre';
  };

  const formatClabe = (clabe: string) => {
    if (!clabe) return '';
    return clabe.replace(/(.{4})/g, '$1 ').trim();
  };

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

  const stats = {
    total: agencies.length,
    active: agencies.filter(a => a.is_active).length,
    inactive: agencies.filter(a => !a.is_active).length,
    totalTours: agencies.reduce((sum, a) => sum + (a.tour_count || 0), 0),
    totalBookings: agencies.reduce((sum, a) => sum + (a.booking_count || 0), 0),
    averageCommission: agencies.length > 0
      ? Math.round((agencies.reduce((sum, a) => sum + (parseFloat(a.commission_rate) || 0.10), 0) / agencies.length) * 1000) / 10
      : 10
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

  return (
    <div className="container mx-auto px-4 py-8">
      <div className="flex justify-between items-center mb-6">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Gestión de Agencias</h1>
          <p className="text-gray-600 mt-1">
            Administra las agencias registradas y configura comisiones
          </p>
        </div>
      </div>

      {error && (
        <div className="mb-6 bg-error-50 text-error-600 p-4 rounded-md flex items-start">
          <AlertTriangle className="h-5 w-5 mr-2 mt-0.5 flex-shrink-0" />
          <div>
            <p className="font-medium">Error</p>
            <p className="text-sm">{error}</p>
          </div>
        </div>
      )}

      {/* Estadísticas */}
      <div className="grid grid-cols-1 md:grid-cols-6 gap-4 mb-6">
        <div className="bg-white rounded-lg shadow-md p-4">
          <div className="text-2xl font-bold text-primary-600">{stats.total}</div>
          <div className="text-sm text-gray-500">Total Agencias</div>
        </div>
        <div className="bg-white rounded-lg shadow-md p-4">
          <div className="text-2xl font-bold text-success-600">{stats.active}</div>
          <div className="text-sm text-gray-500">Activas</div>
        </div>
        <div className="bg-white rounded-lg shadow-md p-4">
          <div className="text-2xl font-bold text-error-600">{stats.inactive}</div>
          <div className="text-sm text-gray-500">Inactivas</div>
        </div>
        <div className="bg-white rounded-lg shadow-md p-4">
          <div className="text-2xl font-bold text-blue-600">{stats.totalTours}</div>
          <div className="text-sm text-gray-500">Tours Totales</div>
        </div>
        <div className="bg-white rounded-lg shadow-md p-4">
          <div className="text-2xl font-bold text-accent-600">{stats.totalBookings}</div>
          <div className="text-sm text-gray-500">Reservas Totales</div>
        </div>
        <div className="bg-white rounded-lg shadow-md p-4">
          <div className="text-2xl font-bold text-orange-600">{stats.averageCommission}%</div>
          <div className="text-sm text-gray-500">Comisión Promedio</div>
        </div>
      </div>

      {/* Filtros y búsqueda */}
      <div className="bg-white rounded-lg shadow-md p-4 mb-6">
        <div className="flex flex-col md:flex-row gap-4">
          <div className="flex-1">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
              <input
                type="text"
                placeholder="Buscar por nombre, email, propietario..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-10 pr-4 py-2 w-full border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
              />
            </div>
          </div>
          <div className="flex items-center space-x-2">
            <Filter className="h-4 w-4 text-gray-400" />
            <select
              value={filterStatus}
              onChange={(e) => setFilterStatus(e.target.value as 'all' | 'active' | 'inactive')}
              className="border border-gray-300 rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
            >
              <option value="all">Todas las agencias</option>
              <option value="active">Solo activas</option>
              <option value="inactive">Solo inactivas</option>
            </select>
          </div>
        </div>
      </div>

      {/* Lista de agencias */}
      {filteredAgencies.length === 0 ? (
        <div className="bg-white rounded-lg shadow-md p-8 text-center">
          <Building className="h-12 w-12 text-gray-400 mx-auto mb-4" />
          <h3 className="text-xl font-semibold mb-2">
            {agencies.length === 0 ? 'No hay agencias registradas' : 'No se encontraron agencias'}
          </h3>
          <p className="text-gray-600">
            {agencies.length === 0 
              ? 'Las agencias aparecerán aquí cuando se registren en la plataforma.'
              : 'Intenta ajustar los filtros de búsqueda.'
            }
          </p>
        </div>
      ) : (
        <div className="bg-white rounded-lg shadow-md overflow-hidden">
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    <button
                      onClick={() => handleSort('name')}
                      className="flex items-center gap-1 hover:text-gray-700"
                    >
                      Agencia
                      {getSortIcon('name')}
                    </button>
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    <button
                      onClick={() => handleSort('owner')}
                      className="flex items-center gap-1 hover:text-gray-700"
                    >
                      Propietario
                      {getSortIcon('owner')}
                    </button>
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Contacto
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    <button
                      onClick={() => handleSort('commission')}
                      className="flex items-center gap-1 hover:text-gray-700"
                    >
                      Comisión
                      {getSortIcon('commission')}
                    </button>
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    <button
                      onClick={() => handleSort('tours')}
                      className="flex items-center gap-1 hover:text-gray-700"
                    >
                      Estadísticas
                      {getSortIcon('tours')}
                    </button>
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    <button
                      onClick={() => handleSort('status')}
                      className="flex items-center gap-1 hover:text-gray-700"
                    >
                      Estado
                      {getSortIcon('status')}
                    </button>
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Validación
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Ejecutivo
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Acciones
                  </th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {filteredAgencies.map((agency) => (
                  <tr key={agency.id} className="hover:bg-gray-50">
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="flex items-center">
                        <div className="flex-shrink-0 h-10 w-10">
                          {agency.logo ? (
                            <img
                              className="h-10 w-10 rounded-full object-cover"
                              src={agency.logo}
                              alt={agency.name}
                            />
                          ) : (
                            <div className="h-10 w-10 rounded-full bg-gray-100 flex items-center justify-center">
                              <Building className="h-5 w-5 text-gray-500" />
                            </div>
                          )}
                        </div>
                        <div className="ml-4">
                          <div className="text-sm font-medium text-gray-900">
                            {agency.name}
                          </div>
                          <div className="text-xs text-gray-500">
                            ID: {agency.id.slice(0, 8)}...
                          </div>
                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="text-sm text-gray-900">
                        {getUserDisplayName(agency)}
                      </div>
                      <div className="text-sm text-gray-500">
                        {agency.users?.email}
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="space-y-1">
                        <div className="flex items-center text-sm text-gray-900">
                          <Mail className="h-3 w-3 mr-1 text-gray-400" />
                          {agency.contact_email}
                        </div>
                        {agency.contact_phone && (
                          <div className="flex items-center text-sm text-gray-500">
                            <Phone className="h-3 w-3 mr-1 text-gray-400" />
                            {agency.contact_phone}
                          </div>
                        )}
                        {agency.website && (
                          <div className="flex items-center text-sm text-gray-500">
                            <Globe className="h-3 w-3 mr-1 text-gray-400" />
                            <a 
                              href={agency.website} 
                              target="_blank" 
                              rel="noopener noreferrer"
                              className="hover:text-primary-600"
                            >
                              Sitio web
                            </a>
                          </div>
                        )}
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="flex items-center">
                        <Percent className="h-4 w-4 text-orange-600 mr-2" />
                        <div>
                          <div className="text-sm font-medium text-gray-900">
                            {((parseFloat(agency.commission_rate) || 0.10) * 100).toFixed(1)}%
                          </div>
                          <div className="text-xs text-gray-500">
                            {formatCurrencyMXN(agency.platform_commission || 0)} generado
                          </div>
                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="space-y-1">
                        <div className="text-sm text-gray-900">
                          {agency.tour_count || 0} tours
                        </div>
                        <div className="text-sm text-gray-500">
                          {agency.booking_count || 0} reservas
                        </div>
                        <div className="text-sm text-gray-500">
                          {formatCurrencyMXN(agency.total_revenue || 0)} ingresos
                        </div>
                        {agency.rating && (
                          <div className="text-sm text-gray-500">
                            ⭐ {parseFloat(agency.rating).toFixed(1)}
                          </div>
                        )}
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      {getStatusBadge(agency.is_active)}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      {getApprovalBadge(agency.is_approved)}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      {(agency as any).account_executive_id ? (
                        <div className="text-xs">
                          <span className="inline-flex items-center gap-1 text-blue-700 bg-blue-50 px-2 py-1 rounded-full font-medium">
                            {(agency as any)._executive_name || 'Asignado'}
                          </span>
                        </div>
                      ) : (
                        <span className="text-xs text-gray-300">—</span>
                      )}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                      <div className="flex items-center space-x-2">
                        <button
                          onClick={() => openEditModal(agency)}
                          disabled={isUpdating === agency.id}
                          className="text-primary-600 hover:text-primary-900 disabled:opacity-50"
                          title="Editar agencia"
                        >
                          <Edit className="h-4 w-4" />
                        </button>

                        <button
                          onClick={() => handleApprovalToggle(agency.user_id, agency.is_approved !== false)}
                          disabled={isUpdating === agency.user_id}
                          className={`${
                            agency.is_approved !== false
                              ? 'text-orange-600 hover:text-orange-900'
                              : 'text-green-600 hover:text-green-900'
                          } disabled:opacity-50`}
                          title={agency.is_approved !== false ? 'Revocar aprobación' : 'Aprobar agencia'}
                        >
                          {isUpdating === agency.user_id ? (
                            <div className="animate-spin rounded-full h-4 w-4 border-t-2 border-b-2 border-current"></div>
                          ) : agency.is_approved !== false ? (
                            <XCircle className="h-4 w-4" />
                          ) : (
                            <CheckCircle className="h-4 w-4" />
                          )}
                        </button>

                        <button
                          onClick={() => handleStatusToggle(agency.id, agency.is_active)}
                          disabled={isUpdating === agency.id}
                          className={`${
                            agency.is_active
                              ? 'text-error-600 hover:text-error-900'
                              : 'text-success-600 hover:text-success-900'
                          } disabled:opacity-50`}
                          title={agency.is_active ? 'Desactivar agencia' : 'Activar agencia'}
                        >
                          {isUpdating === agency.id ? (
                            <div className="animate-spin rounded-full h-4 w-4 border-t-2 border-b-2 border-current"></div>
                          ) : agency.is_active ? (
                            <EyeOff className="h-4 w-4" />
                          ) : (
                            <Eye className="h-4 w-4" />
                          )}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Modal de Editar Agencia */}
      {isEditingAgency && selectedAgency && (
        <div className="fixed inset-0 bg-gray-600 bg-opacity-50 overflow-y-auto h-full w-full z-50 flex items-start justify-center py-10 px-4">
          <div className="relative w-full max-w-4xl shadow-lg rounded-md bg-white flex flex-col max-h-[90vh]">
            <div className="flex justify-between items-center p-5 border-b shrink-0">
              <h3 className="text-xl font-medium text-gray-900">
                Editar Agencia: {selectedAgency.name}
              </h3>
              <button onClick={closeModals} className="text-gray-400 hover:text-gray-600">
                <X className="h-6 w-6" />
              </button>
            </div>

            <div className="overflow-y-auto flex-1 p-5">
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              {/* Información Principal */}
              <div className="lg:col-span-2 space-y-6">
                {/* Datos de la Agencia */}
                <div className="bg-gray-50 rounded-lg p-4">
                  <h4 className="text-lg font-semibold mb-4 flex items-center">
                    <Building className="h-5 w-5 mr-2" />
                    Información de la Agencia
                  </h4>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        Nombre de la Agencia *
                      </label>
                      <input
                        type="text"
                        value={editForm.name}
                        onChange={(e) => setEditForm({...editForm, name: e.target.value})}
                        className="input"
                        required
                      />
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        Comisión de la Plataforma *
                      </label>
                      <div className="relative">
                        <input
                          type="text"
                          inputMode="decimal"
                          value={commissionInput}
                          placeholder="Ej: 10"
                          onChange={(e) => {
                            const val = e.target.value;
                            if (/^(\d{0,2}(\.\d{0,1})?)?$/.test(val)) {
                              setCommissionInput(val);
                            }
                          }}
                          onFocus={(e) => e.target.select()}
                          onBlur={() => {
                            const parsed = parseFloat(commissionInput);
                            if (isNaN(parsed) || commissionInput === '') {
                              const prev = editForm.commission_rate * 100;
                              const display = Number.isInteger(prev) ? String(prev) : prev.toFixed(1);
                              setCommissionInput(display);
                            } else {
                              const clamped = Math.min(50, Math.max(0, parsed));
                              setCommissionInput(Number.isInteger(clamped) ? String(clamped) : clamped.toFixed(1));
                              setEditForm({ ...editForm, commission_rate: clamped / 100 });
                            }
                          }}
                          className="input pr-8"
                          required
                        />
                        <div className="absolute inset-y-0 right-0 pr-3 flex items-center pointer-events-none">
                          <Percent className="h-4 w-4 text-gray-400" />
                        </div>
                      </div>
                      <p className="text-xs text-gray-500 mt-1">
                        Porcentaje que cobra la plataforma por cada reserva (0–50%)
                      </p>
                    </div>

                    {/* Comisión negociada (commission_percentage) */}
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        Comisión negociada <span className="text-gray-400 font-normal">(acuerdo especial)</span>
                      </label>
                      <div className="flex items-center gap-2 mb-2">
                        <button
                          type="button"
                          onClick={() => {
                            setUseSpecialCommission(!useSpecialCommission);
                            if (useSpecialCommission) setCommissionPctInput('');
                          }}
                          className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${useSpecialCommission ? 'bg-blue-600' : 'bg-gray-200'}`}
                        >
                          <span className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow transition-transform ${useSpecialCommission ? 'translate-x-5' : 'translate-x-0.5'}`} />
                        </button>
                        <span className="text-xs text-gray-600">{useSpecialCommission ? 'Comisión especial activa' : `Usando default de plataforma (${platformDefaultCommission}%)`}</span>
                      </div>
                      {useSpecialCommission && (
                        <>
                          <div className="relative">
                            <input
                              type="number"
                              min={0}
                              max={100}
                              step={0.5}
                              value={commissionPctInput}
                              onChange={(e) => setCommissionPctInput(e.target.value)}
                              placeholder={`${platformDefaultCommission} (default plataforma)`}
                              className="input pr-8"
                            />
                            <div className="absolute inset-y-0 right-0 pr-3 flex items-center pointer-events-none">
                              <Percent className="h-4 w-4 text-gray-400" />
                            </div>
                          </div>
                          {selectedAgency?.pending_amendment_id && (
                            <p className="text-xs text-amber-600 mt-1 flex items-center gap-1">
                              <RefreshCw className="h-3 w-3" />
                              Enmienda de comisión pendiente de firma por la agencia
                            </p>
                          )}
                          <p className="text-xs text-gray-500 mt-1">
                            Si la agencia ya tiene contrato firmado, se generará una enmienda y se solicitará nueva firma.
                          </p>
                        </>
                      )}
                    </div>

                    <div className="md:col-span-2">
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        Descripción
                      </label>
                      <textarea
                        value={editForm.description}
                        onChange={(e) => setEditForm({...editForm, description: e.target.value})}
                        className="input"
                        rows={3}
                        placeholder="Descripción de la agencia..."
                      />
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        Email de Contacto *
                      </label>
                      <input
                        type="email"
                        value={editForm.contact_email}
                        onChange={(e) => setEditForm({...editForm, contact_email: e.target.value})}
                        className="input"
                        required
                      />
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        Teléfono de Contacto
                      </label>
                      <input
                        type="tel"
                        value={editForm.contact_phone}
                        onChange={(e) => setEditForm({...editForm, contact_phone: e.target.value})}
                        className="input"
                        placeholder="+52 (55) 1234-5678"
                      />
                    </div>

                    <div className="md:col-span-2">
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        Sitio Web
                      </label>
                      <input
                        type="url"
                        value={editForm.website}
                        onChange={(e) => setEditForm({...editForm, website: e.target.value})}
                        className="input"
                        placeholder="https://www.agencia.com"
                      />
                    </div>
                  </div>
                </div>

                {/* Información Fiscal */}
                <div className="bg-blue-50 rounded-lg p-4">
                  <h4 className="text-lg font-semibold mb-4 flex items-center">
                    <DollarSign className="h-5 w-5 mr-2" />
                    Información Fiscal
                  </h4>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        RFC
                      </label>
                      <input
                        type="text"
                        value={editForm.rfc}
                        onChange={(e) => setEditForm({...editForm, rfc: e.target.value})}
                        className="input"
                        placeholder="XAXX010101000"
                      />
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        Razón Social
                      </label>
                      <input
                        type="text"
                        value={editForm.razon_social}
                        onChange={(e) => setEditForm({...editForm, razon_social: e.target.value})}
                        className="input"
                        placeholder="Nombre legal de la empresa"
                      />
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        Régimen Fiscal
                      </label>
                      <select
                        value={editForm.regimen_fiscal}
                        onChange={(e) => setEditForm({...editForm, regimen_fiscal: e.target.value})}
                        className="input"
                      >
                        <option value="">Seleccionar régimen fiscal</option>
                        <option value="601">601 - General de Ley</option>
                        <option value="612">612 - Personas Físicas con Actividades Empresariales</option>
                        <option value="621">621 - Incorporación Fiscal</option>
                        <option value="625">625 - Régimen Simplificado de Confianza</option>
                        <option value="626">626 - Régimen Simplificado de Confianza (RESICO)</option>
                      </select>
                    </div>

                    <div className="md:col-span-2">
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        CP Fiscal (para facturación SAT)
                      </label>
                      <input
                        type="text"
                        value={editForm.domicilio_fiscal}
                        onChange={(e) => setEditForm({...editForm, domicilio_fiscal: e.target.value})}
                        className="input"
                        placeholder="Código postal para facturación"
                      />
                    </div>

                    {/* Domicilio de la Agencia */}
                    <div className="md:col-span-2 pt-2">
                      <label className="block text-sm font-semibold text-gray-800 mb-3">Domicilio de la Agencia</label>
                      <div className="space-y-3">
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-1">Calle</label>
                          <input
                            type="text"
                            value={editForm.street || ''}
                            onChange={(e) => setEditForm({...editForm, street: e.target.value})}
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
                              onChange={(e) => setEditForm({...editForm, exterior_number: e.target.value})}
                              className="input"
                              placeholder="123"
                            />
                          </div>
                          <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">No. Interior</label>
                            <input
                              type="text"
                              value={editForm.interior_number || ''}
                              onChange={(e) => setEditForm({...editForm, interior_number: e.target.value})}
                              className="input"
                              placeholder="B-2"
                            />
                          </div>
                        </div>
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-1">Colonia</label>
                          <input
                            type="text"
                            value={editForm.colony || ''}
                            onChange={(e) => setEditForm({...editForm, colony: e.target.value})}
                            className="input"
                            placeholder="Ej: Centro"
                          />
                        </div>
                        <div className="grid grid-cols-2 gap-3">
                          <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">Ciudad</label>
                            <input
                              type="text"
                              value={editForm.city || ''}
                              onChange={(e) => setEditForm({...editForm, city: e.target.value})}
                              className="input"
                              placeholder="Ej: CDMX"
                            />
                          </div>
                          <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">Estado</label>
                            <input
                              type="text"
                              value={editForm.state || ''}
                              onChange={(e) => setEditForm({...editForm, state: e.target.value})}
                              className="input"
                              placeholder="Ej: Ciudad de México"
                            />
                          </div>
                        </div>
                        <div className="grid grid-cols-2 gap-3">
                          <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">Código Postal</label>
                            <input
                              type="text"
                              value={editForm.postal_code || ''}
                              onChange={(e) => setEditForm({...editForm, postal_code: e.target.value})}
                              className="input"
                              placeholder="00000"
                            />
                          </div>
                          <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">País</label>
                            <input
                              type="text"
                              value={editForm.country || ''}
                              onChange={(e) => setEditForm({...editForm, country: e.target.value})}
                              className="input"
                              placeholder="México"
                            />
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* Tipo de persona */}
                    <div className="md:col-span-2">
                      <label className="block text-sm font-medium text-gray-700 mb-2">Tipo de persona</label>
                      <div className="flex gap-3">
                        {([
                          { value: 'persona_fisica', label: 'Persona Física' },
                          { value: 'persona_moral',  label: 'Persona Moral' },
                        ] as const).map(({ value, label }) => (
                          <button
                            key={value}
                            type="button"
                            onClick={() => setEditForm({ ...editForm, persona_type: value })}
                            className={`px-4 py-2 rounded-lg border-2 text-sm font-medium transition-colors ${
                              editForm.persona_type === value
                                ? 'border-blue-500 bg-blue-50 text-blue-700'
                                : 'border-gray-200 text-gray-600 hover:border-gray-300'
                            }`}
                          >
                            {label}
                          </button>
                        ))}
                        {editForm.persona_type && (
                          <button
                            type="button"
                            onClick={() => setEditForm({ ...editForm, persona_type: '' })}
                            className="px-3 py-2 rounded-lg border border-gray-200 text-xs text-gray-400 hover:text-gray-600"
                          >
                            Limpiar
                          </button>
                        )}
                      </div>
                    </div>

                    {/* Representante legal / firmante */}
                    <div className="md:col-span-2">
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        Representante Legal / Firmante del contrato
                      </label>
                      <input
                        type="text"
                        value={editForm.representante_legal_nombre}
                        onChange={(e) => setEditForm({ ...editForm, representante_legal_nombre: e.target.value })}
                        className="input"
                        placeholder="Nombre completo de quien firma el contrato"
                      />
                      <p className="mt-1 text-xs text-gray-500">
                        Para persona física, normalmente el titular de la agencia. Para persona moral, quien cuente con facultades legales.
                      </p>
                    </div>
                  </div>
                </div>

                {/* Información Bancaria */}
                <div className="bg-green-50 rounded-lg p-4">
                  <h4 className="text-lg font-semibold mb-4 flex items-center">
                    <DollarSign className="h-5 w-5 mr-2" />
                    Información Bancaria
                  </h4>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        Banco
                      </label>
                      <input
                        type="text"
                        value={editForm.banco}
                        onChange={(e) => setEditForm({...editForm, banco: e.target.value})}
                        className="input"
                        placeholder="BBVA, Santander, etc."
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        Cuenta CLABE
                      </label>
                      <input
                        type="text"
                        value={editForm.cuenta_clabe}
                        onChange={(e) => setEditForm({...editForm, cuenta_clabe: e.target.value})}
                        className="input"
                        placeholder="18 dígitos"
                        maxLength={18}
                      />
                      {editForm.cuenta_clabe && (
                        <p className="text-xs text-gray-500 mt-1">
                          Formato: {formatClabe(editForm.cuenta_clabe)}
                        </p>
                      )}
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        Titular de la Cuenta
                      </label>
                      <input
                        type="text"
                        value={editForm.titular_cuenta}
                        onChange={(e) => setEditForm({...editForm, titular_cuenta: e.target.value})}
                        className="input"
                        placeholder="Nombre del titular"
                      />
                    </div>
                  </div>
                </div>
              </div>

              {/* Información del Propietario */}
              <div className="space-y-6">
                <div className="bg-green-50 rounded-lg p-4">
                  <h4 className="text-lg font-semibold mb-4 flex items-center">
                    <User className="h-5 w-5 mr-2" />
                    Datos del Propietario
                  </h4>
                  <div className="space-y-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        Email del Usuario
                      </label>
                      <div className="flex items-center p-3 bg-gray-100 rounded-md">
                        <Mail className="h-4 w-4 text-gray-400 mr-2" />
                        <span className="text-sm text-gray-600">{selectedAgency.users?.email}</span>
                      </div>
                      <p className="text-xs text-gray-500 mt-1">
                        El email no se puede modificar desde aquí
                      </p>
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        Nombre
                      </label>
                      <input
                        type="text"
                        value={editForm.first_name}
                        onChange={(e) => setEditForm({...editForm, first_name: e.target.value})}
                        className="input"
                        placeholder="Nombre del propietario"
                      />
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        Apellido
                      </label>
                      <input
                        type="text"
                        value={editForm.last_name}
                        onChange={(e) => setEditForm({...editForm, last_name: e.target.value})}
                        className="input"
                        placeholder="Apellido del propietario"
                      />
                    </div>
                  </div>
                </div>

                {/* Información Adicional */}
                <div className="bg-yellow-50 rounded-lg p-4">
                  <h4 className="text-lg font-semibold mb-4 flex items-center">
                    <Calendar className="h-5 w-5 mr-2" />
                    Información del Sistema
                  </h4>
                  <div className="space-y-3 text-sm">
                    <div>
                      <span className="font-medium text-gray-700">Fecha de Registro:</span>
                      <div className="text-gray-600">
                        {new Date(selectedAgency.created_at).toLocaleDateString('es-ES', {
                          year: 'numeric',
                          month: 'long',
                          day: 'numeric'
                        })}
                      </div>
                    </div>

                    <div>
                      <span className="font-medium text-gray-700">Última Actualización:</span>
                      <div className="text-gray-600">
                        {new Date(selectedAgency.updated_at).toLocaleDateString('es-ES', {
                          year: 'numeric',
                          month: 'long',
                          day: 'numeric'
                        })}
                      </div>
                    </div>

                    <div>
                      <span className="font-medium text-gray-700">ID de Usuario:</span>
                      <div className="text-gray-600 font-mono text-xs break-all">
                        {selectedAgency.user_id}
                      </div>
                    </div>

                    <div>
                      <span className="font-medium text-gray-700">ID de Agencia:</span>
                      <div className="text-gray-600 font-mono text-xs break-all">
                        {selectedAgency.id}
                      </div>
                    </div>
                  </div>
                </div>

                {/* Cálculo de Comisiones */}
                <div className="bg-orange-50 rounded-lg p-4">
                  <h4 className="text-lg font-semibold mb-4 flex items-center">
                    <Percent className="h-5 w-5 mr-2" />
                    Cálculo de Comisiones
                  </h4>
                  <div className="space-y-2 text-sm">
                    <div className="flex justify-between">
                      <span className="text-gray-600">Comisión Actual:</span>
                      <span className="font-medium">{(editForm.commission_rate * 100).toFixed(1)}%</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-600">Ingresos Totales de la Agencia:</span>
                      <span className="font-medium">{formatCurrencyMXN(selectedAgency.total_revenue || 0)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-600">Comisiones Generadas:</span>
                      <span className="font-medium text-orange-600">
                        {formatCurrencyMXN((selectedAgency.total_revenue || 0) * editForm.commission_rate)}
                      </span>
                    </div>
                    <div className="border-t pt-2 mt-2">
                      <div className="flex justify-between text-base font-bold">
                        <span>Ingresos Netos de la Agencia:</span>
                        <span className="text-green-600">
                          {formatCurrencyMXN((selectedAgency.total_revenue || 0) * (1 - editForm.commission_rate))}
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {/* Contrato y documentos de onboarding */}
              <div className="space-y-6">
                <div className="bg-gray-50 rounded-lg p-4 border border-gray-200">
                  <h4 className="text-lg font-semibold mb-4 flex items-center gap-2">
                    <FileText className="h-5 w-5" />
                    Contrato y Documentos
                  </h4>
                  <AgencyContractSection
                    agencyId={selectedAgency.id}
                    legacySignedContractUrl={selectedAgency.signed_contract_url}
                    onboardingStatus={selectedAgency.onboarding_status}
                    onRefresh={fetchAgencies}
                  />
                </div>
              </div>

              {/* Panel Lateral */}
              <div className="space-y-6">
                {/* Vista Previa de Comisión */}
                <div className="bg-white border-2 border-orange-200 rounded-lg p-4">
                  <h4 className="font-semibold mb-3 text-orange-800">Vista Previa de Comisión</h4>
                  <div className="space-y-2 text-sm">
                    <div className="bg-orange-50 p-3 rounded">
                      <div className="text-center">
                        <div className="text-2xl font-bold text-orange-600">
                          {(editForm.commission_rate * 100).toFixed(1)}%
                        </div>
                        <div className="text-xs text-orange-700">Nueva comisión</div>
                      </div>
                    </div>
                    
                    <div className="text-xs text-gray-600">
                      <p><strong>Ejemplo con tour de $10,000:</strong></p>
                      <ul className="list-disc list-inside space-y-1 mt-1">
                        <li>Comisión plataforma: {formatCurrencyMXN(10000 * editForm.commission_rate)}</li>
                        <li>Agencia recibe: {formatCurrencyMXN(10000 * (1 - editForm.commission_rate))}</li>
                      </ul>
                      <p className="mt-2 text-gray-400 italic">El cargo por servicio se cobra al viajero por separado.</p>
                    </div>
                  </div>
                </div>

                {/* Estadísticas Rápidas */}
                <div className="bg-white border rounded-lg p-4">
                  <h4 className="font-semibold mb-3">Estadísticas</h4>
                  <div className="space-y-3">
                    <div className="flex justify-between items-center">
                      <span className="text-sm text-gray-600">Tours Publicados:</span>
                      <span className="font-medium">{selectedAgency.tour_count || 0}</span>
                    </div>
                    <div className="flex justify-between items-center">
                      <span className="text-sm text-gray-600">Reservas Totales:</span>
                      <span className="font-medium">{selectedAgency.booking_count || 0}</span>
                    </div>
                    <div className="flex justify-between items-center">
                      <span className="text-sm text-gray-600">Calificación:</span>
                      <span className="font-medium">
                        {selectedAgency.rating ? `⭐ ${selectedAgency.rating.toFixed(1)}` : 'Sin calificar'}
                      </span>
                    </div>
                    <div className="flex justify-between items-center">
                      <span className="text-sm text-gray-600">Estado:</span>
                      {getStatusBadge(selectedAgency.is_active)}
                    </div>
                  </div>
                </div>

              </div>
            </div>
            </div>

            {/* Acciones */}
            <div className="flex justify-end space-x-4 p-5 pt-4 border-t shrink-0">
              <button
                onClick={closeModals}
                className="btn btn-outline"
                disabled={isUpdating === selectedAgency.id}
              >
                Cancelar
              </button>
              <button
                onClick={handleUpdateAgency}
                className="btn btn-primary"
                disabled={isUpdating === selectedAgency.id || !editForm.name.trim() || !editForm.contact_email.trim()}
              >
                {isUpdating === selectedAgency.id ? (
                  <>
                    <div className="animate-spin rounded-full h-4 w-4 border-t-2 border-b-2 border-white mr-2"></div>
                    Actualizando...
                  </>
                ) : (
                  <>
                    <Save className="h-4 w-4 mr-2" />
                    Guardar Cambios
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal de advertencia: resign / enmienda de comisión */}
      {resignModal?.show && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-[60] p-4">
          <div className="bg-white rounded-2xl shadow-xl max-w-md w-full p-6">
            <div className="flex items-center gap-3 mb-4">
              <div className="p-2 bg-amber-100 rounded-full">
                <AlertTriangle className="h-6 w-6 text-amber-600" />
              </div>
              <h3 className="text-lg font-semibold text-gray-900">Contrato firmado — enmienda requerida</h3>
            </div>
            <p className="text-sm text-gray-600 mb-2">
              La agencia <strong>{resignModal.agencyName}</strong> ya tiene un contrato firmado.
              El cambio de comisión a <strong>{resignModal.newPct}%</strong> requiere generar
              una enmienda contractual y solicitar nueva firma digital a la agencia.
            </p>
            <p className="text-sm text-gray-500 mb-6">
              La agencia seguirá operando con normalidad mientras firma la enmienda. La nueva
              comisión entrará en vigor solo cuando firme.
            </p>
            <div className="flex gap-3 justify-end">
              <button
                onClick={() => setResignModal(null)}
                disabled={isResigning}
                className="btn btn-outline"
              >
                Cancelar
              </button>
              <button
                onClick={handleResign}
                disabled={isResigning}
                className="btn btn-primary flex items-center gap-2"
              >
                {isResigning ? (
                  <><div className="animate-spin rounded-full h-4 w-4 border-t-2 border-b-2 border-white" />Generando enmienda...</>
                ) : (
                  <><RefreshCw className="h-4 w-4" />Generar enmienda y solicitar firma</>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default AdminAgencies;