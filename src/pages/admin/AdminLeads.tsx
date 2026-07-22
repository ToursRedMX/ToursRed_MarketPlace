import React, { useState, useEffect, useCallback } from 'react';
import { Search, X, CheckCircle, Clock, AlertCircle, Building2, MailCheck, Send, Loader2, MessageSquare, ChevronDown } from 'lucide-react';
import { supabase } from '../../lib/supabase';

type LeadStatus = 'prospecto' | 'contactado' | 'negociacion' | 'registrado' | 'aprobado' | 'perdido';

interface AgencyLead {
  id: string;
  executive_id: string;
  agency_name: string;
  contact_first_name: string;
  contact_last_name: string;
  contact_email: string;
  contact_phone: string | null;
  status: LeadStatus;
  notes: string;
  next_contact_date: string | null;
  probability: number;
  source: string;
  converted_agency_id: string | null;
  converted_at: string | null;
  follow_up_log: any[];
  created_at: string;
  updated_at: string;
  converted_agency_onboarding_status?: string | null;
  converted_agency_name?: string | null;
  executive_name?: string | null;
}

const STATUS_CONFIG: Record<LeadStatus, { label: string; color: string; bg: string }> = {
  prospecto: { label: 'Prospecto', color: 'text-gray-600', bg: 'bg-gray-100' },
  contactado: { label: 'Contactado', color: 'text-sky-700', bg: 'bg-sky-100' },
  negociacion: { label: 'Negociación', color: 'text-amber-700', bg: 'bg-amber-100' },
  registrado: { label: 'Registrado', color: 'text-blue-700', bg: 'bg-blue-100' },
  aprobado: { label: 'Aprobado', color: 'text-green-700', bg: 'bg-green-100' },
  perdido: { label: 'Perdido', color: 'text-red-700', bg: 'bg-red-100' },
};

export default function AdminLeads() {
  const [leads, setLeads] = useState<AgencyLead[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [execFilter, setExecFilter] = useState<string>('all');
  const [executives, setExecutives] = useState<{ id: string; name: string }[]>([]);
  const [fixEmailLead, setFixEmailLead] = useState<AgencyLead | null>(null);
  const [resendLead, setResendLead] = useState<AgencyLead | null>(null);
  const [fixEmailValue, setFixEmailValue] = useState('');
  const [actionLoading, setActionLoading] = useState(false);
  const [actionMessage, setActionMessage] = useState('');
  const [showFollowUp, setShowFollowUp] = useState<AgencyLead | null>(null);
  const [newNote, setNewNote] = useState('');

  const loadLeads = useCallback(async () => {
    setIsLoading(true);
    try {
      const { data } = await supabase
        .from('agency_leads')
        .select('*')
        .order('created_at', { ascending: false });

      const { data: execs } = await supabase
        .from('account_executives')
        .select('id, first_name, last_name')
        .eq('is_active', true);

      const execMap = new Map((execs || []).map(e => [e.id, `${e.first_name} ${e.last_name || ''}`.trim()]));
      setExecutives((execs || []).map(e => ({ id: e.id, name: `${e.first_name} ${e.last_name || ''}`.trim() })));

      const convertedIds = (data || []).filter(l => l.converted_agency_id).map(l => l.converted_agency_id);
      let agencyMap = new Map<string, { onboarding_status: string; name: string }>();
      if (convertedIds.length > 0) {
        const { data: agenciesData } = await supabase
          .from('agencies')
          .select('id, onboarding_status, name')
          .in('id', convertedIds);
        agencyMap = new Map((agenciesData || []).map(a => [a.id, { onboarding_status: a.onboarding_status, name: a.name }]));
      }

      const enriched = (data || []).map(l => ({
        ...l,
        converted_agency_onboarding_status: l.converted_agency_id ? agencyMap.get(l.converted_agency_id)?.onboarding_status || null : null,
        converted_agency_name: l.converted_agency_id ? agencyMap.get(l.converted_agency_id)?.name || null : null,
        executive_name: execMap.get(l.executive_id) || null,
      }));
      setLeads(enriched);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => { loadLeads(); }, [loadLeads]);

  const openFixEmail = (lead: AgencyLead) => {
    setFixEmailLead(lead);
    setFixEmailValue(lead.contact_email);
    setActionMessage('');
  };

  const handleFixEmail = async () => {
    if (!fixEmailLead?.converted_agency_id) return;
    const trimmed = fixEmailValue.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
      setActionMessage('Formato de correo inválido');
      return;
    }
    if (trimmed === fixEmailLead.contact_email.toLowerCase()) {
      setActionMessage('El correo es el mismo, no hay cambios');
      return;
    }
    setActionLoading(true);
    setActionMessage('');
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const resp = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/fix-agency-email`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ agencyId: fixEmailLead.converted_agency_id, newEmail: trimmed }),
      });
      const result = await resp.json();
      if (!resp.ok) throw new Error(result.error || 'Error al corregir el correo');
      setActionMessage('Correo corregido y credenciales reenviadas correctamente');
      setFixEmailLead(null);
      setFixEmailValue('');
      loadLeads();
    } catch (err: any) {
      setActionMessage(err.message || 'Error al corregir el correo');
    } finally {
      setActionLoading(false);
    }
  };

  const handleResendCredentials = async () => {
    if (!resendLead?.converted_agency_id) return;
    setActionLoading(true);
    setActionMessage('');
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error('Tu sesión ha expirado, vuelve a iniciar sesión');
      const resp = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/resend-agency-credentials`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ agencyId: resendLead.converted_agency_id }),
      });
      const result = await resp.json();
      if (!resp.ok) throw new Error(result.error || 'Error al reenviar credenciales');
      setActionMessage('Credenciales reenviadas correctamente');
      setResendLead(null);
    } catch (err: any) {
      setActionMessage(err.message || 'Error al reenviar credenciales');
    } finally {
      setActionLoading(false);
    }
  };

  const addFollowUpNote = async (lead: AgencyLead) => {
    if (!newNote.trim()) return;
    const log = Array.isArray(lead.follow_up_log) ? lead.follow_up_log : [];
    const updated = [...log, { date: new Date().toISOString(), note: newNote.trim() }];
    await supabase.from('agency_leads').update({ follow_up_log: updated }).eq('id', lead.id);
    setNewNote('');
    setShowFollowUp(null);
    loadLeads();
  };

  const filtered = leads.filter(l => {
    if (l.status === 'aprobado') return false;
    const matchSearch = !search ||
      l.agency_name.toLowerCase().includes(search.toLowerCase()) ||
      l.contact_email.toLowerCase().includes(search.toLowerCase()) ||
      `${l.contact_first_name} ${l.contact_last_name}`.toLowerCase().includes(search.toLowerCase());
    const matchStatus = statusFilter === 'all' || l.status === statusFilter;
    const matchExec = execFilter === 'all' || l.executive_id === execFilter;
    return matchSearch && matchStatus && matchExec;
  });

  const activeLeads = leads.filter(l => l.status !== 'aprobado');

  const statusCounts = activeLeads.reduce((acc, l) => {
    acc[l.status] = (acc[l.status] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  return (
    <div className="max-w-7xl mx-auto px-4 py-8 space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Pipeline Global de Leads</h1>
        <p className="text-gray-500 mt-1">Todos los leads de todos los ejecutivos de cuenta</p>
      </div>

      {/* Status Summary */}
      <div className="flex gap-2 flex-wrap">
        <button
          onClick={() => setStatusFilter('all')}
          className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${statusFilter === 'all' ? 'bg-gray-900 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
        >
          Todos ({activeLeads.length})
        </button>
        {Object.entries(STATUS_CONFIG).filter(([key]) => key !== 'aprobado').map(([key, cfg]) => (
          <button
            key={key}
            onClick={() => setStatusFilter(key)}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${statusFilter === key ? cfg.bg + ' ' + cfg.color + ' ring-1 ring-current' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
          >
            {cfg.label} ({statusCounts[key] || 0})
          </button>
        ))}
      </div>

      {/* Search + Executive filter */}
      <div className="flex gap-3 flex-col sm:flex-row">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Buscar por nombre, email o contacto..."
            className="w-full pl-9 pr-4 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
        <select
          value={execFilter}
          onChange={e => setExecFilter(e.target.value)}
          className="border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
        >
          <option value="all">Todos los ejecutivos</option>
          {executives.map(e => (
            <option key={e.id} value={e.id}>{e.name}</option>
          ))}
        </select>
      </div>

      {/* Table */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        {isLoading ? (
          <div className="flex items-center justify-center py-16">
            <div className="w-6 h-6 border-4 border-blue-600 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-16 text-gray-400">
            <Building2 className="h-10 w-10 mx-auto mb-3 text-gray-300" />
            <p>No se encontraron leads</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  {['Agencia', 'Contacto', 'Ejecutivo', 'Estado', 'Próximo contacto', 'Probabilidad', 'Acciones'].map(h => (
                    <th key={h} className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {filtered.map(lead => {
                  const cfg = STATUS_CONFIG[lead.status];
                  return (
                    <tr key={lead.id} className="hover:bg-gray-50 transition-colors">
                      <td className="px-4 py-3">
                        <p className="font-medium text-gray-900 text-sm">{lead.agency_name}</p>
                        {lead.rfc && <p className="text-xs text-gray-400">{lead.rfc}</p>}
                      </td>
                      <td className="px-4 py-3">
                        <p className="text-sm text-gray-900">{lead.contact_first_name} {lead.contact_last_name}</p>
                        <p className="text-xs text-gray-400">{lead.contact_email}</p>
                      </td>
                      <td className="px-4 py-3">
                        <p className="text-sm text-gray-700">{lead.executive_name || <span className="text-gray-300">—</span>}</p>
                      </td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium ${cfg.bg} ${cfg.color}`}>
                          {cfg.label}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <p className="text-sm text-gray-700">
                          {lead.next_contact_date
                            ? new Date(lead.next_contact_date).toLocaleDateString('es-MX')
                            : <span className="text-gray-300">—</span>
                          }
                        </p>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <div className="w-16 h-1.5 bg-gray-200 rounded-full overflow-hidden">
                            <div
                              className="h-full bg-blue-500 rounded-full"
                              style={{ width: `${lead.probability}%` }}
                            />
                          </div>
                          <span className="text-xs text-gray-500">{lead.probability}%</span>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => { setShowFollowUp(lead); setNewNote(''); }}
                            className="p-1.5 hover:bg-gray-100 rounded text-gray-500 hover:text-gray-700 transition-colors"
                            title="Notas de seguimiento"
                          >
                            <MessageSquare className="h-4 w-4" />
                          </button>
                          {lead.converted_agency_id && lead.converted_agency_onboarding_status !== 'active' && (
                            <>
                              <button
                                onClick={() => openFixEmail(lead)}
                                className="p-1.5 hover:bg-amber-50 rounded text-amber-600 hover:text-amber-700 transition-colors"
                                title="Corregir email"
                              >
                                <MailCheck className="h-4 w-4" />
                              </button>
                              <button
                                onClick={() => { setResendLead(lead); setActionMessage(''); }}
                                className="p-1.5 hover:bg-green-50 rounded text-green-600 hover:text-green-700 transition-colors"
                                title="Reenviar credenciales"
                              >
                                <Send className="h-4 w-4" />
                              </button>
                            </>
                          )}
                          {lead.converted_agency_id && lead.converted_agency_onboarding_status === 'active' && (
                            <span className="inline-flex items-center gap-1 text-xs text-green-600 font-medium">
                              <CheckCircle className="h-3.5 w-3.5" /> Aprobada
                            </span>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Follow Up Modal */}
      {showFollowUp && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-xl max-w-lg w-full p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-bold text-gray-900">Notas de seguimiento — {showFollowUp.agency_name}</h3>
              <button onClick={() => setShowFollowUp(null)} className="text-gray-400 hover:text-gray-600">
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="space-y-2 max-h-60 overflow-y-auto">
              {Array.isArray(showFollowUp.follow_up_log) && showFollowUp.follow_up_log.length > 0 ? (
                showFollowUp.follow_up_log.map((entry, i) => (
                  <div key={i} className="bg-gray-50 rounded-lg px-3 py-2 text-sm">
                    <p className="text-xs text-gray-400 mb-1">{new Date(entry.date).toLocaleString('es-MX')}</p>
                    <p className="text-gray-700">{entry.note}</p>
                  </div>
                ))
              ) : (
                <p className="text-sm text-gray-400 text-center py-4">Sin notas de seguimiento</p>
              )}
            </div>
            <div className="flex gap-2">
              <input
                value={newNote}
                onChange={e => setNewNote(e.target.value)}
                placeholder="Agregar nota..."
                className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                onKeyDown={e => { if (e.key === 'Enter') addFollowUpNote(showFollowUp); }}
              />
              <button
                onClick={() => addFollowUpNote(showFollowUp)}
                className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 transition-colors"
              >
                Agregar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Fix Email Modal */}
      {fixEmailLead && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-xl max-w-md w-full p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-bold text-gray-900 flex items-center gap-2">
                <MailCheck className="h-5 w-5 text-amber-600" /> Corregir correo
              </h3>
              <button onClick={() => setFixEmailLead(null)} className="text-gray-400 hover:text-gray-600">
                <X className="h-5 w-5" />
              </button>
            </div>
            <p className="text-sm text-gray-600">
              Agencia: <strong>{fixEmailLead.agency_name}</strong>
            </p>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1.5">Correo actual</label>
              <p className="text-sm text-gray-400">{fixEmailLead.contact_email}</p>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1.5">Nuevo correo *</label>
              <input
                type="email"
                value={fixEmailValue}
                onChange={e => setFixEmailValue(e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500"
                placeholder="nuevo@correo.com"
              />
            </div>
            <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-xs text-amber-700">
              Se anulara la contraseña anterior y se enviara una nueva contraseña temporal al correo corregido. La agencia debera cambiarla al iniciar sesion.
            </div>
            {actionMessage && (
              <p className="text-sm text-red-600">{actionMessage}</p>
            )}
            <div className="flex gap-3 justify-end">
              <button
                onClick={() => setFixEmailLead(null)}
                className="px-4 py-2 text-sm font-medium text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
              >
                Cancelar
              </button>
              <button
                onClick={handleFixEmail}
                disabled={actionLoading}
                className="px-4 py-2 text-sm font-medium text-white bg-amber-600 hover:bg-amber-700 rounded-lg transition-colors disabled:opacity-50 flex items-center gap-2"
              >
                {actionLoading && <Loader2 className="h-4 w-4 animate-spin" />}
                Corregir y reenviar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Resend Credentials Modal */}
      {resendLead && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-xl max-w-md w-full p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-bold text-gray-900 flex items-center gap-2">
                <Send className="h-5 w-5 text-green-600" /> Reenviar credenciales
              </h3>
              <button onClick={() => setResendLead(null)} className="text-gray-400 hover:text-gray-600">
                <X className="h-5 w-5" />
              </button>
            </div>
            <p className="text-sm text-gray-600">
              Agencia: <strong>{resendLead.agency_name}</strong>
            </p>
            <p className="text-sm text-gray-600">
              Se generara una nueva contraseña temporal y se enviara al correo actual:
            </p>
            <p className="text-sm font-semibold text-gray-900">{resendLead.contact_email}</p>
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 text-xs text-blue-700">
              La contraseña anterior sera anulada. La agencia debera cambiar la nueva contraseña al iniciar sesion.
            </div>
            {actionMessage && (
              <p className="text-sm text-red-600">{actionMessage}</p>
            )}
            <div className="flex gap-3 justify-end">
              <button
                onClick={() => setResendLead(null)}
                className="px-4 py-2 text-sm font-medium text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
              >
                Cancelar
              </button>
              <button
                onClick={handleResendCredentials}
                disabled={actionLoading}
                className="px-4 py-2 text-sm font-medium text-white bg-green-600 hover:bg-green-700 rounded-lg transition-colors disabled:opacity-50 flex items-center gap-2"
              >
                {actionLoading && <Loader2 className="h-4 w-4 animate-spin" />}
                Reenviar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
