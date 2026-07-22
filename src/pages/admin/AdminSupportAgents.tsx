import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { Headphones as HeadphonesIcon, ArrowLeft, Plus, CreditCard as Edit2, X, Save, Search, ToggleLeft, ToggleRight, Trash2 } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { SupportAgentPermission, SupportAgentRole } from '../../types';

const ROLE_OPTIONS: { value: SupportAgentRole; label: string; desc: string }[] = [
  { value: 'super_admin', label: 'Super Admin', desc: 'Configuracion, todos los tickets' },
  { value: 'supervisor', label: 'Supervisor', desc: 'Ver todos, asignar y reasignar' },
  { value: 'agente', label: 'Agente', desc: 'Ver y gestionar tickets asignados' },
  { value: 'lectura', label: 'Solo Lectura', desc: 'Consultar tickets sin modificar' },
];

const ROLE_BADGE: Record<SupportAgentRole, string> = {
  super_admin: 'bg-red-100 text-red-700',
  supervisor: 'bg-orange-100 text-orange-700',
  agente: 'bg-blue-100 text-blue-700',
  lectura: 'bg-gray-100 text-gray-600',
};

interface AdminUser { id: string; first_name: string; last_name: string; email: string; }

const AdminSupportAgents: React.FC = () => {
  const [agents, setAgents] = useState<(SupportAgentPermission & { user?: AdminUser })[]>([]);
  const [adminUsers, setAdminUsers] = useState<AdminUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState<{ open: boolean; editing: SupportAgentPermission | null }>({ open: false, editing: null });
  const [selectedUserId, setSelectedUserId] = useState('');
  const [selectedRole, setSelectedRole] = useState<SupportAgentRole>('agente');
  const [userSearch, setUserSearch] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    const { data: permsData } = await supabase
      .from('support_agent_permissions')
      .select(`*, user:users!support_agent_permissions_user_id_fkey(id, first_name, last_name, email)`)
      .order('created_at', { ascending: false });

    const existingUserIds = new Set((permsData ?? []).map((p: any) => p.user_id));

    const { data: admins } = await supabase
      .from('users')
      .select('id, first_name, last_name, email')
      .eq('role', 'admin')
      .order('first_name');

    setAgents(permsData ?? []);
    setAdminUsers((admins ?? []).filter(u => !existingUserIds.has(u.id)));
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const openModal = (agent?: SupportAgentPermission) => {
    setModal({ open: true, editing: agent ?? null });
    if (agent) {
      setSelectedUserId(agent.user_id);
      setSelectedRole(agent.rol_soporte);
    } else {
      setSelectedUserId('');
      setSelectedRole('agente');
    }
    setError(null);
  };

  const save = async () => {
    if (!modal.editing && !selectedUserId) { setError('Selecciona un usuario.'); return; }
    setSaving(true); setError(null);
    if (modal.editing) {
      await supabase.from('support_agent_permissions').update({ rol_soporte: selectedRole }).eq('id', modal.editing.id);
    } else {
      await supabase.from('support_agent_permissions').insert({ user_id: selectedUserId, rol_soporte: selectedRole });
    }
    await load();
    setModal({ open: false, editing: null });
    setSaving(false);
  };

  const toggleActive = async (agent: SupportAgentPermission) => {
    await supabase.from('support_agent_permissions').update({ activo: !agent.activo }).eq('id', agent.id);
    await load();
  };

  const deleteAgent = async (agent: SupportAgentPermission) => {
    if (!confirm('¿Quitar el rol de soporte a este usuario?')) return;
    await supabase.from('support_agent_permissions').delete().eq('id', agent.id);
    await load();
  };

  const filteredAdmins = adminUsers.filter(u =>
    !userSearch ||
    `${u.first_name} ${u.last_name}`.toLowerCase().includes(userSearch.toLowerCase()) ||
    u.email.toLowerCase().includes(userSearch.toLowerCase())
  );

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="bg-white border-b border-gray-200">
        <div className="container-custom py-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Link to="/admin/service-desk" className="text-gray-400 hover:text-gray-600">
                <ArrowLeft className="h-5 w-5" />
              </Link>
              <div className="w-10 h-10 bg-primary-100 rounded-xl flex items-center justify-center">
                <HeadphonesIcon className="h-5 w-5 text-primary-600" />
              </div>
              <div>
                <h1 className="text-xl font-bold text-gray-900">Agentes de Soporte</h1>
                <p className="text-sm text-gray-500">{agents.length} agentes registrados</p>
              </div>
            </div>
            <button onClick={() => openModal()} className="btn btn-primary flex items-center gap-2">
              <Plus className="h-4 w-4" /> Agregar Agente
            </button>
          </div>
        </div>
      </div>

      <div className="container-custom py-6 max-w-3xl">
        {loading ? (
          <div className="flex justify-center py-16">
            <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-primary-600" />
          </div>
        ) : agents.length === 0 ? (
          <div className="text-center py-16 bg-white rounded-xl border border-gray-200">
            <HeadphonesIcon className="mx-auto h-12 w-12 text-gray-300 mb-3" />
            <p className="text-gray-500 mb-4">No hay agentes de soporte configurados.</p>
            <button onClick={() => openModal()} className="btn btn-primary">Agregar primer agente</button>
          </div>
        ) : (
          <div className="bg-white rounded-xl border border-gray-200 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-200">
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">Usuario</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">Rol de Soporte</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">Estado</th>
                  <th className="px-4 py-3"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {agents.map(agent => (
                  <tr key={agent.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3">
                      <p className="font-medium text-gray-800">
                        {(agent.user as any)?.first_name} {(agent.user as any)?.last_name}
                      </p>
                      <p className="text-xs text-gray-400">{(agent.user as any)?.email}</p>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${ROLE_BADGE[agent.rol_soporte]}`}>
                        {ROLE_OPTIONS.find(r => r.value === agent.rol_soporte)?.label ?? agent.rol_soporte}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`text-xs font-medium ${agent.activo ? 'text-green-600' : 'text-gray-400'}`}>
                        {agent.activo ? 'Activo' : 'Inactivo'}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1 justify-end">
                        <button onClick={() => openModal(agent)} className="p-1.5 rounded text-gray-400 hover:text-primary-600 hover:bg-primary-50">
                          <Edit2 className="h-4 w-4" />
                        </button>
                        <button onClick={() => toggleActive(agent)} className={`p-1.5 rounded transition-colors ${agent.activo ? 'text-green-500 hover:bg-green-50' : 'text-gray-300 hover:bg-gray-50'}`}>
                          {agent.activo ? <ToggleRight className="h-5 w-5" /> : <ToggleLeft className="h-5 w-5" />}
                        </button>
                        <button onClick={() => deleteAgent(agent)} className="p-1.5 rounded text-gray-400 hover:text-red-500 hover:bg-red-50">
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Role descriptions */}
        <div className="mt-6 bg-white rounded-xl border border-gray-200 p-5">
          <h3 className="text-sm font-semibold text-gray-700 mb-3">Descripcion de roles</h3>
          <div className="space-y-2">
            {ROLE_OPTIONS.map(role => (
              <div key={role.value} className="flex items-center gap-3">
                <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${ROLE_BADGE[role.value]}`}>{role.label}</span>
                <span className="text-sm text-gray-500">{role.desc}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Modal */}
      {modal.open && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md">
            <div className="flex items-center justify-between p-5 border-b border-gray-200">
              <h2 className="text-lg font-bold text-gray-900">
                {modal.editing ? 'Editar Agente' : 'Agregar Agente'}
              </h2>
              <button onClick={() => setModal({ open: false, editing: null })} className="text-gray-400 hover:text-gray-600">
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="p-5 space-y-4">
              {!modal.editing && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Usuario admin <span className="text-red-500">*</span>
                  </label>
                  <div className="relative mb-2">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                    <input
                      type="text"
                      placeholder="Buscar por nombre o correo..."
                      value={userSearch}
                      onChange={e => setUserSearch(e.target.value)}
                      className="input pl-9"
                    />
                  </div>
                  <select value={selectedUserId} onChange={e => setSelectedUserId(e.target.value)} className="input">
                    <option value="">Selecciona un usuario</option>
                    {filteredAdmins.map(u => (
                      <option key={u.id} value={u.id}>{u.first_name} {u.last_name} — {u.email}</option>
                    ))}
                  </select>
                  {adminUsers.length === 0 && (
                    <p className="text-xs text-gray-400 mt-1">Todos los usuarios admin ya tienen un rol de soporte asignado.</p>
                  )}
                </div>
              )}
              {modal.editing && (
                <div className="bg-gray-50 rounded-lg p-3">
                  <p className="text-sm font-medium text-gray-800">
                    {(modal.editing as any).user?.first_name} {(modal.editing as any).user?.last_name}
                  </p>
                  <p className="text-xs text-gray-400">{(modal.editing as any).user?.email}</p>
                </div>
              )}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Rol de soporte <span className="text-red-500">*</span></label>
                <div className="space-y-2">
                  {ROLE_OPTIONS.map(role => (
                    <label key={role.value} className={`flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${
                      selectedRole === role.value ? 'border-primary-400 bg-primary-50' : 'border-gray-200 hover:border-gray-300'
                    }`}>
                      <input type="radio" name="role" value={role.value} checked={selectedRole === role.value} onChange={() => setSelectedRole(role.value)} className="mt-0.5 text-primary-600" />
                      <div>
                        <p className="text-sm font-medium text-gray-800">{role.label}</p>
                        <p className="text-xs text-gray-500">{role.desc}</p>
                      </div>
                    </label>
                  ))}
                </div>
              </div>
              {error && <p className="text-sm text-red-600">{error}</p>}
            </div>
            <div className="flex gap-3 p-5 border-t border-gray-200">
              <button onClick={() => setModal({ open: false, editing: null })} className="btn btn-secondary flex-1">Cancelar</button>
              <button onClick={save} disabled={saving} className="btn btn-primary flex-1 flex items-center justify-center gap-2">
                {saving ? <span className="animate-spin h-4 w-4 border-t-2 border-white rounded-full" /> : <Save className="h-4 w-4" />}
                Guardar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default AdminSupportAgents;
