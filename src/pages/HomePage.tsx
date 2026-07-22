import React, { useEffect, useState, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { Compass, Search, Award, CreditCard, Users, Plane, Globe, Clock, Palmtree, Ship, Building2, FileCheck, MapPin, Handshake, ShieldCheck, Lock } from 'lucide-react';
import SearchBox from '../components/SearchBox';
import CategoryList from '../components/CategoryList';
import FeaturedDestinations from '../components/FeaturedDestinations';
import TourGridSection from '../components/TourGridSection';
import MembershipSection from '../components/MembershipSection';
import PreventasSection from '../components/PreventasSection';
import { Tour } from '../types';
import { getActiveFeaturedTours, getPopularTours, getNewTours, supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import { useTourPromotionsBatch } from '../hooks/useSharedData';
import Seo from '../components/Seo';

const SITE_URL = (import.meta.env.VITE_APP_URL || 'https://toursredmx.netlify.app/').replace(/\/$/, '');

const HomePage: React.FC = () => {
  const [featuredTours, setFeaturedTours] = useState<Tour[]>([]);
  const [featuredSlotMap, setFeaturedSlotMap] = useState<Record<string, string>>({});
  const [popularTours, setPopularTours] = useState<Tour[]>([]);
  const [newTours, setNewTours] = useState<Tour[]>([]);
  const [featuredLoading, setFeaturedLoading] = useState(true);
  const [popularLoading, setPopularLoading] = useState(true);
  const [newToursLoading, setNewToursLoading] = useState(true);
  const [heroBackground, setHeroBackground] = useState<string | null | undefined>(undefined);
  const { user } = useAuth();

  useEffect(() => {
    getActiveFeaturedTours().then(({ data, slotMap }) => {
      setFeaturedTours((data as Tour[]) || []);
      setFeaturedSlotMap(slotMap || {});
      setFeaturedLoading(false);
    }).catch(() => setFeaturedLoading(false));

    getPopularTours(20).then(({ data }) => {
      setPopularTours((data as Tour[]) || []);
      setPopularLoading(false);
    }).catch(() => setPopularLoading(false));

    getNewTours(20).then(({ data }) => {
      setNewTours((data as Tour[]) || []);
      setNewToursLoading(false);
    }).catch(() => setNewToursLoading(false));

    supabase
      .from('platform_settings')
      .select('hero_background_url')
      .maybeSingle()
      .then(({ data }) => {
        setHeroBackground(data?.hero_background_url ?? null);
      })
      .catch(() => setHeroBackground(null));
  }, []);

  const allTourIds = useMemo(
    () => [...new Set([...featuredTours.map(t => t.id), ...popularTours.map(t => t.id), ...newTours.map(t => t.id)])],
    [featuredTours, popularTours, newTours]
  );
  const { data: promotionsMap = {} } = useTourPromotionsBatch(allTourIds);

  return (
    <div>
      <Seo
        title="ToursRed | Tours y Excursiones en México"
        description="Marketplace de tours y excursiones en México. Compara tours de agencias verificadas, reserva en línea y descubre experiencias auténticas en todo el país."
        type="website"
        jsonLd={[
          {
            '@context': 'https://schema.org',
            '@type': 'Organization',
            name: 'ToursRed',
            url: SITE_URL,
            logo: `${SITE_URL}/LogoFinal.jpg`,
            description: 'Plataforma mexicana que conecta viajeros con agencias locales para descubrir y reservar experiencias turísticas.',
            email: 'contacto@toursred.com',
            telephone: '+52 55 47127668',
            sameAs: [
              'https://www.facebook.com/ToursRedMX',
              'https://www.instagram.com/toursredmx',
              'https://www.tiktok.com/@toursredmx',
              'https://www.linkedin.com/company/toursredmx',
            ],
          },
          {
            '@context': 'https://schema.org',
            '@type': 'WebSite',
            name: 'ToursRed',
            url: SITE_URL,
            inLanguage: 'es-MX',
            potentialAction: {
              '@type': 'SearchAction',
              target: {
                '@type': 'EntryPoint',
                urlTemplate: `${SITE_URL}/tours?tourName={search_term_string}`,
              },
              'query-input': 'required name=search_term_string',
            },
          },
        ]}
      />
      {/* Hero Section */}
      <section
        className="relative bg-blue-900 text-white"
        style={heroBackground ? { backgroundImage: `url(${heroBackground})`, backgroundSize: 'cover', backgroundPosition: 'center' } : undefined}
      >
        <div className="absolute inset-0 overflow-hidden">
          <div className="absolute inset-0 bg-gradient-to-r from-blue-900/80 to-blue-900/60"></div>
          {!heroBackground && (
            <img
              src="https://images.pexels.com/photos/1271619/pexels-photo-1271619.jpeg"
              alt="Fondo de viaje"
              loading="lazy"
              className="w-full h-full object-cover opacity-60"
            />
          )}
        </div>
        <div className="relative container-custom py-24 md:py-36">
          <div className="max-w-3xl flex flex-col items-start">
            <img src="/Logo_Transparente.jpg" alt="ToursRed Logo" className="h-24 w-auto mb-6" />
            <h1 className="text-4xl md:text-5xl font-bold mb-4 animate-fade-in">
              Descubre Tu Próxima<br />Aventura
            </h1>
            <p className="text-xl md:text-2xl mb-8 animate-fade-in">
              Compara tours de las mejores agencias y encuentra las experiencias perfectas para tu próximo viaje.
            </p>
            <div className="animate-slide-up">
              <SearchBox className="bg-blue-50/90 backdrop-blur-sm" />
            </div>
          </div>
        </div>
      </section>

      {/* Preventas Exclusivas */}
      <PreventasSection />

      {/* Tours Destacados (paid) — hidden when no active slots */}
      <TourGridSection
        title="Tours Destacados"
        subtitle="Tours con visibilidad premium seleccionados por agencias verificadas"
        tours={featuredTours}
        isLoading={featuredLoading}
        promotionsMap={promotionsMap}
        bgClass="bg-amber-50"
        maxRows={4}
        hideIfEmpty
        viewAllLink="/tours"
        featuredSlotMap={featuredSlotMap}
      />

      {/* Nuevos Tours */}
      <TourGridSection
        title="Nuevos Tours"
        subtitle="Las últimas incorporaciones al catálogo de ToursRed"
        tours={newTours}
        isLoading={newToursLoading}
        promotionsMap={promotionsMap}
        bgClass="bg-white"
        maxRows={4}
        viewAllLink="/tours"
      />

      {/* Popular Tours */}
      <TourGridSection
        title="Tours Más Populares"
        subtitle="Los tours con más reservas entre nuestros viajeros"
        tours={popularTours}
        isLoading={popularLoading}
        promotionsMap={promotionsMap}
        bgClass="bg-blue-50"
        maxRows={4}
        viewAllLink="/tours"
      />

      {/* Categories Section */}
      <section className="py-12 bg-blue-50">
        <div className="container-custom">
          <h2 className="text-2xl md:text-3xl font-bold mb-8 text-center">Explora por Categoría</h2>
          <CategoryList />
        </div>
      </section>

      {/* Featured Destinations */}
      <section className="py-12 bg-blue-100">
        <div className="container-custom">
          <div className="flex justify-between items-center mb-8">
            <h2 className="text-2xl md:text-3xl font-bold">Destinos Populares</h2>
            <Link to="/tours" className="text-primary-600 hover:text-primary-700 font-medium flex items-center">
              Ver todos <Compass className="ml-1 h-4 w-4" />
            </Link>
          </div>
          <FeaturedDestinations />
        </div>
      </section>

      {/* International Tours Section */}
      <section className="py-16 bg-gradient-to-br from-blue-100 via-blue-50 to-orange-50">
        <div className="container-custom">
          <div className="text-center mb-12">
            <div className="inline-flex items-center justify-center w-16 h-16 bg-primary-100 rounded-full mb-4">
              <Globe className="h-8 w-8 text-primary-600" />
            </div>
            <h2 className="text-3xl md:text-4xl font-bold mb-4">Explora el Mundo</h2>
            <p className="text-xl text-gray-600 max-w-2xl mx-auto">
              Tours Internacionales con Nuestros Aliados Verificados
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-8 max-w-6xl mx-auto">
            <Link
              to="/tours/international/mega-travel"
              className="group bg-white rounded-lg shadow-lg overflow-hidden hover:shadow-xl transition-all duration-300 transform hover:-translate-y-1"
            >
              <div className="relative h-44 bg-gradient-to-r from-primary-600 to-primary-800 flex items-center justify-center">
                <Plane className="h-20 w-20 text-white opacity-20 absolute" />
                <div className="relative z-10 text-center">
                  <Plane className="h-10 w-10 text-white mx-auto mb-2" />
                  <h3 className="text-xl font-bold text-white">Mega Travel</h3>
                </div>
              </div>
              <div className="p-5">
                <p className="text-gray-600 mb-3 text-sm">
                  Mas de 100 destinos internacionales en Europa, Asia, America, el Caribe y mas
                </p>
                <div className="flex flex-wrap gap-1.5 mb-3">
                  <span className="px-2.5 py-0.5 bg-primary-100 text-primary-700 rounded-full text-xs font-medium">Europa</span>
                  <span className="px-2.5 py-0.5 bg-primary-100 text-primary-700 rounded-full text-xs font-medium">Asia</span>
                  <span className="px-2.5 py-0.5 bg-primary-100 text-primary-700 rounded-full text-xs font-medium">America</span>
                  <span className="px-2.5 py-0.5 bg-primary-100 text-primary-700 rounded-full text-xs font-medium">Caribe</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-primary-600 font-semibold group-hover:text-primary-700 flex items-center text-sm">
                    Ver Catalogo
                    <Compass className="ml-1.5 h-4 w-4" />
                  </span>
                  <div className="flex items-center text-xs text-gray-500">
                    <Clock className="h-3.5 w-3.5 mr-1" />
                    Cotizacion en 24h
                  </div>
                </div>
              </div>
            </Link>

            <Link
              to="/tours/international/nefertari-travel"
              className="group bg-white rounded-lg shadow-lg overflow-hidden hover:shadow-xl transition-all duration-300 transform hover:-translate-y-1"
            >
              <div className="relative h-44 bg-gradient-to-r from-amber-700 to-amber-900 flex items-center justify-center">
                <Ship className="h-20 w-20 text-white opacity-20 absolute" />
                <div className="relative z-10 text-center">
                  <Ship className="h-10 w-10 text-white mx-auto mb-2" />
                  <h3 className="text-xl font-bold text-white">Nefertari Travel</h3>
                </div>
              </div>
              <div className="p-5">
                <p className="text-gray-600 mb-3 text-sm">
                  Experiencias unicas en destinos fascinantes con servicio personalizado y atencion de primera
                </p>
                <div className="flex flex-wrap gap-1.5 mb-3">
                  <span className="px-2.5 py-0.5 bg-amber-100 text-amber-700 rounded-full text-xs font-medium">Europa</span>
                  <span className="px-2.5 py-0.5 bg-amber-100 text-amber-700 rounded-full text-xs font-medium">Medio Oriente</span>
                  <span className="px-2.5 py-0.5 bg-amber-100 text-amber-700 rounded-full text-xs font-medium">Africa</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-amber-700 font-semibold group-hover:text-amber-800 flex items-center text-sm">
                    Ver Catalogo
                    <Compass className="ml-1.5 h-4 w-4" />
                  </span>
                  <div className="flex items-center text-xs text-gray-500">
                    <Clock className="h-3.5 w-3.5 mr-1" />
                    Cotizacion en 24h
                  </div>
                </div>
              </div>
            </Link>

            <Link
              to="/tours/international/exoticca"
              className="group bg-white rounded-lg shadow-lg overflow-hidden hover:shadow-xl transition-all duration-300 transform hover:-translate-y-1"
            >
              <div className="relative h-44 bg-gradient-to-r from-teal-600 to-teal-800 flex items-center justify-center">
                <Palmtree className="h-20 w-20 text-white opacity-20 absolute" />
                <div className="relative z-10 text-center">
                  <Palmtree className="h-10 w-10 text-white mx-auto mb-2" />
                  <h3 className="text-xl font-bold text-white">Exoticca</h3>
                </div>
              </div>
              <div className="p-5">
                <p className="text-gray-600 mb-3 text-sm">
                  Paquetes todo incluido a mas de 60 paises con vuelos, hoteles, tours y actividades exclusivas
                </p>
                <div className="flex flex-wrap gap-1.5 mb-3">
                  <span className="px-2.5 py-0.5 bg-teal-100 text-teal-700 rounded-full text-xs font-medium">Asia</span>
                  <span className="px-2.5 py-0.5 bg-teal-100 text-teal-700 rounded-full text-xs font-medium">Africa</span>
                  <span className="px-2.5 py-0.5 bg-teal-100 text-teal-700 rounded-full text-xs font-medium">Sudamerica</span>
                  <span className="px-2.5 py-0.5 bg-teal-100 text-teal-700 rounded-full text-xs font-medium">Oceania</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-teal-600 font-semibold group-hover:text-teal-700 flex items-center text-sm">
                    Explorar Tours
                    <Compass className="ml-1.5 h-4 w-4" />
                  </span>
                  <div className="flex items-center text-xs text-gray-500">
                    <Clock className="h-3.5 w-3.5 mr-1" />
                    Todo incluido
                  </div>
                </div>
              </div>
            </Link>

            <Link
              to="/tours/international/coming-soon"
              className="group bg-white rounded-lg shadow-lg overflow-hidden hover:shadow-xl transition-all duration-300 transform hover:-translate-y-1"
            >
              <div className="relative h-44 bg-gradient-to-r from-gray-400 to-gray-600 flex items-center justify-center">
                <Globe className="h-20 w-20 text-white opacity-20 absolute" />
                <div className="relative z-10 text-center">
                  <Globe className="h-10 w-10 text-white mx-auto mb-2" />
                  <h3 className="text-xl font-bold text-white">Mas Opciones</h3>
                </div>
              </div>
              <div className="p-5">
                <p className="text-gray-600 mb-3 text-sm">
                  Estamos agregando mas destinos internacionales con agencias verificadas
                </p>
                <div className="bg-orange-50 border border-orange-200 rounded-lg p-3 mb-3">
                  <p className="text-xs text-orange-800 font-medium">
                    Proximamente: Nuevas opciones de viajes internacionales
                  </p>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-gray-600 font-semibold group-hover:text-gray-700 flex items-center text-sm">
                    Notificame
                    <Compass className="ml-1.5 h-4 w-4" />
                  </span>
                  <div className="flex items-center text-xs text-gray-500">
                    <Clock className="h-3.5 w-3.5 mr-1" />
                    Disponible pronto
                  </div>
                </div>
              </div>
            </Link>
          </div>

          <div className="text-center mt-8">
            <p className="text-gray-600">
              ¿Buscas tours dentro de México?{' '}
              <Link to="/tours" className="text-primary-600 hover:text-primary-700 font-semibold">
                Ver Tours Nacionales →
              </Link>
            </p>
          </div>
        </div>
      </section>

      {/* Membership Section */}
      <MembershipSection />

      {/* Confia en ToursRed */}
      <section className="py-16 bg-white border-t border-b border-blue-100">
        <div className="container-custom">
          <div className="text-center mb-12">
            <span className="inline-flex items-center gap-1.5 px-3 py-1 bg-blue-100 text-blue-700 text-xs font-semibold rounded-full uppercase tracking-wider mb-4">
              <ShieldCheck className="h-3.5 w-3.5" />
              Empresa Verificada
            </span>
            <h2 className="text-3xl md:text-4xl font-bold text-blue-900 mb-3">Confia en ToursRed</h2>
            <p className="text-gray-500 max-w-xl mx-auto text-base">
              Tu viaje respaldado por una empresa formalmente registrada y reconocida por organismos turisticos oficiales.
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5 max-w-5xl mx-auto">
            {[
              {
                icon: Building2,
                title: 'Empresa legalmente constituida en Mexico',
                desc: 'Sociedad registrada y operando conforme a la legislacion mexicana.',
              },
              {
                icon: FileCheck,
                title: 'Registro Nacional de Turismo (RNT)',
                desc: 'Inscritos ante SECTUR como prestador de servicios turisticos.',
              },
              {
                icon: MapPin,
                title: 'Cedula Turistica de la Ciudad de Mexico',
                desc: 'Autorizados por la Secretaria de Turismo de la CDMX.',
              },
              {
                icon: Handshake,
                title: 'Afiliados a AMAV',
                desc: 'Miembro de la Asociacion Mexicana de Agencias de Viajes.',
              },
              {
                icon: Award,
                title: 'Marca registrada ante el IMPI',
                desc: 'ToursRed es una marca protegida legalmente en Mexico.',
              },
              {
                icon: Lock,
                title: 'Pagos seguros y protegidos',
                desc: 'Procesamiento mediante plataformas certificadas.',
              },
            ].map(({ icon: Icon, title, desc }) => (
              <div
                key={title}
                className="flex items-start gap-4 p-5 rounded-xl border border-blue-100 bg-blue-50/40 hover:bg-blue-50 hover:border-blue-200 hover:shadow-sm transition-all duration-200"
              >
                <div className="flex-shrink-0 w-10 h-10 rounded-lg bg-blue-100 flex items-center justify-center">
                  <Icon className="h-5 w-5 text-blue-600" />
                </div>
                <div>
                  <h3 className="font-semibold text-blue-900 text-sm leading-snug mb-1">{title}</h3>
                  <p className="text-gray-500 text-sm leading-relaxed">{desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* How It Works */}
      <section className="py-12 bg-blue-100">
        <div className="container-custom">
          <h2 className="text-2xl md:text-3xl font-bold mb-8 text-center">Cómo Funciona</h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            <div className="text-center">
              <div className="w-16 h-16 rounded-full bg-primary-100 flex items-center justify-center mx-auto mb-4 text-primary-600">
                <Search className="h-8 w-8" />
              </div>
              <h3 className="text-xl font-semibold mb-2">1. Encuentra Tu Tour</h3>
              <p className="text-gray-600">
                Explora nuestra extensa colección de tours de las mejores agencias y encuentra tu opción perfecta.
              </p>
            </div>
            <div className="text-center">
              <div className="w-16 h-16 rounded-full bg-primary-100 flex items-center justify-center mx-auto mb-4 text-primary-600">
                <CreditCard className="h-8 w-8" />
              </div>
              <h3 className="text-xl font-semibold mb-2">2. Reserva con Depósito</h3>
              <p className="text-gray-600">
                Asegura tu lugar con un pequeño depósito y paga el resto directamente a la agencia después.
              </p>
            </div>
            <div className="text-center">
              <div className="w-16 h-16 rounded-full bg-primary-100 flex items-center justify-center mx-auto mb-4 text-primary-600">
                <Award className="h-8 w-8" />
              </div>
              <h3 className="text-xl font-semibold mb-2">3. Disfruta Tu Viaje</h3>
              <p className="text-gray-600">
                Vive la aventura de tu vida y comparte tu experiencia con nuestra comunidad.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Service Charge Section - Only show to authenticated users */}
      {user && (
        <section className="py-12 bg-blue-200">
          <div className="container-custom relative">
            <div className="max-w-3xl mx-auto text-center">
              <h2 className="text-2xl md:text-3xl font-bold mb-4">Cómo Funcionan Nuestros Pagos</h2>
              <p className="text-lg text-gray-600 mb-6">
                En ToursRed, hacemos que reservar tours sea seguro y transparente:
              </p>
              
              <div className="bg-blue-50 rounded-lg shadow-lg p-6 mb-8">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6 text-left">
                  <div className="space-y-2">
                    <div className="w-10 h-10 rounded-full bg-primary-100 flex items-center justify-center text-primary-600 mb-3">
                      <span className="font-bold">1</span>
                    </div>
                    <h3 className="font-semibold">Depósito Inicial</h3>
                    <p className="text-sm text-gray-600">Pagas solo un depósito para asegurar tu lugar (generalmente 30-50% del precio total)</p>
                  </div>
                  
                  <div className="space-y-2">
                    <div className="w-10 h-10 rounded-full bg-primary-100 flex items-center justify-center text-primary-600 mb-3">
                      <span className="font-bold">2</span>
                    </div>
                    <h3 className="font-semibold">Cargo por Servicio</h3>
                    <p className="text-sm text-gray-600">Aplicamos un pequeño cargo del 5% en cada reserva para mantener la plataforma y garantizar seguridad</p>
                  </div>
                  
                  <div className="space-y-2">
                    <div className="w-10 h-10 rounded-full bg-primary-100 flex items-center justify-center text-primary-600 mb-3">
                      <span className="font-bold">3</span>
                    </div>
                    <h3 className="font-semibold">Saldo Restante</h3>
                    <p className="text-sm text-gray-600">El saldo restante se paga directamente a la agencia según sus políticas</p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>
      )}

      {/* Become a Partner */}
      <section className="py-12 bg-blue-200">
        <div className="container-custom">
          <div className="bg-blue-50 rounded-lg shadow-lg p-8 md:p-12">
            <div className="flex flex-col md:flex-row items-center">
              <div className="md:w-2/3 mb-6 md:mb-0 md:pr-8">
                <h2 className="text-2xl md:text-3xl font-bold mb-4">¿Eres una Agencia de Viajes?</h2>
                <p className="text-lg text-gray-600 mb-6">
                  Únete a ToursRed y llega a miles de viajeros buscando su próxima aventura. Gestiona tus tours, recibe reservas y haz crecer tu negocio con nosotros.
                </p>
                <Link to="/agency-signup" className="btn btn-primary">
                  <Users className="mr-2 h-5 w-5" />
                  Conviértete en Socio
                </Link>
              </div>
              <div className="md:w-1/3">
                <img
                  src="https://images.pexels.com/photos/3184465/pexels-photo-3184465.jpeg"
                  alt="Asociación de agencia de viajes"
                  className="rounded-lg shadow-md"
                />
              </div>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
};

export default HomePage;