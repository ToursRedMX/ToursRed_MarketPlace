import React, { useState, useEffect, useCallback } from 'react';
import {
  Users, Plus, CreditCard as Edit2, UserCheck, UserX, DollarSign,
  Search, X, CheckCircle, AlertCircle, Eye, EyeOff,
  ArrowRightLeft, Zap, KeyRound, RefreshCw
} from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../context/AuthContext';
import { formatCurrencyMXN } from '../../utils/formatCurrency';

interface Executive {
  id: string;
  user_id: string | null;
  first_name: string;
  last_name: string;
  email: string;
  phone: string | null;
  is_active: boolean;
  notes: string | null;
  hired_at: string;
  terminated_at: string | null;
  created_at: string;
  facturapi_configured?: boolean;
  facturapi_organization_id?: string | null;
  facturapi_configured_at?: string | null;
  _agencies_count?: number;
  _pending_commissions?: number;
  _paid_commissions?: number;
}

const EMPTY_FORM = { first_name: '', last_name: '', email: '', phone: '', notes: '', password: '' };

export default function AdminEjecutivos() {
  const { isSuperAdmin, permissions } = useAuth();
  const canManage = isSuperAdmin || permissions?.canManageExecutives;

  const [executives, setExecutives] = useState<Executive[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [editingExec, setEditingExec] = useState<Executive | null>(null);
  const [modalTab, setModalTab] = useState<'info' | 'facturapi'>('info');
  const [form, setForm] = useState({ ...EMPTY_FORM });
  const [isSaving, setIsSaving] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [reassignModal, setReassignModal] = useState<Executive | null>(null);
  const [reassignTarget, setReassignTarget] = useState('');
  const [selectedAgencies, setSelectedAgencies] = useState<string[]>([]);
  const [executiveAgencies, setExecutiveAgencies] = useState<any[]>([]);
  const [isReassigning, setIsReassigning] = useState(false);

  // FacturAPI admin config
  const [facturApiKey, setFacturApiKey] = useState('');
  const [facturOrgId, setFacturOrgId] = useState('');
  const [showAdminApiKey, setShowAdminApiKey] = useState(false);
  const [isVerifyingFacturapi, setIsVerifyingFacturapi] = useState(false);

  const loadExecutives = useCallback(async () => {
    setIsLoading(true);
    try {
      const { data: execs } = await supabase
        .from('account_executives_safe')
        .select('id, user_id, first_name, last_name, email, phone, is_active, notes, hired_at, terminated_at, created_at, facturapi_configured, facturapi_organization_id, facturapi_configured_at')
        .order('created_at', { ascending: false });

      if (!execs) { setExecutives([]); return; }

      const execIds = execs.map(e => e.id);
      const [agenciesRes, commissionsRes] = await Promise.all([
        supabase.from('agencies').select('account_executive_id').in('account_executive_id', execIds),
        supabase.from('executive_commissions').select('executive_id, amount, status').in('executive_id', execIds),
      ]);

      const agencyCount: Record<string, number> = {};
      (agenciesRes.data || []).forEach((a: any) => { agencyCount[a.account_executive_id] = (agencyCount[a.account_executive_id] || 0) + 1; });

      const pendingComm: Record<string, number> = {};
      const paidComm: Record<string, number> = {};
      (commissionsRes.data || []).forEach((c: any) => {
        if (['pending', 'invoiced', 'approved'].includes(c.status)) pendingComm[c.executive_id] = (pendingComm[c.executive_id] || 0) + Number(c.amount);
        else if (c.status === 'paid') paidComm[c.executive_id] = (paidComm[c.executive_id] || 0) + Number(c.amount);
      });

      setExecutives(execs.map(e => ({ ...e, _agencies_count: agencyCount[e.id] || 0, _pending_commissions: pendingComm[e.id] || 0, _paid_commissions: paidComm[e.id] || 0 })));
    } finally { setIsLoading(false); }
  }, []);

  useEffect(() => { loadExecutives(); }, [loadExecutives]);

  const openCreate = () => {
    setEditingExec(null);
    setForm({ ...EMPTY_FORM });
    setModalTab('info');
    setFacturApiKey('');
    setFacturOrgId('');
    setShowModal(true);
  };

  const openEdit = (exec: Executive) => {
    setEditingExec(exec);
    setForm({ first_name: exec.first_name, last_name: exec.last_name, email: exec.email, phone: exec.phone || '', notes: exec.notes || '', password: '' });
    setModalTab('info');
    setFacturApiKey('');
    setFacturOrgId(exec.facturapi_organization_id || '');
    setShowModal(true);
  };

  const saveExecutive = async () => {
    if (!form.first_name || !form.email) { setMessage({ type: 'error', text: 'Nombre y email son requeridos.' }); return; }
    setIsSaving(true);
    try {
      if (editingExec) {
        const { error } = await supabase.from('account_executives').update({
          first_name: form.first_name, last_name: form.last_name,
          phone: form.phone || null, notes: form.notes || null, updated_at: new Date().toISOString(),
        }).eq('id', editingExec.id);
        if (error) throw error;
      } else {
        if (!form.password || form.password.length < 6) throw new Error('La contraseña debe tener al menos 6 caracteres.');
        const { data: { session } } = await supabase.auth.getSession();
        if (!session) throw new Error('Sesión expirada. Vuelve a iniciar sesión.');
        const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/create-executive-user`, {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${session.access_token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: form.email, password: form.password, first_name: form.first_name, last_name: form.last_name, phone: form.phone || null, notes: form.notes || null }),
        });
        const result = await res.json();
        if (!res.ok) throw new Error(result.error || 'Error al crear el ejecutivo.');
      }
      setMessage({ type: 'success', text: editingExec ? 'Ejecutivo actualizado.' : 'Ejecutivo creado y credenciales enviadas.' });
      setShowModal(false);
      loadExecutives();
    } catch (e: any) {
      setMessage({ type: 'error', text: e.message || 'Error al guardar.' });
    } finally { setIsSaving(false); }
  };

  const verifyAndSaveFacturapi = async () => {
    if (!editingExec || !facturApiKey.trim()) { setMessage({ type: 'error', text: 'Ingresa el API Key de FacturAPI.' }); return; }
    setIsVerifyingFacturapi(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error('Sesión expirada.');
      const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/verify-executive-facturapi`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${session.access_token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ executive_id: editingExec.id, api_key: facturApiKey.trim(), organization_id: facturOrgId.trim() || null }),
      });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error || 'Error al verificar.');
      setMessage({ type: 'success', text: 'FacturAPI configurado y verificado correctamente.' });
      setFacturApiKey('');
      loadExecutives();
    } catch (e: any) {
      setMessage({ type: 'error', text: e.message || 'Error al verificar con FacturAPI.' });
    } finally { setIsVerifyingFacturapi(false); }
  };

  const toggleActive = async (exec: Executive) => {
    await supabase.from('account_executives').update({ is_active: !exec.is_active }).eq('id', exec.id);
    loadExecutives();
  };

  const openReassign = async (exec: Executive) => {
    setReassignModal(exec);
    setSelectedAgencies([]);
    setReassignTarget('');
    const { data } = await supabase.from('agencies').select('id, name, is_approved, registered_by_executive').eq('account_executive_id', exec.id).order('name');
    setExecutiveAgencies(data || []);
  };

  const doReassign = async () => {
    if (!reassignTarget || selectedAgencies.length === 0) { setMessage({ type: 'error', text: 'Selecciona agencias y el ejecutivo destino.' }); return; }
    setIsReassigning(true);
    try {
      const { error } = await supabase.from('agencies').update({ account_executive_id: reassignTarget }).in('id', selectedAgencies);
      if (error) throw error;
      setMessage({ type: 'success', text: `${selectedAgencies.length} agencia(s) reasignada(s) exitosamente.` });
      setReassignModal(null);
      loadExecutives();
    } catch (e: any) {
      setMessage({ type: 'error', text: e.message || 'Error al reasignar.' });
    } finally { setIsReassigning(false); }
  };

  const filtered = executives.filter(e =>
    !search || `${e.first_name} ${e.last_name}`.toLowerCase().includes(search.toLowerCase()) || e.email.toLowerCase().includes(search.toLowerCase())
  );

  const otherExecs = executives.filter(e => e.id !== reassignModal?.id && e.is_active);

  return (
    <div className="max-w-7xl mx-auto px-4 py-8 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Ejecutivos de Cuenta</h1>
          <p className="text-gray-500 mt-1">Gestión del equipo de onboarding de agencias</p>
        </div>
        {canManage && (
          <div className="flex gap-3">
            <a href="/admin/ejecutivos/comisiones" className="flex items-center gap-2 border border-gray-300 text-gray-700 px-4 py-2 rounded-lg hover:bg-gray-50 transition-colors text-sm font-medium">
              <DollarSign className="h-4 w-4" /> Pagos de comisiones
            </a>
            <a href="/admin/ejecutivos/configuracion" className="flex items-center gap-2 border border-gray-300 text-gray-700 px-4 py-2 rounded-lg hover:bg-gray-50 transition-colors text-sm font-medium">Configuración</a>
            <button onClick={openCreate} className="flex items-center gap-2 bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 transition-colors text-sm font-medium">
              <Plus className="h-4 w-4" /> Nuevo ejecutivo
            </button>
          </div>
        )}
      </div>

      {message && (
        <div className={`rounded-lg px-4 py-3 text-sm flex items-center gap-2 ${message.type === 'success' ? 'bg-green-50 text-green-700 border border-green-200' : 'bg-red-50 text-red-700 border border-red-200'}`}>
          {message.type === 'success' ? <CheckCircle className="h-4 w-4 shrink-0" /> : <AlertCircle className="h-4 w-4 shrink-0" />}
          {message.text}
          <button onClick={() => setMessage(null)} className="ml-auto"><X className="h-4 w-4" /></button>
        </div>
      )}

      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Buscar ejecutivo..." className="w-full pl-9 pr-4 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {isLoading ? (
          <div className="col-span-3 flex justify-center py-16"><div className="w-6 h-6 border-4 border-blue-600 border-t-transparent rounded-full animate-spin" /></div>
        ) : filtered.length === 0 ? (
          <div className="col-span-3 text-center py-16 text-gray-400"><Users className="h-10 w-10 mx-auto mb-3 text-gray-300" /><p>No hay ejecutivos registrados</p></div>
        ) : (
          filtered.map(exec => (
            <div key={exec.id} className={`bg-white rounded-xl border p-5 space-y-4 ${exec.is_active ? 'border-gray-200' : 'border-gray-100 opacity-60'}`}>
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-blue-100 rounded-full flex items-center justify-center shrink-0">
                    <span className="text-blue-700 font-semibold text-sm">{exec.first_name[0]}{exec.last_name[0]}</span>
                  </div>
                  <div>
                    <p className="font-semibold text-gray-900">{exec.first_name} {exec.last_name}</p>
                    <p className="text-xs text-gray-400">{exec.email}</p>
                  </div>
                </div>
                <div className="flex flex-col items-end gap-1">
                  {exec.is_active
                    ? <span className="text-xs text-green-700 bg-green-100 px-2 py-0.5 rounded-full">Activo</span>
                    : <span className="text-xs text-gray-500 bg-gray-100 px-2 py-0.5 rounded-full">Inactivo</span>}
                  {exec.facturapi_configured && (
                    <span className="text-xs text-violet-700 bg-violet-100 px-2 py-0.5 rounded-full flex items-center gap-1">
                      <Zap className="h-3 w-3" /> FacturAPI
                    </span>
                  )}
                </div>
              </div>
              <div className="grid grid-cols-3 gap-2 text-center border-t border-gray-100 pt-4">
                <div><p className="text-xl font-bold text-gray-900">{exec._agencies_count}</p><p className="text-xs text-gray-400">Agencias</p></div>
                <div><p className="text-sm font-bold text-amber-600">{formatCurrencyMXN(exec._pending_commissions || 0)}</p><p className="text-xs text-gray-400">Pendiente</p></div>
                <div><p className="text-sm font-bold text-green-600">{formatCurrencyMXN(exec._paid_commissions || 0)}</p><p className="text-xs text-gray-400">Pagado</p></div>
              </div>
              {canManage && (
                <div className="flex gap-2 pt-1">
                  <button onClick={() => openEdit(exec)} className="flex-1 flex items-center justify-center gap-1.5 text-xs text-gray-600 border border-gray-200 rounded-lg py-1.5 hover:bg-gray-50 transition-colors">
                    <Edit2 className="h-3.5 w-3.5" /> Editar
                  </button>
                  <button onClick={() => openReassign(exec)} className="flex-1 flex items-center justify-center gap-1.5 text-xs text-blue-600 border border-blue-200 rounded-lg py-1.5 hover:bg-blue-50 transition-colors">
                    <ArrowRightLeft className="h-3.5 w-3.5" /> Reasignar
                  </button>
                  <button onClick={() => toggleActive(exec)} className={`flex-1 flex items-center justify-center gap-1.5 text-xs rounded-lg py-1.5 transition-colors ${exec.is_active ? 'text-red-600 border border-red-200 hover:bg-red-50' : 'text-green-600 border border-green-200 hover:bg-green-50'}`}>
                    {exec.is_active ? <UserX className="h-3.5 w-3.5" /> : <UserCheck className="h-3.5 w-3.5" />}
                    {exec.is_active ? 'Desactivar' : 'Activar'}
                  </button>
                </div>
              )}
            </div>
          ))
        )}
      </div>

      {/* Modal Crear/Editar */}
      {showModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md">
            <div className="p-6 pb-0">
              <h2 className="text-lg font-semibold text-gray-900 mb-4">{editingExec ? 'Editar ejecutivo' : 'Nuevo ejecutivo de cuenta'}</h2>
              {editingExec && (
                <div className="flex border-b border-gray-200 mb-5 -mx-6 px-6 gap-1">
                  <button onClick={() => setModalTab('info')} className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${modalTab === 'info' ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-500 hover:text-gray-700'}`}>Información</button>
                  <button onClick={() => setModalTab('facturapi')} className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors flex items-center gap-1.5 ${modalTab === 'facturapi' ? 'border-violet-600 text-violet-600' : 'border-transparent text-gray-500 hover:text-gray-700'}`}>
                    <Zap className="h-3.5 w-3.5" /> Facturación
                    {editingExec.facturapi_configured && <span className="w-2 h-2 rounded-full bg-green-500" />}
                  </button>
                </div>
              )}
            </div>

            {(!editingExec || modalTab === 'info') && (
              <div className="px-6 pb-0 space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1.5">Nombre *</label>
                    <input value={form.first_name} onChange={e => setForm(f => ({ ...f, first_name: e.target.value }))} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1.5">Apellido</label>
                    <input value={form.last_name} onChange={e => setForm(f => ({ ...f, last_name: e.target.value }))} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1.5">Email *</label>
                  <input type="email" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} disabled={!!editingExec} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-50" />
                </div>
                {!editingExec && (
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1.5">Contraseña temporal *</label>
                    <input type="text" value={form.password} onChange={e => setForm(f => ({ ...f, password: e.target.value }))} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" placeholder="Mínimo 6 caracteres" />
                  </div>
                )}
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1.5">Teléfono</label>
                  <input value={form.phone} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1.5">Notas internas</label>
                  <textarea rows={2} value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none" />
                </div>
              </div>
            )}

            {editingExec && modalTab === 'facturapi' && (
              <div className="px-6 pb-0 space-y-4">
                {editingExec.facturapi_configured && (
                  <div className="bg-green-50 border border-green-200 rounded-lg px-4 py-3 flex items-center gap-3">
                    <CheckCircle className="h-4 w-4 text-green-600 shrink-0" />
                    <div>
                      <p className="text-sm font-medium text-green-800">FacturAPI configurado</p>
                      <p className="text-xs text-green-600 mt-0.5">
                        {editingExec.facturapi_configured_at ? new Date(editingExec.facturapi_configured_at).toLocaleDateString('es-MX', { day: 'numeric', month: 'long', year: 'numeric' }) : ''}
                        {editingExec.facturapi_organization_id && ` · Org: ${editingExec.facturapi_organization_id}`}
                      </p>
                    </div>
                  </div>
                )}
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1.5"><span className="flex items-center gap-1"><KeyRound className="h-3 w-3" /> API Key de FacturAPI *</span></label>
                  <div className="relative">
                    <input
                      type={showAdminApiKey ? 'text' : 'password'}
                      value={facturApiKey}
                      onChange={e => setFacturApiKey(e.target.value)}
                      className="w-full border border-gray-300 rounded-lg pl-3 pr-10 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-violet-500"
                      placeholder={editingExec.facturapi_configured ? '••••••••• (introduce para actualizar)' : 'sk_live_...'}
                    />
                    <button type="button" onClick={() => setShowAdminApiKey(v => !v)} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
                      {showAdminApiKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1.5">Organization ID (opcional)</label>
                  <input value={facturOrgId} onChange={e => setFacturOrgId(e.target.value)} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-violet-500" placeholder="Requerido si hay múltiples organizaciones" />
                </div>
                <p className="text-xs text-gray-400">El API Key se guarda de forma segura y nunca se muestra de nuevo.</p>
              </div>
            )}

            <div className="px-6 py-5 flex justify-end gap-3">
              <button onClick={() => setShowModal(false)} className="px-4 py-2 text-sm text-gray-600">Cancelar</button>
              {(!editingExec || modalTab === 'info') && (
                <button onClick={saveExecutive} disabled={isSaving} className="px-5 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50">
                  {isSaving ? 'Guardando...' : (editingExec ? 'Actualizar' : 'Crear ejecutivo')}
                </button>
              )}
              {editingExec && modalTab === 'facturapi' && (
                <button onClick={verifyAndSaveFacturapi} disabled={isVerifyingFacturapi || !facturApiKey.trim()} className="flex items-center gap-2 px-5 py-2 bg-violet-600 text-white rounded-lg text-sm font-medium hover:bg-violet-700 disabled:opacity-50">
                  {isVerifyingFacturapi ? <><RefreshCw className="h-4 w-4 animate-spin" /> Verificando...</> : <><CheckCircle className="h-4 w-4" /> {editingExec.facturapi_configured ? 'Actualizar' : 'Verificar y guardar'}</>}
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Modal Reasignar */}
      {reassignModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
            <div className="sticky top-0 bg-white border-b border-gray-100 px-6 py-4 flex items-center justify-between">
              <h2 className="text-lg font-semibold text-gray-900">Reasignar agencias de {reassignModal.first_name}</h2>
              <button onClick={() => setReassignModal(null)}><X className="h-5 w-5 text-gray-400" /></button>
            </div>
            <div className="p-6 space-y-5">
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-2">Ejecutivo destino *</label>
                <select value={reassignTarget} onChange={e => setReassignTarget(e.target.value)} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                  <option value="">Seleccionar ejecutivo...</option>
                  {otherExecs.map(e => <option key={e.id} value={e.id}>{e.first_name} {e.last_name}</option>)}
                </select>
              </div>
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="block text-xs font-medium text-gray-600">Agencias a reasignar</label>
                  <button onClick={() => setSelectedAgencies(selectedAgencies.length === executiveAgencies.length ? [] : executiveAgencies.map(a => a.id))} className="text-xs text-blue-600 hover:underline">
                    {selectedAgencies.length === executiveAgencies.length ? 'Deseleccionar todo' : 'Seleccionar todo'}
                  </button>
                </div>
                <div className="border border-gray-200 rounded-lg divide-y divide-gray-100 max-h-60 overflow-y-auto">
                  {executiveAgencies.length === 0 ? (
                    <p className="text-sm text-gray-400 text-center py-6">Sin agencias asignadas</p>
                  ) : (
                    executiveAgencies.map(agency => (
                      <label key={agency.id} className="flex items-center gap-3 px-4 py-3 hover:bg-gray-50 cursor-pointer">
                        <input type="checkbox" checked={selectedAgencies.includes(agency.id)} onChange={() => setSelectedAgencies(prev => prev.includes(agency.id) ? prev.filter(x => x !== agency.id) : [...prev, agency.id])} className="rounded text-blue-600" />
                        <div>
                          <p className="text-sm font-medium text-gray-900">{agency.name}</p>
                          <p className="text-xs text-gray-400">{agency.is_approved ? 'Aprobada' : 'Pendiente'} · {agency.registered_by_executive ? 'Por ejecutivo' : 'Auto-registro'}</p>
                        </div>
                      </label>
                    ))
                  )}
                </div>
              </div>
              <div className="bg-amber-50 border border-amber-200 rounded-lg p-3">
                <p className="text-xs text-amber-700">Las comisiones ya generadas para el ejecutivo actual se respetan. El nuevo ejecutivo comenzará a ganar comisiones solo a partir de la fecha de reasignación.</p>
              </div>
            </div>
            <div className="px-6 pb-6 flex justify-end gap-3">
              <button onClick={() => setReassignModal(null)} className="px-4 py-2 text-sm text-gray-600">Cancelar</button>
              <button onClick={doReassign} disabled={isReassigning || !reassignTarget || selectedAgencies.length === 0} className="px-5 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50">
                {isReassigning ? 'Reasignando...' : `Reasignar (${selectedAgencies.length})`}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
