import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { Facebook, Instagram, Linkedin, Mail, Phone } from 'lucide-react';

const Footer: React.FC = () => {
  const [email, setEmail] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const handleSubscribe = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!email.trim()) {
      setMessage({ type: 'error', text: 'Por favor ingresa tu email' });
      return;
    }

    setIsLoading(true);
    setMessage(null);

    try {
      const response = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/subscribe-newsletter`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: email.trim() }),
        }
      );

      const data = await response.json();

      if (response.ok) {
        setMessage({ type: 'success', text: data.message || '¡Gracias por suscribirte!' });
        setEmail('');
      } else if (response.status === 409) {
        setMessage({ type: 'error', text: 'Este email ya está suscrito a nuestro boletín' });
      } else {
        setMessage({ type: 'error', text: data.error || 'Error al procesar la suscripción' });
      }
    } catch (error) {
      console.error('Error subscribing to newsletter:', error);
      setMessage({ type: 'error', text: 'Error de conexión. Intenta nuevamente.' });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <footer className="bg-blue-900 text-white pt-12 pb-8">
      <div className="container-custom">
        {/* 5-column grid */}
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-6">

          {/* Col 1: Brand */}
          <div className="col-span-2 sm:col-span-1">
            <div className="flex items-center mb-4">
              <img src="/Logo_Transparente.jpg" alt="ToursRed Logo" loading="lazy" className="h-20 w-auto" />
            </div>
            <p className="text-gray-400 text-sm mb-4">
              Descubre destinos extraordinarios y experiencias inolvidables con nuestros socios de viaje de confianza.
            </p>
            <div className="flex space-x-3">
              <a href="https://www.facebook.com/ToursRedMX" target="_blank" rel="noopener noreferrer" className="text-gray-400 hover:text-white transition-colors">
                <Facebook className="h-5 w-5" />
              </a>
              <a href="https://www.instagram.com/toursredmx" target="_blank" rel="noopener noreferrer" className="text-gray-400 hover:text-white transition-colors">
                <Instagram className="h-5 w-5" />
              </a>
              <a href="https://www.tiktok.com/@toursredmx" target="_blank" rel="noopener noreferrer" className="text-gray-400 hover:text-white transition-colors">
                <img src="https://cdn.jsdelivr.net/gh/simple-icons/simple-icons/icons/tiktok.svg" alt="TikTok" loading="lazy" className="h-5 w-5" style={{ filter: 'invert(0.6)' }} />
              </a>
              <a href="https://www.linkedin.com/company/toursredmx" target="_blank" rel="noopener noreferrer" className="text-gray-400 hover:text-white transition-colors">
                <Linkedin className="h-5 w-5" />
              </a>
              <a href="https://x.com/ToursRedMX" target="_blank" rel="noopener noreferrer" className="text-gray-400 hover:text-white transition-colors">
                <svg className="h-5 w-5" viewBox="0 0 24 24" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
                  <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
                </svg>
              </a>
            </div>
          </div>

          {/* Col 2: Enlaces Rápidos */}
          <div>
            <h3 className="text-sm font-semibold uppercase tracking-wide mb-4 text-white">Enlaces Rápidos</h3>
            <ul className="space-y-2">
              <li><Link to="/" className="text-gray-400 hover:text-white transition-colors text-sm">Inicio</Link></li>
              <li><Link to="/tours" className="text-gray-400 hover:text-white transition-colors text-sm">Tours</Link></li>
              <li><Link to="/about" className="text-gray-400 hover:text-white transition-colors text-sm">Nosotros</Link></li>
              <li><Link to="/contact" className="text-gray-400 hover:text-white transition-colors text-sm">Contacto</Link></li>
            </ul>
          </div>

          {/* Col 3: Para Viajeros */}
          <div>
            <h3 className="text-sm font-semibold uppercase tracking-wide mb-4 text-white">Para Viajeros</h3>
            <ul className="space-y-2">
              <li><Link to="/login" className="text-gray-400 hover:text-white transition-colors text-sm">Iniciar Sesión</Link></li>
              <li><Link to="/signup" className="text-gray-400 hover:text-white transition-colors text-sm">Registrarse</Link></li>
              <li><Link to="/gift-cards" className="text-gray-400 hover:text-white transition-colors text-sm">Tarjetas de Regalo</Link></li>
              <li><Link to="/booking-guide" className="text-gray-400 hover:text-white transition-colors text-sm">Cómo Reservar</Link></li>
              <li><Link to="/faq" className="text-gray-400 hover:text-white transition-colors text-sm">Preguntas Frecuentes</Link></li>
            </ul>
          </div>

          {/* Col 4: Aviso Legal */}
          <div>
            <h3 className="text-sm font-semibold uppercase tracking-wide mb-4 text-white">Aviso Legal</h3>
            <ul className="space-y-2">
              <li><Link to="/aviso-privacidad" className="text-gray-400 hover:text-white transition-colors text-sm">Aviso de Privacidad</Link></li>
              <li><Link to="/terminos-servicio" className="text-gray-400 hover:text-white transition-colors text-sm">Términos de Servicio</Link></li>
              <li><Link to="/politica-cookies" className="text-gray-400 hover:text-white transition-colors text-sm">Política de Cookies</Link></li>
              <li>
                <button
                  onClick={() => { localStorage.removeItem('cookie_consent'); window.location.reload(); }}
                  className="text-gray-400 hover:text-white transition-colors text-sm text-left"
                >
                  Preferencias de Cookies
                </button>
              </li>
            </ul>
          </div>

          {/* Col 5: Contáctanos */}
          <div>
            <h3 className="text-sm font-semibold uppercase tracking-wide mb-4 text-white">Contáctanos</h3>
            <ul className="space-y-2 mb-4">
              <li className="flex items-center">
                <Mail className="h-4 w-4 text-gray-400 mr-2 shrink-0" />
                <a href="mailto:contacto@toursred.com" className="text-gray-400 hover:text-white transition-colors text-sm">
                  contacto@toursred.com
                </a>
              </li>
              <li className="flex items-center">
                <Phone className="h-4 w-4 text-gray-400 mr-2 shrink-0" />
                <a href="https://wa.me/525547127668" target="_blank" rel="noopener noreferrer" className="text-gray-400 hover:text-white transition-colors text-sm">
                  +52 55 47127668
                </a>
              </li>
            </ul>
            <div>
              <h4 className="text-xs font-semibold mb-2 text-gray-300">Suscríbete a nuestro boletín</h4>
              <form onSubmit={handleSubscribe}>
                <div className="flex">
                  <input
                    type="email"
                    placeholder="Tu correo"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    disabled={isLoading}
                    className="px-3 py-2 rounded-l-md w-full text-gray-900 text-xs disabled:opacity-50"
                  />
                  <button
                    type="submit"
                    disabled={isLoading}
                    className="bg-primary-600 px-3 py-2 rounded-r-md text-white font-medium text-xs hover:bg-primary-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap"
                  >
                    {isLoading ? '...' : 'Suscribirse'}
                  </button>
                </div>
                {message && (
                  <p className={`text-xs mt-2 ${message.type === 'success' ? 'text-green-300' : 'text-red-300'}`}>
                    {message.text}
                  </p>
                )}
              </form>
            </div>
          </div>
        </div>

        {/* Bottom bar */}
        <div className="border-t border-blue-800 mt-8 pt-5">
          <div className="flex flex-col sm:flex-row justify-between items-center gap-4">
            {/* Logos institucionales */}
            <div className="flex items-center gap-6 flex-wrap justify-center sm:justify-start">
              {/* SECTUR + RNT */}
              <a href="https://rnt-consulta.sectur.gob.mx/" target="_blank" rel="noopener noreferrer" className="flex items-center gap-3 hover:opacity-80 transition-opacity">
                <img
                  src="/SECTUR.png"
                  alt="Secretaría de Turismo"
                  loading="lazy"
                  className="h-16 w-auto"
                  style={{ filter: 'brightness(0) invert(1)', opacity: 0.65 }}
                />
                <div>
                  <p className="text-gray-400 text-xs leading-tight">Registro Nacional de</p>
                  <p className="text-gray-400 text-xs leading-tight">Turismo</p>
                  <p className="text-gray-300 text-xs font-medium mt-0.5">RNT: 04090165582a1</p>
                </div>
              </a>

              {/* AMAV */}
              <a href="https://amavmexico.mx/socios/tours-red/" target="_blank" rel="noopener noreferrer" className="bg-white rounded-md px-2 py-1 hover:opacity-80 transition-opacity">
                <img
                  src="/LogoAMAV.jpeg"
                  alt="AMAV Ciudad de México"
                  loading="lazy"
                  className="h-14 w-auto"
                />
              </a>

              {/* FEMATUR */}
              <a href="https://fematur.org" target="_blank" rel="noopener noreferrer" className="bg-white rounded-md px-2 py-1 hover:opacity-80 transition-opacity">
                <img
                  src="/LogoFematur.jpg"
                  alt="FEMATUR"
                  loading="lazy"
                  className="h-14 w-auto"
                />
              </a>
            </div>

            {/* Copyright */}
            <p className="text-gray-400 text-xs text-center sm:text-right">
              &copy; {new Date().getFullYear()} TOURS RED GLOBAL SAS DE CV. Todos los derechos reservados.
            </p>
          </div>
        </div>
      </div>
    </footer>
  );
};

export default Footer;
