import { useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../context/AuthContext';
import { supabase } from '../lib/supabase';
import { mensajeDeError } from '../lib/errores';
import { useCobroNotificaciones } from '../lib/cobroNotificaciones';

interface PreferenciasViajero {
  confirmacion: boolean;
  cancelacion: boolean;
  recordatorio: boolean;
}

const AVISOS: { clave: keyof PreferenciasViajero; titulo: string; detalle: string }[] = [
  { clave: 'confirmacion', titulo: 'Confirmación de reservas', detalle: 'Cuando tu reserva queda confirmada.' },
  { clave: 'cancelacion', titulo: 'Cancelación de reservas', detalle: 'Cuando se cancela una reserva tuya, la hayas cancelado tú o la agencia.' },
  { clave: 'recordatorio', titulo: 'Recordatorios de tours', detalle: 'El día antes de tu tour, con el punto de encuentro.' },
];

/**
 * Avisos por SMS del viajero: elige cuáles recibir (confirmación, cancelación y recordatorio). Apagados por defecto, y hace falta un
 * teléfono verificado. La sección SOLO sale si el viajero está cubierto (ToursRed Plus, suscripción, gracia, o el cobro apagado):
 * sin cobertura no hay nada que elegir y la tarjeta de suscripción de arriba explica cómo activarlos. Los códigos para verificar el
 * teléfono no dependen de esto.
 */
export function SmsPreferences() {
  const { user, phoneVerification } = useAuth();
  const queryClient = useQueryClient();
  const cobro = useCobroNotificaciones('viajero');
  const queryKey = ['traveler-sms-preferences', user?.id];
  const todasRef = useRef<HTMLInputElement>(null);

  const query = useQuery({
    queryKey,
    enabled: Boolean(user),
    queryFn: async (): Promise<PreferenciasViajero> => {
      const { data, error } = await supabase.rpc('get_my_traveler_sms_preferences');
      if (error) throw error;
      return {
        confirmacion: data?.confirmacion === true,
        cancelacion: data?.cancelacion === true,
        recordatorio: data?.recordatorio === true,
      };
    },
  });

  const mutation = useMutation({
    mutationFn: async (nuevas: PreferenciasViajero) => {
      const { error } = await supabase.rpc('set_my_traveler_sms_preferences', {
        p_confirmacion: nuevas.confirmacion,
        p_cancelacion: nuevas.cancelacion,
        p_recordatorio: nuevas.recordatorio,
      });
      if (error) throw error;
      return nuevas;
    },
    onSuccess: (nuevas) => queryClient.setQueryData(queryKey, nuevas),
  });

  const preferencias = query.data;
  const activos = preferencias ? AVISOS.filter((a) => preferencias[a.clave]).length : 0;

  // "Todos" queda a medias (indeterminado) cuando solo hay algunos.
  useEffect(() => {
    if (todasRef.current) todasRef.current.indeterminate = activos > 0 && activos < AVISOS.length;
  }, [activos]);

  // Sin cobertura (cobro vigente y ni Plus ni suscripción) no hay avisos que elegir. Si el estado del cobro no se pudo leer se muestra
  // la sección: es más seguro dejar elegir que esconder el control por un error de lectura (el servidor decide de todos modos).
  if (cobro.data && cobro.data.cobertura === null) return null;

  if (query.isPending) return <p role="status" className="text-sm text-gray-500">Cargando avisos por SMS…</p>;

  const ocupado = query.isError || mutation.isPending;
  const telefonoVerificado = Boolean(phoneVerification?.verified_at);

  const cambiar = (clave: keyof PreferenciasViajero, valor: boolean) => {
    if (!preferencias) return;
    mutation.mutate({ ...preferencias, [clave]: valor });
  };
  const cambiarTodas = (valor: boolean) => {
    mutation.mutate({ confirmacion: valor, cancelacion: valor, recordatorio: valor });
  };

  return (
    <div className="my-6 border-t pt-4">
      <h2 className="font-semibold text-gray-900">Avisos por SMS</h2>
      <p className="mt-1 text-sm text-gray-600">Elige de qué quieres enterarte por mensaje de texto.</p>

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
        Esto no desactiva los códigos necesarios para verificar tu teléfono. No incluye publicidad.
      </p>

      {(query.isError || mutation.isError) && (
        <p role="alert" className="mt-2 text-sm text-red-600">
          {mensajeDeError(mutation.error ?? query.error) || 'No se pudieron guardar o consultar los avisos. Intenta de nuevo.'}
        </p>
      )}
    </div>
  );
}
