import React, { useState, useEffect } from 'react';
import { Users, Plus, CreditCard as Edit, Trash2, Save, X, AlertCircle, Search, UserPlus, Shield, Phone } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { supabase } from '../../lib/supabase';
import { FrequentCompanion } from '../../types';
import { Link } from 'react-router-dom';

interface CompanionForm {
  nombre: string;
  apellido: string;
  email: string;
  telefono: string;
  fecha_nacimiento: string;
  documento_tipo: 'curp' | 'pasaporte' | '';
  documento_numero: string;
  emergency_contact_name: string;
  emergency_contact_phone: string;
}

const emptyForm: CompanionForm = {
  nombre: '',
  apellido: '',
  email: '',
  telefono: '',
  fecha_nacimiento: '',
  documento_tipo: '',
  documento_numero: '',
  emergency_contact_name: '',
  emergency_contact_phone: '',
};

const TravelerCompanions: React.FC = () => {
  const { user } = useAuth();
  const [companions, setCompanions] = useState<FrequentCompanion[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [showAddForm, setShowAddForm] = useState(false);
  const [form, setForm] = useState<CompanionForm>({ ...emptyForm });
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');

  useEffect(() => {
    if (user) loadCompanions();
  }, [user?.id]);

  const loadCompanions = async () => {
    if (!user) return;
    setIsLoading(true);
    try {
      const { data, error } = await supabase
        .from('frequent_companions')
        .select('*')
        .eq('user_id', user.id)
        .order('nombre', { ascending: true });

      if (error) throw error;
      setCompanions(data || []);
    } catch {
      setError('Error al cargar los acompañantes');
    } finally {
      setIsLoading(false);
    }
  };

  const validateForm = (): string | null => {
    if (!form.nombre.trim()) return 'El nombre es obligatorio';
    if (!form.apellido.trim()) return 'Los apellidos son obligatorios';
    if (!form.email.trim()) return 'El email es obligatorio';
    if (!form.fecha_nacimiento) return 'La fecha de nacimiento es obligatoria';
    if (!form.documento_tipo) return 'El tipo de documento es obligatorio';
    if (!form.documento_numero.trim()) return `El ${form.documento_tipo === 'pasaporte' ? 'número de pasaporte' : 'CURP'} es obligatorio`;
    return null;
  };

  const buildRecord = () => ({
    nombre: form.nombre.trim(),
    apellido: form.apellido.trim(),
    email: form.email.trim(),
    telefono: form.telefono.trim() || null,
    fecha_nacimiento: form.fecha_nacimiento,
    documento_tipo: form.documento_tipo as 'curp' | 'pasaporte',
    documento_numero: form.documento_numero.trim().toUpperCase(),
    emergency_contact_name: form.emergency_contact_name.trim() || null,
    emergency_contact_phone: form.emergency_contact_phone.trim() || null,
  });

  const handleAdd = async () => {
    if (!user) return;
    const validationError = validateForm();
    if (validationError) {
      setError(validationError);
      return;
    }

    setIsSaving(true);
    setError('');
    try {
      const { error } = await supabase
        .from('frequent_companions')
        .insert({ user_id: user.id, ...buildRecord() });

      if (error) throw error;

      setSuccess('Acompañante agregado correctamente');
      setShowAddForm(false);
      setForm({ ...emptyForm });
      await loadCompanions();
      setTimeout(() => setSuccess(''), 3000);
    } catch (err: any) {
      setError(err.message || 'Error al agregar el acompañante');
    } finally {
      setIsSaving(false);
    }
  };

  const handleEdit = (companion: FrequentCompanion) => {
    setEditingId(companion.id);
    setForm({
      nombre: companion.nombre,
      apellido: companion.apellido || '',
      email: companion.email,
      telefono: companion.telefono || '',
      fecha_nacimiento: companion.fecha_nacimiento,
      documento_tipo: companion.documento_tipo || '',
      documento_numero: companion.documento_numero || '',
      emergency_contact_name: companion.emergency_contact_name || '',
      emergency_contact_phone: companion.emergency_contact_phone || '',
    });
    setShowAddForm(false);
    setError('');
  };

  const handleUpdate = async () => {
    if (!editingId) return;
    const validationError = validateForm();
    if (validationError) {
      setError(validationError);
      return;
    }

    setIsSaving(true);
    setError('');
    try {
      const { error } = await supabase
        .from('frequent_companions')
        .update(buildRecord())
        .eq('id', editingId);

      if (error) throw error;

      setSuccess('Acompañante actualizado correctamente');
      setEditingId(null);
      setForm({ ...emptyForm });
      await loadCompanions();
      setTimeout(() => setSuccess(''), 3000);
    } catch (err: any) {
      setError(err.message || 'Error al actualizar el acompañante');
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    try {
      const { error } = await supabase
        .from('frequent_companions')
        .delete()
        .eq('id', id);

      if (error) throw error;

      setSuccess('Acompañante eliminado correctamente');
      setDeleteConfirmId(null);
      await loadCompanions();
      setTimeout(() => setSuccess(''), 3000);
    } catch (err: any) {
      setError(err.message || 'Error al eliminar el acompañante');
    }
  };

  const handleCancel = () => {
    setEditingId(null);
    setShowAddForm(false);
    setForm({ ...emptyForm });
    setError('');
  };

  const filteredCompanions = companions.filter(c => {
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase();
    const fullName = `${c.nombre} ${c.apellido || ''}`.toLowerCase();
    return (
      fullName.includes(q) ||
      c.email.toLowerCase().includes(q) ||
      (c.telefono && c.telefono.toLowerCase().includes(q))
    );
  });

  const formatDate = (dateStr: string) => {
    try {
      const [year, month, day] = dateStr.split('-');
      return `${day}/${month}/${year}`;
    } catch {
      return dateStr;
    }
  };

  const docLabel = (tipo?: string) => tipo === 'pasaporte' ? 'Pasaporte' : tipo === 'curp' ? 'CURP' : '';

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-primary-600"></div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 py-8">
      <div className="max-w-4xl mx-auto px-4">
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center">
            <Users className="w-7 h-7 text-primary-600 mr-3" />
            <div>
              <h1 className="text-2xl font-bold text-gray-900">Acompañantes Frecuentes</h1>
              <p className="text-sm text-gray-500 mt-0.5">
                {companions.length} acompañante{companions.length !== 1 ? 's' : ''} guardado{companions.length !== 1 ? 's' : ''}
              </p>
            </div>
          </div>
          <Link to="/traveler/dashboard" className="text-sm text-gray-500 hover:text-gray-700">
            Volver al panel
          </Link>
        </div>

        {success && (
          <div className="bg-green-50 border border-green-200 rounded-lg p-3 mb-4 flex items-center">
            <Save className="h-4 w-4 text-green-600 mr-2 flex-shrink-0" />
            <p className="text-sm text-green-800">{success}</p>
          </div>
        )}

        {error && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-3 mb-4 flex items-center">
            <AlertCircle className="h-4 w-4 text-red-600 mr-2 flex-shrink-0" />
            <p className="text-sm text-red-800">{error}</p>
          </div>
        )}

        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6 mb-6">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 mb-6">
            <div className="relative w-full sm:w-72">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
              <input
                type="text"
                placeholder="Buscar por nombre, email..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="input pl-10 w-full"
              />
            </div>
            {!showAddForm && !editingId && (
              <button
                onClick={() => { setShowAddForm(true); setForm({ ...emptyForm }); setError(''); }}
                className="btn btn-primary flex items-center whitespace-nowrap"
              >
                <Plus className="h-4 w-4 mr-2" />
                Agregar Acompañante
              </button>
            )}
          </div>

          {(showAddForm || editingId) && (
            <div className="bg-gray-50 border border-gray-200 rounded-lg p-5 mb-6">
              <h3 className="font-semibold text-gray-900 mb-4 flex items-center">
                <UserPlus className="h-5 w-5 mr-2 text-primary-600" />
                {editingId ? 'Editar Acompañante' : 'Nuevo Acompañante'}
              </h3>

              {/* Datos personales */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Nombre(s) *
                  </label>
                  <input
                    type="text"
                    value={form.nombre}
                    onChange={(e) => setForm({ ...form, nombre: e.target.value })}
                    className="input"
                    placeholder="Nombre(s)"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Apellidos *
                  </label>
                  <input
                    type="text"
                    value={form.apellido}
                    onChange={(e) => setForm({ ...form, apellido: e.target.value })}
                    className="input"
                    placeholder="Apellido paterno y materno"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Fecha de Nacimiento *
                  </label>
                  <input
                    type="date"
                    value={form.fecha_nacimiento}
                    onChange={(e) => setForm({ ...form, fecha_nacimiento: e.target.value })}
                    className="input"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Email *
                  </label>
                  <input
                    type="email"
                    value={form.email}
                    onChange={(e) => setForm({ ...form, email: e.target.value })}
                    className="input"
                    placeholder="correo@ejemplo.com"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Teléfono
                  </label>
                  <input
                    type="tel"
                    value={form.telefono}
                    onChange={(e) => setForm({ ...form, telefono: e.target.value })}
                    className="input"
                    placeholder="+52 123 456 7890"
                  />
                </div>
              </div>

              {/* Documento de identificación */}
              <div className="mt-5 border border-blue-200 rounded-lg bg-blue-50 p-4">
                <div className="flex items-center gap-2 mb-3">
                  <Shield className="w-4 h-4 text-blue-600 flex-shrink-0" />
                  <span className="text-sm font-semibold text-blue-800">Identificación *</span>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Tipo de documento *
                    </label>
                    <select
                      value={form.documento_tipo}
                      onChange={(e) => setForm({ ...form, documento_tipo: e.target.value as 'curp' | 'pasaporte' | '', documento_numero: '' })}
                      className="input"
                    >
                      <option value="">Seleccionar...</option>
                      <option value="curp">CURP (nacional)</option>
                      <option value="pasaporte">Pasaporte (extranjero)</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      {form.documento_tipo === 'pasaporte' ? 'Número de Pasaporte *' : 'CURP *'}
                    </label>
                    <input
                      type="text"
                      value={form.documento_numero}
                      onChange={(e) => setForm({ ...form, documento_numero: e.target.value.toUpperCase() })}
                      className="input uppercase"
                      placeholder={form.documento_tipo === 'pasaporte' ? 'A12345678' : form.documento_tipo === 'curp' ? 'ABCD123456HDFRRL09' : '—'}
                      maxLength={form.documento_tipo === 'pasaporte' ? 20 : 18}
                      disabled={!form.documento_tipo}
                    />
                  </div>
                </div>
              </div>

              {/* Contacto de emergencia (opcional) */}
              <div className="mt-4 border border-gray-200 rounded-lg bg-gray-50 p-4">
                <div className="flex items-center gap-2 mb-3">
                  <Phone className="w-4 h-4 text-gray-500 flex-shrink-0" />
                  <span className="text-sm font-semibold text-gray-700">Contacto de Emergencia</span>
                  <span className="text-xs text-gray-400">(opcional)</span>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Nombre del contacto
                    </label>
                    <input
                      type="text"
                      value={form.emergency_contact_name}
                      onChange={(e) => setForm({ ...form, emergency_contact_name: e.target.value })}
                      className="input"
                      placeholder="Nombre completo"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Teléfono del contacto
                    </label>
                    <input
                      type="tel"
                      value={form.emergency_contact_phone}
                      onChange={(e) => setForm({ ...form, emergency_contact_phone: e.target.value })}
                      className="input"
                      placeholder="+52 55 1234 5678"
                    />
                  </div>
                </div>
              </div>

              <div className="flex justify-end gap-3 mt-5">
                <button
                  onClick={handleCancel}
                  className="btn btn-outline flex items-center"
                  disabled={isSaving}
                >
                  <X className="h-4 w-4 mr-1" />
                  Cancelar
                </button>
                <button
                  onClick={editingId ? handleUpdate : handleAdd}
                  disabled={isSaving}
                  className="btn btn-primary flex items-center"
                >
                  {isSaving ? (
                    <>
                      <div className="animate-spin rounded-full h-4 w-4 border-t-2 border-b-2 border-white mr-2"></div>
                      Guardando...
                    </>
                  ) : (
                    <>
                      <Save className="h-4 w-4 mr-2" />
                      {editingId ? 'Guardar Cambios' : 'Agregar'}
                    </>
                  )}
                </button>
              </div>
            </div>
          )}

          {filteredCompanions.length === 0 ? (
            <div className="text-center py-12">
              <Users className="h-12 w-12 text-gray-300 mx-auto mb-4" />
              {companions.length === 0 ? (
                <>
                  <p className="text-gray-500 font-medium">No tienes acompañantes frecuentes guardados</p>
                  <p className="text-sm text-gray-400 mt-1">
                    Agrega acompañantes para autocompletar sus datos al reservar tours
                  </p>
                </>
              ) : (
                <p className="text-gray-500">No se encontraron resultados para "{searchQuery}"</p>
              )}
            </div>
          ) : (
            <div className="space-y-3">
              {filteredCompanions.map((companion) => (
                <div
                  key={companion.id}
                  className={`border rounded-lg p-4 transition-all ${
                    editingId === companion.id
                      ? 'border-primary-300 bg-primary-50/30'
                      : 'border-gray-200 hover:border-gray-300'
                  }`}
                >
                  <div className="flex items-start justify-between">
                    <div className="flex items-start gap-4 flex-1 min-w-0">
                      <div className="w-10 h-10 rounded-full bg-primary-100 flex items-center justify-center flex-shrink-0">
                        <span className="text-primary-700 font-semibold text-sm">
                          {companion.nombre.charAt(0).toUpperCase()}
                        </span>
                      </div>
                      <div className="min-w-0 flex-1">
                        <h4 className="font-semibold text-gray-900 truncate">
                          {companion.nombre}{companion.apellido ? ` ${companion.apellido}` : ''}
                        </h4>
                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-x-6 gap-y-1 mt-1.5">
                          <div className="text-sm text-gray-500 truncate">{companion.email}</div>
                          <div className="text-sm text-gray-500">
                            {formatDate(companion.fecha_nacimiento)}
                          </div>
                          <div className="text-sm text-gray-500">
                            {companion.telefono || 'Sin teléfono'}
                          </div>
                        </div>
                        {(companion.documento_tipo && companion.documento_numero) && (
                          <div className="mt-1.5 flex items-center gap-1.5">
                            <Shield className="w-3.5 h-3.5 text-blue-500 flex-shrink-0" />
                            <span className="text-xs text-blue-700 font-medium">
                              {docLabel(companion.documento_tipo)}:
                            </span>
                            <span className="text-xs text-gray-600 font-mono">
                              {companion.documento_numero}
                            </span>
                          </div>
                        )}
                        {companion.emergency_contact_name && (
                          <div className="mt-1 flex items-center gap-1.5">
                            <Phone className="w-3.5 h-3.5 text-gray-400 flex-shrink-0" />
                            <span className="text-xs text-gray-500">
                              Emergencia: {companion.emergency_contact_name}
                              {companion.emergency_contact_phone ? ` · ${companion.emergency_contact_phone}` : ''}
                            </span>
                          </div>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-1 ml-4 flex-shrink-0">
                      <button
                        onClick={() => handleEdit(companion)}
                        className="p-2 text-gray-400 hover:text-primary-600 hover:bg-primary-50 rounded-md transition-colors"
                        title="Editar"
                      >
                        <Edit className="h-4 w-4" />
                      </button>
                      {deleteConfirmId === companion.id ? (
                        <div className="flex items-center gap-1">
                          <button
                            onClick={() => handleDelete(companion.id)}
                            className="p-2 text-red-600 hover:bg-red-50 rounded-md transition-colors"
                            title="Confirmar eliminar"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                          <button
                            onClick={() => setDeleteConfirmId(null)}
                            className="p-2 text-gray-400 hover:bg-gray-100 rounded-md transition-colors"
                            title="Cancelar"
                          >
                            <X className="h-4 w-4" />
                          </button>
                        </div>
                      ) : (
                        <button
                          onClick={() => setDeleteConfirmId(companion.id)}
                          className="p-2 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-md transition-colors"
                          title="Eliminar"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
          <p className="text-sm text-blue-800">
            Los acompañantes frecuentes te permiten autocompletar los datos de tus viajeros al momento de hacer una reserva, ahorrando tiempo en el proceso.
          </p>
        </div>
      </div>
    </div>
  );
};

export default TravelerCompanions;
