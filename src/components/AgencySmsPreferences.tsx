import { useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../context/AuthContext';
import { useAgencyId } from '../hooks/useAgencyId';
import { supabase } from '../lib/supabase';
import { mensajeDeError } from '../lib/errores';
import { useCobroNotificaciones } from '../lib/cobroNotificaciones';

interface PreferenciasAgencia {
  reserva: boolean;
  cancelacion: boolean;
  mensaje: boolean;
}

const AVISOS: { clave: keyof PreferenciasAgencia; titulo: string; detalle: string }[] = [
  { clave: 'reserva', titulo: 'Nueva reserva', detalle: 'Cuando alguien reserva y paga uno de tus tours.' },
  { clave: 'cancelacion', titulo: 'Cancelación', detalle: 'Cuando un viajero cancela una reserva confirmada.' },
  { clave: 'mensaje', titulo: 'Mensaje nuevo', detalle: 'Cuando un usuario te escribe por la mensajería de la plataforma.' },
];

/**
 * Avisos por SMS para agencias y su personal: cada persona elige cuáles recibir.
 * Sin fila de preferencia no se manda nada (apagado por defecto), y hace falta un teléfono verificado.
 * El personal recibe los de reservas y cancelaciones si tiene el permiso de ver reservas, y los de
 * mensajes si tiene el de ver mensajes; los avisos se calculan en el servidor, no aquí.
 */
export function AgencySmsPreferences() {
  const { user, phoneVerification } = useAuth();
  const queryClient = useQueryClient();
  const { agencyId } = useAgencyId();
  const cobro = useCobroNotificaciones('agencia', agencyId);
  const queryKey = ['agency-sms-preferences', user?.id];
  const todasRef = useRef<HTMLInputElement>(null);

  const query = useQuery({
    queryKey,
    enabled: Boolean(user),
    queryFn: async (): Promise<PreferenciasAgencia> => {
      const { data, error } = await supabase.rpc('get_my_agency_sms_preferences');
      if (error) throw error;
      return {
        reserva: data?.reserva === true,
        cancelacion: data?.cancelacion === true,
        mensaje: data?.mensaje === true,
      };
    },
  });

  const mutation = useMutation({
    mutationFn: async (nuevas: PreferenciasAgencia) => {
      const { error } = await supabase.rpc('set_my_agency_sms_preferences', {
        p_reserva: nuevas.reserva,
        p_cancelacion: nuevas.cancelacion,
        p_mensaje: nuevas.mensaje,
      });
      if (error) throw error;
      return nuevas;
    },
    onSuccess: (nuevas) => queryClient.setQueryData(queryKey, nuevas),
  });

  const preferencias = query.data;
  const activos = preferencias ? AVISOS.filter((a) => preferencias[a.clave]).length : 0;

  // "Todas" queda a medias (indeterminada) cuando solo hay algunas.
  useEffect(() => {
    if (todasRef.current) todasRef.current.indeterminate = activos > 0 && activos < AVISOS.length;
  }, [activos]);

  if (query.isPending) return <p role="status" className="text-sm text-gray-500">Cargando avisos por SMS…</p>;

  const ocupado = query.isError || mutation.isPending;
  const telefonoVerificado = Boolean(phoneVerification?.verified_at);

  const cambiar = (clave: keyof PreferenciasAgencia, valor: boolean) => {
    if (!preferencias) return;
    mutation.mutate({ ...preferencias, [clave]: valor });
  };
  const cambiarTodas = (valor: boolean) => {
    mutation.mutate({ reserva: valor, cancelacion: valor, mensaje: valor });
  };

  return (
    <div className="pt-6">
      <h2 className="font-semibold text-gray-900">Avisos por SMS</h2>
      <p className="text-sm text-gray-600 mt-1">
        Elige de qué quieres enterarte por mensaje de texto.{!cobro.data?.activo && ' Por ahora el servicio no tiene costo.'}
      </p>

      {!telefonoVerificado && (
        <p role="alert" className="mt-3 rounded-md bg-amber-50 p-3 text-sm text-amber-800">
          Necesitas un teléfono verificado para recibir SMS.{' '}
          <Link to="/verificar-telefono" className="font-medium underline">Verificar mi teléfono</Link>
        </p>
      )}

      <label className="mt-4 flex items-center gap-2 font-medium text-gray-900">
        <input
          ref={todasRef}
          type="checkbox"
          checked={activos === AVISOS.length}
          disabled={ocupado}
          onChange={(e) => cambiarTodas(e.target.checked)}
        />
        Todos los avisos
      </label>

      <div className="mt-2 space-y-2 pl-6">
        {AVISOS.map((aviso) => (
          <label key={aviso.clave} className="flex items-start gap-2">
            <input
              type="checkbox"
              className="mt-1"
              checked={preferencias?.[aviso.clave] ?? false}
              disabled={ocupado}
              onChange={(e) => cambiar(aviso.clave, e.target.checked)}
            />
            <span>
              <span className="block text-gray-900">{aviso.titulo}</span>
              <span className="block text-sm text-gray-600">{aviso.detalle}</span>
            </span>
          </label>
        ))}
      </div>

      <p className="mt-3 text-sm text-gray-600">
        Si eres parte del personal de una agencia, recibes los avisos de reservas y cancelaciones si tienes
        permiso para ver reservas, y los de mensajes si tienes permiso para ver mensajes. Los códigos para
        verificar tu teléfono no dependen de esta elección. No incluye publicidad.
      </p>

      {(query.isError || mutation.isError) && (
        <p role="alert" className="mt-2 text-sm text-red-600">
          {mensajeDeError(mutation.error ?? query.error) || 'No se pudieron guardar o consultar los avisos. Intenta de nuevo.'}
        </p>
      )}
    </div>
  );
}
