import React, { useState, useEffect, useCallback } from 'react';
import { Mail, Users, UserMinus, UserCheck, Send, Search, RefreshCw, CheckCheck, Clock, AlertCircle, ChevronDown, ChevronUp, X, Tag } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { format } from 'date-fns';
import RichTextEditor from '../../components/RichTextEditor';

interface NewsletterSubscriber {
  id: string;
  email: string;
  name: string | null;
  subscribed_at: string;
  active: boolean;
  unsubscribed_at: string | null;
  tags: string[] | null;
}

interface NewsletterBroadcast {
  id: string;
  subject: string;
  message_body: string;
  sent_by: string | null;
  recipients_count: number;
  success_count: number;
  error_count: number;
  status: 'sending' | 'completed' | 'failed';
  created_at: string;
}

const PAGE_SIZE = 20;

const AdminNewsletter: React.FC = () => {
  const [subscribers, setSubscribers] = useState<NewsletterSubscriber[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [filterStatus, setFilterStatus] = useState<'all' | 'active' | 'inactive'>('all');
  const [activeCount, setActiveCount] = useState(0);
  const [inactiveCount, setInactiveCount] = useState(0);

  const [broadcasts, setBroadcasts] = useState<NewsletterBroadcast[]>([]);
  const [loadingBroadcasts, setLoadingBroadcasts] = useState(true);
  const [expandedBroadcast, setExpandedBroadcast] = useState<string | null>(null);

  const [showSendModal, setShowSendModal] = useState(false);
  const [sendSubject, setSendSubject] = useState('');
  const [sendMessage, setSendMessage] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [sendResult, setSendResult] = useState<{ success: boolean; message: string; counts?: { recipients: number; success: number; errors: number } } | null>(null);

  const totalPages = Math.ceil(total / PAGE_SIZE);

  const fetchCounts = useCallback(async () => {
    const { count: active } = await supabase
      .from('newsletter_subscriptions')
      .select('id', { count: 'exact', head: true })
      .eq('active', true);
    const { count: inactive } = await supabase
      .from('newsletter_subscriptions')
      .select('id', { count: 'exact', head: true })
      .eq('active', false);
    setActiveCount(active ?? 0);
    setInactiveCount(inactive ?? 0);
  }, []);

  const fetchSubscribers = useCallback(async () => {
    setLoading(true);
    let query = supabase
      .from('newsletter_subscriptions')
      .select('*', { count: 'exact' })
      .order('subscribed_at', { ascending: false })
      .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1);

    if (filterStatus === 'active') query = query.eq('active', true);
    if (filterStatus === 'inactive') query = query.eq('active', false);
    if (search) query = query.or(`email.ilike.%${search}%,name.ilike.%${search}%`);

    const { data, count } = await query;
    setSubscribers(data ?? []);
    setTotal(count ?? 0);
    setLoading(false);
  }, [page, search, filterStatus]);

  const fetchBroadcasts = useCallback(async () => {
    setLoadingBroadcasts(true);
    const { data } = await supabase
      .from('newsletter_broadcasts')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(30);
    setBroadcasts(data ?? []);
    setLoadingBroadcasts(false);
  }, []);

  useEffect(() => { fetchCounts(); }, [fetchCounts]);
  useEffect(() => { fetchSubscribers(); }, [fetchSubscribers]);
  useEffect(() => { fetchBroadcasts(); }, [fetchBroadcasts]);

  const handleSend = async () => {
    if (!sendSubject.trim() || !sendMessage.trim()) return;
    setIsSending(true);
    setSendResult(null);

    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;
      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;

      const response = await fetch(`${supabaseUrl}/functions/v1/send-newsletter-broadcast`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          subject: sendSubject.trim(),
          message_body: sendMessage.trim(),
        }),
      });

      const result = await response.json();

      if (!response.ok || !result.success) {
        setSendResult({ success: false, message: result.error || 'Error al enviar el comunicado' });
      } else {
        setSendResult({
          success: true,
          message: 'Comunicado enviado exitosamente!',
          counts: {
            recipients: result.recipients_count,
            success: result.success_count,
            errors: result.error_count,
          },
        });
        setSendSubject('');
        setSendMessage('');
        fetchBroadcasts();
        fetchCounts();
        setTimeout(() => {
          setShowSendModal(false);
          setSendResult(null);
        }, 2500);
      }
    } catch (err: any) {
      setSendResult({ success: false, message: err.message || 'Error inesperado' });
    } finally {
      setIsSending(false);
    }
  };

  const closeSendModal = () => {
    setShowSendModal(false);
    setSendSubject('');
    setSendMessage('');
    setSendResult(null);
  };

  const getStatusBadge = (status: string) => {
    if (status === 'completed') return <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-green-100 text-green-700"><CheckCheck className="h-3 w-3" />Enviado</span>;
    if (status === 'sending') return <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-yellow-100 text-yellow-700"><Clock className="h-3 w-3" />Enviando</span>;
    return <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-red-100 text-red-700"><AlertCircle className="h-3 w-3" />Fallido</span>;
  };

  const resetFilters = () => {
    setFilterStatus('all');
    setSearch('');
    setPage(0);
  };

  return (
    <div className="container mx-auto px-4 py-8">
      <div className="max-w-6xl mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between mb-8 flex-wrap gap-3">
          <div>
            <h1 className="text-3xl font-bold text-gray-900">Newsletter</h1>
            <p className="text-gray-500 mt-1">Gestiona suscriptores, envia comunicados y revisa el historial.</p>
          </div>
          <button
            onClick={() => setShowSendModal(true)}
            className="btn btn-primary flex items-center gap-2"
          >
            <Send className="h-4 w-4" />
            Enviar comunicado
          </button>
        </div>

        {/* Summary cards */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-8">
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-blue-100 rounded-xl flex items-center justify-center">
                <Users className="h-5 w-5 text-blue-600" />
              </div>
              <div>
                <p className="text-2xl font-bold text-gray-900">{activeCount + inactiveCount}</p>
                <p className="text-xs text-gray-500">Total suscriptores</p>
              </div>
            </div>
          </div>
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-green-100 rounded-xl flex items-center justify-center">
                <UserCheck className="h-5 w-5 text-green-600" />
              </div>
              <div>
                <p className="text-2xl font-bold text-gray-900">{activeCount}</p>
                <p className="text-xs text-gray-500">Activos</p>
              </div>
            </div>
          </div>
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-gray-100 rounded-xl flex items-center justify-center">
                <UserMinus className="h-5 w-5 text-gray-500" />
              </div>
              <div>
                <p className="text-2xl font-bold text-gray-900">{inactiveCount}</p>
                <p className="text-xs text-gray-500">Dados de baja</p>
              </div>
            </div>
          </div>
        </div>

        {/* Subscribers table */}
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden mb-8">
          <div className="px-5 py-4 border-b border-gray-100">
            <h2 className="text-base font-bold text-gray-800 mb-3">Suscriptores</h2>
            <div className="flex gap-3 flex-wrap">
              <div className="relative flex-1 min-w-48">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                <input
                  type="text"
                  placeholder="Buscar por email o nombre..."
                  value={search}
                  onChange={e => { setSearch(e.target.value); setPage(0); }}
                  className="input pl-9 text-sm"
                />
              </div>
              <select
                value={filterStatus}
                onChange={e => { setFilterStatus(e.target.value as any); setPage(0); }}
                className="input text-sm w-auto"
              >
                <option value="all">Todos</option>
                <option value="active">Activos</option>
                <option value="inactive">Dados de baja</option>
              </select>
              <button onClick={fetchSubscribers} className="btn btn-secondary">
                <RefreshCw className="h-4 w-4" />
              </button>
            </div>
          </div>

          {loading ? (
            <div className="flex justify-center py-12">
              <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-primary-600" />
            </div>
          ) : subscribers.length === 0 ? (
            <div className="text-center py-12">
              <Mail className="mx-auto h-10 w-10 text-gray-300 mb-2" />
              <p className="text-gray-400 text-sm">No se encontraron suscriptores con los filtros actuales.</p>
              {(search || filterStatus !== 'all') && (
                <button onClick={resetFilters} className="mt-3 text-sm text-primary-600 hover:text-primary-700">Limpiar filtros</button>
              )}
            </div>
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-gray-50 border-b border-gray-200">
                      <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">Email</th>
                      <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">Nombre</th>
                      <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">Suscripcion</th>
                      <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">Estatus</th>
                      <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">Baja</th>
                      <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">Tags</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {subscribers.map(sub => (
                      <tr key={sub.id} className="hover:bg-gray-50 transition-colors">
                        <td className="px-4 py-3 text-gray-800 font-medium">{sub.email}</td>
                        <td className="px-4 py-3 text-gray-600">{sub.name || '-'}</td>
                        <td className="px-4 py-3 text-gray-400 text-xs">{format(new Date(sub.subscribed_at), 'dd/MM/yyyy')}</td>
                        <td className="px-4 py-3">
                          {sub.active ? (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-green-100 text-green-700">
                              <UserCheck className="h-3 w-3" /> Activo
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-gray-100 text-gray-500">
                              <UserMinus className="h-3 w-3" /> Inactivo
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-gray-400 text-xs">
                          {sub.unsubscribed_at ? format(new Date(sub.unsubscribed_at), 'dd/MM/yyyy') : '-'}
                        </td>
                        <td className="px-4 py-3">
                          {sub.tags && sub.tags.length > 0 ? (
                            <div className="flex gap-1 flex-wrap">
                              {sub.tags.map((tag, i) => (
                                <span key={i} className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-xs bg-blue-50 text-blue-600">
                                  <Tag className="h-2.5 w-2.5" />{tag}
                                </span>
                              ))}
                            </div>
                          ) : (
                            <span className="text-gray-300 text-xs">-</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {totalPages > 1 && (
                <div className="flex items-center justify-between px-5 py-3 border-t border-gray-100">
                  <p className="text-xs text-gray-500">
                    Mostrando {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, total)} de {total}
                  </p>
                  <div className="flex gap-2">
                    <button
                      onClick={() => setPage(p => Math.max(0, p - 1))}
                      disabled={page === 0}
                      className="btn btn-secondary text-sm disabled:opacity-50"
                    >
                      Anterior
                    </button>
                    <button
                      onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))}
                      disabled={page >= totalPages - 1}
                      className="btn btn-secondary text-sm disabled:opacity-50"
                    >
                      Siguiente
                    </button>
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        {/* Broadcast history */}
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5">
          <h2 className="text-lg font-bold text-gray-800 mb-4">Historial de envios</h2>

          {loadingBroadcasts ? (
            <div className="flex justify-center py-8">
              <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-primary-600" />
            </div>
          ) : broadcasts.length === 0 ? (
            <div className="text-center py-8 text-gray-400">
              <Send className="h-10 w-10 mx-auto mb-2 opacity-30" />
              <p className="text-sm">No se han enviado comunicados al newsletter aun.</p>
            </div>
          ) : (
            <div className="space-y-3">
              {broadcasts.map(broadcast => (
                <div key={broadcast.id} className="border border-gray-100 rounded-xl overflow-hidden">
                  <div
                    className="flex items-center justify-between px-4 py-3 cursor-pointer hover:bg-gray-50 transition-colors"
                    onClick={() => setExpandedBroadcast(expandedBroadcast === broadcast.id ? null : broadcast.id)}
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <Mail className="h-5 w-5 text-blue-500 flex-shrink-0" />
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-gray-900 truncate">{broadcast.subject}</p>
                        <p className="text-xs text-gray-500 mt-0.5">
                          {format(new Date(broadcast.created_at), 'dd/MM/yyyy HH:mm')} · {broadcast.recipients_count} destinatarios
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-3 ml-4 flex-shrink-0">
                      {getStatusBadge(broadcast.status)}
                      <span className="text-xs text-green-600 font-medium">{broadcast.success_count} ok</span>
                      {broadcast.error_count > 0 && <span className="text-xs text-red-500 font-medium">{broadcast.error_count} err</span>}
                      {expandedBroadcast === broadcast.id ? <ChevronUp className="h-4 w-4 text-gray-400" /> : <ChevronDown className="h-4 w-4 text-gray-400" />}
                    </div>
                  </div>

                  {expandedBroadcast === broadcast.id && (
                    <div className="border-t border-gray-100 px-4 py-3 bg-gray-50">
                      <div className="bg-white border-l-4 border-blue-400 rounded-r-xl px-4 py-3">
                        <div className="text-sm text-gray-800 prose prose-sm max-w-none" dangerouslySetInnerHTML={{ __html: broadcast.message_body }} />
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Send broadcast modal */}
      {showSendModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
          <div className="bg-white rounded-2xl shadow-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
              <h3 className="text-lg font-bold text-gray-900">Enviar comunicado al newsletter</h3>
              <button onClick={closeSendModal} className="text-gray-400 hover:text-gray-600 transition-colors">
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="px-6 py-5 space-y-4">
              <div className="bg-blue-50 border border-blue-100 rounded-xl px-4 py-3 text-sm text-blue-700 flex items-center gap-2">
                <Users className="h-4 w-4 flex-shrink-0" />
                Se enviara a <strong>{activeCount}</strong> suscriptores activos.
              </div>

              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1">
                  Asunto <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={sendSubject}
                  onChange={e => setSendSubject(e.target.value)}
                  maxLength={150}
                  placeholder="Ej: Nuevas ofertas de viaje para este mes"
                  className="w-full border border-gray-300 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
                />
                <p className="text-xs text-gray-400 mt-1 text-right">{sendSubject.length}/150</p>
              </div>

              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1">
                  Mensaje <span className="text-red-500">*</span>
                </label>
                <RichTextEditor
                  value={sendMessage}
                  onChange={setSendMessage}
                  placeholder="Escribe aqui el contenido del comunicado. Puedes usar negritas, listas, links e imagenes..."
                  minHeight="min-h-48"
                />
              </div>

              {/* Preview */}
              {sendMessage && sendMessage !== '<p></p>' && (
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-1">Vista previa del correo</label>
                  <div className="border border-gray-200 rounded-xl overflow-hidden">
                    <div className="bg-[#b8dfe6] px-4 py-3 text-center">
                      <div style={{ fontSize: '16px', fontWeight: 'bold', color: '#1e40af' }}>Boletin ToursRed</div>
                    </div>
                    <div className="bg-white px-4 py-3">
                      <div style={{ fontSize: '11px', color: '#6b7280', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '6px' }}>{sendSubject || 'Asunto del comunicado'}</div>
                      <div className="bg-gray-50 border-l-4 border-blue-500 rounded-r-lg px-3 py-2 text-sm text-gray-800 prose prose-sm max-w-none" dangerouslySetInnerHTML={{ __html: sendMessage }} />
                    </div>
                    <div className="bg-gray-50 px-4 py-2 text-center text-xs text-gray-400 border-t border-gray-100">
                      Recibes este correo porque estas suscrito al boletin de ToursRed.
                    </div>
                  </div>
                </div>
              )}

              {sendResult && (
                <div className={`rounded-xl px-4 py-3 text-sm ${sendResult.success ? 'bg-green-50 text-green-800 border border-green-200' : 'bg-red-50 text-red-800 border border-red-200'}`}>
                  <p className="font-semibold">{sendResult.message}</p>
                  {sendResult.counts && (
                    <p className="mt-1 text-xs opacity-80">
                      {sendResult.counts.recipients} destinatarios · {sendResult.counts.success} exitosos · {sendResult.counts.errors} fallidos
                    </p>
                  )}
                </div>
              )}

              <div className="bg-yellow-50 border border-yellow-100 rounded-xl px-4 py-3 text-xs text-yellow-700">
                <strong>Importante:</strong> Una vez enviado, el comunicado no se puede deshacer. Cada correo incluira un link de baja al final.
              </div>

              <div className="flex gap-3 pt-2">
                <button onClick={closeSendModal} className="btn btn-secondary flex-1 text-sm">
                  Cancelar
                </button>
                <button
                  onClick={handleSend}
                  disabled={!sendSubject.trim() || !sendMessage.replace(/<[^>]*>/g, '').trim() || isSending}
                  className="btn btn-primary flex-1 text-sm flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {isSending ? (
                    <>
                      <div className="animate-spin rounded-full h-4 w-4 border-t-2 border-b-2 border-white" />
                      Enviando...
                    </>
                  ) : (
                    <>
                      <Send className="h-4 w-4" />
                      Enviar comunicado
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default AdminNewsletter;
