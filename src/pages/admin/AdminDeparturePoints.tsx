import React, { useState, useEffect } from 'react';
import { MapPin, Search, Plus, Edit2, Trash2, ExternalLink, Eye, AlertCircle, Check, X, Save } from 'lucide-react';
import { supabase } from '../../lib/supabase';

interface DeparturePoint {
  id: string;
  name: string;
  city: string;
  municipality: string;
  google_maps_url?: string;
  usage_count: number;
  is_active: boolean;
  created_at: string;
  created_by?: string;
}

interface ToursUsingPoint {
  tour_id: string;
  tour_name: string;
  agency_name: string;
  display_order: number;
}

const AdminDeparturePoints: React.FC = () => {
  const [departurePoints, setDeparturePoints] = useState<DeparturePoint[]>([]);
  const [filteredPoints, setFilteredPoints] = useState<DeparturePoint[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [filterStatus, setFilterStatus] = useState<'all' | 'active' | 'inactive'>('all');
  const [isLoading, setIsLoading] = useState(true);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [isAddingNew, setIsAddingNew] = useState(false);
  const [viewingPointId, setViewingPointId] = useState<string | null>(null);
  const [toursUsingPoint, setToursUsingPoint] = useState<ToursUsingPoint[]>([]);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [formData, setFormData] = useState({
    name: '',
    city: '',
    municipality: '',
    google_maps_url: '',
    is_active: true
  });

  useEffect(() => {
    fetchDeparturePoints();
  }, []);

  useEffect(() => {
    filterPoints();
  }, [searchQuery, filterStatus, departurePoints]);

  const fetchDeparturePoints = async () => {
    setIsLoading(true);
    setError('');

    try {
      const { data, error: fetchError } = await supabase
        .from('departure_points')
        .select('*')
        .order('usage_count', { ascending: false });

      if (fetchError) throw fetchError;

      setDeparturePoints(data || []);
    } catch (err: any) {
      console.error('Error fetching departure points:', err);
      setError(err.message || 'Error al cargar los puntos de salida');
    } finally {
      setIsLoading(false);
    }
  };

  const filterPoints = () => {
    let filtered = [...departurePoints];

    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      filtered = filtered.filter(point =>
        point.name.toLowerCase().includes(query) ||
        point.city.toLowerCase().includes(query) ||
        point.municipality.toLowerCase().includes(query)
      );
    }

    if (filterStatus !== 'all') {
      filtered = filtered.filter(point =>
        filterStatus === 'active' ? point.is_active : !point.is_active
      );
    }

    setFilteredPoints(filtered);
  };

  const handleViewTours = async (pointId: string) => {
    setViewingPointId(pointId);
    try {
      const { data, error } = await supabase
        .from('tour_departure_points')
        .select(`
          tour_id,
          display_order,
          tours(name),
          tours:tour_id(agency_id),
          agencies(name)
        `)
        .eq('departure_point_id', pointId);

      if (error) throw error;

      const processed = (data || []).map((item: any) => ({
        tour_id: item.tour_id,
        tour_name: item.tours?.name || 'Sin nombre',
        agency_name: item.agencies?.name || 'Sin agencia',
        display_order: item.display_order
      }));

      setToursUsingPoint(processed);
    } catch (err: any) {
      console.error('Error fetching tours for point:', err);
      alert('Error al cargar los tours que usan este punto');
    }
  };

  const handleEdit = (point: DeparturePoint) => {
    setEditingId(point.id);
    setFormData({
      name: point.name,
      city: point.city,
      municipality: point.municipality,
      google_maps_url: point.google_maps_url || '',
      is_active: point.is_active
    });
    setIsAddingNew(false);
  };

  const handleCancelEdit = () => {
    setEditingId(null);
    setIsAddingNew(false);
    setFormData({
      name: '',
      city: '',
      municipality: '',
      google_maps_url: '',
      is_active: true
    });
  };

  const handleAddNew = () => {
    setIsAddingNew(true);
    setEditingId(null);
    setFormData({
      name: '',
      city: '',
      municipality: '',
      google_maps_url: '',
      is_active: true
    });
  };

  const handleSave = async () => {
    try {
      setError('');
      setSuccess('');

      if (!formData.name.trim() || !formData.city.trim() || !formData.municipality.trim()) {
        setError('El nombre, ciudad y municipio son obligatorios');
        return;
      }

      if (isAddingNew) {
        const { error: insertError } = await supabase
          .from('departure_points')
          .insert({
            name: formData.name.trim(),
            city: formData.city.trim(),
            municipality: formData.municipality.trim(),
            google_maps_url: formData.google_maps_url.trim() || null,
            is_active: formData.is_active
          });

        if (insertError) throw insertError;
        setSuccess('Punto de partida creado exitosamente');
      } else if (editingId) {
        const { error: updateError } = await supabase
          .from('departure_points')
          .update({
            name: formData.name.trim(),
            city: formData.city.trim(),
            municipality: formData.municipality.trim(),
            google_maps_url: formData.google_maps_url.trim() || null,
            is_active: formData.is_active,
            updated_at: new Date().toISOString()
          })
          .eq('id', editingId);

        if (updateError) throw updateError;
        setSuccess('Punto de partida actualizado exitosamente');
      }

      handleCancelEdit();
      fetchDeparturePoints();
    } catch (err: any) {
      console.error('Error saving departure point:', err);
      setError(err.message || 'Error al guardar el punto de partida');
    }
  };

  const handleToggleActive = async (pointId: string, currentStatus: boolean) => {
    try {
      const { error } = await supabase
        .from('departure_points')
        .update({ is_active: !currentStatus })
        .eq('id', pointId);

      if (error) throw error;

      await fetchDeparturePoints();
    } catch (err: any) {
      console.error('Error toggling point status:', err);
      alert(err.message || 'Error al cambiar el estado del punto');
    }
  };

  const handleDelete = async (point: DeparturePoint) => {
    if (point.usage_count > 0) {
      alert('No puedes eliminar un punto que está siendo usado por tours. Primero desactívalo.');
      return;
    }

    if (!confirm(`¿Estás seguro de que quieres eliminar "${point.name}"? Esta acción no se puede deshacer.`)) {
      return;
    }

    try {
      const { error } = await supabase
        .from('departure_points')
        .delete()
        .eq('id', point.id);

      if (error) throw error;

      await fetchDeparturePoints();
    } catch (err: any) {
      console.error('Error deleting point:', err);
      alert(err.message || 'Error al eliminar el punto');
    }
  };

  const getStats = () => {
    return {
      total: departurePoints.length,
      active: departurePoints.filter(p => p.is_active).length,
      inactive: departurePoints.filter(p => !p.is_active).length,
      mostUsed: departurePoints.length > 0
        ? departurePoints.reduce((prev, current) =>
            prev.usage_count > current.usage_count ? prev : current
          )
        : null,
      unused: departurePoints.filter(p => p.usage_count === 0).length,
    };
  };

  const stats = getStats();

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
      <div className="flex flex-col md:flex-row md:items-center md:justify-between mb-6">
        <div>
          <h1 className="text-3xl font-bold flex items-center gap-3">
            <MapPin className="w-8 h-8 text-primary-600" />
            Puntos de Salida
          </h1>
          <p className="text-gray-600 mt-1">
            Administra el catálogo de puntos de salida del sistema
          </p>
        </div>
        <button
          onClick={handleAddNew}
          disabled={isAddingNew}
          className="inline-flex items-center px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-primary-600 hover:bg-primary-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-500 disabled:opacity-50 disabled:cursor-not-allowed mt-4 md:mt-0"
        >
          <Plus className="w-5 h-5 mr-2" />
          Nuevo Punto
        </button>
      </div>

      {error && (
        <div className="mb-6 bg-error-50 border border-error-200 rounded-lg p-4 flex items-start gap-3">
          <AlertCircle className="w-5 h-5 text-error-600 flex-shrink-0 mt-0.5" />
          <p className="text-sm text-error-800">{error}</p>
        </div>
      )}

      {success && (
        <div className="mb-6 bg-success-50 text-success-700 p-4 rounded-md">
          {success}
        </div>
      )}

      {isAddingNew && (
        <div className="bg-white rounded-lg shadow-md p-6 mb-6 border-2 border-primary-500">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">Nuevo Punto de Partida</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Nombre del Punto <span className="text-error-600">*</span>
              </label>
              <input
                type="text"
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                placeholder="ej. Monumento a la Revolución"
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-primary-500 focus:border-primary-500"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Ciudad <span className="text-error-600">*</span>
              </label>
              <input
                type="text"
                value={formData.city}
                onChange={(e) => setFormData({ ...formData, city: e.target.value })}
                placeholder="ej. Ciudad de México"
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-primary-500 focus:border-primary-500"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Municipio/Alcaldía <span className="text-error-600">*</span>
              </label>
              <input
                type="text"
                value={formData.municipality}
                onChange={(e) => setFormData({ ...formData, municipality: e.target.value })}
                placeholder="ej. Cuauhtémoc"
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-primary-500 focus:border-primary-500"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                URL de Google Maps
              </label>
              <input
                type="url"
                value={formData.google_maps_url}
                onChange={(e) => setFormData({ ...formData, google_maps_url: e.target.value })}
                placeholder="https://maps.app.goo.gl/..."
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-primary-500 focus:border-primary-500"
              />
            </div>

            <div className="flex items-center">
              <input
                type="checkbox"
                id="new-is-active"
                checked={formData.is_active}
                onChange={(e) => setFormData({ ...formData, is_active: e.target.checked })}
                className="h-4 w-4 text-primary-600 focus:ring-primary-500 border-gray-300 rounded"
              />
              <label htmlFor="new-is-active" className="ml-2 block text-sm text-gray-900">
                Activo
              </label>
            </div>
          </div>

          <div className="mt-4 flex justify-end space-x-3">
            <button
              onClick={handleCancelEdit}
              className="px-4 py-2 border border-gray-300 rounded-md text-sm font-medium text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-500"
            >
              <X className="h-4 w-4 inline mr-1" />
              Cancelar
            </button>
            <button
              onClick={handleSave}
              className="px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-primary-600 hover:bg-primary-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-500"
            >
              <Save className="h-4 w-4 inline mr-1" />
              Guardar
            </button>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
        <div className="bg-white rounded-lg shadow-md p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-600">Total de Puntos</p>
              <p className="text-3xl font-bold text-gray-900">{stats.total}</p>
            </div>
            <MapPin className="w-12 h-12 text-blue-500 opacity-20" />
          </div>
        </div>

        <div className="bg-white rounded-lg shadow-md p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-600">Activos</p>
              <p className="text-3xl font-bold text-success-600">{stats.active}</p>
            </div>
            <Check className="w-12 h-12 text-success-500 opacity-20" />
          </div>
        </div>

        <div className="bg-white rounded-lg shadow-md p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-600">Sin Usar</p>
              <p className="text-3xl font-bold text-gray-600">{stats.unused}</p>
            </div>
            <AlertCircle className="w-12 h-12 text-gray-400 opacity-20" />
          </div>
        </div>

        <div className="bg-white rounded-lg shadow-md p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-600">Más Usado</p>
              <p className="text-3xl font-bold text-primary-600">
                {stats.mostUsed ? stats.mostUsed.usage_count : 0}
              </p>
              {stats.mostUsed && (
                <p className="text-xs text-gray-500 mt-1 truncate">
                  {stats.mostUsed.name}
                </p>
              )}
            </div>
            <MapPin className="w-12 h-12 text-primary-500 opacity-20" />
          </div>
        </div>
      </div>

      <div className="bg-white rounded-lg shadow-md p-6 mb-6">
        <div className="flex flex-col md:flex-row gap-4">
          <div className="flex-1 relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-5 h-5 text-gray-400" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Buscar por nombre, ciudad o municipio..."
              className="input pl-10"
            />
          </div>

          <div className="flex gap-2">
            <button
              onClick={() => setFilterStatus('all')}
              className={`px-4 py-2 rounded-md font-medium transition-colors ${
                filterStatus === 'all'
                  ? 'bg-primary-600 text-white'
                  : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
              }`}
            >
              Todos ({stats.total})
            </button>
            <button
              onClick={() => setFilterStatus('active')}
              className={`px-4 py-2 rounded-md font-medium transition-colors ${
                filterStatus === 'active'
                  ? 'bg-success-600 text-white'
                  : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
              }`}
            >
              Activos ({stats.active})
            </button>
            <button
              onClick={() => setFilterStatus('inactive')}
              className={`px-4 py-2 rounded-md font-medium transition-colors ${
                filterStatus === 'inactive'
                  ? 'bg-error-600 text-white'
                  : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
              }`}
            >
              Inactivos ({stats.inactive})
            </button>
          </div>
        </div>
      </div>

      {filteredPoints.length === 0 ? (
        <div className="bg-white rounded-lg shadow-md p-12 text-center">
          <MapPin className="w-16 h-16 text-gray-300 mx-auto mb-4" />
          <h3 className="text-xl font-semibold text-gray-900 mb-2">
            No se encontraron puntos
          </h3>
          <p className="text-gray-600">
            {searchQuery
              ? 'Intenta ajustar tu búsqueda'
              : 'Comienza creando el primer punto de salida'}
          </p>
        </div>
      ) : (
        <div className="bg-white rounded-lg shadow-md overflow-hidden">
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Punto de Salida
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Ubicación
                  </th>
                  <th className="px-6 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Tours
                  </th>
                  <th className="px-6 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Estado
                  </th>
                  <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Acciones
                  </th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {filteredPoints.map((point) => (
                  <React.Fragment key={point.id}>
                    {editingId === point.id ? (
                      <tr className="bg-blue-50">
                        <td colSpan={5} className="px-6 py-4">
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <div>
                              <label className="block text-sm font-medium text-gray-700 mb-1">
                                Nombre <span className="text-error-600">*</span>
                              </label>
                              <input
                                type="text"
                                value={formData.name}
                                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-primary-500 focus:border-primary-500"
                              />
                            </div>

                            <div>
                              <label className="block text-sm font-medium text-gray-700 mb-1">
                                Ciudad <span className="text-error-600">*</span>
                              </label>
                              <input
                                type="text"
                                value={formData.city}
                                onChange={(e) => setFormData({ ...formData, city: e.target.value })}
                                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-primary-500 focus:border-primary-500"
                              />
                            </div>

                            <div>
                              <label className="block text-sm font-medium text-gray-700 mb-1">
                                Municipio <span className="text-error-600">*</span>
                              </label>
                              <input
                                type="text"
                                value={formData.municipality}
                                onChange={(e) => setFormData({ ...formData, municipality: e.target.value })}
                                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-primary-500 focus:border-primary-500"
                              />
                            </div>

                            <div>
                              <label className="block text-sm font-medium text-gray-700 mb-1">
                                URL de Google Maps
                              </label>
                              <input
                                type="url"
                                value={formData.google_maps_url}
                                onChange={(e) => setFormData({ ...formData, google_maps_url: e.target.value })}
                                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-primary-500 focus:border-primary-500"
                              />
                            </div>

                            <div className="flex items-center">
                              <input
                                type="checkbox"
                                id={`edit-is-active-${point.id}`}
                                checked={formData.is_active}
                                onChange={(e) => setFormData({ ...formData, is_active: e.target.checked })}
                                className="h-4 w-4 text-primary-600 focus:ring-primary-500 border-gray-300 rounded"
                              />
                              <label htmlFor={`edit-is-active-${point.id}`} className="ml-2 block text-sm text-gray-900">
                                Activo
                              </label>
                            </div>
                          </div>

                          <div className="mt-4 flex justify-end space-x-3">
                            <button
                              onClick={handleCancelEdit}
                              className="px-4 py-2 border border-gray-300 rounded-md text-sm font-medium text-gray-700 bg-white hover:bg-gray-50"
                            >
                              <X className="h-4 w-4 inline mr-1" />
                              Cancelar
                            </button>
                            <button
                              onClick={handleSave}
                              className="px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-primary-600 hover:bg-primary-700"
                            >
                              <Save className="h-4 w-4 inline mr-1" />
                              Guardar Cambios
                            </button>
                          </div>
                        </td>
                      </tr>
                    ) : (
                      <tr className="hover:bg-gray-50">
                        <td className="px-6 py-4">
                      <div className="flex items-start gap-3">
                        <MapPin className="w-5 h-5 text-primary-600 flex-shrink-0 mt-1" />
                        <div>
                          <p className="font-medium text-gray-900">{point.name}</p>
                          {point.google_maps_url && (
                            <a
                              href={point.google_maps_url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-xs text-blue-600 hover:text-blue-700 flex items-center gap-1 mt-1"
                            >
                              Ver en Google Maps <ExternalLink className="w-3 h-3" />
                            </a>
                          )}
                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <p className="text-sm text-gray-900">{point.city}</p>
                      <p className="text-xs text-gray-500">{point.municipality}</p>
                    </td>
                    <td className="px-6 py-4 text-center">
                      <button
                        onClick={() => handleViewTours(point.id)}
                        className={`inline-flex items-center gap-1 px-3 py-1 rounded-full text-sm font-medium ${
                          point.usage_count > 0
                            ? 'bg-blue-100 text-blue-800 hover:bg-blue-200 cursor-pointer'
                            : 'bg-gray-100 text-gray-600'
                        }`}
                        disabled={point.usage_count === 0}
                      >
                        {point.usage_count}
                        {point.usage_count > 0 && <Eye className="w-3 h-3" />}
                      </button>
                    </td>
                    <td className="px-6 py-4 text-center">
                      <button
                        onClick={() => handleToggleActive(point.id, point.is_active)}
                        className={`inline-flex items-center gap-1 px-3 py-1 rounded-full text-xs font-medium ${
                          point.is_active
                            ? 'bg-success-100 text-success-800'
                            : 'bg-error-100 text-error-800'
                        }`}
                      >
                        {point.is_active ? 'Activo' : 'Inactivo'}
                      </button>
                    </td>
                    <td className="px-6 py-4 text-right">
                      <div className="flex items-center justify-end gap-2">
                        <button
                          onClick={() => handleEdit(point)}
                          className="p-2 text-primary-600 hover:bg-primary-50 rounded-md transition-colors"
                          title="Editar"
                        >
                          <Edit2 className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => handleToggleActive(point.id, point.is_active)}
                          className={`p-2 rounded-md transition-colors ${
                            point.is_active
                              ? 'text-error-600 hover:bg-error-50'
                              : 'text-success-600 hover:bg-success-50'
                          }`}
                          title={point.is_active ? 'Desactivar' : 'Activar'}
                        >
                          {point.is_active ? <X className="w-4 h-4" /> : <Check className="w-4 h-4" />}
                        </button>
                        <button
                          onClick={() => handleDelete(point)}
                          className="p-2 text-error-600 hover:bg-error-50 rounded-md transition-colors disabled:text-gray-300 disabled:cursor-not-allowed"
                          title={point.usage_count > 0 ? 'No se puede eliminar (en uso)' : 'Eliminar'}
                          disabled={point.usage_count > 0}
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                    )}
                  </React.Fragment>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {viewingPointId && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg shadow-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
            <div className="sticky top-0 bg-white border-b border-gray-200 px-6 py-4 flex items-center justify-between">
              <h2 className="text-xl font-semibold">Tours que usan este punto</h2>
              <button
                onClick={() => setViewingPointId(null)}
                className="p-2 hover:bg-gray-100 rounded-full transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-6">
              {toursUsingPoint.length === 0 ? (
                <p className="text-gray-600 text-center py-8">
                  Este punto no está siendo usado por ningún tour
                </p>
              ) : (
                <div className="space-y-3">
                  {toursUsingPoint.map((tour) => (
                    <div key={tour.tour_id} className="border border-gray-200 rounded-lg p-4">
                      <div className="flex items-start gap-3">
                        <div className="flex-shrink-0 w-8 h-8 bg-primary-600 text-white rounded-full flex items-center justify-center font-semibold">
                          {tour.display_order}
                        </div>
                        <div className="flex-1">
                          <p className="font-medium text-gray-900">{tour.tour_name}</p>
                          <p className="text-sm text-gray-600">{tour.agency_name}</p>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default AdminDeparturePoints;
