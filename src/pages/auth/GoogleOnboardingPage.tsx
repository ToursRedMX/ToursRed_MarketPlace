import React from 'react';
import { useNavigate } from 'react-router-dom';
import { MapPin, Building2, LogOut } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../context/AuthContext';

const GoogleOnboardingPage: React.FC = () => {
  const { user } = useAuth();
  const navigate = useNavigate();

  const meta = user?.user_metadata ?? {};
  const displayName = meta.full_name || meta.name || user?.email?.split('@')[0] || 'Usuario';
  const avatarUrl = meta.avatar_url || meta.picture || null;

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    navigate('/login');
  };

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col justify-center py-12 px-4 sm:px-6 lg:px-8">
      <div className="sm:mx-auto sm:w-full sm:max-w-lg">
        {/* Avatar + welcome */}
        <div className="flex flex-col items-center mb-8">
          {avatarUrl ? (
            <img
              src={avatarUrl}
              alt={displayName}
              className="w-20 h-20 rounded-full ring-4 ring-white shadow-lg object-cover mb-4"
            />
          ) : (
            <div className="w-20 h-20 rounded-full ring-4 ring-white shadow-lg bg-primary-100 flex items-center justify-center mb-4">
              <span className="text-3xl font-bold text-primary-600">
                {displayName.charAt(0).toUpperCase()}
              </span>
            </div>
          )}
          <h1 className="text-2xl font-bold text-gray-900">Bienvenido, {displayName.split(' ')[0]}</h1>
          <p className="text-sm text-gray-500 mt-1">{user?.email}</p>
        </div>

        <div className="bg-white shadow-sm rounded-xl px-6 py-8">
          <h2 className="text-lg font-semibold text-gray-900 text-center mb-2">
            ¿Cómo quieres unirte a ToursRed?
          </h2>
          <p className="text-sm text-gray-500 text-center mb-8">
            Elige tu perfil para completar tu registro.
          </p>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {/* Viajero */}
            <button
              onClick={() => navigate('/auth/google-signup/traveler')}
              className="group flex flex-col items-center gap-4 p-6 border-2 border-gray-200 rounded-xl hover:border-primary-500 hover:bg-primary-50 transition-all duration-200 text-left"
            >
              <div className="w-14 h-14 rounded-full bg-primary-100 group-hover:bg-primary-200 flex items-center justify-center transition-colors">
                <MapPin className="w-7 h-7 text-primary-600" />
              </div>
              <div className="text-center">
                <p className="font-semibold text-gray-900 group-hover:text-primary-700">Soy Viajero</p>
                <p className="text-xs text-gray-500 mt-1">Explora y reserva tours increíbles</p>
              </div>
            </button>

            {/* Agencia */}
            <button
              onClick={() => navigate('/auth/google-signup/agency')}
              className="group flex flex-col items-center gap-4 p-6 border-2 border-gray-200 rounded-xl hover:border-primary-500 hover:bg-primary-50 transition-all duration-200 text-left"
            >
              <div className="w-14 h-14 rounded-full bg-primary-100 group-hover:bg-primary-200 flex items-center justify-center transition-colors">
                <Building2 className="w-7 h-7 text-primary-600" />
              </div>
              <div className="text-center">
                <p className="font-semibold text-gray-900 group-hover:text-primary-700">Soy Agencia</p>
                <p className="text-xs text-gray-500 mt-1">Publica y gestiona tus tours</p>
              </div>
            </button>
          </div>

          <div className="mt-8 pt-6 border-t border-gray-100 flex justify-center">
            <button
              onClick={handleSignOut}
              className="flex items-center gap-2 text-sm text-gray-400 hover:text-gray-600 transition-colors"
            >
              <LogOut className="w-4 h-4" />
              Cancelar y cerrar sesión
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default GoogleOnboardingPage;
