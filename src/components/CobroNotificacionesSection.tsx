import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { BellRing, Loader2 } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { mensajeDeError } from '../lib/errores';
import { dinero, fechaLarga, invocarSuscripcion } from '../lib/cobroNotificaciones';

interface Ajustes {
  cobro_notificaciones_activo: boolean;
  cobro_notificaciones_desde: string | null;
  cobro_notificaciones_dias_gracia: number;
  stripe_price_notificaciones_viajero: string | null;
  stripe_price_notificaciones_agencia: string | null;
}

interface FilaSuscriptor {
  id: string;
  tipo: 'viajero' | 'agencia';
  status: string;
  current_period_end: string | null;
  cancel_at_period_end: boolean;
  en_gracia_hasta: string | null;
  price_paid: number | null;
  users: { first_name: string | null; last_name: string | null; email: string | null } | null;
  agencies: { name: string | null } | null;
}

const COLUMNAS = 'cobro_notificaciones_activo, cobro_notificaciones_desde, cobro_notificaciones_dias_gracia, stripe_price_notificaciones_viajero, stripe_price_notificaciones_agencia';
const FORMATO_PRICE = /^price_[A-Za-z0-9]+$/;

/** `datetime-local` quiere "AAAA-MM-DDTHH:mm" en hora local del navegador. */
function aCampoLocal(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

interface ResumenAviso {
  desde: string;
  por_avisar: number;
  viajeros: number;
  agencias: number;
  enviados?: number;
  fallidos?: number;
  faltan?: number;
}

const ETIQUETA_ESTADO: Record<string, string> = {
  active: 'Al corriente', trialing: 'En prueba', past_due: 'Pago fallido', unpaid: 'Sin pagar', incomplete: 'Sin completar', canceled: 'Cancelada',
};

/**
 * Configuracion del cobro por suscripcion de las notificaciones: interruptor, fecha de inicio, dias de gracia y los Price IDs
 * de Stripe (viajero y agencia). Mientras este apagado nada cambia: el servicio es gratis y las preferencias no se tocan.
 */
export function CobroNotificacionesSection() {
  const queryClient = useQueryClient();
  const ajustes = useQuery({
    queryKey: ['admin-cobro-notificaciones'],
    queryFn: async (): Promise<Ajustes> => {
      const { data, error } = await supabase.from('platform_settings').select(COLUMNAS).single();
      if (error) throw error;
      return data as Ajustes;
    },
  });
  const suscriptores = useQuery({
    queryKey: ['admin-suscriptores-notificaciones'],
    queryFn: async (): Promise<FilaSuscriptor[]> => {
      const { data, error } = await supabase
        .from('suscripciones_notificaciones')
        .select('id, tipo, status, current_period_end, cancel_at_period_end, en_gracia_hasta, price_paid, users(first_name, last_name, email), agencies(name)')
        .order('created_at', { ascending: false })
        .limit(100);
      if (error) throw error;
      return (data ?? []) as unknown as FilaSuscriptor[];
    },
  });

  const [activo, setActivo] = useState(false);
  const [desde, setDesde] = useState('');
  const [gracia, setGracia] = useState('3');
  const [priceViajero, setPriceViajero] = useState('');
  const [priceAgencia, setPriceAgencia] = useState('');
  const [aviso, setAviso] = useState('');
  const [resumenAviso, setResumenAviso] = useState<ResumenAviso | null>(null);
  // «Ahora» se toma al abrir la pantalla (Date.now en el render no es puro); el servidor vuelve a comprobar la fecha al enviar.
  const [ahora] = useState(() => Date.now());

  useEffect(() => {
    const a = ajustes.data;
    if (!a) return;
    // Los campos del formulario se llenan con lo guardado; es la unica sincronizacion servidor -> formulario.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setActivo(a.cobro_notificaciones_activo);
    setDesde(aCampoLocal(a.cobro_notificaciones_desde));
    setGracia(String(a.cobro_notificaciones_dias_gracia));
    setPriceViajero(a.stripe_price_notificaciones_viajero ?? '');
    setPriceAgencia(a.stripe_price_notificaciones_agencia ?? '');
  }, [ajustes.data]);

  const guardar = useMutation({
    mutationFn: async () => {
      const viajero = priceViajero.trim();
      const agencia = priceAgencia.trim();
      if (viajero && !FORMATO_PRICE.test(viajero)) throw new Error('El precio del viajero debe ser un Price ID de Stripe (empieza con price_), no un Product ID.');
      if (agencia && !FORMATO_PRICE.test(agencia)) throw new Error('El precio de la agencia debe ser un Price ID de Stripe (empieza con price_), no un Product ID.');
      const dias = Number(gracia);
      if (!Number.isInteger(dias) || dias < 0 || dias > 30) throw new Error('Los días de gracia deben ser un entero entre 0 y 30.');
      if (activo && (!viajero || !agencia)) throw new Error('Para encender el cobro captura los dos Price IDs (viajero y agencia).');
      const fecha = desde ? new Date(desde) : null;
      if (fecha && Number.isNaN(fecha.getTime())) throw new Error('La fecha de inicio no es válida.');

      const cambiaAEncendido = activo && !ajustes.data?.cobro_notificaciones_activo;
      if (cambiaAEncendido) {
        const cuando = fecha ? `el ${fechaLarga(fecha.toISOString())}` : 'AHORA MISMO (no pusiste fecha)';
        const ok = window.confirm(
          `Vas a encender el cobro de notificaciones ${cuando}.\n\nA partir de entonces se APAGAN las preferencias de SMS de todo viajero y agencia que no esté cubierto (los miembros ToursRed Plus conservan las suyas), y para volver a recibir avisos tendrán que pagar y reactivarlas. Se respaldan antes de apagarse.\n\n¿Continuar?`,
        );
        if (!ok) throw new Error('Cancelado: el cobro sigue como estaba.');
      }

      const { error } = await supabase.from('platform_settings').update({
        cobro_notificaciones_activo: activo,
        cobro_notificaciones_desde: fecha ? fecha.toISOString() : null,
        cobro_notificaciones_dias_gracia: dias,
        stripe_price_notificaciones_viajero: viajero || null,
        stripe_price_notificaciones_agencia: agencia || null,
      }).neq('id', '00000000-0000-0000-0000-000000000000');
      if (error) throw error;
    },
    onSuccess: async () => {
      setAviso('Configuración guardada');
      window.setTimeout(() => setAviso(''), 3000);
      await queryClient.invalidateQueries({ queryKey: ['admin-cobro-notificaciones'] });
    },
  });

  // APAGAR el cobro es inmediato (como los demas interruptores de seguridad): es la accion segura y no debe depender de recordar un
  // segundo boton. El 23-oct-2026 Axel lo apago aqui, pulso el «Guardar» de la pagina (que no guarda esta seccion) y el cobro siguio
  // encendido: la tarjeta de suscripcion siguio saliendo a los usuarios. ENCENDER, en cambio, sigue exigiendo el boton y su confirmacion.
  const apagar = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from('platform_settings').update({ cobro_notificaciones_activo: false })
        .neq('id', '00000000-0000-0000-0000-000000000000');
      if (error) throw error;
    },
    onSuccess: async () => {
      setAviso('Cobro apagado: las notificaciones vuelven a ser gratis');
      window.setTimeout(() => setAviso(''), 4000);
      await queryClient.invalidateQueries({ queryKey: ['admin-cobro-notificaciones'] });
    },
    onError: () => setActivo(true), // no se pudo apagar: el interruptor vuelve a decir la verdad
  });

  // Cambios sin guardar: lo que se ve en el formulario no es lo guardado. Sin este aviso se puede creer que algo ya aplico.
  const hayCambios = Boolean(ajustes.data) && (
    activo !== ajustes.data!.cobro_notificaciones_activo
    || desde !== aCampoLocal(ajustes.data!.cobro_notificaciones_desde)
    || gracia !== String(ajustes.data!.cobro_notificaciones_dias_gracia)
    || priceViajero.trim() !== (ajustes.data!.stripe_price_notificaciones_viajero ?? '')
    || priceAgencia.trim() !== (ajustes.data!.stripe_price_notificaciones_agencia ?? ''));

  // El aviso previo solo tiene sentido con el cobro encendido y la fecha de inicio a futuro (lo que esta GUARDADO, no el formulario).
  const guardado = ajustes.data;
  const fechaGuardada = guardado?.cobro_notificaciones_desde ? new Date(guardado.cobro_notificaciones_desde) : null;
  const avisoDisponible = Boolean(guardado?.cobro_notificaciones_activo && fechaGuardada && fechaGuardada.getTime() > ahora
    && guardado.stripe_price_notificaciones_viajero && guardado.stripe_price_notificaciones_agencia);

  const consultarAviso = useMutation({
    mutationFn: async () => invocarSuscripcion<ResumenAviso>('send-aviso-cobro-notificaciones', { modo: 'simular' }),
    onSuccess: (r) => setResumenAviso(r),
  });
  const enviarAviso = useMutation({
    mutationFn: async () => {
      const ok = window.confirm(
        `Se enviará un correo a ${resumenAviso?.por_avisar ?? 0} persona(s) (${resumenAviso?.viajeros ?? 0} viajeros y ${resumenAviso?.agencias ?? 0} agencias) avisando que el cobro empieza el ${fechaLarga(resumenAviso?.desde)}.

Quien ya lo recibió para esta fecha no lo recibe otra vez. ¿Enviar?`,
      );
      if (!ok) throw new Error('Cancelado: no se envió ningún correo.');
      return invocarSuscripcion<ResumenAviso>('send-aviso-cobro-notificaciones', { modo: 'enviar' });
    },
    onSuccess: (r) => setResumenAviso(r),
  });

  if (ajustes.isPending) {
    return <div className="flex items-center justify-center py-8"><Loader2 className="w-6 h-6 animate-spin text-slate-400" /></div>;
  }
  if (ajustes.isError) {
    return (
      <div className="bg-white rounded-xl shadow-xs border border-slate-200 p-6">
        <p role="alert" className="text-sm text-amber-700">No pudimos leer la configuración del cobro de notificaciones, así que no mostramos los controles.</p>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-xl shadow-xs border border-slate-200 p-6">
      <div className="flex items-center gap-3 mb-4">
        <div className="w-10 h-10 rounded-lg bg-indigo-50 flex items-center justify-center">
          <BellRing className="w-5 h-5 text-indigo-600" />
        </div>
        <div>
          <h3 className="font-semibold text-slate-900">Cobro de notificaciones (suscripción)</h3>
          <p className="text-sm text-slate-500">SMS de reserva y avisos como suscripción mensual en Stripe. Los códigos de verificación siempre son gratis.</p>
        </div>
      </div>

      <div className="space-y-4">
        <label className="flex items-center justify-between gap-4 py-2 border-b border-slate-100">
          <span>
            <span className="block font-medium text-slate-900">Cobrar las notificaciones</span>
            <span className="block text-sm text-slate-500">Apagado: todo es gratis y nada cambia. Encendido: desde la fecha de inicio solo reciben quienes estén cubiertos.</span>
          </span>
          <input type="checkbox" checked={activo} disabled={apagar.isPending}
            onChange={(e) => {
              setActivo(e.target.checked);
              if (!e.target.checked && ajustes.data?.cobro_notificaciones_activo) apagar.mutate();
            }} className="h-5 w-5" aria-label="Cobrar las notificaciones" />
        </label>

        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block text-sm">
            <span className="font-medium text-slate-700">Fecha de inicio del cobro</span>
            <input type="datetime-local" value={desde} onChange={(e) => setDesde(e.target.value)} className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2" />
            <span className="mt-1 block text-slate-500">Hora de tu navegador. Vacía = empieza en cuanto lo enciendas. Avísales a los usuarios con tiempo.</span>
          </label>
          <label className="block text-sm">
            <span className="font-medium text-slate-700">Días de gracia si falla un pago</span>
            <input type="number" min={0} max={30} value={gracia} onChange={(e) => setGracia(e.target.value)} className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2" />
            <span className="mt-1 block text-slate-500">Siguen recibiendo avisos este tiempo antes de pausarse.</span>
          </label>
          <label className="block text-sm">
            <span className="font-medium text-slate-700">Price ID del viajero (Stripe)</span>
            <input type="text" value={priceViajero} onChange={(e) => setPriceViajero(e.target.value)} placeholder="price_..." className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 font-mono" />
          </label>
          <label className="block text-sm">
            <span className="font-medium text-slate-700">Price ID de la agencia (Stripe)</span>
            <input type="text" value={priceAgencia} onChange={(e) => setPriceAgencia(e.target.value)} placeholder="price_..." className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 font-mono" />
          </label>
        </div>
        <p className="text-sm text-slate-500">
          Crea cada precio en Stripe como recurrente mensual en MXN y pega su <strong>Price ID</strong> (empieza con <code>price_</code>), no el Product ID. Debe estar en la misma cuenta de Stripe que usan las llaves de las funciones. El monto que ven los usuarios se lee de Stripe.
        </p>

        {hayCambios && !guardar.isPending && (
          <p role="status" className="text-sm text-amber-800 bg-amber-50 rounded-lg p-3">
            Tienes cambios sin guardar en esta sección. Pulsa «Guardar cobro de notificaciones»: el botón de guardar de la página NO los guarda.
          </p>
        )}
        {apagar.isError && <p role="alert" className="text-sm text-red-600 bg-red-50 rounded-lg p-3">{mensajeDeError(apagar.error)}</p>}
        {guardar.isError && <p role="alert" className="text-sm text-red-600 bg-red-50 rounded-lg p-3">{mensajeDeError(guardar.error)}</p>}
        {aviso && <p role="status" className="text-sm text-green-700 bg-green-50 rounded-lg p-3">{aviso}</p>}

        <div className="flex justify-end">
          <button type="button" onClick={() => guardar.mutate()} disabled={guardar.isPending} className="bg-indigo-600 text-white px-4 py-2 rounded-md hover:bg-indigo-700 disabled:bg-gray-400">
            {guardar.isPending ? 'Guardando…' : 'Guardar cobro de notificaciones'}
          </button>
        </div>
      </div>

      <div className="mt-6 border-t border-slate-100 pt-4">
        <h4 className="font-medium text-slate-900">Aviso previo por correo</h4>
        <p className="mt-1 text-sm text-slate-500">
          Avisa con tiempo a quien perdería sus avisos por SMS al empezar el cobro: viajeros con avisos activos y sin Plus ni suscripción, y el dueño de cada agencia sin suscripción. Quien ya lo recibió para esta fecha no lo recibe otra vez.
        </p>
        {!avisoDisponible && (
          <p className="mt-2 text-sm text-amber-700">
            Para avisar, guarda el cobro encendido, con la fecha de inicio a futuro y los dos Price IDs.
          </p>
        )}
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button type="button" onClick={() => consultarAviso.mutate()} disabled={!avisoDisponible || consultarAviso.isPending}
            className="rounded-md border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50">
            {consultarAviso.isPending ? 'Calculando…' : 'Ver a quién se avisaría'}
          </button>
          <button type="button" onClick={() => enviarAviso.mutate()} disabled={!avisoDisponible || !resumenAviso || resumenAviso.por_avisar === 0 || enviarAviso.isPending}
            className="rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-700 disabled:bg-gray-400">
            {enviarAviso.isPending ? 'Enviando…' : 'Enviar aviso'}
          </button>
        </div>
        {resumenAviso && (
          <p role="status" className="mt-2 text-sm text-slate-700">
            {resumenAviso.enviados != null
              ? `Enviados: ${resumenAviso.enviados}${resumenAviso.fallidos ? ` · No salieron: ${resumenAviso.fallidos} (se pueden reintentar)` : ''}${resumenAviso.faltan ? ` · Faltan ${resumenAviso.faltan}: vuelve a pulsar «Enviar aviso»` : ''}.`
              : `Por avisar: ${resumenAviso.por_avisar} (${resumenAviso.viajeros} viajeros, ${resumenAviso.agencias} agencias). El cobro empieza el ${fechaLarga(resumenAviso.desde)}.`}
          </p>
        )}
        {(consultarAviso.isError || enviarAviso.isError) && (
          <p role="alert" className="mt-2 text-sm text-red-600">{mensajeDeError(enviarAviso.error ?? consultarAviso.error)}</p>
        )}
      </div>

      <div className="mt-6 border-t border-slate-100 pt-4">
        <h4 className="font-medium text-slate-900">Suscriptores ({suscriptores.data?.length ?? 0})</h4>
        {suscriptores.isError && <p role="alert" className="mt-2 text-sm text-red-600">No se pudieron leer las suscripciones.</p>}
        {suscriptores.data && suscriptores.data.length === 0 && <p className="mt-2 text-sm text-slate-500">Todavía no hay suscripciones.</p>}
        {suscriptores.data && suscriptores.data.length > 0 && (
          <div className="mt-2 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-slate-500">
                  <th className="py-1 pr-3 font-medium">Quién</th><th className="py-1 pr-3 font-medium">Tipo</th><th className="py-1 pr-3 font-medium">Estado</th>
                  <th className="py-1 pr-3 font-medium">Vence</th><th className="py-1 pr-3 font-medium">Monto</th>
                </tr>
              </thead>
              <tbody>
                {suscriptores.data.map((f) => (
                  <tr key={f.id} className="border-t border-slate-100">
                    <td className="py-1 pr-3">{f.tipo === 'agencia' ? f.agencies?.name : `${f.users?.first_name ?? ''} ${f.users?.last_name ?? ''}`.trim() || f.users?.email}</td>
                    <td className="py-1 pr-3">{f.tipo === 'agencia' ? 'Agencia' : 'Viajero'}</td>
                    <td className="py-1 pr-3">
                      {ETIQUETA_ESTADO[f.status] ?? f.status}
                      {f.cancel_at_period_end && ' (termina al vencer)'}
                      {f.en_gracia_hasta && ` · gracia hasta ${fechaLarga(f.en_gracia_hasta)}`}
                    </td>
                    <td className="py-1 pr-3">{fechaLarga(f.current_period_end)}</td>
                    <td className="py-1 pr-3">{dinero(f.price_paid)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
