import { useEffect, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { BellRing } from 'lucide-react';
import {
  dinero, fechaLarga, invocarSuscripcion, queryKeyCobro, useCobroNotificaciones,
  type TipoSuscripcionNotificaciones,
} from '../lib/cobroNotificaciones';
import { mensajeDeError } from '../lib/errores';

interface Props {
  tipo: TipoSuscripcionNotificaciones;
  /** Solo para la agencia. */
  agencyId?: string | null;
}

/**
 * Estado y contratacion de la suscripcion mensual de notificaciones. No pinta nada mientras el cobro este apagado: el
 * servicio sigue siendo gratis y no hay nada que explicar. La agencia paga una vez y eso cubre a su dueno y a su personal.
 */
export function SuscripcionNotificaciones({ tipo, agencyId }: Props) {
  const queryClient = useQueryClient();
  const cobro = useCobroNotificaciones(tipo, agencyId);
  const estado = cobro.data;
  const cuerpo = { tipo, ...(tipo === 'agencia' ? { agency_id: agencyId } : {}) };

  const sinCobertura = estado?.vigente === true && estado.cobertura === null;
  const precio = useQuery({
    queryKey: ['precio-notificaciones', tipo],
    enabled: Boolean(estado?.activo && estado.precio_listo && estado.es_dueno),
    staleTime: 10 * 60 * 1000,
    queryFn: () => invocarSuscripcion<{ monto: number | null; moneda: string | null }>('manage-notification-subscription', { action: 'precio', ...cuerpo }),
  });

  // Al volver de Stripe el webhook puede tardar unos segundos: se reconsulta un rato.
  const volvioDePagar = typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('notificaciones') === 'ok';
  useEffect(() => {
    if (!volvioDePagar) return;
    const llave = queryKeyCobro(tipo, agencyId);
    const id = window.setInterval(() => { void queryClient.invalidateQueries({ queryKey: llave }); }, 3000);
    const fin = window.setTimeout(() => window.clearInterval(id), 30000);
    return () => { window.clearInterval(id); window.clearTimeout(fin); };
  }, [volvioDePagar, tipo, agencyId, queryClient]);

  const irAStripe = useMutation({
    mutationFn: async (accion: 'contratar' | 'portal') => {
      const r = accion === 'contratar'
        ? await invocarSuscripcion<{ url: string }>('create-notification-subscription', cuerpo)
        : await invocarSuscripcion<{ url: string }>('manage-notification-subscription', { action: 'portal', ...cuerpo });
      if (!r.url) throw new Error('Stripe no devolvio una direccion de pago');
      window.location.href = r.url;
    },
  });
  const cambiarCancelacion = useMutation({
    mutationFn: (accion: 'cancel' | 'resume') => invocarSuscripcion('manage-notification-subscription', { action: accion, ...cuerpo }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeyCobro(tipo, agencyId) }),
  });

  if (cobro.isPending || cobro.isError || !estado || !estado.activo) return null;

  const sub = estado.suscripcion;
  const montoTexto = precio.data?.monto != null ? `${dinero(precio.data.monto, precio.data.moneda ?? 'MXN')} al mes` : null;
  const error = irAStripe.error ?? cambiarCancelacion.error;

  let titulo = 'Notificaciones por SMS';
  let cuerpoTexto: ReactNode;
  let acciones: ReactNode = null;

  if (!estado.vigente) {
    cuerpoTexto = (
      <>Hoy las notificaciones son gratis. A partir del <strong>{fechaLarga(estado.desde)}</strong> serán una suscripción mensual{montoTexto ? ` de ${montoTexto}` : ''}
        {tipo === 'agencia' ? ', que cubre al dueño y a su personal' : ''}. Los códigos para verificar tu teléfono seguirán siendo gratis.</>
    );
  } else if (estado.cobertura === 'plus') {
    titulo = 'Notificaciones incluidas con ToursRed Plus';
    cuerpoTexto = <>Tu membresía ToursRed Plus ya incluye las notificaciones por SMS. No necesitas pagar aparte.</>;
  } else if (estado.cobertura === 'suscripcion' && sub) {
    titulo = 'Notificaciones activas';
    cuerpoTexto = (
      <>
        {sub.cancel_at_period_end
          ? <>Tu suscripción termina el <strong>{fechaLarga(sub.current_period_end)}</strong>; hasta entonces sigues recibiendo avisos.</>
          : <>Tu suscripción está al corriente{sub.price_paid != null ? ` (${dinero(sub.price_paid)} al mes)` : ''}. Se renueva el <strong>{fechaLarga(sub.current_period_end)}</strong>.</>}
        {tipo === 'agencia' ? ' Cubre al dueño y a todo el personal.' : ''}
      </>
    );
    if (estado.es_dueno) {
      acciones = (
        <>
          <button type="button" onClick={() => irAStripe.mutate('portal')} disabled={irAStripe.isPending} className="rounded-md border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50">
            Cambiar tarjeta o ver facturas
          </button>
          <button type="button" onClick={() => cambiarCancelacion.mutate(sub.cancel_at_period_end ? 'resume' : 'cancel')} disabled={cambiarCancelacion.isPending} className="rounded-md border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50">
            {sub.cancel_at_period_end ? 'Reanudar suscripción' : 'Cancelar al terminar el periodo'}
          </button>
        </>
      );
    }
  } else if (estado.cobertura === 'gracia' && sub) {
    titulo = 'No pudimos cobrar tu suscripción';
    cuerpoTexto = (
      <>No se pudo procesar el pago. Sigues recibiendo avisos hasta el <strong>{fechaLarga(sub.en_gracia_hasta)}</strong>; después se pausan si no actualizas la tarjeta.</>
    );
    if (estado.es_dueno) {
      acciones = (
        <button type="button" onClick={() => irAStripe.mutate('portal')} disabled={irAStripe.isPending} className="rounded-md bg-amber-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-amber-700 disabled:opacity-50">
          Actualizar tarjeta
        </button>
      );
    }
  } else if (sinCobertura) {
    titulo = 'Activa tus notificaciones por SMS';
    cuerpoTexto = (
      <>
        {tipo === 'agencia' ? 'Tu agencia' : 'Tu cuenta'} no recibe avisos por SMS hasta contratar la suscripción{montoTexto ? <>: <strong>{montoTexto}</strong></> : ''}.
        {tipo === 'agencia' ? ' Se paga una vez y cubre al dueño y a todo el personal.' : ' Con ToursRed Plus van incluidas.'}
        {' '}Los códigos para verificar tu teléfono siempre son gratis.
        {!estado.es_dueno && ' Pídele al dueño de la agencia que la contrate.'}
      </>
    );
    if (estado.es_dueno && estado.precio_listo) {
      acciones = (
        <button type="button" onClick={() => irAStripe.mutate('contratar')} disabled={irAStripe.isPending} className="rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50">
          {irAStripe.isPending ? 'Abriendo Stripe…' : 'Contratar suscripción'}
        </button>
      );
    }
  } else {
    return null;
  }

  return (
    <div className="rounded-lg border border-blue-100 bg-blue-50 p-4">
      <div className="flex items-start gap-3">
        <BellRing className="mt-0.5 h-5 w-5 flex-shrink-0 text-blue-600" aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <h3 className="font-semibold text-gray-900">{titulo}</h3>
          <p className="mt-1 text-sm text-gray-700">{cuerpoTexto}</p>
          {acciones && <div className="mt-3 flex flex-wrap gap-2">{acciones}</div>}
          {volvioDePagar && estado.cobertura !== 'suscripcion' && (
            <p role="status" className="mt-2 text-sm text-gray-600">Estamos confirmando tu pago con Stripe; esto tarda unos segundos.</p>
          )}
          {error && <p role="alert" className="mt-2 text-sm text-red-600">{mensajeDeError(error)}</p>}
        </div>
      </div>
    </div>
  );
}
