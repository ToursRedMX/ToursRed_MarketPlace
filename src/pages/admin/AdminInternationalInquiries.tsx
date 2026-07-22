import React, { useState, useEffect } from 'react';
import { supabase } from '../../lib/supabase';
import { Search, Filter, X, Mail, Phone, Calendar, Users, MapPin, MessageSquare, ExternalLink, TrendingUp, Clock, CheckCircle, Hash } from 'lucide-react';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';

interface Inquiry {
  id: string;
  user_id: string | null;
  name: string;
  email: string;
  phone: string;
  destination: string;
  travel_date: string | null;
  num_people: number;
  tour_code: string | null;
  message: string | null;
  source: string;
  status: 'pending' | 'contacted' | 'converted' | 'no_convertido';
  created_at: string;
  updated_at: string;
}

interface Stats {
  total: number;
  pending: number;
  contacted: number;
  converted: number;
  noConvertido: number;
  conversionRate: number;
  topDestinations: { destination: string; count: number }[];
}

const AdminInternationalInquiries: React.FC = () => {
  const [inquiries, setInquiries] = useState<Inquiry[]>([]);
  const [filteredInquiries, setFilteredInquiries] = useState<Inquiry[]>([]);
  const [stats, setStats] = useState<Stats>({
    total: 0,
    pending: 0,
    contacted: 0,
    converted: 0,
    noConvertido: 0,
    conversionRate: 0,
    topDestinations: []
  });
  const [isLoading, setIsLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [sourceFilter, setSourceFilter] = useState<string>('all');
  const [selectedInquiry, setSelectedInquiry] = useState<Inquiry | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);

  useEffect(() => {
    fetchInquiries();
  }, []);

  useEffect(() => {
    filterInquiries();
  }, [inquiries, searchTerm, statusFilter, sourceFilter]);

  const fetchInquiries = async () => {
    setIsLoading(true);
    try {
      const { data, error } = await supabase
        .from('international_tour_inquiries')
        .select('*')
        .order('created_at', { ascending: false });

      if (error) throw error;

      setInquiries(data || []);
      calculateStats(data || []);
    } catch (error) {
      console.error('Error fetching inquiries:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const calculateStats = (data: Inquiry[]) => {
    const total = data.length;
    const pending = data.filter(i => i.status === 'pending').length;
    const contacted = data.filter(i => i.status === 'contacted').length;
    const converted = data.filter(i => i.status === 'converted').length;
    const noConvertido = data.filter(i => i.status === 'no_convertido').length;

    const totalResolved = converted + noConvertido;
    const conversionRate = totalResolved > 0 ? (converted / totalResolved) * 100 : 0;

    const destinationCounts = data.reduce((acc, inquiry) => {
      acc[inquiry.destination] = (acc[inquiry.destination] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);

    const topDestinations = Object.entries(destinationCounts)
      .map(([destination, count]) => ({ destination, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);

    setStats({
      total,
      pending,
      contacted,
      converted,
      noConvertido,
      conversionRate,
      topDestinations
    });
  };

  const filterInquiries = () => {
    let filtered = [...inquiries];

    if (searchTerm) {
      filtered = filtered.filter(
        inquiry =>
          inquiry.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
          inquiry.email.toLowerCase().includes(searchTerm.toLowerCase()) ||
          inquiry.destination.toLowerCase().includes(searchTerm.toLowerCase())
      );
    }

    if (statusFilter !== 'all') {
      filtered = filtered.filter(inquiry => inquiry.status === statusFilter);
    }

    if (sourceFilter !== 'all') {
      filtered = filtered.filter(inquiry => inquiry.source === sourceFilter);
    }

    setFilteredInquiries(filtered);
  };

  const updateStatus = async (inquiryId: string, newStatus: 'pending' | 'contacted' | 'converted' | 'no_convertido') => {
    try {
      const { error } = await supabase
        .from('international_tour_inquiries')
        .update({ status: newStatus })
        .eq('id', inquiryId);

      if (error) throw error;

      setInquiries(prev =>
        prev.map(inquiry =>
          inquiry.id === inquiryId ? { ...inquiry, status: newStatus } : inquiry
        )
      );

      if (selectedInquiry?.id === inquiryId) {
        setSelectedInquiry(prev => prev ? { ...prev, status: newStatus } : null);
      }

      calculateStats(inquiries.map(inquiry =>
        inquiry.id === inquiryId ? { ...inquiry, status: newStatus } : inquiry
      ));
    } catch (error) {
      console.error('Error updating status:', error);
      alert('Error al actualizar el estado');
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'pending':
        return 'bg-yellow-100 text-yellow-800';
      case 'contacted':
        return 'bg-blue-100 text-blue-800';
      case 'converted':
        return 'bg-green-100 text-green-800';
      case 'no_convertido':
        return 'bg-red-100 text-red-800';
      default:
        return 'bg-gray-100 text-gray-800';
    }
  };

  const getStatusLabel = (status: string) => {
    switch (status) {
      case 'pending':
        return 'Pendiente';
      case 'contacted':
        return 'Contactado';
      case 'converted':
        return 'Convertido';
      case 'no_convertido':
        return 'No Convertido';
      default:
        return status;
    }
  };

  const getSourceLabel = (source: string) => {
    switch (source) {
      case 'mega_travel':
        return 'Mega Travel';
      case 'nefertari_travel':
        return 'Nefertari Travel';
      default:
        return source;
    }
  };

  const getSourceColor = (source: string) => {
    switch (source) {
      case 'mega_travel':
        return 'bg-primary-100 text-primary-800';
      case 'nefertari_travel':
        return 'bg-amber-100 text-amber-800';
      default:
        return 'bg-gray-100 text-gray-800';
    }
  };

  const getDestinationLabel = (inquiry: Inquiry) => {
    if (inquiry.source === 'nefertari_travel') return 'Nombre del Viaje';
    return 'Destino';
  };

  return (
    <div className="min-h-screen bg-gray-50 py-8">
      <div className="container-custom">
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-gray-900 mb-2">Cotizaciones Internacionales</h1>
          <p className="text-gray-600">Gestiona las solicitudes de cotización de tours internacionales</p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-6 gap-6 mb-8">
          <div className="bg-white rounded-lg shadow p-6">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm text-gray-600">Total</span>
              <MessageSquare className="h-5 w-5 text-gray-400" />
            </div>
            <p className="text-3xl font-bold text-gray-900">{stats.total}</p>
          </div>

          <div className="bg-white rounded-lg shadow p-6">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm text-gray-600">Pendientes</span>
              <Clock className="h-5 w-5 text-yellow-500" />
            </div>
            <p className="text-3xl font-bold text-yellow-600">{stats.pending}</p>
          </div>

          <div className="bg-white rounded-lg shadow p-6">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm text-gray-600">Contactados</span>
              <Phone className="h-5 w-5 text-blue-500" />
            </div>
            <p className="text-3xl font-bold text-blue-600">{stats.contacted}</p>
          </div>

          <div className="bg-white rounded-lg shadow p-6">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm text-gray-600">Convertidos</span>
              <CheckCircle className="h-5 w-5 text-green-500" />
            </div>
            <p className="text-3xl font-bold text-green-600">{stats.converted}</p>
          </div>

          <div className="bg-white rounded-lg shadow p-6">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm text-gray-600">No Convertidos</span>
              <X className="h-5 w-5 text-red-500" />
            </div>
            <p className="text-3xl font-bold text-red-600">{stats.noConvertido}</p>
          </div>

          <div className="bg-white rounded-lg shadow p-6">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm text-gray-600">Tasa Conversión</span>
              <TrendingUp className="h-5 w-5 text-primary-500" />
            </div>
            <p className="text-3xl font-bold text-primary-600">{stats.conversionRate.toFixed(1)}%</p>
          </div>
        </div>

        {stats.topDestinations.length > 0 && (
          <div className="bg-white rounded-lg shadow p-6 mb-8">
            <h2 className="text-lg font-semibold text-gray-900 mb-4">Destinos Más Solicitados</h2>
            <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
              {stats.topDestinations.map((dest, index) => (
                <div key={dest.destination} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                  <div className="flex items-center space-x-2">
                    <span className="flex items-center justify-center w-6 h-6 bg-primary-100 text-primary-600 rounded-full text-sm font-bold">
                      {index + 1}
                    </span>
                    <span className="text-sm font-medium text-gray-700">{dest.destination}</span>
                  </div>
                  <span className="text-sm font-bold text-primary-600">{dest.count}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="bg-white rounded-lg shadow">
          <div className="p-6 border-b border-gray-200">
            <div className="flex flex-col md:flex-row md:items-center md:justify-between space-y-4 md:space-y-0">
              <div className="flex-1 max-w-lg">
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-5 w-5 text-gray-400" />
                  <input
                    type="text"
                    placeholder="Buscar por nombre, email o destino..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-md focus:ring-primary-500 focus:border-primary-500"
                  />
                </div>
              </div>

              <div className="flex items-center space-x-4">
                <div className="flex items-center space-x-2">
                  <Filter className="h-5 w-5 text-gray-400" />
                  <select
                    value={statusFilter}
                    onChange={(e) => setStatusFilter(e.target.value)}
                    className="border border-gray-300 rounded-md px-3 py-2 focus:ring-primary-500 focus:border-primary-500"
                  >
                    <option value="all">Todos los estados</option>
                    <option value="pending">Pendientes</option>
                    <option value="contacted">Contactados</option>
                    <option value="converted">Convertidos</option>
                    <option value="no_convertido">No Convertidos</option>
                  </select>
                </div>

                <select
                  value={sourceFilter}
                  onChange={(e) => setSourceFilter(e.target.value)}
                  className="border border-gray-300 rounded-md px-3 py-2 focus:ring-primary-500 focus:border-primary-500"
                >
                  <option value="all">Todas las fuentes</option>
                  <option value="mega_travel">Mega Travel</option>
                  <option value="nefertari_travel">Nefertari Travel</option>
                </select>
              </div>
            </div>
          </div>

          <div className="overflow-x-auto">
            {isLoading ? (
              <div className="p-12 text-center">
                <p className="text-gray-500">Cargando cotizaciones...</p>
              </div>
            ) : filteredInquiries.length === 0 ? (
              <div className="p-12 text-center">
                <MessageSquare className="h-12 w-12 text-gray-300 mx-auto mb-4" />
                <p className="text-gray-500">No se encontraron cotizaciones</p>
              </div>
            ) : (
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Fecha
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Viajero
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Destino
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Personas
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Fuente
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
                  {filteredInquiries.map((inquiry) => (
                    <tr key={inquiry.id} className="hover:bg-gray-50">
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                        {format(new Date(inquiry.created_at), 'dd MMM yyyy', { locale: es })}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="text-sm font-medium text-gray-900">{inquiry.name}</div>
                        <div className="text-sm text-gray-500">{inquiry.email}</div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="text-sm text-gray-900">{inquiry.destination}</div>
                        {inquiry.tour_code && (
                          <div className="text-xs font-bold text-accent-600 mt-0.5">{inquiry.tour_code}</div>
                        )}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                        {inquiry.num_people}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <span className={`px-2 py-1 text-xs font-medium rounded-full ${getSourceColor(inquiry.source)}`}>
                          {getSourceLabel(inquiry.source)}
                        </span>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <select
                          value={inquiry.status}
                          onChange={(e) => updateStatus(inquiry.id, e.target.value as any)}
                          className={`text-xs font-medium rounded-full px-3 py-1 ${getStatusColor(inquiry.status)}`}
                        >
                          <option value="pending">Pendiente</option>
                          <option value="contacted">Contactado</option>
                          <option value="converted">Convertido</option>
                          <option value="no_convertido">No Convertido</option>
                        </select>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                        <button
                          onClick={() => {
                            setSelectedInquiry(inquiry);
                            setIsModalOpen(true);
                          }}
                          className="text-primary-600 hover:text-primary-900 mr-4"
                        >
                          Ver detalles
                        </button>
                        <a
                          href={`mailto:${inquiry.email}`}
                          className="text-accent-600 hover:text-accent-900"
                        >
                          Responder
                        </a>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </div>

      {isModalOpen && selectedInquiry && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-lg max-w-2xl w-full max-h-[90vh] overflow-y-auto">
            <div className="sticky top-0 bg-white border-b border-gray-200 px-6 py-4 flex items-center justify-between">
              <h2 className="text-2xl font-bold text-gray-900">Detalles de Cotización</h2>
              <button
                onClick={() => setIsModalOpen(false)}
                className="text-gray-400 hover:text-gray-600"
              >
                <X className="h-6 w-6" />
              </button>
            </div>

            <div className="p-6">
              <div className="mb-6">
                <span className={`inline-block px-3 py-1 text-sm font-medium rounded-full ${getStatusColor(selectedInquiry.status)}`}>
                  {getStatusLabel(selectedInquiry.status)}
                </span>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
                <div>
                  <h3 className="text-sm font-medium text-gray-500 mb-2">Información del Viajero</h3>
                  <div className="space-y-3">
                    <div className="flex items-start space-x-2">
                      <Users className="h-5 w-5 text-gray-400 mt-0.5" />
                      <div>
                        <p className="text-sm text-gray-500">Nombre</p>
                        <p className="font-medium">{selectedInquiry.name}</p>
                      </div>
                    </div>
                    <div className="flex items-start space-x-2">
                      <Mail className="h-5 w-5 text-gray-400 mt-0.5" />
                      <div>
                        <p className="text-sm text-gray-500">Email</p>
                        <a href={`mailto:${selectedInquiry.email}`} className="font-medium text-primary-600 hover:underline">
                          {selectedInquiry.email}
                        </a>
                      </div>
                    </div>
                    <div className="flex items-start space-x-2">
                      <Phone className="h-5 w-5 text-gray-400 mt-0.5" />
                      <div>
                        <p className="text-sm text-gray-500">Teléfono</p>
                        <a href={`tel:${selectedInquiry.phone}`} className="font-medium text-primary-600 hover:underline">
                          {selectedInquiry.phone}
                        </a>
                      </div>
                    </div>
                  </div>
                </div>

                <div>
                  <h3 className="text-sm font-medium text-gray-500 mb-2">Detalles del Viaje</h3>
                  <div className="space-y-3">
                    <div className="flex items-start space-x-2">
                      <MapPin className="h-5 w-5 text-gray-400 mt-0.5" />
                      <div>
                        <p className="text-sm text-gray-500">{getDestinationLabel(selectedInquiry)}</p>
                        <p className="font-medium">{selectedInquiry.destination}</p>
                      </div>
                    </div>
                    {selectedInquiry.tour_code && (
                      <div className="flex items-start space-x-2">
                        <Hash className="h-5 w-5 text-accent-500 mt-0.5" />
                        <div>
                          <p className="text-sm text-gray-500">Código de Viaje</p>
                          <p className="font-bold text-accent-600 text-lg">{selectedInquiry.tour_code}</p>
                        </div>
                      </div>
                    )}
                    <div className="flex items-start space-x-2">
                      <Calendar className="h-5 w-5 text-gray-400 mt-0.5" />
                      <div>
                        <p className="text-sm text-gray-500">Fecha Aproximada</p>
                        <p className="font-medium">
                          {selectedInquiry.travel_date
                            ? format(new Date(selectedInquiry.travel_date), 'dd MMMM yyyy', { locale: es })
                            : 'No especificada'}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-start space-x-2">
                      <Users className="h-5 w-5 text-gray-400 mt-0.5" />
                      <div>
                        <p className="text-sm text-gray-500">Número de Personas</p>
                        <p className="font-medium">{selectedInquiry.num_people}</p>
                      </div>
                    </div>
                    <div className="flex items-start space-x-2">
                      <ExternalLink className="h-5 w-5 text-gray-400 mt-0.5" />
                      <div>
                        <p className="text-sm text-gray-500">Fuente</p>
                        <p className="font-medium">{getSourceLabel(selectedInquiry.source)}</p>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {selectedInquiry.message && (
                <div className="mb-6">
                  <h3 className="text-sm font-medium text-gray-500 mb-2">Mensaje/Comentarios</h3>
                  <div className="bg-gray-50 rounded-lg p-4 border border-gray-200">
                    <p className="text-gray-700 whitespace-pre-wrap">{selectedInquiry.message}</p>
                  </div>
                </div>
              )}

              <div className="border-t border-gray-200 pt-4">
                <p className="text-xs text-gray-500">
                  Recibida el {format(new Date(selectedInquiry.created_at), "dd 'de' MMMM 'de' yyyy 'a las' HH:mm", { locale: es })}
                </p>
                <p className="text-xs text-gray-500 mt-1">
                  ID: {selectedInquiry.id}
                </p>
              </div>

              <div className="mt-6 flex justify-end space-x-4">
                <button
                  onClick={() => setIsModalOpen(false)}
                  className="px-6 py-2 border border-gray-300 rounded-md text-gray-700 hover:bg-gray-50"
                >
                  Cerrar
                </button>
                <a
                  href={`mailto:${selectedInquiry.email}?subject=Re: Cotización ${selectedInquiry.destination}`}
                  className="px-6 py-2 bg-primary-600 text-white rounded-md hover:bg-primary-700 inline-flex items-center space-x-2"
                >
                  <Mail className="h-5 w-5" />
                  <span>Responder al Viajero</span>
                </a>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default AdminInternationalInquiries;
