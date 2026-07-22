import React, { useState, useEffect } from 'react';
import { MapPin, Plus, Edit, Trash2, Image, Globe, Clock, Search, Filter, Eye, EyeOff, Save, X, Upload, AlertTriangle, Calendar, User } from 'lucide-react';
import { getAllDestinations, createDestination, updateDestination, deleteDestination, addDestinationImage, deleteDestinationImage, supabase } from '../../lib/supabase';
import { Destination, DestinationImage } from '../../types';
import { format } from 'date-fns';
import ImageUploader from '../../components/ImageUploader';

const AdminDestinations: React.FC = () => {
  const [destinations, setDestinations] = useState<Destination[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'inactive'>('all');
  const [isCreating, setIsCreating] = useState(false);
  const [editingDestination, setEditingDestination] = useState<Destination | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [deletingDestination, setDeletingDestination] = useState<string | null>(null);

  const [formData, setFormData] = useState({
    name: '',
    description: '',
    country: 'México',
    region: '',
    best_time_to_visit: '',
    average_temperature: '',
    currency: 'MXN',
    language: 'Español',
    time_zone: 'America/Mexico_City',
    main_image_url: ''
  });

  const [newImageUrl, setNewImageUrl] = useState('');
  const [newImageCaption, setNewImageCaption] = useState('');

  useEffect(() => {
    fetchDestinations();
  }, []);

  const fetchDestinations = async () => {
    try {
      setIsLoading(true);
      setError('');
      
      console.log('🌍 Cargando destinos desde la BD...');
      
      const { data, error } = await getAllDestinations();
      
      if (error) {
        throw new Error(error.message);
      }
      
      console.log('✅ Destinos cargados:', data);
      setDestinations(data || []);
    } catch (err: any) {
      console.error('❌ Error cargando destinos:', err);
      setError(err.message || 'Error al cargar destinos');
    } finally {
      setIsLoading(false);
    }
  };

  const resetForm = () => {
    setFormData({
      name: '',
      description: '',
      country: 'México',
      region: '',
      best_time_to_visit: '',
      average_temperature: '',
      currency: 'MXN',
      language: 'Español',
      time_zone: 'America/Mexico_City',
      main_image_url: ''
    });
    setNewImageCaption('');
  };

  const handleCreate = () => {
    resetForm();
    setIsCreating(true);
    setEditingDestination(null);
  };

  const handleEdit = (destination: Destination) => {
    setFormData({
      name: destination.name || '',
      description: destination.description || '',
      country: destination.country || 'México',
      region: destination.region || '',
      best_time_to_visit: destination.best_time_to_visit || '',
      average_temperature: destination.average_temperature || '',
      currency: destination.currency || 'MXN',
      language: destination.language || 'Español',
      time_zone: destination.time_zone || 'America/Mexico_City',
      main_image_url: destination.main_image_url || ''
    });
    setEditingDestination(destination);
    setIsCreating(false);
  };

  const handleCancel = () => {
    setIsCreating(false);
    setEditingDestination(null);
    resetForm();
    setError('');
  };

  const handleMainImageSelect = (publicUrl: string, _type: string, _size: number) => {
    setFormData({
      ...formData,
      main_image_url: publicUrl
    });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    setError('');

    try {
      if (!formData.name.trim()) {
        throw new Error('El nombre del destino es obligatorio');
      }

      const destinationData: any = {
        name: formData.name.trim(),
        description: formData.description || null,
        country: formData.country || null,
        region: formData.region || null,
        best_time_to_visit: formData.best_time_to_visit || null,
        average_temperature: formData.average_temperature || null,
        currency: formData.currency || null,
        language: formData.language || null,
        time_zone: formData.time_zone || null,
        is_active: true
      };

      if (formData.main_image_url) {
        destinationData.main_image_url = formData.main_image_url;
      }

      if (editingDestination) {
        const { error } = await updateDestination(editingDestination.id, destinationData);
        if (error) throw error;
        console.log('✅ Destino actualizado correctamente');
      } else {
        const { error } = await createDestination(destinationData);
        if (error) throw error;
        console.log('✅ Destino creado correctamente');
      }

      await fetchDestinations();
      handleCancel();
    } catch (err: any) {
      console.error('❌ Error guardando destino:', err);
      setError(err.message || 'Error al guardar destino');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDelete = async (destination: Destination) => {
    const tourCount = getTourCount(destination);
    
    if (tourCount > 0) {
      setError(`No se puede eliminar el destino "${destination.name}" porque tiene ${tourCount} ${tourCount === 1 ? 'tour asociado' : 'tours asociados'}. Elimina primero los tours que usan este destino.`);
      return;
    }

    if (!confirm(`¿Estás seguro de que quieres eliminar el destino "${destination.name}"?\n\nEsta acción eliminará:\n- El destino\n- Todas sus imágenes asociadas\n\nEsta acción NO se puede deshacer.`)) {
      return;
    }

    try {
      setDeletingDestination(destination.id);
      setError('');
      
      const { error } = await deleteDestination(destination.id);
      if (error) {
        throw new Error(error.message);
      }

      await fetchDestinations();
      console.log('✅ Destino eliminado correctamente');
    } catch (err: any) {
      console.error('❌ Error eliminando destino:', err);
      setError(err.message || 'Error al eliminar el destino');
    } finally {
      setDeletingDestination(null);
    }
  };

  const handleToggleStatus = async (destinationId: string, currentStatus: boolean) => {
    try {
      setIsSubmitting(true);
      setError('');

      const { error } = await updateDestination(destinationId, { 
        is_active: !currentStatus 
      });

      if (error) {
        throw new Error(error.message);
      }

      // Update local state
      setDestinations(destinations.map(dest => 
        dest.id === destinationId 
          ? { ...dest, is_active: !currentStatus }
          : dest
      ));

      console.log(`✅ Estado del destino actualizado a: ${!currentStatus}`);
    } catch (err: any) {
      console.error('❌ Error actualizando estado:', err);
      setError(err.message || 'Error al actualizar el estado del destino');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleAddImage = async (destinationId: string) => {
    if (!newImageUrl) return;

    try {
      setIsSubmitting(true);
      
      const imageData = {
        image_url: newImageUrl,
        caption: newImageCaption || null,
        is_featured: false
      };

      const { error } = await addDestinationImage(destinationId, imageData);
      if (error) throw error;

      await fetchDestinations();
      setNewImageUrl('');
      setNewImageCaption('');
    } catch (err: any) {
      setError(err.message || 'Error al agregar imagen');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDeleteImage = async (imageId: string) => {
    if (!confirm('¿Estás seguro de que quieres eliminar esta imagen?')) return;

    try {
      setIsSubmitting(true);
      
      const { error } = await deleteDestinationImage(imageId);
      if (error) throw error;

      await fetchDestinations();
    } catch (err: any) {
      setError(err.message || 'Error al eliminar imagen');
    } finally {
      setIsSubmitting(false);
    }
  };

  const getTourCount = (destination: Destination) => {
    return destination.tour_destinations?.length || 0;
  };

  const getStatusBadge = (isActive: boolean) => {
    if (isActive) {
      return (
        <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-success-100 text-success-800">
          <Eye className="h-3 w-3 mr-1" />
          Activo
        </span>
      );
    } else {
      return (
        <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-error-100 text-error-800">
          <EyeOff className="h-3 w-3 mr-1" />
          Inactivo
        </span>
      );
    }
  };

  const filteredDestinations = destinations.filter(destination => {
    const matchesSearch = 
      destination.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      (destination.description || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
      (destination.country || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
      (destination.region || '').toLowerCase().includes(searchTerm.toLowerCase());

    const matchesStatus = 
      statusFilter === 'all' ||
      (statusFilter === 'active' && destination.is_active) ||
      (statusFilter === 'inactive' && !destination.is_active);

    return matchesSearch && matchesStatus;
  });

  const stats = {
    total: destinations.length,
    active: destinations.filter(d => d.is_active).length,
    inactive: destinations.filter(d => !d.is_active).length,
    withTours: destinations.filter(d => getTourCount(d) > 0).length,
    totalTours: destinations.reduce((sum, d) => sum + getTourCount(d), 0),
    withImages: destinations.filter(d => (d.destination_images?.length || 0) > 0).length
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
          <h1 className="text-3xl font-bold text-gray-900">Gestión de Destinos</h1>
          <p className="text-gray-600 mt-1">
            Administra el catálogo completo de destinos de la plataforma
          </p>
        </div>
        <button
          onClick={handleCreate}
          className="btn btn-primary"
          disabled={isCreating || editingDestination}
        >
          <Plus className="h-5 w-5 mr-2" />
          Crear Destino
        </button>
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
          <div className="text-sm text-gray-500">Total Destinos</div>
        </div>
        <div className="bg-white rounded-lg shadow-md p-4">
          <div className="text-2xl font-bold text-success-600">{stats.active}</div>
          <div className="text-sm text-gray-500">Activos</div>
        </div>
        <div className="bg-white rounded-lg shadow-md p-4">
          <div className="text-2xl font-bold text-error-600">{stats.inactive}</div>
          <div className="text-sm text-gray-500">Inactivos</div>
        </div>
        <div className="bg-white rounded-lg shadow-md p-4">
          <div className="text-2xl font-bold text-blue-600">{stats.withTours}</div>
          <div className="text-sm text-gray-500">Con Tours</div>
        </div>
        <div className="bg-white rounded-lg shadow-md p-4">
          <div className="text-2xl font-bold text-accent-600">{stats.totalTours}</div>
          <div className="text-sm text-gray-500">Tours Totales</div>
        </div>
        <div className="bg-white rounded-lg shadow-md p-4">
          <div className="text-2xl font-bold text-secondary-600">{stats.withImages}</div>
          <div className="text-sm text-gray-500">Con Imágenes</div>
        </div>
      </div>

      {/* Filtros */}
      <div className="bg-white rounded-lg shadow-md p-4 mb-6">
        <div className="flex flex-col md:flex-row gap-4">
          <div className="flex-1">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
              <input
                type="text"
                placeholder="Buscar por nombre, descripción, país o región..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-10 pr-4 py-2 w-full border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
              />
            </div>
          </div>
          <div className="flex items-center space-x-2">
            <Filter className="h-4 w-4 text-gray-400" />
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as any)}
              className="border border-gray-300 rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
            >
              <option value="all">Todos los estados</option>
              <option value="active">Solo activos</option>
              <option value="inactive">Solo inactivos</option>
            </select>
          </div>
        </div>
      </div>

      {/* Formulario de Crear/Editar */}
      {(isCreating || editingDestination) && (
        <div className="bg-white rounded-lg shadow-md p-6 mb-6">
          <h2 className="text-xl font-semibold mb-4">
            {editingDestination ? `Editar Destino: ${editingDestination.name}` : 'Crear Nuevo Destino'}
          </h2>
          
          <form onSubmit={handleSubmit} className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Nombre del Destino *
                </label>
                <input
                  type="text"
                  value={formData.name}
                  onChange={(e) => setFormData({...formData, name: e.target.value})}
                  className="input"
                  required
                  placeholder="Ej: Cancún, Oaxaca, Ciudad de México"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  País
                </label>
                <input
                  type="text"
                  value={formData.country}
                  onChange={(e) => setFormData({...formData, country: e.target.value})}
                  className="input"
                  placeholder="México"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Estado/Región
                </label>
                <input
                  type="text"
                  value={formData.region}
                  onChange={(e) => setFormData({...formData, region: e.target.value})}
                  className="input"
                  placeholder="ej. Quintana Roo, Yucatán, CDMX"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Mejor Época para Visitar
                </label>
                <input
                  type="text"
                  value={formData.best_time_to_visit}
                  onChange={(e) => setFormData({...formData, best_time_to_visit: e.target.value})}
                  className="input"
                  placeholder="ej. Noviembre - Abril (temporada seca)"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Temperatura Promedio
                </label>
                <input
                  type="text"
                  value={formData.average_temperature}
                  onChange={(e) => setFormData({...formData, average_temperature: e.target.value})}
                  className="input"
                  placeholder="ej. 25-30°C"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Moneda
                </label>
                <input
                  type="text"
                  value={formData.currency}
                  onChange={(e) => setFormData({...formData, currency: e.target.value})}
                  className="input"
                  placeholder="MXN"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Idioma Principal
                </label>
                <input
                  type="text"
                  value={formData.language}
                  onChange={(e) => setFormData({...formData, language: e.target.value})}
                  className="input"
                  placeholder="Español"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Zona Horaria
                </label>
                <select
                  value={formData.time_zone}
                  onChange={(e) => setFormData({...formData, time_zone: e.target.value})}
                  className="input"
                >
                  <option value="America/Mexico_City">Ciudad de México (UTC-6)</option>
                  <option value="America/Cancun">Cancún (UTC-5)</option>
                  <option value="America/Mazatlan">Mazatlán (UTC-7)</option>
                  <option value="America/Tijuana">Tijuana (UTC-8)</option>
                </select>
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Descripción
              </label>
              <textarea
                value={formData.description}
                onChange={(e) => setFormData({...formData, description: e.target.value})}
                className="input"
                rows={4}
                placeholder="Describe el destino, sus atracciones principales, cultura, etc."
              />
            </div>

            {/* Imagen Principal */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Imagen Principal del Destino
              </label>
              <ImageUploader
                onImageSelect={handleMainImageSelect}
                currentImage={formData.main_image_url}
                maxSizeMB={5}
                placeholder="Seleccionar imagen principal del destino"
                storageFolder="destinations"
              />

              <div className="mt-3">
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  O proporciona una URL de imagen
                </label>
                <input
                  type="url"
                  value={formData.main_image_url}
                  onChange={(e) => setFormData({...formData, main_image_url: e.target.value})}
                  className="input"
                  placeholder="https://ejemplo.com/imagen.jpg"
                />
              </div>
            </div>

            <div className="flex justify-end space-x-4">
              <button
                type="button"
                onClick={handleCancel}
                className="btn btn-outline"
                disabled={isSubmitting}
              >
                <X className="h-4 w-4 mr-2" />
                Cancelar
              </button>
              <button
                type="submit"
                disabled={isSubmitting || !formData.name.trim()}
                className="btn btn-primary"
              >
                <Save className="h-4 w-4 mr-2" />
                {isSubmitting 
                  ? (editingDestination ? 'Actualizando...' : 'Creando...') 
                  : (editingDestination ? 'Actualizar Destino' : 'Crear Destino')
                }
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Lista de Destinos */}
      {filteredDestinations.length === 0 ? (
        <div className="bg-white rounded-lg shadow-md p-8 text-center">
          <MapPin className="h-12 w-12 text-gray-400 mx-auto mb-4" />
          <h3 className="text-xl font-semibold mb-2">
            {destinations.length === 0 ? 'No hay destinos registrados' : 'No se encontraron destinos'}
          </h3>
          <p className="text-gray-600 mb-6">
            {destinations.length === 0 
              ? 'Los destinos aparecerán aquí cuando se agreguen a la plataforma.'
              : 'Intenta ajustar los filtros de búsqueda.'
            }
          </p>
          {destinations.length === 0 && (
            <button
              onClick={handleCreate}
              className="btn btn-primary"
            >
              <Plus className="h-5 w-5 mr-2" />
              Crear Primer Destino
            </button>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-6">
          {filteredDestinations.map((destination) => (
            <div key={destination.id} className="bg-white rounded-lg shadow-md overflow-hidden">
              {/* Imagen Principal */}
              <div className="relative h-48">
                <img
                  src={destination.main_image_url || 'https://images.pexels.com/photos/1271619/pexels-photo-1271619.jpeg'}
                  alt={destination.name}
                  className="w-full h-full object-cover"
                />
                <div className="absolute top-2 left-2">
                  {getStatusBadge(destination.is_active)}
                </div>
                <div className="absolute top-2 right-2 flex space-x-2">
                  <button
                    onClick={() => handleEdit(destination)}
                    className="bg-white/80 hover:bg-white rounded-full p-2 text-gray-700"
                    disabled={isCreating || editingDestination}
                    title="Editar destino"
                  >
                    <Edit className="h-4 w-4" />
                  </button>
                  <button
                    onClick={() => handleToggleStatus(destination.id, destination.is_active)}
                    className="bg-white/80 hover:bg-white rounded-full p-2 text-gray-700"
                    disabled={isSubmitting}
                    title={destination.is_active ? 'Desactivar destino' : 'Activar destino'}
                  >
                    {destination.is_active ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
                <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/60 to-transparent p-4">
                  <h3 className="text-white text-xl font-bold">{destination.name}</h3>
                  {destination.country && (
                    <p className="text-white/90 text-sm flex items-center">
                      <MapPin className="h-4 w-4 mr-1" />
                      {destination.country}
                      {destination.region && `, ${destination.region}`}
                    </p>
                  )}
                </div>
              </div>

              {/* Información del Destino */}
              <div className="p-4">
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center space-x-3">
                    <span className="text-sm text-gray-500 flex items-center">
                      <Globe className="h-4 w-4 mr-1" />
                      {getTourCount(destination)} tours
                    </span>
                    <span className="text-sm text-gray-500 flex items-center">
                      <Image className="h-4 w-4 mr-1" />
                      {destination.destination_images?.length || 0} fotos
                    </span>
                  </div>
                  <span className="text-xs text-gray-400">
                    {format(new Date(destination.updated_at), 'dd/MM/yyyy')}
                  </span>
                </div>

                {destination.description && (
                  <p className="text-gray-600 text-sm mb-3 line-clamp-2">
                    {destination.description}
                  </p>
                )}

                {/* Información Detallada */}
                <div className="space-y-2 text-xs text-gray-500 mb-4">
                  {destination.best_time_to_visit && (
                    <div className="flex items-center">
                      <Clock className="h-3 w-3 mr-2" />
                      <span>Mejor época: {destination.best_time_to_visit}</span>
                    </div>
                  )}
                  {destination.average_temperature && (
                    <div className="flex items-center">
                      <span className="h-3 w-3 mr-2 text-center">🌡️</span>
                      <span>Temperatura: {destination.average_temperature}</span>
                    </div>
                  )}
                  {destination.currency && destination.currency !== 'MXN' && (
                    <div className="flex items-center">
                      <span className="h-3 w-3 mr-2 text-center">💰</span>
                      <span>Moneda: {destination.currency}</span>
                    </div>
                  )}
                  {destination.language && destination.language !== 'Español' && (
                    <div className="flex items-center">
                      <span className="h-3 w-3 mr-2 text-center">🗣️</span>
                      <span>Idioma: {destination.language}</span>
                    </div>
                  )}
                </div>

                {/* Galería de Imágenes */}
                <div className="border-t pt-4">
                  <h4 className="text-sm font-medium mb-2 flex items-center">
                    <Image className="h-4 w-4 mr-2" />
                    Galería ({destination.destination_images?.length || 0})
                  </h4>
                  
                  {/* Add Image Form */}
                  <div className="space-y-2 mb-3">
                    <ImageUploader
                      onImageSelect={(url) => setNewImageUrl(url)}
                      maxSizeMB={3}
                      placeholder="Agregar imagen a galería"
                      className="text-xs"
                      storageFolder="destinations"
                    />
                    
                    {newImageUrl && (
                      <div className="flex space-x-2">
                        <input
                          type="text"
                          value={newImageCaption}
                          onChange={(e) => setNewImageCaption(e.target.value)}
                          placeholder="Descripción (opcional)"
                          className="flex-1 text-xs p-2 border border-gray-300 rounded"
                        />
                        <button
                          type="button"
                          onClick={() => handleAddImage(destination.id)}
                          disabled={isSubmitting}
                          className="px-3 py-2 bg-primary-600 text-white rounded text-xs hover:bg-primary-700 disabled:opacity-50"
                        >
                          <Upload className="h-3 w-3" />
                        </button>
                      </div>
                    )}
                  </div>

                  {/* Images Grid */}
                  {destination.destination_images && destination.destination_images.length > 0 ? (
                    <div className="grid grid-cols-3 gap-2">
                      {destination.destination_images.slice(0, 6).map((image) => (
                        <div key={image.id} className="relative group">
                          <img
                            src={image.image_url || 'https://images.pexels.com/photos/1271619/pexels-photo-1271619.jpeg'}
                            alt={image.caption || 'Imagen del destino'}
                            className="w-full h-16 object-cover rounded"
                          />
                          <button
                            onClick={() => handleDeleteImage(image.id)}
                            className="absolute top-1 right-1 bg-red-500 text-white rounded-full p-1 opacity-0 group-hover:opacity-100 transition-opacity"
                            disabled={isSubmitting}
                            title="Eliminar imagen"
                          >
                            <Trash2 className="h-3 w-3" />
                          </button>
                          {image.caption && (
                            <div className="absolute bottom-0 left-0 right-0 bg-black/60 text-white text-xs p-1 rounded-b truncate">
                              {image.caption}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-xs text-gray-400 text-center py-2">
                      No hay imágenes adicionales
                    </p>
                  )}
                </div>

                {/* Acciones de Administrador */}
                <div className="mt-4 pt-4 border-t border-gray-200">
                  <div className="flex justify-between items-center">
                    <div className="text-xs text-gray-500">
                      <div>Creado: {format(new Date(destination.created_at), 'dd/MM/yyyy')}</div>
                      <div>ID: {destination.id.slice(0, 8)}...</div>
                    </div>
                    <button
                      onClick={() => handleDelete(destination)}
                      disabled={getTourCount(destination) > 0 || deletingDestination === destination.id}
                      className={`text-xs px-3 py-2 rounded transition-colors flex items-center ${
                        getTourCount(destination) > 0
                          ? 'bg-gray-100 text-gray-400 cursor-not-allowed'
                          : 'bg-red-100 text-red-700 hover:bg-red-200'
                      }`}
                      title={getTourCount(destination) > 0 
                        ? `No se puede eliminar: tiene ${getTourCount(destination)} tours asociados`
                        : 'Eliminar destino'
                      }
                    >
                      {deletingDestination === destination.id ? (
                        <>
                          <div className="animate-spin rounded-full h-3 w-3 border-t border-b border-current mr-1"></div>
                          Eliminando...
                        </>
                      ) : (
                        <>
                          <Trash2 className="h-3 w-3 mr-1" />
                          Eliminar
                        </>
                      )}
                    </button>
                  </div>
                  
                  {getTourCount(destination) > 0 && (
                    <div className="mt-2 text-xs text-amber-600 bg-amber-50 p-2 rounded">
                      ⚠️ Este destino tiene {getTourCount(destination)} tours asociados y no se puede eliminar
                    </div>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default AdminDestinations;