import React, { useState, useEffect } from 'react';
import { User, Mail, Calendar, Shield, Save, Edit } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { supabase } from '../../lib/supabase';
import ChangePasswordSection from '../../components/ChangePasswordSection';

const AdminProfile: React.FC = () => {
  const { user } = useAuth();
  const [isEditing, setIsEditing] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [profile, setProfile] = useState({
    first_name: '',
    last_name: '',
    email: '',
    role: 'admin',
    created_at: '',
    updated_at: ''
  });

  useEffect(() => {
    const fetchProfile = async () => {
      if (!user?.id) return;

      try {
        setIsLoading(true);
        
        const { data, error } = await supabase
          .from('users')
          .select('*')
          .eq('id', user.id)
          .single();

        if (error) {
          throw new Error(error.message);
        }

        if (data) {
          setProfile({
            first_name: data.first_name || '',
            last_name: data.last_name || '',
            email: data.email || user.email || '',
            role: data.role || 'admin',
            created_at: data.created_at || '',
            updated_at: data.updated_at || ''
          });
        }
      } catch (err: any) {
        setError(err.message || 'Error al cargar el perfil');
      } finally {
        setIsLoading(false);
      }
    };

    fetchProfile();
  }, [user?.id]);

  const handleSave = async () => {
    if (!user?.id) return;

    try {
      setIsLoading(true);
      setError('');
      setSuccess('');

      const { error } = await supabase
        .from('users')
        .update({
          first_name: profile.first_name,
          last_name: profile.last_name,
          updated_at: new Date().toISOString()
        })
        .eq('id', user.id);

      if (error) {
        throw new Error(error.message);
      }

      setSuccess('Perfil actualizado correctamente');
      setIsEditing(false);
    } catch (err: any) {
      setError(err.message || 'Error al actualizar el perfil');
    } finally {
      setIsLoading(false);
    }
  };

  const handleCancel = () => {
    setIsEditing(false);
    setError('');
    setSuccess('');
  };

  if (isLoading && !profile.email) {
    return (
      <div className="container mx-auto px-4 py-8">
        <div className="flex justify-center py-12">
          <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-primary-600"></div>
        </div>
      </div>
    );
  }

  return (
    <div className="container mx-auto px-4 py-8">
      <div className="max-w-2xl mx-auto">
        <div className="bg-white rounded-lg shadow-md overflow-hidden">
          {/* Header */}
          <div className="bg-gradient-to-r from-primary-600 to-primary-700 px-6 py-8">
            <div className="flex items-center">
              <div className="h-20 w-20 rounded-full bg-white/20 flex items-center justify-center">
                <Shield className="h-10 w-10 text-white" />
              </div>
              <div className="ml-6">
                <h1 className="text-2xl font-bold text-white">
                  {profile.first_name || profile.last_name 
                    ? `${profile.first_name} ${profile.last_name}`.trim()
                    : 'Administrador'
                  }
                </h1>
                <p className="text-primary-100">Administrador del Sistema</p>
              </div>
            </div>
          </div>

          {/* Content */}
          <div className="p-6">
            {error && (
              <div className="mb-4 bg-error-50 text-error-600 p-3 rounded-md">
                {error}
              </div>
            )}

            {success && (
              <div className="mb-4 bg-success-50 text-success-600 p-3 rounded-md">
                {success}
              </div>
            )}

            <div className="space-y-6">
              {/* Personal Information */}
              <div>
                <div className="flex justify-between items-center mb-4">
                  <h2 className="text-lg font-semibold text-gray-900">Información Personal</h2>
                  {!isEditing && (
                    <button
                      onClick={() => setIsEditing(true)}
                      className="btn btn-outline"
                    >
                      <Edit className="h-4 w-4 mr-2" />
                      Editar
                    </button>
                  )}
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Nombre
                    </label>
                    {isEditing ? (
                      <input
                        type="text"
                        value={profile.first_name}
                        onChange={(e) => setProfile({...profile, first_name: e.target.value})}
                        className="input"
                        placeholder="Ingresa tu nombre"
                      />
                    ) : (
                      <div className="flex items-center p-3 bg-gray-50 rounded-md">
                        <User className="h-4 w-4 text-gray-400 mr-2" />
                        <span>{profile.first_name || 'No especificado'}</span>
                      </div>
                    )}
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Apellido
                    </label>
                    {isEditing ? (
                      <input
                        type="text"
                        value={profile.last_name}
                        onChange={(e) => setProfile({...profile, last_name: e.target.value})}
                        className="input"
                        placeholder="Ingresa tu apellido"
                      />
                    ) : (
                      <div className="flex items-center p-3 bg-gray-50 rounded-md">
                        <User className="h-4 w-4 text-gray-400 mr-2" />
                        <span>{profile.last_name || 'No especificado'}</span>
                      </div>
                    )}
                  </div>

                  <div className="md:col-span-2">
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Correo Electrónico
                    </label>
                    <div className="flex items-center p-3 bg-gray-50 rounded-md">
                      <Mail className="h-4 w-4 text-gray-400 mr-2" />
                      <span>{profile.email}</span>
                    </div>
                    <p className="text-xs text-gray-500 mt-1">
                      El correo electrónico no se puede modificar
                    </p>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Rol
                    </label>
                    <div className="flex items-center p-3 bg-gray-50 rounded-md">
                      <Shield className="h-4 w-4 text-primary-600 mr-2" />
                      <span className="capitalize font-medium text-primary-600">
                        {profile.role === 'admin' ? 'Administrador' : profile.role}
                      </span>
                    </div>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Miembro desde
                    </label>
                    <div className="flex items-center p-3 bg-gray-50 rounded-md">
                      <Calendar className="h-4 w-4 text-gray-400 mr-2" />
                      <span>
                        {profile.created_at 
                          ? new Date(profile.created_at).toLocaleDateString('es-ES', {
                              year: 'numeric',
                              month: 'long',
                              day: 'numeric'
                            })
                          : 'No disponible'
                        }
                      </span>
                    </div>
                  </div>
                </div>

                {isEditing && (
                  <div className="flex justify-end space-x-4 mt-6">
                    <button
                      onClick={handleCancel}
                      className="btn btn-outline"
                      disabled={isLoading}
                    >
                      Cancelar
                    </button>
                    <button
                      onClick={handleSave}
                      className="btn btn-primary"
                      disabled={isLoading}
                    >
                      <Save className="h-4 w-4 mr-2" />
                      {isLoading ? 'Guardando...' : 'Guardar Cambios'}
                    </button>
                  </div>
                )}
              </div>

              {/* Seguridad - Cambiar Contraseña */}
              <div className="border-t pt-6">
                <ChangePasswordSection />
              </div>

              {/* System Information */}
              <div className="border-t pt-6">
                <h2 className="text-lg font-semibold text-gray-900 mb-4">Información del Sistema</h2>
                <div className="bg-primary-50 rounded-lg p-4">
                  <div className="flex items-start">
                    <Shield className="h-5 w-5 text-primary-600 mt-0.5 mr-3" />
                    <div>
                      <h3 className="font-medium text-primary-900">Privilegios de Administrador</h3>
                      <p className="text-sm text-primary-700 mt-1">
                        Tienes acceso completo al sistema, incluyendo la gestión de usuarios, 
                        agencias, tours y configuraciones del sistema.
                      </p>
                      <ul className="text-sm text-primary-600 mt-2 space-y-1">
                        <li>• Gestión de usuarios y roles</li>
                        <li>• Supervisión de agencias</li>
                        <li>• Moderación de reseñas</li>
                        <li>• Configuración del sistema</li>
                      </ul>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default AdminProfile;