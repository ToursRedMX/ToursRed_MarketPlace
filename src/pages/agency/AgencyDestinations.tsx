import React, { useState, useEffect } from 'react';
import { Plus, CreditCard as Edit, Trash2, Image, MapPin, Globe, Clock, DollarSign, Users, Save, X, Upload, AlertCircle } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { getAllDestinations, createDestination, updateDestination, addDestinationImage, deleteDestinationImage, deleteDestination } from '../../lib/supabase';
import { Destination, DestinationImage, ImageUploadData } from '../../types';
import ImageUploader from '../../components/ImageUploader';

const AgencyDestinations: React.FC = () => {
  const { user, isAdmin } = useAuth();
  const [destinations, setDestinations] = useState<Destination[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');
  const [isCreating, setIsCreating] = useState(false);
  const [editingDestination, setEditingDestination] = useState<Destination | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const [formData, setFormData] = useState({
    name: '',
    description: '',
    main_image_url: '',
    country: 'México',
    region: '',
    best_time_to_visit: '',
  });

  const [newImageUrl, setNewImageUrl] = useState('');
  const [newImageCaption, setNewImageCaption] = useState('');
  const [deletingDestination, setDeletingDestination] = useState<string | null>(null);

  useEffect(() => {
    fetchDestinations();
  }, []);

  const fetchDestinations = async () => {
    try {
      setIsLoading(true);
      setError('');
      
      const { data, error } = await getAllDestinations();
      
      if (error) {
        throw new Error(error.message);
      }
      
      setDestinations(data || []);
    } catch (err: any) {
      setError(err.message || 'Error al cargar destinos');
    } finally {
      setIsLoading(false);
    }
  };

  const resetForm = () => {
    setFormData({
      name: '',
      description: '',
      main_image_url: '',
      country: 'México',
      region: '',
      best_time_to_visit: '',
    });
    setNewImageUrl('');
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
      main_image_url: destination.main_image_url || '',
      country: destination.country || 'México',
      region: destination.region || '',
      best_time_to_visit: destination.best_time_to_visit || '',
    });
    setEditingDestination(destination);
    setIsCreating(false);
  };

  const handleCancel = () => {
    setIsCreating(false);
    setEditingDestination(null);
    resetForm();
  };

  const handleMainImageSelect = (publicUrl: string, _type: string, _size: number) => {
    setFormData({ ...formData, main_image_url: publicUrl });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    setError('');

    try {
      if (!user?.id) {
        throw new Error('Usuario no autenticado');
      }

      // Validar que el nombre no esté vacío
      if (!formData.name.trim()) {
        throw new Error('El nombre del destino es obligatorio');
      }

      if (editingDestination) {
        // Update existing destination
        // Solo enviar campos que no sean vacíos
        const updateData: any = {
          name: formData.name,
          is_active: true
        };
        
        if (formData.description) updateData.description = formData.description;
        if (formData.country) updateData.country = formData.country;
        if (formData.region) updateData.region = formData.region;
        if (formData.best_time_to_visit) updateData.best_time_to_visit = formData.best_time_to_visit;
        
        if (formData.main_image_url) {
          updateData.main_image_url = formData.main_image_url;
        }
        
        const { error } = await updateDestination(editingDestination.id, updateData);
        if (error) throw error;
      } else {
        // Create new destination
        // Only send non-empty fields
        const createData: any = {
          name: formData.name.trim(),
          is_active: true
        };
        
        if (formData.description) createData.description = formData.description;
        if (formData.country) createData.country = formData.country;
        if (formData.region) createData.region = formData.region;
        if (formData.best_time_to_visit) createData.best_time_to_visit = formData.best_time_to_visit;
        
        if (formData.main_image_url) {
          createData.main_image_url = formData.main_image_url;
        }
        
        console.log('🌍 Enviando datos para crear destino:', createData);
        const { error } = await createDestination(createData);
        if (error) {
          console.error('❌ Error detallado al crear destino:', error);
          throw new Error(`Error al crear destino: ${error.message}`);
        }
      }

      await fetchDestinations();
      handleCancel();
    } catch (err: any) {
      setError(err.message || 'Error al guardar destino');
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
        is_featured: false,
        uploaded_by: user?.id
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

  const handleDelete = async (destination: Destination) => {
    if (!isAdmin) {
      setError('Solo los administradores pueden eliminar destinos');
      return;
    }

    if (!confirm(`¿Estás seguro de que quieres eliminar el destino "${destination.name}"?\n\nEsta acción no se puede deshacer y eliminará también todas las imágenes asociadas.`)) {
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

  const getTourCount = (destination: Destination) => {
    return destination.tour_destinations?.length || 0;
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
        <h1 className="text-3xl font-bold">Gestionar Destinos</h1>
        <button
          onClick={handleCreate}
          className="btn btn-primary"
          disabled={isCreating || editingDestination}
        >
          <Plus className="h-5 w-5 mr-2" />
          Agregar Destino
        </button>
      </div>

      {error && (
        <div className="mb-6 bg-error-50 text-error-600 p-4 rounded-md">
          {error}
        </div>
      )}

      {/* Create/Edit Form */}
      {(isCreating || editingDestination) && (
        <div className="bg-white rounded-lg shadow-md p-6 mb-6">
          <h2 className="text-xl font-semibold mb-4">
            {editingDestination ? 'Editar Destino' : 'Crear Nuevo Destino'}
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
                  defaultValue="México"
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
            </div>

            {/* Main Image Upload */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Imagen Principal del Destino (Opcional)
              </label>
              <ImageUploader
                onImageSelect={handleMainImageSelect}
                currentImage={formData.main_image_url}
                maxSizeMB={5}
                placeholder="Seleccionar imagen principal (opcional)"
                storageFolder="destinations"
              />
              <p className="text-xs text-gray-500 mt-1">
                Puedes agregar la imagen principal después de crear el destino
              </p>
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
                placeholder="Describe el destino, sus atracciones principales, cultura, etc. (opcional)"
              />
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
                disabled={isSubmitting}
                className="btn btn-primary"
              >
                <Save className="h-4 w-4 mr-2" />
                {isSubmitting ? 'Guardando...' : 'Guardar Destino'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Destinations List */}
      <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-6">
        {destinations.map((destination) => (
          <div key={destination.id} className="bg-white rounded-lg shadow-md overflow-hidden">
            {/* Destination Header */}
            <div className="relative h-48">
              <img
                src={destination.main_image_url || 'https://images.pexels.com/photos/1271619/pexels-photo-1271619.jpeg'}
                alt={destination.name}
                className="w-full h-full object-cover"
              />
              <div className="absolute top-2 right-2 flex space-x-2">
                <button
                  onClick={() => handleEdit(destination)}
                  className="bg-white/80 hover:bg-white rounded-full p-2 text-gray-700"
                  disabled={isCreating || editingDestination}
                >
                  <Edit className="h-4 w-4" />
                </button>
              </div>
              <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/60 to-transparent p-4">
                <h3 className="text-white text-xl font-bold">{destination.name}</h3>
                {destination.country && (
                  <p className="text-white/90 text-sm flex items-center">
                    <MapPin className="h-4 w-4 mr-1" />
                    {destination.country}
                  </p>
                )}
              </div>
            </div>

            {/* Destination Info */}
            <div className="p-4">
              <div className="flex items-center justify-between mb-3">
                <span className="text-sm text-gray-500 flex items-center">
                  <Users className="h-4 w-4 mr-1" />
                  {getTourCount(destination)} tours
                </span>
                <span className="text-xs text-gray-400">
                  {new Date(destination.updated_at).toLocaleDateString()}
                </span>
              </div>

              {destination.description && (
                <p className="text-gray-600 text-sm mb-3 line-clamp-2">
                  {destination.description}
                </p>
              )}

              {/* Quick Info */}
              <div className="space-y-2 text-xs text-gray-500">
                {destination.best_time_to_visit && (
                  <div className="flex items-center">
                    <Clock className="h-3 w-3 mr-2" />
                    <span>Mejor época: {destination.best_time_to_visit}</span>
                  </div>
                )}
                {destination.region && (
                  <div className="flex items-center">
                    <MapPin className="h-3 w-3 mr-2" />
                    <span>Región: {destination.region}</span>
                  </div>
                )}
                {destination.country && destination.country !== 'México' && (
                  <div className="flex items-center">
                    <Globe className="h-3 w-3 mr-2" />
                    <span>País: {destination.country}</span>
                  </div>
                )}
              </div>

              {/* Images Section */}
              <div className="mt-4 border-t pt-4">
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
                        >
                          <Trash2 className="h-3 w-3" />
                        </button>
                        {image.caption && (
                          <div className="absolute bottom-0 left-0 right-0 bg-black/60 text-white text-xs p-1 rounded-b">
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
              
              {/* Admin Actions */}
              {isAdmin && (
                <div className="mt-4 pt-4 border-t border-gray-200">
                  <div className="flex items-center text-xs text-amber-600 mb-2">
                    <AlertCircle className="h-3 w-3 mr-1" />
                    <span>Acciones de Administrador</span>
                  </div>
                  <button
                    onClick={() => handleDelete(destination)}
                    disabled={getTourCount(destination) > 0 || deletingDestination === destination.id}
                    className={`text-xs px-3 py-2 rounded transition-colors ${
                      getTourCount(destination) > 0
                        ? 'bg-gray-100 text-gray-400 cursor-not-allowed'
                        : 'bg-red-100 text-red-700 hover:bg-red-200'
                    }`}
                  >
                    <Trash2 className="h-3 w-3 mr-1" />
                    {deletingDestination === destination.id ? 'Eliminando...' : 'Eliminar'}
                  </button>
                </div>
              )}
            </div>
          </div>
        ))}
      </div>

      {destinations.length === 0 && !isLoading && (
        <div className="bg-white rounded-lg shadow-md p-8 text-center">
          <MapPin className="h-12 w-12 text-gray-400 mx-auto mb-4" />
          <h3 className="text-xl font-semibold mb-2">No hay destinos</h3>
          <p className="text-gray-600 mb-6">
            Comienza agregando destinos para que las agencias puedan crear tours.
          </p>
          <button
            onClick={handleCreate}
            className="btn btn-primary"
          >
            <Plus className="h-5 w-5 mr-2" />
            Agregar Primer Destino
          </button>
        </div>
      )}
    </div>
  );
};

export default AgencyDestinations;