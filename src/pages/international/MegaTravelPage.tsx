import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { ChevronRight, Info, X, Loader, AlertCircle, MessageSquare } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { supabase } from '../../lib/supabase';
import { useFormPersistence } from '../../hooks/useFormPersistence';
import { usePreventUnload } from '../../hooks/usePreventUnload';

interface DestinationTab {
  id: string;
  label: string;
  url: string;
}

const destinations: DestinationTab[] = [
  { id: 'ofertas', label: 'Mejores Ofertas', url: 'https://www.megatravel.com.mx/tools/ofertas-viaje.php' },
  { id: 'promociones', label: 'Promociones Vigentes', url: 'https://www.megatravel.com.mx/tools/vi.php' },
  { id: 'europa', label: 'Europa', url: 'https://www.megatravel.com.mx/tools/vi.php?Dest=1' },
  { id: 'medio-oriente', label: 'Medio Oriente', url: 'https://www.megatravel.com.mx/tools/vi.php?Dest=2' },
  { id: 'canada', label: 'Canadá', url: 'https://www.megatravel.com.mx/tools/vi.php?Dest=3' },
  { id: 'asia', label: 'Asia', url: 'https://www.megatravel.com.mx/tools/vi.php?Dest=4' },
  { id: 'africa', label: 'África', url: 'https://www.megatravel.com.mx/tools/vi.php?Dest=5' },
  { id: 'pacifico', label: 'Pacífico', url: 'https://www.megatravel.com.mx/tools/vi.php?Dest=6' },
  { id: 'sudamerica', label: 'Sudamérica', url: 'https://www.megatravel.com.mx/tools/vi.php?Dest=7' },
  { id: 'estados-unidos', label: 'Estados Unidos', url: 'https://www.megatravel.com.mx/tools/vi.php?Dest=8' },
  { id: 'centroamerica', label: 'Centroamérica', url: 'https://www.megatravel.com.mx/tools/vi.php?Dest=9' },
  { id: 'caribe', label: 'Cuba y el Caribe', url: 'https://www.megatravel.com.mx/tools/vi.php?Dest=10' },
  { id: 'eventos', label: 'Eventos Especiales', url: 'https://www.megatravel.com.mx/tools/vi.php?Dest=12' },
  { id: 'cruceros', label: 'Cruceros', url: 'https://www.megatravel.com.mx/tools/vi.php?Dest=13' },
];

const MegaTravelPage: React.FC = () => {
  const { user } = useAuth();
  const [activeTab, setActiveTab] = useState(destinations[0].id);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [formData, setFormData] = useState({
    name: '',
    email: '',
    phone: '',
    destination: destinations[0].label,
    travel_date: '',
    num_people: 1,
    tour_code: '',
    message: ''
  });
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);
  const [iframeLoading, setIframeLoading] = useState(true);
  const [iframeError, setIframeError] = useState(false);

  const activeDestination = destinations.find(d => d.id === activeTab) || destinations[0];
  const iframeUrl = `${activeDestination.url}${activeDestination.url.includes('?') ? '&' : '?'}colorPrimario=2563eb&colorSecundario=f59e0b&colorTexto=000000&colorFondo=ffffff`;

  const megaTravelFormPersistence = useFormPersistence(
    formData,
    { key: 'mega_travel_inquiry', expirationHours: 24 }
  );

  usePreventUnload(
    formData.name.length > 0 ||
    formData.email.length > 0 ||
    formData.phone.length > 0 ||
    formData.message.length > 0
  );

  useEffect(() => {
    const savedData = megaTravelFormPersistence.loadFromStorage();
    if (savedData) {
      megaTravelFormPersistence.setIsRestoring(true);
      setFormData(savedData);
      setTimeout(() => megaTravelFormPersistence.setIsRestoring(false), 100);
    }
  }, []);

  useEffect(() => {
    setFormData(prev => ({
      ...prev,
      destination: activeDestination.label
    }));
  }, [activeDestination.label]);

  useEffect(() => {
    setIframeLoading(true);
    setIframeError(false);
  }, [activeTab]);

  const handleTabChange = (tabId: string) => {
    setActiveTab(tabId);
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
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

    if (!formData.name || !formData.email || !formData.phone || !formData.num_people) {
      setError('Por favor completa todos los campos requeridos');
      setIsLoading(false);
      return;
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(formData.email)) {
      setError('Por favor ingresa un email válido');
      setIsLoading(false);
      return;
    }

    const phoneRegex = /^\d{10}$/;
    if (!phoneRegex.test(formData.phone.replace(/\D/g, ''))) {
      setError('Por favor ingresa un teléfono válido de 10 dígitos');
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
            source: 'mega_travel'
          }),
        }
      );

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || 'Error al enviar la cotización');
      }

      megaTravelFormPersistence.clearStorage();
      setSuccess(true);
      setTimeout(() => {
        setIsModalOpen(false);
        setSuccess(false);
        setFormData({
          name: '',
          email: '',
          phone: '',
          destination: activeDestination.label,
          travel_date: '',
          num_people: 1,
          tour_code: '',
          message: ''
        });
      }, 2000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al enviar la cotización');
    } finally {
      setIsLoading(false);
    }
  };

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
                <span className="ml-1 font-medium text-gray-900">Mega Travel</span>
              </div>
            </li>
          </ol>
        </nav>

        <div className="bg-gradient-to-r from-primary-600 to-primary-800 rounded-lg shadow-lg p-8 mb-8 text-white">
          <h1 className="text-3xl md:text-4xl font-bold mb-4">Tours Internacionales con Mega Travel</h1>
          <p className="text-lg mb-6 text-blue-100">
            Explora más de 100 destinos alrededor del mundo con nuestro aliado de confianza
          </p>

          <div className="bg-white/10 backdrop-blur-sm rounded-lg p-4 mb-6 border border-white/20">
            <div className="flex items-start space-x-3">
              <Info className="h-6 w-6 flex-shrink-0 mt-0.5" />
              <div>
                <p className="font-semibold mb-2">¿Cómo funciona?</p>
                <p className="text-sm text-blue-100">
                  Explora nuestro catálogo de destinos internacionales, encuentra el viaje de tus sueños y solicita una cotización personalizada.
                  Nuestro equipo se pondrá en contacto contigo en menos de 24 horas con toda la información y precios actualizados para hacer tu reservación.
                </p>
              </div>
            </div>
          </div>

          <div className="bg-accent-500 text-gray-900 rounded-lg p-4 flex items-start space-x-3">
            <AlertCircle className="h-6 w-6 flex-shrink-0 mt-0.5" />
            <p className="text-sm font-medium">
              Este es un catálogo informativo. Para reservar, primero debes solicitar una cotización y nuestro equipo te guiará en el proceso de compra.
            </p>
          </div>
        </div>

        <div className="bg-white rounded-lg shadow-md overflow-hidden">
          <div className="border-b border-gray-200">
            <div className="overflow-x-auto">
              <nav className="flex space-x-2 p-4 min-w-max" aria-label="Tabs">
                {destinations.map((dest) => (
                  <button
                    key={dest.id}
                    onClick={() => handleTabChange(dest.id)}
                    className={`px-4 py-2 text-sm font-medium rounded-md whitespace-nowrap transition-colors ${
                      activeTab === dest.id
                        ? 'bg-primary-600 text-white'
                        : 'text-gray-600 hover:text-gray-900 hover:bg-gray-100'
                    }`}
                  >
                    {dest.label}
                  </button>
                ))}
              </nav>
            </div>
          </div>

          <div className="relative">
            {iframeLoading && (
              <div className="absolute inset-0 flex items-center justify-center bg-gray-100 z-10">
                <div className="text-center">
                  <Loader className="h-12 w-12 text-primary-600 animate-spin mx-auto mb-4" />
                  <p className="text-gray-600">Cargando catálogo...</p>
                </div>
              </div>
            )}

            {iframeError ? (
              <div className="p-12 text-center">
                <AlertCircle className="h-16 w-16 text-red-500 mx-auto mb-4" />
                <p className="text-gray-600 mb-4">No se pudo cargar el catálogo</p>
                <a
                  href={activeDestination.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="btn btn-primary"
                >
                  Ver en Mega Travel
                </a>
              </div>
            ) : (
              <iframe
                key={activeTab}
                src={iframeUrl}
                className="w-full h-[600px] md:h-[800px]"
                title={`Catálogo de ${activeDestination.label}`}
                onLoad={() => setIframeLoading(false)}
                onError={() => {
                  setIframeLoading(false);
                  setIframeError(true);
                }}
              />
            )}
          </div>
        </div>

        <button
          onClick={() => setIsModalOpen(true)}
          className="fixed bottom-6 right-6 bg-accent-500 hover:bg-accent-600 text-white px-6 py-4 rounded-full shadow-lg flex items-center space-x-2 transition-transform hover:scale-105 z-40"
        >
          <MessageSquare className="h-5 w-5" />
          <span className="font-semibold">Solicitar Cotización</span>
        </button>
      </div>

      {isModalOpen && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-lg max-w-2xl w-full max-h-[90vh] overflow-y-auto">
            <div className="sticky top-0 bg-white border-b border-gray-200 px-6 py-4 flex items-center justify-between">
              <h2 className="text-2xl font-bold text-gray-900">Solicitar Cotización</h2>
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
                    ¡Cotización enviada exitosamente! Nos pondremos en contacto contigo pronto.
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
                    Teléfono <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="tel"
                    id="phone"
                    name="phone"
                    value={formData.phone}
                    onChange={handleInputChange}
                    placeholder="10 dígitos"
                    required
                    className="w-full px-4 py-2 border border-gray-300 rounded-md focus:ring-primary-500 focus:border-primary-500"
                  />
                </div>

                <div>
                  <label htmlFor="destination" className="block text-sm font-medium text-gray-700 mb-2">
                    Destino de Interés <span className="text-red-500">*</span>
                  </label>
                  <select
                    id="destination"
                    name="destination"
                    value={formData.destination}
                    onChange={handleInputChange}
                    required
                    className="w-full px-4 py-2 border border-gray-300 rounded-md focus:ring-primary-500 focus:border-primary-500"
                  >
                    {destinations.map((dest) => (
                      <option key={dest.id} value={dest.label}>
                        {dest.label}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label htmlFor="tour_code" className="block text-sm font-medium text-gray-700 mb-2">
                    Código de Viaje
                  </label>
                  <div className="flex items-center">
                    <span className="inline-flex items-center px-3 py-2 border border-r-0 border-gray-300 bg-gray-50 text-gray-600 text-sm rounded-l-md font-medium">
                      MT-
                    </span>
                    <input
                      type="text"
                      id="tour_code"
                      name="tour_code"
                      value={formData.tour_code}
                      onChange={handleInputChange}
                      placeholder="20293"
                      className="flex-1 px-4 py-2 border border-gray-300 rounded-r-md focus:ring-primary-500 focus:border-primary-500"
                    />
                  </div>
                  <p className="text-xs text-gray-500 mt-1">
                    Si ya conoces el código del tour, ingrésalo aquí para una cotización más precisa
                  </p>
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
                  <label htmlFor="num_people" className="block text-sm font-medium text-gray-700 mb-2">
                    Número de Personas <span className="text-red-500">*</span>
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
                  placeholder="Cuéntanos más sobre tu viaje ideal..."
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
                    <span>Enviar Cotización</span>
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

export default MegaTravelPage;
