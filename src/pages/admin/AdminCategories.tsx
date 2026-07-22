import React, { useState, useEffect } from 'react';
import { Tag, Plus, Edit, Trash2, Save, X, Eye, EyeOff, ArrowUp, ArrowDown } from 'lucide-react';
import { getTourCategories, createTourCategory, updateTourCategory, deleteTourCategory } from '../../lib/supabase';

interface TourCategory {
  id: string;
  name: string;
  slug: string;
  description?: string;
  is_active: boolean;
  display_order: number;
  created_at: string;
  updated_at: string;
}

const AdminCategories: React.FC = () => {
  const [categories, setCategories] = useState<TourCategory[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');
  const [successMessage, setSuccessMessage] = useState('');
  const [isCreating, setIsCreating] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formData, setFormData] = useState({
    name: '',
    slug: '',
    description: '',
    display_order: 0
  });

  useEffect(() => {
    fetchCategories();
  }, []);

  const fetchCategories = async () => {
    try {
      setIsLoading(true);
      setError('');

      const { data, error } = await getTourCategories(true);

      if (error) {
        throw new Error(error.message);
      }

      setCategories(data || []);
    } catch (err: any) {
      setError(err.message || 'Error al cargar las categorías');
    } finally {
      setIsLoading(false);
    }
  };

  const handleCreate = () => {
    setIsCreating(true);
    setEditingId(null);
    setFormData({
      name: '',
      slug: '',
      description: '',
      display_order: categories.length + 1
    });
  };

  const handleEdit = (category: TourCategory) => {
    setIsCreating(false);
    setEditingId(category.id);
    setFormData({
      name: category.name,
      slug: category.slug,
      description: category.description || '',
      display_order: category.display_order
    });
  };

  const handleCancel = () => {
    setIsCreating(false);
    setEditingId(null);
    setFormData({ name: '', slug: '', description: '', display_order: 0 });
    setError('');
  };

  const generateSlug = (name: string): string => {
    return name
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
  };

  const handleNameChange = (name: string) => {
    setFormData({
      ...formData,
      name,
      slug: editingId ? formData.slug : generateSlug(name)
    });
  };

  const handleSave = async () => {
    try {
      setError('');
      setSuccessMessage('');

      if (!formData.name.trim()) {
        setError('El nombre es obligatorio');
        return;
      }

      if (!formData.slug.trim()) {
        setError('El slug es obligatorio');
        return;
      }

      if (isCreating) {
        const { error } = await createTourCategory(formData);
        if (error) throw new Error(error.message);
        setSuccessMessage('Categoría creada exitosamente');
      } else if (editingId) {
        const { error } = await updateTourCategory(editingId, formData);
        if (error) throw new Error(error.message);
        setSuccessMessage('Categoría actualizada exitosamente');
      }

      await fetchCategories();
      handleCancel();

      setTimeout(() => setSuccessMessage(''), 3000);
    } catch (err: any) {
      setError(err.message || 'Error al guardar la categoría');
    }
  };

  const handleToggleActive = async (id: string, currentStatus: boolean) => {
    try {
      setError('');
      const { error } = await updateTourCategory(id, { is_active: !currentStatus });

      if (error) throw new Error(error.message);

      await fetchCategories();
    } catch (err: any) {
      setError(err.message || 'Error al cambiar el estado');
    }
  };

  const handleDelete = async (id: string, name: string) => {
    if (!confirm(`¿Estás seguro de que deseas eliminar la categoría "${name}"?`)) {
      return;
    }

    try {
      setError('');
      const { error } = await deleteTourCategory(id);

      if (error) throw new Error(error.message);

      setSuccessMessage('Categoría eliminada exitosamente');
      await fetchCategories();

      setTimeout(() => setSuccessMessage(''), 3000);
    } catch (err: any) {
      setError(err.message || 'Error al eliminar la categoría');
    }
  };

  const handleReorder = async (id: string, direction: 'up' | 'down') => {
    const currentIndex = categories.findIndex(c => c.id === id);
    if (currentIndex === -1) return;

    const newIndex = direction === 'up' ? currentIndex - 1 : currentIndex + 1;
    if (newIndex < 0 || newIndex >= categories.length) return;

    try {
      const category = categories[currentIndex];
      const swapCategory = categories[newIndex];

      await updateTourCategory(category.id, { display_order: swapCategory.display_order });
      await updateTourCategory(swapCategory.id, { display_order: category.display_order });

      await fetchCategories();
    } catch (err: any) {
      setError('Error al reordenar las categorías');
    }
  };

  if (isLoading) {
    return (
      <div className="container mx-auto px-4 py-8">
        <div className="flex justify-center items-center h-64">
          <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-primary-600"></div>
        </div>
      </div>
    );
  }

  return (
    <div className="container mx-auto px-4 py-8">
      <div className="flex justify-between items-center mb-6">
        <div>
          <h1 className="text-3xl font-bold text-gray-900 flex items-center">
            <Tag className="h-8 w-8 mr-3 text-primary-600" />
            Gestión de Categorías
          </h1>
          <p className="text-gray-600 mt-2">
            Administra las categorías disponibles para los tours
          </p>
        </div>

        {!isCreating && !editingId && (
          <button
            onClick={handleCreate}
            className="btn btn-primary flex items-center"
          >
            <Plus className="h-5 w-5 mr-2" />
            Nueva Categoría
          </button>
        )}
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-800 px-4 py-3 rounded-lg mb-4">
          {error}
        </div>
      )}

      {successMessage && (
        <div className="bg-green-50 border border-green-200 text-green-800 px-4 py-3 rounded-lg mb-4">
          {successMessage}
        </div>
      )}

      {(isCreating || editingId) && (
        <div className="bg-white rounded-lg shadow-md p-6 mb-6">
          <h2 className="text-xl font-semibold mb-4">
            {isCreating ? 'Crear Nueva Categoría' : 'Editar Categoría'}
          </h2>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Nombre *
              </label>
              <input
                type="text"
                value={formData.name}
                onChange={(e) => handleNameChange(e.target.value)}
                className="input"
                placeholder="Ej: Aventura"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Slug (identificador único) *
              </label>
              <input
                type="text"
                value={formData.slug}
                onChange={(e) => setFormData({ ...formData, slug: e.target.value })}
                className="input"
                placeholder="Ej: adventure"
              />
            </div>
          </div>

          <div className="mb-4">
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Descripción
            </label>
            <textarea
              value={formData.description}
              onChange={(e) => setFormData({ ...formData, description: e.target.value })}
              className="input"
              rows={3}
              placeholder="Descripción de la categoría (opcional)"
            />
          </div>

          <div className="mb-4">
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Orden de visualización
            </label>
            <input
              type="number"
              value={formData.display_order}
              onChange={(e) => setFormData({ ...formData, display_order: parseInt(e.target.value) || 0 })}
              className="input"
              min="0"
            />
          </div>

          <div className="flex justify-end space-x-3">
            <button
              onClick={handleCancel}
              className="btn btn-secondary flex items-center"
            >
              <X className="h-4 w-4 mr-2" />
              Cancelar
            </button>
            <button
              onClick={handleSave}
              className="btn btn-primary flex items-center"
            >
              <Save className="h-4 w-4 mr-2" />
              Guardar
            </button>
          </div>
        </div>
      )}

      <div className="bg-white rounded-lg shadow-md overflow-hidden">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                  Orden
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                  Nombre
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                  Slug
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                  Descripción
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                  Estado
                </th>
                <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">
                  Acciones
                </th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {categories.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-6 py-8 text-center text-gray-500">
                    No hay categorías registradas
                  </td>
                </tr>
              ) : (
                categories.map((category, index) => (
                  <tr key={category.id} className="hover:bg-gray-50">
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="flex items-center space-x-2">
                        <span className="text-sm text-gray-900">{category.display_order}</span>
                        <div className="flex flex-col">
                          <button
                            onClick={() => handleReorder(category.id, 'up')}
                            disabled={index === 0}
                            className="text-gray-400 hover:text-gray-600 disabled:opacity-30"
                          >
                            <ArrowUp className="h-4 w-4" />
                          </button>
                          <button
                            onClick={() => handleReorder(category.id, 'down')}
                            disabled={index === categories.length - 1}
                            className="text-gray-400 hover:text-gray-600 disabled:opacity-30"
                          >
                            <ArrowDown className="h-4 w-4" />
                          </button>
                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="text-sm font-medium text-gray-900">{category.name}</div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <code className="text-sm bg-gray-100 px-2 py-1 rounded">{category.slug}</code>
                    </td>
                    <td className="px-6 py-4">
                      <div className="text-sm text-gray-600 max-w-xs truncate">
                        {category.description || '-'}
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      {category.is_active ? (
                        <span className="px-2 py-1 text-xs font-semibold rounded-full bg-green-100 text-green-800">
                          Activa
                        </span>
                      ) : (
                        <span className="px-2 py-1 text-xs font-semibold rounded-full bg-gray-100 text-gray-800">
                          Inactiva
                        </span>
                      )}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                      <div className="flex items-center justify-end space-x-2">
                        <button
                          onClick={() => handleEdit(category)}
                          className="text-primary-600 hover:text-primary-900"
                          title="Editar"
                        >
                          <Edit className="h-4 w-4" />
                        </button>
                        <button
                          onClick={() => handleToggleActive(category.id, category.is_active)}
                          className={`${
                            category.is_active
                              ? 'text-gray-600 hover:text-gray-900'
                              : 'text-green-600 hover:text-green-900'
                          }`}
                          title={category.is_active ? 'Desactivar' : 'Activar'}
                        >
                          {category.is_active ? (
                            <EyeOff className="h-4 w-4" />
                          ) : (
                            <Eye className="h-4 w-4" />
                          )}
                        </button>
                        <button
                          onClick={() => handleDelete(category.id, category.name)}
                          className="text-red-600 hover:text-red-900"
                          title="Eliminar"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="mt-6 bg-blue-50 border border-blue-200 rounded-lg p-4">
        <h3 className="text-sm font-semibold text-blue-900 mb-2">Información</h3>
        <ul className="text-sm text-blue-800 space-y-1">
          <li>• Las categorías activas aparecen en los formularios de creación de tours</li>
          <li>• Las categorías inactivas se ocultan pero no se eliminan</li>
          <li>• No puedes eliminar categorías que tienen tours asociados</li>
          <li>• El slug debe ser único y se usa internamente en el sistema</li>
        </ul>
      </div>
    </div>
  );
};

export default AdminCategories;
