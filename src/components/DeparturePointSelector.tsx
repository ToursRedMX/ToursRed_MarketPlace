import React, { useState, useEffect, useRef } from 'react';
import { MapPin, Plus, Search, AlertCircle, ExternalLink, X } from 'lucide-react';
import { supabase } from '../lib/supabase';

interface DeparturePoint {
  id: string;
  name: string;
  city: string;
  municipality: string;
  google_maps_url?: string;
  usage_count: number;
}

interface SelectedDeparturePoint extends DeparturePoint {
  display_order: number;
  departure_time?: string;
  special_instructions?: string;
}

interface DeparturePointSelectorProps {
  selectedPoints: SelectedDeparturePoint[];
  onPointsChange: (points: SelectedDeparturePoint[]) => void;
  onCreateNew?: () => void;
  maxPoints?: number;
  minPoints?: number;
  label?: string;
}

const DeparturePointSelector: React.FC<DeparturePointSelectorProps> = ({
  selectedPoints,
  onPointsChange,
  onCreateNew,
  maxPoints = 4,
  minPoints = 1,
  label = 'Puntos de Salida',
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [suggestions, setSuggestions] = useState<DeparturePoint[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [isSearching, setIsSearching] = useState(false);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState(-1);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<NodeJS.Timeout>();

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (wrapperRef.current && !wrapperRef.current.contains(event.target as Node)) {
        setShowSuggestions(false);
      }
    }

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  useEffect(() => {
    if (searchQuery.length < 2) {
      setSuggestions([]);
      setShowSuggestions(false);
      return;
    }

    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
    }

    debounceRef.current = setTimeout(async () => {
      await searchDeparturePoints(searchQuery);
    }, 300);

    return () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
      }
    };
  }, [searchQuery]);

  const searchDeparturePoints = async (query: string) => {
    setIsSearching(true);
    try {
      const { data, error } = await supabase
        .rpc('search_departure_points', {
          search_query: query,
          limit_count: 20
        });

      if (error) throw error;

      setSuggestions(data || []);
      setShowSuggestions(true);
      setHighlightedIndex(-1);
    } catch (error) {
      console.error('Error searching departure points:', error);
      setSuggestions([]);
    } finally {
      setIsSearching(false);
    }
  };

  const handleSelectPoint = (point: DeparturePoint) => {
    if (selectedPoints.length >= maxPoints) {
      alert(`No puedes seleccionar más de ${maxPoints} puntos de salida`);
      return;
    }

    if (selectedPoints.some(p => p.id === point.id)) {
      alert('Este punto ya está seleccionado');
      return;
    }

    const newPoint: SelectedDeparturePoint = {
      ...point,
      display_order: selectedPoints.length + 1,
    };

    onPointsChange([...selectedPoints, newPoint]);
    setSearchQuery('');
    setSuggestions([]);
    setShowSuggestions(false);
  };

  const handleRemovePoint = (pointId: string) => {
    const updatedPoints = selectedPoints
      .filter(p => p.id !== pointId)
      .map((p, index) => ({ ...p, display_order: index + 1 }));

    onPointsChange(updatedPoints);
  };

  const handleReorderPoint = (pointId: string, direction: 'up' | 'down') => {
    const currentIndex = selectedPoints.findIndex(p => p.id === pointId);
    if (currentIndex === -1) return;

    const newIndex = direction === 'up' ? currentIndex - 1 : currentIndex + 1;
    if (newIndex < 0 || newIndex >= selectedPoints.length) return;

    const reordered = [...selectedPoints];
    [reordered[currentIndex], reordered[newIndex]] = [reordered[newIndex], reordered[currentIndex]];

    const updated = reordered.map((p, index) => ({ ...p, display_order: index + 1 }));
    onPointsChange(updated);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!showSuggestions || suggestions.length === 0) return;

    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        setHighlightedIndex(prev => (prev < suggestions.length - 1 ? prev + 1 : prev));
        break;
      case 'ArrowUp':
        e.preventDefault();
        setHighlightedIndex(prev => (prev > 0 ? prev - 1 : -1));
        break;
      case 'Enter':
        e.preventDefault();
        if (highlightedIndex >= 0 && highlightedIndex < suggestions.length) {
          handleSelectPoint(suggestions[highlightedIndex]);
        }
        break;
      case 'Escape':
        setShowSuggestions(false);
        break;
    }
  };

  return (
    <div className="space-y-4">
      <div ref={wrapperRef} className="relative">
        <label className="block text-sm font-medium text-gray-700 mb-2">
          {label} *
          <span className="text-xs text-gray-500 ml-2">
            (Mínimo {minPoints}, Máximo {maxPoints})
          </span>
        </label>

        <div className="relative">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-5 h-5 text-gray-400" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            onFocus={() => {
              if (suggestions.length > 0) {
                setShowSuggestions(true);
              }
            }}
            placeholder={`Buscar ${label.toLowerCase()}...`}
            className="input pl-10 pr-10"
            disabled={selectedPoints.length >= maxPoints}
          />
          {isSearching && (
            <div className="absolute right-3 top-1/2 transform -translate-y-1/2">
              <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-primary-600"></div>
            </div>
          )}
        </div>

        {showSuggestions && suggestions.length > 0 && (
          <div className="absolute z-50 w-full mt-1 bg-white border border-gray-200 rounded-lg shadow-lg max-h-80 overflow-y-auto">
            <div className="py-1">
              <div className="px-3 py-2 text-xs text-gray-500 border-b bg-gray-50">
                Puntos de salida existentes
              </div>
              {suggestions.map((suggestion, index) => (
                <button
                  key={suggestion.id}
                  onClick={() => handleSelectPoint(suggestion)}
                  onMouseEnter={() => setHighlightedIndex(index)}
                  className={`w-full text-left px-3 py-3 hover:bg-gray-50 border-b border-gray-100 last:border-b-0 transition-colors ${
                    highlightedIndex === index ? 'bg-blue-50' : ''
                  } ${selectedPoints.some(p => p.id === suggestion.id) ? 'opacity-50' : ''}`}
                  disabled={selectedPoints.some(p => p.id === suggestion.id)}
                >
                  <div className="flex items-start gap-3">
                    <MapPin className="w-5 h-5 text-primary-600 mt-0.5 flex-shrink-0" />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="font-medium text-gray-900">{suggestion.name}</p>
                        {suggestion.usage_count > 0 && (
                          <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-blue-100 text-blue-800">
                            {suggestion.usage_count} {suggestion.usage_count === 1 ? 'tour' : 'tours'}
                          </span>
                        )}
                      </div>
                      <p className="text-sm text-gray-600">
                        {suggestion.city}, {suggestion.municipality}
                      </p>
                      {suggestion.google_maps_url && (
                        <a
                          href={suggestion.google_maps_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          onClick={(e) => e.stopPropagation()}
                          className="text-xs text-blue-600 hover:text-blue-700 flex items-center gap-1 mt-1"
                        >
                          Ver en Google Maps <ExternalLink className="w-3 h-3" />
                        </a>
                      )}
                    </div>
                  </div>
                </button>
              ))}
            </div>
          </div>
        )}

        {searchQuery.length >= 2 && !isSearching && suggestions.length === 0 && showSuggestions && (
          <div className="absolute z-50 w-full mt-1 bg-white border border-gray-200 rounded-lg shadow-lg">
            <div className="px-4 py-6 text-center">
              <AlertCircle className="w-8 h-8 text-gray-400 mx-auto mb-2" />
              <p className="text-sm text-gray-600 mb-3">No se encontraron puntos de salida</p>
              <button
                type="button"
                onClick={() => onCreateNew?.()}
                className="text-sm text-primary-600 hover:text-primary-700 font-medium"
              >
                Crear nuevo punto de salida
              </button>
            </div>
          </div>
        )}
      </div>

      {selectedPoints.length > 0 && (
        <div className="space-y-3">
          <p className="text-sm font-medium text-gray-700">Puntos seleccionados ({selectedPoints.length}/{maxPoints}):</p>
          {selectedPoints.map((point, index) => (
            <div
              key={point.id}
              className="p-4 bg-gray-50 rounded-lg border border-gray-200"
            >
              <div className="flex items-start gap-3 mb-3">
                <div className="flex-shrink-0 w-8 h-8 bg-primary-600 text-white rounded-full flex items-center justify-center font-semibold">
                  {point.display_order}
                </div>
                <MapPin className="w-5 h-5 text-primary-600 flex-shrink-0 mt-0.5" />
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-gray-900">{point.name}</p>
                  <p className="text-sm text-gray-600">{point.city}, {point.municipality}</p>
                </div>
                <div className="flex items-center gap-1">
                  {index > 0 && (
                    <button
                      type="button"
                      onClick={() => handleReorderPoint(point.id, 'up')}
                      className="p-1 text-gray-400 hover:text-gray-600"
                      title="Mover arriba"
                    >
                      ▲
                    </button>
                  )}
                  {index < selectedPoints.length - 1 && (
                    <button
                      type="button"
                      onClick={() => handleReorderPoint(point.id, 'down')}
                      className="p-1 text-gray-400 hover:text-gray-600"
                      title="Mover abajo"
                    >
                      ▼
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => handleRemovePoint(point.id)}
                    className="p-1 text-error-600 hover:text-error-700 ml-2"
                    title="Eliminar"
                    disabled={selectedPoints.length <= minPoints}
                  >
                    <X className="w-5 h-5" />
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 ml-11">
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">
                    Hora de salida (opcional)
                  </label>
                  <input
                    type="time"
                    value={point.departure_time || ''}
                    onChange={(e) => {
                      const updated = selectedPoints.map(p =>
                        p.id === point.id ? { ...p, departure_time: e.target.value } : p
                      );
                      onPointsChange(updated);
                    }}
                    className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-primary-500 focus:border-primary-500"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">
                    Instrucciones especiales (opcional)
                  </label>
                  <input
                    type="text"
                    value={point.special_instructions || ''}
                    onChange={(e) => {
                      const updated = selectedPoints.map(p =>
                        p.id === point.id ? { ...p, special_instructions: e.target.value } : p
                      );
                      onPointsChange(updated);
                    }}
                    placeholder="Ej: Junto al Starbucks"
                    className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-primary-500 focus:border-primary-500"
                  />
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {selectedPoints.length < minPoints && (
        <p className="text-sm text-error-600 flex items-center gap-2">
          <AlertCircle className="w-4 h-4" />
          Debes seleccionar al menos {minPoints} {label.toLowerCase().replace(/s$/, '')}{minPoints !== 1 ? 's' : ''}
        </p>
      )}

      <button
        type="button"
        onClick={() => onCreateNew?.()}
        className="text-sm text-primary-600 hover:text-primary-700 font-medium flex items-center gap-2"
        disabled={selectedPoints.length >= maxPoints}
      >
        <Plus className="w-4 h-4" />
        Crear nuevo {label.toLowerCase().replace(/s$/, '').replace(/puntos? de/i, 'punto de')}
      </button>

      <p className="text-xs text-gray-500">
        Busca por nombre del lugar, ciudad o municipio. Si no encuentras el punto que necesitas, créalo y estará disponible para todos tus tours futuros.
      </p>
    </div>
  );
};

export default DeparturePointSelector;
