import React, { useState, useEffect, useRef, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search, Tag, Calendar, Building2, DollarSign, Dog, X, MapPin, FileSearch, RefreshCw, SlidersHorizontal, RotateCcw } from 'lucide-react';
import { SearchFilters } from '../types';
import { useTourCategories, useAgencies, useDeparturePoints } from '../hooks/useSharedData';

interface SearchBoxProps {
  initialFilters?: SearchFilters;
  className?: string;
  onClose?: () => void;
}

const SearchBox: React.FC<SearchBoxProps> = ({ initialFilters = {}, className = '', onClose }) => {
  const [tourName, setTourName] = useState(initialFilters.tourName || '');
  const [destination, setDestination] = useState(initialFilters.destination || '');
  const [category, setCategory] = useState(initialFilters.category || '');
  const [startDate, setStartDate] = useState(initialFilters.startDate || '');
  const [endDate, setEndDate] = useState(initialFilters.endDate || '');
  const [agency, setAgency] = useState(initialFilters.agency || '');
  const [agencySearchText, setAgencySearchText] = useState('');
  const [departurePoint, setDeparturePoint] = useState(initialFilters.departurePoint || '');
  const [departurePointSearchText, setDeparturePointSearchText] = useState(initialFilters.departurePoint || '');
  const [minPrice, setMinPrice] = useState(initialFilters.minPrice || '');
  const [maxPrice, setMaxPrice] = useState(initialFilters.maxPrice || '');
  const [petFriendly, setPetFriendly] = useState(initialFilters.petFriendly || '');
  const [tourType, setTourType] = useState(initialFilters.tourType || '');
  const [locationName] = useState(initialFilters.locationName || '');
  const [locationCoords] = useState<{ lat: number; lng: number } | null>(
    initialFilters.lat && initialFilters.lng
      ? { lat: parseFloat(initialFilters.lat), lng: parseFloat(initialFilters.lng) }
      : null
  );
  const [radius] = useState(initialFilters.radius || '5');
  const [showAgencyDropdown, setShowAgencyDropdown] = useState(false);
  const [selectedAgencyName, setSelectedAgencyName] = useState('');
  const [showDeparturePointDropdown, setShowDeparturePointDropdown] = useState(false);
  const agencyInputRef = useRef<HTMLDivElement>(null);
  const departurePointInputRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();

  const { data: categories = [] } = useTourCategories();
  const { data: agencies = [] } = useAgencies();
  const { data: departurePoints = [] } = useDeparturePoints();

  const initialAgencyIdRef = useRef(initialFilters.agency);
  const agencyInitializedRef = useRef(false);

  useEffect(() => {
    if (agencies.length === 0 || agencyInitializedRef.current) return;
    const initialAgencyId = initialAgencyIdRef.current;
    if (initialAgencyId) {
      const selectedAgency = agencies.find((a: any) => a.id === initialAgencyId);
      if (selectedAgency) {
        setSelectedAgencyName(selectedAgency.name);
        setAgencySearchText(selectedAgency.name);
      }
    }
    agencyInitializedRef.current = true;
  }, [agencies]);

  const filteredAgencies = useMemo(() => {
    if (agencySearchText === '' || agencySearchText === selectedAgencyName) return agencies;
    return agencies.filter((ag: any) =>
      ag.name.toLowerCase().includes(agencySearchText.toLowerCase())
    );
  }, [agencySearchText, agencies, selectedAgencyName]);

  const filteredDeparturePoints = useMemo(() => {
    if (departurePointSearchText === '') return departurePoints;
    return departurePoints.filter((dp: any) =>
      dp.name.toLowerCase().includes(departurePointSearchText.toLowerCase()) ||
      (dp.city && dp.city.toLowerCase().includes(departurePointSearchText.toLowerCase()))
    );
  }, [departurePointSearchText, departurePoints]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (agencyInputRef.current && !agencyInputRef.current.contains(event.target as Node)) {
        setShowAgencyDropdown(false);
      }
      if (departurePointInputRef.current && !departurePointInputRef.current.contains(event.target as Node)) {
        setShowDeparturePointDropdown(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleAgencyInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    setAgencySearchText(value);
    setShowAgencyDropdown(true);
    if (value === '') {
      setAgency('');
      setSelectedAgencyName('');
    }
  };

  const handleAgencySelect = (selectedAgency: any) => {
    setAgency(selectedAgency.id);
    setAgencySearchText(selectedAgency.name);
    setSelectedAgencyName(selectedAgency.name);
    setShowAgencyDropdown(false);
  };

  const handleClearAgency = () => {
    setAgency('');
    setAgencySearchText('');
    setSelectedAgencyName('');
    setShowAgencyDropdown(false);
  };

  const handleDeparturePointInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    setDeparturePointSearchText(value);
    setShowDeparturePointDropdown(true);
    if (value === '') setDeparturePoint('');
  };

  const handleDeparturePointSelect = (selectedPoint: any) => {
    setDeparturePoint(selectedPoint.name);
    setDeparturePointSearchText(selectedPoint.name);
    setShowDeparturePointDropdown(false);
  };

  const handleClearDeparturePoint = () => {
    setDeparturePoint('');
    setDeparturePointSearchText('');
    setShowDeparturePointDropdown(false);
  };

  const handleClearAll = () => {
    setTourName('');
    setDestination('');
    setCategory('');
    setStartDate('');
    setEndDate('');
    setAgency('');
    setAgencySearchText('');
    setSelectedAgencyName('');
    setDeparturePoint('');
    setDeparturePointSearchText('');
    setMinPrice('');
    setMaxPrice('');
    setPetFriendly('');
    setTourType('');
  };

  const hasActiveFilters = !!(tourName || destination || category || startDate || endDate || agency || departurePoint || minPrice || maxPrice || petFriendly || tourType);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    const queryParams = new URLSearchParams();
    if (tourName) queryParams.set('tourName', tourName);
    if (destination) queryParams.set('destination', destination);
    if (category) queryParams.set('category', category);
    if (startDate) queryParams.set('startDate', startDate);
    if (endDate) queryParams.set('endDate', endDate);
    if (agency) queryParams.set('agency', agency);
    if (departurePoint) queryParams.set('departurePoint', departurePoint);
    if (minPrice) queryParams.set('minPrice', minPrice);
    if (maxPrice) queryParams.set('maxPrice', maxPrice);
    if (petFriendly) queryParams.set('petFriendly', petFriendly);
    if (tourType) queryParams.set('tourType', tourType);
    if (locationCoords) {
      queryParams.set('lat', locationCoords.lat.toString());
      queryParams.set('lng', locationCoords.lng.toString());
      queryParams.set('radius', radius);
      if (locationName) queryParams.set('locationName', locationName);
    }
    navigate(`/tours?${queryParams.toString()}`);
    onClose?.();
  };

  const inputBase = 'w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm text-gray-900 bg-white focus:outline-none focus:ring-2 focus:ring-primary-400 focus:border-transparent transition placeholder-gray-400';
  const inputWithIcon = 'pl-10 ' + inputBase;
  const labelClass = 'block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5';

  return (
    <div className={`bg-white rounded-2xl shadow-lg overflow-hidden ${className}`}>
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
        <div className="flex items-center gap-2">
          <SlidersHorizontal className="w-4 h-4 text-primary-600" />
          <span className="font-semibold text-gray-900 text-sm">Filtrar Tours</span>
        </div>
        <div className="flex items-center gap-2">
          {hasActiveFilters && (
            <button
              type="button"
              onClick={handleClearAll}
              className="flex items-center gap-1.5 text-xs text-gray-500 hover:text-primary-600 transition-colors font-medium"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              Limpiar todo
            </button>
          )}
          {onClose && (
            <button type="button" onClick={onClose} className="p-1.5 hover:bg-gray-100 rounded-lg transition-colors">
              <X className="w-4 h-4 text-gray-500" />
            </button>
          )}
        </div>
      </div>

      <form onSubmit={handleSearch} className="p-5 space-y-5">

        {/* Busqueda por nombre */}
        <div>
          <label className={labelClass}>Nombre del Tour</label>
          <div className="relative">
            <FileSearch className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
            <input
              type="text"
              value={tourName}
              onChange={(e) => setTourName(e.target.value)}
              className={inputWithIcon}
              placeholder="Buscar por nombre..."
            />
            {tourName && (
              <button type="button" onClick={() => setTourName('')} className="absolute right-3 top-1/2 -translate-y-1/2">
                <X className="w-4 h-4 text-gray-400 hover:text-gray-600" />
              </button>
            )}
          </div>
        </div>

        {/* Destino */}
        <div>
          <label className={labelClass}>Destino</label>
          <div className="relative">
            <MapPin className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
            <input
              type="text"
              value={destination}
              onChange={(e) => setDestination(e.target.value)}
              className={inputWithIcon}
              placeholder="¿A dónde quieres ir?"
            />
            {destination && (
              <button type="button" onClick={() => setDestination('')} className="absolute right-3 top-1/2 -translate-y-1/2">
                <X className="w-4 h-4 text-gray-400 hover:text-gray-600" />
              </button>
            )}
          </div>
        </div>

        {/* Fechas */}
        <div>
          <label className={labelClass}>Fechas</label>
          <div className="grid grid-cols-2 gap-2">
            <div className="relative">
              <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
              <input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className={inputWithIcon + ' text-xs'}
                placeholder="Inicio"
              />
            </div>
            <div className="relative">
              <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
              <input
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                min={startDate}
                className={inputWithIcon + ' text-xs'}
                placeholder="Fin"
              />
            </div>
          </div>
        </div>

        {/* Rango de precio */}
        <div>
          <label className={labelClass}>Rango de Precio</label>
          <div className="grid grid-cols-2 gap-2">
            <div className="relative">
              <DollarSign className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
              <input
                type="number"
                value={minPrice}
                onChange={(e) => setMinPrice(e.target.value)}
                min="0"
                className={inputWithIcon}
                placeholder="Mínimo"
              />
            </div>
            <div className="relative">
              <DollarSign className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
              <input
                type="number"
                value={maxPrice}
                onChange={(e) => setMaxPrice(e.target.value)}
                min={minPrice || '0'}
                className={inputWithIcon}
                placeholder="Máximo"
              />
            </div>
          </div>
        </div>

        {/* Tipo de Tour — toggles */}
        <div>
          <label className={labelClass}>Tipo de Tour</label>
          <div className="grid grid-cols-3 gap-2">
            {[
              { value: '', label: 'Todos' },
              { value: 'excursion', label: 'Excursión' },
              { value: 'receptivo', label: 'Receptivo' },
            ].map((opt) => (
              <button
                key={opt.value}
                type="button"
                onClick={() => setTourType(opt.value)}
                className={`py-2 px-2 rounded-xl text-xs font-semibold border transition-all ${
                  tourType === opt.value
                    ? 'bg-primary-600 border-primary-600 text-white shadow-sm'
                    : 'bg-white border-gray-200 text-gray-600 hover:border-primary-300 hover:text-primary-600'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        {/* Pet Friendly — toggles */}
        <div>
          <label className={labelClass}>Mascotas</label>
          <div className="grid grid-cols-3 gap-2">
            {[
              { value: '', label: 'Todos' },
              { value: 'true', label: '🐾 Pet Friendly' },
              { value: 'false', label: 'Sin mascotas' },
            ].map((opt) => (
              <button
                key={opt.value}
                type="button"
                onClick={() => setPetFriendly(opt.value)}
                className={`py-2 px-2 rounded-xl text-xs font-semibold border transition-all ${
                  petFriendly === opt.value
                    ? 'bg-primary-600 border-primary-600 text-white shadow-sm'
                    : 'bg-white border-gray-200 text-gray-600 hover:border-primary-300 hover:text-primary-600'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        {/* Categoría */}
        <div>
          <label className={labelClass}>Categoría</label>
          <div className="relative">
            <Tag className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              className={inputWithIcon}
            >
              <option value="">Todas las Categorías</option>
              {categories.map((cat: any) => (
                <option key={cat.id} value={cat.slug}>{cat.name}</option>
              ))}
            </select>
          </div>
        </div>

        {/* Agencia */}
        <div ref={agencyInputRef}>
          <label className={labelClass}>Agencia</label>
          <div className="relative">
            <Building2 className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none z-10" />
            <input
              type="text"
              value={agencySearchText}
              onChange={handleAgencyInputChange}
              onFocus={() => setShowAgencyDropdown(true)}
              className={inputWithIcon}
              placeholder="Buscar agencia..."
              autoComplete="off"
            />
            {agency && (
              <button type="button" onClick={handleClearAgency} className="absolute right-3 top-1/2 -translate-y-1/2">
                <X className="w-4 h-4 text-gray-400 hover:text-gray-600" />
              </button>
            )}
            {showAgencyDropdown && filteredAgencies.length > 0 && (
              <div className="absolute z-50 top-full mt-1 w-full bg-white border border-gray-200 shadow-xl max-h-52 rounded-xl overflow-auto">
                {filteredAgencies.map((ag: any) => (
                  <div
                    key={ag.id}
                    onClick={() => handleAgencySelect(ag)}
                    className={`cursor-pointer px-4 py-2.5 text-sm hover:bg-blue-50 transition-colors ${
                      agency === ag.id ? 'bg-blue-50 font-semibold text-primary-700' : 'text-gray-800'
                    }`}
                  >
                    {ag.name}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Punto de Partida */}
        <div ref={departurePointInputRef}>
          <label className={labelClass}>Punto de Partida</label>
          <div className="relative">
            <MapPin className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none z-10" />
            <input
              type="text"
              value={departurePointSearchText}
              onChange={handleDeparturePointInputChange}
              onFocus={() => setShowDeparturePointDropdown(true)}
              className={inputWithIcon}
              placeholder="Ciudad de salida..."
              autoComplete="off"
            />
            {departurePoint && (
              <button type="button" onClick={handleClearDeparturePoint} className="absolute right-3 top-1/2 -translate-y-1/2">
                <X className="w-4 h-4 text-gray-400 hover:text-gray-600" />
              </button>
            )}
            {showDeparturePointDropdown && filteredDeparturePoints.length > 0 && (
              <div className="absolute z-50 top-full mt-1 w-full bg-white border border-gray-200 shadow-xl max-h-52 rounded-xl overflow-auto">
                {filteredDeparturePoints.map((point: any) => (
                  <div
                    key={point.id}
                    onClick={() => handleDeparturePointSelect(point)}
                    className={`cursor-pointer px-4 py-2.5 hover:bg-blue-50 transition-colors ${
                      departurePoint === point.name ? 'bg-blue-50' : ''
                    }`}
                  >
                    <div className={`text-sm ${departurePoint === point.name ? 'font-semibold text-primary-700' : 'text-gray-800'}`}>
                      {point.name}
                    </div>
                    {point.city && (
                      <div className="text-xs text-gray-500 mt-0.5">
                        {point.city}{point.municipality ? `, ${point.municipality}` : ''}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Boton buscar */}
        <button
          type="submit"
          className="w-full flex items-center justify-center gap-2 bg-primary-600 hover:bg-primary-700 active:bg-primary-800 text-white font-semibold py-3 px-4 rounded-xl transition-colors shadow-sm"
        >
          <Search className="w-4 h-4" />
          Buscar Tours
        </button>
      </form>
    </div>
  );
};

export default SearchBox;
