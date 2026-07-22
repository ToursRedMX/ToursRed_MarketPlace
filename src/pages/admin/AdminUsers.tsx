import React, { useState, useEffect } from 'react';
import { useAuth, AdminPermissions } from '../../context/AuthContext';
import { supabase } from '../../lib/supabase';
import { UserPlus, Shield, X, Check, AlertCircle, Lock, Unlock, Trash2, Eye, EyeOff } from 'lucide-react';

interface StaffUser {
  id: string;
  email: string;
  first_name: string;
  last_name: string;
  is_super_admin: boolean;
  is_active: boolean;
  created_at: string;
  permissions: AdminPermissions | null;
}

const AdminUsers: React.FC = () => {
  const { isSuperAdmin } = useAuth();
  const [staffUsers, setStaffUsers] = useState<StaffUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [editingPermissions, setEditingPermissions] = useState<string | null>(null);

  const [showNewUserPassword, setShowNewUserPassword] = useState(false);
  const [newUser, setNewUser] = useState({
    email: '',
    password: '',
    nombre: '',
    apellido: '',
    permissions: {
      canManageAgencies: false,
      canManageUsers: false,
      canManageTravelers: false,
      canManageDestinations: false,
      canManageCategories: false,
      canManageDeparturePoints: false,
      canManageReviews: false,
      canManageMessages: false,
      canManageSettings: false,
      canManageMemberships: false,
      canManageInquiries: false,
      canManagePoints: false,
      canManageDiscountCodes: false,
    }
  });

  const [tempPermissions, setTempPermissions] = useState<AdminPermissions>({
    canManageAgencies: false,
    canManageUsers: false,
    canManageTravelers: false,
    canManageDestinations: false,
    canManageCategories: false,
    canManageDeparturePoints: false,
    canManageReviews: false,
    canManageMessages: false,
    canManageSettings: false,
    canManageMemberships: false,
    canManageInquiries: false,
    canManagePoints: false,
    canManageDiscountCodes: false,
    canViewAuditLog: false,
    canViewAuditSensitiveData: false,
    canExportAuditLog: false,
    canCancelBookings: false,
  });

  useEffect(() => {
    loadStaffUsers();
  }, []);

  const loadStaffUsers = async () => {
    try {
      setLoading(true);
      setError(null);

      // OPTIMIZED: Select only needed columns
      const { data: usersData, error: usersError } = await supabase
        .from('users')
        .select('id, email, first_name, last_name, role, is_active, created_at, is_super_admin')
        .eq('role', 'admin')
        .order('created_at', { ascending: false });

      if (usersError) throw usersError;

      const staffWithPermissions = await Promise.all(
        (usersData || []).map(async (user) => {
          const { data: permsData } = await supabase
            .from('admin_permissions')
            .select('can_manage_agencies, can_manage_users, can_manage_travelers, can_manage_destinations, can_manage_categories, can_manage_departure_points, can_manage_reviews, can_manage_messages, can_manage_inquiries, can_manage_settings, can_manage_memberships, can_manage_points, can_manage_discount_codes, can_view_audit_log, can_view_audit_sensitive_data, can_export_audit_log, can_cancel_bookings')
            .eq('user_id', user.id)
            .maybeSingle();

          return {
            ...user,
            permissions: permsData ? {
              canManageAgencies: permsData.can_manage_agencies,
              canManageUsers: permsData.can_manage_users,
              canManageTravelers: permsData.can_manage_travelers,
              canManageDestinations: permsData.can_manage_destinations,
              canManageCategories: permsData.can_manage_categories,
              canManageDeparturePoints: permsData.can_manage_departure_points,
              canManageReviews: permsData.can_manage_reviews,
              canManageMessages: permsData.can_manage_messages,
              canManageSettings: permsData.can_manage_settings,
              canManageMemberships: permsData.can_manage_memberships,
              canManageInquiries: permsData.can_manage_inquiries,
              canManagePoints: permsData.can_manage_points,
              canManageDiscountCodes: permsData.can_manage_discount_codes,
              canViewAuditLog: permsData.can_view_audit_log ?? false,
              canViewAuditSensitiveData: permsData.can_view_audit_sensitive_data ?? false,
              canExportAuditLog: permsData.can_export_audit_log ?? false,
              canCancelBookings: permsData.can_cancel_bookings ?? false,
            } : null
          };
        })
      );

      setStaffUsers(staffWithPermissions);
    } catch (err: any) {
      console.error('Error cargando usuarios staff:', err);
      setError('Error al cargar los usuarios');
    } finally {
      setLoading(false);
    }
  };

  const handleCreateUser = async () => {
    if (!newUser.email || !newUser.password || !newUser.nombre || !newUser.apellido) {
      setError('Todos los campos son obligatorios');
      return;
    }

    try {
      setLoading(true);
      setError(null);

      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        throw new Error('No hay sesión activa');
      }

      const response = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/create-admin-user`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${session.access_token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            email: newUser.email,
            password: newUser.password,
            nombre: newUser.nombre,
            apellido: newUser.apellido,
            permissions: {
              can_manage_agencies: newUser.permissions.canManageAgencies,
              can_manage_users: newUser.permissions.canManageUsers,
              can_manage_travelers: newUser.permissions.canManageTravelers,
              can_manage_destinations: newUser.permissions.canManageDestinations,
              can_manage_categories: newUser.permissions.canManageCategories,
              can_manage_departure_points: newUser.permissions.canManageDeparturePoints,
              can_manage_reviews: newUser.permissions.canManageReviews,
              can_manage_messages: newUser.permissions.canManageMessages,
              can_manage_settings: newUser.permissions.canManageSettings,
              can_manage_memberships: newUser.permissions.canManageMemberships,
              can_manage_inquiries: newUser.permissions.canManageInquiries,
              can_manage_points: newUser.permissions.canManagePoints,
              can_manage_discount_codes: newUser.permissions.canManageDiscountCodes,
            }
          }),
        }
      );

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || 'Error al crear usuario');
      }

      setShowCreateModal(false);
      setNewUser({
        email: '',
        password: '',
        nombre: '',
        apellido: '',
        permissions: {
          canManageAgencies: false,
          canManageUsers: false,
          canManageTravelers: false,
          canManageDestinations: false,
          canManageCategories: false,
          canManageDeparturePoints: false,
          canManageReviews: false,
          canManageMessages: false,
          canManageSettings: false,
          canManageMemberships: false,
          canManageInquiries: false,
          canManagePoints: false,
          canManageDiscountCodes: false,
        }
      });

      await loadStaffUsers();
    } catch (err: any) {
      console.error('Error creando usuario:', err);
      setError(err.message || 'Error al crear usuario');
    } finally {
      setLoading(false);
    }
  };

  const handleUpdatePermissions = async (userId: string) => {
    try {
      setLoading(true);
      setError(null);

      const { error: updateError } = await supabase
        .from('admin_permissions')
        .upsert({
          user_id: userId,
          can_manage_agencies: tempPermissions.canManageAgencies,
          can_manage_users: tempPermissions.canManageUsers,
          can_manage_travelers: tempPermissions.canManageTravelers,
          can_manage_destinations: tempPermissions.canManageDestinations,
          can_manage_categories: tempPermissions.canManageCategories,
          can_manage_departure_points: tempPermissions.canManageDeparturePoints,
          can_manage_reviews: tempPermissions.canManageReviews,
          can_manage_messages: tempPermissions.canManageMessages,
          can_manage_settings: tempPermissions.canManageSettings,
          can_manage_memberships: tempPermissions.canManageMemberships,
          can_manage_inquiries: tempPermissions.canManageInquiries,
          can_manage_points: tempPermissions.canManagePoints,
          can_manage_discount_codes: tempPermissions.canManageDiscountCodes,
          can_view_audit_log: tempPermissions.canViewAuditLog,
          can_view_audit_sensitive_data: tempPermissions.canViewAuditSensitiveData,
          can_export_audit_log: tempPermissions.canExportAuditLog,
          can_cancel_bookings: tempPermissions.canCancelBookings,
        }, { onConflict: 'user_id' });

      if (updateError) throw updateError;

      setEditingPermissions(null);
      await loadStaffUsers();
    } catch (err: any) {
      console.error('Error actualizando permisos:', err);
      setError('Error al actualizar permisos');
    } finally {
      setLoading(false);
    }
  };

  const startEditPermissions = (user: StaffUser) => {
    const base = {
      canManageAgencies: false,
      canManageUsers: false,
      canManageTravelers: false,
      canManageDestinations: false,
      canManageCategories: false,
      canManageDeparturePoints: false,
      canManageReviews: false,
      canManageMessages: false,
      canManageSettings: false,
      canManageMemberships: false,
      canManageInquiries: false,
      canManagePoints: false,
      canManageDiscountCodes: false,
      canViewAuditLog: false,
      canViewAuditSensitiveData: false,
      canExportAuditLog: false,
    };
    setTempPermissions(user.permissions ? { ...base, ...user.permissions } : base);
    setEditingPermissions(user.id);
  };

  const cancelEditPermissions = () => {
    setEditingPermissions(null);
    setTempPermissions({
      canManageAgencies: false,
      canManageUsers: false,
      canManageTravelers: false,
      canManageDestinations: false,
      canManageCategories: false,
      canManageDeparturePoints: false,
      canManageReviews: false,
      canManageMessages: false,
      canManageSettings: false,
      canManageMemberships: false,
      canManageInquiries: false,
      canManagePoints: false,
      canManageDiscountCodes: false,
      canViewAuditLog: false,
      canViewAuditSensitiveData: false,
      canExportAuditLog: false,
    });
  };

  const handleToggleUserStatus = async (userId: string, currentStatus: boolean) => {
    if (!window.confirm(currentStatus ? '¿Bloquear este usuario?' : '¿Desbloquear este usuario?')) {
      return;
    }

    try {
      setLoading(true);
      setError(null);

      const { error: updateError } = await supabase
        .from('users')
        .update({ is_active: !currentStatus })
        .eq('id', userId);

      if (updateError) throw updateError;

      await loadStaffUsers();
    } catch (err: any) {
      console.error('Error actualizando estado del usuario:', err);
      setError('Error al actualizar el estado del usuario');
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteUser = async (userId: string, userEmail: string) => {
    if (!window.confirm(`¿Estás seguro de eliminar permanentemente al usuario ${userEmail}? Esta acción no se puede deshacer.`)) {
      return;
    }

    try {
      setLoading(true);
      setError(null);

      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        throw new Error('No hay sesión activa');
      }

      const { error: permsError } = await supabase
        .from('admin_permissions')
        .delete()
        .eq('user_id', userId);

      if (permsError) throw permsError;

      const { error: userError } = await supabase
        .from('users')
        .delete()
        .eq('id', userId);

      if (userError) throw userError;

      await loadStaffUsers();
    } catch (err: any) {
      console.error('Error eliminando usuario:', err);
      setError('Error al eliminar el usuario');
    } finally {
      setLoading(false);
    }
  };

  const PermissionCheckbox = ({
    label,
    checked,
    onChange,
    disabled = false
  }: {
    label: string;
    checked: boolean;
    onChange: (checked: boolean) => void;
    disabled?: boolean;
  }) => (
    <label className="flex items-center space-x-2 cursor-pointer">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        disabled={disabled}
        className="w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500 disabled:opacity-50"
      />
      <span className={`text-sm ${disabled ? 'text-gray-400' : 'text-gray-700'}`}>
        {label}
      </span>
    </label>
  );

  if (!isSuperAdmin) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-6">
        <div className="bg-white rounded-lg shadow-lg p-8 max-w-md w-full text-center">
          <AlertCircle className="w-16 h-16 text-red-500 mx-auto mb-4" />
          <h2 className="text-2xl font-bold text-gray-900 mb-2">Acceso Denegado</h2>
          <p className="text-gray-600">Solo el super administrador puede gestionar usuarios del sistema.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 py-8 px-4 sm:px-6 lg:px-8">
      <div className="max-w-7xl mx-auto">
        <div className="mb-8">
          <div className="flex justify-between items-center">
            <div>
              <h1 className="text-3xl font-bold text-gray-900">Usuarios del Sistema</h1>
              <p className="mt-2 text-gray-600">
                Gestiona los usuarios internos y sus permisos de acceso
              </p>
            </div>
            <button
              onClick={() => setShowCreateModal(true)}
              className="flex items-center px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
            >
              <UserPlus className="w-5 h-5 mr-2" />
              Crear Usuario
            </button>
          </div>
        </div>

        {error && (
          <div className="mb-4 p-4 bg-red-50 border border-red-200 rounded-lg flex items-start">
            <AlertCircle className="w-5 h-5 text-red-600 mr-2 mt-0.5" />
            <span className="text-red-800">{error}</span>
          </div>
        )}

        {loading && staffUsers.length === 0 ? (
          <div className="text-center py-12">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto"></div>
            <p className="mt-4 text-gray-600">Cargando usuarios...</p>
          </div>
        ) : (
          <div className="grid gap-6">
            {staffUsers.map((user) => (
              <div key={user.id} className="bg-white rounded-lg shadow-md p-6">
                <div className="flex items-start justify-between mb-4">
                  <div className="flex items-center">
                    <div className="w-12 h-12 bg-blue-100 rounded-full flex items-center justify-center">
                      <Shield className="w-6 h-6 text-blue-600" />
                    </div>
                    <div className="ml-4">
                      <h3 className="text-lg font-semibold text-gray-900">
                        {user.first_name} {user.last_name}
                      </h3>
                      <p className="text-gray-600">{user.email}</p>
                      <div className="flex gap-2 mt-1">
                        {user.is_super_admin && (
                          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-yellow-100 text-yellow-800">
                            Super Administrador
                          </span>
                        )}
                        <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                          user.is_active
                            ? 'bg-green-100 text-green-800'
                            : 'bg-red-100 text-red-800'
                        }`}>
                          {user.is_active ? 'Activo' : 'Bloqueado'}
                        </span>
                      </div>
                    </div>
                  </div>
                  {!user.is_super_admin && editingPermissions !== user.id && (
                    <div className="flex gap-2">
                      <button
                        onClick={() => startEditPermissions(user)}
                        className="px-4 py-2 text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
                      >
                        Editar Permisos
                      </button>
                      <button
                        onClick={() => handleToggleUserStatus(user.id, user.is_active)}
                        className={`px-4 py-2 rounded-lg transition-colors flex items-center gap-2 ${
                          user.is_active
                            ? 'text-orange-600 hover:bg-orange-50'
                            : 'text-green-600 hover:bg-green-50'
                        }`}
                        title={user.is_active ? 'Bloquear usuario' : 'Desbloquear usuario'}
                      >
                        {user.is_active ? <Lock className="w-4 h-4" /> : <Unlock className="w-4 h-4" />}
                        {user.is_active ? 'Bloquear' : 'Desbloquear'}
                      </button>
                      <button
                        onClick={() => handleDeleteUser(user.id, user.email)}
                        className="px-4 py-2 text-red-600 hover:bg-red-50 rounded-lg transition-colors flex items-center gap-2"
                        title="Eliminar usuario"
                      >
                        <Trash2 className="w-4 h-4" />
                        Eliminar
                      </button>
                    </div>
                  )}
                </div>

                {user.is_super_admin ? (
                  <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
                    <p className="text-sm text-yellow-800">
                      El super administrador tiene acceso completo a todas las secciones del sistema.
                    </p>
                  </div>
                ) : (user.permissions || editingPermissions === user.id) ? (
                  <div className="border-t border-gray-200 pt-4">
                    <h4 className="text-sm font-semibold text-gray-700 mb-3">Permisos de Acceso:</h4>
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                      {editingPermissions === user.id ? (
                        <>
                          <PermissionCheckbox
                            label="Gestionar Agencias"
                            checked={tempPermissions.canManageAgencies}
                            onChange={(checked) => setTempPermissions({ ...tempPermissions, canManageAgencies: checked })}
                          />
                          <PermissionCheckbox
                            label="Gestionar Usuarios"
                            checked={tempPermissions.canManageUsers}
                            onChange={(checked) => setTempPermissions({ ...tempPermissions, canManageUsers: checked })}
                          />
                          <PermissionCheckbox
                            label="Gestionar Viajeros"
                            checked={tempPermissions.canManageTravelers}
                            onChange={(checked) => setTempPermissions({ ...tempPermissions, canManageTravelers: checked })}
                          />
                          <PermissionCheckbox
                            label="Gestionar Destinos"
                            checked={tempPermissions.canManageDestinations}
                            onChange={(checked) => setTempPermissions({ ...tempPermissions, canManageDestinations: checked })}
                          />
                          <PermissionCheckbox
                            label="Gestionar Categorías"
                            checked={tempPermissions.canManageCategories}
                            onChange={(checked) => setTempPermissions({ ...tempPermissions, canManageCategories: checked })}
                          />
                          <PermissionCheckbox
                            label="Gestionar Puntos de Partida"
                            checked={tempPermissions.canManageDeparturePoints}
                            onChange={(checked) => setTempPermissions({ ...tempPermissions, canManageDeparturePoints: checked })}
                          />
                          <PermissionCheckbox
                            label="Gestionar Reseñas"
                            checked={tempPermissions.canManageReviews}
                            onChange={(checked) => setTempPermissions({ ...tempPermissions, canManageReviews: checked })}
                          />
                          <PermissionCheckbox
                            label="Ver Mensajes"
                            checked={tempPermissions.canManageMessages}
                            onChange={(checked) => setTempPermissions({ ...tempPermissions, canManageMessages: checked })}
                          />
                          <PermissionCheckbox
                            label="Configuración"
                            checked={tempPermissions.canManageSettings}
                            onChange={(checked) => setTempPermissions({ ...tempPermissions, canManageSettings: checked })}
                          />
                          <PermissionCheckbox
                            label="Gestionar Membresías"
                            checked={tempPermissions.canManageMemberships}
                            onChange={(checked) => setTempPermissions({ ...tempPermissions, canManageMemberships: checked })}
                          />
                          <PermissionCheckbox
                            label="Gestionar Cotizaciones"
                            checked={tempPermissions.canManageInquiries}
                            onChange={(checked) => setTempPermissions({ ...tempPermissions, canManageInquiries: checked })}
                          />
                          <PermissionCheckbox
                            label="Gestionar Puntos"
                            checked={tempPermissions.canManagePoints}
                            onChange={(checked) => setTempPermissions({ ...tempPermissions, canManagePoints: checked })}
                          />
                          <PermissionCheckbox
                            label="Códigos de Descuento"
                            checked={tempPermissions.canManageDiscountCodes}
                            onChange={(checked) => setTempPermissions({ ...tempPermissions, canManageDiscountCodes: checked })}
                          />
                          <PermissionCheckbox
                            label="Ver Registro de Auditoría"
                            checked={tempPermissions.canViewAuditLog}
                            onChange={(checked) => setTempPermissions({ ...tempPermissions, canViewAuditLog: checked })}
                          />
                          <PermissionCheckbox
                            label="Ver Datos Sensibles (Auditoría)"
                            checked={tempPermissions.canViewAuditSensitiveData}
                            onChange={(checked) => setTempPermissions({ ...tempPermissions, canViewAuditSensitiveData: checked })}
                          />
                          <PermissionCheckbox
                            label="Exportar Auditoría"
                            checked={tempPermissions.canExportAuditLog}
                            onChange={(checked) => setTempPermissions({ ...tempPermissions, canExportAuditLog: checked })}
                          />
                          <PermissionCheckbox
                            label="Cancelar Reservas"
                            checked={tempPermissions.canCancelBookings}
                            onChange={(checked) => setTempPermissions({ ...tempPermissions, canCancelBookings: checked })}
                          />
                        </>
                      ) : (
                        <>
                          <PermissionCheckbox
                            label="Gestionar Agencias"
                            checked={user.permissions?.canManageAgencies ?? false}
                            onChange={() => {}}
                            disabled
                          />
                          <PermissionCheckbox
                            label="Gestionar Usuarios"
                            checked={user.permissions?.canManageUsers ?? false}
                            onChange={() => {}}
                            disabled
                          />
                          <PermissionCheckbox
                            label="Gestionar Viajeros"
                            checked={user.permissions?.canManageTravelers ?? false}
                            onChange={() => {}}
                            disabled
                          />
                          <PermissionCheckbox
                            label="Gestionar Destinos"
                            checked={user.permissions?.canManageDestinations ?? false}
                            onChange={() => {}}
                            disabled
                          />
                          <PermissionCheckbox
                            label="Gestionar Categorías"
                            checked={user.permissions?.canManageCategories ?? false}
                            onChange={() => {}}
                            disabled
                          />
                          <PermissionCheckbox
                            label="Gestionar Puntos de Partida"
                            checked={user.permissions?.canManageDeparturePoints ?? false}
                            onChange={() => {}}
                            disabled
                          />
                          <PermissionCheckbox
                            label="Gestionar Reseñas"
                            checked={user.permissions?.canManageReviews ?? false}
                            onChange={() => {}}
                            disabled
                          />
                          <PermissionCheckbox
                            label="Ver Mensajes"
                            checked={user.permissions?.canManageMessages ?? false}
                            onChange={() => {}}
                            disabled
                          />
                          <PermissionCheckbox
                            label="Configuración"
                            checked={user.permissions?.canManageSettings ?? false}
                            onChange={() => {}}
                            disabled
                          />
                          <PermissionCheckbox
                            label="Gestionar Membresías"
                            checked={user.permissions?.canManageMemberships ?? false}
                            onChange={() => {}}
                            disabled
                          />
                          <PermissionCheckbox
                            label="Gestionar Cotizaciones"
                            checked={user.permissions?.canManageInquiries ?? false}
                            onChange={() => {}}
                            disabled
                          />
                          <PermissionCheckbox
                            label="Gestionar Puntos"
                            checked={user.permissions?.canManagePoints ?? false}
                            onChange={() => {}}
                            disabled
                          />
                          <PermissionCheckbox
                            label="Códigos de Descuento"
                            checked={user.permissions?.canManageDiscountCodes ?? false}
                            onChange={() => {}}
                            disabled
                          />
                          <PermissionCheckbox
                            label="Ver Registro de Auditoría"
                            checked={user.permissions.canViewAuditLog ?? false}
                            onChange={() => {}}
                            disabled
                          />
                          <PermissionCheckbox
                            label="Ver Datos Sensibles (Auditoría)"
                            checked={user.permissions.canViewAuditSensitiveData ?? false}
                            onChange={() => {}}
                            disabled
                          />
                          <PermissionCheckbox
                            label="Exportar Auditoría"
                            checked={user.permissions.canExportAuditLog ?? false}
                            onChange={() => {}}
                            disabled
                          />
                          <PermissionCheckbox
                            label="Cancelar Reservas"
                            checked={user.permissions.canCancelBookings ?? false}
                            onChange={() => {}}
                            disabled
                          />
                        </>
                      )}
                    </div>
                    {editingPermissions === user.id && (
                      <div className="mt-4 flex justify-end space-x-2">
                        <button
                          onClick={cancelEditPermissions}
                          className="px-4 py-2 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50 transition-colors"
                        >
                          Cancelar
                        </button>
                        <button
                          onClick={() => handleUpdatePermissions(user.id)}
                          disabled={loading}
                          className="flex items-center px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50"
                        >
                          <Check className="w-5 h-5 mr-2" />
                          Guardar Permisos
                        </button>
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="bg-gray-50 border border-gray-200 rounded-lg p-4">
                    <p className="text-sm text-gray-600">Sin permisos configurados</p>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {showCreateModal && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
            <div className="bg-white rounded-lg shadow-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
              <div className="p-6">
                <div className="flex justify-between items-center mb-6">
                  <h2 className="text-2xl font-bold text-gray-900">Crear Nuevo Usuario</h2>
                  <button
                    onClick={() => setShowCreateModal(false)}
                    className="text-gray-400 hover:text-gray-600"
                  >
                    <X className="w-6 h-6" />
                  </button>
                </div>

                <div className="space-y-4 mb-6">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Email
                    </label>
                    <input
                      type="email"
                      value={newUser.email}
                      onChange={(e) => setNewUser({ ...newUser, email: e.target.value })}
                      className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                      placeholder="usuario@toursred.com"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Contraseña
                    </label>
                    <div className="relative">
                      <input
                        type={showNewUserPassword ? 'text' : 'password'}
                        value={newUser.password}
                        onChange={(e) => setNewUser({ ...newUser, password: e.target.value })}
                        className="w-full px-4 py-2 pr-10 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                        placeholder="Contraseña segura"
                      />
                      <button
                        type="button"
                        onClick={() => setShowNewUserPassword(!showNewUserPassword)}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                      >
                        {showNewUserPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                      </button>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        Nombre
                      </label>
                      <input
                        type="text"
                        value={newUser.nombre}
                        onChange={(e) => setNewUser({ ...newUser, nombre: e.target.value })}
                        className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                        placeholder="Juan"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        Apellido
                      </label>
                      <input
                        type="text"
                        value={newUser.apellido}
                        onChange={(e) => setNewUser({ ...newUser, apellido: e.target.value })}
                        className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                        placeholder="Pérez"
                      />
                    </div>
                  </div>
                </div>

                <div className="border-t border-gray-200 pt-4 mb-6">
                  <h3 className="text-lg font-semibold text-gray-900 mb-4">Permisos de Acceso</h3>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <PermissionCheckbox
                      label="Gestionar Agencias"
                      checked={newUser.permissions.canManageAgencies}
                      onChange={(checked) => setNewUser({
                        ...newUser,
                        permissions: { ...newUser.permissions, canManageAgencies: checked }
                      })}
                    />
                    <PermissionCheckbox
                      label="Gestionar Usuarios"
                      checked={newUser.permissions.canManageUsers}
                      onChange={(checked) => setNewUser({
                        ...newUser,
                        permissions: { ...newUser.permissions, canManageUsers: checked }
                      })}
                    />
                    <PermissionCheckbox
                      label="Gestionar Viajeros"
                      checked={newUser.permissions.canManageTravelers}
                      onChange={(checked) => setNewUser({
                        ...newUser,
                        permissions: { ...newUser.permissions, canManageTravelers: checked }
                      })}
                    />
                    <PermissionCheckbox
                      label="Gestionar Destinos"
                      checked={newUser.permissions.canManageDestinations}
                      onChange={(checked) => setNewUser({
                        ...newUser,
                        permissions: { ...newUser.permissions, canManageDestinations: checked }
                      })}
                    />
                    <PermissionCheckbox
                      label="Gestionar Categorías"
                      checked={newUser.permissions.canManageCategories}
                      onChange={(checked) => setNewUser({
                        ...newUser,
                        permissions: { ...newUser.permissions, canManageCategories: checked }
                      })}
                    />
                    <PermissionCheckbox
                      label="Gestionar Puntos de Partida"
                      checked={newUser.permissions.canManageDeparturePoints}
                      onChange={(checked) => setNewUser({
                        ...newUser,
                        permissions: { ...newUser.permissions, canManageDeparturePoints: checked }
                      })}
                    />
                    <PermissionCheckbox
                      label="Gestionar Reseñas"
                      checked={newUser.permissions.canManageReviews}
                      onChange={(checked) => setNewUser({
                        ...newUser,
                        permissions: { ...newUser.permissions, canManageReviews: checked }
                      })}
                    />
                    <PermissionCheckbox
                      label="Ver Mensajes"
                      checked={newUser.permissions.canManageMessages}
                      onChange={(checked) => setNewUser({
                        ...newUser,
                        permissions: { ...newUser.permissions, canManageMessages: checked }
                      })}
                    />
                    <PermissionCheckbox
                      label="Configuración"
                      checked={newUser.permissions.canManageSettings}
                      onChange={(checked) => setNewUser({
                        ...newUser,
                        permissions: { ...newUser.permissions, canManageSettings: checked }
                      })}
                    />
                    <PermissionCheckbox
                      label="Gestionar Membresías"
                      checked={newUser.permissions.canManageMemberships}
                      onChange={(checked) => setNewUser({
                        ...newUser,
                        permissions: { ...newUser.permissions, canManageMemberships: checked }
                      })}
                    />
                    <PermissionCheckbox
                      label="Gestionar Cotizaciones"
                      checked={newUser.permissions.canManageInquiries}
                      onChange={(checked) => setNewUser({
                        ...newUser,
                        permissions: { ...newUser.permissions, canManageInquiries: checked }
                      })}
                    />
                    <PermissionCheckbox
                      label="Gestionar Puntos"
                      checked={newUser.permissions.canManagePoints}
                      onChange={(checked) => setNewUser({
                        ...newUser,
                        permissions: { ...newUser.permissions, canManagePoints: checked }
                      })}
                    />
                    <PermissionCheckbox
                      label="Códigos de Descuento"
                      checked={newUser.permissions.canManageDiscountCodes}
                      onChange={(checked) => setNewUser({
                        ...newUser,
                        permissions: { ...newUser.permissions, canManageDiscountCodes: checked }
                      })}
                    />
                  </div>
                </div>

                <div className="flex justify-end space-x-2">
                  <button
                    onClick={() => setShowCreateModal(false)}
                    className="px-4 py-2 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50 transition-colors"
                  >
                    Cancelar
                  </button>
                  <button
                    onClick={handleCreateUser}
                    disabled={loading}
                    className="flex items-center px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50"
                  >
                    <UserPlus className="w-5 h-5 mr-2" />
                    Crear Usuario
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default AdminUsers;
