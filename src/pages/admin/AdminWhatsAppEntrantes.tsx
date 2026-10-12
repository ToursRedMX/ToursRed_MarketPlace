import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, ArrowLeft, Ban, Check, CheckCheck, Clock, FileText, MessageCircle, Paperclip, Search, Send, ShieldOff, User } from 'lucide-react';
import { FunctionsHttpError } from '@supabase/supabase-js';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import { supabase } from '../../lib/supabase';
import { mensajeDeError } from '../../lib/errores';
import { useAuth } from '../../context/AuthContext';

const BUCKET = 'whatsapp-media';
const VENTANA_MS = 24 * 60 * 60 * 1000;

interface Contacto {
  telefono: string;
  telefono_twilio: string;
  nombre_perfil: string | null;
  user_id: string | null;
  bloqueado: boolean;
  bloqueado_en: string | null;
  motivo_bloqueo: string | null;
  descartados_bloqueado: number;
  ultimo_entrante_en: string | null;
  ultimo_mensaje_en: string | null;
  no_leidos: number;
}

interface Adjunto {
  id: string;
  content_type: string;
  tamano_bytes: number | null;
  storage_path: string | null;
  estado: 'pendiente' | 'guardado' | 'fallido' | 'omitido';
  codigo_error: string | null;
}

interface Mensaje {
  id: string;
  telefono: string;
  direccion: 'entrante' | 'saliente';
  tipo: 'texto' | 'plantilla' | 'media';
  cuerpo: string | null;
  estado: 'recibido' | 'enviando' | 'enviado' | 'entregado' | 'leido' | 'fallido' | 'desconocido';
  codigo_error: string | null;
  creado_en: string;
  whatsapp_adjuntos: Adjunto[];
}

interface Plantilla {
  id: string;
  nombre: string;
  descripcion: string | null;
  cuerpo_ejemplo: string | null;
  variables: number;
}

type Filtro = 'todos' | 'sin_leer' | 'bloqueados';

const fecha = (iso: string | null) => (iso ? format(new Date(iso), 'dd MMM HH:mm', { locale: es }) : '');
const nombreDe = (c: Contacto) => c.nombre_perfil || c.telefono;

/** Mensaje legible de un error de Edge Function (el cuerpo trae `error`). */
async function errorDeFuncion(error: unknown): Promise<string> {
  if (error instanceof FunctionsHttpError) {
    const body = await error.context.json().catch(() => null);
    return body?.error || error.message;
  }
  return mensajeDeError(error);
}

const EstadoSaliente: React.FC<{ m: Mensaje }> = ({ m }) => {
  switch (m.estado) {
    case 'enviando': return <span className="inline-flex items-center gap-x-1"><Clock className="h-3 w-3" />Enviando</span>;
    case 'enviado': return <span className="inline-flex items-center gap-x-1"><Check className="h-3 w-3" />Enviado</span>;
    case 'entregado': return <span className="inline-flex items-center gap-x-1"><CheckCheck className="h-3 w-3" />Entregado</span>;
    case 'leido': return <span className="inline-flex items-center gap-x-1 text-blue-200"><CheckCheck className="h-3 w-3" />Leído</span>;
    case 'desconocido': return <span className="inline-flex items-center gap-x-1 text-amber-200"><AlertTriangle className="h-3 w-3" />Sin confirmar</span>;
    case 'fallido': return <span className="inline-flex items-center gap-x-1 text-red-200"><AlertTriangle className="h-3 w-3" />No se envió{m.codigo_error ? ` (${m.codigo_error})` : ''}</span>;
    default: return null;
  }
};

const AdjuntoVista: React.FC<{ adjunto: Adjunto }> = ({ adjunto }) => {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let vivo = true;
    if (adjunto.estado === 'guardado' && adjunto.storage_path) {
      void supabase.storage.from(BUCKET).createSignedUrl(adjunto.storage_path, 600).then(({ data }) => { if (vivo) setUrl(data?.signedUrl ?? null); });
    }
    return () => { vivo = false; };
  }, [adjunto.estado, adjunto.storage_path]);

  if (adjunto.estado === 'pendiente') return <div className="text-xs italic opacity-80 mt-1">Descargando adjunto…</div>;
  if (adjunto.estado !== 'guardado') {
    const motivo = adjunto.estado === 'omitido' ? 'omitido (tipo o tamaño no permitido)' : 'no se pudo descargar';
    return <div className="text-xs italic opacity-80 mt-1 flex items-center gap-x-1"><Paperclip className="h-3 w-3" />Adjunto {motivo}</div>;
  }
  if (!url) return <div className="text-xs italic opacity-80 mt-1">Cargando adjunto…</div>;
  if (adjunto.content_type.startsWith('image/')) {
    return <a href={url} target="_blank" rel="noopener noreferrer"><img src={url} alt="Adjunto de WhatsApp" className="mt-1 max-h-64 rounded" /></a>;
  }
  if (adjunto.content_type.startsWith('video/')) return <video src={url} controls className="mt-1 max-h-64 rounded" />;
  if (adjunto.content_type.startsWith('audio/')) return <audio src={url} controls className="mt-1 w-full" />;
  return (
    <a href={url} target="_blank" rel="noopener noreferrer" className="mt-1 inline-flex items-center gap-x-1 text-sm underline">
      <FileText className="h-4 w-4" />Abrir archivo ({adjunto.content_type.split('/')[1]})
    </a>
  );
};

const AdminWhatsAppEntrantes: React.FC = () => {
  const { isSuperAdmin } = useAuth();
  const queryClient = useQueryClient();
  const [seleccionado, setSeleccionado] = useState<string | null>(null);
  const [busqueda, setBusqueda] = useState('');
  const [filtro, setFiltro] = useState<Filtro>('todos');
  const [texto, setTexto] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [errorEnvio, setErrorEnvio] = useState('');
  const [errorAccion, setErrorAccion] = useState('');
  const [plantillaId, setPlantillaId] = useState('');
  const [variables, setVariables] = useState<Record<string, string>>({});
  const [bloqueando, setBloqueando] = useState(false);
  const [motivo, setMotivo] = useState('');
  const [ahora, setAhora] = useState(() => Date.now());
  const finHilo = useRef<HTMLDivElement>(null);

  const contactosQuery = useQuery({
    queryKey: ['wa-contactos'],
    enabled: isSuperAdmin,
    queryFn: async () => {
      const { data, error: err } = await supabase.from('whatsapp_contactos').select('*').order('ultimo_mensaje_en', { ascending: false, nullsFirst: false }).limit(300);
      if (err) throw err;
      return (data ?? []) as Contacto[];
    },
  });
  const plantillasQuery = useQuery({
    queryKey: ['wa-plantillas'],
    enabled: isSuperAdmin,
    queryFn: async () => {
      const { data, error: err } = await supabase.from('whatsapp_plantillas').select('id, nombre, descripcion, cuerpo_ejemplo, variables').eq('activa', true).order('nombre');
      if (err) throw err;
      return (data ?? []) as Plantilla[];
    },
  });
  const hiloQuery = useQuery({
    queryKey: ['wa-hilo', seleccionado],
    enabled: isSuperAdmin && seleccionado !== null,
    queryFn: async () => {
      const { data, error: err } = await supabase.from('whatsapp_mensajes')
        .select('id, telefono, direccion, tipo, cuerpo, estado, codigo_error, creado_en, whatsapp_adjuntos(id, content_type, tamano_bytes, storage_path, estado, codigo_error)')
        .eq('telefono', seleccionado).order('creado_en', { ascending: false }).limit(200);
      if (err) throw err;
      return ((data ?? []) as Mensaje[]).reverse();
    },
  });
  const contactos = useMemo(() => contactosQuery.data ?? [], [contactosQuery.data]);
  const mensajes = useMemo(() => (seleccionado ? hiloQuery.data ?? [] : []), [seleccionado, hiloQuery.data]);
  const plantillas = useMemo(() => plantillasQuery.data ?? [], [plantillasQuery.data]);
  const cargando = isSuperAdmin && contactosQuery.isLoading;
  const error = errorAccion || (contactosQuery.error ? mensajeDeError(contactosQuery.error) : '') || (hiloQuery.error ? mensajeDeError(hiloQuery.error) : '');

  // Realtime (respeta RLS): cualquier cambio vuelve a pedir lo que se esta viendo.
  useEffect(() => {
    if (!isSuperAdmin) return;
    let temporizador: ReturnType<typeof setTimeout> | undefined;
    const refrescar = () => {
      clearTimeout(temporizador);
      temporizador = setTimeout(() => {
        void queryClient.invalidateQueries({ queryKey: ['wa-contactos'] });
        void queryClient.invalidateQueries({ queryKey: ['wa-hilo'] });
      }, 300);
    };
    const canal = supabase.channel(`whatsapp_bandeja_${Math.random().toString(36).slice(2)}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'whatsapp_mensajes' }, refrescar)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'whatsapp_contactos' }, refrescar)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'whatsapp_adjuntos' }, refrescar)
      .subscribe();
    return () => { clearTimeout(temporizador); void supabase.removeChannel(canal); };
  }, [isSuperAdmin, queryClient]);

  // El contador de la ventana de 24 h se refresca cada minuto.
  useEffect(() => { const t = setInterval(() => setAhora(Date.now()), 60000); return () => clearInterval(t); }, []);

  const contacto = useMemo(() => contactos.find(c => c.telefono === seleccionado) ?? null, [contactos, seleccionado]);

  // Cambiar de conversacion limpia los borradores; el handler lo hace, no un efecto.
  const seleccionar = (telefono: string | null) => {
    setSeleccionado(telefono);
    setTexto(''); setErrorEnvio(''); setErrorAccion(''); setPlantillaId(''); setVariables({}); setBloqueando(false);
  };

  useEffect(() => { finHilo.current?.scrollIntoView({ block: 'end' }); }, [mensajes.length]);

  // Al abrir una conversacion con mensajes sin leer se marcan como leidos.
  const sinLeer = contacto?.no_leidos ?? 0;
  const telefonoAbierto = contacto?.telefono;
  useEffect(() => {
    if (telefonoAbierto && sinLeer > 0) void supabase.rpc('whatsapp_marcar_leido', { p_telefono: telefonoAbierto });
  }, [telefonoAbierto, sinLeer]);

  const restanteMs = contacto?.ultimo_entrante_en ? new Date(contacto.ultimo_entrante_en).getTime() + VENTANA_MS - ahora : 0;
  const ventanaAbierta = restanteMs > 0;
  const plantilla = plantillas.find(p => p.id === plantillaId) ?? null;

  const filtrados = useMemo(() => {
    const q = busqueda.trim().toLowerCase();
    return contactos.filter(c => {
      if (filtro === 'sin_leer' && c.no_leidos === 0) return false;
      if (filtro === 'bloqueados' && !c.bloqueado) return false;
      if (filtro !== 'bloqueados' && c.bloqueado) return false;
      return !q || c.telefono.includes(q) || (c.nombre_perfil ?? '').toLowerCase().includes(q);
    });
  }, [contactos, busqueda, filtro]);

  const enviar = async (tipo: 'texto' | 'plantilla') => {
    if (!contacto || enviando) return;
    setEnviando(true); setErrorEnvio('');
    try {
      const { error: err } = await supabase.functions.invoke('whatsapp-enviar-respuesta', {
        body: tipo === 'texto'
          ? { telefono: contacto.telefono, tipo, cuerpo: texto.trim() }
          : { telefono: contacto.telefono, tipo, plantilla_id: plantillaId, variables },
      });
      if (err) throw new Error(await errorDeFuncion(err));
      if (tipo === 'texto') setTexto(''); else { setPlantillaId(''); setVariables({}); }
    } catch (e) {
      setErrorEnvio(mensajeDeError(e));
    } finally {
      setEnviando(false);
      void queryClient.invalidateQueries({ queryKey: ['wa-hilo', contacto.telefono] });
    }
  };

  const cambiarBloqueo = async (bloquear: boolean) => {
    if (!contacto) return;
    const { error: err } = await supabase.rpc('whatsapp_bloquear_contacto', { p_telefono: contacto.telefono, p_bloquear: bloquear, p_motivo: bloquear ? motivo : null });
    if (err) { setErrorAccion(mensajeDeError(err)); return; }
    setErrorAccion(''); setBloqueando(false); setMotivo('');
    void queryClient.invalidateQueries({ queryKey: ['wa-contactos'] });
  };

  if (!isSuperAdmin) {
    return (
      <div className="container mx-auto px-4 py-12 text-center text-gray-600">
        <ShieldOff className="h-10 w-10 mx-auto mb-3 text-gray-400" />
        Esta sección es solo para el super administrador.
      </div>
    );
  }

  if (cargando) {
    return (
      <div className="container mx-auto px-4 py-12 flex justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-primary-600"></div>
      </div>
    );
  }

  const horas = Math.floor(restanteMs / 3600000);
  const minutos = Math.floor((restanteMs % 3600000) / 60000);

  return (
    <div className="h-screen flex bg-gray-50">
      {/* Lista de contactos */}
      <div className={`${seleccionado ? 'hidden md:flex' : 'flex'} w-full md:w-1/3 bg-white border-r border-gray-200 flex-col`}>
        <div className="p-4 border-b border-gray-200">
          <h1 className="text-lg font-semibold flex items-center">
            <MessageCircle className="h-5 w-5 mr-2" />
            Mensajes Entrantes de WhatsApp
          </h1>
          <p className="text-sm text-gray-600 mt-1">{contactos.filter(c => !c.bloqueado).length} contactos · {contactos.reduce((s, c) => s + c.no_leidos, 0)} sin leer</p>
        </div>
        <div className="p-4 border-b border-gray-200 flex flex-col gap-y-3">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
            <input type="text" placeholder="Buscar por nombre o teléfono..." value={busqueda} onChange={e => setBusqueda(e.target.value)}
              className="pl-10 pr-4 py-2 w-full border border-gray-300 rounded-md focus:outline-hidden focus:ring-2 focus:ring-primary-500 focus:border-primary-500 text-sm" />
          </div>
          <div className="flex gap-x-2 text-sm">
            {([['todos', 'Todos'], ['sin_leer', 'Sin leer'], ['bloqueados', 'Bloqueados']] as [Filtro, string][]).map(([valor, etiqueta]) => (
              <button key={valor} onClick={() => setFiltro(valor)}
                className={`px-3 py-1 rounded-full border ${filtro === valor ? 'bg-primary-600 text-white border-primary-600' : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'}`}>{etiqueta}</button>
            ))}
          </div>
        </div>
        {error && <div className="m-4 p-3 bg-red-50 border border-red-200 text-red-700 text-sm rounded">{error}</div>}
        <div className="flex-1 overflow-y-auto">
          {filtrados.length === 0 ? (
            <div className="p-8 text-center text-gray-500 text-sm">
              {contactos.length === 0 ? 'Todavía no ha llegado ningún mensaje.' : 'Ningún contacto coincide con el filtro.'}
            </div>
          ) : filtrados.map(c => (
            <button key={c.telefono} onClick={() => seleccionar(c.telefono)}
              className={`w-full text-left p-4 border-b border-gray-100 hover:bg-gray-50 ${seleccionado === c.telefono ? 'bg-primary-50' : ''}`}>
              <div className="flex items-center justify-between">
                <span className="font-medium text-gray-900 truncate">{nombreDe(c)}</span>
                {c.no_leidos > 0 && <span className="ml-2 bg-primary-600 text-white text-xs rounded-full px-2 py-0.5">{c.no_leidos}</span>}
              </div>
              <div className="flex items-center justify-between text-xs text-gray-500 mt-1">
                <span className="flex items-center gap-x-2">
                  {c.nombre_perfil && <span>{c.telefono}</span>}
                  {c.user_id && <span className="inline-flex items-center text-green-700"><User className="h-3 w-3 mr-0.5" />Usuario</span>}
                  {c.bloqueado && <span className="inline-flex items-center text-red-700"><Ban className="h-3 w-3 mr-0.5" />Bloqueado</span>}
                </span>
                <span>{fecha(c.ultimo_mensaje_en)}</span>
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* Hilo */}
      <div className={`${seleccionado ? 'flex' : 'hidden md:flex'} flex-1 flex-col`}>
        {!contacto ? (
          <div className="flex-1 flex items-center justify-center text-gray-500">
            <div className="text-center"><MessageCircle className="h-12 w-12 mx-auto mb-3 text-gray-300" />Selecciona una conversación</div>
          </div>
        ) : (
          <>
            <div className="p-4 bg-white border-b border-gray-200 flex items-center justify-between">
              <div className="flex items-center gap-x-3 min-w-0">
                <button className="md:hidden" onClick={() => seleccionar(null)} aria-label="Volver"><ArrowLeft className="h-5 w-5" /></button>
                <div className="min-w-0">
                  <div className="font-semibold truncate">{nombreDe(contacto)}</div>
                  <div className="text-xs text-gray-500">
                    {contacto.telefono}{contacto.user_id ? ' · usuario registrado' : ' · número no registrado'}
                  </div>
                </div>
              </div>
              {contacto.bloqueado ? (
                <button onClick={() => void cambiarBloqueo(false)} className="text-sm px-3 py-1.5 border border-gray-300 rounded-md hover:bg-gray-50">Desbloquear</button>
              ) : (
                <button onClick={() => setBloqueando(true)} className="text-sm px-3 py-1.5 border border-red-300 text-red-700 rounded-md hover:bg-red-50 inline-flex items-center gap-x-1">
                  <Ban className="h-4 w-4" />Bloquear
                </button>
              )}
            </div>

            {bloqueando && (
              <div className="p-4 bg-red-50 border-b border-red-200 text-sm">
                <p className="text-red-800 mb-2">Si lo bloqueas, <strong>no se recibirán ni se guardarán</strong> más mensajes de este número y no podrás responderle hasta desbloquearlo. El historial actual se conserva.</p>
                <input value={motivo} onChange={e => setMotivo(e.target.value)} maxLength={500} placeholder="Motivo (opcional)" className="w-full border border-red-300 rounded-md px-3 py-2 mb-2" />
                <div className="flex gap-x-2">
                  <button onClick={() => void cambiarBloqueo(true)} className="px-3 py-1.5 bg-red-600 text-white rounded-md hover:bg-red-700">Bloquear número</button>
                  <button onClick={() => setBloqueando(false)} className="px-3 py-1.5 border border-gray-300 bg-white rounded-md">Cancelar</button>
                </div>
              </div>
            )}
            {contacto.bloqueado && (
              <div className="p-3 bg-red-50 border-b border-red-200 text-sm text-red-800">
                Número bloqueado{contacto.bloqueado_en ? ` el ${fecha(contacto.bloqueado_en)}` : ''}{contacto.motivo_bloqueo ? ` — ${contacto.motivo_bloqueo}` : ''}.
                {contacto.descartados_bloqueado > 0 && ` Se descartaron ${contacto.descartados_bloqueado} mensajes desde entonces.`}
              </div>
            )}

            <div className="flex-1 overflow-y-auto p-4 space-y-3">
              {mensajes.map(m => (
                <div key={m.id} className={`flex ${m.direccion === 'saliente' ? 'justify-end' : 'justify-start'}`}>
                  <div className={`max-w-[75%] rounded-lg px-3 py-2 ${m.direccion === 'saliente' ? 'bg-primary-600 text-white' : 'bg-white border border-gray-200 text-gray-900'}`}>
                    {m.tipo === 'plantilla' && <div className="text-xs opacity-80 mb-1">Plantilla</div>}
                    {m.cuerpo && <div className="whitespace-pre-wrap break-words text-sm">{m.cuerpo}</div>}
                    {m.whatsapp_adjuntos.map(a => <AdjuntoVista key={a.id} adjunto={a} />)}
                    <div className={`text-xs mt-1 flex items-center justify-end gap-x-2 ${m.direccion === 'saliente' ? 'text-primary-100' : 'text-gray-400'}`}>
                      {m.direccion === 'saliente' && <EstadoSaliente m={m} />}
                      <span>{fecha(m.creado_en)}</span>
                    </div>
                  </div>
                </div>
              ))}
              <div ref={finHilo} />
            </div>

            {/* Respuesta */}
            <div className="p-4 bg-white border-t border-gray-200">
              {errorEnvio && <div className="mb-3 p-3 bg-red-50 border border-red-200 text-red-700 text-sm rounded">{errorEnvio}</div>}
              {contacto.bloqueado ? (
                <p className="text-sm text-gray-500">Desbloquea el número para poder responderle.</p>
              ) : ventanaAbierta ? (
                <>
                  <p className="text-xs text-gray-500 mb-2">Puedes responder con texto libre {horas > 0 ? `${horas} h ` : ''}{minutos} min más (WhatsApp permite 24 h desde su último mensaje).</p>
                  <div className="flex gap-x-2">
                    <textarea value={texto} onChange={e => setTexto(e.target.value)} rows={2} maxLength={4096} placeholder="Escribe una respuesta..."
                      className="flex-1 border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-hidden focus:ring-2 focus:ring-primary-500" />
                    <button onClick={() => void enviar('texto')} disabled={enviando || !texto.trim()}
                      className="px-4 bg-primary-600 text-white rounded-md hover:bg-primary-700 disabled:opacity-50 inline-flex items-center gap-x-1">
                      <Send className="h-4 w-4" />{enviando ? 'Enviando…' : 'Enviar'}
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <div className="p-3 bg-amber-50 border border-amber-200 rounded text-sm text-amber-800 mb-3">
                    Pasaron más de 24 horas desde su último mensaje. WhatsApp solo permite enviar una <strong>plantilla aprobada</strong>.
                  </div>
                  {plantillas.length === 0 ? (
                    <p className="text-sm text-gray-500">No hay plantillas activas todavía. Se dan de alta en la tabla <code>whatsapp_plantillas</code> con el <code>ContentSid</code> aprobado en Twilio.</p>
                  ) : (
                    <div className="space-y-2">
                      <select value={plantillaId} onChange={e => { setPlantillaId(e.target.value); setVariables({}); }} className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm">
                        <option value="">Elige una plantilla…</option>
                        {plantillas.map(p => <option key={p.id} value={p.id}>{p.nombre}</option>)}
                      </select>
                      {plantilla?.cuerpo_ejemplo && <p className="text-xs text-gray-500 whitespace-pre-wrap">{plantilla.cuerpo_ejemplo}</p>}
                      {plantilla && Array.from({ length: plantilla.variables }, (_, i) => String(i + 1)).map(n => (
                        <input key={n} value={variables[n] ?? ''} onChange={e => setVariables(v => ({ ...v, [n]: e.target.value }))} maxLength={1024}
                          placeholder={`Variable {{${n}}}`} className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm" />
                      ))}
                      <button onClick={() => void enviar('plantilla')}
                        disabled={enviando || !plantilla || Array.from({ length: plantilla.variables }, (_, i) => String(i + 1)).some(n => !(variables[n] ?? '').trim())}
                        className="px-4 py-2 bg-primary-600 text-white rounded-md hover:bg-primary-700 disabled:opacity-50 inline-flex items-center gap-x-1 text-sm">
                        <Send className="h-4 w-4" />{enviando ? 'Enviando…' : 'Enviar plantilla'}
                      </button>
                    </div>
                  )}
                </>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
};

export default AdminWhatsAppEntrantes;
