import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { ChevronRight, Info, ExternalLink, MapPin, Clock, Shield, Star, DollarSign, HeadphonesIcon, MessageSquare, X, Loader } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useFormPersistence } from '../../hooks/useFormPersistence';
import { usePreventUnload } from '../../hooks/usePreventUnload';

const ExoticcaPage: React.FC = () => {
  const { user } = useAuth();
  const exoticcaUrl = 'https://www.exoticca.com/mx?advisor_token=alan-axel-alvarez-hernandez-019c2fa9-0f7e-717c-9187-65995b917bc6';

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [formData, setFormData] = useState({
    name: '',
    email: '',
    phone: '',
    destination: '',
    travel_date: '',
    num_people: 1,
    message: ''
  });
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);

  const formPersistence = useFormPersistence(
    formData,
    { key: 'exoticca_inquiry', expirationHours: 24 }
  );

  usePreventUnload(
    formData.name.length > 0 ||
    formData.email.length > 0 ||
    formData.phone.length > 0 ||
    formData.message.length > 0
  );

  useEffect(() => {
    const savedData = formPersistence.loadFromStorage();
    if (savedData) {
      formPersistence.setIsRestoring(true);
      setFormData(savedData);
      setTimeout(() => formPersistence.setIsRestoring(false), 100);
    }
  }, []);

  const handleExploreClick = () => {
    window.open(exoticcaUrl, '_blank', 'noopener,noreferrer');
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    setFormData(prev => ({
      ...prev,
      [name]: name === 'num_people' ? parseInt(value) : value
    }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setIsLoading(true);

    if (!formData.name || !formData.email || !formData.phone || !formData.destination || !formData.num_people) {
      setError('Por favor completa todos los campos requeridos');
      setIsLoading(false);
      return;
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(formData.email)) {
      setError('Por favor ingresa un email valido');
      setIsLoading(false);
      return;
    }

    const phoneRegex = /^\d{10}$/;
    if (!phoneRegex.test(formData.phone.replace(/\D/g, ''))) {
      setError('Por favor ingresa un telefono valido de 10 digitos');
      setIsLoading(false);
      return;
    }

    try {
      const response = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/send-inquiry-email`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`,
          },
          body: JSON.stringify({
            ...formData,
            user_id: user?.id || null,
            source: 'exoticca'
          }),
        }
      );

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || 'Error al enviar la cotizacion');
      }

      formPersistence.clearStorage();
      setSuccess(true);
      setTimeout(() => {
        setIsModalOpen(false);
        setSuccess(false);
        setFormData({
          name: '',
          email: '',
          phone: '',
          destination: '',
          travel_date: '',
          num_people: 1,
          message: ''
        });
      }, 2000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al enviar la cotizacion');
    } finally {
      setIsLoading(false);
    }
  };

  const features = [
    {
      icon: MapPin,
      title: 'Destinos Únicos',
      description: 'Accede a experiencias exclusivas en más de 60 países alrededor del mundo con itinerarios cuidadosamente diseñados.'
    },
    {
      icon: DollarSign,
      title: 'Precios Competitivos',
      description: 'Obtén las mejores tarifas con paquetes todo incluido que combinan vuelos, hoteles, tours y más.'
    },
    {
      icon: Shield,
      title: 'Viajes Seguros',
      description: 'Disfruta de la tranquilidad con protección completa y asistencia 24/7 durante todo tu viaje.'
    },
    {
      icon: Star,
      title: 'Experiencias Premium',
      description: 'Vive aventuras extraordinarias con guías expertos y servicios de alta calidad en cada destino.'
    },
    {
      icon: Clock,
      title: 'Flexibilidad',
      description: 'Elige entre múltiples fechas de salida y opciones de personalización para adaptar tu viaje.'
    },
    {
      icon: HeadphonesIcon,
      title: 'Soporte Dedicado',
      description: 'Recibe atención personalizada desde la planificación hasta el regreso de tu viaje.'
    }
  ];

  const destinations = [
    'Asia: Tailandia, Vietnam, Japón, India, Sri Lanka',
    'África: Marruecos, Egipto, Sudáfrica, Tanzania, Kenia',
    'Europa: Grecia, Italia, España, Portugal, Turquía',
    'América del Sur: Perú, Brasil, Argentina, Chile, Ecuador',
    'Oceanía: Australia, Nueva Zelanda, Polinesia Francesa',
    'Oriente Medio: Jordania, Emiratos Árabes, Israel'
  ];

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="container-custom py-6">
        <nav className="flex mb-6" aria-label="Breadcrumb">
          <ol className="inline-flex items-center space-x-1 md:space-x-3">
            <li className="inline-flex items-center">
              <Link to="/" className="text-gray-500 hover:text-primary-600">
                Inicio
              </Link>
            </li>
            <li>
              <div className="flex items-center">
                <ChevronRight className="h-4 w-4 text-gray-400" />
                <span className="ml-1 text-gray-500">Tours</span>
              </div>
            </li>
            <li>
              <div className="flex items-center">
                <ChevronRight className="h-4 w-4 text-gray-400" />
                <span className="ml-1 text-gray-500">Tours Internacionales</span>
              </div>
            </li>
            <li aria-current="page">
              <div className="flex items-center">
                <ChevronRight className="h-4 w-4 text-gray-400" />
                <span className="ml-1 font-medium text-gray-900">Exoticca</span>
              </div>
            </li>
          </ol>
        </nav>

        <div className="bg-gradient-to-r from-primary-600 to-primary-800 rounded-lg shadow-lg p-8 mb-8 text-white">
          <h1 className="text-3xl md:text-4xl font-bold mb-4">Tours Internacionales con Exoticca</h1>
          <p className="text-lg mb-6 text-blue-100">
            Descubre destinos exóticos alrededor del mundo con paquetes completos y experiencias únicas
          </p>

          <div className="bg-white/10 backdrop-blur-sm rounded-lg p-4 mb-6 border border-white/20">
            <div className="flex items-start space-x-3">
              <Info className="h-6 w-6 flex-shrink-0 mt-0.5" />
              <div>
                <p className="font-semibold mb-2">¿Qué es Exoticca?</p>
                <p className="text-sm text-blue-100">
                  Exoticca es un líder global en viajes a destinos exóticos, ofreciendo paquetes todo incluido a más de 60 países.
                  Con años de experiencia, se especializan en crear experiencias memorables combinando vuelos, hoteles de calidad,
                  tours guiados y actividades exclusivas a precios competitivos.
                </p>
              </div>
            </div>
          </div>

          <div className="bg-accent-500 text-gray-900 rounded-lg p-4 mb-6 flex items-start space-x-3">
            <ExternalLink className="h-6 w-6 flex-shrink-0 mt-0.5" />
            <p className="text-sm font-medium">
              Al hacer clic en "Explorar Tours", se abrirá una nueva ventana con el catálogo completo de Exoticca
              donde podrás ver todos los destinos disponibles, precios y hacer tu reservación directamente.
            </p>
          </div>

          <button
            onClick={handleExploreClick}
            className="bg-white text-primary-700 hover:bg-blue-50 px-8 py-4 rounded-lg font-bold text-lg flex items-center space-x-3 transition-all hover:scale-105 shadow-lg"
          >
            <span>Explorar Tours en Exoticca</span>
            <ExternalLink className="h-6 w-6" />
          </button>
        </div>

        <div className="bg-white rounded-lg shadow-md p-8 mb-8">
          <h2 className="text-2xl font-bold text-gray-900 mb-2">¿Por qué elegir Exoticca?</h2>
          <p className="text-gray-600 mb-8">
            Exoticca se dedica a hacer realidad los viajes de tus sueños con servicios premium y atención al detalle
          </p>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {features.map((feature, index) => (
              <div key={index} className="border border-gray-200 rounded-lg p-6 hover:shadow-lg transition-shadow">
                <div className="bg-primary-100 w-12 h-12 rounded-lg flex items-center justify-center mb-4">
                  <feature.icon className="h-6 w-6 text-primary-600" />
                </div>
                <h3 className="text-lg font-bold text-gray-900 mb-2">{feature.title}</h3>
                <p className="text-gray-600 text-sm">{feature.description}</p>
              </div>
            ))}
          </div>
        </div>

        <div className="bg-white rounded-lg shadow-md p-8 mb-8">
          <h2 className="text-2xl font-bold text-gray-900 mb-4">Destinos Populares</h2>
          <p className="text-gray-600 mb-6">
            Explora algunos de los destinos más fascinantes que Exoticca tiene para ofrecerte:
          </p>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {destinations.map((dest, index) => (
              <div key={index} className="flex items-start space-x-3 p-4 bg-gray-50 rounded-lg">
                <MapPin className="h-5 w-5 text-primary-600 flex-shrink-0 mt-0.5" />
                <p className="text-gray-700">{dest}</p>
              </div>
            ))}
          </div>

          <div className="mt-8 p-6 bg-primary-50 rounded-lg border border-primary-200">
            <h3 className="font-bold text-gray-900 mb-2">Paquetes Todo Incluido</h3>
            <p className="text-gray-700 text-sm mb-4">
              Todos los paquetes de Exoticca incluyen vuelos internacionales, hoteles seleccionados, traslados,
              tours guiados en español, algunas comidas y asistencia durante todo el viaje. Solo necesitas
              preparar tu maleta y disfrutar de la experiencia.
            </p>
          </div>
        </div>

        <div className="bg-gray-100 border border-gray-300 rounded-lg shadow-sm p-6 mb-8">
          <h3 className="text-lg font-bold text-gray-900 mb-4">Aviso Legal</h3>
          <div className="space-y-3 text-sm text-gray-700 leading-relaxed">
            <p>
              Los paquetes y servicios turísticos internacionales ofrecidos en esta sección son prestados, operados y administrados directamente por <span className="font-semibold">Exoticca</span>, quien actúa como proveedor final del servicio.
            </p>
            <p>
              Exoticca es el único responsable de la ejecución del viaje, calidad de los servicios, atención al cliente, políticas de cancelación, modificaciones, reembolsos y cualquier reclamación relacionada con la experiencia de viaje.
            </p>
            <p>
              ToursRed no opera, organiza ni administra los viajes, y participa exclusivamente como intermediario de referencia, limitando su responsabilidad a la promoción y canalización del usuario hacia el proveedor externo.
            </p>
          </div>
        </div>

        <div className="bg-gradient-to-r from-gray-800 to-gray-900 rounded-lg shadow-lg p-8 text-white text-center">
          <h2 className="text-2xl font-bold mb-4">¿Listo para tu próxima aventura?</h2>
          <p className="text-gray-300 mb-6 max-w-2xl mx-auto">
            Explora el catálogo completo de Exoticca, encuentra tu destino ideal y reserva con confianza.
            Si tienes dudas, nuestro equipo está listo para ayudarte.
          </p>

          <div className="flex flex-col sm:flex-row gap-4 justify-center items-center">
            <button
              onClick={handleExploreClick}
              className="bg-primary-600 hover:bg-primary-700 text-white px-8 py-3 rounded-lg font-bold flex items-center space-x-2 transition-all hover:scale-105"
            >
              <span>Ver Catálogo Completo</span>
              <ExternalLink className="h-5 w-5" />
            </button>

            <Link
              to="/contact"
              className="bg-white hover:bg-gray-100 text-gray-900 px-8 py-3 rounded-lg font-bold transition-colors"
            >
              Contáctanos
            </Link>
          </div>
        </div>

        <button
          onClick={() => setIsModalOpen(true)}
          className="fixed bottom-6 right-6 bg-primary-600 hover:bg-primary-700 text-white px-6 py-4 rounded-full shadow-lg flex items-center space-x-2 transition-transform hover:scale-105 z-40"
        >
          <MessageSquare className="h-5 w-5" />
          <span className="font-semibold">Solicitar Cotizacion</span>
        </button>
      </div>

      {isModalOpen && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-lg max-w-2xl w-full max-h-[90vh] overflow-y-auto">
            <div className="sticky top-0 bg-white border-b border-gray-200 px-6 py-4 flex items-center justify-between">
              <h2 className="text-2xl font-bold text-gray-900">Solicitar Cotizacion</h2>
              <button
                onClick={() => setIsModalOpen(false)}
                className="text-gray-400 hover:text-gray-600"
              >
                <X className="h-6 w-6" />
              </button>
            </div>

            <form onSubmit={handleSubmit} className="p-6">
              {success && (
                <div className="mb-6 p-4 bg-green-50 border border-green-200 rounded-lg">
                  <p className="text-green-800 font-medium">
                    Cotizacion enviada exitosamente! Nos pondremos en contacto contigo pronto.
                  </p>
                </div>
              )}

              {error && (
                <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-lg">
                  <p className="text-red-800">{error}</p>
                </div>
              )}

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div>
                  <label htmlFor="name" className="block text-sm font-medium text-gray-700 mb-2">
                    Nombre Completo <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="text"
                    id="name"
                    name="name"
                    value={formData.name}
                    onChange={handleInputChange}
                    required
                    className="w-full px-4 py-2 border border-gray-300 rounded-md focus:ring-primary-500 focus:border-primary-500"
                  />
                </div>

                <div>
                  <label htmlFor="email" className="block text-sm font-medium text-gray-700 mb-2">
                    Email <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="email"
                    id="email"
                    name="email"
                    value={formData.email}
                    onChange={handleInputChange}
                    required
                    className="w-full px-4 py-2 border border-gray-300 rounded-md focus:ring-primary-500 focus:border-primary-500"
                  />
                </div>

                <div>
                  <label htmlFor="phone" className="block text-sm font-medium text-gray-700 mb-2">
                    Telefono <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="tel"
                    id="phone"
                    name="phone"
                    value={formData.phone}
                    onChange={handleInputChange}
                    placeholder="10 digitos"
                    required
                    className="w-full px-4 py-2 border border-gray-300 rounded-md focus:ring-primary-500 focus:border-primary-500"
                  />
                </div>

                <div>
                  <label htmlFor="travel_date" className="block text-sm font-medium text-gray-700 mb-2">
                    Fecha Aproximada de Viaje
                  </label>
                  <input
                    type="date"
                    id="travel_date"
                    name="travel_date"
                    value={formData.travel_date}
                    onChange={handleInputChange}
                    min={new Date().toISOString().split('T')[0]}
                    className="w-full px-4 py-2 border border-gray-300 rounded-md focus:ring-primary-500 focus:border-primary-500"
                  />
                </div>

                <div>
                  <label htmlFor="destination" className="block text-sm font-medium text-gray-700 mb-2">
                    Nombre del Viaje <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="text"
                    id="destination"
                    name="destination"
                    value={formData.destination}
                    onChange={handleInputChange}
                    placeholder="Ej: Tailandia Esencial"
                    required
                    className="w-full px-4 py-2 border border-gray-300 rounded-md focus:ring-primary-500 focus:border-primary-500"
                  />
                </div>

                <div>
                  <label htmlFor="num_people" className="block text-sm font-medium text-gray-700 mb-2">
                    Numero de Personas <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="number"
                    id="num_people"
                    name="num_people"
                    value={formData.num_people}
                    onChange={handleInputChange}
                    min="1"
                    required
                    className="w-full px-4 py-2 border border-gray-300 rounded-md focus:ring-primary-500 focus:border-primary-500"
                  />
                </div>
              </div>

              <div className="mt-6">
                <label htmlFor="message" className="block text-sm font-medium text-gray-700 mb-2">
                  Mensaje o Comentarios Adicionales
                </label>
                <textarea
                  id="message"
                  name="message"
                  value={formData.message}
                  onChange={handleInputChange}
                  rows={4}
                  className="w-full px-4 py-2 border border-gray-300 rounded-md focus:ring-primary-500 focus:border-primary-500"
                  placeholder="Cuentanos mas sobre tu viaje ideal..."
                />
              </div>

              <div className="mt-6 flex justify-end space-x-4">
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  className="px-6 py-2 border border-gray-300 rounded-md text-gray-700 hover:bg-gray-50"
                  disabled={isLoading}
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="px-6 py-2 bg-primary-600 text-white rounded-md hover:bg-primary-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center space-x-2"
                  disabled={isLoading}
                >
                  {isLoading ? (
                    <>
                      <Loader className="h-5 w-5 animate-spin" />
                      <span>Enviando...</span>
                    </>
                  ) : (
                    <span>Enviar Cotizacion</span>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default ExoticcaPage;
