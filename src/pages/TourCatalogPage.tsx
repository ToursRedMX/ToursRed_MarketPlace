import React, { useEffect, useState, useMemo, useCallback } from 'react';
import { Link, useSearchParams, useNavigate } from 'react-router-dom';
import { Filter, MapPin, ChevronRight, ChevronLeft, X, SlidersHorizontal, Building2, Search } from 'lucide-react';
import SearchBox from '../components/SearchBox';
import TourCard from '../components/TourCard';
import { Tour, SearchFilters } from '../types';
import { getTours, getActiveFeaturedTours, supabase } from '../lib/supabase';
import { useTourPromotionsBatch } from '../hooks/useSharedData';
import Seo from '../components/Seo';

const SITE_URL = (import.meta.env.VITE_APP_URL || 'https://toursredmx.netlify.app/').replace(/\/$/, '');

const PAGE_SIZE = 20;

const TourCatalogPage: React.FC = () => {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const [tours, setTours] = useState<Tour[]>([]);
  const [featuredSlotMapCatalog, setFeaturedSlotMapCatalog] = useState<Record<string, string>>({});
  const [featuredCount, setFeaturedCount] = useState(0);
  const [totalCount, setTotalCount] = useState(0);
  const [currentPage, setCurrentPage] = useState(1);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [popularDestinations, setPopularDestinations] = useState<any[]>([]);
  const [categories, setCategories] = useState<any[]>([]);
  const [popularDeparturePoints, setPopularDeparturePoints] = useState<any[]>([]);

  const initialFilters: SearchFilters = useMemo(() => ({
    tourName: searchParams.get('tourName') || '',
    destination: searchParams.get('destination') || '',
    category: searchParams.get('category') || '',
    startDate: searchParams.get('startDate') || '',
    endDate: searchParams.get('endDate') || '',
    agency: searchParams.get('agency') || '',
    minPrice: searchParams.get('minPrice') || '',
    maxPrice: searchParams.get('maxPrice') || '',
    petFriendly: searchParams.get('petFriendly') || '',
    departurePoint: searchParams.get('departurePoint') || '',
    lat: searchParams.get('lat') || '',
    lng: searchParams.get('lng') || '',
    radius: searchParams.get('radius') || '',
    locationName: searchParams.get('locationName') || '',
    tourType: (searchParams.get('tourType') as 'excursion' | 'receptivo' | undefined) || undefined,
    activityType: (searchParams.get('activityType') as any) || undefined,
  }), [searchParams]);

  const hasGeoSearch = !!(initialFilters.lat && initialFilters.lng);

  const activeFilterCount = useMemo(() => [
    initialFilters.tourName, initialFilters.destination, initialFilters.category,
    initialFilters.startDate, initialFilters.endDate, initialFilters.agency,
    initialFilters.departurePoint, initialFilters.minPrice, initialFilters.maxPrice,
    initialFilters.petFriendly, initialFilters.tourType, (initialFilters as any).activityType,
  ].filter(Boolean).length, [initialFilters]);

  const activeFilterPills = useMemo(() => {
    const pills: { key: string; label: string }[] = [];
    if (initialFilters.tourName) pills.push({ key: 'tourName', label: `"${initialFilters.tourName}"` });
    if (initialFilters.destination) pills.push({ key: 'destination', label: `Destino: ${initialFilters.destination}` });
    if (initialFilters.category) pills.push({ key: 'category', label: `Cat: ${initialFilters.category}` });
    if (initialFilters.startDate) pills.push({ key: 'startDate', label: `Desde: ${initialFilters.startDate}` });
    if (initialFilters.endDate) pills.push({ key: 'endDate', label: `Hasta: ${initialFilters.endDate}` });
    if (initialFilters.agency) pills.push({ key: 'agency', label: 'Agencia seleccionada' });
    if (initialFilters.departurePoint) pills.push({ key: 'departurePoint', label: `Salida: ${initialFilters.departurePoint}` });
    if (initialFilters.minPrice) pills.push({ key: 'minPrice', label: `Desde $${initialFilters.minPrice}` });
    if (initialFilters.maxPrice) pills.push({ key: 'maxPrice', label: `Hasta $${initialFilters.maxPrice}` });
    if (initialFilters.petFriendly === 'true') pills.push({ key: 'petFriendly', label: 'Pet Friendly' });
    if (initialFilters.petFriendly === 'false') pills.push({ key: 'petFriendly', label: 'Sin mascotas' });
    if (initialFilters.tourType === 'excursion') pills.push({ key: 'tourType', label: 'Excursiones' });
    if (initialFilters.tourType === 'receptivo') pills.push({ key: 'tourType', label: 'Receptivos' });
    if (initialFilters.locationName) pills.push({ key: 'locationName', label: `Cerca de: ${initialFilters.locationName}` });
    return pills;
  }, [initialFilters]);

  const removeFilter = useCallback((key: string) => {
    const params = new URLSearchParams(searchParams.toString());
    params.delete(key);
    if (key === 'locationName') { params.delete('lat'); params.delete('lng'); params.delete('radius'); }
    navigate(`/tours?${params.toString()}`);
  }, [searchParams, navigate]);

  const clearAllFilters = useCallback(() => navigate('/tours'), [navigate]);

  useEffect(() => { setCurrentPage(1); }, [searchParams]);

  useEffect(() => {
    const fetchTours = async () => {
      try {
        setIsLoading(true);
        setError('');
        if (hasGeoSearch) {
          const { data, error } = await supabase.rpc('search_tours_by_departure_radius', {
            search_lat: parseFloat(initialFilters.lat!),
            search_lng: parseFloat(initialFilters.lng!),
            radius_km: parseFloat(initialFilters.radius || '5'),
            filter_category: initialFilters.category ? [initialFilters.category] : null,
            filter_destination: initialFilters.destination || null,
            min_price: initialFilters.minPrice ? parseFloat(initialFilters.minPrice) : null,
            max_price: initialFilters.maxPrice ? parseFloat(initialFilters.maxPrice) : null,
            limit_results: 100,
          });
          if (error) throw new Error(error.message);
          const transformedTours = data?.map((row: any) => ({
            id: row.tour_id, name: row.tour_name, description: row.tour_description,
            price: row.tour_price, category: row.tour_category, destination: row.tour_destination,
            image_url: row.tour_image_url, is_featured: row.tour_is_featured,
            start_date: row.tour_start_date, end_date: row.tour_end_date,
            agency_id: row.agency_id, agencies: { id: row.agency_id, name: row.agency_name },
            distance_meters: row.distance_meters,
            nearest_departure_location: row.nearest_departure_location,
            nearest_departure_address: row.nearest_departure_address,
            all_departure_locations: row.all_departure_locations,
          })) || [];
          setTours(transformedTours);
          setTotalCount(transformedTours.length);
          setFeaturedSlotMapCatalog({});
          setFeaturedCount(0);
        } else {
          const offset = (currentPage - 1) * PAGE_SIZE;
          const [toursResult, featuredResult] = await Promise.all([
            getTours({
              tourName: initialFilters.tourName || null,
              destination: initialFilters.destination || null,
              category: initialFilters.category || null,
              startDate: initialFilters.startDate || null,
              endDate: initialFilters.endDate || null,
              agency: initialFilters.agency || null,
              minPrice: initialFilters.minPrice || null,
              maxPrice: initialFilters.maxPrice || null,
              petFriendly: initialFilters.petFriendly || null,
              departurePoint: initialFilters.departurePoint || null,
              tourType: initialFilters.tourType || null,
              activityType: (initialFilters as any).activityType || null,
              limit: PAGE_SIZE,
              offset,
            }),
            activeFilterCount > 0 ? getActiveFeaturedTours() : Promise.resolve({ data: [], slotMap: {}, error: null }),
          ]);

          const { data, error, count } = toursResult;
          if (error) throw new Error(error.message);

          if (activeFilterCount > 0 && featuredResult.data.length > 0) {
            const queryTerms = [
              initialFilters.tourName,
              initialFilters.destination,
              initialFilters.category,
            ].filter(Boolean).map((s) => s!.toLowerCase());

            const matchingFeatured = featuredResult.data.filter((t) => {
              if (!queryTerms.length) return false;
              const haystack = `${t.name} ${t.destination} ${Array.isArray(t.category) ? t.category.join(' ') : (t.category || '')}`.toLowerCase();
              return queryTerms.some((q) => haystack.includes(q));
            });

            if (matchingFeatured.length > 0) {
              const featuredIds = new Set(matchingFeatured.map((t) => t.id));
              const organic = (data || []).filter((t) => !featuredIds.has(t.id));
              setTours([...matchingFeatured, ...organic]);
              setFeaturedSlotMapCatalog(featuredResult.slotMap);
              setFeaturedCount(matchingFeatured.length);
              setTotalCount((count ?? data?.length ?? 0) + matchingFeatured.length);
              return;
            }
          }

          setTours(data || []);
          setFeaturedSlotMapCatalog({});
          setFeaturedCount(0);
          setTotalCount(count ?? data?.length ?? 0);
        }
      } catch (err: any) {
        setError(err.message || 'Error al cargar los tours');
        setTours([]); setTotalCount(0); setFeaturedSlotMapCatalog({}); setFeaturedCount(0);
      } finally {
        setIsLoading(false);
      }
    };
    fetchTours();
  }, [searchParams, currentPage]);

  useEffect(() => {
    supabase.from('tour_categories').select('id, name, slug').eq('is_active', true).order('name')
      .then(({ data }) => { if (data) setCategories(data); });
  }, []);

  useEffect(() => {
    const fetchPopularDestinations = async () => {
      try {
        const { data: destinations } = await supabase.from('destinations').select('id, name').eq('is_active', true).order('name');
        if (!destinations?.length) return;
        const { data: tourDestinations } = await supabase.from('tour_destinations').select('destination_id').in('destination_id', destinations.map(d => d.id));
        const counts = (tourDestinations || []).reduce((acc: Record<string, number>, td: any) => { acc[td.destination_id] = (acc[td.destination_id] || 0) + 1; return acc; }, {});
        setPopularDestinations(
          destinations.map(d => ({ ...d, tour_count: counts[d.id] || 0 }))
            .filter(d => d.tour_count > 0).sort((a, b) => b.tour_count - a.tour_count).slice(0, 8)
        );
      } catch {}
    };
    fetchPopularDestinations();
  }, []);

  useEffect(() => {
    const fetchPopularDeparturePoints = async () => {
      try {
        const { data: points } = await supabase.from('departure_points').select('id, name, city, municipality').eq('is_active', true).order('name');
        if (!points?.length) return;
        const { data: tourPoints } = await supabase.from('tour_departure_points').select('departure_point_id').in('departure_point_id', points.map(p => p.id));
        const counts = (tourPoints || []).reduce((acc: Record<string, number>, tp: any) => { acc[tp.departure_point_id] = (acc[tp.departure_point_id] || 0) + 1; return acc; }, {});
        setPopularDeparturePoints(
          points.map(p => ({ ...p, tour_count: counts[p.id] || 0 }))
            .filter(p => p.tour_count > 0).sort((a, b) => b.tour_count - a.tour_count).slice(0, 6)
        );
      } catch {}
    };
    fetchPopularDeparturePoints();
  }, []);

  const filteredTours = tours;

  const { data: promotionsMap = {} } = useTourPromotionsBatch(filteredTours.map(t => t.id));
  const totalPages = Math.ceil(totalCount / PAGE_SIZE);

  const handlePageChange = (page: number) => {
    setCurrentPage(page);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') setDrawerOpen(false); };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, []);

  useEffect(() => {
    document.body.style.overflow = drawerOpen ? 'hidden' : '';
    return () => { document.body.style.overflow = ''; };
  }, [drawerOpen]);

  const catalogTitle = initialFilters.destination
    ? `Tours a ${initialFilters.destination} | ToursRed`
    : 'Tours Nacionales | ToursRed';

  const catalogDescription = initialFilters.destination
    ? `Descubre tours y excursiones a ${initialFilters.destination}. Compara precios, reserva en línea y vive experiencias auténticas con agencias verificadas.`
    : 'Descubre los mejores tours y excursiones en México. Compara precios, destinos y agencias verificadas. Reserva en línea con ToursRed.';

  return (
    <div className="bg-slate-50 min-h-screen">
      <Seo
        title={catalogTitle}
        description={catalogDescription}
        type="website"
        jsonLd={{
          '@context': 'https://schema.org',
          '@type': 'BreadcrumbList',
          itemListElement: [
            { '@type': 'ListItem', position: 1, name: 'Inicio', item: SITE_URL },
            { '@type': 'ListItem', position: 2, name: initialFilters.destination ? `Tours a ${initialFilters.destination}` : 'Tours Nacionales', item: `${SITE_URL}/tours${initialFilters.destination ? `?destination=${encodeURIComponent(initialFilters.destination)}` : ''}` },
          ],
        }}
      />

      {/* Page header */}
      <div className="bg-white border-b border-gray-100 shadow-sm">
        <div className="container-custom py-5">
          <nav className="flex mb-3" aria-label="Breadcrumb">
            <ol className="inline-flex items-center space-x-1 text-sm">
              <li><Link to="/" className="text-gray-400 hover:text-primary-600 transition-colors">Inicio</Link></li>
              <li><ChevronRight className="h-3.5 w-3.5 text-gray-300 mx-1" /></li>
              <li><span className="text-gray-700">Tours</span></li>
              <li><ChevronRight className="h-3.5 w-3.5 text-gray-300 mx-1" /></li>
              <li><span className="text-gray-900 font-medium">Tours Nacionales</span></li>
            </ol>
          </nav>
          <div className="flex flex-col sm:flex-row sm:items-end gap-3">
            <div>
              <h1 className="text-2xl sm:text-3xl font-bold text-gray-900 leading-tight">Tours Nacionales</h1>
              <p className="text-gray-500 text-sm mt-1">Descubre los mejores destinos en México</p>
            </div>
            <span className="sm:ml-auto px-3 py-1.5 bg-primary-50 text-primary-700 rounded-full text-xs font-semibold border border-primary-100 self-start sm:self-auto whitespace-nowrap">
              Destinos en México
            </span>
          </div>
        </div>
      </div>

      {/* Quick categories strip */}
      {categories.length > 0 && (
        <div className="bg-white border-b border-gray-100 overflow-x-auto">
          <div className="container-custom">
            <div className="flex gap-2 py-3 w-max min-w-full">
              <a href="/tours" className={`flex-shrink-0 px-4 py-1.5 rounded-full text-xs font-semibold border transition-all ${!initialFilters.category ? 'bg-primary-600 text-white border-primary-600' : 'bg-white text-gray-600 border-gray-200 hover:border-primary-300 hover:text-primary-600'}`}>
                Todos
              </a>
              {categories.map((cat: any) => (
                <a key={cat.id} href={`/tours?category=${cat.slug}`}
                  className={`flex-shrink-0 px-4 py-1.5 rounded-full text-xs font-semibold border transition-all ${initialFilters.category === cat.slug ? 'bg-primary-600 text-white border-primary-600' : 'bg-white text-gray-600 border-gray-200 hover:border-primary-300 hover:text-primary-600'}`}>
                  {cat.name}
                </a>
              ))}
            </div>
          </div>
        </div>
      )}

      <div className="container-custom py-6">

        {/* Active filter pills */}
        {activeFilterPills.length > 0 && (
          <div className="flex flex-wrap items-center gap-2 mb-5 p-3 bg-white rounded-xl border border-gray-100 shadow-sm">
            <span className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Filtros activos:</span>
            {activeFilterPills.map((pill) => (
              <span key={pill.key} className="inline-flex items-center gap-1.5 pl-3 pr-2 py-1 bg-primary-50 text-primary-700 text-xs font-medium rounded-full border border-primary-100">
                {pill.label}
                <button onClick={() => removeFilter(pill.key)} className="hover:bg-primary-200 rounded-full p-0.5 transition-colors"><X className="w-3 h-3" /></button>
              </span>
            ))}
            <button onClick={clearAllFilters} className="ml-auto text-xs text-gray-400 hover:text-red-500 transition-colors font-medium flex items-center gap-1">
              <X className="w-3 h-3" /> Limpiar todo
            </button>
          </div>
        )}

        <div className="flex gap-6">

          {/* Sidebar desktop */}
          <aside className="hidden lg:block w-72 xl:w-80 flex-shrink-0">
            <div className="sticky top-4 space-y-4">
              <SearchBox initialFilters={initialFilters} />

              {popularDestinations.length > 0 && (
                <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-4">
                  <div className="flex items-center gap-2 mb-3">
                    <MapPin className="w-4 h-4 text-primary-600" />
                    <h3 className="font-semibold text-gray-900 text-sm">Destinos Populares</h3>
                  </div>
                  <div className="space-y-0.5">
                    {popularDestinations.map((destination) => (
                      <a key={destination.id} href={`/tours?destination=${encodeURIComponent(destination.name)}`}
                        className={`flex items-center justify-between px-3 py-2 rounded-xl text-sm transition-colors group ${initialFilters.destination === destination.name ? 'bg-primary-50 text-primary-700 font-medium' : 'text-gray-700 hover:bg-gray-50 hover:text-primary-600'}`}>
                        <span>{destination.name}</span>
                        <span className="text-xs text-gray-400 group-hover:text-primary-500 transition-colors">{destination.tour_count}</span>
                      </a>
                    ))}
                  </div>
                </div>
              )}

              {popularDeparturePoints.length > 0 && (
                <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-4">
                  <div className="flex items-center gap-2 mb-3">
                    <Building2 className="w-4 h-4 text-primary-600" />
                    <h3 className="font-semibold text-gray-900 text-sm">Puntos de Partida</h3>
                  </div>
                  <div className="space-y-0.5">
                    {popularDeparturePoints.map((point) => (
                      <a key={point.id} href={`/tours?departurePoint=${encodeURIComponent(point.name)}`}
                        className="flex items-center justify-between px-3 py-2 rounded-xl text-sm text-gray-700 hover:bg-gray-50 hover:text-primary-600 transition-colors group">
                        <div className="min-w-0 flex-1 mr-2">
                          <div className="truncate">{point.name}</div>
                          {point.city && <div className="text-xs text-gray-400 truncate">{point.city}</div>}
                        </div>
                        <span className="text-xs text-gray-400 group-hover:text-primary-500 flex-shrink-0">{point.tour_count}</span>
                      </a>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </aside>

          {/* Main content */}
          <div className="flex-1 min-w-0">

            {/* Toolbar */}
            <div className="flex items-center gap-3 mb-5 flex-wrap">
              <button
                onClick={() => setDrawerOpen(true)}
                className="lg:hidden flex items-center gap-2 px-4 py-2.5 bg-white border border-gray-200 rounded-xl text-sm font-semibold text-gray-700 hover:border-primary-300 transition-colors shadow-sm relative flex-shrink-0"
              >
                <SlidersHorizontal className="w-4 h-4" />
                Filtros
                {activeFilterCount > 0 && (
                  <span className="absolute -top-1.5 -right-1.5 w-5 h-5 bg-primary-600 text-white text-[10px] font-bold rounded-full flex items-center justify-center">
                    {activeFilterCount}
                  </span>
                )}
              </button>

              <p className="text-sm text-gray-500 flex-1 min-w-0">
                {isLoading ? (
                  <span className="inline-block w-32 h-4 bg-gray-200 rounded animate-pulse" />
                ) : (
                  <>
                    {!hasGeoSearch && totalCount > PAGE_SIZE
                      ? <><span className="font-semibold text-gray-900">{(currentPage - 1) * PAGE_SIZE + 1}–{Math.min(currentPage * PAGE_SIZE, totalCount)}</span> de <span className="font-semibold text-gray-900">{totalCount}</span> tours</>
                      : <><span className="font-semibold text-gray-900">{filteredTours.length}</span> {filteredTours.length === 1 ? 'tour encontrado' : 'tours encontrados'}</>
                    }
                    {hasGeoSearch && initialFilters.locationName && <span className="text-gray-400"> · cerca de "{initialFilters.locationName}"</span>}
                  </>
                )}
              </p>

              <select className="text-xs font-medium text-gray-700 border border-gray-200 rounded-xl px-3 py-2.5 bg-white focus:outline-none focus:ring-2 focus:ring-primary-400 focus:border-transparent transition shadow-sm flex-shrink-0">
                <option value="recommended">Recomendados</option>
                <option value="price-low">Precio: Menor a Mayor</option>
                <option value="price-high">Precio: Mayor a Menor</option>
                <option value="rating">Mejor Calificados</option>
                <option value="newest">Más Recientes</option>
              </select>
            </div>

            {/* Tour type quick-filter */}
            <div className="flex items-center gap-2 mb-5 flex-wrap">
              {[
                { value: '', label: 'Todos' },
                { value: 'excursion', label: 'Excursiones' },
                { value: 'receptivo', label: 'Receptivos' },
              ].map(opt => (
                <a
                  key={opt.value}
                  href={opt.value ? `/tours?${new URLSearchParams({ ...Object.fromEntries(new URLSearchParams(window.location.search)), tourType: opt.value }).toString()}` : '/tours'}
                  className={`px-3 py-1.5 rounded-full text-xs font-semibold border transition-all ${
                    (opt.value === '' && !initialFilters.tourType) || initialFilters.tourType === opt.value
                      ? 'bg-primary-600 text-white border-primary-600'
                      : 'bg-white text-gray-600 border-gray-200 hover:border-primary-300 hover:text-primary-600'
                  }`}
                >
                  {opt.label}
                </a>
              ))}
              {initialFilters.tourType === 'receptivo' && (
                <>
                  <span className="text-xs text-gray-300 mx-1">|</span>
                  {[
                    { value: 'guided_tour', label: 'Tour Guiado' },
                    { value: 'experience', label: 'Experiencias' },
                    { value: 'transport', label: 'Traslados' },
                    { value: 'ticket', label: 'Entradas' },
                  ].map(opt => {
                    const params = new URLSearchParams(window.location.search);
                    const currentAT = params.get('activityType');
                    params.set('activityType', opt.value);
                    return (
                      <a
                        key={opt.value}
                        href={currentAT === opt.value
                          ? (() => { const p = new URLSearchParams(window.location.search); p.delete('activityType'); return `/tours?${p.toString()}`; })()
                          : `/tours?${params.toString()}`
                        }
                        className={`px-3 py-1.5 rounded-full text-xs font-semibold border transition-all ${
                          currentAT === opt.value
                            ? opt.value === 'experience' ? 'bg-violet-600 text-white border-violet-600'
                            : opt.value === 'transport' ? 'bg-blue-600 text-white border-blue-600'
                            : opt.value === 'ticket' ? 'bg-orange-600 text-white border-orange-600'
                            : 'bg-teal-600 text-white border-teal-600'
                            : 'bg-white text-gray-600 border-gray-200 hover:border-gray-300'
                        }`}
                      >
                        {opt.label}
                      </a>
                    );
                  })}
                </>
              )}
            </div>

            {/* Results */}
            {isLoading ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-5">
                {Array.from({ length: 6 }).map((_, i) => (
                  <div key={i} className="bg-white rounded-2xl overflow-hidden shadow-sm animate-pulse">
                    <div className="aspect-[4/3] bg-gray-200" />
                    <div className="p-4 space-y-3">
                      <div className="h-4 bg-gray-200 rounded w-3/4" />
                      <div className="h-3 bg-gray-200 rounded w-1/2" />
                      <div className="h-3 bg-gray-200 rounded w-2/3" />
                      <div className="h-9 bg-gray-200 rounded mt-4" />
                    </div>
                  </div>
                ))}
              </div>
            ) : error ? (
              <div className="bg-white rounded-2xl border border-gray-100 p-10 text-center">
                <div className="w-14 h-14 bg-red-50 rounded-2xl flex items-center justify-center mx-auto mb-4">
                  <X className="w-7 h-7 text-red-400" />
                </div>
                <p className="text-gray-900 font-semibold mb-2">Error al cargar los tours</p>
                <p className="text-gray-500 text-sm mb-6">{error}</p>
                <button onClick={() => window.location.reload()} className="btn btn-primary">Reintentar</button>
              </div>
            ) : filteredTours.length === 0 ? (
              <div className="bg-white rounded-2xl border border-gray-100 p-10 text-center">
                <div className="w-14 h-14 bg-blue-50 rounded-2xl flex items-center justify-center mx-auto mb-4">
                  <Search className="w-7 h-7 text-blue-400" />
                </div>
                <p className="text-gray-900 font-semibold text-lg mb-2">
                  {tours.length === 0 ? 'No hay tours disponibles' : 'Sin resultados'}
                </p>
                <p className="text-gray-500 text-sm mb-6">
                  {tours.length === 0 ? 'Las agencias aún no han publicado tours. ¡Vuelve pronto!' : 'Intenta ajustar o limpiar los filtros para ver más opciones.'}
                </p>
                <a href="/tours" className="btn btn-primary">Ver todos los tours</a>
              </div>
            ) : (
              <>
                <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-5">
                  {featuredCount > 0 && (
                    <div className="col-span-full flex items-center gap-2 mb-1">
                      <span className="inline-flex items-center gap-1.5 px-3 py-1 bg-amber-50 text-amber-700 text-xs font-semibold rounded-full border border-amber-200">
                        Tours Destacados primero
                      </span>
                      <span className="text-xs text-gray-400">{featuredCount} destacado{featuredCount !== 1 ? 's' : ''} coinciden con tu búsqueda</span>
                    </div>
                  )}
                  {filteredTours.map((tour) => {
                    const slotId = featuredSlotMapCatalog[tour.id];
                    return (
                      <TourCard
                        key={tour.id}
                        tour={tour}
                        showDistance={hasGeoSearch}
                        activePromo={promotionsMap[tour.id] ?? null}
                        isFeaturedTour={!!slotId}
                        featuredSlotId={slotId}
                      />
                    );
                  })}
                </div>

                {!hasGeoSearch && totalPages > 1 && (
                  <div className="mt-8 flex justify-center items-center gap-2">
                    <button
                      onClick={() => handlePageChange(currentPage - 1)}
                      disabled={currentPage === 1}
                      className="flex items-center gap-1.5 px-4 py-2 rounded-xl border border-gray-200 bg-white text-sm font-medium text-gray-700 disabled:opacity-40 hover:border-primary-300 hover:text-primary-600 transition-colors"
                    >
                      <ChevronLeft className="h-4 w-4" />
                      <span className="hidden sm:inline">Anterior</span>
                    </button>

                    <div className="flex items-center gap-1">
                      {Array.from({ length: totalPages }, (_, i) => i + 1)
                        .filter(page => page === 1 || page === totalPages || Math.abs(page - currentPage) <= 1)
                        .reduce<(number | string)[]>((acc, page, idx, arr) => {
                          if (idx > 0 && (page as number) - (arr[idx - 1] as number) > 1) acc.push('...');
                          acc.push(page);
                          return acc;
                        }, [])
                        .map((item, idx) =>
                          typeof item === 'string' ? (
                            <span key={`ellipsis-${idx}`} className="px-2 text-gray-400 text-sm">…</span>
                          ) : (
                            <button key={item} onClick={() => handlePageChange(item)}
                              className={`w-9 h-9 rounded-xl text-sm font-semibold transition-colors ${item === currentPage ? 'bg-primary-600 text-white' : 'bg-white border border-gray-200 text-gray-700 hover:border-primary-300 hover:text-primary-600'}`}>
                              {item}
                            </button>
                          )
                        )}
                    </div>

                    <button
                      onClick={() => handlePageChange(currentPage + 1)}
                      disabled={currentPage === totalPages}
                      className="flex items-center gap-1.5 px-4 py-2 rounded-xl border border-gray-200 bg-white text-sm font-medium text-gray-700 disabled:opacity-40 hover:border-primary-300 hover:text-primary-600 transition-colors"
                    >
                      <span className="hidden sm:inline">Siguiente</span>
                      <ChevronRight className="h-4 w-4" />
                    </button>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      </div>

      {/* Mobile filter drawer */}
      {drawerOpen && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={() => setDrawerOpen(false)} />
          <div className="absolute inset-x-0 bottom-0 max-h-[92vh] bg-slate-50 rounded-t-3xl shadow-2xl flex flex-col overflow-hidden">
            <div className="flex items-center justify-between px-5 py-4 bg-white border-b border-gray-100 flex-shrink-0 rounded-t-3xl">
              <div className="flex items-center gap-2">
                <Filter className="w-4 h-4 text-primary-600" />
                <span className="font-bold text-gray-900">Filtros</span>
                {activeFilterCount > 0 && (
                  <span className="px-2 py-0.5 bg-primary-100 text-primary-700 text-xs font-bold rounded-full">{activeFilterCount}</span>
                )}
              </div>
              <button onClick={() => setDrawerOpen(false)} className="p-2 hover:bg-gray-100 rounded-xl transition-colors">
                <X className="w-5 h-5 text-gray-600" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-4 space-y-4">
              {popularDestinations.length > 0 && (
                <div>
                  <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2 flex items-center gap-1.5">
                    <MapPin className="w-3.5 h-3.5" /> Destinos populares
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {popularDestinations.map(d => (
                      <a key={d.id} href={`/tours?destination=${encodeURIComponent(d.name)}`}
                        onClick={() => setDrawerOpen(false)}
                        className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-all ${initialFilters.destination === d.name ? 'bg-primary-600 text-white border-primary-600' : 'bg-white text-gray-700 border-gray-200 hover:border-primary-300'}`}>
                        {d.name}
                      </a>
                    ))}
                  </div>
                </div>
              )}
              <SearchBox initialFilters={initialFilters} onClose={() => setDrawerOpen(false)} />
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default TourCatalogPage;
