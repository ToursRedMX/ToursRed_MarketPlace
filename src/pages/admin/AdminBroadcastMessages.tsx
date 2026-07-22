import React, { useState, useEffect } from 'react';
import { Send, Users, Building2, Globe, Mail, Bell, BellRing, CheckCheck, Clock, AlertCircle, ChevronDown, ChevronUp, Eye } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../context/AuthContext';
import { format } from 'date-fns';
import RichTextEditor from '../../components/RichTextEditor';

type SendChannel = 'email' | 'notification' | 'both';
type Audience = 'travelers' | 'agencies' | 'all';

interface BroadcastMessage {
  id: string;
  subject: string;
  message_body: string;
  audience: Audience;
  send_channel: SendChannel;
  recipients_count: number;
  success_count: number;
  error_count: number;
  status: 'sending' | 'completed' | 'failed';
  created_at: string;
  sent_by: string;
}

const AUDIENCE_OPTIONS: { value: Audience; label: string; icon: React.ReactNode; desc: string }[] = [
  {
    value: 'travelers',
    label: 'Viajeros',
    icon: <Users className="h-5 w-5" />,
    desc: 'Todos los usuarios con rol de viajero',
  },
  {
    value: 'agencies',
    label: 'Agencias',
    icon: <Building2 className="h-5 w-5" />,
    desc: 'Todos los usuarios con rol de agencia',
  },
  {
    value: 'all',
    label: 'Todos',
    icon: <Globe className="h-5 w-5" />,
    desc: 'Viajeros y agencias (todos los usuarios)',
  },
];

const CHANNEL_OPTIONS: { value: SendChannel; label: string; icon: React.ReactNode; desc: string }[] = [
  {
    value: 'notification',
    label: 'Notificación en plataforma',
    icon: <Bell className="h-5 w-5" />,
    desc: 'Aparece en el icono de campana',
  },
  {
    value: 'email',
    label: 'Correo electrónico',
    icon: <Mail className="h-5 w-5" />,
    desc: 'Se envía al email registrado',
  },
  {
    value: 'both',
    label: 'Ambos canales',
    icon: <BellRing className="h-5 w-5" />,
    desc: 'Notificación + correo electrónico',
  },
];

const AdminBroadcastMessages: React.FC = () => {
  const { user } = useAuth();

  const [subject, setSubject] = useState('');
  const [messageBody, setMessageBody] = useState('');
  const [audience, setAudience] = useState<Audience>('travelers');
  const [sendChannel, setSendChannel] = useState<SendChannel>('both');
  const [isSending, setIsSending] = useState(false);
  const [sendResult, setSendResult] = useState<{ success: boolean; message: string; counts?: { recipients: number; success: number; errors: number } } | null>(null);

  const [history, setHistory] = useState<BroadcastMessage[]>([]);
  const [isLoadingHistory, setIsLoadingHistory] = useState(true);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const [recipientPreview, setRecipientPreview] = useState<number | null>(null);

  useEffect(() => {
    fetchHistory();
  }, []);

  useEffect(() => {
    fetchRecipientCount(audience);
  }, [audience]);

  const fetchRecipientCount = async (aud: Audience) => {
    setRecipientPreview(null);
    const roles = aud === 'travelers' ? ['traveler'] : aud === 'agencies' ? ['agency'] : ['traveler', 'agency'];
    const { count } = await supabase
      .from('users')
      .select('id', { count: 'exact', head: true })
      .in('role', roles)
      .eq('is_active', true);
    setRecipientPreview(count ?? 0);
  };

  const fetchHistory = async () => {
    setIsLoadingHistory(true);
    const { data } = await supabase
      .from('admin_broadcast_messages')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(50);
    setHistory(data || []);
    setIsLoadingHistory(false);
  };

  const handleSend = async () => {
    if (!subject.trim() || !messageBody.replace(/<[^>]*>/g, '').trim()) return;
    setIsSending(true);
    setSendResult(null);

    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;

      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
      const response = await fetch(`${supabaseUrl}/functions/v1/admin-send-broadcast-message`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          subject: subject.trim(),
          message_body: messageBody.trim(),
          audience,
          send_channel: sendChannel,
        }),
      });

      const result = await response.json();

      if (!response.ok || !result.success) {
        setSendResult({ success: false, message: result.error || 'Error al enviar el mensaje' });
      } else {
        setSendResult({
          success: true,
          message: '¡Mensaje enviado exitosamente!',
          counts: {
            recipients: result.recipients_count,
            success: result.success_count,
            errors: result.error_count,
          },
        });
        setSubject('');
        setMessageBody('');
        fetchHistory();
      }
    } catch (err: any) {
      setSendResult({ success: false, message: err.message || 'Error inesperado' });
    } finally {
      setIsSending(false);
    }
  };

  const getAudienceLabel = (aud: Audience) => {
    if (aud === 'travelers') return 'Viajeros';
    if (aud === 'agencies') return 'Agencias';
    return 'Todos';
  };

  const getChannelLabel = (ch: SendChannel) => {
    if (ch === 'email') return 'Email';
    if (ch === 'notification') return 'Notificación';
    return 'Email + Notificación';
  };

  const getStatusBadge = (status: string) => {
    if (status === 'completed') return <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-green-100 text-green-700"><CheckCheck className="h-3 w-3" />Enviado</span>;
    if (status === 'sending') return <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-yellow-100 text-yellow-700"><Clock className="h-3 w-3" />Enviando</span>;
    return <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-red-100 text-red-700"><AlertCircle className="h-3 w-3" />Fallido</span>;
  };

  const canSend = subject.trim().length > 0 && messageBody.replace(/<[^>]*>/g, '').trim().length > 0 && !isSending;

  return (
    <div className="container mx-auto px-4 py-8">
      <div className="max-w-5xl mx-auto">
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-gray-900">Mensajes Masivos</h1>
          <p className="text-gray-500 mt-1">Envía comunicados a viajeros, agencias o todos los usuarios de la plataforma.</p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-5 gap-8">
          {/* Compose panel */}
          <div className="lg:col-span-3 space-y-6">
            <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
              <h2 className="text-base font-bold text-gray-800 mb-5">Redactar mensaje</h2>

              {/* Audience */}
              <div className="mb-5">
                <label className="block text-sm font-semibold text-gray-700 mb-2">Destinatarios</label>
                <div className="grid grid-cols-3 gap-2">
                  {AUDIENCE_OPTIONS.map((opt) => (
                    <button
                      key={opt.value}
                      onClick={() => setAudience(opt.value)}
                      className={`flex flex-col items-center gap-1 p-3 rounded-xl border-2 transition-all text-center ${
                        audience === opt.value
                          ? 'border-primary-500 bg-primary-50 text-primary-700'
                          : 'border-gray-200 hover:border-gray-300 text-gray-600'
                      }`}
                    >
                      {opt.icon}
                      <span className="text-xs font-semibold">{opt.label}</span>
                    </button>
                  ))}
                </div>
                {recipientPreview !== null && (
                  <p className="mt-2 text-xs text-gray-500 flex items-center gap-1">
                    <Users className="h-3 w-3" />
                    {recipientPreview} {recipientPreview === 1 ? 'destinatario' : 'destinatarios'} activos
                  </p>
                )}
              </div>

              {/* Channel */}
              <div className="mb-5">
                <label className="block text-sm font-semibold text-gray-700 mb-2">Canal de envío</label>
                <div className="grid grid-cols-3 gap-2">
                  {CHANNEL_OPTIONS.map((opt) => (
                    <button
                      key={opt.value}
                      onClick={() => setSendChannel(opt.value)}
                      className={`flex flex-col items-center gap-1 p-3 rounded-xl border-2 transition-all text-center ${
                        sendChannel === opt.value
                          ? 'border-primary-500 bg-primary-50 text-primary-700'
                          : 'border-gray-200 hover:border-gray-300 text-gray-600'
                      }`}
                    >
                      {opt.icon}
                      <span className="text-xs font-semibold leading-tight">{opt.label}</span>
                    </button>
                  ))}
                </div>
              </div>

              {/* Subject */}
              <div className="mb-4">
                <label className="block text-sm font-semibold text-gray-700 mb-1">
                  Asunto <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={subject}
                  onChange={(e) => setSubject(e.target.value)}
                  maxLength={150}
                  placeholder="Ej: Mantenimiento programado el viernes 20"
                  className="w-full border border-gray-300 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
                />
                <p className="text-xs text-gray-400 mt-1 text-right">{subject.length}/150</p>
              </div>

              {/* Message body */}
              <div className="mb-5">
                <label className="block text-sm font-semibold text-gray-700 mb-1">
                  Mensaje <span className="text-red-500">*</span>
                </label>
                <RichTextEditor
                  value={messageBody}
                  onChange={setMessageBody}
                  placeholder="Escribe aqui el contenido del mensaje. Puedes usar negritas, listas, links e imagenes..."
                  minHeight="min-h-48"
                />
              </div>

              {/* Result */}
              {sendResult && (
                <div className={`rounded-xl px-4 py-3 mb-4 text-sm ${sendResult.success ? 'bg-green-50 text-green-800 border border-green-200' : 'bg-red-50 text-red-800 border border-red-200'}`}>
                  <p className="font-semibold">{sendResult.message}</p>
                  {sendResult.counts && (
                    <p className="mt-1 text-xs opacity-80">
                      {sendResult.counts.recipients} destinatarios · {sendResult.counts.success} exitosos · {sendResult.counts.errors} fallidos
                    </p>
                  )}
                </div>
              )}

              <button
                onClick={handleSend}
                disabled={!canSend}
                className="w-full btn btn-primary flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isSending ? (
                  <>
                    <div className="animate-spin rounded-full h-4 w-4 border-t-2 border-b-2 border-white" />
                    Enviando...
                  </>
                ) : (
                  <>
                    <Send className="h-4 w-4" />
                    Enviar a {getAudienceLabel(audience)} via {getChannelLabel(sendChannel)}
                  </>
                )}
              </button>
            </div>
          </div>

          {/* Preview panel */}
          <div className="lg:col-span-2 space-y-4">
            <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5">
              <h2 className="text-sm font-bold text-gray-700 mb-3 flex items-center gap-2">
                <Eye className="h-4 w-4 text-gray-400" />
                Vista previa de notificación
              </h2>
              <div className={`rounded-xl border-l-4 border-primary-400 bg-blue-50 p-3 ${!subject && !messageBody ? 'opacity-40' : ''}`}>
                <div className="flex items-center gap-2 mb-1">
                  <Bell className="h-4 w-4 text-primary-600" />
                  <span className="text-sm font-semibold text-gray-900 truncate">{subject || 'Asunto del mensaje'}</span>
                </div>
                <div className="text-xs text-gray-600 line-clamp-3 prose prose-sm max-w-none" dangerouslySetInnerHTML={{ __html: messageBody || 'El contenido del mensaje aparecerá aquí...' }} />
                <p className="text-xs text-gray-400 mt-1">Ahora mismo · ToursRed</p>
              </div>
            </div>

            <div className="bg-blue-50 rounded-2xl border border-blue-100 p-4 text-sm text-blue-800">
              <p className="font-semibold mb-1">Consejos</p>
              <ul className="space-y-1 text-xs text-blue-700 list-disc list-inside">
                <li>Usa un asunto claro y descriptivo.</li>
                <li>Para mantenimientos, indica hora y duración.</li>
                <li>Para promociones, incluye fechas de vigencia.</li>
                <li>El canal "Ambos" garantiza mayor alcance.</li>
              </ul>
            </div>
          </div>
        </div>

        {/* History */}
        <div className="mt-10">
          <h2 className="text-lg font-bold text-gray-800 mb-4">Historial de mensajes</h2>

          {isLoadingHistory ? (
            <div className="flex justify-center py-8">
              <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-primary-600" />
            </div>
          ) : history.length === 0 ? (
            <div className="bg-white rounded-2xl border border-gray-100 p-8 text-center text-gray-400">
              <Send className="h-10 w-10 mx-auto mb-2 opacity-30" />
              <p>No se han enviado mensajes masivos aún.</p>
            </div>
          ) : (
            <div className="space-y-3">
              {history.map((msg) => (
                <div key={msg.id} className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
                  <div
                    className="flex items-center justify-between px-5 py-4 cursor-pointer hover:bg-gray-50 transition-colors"
                    onClick={() => setExpandedId(expandedId === msg.id ? null : msg.id)}
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="flex-shrink-0">
                        {msg.audience === 'travelers' ? <Users className="h-5 w-5 text-blue-500" /> : msg.audience === 'agencies' ? <Building2 className="h-5 w-5 text-emerald-500" /> : <Globe className="h-5 w-5 text-orange-500" />}
                      </div>
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-gray-900 truncate">{msg.subject}</p>
                        <p className="text-xs text-gray-500 mt-0.5">
                          {getAudienceLabel(msg.audience)} · {getChannelLabel(msg.send_channel)} · {format(new Date(msg.created_at), 'dd/MM/yyyy HH:mm')}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-3 ml-4 flex-shrink-0">
                      {getStatusBadge(msg.status)}
                      <span className="text-xs text-gray-400">{msg.recipients_count} dest.</span>
                      {expandedId === msg.id ? <ChevronUp className="h-4 w-4 text-gray-400" /> : <ChevronDown className="h-4 w-4 text-gray-400" />}
                    </div>
                  </div>

                  {expandedId === msg.id && (
                    <div className="border-t border-gray-100 px-5 py-4 bg-gray-50">
                      <div className="flex gap-4 mb-3 text-xs">
                        <span className="text-green-700 font-semibold">{msg.success_count} exitosos</span>
                        {msg.error_count > 0 && <span className="text-red-600 font-semibold">{msg.error_count} fallidos</span>}
                      </div>
                      <div className="bg-white border-l-4 border-primary-400 rounded-r-xl px-4 py-3">
                        <div className="text-sm text-gray-800 prose prose-sm max-w-none" dangerouslySetInnerHTML={{ __html: msg.message_body }} />
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default AdminBroadcastMessages;
