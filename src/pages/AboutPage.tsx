import React from 'react';
import { Target, Eye, Briefcase, Shield, Users, Lightbulb, Handshake } from 'lucide-react';
import Seo from '../components/Seo';

const AboutPage: React.FC = () => {
  return (
    <div className="min-h-screen bg-blue-50">
      <Seo
        title="Quiénes Somos | ToursRed"
        description="Conoce ToursRed, la plataforma mexicana que conecta viajeros con agencias locales para descubrir y reservar experiencias turísticas auténticas en todo México."
        type="website"
      />
      {/* Hero Section */}
      <section className="bg-gradient-to-r from-blue-900 to-blue-800 text-white py-16">
        <div className="container mx-auto px-4">
          <h1 className="text-5xl font-bold text-center mb-6">Quiénes somos</h1>
          <p className="text-xl text-center max-w-3xl mx-auto text-blue-100">
            Conoce nuestra historia, misión y los valores que nos impulsan a transformar la industria del turismo en México
          </p>
        </div>
      </section>

      {/* Propósito, Misión y Visión */}
      <section className="container mx-auto px-4 py-16">
        <div className="grid md:grid-cols-3 gap-6">
          {/* Propósito */}
          <div className="bg-red-600 text-white rounded-xl shadow-lg p-8 transform hover:scale-105 transition-transform duration-300">
            <div className="bg-white/20 w-16 h-16 rounded-lg flex items-center justify-center mb-4">
              <Target className="w-8 h-8" />
            </div>
            <h2 className="text-2xl font-bold mb-4">Nuestro Propósito</h2>
            <p className="text-white/90 leading-relaxed">
              Facilitar el acceso a experiencias auténticas en México, conectando viajeros con agencias locales y fortaleciendo el turismo regional.
            </p>
          </div>

          {/* Misión */}
          <div className="bg-teal-600 text-white rounded-xl shadow-lg p-8 transform hover:scale-105 transition-transform duration-300">
            <div className="bg-white/20 w-16 h-16 rounded-lg flex items-center justify-center mb-4">
              <Target className="w-8 h-8" />
            </div>
            <h2 className="text-2xl font-bold mb-4">Nuestra Misión</h2>
            <p className="text-white/90 leading-relaxed">
              Conectar a viajeros con experiencias reales a través de una plataforma digital que permita a las agencias locales promocionar y vender sus tours de forma sencilla y segura.
            </p>
          </div>

          {/* Visión */}
          <div className="bg-blue-600 text-white rounded-xl shadow-lg p-8 transform hover:scale-105 transition-transform duration-300">
            <div className="bg-white/20 w-16 h-16 rounded-lg flex items-center justify-center mb-4">
              <Eye className="w-8 h-8" />
            </div>
            <h2 className="text-2xl font-bold mb-4">Nuestra Visión</h2>
            <p className="text-white/90 leading-relaxed">
              Convertirnos en la plataforma de referencia en México para descubrir y reservar experiencias turísticas locales, impulsando un ecosistema justo y transparente.
            </p>
          </div>
        </div>
      </section>

      {/* ¿Qué es ToursRed? */}
      <section className="bg-white py-16">
        <div className="container mx-auto px-4">
          <h2 className="text-4xl font-bold text-center text-gray-900 mb-8">¿Qué es ToursRed?</h2>

          <div className="max-w-4xl mx-auto space-y-6 text-lg text-gray-700 leading-relaxed">
            <p>
              <span className="text-blue-600 font-semibold">ToursRed</span> es una plataforma mexicana que conecta viajeros con agencias locales para descubrir y reservar experiencias auténticas en todo México.
            </p>

            <p>
              <span className="text-blue-600 font-semibold">ToursRed</span> no opera directamente los tours. Las experiencias publicadas son creadas y operadas por agencias aliadas, mientras ToursRed facilita el proceso de búsqueda, reserva y contacto de forma sencilla y segura.
            </p>

            <p>
              Nuestro objetivo es impulsar el <span className="text-blue-600 font-semibold">turismo local</span>, brindando a las agencias una vitrina digital para crecer y a los viajeros una forma confiable de descubrir nuevas experiencias.
            </p>
          </div>

          {/* Características Clave */}
          <div className="grid md:grid-cols-3 gap-6 mt-12 max-w-5xl mx-auto">
            {/* Plataforma digital */}
            <div className="bg-blue-50 rounded-lg p-6 text-center">
              <div className="bg-blue-600 w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4">
                <Briefcase className="w-8 h-8 text-white" />
              </div>
              <h3 className="text-xl font-bold text-gray-900 mb-3">
                Plataforma digital de intermediación
              </h3>
              <p className="text-gray-600">
                Conectamos viajeros y agencias a través de un sistema de reservas sencillo y transparente.
              </p>
            </div>

            {/* Red de agencias */}
            <div className="bg-teal-50 rounded-lg p-6 text-center">
              <div className="bg-teal-600 w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4">
                <Users className="w-8 h-8 text-white" />
              </div>
              <h3 className="text-xl font-bold text-gray-900 mb-3">
                Red de agencias y operadores validados
              </h3>
              <p className="text-gray-600">
                Colaboramos con prestadores de servicios turísticos formalmente establecidos.
              </p>
            </div>

            {/* Empresa mexicana */}
            <div className="bg-red-50 rounded-lg p-6 text-center">
              <div className="bg-red-600 w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4">
                <Shield className="w-8 h-8 text-white" />
              </div>
              <h3 className="text-xl font-bold text-gray-900 mb-3">
                Empresa 100% mexicana
              </h3>
              <p className="text-gray-600">
                Comprometidos con el desarrollo del turismo local.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Nuestros Valores */}
      <section className="container mx-auto px-4 py-16">
        <h2 className="text-4xl font-bold text-center text-gray-900 mb-12">Nuestros Valores</h2>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-6 max-w-7xl mx-auto">
          {/* Colaboración */}
          <div className="bg-white rounded-lg shadow-md p-6 text-center hover:shadow-xl transition-shadow">
            <div className="bg-green-100 w-16 h-16 rounded-lg flex items-center justify-center mx-auto mb-4">
              <Handshake className="w-8 h-8 text-green-600" />
            </div>
            <h3 className="text-xl font-bold text-gray-900 mb-3">Colaboración</h3>
            <p className="text-gray-600 text-sm">
              Creemos en el crecimiento conjunto con agencias y operadores turísticos locales.
            </p>
          </div>

          {/* Compromiso */}
          <div className="bg-white rounded-lg shadow-md p-6 text-center hover:shadow-xl transition-shadow">
            <div className="bg-orange-100 w-16 h-16 rounded-lg flex items-center justify-center mx-auto mb-4">
              <Target className="w-8 h-8 text-orange-600" />
            </div>
            <h3 className="text-xl font-bold text-gray-900 mb-3">Compromiso</h3>
            <p className="text-gray-600 text-sm">
              Estamos comprometidos con el desarrollo del turismo responsable y las comunidades locales.
            </p>
          </div>

          {/* Confianza */}
          <div className="bg-white rounded-lg shadow-md p-6 text-center hover:shadow-xl transition-shadow">
            <div className="bg-blue-100 w-16 h-16 rounded-lg flex items-center justify-center mx-auto mb-4">
              <Shield className="w-8 h-8 text-blue-600" />
            </div>
            <h3 className="text-xl font-bold text-gray-900 mb-3">Confianza</h3>
            <p className="text-gray-600 text-sm">
              Construimos relaciones basadas en formalidad, cumplimiento y atención cercana.
            </p>
          </div>

          {/* Transparencia */}
          <div className="bg-white rounded-lg shadow-md p-6 text-center hover:shadow-xl transition-shadow">
            <div className="bg-purple-100 w-16 h-16 rounded-lg flex items-center justify-center mx-auto mb-4">
              <Eye className="w-8 h-8 text-purple-600" />
            </div>
            <h3 className="text-xl font-bold text-gray-900 mb-3">Transparencia</h3>
            <p className="text-gray-600 text-sm">
              Actuamos con claridad en precios, procesos y condiciones para viajeros y agencias.
            </p>
          </div>

          {/* Innovación */}
          <div className="bg-white rounded-lg shadow-md p-6 text-center hover:shadow-xl transition-shadow">
            <div className="bg-yellow-100 w-16 h-16 rounded-lg flex items-center justify-center mx-auto mb-4">
              <Lightbulb className="w-8 h-8 text-yellow-600" />
            </div>
            <h3 className="text-xl font-bold text-gray-900 mb-3">Innovación</h3>
            <p className="text-gray-600 text-sm">
              Creamos herramientas digitales simples e innovadoras que facilitan la venta y reserva de experiencias.
            </p>
          </div>
        </div>
      </section>
    </div>
  );
};

export default AboutPage;