import React from 'react';
import { useNavigate } from 'react-router-dom';
import { Headphones as HeadphonesIcon, User, Building2, Globe, ChevronRight, Shield } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { UserRole } from '../../lib/supabase';

const SupportLandingPage: React.FC = () => {
  const navigate = useNavigate();
  const { user, userRole, isEmailVerified, isAgencyStaff } = useAuth();

  const handleTravelerClick = () => {
    if (user && (userRole === UserRole.TRAVELER || userRole === UserRole.AGENCY) && isEmailVerified) {
      navigate('/soporte/viajero');
    } else {
      navigate('/login?redirect=/soporte/viajero');
    }
  };

  const handleAgencyClick = () => {
    if (user && (userRole === UserRole.AGENCY || isAgencyStaff) && isEmailVerified) {
      navigate('/soporte/agencia');
    } else {
      navigate('/login?redirect=/soporte/agencia');
    }
  };

  const options = [
    {
      icon: <User className="h-10 w-10 text-primary-600" />,
      title: 'Soporte para Viajeros',
      description: 'Ayuda con reservas, pagos, puntos, membresias, perfil y mas.',
      badge: 'Requiere cuenta de viajero',
      badgeColor: 'bg-primary-100 text-primary-700',
      action: handleTravelerClick,
      cta: 'Acceder como Viajero',
      bgGradient: 'from-primary-50 to-blue-50',
      borderColor: 'border-primary-200 hover:border-primary-400',
    },
    {
      icon: <Building2 className="h-10 w-10 text-secondary-600" />,
      title: 'Soporte para Agencias',
      description: 'Asistencia con tours, reservas, finanzas, facturacion y configuracion.',
      badge: 'Requiere cuenta de agencia',
      badgeColor: 'bg-secondary-100 text-secondary-700',
      action: handleAgencyClick,
      cta: 'Acceder como Agencia',
      bgGradient: 'from-secondary-50 to-green-50',
      borderColor: 'border-secondary-200 hover:border-secondary-400',
    },
    {
      icon: <Globe className="h-10 w-10 text-accent-600" />,
      title: 'Soporte General',
      description: 'Problemas con registro, acceso, contrasena, tarjetas de regalo y dudas generales del sitio.',
      badge: 'Sin login requerido',
      badgeColor: 'bg-accent-100 text-accent-700',
      action: () => navigate('/soporte/general'),
      cta: 'Continuar sin iniciar sesion',
      bgGradient: 'from-accent-50 to-yellow-50',
      borderColor: 'border-accent-200 hover:border-accent-400',
    },
  ];

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-white border-b border-gray-200">
        <div className="container-custom py-12 text-center">
          <div className="inline-flex items-center justify-center w-16 h-16 bg-primary-100 rounded-2xl mb-4">
            <HeadphonesIcon className="h-8 w-8 text-primary-600" />
          </div>
          <h1 className="text-3xl font-bold text-gray-900 mb-3">Centro de Soporte</h1>
          <p className="text-lg text-gray-600 max-w-xl mx-auto">
            Selecciona el tipo de soporte que necesitas. Te ayudaremos a resolver tu problema lo antes posible.
          </p>
        </div>
      </div>

      {/* Cards */}
      <div className="container-custom py-12">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 max-w-5xl mx-auto">
          {options.map((opt) => (
            <button
              key={opt.title}
              onClick={opt.action}
              className={`text-left rounded-2xl border-2 bg-gradient-to-br ${opt.bgGradient} ${opt.borderColor} p-6 shadow-sm hover:shadow-md transition-all duration-200 group`}
            >
              <div className="mb-4">{opt.icon}</div>
              <h2 className="text-xl font-bold text-gray-900 mb-2 group-hover:text-primary-700 transition-colors">
                {opt.title}
              </h2>
              <p className="text-gray-600 text-sm mb-4 leading-relaxed">{opt.description}</p>
              <span className={`inline-block text-xs font-semibold px-3 py-1 rounded-full mb-4 ${opt.badgeColor}`}>
                {opt.badge}
              </span>
              <div className="flex items-center gap-1 text-sm font-medium text-primary-600 group-hover:gap-2 transition-all">
                {opt.cta}
                <ChevronRight className="h-4 w-4" />
              </div>
            </button>
          ))}
        </div>

        {/* Info footer */}
        <div className="mt-12 max-w-2xl mx-auto bg-white rounded-xl border border-gray-200 p-6">
          <div className="flex items-start gap-4">
            <Shield className="h-6 w-6 text-primary-500 flex-shrink-0 mt-0.5" />
            <div>
              <h3 className="font-semibold text-gray-800 mb-1">Como funciona</h3>
              <ul className="text-sm text-gray-600 space-y-1 list-disc list-inside">
                <li>Llena el formulario con una descripcion clara de tu problema.</li>
                <li>Recibes un folio de seguimiento por correo electronico.</li>
                <li>Un agente de soporte atendara tu caso segun la prioridad.</li>
                <li>Puedes agregar informacion adicional o comentarios en cualquier momento.</li>
              </ul>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default SupportLandingPage;
