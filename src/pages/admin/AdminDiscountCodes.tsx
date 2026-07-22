import { useState, useEffect } from 'react';
import { Ticket, Plus, CreditCard as Edit2, Trash2, Eye, Percent, DollarSign, Calendar, Users, AlertCircle, CheckCircle, XCircle, Search, Map, Crown, Gift, ArrowUpDown, ArrowUp, ArrowDown, Building2, Target, Shield } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../context/AuthContext';

interface DiscountCode {
  id: string;
  code: string;
  description: string;
  discount_type: 'tour_percentage' | 'tour_fixed' | 'membership_free_month' | 'membership_percentage' | 'membership_fixed' | 'gift_card_percentage' | 'gift_card_fixed' | 'service_fee_percentage' | 'service_fee_fixed' | 'service_fee_full' | 'insurance_percentage' | 'insurance_fixed' | 'insurance_free';
  discount_value: number;
  applicable_to: 'tours' | 'memberships' | 'gift_cards' | 'service_fees' | 'insurance';
  discount_applies_to: 'total_price' | 'payment_amount';
  is_single_use: boolean;
  is_active: boolean;
  valid_from: string;
  valid_until: string;
  max_uses: number | null;
  times_used: number;
  max_discount_amount?: number | null;
  membership_plan_type?: 'monthly' | 'annual' | 'both';
  agency_id?: string | null;
  tour_id?: string | null;
  created_at: string;
  agencies?: { name: string } | null;
  tours?: { name: string } | null;
}

interface AgencyOption {
  id: string;
  name: string;
}

interface TourOption {
  id: string;
  name: string;
}

interface UsageRecord {
  id: string;
  user_id: string;
  user_name: string;
  used_at: string;
  booking_id: string | null;
  gift_card_id: string | null;
  membership_id: string | null;
}

export default function AdminDiscountCodes() {
  const { user } = useAuth();
  const [codes, setCodes] = useState<DiscountCode[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [showDetailModal, setShowDetailModal] = useState(false);
  const [editingCode, setEditingCode] = useState<DiscountCode | null>(null);
  const [selectedCode, setSelectedCode] = useState<DiscountCode | null>(null);
  const [usageRecords, setUsageRecords] = useState<UsageRecord[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [filterType, setFilterType] = useState<string>('all');
  const [filterStatus, setFilterStatus] = useState<string>('all');
  const [sortColumn, setSortColumn] = useState<string>('created_at');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('desc');
  const [agencies, setAgencies] = useState<AgencyOption[]>([]);
  const [agencyTours, setAgencyTours] = useState<TourOption[]>([]);
  const [loadingAgencyTours, setLoadingAgencyTours] = useState(false);

  const [formData, setFormData] = useState({
    code: '',
    description: '',
    applicable_to: 'tours' as 'tours' | 'memberships' | 'gift_cards' | 'service_fees' | 'insurance',
    discount_type: 'tour_percentage' as string,
    discount_value: '',
    discount_applies_to: 'total_price' as 'total_price' | 'payment_amount',
    valid_from: new Date().toISOString().split('T')[0],
    valid_until: '',
    is_single_use: false,
    max_uses: '',
    max_discount_amount: '',
    is_active: true,
    membership_plan_type: 'both' as 'monthly' | 'annual' | 'both',
    agency_id: '' as string,
    tour_id: '' as string,
  });

  useEffect(() => {
    fetchCodes();
    fetchAgencies();
  }, []);

  const fetchCodes = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('discount_codes')
        .select('*, agencies:agency_id(name), tours:tour_id(name)')
        .order('created_at', { ascending: false });

      if (error) throw error;
      setCodes(data || []);
    } catch (err) {
      console.error('Error fetching discount codes:', err);
    } finally {
      setLoading(false);
    }
  };

  const fetchAgencies = async () => {
    try {
      const { data, error } = await supabase
        .from('agencies')
        .select('id, name')
        .eq('is_active', true)
        .order('name');

      if (error) throw error;
      setAgencies(data || []);
    } catch (err) {
      console.error('Error fetching agencies:', err);
    }
  };

  const fetchAgencyTours = async (agencyId: string) => {
    if (!agencyId) {
      setAgencyTours([]);
      return;
    }
    setLoadingAgencyTours(true);
    try {
      const { data, error } = await supabase
        .rpc('get_agency_tours', { p_agency_id: agencyId });

      if (error) throw error;
      setAgencyTours(data || []);
    } catch (err) {
      console.error('Error fetching agency tours:', err);
    } finally {
      setLoadingAgencyTours(false);
    }
  };

  const fetchCodeDetails = async (codeId: string) => {
    try {
      const { data, error } = await supabase
        .rpc('get_discount_code_details', { p_code_id: codeId });

      if (error) throw error;

      if (data && !data.error) {
        setUsageRecords(data.usage_records || []);
      }
    } catch (err) {
      console.error('Error fetching code details:', err);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!formData.code || !formData.description || !formData.valid_until) {
      alert('Por favor complete todos los campos requeridos');
      return;
    }

    if (formData.discount_type !== 'membership_free_month' && formData.discount_type !== 'service_fee_full' && formData.discount_type !== 'insurance_free' && !formData.discount_value) {
      alert('Por favor complete todos los campos requeridos');
      return;
    }

    if (formData.max_discount_amount && parseFloat(formData.max_discount_amount) <= 0) {
      alert('El monto máximo de descuento debe ser mayor que 0');
      return;
    }

    try {
      const discountValue = formData.discount_type === 'membership_free_month' || formData.discount_type === 'service_fee_full' || formData.discount_type === 'insurance_free'
        ? (formData.discount_type === 'service_fee_full' || formData.discount_type === 'insurance_free' ? 100 : 1)
        : parseFloat(formData.discount_value);

      const codeData: Record<string, any> = {
        code: formData.code.toUpperCase(),
        description: formData.description,
        discount_type: formData.discount_type,
        discount_value: discountValue,
        applicable_to: formData.applicable_to,
        discount_applies_to: formData.applicable_to === 'tours' ? formData.discount_applies_to : 'total_price',
        is_single_use: formData.is_single_use,
        is_active: formData.is_active,
        valid_from: formData.valid_from,
        valid_until: formData.valid_until,
        max_uses: formData.max_uses ? parseInt(formData.max_uses) : null,
        max_discount_amount: formData.max_discount_amount ? parseFloat(formData.max_discount_amount) : null,
        created_by: user?.id,
        membership_plan_type: formData.applicable_to === 'memberships' ? formData.membership_plan_type : 'both',
        agency_id: formData.applicable_to === 'tours' && formData.agency_id ? formData.agency_id : null,
        tour_id: formData.applicable_to === 'tours' && formData.tour_id ? formData.tour_id : null,
      };

      if (editingCode) {
        const { error } = await supabase
          .from('discount_codes')
          .update(codeData)
          .eq('id', editingCode.id);

        if (error) throw error;
      } else {
        const { error } = await supabase
          .from('discount_codes')
          .insert([codeData]);

        if (error) throw error;
      }

      setShowModal(false);
      resetForm();
      fetchCodes();
    } catch (err: any) {
      console.error('Error saving discount code:', err);
      alert(err.message || 'Error al guardar el código de descuento');
    }
  };

  const handleEdit = (code: DiscountCode) => {
    setEditingCode(code);
    if (code.agency_id) {
      fetchAgencyTours(code.agency_id);
    }
    setFormData({
      code: code.code,
      description: code.description,
      applicable_to: code.applicable_to,
      discount_type: code.discount_type,
      discount_value: (code.discount_type === 'membership_free_month' || code.discount_type === 'service_fee_full' || code.discount_type === 'insurance_free') ? '' : code.discount_value.toString(),
      discount_applies_to: code.discount_applies_to || 'total_price',
      valid_from: code.valid_from.split('T')[0],
      valid_until: code.valid_until.split('T')[0],
      is_single_use: code.is_single_use,
      max_uses: code.max_uses?.toString() || '',
      max_discount_amount: code.max_discount_amount?.toString() || '',
      is_active: code.is_active,
      membership_plan_type: code.membership_plan_type || 'both',
      agency_id: code.agency_id || '',
      tour_id: code.tour_id || '',
    });
    setShowModal(true);
  };

  const handleDelete = async (id: string) => {
    if (!confirm('¿Estás seguro de que quieres eliminar este código de descuento?')) {
      return;
    }

    try {
      const { error } = await supabase
        .from('discount_codes')
        .delete()
        .eq('id', id);

      if (error) throw error;
      fetchCodes();
    } catch (err: any) {
      console.error('Error deleting discount code:', err);
      alert('Error al eliminar el código. Si el código ya ha sido usado, considera desactivarlo en lugar de eliminarlo.');
    }
  };

  const handleViewDetails = async (code: DiscountCode) => {
    setSelectedCode(code);
    await fetchCodeDetails(code.id);
    setShowDetailModal(true);
  };

  const resetForm = () => {
    setEditingCode(null);
    setAgencyTours([]);
    setFormData({
      code: '',
      description: '',
      applicable_to: 'tours',
      discount_type: 'tour_percentage',
      discount_value: '',
      discount_applies_to: 'total_price',
      valid_from: new Date().toISOString().split('T')[0],
      valid_until: '',
      is_single_use: false,
      max_uses: '',
      max_discount_amount: '',
      is_active: true,
      membership_plan_type: 'both',
      agency_id: '',
      tour_id: '',
    });
  };

  const getDiscountTypeOptions = (applicableTo: string) => {
    switch (applicableTo) {
      case 'tours':
        return [
          { value: 'tour_percentage', label: 'Porcentaje' },
          { value: 'tour_fixed', label: 'Monto Fijo' },
        ];
      case 'memberships':
        return [
          { value: 'membership_percentage', label: 'Porcentaje' },
          { value: 'membership_fixed', label: 'Monto Fijo' },
          { value: 'membership_free_month', label: 'Mes Gratis (Solo Mensual)' },
        ];
      case 'gift_cards':
        return [
          { value: 'gift_card_percentage', label: 'Porcentaje' },
          { value: 'gift_card_fixed', label: 'Monto Fijo' },
        ];
      case 'service_fees':
        return [
          { value: 'service_fee_percentage', label: 'Porcentaje del Cargo' },
          { value: 'service_fee_fixed', label: 'Monto Fijo' },
          { value: 'service_fee_full', label: 'Cargo por Servicio Gratis' },
        ];
      case 'insurance':
        return [
          { value: 'insurance_percentage', label: 'Porcentaje del Seguro' },
          { value: 'insurance_fixed', label: 'Monto Fijo' },
          { value: 'insurance_free', label: 'Seguro Gratis' },
        ];
      case 'featured_slots':
        return [
          { value: 'featured_percentage', label: 'Porcentaje' },
          { value: 'featured_fixed', label: 'Monto Fijo' },
        ];
      default:
        return [];
    }
  };

  const getDiscountTypeLabel = (type: string) => {
    const labels: Record<string, string> = {
      tour_percentage: 'Porcentaje',
      tour_fixed: 'Monto Fijo',
      membership_free_month: 'Mes Gratis',
      membership_percentage: 'Porcentaje',
      membership_fixed: 'Monto Fijo',
      gift_card_percentage: 'Porcentaje',
      gift_card_fixed: 'Monto Fijo',
      service_fee_percentage: 'Porcentaje del Cargo',
      service_fee_fixed: 'Monto Fijo',
      service_fee_full: 'Cargo Gratis',
      insurance_percentage: 'Porcentaje del Seguro',
      insurance_fixed: 'Monto Fijo',
      insurance_free: 'Seguro Gratis',
      featured_percentage: 'Porcentaje',
      featured_fixed: 'Monto Fijo',
    };
    return labels[type] || type;
  };

  const getMembershipPlanTypeLabel = (type?: string) => {
    const labels: Record<string, string> = {
      monthly: 'Solo Mensual',
      annual: 'Solo Anual',
      both: 'Ambos',
    };
    return labels[type || 'both'] || 'Ambos';
  };

  const getApplicableToLabel = (type: string) => {
    const labels: Record<string, string> = {
      tours: 'Tours',
      memberships: 'Membresias',
      gift_cards: 'Tarjetas de Regalo',
      service_fees: 'Cargo por Servicio',
      insurance: 'Seguro de Viajero',
      featured_slots: 'Tours Destacados',
    };
    return labels[type] || type;
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('es-MX', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  };

  const getStatusBadge = (code: DiscountCode) => {
    const now = new Date();
    const validFrom = new Date(code.valid_from);
    const validUntil = new Date(code.valid_until);

    if (!code.is_active) {
      return (
        <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium bg-gray-100 text-gray-800">
          <XCircle className="h-3 w-3" />
          Inactivo
        </span>
      );
    }

    if (now > validUntil) {
      return (
        <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium bg-red-100 text-red-800">
          <XCircle className="h-3 w-3" />
          Expirado
        </span>
      );
    }

    if (now < validFrom) {
      return (
        <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium bg-blue-100 text-blue-800">
          <Calendar className="h-3 w-3" />
          Programado
        </span>
      );
    }

    if (code.max_uses && code.times_used >= code.max_uses) {
      return (
        <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium bg-orange-100 text-orange-800">
          <AlertCircle className="h-3 w-3" />
          Límite Alcanzado
        </span>
      );
    }

    const daysUntilExpiry = Math.ceil((validUntil.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
    if (daysUntilExpiry <= 7) {
      return (
        <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium bg-yellow-100 text-yellow-800">
          <AlertCircle className="h-3 w-3" />
          Por Expirar
        </span>
      );
    }

    return (
      <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium bg-green-100 text-green-800">
        <CheckCircle className="h-3 w-3" />
        Activo
      </span>
    );
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
    return sortDirection === 'asc' ? <ArrowUp className="h-4 w-4" /> : <ArrowDown className="h-4 w-4" />;
  };

  const filteredCodes = codes.filter(code => {
    const matchesSearch = code.code.toLowerCase().includes(searchTerm.toLowerCase()) ||
                         code.description.toLowerCase().includes(searchTerm.toLowerCase());

    const matchesType = filterType === 'all' || code.applicable_to === filterType;

    const now = new Date();
    const validUntil = new Date(code.valid_until);
    let matchesStatus = true;

    if (filterStatus === 'active') {
      matchesStatus = code.is_active && now <= validUntil && (!code.max_uses || code.times_used < code.max_uses);
    } else if (filterStatus === 'inactive') {
      matchesStatus = !code.is_active;
    } else if (filterStatus === 'expired') {
      matchesStatus = now > validUntil;
    }

    return matchesSearch && matchesType && matchesStatus;
  });

  const sortedAndFilteredCodes = [...filteredCodes].sort((a, b) => {
    let aValue: any;
    let bValue: any;

    switch (sortColumn) {
      case 'code':
        aValue = a.code.toLowerCase();
        bValue = b.code.toLowerCase();
        break;
      case 'type':
        aValue = a.discount_type;
        bValue = b.discount_type;
        break;
      case 'discount':
        aValue = a.discount_value;
        bValue = b.discount_value;
        break;
      case 'applicable_to':
        aValue = a.applicable_to;
        bValue = b.applicable_to;
        break;
      case 'uses':
        aValue = a.times_used;
        bValue = b.times_used;
        break;
      case 'valid_from':
        aValue = new Date(a.valid_from).getTime();
        bValue = new Date(b.valid_from).getTime();
        break;
      case 'valid_until':
        aValue = new Date(a.valid_until).getTime();
        bValue = new Date(b.valid_until).getTime();
        break;
      case 'status':
        aValue = a.is_active ? 1 : 0;
        bValue = b.is_active ? 1 : 0;
        break;
      case 'created_at':
      default:
        aValue = new Date(a.created_at).getTime();
        bValue = new Date(b.created_at).getTime();
        break;
    }

    if (aValue < bValue) return sortDirection === 'asc' ? -1 : 1;
    if (aValue > bValue) return sortDirection === 'asc' ? 1 : -1;
    return 0;
  });

  const stats = {
    total: codes.length,
    active: codes.filter(c => c.is_active && new Date() <= new Date(c.valid_until)).length,
    expired: codes.filter(c => new Date() > new Date(c.valid_until)).length,
    totalUses: codes.reduce((sum, c) => sum + c.times_used, 0),
  };

  return (
    <div className="min-h-screen bg-gray-50 py-8">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-3xl font-bold text-gray-900 flex items-center gap-3">
              <Ticket className="h-8 w-8 text-blue-600" />
              Códigos de Descuento
            </h1>
            <p className="text-gray-600 mt-1">Gestiona los códigos promocionales de la plataforma</p>
          </div>
          <button
            onClick={() => {
              resetForm();
              setShowModal(true);
            }}
            className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
          >
            <Plus className="h-5 w-5" />
            Crear Código
          </button>
        </div>

        {/* Stats Cards */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-8">
          <div className="bg-white rounded-lg shadow p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-600">Total Códigos</p>
                <p className="text-3xl font-bold text-gray-900 mt-1">{stats.total}</p>
              </div>
              <Ticket className="h-10 w-10 text-gray-400" />
            </div>
          </div>

          <div className="bg-white rounded-lg shadow p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-600">Activos</p>
                <p className="text-3xl font-bold text-green-600 mt-1">{stats.active}</p>
              </div>
              <CheckCircle className="h-10 w-10 text-green-400" />
            </div>
          </div>

          <div className="bg-white rounded-lg shadow p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-600">Expirados</p>
                <p className="text-3xl font-bold text-red-600 mt-1">{stats.expired}</p>
              </div>
              <XCircle className="h-10 w-10 text-red-400" />
            </div>
          </div>

          <div className="bg-white rounded-lg shadow p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-600">Total Usos</p>
                <p className="text-3xl font-bold text-blue-600 mt-1">{stats.totalUses}</p>
              </div>
              <Users className="h-10 w-10 text-blue-400" />
            </div>
          </div>
        </div>

        {/* Filters */}
        <div className="bg-white rounded-lg shadow p-6 mb-6">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Buscar
              </label>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-5 w-5 text-gray-400" />
                <input
                  type="text"
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  placeholder="Buscar por código o descripción..."
                  className="w-full pl-10 pr-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Tipo
              </label>
              <select
                value={filterType}
                onChange={(e) => setFilterType(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              >
                <option value="all">Todos</option>
                <option value="tours">Tours</option>
                <option value="memberships">Membresias</option>
                <option value="gift_cards">Tarjetas de Regalo</option>
                <option value="service_fees">Cargo por Servicio</option>
                <option value="insurance">Seguro de Viajero</option>
                <option value="featured_slots">Tours Destacados</option>
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Estado
              </label>
              <select
                value={filterStatus}
                onChange={(e) => setFilterStatus(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              >
                <option value="all">Todos</option>
                <option value="active">Activos</option>
                <option value="inactive">Inactivos</option>
                <option value="expired">Expirados</option>
              </select>
            </div>
          </div>
        </div>

        {/* Codes Table */}
        <div className="bg-white rounded-lg shadow overflow-hidden">
          {loading ? (
            <div className="p-8 text-center">
              <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto"></div>
              <p className="text-gray-600 mt-4">Cargando códigos...</p>
            </div>
          ) : sortedAndFilteredCodes.length === 0 ? (
            <div className="p-8 text-center">
              <Ticket className="h-12 w-12 text-gray-400 mx-auto mb-4" />
              <p className="text-gray-600">No se encontraron códigos de descuento</p>
            </div>
          ) : (
            <div className="overflow-auto" style={{ maxHeight: 'calc(100vh - 320px)' }}>
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50 sticky top-0 z-10">
                  <tr>
                    <th
                      className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100 select-none"
                      onClick={() => handleSort('code')}
                    >
                      <div className="flex items-center gap-2">
                        Código
                        {getSortIcon('code')}
                      </div>
                    </th>
                    <th
                      className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100 select-none"
                      onClick={() => handleSort('type')}
                    >
                      <div className="flex items-center gap-2">
                        Tipo
                        {getSortIcon('type')}
                      </div>
                    </th>
                    <th
                      className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100 select-none"
                      onClick={() => handleSort('discount')}
                    >
                      <div className="flex items-center gap-2">
                        Descuento
                        {getSortIcon('discount')}
                      </div>
                    </th>
                    <th
                      className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100 select-none"
                      onClick={() => handleSort('applicable_to')}
                    >
                      <div className="flex items-center gap-2">
                        Aplicable a
                        {getSortIcon('applicable_to')}
                      </div>
                    </th>
                    <th
                      className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100 select-none"
                      onClick={() => handleSort('uses')}
                    >
                      <div className="flex items-center gap-2">
                        Usos
                        {getSortIcon('uses')}
                      </div>
                    </th>
                    <th
                      className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100 select-none"
                      onClick={() => handleSort('valid_from')}
                    >
                      <div className="flex items-center gap-2">
                        Vigencia
                        {getSortIcon('valid_from')}
                      </div>
                    </th>
                    <th
                      className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100 select-none"
                      onClick={() => handleSort('status')}
                    >
                      <div className="flex items-center gap-2">
                        Estado
                        {getSortIcon('status')}
                      </div>
                    </th>
                    <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Acciones
                    </th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {sortedAndFilteredCodes.map((code) => (
                    <tr key={code.id} className="hover:bg-gray-50">
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="flex items-center">
                          <div className="flex-shrink-0 h-10 w-10 flex items-center justify-center bg-blue-100 rounded-lg">
                            <Ticket className="h-5 w-5 text-blue-600" />
                          </div>
                          <div className="ml-4">
                            <div className="text-sm font-medium text-gray-900">{code.code}</div>
                            <div className="text-sm text-gray-500 max-w-xs truncate">{code.description}</div>
                          </div>
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="text-sm text-gray-900">{getDiscountTypeLabel(code.discount_type)}</div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="flex flex-col gap-1">
                          <div className="flex items-center gap-1 text-sm font-medium text-gray-900">
                            {code.discount_type.includes('percentage') ? (
                              <>
                                <Percent className="h-4 w-4 text-green-600" />
                                {code.discount_value}%
                              </>
                            ) : code.discount_type === 'membership_free_month' ? (
                              <>1 Mes Gratis</>
                            ) : code.discount_type === 'service_fee_full' ? (
                              <>Cargo Gratis</>
                            ) : code.discount_type === 'insurance_free' ? (
                              <>Seguro Gratis</>
                            ) : (
                              <>
                                <DollarSign className="h-4 w-4 text-green-600" />
                                ${code.discount_value}
                              </>
                            )}
                          </div>
                          {code.max_discount_amount && code.discount_type.includes('percentage') && (
                            <div className="text-xs text-gray-500">
                              (máx. ${code.max_discount_amount})
                            </div>
                          )}
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="flex flex-col gap-1">
                          {code.applicable_to === 'tours' && (
                            <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium bg-blue-100 text-blue-800">
                              <Map className="h-3 w-3" />
                              {getApplicableToLabel(code.applicable_to)}
                            </span>
                          )}
                          {code.applicable_to === 'memberships' && (
                            <>
                              <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium bg-purple-100 text-purple-800">
                                <Crown className="h-3 w-3" />
                                {getApplicableToLabel(code.applicable_to)}
                              </span>
                              {code.membership_plan_type && code.membership_plan_type !== 'both' && (
                                <span className="text-xs text-gray-500 ml-1">
                                  {getMembershipPlanTypeLabel(code.membership_plan_type)}
                                </span>
                              )}
                            </>
                          )}
                          {code.applicable_to === 'gift_cards' && (
                            <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium bg-orange-100 text-orange-800">
                              <Gift className="h-3 w-3" />
                              {getApplicableToLabel(code.applicable_to)}
                            </span>
                          )}
                          {code.applicable_to === 'service_fees' && (
                            <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium bg-cyan-100 text-cyan-800">
                              <DollarSign className="h-3 w-3" />
                              {getApplicableToLabel(code.applicable_to)}
                            </span>
                          )}
                          {code.applicable_to === 'insurance' && (
                            <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium bg-green-100 text-green-800">
                              <Shield className="h-3 w-3" />
                              {getApplicableToLabel(code.applicable_to)}
                            </span>
                          )}
                          {code.applicable_to === 'tours' && code.agencies?.name && (
                            <span className="inline-flex items-center gap-1 text-xs text-gray-500">
                              <Building2 className="h-3 w-3" />
                              {code.agencies.name}
                            </span>
                          )}
                          {code.applicable_to === 'tours' && code.tours?.name && (
                            <span className="inline-flex items-center gap-1 text-xs text-gray-500">
                              <Target className="h-3 w-3" />
                              {code.tours.name}
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="text-sm text-gray-900">
                          {code.times_used} {code.max_uses ? `/ ${code.max_uses}` : '/ ∞'}
                        </div>
                        {code.is_single_use && (
                          <div className="text-xs text-gray-500">Uso único</div>
                        )}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="text-sm text-gray-900">{formatDate(code.valid_from)}</div>
                        <div className="text-sm text-gray-500">{formatDate(code.valid_until)}</div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        {getStatusBadge(code)}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                        <div className="flex items-center justify-end gap-2">
                          <button
                            onClick={() => handleViewDetails(code)}
                            className="text-blue-600 hover:text-blue-900"
                            title="Ver detalles"
                          >
                            <Eye className="h-5 w-5" />
                          </button>
                          <button
                            onClick={() => handleEdit(code)}
                            className="text-yellow-600 hover:text-yellow-900"
                            title="Editar"
                          >
                            <Edit2 className="h-5 w-5" />
                          </button>
                          <button
                            onClick={() => handleDelete(code.id)}
                            className="text-red-600 hover:text-red-900"
                            title="Eliminar"
                          >
                            <Trash2 className="h-5 w-5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {/* Create/Edit Modal */}
      {showModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-lg max-w-2xl w-full max-h-[90vh] overflow-y-auto">
            <div className="p-6">
              <h2 className="text-2xl font-bold text-gray-900 mb-6">
                {editingCode ? 'Editar Código de Descuento' : 'Crear Código de Descuento'}
              </h2>

              <form onSubmit={handleSubmit} className="space-y-6">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Código *
                    </label>
                    <input
                      type="text"
                      value={formData.code}
                      onChange={(e) => setFormData({ ...formData, code: e.target.value.toUpperCase() })}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent uppercase"
                      placeholder="VERANO2024"
                      required
                    />
                    <p className="text-xs text-gray-500 mt-1">El código se convertirá automáticamente a mayúsculas</p>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Aplicable a *
                    </label>
                    <select
                      value={formData.applicable_to}
                      onChange={(e) => {
                        const newApplicableTo = e.target.value as 'tours' | 'memberships' | 'gift_cards' | 'service_fees' | 'insurance';
                        const options = getDiscountTypeOptions(newApplicableTo);
                        setFormData({
                          ...formData,
                          applicable_to: newApplicableTo,
                          discount_type: options[0]?.value || '',
                          max_discount_amount: '',
                          membership_plan_type: 'both',
                        });
                      }}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                      required
                    >
                      <option value="tours">Tours</option>
                      <option value="memberships">Membresias</option>
                      <option value="gift_cards">Tarjetas de Regalo</option>
                      <option value="service_fees">Cargo por Servicio</option>
                      <option value="insurance">Seguro de Viajero</option>
                      <option value="featured_slots">Tours Destacados</option>
                    </select>
                    {formData.applicable_to === 'service_fees' && (
                      <p className="text-xs text-cyan-600 mt-1">
                        Descuentos aplicables unicamente al cargo por servicio de la plataforma. No afecta el precio del tour.
                      </p>
                    )}
                    {formData.applicable_to === 'insurance' && (
                      <p className="text-xs text-green-600 mt-1">
                        Descuentos aplicables unicamente al seguro de viajero. No afecta el precio del tour.
                      </p>
                    )}
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Descripción *
                  </label>
                  <textarea
                    value={formData.description}
                    onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    rows={3}
                    placeholder="Describe el propósito de este código..."
                    required
                  />
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Tipo de Descuento *
                    </label>
                    <select
                      value={formData.discount_type}
                      onChange={(e) => setFormData({
                        ...formData,
                        discount_type: e.target.value,
                        discount_value: (e.target.value === 'membership_free_month' || e.target.value === 'service_fee_full' || e.target.value === 'insurance_free') ? '' : formData.discount_value,
                        max_discount_amount: (e.target.value === 'service_fee_full' || e.target.value === 'insurance_free') ? '' : formData.max_discount_amount,
                        membership_plan_type: e.target.value === 'membership_free_month' ? 'monthly' : formData.membership_plan_type,
                      })}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                      required
                    >
                      {getDiscountTypeOptions(formData.applicable_to).map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                    {formData.discount_type === 'service_fee_full' && (
                      <p className="text-xs text-cyan-600 mt-1">
                        Este codigo eliminara completamente el cargo por servicio para el usuario
                      </p>
                    )}
                    {formData.discount_type === 'insurance_free' && (
                      <p className="text-xs text-green-600 mt-1">
                        Este codigo eliminara completamente el costo del seguro para el usuario
                      </p>
                    )}
                  </div>

                  {formData.discount_type !== 'membership_free_month' && formData.discount_type !== 'service_fee_full' && formData.discount_type !== 'insurance_free' && (
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        Valor del Descuento *
                      </label>
                      <input
                        type="number"
                        value={formData.discount_value}
                        onChange={(e) => setFormData({ ...formData, discount_value: e.target.value })}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                        placeholder={formData.discount_type.includes('percentage') ? '10' : '100'}
                        min="0"
                        max={formData.discount_type.includes('percentage') ? '100' : undefined}
                        step={formData.discount_type.includes('percentage') ? '1' : '0.01'}
                        required
                      />
                      <p className="text-xs text-gray-500 mt-1">
                        {formData.discount_type.includes('percentage') ? 'Porcentaje (0-100)' : 'Monto en pesos'}
                      </p>
                    </div>
                  )}
                </div>

                {formData.applicable_to === 'memberships' && (
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Tipo de Plan *
                    </label>
                    <select
                      value={formData.membership_plan_type}
                      onChange={(e) => setFormData({ ...formData, membership_plan_type: e.target.value as 'monthly' | 'annual' | 'both' })}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                      disabled={formData.discount_type === 'membership_free_month'}
                    >
                      <option value="both">Ambos (Mensual y Anual)</option>
                      <option value="monthly">Solo Mensual</option>
                      <option value="annual">Solo Anual</option>
                    </select>
                    <p className="text-xs text-gray-500 mt-1">
                      {formData.discount_type === 'membership_free_month'
                        ? 'El descuento de mes gratis solo aplica al plan mensual'
                        : 'Selecciona a que tipo de plan aplica este codigo'}
                    </p>
                  </div>
                )}

                {(formData.applicable_to === 'service_fees' && formData.discount_type === 'service_fee_percentage') ||
                 (formData.applicable_to === 'tours' && formData.discount_type.includes('percentage')) ||
                 (formData.applicable_to === 'insurance' && formData.discount_type === 'insurance_percentage') ? (
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Monto Máximo de Descuento (Opcional)
                    </label>
                    <input
                      type="number"
                      value={formData.max_discount_amount}
                      onChange={(e) => setFormData({ ...formData, max_discount_amount: e.target.value })}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                      placeholder="100"
                      min="0"
                      step="0.01"
                    />
                    <p className="text-xs text-gray-500 mt-1">
                      Opcional: Límite máximo del descuento en pesos. Útil para controlar el costo de promociones con porcentajes altos.
                    </p>
                  </div>
                ) : null}

                {formData.applicable_to === 'tours' && (
                  <>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        Descuento aplica sobre *
                      </label>
                      <select
                        value={formData.discount_applies_to}
                        onChange={(e) => setFormData({ ...formData, discount_applies_to: e.target.value as 'total_price' | 'payment_amount' })}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                      >
                        <option value="total_price">Costo total del tour</option>
                        <option value="payment_amount">Monto a pagar (deposito + cargo por servicio)</option>
                      </select>
                      <p className="text-xs text-gray-500 mt-1">
                        {formData.discount_applies_to === 'total_price'
                          ? 'El descuento reduce el precio total del tour, afectando deposito, comision y cargo por servicio en cascada.'
                          : 'El descuento solo reduce lo que el usuario paga (deposito + cargo por servicio), sin modificar el costo total del tour.'}
                      </p>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">
                          Agencia (Opcional)
                        </label>
                        <select
                          value={formData.agency_id}
                          onChange={(e) => {
                            const newAgencyId = e.target.value;
                            setFormData({ ...formData, agency_id: newAgencyId, tour_id: '' });
                            if (newAgencyId) {
                              fetchAgencyTours(newAgencyId);
                            } else {
                              setAgencyTours([]);
                            }
                          }}
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                        >
                          <option value="">Todas las agencias (global)</option>
                          {agencies.map((agency) => (
                            <option key={agency.id} value={agency.id}>{agency.name}</option>
                          ))}
                        </select>
                        <p className="text-xs text-gray-500 mt-1">
                          Deja vacio para que aplique a todos los tours de la plataforma
                        </p>
                      </div>

                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">
                          Tour (Opcional)
                        </label>
                        <select
                          value={formData.tour_id}
                          onChange={(e) => setFormData({ ...formData, tour_id: e.target.value })}
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                          disabled={!formData.agency_id || loadingAgencyTours}
                        >
                          <option value="">Todos los tours de la agencia</option>
                          {agencyTours.map((tour) => (
                            <option key={tour.id} value={tour.id}>{tour.name}</option>
                          ))}
                        </select>
                        <p className="text-xs text-gray-500 mt-1">
                          {!formData.agency_id ? 'Selecciona una agencia primero' : 'Deja vacio para que aplique a todos los tours de la agencia'}
                        </p>
                      </div>
                    </div>
                  </>
                )}

                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Válido Desde *
                    </label>
                    <input
                      type="date"
                      value={formData.valid_from}
                      onChange={(e) => setFormData({ ...formData, valid_from: e.target.value })}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                      required
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Válido Hasta *
                    </label>
                    <input
                      type="date"
                      value={formData.valid_until}
                      onChange={(e) => setFormData({ ...formData, valid_until: e.target.value })}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                      min={formData.valid_from}
                      required
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Máximo de Usos
                    </label>
                    <input
                      type="number"
                      value={formData.max_uses}
                      onChange={(e) => setFormData({ ...formData, max_uses: e.target.value })}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                      placeholder="Dejar vacío para ilimitado"
                      min="1"
                    />
                    <p className="text-xs text-gray-500 mt-1">Número máximo de veces que se puede usar</p>
                  </div>
                </div>

                <div className="space-y-4">
                  <label className="flex items-center gap-3">
                    <input
                      type="checkbox"
                      checked={formData.is_single_use}
                      onChange={(e) => setFormData({
                        ...formData,
                        is_single_use: e.target.checked,
                        max_uses: e.target.checked ? '1' : formData.max_uses
                      })}
                      className="w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
                    />
                    <span className="text-sm font-medium text-gray-700">Uso único (solo puede usarse una vez en total)</span>
                  </label>

                  <label className="flex items-center gap-3">
                    <input
                      type="checkbox"
                      checked={formData.is_active}
                      onChange={(e) => setFormData({ ...formData, is_active: e.target.checked })}
                      className="w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
                    />
                    <span className="text-sm font-medium text-gray-700">Código activo</span>
                  </label>
                </div>

                <div className="flex gap-4 pt-4">
                  <button
                    type="submit"
                    className="flex-1 bg-blue-600 text-white py-2 px-4 rounded-lg hover:bg-blue-700 transition-colors"
                  >
                    {editingCode ? 'Actualizar Código' : 'Crear Código'}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setShowModal(false);
                      resetForm();
                    }}
                    className="flex-1 bg-gray-200 text-gray-800 py-2 px-4 rounded-lg hover:bg-gray-300 transition-colors"
                  >
                    Cancelar
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}

      {/* Detail Modal */}
      {showDetailModal && selectedCode && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-lg max-w-4xl w-full max-h-[90vh] overflow-y-auto">
            <div className="p-6">
              <div className="flex items-center justify-between mb-6">
                <h2 className="text-2xl font-bold text-gray-900">Detalles del Código</h2>
                <button
                  onClick={() => setShowDetailModal(false)}
                  className="text-gray-400 hover:text-gray-600"
                >
                  <XCircle className="h-6 w-6" />
                </button>
              </div>

              <div className="bg-gray-50 rounded-lg p-6 mb-6">
                <div className="grid grid-cols-2 gap-6">
                  <div>
                    <p className="text-sm text-gray-600">Código</p>
                    <p className="text-lg font-bold text-gray-900">{selectedCode.code}</p>
                  </div>
                  <div>
                    <p className="text-sm text-gray-600">Estado</p>
                    <div className="mt-1">{getStatusBadge(selectedCode)}</div>
                  </div>
                  <div>
                    <p className="text-sm text-gray-600">Descripción</p>
                    <p className="text-sm text-gray-900">{selectedCode.description}</p>
                  </div>
                  <div>
                    <p className="text-sm text-gray-600">Tipo de Descuento</p>
                    <p className="text-sm text-gray-900">{getDiscountTypeLabel(selectedCode.discount_type)}</p>
                  </div>
                  <div>
                    <p className="text-sm text-gray-600">Aplicable a</p>
                    <p className="text-sm font-medium text-gray-900">{getApplicableToLabel(selectedCode.applicable_to)}</p>
                    {selectedCode.applicable_to === 'memberships' && (
                      <p className="text-xs text-gray-500 mt-1">
                        Plan: {getMembershipPlanTypeLabel(selectedCode.membership_plan_type)}
                      </p>
                    )}
                  </div>
                  <div>
                    <p className="text-sm text-gray-600">Valor</p>
                    <p className="text-sm font-medium text-gray-900">
                      {selectedCode.discount_type.includes('percentage')
                        ? `${selectedCode.discount_value}%`
                        : selectedCode.discount_type === 'membership_free_month'
                        ? '1 Mes Gratis'
                        : selectedCode.discount_type === 'service_fee_full'
                        ? 'Cargo por Servicio Gratis'
                        : selectedCode.discount_type === 'insurance_free'
                        ? 'Seguro Gratis'
                        : `$${selectedCode.discount_value}`
                      }
                    </p>
                    {selectedCode.max_discount_amount && selectedCode.discount_type.includes('percentage') && (
                      <p className="text-xs text-gray-500 mt-1">
                        Máximo: ${selectedCode.max_discount_amount}
                      </p>
                    )}
                  </div>
                  <div>
                    <p className="text-sm text-gray-600">Usos</p>
                    <p className="text-sm text-gray-900">
                      {selectedCode.times_used} {selectedCode.max_uses ? `/ ${selectedCode.max_uses}` : '/ ∞'}
                    </p>
                  </div>
                  {selectedCode.applicable_to === 'tours' && (
                    <div>
                      <p className="text-sm text-gray-600">Aplica sobre</p>
                      <p className="text-sm text-gray-900">
                        {selectedCode.discount_applies_to === 'total_price' ? 'Costo total del tour' : 'Monto a pagar'}
                      </p>
                    </div>
                  )}
                  {selectedCode.agencies?.name && (
                    <div>
                      <p className="text-sm text-gray-600">Agencia</p>
                      <p className="text-sm text-gray-900">{selectedCode.agencies.name}</p>
                    </div>
                  )}
                  {selectedCode.tours?.name && (
                    <div>
                      <p className="text-sm text-gray-600">Tour</p>
                      <p className="text-sm text-gray-900">{selectedCode.tours.name}</p>
                    </div>
                  )}
                </div>
                {selectedCode.applicable_to === 'service_fees' && (
                  <div className="mt-4 p-3 bg-cyan-50 border border-cyan-200 rounded-lg">
                    <p className="text-sm text-cyan-800">
                      <strong>Nota:</strong> Este codigo solo afecta el cargo por servicio de la plataforma y no modifica el precio base del tour.
                    </p>
                  </div>
                )}
                {selectedCode.applicable_to === 'insurance' && (
                  <div className="mt-4 p-3 bg-green-50 border border-green-200 rounded-lg">
                    <p className="text-sm text-green-800">
                      <strong>Nota:</strong> Este codigo solo afecta el costo del seguro de viajero y no modifica el precio del tour ni el cargo por servicio.
                    </p>
                  </div>
                )}
              </div>

              <h3 className="text-lg font-bold text-gray-900 mb-4">Historial de Uso</h3>

              {usageRecords.length === 0 ? (
                <div className="text-center py-8">
                  <Users className="h-12 w-12 text-gray-400 mx-auto mb-4" />
                  <p className="text-gray-600">Este código aún no ha sido usado</p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="min-w-full divide-y divide-gray-200">
                    <thead className="bg-gray-50">
                      <tr>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Usuario</th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Fecha de Uso</th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Usado en</th>
                      </tr>
                    </thead>
                    <tbody className="bg-white divide-y divide-gray-200">
                      {usageRecords.map((record) => (
                        <tr key={record.id}>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                            {record.user_name || 'Usuario desconocido'}
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                            {formatDate(record.used_at)}
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                            {record.booking_id && 'Reserva'}
                            {record.gift_card_id && 'Tarjeta de Regalo'}
                            {record.membership_id && 'Membresía'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              <div className="mt-6">
                <button
                  onClick={() => setShowDetailModal(false)}
                  className="w-full bg-gray-200 text-gray-800 py-2 px-4 rounded-lg hover:bg-gray-300 transition-colors"
                >
                  Cerrar
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}