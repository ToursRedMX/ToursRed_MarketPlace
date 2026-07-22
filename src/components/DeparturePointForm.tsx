import React, { useState } from 'react';
import { X, MapPin, AlertCircle, ExternalLink, Check } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';

interface DeparturePointFormProps {
  onClose: () => void;
  onSuccess: (newPoint: {
    id: string;
    name: string;
    city: string;
    municipality: string;
    google_maps_url?: string;
    usage_count: number;
  }) => void;
}

const DeparturePointForm: React.FC<DeparturePointFormProps> = ({ onClose, onSuccess }) => {
  const { user } = useAuth();
  const [formData, setFormData] = useState({
    name: '',
    city: '',
    municipality: '',
    google_maps_url: '',
  });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [duplicates, setDuplicates] = useState<any[]>([]);
  const [confirmCreate, setConfirmCreate] = useState(false);

  const checkForDuplicates = async () => {
    if (formData.name.length < 2 || formData.city.length < 2) return;

    try {
      const { data } = await supabase
        .rpc('search_departure_points', {
          search_query: `${formData.name} ${formData.city}`,
          limit_count: 5
        });

      if (data && data.length > 0) {
        const similarPoints = data.filter((point: any) => {
          const nameMatch = point.name.toLowerCase().includes(formData.name.toLowerCase()) ||
                           formData.name.toLowerCase().includes(point.name.toLowerCase());
          const cityMatch = point.city.toLowerCase() === formData.city.toLowerCase();
          return nameMatch && cityMatch;
        });

        setDuplicates(similarPoints);

        if (similarPoints.length > 0) {
          setConfirmCreate(false);
        }
      }
    } catch (error) {
      console.error('Error checking duplicates:', error);
    }
  };

  const handleBlurName = () => {
    checkForDuplicates();
  };

  const handleBlurCity = () => {
    checkForDuplicates();
  };

  const validateGoogleMapsUrl = (url: string): boolean => {
    if (!url) return true;

    const patterns = [
      /^https:\/\/(www\.)?google\.(com|[a-z]{2})\/maps/,
      /^https:\/\/goo\.gl\/maps\//,
      /^https:\/\/maps\.app\.goo\.gl\//,
    ];

    return patterns.some(pattern => pattern.test(url));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (formData.google_maps_url && !validateGoogleMapsUrl(formData.google_maps_url)) {
      setError('La URL debe ser un enlace válido de Google Maps');
      return;
    }

    if (duplicates.length > 0 && !confirmCreate) {
      setError('Se encontraron puntos similares. Por favor, confirma que deseas crear este nuevo punto.');
      return;
    }

    setIsSubmitting(true);

    try {
      const { data, error: insertError } = await supabase
        .from('departure_points')
        .insert({
          name: formData.name.trim(),
          city: formData.city.trim(),
          municipality: formData.municipality.trim(),
          google_maps_url: formData.google_maps_url.trim() || null,
          created_by: user?.id,
        })
        .select()
        .single();

      if (insertError) {
        if (insertError.code === '23505') {
          setError('Ya existe un punto de salida con este nombre en esta ciudad y municipio');
        } else {
          throw insertError;
        }
        return;
      }

      onSuccess(data);
      onClose();
    } catch (err: any) {
      console.error('Error creating departure point:', err);
      setError(err.message || 'Error al crear el punto de salida');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg shadow-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
        <div className="sticky top-0 bg-white border-b border-gray-200 px-6 py-4 flex items-center justify-between">
          <h2 className="text-xl font-semibold flex items-center gap-2">
            <MapPin className="w-6 h-6 text-primary-600" />
            Crear Nuevo Punto de Salida
          </h2>
          <button
            onClick={onClose}
            className="p-2 hover:bg-gray-100 rounded-full transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-6">
          {error && (
            <div className="bg-error-50 border border-error-200 rounded-lg p-4 flex items-start gap-3">
              <AlertCircle className="w-5 h-5 text-error-600 flex-shrink-0 mt-0.5" />
              <p className="text-sm text-error-800">{error}</p>
            </div>
          )}

          {duplicates.length > 0 && (
            <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
              <div className="flex items-start gap-3 mb-3">
                <AlertCircle className="w-5 h-5 text-yellow-600 flex-shrink-0 mt-0.5" />
                <div className="flex-1">
                  <p className="text-sm font-medium text-yellow-900 mb-2">
                    Se encontraron puntos de salida similares:
                  </p>
                  <div className="space-y-2">
                    {duplicates.map((dup) => (
                      <div key={dup.id} className="bg-white p-3 rounded border border-yellow-200">
                        <p className="font-medium text-gray-900">{dup.name}</p>
                        <p className="text-sm text-gray-600">{dup.city}, {dup.municipality}</p>
                        {dup.google_maps_url && (
                          <a
                            href={dup.google_maps_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-xs text-blue-600 hover:text-blue-700 flex items-center gap-1 mt-1"
                          >
                            Ver en Google Maps <ExternalLink className="w-3 h-3" />
                          </a>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              </div>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={confirmCreate}
                  onChange={(e) => setConfirmCreate(e.target.checked)}
                  className="w-4 h-4 text-primary-600 border-gray-300 rounded focus:ring-primary-500"
                />
                <span className="text-sm text-yellow-900">
                  Confirmo que este es un punto diferente y deseo crearlo
                </span>
              </label>
            </div>
          )}

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Nombre del Lugar *
            </label>
            <input
              type="text"
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              onBlur={handleBlurName}
              className="input"
              placeholder="Ej: Monumento a la Revolución, Terminal de Autobuses, etc."
              required
              maxLength={200}
            />
            <p className="text-xs text-gray-500 mt-1">
              Nombre específico y reconocible del punto de salida
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Ciudad *
              </label>
              <input
                type="text"
                value={formData.city}
                onChange={(e) => setFormData({ ...formData, city: e.target.value })}
                onBlur={handleBlurCity}
                className="input"
                placeholder="Ej: Ciudad de México"
                required
                maxLength={100}
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Municipio / Alcaldía *
              </label>
              <input
                type="text"
                value={formData.municipality}
                onChange={(e) => setFormData({ ...formData, municipality: e.target.value })}
                className="input"
                placeholder="Ej: Cuauhtémoc"
                required
                maxLength={100}
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              URL de Google Maps (Opcional)
            </label>
            <input
              type="url"
              value={formData.google_maps_url}
              onChange={(e) => setFormData({ ...formData, google_maps_url: e.target.value })}
              className="input"
              placeholder="https://goo.gl/maps/..."
            />
            <p className="text-xs text-gray-500 mt-1">
              Comparte el enlace exacto de Google Maps para que los viajeros puedan encontrar el lugar fácilmente
            </p>
          </div>

          <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
            <p className="text-sm text-blue-900">
              <strong>Nota:</strong> Este punto de salida estará disponible para que cualquier agencia lo use en sus tours.
              Asegúrate de que la información sea precisa y útil para otros.
            </p>
          </div>

          <div className="flex justify-end gap-3 pt-4 border-t">
            <button
              type="button"
              onClick={onClose}
              className="btn btn-outline"
              disabled={isSubmitting}
            >
              Cancelar
            </button>
            <button
              type="submit"
              className="btn btn-primary flex items-center gap-2"
              disabled={isSubmitting || (duplicates.length > 0 && !confirmCreate)}
            >
              {isSubmitting ? (
                <>
                  <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
                  Creando...
                </>
              ) : (
                <>
                  <Check className="w-4 h-4" />
                  Crear Punto de Salida
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default DeparturePointForm;
