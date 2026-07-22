import React, { useEffect, useState } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { MapPin, Calendar, Users, Building, Star, Clock, Globe, MessageCircle, ChevronLeft, ChevronRight, CreditCard as Edit, Heart, ExternalLink, Share2, RefreshCw, Lock, Car, AlertTriangle, Sparkles, Tag, Bus } from 'lucide-react';
import BookingForm from '../components/BookingForm';
import AgencyReviews from '../components/AgencyReviews';
import ShareTourModal from '../components/ShareTourModal';
import { Tour } from '../types';
import { getTourById, getTourBySlug, resolveTourSlug, supabase, parseDateFromDB } from '../lib/supabase';
import { isCrawler } from '../utils/isCrawler';
import { useAuth } from '../context/AuthContext';
import { formatCurrencyMXN } from '../utils/formatCurrency';
import { format } from 'date-fns';
import Seo from '../components/Seo';

const SITE_URL = (import.meta.env.VITE_APP_URL || 'https://toursredmx.netlify.app/').replace(/\/$/, '');

interface DeparturePointInfo {
  id: string;
  name: string;
  city: string;
  municipality: string;
  google_maps_url?: string;
  display_order: number;
  departure_time?: string;
  special_instructions?: string;
}

const TourDetailPage: React.FC = () => {
  const { slug } = useParams<{ slug: string }>();
  const { user, isAgency } = useAuth();
  const navigate = useNavigate();
  const [tour, setTour] = useState<Tour | null>(null);
  const [departurePointsInfo, setDeparturePointsInfo] = useState<DeparturePointInfo[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');
  const [activeTab, setActiveTab] = useState('description');
  const [activeImageIndex, setActiveImageIndex] = useState(0);
  const [isOwner, setIsOwner] = useState(false);
  const [agencyUserId, setAgencyUserId] = useState<string | null>(null);
  const [isCreatingChat, setIsCreatingChat] = useState(false);
  const [availableSpots, setAvailableSpots] = useState<number | null>(null);
  const [totalCapacity, setTotalCapacity] = useState<number>(0);
  const [isSaved, setIsSaved] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isShareModalOpen, setIsShareModalOpen] = useState(false);
  const [categoryMap, setCategoryMap] = useState<{ [key: string]: string }>({});

  // Load categories from database
  useEffect(() => {
    const loadCategories = async () => {
      const { data } = await supabase
        .from('tour_categories')
        .select('slug, name')
        .eq('is_active', true);

      if (data) {
        const map: { [key: string]: string } = {};
        data.forEach(cat => {
          map[cat.slug] = cat.name;
        });
        setCategoryMap(map);
      }
    };

    loadCategories();
  }, []);

  // Helper function to get category name
  const getCategoryName = (category: string) => {
    return categoryMap[category] || category;
  };

  // Helper function to format categories array
  const formatCategories = (categories: string | string[]) => {
    const categoryArray = Array.isArray(categories) ? categories : [categories];
    return categoryArray.map(cat => getCategoryName(cat)).join(', ');
  };

  useEffect(() => {
    const fetchTour = async () => {
      // Salvaguarda: slug vacío o literal "undefined"/"null" → no buscar
      if (!slug || slug === 'undefined' || slug === 'null') {
        setError('Tour no encontrado');
        setIsLoading(false);
        return;
      }

      try {
        setIsLoading(true);
        setError('');

        // Detectar si el param es UUID (legacy) o slug
        const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(slug);
        const { data, error } = isUuid ? await getTourById(slug) : await getTourBySlug(slug);

        if (error) {
          throw new Error(error.message);
        }

        if (!data) {
          if (!isUuid) {
            const resolvedSlug = await resolveTourSlug(slug);
            if (resolvedSlug && resolvedSlug !== slug) {
              navigate(`/tours/${resolvedSlug}`, { replace: true });
              return;
            }
          }
          throw new Error('Tour no encontrado');
        }
        
        console.log('✅ Tour cargado desde BD:', data);
        setTour(data);

        // Load departure points information
        try {
          const { data: tourDeparturePoints, error: dpError } = await supabase
            .from('tour_departure_points')
            .select(`
              display_order,
              departure_time,
              special_instructions,
              departure_points (
                id,
                name,
                city,
                municipality,
                google_maps_url
              )
            `)
            .eq('tour_id', data.id)
            .order('display_order');

          if (!dpError && tourDeparturePoints) {
            const pointsInfo: DeparturePointInfo[] = tourDeparturePoints
              .filter(tdp => tdp.departure_points)
              .map(tdp => ({
                ...(tdp.departure_points as any),
                display_order: tdp.display_order,
                departure_time: tdp.departure_time || undefined,
                special_instructions: tdp.special_instructions || undefined,
              }));
            setDeparturePointsInfo(pointsInfo);
          }
        } catch (dpErr) {
          console.error('Error loading departure points:', dpErr);
        }

        // Obtener información de la agencia y verificar propiedad
        const { data: agencyData } = await supabase
          .from('agencies')
          .select('id, user_id')
          .eq('id', data.agency_id)
          .single();

        if (agencyData) {
          setAgencyUserId(agencyData.user_id);

          // Verificar si el usuario actual es el propietario del tour
          if (user && isAgency && agencyData.user_id === user.id) {
            setIsOwner(true);
          }
        }
        
      } catch (err: any) {
        console.error('❌ Error en fetchTour:', err);
        setError(err.message || 'Error al cargar los detalles del tour');
      } finally {
        setIsLoading(false);
      }
    };

    fetchTour();
  }, [slug, user, isAgency]);

  useEffect(() => {
    if (user && tour) {
      checkIfSaved();
    }
  }, [user, tour]);

  const checkIfSaved = async () => {
    if (!user || !tour) return;

    const { data } = await supabase
      .from('saved_tours')
      .select('id')
      .eq('user_id', user.id)
      .eq('tour_id', tour.id)
      .maybeSingle();

    setIsSaved(!!data);
  };

  const handleSaveToggle = async () => {
    if (!user) {
      alert('Debes iniciar sesión para guardar tours');
      return;
    }

    if (!tour) return;

    setIsSaving(true);

    try {
      if (isSaved) {
        const { error } = await supabase
          .from('saved_tours')
          .delete()
          .eq('user_id', user.id)
          .eq('tour_id', tour.id);

        if (error) throw error;
        setIsSaved(false);
      } else {
        const { error } = await supabase
          .from('saved_tours')
          .insert({
            user_id: user.id,
            tour_id: tour.id
          });

        if (error) throw error;
        setIsSaved(true);
      }
    } catch (error) {
      console.error('Error saving tour:', error);
      alert('Error al guardar el tour');
    } finally {
      setIsSaving(false);
    }
  };

  useEffect(() => {
    if (!tour || tour.tour_type === 'receptivo') return;

    const fetchAvailability = async () => {
      try {
        const { data, error } = await supabase
          .rpc('get_tour_availability', { p_tour_id: tour.id });

        if (error) {
          console.error('Error fetching availability from RPC:', error);
          return;
        }

        if (data && data.length > 0) {
          const availability = data[0];
          setTotalCapacity(availability.max_capacity);
          setAvailableSpots(availability.available_spots);
        }

      } catch (err) {
        console.error('Error loading availability:', err);
      }
    };

    fetchAvailability();

    if (isCrawler()) return;

    const channel = supabase
      .channel(`tour_detail_availability:${tour.id}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'bookings',
          filter: `tour_id=eq.${tour.id}`,
        },
        () => {
          fetchAvailability();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [tour?.id]);

  const handleContactAgency = async () => {
    if (!user) {
      navigate('/login');
      return;
    }

    if (!agencyUserId || !tour) {
      setError('No se pudo obtener información de la agencia');
      return;
    }

    try {
      setIsCreatingChat(true);
      
      // Verificar si ya existe una conversación entre el usuario y la agencia para este tour
      const { data: existingConversation, error: searchError } = await supabase
        .from('conversations')
        .select('id')
        .eq('tour_id', tour.id)
        .eq('created_by', user.id)
        .eq('status', 'active')
        .maybeSingle();

      if (searchError) {
        console.error('Error buscando conversación existente:', searchError);
      }

      let conversationId: string;

      if (existingConversation) {
        // Si ya existe una conversación, usarla
        conversationId = existingConversation.id;
        console.log('✅ Usando conversación existente:', conversationId);
      } else {
        // Crear nueva conversación
        const { data, error } = await supabase.rpc('create_conversation_with_participants', {
          p_title: `Consulta sobre: ${tour.name}`,
          p_type: 'general',
          p_booking_id: null,
          p_tour_id: tour.id,
          p_participant_ids: [agencyUserId]
        });

        if (error) {
          throw new Error(error.message);
        }

        conversationId = data;
        console.log('✅ Nueva conversación creada:', conversationId);
      }

      // Redirigir a la página de mensajes con la conversación seleccionada
      navigate(`/messages?conversation=${conversationId}`);
      
    } catch (err: any) {
      console.error('❌ Error creando conversación:', err);
      setError(err.message || 'Error al iniciar conversación con la agencia');
    } finally {
      setIsCreatingChat(false);
    }
  };

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-primary-600"></div>
      </div>
    );
  }

  if (error || !tour) {
    return (
      <div className="container-custom py-12">
        <div className="bg-white rounded-lg shadow-md p-6 text-center">
          <p className="text-error-600 mb-4">
            {error || 'Tour no encontrado'}
          </p>
          <p className="text-gray-600 mb-6">
            El tour que buscas no existe o no está disponible.
          </p>
          <Link to="/tours" className="btn btn-primary">
            Volver a Tours
          </Link>
        </div>
      </div>
    );
  }

  const galleryImages = tour.gallery || [tour.image_url];

  const nextImage = () => {
    setActiveImageIndex((prevIndex) => 
      prevIndex === galleryImages.length - 1 ? 0 : prevIndex + 1
    );
  };

  const prevImage = () => {
    setActiveImageIndex((prevIndex) => 
      prevIndex === 0 ? galleryImages.length - 1 : prevIndex - 1
    );
  };

  // Helper function to format dates consistently
  const formatDate = (dateString: string | null | undefined) => {
    if (!dateString) return '';
    try {
      const [year, month, day] = dateString.split('-').map(Number);
      // Create date at midnight UTC
      const date = new Date(Date.UTC(year, month - 1, day));
      // Format using UTC to avoid timezone conversion
      const monthName = date.toLocaleString('en-US', { month: 'short', timeZone: 'UTC' });
      const dayNum = date.toLocaleString('en-US', { day: 'numeric', timeZone: 'UTC' });
      const yearNum = date.toLocaleString('en-US', { year: 'numeric', timeZone: 'UTC' });
      return `${monthName} ${dayNum}, ${yearNum}`;
    } catch (error) {
      console.error('Error formatting date:', dateString, error);
      return dateString;
    }
  };

  const calculateDuration = () => {
    try {
      if (!tour.start_date || !tour.end_date) return 1;
      // Parse dates in UTC
      const [startYear, startMonth, startDay] = tour.start_date.split('-').map(Number);
      const [endYear, endMonth, endDay] = tour.end_date.split('-').map(Number);

      const start = new Date(Date.UTC(startYear, startMonth - 1, startDay));
      const end = new Date(Date.UTC(endYear, endMonth - 1, endDay));
      const diffTime = Math.abs(end.getTime() - start.getTime());
      const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

      return diffDays === 0 ? 1 : diffDays + 1;
    } catch (error) {
      console.error('Error calculating duration:', error);
      return 1;
    }
  };

  const getBookingDeadline = () => {
    if (tour.booking_deadline) {
      return formatDate(tour.booking_deadline);
    }
    if (!tour.start_date) return '';
    try {
      const startDate = parseDateFromDB(tour.start_date);
      const deadline = new Date(startDate);
      deadline.setDate(deadline.getDate() - 14);
      return format(deadline, 'MMM d, yyyy');
    } catch (error) {
      console.error('Error calculating booking deadline:', error);
      return '';
    }
  };

  // Función para obtener los elementos incluidos
  const getIncludedItems = () => {
    if (tour.includes && tour.includes.length > 0) {
      return tour.includes;
    }
    // Elementos por defecto si no hay datos personalizados
    return [
      `Alojamiento por ${calculateDuration()} ${calculateDuration() === 1 ? 'día' : 'días'}`,
      'Transporte durante el tour',
      'Guía profesional de turismo',
      'Desayuno y almuerzo diarios',
      'Todas las entradas a atracciones'
    ];
  };

  // Función para obtener los elementos no incluidos
  const getExcludedItems = () => {
    if (tour.excludes && tour.excludes.length > 0) {
      return tour.excludes;
    }
    // Elementos por defecto si no hay datos personalizados
    return [
      'Vuelos hacia y desde el destino',
      'Seguro de viaje',
      'Gastos de cena',
      'Gastos personales y souvenirs'
    ];
  };

  const seoDescription = tour.description
    ? `${tour.description.slice(0, 150)}${tour.description.length > 150 ? '...' : ''} ${tour.destination ? `- ${tour.destination}` : ''}`
    : `${tour.name} en ${tour.destination}. Reserva en línea con ToursRed.`;

  const tourJsonLd: object[] = [
    {
      '@context': 'https://schema.org',
      '@type': 'Product',
      name: tour.name,
      image: tour.image_url || undefined,
      description: seoDescription,
      brand: { '@type': 'Brand', name: tour.agencies?.name || 'ToursRed' },
      offers: {
        '@type': 'Offer',
        price: tour.price,
        priceCurrency: 'MXN',
        availability: (availableSpots !== null && availableSpots > 0) ? 'https://schema.org/InStock' : 'https://schema.org/PreOrder',
        url: `${SITE_URL}/tours/${tour.slug}`,
      },
    },
    {
      '@context': 'https://schema.org',
      '@type': 'BreadcrumbList',
      itemListElement: [
        { '@type': 'ListItem', position: 1, name: 'Inicio', item: SITE_URL },
        { '@type': 'ListItem', position: 2, name: 'Tours', item: `${SITE_URL}/tours` },
        { '@type': 'ListItem', position: 3, name: tour.destination || 'Destinos', item: `${SITE_URL}/tours?destination=${encodeURIComponent(tour.destination || '')}` },
        { '@type': 'ListItem', position: 4, name: tour.name, item: `${SITE_URL}/tours/${tour.slug}` },
      ],
    },
  ];

  if (tour.itinerary) {
    tourJsonLd.push({
      '@context': 'https://schema.org',
      '@type': 'TouristTrip',
      name: tour.name,
      description: seoDescription,
      provider: { '@type': 'LocalBusiness', name: tour.agencies?.name || 'ToursRed' },
      itinerary: tour.itinerary,
    });
  }

  return (
    <>
      <Seo
        title={`${tour.name} | ToursRed`}
        description={seoDescription}
        image={tour.image_url}
        type="product"
        jsonLd={tourJsonLd}
      />
      <div className="bg-gray-50 pb-12">
      {/* Tour Image Gallery */}
      <div className="relative bg-gray-900 h-[300px] md:h-[400px] lg:h-[500px]">
        <img
          src={galleryImages[activeImageIndex]}
          alt={tour.name}
          className="w-full h-full object-cover"
          onError={(e) => {
            // Fallback image if the tour image fails to load
            e.currentTarget.src = 'https://images.pexels.com/photos/1271619/pexels-photo-1271619.jpeg';
          }}
        />
        
        {galleryImages.length > 1 && (
          <>
            <button
              onClick={prevImage}
              className="absolute left-4 top-1/2 transform -translate-y-1/2 bg-white/80 hover:bg-white rounded-full p-2 text-gray-800"
              aria-label="Imagen anterior"
            >
              <ChevronLeft className="h-6 w-6" />
            </button>
            <button
              onClick={nextImage}
              className="absolute right-4 top-1/2 transform -translate-y-1/2 bg-white/80 hover:bg-white rounded-full p-2 text-gray-800"
              aria-label="Siguiente imagen"
            >
              <ChevronRight className="h-6 w-6" />
            </button>
            
            <div className="absolute bottom-4 left-1/2 transform -translate-x-1/2 flex space-x-2">
              {galleryImages.map((_, index) => (
                <button
                  key={index}
                  onClick={() => setActiveImageIndex(index)}
                  className={`w-2 h-2 rounded-full ${
                    index === activeImageIndex ? 'bg-white' : 'bg-white/50'
                  }`}
                  aria-label={`Ir a imagen ${index + 1}`}
                />
              ))}
            </div>
          </>
        )}

        {/* Botón de editar para el propietario */}
        {isOwner && (
          <div className="absolute top-4 right-4">
            <Link
              to="/agency/tours"
              className="bg-white/90 hover:bg-white rounded-full p-3 text-gray-800 shadow-lg transition-all"
              title="Editar este tour"
            >
              <Edit className="h-5 w-5" />
            </Link>
          </div>
        )}
      </div>
      
      <div className="container-custom -mt-10 relative z-10">
        <div className="bg-white rounded-t-lg shadow-md p-6">
          <div className="flex flex-col md:flex-row md:items-start md:justify-between">
            <div className="flex-1">
              <div className="flex items-center text-sm text-gray-500 mb-2">
                <MapPin className="h-4 w-4 mr-1" />
                <span>{tour.destination}</span>
              </div>
              <div className="flex items-start justify-between gap-4">
                <h1 className="text-2xl md:text-3xl font-bold mb-2 flex-1">{tour.name}</h1>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setIsShareModalOpen(true)}
                    className="flex-shrink-0 p-2 hover:bg-gray-100 rounded-full transition-all"
                    title="Compartir tour"
                  >
                    <Share2 className="w-6 h-6 text-gray-400 hover:text-gray-700" />
                  </button>
                  {user && !isOwner && (
                    <button
                      onClick={handleSaveToggle}
                      disabled={isSaving}
                      className="flex-shrink-0 p-2 hover:bg-gray-100 rounded-full transition-all disabled:opacity-50"
                      title={isSaved ? 'Quitar de guardados' : 'Guardar tour'}
                    >
                      <Heart
                        className={`w-7 h-7 transition-all ${
                          isSaved ? 'fill-red-500 text-red-500' : 'text-gray-400 hover:text-red-500'
                        }`}
                      />
                    </button>
                  )}
                </div>
              </div>
              <div className="flex items-center mb-4">
                <div className="flex">
                  {[1, 2, 3, 4, 5].map((star) => (
                    <Star
                      key={star}
                      className={`h-4 w-4 ${
                        star <= Math.round(tour.agencies?.rating || 0)
                          ? 'text-yellow-400 fill-current'
                          : 'text-gray-300'
                      }`}
                    />
                  ))}
                </div>
                <span className="ml-2 text-sm text-gray-600">
                  {tour.agencies?.rating?.toFixed(1) || '0.0'} / 5.0
                </span>
              </div>
            </div>
            
            <div className="flex items-center mt-4 md:mt-0">
              <div className="flex items-center">
                <div className="h-10 w-10 rounded-full bg-gray-100 flex items-center justify-center mr-3">
                  {tour.agencies?.logo ? (
                    <img
                      src={tour.agencies.logo}
                      alt={tour.agencies.name}
                      className="h-10 w-10 rounded-full object-cover"
                    />
                  ) : (
                    <Building className="h-5 w-5 text-gray-500" />
                  )}
                </div>
                <div>
                  <p className="text-sm font-medium">{tour.agencies?.name}</p>
                  <p className="text-xs text-gray-500">Operador de Tours</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
      
      <div className="container-custom">
        <div className="flex flex-col lg:flex-row gap-4 md:gap-5 lg:gap-6 mt-6">
          <div className="w-full lg:w-2/3">
            {/* Tour Details Tabs */}
            <div className="bg-white rounded-lg shadow-md mb-6">
              <div className="border-b border-gray-200">
                <nav className="flex -mb-px">
                  <button
                    onClick={() => setActiveTab('description')}
                    className={`py-4 px-6 font-medium text-sm border-b-2 ${
                      activeTab === 'description'
                        ? 'border-primary-500 text-primary-600'
                        : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                    }`}
                  >
                    Descripción
                  </button>
                  <button
                    onClick={() => setActiveTab('itinerary')}
                    className={`py-4 px-6 font-medium text-sm border-b-2 ${
                      activeTab === 'itinerary'
                        ? 'border-primary-500 text-primary-600'
                        : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                    }`}
                  >
                    Itinerario
                  </button>
                  <button
                    onClick={() => setActiveTab('reviews')}
                    className={`py-4 px-6 font-medium text-sm border-b-2 ${
                      activeTab === 'reviews'
                        ? 'border-primary-500 text-primary-600'
                        : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                    }`}
                  >
                    Reseñas
                  </button>
                </nav>
              </div>
              
              <div className="p-6">
                {activeTab === 'description' && (
                  <div className="prose max-w-none">
                    <p className="whitespace-pre-line">{tour.description}</p>
                    
                    <h3 className="text-lg font-semibold mt-6 mb-3 flex items-center justify-between">
                      Qué Incluye
                      {isOwner && (
                        <Link
                          to="/agency/tours"
                          className="text-sm text-primary-600 hover:text-primary-700 font-normal"
                        >
                          Editar
                        </Link>
                      )}
                    </h3>
                    <ul className="space-y-2">
                      {getIncludedItems().map((item, index) => (
                        <li key={index} className="flex items-start">
                          <span className="text-success-500 mr-2">✓</span>
                          <span>{item}</span>
                        </li>
                      ))}
                    </ul>
                    
                    <h3 className="text-lg font-semibold mt-6 mb-3 flex items-center justify-between">
                      Qué No Incluye
                      {isOwner && (
                        <Link
                          to="/agency/tours"
                          className="text-sm text-primary-600 hover:text-primary-700 font-normal"
                        >
                          Editar
                        </Link>
                      )}
                    </h3>
                    <ul className="space-y-2">
                      {getExcludedItems().map((item, index) => (
                        <li key={index} className="flex items-start">
                          <span className="text-error-500 mr-2">✗</span>
                          <span>{item}</span>
                        </li>
                      ))}
                    </ul>

                    {departurePointsInfo && departurePointsInfo.length > 0 && (
                      <>
                        <h3 className="text-lg font-semibold mt-6 mb-3 flex items-center">
                          <MapPin className="h-5 w-5 mr-2 text-primary-600" />
                          {(tour as any).activity_type === 'experience'
                            ? 'Lugar de la Experiencia'
                            : tour.tour_type === 'receptivo'
                            ? 'Puntos de Encuentro'
                            : 'Puntos de Salida'}
                        </h3>
                        <div className="space-y-3">
                          {departurePointsInfo.map((point) => (
                            <div key={point.id} className="flex items-start gap-3 p-4 bg-gray-50 rounded-lg border border-gray-200">
                              <div className="flex-shrink-0 w-8 h-8 bg-primary-600 text-white rounded-full flex items-center justify-center font-semibold text-sm">
                                {point.display_order}
                              </div>
                              <div className="flex-1">
                                <p className="font-medium text-gray-900">{point.name}</p>
                                <p className="text-sm text-gray-600">{point.city}, {point.municipality}</p>
                                {point.departure_time && (
                                  <p className="text-sm text-primary-700 font-medium mt-1">
                                    {(tour as any).activity_type === 'experience' ? 'Hora de inicio:' : 'Hora de salida:'}{' '}
                                    {point.departure_time}
                                  </p>
                                )}
                                {(tour as any).activity_type === 'experience' && point.departure_time && (
                                  <p className="text-xs text-violet-600 mt-1 flex items-center gap-1">
                                    <span className="inline-block w-1.5 h-1.5 rounded-full bg-violet-400 flex-shrink-0" />
                                    Se recomienda llegar al menos 10 minutos antes de la hora de inicio.
                                  </p>
                                )}
                                {point.special_instructions && (
                                  <p className="text-sm text-gray-700 mt-1 italic">
                                    {point.special_instructions}
                                  </p>
                                )}
                                {point.google_maps_url && (
                                  <a
                                    href={point.google_maps_url}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="text-xs text-blue-600 hover:text-blue-700 flex items-center gap-1 mt-2"
                                  >
                                    Ver ubicación en Google Maps <ExternalLink className="w-3 h-3" />
                                  </a>
                                )}
                              </div>
                            </div>
                          ))}
                        </div>
                        <p className="text-sm text-gray-600 mt-3 italic">
                          {(tour as any).activity_type === 'experience'
                            ? `La experiencia se realiza en ${departurePointsInfo.length === 1 ? 'este lugar' : 'estos lugares'}. Llega al menos 10 minutos antes de tu hora de inicio.`
                            : tour.tour_type === 'receptivo'
                            ? `El tour opera desde ${departurePointsInfo.length === 1 ? 'este punto de encuentro' : 'estos puntos de encuentro'}. Preséntate a tiempo.`
                            : `El tour sale desde ${departurePointsInfo.length === 1 ? 'este punto' : 'estos puntos'}. Asegúrate de llegar con tiempo suficiente.`
                          }
                        </p>
                      </>
                    )}

                    {/* Pick Up — solo receptivo */}
                    {tour.tour_type === 'receptivo' && tour.pickup_available && (
                      <>
                        <h3 className="text-lg font-semibold mt-6 mb-3 flex items-center gap-2">
                          <Car className="h-5 w-5 text-teal-600" />
                          Recogida en Hotel (Pick Up)
                        </h3>
                        <div className="space-y-3">
                          {tour.pickup_free_zone && (
                            <div className="flex items-start gap-3 p-4 bg-teal-50 border border-teal-200 rounded-lg">
                              <div className="flex-shrink-0 w-6 h-6 bg-teal-600 text-white rounded-full flex items-center justify-center text-xs font-bold">
                                ✓
                              </div>
                              <div>
                                <p className="text-sm font-semibold text-teal-800">Sin costo adicional</p>
                                <p className="text-sm text-teal-700">{tour.pickup_free_zone}</p>
                              </div>
                            </div>
                          )}
                          {Array.isArray(tour.pickup_zones) && tour.pickup_zones.length > 0 && (
                            <div className="space-y-2">
                              <p className="text-sm font-medium text-gray-700">Zonas con costo adicional:</p>
                              {tour.pickup_zones.map((zone: any, idx: number) => (
                                <div key={idx} className="flex items-center justify-between p-3 bg-gray-50 border border-gray-200 rounded-lg">
                                  <span className="text-sm text-gray-800">{zone.name}</span>
                                  <span className="text-sm font-semibold text-gray-900">
                                    +{formatCurrencyMXN(zone.extra_cost ?? 0)} MXN
                                    <span className="text-xs font-normal text-gray-500 ml-1">
                                      {zone.cost_type === 'por_persona' ? '/ persona' : '/ reserva'}
                                    </span>
                                  </span>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      </>
                    )}

                    {/* Idiomas disponibles — solo receptivo */}
                    {tour.tour_type === 'receptivo' && Array.isArray(tour.tour_languages) && tour.tour_languages.length > 0 && (
                      <>
                        <h3 className="text-lg font-semibold mt-6 mb-3 flex items-center gap-2">
                          <Globe className="h-5 w-5 text-blue-600" />
                          Idiomas Disponibles
                        </h3>
                        <div className="flex flex-wrap gap-2">
                          {tour.tour_languages.map((lang: any, idx: number) => (
                            <div key={idx} className="flex items-center gap-2 px-3 py-2 bg-blue-50 border border-blue-200 rounded-lg">
                              <span className="text-sm font-medium text-blue-800">{lang.language}</span>
                              {lang.extra_cost > 0 && (
                                <span className="text-xs text-blue-600 bg-blue-100 px-2 py-0.5 rounded-full">
                                  +{formatCurrencyMXN(lang.extra_cost ?? 0)} {lang.cost_type === 'por_persona' ? '/ persona' : 'fijo'}
                                </span>
                              )}
                              {(!lang.extra_cost || lang.extra_cost === 0) && (
                                <span className="text-xs text-green-600 bg-green-100 px-2 py-0.5 rounded-full">Sin costo extra</span>
                              )}
                            </div>
                          ))}
                        </div>
                      </>
                    )}

                    {/* Detalles de Experiencia */}
                    {tour.tour_type === 'receptivo' && (tour as any).activity_type === 'experience' && (
                      <>
                        <h3 className="text-lg font-semibold mt-6 mb-3 flex items-center gap-2">
                          <Sparkles className="h-5 w-5 text-violet-600" />
                          Lo que Vivirás
                        </h3>
                        <div className="space-y-3">
                          {(tour as any).unique_experience && (
                            <p className="text-sm text-gray-700 bg-violet-50 border border-violet-200 rounded-lg p-4">
                              {(tour as any).unique_experience}
                            </p>
                          )}
                          {Array.isArray((tour as any).experience_environment) && (tour as any).experience_environment.length > 0 && (
                            <div>
                              <p className="text-sm font-medium text-gray-700 mb-2">Ambiente:</p>
                              <div className="flex flex-wrap gap-2">
                                {(tour as any).experience_environment.map((env: string, idx: number) => (
                                  <span key={idx} className="px-3 py-1 bg-violet-100 text-violet-700 rounded-full text-xs font-medium">{env}</span>
                                ))}
                              </div>
                            </div>
                          )}
                          {(tour as any).participation_level && (
                            <div className="flex items-center gap-2">
                              <span className="text-sm font-medium text-gray-700">Participación:</span>
                              <span className="px-3 py-1 bg-gray-100 text-gray-700 rounded-full text-xs font-medium capitalize">
                                {(tour as any).participation_level}
                              </span>
                            </div>
                          )}
                          {(tour as any).local_host && (
                            <div className="flex items-center gap-2 text-sm text-gray-700">
                              <span className="w-5 h-5 bg-violet-600 text-white rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0">✓</span>
                              Dirigida por anfitrión local
                            </div>
                          )}
                          {(tour as any).special_requirements && (
                            <div className="bg-amber-50 border border-amber-200 rounded-lg p-3">
                              <p className="text-xs font-semibold text-amber-700 mb-1">Requisitos del participante:</p>
                              <p className="text-sm text-amber-800">{(tour as any).special_requirements}</p>
                            </div>
                          )}
                        </div>
                      </>
                    )}

                    {/* Detalles del Traslado */}
                    {tour.tour_type === 'receptivo' && (tour as any).activity_type === 'transport' && (
                      <>
                        <h3 className="text-lg font-semibold mt-6 mb-3 flex items-center gap-2">
                          <Bus className="h-5 w-5 text-blue-600" />
                          Detalles del Traslado
                        </h3>
                        <div className="space-y-3">
                          {(tour as any).transfer_type && (
                            <div className="flex items-center gap-3 p-4 bg-blue-50 border border-blue-200 rounded-lg">
                              <Bus className="h-5 w-5 text-blue-600 flex-shrink-0" />
                              <div>
                                <p className="text-xs font-semibold text-blue-700 uppercase tracking-wide">Tipo de Traslado</p>
                                <p className="text-sm font-medium text-blue-900 mt-0.5">
                                  {(tour as any).transfer_type === 'aeropuerto_hotel' ? 'Aeropuerto → Hotel'
                                    : (tour as any).transfer_type === 'hotel_aeropuerto' ? 'Hotel → Aeropuerto'
                                    : (tour as any).transfer_type === 'hotel_hotel' ? 'Hotel → Hotel'
                                    : (tour as any).transfer_type === 'punto_punto' ? 'Punto → Punto'
                                    : (tour as any).transfer_type === 'excursion_retorno' ? 'Excursión con Retorno'
                                    : 'Otro'}
                                </p>
                              </div>
                              {(tour as any).estimated_minutes && (
                                <div className="ml-auto text-right">
                                  <p className="text-xs font-semibold text-blue-700 uppercase tracking-wide">Duración aprox.</p>
                                  <p className="text-sm font-medium text-blue-900 mt-0.5">{(tour as any).estimated_minutes} min</p>
                                </div>
                              )}
                            </div>
                          )}
                          {(tour as any).transport_service_info && (
                            <p className="text-sm text-gray-700 whitespace-pre-line">{(tour as any).transport_service_info}</p>
                          )}
                        </div>
                      </>
                    )}

                    {/* Detalles de la Entrada */}
                    {tour.tour_type === 'receptivo' && (tour as any).activity_type === 'ticket' && (
                      <>
                        <h3 className="text-lg font-semibold mt-6 mb-3 flex items-center gap-2">
                          <Tag className="h-5 w-5 text-orange-600" />
                          Detalles de la Entrada
                        </h3>
                        <div className="space-y-3">
                          {(tour as any).ticket_type && (
                            <div className="flex items-center gap-2">
                              <span className="text-sm font-medium text-gray-700">Tipo:</span>
                              <span className="px-3 py-1 bg-orange-100 text-orange-700 rounded-full text-xs font-medium capitalize">
                                {(tour as any).ticket_type === 'parque_tematico' ? 'Parque Temático'
                                  : (tour as any).ticket_type === 'museo' ? 'Museo / Galería'
                                  : (tour as any).ticket_type === 'zona_arqueologica' ? 'Zona Arqueológica'
                                  : (tour as any).ticket_type === 'show_evento' ? 'Show / Evento'
                                  : (tour as any).ticket_type === 'atraccion_natural' ? 'Atracción Natural'
                                  : 'Otro'}
                              </span>
                            </div>
                          )}
                          {(tour as any).ticket_validity_type && (
                            <div className="p-3 bg-orange-50 border border-orange-200 rounded-lg">
                              <p className="text-xs font-semibold text-orange-700 mb-1">Vigencia</p>
                              <p className="text-sm text-orange-900">
                                {(tour as any).ticket_validity_type === 'open' ? 'Entrada abierta (sin fecha fija)'
                                  : (tour as any).ticket_validity_type === 'fixed_date' && (tour as any).ticket_valid_from
                                    ? `Fecha específica: ${(tour as any).ticket_valid_from}`
                                    : (tour as any).ticket_validity_type === 'date_range' && (tour as any).ticket_valid_from
                                      ? `Válida del ${(tour as any).ticket_valid_from} al ${(tour as any).ticket_valid_to || '...'}`
                                      : '—'}
                              </p>
                            </div>
                          )}
                          {((tour as any).ticket_redemption_method || (tour as any).ticket_delivery_method) && (
                            <div className="grid grid-cols-2 gap-3">
                              {(tour as any).ticket_redemption_method && (
                                <div className="p-3 bg-gray-50 border border-gray-200 rounded-lg">
                                  <p className="text-xs font-semibold text-gray-600 mb-1">Método de canje</p>
                                  <p className="text-sm text-gray-800 capitalize">
                                    {(tour as any).ticket_redemption_method === 'qr_codigo' ? 'Código QR'
                                      : (tour as any).ticket_redemption_method === 'voucher_impreso' ? 'Voucher impreso'
                                      : (tour as any).ticket_redemption_method === 'nombre_lista' ? 'Nombre en lista'
                                      : 'Boleto físico'}
                                  </p>
                                </div>
                              )}
                              {(tour as any).ticket_delivery_method && (
                                <div className="p-3 bg-gray-50 border border-gray-200 rounded-lg">
                                  <p className="text-xs font-semibold text-gray-600 mb-1">Entrega</p>
                                  <p className="text-sm text-gray-800">
                                    {(tour as any).ticket_delivery_method === 'email' ? 'Correo electrónico'
                                      : (tour as any).ticket_delivery_method === 'whatsapp' ? 'WhatsApp'
                                      : (tour as any).ticket_delivery_method === 'punto_recogida' ? 'Punto de recogida'
                                      : 'En taquilla'}
                                  </p>
                                </div>
                              )}
                            </div>
                          )}
                          {(tour as any).ticket_access_instructions && (
                            <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
                              <p className="text-xs font-semibold text-blue-700 mb-1">Instrucciones de acceso</p>
                              <p className="text-sm text-blue-900">{(tour as any).ticket_access_instructions}</p>
                            </div>
                          )}
                          {(tour as any).ticket_service_info && (
                            <p className="text-sm text-gray-700 whitespace-pre-line">{(tour as any).ticket_service_info}</p>
                          )}
                        </div>
                      </>
                    )}

                    {/* Restricciones físicas — solo receptivo */}
                    {tour.tour_type === 'receptivo' && (tour.restriction_pregnant || tour.restriction_disability || tour.restriction_physical) && (
                      <>
                        <h3 className="text-lg font-semibold mt-6 mb-3 flex items-center gap-2">
                          <AlertTriangle className="h-5 w-5 text-amber-500" />
                          Restricciones Importantes
                        </h3>
                        <div className="bg-amber-50 border-2 border-amber-300 rounded-xl p-4 space-y-2">
                          <p className="text-sm font-semibold text-amber-800 mb-3">Este tour tiene las siguientes restricciones de aptitud:</p>
                          {tour.restriction_pregnant && (
                            <div className="flex items-center gap-2">
                              <span className="w-5 h-5 rounded-full bg-amber-400 flex items-center justify-center text-white text-xs font-bold flex-shrink-0">!</span>
                              <span className="text-sm text-amber-800">No apto para mujeres embarazadas</span>
                            </div>
                          )}
                          {tour.restriction_disability && (
                            <div className="flex items-center gap-2">
                              <span className="w-5 h-5 rounded-full bg-amber-400 flex items-center justify-center text-white text-xs font-bold flex-shrink-0">!</span>
                              <span className="text-sm text-amber-800">No apto para personas con alguna discapacidad</span>
                            </div>
                          )}
                          {tour.restriction_physical && (
                            <div className="flex items-center gap-2">
                              <span className="w-5 h-5 rounded-full bg-amber-400 flex items-center justify-center text-white text-xs font-bold flex-shrink-0">!</span>
                              <span className="text-sm text-amber-800">No apto para personas con mala condición física</span>
                            </div>
                          )}
                          <p className="text-xs text-amber-700 mt-3 pt-2 border-t border-amber-200">
                            Al hacer una reserva, deberás aceptar estas restricciones. Ni tú ni tus acompañantes deben pertenecer a estos grupos.
                          </p>
                        </div>
                      </>
                    )}

                    {isOwner && (
                      <div className="mt-6 p-4 bg-blue-50 border border-blue-200 rounded-lg">
                        <p className="text-sm text-blue-800">
                          <strong>Nota para la agencia:</strong> Puedes personalizar completamente qué incluye y qué no incluye tu tour desde el panel de gestión.
                        </p>
                      </div>
                    )}
                  </div>
                )}
                
                {activeTab === 'itinerary' && (
                  <div className="space-y-6">
                    {tour.itinerary ? (
                      <div className="whitespace-pre-line">{tour.itinerary}</div>
                    ) : (
                      <div className="space-y-3">
                        <div className="space-y-3">
                          <h3 className="text-lg font-semibold">Día 1: Llegada y Bienvenida</h3>
                          <div className="ml-6 space-y-2">
                            <p>
                              Llegada al punto de encuentro y conoce a tu guía turístico y compañeros de viaje. 
                              Traslado al alojamiento y disfruta de una cena de bienvenida.
                            </p>
                            <ul className="list-disc ml-5 text-gray-600">
                              <li>Llegada y check-in</li>
                              <li>Reunión de bienvenida y orientación</li>
                              <li>Cena grupal</li>
                            </ul>
                          </div>
                        </div>
                        
                        <div className="space-y-3">
                          <h3 className="text-lg font-semibold">Días 2-{Math.max(2, calculateDuration() - 1)}: Exploración</h3>
                          <div className="ml-6 space-y-2">
                            <p>
                              Días completos explorando las principales atracciones con guías locales expertos.
                              Experimenta la belleza natural y los aspectos culturales destacados del destino.
                            </p>
                            <ul className="list-disc ml-5 text-gray-600">
                              <li>Tours guiados matutinos</li>
                              <li>Almuerzo en restaurantes locales</li>
                              <li>Actividades vespertinas y tiempo libre</li>
                            </ul>
                          </div>
                        </div>
                        
                        {calculateDuration() > 1 && (
                          <div className="space-y-3">
                            <h3 className="text-lg font-semibold">Día {calculateDuration()}: Relajación y Partida</h3>
                            <div className="ml-6 space-y-2">
                              <p>
                                Día final para disfrutar el destino a tu propio ritmo.
                                Cena de despedida y preparación para la partida.
                              </p>
                              <ul className="list-disc ml-5 text-gray-600">
                                <li>Tiempo libre para compras o relajación</li>
                                <li>Cena de despedida</li>
                                <li>Check-out y traslados de partida</li>
                              </ul>
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}
                
                {activeTab === 'reviews' && tour.agency_id && (
                  <AgencyReviews agencyId={tour.agency_id} agencyName={tour.agencies?.name || 'la agencia'} />
                )}
              </div>
            </div>
            
            {/* Tour Details */}
            <div className="bg-white rounded-lg shadow-md p-6">
              <h2 className="text-xl font-semibold mb-4">Detalles del Tour</h2>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="flex items-start">
                  <Calendar className="h-5 w-5 text-primary-600 mr-3 mt-0.5" />
                  <div>
                    <h4 className="font-medium">Duración</h4>
                    <p className="text-gray-600">
                      {calculateDuration()} {calculateDuration() === 1 ? 'Día' : 'Días'}
                    </p>
                  </div>
                </div>

                <div className="flex items-start">
                  <Calendar className="h-5 w-5 text-primary-600 mr-3 mt-0.5" />
                  <div>
                    <h4 className="font-medium">
                      {tour.tour_type === 'receptivo' ? 'Disponibilidad' : 'Fechas'}
                    </h4>
                    {tour.tour_type === 'receptivo' ? (
                      <p className="text-gray-600">Disponible según calendario</p>
                    ) : (
                      <p className="text-gray-600">
                        {formatDate(tour.start_date)} - {formatDate(tour.end_date)}
                      </p>
                    )}
                  </div>
                </div>

                {tour.tour_type === 'receptivo' && (
                  <div className="flex items-start">
                    <RefreshCw className="h-5 w-5 text-teal-600 mr-3 mt-0.5" />
                    <div>
                      <h4 className="font-medium">Modalidad</h4>
                      <p className="text-gray-600 capitalize">
                        {tour.receptivo_modality === 'compartido' ? 'Tour Compartido' : 'Tour Privado'}
                      </p>
                    </div>
                  </div>
                )}

                {tour.tour_type === 'receptivo' && (tour as any).activity_type && (tour as any).activity_type !== 'guided_tour' && (
                  <div className="flex items-start">
                    {(tour as any).activity_type === 'transport' && <Bus className="h-5 w-5 text-blue-600 mr-3 mt-0.5" />}
                    {(tour as any).activity_type === 'experience' && <Sparkles className="h-5 w-5 text-violet-600 mr-3 mt-0.5" />}
                    {(tour as any).activity_type === 'ticket' && <Tag className="h-5 w-5 text-orange-600 mr-3 mt-0.5" />}
                    <div>
                      <h4 className="font-medium">Tipo de Actividad</h4>
                      <p className="text-gray-600">
                        {(tour as any).activity_type === 'experience' ? 'Experiencia'
                          : (tour as any).activity_type === 'transport' ? 'Traslado'
                          : 'Entrada'}
                      </p>
                    </div>
                  </div>
                )}

                <div className="flex items-start">
                  <Users className="h-5 w-5 text-primary-600 mr-3 mt-0.5" />
                  <div>
                    <h4 className="font-medium">Capacidad del Grupo</h4>
                    <p className="text-gray-600">
                      {tour.available_spots !== null && tour.available_spots !== undefined
                        ? `Hasta ${tour.available_spots} viajeros`
                        : `Máx ${tour.max_travelers || 'Sin límite'} viajeros`
                      }
                    </p>
                  </div>
                </div>
                
                <div className="flex items-start">
                  <MapPin className="h-5 w-5 text-primary-600 mr-3 mt-0.5" />
                  <div>
                    <h4 className="font-medium">Destino</h4>
                    <p className="text-gray-600">{tour.destination}</p>
                  </div>
                </div>
                
                <div className="flex items-start">
                  <span className="h-5 w-5 text-primary-600 mr-3 mt-0.5 text-sm font-bold">🏷️</span>
                  <div>
                    <h4 className="font-medium">Categorías</h4>
                    <p className="text-gray-600">{formatCategories(tour.category)}</p>
                  </div>
                </div>

                <div className="flex items-start">
                  <span className="h-5 w-5 text-primary-600 mr-3 mt-0.5 text-sm font-bold">🐾</span>
                  <div>
                    <h4 className="font-medium">Pet Friendly</h4>
                    <p className="text-gray-600">{tour.pet_friendly ? 'Sí' : 'No'}</p>
                  </div>
                </div>

                <div className="flex items-start">
                  <Clock className="h-5 w-5 text-primary-600 mr-3 mt-0.5" />
                  <div>
                    <h4 className="font-medium">Fecha Límite de Reserva</h4>
                    <p className="text-gray-600">
                      {getBookingDeadline()}
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </div>
          
          <div className="w-full lg:w-1/3">
            {/* Availability Info - Solo para tours NO receptivos (los receptivos muestran disponibilidad por slot en el formulario) */}
            {!isOwner && availableSpots !== null && tour.tour_type !== 'receptivo' && (
              <div className={`rounded-lg p-4 mb-6 ${
                availableSpots === 0
                  ? 'bg-red-50 border-2 border-red-200'
                  : availableSpots <= 3
                    ? 'bg-orange-50 border-2 border-orange-200'
                    : 'bg-green-50 border-2 border-green-200'
              }`}>
                <div className="flex items-center justify-between">
                  <div className="flex items-center">
                    <Users className={`h-5 w-5 mr-2 ${
                      availableSpots === 0
                        ? 'text-red-600'
                        : availableSpots <= 3
                          ? 'text-orange-600'
                          : 'text-green-600'
                    }`} />
                    <div>
                      <p className={`font-semibold ${
                        availableSpots === 0
                          ? 'text-red-900'
                          : availableSpots <= 3
                            ? 'text-orange-900'
                            : 'text-green-900'
                      }`}>
                        {availableSpots === 0
                          ? 'Sin lugares disponibles'
                          : availableSpots === 1
                            ? '¡Último lugar disponible!'
                            : availableSpots <= 3
                              ? `¡Solo ${availableSpots} lugares disponibles!`
                              : `${availableSpots} lugares disponibles`
                        }
                      </p>
                      <p className={`text-xs ${
                        availableSpots === 0
                          ? 'text-red-700'
                          : availableSpots <= 3
                            ? 'text-orange-700'
                            : 'text-green-700'
                      }`}>
                        de {totalCapacity} {totalCapacity === 1 ? 'lugar' : 'lugares'} en total
                      </p>
                    </div>
                  </div>
                  {availableSpots > 0 && availableSpots <= 3 && (
                    <span className="text-orange-600 text-2xl animate-pulse">⚠️</span>
                  )}
                  {availableSpots === 0 && (
                    <span className="text-red-600 text-2xl">🚫</span>
                  )}
                </div>
              </div>
            )}

            {/* Mensaje si la agencia está inactiva */}
            {!isOwner && tour.agencies?.is_active === false && (
              <div className="bg-red-50 border border-red-200 rounded-lg p-6 mb-6">
                <h3 className="text-lg font-semibold text-red-900 mb-2">
                  Tour No Disponible
                </h3>
                <p className="text-red-800">
                  Este tour no está disponible para nuevas reservas en este momento. La agencia asociada se encuentra temporalmente inactiva.
                </p>
              </div>
            )}

            {/* Warning for no cancellation tours (excursion only) */}
            {!isOwner && tour.tour_type !== 'receptivo' && tour.cancellation_not_allowed && tour.agencies?.is_active !== false && (
              <div className="bg-orange-50 border-l-4 border-orange-500 rounded-lg p-6 mb-6">
                <div className="flex items-start">
                  <div className="flex-shrink-0">
                    <svg className="h-6 w-6 text-orange-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                    </svg>
                  </div>
                  <div className="ml-4">
                    <h3 className="text-lg font-bold text-orange-900 mb-2">
                      IMPORTANTE: Este tour NO permite cancelaciones con reembolso
                    </h3>
                    <p className="text-sm text-orange-800">
                      Una vez confirmada tu reserva, <strong>no podrás obtener reembolso si cancelas</strong>. Solo podrás cancelar para evitar una penalización de No Show en tu perfil. Por favor, confirma tus fechas y disponibilidad antes de reservar.
                    </p>
                  </div>
                </div>
              </div>
            )}

            {/* Warning for no cancellation receptivo tours */}
            {!isOwner && tour.tour_type === 'receptivo' && tour.cancellation_not_allowed && tour.agencies?.is_active !== false && (
              <div className="bg-orange-50 border-l-4 border-orange-500 rounded-lg p-6 mb-6">
                <div className="flex items-start">
                  <div className="flex-shrink-0">
                    <svg className="h-6 w-6 text-orange-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                    </svg>
                  </div>
                  <div className="ml-4">
                    <h3 className="text-lg font-bold text-orange-900 mb-2">
                      IMPORTANTE: Este tour NO permite cancelaciones con reembolso
                    </h3>
                    <p className="text-sm text-orange-800">
                      Una vez confirmada tu reserva, <strong>no podrás obtener reembolso si cancelas</strong>. Solo podrás cancelar para evitar una penalización de No Show en tu perfil. Por favor, confirma tus fechas y disponibilidad antes de reservar.
                    </p>
                  </div>
                </div>
              </div>
            )}

            {/* Cancellation policy for receptivo tours */}
            {!isOwner && tour.tour_type === 'receptivo' && !tour.cancellation_not_allowed && tour.agencies?.is_active !== false && (
              <div className="bg-white border border-gray-200 rounded-xl p-5 mb-6 shadow-sm">
                <h3 className="text-base font-bold text-gray-800 mb-3 flex items-center gap-2">
                  <svg className="h-5 w-5 text-teal-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
                  </svg>
                  Política de cancelación
                </h3>
                <div className="space-y-2">
                  <div className="flex items-start gap-3 p-3 bg-green-50 rounded-lg border border-green-100">
                    <span className="w-2.5 h-2.5 rounded-full bg-green-500 flex-shrink-0 mt-1" />
                    <div>
                      <p className="text-sm font-semibold text-green-800">
                        {tour.flexible_hours ?? 48}+ horas antes: reembolso del {tour.flexible_refund_percentage ?? 100}%
                      </p>
                      <p className="text-xs text-green-700 mt-0.5">Cancelando con suficiente anticipación recibes el mayor reembolso posible.</p>
                    </div>
                  </div>
                  <div className="flex items-start gap-3 p-3 bg-yellow-50 rounded-lg border border-yellow-100">
                    <span className="w-2.5 h-2.5 rounded-full bg-yellow-500 flex-shrink-0 mt-1" />
                    <div>
                      <p className="text-sm font-semibold text-yellow-800">
                        {tour.moderate_hours ?? 24} a {tour.flexible_hours ?? 48} horas antes: reembolso del {tour.moderate_refund_percentage ?? 50}%
                      </p>
                      <p className="text-xs text-yellow-700 mt-0.5">Reembolso parcial si cancelas con menos anticipación.</p>
                    </div>
                  </div>
                  <div className="flex items-start gap-3 p-3 bg-red-50 rounded-lg border border-red-100">
                    <span className="w-2.5 h-2.5 rounded-full bg-red-500 flex-shrink-0 mt-1" />
                    <div>
                      <p className="text-sm font-semibold text-red-800">
                        Menos de {tour.moderate_hours ?? 24} horas antes: sin reembolso
                      </p>
                      <p className="text-xs text-red-700 mt-0.5">Aun así puedes cancelar para evitar una penalización de No Show en tu perfil.</p>
                    </div>
                  </div>
                </div>
                <p className="text-xs text-gray-400 mt-3">El cargo por servicio de plataforma no es reembolsable en ningún caso.</p>
              </div>
            )}

            {/* Booking Form - Solo mostrar si NO es el propietario Y la agencia está activa */}
            {!isOwner && tour.agencies?.is_active !== false && <BookingForm tour={tour} />}

            {/* Mensaje para el propietario */}
            {isOwner && (
              <div className="bg-blue-50 border border-blue-200 rounded-lg p-6 mb-6">
                <h3 className="text-lg font-semibold text-blue-900 mb-2">
                  Vista de Propietario
                </h3>
                <p className="text-blue-800 mb-4">
                  Estás viendo tu propio tour. Los viajeros verán aquí el formulario de reserva.
                </p>
                <Link
                  to="/agency/tours"
                  className="btn btn-primary w-full"
                >
                  <Edit className="h-4 w-4 mr-2" />
                  Editar Tour
                </Link>
              </div>
            )}
            
            {/* Agency Info */}
            <div className="bg-white rounded-lg shadow-md p-6 mt-6">
              <div className="flex items-center">
                <div className="flex-shrink-0">
                  {tour.agencies?.logo ? (
                    <img
                      src={tour.agencies.logo}
                      alt={tour.agencies?.name}
                      className="h-12 w-12 rounded-full object-cover"
                    />
                  ) : (
                    <div className="h-12 w-12 rounded-full bg-gray-100 flex items-center justify-center">
                      <Building className="h-6 w-6 text-gray-500" />
                    </div>
                  )}
                </div>
                <div className="ml-4">
                  <Link
                    to={`/agencies/${tour.agency_id}`}
                    className="text-lg font-semibold hover:text-blue-600 transition-colors"
                  >
                    {tour.agencies?.name}
                  </Link>
                  <div className="flex items-center">
                    <Star className="h-4 w-4 text-yellow-400 fill-current" />
                    <span className="ml-1 text-sm text-gray-600">
                      {tour.agencies?.rating?.toFixed(1) || '0.0'} Calificación
                    </span>
                  </div>
                </div>
              </div>

              <p className="mt-4 text-gray-700">
                {tour.agencies?.description || 'Información de la agencia no disponible.'}
              </p>

              <div className="mt-6 space-y-2">
                <Link
                  to={`/agencies/${tour.agency_id}`}
                  className="flex items-center text-primary-600 hover:text-primary-700"
                >
                  <Building className="h-5 w-5 mr-2" />
                  <span>Ver perfil de la agencia</span>
                </Link>

                {tour.agencies?.website && (
                  <a
                    href={tour.agencies.website}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center text-primary-600 hover:text-primary-700"
                  >
                    <Globe className="h-5 w-5 mr-2" />
                    <span>Visitar sitio web</span>
                  </a>
                )}
                
                {/* Botón de contactar agencia - Solo mostrar si NO es el propietario */}
                {!isOwner && (
                  <button
                    onClick={handleContactAgency}
                    disabled={isCreatingChat}
                    className="flex items-center text-primary-600 hover:text-primary-700 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {isCreatingChat ? (
                      <>
                        <div className="animate-spin rounded-full h-5 w-5 border-t-2 border-b-2 border-primary-600 mr-2"></div>
                        <span>Iniciando chat...</span>
                      </>
                    ) : (
                      <>
                        <MessageCircle className="h-5 w-5 mr-2" />
                        <span>Contactar agencia</span>
                      </>
                    )}
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
      </div>

      {tour && (
        <ShareTourModal
          isOpen={isShareModalOpen}
          onClose={() => setIsShareModalOpen(false)}
          tourId={tour.id}
          tourName={tour.name}
          tourImage={tour.image_url}
        />
      )}
    </>
  );
};

export default TourDetailPage;