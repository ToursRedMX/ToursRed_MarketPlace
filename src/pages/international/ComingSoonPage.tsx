import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { ChevronRight, Plane, Clock, Globe, Mail, Loader, CheckCircle } from 'lucide-react';
import { supabase } from '../../lib/supabase';

const ComingSoonPage: React.FC = () => {
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setIsLoading(true);

    if (!name || !email) {
      setError('Por favor completa todos los campos');
      setIsLoading(false);
      return;
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      setError('Por favor ingresa un email válido');
      setIsLoading(false);
      return;
    }

    try {
      const { error: insertError } = await supabase
        .from('newsletter_subscriptions')
        .insert({
          email,
          name,
          tags: ['international_tours_waitlist']
        });

      if (insertError) {
        if (insertError.code === '23505') {
          setError('Este email ya está registrado en nuestra lista');
        } else {
          throw insertError;
        }
      } else {
        setSuccess(true);
        setEmail('');
        setName('');
        setTimeout(() => setSuccess(false), 5000);
      }
    } catch (err) {
      setError('Error al registrar tu email. Por favor intenta de nuevo.');
      console.error('Error:', err);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-orange-50">
      <div className="container-custom py-6">
        <nav className="flex mb-8" aria-label="Breadcrumb">
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
                <span className="ml-1 font-medium text-gray-900">Otras Agencias</span>
              </div>
            </li>
          </ol>
        </nav>

        <div className="max-w-4xl mx-auto">
          <div className="text-center mb-12">
            <div className="inline-flex items-center justify-center w-24 h-24 bg-primary-100 rounded-full mb-6">
              <Plane className="h-12 w-12 text-primary-600 animate-bounce" />
            </div>
            <h1 className="text-4xl md:text-5xl font-bold text-gray-900 mb-4">
              Próximamente: Más Opciones de Tours Internacionales
            </h1>
            <p className="text-xl text-gray-600">
              Estamos trabajando con más agencias verificadas para traerte las mejores opciones de viajes internacionales
            </p>
          </div>

          <div className="bg-white rounded-lg shadow-xl p-8 md:p-12 mb-12">
            <div className="grid md:grid-cols-3 gap-8 mb-12">
              <div className="text-center">
                <div className="inline-flex items-center justify-center w-16 h-16 bg-blue-100 rounded-full mb-4">
                  <Globe className="h-8 w-8 text-primary-600" />
                </div>
                <h3 className="text-lg font-semibold text-gray-900 mb-2">Más Destinos</h3>
                <p className="text-gray-600 text-sm">
                  Trabajando para agregarte aún más opciones de destinos alrededor del mundo
                </p>
              </div>

              <div className="text-center">
                <div className="inline-flex items-center justify-center w-16 h-16 bg-orange-100 rounded-full mb-4">
                  <CheckCircle className="h-8 w-8 text-accent-600" />
                </div>
                <h3 className="text-lg font-semibold text-gray-900 mb-2">Agencias Verificadas</h3>
                <p className="text-gray-600 text-sm">
                  Solo trabajamos con agencias de confianza y con años de experiencia
                </p>
              </div>

              <div className="text-center">
                <div className="inline-flex items-center justify-center w-16 h-16 bg-green-100 rounded-full mb-4">
                  <Clock className="h-8 w-8 text-green-600" />
                </div>
                <h3 className="text-lg font-semibold text-gray-900 mb-2">Disponible Pronto</h3>
                <p className="text-gray-600 text-sm">
                  Estaremos lanzando nuevas opciones en los próximos meses
                </p>
              </div>
            </div>

            <div className="border-t border-gray-200 pt-8">
              <div className="bg-gradient-to-r from-primary-50 to-accent-50 rounded-lg p-8">
                <div className="flex items-center justify-center mb-6">
                  <Mail className="h-8 w-8 text-primary-600 mr-3" />
                  <h2 className="text-2xl font-bold text-gray-900">Notifícame cuando esté disponible</h2>
                </div>

                <p className="text-center text-gray-600 mb-6">
                  Déjanos tu email y te avisaremos cuando tengamos nuevas opciones de tours internacionales
                </p>

                {success && (
                  <div className="mb-6 p-4 bg-green-50 border border-green-200 rounded-lg flex items-center">
                    <CheckCircle className="h-5 w-5 text-green-600 mr-3 flex-shrink-0" />
                    <p className="text-green-800 font-medium">
                      ¡Gracias! Te notificaremos cuando tengamos novedades.
                    </p>
                  </div>
                )}

                {error && (
                  <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-lg">
                    <p className="text-red-800">{error}</p>
                  </div>
                )}

                <form onSubmit={handleSubmit} className="max-w-md mx-auto">
                  <div className="mb-4">
                    <label htmlFor="name" className="block text-sm font-medium text-gray-700 mb-2">
                      Nombre
                    </label>
                    <input
                      type="text"
                      id="name"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      required
                      className="w-full px-4 py-3 border border-gray-300 rounded-md focus:ring-primary-500 focus:border-primary-500"
                      placeholder="Tu nombre completo"
                    />
                  </div>

                  <div className="mb-6">
                    <label htmlFor="email" className="block text-sm font-medium text-gray-700 mb-2">
                      Email
                    </label>
                    <input
                      type="email"
                      id="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      required
                      className="w-full px-4 py-3 border border-gray-300 rounded-md focus:ring-primary-500 focus:border-primary-500"
                      placeholder="tu@email.com"
                    />
                  </div>

                  <button
                    type="submit"
                    disabled={isLoading}
                    className="w-full bg-primary-600 text-white py-3 px-6 rounded-md hover:bg-primary-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center space-x-2 font-semibold"
                  >
                    {isLoading ? (
                      <>
                        <Loader className="h-5 w-5 animate-spin" />
                        <span>Registrando...</span>
                      </>
                    ) : (
                      <span>Notifícame</span>
                    )}
                  </button>
                </form>
              </div>
            </div>
          </div>

          <div className="text-center">
            <p className="text-gray-600 mb-4">Mientras tanto, puedes explorar nuestras opciones actuales:</p>
            <div className="flex flex-col sm:flex-row gap-4 justify-center">
              <Link
                to="/tours"
                className="btn btn-outline"
              >
                Ver Tours Nacionales
              </Link>
              <Link
                to="/tours/international/mega-travel"
                className="btn btn-primary"
              >
                Ver Tours con Mega Travel
              </Link>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ComingSoonPage;
