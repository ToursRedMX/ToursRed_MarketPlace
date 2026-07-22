import React, { useState, useEffect } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Plus, TicketCheck, Search, RefreshCw, Eye, MessageCircle, Clock, Building2, Tag } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../context/AuthContext';
import { SupportTicket, SupportTicketComment, SupportTicketHistoryEvent } from '../../types';
import TicketStatusBadge from '../../components/support/TicketStatusBadge';
import TicketPriorityBadge from '../../components/support/TicketPriorityBadge';
import TicketTimeline from '../../components/support/TicketTimeline';
import { useAgencyId } from '../../hooks/useAgencyId';

type TabType = 'propios' | 'asignados';

const AgencySupportTickets: React.FC = () => {
  const { user } = useAuth();
  const { agencyId } = useAgencyId();
  const [searchParams] = useSearchParams();
  const [tab, setTab] = useState<TabType>('propios');
  const [tickets, setTickets] = useState<SupportTicket[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [selectedTicket, setSelectedTicket] = useState<SupportTicket | null>(null);
  const [comments, setComments] = useState<SupportTicketComment[]>([]);
  const [history, setHistory] = useState<SupportTicketHistoryEvent[]>([]);
  const [newComment, setNewComment] = useState('');
  const [submittingComment, setSubmittingComment] = useState(false);

  const fetchTickets = async () => {
    if (!user) return;
    setLoading(true);

    let query = supabase
      .from('support_tickets')
      .select(`
        *,
        category:support_categories(id, nombre),
        subcategory:support_subcategories(id, nombre)
      `)
      .order('created_at', { ascending: false });

    if (tab === 'propios') {
      query = query.eq('user_id', user.id);
    } else if (tab === 'asignados' && agencyId) {
      query = query.eq('agencia_asignada_id', agencyId);
    }

    const { data } = await query;
    const list = data ?? [];
    setTickets(list);
    setLoading(false);

    const ticketParam = searchParams.get('ticket');
    if (ticketParam) {
      const target = list.find(t => t.id === ticketParam);
      if (target) openTicket(target);
    }
  };

  useEffect(() => { fetchTickets(); }, [user, tab, agencyId]);

  const openTicket = async (ticket: SupportTicket) => {
    setSelectedTicket(ticket);
    const [commentsRes, historyRes] = await Promise.all([
      supabase.from('support_ticket_comments')
        .select('*')
        .eq('ticket_id', ticket.id)
        .eq('tipo', 'respuesta_usuario')
        .order('created_at'),
      supabase.from('support_ticket_history')
        .select('*')
        .eq('ticket_id', ticket.id)
        .order('created_at'),
    ]);
    setComments(commentsRes.data ?? []);
    setHistory(historyRes.data ?? []);
    setNewComment('');
  };

  const submitComment = async () => {
    if (!selectedTicket || !newComment.trim() || !user) return;
    setSubmittingComment(true);
    let authorName = user.email as string;
    if (agencyId) {
      const { data: agency } = await supabase
        .from('agencies')
        .select('name')
        .eq('id', agencyId)
        .maybeSingle();
      if (agency?.name) authorName = agency.name;
    }

    await supabase.from('support_ticket_comments').insert({
      ticket_id: selectedTicket.id,
      author_id: user.id,
      author_name: authorName,
      tipo: 'respuesta_usuario',
      contenido: newComment.trim(),
    });
    await supabase.from('support_ticket_history').insert({
      ticket_id: selectedTicket.id,
      tipo_evento: 'comentario_usuario',
      descripcion: newComment.trim(),
      actor_id: user.id,
      actor_name: authorName,
    });
    setNewComment('');
    await openTicket(selectedTicket);
    setSubmittingComment(false);
  };

  const filtered = tickets.filter(t =>
    !search ||
    t.folio.includes(search.toUpperCase()) ||
    (t.category as any)?.nombre?.toLowerCase().includes(search.toLowerCase()) ||
    t.solicitante_nombre.toLowerCase().includes(search.toLowerCase())
  );

  const isClosed = (t: SupportTicket) =>
    t.status === 'resuelto' || t.status === 'cancelado' || t.status === 'duplicado';

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="bg-white border-b border-gray-200">
        <div className="container-custom py-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-secondary-100 rounded-xl flex items-center justify-center">
                <TicketCheck className="h-5 w-5 text-secondary-600" />
              </div>
              <div>
                <h1 className="text-xl font-bold text-gray-900">Soporte</h1>
                <p className="text-sm text-gray-500">{tickets.length} tickets</p>
              </div>
            </div>
            <Link to="/soporte/agencia" className="btn btn-primary flex items-center gap-2">
              <Plus className="h-4 w-4" /> Nuevo ticket
            </Link>
          </div>
        </div>
      </div>

      <div className="container-custom py-6">
        {/* Tabs */}
        <div className="flex border-b border-gray-200 mb-5">
          {[
            { key: 'propios', label: 'Mis Tickets', icon: <Tag className="h-4 w-4" /> },
            { key: 'asignados', label: 'Asignados a mi Agencia', icon: <Building2 className="h-4 w-4" /> },
          ].map(t => (
            <button
              key={t.key}
              onClick={() => setTab(t.key as TabType)}
              className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
                tab === t.key
                  ? 'border-primary-500 text-primary-700'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
              }`}
            >
              {t.icon} {t.label}
            </button>
          ))}
        </div>

        <div className="flex gap-3 mb-5">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
            <input
              type="text"
              placeholder="Buscar por folio, categoria o solicitante..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="input pl-9"
            />
          </div>
          <button onClick={fetchTickets} className="btn btn-secondary flex items-center gap-2">
            <RefreshCw className="h-4 w-4" />
          </button>
        </div>

        {loading ? (
          <div className="flex justify-center py-12">
            <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-primary-600" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-16">
            <TicketCheck className="mx-auto h-12 w-12 text-gray-300 mb-3" />
            <p className="text-gray-500 mb-4">
              {tab === 'asignados' ? 'No hay tickets asignados a tu agencia.' : 'No has creado tickets de soporte.'}
            </p>
            {tab === 'propios' && (
              <Link to="/soporte/agencia" className="btn btn-primary">Crear primer ticket</Link>
            )}
          </div>
        ) : (
          <div className="space-y-3">
            {filtered.map(ticket => (
              <div
                key={ticket.id}
                className="bg-white rounded-xl border border-gray-200 p-4 hover:shadow-sm transition-shadow cursor-pointer"
                onClick={() => openTicket(ticket)}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap mb-1">
                      <span className="font-mono font-bold text-primary-600 text-sm">{ticket.folio}</span>
                      <TicketStatusBadge status={ticket.status} />
                      <TicketPriorityBadge priority={ticket.prioridad} />
                    </div>
                    {tab === 'asignados' && (
                      <p className="text-xs text-gray-500 mb-0.5">Solicitante: {ticket.solicitante_nombre}</p>
                    )}
                    <p className="text-sm font-medium text-gray-800 mb-1">
                      {(ticket.subcategory as any)?.nombre ?? 'Sin subcategoria'}
                    </p>
                    <p className="text-xs text-gray-500 truncate">{ticket.descripcion}</p>
                  </div>
                  <div className="flex flex-col items-end gap-1 flex-shrink-0">
                    <div className="flex items-center gap-1 text-xs text-gray-400">
                      <Clock className="h-3 w-3" />
                      {new Date(ticket.created_at).toLocaleDateString('es-MX')}
                    </div>
                    <Eye className="h-4 w-4 text-gray-400" />
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Detail modal */}
      {selectedTicket && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4">
          <div className="bg-white w-full sm:max-w-2xl sm:rounded-2xl rounded-t-2xl shadow-xl max-h-[90vh] flex flex-col">
            <div className="flex items-center justify-between p-4 border-b border-gray-200">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-mono font-bold text-primary-600">{selectedTicket.folio}</span>
                <TicketStatusBadge status={selectedTicket.status} />
                <TicketPriorityBadge priority={selectedTicket.prioridad} />
              </div>
              <button onClick={() => setSelectedTicket(null)} className="text-gray-400 hover:text-gray-600 text-xl font-bold p-1">×</button>
            </div>

            <div className="flex-1 overflow-y-auto p-4 space-y-4">
              <div className="bg-gray-50 rounded-lg p-3">
                <p className="text-xs text-gray-500 mb-1">
                  {(selectedTicket.category as any)?.nombre} › {(selectedTicket.subcategory as any)?.nombre}
                </p>
                <p className="text-sm text-gray-800">{selectedTicket.descripcion}</p>
                <p className="text-xs text-gray-400 mt-2">
                  Creado: {new Date(selectedTicket.created_at).toLocaleString('es-MX')}
                </p>
              </div>

              <div>
                <h3 className="text-sm font-semibold text-gray-700 mb-3">Historial</h3>
                <TicketTimeline history={history} comments={comments} showInternal={false} />
              </div>

              {!isClosed(selectedTicket) && (
                <div className="border-t border-gray-200 pt-4">
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Agregar informacion o respuesta
                  </label>
                  <textarea
                    value={newComment}
                    onChange={e => setNewComment(e.target.value)}
                    rows={3}
                    className="input resize-none"
                    placeholder="Escribe aqui informacion adicional..."
                  />
                  <button
                    onClick={submitComment}
                    disabled={submittingComment || !newComment.trim()}
                    className="btn btn-primary mt-2 flex items-center gap-2"
                  >
                    {submittingComment ? (
                      <><RefreshCw className="h-4 w-4 animate-spin" /> Enviando...</>
                    ) : (
                      <><MessageCircle className="h-4 w-4" /> Enviar</>
                    )}
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default AgencySupportTickets;
