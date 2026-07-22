import { Link } from 'react-router-dom';
import { Cookie, Settings, Trash2, ExternalLink } from 'lucide-react';
import Seo from '../components/Seo';

export default function CookiePolicyPage() {
  const handleResetPreferences = () => {
    localStorage.removeItem('cookie_consent');
    window.location.reload();
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <Seo
        title="Política de Cookies | ToursRed"
        description="Política de cookies de ToursRed. Información sobre el uso de cookies en nuestra plataforma y cómo gestionar tus preferencias."
        type="website"
      />
      <div className="bg-gradient-to-r from-orange-600 to-orange-800 text-white py-16">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center gap-3 mb-4">
            <Cookie className="h-12 w-12" />
            <h1 className="text-4xl font-bold">Política de Cookies</h1>
          </div>
          <p className="text-xl text-orange-100">
            Última actualización: 23 de diciembre de 2024
          </p>
        </div>
      </div>

      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <div className="bg-white rounded-xl shadow-sm p-8 space-y-8">
          <section>
            <h2 className="text-2xl font-bold text-gray-900 mb-4">¿Qué son las cookies?</h2>
            <p className="text-gray-700 leading-relaxed">
              Las cookies son pequeños archivos de texto que se almacenan en su dispositivo (computadora, tablet o móvil) cuando visita un sitio web. Las cookies ayudan a los sitios web a recordar información sobre su visita, como sus preferencias y configuraciones, lo que puede hacer que su próxima visita sea más fácil y el sitio más útil para usted.
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-bold text-gray-900 mb-4">¿Cómo usamos las cookies?</h2>
            <p className="text-gray-700 mb-4">
              En ToursRed utilizamos cookies para diversos propósitos. A continuación, describimos los tipos de cookies que utilizamos:
            </p>

            <div className="space-y-4">
              <div className="border-l-4 border-green-600 bg-green-50 p-5 rounded-r-lg">
                <h3 className="font-bold text-gray-900 text-lg mb-3">Cookies Esenciales (Obligatorias)</h3>
                <p className="text-gray-700 mb-3">
                  Estas cookies son necesarias para el funcionamiento básico del sitio y no se pueden desactivar.
                </p>
                <div className="bg-white rounded-lg p-4 space-y-3">
                  <div>
                    <h4 className="font-semibold text-gray-900">Cookies de autenticación de Supabase</h4>
                    <p className="text-sm text-gray-600 mt-1">
                      <strong>Propósito:</strong> Mantener su sesión activa cuando inicia sesión
                    </p>
                    <p className="text-sm text-gray-600">
                      <strong>Duración:</strong> Hasta que cierre sesión o expiren (por defecto 7 días)
                    </p>
                    <p className="text-sm text-gray-600">
                      <strong>Nombre:</strong> sb-*-auth-token
                    </p>
                  </div>
                  <div>
                    <h4 className="font-semibold text-gray-900">Cookie de consentimiento</h4>
                    <p className="text-sm text-gray-600 mt-1">
                      <strong>Propósito:</strong> Recordar sus preferencias de cookies
                    </p>
                    <p className="text-sm text-gray-600">
                      <strong>Duración:</strong> 1 año
                    </p>
                    <p className="text-sm text-gray-600">
                      <strong>Nombre:</strong> cookie_consent
                    </p>
                  </div>
                  <div>
                    <h4 className="font-semibold text-gray-900">Cookie de sesión</h4>
                    <p className="text-sm text-gray-600 mt-1">
                      <strong>Propósito:</strong> Identificar su sesión para auditoría de consentimientos
                    </p>
                    <p className="text-sm text-gray-600">
                      <strong>Duración:</strong> Permanente
                    </p>
                    <p className="text-sm text-gray-600">
                      <strong>Nombre:</strong> session_id
                    </p>
                  </div>
                </div>
              </div>

              <div className="border-l-4 border-blue-600 bg-blue-50 p-5 rounded-r-lg">
                <h3 className="font-bold text-gray-900 text-lg mb-3">Cookies Analíticas (Opcionales)</h3>
                <p className="text-gray-700 mb-3">
                  Estas cookies nos ayudan a entender cómo los visitantes interactúan con nuestro sitio web. Solo se activan si acepta todas las cookies.
                </p>
                <div className="bg-white rounded-lg p-4 space-y-3">
                  <div>
                    <h4 className="font-semibold text-gray-900">Google Analytics</h4>
                    <p className="text-sm text-gray-600 mt-1">
                      <strong>Propósito:</strong> Analizar el tráfico del sitio, páginas visitadas, tiempo de permanencia y comportamiento del usuario
                    </p>
                    <p className="text-sm text-gray-600">
                      <strong>Duración:</strong> Hasta 2 años
                    </p>
                    <p className="text-sm text-gray-600">
                      <strong>Nombres:</strong> _ga, _gid, _gat
                    </p>
                    <p className="text-sm text-gray-600">
                      <strong>Proveedor:</strong> Google LLC
                    </p>
                  </div>
                </div>
              </div>

              <div className="border-l-4 border-purple-600 bg-purple-50 p-5 rounded-r-lg">
                <h3 className="font-bold text-gray-900 text-lg mb-3">Cookies de Terceros</h3>
                <p className="text-gray-700 mb-3">
                  Algunos servicios externos que utilizamos pueden establecer sus propias cookies.
                </p>
                <div className="bg-white rounded-lg p-4 space-y-3">
                  <div>
                    <h4 className="font-semibold text-gray-900">Stripe (Procesamiento de pagos)</h4>
                    <p className="text-sm text-gray-600 mt-1">
                      <strong>Propósito:</strong> Procesar transacciones de pago de forma segura y prevenir fraudes
                    </p>
                    <p className="text-sm text-gray-600">
                      <strong>Duración:</strong> Variable según la cookie específica
                    </p>
                    <p className="text-sm text-gray-600">
                      <strong>Proveedor:</strong> Stripe, Inc.
                    </p>
                    <a
                      href="https://stripe.com/privacy"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-blue-600 hover:text-blue-700 text-sm inline-flex items-center gap-1 mt-2"
                    >
                      Ver política de privacidad de Stripe
                      <ExternalLink className="h-3 w-3" />
                    </a>
                  </div>
                </div>
              </div>
            </div>
          </section>

          <section>
            <h2 className="text-2xl font-bold text-gray-900 mb-4">Gestión de preferencias de cookies</h2>
            <p className="text-gray-700 mb-4">
              Puede cambiar sus preferencias de cookies en cualquier momento haciendo clic en el botón a continuación. Esto eliminará la cookie de consentimiento actual y volverá a mostrar el banner de cookies.
            </p>
            <button
              onClick={handleResetPreferences}
              className="flex items-center gap-2 px-6 py-3 bg-orange-600 text-white rounded-lg hover:bg-orange-700 transition-colors duration-200 font-medium shadow-md"
            >
              <Settings className="h-5 w-5" />
              Cambiar preferencias de cookies
            </button>
          </section>

          <section>
            <h2 className="text-2xl font-bold text-gray-900 mb-4">Cómo eliminar cookies desde su navegador</h2>
            <p className="text-gray-700 mb-4">
              La mayoría de los navegadores web le permiten controlar las cookies a través de la configuración. Sin embargo, si limita la capacidad de los sitios web para establecer cookies, puede empeorar su experiencia general del usuario.
            </p>
            <div className="bg-gray-50 rounded-lg p-6 space-y-3">
              <div>
                <h3 className="font-semibold text-gray-900 mb-2">Instrucciones por navegador:</h3>
                <ul className="space-y-2">
                  <li>
                    <a
                      href="https://support.google.com/chrome/answer/95647"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-blue-600 hover:text-blue-700 inline-flex items-center gap-1"
                    >
                      Google Chrome
                      <ExternalLink className="h-3 w-3" />
                    </a>
                  </li>
                  <li>
                    <a
                      href="https://support.mozilla.org/es/kb/habilitar-y-deshabilitar-cookies-sitios-web-rastrear-preferencias"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-blue-600 hover:text-blue-700 inline-flex items-center gap-1"
                    >
                      Mozilla Firefox
                      <ExternalLink className="h-3 w-3" />
                    </a>
                  </li>
                  <li>
                    <a
                      href="https://support.apple.com/es-mx/guide/safari/sfri11471/mac"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-blue-600 hover:text-blue-700 inline-flex items-center gap-1"
                    >
                      Safari
                      <ExternalLink className="h-3 w-3" />
                    </a>
                  </li>
                  <li>
                    <a
                      href="https://support.microsoft.com/es-es/microsoft-edge/eliminar-las-cookies-en-microsoft-edge-63947406-40ac-c3b8-57b9-2a946a29ae09"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-blue-600 hover:text-blue-700 inline-flex items-center gap-1"
                    >
                      Microsoft Edge
                      <ExternalLink className="h-3 w-3" />
                    </a>
                  </li>
                </ul>
              </div>
            </div>
          </section>

          <section>
            <h2 className="text-2xl font-bold text-gray-900 mb-4">Políticas de privacidad de terceros</h2>
            <p className="text-gray-700 mb-3">
              Los servicios de terceros que utilizamos tienen sus propias políticas de privacidad:
            </p>
            <div className="space-y-2">
              <a
                href="https://policies.google.com/privacy"
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-2 text-blue-600 hover:text-blue-700"
              >
                Política de privacidad de Google
                <ExternalLink className="h-4 w-4" />
              </a>
              <a
                href="https://stripe.com/privacy"
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-2 text-blue-600 hover:text-blue-700"
              >
                Política de privacidad de Stripe
                <ExternalLink className="h-4 w-4" />
              </a>
              <a
                href="https://supabase.com/privacy"
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-2 text-blue-600 hover:text-blue-700"
              >
                Política de privacidad de Supabase
                <ExternalLink className="h-4 w-4" />
              </a>
            </div>
          </section>

          <section>
            <h2 className="text-2xl font-bold text-gray-900 mb-4">Actualizaciones de esta política</h2>
            <p className="text-gray-700">
              Podemos actualizar esta Política de Cookies periódicamente para reflejar cambios en las cookies que utilizamos o por otras razones operativas, legales o regulatorias. Revise esta página regularmente para mantenerse informado sobre nuestro uso de cookies.
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-bold text-gray-900 mb-4">Más información</h2>
            <p className="text-gray-700 mb-3">
              Para obtener más información sobre cómo protegemos sus datos personales, consulte:
            </p>
            <div className="flex flex-col gap-2">
              <Link to="/aviso-privacidad" className="text-blue-600 hover:text-blue-700 font-medium">
                → Aviso de Privacidad
              </Link>
              <Link to="/terminos-servicio" className="text-blue-600 hover:text-blue-700 font-medium">
                → Términos y Condiciones de Servicio
              </Link>
            </div>
          </section>

          <div className="border-t pt-6 mt-8">
            <p className="text-sm text-gray-600 text-center">
              Si tiene alguna pregunta sobre nuestra Política de Cookies, puede contactarnos en{' '}
              <a href="mailto:contacto@toursred.com" className="text-blue-600 hover:text-blue-700 underline">
                contacto@toursred.com
              </a>
            </p>
          </div>
        </div>

        <div className="mt-8 text-center">
          <Link
            to="/"
            className="text-orange-600 hover:text-orange-700 font-medium"
          >
            ← Volver al inicio
          </Link>
        </div>
      </div>
    </div>
  );
}
