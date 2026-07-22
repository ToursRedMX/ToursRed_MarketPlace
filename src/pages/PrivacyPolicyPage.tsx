import { Link } from 'react-router-dom';
import { Shield, Mail, Clock, UserCheck } from 'lucide-react';
import Seo from '../components/Seo';

export default function PrivacyPolicyPage() {
  return (
    <div className="min-h-screen bg-gray-50">
      <Seo
        title="Aviso de Privacidad | ToursRed"
        description="Aviso de privacidad de ToursRed. Conoce cómo protegemos tus datos personales conforme a la LFPDPPP."
        type="website"
      />
      <div className="bg-gradient-to-r from-blue-600 to-blue-800 text-white py-16">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center gap-3 mb-4">
            <Shield className="h-12 w-12" />
            <h1 className="text-4xl font-bold">Aviso de Privacidad</h1>
          </div>
          <p className="text-xl text-blue-100">
            Última actualización: 23 de diciembre de 2024
          </p>
        </div>
      </div>

      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <div className="bg-white rounded-xl shadow-sm p-8 space-y-8">
          <section>
            <h2 className="text-2xl font-bold text-gray-900 mb-4">1. Identidad del Responsable</h2>
            <p className="text-gray-700 leading-relaxed">
              ToursRed, con domicilio en México, es el responsable del tratamiento de sus datos personales de conformidad con la Ley Federal de Protección de Datos Personales en Posesión de los Particulares (LFPDPPP) y su Reglamento.
            </p>
            <div className="mt-4 flex items-center gap-2 text-blue-600">
              <Mail className="h-5 w-5" />
              <span className="font-medium">Contacto: contacto@toursred.com</span>
            </div>
          </section>

          <section>
            <h2 className="text-2xl font-bold text-gray-900 mb-4">2. Datos Personales que Recabamos</h2>
            <p className="text-gray-700 mb-3">Recabamos las siguientes categorías de datos personales:</p>
            <div className="bg-blue-50 rounded-lg p-6 space-y-3">
              <div>
                <h3 className="font-semibold text-gray-900 mb-2">Datos de Identificación:</h3>
                <ul className="list-disc list-inside text-gray-700 space-y-1 ml-4">
                  <li>Nombre completo</li>
                  <li>Correo electrónico</li>
                  <li>Número de teléfono</li>
                  <li>CURP (para viajeros mexicanos)</li>
                  <li>Número de pasaporte (para viajeros extranjeros)</li>
                  <li>Fecha de nacimiento</li>
                  <li>Dirección</li>
                </ul>
              </div>
              <div>
                <h3 className="font-semibold text-gray-900 mb-2">Datos de Agencias de Viajes:</h3>
                <ul className="list-disc list-inside text-gray-700 space-y-1 ml-4">
                  <li>Nombre de la agencia</li>
                  <li>RFC</li>
                  <li>Descripción y logo</li>
                  <li>Información de contacto</li>
                  <li>Datos bancarios para pagos</li>
                </ul>
              </div>
              <div>
                <h3 className="font-semibold text-gray-900 mb-2">Datos de Navegación:</h3>
                <ul className="list-disc list-inside text-gray-700 space-y-1 ml-4">
                  <li>Dirección IP</li>
                  <li>Tipo de navegador</li>
                  <li>Páginas visitadas</li>
                  <li>Cookies y tecnologías similares</li>
                </ul>
              </div>
            </div>
          </section>

          <section>
            <h2 className="text-2xl font-bold text-gray-900 mb-4">3. Finalidades del Tratamiento</h2>
            <p className="text-gray-700 mb-3">Utilizamos sus datos personales para las siguientes finalidades:</p>
            <div className="space-y-3">
              <div className="border-l-4 border-blue-600 pl-4">
                <h3 className="font-semibold text-gray-900">Finalidades Primarias (necesarias):</h3>
                <ul className="list-disc list-inside text-gray-700 space-y-1 mt-2">
                  <li>Crear y administrar su cuenta de usuario</li>
                  <li>Procesar reservas y pagos de tours</li>
                  <li>Facilitar la comunicación entre viajeros y agencias</li>
                  <li>Cumplir con obligaciones legales y fiscales</li>
                  <li>Prevenir fraudes y garantizar la seguridad</li>
                </ul>
              </div>
              <div className="border-l-4 border-green-600 pl-4">
                <h3 className="font-semibold text-gray-900">Finalidades Secundarias (opcionales):</h3>
                <ul className="list-disc list-inside text-gray-700 space-y-1 mt-2">
                  <li>Enviar comunicaciones promocionales y ofertas especiales</li>
                  <li>Realizar análisis estadísticos y mejoras del servicio</li>
                  <li>Personalizar su experiencia en la plataforma</li>
                </ul>
                <p className="text-sm text-gray-600 mt-2">
                  Puede oponerse al tratamiento para finalidades secundarias en cualquier momento contactándonos.
                </p>
              </div>
            </div>
          </section>

          <section>
            <h2 className="text-2xl font-bold text-gray-900 mb-4">4. Derechos ARCO</h2>
            <p className="text-gray-700 mb-4">
              Usted tiene derecho a conocer qué datos personales tenemos de usted, para qué los utilizamos y las condiciones del uso que les damos (Acceso). Asimismo, es su derecho solicitar la corrección de su información personal en caso de que esté desactualizada, sea inexacta o incompleta (Rectificación); que la eliminemos de nuestros registros o bases de datos cuando considere que la misma no está siendo utilizada adecuadamente (Cancelación); así como oponerse al uso de sus datos personales para fines específicos (Oposición).
            </p>
            <div className="bg-gray-50 rounded-lg p-6">
              <div className="flex items-start gap-3">
                <UserCheck className="h-6 w-6 text-blue-600 flex-shrink-0 mt-1" />
                <div>
                  <h3 className="font-semibold text-gray-900 mb-2">Cómo ejercer sus derechos ARCO:</h3>
                  <ol className="list-decimal list-inside text-gray-700 space-y-2">
                    <li>Envíe un correo a <span className="font-medium text-blue-600">contacto@toursred.com</span></li>
                    <li>Incluya su nombre completo y correo electrónico registrado</li>
                    <li>Especifique claramente el derecho que desea ejercer</li>
                    <li>Adjunte identificación oficial vigente</li>
                  </ol>
                  <div className="mt-4 flex items-center gap-2 text-gray-600">
                    <Clock className="h-5 w-5" />
                    <span>Responderemos su solicitud en un plazo máximo de 20 días hábiles</span>
                  </div>
                </div>
              </div>
            </div>
          </section>

          <section>
            <h2 className="text-2xl font-bold text-gray-900 mb-4">5. Transferencias de Datos</h2>
            <p className="text-gray-700 mb-3">
              Sus datos personales pueden ser compartidos con los siguientes terceros:
            </p>
            <div className="space-y-3">
              <div className="bg-gray-50 rounded-lg p-4">
                <h3 className="font-semibold text-gray-900">Supabase (Infraestructura)</h3>
                <p className="text-gray-700 text-sm mt-1">
                  Almacenamiento y gestión de bases de datos. Ubicación: Estados Unidos.
                </p>
              </div>
              <div className="bg-gray-50 rounded-lg p-4">
                <h3 className="font-semibold text-gray-900">Stripe (Procesamiento de pagos)</h3>
                <p className="text-gray-700 text-sm mt-1">
                  Procesamiento seguro de transacciones financieras. Ubicación: Estados Unidos.
                </p>
              </div>
              <div className="bg-gray-50 rounded-lg p-4">
                <h3 className="font-semibold text-gray-900">Agencias de Viajes Registradas</h3>
                <p className="text-gray-700 text-sm mt-1">
                  Información necesaria para procesar su reserva y proporcionar el servicio contratado.
                </p>
              </div>
            </div>
            <p className="text-gray-700 mt-4">
              Estas transferencias son necesarias para la prestación del servicio y están protegidas por acuerdos de confidencialidad.
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-bold text-gray-900 mb-4">6. Uso de Cookies y Tecnologías de Rastreo</h2>
            <p className="text-gray-700 mb-3">
              Utilizamos cookies y tecnologías similares para mejorar su experiencia. Para más información, consulte nuestra{' '}
              <Link to="/politica-cookies" className="text-blue-600 hover:text-blue-700 underline font-medium">
                Política de Cookies
              </Link>
              .
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-bold text-gray-900 mb-4">7. Cambios al Aviso de Privacidad</h2>
            <p className="text-gray-700">
              Nos reservamos el derecho de efectuar en cualquier momento modificaciones o actualizaciones al presente aviso de privacidad. Estas modificaciones estarán disponibles en esta página web con la fecha de última actualización. Le recomendamos revisar periódicamente este aviso.
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-bold text-gray-900 mb-4">8. Seguridad de los Datos</h2>
            <p className="text-gray-700">
              Implementamos medidas de seguridad administrativas, técnicas y físicas para proteger sus datos personales contra daño, pérdida, alteración, destrucción o el uso, acceso o tratamiento no autorizados.
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-bold text-gray-900 mb-4">9. Consentimiento</h2>
            <p className="text-gray-700">
              Al utilizar nuestros servicios y proporcionar sus datos personales, usted consiente el tratamiento de los mismos conforme a los términos y condiciones del presente aviso de privacidad.
            </p>
          </section>

          <div className="border-t pt-6 mt-8">
            <p className="text-sm text-gray-600 text-center">
              Si tiene alguna duda sobre este Aviso de Privacidad, puede contactarnos en{' '}
              <a href="mailto:contacto@toursred.com" className="text-blue-600 hover:text-blue-700 underline">
                contacto@toursred.com
              </a>
            </p>
          </div>
        </div>

        <div className="mt-8 text-center">
          <Link
            to="/"
            className="text-blue-600 hover:text-blue-700 font-medium"
          >
            ← Volver al inicio
          </Link>
        </div>
      </div>
    </div>
  );
}
