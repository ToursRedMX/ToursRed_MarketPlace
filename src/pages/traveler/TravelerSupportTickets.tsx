import React, { useState, useEffect } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Plus, TicketCheck, Search, RefreshCw, Eye, MessageCircle, Clock } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../context/AuthContext';
import { SupportTicket, SupportTicketComment, SupportTicketHistoryEvent } from '../../types';
import TicketStatusBadge from '../../components/support/TicketStatusBadge';
import TicketPriorityBadge from '../../components/support/TicketPriorityBadge';
import TicketTimeline from '../../components/support/TicketTimeline';

const TravelerSupportTickets: React.FC = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
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
    const { data } = await supabase
      .from('support_tickets')
      .select(`
        *,
        category:support_categories(id, nombre),
        subcategory:support_subcategories(id, nombre)
      `)
      .eq('user_id', user.id)
      .order('created_at', { ascending: false });
    const list = data ?? [];
    setTickets(list);
    setLoading(false);

    const ticketParam = searchParams.get('ticket');
    if (ticketParam) {
      const target = list.find(t => t.id === ticketParam);
      if (target) openTicket(target);
    }
  };

  useEffect(() => { fetchTickets(); }, [user]);

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
    const { data: profile } = await supabase
      .from('users')
      .select('first_name, last_name')
      .eq('id', user.id)
      .maybeSingle();
    const authorName = profile ? `${profile.first_name} ${profile.last_name}` : user.email;

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
    !search || t.folio.includes(search.toUpperCase()) ||
    (t.category as any)?.nombre?.toLowerCase().includes(search.toLowerCase()) ||
    (t.subcategory as any)?.nombre?.toLowerCase().includes(search.toLowerCase())
  );

  const isClosed = (t: SupportTicket) =>
    t.status === 'resuelto' || t.status === 'cancelado' || t.status === 'duplicado';

  const slaRemaining = (ticket: SupportTicket) => {
    if (!ticket.subcategory) return null;
    const sla = (ticket.subcategory as any).sla_horas ?? 24;
    const created = new Date(ticket.created_at).getTime();
    const deadline = created + sla * 3600 * 1000;
    const remaining = deadline - Date.now();
    if (remaining <= 0) return 'Vencido';
    const hours = Math.floor(remaining / 3600000);
    if (hours < 1) return '< 1 hora';
    if (hours < 24) return `${hours}h restantes`;
    return `${Math.floor(hours / 24)}d restantes`;
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="bg-white border-b border-gray-200">
        <div className="container-custom py-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-primary-100 rounded-xl flex items-center justify-center">
                <TicketCheck className="h-5 w-5 text-primary-600" />
              </div>
              <div>
                <h1 className="text-xl font-bold text-gray-900">Mis Tickets de Soporte</h1>
                <p className="text-sm text-gray-500">{tickets.length} tickets en total</p>
              </div>
            </div>
            <Link to="/soporte/viajero" className="btn btn-primary flex items-center gap-2">
              <Plus className="h-4 w-4" /> Nuevo ticket
            </Link>
          </div>
        </div>
      </div>

      <div className="container-custom py-6">
        <div className="flex gap-3 mb-5">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
            <input
              type="text"
              placeholder="Buscar por folio o categoria..."
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
            <p className="text-gray-500 mb-4">No tienes tickets de soporte aun.</p>
            <Link to="/soporte/viajero" className="btn btn-primary">Crear primer ticket</Link>
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
                    {!isClosed(ticket) && (
                      <span className="text-xs text-blue-600">{slaRemaining(ticket)}</span>
                    )}
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
                    Agregar informacion adicional
                  </label>
                  <textarea
                    value={newComment}
                    onChange={e => setNewComment(e.target.value)}
                    rows={3}
                    className="input resize-none"
                    placeholder="Escribe aqui si tienes informacion adicional que agregar..."
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

export default TravelerSupportTickets;
