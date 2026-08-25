import React, { useState, useEffect, useRef } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import {
  ArrowLeft, User, Building2, Paperclip, Send, Lock, RefreshCw,
  ChevronDown, AlertCircle, ExternalLink, Clock, Mail
} from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../context/AuthContext';
import {
  SupportTicket, SupportTicketComment, SupportTicketHistoryEvent,
  SupportTicketAttachment, SupportTicketStatus, SupportTicketPriority
} from '../../types';
import TicketStatusBadge from '../../components/support/TicketStatusBadge';
import TicketPriorityBadge from '../../components/support/TicketPriorityBadge';
import TicketTimeline from '../../components/support/TicketTimeline';

interface AgentOption { id: string; first_name: string; last_name: string; email: string; }
interface AgencyOption { id: string; name: string; }

const AdminTicketDetail: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const { user } = useAuth();
  const navigate = useNavigate();

  const [ticket, setTicket] = useState<SupportTicket | null>(null);
  const [comments, setComments] = useState<SupportTicketComment[]>([]);
  const [history, setHistory] = useState<SupportTicketHistoryEvent[]>([]);
  const [attachments, setAttachments] = useState<SupportTicketAttachment[]>([]);
  const [agents, setAgents] = useState<AgentOption[]>([]);
  const [agencies, setAgencies] = useState<AgencyOption[]>([]);
  const [allTickets, setAllTickets] = useState<{ id: string; folio: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);

  // Action state
  const [newStatus, setNewStatus] = useState<SupportTicketStatus | ''>('');
  const [newPriority, setNewPriority] = useState<SupportTicketPriority | ''>('');
  const [newAgentId, setNewAgentId] = useState('');
  const [newAgencyId, setNewAgencyId] = useState('');
  const [relatedTicketId, setRelatedTicketId] = useState('');
  const [commentText, setCommentText] = useState('');
  const [commentType, setCommentType] = useState<'interno' | 'respuesta_usuario'>('respuesta_usuario');
  const [saving, setSaving] = useState(false);
  const submittingRef = useRef(false);
  const [error, setError] = useState<string | null>(null);

  const fetchTicket = async (silent = false) => {
    if (!id) return;
    if (!silent) setLoading(true);
    const [ticketRes, commentsRes, historyRes, attachmentsRes] = await Promise.all([
      supabase.from('support_tickets')
        .select(`
          *,
          category:support_categories(id, nombre),
          subcategory:support_subcategories(id, nombre, sla_horas),
          agencia:agencies(id, name)
        `)
        .eq('id', id)
        .maybeSingle(),
      supabase.from('support_ticket_comments').select('*').eq('ticket_id', id).order('created_at'),
      supabase.from('support_ticket_history').select('*').eq('ticket_id', id).order('created_at'),
      supabase.from('support_ticket_attachments').select('*').eq('ticket_id', id).order('created_at'),
    ]);
    if (ticketRes.error) {
      console.error('Ticket fetch error:', ticketRes.error);
      setFetchError(ticketRes.error.message);
    }

    let ticketData = ticketRes.data;
    if (ticketData?.ticket_relacionado_id) {
      const { data: related } = await supabase
        .from('support_tickets')
        .select('id, folio')
        .eq('id', ticketData.ticket_relacionado_id)
        .maybeSingle();
      if (related) ticketData = { ...ticketData, ticket_relacionado: related };
    }

    setTicket(ticketData);
    setComments(commentsRes.data ?? []);
    setHistory(historyRes.data ?? []);
    setAttachments(attachmentsRes.data ?? []);
    if (ticketData) {
      setNewStatus(ticketData.status);
      setNewPriority(ticketData.prioridad);
      setNewAgentId(ticketData.agente_asignado_id ?? '');
      setNewAgencyId(ticketData.agencia_asignada_id ?? '');
      setRelatedTicketId(ticketData.ticket_relacionado_id ?? '');
    }
    setLoading(false);
  };

  useEffect(() => {
    fetchTicket();
    supabase.from('users').select('id, first_name, last_name, email').eq('role', 'admin').then(r => setAgents(r.data ?? []));
    supabase.from('agencies').select('id, name').eq('is_active', true).order('name').then(r => setAgencies(r.data ?? []));
    supabase.from('support_tickets').select('id, folio').order('folio').then(r => setAllTickets(r.data ?? []));
  }, [id]);

  const getActorName = async () => {
    if (!user) return 'Administrador';
    const { data } = await supabase.from('users').select('first_name, last_name').eq('id', user.id).maybeSingle();
    return data ? `${data.first_name} ${data.last_name}` : 'Administrador';
  };

  const sendUpdateEmail = async (params: {
    nuevo_status?: string;
    mensaje_agente?: string;
  }) => {
    if (!ticket) return;
    try {
      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
      const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
      await fetch(`${supabaseUrl}/functions/v1/send-support-ticket-updated`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${supabaseAnonKey}`,
        },
        body: JSON.stringify({
          folio: ticket.folio,
          solicitante_nombre: ticket.solicitante_nombre,
          solicitante_email: ticket.solicitante_email,
          ...params,
        }),
      });
    } catch (err) {
      console.error('Error sending update email:', err);
    }
  };

  const saveChanges = async () => {
    if (!ticket || !user) return;
    if (newStatus === 'duplicado' && !relatedTicketId) {
      setError('Debes seleccionar el ticket relacionado cuando el estado es Duplicado / Asociado.');
      return;
    }
    setSaving(true);
    setError(null);

    const actorName = await getActorName();
    const historyEvents: any[] = [];
    const updates: Partial<SupportTicket> = {};

    if (newStatus && newStatus !== ticket.status) {
      updates.status = newStatus;
      if (newStatus === 'resuelto' || newStatus === 'cancelado' || newStatus === 'duplicado') {
        (updates as any).closed_at = new Date().toISOString();
      }
      historyEvents.push({
        ticket_id: ticket.id,
        tipo_evento: 'cambio_status',
        descripcion: `Estado cambiado de "${ticket.status}" a "${newStatus}"`,
        actor_id: user.id,
        actor_name: actorName,
        metadata: { old: ticket.status, new: newStatus },
      });
    }

    if (newPriority && newPriority !== ticket.prioridad) {
      updates.prioridad = newPriority;
      historyEvents.push({
        ticket_id: ticket.id,
        tipo_evento: 'cambio_prioridad',
        descripcion: `Prioridad cambiada de "${ticket.prioridad}" a "${newPriority}"`,
        actor_id: user.id,
        actor_name: actorName,
        metadata: { old: ticket.prioridad, new: newPriority },
      });
    }

    const agentChanged = (newAgentId || null) !== ticket.agente_asignado_id;
    if (agentChanged) {
      (updates as any).agente_asignado_id = newAgentId || null;
      const agent = agents.find(a => a.id === newAgentId);
      const isReassign = !!ticket.agente_asignado_id;
      historyEvents.push({
        ticket_id: ticket.id,
        tipo_evento: isReassign ? 'reasignacion_agente' : 'asignacion_agente',
        descripcion: newAgentId
          ? `Ticket ${isReassign ? 'reasignado' : 'asignado'} a ${agent?.first_name ?? ''} ${agent?.last_name ?? ''}`
          : 'Agente removido del ticket',
        actor_id: user.id,
        actor_name: actorName,
      });
    }

    const agencyChanged = (newAgencyId || null) !== ticket.agencia_asignada_id;
    if (agencyChanged) {
      (updates as any).agencia_asignada_id = newAgencyId || null;
      const agency = agencies.find(a => a.id === newAgencyId);
      const isReassign = !!ticket.agencia_asignada_id;
      historyEvents.push({
        ticket_id: ticket.id,
        tipo_evento: isReassign ? 'reasignacion_agencia' : 'asignacion_agencia',
        descripcion: newAgencyId
          ? `Ticket ${isReassign ? 'reasignado' : 'asignado'} a agencia ${agency?.name ?? ''}`
          : 'Agencia removida del ticket',
        actor_id: user.id,
        actor_name: actorName,
      });
    }

    const relatedChanged = (relatedTicketId || null) !== ticket.ticket_relacionado_id;
    if (relatedChanged) {
      (updates as any).ticket_relacionado_id = relatedTicketId || null;
    }

    if (Object.keys(updates).length > 0) {
      await supabase.from('support_tickets').update(updates).eq('id', ticket.id);
    }

    if (historyEvents.length > 0) {
      await supabase.from('support_ticket_history').insert(historyEvents);
    }

    // Notify user in-app if status changed or agent responded
    if ((updates.status && ticket.user_id) || (agentChanged && ticket.user_id)) {
      await supabase.from('notifications').insert({
        user_id: ticket.user_id,
        type: 'support_ticket_updated',
        title: `Actualización en ticket ${ticket.folio}`,
        message: updates.status
          ? `Tu ticket ${ticket.folio} cambió de estado a "${newStatus}"`
          : `Tu ticket ${ticket.folio} fue actualizado`,
        data: { ticket_id: ticket.id, folio: ticket.folio },
      });
    }

    // Notify agency if assigned
    if (agencyChanged && newAgencyId) {
      const { data: agencyUser } = await supabase
        .from('agencies')
        .select('user_id')
        .eq('id', newAgencyId)
        .maybeSingle();
      if (agencyUser?.user_id) {
        const agency = agencies.find(a => a.id === newAgencyId);
        await supabase.from('notifications').insert({
          user_id: agencyUser.user_id,
          type: 'support_ticket_assigned',
          title: `Nuevo ticket asignado: ${ticket.folio}`,
          message: `Se te asignó el ticket de soporte ${ticket.folio}`,
          data: { ticket_id: ticket.id, folio: ticket.folio },
        });
      }
    }

    // Notify assigned agent by email
    if (agentChanged && newAgentId) {
      const agent = agents.find(a => a.id === newAgentId);
      if (agent?.email) {
        try {
          const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
          const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
          await fetch(`${supabaseUrl}/functions/v1/send-support-ticket-agent-assigned`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${supabaseAnonKey}`,
            },
            body: JSON.stringify({
              folio: ticket.folio,
              agente_nombre: `${agent.first_name} ${agent.last_name}`,
              agente_email: agent.email,
              solicitante_nombre: ticket.solicitante_nombre,
              categoria: ticket.category?.nombre,
              descripcion: ticket.descripcion,
            }),
          });
        } catch (err) {
          console.error('Error sending agent assignment email:', err);
        }
      }
    }

    // Send email if status changed or meaningful update
    const hasEmailableChange = updates.status || updates.prioridad || agentChanged;
    if (hasEmailableChange) {
      await sendUpdateEmail({
        nuevo_status: updates.status ?? ticket.status,
      });
    }

    await fetchTicket(true);
    setSaving(false);
  };

  const submitComment = async () => {
    if (!ticket || !user || !commentText.trim()) return;
    if (submittingRef.current) return;
    submittingRef.current = true;

    // Capture values immediately before any state changes
    const text = commentText.trim();
    const type = commentType;
    const ticketId = ticket.id;
    const ticketFolio = ticket.folio;
    const ticketUserId = ticket.user_id;
    const ticketSolicitanteNombre = ticket.solicitante_nombre;
    const ticketSolicitanteEmail = ticket.solicitante_email;

    // Clear textarea immediately to prevent double-click confusion
    setCommentText('');
    setSaving(true);

    const actorName = await getActorName();

    await supabase.from('support_ticket_comments').insert({
      ticket_id: ticketId,
      author_id: user.id,
      author_name: actorName,
      tipo: type,
      contenido: text,
    });

    await supabase.from('support_ticket_history').insert({
      ticket_id: ticketId,
      tipo_evento: type === 'interno' ? 'comentario_interno' : 'respuesta_usuario',
      descripcion: text,
      actor_id: user.id,
      actor_name: actorName,
    });

    // Notify user if it's a response
    if (type === 'respuesta_usuario') {
      if (ticketUserId) {
        await supabase.from('notifications').insert({
          user_id: ticketUserId,
          type: 'support_ticket_updated',
          title: `Respuesta en ticket ${ticketFolio}`,
          message: `Un agente respondio a tu ticket ${ticketFolio}`,
          data: { ticket_id: ticketId, folio: ticketFolio },
        });
      }

      // Always send email when there is a solicitante_email
      if (ticketSolicitanteEmail) {
        const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
        const supabaseServiceKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
        await fetch(`${supabaseUrl}/functions/v1/send-support-ticket-updated`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${supabaseServiceKey}`,
          },
          body: JSON.stringify({
            folio: ticketFolio,
            solicitante_nombre: ticketSolicitanteNombre,
            solicitante_email: ticketSolicitanteEmail,
            mensaje_agente: text,
          }),
        }).catch(err => console.error('Error sending comment email:', err));
      }
    }

    await fetchTicket(true);
    setSaving(false);
    submittingRef.current = false;
  };

  const getAttachmentUrl = async (path: string) => {
    const { data } = await supabase.storage.from('support-attachments').createSignedUrl(path, 3600);
    if (data?.signedUrl) window.open(data.signedUrl, '_blank');
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-10 w-10 border-t-2 border-b-2 border-primary-600" />
      </div>
    );
  }

  if (!ticket) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <p className="text-gray-500 mb-2">Ticket no encontrado.</p>
          {fetchError && <p className="text-xs text-red-500 mb-4 max-w-md">{fetchError}</p>}
          <Link to="/admin/service-desk" className="btn btn-primary">Volver al Service Desk</Link>
        </div>
      </div>
    );
  }

  const isClosed = ticket.status === 'resuelto' || ticket.status === 'cancelado' || ticket.status === 'duplicado';

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-white border-b border-gray-200">
        <div className="container-custom py-4">
          <div className="flex items-center gap-3 flex-wrap">
            <Link to="/admin/service-desk" className="text-gray-400 hover:text-gray-600">
              <ArrowLeft className="h-5 w-5" />
            </Link>
            <span className="font-mono font-bold text-primary-600 text-lg">{ticket.folio}</span>
            <TicketStatusBadge status={ticket.status} size="md" />
            <TicketPriorityBadge priority={ticket.prioridad} size="md" />
            <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
              ticket.tipo === 'traveler' ? 'bg-blue-100 text-blue-700' :
              ticket.tipo === 'agency' ? 'bg-green-100 text-green-700' :
              'bg-gray-100 text-gray-600'
            }`}>
              {ticket.tipo === 'traveler' ? 'Viajero' : ticket.tipo === 'agency' ? 'Agencia' : 'General'}
            </span>
          </div>
        </div>
      </div>

      <div className="container-custom py-6">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Left: ticket info + timeline */}
          <div className="lg:col-span-2 space-y-5">
            {/* Ticket info */}
            <div className="bg-white rounded-xl border border-gray-200 p-5">
              <div className="flex items-start justify-between mb-3">
                <div>
                  <p className="text-xs text-gray-500 mb-1">
                    {(ticket.category as any)?.nombre} › {(ticket.subcategory as any)?.nombre}
                  </p>
                  <div className="flex items-center gap-3 text-sm text-gray-500">
                    <div className="flex items-center gap-1">
                      <Mail className="h-4 w-4" />
                      <a href={`mailto:${ticket.solicitante_email}`} className="hover:text-primary-600">
                        {ticket.solicitante_email}
                      </a>
                    </div>
                    <div className="flex items-center gap-1">
                      <User className="h-4 w-4" />
                      {ticket.solicitante_nombre}
                    </div>
                  </div>
                </div>
                <div className="text-right text-xs text-gray-400">
                  <div className="flex items-center gap-1 justify-end">
                    <Clock className="h-3 w-3" />
                    {new Date(ticket.created_at).toLocaleString('es-MX')}
                  </div>
                  {ticket.closed_at && (
                    <div className="mt-1">Cerrado: {new Date(ticket.closed_at).toLocaleString('es-MX')}</div>
                  )}
                </div>
              </div>
              <div className="bg-gray-50 rounded-lg p-4">
                <p className="text-sm text-gray-800 whitespace-pre-wrap">{ticket.descripcion}</p>
              </div>

              {/* Attachments */}
              {attachments.length > 0 && (
                <div className="mt-4">
                  <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">Adjuntos</p>
                  <div className="flex flex-wrap gap-2">
                    {attachments.map(att => (
                      <button
                        key={att.id}
                        onClick={() => getAttachmentUrl(att.storage_path)}
                        className="flex items-center gap-1.5 px-3 py-1.5 bg-gray-100 hover:bg-primary-50 hover:text-primary-700 rounded-lg text-sm text-gray-600 transition-colors"
                      >
                        <Paperclip className="h-3.5 w-3.5" />
                        {att.nombre_archivo}
                        <ExternalLink className="h-3 w-3" />
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Timeline */}
            <div className="bg-white rounded-xl border border-gray-200 p-5">
              <h3 className="font-semibold text-gray-800 mb-4">Historial del Ticket</h3>
              <TicketTimeline history={history} comments={comments} showInternal={true} />
            </div>

            {/* Add comment */}
            {!isClosed && (
              <div className="bg-white rounded-xl border border-gray-200 p-5">
                <h3 className="font-semibold text-gray-800 mb-3">Agregar Comentario</h3>
                <div className="flex gap-4 mb-3">
                  {[
                    { value: 'respuesta_usuario', label: 'Respuesta al usuario', icon: <Send className="h-4 w-4" /> },
                    { value: 'interno', label: 'Nota interna', icon: <Lock className="h-4 w-4" /> },
                  ].map(opt => (
                    <label key={opt.value} className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="radio"
                        name="commentType"
                        value={opt.value}
                        checked={commentType === opt.value}
                        onChange={() => setCommentType(opt.value as any)}
                        className="text-primary-600"
                      />
                      <span className="flex items-center gap-1 text-sm text-gray-700">
                        {opt.icon} {opt.label}
                      </span>
                    </label>
                  ))}
                </div>
                <textarea
                  value={commentText}
                  onChange={e => setCommentText(e.target.value)}
                  rows={4}
                  className={`input resize-none ${commentType === 'interno' ? 'bg-yellow-50 border-yellow-200' : ''}`}
                  placeholder={commentType === 'interno' ? 'Nota interna (solo visible para agentes)...' : 'Respuesta para el usuario...'}
                />
                <button
                  onClick={submitComment}
                  disabled={saving || !commentText.trim()}
                  className="btn btn-primary mt-3 flex items-center gap-2"
                >
                  {saving ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                  Enviar
                </button>
              </div>
            )}
          </div>

          {/* Right: actions panel */}
          <div className="space-y-4">
            {/* Status */}
            <div className="bg-white rounded-xl border border-gray-200 p-4">
              <h4 className="text-sm font-semibold text-gray-700 mb-3">Gestionar Ticket</h4>
              <div className="space-y-3">
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">Estado</label>
                  <select value={newStatus} onChange={e => setNewStatus(e.target.value as SupportTicketStatus)} className="input text-sm">
                    <option value="sin_atender">Sin Atender</option>
                    <option value="en_proceso">En Proceso</option>
                    <option value="escalado">Escalado</option>
                    <option value="resuelto">Resuelto / Cerrado</option>
                    <option value="cancelado">Cancelado / Desestimado</option>
                    <option value="duplicado">Duplicado / Asociado</option>
                  </select>
                </div>

                {newStatus === 'duplicado' && (
                  <div>
                    <label className="block text-xs font-medium text-gray-500 mb-1">
                      Ticket relacionado <span className="text-red-500">*</span>
                    </label>
                    <select value={relatedTicketId} onChange={e => setRelatedTicketId(e.target.value)} className="input text-sm">
                      <option value="">Selecciona el ticket original</option>
                      {allTickets.filter(t => t.id !== ticket.id).map(t => (
                        <option key={t.id} value={t.id}>{t.folio}</option>
                      ))}
                    </select>
                  </div>
                )}

                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">Prioridad</label>
                  <select value={newPriority} onChange={e => setNewPriority(e.target.value as SupportTicketPriority)} className="input text-sm">
                    <option value="baja">Baja</option>
                    <option value="media">Media</option>
                    <option value="alta">Alta</option>
                    <option value="urgente">Urgente</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">
                    <User className="h-3.5 w-3.5 inline mr-1" />Asignar agente
                  </label>
                  <select value={newAgentId} onChange={e => setNewAgentId(e.target.value)} className="input text-sm">
                    <option value="">Sin agente</option>
                    {agents.map(a => (
                      <option key={a.id} value={a.id}>{a.first_name} {a.last_name}</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">
                    <Building2 className="h-3.5 w-3.5 inline mr-1" />Asignar agencia
                  </label>
                  <select value={newAgencyId} onChange={e => setNewAgencyId(e.target.value)} className="input text-sm">
                    <option value="">Sin agencia</option>
                    {agencies.map(a => (
                      <option key={a.id} value={a.id}>{a.name}</option>
                    ))}
                  </select>
                </div>

                {error && (
                  <div className="flex items-start gap-2 bg-red-50 border border-red-200 rounded-lg p-3 text-xs text-red-700">
                    <AlertCircle className="h-4 w-4 flex-shrink-0 mt-0.5" />
                    {error}
                  </div>
                )}

                <button
                  onClick={saveChanges}
                  disabled={saving}
                  className="btn btn-primary w-full flex items-center justify-center gap-2"
                >
                  {saving ? <RefreshCw className="h-4 w-4 animate-spin" /> : null}
                  Guardar cambios
                </button>
              </div>
            </div>

            {/* Related ticket info */}
            {ticket.ticket_relacionado && (
              <div className="bg-white rounded-xl border border-gray-200 p-4">
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">Ticket relacionado</p>
                <Link
                  to={`/admin/service-desk/tickets/${(ticket.ticket_relacionado as any).id}`}
                  className="flex items-center gap-2 text-primary-600 hover:text-primary-700 text-sm font-mono"
                >
                  {(ticket.ticket_relacionado as any).folio}
                  <ExternalLink className="h-3.5 w-3.5" />
                </Link>
              </div>
            )}

            {/* Ticket metadata */}
            <div className="bg-white rounded-xl border border-gray-200 p-4 space-y-2 text-xs text-gray-500">
              <div className="flex justify-between">
                <span>Creado</span>
                <span>{new Date(ticket.created_at).toLocaleString('es-MX')}</span>
              </div>
              <div className="flex justify-between">
                <span>Actualizado</span>
                <span>{new Date(ticket.updated_at).toLocaleString('es-MX')}</span>
              </div>
              {ticket.closed_at && (
                <div className="flex justify-between">
                  <span>Cerrado</span>
                  <span>{new Date(ticket.closed_at).toLocaleString('es-MX')}</span>
                </div>
              )}
              <div className="flex justify-between">
                <span>SLA objetivo</span>
                <span>{(ticket.subcategory as any)?.sla_horas ?? 24}h</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default AdminTicketDetail;
