import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { Bell, CheckCircle2 } from 'lucide-react';
import { supabase } from '../lib/supabase';

interface Props {
  /** Lo que el viajero busco (destino o nombre del tour). */
  termino: string;
  /** null = sin sesion. */
  userId: string | null;
}

type Estado = 'inicial' | 'guardando' | 'listo' | 'error';

/**
 * "Avisame": el viajero pide un correo cuando una agencia publique un tour de
 * lo que busco y no encontro. Es opt-in (un clic suyo), requiere sesion y cada
 * correo trae un enlace para cancelar. Ver migracion avisame_alertas_de_destino.
 */
const AvisameButton: React.FC<Props> = ({ termino, userId }) => {
  const [estado, setEstado] = useState<Estado>('inicial');
  const [mensajeError, setMensajeError] = useState('');

  const pedirAviso = async () => {
    setEstado('guardando');
    setMensajeError('');
    const { error } = await supabase.rpc('subscribe_destination_alert', { p_term: termino });
    if (error) {
      console.warn('AvisameButton: no se pudo guardar el aviso', error);
      setMensajeError(
        error.code === '54000'
          ? 'Ya tienes 20 avisos activos. Cancela alguno desde el enlace de sus correos para agregar otro.'
          : 'No pudimos guardar tu aviso. Inténtalo de nuevo en un momento.',
      );
      setEstado('error');
      return;
    }
    setEstado('listo');
  };

  if (estado === 'listo') {
    return (
      <div className="mt-6 flex items-start gap-3 rounded-xl bg-green-50 border border-green-200 p-4 text-left">
        <CheckCircle2 className="w-5 h-5 text-green-600 mt-0.5 flex-shrink-0" />
        <p className="text-sm text-green-800">
          Listo. Te escribiremos un correo cuando una agencia publique un tour de <strong>{termino}</strong>.
          Es un solo aviso y podrás cancelarlo desde el mismo correo.
        </p>
      </div>
    );
  }

  return (
    <div className="mt-6 rounded-xl bg-sky-50 border border-sky-100 p-4 text-left">
      <p className="text-sm text-sky-900 mb-3">
        ¿No encontraste <strong>{termino}</strong>? Te avisamos por correo cuando una agencia publique un tour de ese destino.
      </p>
      {userId ? (
        <button
          type="button"
          onClick={pedirAviso}
          disabled={estado === 'guardando'}
          className="btn btn-primary inline-flex items-center gap-2 disabled:opacity-60"
        >
          <Bell className="w-4 h-4" />
          {estado === 'guardando' ? 'Guardando…' : 'Avísame'}
        </button>
      ) : (
        <Link to="/login" className="btn btn-primary inline-flex items-center gap-2">
          <Bell className="w-4 h-4" />
          Inicia sesión para que te avisemos
        </Link>
      )}
      {estado === 'error' && <p className="mt-2 text-sm text-red-600">{mensajeError}</p>}
      <p className="mt-3 text-xs text-sky-700">
        Solo te escribimos una vez por destino y puedes cancelar el aviso desde el correo.
      </p>
    </div>
  );
};

export default AvisameButton;
