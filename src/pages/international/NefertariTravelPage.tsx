import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { ChevronRight, Info, X, Loader, AlertCircle, MessageSquare, RotateCcw } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useFormPersistence } from '../../hooks/useFormPersistence';
import { usePreventUnload } from '../../hooks/usePreventUnload';

const IFRAME_URL = 'https://nefertaritravel.com.mx/sg/?iframe=yes';

const NefertariTravelPage: React.FC = () => {
  const { user } = useAuth();
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
  const [iframeLoading, setIframeLoading] = useState(true);
  const [iframeError, setIframeError] = useState(false);
  const iframeRef = React.useRef<HTMLIFrameElement>(null);

  const handleBackToCatalog = () => {
    if (iframeRef.current) {
      setIframeLoading(true);
      iframeRef.current.src = IFRAME_URL;
    }
  };

  const formPersistence = useFormPersistence(
    formData,
    { key: 'nefertari_travel_inquiry', expirationHours: 24 }
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
            source: 'nefertari_travel'
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
                <span className="ml-1 font-medium text-gray-900">Nefertari Travel</span>
              </div>
            </li>
          </ol>
        </nav>

        <div className="bg-gradient-to-r from-amber-700 to-amber-900 rounded-lg shadow-lg p-8 mb-8 text-white">
          <h1 className="text-3xl md:text-4xl font-bold mb-4">Tours Internacionales con Nefertari Travel</h1>
          <p className="text-lg mb-6 text-amber-100">
            Explora destinos fascinantes alrededor del mundo con experiencias unicas y servicio personalizado
          </p>

          <div className="bg-white/10 backdrop-blur-sm rounded-lg p-4 mb-6 border border-white/20">
            <div className="flex items-start space-x-3">
              <Info className="h-6 w-6 flex-shrink-0 mt-0.5" />
              <div>
                <p className="font-semibold mb-2">Como funciona?</p>
                <p className="text-sm text-amber-100">
                  Explora el catalogo de Nefertari Travel, encuentra el viaje que mas te guste y solicita una cotizacion personalizada.
                  Nuestro equipo se pondra en contacto contigo en menos de 24 horas con toda la informacion y precios actualizados.
                </p>
              </div>
            </div>
          </div>

          <div className="bg-amber-400 text-gray-900 rounded-lg p-4 flex items-start space-x-3">
            <AlertCircle className="h-6 w-6 flex-shrink-0 mt-0.5" />
            <p className="text-sm font-medium">
              Este es un catalogo informativo. Para reservar, primero debes solicitar una cotizacion y nuestro equipo te guiara en el proceso de compra.
            </p>
          </div>
        </div>

        <div className="flex justify-center my-6">
          <button
            onClick={handleBackToCatalog}
            className="inline-flex items-center space-x-2 px-6 py-3 border-2 border-gray-300 rounded-full text-gray-700 bg-white hover:bg-gray-50 hover:border-gray-400 transition-all font-medium shadow-sm"
          >
            <RotateCcw className="h-4 w-4" />
            <span>Volver al Catalogo</span>
          </button>
        </div>

        <div className="bg-white rounded-lg shadow-md overflow-hidden">
          <div className="relative">
            {iframeLoading && (
              <div className="absolute inset-0 flex items-center justify-center bg-gray-100 z-10">
                <div className="text-center">
                  <Loader className="h-12 w-12 text-amber-700 animate-spin mx-auto mb-4" />
                  <p className="text-gray-600">Cargando catalogo...</p>
                </div>
              </div>
            )}

            {iframeError ? (
              <div className="p-12 text-center">
                <AlertCircle className="h-16 w-16 text-red-500 mx-auto mb-4" />
                <p className="text-gray-600 mb-4">No se pudo cargar el catalogo</p>
                <a
                  href="https://nefertaritravel.com.mx"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="btn btn-primary"
                >
                  Ver en Nefertari Travel
                </a>
              </div>
            ) : (
              <iframe
                ref={iframeRef}
                src={IFRAME_URL}
                className="w-full h-[600px] md:h-[800px]"
                title="Catalogo de Nefertari Travel"
                onLoad={() => setIframeLoading(false)}
                onError={() => {
                  setIframeLoading(false);
                  setIframeError(true);
                }}
              />
            )}
          </div>
        </div>

        <div className="bg-gray-100 border border-gray-300 rounded-lg shadow-sm p-6 mt-8">
          <h3 className="text-lg font-bold text-gray-900 mb-4">Aviso Legal</h3>
          <div className="space-y-3 text-sm text-gray-700 leading-relaxed">
            <p>
              Los paquetes y servicios turisticos internacionales ofrecidos en esta seccion son prestados, operados y administrados directamente por <span className="font-semibold">Nefertari Travel</span>, quien actua como proveedor final del servicio.
            </p>
            <p>
              Nefertari Travel es el unico responsable de la ejecucion del viaje, calidad de los servicios, atencion al cliente, politicas de cancelacion, modificaciones, reembolsos y cualquier reclamacion relacionada con la experiencia de viaje.
            </p>
            <p>
              ToursRed no opera, organiza ni administra los viajes, y participa exclusivamente como intermediario de referencia, limitando su responsabilidad a la promocion y canalizacion del usuario hacia el proveedor externo.
            </p>
          </div>
        </div>

        <button
          onClick={() => setIsModalOpen(true)}
          className="fixed bottom-6 right-6 bg-amber-600 hover:bg-amber-700 text-white px-6 py-4 rounded-full shadow-lg flex items-center space-x-2 transition-transform hover:scale-105 z-40"
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
                    placeholder="Ej: Europeando 2026"
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
                  className="px-6 py-2 bg-amber-600 text-white rounded-md hover:bg-amber-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center space-x-2"
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

export default NefertariTravelPage;
