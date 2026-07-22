import React, { useState, useEffect } from 'react';
import { Send, Search, Filter, Eye, X, Users, Calendar, CheckCircle, AlertCircle, Clock, ChevronDown } from 'lucide-react';
import { supabase } from '../../lib/supabase';

interface TourMessage {
  id: string;
  subject: string;
  message_body: string;
  recipients_count: number;
  success_count: number;
  error_count: number;
  status: string;
  created_at: string;
  slot_id: string | null;
  agency_id: string;
  agencies: {
    name: string;
    contact_email: string;
  } | null;
  tours: {
    name: string;
    destination: string;
  } | null;
  tour_slots: {
    slot_date: string;
    departure_time: string;
  } | null;
  sender: {
    first_name: string;
    last_name: string;
    email: string;
  } | null;
}

interface MessageRecipient {
  id: string;
  email: string;
  delivered: boolean;
  delivered_at: string | null;
  error_message: string | null;
  users: {
    first_name: string;
    last_name: string;
  } | null;
  bookings: {
    booking_code: string;
  } | null;
}

const AdminTourMessages: React.FC = () => {
  const [messages, setMessages] = useState<TourMessage[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'completed' | 'failed' | 'sending' | 'pending'>('all');
  const [selectedMessage, setSelectedMessage] = useState<TourMessage | null>(null);
  const [recipients, setRecipients] = useState<MessageRecipient[]>([]);
  const [loadingRecipients, setLoadingRecipients] = useState(false);

  useEffect(() => {
    fetchMessages();
  }, []);

  const fetchMessages = async () => {
    setIsLoading(true);
    setError('');
    try {
      const { data, error: err } = await supabase
        .from('agency_tour_messages')
        .select(`
          id, subject, message_body, recipients_count, success_count, error_count, status, created_at, slot_id, agency_id,
          agencies(name, contact_email),
          tours(name, destination),
          tour_slots(slot_date, departure_time),
          sender:users!agency_tour_messages_sent_by_fkey(first_name, last_name, email)
        `)
        .order('created_at', { ascending: false })
        .limit(200);

      if (err) throw new Error(err.message);
      setMessages(data || []);
    } catch (e: any) {
      setError(e.message || 'Error al cargar mensajes');
    } finally {
      setIsLoading(false);
    }
  };

  const fetchRecipients = async (messageId: string) => {
    setLoadingRecipients(true);
    try {
      const { data, error: err } = await supabase
        .from('agency_tour_message_recipients')
        .select(`
          id, email, delivered, delivered_at, error_message,
          users(first_name, last_name),
          bookings(booking_code)
        `)
        .eq('message_id', messageId)
        .order('created_at', { ascending: true });

      if (!err) setRecipients(data || []);
    } catch (e) {
      console.error('Error loading recipients:', e);
    } finally {
      setLoadingRecipients(false);
    }
  };

  const handleViewMessage = (msg: TourMessage) => {
    setSelectedMessage(msg);
    fetchRecipients(msg.id);
  };

  const filteredMessages = messages.filter(msg => {
    const matchesSearch =
      msg.subject.toLowerCase().includes(searchTerm.toLowerCase()) ||
      msg.message_body.toLowerCase().includes(searchTerm.toLowerCase()) ||
      msg.agencies?.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      msg.tours?.name.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesStatus = statusFilter === 'all' || msg.status === statusFilter;
    return matchesSearch && matchesStatus;
  });

  const statusConfig: Record<string, { label: string; color: string; icon: React.ReactNode }> = {
    completed: { label: 'Enviado', color: 'bg-green-100 text-green-700', icon: <CheckCircle className="h-3.5 w-3.5" /> },
    sending: { label: 'Enviando', color: 'bg-blue-100 text-blue-700', icon: <Clock className="h-3.5 w-3.5" /> },
    failed: { label: 'Error', color: 'bg-red-100 text-red-700', icon: <AlertCircle className="h-3.5 w-3.5" /> },
    pending: { label: 'Pendiente', color: 'bg-yellow-100 text-yellow-700', icon: <Clock className="h-3.5 w-3.5" /> },
  };

  const formatDate = (dateStr: string) =>
    new Date(dateStr).toLocaleDateString('es-MX', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });

  const formatSlotDate = (dateStr: string) =>
    new Date(dateStr + 'T12:00:00').toLocaleDateString('es-MX', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });

  return (
    <div className="container mx-auto px-4 py-8">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Mensajes de Agencias a Asistentes</h1>
          <p className="text-gray-600 mt-1">Auditoria de todos los mensajes masivos enviados por las agencias a sus asistentes.</p>
        </div>
        <div className="flex items-center gap-2 bg-blue-50 text-blue-700 px-4 py-2 rounded-xl text-sm font-medium">
          <Send className="h-4 w-4" />
          {messages.length} mensajes totales
        </div>
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <div className="bg-white rounded-xl shadow-sm p-4 border border-gray-100">
          <div className="text-2xl font-bold text-gray-900">{messages.length}</div>
          <div className="text-sm text-gray-500 mt-0.5">Total mensajes</div>
        </div>
        <div className="bg-white rounded-xl shadow-sm p-4 border border-gray-100">
          <div className="text-2xl font-bold text-green-600">{messages.filter(m => m.status === 'completed').length}</div>
          <div className="text-sm text-gray-500 mt-0.5">Completados</div>
        </div>
        <div className="bg-white rounded-xl shadow-sm p-4 border border-gray-100">
          <div className="text-2xl font-bold text-blue-600">{messages.reduce((s, m) => s + m.success_count, 0)}</div>
          <div className="text-sm text-gray-500 mt-0.5">Emails enviados</div>
        </div>
        <div className="bg-white rounded-xl shadow-sm p-4 border border-gray-100">
          <div className="text-2xl font-bold text-red-500">{messages.reduce((s, m) => s + m.error_count, 0)}</div>
          <div className="text-sm text-gray-500 mt-0.5">Errores de envio</div>
        </div>
      </div>

      {/* Filters */}
      <div className="bg-white rounded-xl shadow-sm p-4 mb-6 border border-gray-100 flex flex-col md:flex-row gap-3">
        <div className="flex-1 relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
          <input
            type="text"
            placeholder="Buscar por asunto, mensaje, agencia o tour..."
            value={searchTerm}
            onChange={e => setSearchTerm(e.target.value)}
            className="pl-10 pr-4 py-2 w-full border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
          />
        </div>
        <div className="flex items-center gap-2">
          <Filter className="h-4 w-4 text-gray-400" />
          <div className="relative">
            <select
              value={statusFilter}
              onChange={e => setStatusFilter(e.target.value as any)}
              className="border border-gray-300 rounded-lg px-3 py-2 pr-8 text-sm appearance-none focus:outline-none focus:ring-2 focus:ring-primary-500 bg-white"
            >
              <option value="all">Todos los estados</option>
              <option value="completed">Enviados</option>
              <option value="sending">Enviando</option>
              <option value="failed">Con error</option>
              <option value="pending">Pendientes</option>
            </select>
            <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-gray-400 pointer-events-none" />
          </div>
        </div>
      </div>

      {error && (
        <div className="mb-4 bg-red-50 text-red-700 p-4 rounded-xl flex items-center gap-2">
          <AlertCircle className="h-5 w-5 flex-shrink-0" />
          {error}
        </div>
      )}

      {isLoading ? (
        <div className="flex justify-center py-16">
          <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-primary-600"></div>
        </div>
      ) : filteredMessages.length === 0 ? (
        <div className="bg-white rounded-xl shadow-sm p-12 text-center border border-gray-100">
          <Send className="h-12 w-12 text-gray-300 mx-auto mb-4" />
          <p className="text-lg font-medium text-gray-600">No se encontraron mensajes</p>
          <p className="text-sm text-gray-400 mt-1">
            {searchTerm || statusFilter !== 'all' ? 'Intenta ajustar los filtros de busqueda.' : 'Las agencias aun no han enviado mensajes masivos a sus asistentes.'}
          </p>
        </div>
      ) : (
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-5 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Agencia / Tour</th>
                <th className="px-5 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Asunto</th>
                <th className="px-5 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Alcance</th>
                <th className="px-5 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Estado</th>
                <th className="px-5 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Fecha</th>
                <th className="px-5 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {filteredMessages.map(msg => {
                const sc = statusConfig[msg.status] || { label: msg.status, color: 'bg-gray-100 text-gray-700', icon: null };
                return (
                  <tr key={msg.id} className="hover:bg-gray-50 transition-colors">
                    <td className="px-5 py-4">
                      <div className="font-semibold text-gray-900 text-sm">{msg.agencies?.name || '—'}</div>
                      <div className="text-xs text-gray-500 mt-0.5">{msg.tours?.name || '—'}</div>
                    </td>
                    <td className="px-5 py-4 max-w-xs">
                      <div className="text-sm font-medium text-gray-800 truncate">{msg.subject}</div>
                      <div className="text-xs text-gray-400 mt-0.5 truncate">{msg.message_body.substring(0, 60)}…</div>
                    </td>
                    <td className="px-5 py-4">
                      {msg.slot_id && msg.tour_slots ? (
                        <div className="flex items-center gap-1 text-xs text-gray-600">
                          <Calendar className="h-3.5 w-3.5 text-gray-400" />
                          {formatSlotDate(msg.tour_slots.slot_date)}
                          {msg.tour_slots.departure_time && <span className="text-gray-400">· {msg.tour_slots.departure_time}</span>}
                        </div>
                      ) : (
                        <div className="flex items-center gap-1 text-xs text-gray-600">
                          <Users className="h-3.5 w-3.5 text-gray-400" />
                          Todos los asistentes
                        </div>
                      )}
                      <div className="text-xs text-gray-400 mt-0.5">
                        {msg.success_count} enviados{msg.error_count > 0 && <span className="text-red-400"> · {msg.error_count} errores</span>}
                      </div>
                    </td>
                    <td className="px-5 py-4">
                      <span className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium ${sc.color}`}>
                        {sc.icon}
                        {sc.label}
                      </span>
                    </td>
                    <td className="px-5 py-4 text-xs text-gray-500">{formatDate(msg.created_at)}</td>
                    <td className="px-5 py-4">
                      <button
                        onClick={() => handleViewMessage(msg)}
                        className="flex items-center gap-1.5 text-xs font-medium text-primary-600 hover:text-primary-800 transition-colors"
                      >
                        <Eye className="h-4 w-4" />
                        Ver detalle
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Detail modal */}
      {selectedMessage && (
        <div className="fixed inset-0 z-50 overflow-y-auto">
          <div className="flex items-start justify-center min-h-screen px-4 py-8">
            <div className="fixed inset-0 bg-black bg-opacity-50" onClick={() => setSelectedMessage(null)} />
            <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-2xl mx-auto mt-4">
              <div className="flex items-center justify-between px-6 py-5 border-b border-gray-100">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-blue-50 flex items-center justify-center">
                    <Send className="h-5 w-5 text-blue-600" />
                  </div>
                  <div>
                    <h2 className="text-lg font-bold text-gray-900">Detalle del Mensaje</h2>
                    <p className="text-xs text-gray-500">{selectedMessage.agencies?.name}</p>
                  </div>
                </div>
                <button onClick={() => setSelectedMessage(null)} className="p-2 hover:bg-gray-100 rounded-lg">
                  <X className="h-5 w-5 text-gray-500" />
                </button>
              </div>

              <div className="px-6 py-5 space-y-5 max-h-[70vh] overflow-y-auto">
                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div>
                    <p className="text-xs text-gray-500 font-medium uppercase tracking-wide mb-1">Agencia</p>
                    <p className="font-semibold text-gray-900">{selectedMessage.agencies?.name}</p>
                    <p className="text-gray-500 text-xs">{selectedMessage.agencies?.contact_email}</p>
                  </div>
                  <div>
                    <p className="text-xs text-gray-500 font-medium uppercase tracking-wide mb-1">Tour</p>
                    <p className="font-semibold text-gray-900">{selectedMessage.tours?.name}</p>
                    <p className="text-gray-500 text-xs">{selectedMessage.tours?.destination}</p>
                  </div>
                  <div>
                    <p className="text-xs text-gray-500 font-medium uppercase tracking-wide mb-1">Enviado por</p>
                    <p className="font-semibold text-gray-900">
                      {selectedMessage.sender ? `${selectedMessage.sender.first_name} ${selectedMessage.sender.last_name}` : '—'}
                    </p>
                    <p className="text-gray-500 text-xs">{selectedMessage.sender?.email}</p>
                  </div>
                  <div>
                    <p className="text-xs text-gray-500 font-medium uppercase tracking-wide mb-1">Fecha de envio</p>
                    <p className="font-semibold text-gray-900">{formatDate(selectedMessage.created_at)}</p>
                  </div>
                  {selectedMessage.slot_id && selectedMessage.tour_slots && (
                    <div className="col-span-2">
                      <p className="text-xs text-gray-500 font-medium uppercase tracking-wide mb-1">Fecha / Slot</p>
                      <p className="font-semibold text-gray-900">
                        {formatSlotDate(selectedMessage.tour_slots.slot_date)}
                        {selectedMessage.tour_slots.departure_time && ` · ${selectedMessage.tour_slots.departure_time}`}
                      </p>
                    </div>
                  )}
                </div>

                <div className="border-t border-gray-100 pt-4">
                  <p className="text-xs text-gray-500 font-medium uppercase tracking-wide mb-2">Asunto</p>
                  <p className="text-gray-900 font-semibold">{selectedMessage.subject}</p>
                </div>

                <div>
                  <p className="text-xs text-gray-500 font-medium uppercase tracking-wide mb-2">Contenido del mensaje</p>
                  <div className="bg-gray-50 border border-gray-200 rounded-xl p-4 text-sm text-gray-700 whitespace-pre-wrap leading-relaxed">
                    {selectedMessage.message_body}
                  </div>
                </div>

                <div className="border-t border-gray-100 pt-4">
                  <div className="flex items-center justify-between mb-3">
                    <p className="text-xs text-gray-500 font-medium uppercase tracking-wide">Destinatarios ({selectedMessage.recipients_count})</p>
                    <div className="flex items-center gap-3 text-xs">
                      <span className="text-green-600 font-medium">{selectedMessage.success_count} enviados</span>
                      {selectedMessage.error_count > 0 && (
                        <span className="text-red-500 font-medium">{selectedMessage.error_count} errores</span>
                      )}
                    </div>
                  </div>
                  {loadingRecipients ? (
                    <div className="flex justify-center py-6">
                      <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-primary-600" />
                    </div>
                  ) : (
                    <div className="space-y-2 max-h-64 overflow-y-auto">
                      {recipients.map(r => (
                        <div key={r.id} className="flex items-center justify-between py-2 px-3 bg-gray-50 rounded-lg text-sm">
                          <div>
                            <span className="font-medium text-gray-800">
                              {r.users ? `${r.users.first_name} ${r.users.last_name}` : r.email}
                            </span>
                            <span className="text-gray-400 text-xs ml-2">{r.email}</span>
                            {r.bookings?.booking_code && (
                              <span className="text-gray-400 text-xs ml-2">#{r.bookings.booking_code}</span>
                            )}
                          </div>
                          <div>
                            {r.delivered ? (
                              <span className="inline-flex items-center gap-1 text-xs text-green-600">
                                <CheckCircle className="h-3.5 w-3.5" />
                                Entregado
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1 text-xs text-red-500">
                                <AlertCircle className="h-3.5 w-3.5" />
                                Error
                              </span>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default AdminTourMessages;
