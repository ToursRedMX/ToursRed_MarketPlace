import React from 'react';
import { Clock, Mail, LogOut, CheckCircle, AlertCircle, Phone } from 'lucide-react';
import { supabase } from '../../lib/supabase';

const AgencyPendingApproval: React.FC = () => {
  const handleSignOut = async () => {
    await supabase.auth.signOut();
    window.location.href = '/login';
  };

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      {/* Header */}
      <header className="bg-white border-b border-gray-200 px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <img src="/logo.png" alt="ToursRed" className="h-8 w-auto" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
          <span className="text-lg font-semibold text-gray-900">ToursRed</span>
        </div>
        <button
          onClick={handleSignOut}
          className="flex items-center gap-2 text-sm text-gray-500 hover:text-gray-700 transition-colors"
        >
          <LogOut className="w-4 h-4" />
          Cerrar sesión
        </button>
      </header>

      {/* Content */}
      <main className="flex-1 flex items-center justify-center px-4 py-16">
        <div className="max-w-lg w-full">
          {/* Status card */}
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
            {/* Top accent */}
            <div className="h-1.5 bg-gradient-to-r from-amber-400 to-amber-500" />

            <div className="p-8">
              {/* Icon */}
              <div className="flex justify-center mb-6">
                <div className="relative">
                  <div className="w-20 h-20 rounded-full bg-amber-50 flex items-center justify-center">
                    <Clock className="w-10 h-10 text-amber-500" />
                  </div>
                  <div className="absolute -bottom-1 -right-1 w-7 h-7 rounded-full bg-amber-100 border-2 border-white flex items-center justify-center">
                    <AlertCircle className="w-4 h-4 text-amber-600" />
                  </div>
                </div>
              </div>

              {/* Heading */}
              <h1 className="text-2xl font-bold text-gray-900 text-center mb-2">
                Cuenta en revisión
              </h1>
              <p className="text-gray-500 text-center text-sm mb-8">
                Tu solicitud de registro como agencia ha sido recibida exitosamente y está siendo revisada por nuestro equipo.
              </p>

              {/* Steps */}
              <div className="space-y-3 mb-8">
                {[
                  { label: 'Registro completado', done: true },
                  { label: 'Revisión por el equipo de ToursRed', done: false, active: true },
                  { label: 'Aprobación y activación de cuenta', done: false },
                ].map((step, i) => (
                  <div key={i} className="flex items-center gap-3">
                    <div className={`w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0 ${
                      step.done
                        ? 'bg-green-100'
                        : step.active
                        ? 'bg-amber-100'
                        : 'bg-gray-100'
                    }`}>
                      {step.done ? (
                        <CheckCircle className="w-4 h-4 text-green-600" />
                      ) : step.active ? (
                        <Clock className="w-4 h-4 text-amber-600" />
                      ) : (
                        <div className="w-2 h-2 rounded-full bg-gray-300" />
                      )}
                    </div>
                    <span className={`text-sm ${
                      step.done ? 'text-gray-700 font-medium' : step.active ? 'text-amber-700 font-medium' : 'text-gray-400'
                    }`}>
                      {step.label}
                    </span>
                  </div>
                ))}
              </div>

              {/* Info box */}
              <div className="bg-blue-50 rounded-xl p-4 mb-6">
                <p className="text-sm text-blue-800 leading-relaxed">
                  El proceso de validación suele tardar <strong>1 a 3 días hábiles</strong>. Recibirás una notificación por correo electrónico cuando tu cuenta sea aprobada.
                </p>
              </div>

              {/* Contact */}
              <div className="border-t border-gray-100 pt-6">
                <p className="text-xs text-gray-500 text-center mb-3 font-medium uppercase tracking-wide">
                  ¿Necesitas ayuda o quieres agilizar el proceso?
                </p>
                <div className="flex flex-col sm:flex-row gap-2 justify-center">
                  <a
                    href="mailto:contacto@toursred.com"
                    className="flex items-center justify-center gap-2 text-sm text-primary-600 hover:text-primary-700 font-medium bg-primary-50 hover:bg-primary-100 px-4 py-2 rounded-lg transition-colors"
                  >
                    <Mail className="w-4 h-4" />
                    contacto@toursred.com
                  </a>
                  <a
                    href="https://wa.me/5215500000000"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center justify-center gap-2 text-sm text-green-700 hover:text-green-800 font-medium bg-green-50 hover:bg-green-100 px-4 py-2 rounded-lg transition-colors"
                  >
                    <Phone className="w-4 h-4" />
                    WhatsApp
                  </a>
                </div>
              </div>
            </div>
          </div>

          <p className="text-center text-xs text-gray-400 mt-6">
            Al ser aprobada, podrás acceder a todos los módulos de tu panel de agencia.
          </p>
        </div>
      </main>
    </div>
  );
};

export default AgencyPendingApproval;
