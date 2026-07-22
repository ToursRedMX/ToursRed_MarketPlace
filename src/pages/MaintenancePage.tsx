import React from 'react';
import { Wrench, Mail, Phone } from 'lucide-react';

interface MaintenancePageProps {
  message?: string;
}

const MaintenancePage: React.FC<MaintenancePageProps> = ({
  message = 'Estamos realizando tareas de mantenimiento. Estaremos de vuelta muy pronto.',
}) => {
  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 flex flex-col items-center justify-center px-4">
      <div className="max-w-lg w-full text-center">
        {/* Logo */}
        <div className="mb-8 flex justify-center">
          <img
            src="/LogoFinal.jpg"
            alt="ToursRed"
            className="h-16 rounded-x1 shadow-2x1"
            onError={(e) => {
              (e.target as HTMLImageElement).style.display = 'none';
            }}
          />
        </div>

        {/* Icon */}
        <div className="relative inline-flex items-center justify-center mb-8">
          <div className="absolute inset-0 bg-red-500/20 rounded-full blur-xl scale-150" />
          <div className="relative bg-slate-800 border border-slate-700 rounded-full p-6 shadow-2xl">
            <Wrench className="h-14 w-14 text-red-400" strokeWidth={1.5} />
          </div>
        </div>

        {/* Heading */}
        <h1 className="text-3xl font-bold text-white mb-3 tracking-tight">
          Sitio en mantenimiento
        </h1>
        <div className="w-16 h-1 bg-red-500 rounded-full mx-auto mb-6" />

        {/* Message */}
        <p className="text-slate-300 text-lg leading-relaxed mb-10 px-2">
          {message}
        </p>

        {/* Contact */}
        <div className="bg-slate-800/60 border border-slate-700 rounded-2xl p-6 backdrop-blur-sm">
          <p className="text-slate-400 text-sm mb-4 font-medium uppercase tracking-wider">
            ¿Necesitas ayuda urgente?
          </p>
          <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
            <a
              href="mailto:contacto@toursred.com"
              className="flex items-center gap-2 text-slate-300 hover:text-white transition-colors text-sm"
            >
              <Mail className="h-4 w-4 text-red-400" />
              contacto@toursred.com
            </a>
            <span className="hidden sm:block w-px h-4 bg-slate-600" />
            <a
              href="https://wa.me/525547127668"
              className="flex items-center gap-2 text-slate-300 hover:text-white transition-colors text-sm"
            >
              <Phone className="h-4 w-4 text-red-400" />
              +52 55 4712 7668
            </a>
          </div>
        </div>

        {/* Footer */}
        <p className="mt-10 text-slate-600 text-xs">
          &copy; {new Date().getFullYear()} ToursRed. Todos los derechos reservados.
        </p>
      </div>
    </div>
  );
};

export default MaintenancePage;
