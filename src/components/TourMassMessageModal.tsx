import React, { useState, useEffect } from 'react';
import { X, Send, Users, Calendar, ChevronDown, AlertCircle, CheckCircle, MessageSquare, Info, Mail, Bell, Layers } from 'lucide-react';
import { supabase } from '../lib/supabase';

interface TourOption {
  id: string;
  name: string;
  destination: string;
  start_date: string | null;
  end_date: string | null;
  tour_type: string | null;
}

interface SlotOption {
  id: string;
  slot_date: string;
  departure_time: string;
  booked_count: number;
}

interface TourMassMessageModalProps {
  open: boolean;
  onClose: () => void;
  agencyId: string;
  tours: TourOption[];
  preselectedTourId?: string | null;
  preselectedSlotId?: string | null;
}

type Step = 'scope' | 'compose' | 'confirm';
type SendChannel = 'email' | 'notification' | 'both';

const CHANNEL_OPTIONS: { value: SendChannel; label: string; description: string; icon: React.ReactNode }[] = [
  {
    value: 'email',
    label: 'Solo email',
    description: 'Envía un correo al viajero',
    icon: <Mail className="h-5 w-5" />,
  },
  {
    value: 'notification',
    label: 'Notificación en app',
    description: 'Aparece en la campanita',
    icon: <Bell className="h-5 w-5" />,
  },
  {
    value: 'both',
    label: 'Email y notificación',
    description: 'Ambos canales a la vez',
    icon: <Layers className="h-5 w-5" />,
  },
];

const TourMassMessageModal: React.FC<TourMassMessageModalProps> = ({
  open,
  onClose,
  agencyId,
  tours,
  preselectedTourId,
  preselectedSlotId,
}) => {
  const [step, setStep] = useState<Step>('scope');
  const [selectedTourId, setSelectedTourId] = useState<string>(preselectedTourId || '');
  const [scopeType, setScopeType] = useState<'all' | 'slot'>('all');
  const [selectedSlotId, setSelectedSlotId] = useState<string>(preselectedSlotId || '');
  const [slots, setSlots] = useState<SlotOption[]>([]);
  const [loadingSlots, setLoadingSlots] = useState(false);
  const [recipientCount, setRecipientCount] = useState<number | null>(null);
  const [loadingCount, setLoadingCount] = useState(false);
  const [sendChannel, setSendChannel] = useState<SendChannel>('both');
  const [subject, setSubject] = useState('');
  const [messageBody, setMessageBody] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [sendResult, setSendResult] = useState<{ success: boolean; successCount: number; errorCount: number } | null>(null);

  const selectedTour = tours.find(t => t.id === selectedTourId) || null;
  const isReceptivo = selectedTour ? (!selectedTour.start_date && !selectedTour.end_date) || selectedTour.tour_type === 'receptivo' : false;

  useEffect(() => {
    if (!open) {
      setStep('scope');
      setSelectedTourId(preselectedTourId || '');
      setScopeType('all');
      setSelectedSlotId(preselectedSlotId || '');
      setSlots([]);
      setRecipientCount(null);
      setSendChannel('both');
      setSubject('');
      setMessageBody('');
      setIsSending(false);
      setSendResult(null);
    }
  }, [open, preselectedTourId, preselectedSlotId]);

  useEffect(() => {
    if (selectedTourId && isReceptivo) {
      loadSlots();
    } else {
      setSlots([]);
      setSelectedSlotId('');
    }
  }, [selectedTourId, isReceptivo]);

  useEffect(() => {
    if (selectedTourId) {
      loadRecipientCount(selectedTourId, scopeType, selectedSlotId);
    } else {
      setRecipientCount(null);
    }
  }, [selectedTourId, scopeType, selectedSlotId]);

  const loadSlots = async () => {
    if (!selectedTourId) return;
    setLoadingSlots(true);
    try {
      const { data, error } = await supabase
        .from('tour_slots')
        .select('id, slot_date, departure_time, booked_count')
        .eq('tour_id', selectedTourId)
        .order('slot_date', { ascending: true });

      if (!error && data) {
        setSlots(data.filter(s => (s.booked_count ?? 0) > 0));
      }
    } catch (err) {
      console.error('Error loading slots:', err);
    } finally {
      setLoadingSlots(false);
    }
  };

  const loadRecipientCount = async (tourId: string, scope: 'all' | 'slot', slotId: string) => {
    if (!tourId) return;
    setLoadingCount(true);
    try {
      const resolvedSlotId = scope === 'slot' && slotId ? slotId : null;
      const { data, error } = await supabase.rpc('get_tour_confirmed_attendees', {
        p_tour_id: tourId,
        p_slot_id: resolvedSlotId,
      });

      if (!error) {
        setRecipientCount((data || []).length);
      }
    } catch (err) {
      console.error('Error counting recipients:', err);
    } finally {
      setLoadingCount(false);
    }
  };

  const handleNextFromScope = () => {
    if (!selectedTourId) return;
    if (scopeType === 'slot' && !selectedSlotId) return;
    setStep('compose');
  };

  const handleNextFromCompose = () => {
    if (!messageBody.trim()) return;
    if ((sendChannel === 'email' || sendChannel === 'both') && !subject.trim()) return;
    setStep('confirm');
    loadRecipientCount(selectedTourId, scopeType, selectedSlotId);
  };

  const handleSend = async () => {
    setIsSending(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error('No hay sesión activa');

      const response = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/send-tour-mass-message`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${session.access_token}`,
          },
          body: JSON.stringify({
            agency_id: agencyId,
            tour_id: selectedTourId,
            slot_id: scopeType === 'slot' && selectedSlotId ? selectedSlotId : null,
            subject: subject.trim(),
            message_body: messageBody.trim(),
            send_channel: sendChannel,
          }),
        }
      );

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || 'Error al enviar el mensaje');
      }

      setSendResult({
        success: true,
        successCount: result.success_count,
        errorCount: result.error_count,
      });
    } catch (err: any) {
      setSendResult({ success: false, successCount: 0, errorCount: recipientCount || 0 });
      console.error('Error sending mass message:', err);
    } finally {
      setIsSending(false);
    }
  };

  const formatSlotDate = (dateStr: string) => {
    const d = new Date(dateStr + 'T12:00:00');
    return d.toLocaleDateString('es-MX', { weekday: 'short', year: 'numeric', month: 'short', day: 'numeric' });
  };

  const selectedSlot = slots.find(s => s.id === selectedSlotId) || null;
  const needsSubject = sendChannel === 'email' || sendChannel === 'both';
  const composeValid = messageBody.trim() && (!needsSubject || subject.trim());

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto">
      <div className="flex items-center justify-center min-h-screen px-4 py-8">
        <div className="fixed inset-0 bg-black bg-opacity-50" />
        <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-xl mx-auto">

          {/* Header */}
          <div className="flex items-center justify-between px-6 py-5 border-b border-gray-100">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-blue-50 flex items-center justify-center">
                <MessageSquare className="h-5 w-5 text-blue-600" />
              </div>
              <div>
                <h2 className="text-lg font-bold text-gray-900">Mensaje a Asistentes</h2>
                <p className="text-xs text-gray-500">
                  {step === 'scope' && 'Selecciona el alcance del mensaje'}
                  {step === 'compose' && 'Redacta tu mensaje'}
                  {step === 'confirm' && 'Confirma y envía'}
                </p>
              </div>
            </div>
            <button onClick={onClose} className="p-2 hover:bg-gray-100 rounded-lg transition-colors">
              <X className="h-5 w-5 text-gray-500" />
            </button>
          </div>

          {/* Step indicators */}
          {!sendResult && (
            <div className="flex items-center px-6 pt-4 pb-2 gap-2">
              {(['scope', 'compose', 'confirm'] as Step[]).map((s, i) => (
                <React.Fragment key={s}>
                  <div className={`flex items-center gap-1.5 ${step === s ? 'text-blue-600' : step > s ? 'text-green-600' : 'text-gray-400'}`}>
                    <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold border-2 ${step === s ? 'border-blue-600 bg-blue-50 text-blue-600' : step > s ? 'border-green-500 bg-green-50 text-green-600' : 'border-gray-300 text-gray-400'}`}>
                      {(['scope', 'compose'].includes(s) && step > s) ? <CheckCircle className="w-3.5 h-3.5" /> : i + 1}
                    </div>
                    <span className="text-xs font-medium hidden sm:inline">
                      {s === 'scope' ? 'Alcance' : s === 'compose' ? 'Mensaje' : 'Enviar'}
                    </span>
                  </div>
                  {i < 2 && <div className={`flex-1 h-0.5 ${step > s ? 'bg-green-400' : 'bg-gray-200'}`} />}
                </React.Fragment>
              ))}
            </div>
          )}

          <div className="px-6 py-5">
            {/* RESULT STATE */}
            {sendResult && (
              <div className="text-center py-6">
                {sendResult.success ? (
                  <>
                    <div className="w-16 h-16 rounded-full bg-green-100 flex items-center justify-center mx-auto mb-4">
                      <CheckCircle className="h-9 w-9 text-green-600" />
                    </div>
                    <h3 className="text-xl font-bold text-gray-900 mb-2">Mensajes enviados</h3>
                    <p className="text-gray-600 mb-4">
                      Se enviaron <strong>{sendResult.successCount}</strong> mensaje{sendResult.successCount !== 1 ? 's' : ''} exitosamente.
                      {sendResult.errorCount > 0 && <span className="text-orange-600"> {sendResult.errorCount} fallaron.</span>}
                    </p>
                    <button onClick={onClose} className="btn btn-primary">Cerrar</button>
                  </>
                ) : (
                  <>
                    <div className="w-16 h-16 rounded-full bg-red-100 flex items-center justify-center mx-auto mb-4">
                      <AlertCircle className="h-9 w-9 text-red-600" />
                    </div>
                    <h3 className="text-xl font-bold text-gray-900 mb-2">Error al enviar</h3>
                    <p className="text-gray-600 mb-4">No se pudieron enviar los mensajes. Intenta de nuevo más tarde.</p>
                    <button onClick={onClose} className="btn btn-outline">Cerrar</button>
                  </>
                )}
              </div>
            )}

            {/* STEP 1: SCOPE */}
            {!sendResult && step === 'scope' && (
              <div className="space-y-5">
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-2">Tour</label>
                  <div className="relative">
                    <select
                      value={selectedTourId}
                      onChange={e => { setSelectedTourId(e.target.value); setScopeType('all'); setSelectedSlotId(''); }}
                      className="w-full border border-gray-300 rounded-lg px-4 py-2.5 pr-10 appearance-none focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-sm bg-white"
                    >
                      <option value="">Selecciona un tour...</option>
                      {tours.map(t => (
                        <option key={t.id} value={t.id}>{t.name}</option>
                      ))}
                    </select>
                    <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400 pointer-events-none" />
                  </div>
                </div>

                {selectedTourId && (
                  <div>
                    <label className="block text-sm font-semibold text-gray-700 mb-2">Alcance del mensaje</label>
                    <div className="grid grid-cols-2 gap-3">
                      <button
                        onClick={() => { setScopeType('all'); setSelectedSlotId(''); }}
                        className={`flex flex-col items-center gap-2 p-4 rounded-xl border-2 transition-all text-left ${scopeType === 'all' ? 'border-blue-500 bg-blue-50' : 'border-gray-200 hover:border-gray-300'}`}
                      >
                        <Users className={`h-6 w-6 ${scopeType === 'all' ? 'text-blue-600' : 'text-gray-400'}`} />
                        <span className={`text-sm font-semibold ${scopeType === 'all' ? 'text-blue-700' : 'text-gray-600'}`}>Todos los asistentes</span>
                        <span className="text-xs text-gray-500 text-center">Sin importar la fecha</span>
                      </button>
                      <button
                        onClick={() => setScopeType('slot')}
                        className={`flex flex-col items-center gap-2 p-4 rounded-xl border-2 transition-all text-left ${scopeType === 'slot' ? 'border-blue-500 bg-blue-50' : 'border-gray-200 hover:border-gray-300'} ${!isReceptivo ? 'opacity-50 cursor-not-allowed' : ''}`}
                        disabled={!isReceptivo}
                      >
                        <Calendar className={`h-6 w-6 ${scopeType === 'slot' ? 'text-blue-600' : 'text-gray-400'}`} />
                        <span className={`text-sm font-semibold ${scopeType === 'slot' ? 'text-blue-700' : 'text-gray-600'}`}>Fecha / Slot especifico</span>
                        <span className="text-xs text-gray-500 text-center">Solo asistentes de esa fecha</span>
                      </button>
                    </div>
                    {!isReceptivo && (
                      <p className="text-xs text-gray-400 mt-2 flex items-center gap-1">
                        <Info className="h-3.5 w-3.5" />
                        La seleccion por slot aplica solo a tours de tipo receptivo
                      </p>
                    )}
                  </div>
                )}

                {selectedTourId && scopeType === 'slot' && isReceptivo && (
                  <div>
                    <label className="block text-sm font-semibold text-gray-700 mb-2">Selecciona la fecha / slot</label>
                    {loadingSlots ? (
                      <div className="flex items-center gap-2 text-sm text-gray-500 py-2">
                        <div className="animate-spin rounded-full h-4 w-4 border-t-2 border-blue-500" />
                        Cargando fechas...
                      </div>
                    ) : slots.length === 0 ? (
                      <p className="text-sm text-gray-500 italic">No hay slots activos para este tour.</p>
                    ) : (
                      <div className="relative">
                        <select
                          value={selectedSlotId}
                          onChange={e => setSelectedSlotId(e.target.value)}
                          className="w-full border border-gray-300 rounded-lg px-4 py-2.5 pr-10 appearance-none focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-sm bg-white"
                        >
                          <option value="">Selecciona una fecha...</option>
                          {slots.map(s => (
                            <option key={s.id} value={s.id}>
                              {formatSlotDate(s.slot_date)}{s.departure_time ? ` · ${s.departure_time}` : ''} ({s.booked_count} confirmados)
                            </option>
                          ))}
                        </select>
                        <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400 pointer-events-none" />
                      </div>
                    )}
                  </div>
                )}

                {selectedTourId && (
                  <div className="bg-gray-50 rounded-xl p-4 flex items-center gap-3">
                    <Users className="h-5 w-5 text-blue-500 flex-shrink-0" />
                    {loadingCount ? (
                      <span className="text-sm text-gray-500">Contando asistentes...</span>
                    ) : recipientCount !== null ? (
                      <span className="text-sm text-gray-700">
                        <strong className="text-blue-700">{recipientCount}</strong> {recipientCount === 1 ? 'asistente confirmado' : 'asistentes confirmados'} recibirán este mensaje
                      </span>
                    ) : (
                      <span className="text-sm text-gray-400">Selecciona un tour para ver los destinatarios</span>
                    )}
                  </div>
                )}

                <div className="flex justify-end pt-2">
                  <button
                    onClick={handleNextFromScope}
                    disabled={!selectedTourId || (scopeType === 'slot' && !selectedSlotId) || recipientCount === 0}
                    className="btn btn-primary disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    Continuar
                  </button>
                </div>
              </div>
            )}

            {/* STEP 2: COMPOSE */}
            {!sendResult && step === 'compose' && (
              <div className="space-y-5">
                {/* Channel selector */}
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-2">Canal de envío</label>
                  <div className="grid grid-cols-3 gap-2">
                    {CHANNEL_OPTIONS.map(opt => (
                      <button
                        key={opt.value}
                        type="button"
                        onClick={() => setSendChannel(opt.value)}
                        className={`flex flex-col items-center gap-1.5 p-3 rounded-xl border-2 transition-all text-center ${
                          sendChannel === opt.value
                            ? 'border-blue-500 bg-blue-50'
                            : 'border-gray-200 hover:border-gray-300'
                        }`}
                      >
                        <span className={sendChannel === opt.value ? 'text-blue-600' : 'text-gray-400'}>
                          {opt.icon}
                        </span>
                        <span className={`text-xs font-semibold leading-tight ${sendChannel === opt.value ? 'text-blue-700' : 'text-gray-600'}`}>
                          {opt.label}
                        </span>
                        <span className="text-[10px] text-gray-400 leading-tight">{opt.description}</span>
                      </button>
                    ))}
                  </div>
                </div>

                <div className="bg-blue-50 rounded-xl p-3 flex items-start gap-2">
                  <Info className="h-4 w-4 text-blue-500 flex-shrink-0 mt-0.5" />
                  <p className="text-xs text-blue-700">
                    {sendChannel === 'email' && 'Se enviará un correo electrónico a cada asistente.'}
                    {sendChannel === 'notification' && 'Aparecerá una notificación en la campanita dentro de la app.'}
                    {sendChannel === 'both' && 'Los asistentes recibirán tanto un email como una notificación en la app.'}
                  </p>
                </div>

                {needsSubject && (
                  <div>
                    <label className="block text-sm font-semibold text-gray-700 mb-1.5">
                      Asunto del email <span className="text-red-500">*</span>
                    </label>
                    <input
                      type="text"
                      value={subject}
                      onChange={e => setSubject(e.target.value)}
                      placeholder="Ej: Informacion importante sobre tu tour"
                      className="w-full border border-gray-300 rounded-lg px-4 py-2.5 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-sm"
                      maxLength={120}
                    />
                    <p className="text-xs text-gray-400 mt-1 text-right">{subject.length}/120</p>
                  </div>
                )}

                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-1.5">
                    Mensaje <span className="text-red-500">*</span>
                  </label>
                  <textarea
                    value={messageBody}
                    onChange={e => setMessageBody(e.target.value)}
                    placeholder="Escribe aqui tu mensaje para los asistentes...&#10;&#10;Puedes incluir:&#10;- Enlace al grupo de WhatsApp&#10;- Punto de encuentro&#10;- Que llevar / vestimenta&#10;- Cualquier cambio de ultima hora"
                    rows={7}
                    className="w-full border border-gray-300 rounded-lg px-4 py-3 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-sm resize-none"
                    maxLength={2000}
                  />
                  <p className="text-xs text-gray-400 mt-1 text-right">{messageBody.length}/2000</p>
                </div>

                <div className="flex justify-between pt-2">
                  <button onClick={() => setStep('scope')} className="btn btn-outline">
                    Atras
                  </button>
                  <button
                    onClick={handleNextFromCompose}
                    disabled={!composeValid}
                    className="btn btn-primary disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    Revisar y enviar
                  </button>
                </div>
              </div>
            )}

            {/* STEP 3: CONFIRM */}
            {!sendResult && step === 'confirm' && (
              <div className="space-y-5">
                <div className="space-y-3">
                  <div className="bg-gray-50 rounded-xl p-4 space-y-2 text-sm">
                    <div className="flex justify-between">
                      <span className="text-gray-500">Tour:</span>
                      <span className="font-semibold text-gray-800">{selectedTour?.name}</span>
                    </div>
                    {scopeType === 'slot' && selectedSlot && (
                      <div className="flex justify-between">
                        <span className="text-gray-500">Fecha:</span>
                        <span className="font-semibold text-gray-800">
                          {formatSlotDate(selectedSlot.slot_date)}
                          {selectedSlot.departure_time && ` · ${selectedSlot.departure_time}`}
                        </span>
                      </div>
                    )}
                    {scopeType === 'all' && (
                      <div className="flex justify-between">
                        <span className="text-gray-500">Alcance:</span>
                        <span className="font-semibold text-gray-800">Todos los asistentes confirmados</span>
                      </div>
                    )}
                    <div className="flex justify-between">
                      <span className="text-gray-500">Canal:</span>
                      <span className="font-semibold text-gray-800">
                        {sendChannel === 'email' && 'Solo email'}
                        {sendChannel === 'notification' && 'Notificación en app'}
                        {sendChannel === 'both' && 'Email y notificación'}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-500">Destinatarios:</span>
                      <span className="font-bold text-blue-700">
                        {loadingCount ? '...' : `${recipientCount ?? 0} ${(recipientCount ?? 0) === 1 ? 'persona' : 'personas'}`}
                      </span>
                    </div>
                    {needsSubject && (
                      <div className="flex justify-between">
                        <span className="text-gray-500">Asunto:</span>
                        <span className="font-semibold text-gray-800 text-right max-w-[60%] truncate">{subject}</span>
                      </div>
                    )}
                  </div>

                  <div className="bg-white border border-gray-200 rounded-xl p-4">
                    <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Vista previa del mensaje</p>
                    <p className="text-sm text-gray-700 whitespace-pre-wrap leading-relaxed">{messageBody}</p>
                  </div>
                </div>

                <div className="flex justify-between pt-2">
                  <button onClick={() => setStep('compose')} className="btn btn-outline" disabled={isSending}>
                    Atras
                  </button>
                  <button
                    onClick={handleSend}
                    disabled={isSending}
                    className="btn btn-primary flex items-center gap-2 disabled:opacity-50"
                  >
                    {isSending ? (
                      <>
                        <div className="animate-spin rounded-full h-4 w-4 border-t-2 border-white" />
                        Enviando...
                      </>
                    ) : (
                      <>
                        <Send className="h-4 w-4" />
                        Enviar a {recipientCount} {recipientCount === 1 ? 'persona' : 'personas'}
                      </>
                    )}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default TourMassMessageModal;
