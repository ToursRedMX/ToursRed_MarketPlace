import React from 'react';
import { Link } from 'react-router-dom';
import { Crown, Check, CreditCard } from 'lucide-react';
import { useMembershipPrices } from '../hooks/useMembershipPrices';

const MembershipSection: React.FC = () => {
  const { prices, loading } = useMembershipPrices();

  if (loading || !prices) {
    return null;
  }

  return (
    <section className="py-12 bg-gradient-to-br from-amber-50 to-orange-50">
      <div className="container-custom">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-amber-100 mb-4">
            <Crown className="h-8 w-8 text-amber-600" />
          </div>
          <h2 className="text-3xl md:text-4xl font-bold mb-4">ToursRed+</h2>
          <p className="text-lg text-gray-600 max-w-2xl mx-auto">
            Ahorra en cada reserva con nuestra membresía premium
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-8 max-w-5xl mx-auto">
          <div className="bg-white rounded-xl shadow-lg p-8 border-2 border-gray-200 hover:border-amber-300 transition-all">
            <div className="text-center mb-6">
              <h3 className="text-2xl font-bold mb-2">Plan Mensual</h3>
              <div className="flex items-baseline justify-center">
                <span className="text-4xl font-bold text-primary-600">{prices.monthlyPriceFormatted}</span>
                <span className="text-gray-600 ml-2">/mes</span>
              </div>
            </div>

            <ul className="space-y-3 mb-8">
              <li className="flex items-start">
                <Check className="h-5 w-5 text-green-500 mr-3 flex-shrink-0 mt-0.5" />
                <span className="text-gray-700">Sin Cargo por Servicio en reservas nacionales</span>
              </li>
              <li className="flex items-start">
                <Check className="h-5 w-5 text-green-500 mr-3 flex-shrink-0 mt-0.5" />
                <span className="text-gray-700">Acumula puntos en cada reserva y canjéalos por descuentos</span>
              </li>
              <li className="flex items-start">
                <Check className="h-5 w-5 text-green-500 mr-3 flex-shrink-0 mt-0.5" />
                <span className="text-gray-700">Acceso prioritario a nuevos tours</span>
              </li>
              <li className="flex items-start">
                <Check className="h-5 w-5 text-green-500 mr-3 flex-shrink-0 mt-0.5" />
                <span className="text-gray-700">Soporte Premium</span>
              </li>
              <li className="flex items-start">
                <Check className="h-5 w-5 text-green-500 mr-3 flex-shrink-0 mt-0.5" />
                <span className="text-gray-700">Cancela cuando quieras</span>
              </li>
            </ul>

            <Link
              to="/traveler/membership"
              className="block w-full py-3 px-4 bg-primary-600 text-white text-center font-semibold rounded-lg hover:bg-primary-700 transition-colors"
            >
              Empezar Ahora
            </Link>
          </div>

          <div className="bg-gradient-to-br from-amber-500 to-orange-500 rounded-xl shadow-xl p-8 border-2 border-amber-400 relative overflow-hidden">
            <div className="absolute top-0 right-0 bg-red-500 text-white text-xs font-bold px-3 py-1 rounded-bl-lg">
              AHORRA {prices.savingsPercentage}%
            </div>

            <div className="text-center mb-6">
              <h3 className="text-2xl font-bold text-white mb-2">Plan Anual</h3>
              <div className="flex items-baseline justify-center mb-1">
                <span className="text-4xl font-bold text-white">{prices.annualPriceFormatted}</span>
                <span className="text-amber-100 ml-2">/año</span>
              </div>
              <p className="text-amber-100 text-sm">Equivalente a {prices.annualMonthlyEquivalentFormatted}/mes</p>
            </div>

            <ul className="space-y-3 mb-8">
              <li className="flex items-start">
                <Check className="h-5 w-5 text-white mr-3 flex-shrink-0 mt-0.5" />
                <span className="text-white font-medium">Todo lo del plan mensual</span>
              </li>
              <li className="flex items-start">
                <Check className="h-5 w-5 text-white mr-3 flex-shrink-0 mt-0.5" />
                <span className="text-white font-medium">2 meses gratis</span>
              </li>
              <li className="flex items-start">
                <Check className="h-5 w-5 text-white mr-3 flex-shrink-0 mt-0.5" />
                <span className="text-white font-medium">Descuentos exclusivos en tours selectos</span>
              </li>
              <li className="flex items-start">
                <Check className="h-5 w-5 text-white mr-3 flex-shrink-0 mt-0.5" />
                <span className="text-white font-medium">Invitaciones a eventos especiales</span>
              </li>
              <li className="flex items-start">
                <Check className="h-5 w-5 text-white mr-3 flex-shrink-0 mt-0.5" />
                <span className="text-white font-medium">Garantía de satisfacción de 30 días</span>
              </li>
            </ul>

            <Link
              to="/traveler/membership"
              className="block w-full py-3 px-4 bg-white text-amber-600 text-center font-bold rounded-lg hover:bg-amber-50 transition-colors"
            >
              Empezar Ahora
            </Link>
          </div>
        </div>

        <div className="mt-12 text-center">
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-6 max-w-3xl mx-auto">
            <h4 className="font-semibold text-gray-900 mb-2">¿Cómo funciona?</h4>
            <p className="text-gray-700">
              Al suscribirte a ToursRed+, eliminas el cargo por servicio del 5% en todas tus reservas nacionales.
              Si reservas tours frecuentemente, tu membresía se paga sola en la primera o segunda reserva.
              Además, puedes agregar la membresía directamente al hacer tu primera reserva.
            </p>
          </div>
        </div>
      </div>
    </section>
  );
};

export default MembershipSection;
