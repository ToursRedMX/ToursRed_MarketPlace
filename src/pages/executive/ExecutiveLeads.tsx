import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Plus, Search, ChevronDown, CreditCard as Edit2, Eye, ArrowRight, Trash2, User, Phone, Mail, MapPin, MessageSquare, Calendar, X, CheckCircle, Clock, AlertCircle, Building2, Upload, Loader2, MailCheck, Send } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../context/AuthContext';

type LeadStatus = 'prospecto' | 'contactado' | 'negociacion' | 'registrado' | 'aprobado' | 'perdido';

interface AgencyLead {
  id: string;
  executive_id: string;
  agency_name: string;
  contact_first_name: string;
  contact_last_name: string;
  contact_email: string;
  contact_phone: string | null;
  website: string | null;
  rfc: string | null;
  razon_social: string | null;
  rnt: string | null;
  street: string | null;
  exterior_number: string | null;
  interior_number: string | null;
  colony: string | null;
  city: string | null;
  state: string | null;
  postal_code: string | null;
  country: string;
  banco: string | null;
  cuenta_clabe: string | null;
  titular_cuenta: string | null;
  status: LeadStatus;
  notes: string | null;
  next_contact_date: string | null;
  probability: number;
  source: string | null;
  converted_agency_id: string | null;
  converted_at: string | null;
  follow_up_log: any[];
  created_at: string;
  updated_at: string;
  converted_agency_onboarding_status?: string | null;
  converted_agency_name?: string | null;
}

const STATUS_CONFIG: Record<LeadStatus, { label: string; color: string; bg: string }> = {
  prospecto: { label: 'Prospecto', color: 'text-gray-600', bg: 'bg-gray-100' },
  contactado: { label: 'Contactado', color: 'text-sky-700', bg: 'bg-sky-100' },
  negociacion: { label: 'Negociación', color: 'text-amber-700', bg: 'bg-amber-100' },
  registrado: { label: 'Registrado', color: 'text-blue-700', bg: 'bg-blue-100' },
  aprobado: { label: 'Aprobado', color: 'text-green-700', bg: 'bg-green-100' },
  perdido: { label: 'Perdido', color: 'text-red-700', bg: 'bg-red-100' },
};

const EMPTY_LEAD: Omit<AgencyLead, 'id' | 'executive_id' | 'converted_agency_id' | 'converted_at' | 'follow_up_log' | 'created_at' | 'updated_at'> = {
  agency_name: '',
  contact_first_name: '',
  contact_last_name: '',
  contact_email: '',
  contact_phone: '',
  website: '',
  rfc: '',
  razon_social: '',
  rnt: '',
  street: '',
  exterior_number: '',
  interior_number: '',
  colony: '',
  city: '',
  state: '',
  postal_code: '',
  country: 'México',
  banco: '',
  cuenta_clabe: '',
  titular_cuenta: '',
  status: 'prospecto',
  notes: '',
  next_contact_date: null,
  probability: 50,
  source: '',
};

export default function ExecutiveLeads() {
  const { accountExecutiveInfo } = useAuth();
  const [leads, setLeads] = useState<AgencyLead[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [showModal, setShowModal] = useState(false);
  const [editingLead, setEditingLead] = useState<AgencyLead | null>(null);
  const [form, setForm] = useState<typeof EMPTY_LEAD>({ ...EMPTY_LEAD });
  const [isSaving, setIsSaving] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [fieldErrors, setFieldErrors] = useState<{ email?: string; rfc?: string }>({});
  const [fieldStatus, setFieldStatus] = useState<{ email?: 'checking' | 'ok' | 'error'; rfc?: 'checking' | 'ok' | 'error' }>({});
  const debounceTimerRef = useRef<{ email?: ReturnType<typeof setTimeout>; rfc?: ReturnType<typeof setTimeout> }>({});

  const checkFieldDuplicate = useCallback(async (field: 'email' | 'rfc', value: string, excludeLeadId?: string) => {
    const trimmed = value.trim();
    if (!trimmed) {
      setFieldErrors(prev => ({ ...prev, [field]: undefined }));
      setFieldStatus(prev => ({ ...prev, [field]: undefined }));
      return;
    }
    if (field === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
      setFieldErrors(prev => ({ ...prev, email: 'Formato de correo inválido' }));
      setFieldStatus(prev => ({ ...prev, email: 'error' }));
      return;
    }
    if (field === 'rfc' && trimmed.length < 12) {
      setFieldErrors(prev => ({ ...prev, rfc: undefined }));
      setFieldStatus(prev => ({ ...prev, rfc: undefined }));
      return;
    }

    setFieldStatus(prev => ({ ...prev, [field]: 'checking' }));

    try {
      const params: any = field === 'email'
        ? { p_email: trimmed, p_rfc: null, p_exclude_lead_id: excludeLeadId || null }
        : { p_email: null, p_rfc: trimmed.toUpperCase(), p_exclude_lead_id: excludeLeadId || null };

      const { data: conflicts, error } = await supabase.rpc('check_lead_duplicate', params);

      if (error) throw error;

      const conflictKey = field === 'email' ? 'email_conflict' : 'rfc_conflict';

      if (conflicts && conflicts[conflictKey]) {
        const c = conflicts[conflictKey];
        let msg: string;
        if (c.type === 'lead') {
          msg = field === 'email'
            ? `Ya existe un lead registrado por ${c.executive_name} para la agencia "${c.agency_name}"`
            : `Ya existe un lead con este RFC para la agencia "${c.agency_name}"`;
        } else {
          msg = `La agencia "${c.agency_name}" ya está aprobada en la plataforma con este ${field === 'email' ? 'correo' : 'RFC'}`;
        }
        setFieldErrors(prev => ({ ...prev, [field]: msg }));
        setFieldStatus(prev => ({ ...prev, [field]: 'error' }));
      } else {
        setFieldErrors(prev => ({ ...prev, [field]: undefined }));
        setFieldStatus(prev => ({ ...prev, [field]: 'ok' }));
      }
    } catch {
      setFieldErrors(prev => ({ ...prev, [field]: undefined }));
      setFieldStatus(prev => ({ ...prev, [field]: undefined }));
    }
  }, []);

  const handleFieldChange = useCallback((field: 'email' | 'rfc', value: string) => {
    if (debounceTimerRef.current[field]) clearTimeout(debounceTimerRef.current[field]);
    setFieldStatus(prev => ({ ...prev, [field]: undefined }));
    setFieldErrors(prev => ({ ...prev, [field]: undefined }));

    const timer = setTimeout(() => {
      checkFieldDuplicate(field, value, editingLead?.id);
    }, 500);
    debounceTimerRef.current[field] = timer;
  }, [checkFieldDuplicate, editingLead]);

  useEffect(() => () => {
    if (debounceTimerRef.current.email) clearTimeout(debounceTimerRef.current.email);
    if (debounceTimerRef.current.rfc) clearTimeout(debounceTimerRef.current.rfc);
  }, []);
  const [showConvertModal, setShowConvertModal] = useState<AgencyLead | null>(null);
  const [convertPersonaType, setConvertPersonaType] = useState<'persona_fisica' | 'persona_moral'>('persona_fisica');
  const [convertRepresentante, setConvertRepresentante] = useState('');
  const [convertRegimenFiscal, setConvertRegimenFiscal] = useState('');
  const [convertBanco, setConvertBanco] = useState('');
  const [convertCuentaClabe, setConvertCuentaClabe] = useState('');
  const [convertTitularCuenta, setConvertTitularCuenta] = useState('');
  const [isConverting, setIsConverting] = useState(false);
  const [showFollowUp, setShowFollowUp] = useState<AgencyLead | null>(null);
  const [fixEmailLead, setFixEmailLead] = useState<AgencyLead | null>(null);
  const [resendLead, setResendLead] = useState<AgencyLead | null>(null);
  const [fixEmailValue, setFixEmailValue] = useState('');
  const [actionLoading, setActionLoading] = useState(false);
  const [actionMessage, setActionMessage] = useState('');
  const [newNote, setNewNote] = useState('');

  const loadLeads = useCallback(async () => {
    if (!accountExecutiveInfo?.executiveId) return;
    setIsLoading(true);
    try {
      const { data } = await supabase
        .from('agency_leads')
        .select('*')
        .eq('executive_id', accountExecutiveInfo.executiveId)
        .order('created_at', { ascending: false });

      const convertedIds = (data || []).filter(l => l.converted_agency_id).map(l => l.converted_agency_id);
      if (convertedIds.length > 0) {
        const { data: agenciesData } = await supabase
          .from('agencies')
          .select('id, onboarding_status, name')
          .in('id', convertedIds);
        const agencyMap = new Map((agenciesData || []).map(a => [a.id, a]));
        const enriched = (data || []).map(l => ({
          ...l,
          converted_agency_onboarding_status: l.converted_agency_id ? agencyMap.get(l.converted_agency_id)?.onboarding_status || null : null,
          converted_agency_name: l.converted_agency_id ? agencyMap.get(l.converted_agency_id)?.name || null : null,
        }));
        setLeads(enriched);
      } else {
        setLeads(data || []);
      }
    } finally {
      setIsLoading(false);
    }
  }, [accountExecutiveInfo?.executiveId]);

  useEffect(() => { loadLeads(); }, [loadLeads]);

  const openCreate = () => {
    setEditingLead(null);
    setForm({ ...EMPTY_LEAD });
    setFieldErrors({});
    setFieldStatus({});
    setMessage(null);
    setShowModal(true);
  };

  const openEdit = (lead: AgencyLead) => {
    setEditingLead(lead);
    setFieldErrors({});
    setFieldStatus({});
    setMessage(null);
    setForm({
      agency_name: lead.agency_name,
      contact_first_name: lead.contact_first_name,
      contact_last_name: lead.contact_last_name,
      contact_email: lead.contact_email,
      contact_phone: lead.contact_phone || '',
      website: lead.website || '',
      rfc: lead.rfc || '',
      razon_social: lead.razon_social || '',
      rnt: lead.rnt || '',
      street: lead.street || '',
      exterior_number: lead.exterior_number || '',
      interior_number: lead.interior_number || '',
      colony: lead.colony || '',
      city: lead.city || '',
      state: lead.state || '',
      postal_code: lead.postal_code || '',
      country: lead.country || 'México',
      banco: lead.banco || '',
      cuenta_clabe: lead.cuenta_clabe || '',
      titular_cuenta: lead.titular_cuenta || '',
      status: lead.status,
      notes: lead.notes || '',
      next_contact_date: lead.next_contact_date,
      probability: lead.probability,
      source: lead.source || '',
    });
    setShowModal(true);
  };

  const saveLead = async () => {
    if (!accountExecutiveInfo?.executiveId) return;
    if (!form.agency_name || !form.contact_email || !form.contact_first_name) {
      setMessage({ type: 'error', text: 'Nombre de agencia, nombre del contacto y email son requeridos.' });
      return;
    }

    // Block save if real-time validation found errors
    if (fieldStatus.email === 'error' || fieldStatus.rfc === 'error') {
      setMessage({ type: 'error', text: 'Corrige los campos marcados en rojo antes de guardar.' });
      return;
    }
    if (fieldStatus.email === 'checking' || fieldStatus.rfc === 'checking') {
      setMessage({ type: 'error', text: 'Espera a que termine la validación de correo/RFC.' });
      return;
    }

    setFieldErrors({});
    setIsSaving(true);
    try {
      // Check duplicates across all leads and registered agencies
      const { data: conflicts, error: rpcError } = await supabase
        .rpc('check_lead_duplicate', {
          p_email: form.contact_email,
          p_rfc: form.rfc || null,
          p_exclude_lead_id: editingLead?.id || null,
        });

      if (rpcError) throw rpcError;

      if (conflicts && Object.keys(conflicts).length > 0) {
        const errors: { email?: string; rfc?: string } = {};
        const messages: string[] = [];

        if (conflicts.email_conflict) {
          const c = conflicts.email_conflict;
          if (c.type === 'lead') {
            errors.email = `Ya existe un lead registrado por ${c.executive_name} para la agencia "${c.agency_name}"`;
            messages.push(`El correo ya está registrado como lead por ${c.executive_name} (agencia "${c.agency_name}").`);
          } else {
            errors.email = `La agencia "${c.agency_name}" ya está aprobada en la plataforma con este correo`;
            messages.push(`El correo ya pertenece a la agencia "${c.agency_name}", aprobada en la plataforma.`);
          }
        }

        if (conflicts.rfc_conflict) {
          const c = conflicts.rfc_conflict;
          if (c.type === 'lead') {
            errors.rfc = `Ya existe un lead con este RFC para la agencia "${c.agency_name}"`;
            messages.push(`El RFC ya está registrado como lead (agencia "${c.agency_name}").`);
          } else {
            errors.rfc = `La agencia "${c.agency_name}" ya está aprobada en la plataforma con este RFC`;
            messages.push(`El RFC ya pertenece a la agencia "${c.agency_name}", aprobada en la plataforma.`);
          }
        }

        setFieldErrors(errors);
        setMessage({ type: 'error', text: messages.join(' ') });
        setIsSaving(false);
        return;
      }

      const payload = {
        ...form,
        executive_id: accountExecutiveInfo.executiveId,
        updated_at: new Date().toISOString(),
      };
      if (editingLead) {
        const { error } = await supabase.from('agency_leads').update(payload).eq('id', editingLead.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from('agency_leads').insert(payload);
        if (error) throw error;
      }
      setMessage({ type: 'success', text: editingLead ? 'Lead actualizado.' : 'Lead creado.' });
      setShowModal(false);
      loadLeads();

      // Si el lead se guardó con estado "registrado" y aún no ha sido convertido,
      // abrir automáticamente el modal de conversión
      if (form.status === 'registrado' && editingLead && !editingLead.converted_agency_id) {
        const leadToConvert = { ...editingLead, ...form };
        setTimeout(() => {
          setShowConvertModal(leadToConvert);
          resetConvertForm();
        }, 300);
      }
    } catch (e: any) {
      setMessage({ type: 'error', text: e.message || 'Error al guardar.' });
    } finally {
      setIsSaving(false);
    }
  };

  const convertToAgency = async (lead: AgencyLead) => {
    if (!convertRepresentante.trim()) {
      setMessage({ type: 'error', text: 'El nombre del representante legal o titular es obligatorio.' });
      return;
    }
    setIsConverting(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error('Sesión expirada. Vuelve a iniciar sesión.');

      const res = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/convert-lead-to-agency`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${session.access_token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            leadId: lead.id,
            agencyName: lead.agency_name,
            contactFirstName: lead.contact_first_name,
            contactLastName: lead.contact_last_name,
            contactEmail: lead.contact_email,
            contactPhone: lead.contact_phone,
            website: lead.website,
            rfc: lead.rfc,
            razonSocial: lead.razon_social,
            rnt: lead.rnt,
            street: lead.street,
            exteriorNumber: lead.exterior_number,
            interiorNumber: lead.interior_number,
            colony: lead.colony,
            city: lead.city,
            state: lead.state,
            postalCode: lead.postal_code,
            country: lead.country || 'México',
            personaType: convertPersonaType,
            representanteLegalNombre: convertRepresentante.trim() || null,
            regimenFiscal: convertRegimenFiscal.trim() || null,
            banco: convertBanco.trim() || null,
            cuentaClabe: convertCuentaClabe.trim() || null,
            titularCuenta: convertTitularCuenta.trim() || null,
          }),
        }
      );
      const result = await res.json();
      if (!res.ok) throw new Error(result.error || 'Error al convertir el lead.');

      setMessage({ type: 'success', text: `Agencia "${lead.agency_name}" registrada exitosamente. Se enviaron las credenciales y la contraseña temporal al email.` });
      setShowConvertModal(null);
      resetConvertForm();
      loadLeads();
    } catch (e: any) {
      setMessage({ type: 'error', text: e.message || 'Error al convertir el lead.' });
    } finally {
      setIsConverting(false);
    }
  };

  const resetConvertForm = () => {
    setConvertPersonaType('persona_fisica');
    setConvertRepresentante('');
    setConvertRegimenFiscal('');
    setConvertBanco('');
    setConvertCuentaClabe('');
    setConvertTitularCuenta('');
  };

  const addFollowUpNote = async (lead: AgencyLead) => {
    if (!newNote.trim()) return;
    const log = Array.isArray(lead.follow_up_log) ? lead.follow_up_log : [];
    const updated = [
      ...log,
      { date: new Date().toISOString(), note: newNote.trim() }
    ];
    await supabase.from('agency_leads').update({ follow_up_log: updated }).eq('id', lead.id);
    setNewNote('');
    setShowFollowUp(null);
    loadLeads();
  };

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

  const filtered = leads.filter(l => {
    if (l.status === 'aprobado') return false;
    const matchSearch = !search ||
      l.agency_name.toLowerCase().includes(search.toLowerCase()) ||
      l.contact_email.toLowerCase().includes(search.toLowerCase()) ||
      `${l.contact_first_name} ${l.contact_last_name}`.toLowerCase().includes(search.toLowerCase());
    const matchStatus = statusFilter === 'all' || l.status === statusFilter;
    return matchSearch && matchStatus;
  });

  const activeLeads = leads.filter(l => l.status !== 'aprobado');

  const statusCounts = activeLeads.reduce((acc, l) => {
    acc[l.status] = (acc[l.status] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  return (
    <div className="max-w-7xl mx-auto px-4 py-8 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Pipeline de Leads</h1>
          <p className="text-gray-500 mt-1">Gestiona tus prospectos de agencias</p>
        </div>
        <button
          onClick={openCreate}
          className="flex items-center gap-2 bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 transition-colors text-sm font-medium"
        >
          <Plus className="h-4 w-4" /> Nuevo lead
        </button>
      </div>

      {message && (
        <div className={`rounded-lg px-4 py-3 text-sm flex items-center gap-2 ${message.type === 'success' ? 'bg-green-50 text-green-700 border border-green-200' : 'bg-red-50 text-red-700 border border-red-200'}`}>
          {message.type === 'success' ? <CheckCircle className="h-4 w-4 shrink-0" /> : <AlertCircle className="h-4 w-4 shrink-0" />}
          {message.text}
          <button onClick={() => setMessage(null)} className="ml-auto"><X className="h-4 w-4" /></button>
        </div>
      )}

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

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Buscar por nombre, email o contacto..."
          className="w-full pl-9 pr-4 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
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
                  {['Agencia', 'Contacto', 'Estado', 'Próximo contacto', 'Probabilidad', 'Acciones'].map(h => (
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
                          {lead.status !== 'aprobado' && (
                            <button
                              onClick={() => openEdit(lead)}
                              className="p-1.5 hover:bg-gray-100 rounded text-gray-500 hover:text-gray-700 transition-colors"
                              title="Editar"
                            >
                              <Edit2 className="h-4 w-4" />
                            </button>
                          )}
                          {lead.status !== 'aprobado' && (
                            <button
                              onClick={() => { setShowFollowUp(lead); setNewNote(''); }}
                              className="p-1.5 hover:bg-gray-100 rounded text-gray-500 hover:text-gray-700 transition-colors"
                              title="Agregar nota"
                            >
                              <MessageSquare className="h-4 w-4" />
                            </button>
                          )}
                          {!lead.converted_agency_id && (
                            <button
                              onClick={() => { setShowConvertModal(lead); resetConvertForm(); }}
                              className="p-1.5 hover:bg-blue-50 rounded text-blue-500 hover:text-blue-700 transition-colors"
                              title="Convertir a agencia"
                            >
                              <ArrowRight className="h-4 w-4" />
                            </button>
                          )}
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

      {/* Modal Crear/Editar Lead */}
      {showModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-3xl max-h-[90vh] overflow-y-auto">
            <div className="sticky top-0 bg-white border-b border-gray-100 px-6 py-4 flex items-center justify-between">
              <h2 className="text-lg font-semibold text-gray-900">
                {editingLead ? 'Editar lead' : 'Nuevo lead'}
              </h2>
              <button onClick={() => setShowModal(false)} className="text-gray-400 hover:text-gray-600">
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="p-6 space-y-6">
              {/* Estado y Probabilidad */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1.5">Estado</label>
                  <select
                    value={form.status}
                    onChange={e => setForm(f => ({ ...f, status: e.target.value as LeadStatus }))}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    {Object.entries(STATUS_CONFIG).filter(([key]) => key !== 'aprobado').map(([key, cfg]) => (
                      <option key={key} value={key}>{cfg.label}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1.5">Probabilidad de cierre</label>
                  <div className="flex items-center gap-3">
                    <input
                      type="range" min={0} max={100}
                      value={form.probability}
                      onChange={e => setForm(f => ({ ...f, probability: Number(e.target.value) }))}
                      className="flex-1"
                    />
                    <span className="text-sm font-medium text-gray-700 w-10 text-right">{form.probability}%</span>
                  </div>
                </div>
              </div>

              {/* Datos de la Agencia */}
              <div>
                <h3 className="text-sm font-semibold text-gray-700 mb-3 pb-1 border-b border-gray-100">Datos de la agencia</h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="sm:col-span-2">
                    <label className="block text-xs font-medium text-gray-600 mb-1.5">Nombre de la agencia *</label>
                    <input
                      value={form.agency_name}
                      onChange={e => setForm(f => ({ ...f, agency_name: e.target.value }))}
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                      placeholder="Ej. Viajes Sol y Mar"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1.5">RFC</label>
                    <div className="relative">
                      <input
                        value={form.rfc || ''}
                        onChange={e => {
                          const val = e.target.value.toUpperCase();
                          setForm(f => ({ ...f, rfc: val }));
                          handleFieldChange('rfc', val);
                        }}
                        className={`w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 ${fieldStatus.rfc === 'error' ? 'border-red-400 focus:ring-red-500' : fieldStatus.rfc === 'ok' ? 'border-green-400 focus:ring-green-500' : 'border-gray-300 focus:ring-blue-500'} ${fieldStatus.rfc === 'ok' ? 'pr-9' : ''}`}
                        placeholder="XAXX010101000"
                      />
                      {fieldStatus.rfc === 'checking' && <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400 animate-spin" />}
                      {fieldStatus.rfc === 'ok' && <CheckCircle className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-green-500" />}
                    </div>
                    {fieldErrors.rfc && <p className="mt-1 text-xs text-red-600 flex items-center gap-1"><AlertCircle className="h-3 w-3" /> {fieldErrors.rfc}</p>}
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1.5">Razón social</label>
                    <input
                      value={form.razon_social || ''}
                      onChange={e => setForm(f => ({ ...f, razon_social: e.target.value }))}
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1.5">Sitio web / Facebook</label>
                    <input
                      value={form.website || ''}
                      onChange={e => setForm(f => ({ ...f, website: e.target.value }))}
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1.5">RNT</label>
                    <input
                      value={form.rnt || ''}
                      onChange={e => setForm(f => ({ ...f, rnt: e.target.value }))}
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                </div>
              </div>

              {/* Contacto */}
              <div>
                <h3 className="text-sm font-semibold text-gray-700 mb-3 pb-1 border-b border-gray-100">Datos del contacto</h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1.5">Nombre *</label>
                    <input
                      value={form.contact_first_name}
                      onChange={e => setForm(f => ({ ...f, contact_first_name: e.target.value }))}
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1.5">Apellido</label>
                    <input
                      value={form.contact_last_name}
                      onChange={e => setForm(f => ({ ...f, contact_last_name: e.target.value }))}
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1.5">Email *</label>
                    <div className="relative">
                      <input
                        type="email"
                        value={form.contact_email}
                        onChange={e => {
                          setForm(f => ({ ...f, contact_email: e.target.value }));
                          handleFieldChange('email', e.target.value);
                        }}
                        disabled={!!editingLead?.converted_agency_id}
                        className={`w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 ${fieldStatus.email === 'error' ? 'border-red-400 focus:ring-red-500' : fieldStatus.email === 'ok' ? 'border-green-400 focus:ring-green-500' : 'border-gray-300 focus:ring-blue-500'} ${fieldStatus.email === 'ok' ? 'pr-9' : ''} ${editingLead?.converted_agency_id ? 'bg-gray-100 text-gray-500 cursor-not-allowed' : ''}`}
                      />
                      {editingLead?.converted_agency_id && (
                        <p className="mt-1 text-xs text-amber-600 flex items-center gap-1">
                          <AlertCircle className="h-3 w-3" />
                          El correo no se puede editar aquí una vez convertido. Usa el botón de corregir email en el pipeline.
                        </p>
                      )}
                      {fieldStatus.email === 'checking' && <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400 animate-spin" />}
                      {fieldStatus.email === 'ok' && <CheckCircle className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-green-500" />}
                    </div>
                    {fieldErrors.email && <p className="mt-1 text-xs text-red-600 flex items-center gap-1"><AlertCircle className="h-3 w-3" /> {fieldErrors.email}</p>}
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1.5">Teléfono</label>
                    <input
                      value={form.contact_phone || ''}
                      onChange={e => setForm(f => ({ ...f, contact_phone: e.target.value }))}
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                </div>
              </div>

              {/* Domicilio */}
              <div>
                <h3 className="text-sm font-semibold text-gray-700 mb-3 pb-1 border-b border-gray-100">Domicilio fiscal</h3>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  <div className="sm:col-span-2">
                    <label className="block text-xs font-medium text-gray-600 mb-1.5">Calle</label>
                    <input value={form.street || ''} onChange={e => setForm(f => ({ ...f, street: e.target.value }))}
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1.5">Número ext.</label>
                    <input value={form.exterior_number || ''} onChange={e => setForm(f => ({ ...f, exterior_number: e.target.value }))}
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1.5">Colonia</label>
                    <input value={form.colony || ''} onChange={e => setForm(f => ({ ...f, colony: e.target.value }))}
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1.5">Ciudad</label>
                    <input value={form.city || ''} onChange={e => setForm(f => ({ ...f, city: e.target.value }))}
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1.5">Estado</label>
                    <input value={form.state || ''} onChange={e => setForm(f => ({ ...f, state: e.target.value }))}
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1.5">CP</label>
                    <input value={form.postal_code || ''} onChange={e => setForm(f => ({ ...f, postal_code: e.target.value }))}
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                  </div>
                </div>
              </div>

              {/* CRM */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1.5">Próximo contacto</label>
                  <input
                    type="date"
                    value={form.next_contact_date || ''}
                    onChange={e => setForm(f => ({ ...f, next_contact_date: e.target.value || null }))}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1.5">Fuente del lead</label>
                  <input
                    value={form.source || ''}
                    onChange={e => setForm(f => ({ ...f, source: e.target.value }))}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    placeholder="Ej. Referido, Expo, LinkedIn"
                  />
                </div>
                <div className="sm:col-span-2">
                  <label className="block text-xs font-medium text-gray-600 mb-1.5">Notas internas</label>
                  <textarea
                    rows={3}
                    value={form.notes || ''}
                    onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
                  />
                </div>
              </div>
            </div>

            <div className="sticky bottom-0 bg-white border-t border-gray-100 px-6 py-4 flex justify-end gap-3">
              <button onClick={() => setShowModal(false)} className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800">
                Cancelar
              </button>
              <button
                onClick={saveLead}
                disabled={isSaving}
                className="px-5 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50 transition-colors"
              >
                {isSaving ? 'Guardando...' : (editingLead ? 'Actualizar' : 'Crear lead')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal Convertir a Agencia */}
      {showConvertModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md">
            <div className="p-6">
              <h2 className="text-lg font-semibold text-gray-900 mb-1">Convertir a agencia registrada</h2>
              <p className="text-sm text-gray-500 mb-5">
                Se creará la cuenta de usuario para <strong>{showConvertModal.contact_email}</strong> y el registro de la agencia <strong>{showConvertModal.agency_name}</strong>.
              </p>

              <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 mb-5">
                <p className="text-xs text-blue-700">
                  Se generará una contraseña temporal automáticamente y se enviará al email de la agencia. Al iniciar sesión por primera vez, la agencia deberá cambiarla y completar su onboarding (términos, documentos y firma de contrato).
                </p>
              </div>

              <div className="space-y-4">
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1.5">Tipo de persona *</label>
                  <select
                    value={convertPersonaType}
                    onChange={e => setConvertPersonaType(e.target.value as 'persona_fisica' | 'persona_moral')}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="persona_fisica">Persona Física</option>
                    <option value="persona_moral">Persona Moral</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1.5">
                    {convertPersonaType === 'persona_moral' ? 'Nombre del representante legal *' : 'Nombre del titular *'}
                  </label>
                  <input
                    type="text"
                    value={convertRepresentante}
                    onChange={e => setConvertRepresentante(e.target.value)}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    placeholder={convertPersonaType === 'persona_moral' ? 'Nombre completo del representante legal' : 'Nombre completo del titular de la agencia'}
                  />
                  <p className="text-[11px] text-gray-400 mt-1">Requerido para generar el contrato de colaboración</p>
                </div>

                <div className="border-t border-gray-100 pt-3">
                  <p className="text-[11px] font-bold text-gray-400 uppercase tracking-widest mb-2">Datos fiscales (opcional)</p>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-medium text-gray-600 mb-1">Régimen fiscal</label>
                      <input
                        type="text"
                        value={convertRegimenFiscal}
                        onChange={e => setConvertRegimenFiscal(e.target.value)}
                        className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                        placeholder="Ej: 601"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-600 mb-1">Banco</label>
                      <input
                        type="text"
                        value={convertBanco}
                        onChange={e => setConvertBanco(e.target.value)}
                        className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                        placeholder="Nombre del banco"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-600 mb-1">Cuenta CLABE</label>
                      <input
                        type="text"
                        value={convertCuentaClabe}
                        onChange={e => setConvertCuentaClabe(e.target.value)}
                        className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                        placeholder="18 dígitos"
                        maxLength={18}
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-600 mb-1">Titular de la cuenta</label>
                      <input
                        type="text"
                        value={convertTitularCuenta}
                        onChange={e => setConvertTitularCuenta(e.target.value)}
                        className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                        placeholder="Nombre del titular"
                      />
                    </div>
                  </div>
                </div>
              </div>
            </div>
            <div className="px-6 pb-6 flex justify-end gap-3">
              <button onClick={() => setShowConvertModal(null)} className="px-4 py-2 text-sm text-gray-600">Cancelar</button>
              <button
                onClick={() => convertToAgency(showConvertModal)}
                disabled={isConverting}
                className="px-5 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
              >
                {isConverting ? 'Registrando...' : 'Registrar agencia'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal Seguimiento */}
      {showFollowUp && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg">
            <div className="p-6">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-lg font-semibold text-gray-900">Historial de seguimiento</h2>
                <button onClick={() => setShowFollowUp(null)}><X className="h-5 w-5 text-gray-400" /></button>
              </div>
              <p className="text-sm text-gray-500 mb-4">{showFollowUp.agency_name}</p>

              <div className="space-y-2 max-h-48 overflow-y-auto mb-4">
                {(showFollowUp.follow_up_log || []).length === 0 ? (
                  <p className="text-sm text-gray-400 text-center py-4">Sin notas previas</p>
                ) : (
                  [...(showFollowUp.follow_up_log || [])].reverse().map((entry: any, i: number) => (
                    <div key={i} className="bg-gray-50 rounded-lg px-3 py-2">
                      <p className="text-xs text-gray-400">{new Date(entry.date).toLocaleString('es-MX')}</p>
                      <p className="text-sm text-gray-700 mt-0.5">{entry.note}</p>
                    </div>
                  ))
                )}
              </div>

              <textarea
                rows={3}
                value={newNote}
                onChange={e => setNewNote(e.target.value)}
                placeholder="Escribe una nota de seguimiento..."
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
              />
            </div>
            <div className="px-6 pb-6 flex justify-end gap-3">
              <button onClick={() => setShowFollowUp(null)} className="px-4 py-2 text-sm text-gray-600">Cerrar</button>
              <button
                onClick={() => addFollowUpNote(showFollowUp)}
                disabled={!newNote.trim()}
                className="px-5 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
              >
                Agregar nota
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
