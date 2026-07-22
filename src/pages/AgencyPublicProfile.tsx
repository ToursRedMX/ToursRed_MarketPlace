import React, { useState, useEffect } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { Star, MapPin, Globe, Phone, Mail, Building, Calendar, Award } from 'lucide-react';
import { supabase } from '../lib/supabase';
import TourCard from '../components/TourCard';
import AgencyReviews from '../components/AgencyReviews';
import Seo from '../components/Seo';

const SITE_URL = (import.meta.env.VITE_APP_URL || 'https://toursredmx.netlify.app/').replace(/\/$/, '');

interface Agency {
  id: string;
  name: string;
  description: string;
  logo: string;
  cover_image_url: string;
  custom_slug: string;
  contact_email: string;
  contact_phone: string;
  website: string;
  rating: number;
  rnt: string;
  created_at: string;
}

interface Tour {
  id: string;
  name: string;
  destination: string;
  description: string;
  price: number;
  deposit_percentage: number;
  image_url: string;
  start_date: string;
  end_date: string;
  max_travelers: number;
  category: string[];
}

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const AgencyPublicProfile: React.FC = () => {
  const { agencyId } = useParams<{ agencyId: string }>();
  const navigate = useNavigate();
  const [agency, setAgency] = useState<Agency | null>(null);
  const [tours, setTours] = useState<Tour[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');
  const [activeTab, setActiveTab] = useState<'tours' | 'reviews'>('tours');
  const [reviewCount, setReviewCount] = useState(0);

  useEffect(() => {
    if (agencyId) {
      fetchAgencyData();
    }
  }, [agencyId]);

  const fetchAgencyData = async () => {
    try {
      setIsLoading(true);
      setError('');

      const isUUID = UUID_REGEX.test(agencyId!);

      const query = supabase
        .from('agencies')
        .select('*')
        .eq('is_active', true);

      const { data: agencyData, error: agencyError } = isUUID
        ? await query.eq('id', agencyId).maybeSingle()
        : await query.ilike('custom_slug', agencyId!).maybeSingle();

      if (agencyError) throw agencyError;
      if (!agencyData) {
        setError('Agencia no encontrada');
        return;
      }

      // If accessed by UUID and has a custom slug, redirect to the slug URL
      if (isUUID && agencyData.custom_slug) {
        navigate(`/agencies/${agencyData.custom_slug}`, { replace: true });
        return;
      }

      setAgency(agencyData);

      const { data: toursData, error: toursError } = await supabase
        .from('tours')
        .select('*')
        .eq('agency_id', agencyData.id)
        .order('created_at', { ascending: false });

      if (toursError) throw toursError;
      setTours(toursData || []);

      const { count } = await supabase
        .from('agency_reviews')
        .select('*', { count: 'exact', head: true })
        .eq('agency_id', agencyData.id);
      setReviewCount(count || 0);
    } catch (err: any) {
      console.error('Error cargando datos de agencia:', err);
      setError(err.message || 'Error al cargar la información de la agencia');
    } finally {
      setIsLoading(false);
    }
  };

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  if (error || !agency) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <Building className="h-16 w-16 text-gray-400 mx-auto mb-4" />
          <h2 className="text-2xl font-bold text-gray-900 mb-2">
            {error || 'Agencia no encontrada'}
          </h2>
          <Link to="/tours" className="text-blue-600 hover:text-blue-700">
            Ver todos los tours
          </Link>
        </div>
      </div>
    );
  }

  const agencyDescription = agency.description
    ? agency.description.slice(0, 160)
    : `${agency.name} - Agencia de viajes y tours en México. Reserva experiencias auténticas con ToursRed.`;

  const streetAddress = [agency.street, agency.exterior_number, agency.interior_number, agency.colony]
    .filter(Boolean)
    .join(', ');

  const hasAddress = Boolean(streetAddress || agency.city || agency.state || agency.postal_code || agency.country);

  const agencyJsonLd: object = {
    '@context': 'https://schema.org',
    '@type': 'LocalBusiness',
    name: agency.name,
    image: agency.cover_image_url || agency.logo || undefined,
    description: agencyDescription,
    url: `${SITE_URL}/agencies/${agency.custom_slug || agency.id}`,
    ...(agency.website ? { sameAs: [agency.website] } : {}),
    ...(agency.contact_phone ? { telephone: agency.contact_phone } : {}),
    ...(agency.contact_email ? { email: agency.contact_email } : {}),
    ...(hasAddress
      ? {
          address: {
            '@type': 'PostalAddress',
            ...(streetAddress ? { streetAddress } : {}),
            ...(agency.city ? { addressLocality: agency.city } : {}),
            ...(agency.state ? { addressRegion: agency.state } : {}),
            ...(agency.postal_code ? { postalCode: agency.postal_code } : {}),
            ...(agency.country ? { addressCountry: 'MX' } : {}),
          },
        }
      : {}),
    ...(reviewCount > 0 && agency.rating
      ? {
          aggregateRating: {
            '@type': 'AggregateRating',
            ratingValue: agency.rating,
            reviewCount,
          },
        }
      : {}),
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <Seo
        title={`${agency.name} | ToursRed`}
        description={agencyDescription}
        image={agency.cover_image_url || agency.logo}
        type="profile"
        jsonLd={agencyJsonLd}
      />
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="bg-white rounded-2xl shadow-lg overflow-hidden mb-8">
          {/* Header / Cover con logo superpuesto */}
          <div className="relative h-48 md:h-64">
            {agency.cover_image_url ? (
              <img
                src={agency.cover_image_url}
                alt="Portada de la agencia"
                className="w-full h-full object-cover"
              />
            ) : (
              <div className="w-full h-full bg-gradient-to-r from-blue-600 to-blue-800" />
            )}
            {/* Overlay degradado inferior para contraste */}
            <div className="absolute inset-0 bg-gradient-to-t from-black/50 via-black/10 to-transparent" />

            {/* Logo superpuesto en la esquina inferior izquierda */}
            <div className="absolute bottom-0 left-6 md:left-8 translate-y-1/2">
              {agency.logo ? (
                <img
                  src={agency.logo}
                  alt={agency.name}
                  className="w-28 h-28 md:w-32 md:h-32 rounded-xl border-4 border-white shadow-xl object-cover bg-white"
                />
              ) : (
                <div className="w-28 h-28 md:w-32 md:h-32 rounded-xl border-4 border-white shadow-xl bg-gray-100 flex items-center justify-center">
                  <Building className="h-12 w-12 md:h-14 md:h-14 text-gray-400" />
                </div>
              )}
            </div>
          </div>

          <div className="px-6 md:px-8 pb-8">
            {/* Espacio para el logo superpuesto + nombre */}
            <div className="flex flex-col md:flex-row md:items-end pt-16 md:pt-18 mb-6">
              {/* Espacio reservado para el logo (ya posicionado en absolute) */}
              <div className="hidden md:block w-32 flex-shrink-0" />

              <div className="md:ml-6 flex-1">
                <div className="flex items-start justify-between">
                  <div>
                    <h1 className="text-3xl font-bold text-gray-900">{agency.name}</h1>

                    <div className="flex flex-wrap items-center mt-2 gap-4">
                      {agency.rating > 0 && (
                        <div className="flex items-center">
                          <Star className="h-5 w-5 text-yellow-400 fill-current" />
                          <span className="ml-1 text-lg font-semibold text-gray-900">
                            {agency.rating.toFixed(1)}
                          </span>
                        </div>
                      )}

                      {agency.rnt && (
                        <div className="flex items-center text-green-600">
                          <Award className="h-5 w-5 mr-1" />
                          <span className="text-sm font-medium">RNT: {agency.rnt}</span>
                        </div>
                      )}

                      <div className="flex items-center text-gray-500">
                        <Calendar className="h-4 w-4 mr-1" />
                        <span className="text-sm">
                          Desde {new Date(agency.created_at).getFullYear()}
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {agency.description && (
              <div className="mb-6">
                <h3 className="text-lg font-semibold text-gray-900 mb-2">Acerca de la agencia</h3>
                <p className="text-gray-700 whitespace-pre-wrap leading-relaxed">{agency.description}</p>
              </div>
            )}

            <div className="flex flex-wrap gap-6 pt-6 border-t border-gray-100">
              {agency.website && (
                <a
                  href={agency.website}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center text-blue-600 hover:text-blue-700 transition-colors"
                >
                  <Globe className="h-5 w-5 mr-2" />
                  <span>Visitar sitio web</span>
                </a>
              )}

              {agency.contact_email && (
                <a
                  href={`mailto:${agency.contact_email}`}
                  className="flex items-center text-gray-700 hover:text-gray-900 transition-colors"
                >
                  <Mail className="h-5 w-5 mr-2" />
                  <span>{agency.contact_email}</span>
                </a>
              )}

              {agency.contact_phone && (
                <a
                  href={`tel:${agency.contact_phone}`}
                  className="flex items-center text-gray-700 hover:text-gray-900 transition-colors"
                >
                  <Phone className="h-5 w-5 mr-2" />
                  <span>{agency.contact_phone}</span>
                </a>
              )}
            </div>
          </div>
        </div>

        {/* Tabs */}
        <div className="mb-6">
          <div className="border-b border-gray-200">
            <nav className="-mb-px flex space-x-8">
              <button
                onClick={() => setActiveTab('tours')}
                className={`py-4 px-1 border-b-2 font-medium text-sm transition-colors ${
                  activeTab === 'tours'
                    ? 'border-blue-600 text-blue-600'
                    : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                }`}
              >
                <div className="flex items-center">
                  <MapPin className="h-5 w-5 mr-2" />
                  Tours ({tours.length})
                </div>
              </button>

              <button
                onClick={() => setActiveTab('reviews')}
                className={`py-4 px-1 border-b-2 font-medium text-sm transition-colors ${
                  activeTab === 'reviews'
                    ? 'border-blue-600 text-blue-600'
                    : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                }`}
              >
                <div className="flex items-center">
                  <Star className="h-5 w-5 mr-2" />
                  Reseñas
                </div>
              </button>
            </nav>
          </div>
        </div>

        {activeTab === 'tours' && (
          <div>
            {tours.length > 0 ? (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {tours.map((tour) => (
                  <TourCard key={tour.id} tour={tour} />
                ))}
              </div>
            ) : (
              <div className="bg-white rounded-xl shadow p-12 text-center">
                <MapPin className="h-16 w-16 text-gray-400 mx-auto mb-4" />
                <h3 className="text-xl font-semibold text-gray-900 mb-2">
                  No hay tours disponibles
                </h3>
                <p className="text-gray-600">
                  Esta agencia aún no ha publicado tours.
                </p>
              </div>
            )}
          </div>
        )}

        {activeTab === 'reviews' && (
          <AgencyReviews agencyId={agency.id} agencyName={agency.name} />
        )}
      </div>
    </div>
  );
};

export default AgencyPublicProfile;
