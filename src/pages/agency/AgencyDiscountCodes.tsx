import { useState, useEffect } from 'react';
import { Ticket, Plus, CreditCard as Edit2, Trash2, Eye, Percent, DollarSign, Calendar, Users, AlertCircle, CheckCircle, XCircle, Search, Globe, Target } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../context/AuthContext';
import { useAgencyId } from '../../hooks/useAgencyId';
import { AgencyDiscountCode, AgencyTour } from '../../types';

interface UsageRecord {
  id: string;
  user_id: string;
  user_name: string;
  used_at: string;
  booking_id: string | null;
}

export default function AgencyDiscountCodes() {
  const { user } = useAuth();
  const { agencyId: resolvedAgencyId } = useAgencyId();
  const [codes, setCodes] = useState<AgencyDiscountCode[]>([]);
  const [agencyId, setAgencyId] = useState<string | null>(null);
  const [agencyTours, setAgencyTours] = useState<AgencyTour[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [showDetailModal, setShowDetailModal] = useState(false);
  const [editingCode, setEditingCode] = useState<AgencyDiscountCode | null>(null);
  const [selectedCode, setSelectedCode] = useState<AgencyDiscountCode | null>(null);
  const [usageRecords, setUsageRecords] = useState<UsageRecord[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [filterStatus, setFilterStatus] = useState<string>('all');
  const [filterTour, setFilterTour] = useState<string>('all');

  const [formData, setFormData] = useState({
    code: '',
    description: '',
    tour_scope: 'all' as 'all' | 'specific',
    tour_id: '',
    discount_type: 'agency_tour_percentage' as 'agency_tour_percentage' | 'agency_tour_fixed',
    discount_value: '',
    discount_applies_to: 'total_price' as 'total_price' | 'payment_amount',
    valid_from: new Date().toISOString().split('T')[0],
    valid_until: '',
    is_single_use: false,
    max_uses: '',
    is_active: true,
  });

  useEffect(() => {
    if (resolvedAgencyId) {
      setAgencyId(resolvedAgencyId);
    }
  }, [resolvedAgencyId]);

  useEffect(() => {
    if (agencyId) {
      fetchCodes();
      fetchAgencyTours();
    }
  }, [agencyId]);

  const fetchAgencyTours = async () => {
    if (!agencyId) return;

    try {
      const { data, error } = await supabase
        .rpc('get_agency_tours', { p_agency_id: agencyId });

      if (error) throw error;
      setAgencyTours(data || []);
    } catch (err) {
      console.error('Error fetching agency tours:', err);
    }
  };

  const fetchCodes = async () => {
    if (!agencyId) return;

    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('discount_codes')
        .select(`
          *,
          tours:tour_id (
            name
          )
        `)
        .eq('agency_id', agencyId)
        .order('created_at', { ascending: false });

      if (error) throw error;

      const codesWithTourName = (data || []).map(code => ({
        ...code,
        tour_name: code.tours?.name || null,
      }));

      setCodes(codesWithTourName as AgencyDiscountCode[]);
    } catch (err) {
      console.error('Error fetching discount codes:', err);
    } finally {
      setLoading(false);
    }
  };

  const fetchCodeDetails = async (codeId: string) => {
    try {
      const { data: usageData, error } = await supabase
        .from('discount_code_usage')
        .select(`
          id,
          user_id,
          used_at,
          booking_id,
          users:user_id (
            first_name,
            last_name,
            email
          )
        `)
        .eq('discount_code_id', codeId)
        .order('used_at', { ascending: false });

      if (error) throw error;

      const records = (usageData || []).map((record: any) => ({
        id: record.id,
        user_id: record.user_id,
        user_name: record.users
          ? `${record.users.first_name || ''} ${record.users.last_name || ''}`.trim() || record.users.email
          : 'Usuario desconocido',
        used_at: record.used_at,
        booking_id: record.booking_id,
      }));

      setUsageRecords(records);
    } catch (err) {
      console.error('Error fetching code details:', err);
    }
  };

  const validateForm = () => {
    if (!formData.code || !formData.description || !formData.valid_until) {
      alert('Por favor complete todos los campos requeridos');
      return false;
    }

    if (!formData.discount_value) {
      alert('Por favor ingrese el valor del descuento');
      return false;
    }

    const discountValue = parseFloat(formData.discount_value);

    if (formData.discount_type === 'agency_tour_percentage') {
      if (discountValue <= 0 || discountValue > 100) {
        alert('El porcentaje de descuento debe estar entre 1 y 100');
        return false;
      }
    } else {
      if (discountValue <= 0) {
        alert('El monto del descuento debe ser mayor a 0');
        return false;
      }

      if (formData.tour_scope === 'specific' && formData.tour_id) {
        const selectedTour = agencyTours.find(t => t.id === formData.tour_id);
        if (selectedTour && discountValue >= selectedTour.price) {
          alert(`El descuento no puede ser mayor o igual al precio del tour ($${selectedTour.price})`);
          return false;
        }
      }
    }

    if (formData.tour_scope === 'specific' && !formData.tour_id) {
      alert('Por favor seleccione un tour específico');
      return false;
    }

    if (new Date(formData.valid_until) <= new Date(formData.valid_from)) {
      alert('La fecha de fin debe ser posterior a la fecha de inicio');
      return false;
    }

    return true;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!validateForm() || !agencyId) return;

    try {
      const codeData = {
        code: formData.code.toUpperCase(),
        description: formData.description,
        discount_type: formData.discount_type,
        discount_value: parseFloat(formData.discount_value),
        applicable_to: 'tours' as const,
        discount_applies_to: formData.discount_applies_to,
        is_single_use: formData.is_single_use,
        is_active: formData.is_active,
        valid_from: formData.valid_from,
        valid_until: formData.valid_until,
        max_uses: formData.max_uses ? parseInt(formData.max_uses) : null,
        agency_id: agencyId,
        tour_id: formData.tour_scope === 'specific' ? formData.tour_id : null,
        created_by: user?.id,
      };

      if (editingCode) {
        const { error } = await supabase
          .from('discount_codes')
          .update(codeData)
          .eq('id', editingCode.id);

        if (error) throw error;
        alert('Código actualizado exitosamente');
      } else {
        const { error } = await supabase
          .from('discount_codes')
          .insert([codeData]);

        if (error) throw error;
        alert('Código creado exitosamente');
      }

      setShowModal(false);
      resetForm();
      fetchCodes();
    } catch (err: any) {
      console.error('Error saving discount code:', err);
      if (err.message.includes('duplicate key')) {
        alert('Este código ya existe. Por favor usa un código diferente.');
      } else if (err.message.includes('Tour does not belong')) {
        alert('El tour seleccionado no pertenece a tu agencia');
      } else {
        alert(err.message || 'Error al guardar el código de descuento');
      }
    }
  };

  const handleEdit = (code: AgencyDiscountCode) => {
    setEditingCode(code);
    setFormData({
      code: code.code,
      description: code.description,
      tour_scope: code.tour_id ? 'specific' : 'all',
      tour_id: code.tour_id || '',
      discount_type: code.discount_type,
      discount_value: code.discount_value.toString(),
      discount_applies_to: code.discount_applies_to || 'total_price',
      valid_from: code.valid_from.split('T')[0],
      valid_until: code.valid_until.split('T')[0],
      is_single_use: code.is_single_use,
      max_uses: code.max_uses?.toString() || '',
      is_active: code.is_active,
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
      alert('Código eliminado exitosamente');
      fetchCodes();
    } catch (err: any) {
      console.error('Error deleting discount code:', err);
      alert('Error al eliminar el código. Si el código ya ha sido usado, considera desactivarlo en lugar de eliminarlo.');
    }
  };

  const handleViewDetails = async (code: AgencyDiscountCode) => {
    setSelectedCode(code);
    await fetchCodeDetails(code.id);
    setShowDetailModal(true);
  };

  const resetForm = () => {
    setEditingCode(null);
    setFormData({
      code: '',
      description: '',
      tour_scope: 'all',
      tour_id: '',
      discount_type: 'agency_tour_percentage',
      discount_value: '',
      discount_applies_to: 'total_price',
      valid_from: new Date().toISOString().split('T')[0],
      valid_until: '',
      is_single_use: false,
      max_uses: '',
      is_active: true,
    });
  };

  const getDiscountTypeLabel = (type: string) => {
    const labels: Record<string, string> = {
      agency_tour_percentage: 'Porcentaje',
      agency_tour_fixed: 'Monto Fijo',
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

  const getStatusBadge = (code: AgencyDiscountCode) => {
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

  const getTourScopeBadge = (code: AgencyDiscountCode) => {
    if (code.tour_id && code.tour_name) {
      return (
        <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium bg-blue-100 text-blue-800">
          <Target className="h-3 w-3" />
          {code.tour_name}
        </span>
      );
    }
    return (
      <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium bg-green-100 text-green-800">
        <Globe className="h-3 w-3" />
        Todos los tours
      </span>
    );
  };

  const filteredCodes = codes.filter(code => {
    const matchesSearch = code.code.toLowerCase().includes(searchTerm.toLowerCase()) ||
                         code.description.toLowerCase().includes(searchTerm.toLowerCase());

    const matchesTour = filterTour === 'all' ||
                        (filterTour === 'global' && !code.tour_id) ||
                        (filterTour === 'specific' && code.tour_id) ||
                        (code.tour_id === filterTour);

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

    return matchesSearch && matchesTour && matchesStatus;
  });

  const stats = {
    total: codes.length,
    active: codes.filter(c => c.is_active && new Date() <= new Date(c.valid_until)).length,
    global: codes.filter(c => !c.tour_id).length,
    specific: codes.filter(c => c.tour_id).length,
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
            <p className="text-gray-600 mt-1">Crea y gestiona códigos promocionales para tus tours</p>
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

        <div className="grid grid-cols-1 md:grid-cols-5 gap-6 mb-8">
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
                <p className="text-sm text-gray-600">Globales</p>
                <p className="text-3xl font-bold text-blue-600 mt-1">{stats.global}</p>
              </div>
              <Globe className="h-10 w-10 text-blue-400" />
            </div>
          </div>

          <div className="bg-white rounded-lg shadow p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-600">Específicos</p>
                <p className="text-3xl font-bold text-purple-600 mt-1">{stats.specific}</p>
              </div>
              <Target className="h-10 w-10 text-purple-400" />
            </div>
          </div>

          <div className="bg-white rounded-lg shadow p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-600">Total Usos</p>
                <p className="text-3xl font-bold text-orange-600 mt-1">{stats.totalUses}</p>
              </div>
              <Users className="h-10 w-10 text-orange-400" />
            </div>
          </div>
        </div>

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
                Filtrar por Tour
              </label>
              <select
                value={filterTour}
                onChange={(e) => setFilterTour(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              >
                <option value="all">Todos</option>
                <option value="global">Códigos Globales</option>
                <option value="specific">Códigos Específicos</option>
                {agencyTours.map(tour => (
                  <option key={tour.id} value={tour.id}>{tour.name}</option>
                ))}
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

        <div className="bg-white rounded-lg shadow overflow-hidden">
          {loading ? (
            <div className="p-8 text-center">
              <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto"></div>
              <p className="text-gray-600 mt-4">Cargando códigos...</p>
            </div>
          ) : filteredCodes.length === 0 ? (
            <div className="p-8 text-center">
              <Ticket className="h-12 w-12 text-gray-400 mx-auto mb-4" />
              <p className="text-gray-600">No se encontraron códigos de descuento</p>
              <button
                onClick={() => {
                  resetForm();
                  setShowModal(true);
                }}
                className="mt-4 inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
              >
                <Plus className="h-5 w-5" />
                Crear tu primer código
              </button>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Código
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Tour Aplicable
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Tipo
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Descuento
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Usos
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Vigencia
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Estado
                    </th>
                    <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Acciones
                    </th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {filteredCodes.map((code) => (
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
                        {getTourScopeBadge(code)}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="text-sm text-gray-900">{getDiscountTypeLabel(code.discount_type)}</div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="flex items-center gap-1 text-sm font-medium text-gray-900">
                          {code.discount_type === 'agency_tour_percentage' ? (
                            <>
                              <Percent className="h-4 w-4 text-green-600" />
                              {code.discount_value}%
                            </>
                          ) : (
                            <>
                              <DollarSign className="h-4 w-4 text-green-600" />
                              ${code.discount_value}
                            </>
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
                      disabled={editingCode?.times_used > 0}
                    />
                    {editingCode?.times_used > 0 && (
                      <p className="text-xs text-orange-600 mt-1">No se puede modificar un código que ya ha sido usado</p>
                    )}
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Tipo de Descuento *
                    </label>
                    <select
                      value={formData.discount_type}
                      onChange={(e) => setFormData({
                        ...formData,
                        discount_type: e.target.value as 'agency_tour_percentage' | 'agency_tour_fixed'
                      })}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                      required
                    >
                      <option value="agency_tour_percentage">Porcentaje</option>
                      <option value="agency_tour_fixed">Monto Fijo</option>
                    </select>
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

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-3">
                    Aplicable a *
                  </label>
                  <div className="space-y-3">
                    <label className="flex items-center gap-3 p-4 border border-gray-300 rounded-lg cursor-pointer hover:bg-gray-50">
                      <input
                        type="radio"
                        name="tour_scope"
                        value="all"
                        checked={formData.tour_scope === 'all'}
                        onChange={(e) => setFormData({
                          ...formData,
                          tour_scope: e.target.value as 'all' | 'specific',
                          tour_id: ''
                        })}
                        className="w-4 h-4 text-blue-600 border-gray-300 focus:ring-blue-500"
                      />
                      <div className="flex-1">
                        <div className="flex items-center gap-2">
                          <Globe className="h-5 w-5 text-green-600" />
                          <span className="text-sm font-medium text-gray-900">Todos mis tours</span>
                        </div>
                        <p className="text-xs text-gray-500 mt-1">El código puede usarse en cualquier tour de tu agencia</p>
                      </div>
                    </label>

                    <label className="flex items-center gap-3 p-4 border border-gray-300 rounded-lg cursor-pointer hover:bg-gray-50">
                      <input
                        type="radio"
                        name="tour_scope"
                        value="specific"
                        checked={formData.tour_scope === 'specific'}
                        onChange={(e) => setFormData({
                          ...formData,
                          tour_scope: e.target.value as 'all' | 'specific'
                        })}
                        className="w-4 h-4 text-blue-600 border-gray-300 focus:ring-blue-500"
                      />
                      <div className="flex-1">
                        <div className="flex items-center gap-2">
                          <Target className="h-5 w-5 text-blue-600" />
                          <span className="text-sm font-medium text-gray-900">Tour específico</span>
                        </div>
                        <p className="text-xs text-gray-500 mt-1">El código solo puede usarse en un tour específico</p>
                      </div>
                    </label>
                  </div>
                </div>

                {formData.tour_scope === 'specific' && (
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Selecciona el Tour *
                    </label>
                    <select
                      value={formData.tour_id}
                      onChange={(e) => setFormData({ ...formData, tour_id: e.target.value })}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                      required
                    >
                      <option value="">Selecciona un tour...</option>
                      {agencyTours.map(tour => (
                        <option key={tour.id} value={tour.id}>
                          {tour.name} - ${tour.price} ({formatDate(tour.start_date)})
                        </option>
                      ))}
                    </select>
                    {agencyTours.length === 0 && (
                      <p className="text-xs text-orange-600 mt-1">No tienes tours activos. Crea un tour primero.</p>
                    )}
                  </div>
                )}

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Valor del Descuento *
                  </label>
                  <input
                    type="number"
                    value={formData.discount_value}
                    onChange={(e) => setFormData({ ...formData, discount_value: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    placeholder={formData.discount_type === 'agency_tour_percentage' ? '10' : '100'}
                    min="0"
                    max={formData.discount_type === 'agency_tour_percentage' ? '100' : undefined}
                    step={formData.discount_type === 'agency_tour_percentage' ? '1' : '0.01'}
                    required
                  />
                  <p className="text-xs text-gray-500 mt-1">
                    {formData.discount_type === 'agency_tour_percentage'
                      ? 'Porcentaje de descuento (1-100)'
                      : 'Monto en pesos'}
                  </p>
                </div>

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
                      ? 'El descuento reduce el precio total del tour, afectando deposito, comision y cargo por servicio.'
                      : 'El descuento solo reduce lo que el usuario paga (deposito + cargo por servicio).'}
                  </p>
                </div>

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
                    <p className="text-sm text-gray-600">Tour Aplicable</p>
                    <div className="mt-1">{getTourScopeBadge(selectedCode)}</div>
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
                    <p className="text-sm text-gray-600">Valor</p>
                    <p className="text-sm font-medium text-gray-900">
                      {selectedCode.discount_type === 'agency_tour_percentage'
                        ? `${selectedCode.discount_value}%`
                        : `$${selectedCode.discount_value}`
                      }
                    </p>
                  </div>
                  <div>
                    <p className="text-sm text-gray-600">Usos</p>
                    <p className="text-sm text-gray-900">
                      {selectedCode.times_used} {selectedCode.max_uses ? `/ ${selectedCode.max_uses}` : '/ ∞'}
                    </p>
                  </div>
                </div>
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
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Reserva</th>
                      </tr>
                    </thead>
                    <tbody className="bg-white divide-y divide-gray-200">
                      {usageRecords.map((record) => (
                        <tr key={record.id}>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                            {record.user_name}
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                            {formatDate(record.used_at)}
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                            {record.booking_id ? `#${record.booking_id.slice(0, 8)}` : '-'}
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
